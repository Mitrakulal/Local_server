/**
 * Nocturne Ledger style: public chat may stream responses, but browser code
 * never receives CHAT_GATEWAY_KEY, GATEWAY_ADMIN_TOKEN, or OWNER_CONSOLE_TOKEN.
 */
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

type ChatMessage = { role: "user" | "assistant"; content: string };

function sameSecret(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function error(res: Response, status: number, code: string, message: string) {
  res.status(status).set("cache-control", "no-store").json({
    error: { code, message },
  });
}

async function readJson(req: Request) {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += value.length;
    if (received > 96 * 1024) throw new Error("Chat request is too large.");
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("Chat request must be valid JSON.");
  }
}

function normaliseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) throw new Error("Conversation messages are required.");
  const messages = value
    .slice(-16)
    .flatMap(item => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as { role?: unknown; content?: unknown };
      if (
        (candidate.role !== "user" && candidate.role !== "assistant") ||
        typeof candidate.content !== "string"
      ) {
        return [];
      }
      const content = candidate.content.trim();
      return content && content.length <= 12_000
        ? [{ role: candidate.role, content } as ChatMessage]
        : [];
    });
  if (!messages.length) throw new Error("Write a message before sending.");
  return messages;
}

function boundedTokens(value: unknown) {
  const maximum = Number(process.env.OWNER_CHAT_MAX_OUTPUT || 512);
  const requested = typeof value === "number" ? value : maximum;
  return Math.max(32, Math.min(Math.floor(requested), maximum, 8192));
}

/**
 * Streams a bounded owner-only conversation. This endpoint has an independent
 * owner-chat token and injects an internal gateway key only on the server.
 */
export function createOwnerChatProxy() {
  return async (req: Request, res: Response, _next: NextFunction) => {
    if (req.method !== "POST") {
      error(res, 405, "method_not_allowed", "Use POST to send a chat message.");
      return;
    }

    const ownerChatToken = process.env.OWNER_CHAT_TOKEN;
    const chatGatewayKey = process.env.CHAT_GATEWAY_KEY;
    if (
      !ownerChatToken ||
      ownerChatToken.length < 32 ||
      !chatGatewayKey ||
      !chatGatewayKey.startsWith("gma_live_")
    ) {
      error(
        res,
        503,
        "owner_chat_not_configured",
        "Owner chat secrets are not configured on this Mac mini."
      );
      return;
    }
    const supplied =
      typeof req.headers["x-owner-chat-token"] === "string"
        ? req.headers["x-owner-chat-token"]
        : undefined;
    if (!sameSecret(supplied, ownerChatToken)) {
      error(
        res,
        401,
        "owner_chat_auth_required",
        "Owner chat authentication is required."
      );
      return;
    }

    try {
      const raw = (await readJson(req)) as {
        messages?: unknown;
        max_tokens?: unknown;
      };
      const messages = normaliseMessages(raw.messages);
      const gatewayOrigin = (
        process.env.GATEWAY_PUBLIC_BASE_URL || "http://127.0.0.1:8787"
      ).replace(/\/+$/, "");
      const upstream = await fetch(`${gatewayOrigin}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${chatGatewayKey}`,
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: process.env.GATEWAY_PUBLIC_MODEL || "gemma-e2b",
          stream: true,
          max_tokens: boundedTokens(raw.max_tokens),
          messages: [
            {
              role: "system",
              content:
                "You are a concise, thoughtful local assistant. Give a polished, direct final answer in normal content. Do not narrate planning steps or use headings such as Analyze Request, Draft Response, or Final Output. If a brief user-facing reasoning summary is useful, keep it compact and separate when the runtime supports a reasoning field. Do not reveal private chain-of-thought.",
            },
            ...messages,
          ],
        }),
        signal: AbortSignal.timeout(125_000),
      });

      res.status(upstream.status);
      res.setHeader(
        "content-type",
        upstream.headers.get("content-type") || "application/json; charset=utf-8"
      );
      res.setHeader("cache-control", "no-store");
      if (!upstream.body) {
        res.end();
        return;
      }
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.writableEnded) res.write(Buffer.from(value));
        }
      } finally {
        if (!res.writableEnded) res.end();
      }
    } catch (reason) {
      if (res.headersSent) return;
      const message = reason instanceof Error ? reason.message : "Owner chat failed.";
      const clientError =
        message === "Chat request is too large." ||
        message === "Chat request must be valid JSON." ||
        message === "Conversation messages are required." ||
        message === "Write a message before sending.";
      error(
        res,
        clientError ? 400 : 502,
        clientError ? "invalid_chat_request" : "owner_chat_gateway_unavailable",
        message
      );
    }
  };
}
