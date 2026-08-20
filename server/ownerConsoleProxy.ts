/**
 * Owner Console security boundary: the browser proves private-console access
 * to this local port-3000 server; only this server reads GATEWAY_ADMIN_TOKEN.
 * The public Cloudflare API route never reaches this middleware.
 */
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

type Next = (error?: unknown) => void;

function sameSecret(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function respond(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, maximumBytes = 64 * 1024) {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += value.length;
    if (received > maximumBytes)
      throw new Error("Owner-console request is too large.");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function gatewayTarget(pathname: string) {
  const path = pathname.startsWith("/admin/api/")
    ? pathname.slice("/admin/api".length)
    : pathname;
  return path.startsWith("/") ? `/admin/v1${path}` : `/admin/v1/${path}`;
}

export function createOwnerConsoleProxy() {
  return async (req: IncomingMessage, res: ServerResponse, next?: Next) => {
    const requested = new URL(req.url || "/", "http://owner-console.local");
    const normalizedPath = requested.pathname.startsWith("/admin/api/")
      ? requested.pathname.slice("/admin/api".length)
      : requested.pathname;
    if (!normalizedPath.startsWith("/")) return next?.();

    const ownerToken = process.env.OWNER_CONSOLE_TOKEN;
    const gatewayAdminToken = process.env.GATEWAY_ADMIN_TOKEN;
    const gatewayOrigin = (
      process.env.GATEWAY_ADMIN_BASE_URL || "http://127.0.0.1:8787"
    ).replace(/\/+$/, "");
    if (
      !ownerToken ||
      ownerToken.length < 32 ||
      !gatewayAdminToken ||
      gatewayAdminToken.length < 32
    ) {
      respond(res, 503, {
        error: {
          code: "owner_console_not_configured",
          message: "Owner console secrets are not configured on this Mac mini.",
        },
      });
      return;
    }
    const supplied =
      typeof req.headers["x-owner-console-token"] === "string"
        ? req.headers["x-owner-console-token"]
        : undefined;
    if (!sameSecret(supplied, ownerToken)) {
      respond(res, 401, {
        error: {
          code: "owner_console_auth_required",
          message: "Owner-console authentication is required.",
        },
      });
      return;
    }
    if (!["GET", "POST"].includes(req.method || "")) {
      respond(res, 405, {
        error: {
          code: "method_not_allowed",
          message: "Only GET and POST are available to the owner console.",
        },
      });
      return;
    }

    try {
      const body = req.method === "POST" ? await readBody(req) : undefined;
      const target = new URL(
        `${gatewayOrigin}${gatewayTarget(normalizedPath)}`
      );
      target.search = requested.search;
      const upstream = await fetch(target, {
        method: req.method,
        headers: {
          "x-admin-token": gatewayAdminToken,
          ...(body
            ? {
                "content-type":
                  req.headers["content-type"] || "application/json",
              }
            : {}),
        },
        body: body && body.length > 0 ? body : undefined,
        signal: AbortSignal.timeout(6000),
      });
      const payload = await upstream.arrayBuffer();
      res.writeHead(upstream.status, {
        "content-type":
          upstream.headers.get("content-type") ||
          "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(Buffer.from(payload));
    } catch {
      respond(res, 502, {
        error: {
          code: "owner_console_gateway_unavailable",
          message: "The local gateway administration interface is unavailable.",
        },
      });
    }
  };
}
