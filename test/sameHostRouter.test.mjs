import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";

const CHAT_KEY = "gma_live_router_validation_key";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address.");
  return address.port;
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status) return;
    } catch {
      // Router has not started yet.
    }
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error("Timed out waiting for same-host router.");
}

async function waitForSeats(url, target) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await fetch(url).then(response => response.json());
    if (status.active === target) return status;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${target} active public-chat seats.`);
}

test("public chat enforces three seats while protected API and private routes keep their boundaries", async () => {
  const received = [];
  let releaseStreams;
  const streamGate = new Promise(resolve => {
    releaseStreams = resolve;
  });
  const gateway = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ path: req.url, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString("utf8") });
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"status":"ok"}');
      return;
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (req.headers.authorization === `Bearer ${CHAT_KEY}`) await streamGate;
    res.write('data: {"choices":[{"delta":{"content":"available"}}]}\n\n');
    res.end("data: [DONE]\n\n");
  });
  const gatewayPort = await listen(gateway);
  const routerPort = 30_000 + Math.floor(Math.random() * 2_000);
  const child = spawn("node", ["dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CHAT_ROUTER_PORT: String(routerPort),
      GATEWAY_PUBLIC_BASE_URL: `http://127.0.0.1:${gatewayPort}`,
      CHAT_GATEWAY_KEY: CHAT_KEY,
      GATEWAY_PUBLIC_MODEL: "gemma-e2b",
      PUBLIC_CHAT_SEATS: "3",
      PUBLIC_CHAT_STANDARD_MAX_OUTPUT: "1024",
      PUBLIC_CHAT_LONG_MAX_OUTPUT: "2048",
    },
    stdio: "ignore",
  });

  try {
    const base = `http://127.0.0.1:${routerPort}`;
    await waitFor(`${base}/`);

    const initial = await fetch(`${base}/chat/api/status`).then(response => response.json());
    assert.deepEqual(initial, {
      active: 0,
      limit: 3,
      available: 3,
      accepting: true,
      standard_max_output: 1024,
      long_max_output: 2048,
    });

    const seats = Array.from({ length: 3 }, () =>
      fetch(`${base}/chat/api/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"messages":[{"role":"user","content":"hello"}]}',
      })
    );
    const occupied = await waitForSeats(`${base}/chat/api/status`, 3);
    assert.equal(occupied.accepting, false);
    assert.equal(occupied.available, 0);

    const overflow = await fetch(`${base}/chat/api/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"messages":[{"role":"user","content":"fourth"}]}',
    });
    assert.equal(overflow.status, 429);
    assert.match(await overflow.text(), /All live chat seats are currently in use/);

    releaseStreams();
    for (const seat of seats) {
      const response = await seat;
      assert.equal(response.status, 200);
      assert.match(await response.text(), /data: \[DONE\]/);
    }
    await waitForSeats(`${base}/chat/api/status`, 0);

    const longAnswer = await fetch(`${base}/chat/api/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"answer_mode":"long","messages":[{"role":"user","content":"long answer"}]}',
    });
    assert.equal(longAnswer.status, 200);
    await longAnswer.text();

    const api = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer gma_live_customer_key" },
      body: '{"model":"gemma-e2b","stream":true,"messages":[{"role":"user","content":"hello"}]}',
    });
    assert.equal(api.status, 200);
    assert.match(await api.text(), /data: \[DONE\]/);

    const admin = await fetch(`${base}/admin`);
    assert.equal(admin.status, 404);

    const chatCalls = received.filter(request => request.authorization === `Bearer ${CHAT_KEY}`);
    assert.equal(chatCalls.length, 4);
    assert.equal(JSON.parse(chatCalls[0].body).max_tokens, 1024);
    assert.equal(JSON.parse(chatCalls[3].body).max_tokens, 2048);
    assert.equal(received.at(-1).authorization, "Bearer gma_live_customer_key");
    assert.equal(received.at(-1).path, "/v1/chat/completions");
  } finally {
    releaseStreams?.();
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
    gateway.close();
  }
});
