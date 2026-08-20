/** Stage 1 acceptance tests: gateway policy must reject excess work before llama.cpp is called. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGateway } from '../src/gateway.mjs';
import { GatewayStore } from '../src/store.mjs';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function createFixture({ delayMs = 40, globalConcurrent = 4 } = {}) {
  let backendCalls = 0;
  const backend = http.createServer((req, res) => {
    backendCalls += 1;
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"reasoning_content":"Thinking"},"finish_reason":null}]}\n\n');
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":" answer"},"finish_reason":"stop"}],"usage":{"completion_tokens":2}}\n\n');
        res.end('data: [DONE]\n\n');
      }, delayMs);
    }, delayMs);
  });
  const backendPort = await listen(backend);
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-test-'));
  const config = {
    bindHost: '127.0.0.1',
    port: 0,
    llamaBaseUrl: `http://127.0.0.1:${backendPort}/v1`,
    llamaApiKey: '',
    publicModelAlias: 'gemma-e2b',
    backendModel: 'ggml-org/gemma-4-E2B-it-GGUF:Q8_0',
    keyPepper: 'test-pepper-that-is-longer-than-thirty-two-characters',
    adminToken: 'test-admin-token-that-is-longer-than-thirty-two-characters',
    databasePath: path.join(temporaryDirectory, 'gateway.sqlite'),
    globalConcurrent,
    perKeyConcurrent: 1,
    defaultMaxOutput: 64,
    absoluteMaxOutput: 128,
    maxBodyBytes: 4096,
    maxMessages: 4,
    maxInputCharacters: 200,
    requestTimeoutMs: 5000,
    rateBurst: 100,
    defaultRpmLimit: 1000,
    defaultDailyRequestLimit: 1000,
    corsOrigins: [],
  };
  const store = new GatewayStore(config.databasePath, config.keyPepper);
  const gateway = createGateway({ config, store, logger: { info() {}, error() {} } });
  await gateway.start();
  const gatewayPort = gateway.server.address().port;
  const createKey = (name) => store.createKey({ tenantId: name, label: name, expiresAt: null, activeLimit: 1, rpmLimit: 1000, dailyRequestLimit: 1000, maxOutput: 64 });
  return {
    baseUrl: `http://127.0.0.1:${gatewayPort}`,
    createKey,
    calls: () => backendCalls,
    async cleanup() {
      await gateway.stop();
      await close(backend);
      store.close();
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    },
  };
}

function chatRequest(baseUrl, apiKey, overrides = {}) {
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gemma-e2b', stream: true, max_tokens: 32, messages: [{ role: 'user', content: 'hello' }], ...overrides }),
  });
}

test('rejects a request with an invalid API key before backend dispatch', async () => {
  const fixture = await createFixture();
  try {
    const response = await chatRequest(fixture.baseUrl, 'gma_live_not-a-real-key');
    assert.equal(response.status, 401);
    assert.equal(fixture.calls(), 0);
  } finally {
    await fixture.cleanup();
  }
});

test('forwards SSE while recording reasoning-compatible stream metadata', async () => {
  const fixture = await createFixture();
  try {
    const key = fixture.createKey('one');
    const response = await chatRequest(fixture.baseUrl, key.rawKey);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /reasoning_content/);
    assert.match(body, /data: \[DONE\]/);
    assert.equal(fixture.calls(), 1);
  } finally {
    await fixture.cleanup();
  }
});

test('rejects a second simultaneous generation from the same key before backend dispatch', async () => {
  const fixture = await createFixture({ delayMs: 120 });
  try {
    const key = fixture.createKey('one');
    const first = chatRequest(fixture.baseUrl, key.rawKey);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await chatRequest(fixture.baseUrl, key.rawKey);
    assert.equal(second.status, 429);
    assert.equal((await second.json()).error.code, 'key_concurrency_exceeded');
    await (await first).text();
    assert.equal(fixture.calls(), 1);
  } finally {
    await fixture.cleanup();
  }
});

test('rejects the fifth concurrent key before backend dispatch', async () => {
  const fixture = await createFixture({ delayMs: 140, globalConcurrent: 4 });
  try {
    const keys = Array.from({ length: 5 }, (_, index) => fixture.createKey(`tenant-${index}`));
    const firstFour = keys.slice(0, 4).map((key) => chatRequest(fixture.baseUrl, key.rawKey));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const fifth = await chatRequest(fixture.baseUrl, keys[4].rawKey);
    assert.equal(fifth.status, 429);
    assert.equal((await fifth.json()).error.code, 'capacity_busy');
    await Promise.all((await Promise.all(firstFour)).map((response) => response.text()));
    assert.equal(fixture.calls(), 4);
  } finally {
    await fixture.cleanup();
  }
});

test('rejects an output budget above the key policy before backend dispatch', async () => {
  const fixture = await createFixture();
  try {
    const key = fixture.createKey('one');
    const response = await chatRequest(fixture.baseUrl, key.rawKey, { max_tokens: 65 });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'output_limit_exceeded');
    assert.equal(fixture.calls(), 0);
  } finally {
    await fixture.cleanup();
  }
});
