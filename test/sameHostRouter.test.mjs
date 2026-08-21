import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";

const OWNER_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
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

test("same-host router protects chat, keeps admin private, and relays API paths", async () => {
  const received = [];
  const gateway = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ path: req.url, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString("utf8") });
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"status":"ok"}');
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"secure"}}]}\n\n');
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
      OWNER_CHAT_TOKEN: OWNER_TOKEN,
      CHAT_GATEWAY_KEY: CHAT_KEY,
      GATEWAY_PUBLIC_MODEL: "gemma-e2b",
    },
    stdio: "ignore",
  });

  try {
    await waitFor(`http://127.0.0.1:${routerPort}/`);

    const noToken = await fetch(`http://127.0.0.1:${routerPort}/chat/api/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"messages":[{"role":"user","content":"hello"}]}',
    });
    assert.equal(noToken.status, 401);

    const chat = await fetch(`http://127.0.0.1:${routerPort}/chat/api/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-owner-chat-token": OWNER_TOKEN },
      body: '{"messages":[{"role":"user","content":"hello"}]}',
    });
    assert.equal(chat.status, 200);
    assert.match(await chat.text(), /data: \[DONE\]/);

    const api = await fetch(`http://127.0.0.1:${routerPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer gma_live_customer_key" },
      body: '{"model":"gemma-e2b","stream":true,"messages":[{"role":"user","content":"hello"}]}',
    });
    assert.equal(api.status, 200);
    assert.match(await api.text(), /data: \[DONE\]/);

    const admin = await fetch(`http://127.0.0.1:${routerPort}/admin`);
    assert.equal(admin.status, 404);

    assert.equal(received[0].authorization, `Bearer ${CHAT_KEY}`);
    assert.equal(received[1].authorization, "Bearer gma_live_customer_key");
    assert.equal(received[0].path, "/v1/chat/completions");
    assert.equal(received[1].path, "/v1/chat/completions");
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
    gateway.close();
  }
});
