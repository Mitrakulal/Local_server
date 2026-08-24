/**
 * Public Mattr Chat proxy: browsers never receive the internal CHAT_GATEWAY_KEY.
 * The router owns a small three-seat admission controller; the gateway remains
 * the authoritative global-capacity and request-policy boundary.
 */
import type { NextFunction, Request, Response } from "express";

type ChatMessage = { role: "user" | "assistant"; content: string };
type AnswerMode = "standard" | "long";

function error(res: Response, status: number, code: string, message: string) {
  res.status(status).set("cache-control", "no-store").json({
    error: { code, message },
  });
}

function integerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isSafeInteger(value) ? Math.max(minimum, Math.min(value, maximum)) : fallback;
}

function publicChatPolicy() {
  const seats = integerEnv("PUBLIC_CHAT_SEATS", 3, 1, 3);
  const standardOutput = integerEnv("PUBLIC_CHAT_STANDARD_MAX_OUTPUT", 1024, 32, 2048);
  const longOutput = integerEnv("PUBLIC_CHAT_LONG_MAX_OUTPUT", 2048, standardOutput, 2048);
  return { seats, standardOutput, longOutput };
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

function outputFor(mode: unknown) {
  const policy = publicChatPolicy();
  return mode === "long" ? policy.longOutput : policy.standardOutput;
}

/**
 * Creates a public chat endpoint with a small local concurrency gate. A slot is
 * reserved before proxying and released on completion, failure, or disconnect.
 */
export function createPublicChatProxy() {
  let active = 0;

  const status = () => {
    const policy = publicChatPolicy();
    return {
      active,
      limit: policy.seats,
      available: Math.max(0, policy.seats - active),
      accepting: active < policy.seats,
      standard_max_output: policy.standardOutput,
      long_max_output: policy.longOutput,
    };
  };

  const handler = async (req: Request, res: Response, _next: NextFunction) => {
    if (req.method !== "POST") {
      error(res, 405, "method_not_allowed", "Use POST to send a chat message.");
      return;
    }

    const chatGatewayKey = process.env.CHAT_GATEWAY_KEY;
    if (!chatGatewayKey || !chatGatewayKey.startsWith("gma_live_")) {
      error(res, 503, "public_chat_not_configured", "Public chat is not configured on this server.");
      return;
    }

    const policy = publicChatPolicy();
    if (active >= policy.seats) {
      error(
        res,
        429,
        "chat_capacity_full",
        "All live chat seats are currently in use. Please wait a moment and try again."
      );
      return;
    }

    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
    };
    const controller = new AbortController();
    const abortOnClose = () => controller.abort();
    const timeout = setTimeout(() => controller.abort(), 125_000);
    res.once("close", abortOnClose);

    try {
      const raw = (await readJson(req)) as { messages?: unknown; answer_mode?: unknown };
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
          max_tokens: outputFor(raw.answer_mode as AnswerMode),
          messages: [
            {
              role: "system",
              content:
                "You are Mattr Chat, a concise and thoughtful local assistant. Give a polished, direct final answer in normal content. Do not narrate hidden planning steps or use headings such as Analyze Request, Draft Response, or Final Output. Do not reveal private chain-of-thought.",
            },
            ...messages,
          ],
        }),
        signal: controller.signal,
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
      if (res.headersSent || res.writableEnded) return;
      const message = reason instanceof Error ? reason.message : "Public chat failed.";
      const clientError =
        message === "Chat request is too large." ||
        message === "Chat request must be valid JSON." ||
        message === "Conversation messages are required." ||
        message === "Write a message before sending.";
      error(
        res,
        clientError ? 400 : 502,
        clientError ? "invalid_chat_request" : "public_chat_gateway_unavailable",
        message
      );
    } finally {
      clearTimeout(timeout);
      res.removeListener("close", abortOnClose);
      release();
    }
  };

  return { handler, status };
}
