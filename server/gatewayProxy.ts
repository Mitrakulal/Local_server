/**
 * Same-host router contract: public /v1 and /healthz requests preserve the
 * existing gateway protocol, while raw llama.cpp remains loopback-only.
 */
import type { NextFunction, Request, Response } from "express";

const MAX_BODY_BYTES = 262_144;

function error(res: Response, status: number, code: string, message: string) {
  res.status(status).set("cache-control", "no-store").json({
    error: { code, message },
  });
}

async function readBody(req: Request, maximumBytes = MAX_BODY_BYTES) {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += value.length;
    if (received > maximumBytes) throw new Error("Request body is too large.");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function copySafeHeaders(upstream: globalThis.Response, res: Response) {
  const allowed = [
    "content-type",
    "cache-control",
    "access-control-allow-origin",
    "access-control-allow-headers",
    "access-control-allow-methods",
  ];
  for (const header of allowed) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  res.setHeader("cache-control", "no-store");
}

async function relayStream(upstream: globalThis.Response, res: Response) {
  copySafeHeaders(upstream, res);
  res.status(upstream.status);
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
}

/**
 * Relays only the existing public API paths to the loopback gateway. The
 * external client still supplies its own gma_live key; this router has none.
 */
export function createPublicGatewayProxy() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!["GET", "POST", "OPTIONS"].includes(req.method)) {
      error(res, 405, "method_not_allowed", "Method is not available here.");
      return;
    }

    const gatewayOrigin = (
      process.env.GATEWAY_PUBLIC_BASE_URL || "http://127.0.0.1:8787"
    ).replace(/\/+$/, "");
    const originalPath = req.originalUrl || req.url;
    const target = new URL(`${gatewayOrigin}${originalPath}`);

    try {
      const body = req.method === "POST" ? await readBody(req) : undefined;
      const authorization =
        typeof req.headers.authorization === "string"
          ? req.headers.authorization
          : undefined;
      const upstream = await fetch(target, {
        method: req.method,
        headers: {
          ...(authorization ? { authorization } : {}),
          ...(typeof req.headers["content-type"] === "string"
            ? { "content-type": req.headers["content-type"] }
            : {}),
          accept: typeof req.headers.accept === "string" ? req.headers.accept : "*/*",
        },
        body: body && body.length ? body : undefined,
        signal: AbortSignal.timeout(125_000),
      });
      await relayStream(upstream, res);
    } catch (reason) {
      if (res.headersSent) return;
      const message =
        reason instanceof Error && reason.message === "Request body is too large."
          ? reason.message
          : "The local model gateway is unavailable.";
      error(
        res,
        message === "Request body is too large." ? 413 : 502,
        message === "Request body is too large." ? "body_too_large" : "gateway_unavailable",
        message
      );
    }
  };
}

