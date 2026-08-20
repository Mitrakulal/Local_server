/**
 * Phase 1 gateway persistence.
 * Design rule: store only keyed hashes and request metadata, never raw API keys or prompts.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function hashApiKey(rawKey, pepper) {
  return crypto.createHmac('sha256', pepper).update(rawKey).digest('hex');
}

export class GatewayStore {
  constructor(databasePath, pepper) {
    this.pepper = pepper;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        label TEXT NOT NULL,
        prefix TEXT NOT NULL UNIQUE,
        secret_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        expires_at TEXT,
        active_limit INTEGER NOT NULL,
        rpm_limit INTEGER NOT NULL,
        daily_request_limit INTEGER NOT NULL,
        max_output INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS request_events (
        id TEXT PRIMARY KEY,
        key_id TEXT,
        model_alias TEXT NOT NULL,
        started_at TEXT NOT NULL,
        queued_ms INTEGER NOT NULL,
        response_start_ms INTEGER,
        ttft_ms INTEGER,
        elapsed_ms INTEGER NOT NULL,
        requested_output INTEGER NOT NULL,
        reported_output INTEGER,
        finish_reason TEXT,
        status_code INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        error_code TEXT,
        FOREIGN KEY(key_id) REFERENCES api_keys(id)
      );
      CREATE TABLE IF NOT EXISTS daily_usage (
        key_id TEXT NOT NULL,
        usage_day TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        reported_output_tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(key_id, usage_day),
        FOREIGN KEY(key_id) REFERENCES api_keys(id)
      );
    `);
    this.findKeyStatement = this.db.prepare('SELECT * FROM api_keys WHERE secret_hash = ?');
    this.findPrefixStatement = this.db.prepare('SELECT * FROM api_keys WHERE prefix = ?');
    this.listKeysStatement = this.db.prepare(`
      SELECT
        prefix, tenant_id, label, status, expires_at, active_limit,
        rpm_limit, daily_request_limit, max_output, created_at, revoked_at
      FROM api_keys
      WHERE (? = 'all' OR status = ?)
      ORDER BY created_at ASC
    `);
    this.revokeAllActiveStatement = this.db.prepare(
      "UPDATE api_keys SET status = 'revoked', revoked_at = ? WHERE status = 'active'",
    );
    this.insertKeyStatement = this.db.prepare(`
      INSERT INTO api_keys (
        id, tenant_id, label, prefix, secret_hash, status, expires_at,
        active_limit, rpm_limit, daily_request_limit, max_output, created_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
    `);
    this.insertEventStatement = this.db.prepare(`
      INSERT INTO request_events (
        id, key_id, model_alias, started_at, queued_ms, response_start_ms, ttft_ms,
        elapsed_ms, requested_output, reported_output, finish_reason, status_code, outcome, error_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.incrementUsageStatement = this.db.prepare(`
      INSERT INTO daily_usage (key_id, usage_day, requests, reported_output_tokens)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(key_id, usage_day) DO UPDATE SET
        requests = requests + 1,
        reported_output_tokens = reported_output_tokens + excluded.reported_output_tokens
    `);
  }

  createKey({ tenantId, label, expiresAt = null, activeLimit, rpmLimit, dailyRequestLimit, maxOutput }) {
    const rawKey = `gma_live_${crypto.randomBytes(24).toString('base64url')}`;
    const id = crypto.randomUUID();
    const prefix = rawKey.slice(0, 17);
    const createdAt = new Date().toISOString();
    this.insertKeyStatement.run(
      id,
      tenantId,
      label,
      prefix,
      hashApiKey(rawKey, this.pepper),
      expiresAt,
      activeLimit,
      rpmLimit,
      dailyRequestLimit,
      maxOutput,
      createdAt,
    );
    return { id, rawKey, prefix, tenantId, label, expiresAt, activeLimit, rpmLimit, dailyRequestLimit, maxOutput };
  }

  verifyKey(rawKey) {
    if (typeof rawKey !== 'string' || !rawKey.startsWith('gma_live_')) return null;
    const key = this.findKeyStatement.get(hashApiKey(rawKey, this.pepper));
    if (!key || key.status !== 'active') return null;
    if (key.expires_at && Date.parse(key.expires_at) <= Date.now()) return null;
    return key;
  }

  revokeByPrefix(prefix) {
    const key = this.findPrefixStatement.get(prefix);
    if (!key) return false;
    this.db.prepare("UPDATE api_keys SET status = 'revoked', revoked_at = ? WHERE prefix = ?").run(new Date().toISOString(), prefix);
    return true;
  }

  listKeys(status = 'active') {
    return this.listKeysStatement.all(status, status);
  }

  revokeAllActiveKeys() {
    return this.revokeAllActiveStatement.run(new Date().toISOString()).changes;
  }

  recordEvent(event) {
    this.insertEventStatement.run(
      event.id,
      event.keyId ?? null,
      event.modelAlias,
      event.startedAt,
      event.queuedMs ?? 0,
      event.responseStartMs ?? null,
      event.ttftMs ?? null,
      event.elapsedMs,
      event.requestedOutput,
      event.reportedOutput ?? null,
      event.finishReason ?? null,
      event.statusCode,
      event.outcome,
      event.errorCode ?? null,
    );
    if (event.keyId && event.statusCode >= 200 && event.statusCode < 300) {
      this.incrementUsageStatement.run(event.keyId, event.startedAt.slice(0, 10), event.reportedOutput ?? 0);
    }
  }

  dailyUsage(keyId) {
    const row = this.db.prepare('SELECT requests, reported_output_tokens FROM daily_usage WHERE key_id = ? AND usage_day = ?').get(keyId, new Date().toISOString().slice(0, 10));
    return row ?? { requests: 0, reported_output_tokens: 0 };
  }

  metrics() {
    return this.db.prepare(`
      SELECT
        COUNT(*) AS total_events,
        SUM(CASE WHEN status_code BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS successful_events,
        SUM(CASE WHEN status_code = 429 THEN 1 ELSE 0 END) AS throttled_events,
        SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS failed_events
      FROM request_events
    `).get();
  }

  close() {
    this.db.close();
  }
}
