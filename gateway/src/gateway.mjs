/**
 * Phase 1 local gateway.
 * Design rule: enforce all tenant policy before forwarding a loopback-only request to llama.cpp.
 */
import crypto from "node:crypto";
import http from "node:http";

const JSON_TYPE = "application/json; charset=utf-8";

function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function sendJson(res, statusCode, payload, headers = {}) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, {
    "content-type": JSON_TYPE,
    "cache-control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function sendOpenAiError(
  res,
  statusCode,
  message,
  code,
  type = "invalid_request_error",
  headers = {}
) {
  sendJson(res, statusCode, { error: { message, type, code } }, headers);
}

function applyCors(req, res, config) {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader(
      "access-control-allow-headers",
      "Authorization, Content-Type, X-Admin-Token"
    );
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  }
}

async function readJsonBody(req, maxBytes) {
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const error = new Error("Request body is too large.");
    error.statusCode = 413;
    error.code = "request_too_large";
    throw error;
  }
  let received = 0;
  const chunks = [];
  for await (const chunk of req) {
    received += chunk.length;
    if (received > maxBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      error.code = "request_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    error.code = "invalid_json";
    throw error;
  }
}

function getBearerToken(req) {
  const value = req.headers.authorization;
  if (typeof value !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

function isOwnerRequest(req, config) {
  return secureEqual(req.headers["x-admin-token"], config.adminToken);
}

function ownerKeyPolicy(config, payload = {}) {
  const integer = (value, fallback, minimum, maximum) => {
    if (value === undefined || value === null || value === "") return fallback;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      return null;
    return value;
  };
  const tenantId =
    typeof payload.tenant_id === "string" ? payload.tenant_id.trim() : "";
  const label = typeof payload.label === "string" ? payload.label.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(tenantId)) {
    return {
      error:
        "tenant_id must use 2 to 64 letters, numbers, dots, underscores, or hyphens.",
    };
  }
  if (label.length < 2 || label.length > 120)
    return { error: "label must contain 2 to 120 characters." };
  const expiresDays = integer(payload.expires_days, 30, 1, 3650);
  const activeLimit = integer(
    payload.active_limit,
    config.perKeyConcurrent,
    1,
    config.perKeyConcurrent
  );
  const rpmLimit = integer(payload.rpm_limit, config.defaultRpmLimit, 1, 10000);
  const dailyRequestLimit = integer(
    payload.daily_request_limit,
    config.defaultDailyRequestLimit,
    1,
    1000000
  );
  const maxOutput = integer(
    payload.max_output,
    config.defaultMaxOutput,
    1,
    config.absoluteMaxOutput
  );
  if (
    [expiresDays, activeLimit, rpmLimit, dailyRequestLimit, maxOutput].some(
      value => value === null
    )
  ) {
    return {
      error: "One or more key policy values are outside the permitted range.",
    };
  }
  return {
    value: {
      tenantId,
      label,
      expiresAt: new Date(Date.now() + expiresDays * 86400000).toISOString(),
      activeLimit,
      rpmLimit,
      dailyRequestLimit,
      maxOutput,
    },
  };
}

function validateChatPayload(payload, key, config) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      error: ["Chat completion body must be a JSON object.", "invalid_request"],
    };
  }
  if (payload.model !== config.publicModelAlias) {
    return {
      error: [
        `Only the '${config.publicModelAlias}' model alias is available.`,
        "model_not_allowed",
      ],
    };
  }
  if (
    !Array.isArray(payload.messages) ||
    payload.messages.length === 0 ||
    payload.messages.length > config.maxMessages
  ) {
    return {
      error: [
        `messages must contain 1 to ${config.maxMessages} text messages.`,
        "invalid_messages",
      ],
    };
  }
  const unsupported = [
    "tools",
    "functions",
    "tool_choice",
    "response_format",
    "modalities",
    "audio",
    "attachments",
  ];
  if (unsupported.some(field => field in payload)) {
    return {
      error: [
        "Tools, functions, attachments, and multimodal inputs are not enabled in Phase 1.",
        "feature_not_enabled",
      ],
    };
  }
  let inputCharacters = 0;
  for (const message of payload.messages) {
    if (
      !message ||
      typeof message !== "object" ||
      !["system", "user", "assistant"].includes(message.role) ||
      typeof message.content !== "string"
    ) {
      return {
        error: [
          "Each message must use role system, user, or assistant with string content.",
          "invalid_messages",
        ],
      };
    }
    inputCharacters += message.content.length;
  }
  if (inputCharacters > config.maxInputCharacters) {
    return {
      error: [
        `Input exceeds the ${config.maxInputCharacters}-character Stage 1 limit.`,
        "input_too_large",
      ],
    };
  }
  const requestedOutput = payload.max_tokens ?? config.defaultMaxOutput;
  if (!Number.isSafeInteger(requestedOutput) || requestedOutput < 1) {
    return {
      error: ["max_tokens must be a positive integer.", "invalid_max_tokens"],
    };
  }
  const permittedOutput = Math.min(key.max_output, config.absoluteMaxOutput);
  if (requestedOutput > permittedOutput) {
    return {
      error: [
        `Requested output exceeds this key's ${permittedOutput}-token maximum.`,
        "output_limit_exceeded",
      ],
    };
  }
  return {
    value: {
      stream: payload.stream !== false,
      requestedOutput,
      backendPayload: {
        model: config.backendModel,
        messages: payload.messages,
        stream: payload.stream !== false,
        max_tokens: requestedOutput,
        temperature:
          typeof payload.temperature === "number"
            ? payload.temperature
            : undefined,
        top_p: typeof payload.top_p === "number" ? payload.top_p : undefined,
        user: `key_${key.id}`,
      },
    },
  };
}

function createRateLimiter(state, config) {
  return key => {
    const now = Date.now();
    const rpm = key.rpm_limit || config.defaultRpmLimit;
    const capacity = Math.max(config.rateBurst, 1);
    const existing = state.rateBuckets.get(key.id) ?? {
      tokens: capacity,
      updatedAt: now,
    };
    const replenished = Math.min(
      capacity,
      existing.tokens + ((now - existing.updatedAt) * rpm) / 60000
    );
    if (replenished < 1) {
      state.rateBuckets.set(key.id, { tokens: replenished, updatedAt: now });
      return false;
    }
    state.rateBuckets.set(key.id, { tokens: replenished - 1, updatedAt: now });
    return true;
  };
}

function createAdmission(state, config) {
  return key => {
    const activeForKey = state.activeByKey.get(key.id) ?? 0;
    if (activeForKey >= Math.min(key.active_limit, config.perKeyConcurrent)) {
      return { error: "key_concurrency_exceeded" };
    }
    if (state.globalActive >= config.globalConcurrent) {
      return { error: "capacity_busy" };
    }
    state.globalActive += 1;
    state.activeByKey.set(key.id, activeForKey + 1);
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        state.globalActive = Math.max(0, state.globalActive - 1);
        const next = Math.max(0, (state.activeByKey.get(key.id) ?? 1) - 1);
        if (next === 0) state.activeByKey.delete(key.id);
        else state.activeByKey.set(key.id, next);
      },
    };
  };
}

function extractSseMetadata(chunkText, metadata) {
  for (const rawEvent of chunkText.split("\n\n")) {
    const dataLines = rawEvent
      .split("\n")
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim());
    if (dataLines.length === 0) continue;
    const text = dataLines.join("\n");
    if (text === "[DONE]") continue;
    try {
      const event = JSON.parse(text);
      const choice = event.choices?.[0];
      const delta = choice?.delta ?? {};
      if (
        metadata.ttftMs === null &&
        ((typeof delta.reasoning_content === "string" &&
          delta.reasoning_content.length > 0) ||
          (typeof delta.content === "string" && delta.content.length > 0))
      ) {
        metadata.ttftMs = Date.now() - metadata.startedAtMs;
      }
      if (choice?.finish_reason) metadata.finishReason = choice.finish_reason;
      if (Number.isInteger(event.usage?.completion_tokens))
        metadata.reportedOutput = event.usage.completion_tokens;
    } catch {
      // Forward upstream SSE exactly; malformed metadata must not break a valid client stream.
    }
  }
}

export function createGateway({
  config,
  store,
  fetchImpl = fetch,
  logger = console,
}) {
  const state = {
    globalActive: 0,
    activeByKey: new Map(),
    rateBuckets: new Map(),
  };
  const consumeRate = createRateLimiter(state, config);
  const admit = createAdmission(state, config);

  async function backendHealthy() {
    try {
      const response = await fetchImpl(`${config.llamaBaseUrl}/models`, {
        signal: AbortSignal.timeout(1500),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function record(storeEvent) {
    try {
      store.recordEvent(storeEvent);
    } catch (error) {
      logger.error(
        JSON.stringify({
          level: "error",
          message: "gateway_event_write_failed",
          error: error.message,
        })
      );
    }
  }

  const server = http.createServer(async (req, res) => {
    applyCors(req, res, config);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      const healthy = await backendHealthy();
      sendJson(res, healthy ? 200 : 503, {
        status: healthy ? "ok" : "degraded",
        model: config.publicModelAlias,
        backend: healthy ? "reachable" : "unreachable",
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      if (!isOwnerRequest(req, config)) {
        sendOpenAiError(
          res,
          401,
          "Administrator authentication is required.",
          "admin_auth_required",
          "authentication_error"
        );
        return;
      }
      const totals = store.metrics();
      const body = [
        "# HELP gateway_inflight_global Active generations admitted by the gateway.",
        "# TYPE gateway_inflight_global gauge",
        `gateway_inflight_global ${state.globalActive}`,
        "# HELP gateway_events_total Persisted request events by result class.",
        "# TYPE gateway_events_total counter",
        `gateway_events_total{result="all"} ${totals.total_events ?? 0}`,
        `gateway_events_total{result="success"} ${totals.successful_events ?? 0}`,
        `gateway_events_total{result="throttled"} ${totals.throttled_events ?? 0}`,
        `gateway_events_total{result="failed"} ${totals.failed_events ?? 0}`,
      ].join("\n");
      res.writeHead(200, {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`${body}\n`);
      return;
    }

    if (url.pathname.startsWith("/admin/v1/")) {
      if (!isOwnerRequest(req, config)) {
        sendOpenAiError(
          res,
          401,
          "Administrator authentication is required.",
          "admin_auth_required",
          "authentication_error"
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/admin/v1/overview") {
        const healthy = await backendHealthy();
        sendJson(res, 200, {
          generated_at: new Date().toISOString(),
          health: {
            gateway: "ok",
            backend: healthy ? "reachable" : "unreachable",
            model: config.publicModelAlias,
          },
          capacity: {
            global_active: state.globalActive,
            global_limit: config.globalConcurrent,
            per_key_concurrent_limit: config.perKeyConcurrent,
            default_rpm_limit: config.defaultRpmLimit,
            default_daily_request_limit: config.defaultDailyRequestLimit,
            default_max_output: config.defaultMaxOutput,
            absolute_max_output: config.absoluteMaxOutput,
          },
          usage: store.ownerOverview(),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/admin/v1/keys") {
        sendJson(res, 200, {
          generated_at: new Date().toISOString(),
          keys: store.ownerKeys(),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/admin/v1/events") {
        sendJson(res, 200, {
          generated_at: new Date().toISOString(),
          events: store.ownerEvents(url.searchParams.get("limit")),
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/admin/v1/keys") {
        const payload = await readJsonBody(req, config.maxBodyBytes);
        const policy = ownerKeyPolicy(config, payload);
        if (policy.error) {
          sendOpenAiError(res, 422, policy.error, "invalid_key_policy");
          return;
        }
        const created = store.createKey(policy.value);
        sendJson(res, 201, {
          created: true,
          prefix: created.prefix,
          tenant_id: created.tenantId,
          label: created.label,
          expires_at: created.expiresAt,
          active_limit: created.activeLimit,
          rpm_limit: created.rpmLimit,
          daily_request_limit: created.dailyRequestLimit,
          max_output: created.maxOutput,
          api_key: created.rawKey,
          warning:
            "Store this raw API key now. It is shown only once and is never stored by the gateway.",
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/admin/v1/keys/revoke") {
        const payload = await readJsonBody(req, config.maxBodyBytes);
        const prefix =
          typeof payload.prefix === "string" ? payload.prefix.trim() : "";
        if (!/^gma_live_[A-Za-z0-9_-]{8}$/.test(prefix)) {
          sendOpenAiError(
            res,
            422,
            "A valid non-secret key prefix is required.",
            "invalid_key_prefix"
          );
          return;
        }
        if (!store.revokeByPrefix(prefix)) {
          sendOpenAiError(
            res,
            404,
            "No API key matches that prefix.",
            "key_not_found"
          );
          return;
        }
        sendJson(res, 200, { revoked: true, prefix });
        return;
      }
      sendOpenAiError(
        res,
        404,
        "Administrator route not found.",
        "route_not_found"
      );
      return;
    }

    const rawKey = getBearerToken(req);
    const key = store.verifyKey(rawKey);
    if (!key) {
      sendOpenAiError(
        res,
        401,
        "Invalid, expired, or revoked API key.",
        "invalid_api_key",
        "authentication_error"
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/models") {
      sendJson(res, 200, {
        object: "list",
        data: [
          {
            id: config.publicModelAlias,
            object: "model",
            owned_by: "local-gateway",
          },
        ],
      });
      return;
    }
    if (!(req.method === "POST" && url.pathname === "/v1/chat/completions")) {
      sendOpenAiError(res, 404, "Route not found.", "route_not_found");
      return;
    }

    const requestId = crypto.randomUUID();
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    let requestedOutput = 0;
    let reservation = null;
    let responseStartMs = null;
    let ttftMs = null;
    let reportedOutput = null;
    let finishReason = null;
    let completed = false;
    let statusCode = 500;
    let outcome = "gateway_error";
    let errorCode = null;
    let backendTimeout = null;

    const finalize = async () => {
      reservation?.release();
      await record({
        id: requestId,
        keyId: key.id,
        modelAlias: config.publicModelAlias,
        startedAt,
        queuedMs: 0,
        responseStartMs,
        ttftMs,
        elapsedMs: Date.now() - startedAtMs,
        requestedOutput,
        reportedOutput,
        finishReason,
        statusCode,
        outcome,
        errorCode,
      });
      logger.info(
        JSON.stringify({
          request_id: requestId,
          key_prefix: key.prefix,
          status_code: statusCode,
          outcome,
          ttft_ms: ttftMs,
          elapsed_ms: Date.now() - startedAtMs,
          finish_reason: finishReason,
        })
      );
    };

    try {
      if (!consumeRate(key)) {
        statusCode = 429;
        outcome = "rate_limited";
        errorCode = "rate_limit_exceeded";
        sendOpenAiError(
          res,
          429,
          "Request rate limit exceeded. Retry later.",
          errorCode,
          "rate_limit_error",
          { "retry-after": "15" }
        );
        return;
      }
      const daily = store.dailyUsage(key.id);
      if (daily.requests >= key.daily_request_limit) {
        statusCode = 429;
        outcome = "daily_limit_reached";
        errorCode = "daily_limit_reached";
        sendOpenAiError(
          res,
          429,
          "Daily request allowance reached.",
          errorCode,
          "rate_limit_error"
        );
        return;
      }
      const payload = await readJsonBody(req, config.maxBodyBytes);
      const validation = validateChatPayload(payload, key, config);
      if (validation.error) {
        statusCode = validation.error[1] === "input_too_large" ? 413 : 422;
        outcome = "request_rejected";
        errorCode = validation.error[1];
        sendOpenAiError(res, statusCode, validation.error[0], errorCode);
        return;
      }
      requestedOutput = validation.value.requestedOutput;
      const admitted = admit(key);
      if (admitted.error) {
        statusCode = 429;
        outcome = admitted.error;
        errorCode = admitted.error;
        const message =
          admitted.error === "capacity_busy"
            ? "Interactive capacity is currently full. Retry later."
            : "This API key already has an active generation.";
        sendOpenAiError(res, 429, message, errorCode, "rate_limit_error", {
          "retry-after": "15",
        });
        return;
      }
      reservation = admitted;

      const controller = new AbortController();
      backendTimeout = setTimeout(
        () => controller.abort(),
        config.requestTimeoutMs
      );
      const upstreamHeaders = { "content-type": "application/json" };
      if (config.llamaApiKey)
        upstreamHeaders.authorization = `Bearer ${config.llamaApiKey}`;
      const upstream = await fetchImpl(
        `${config.llamaBaseUrl}/chat/completions`,
        {
          method: "POST",
          headers: upstreamHeaders,
          body: JSON.stringify(validation.value.backendPayload),
          signal: controller.signal,
        }
      );
      responseStartMs = Date.now() - startedAtMs;
      if (!upstream.ok || !upstream.body) {
        statusCode = 503;
        outcome = "backend_unavailable";
        errorCode = "inference_unavailable";
        sendOpenAiError(
          res,
          503,
          "Inference backend is unavailable.",
          errorCode,
          "server_error"
        );
        return;
      }

      if (!validation.value.stream) {
        const payloadText = await upstream.text();
        try {
          const parsed = JSON.parse(payloadText);
          reportedOutput = Number.isInteger(parsed.usage?.completion_tokens)
            ? parsed.usage.completion_tokens
            : null;
          finishReason = parsed.choices?.[0]?.finish_reason ?? null;
        } catch {
          // Preserve upstream response without exposing a parse failure to the customer.
        }
        statusCode = 200;
        outcome = "completed";
        res.writeHead(200, {
          "content-type": upstream.headers.get("content-type") || JSON_TYPE,
          "cache-control": "no-store",
          "x-request-id": requestId,
        });
        res.end(payloadText);
        completed = true;
        return;
      }

      res.writeHead(200, {
        "content-type":
          upstream.headers.get("content-type") ||
          "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-request-id": requestId,
      });
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      const streamMetadata = {
        startedAtMs,
        ttftMs: null,
        reportedOutput: null,
        finishReason: null,
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
        sseBuffer += decoder.decode(value, { stream: true });
        const boundary = sseBuffer.lastIndexOf("\n\n");
        if (boundary >= 0) {
          extractSseMetadata(sseBuffer.slice(0, boundary), streamMetadata);
          sseBuffer = sseBuffer.slice(boundary + 2);
        }
      }
      if (sseBuffer) extractSseMetadata(sseBuffer, streamMetadata);
      ttftMs = streamMetadata.ttftMs;
      reportedOutput = streamMetadata.reportedOutput;
      finishReason = streamMetadata.finishReason;
      statusCode = 200;
      outcome = "completed";
      res.end();
      completed = true;
    } catch (error) {
      if (!res.headersSent) {
        statusCode = error.statusCode || 503;
        outcome =
          error.code === "request_too_large"
            ? "request_rejected"
            : "gateway_error";
        errorCode = error.code || "inference_unavailable";
        sendOpenAiError(
          res,
          statusCode,
          error.statusCode
            ? error.message
            : "Inference backend is unavailable.",
          errorCode,
          error.statusCode ? "invalid_request_error" : "server_error"
        );
      } else if (!res.writableEnded) {
        res.end();
      }
      logger.error(
        JSON.stringify({
          request_id: requestId,
          message: "gateway_request_failed",
          error: error.message,
        })
      );
    } finally {
      if (backendTimeout) clearTimeout(backendTimeout);
      if (!completed && !res.writableEnded) res.end();
      await finalize();
    }
  });

  return {
    server,
    state,
    start() {
      return new Promise(resolve =>
        server.listen(config.port, config.bindHost, resolve)
      );
    },
    stop() {
      return new Promise((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    },
  };
}
