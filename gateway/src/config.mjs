/**
 * Phase 1 gateway configuration.
 * Design rule: this service is loopback-only and talks only to local llama.cpp.
 */
import path from 'node:path';

const integer = (value, fallback) => {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative integer configuration value: ${value}`);
  }
  return parsed;
};

export function loadConfig(env = process.env) {
  const dataDirectory = env.GATEWAY_DATA_DIR || path.resolve('gateway/data');
  const config = {
    bindHost: env.GATEWAY_BIND_HOST || '127.0.0.1',
    port: integer(env.GATEWAY_PORT, 8787),
    llamaBaseUrl: (env.LLAMA_BASE_URL || 'http://127.0.0.1:8080/v1').replace(/\/$/, ''),
    llamaApiKey: env.LLAMA_API_KEY || '',
    publicModelAlias: env.GATEWAY_PUBLIC_MODEL || 'gemma-e2b',
    backendModel: env.LLAMA_BACKEND_MODEL || 'ggml-org/gemma-4-E2B-it-GGUF:Q8_0',
    keyPepper: env.GATEWAY_KEY_PEPPER || '',
    adminToken: env.GATEWAY_ADMIN_TOKEN || '',
    databasePath: env.GATEWAY_DATABASE_PATH || path.join(dataDirectory, 'gateway.sqlite'),
    globalConcurrent: integer(env.GATEWAY_GLOBAL_CONCURRENT, 4),
    perKeyConcurrent: integer(env.GATEWAY_PER_KEY_CONCURRENT, 1),
    defaultMaxOutput: integer(env.GATEWAY_DEFAULT_MAX_OUTPUT, 512),
    absoluteMaxOutput: integer(env.GATEWAY_ABSOLUTE_MAX_OUTPUT, 8192),
    maxBodyBytes: integer(env.GATEWAY_MAX_BODY_BYTES, 262144),
    maxMessages: integer(env.GATEWAY_MAX_MESSAGES, 64),
    maxInputCharacters: integer(env.GATEWAY_MAX_INPUT_CHARACTERS, 24000),
    requestTimeoutMs: integer(env.GATEWAY_REQUEST_TIMEOUT_MS, 120000),
    rateBurst: integer(env.GATEWAY_RATE_BURST, 2),
    defaultRpmLimit: integer(env.GATEWAY_DEFAULT_RPM, 6),
    defaultDailyRequestLimit: integer(env.GATEWAY_DEFAULT_DAILY_REQUESTS, 50),
    corsOrigins: (env.GATEWAY_CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };

  if (config.bindHost !== '127.0.0.1' && config.bindHost !== '::1') {
    throw new Error('GATEWAY_BIND_HOST must remain loopback-only during Stage 1.');
  }
  if (config.defaultMaxOutput > config.absoluteMaxOutput) {
    throw new Error('GATEWAY_DEFAULT_MAX_OUTPUT cannot exceed GATEWAY_ABSOLUTE_MAX_OUTPUT.');
  }
  if (config.keyPepper.length < 32) {
    throw new Error('GATEWAY_KEY_PEPPER must contain at least 32 random characters.');
  }
  if (config.adminToken.length < 32) {
    throw new Error('GATEWAY_ADMIN_TOKEN must contain at least 32 random characters.');
  }
  return Object.freeze(config);
}
