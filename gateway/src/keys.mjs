/** Stage 1 local key administration CLI. Raw key material is printed once only. */
import { loadConfig } from './config.mjs';
import { GatewayStore } from './store.mjs';

function option(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const [command] = process.argv.slice(2);
const config = loadConfig();
const store = new GatewayStore(config.databasePath, config.keyPepper);

try {
  if (command === 'create') {
    const tenantId = option('tenant');
    const label = option('label', 'invited-user');
    const expiresDays = Number.parseInt(option('expires-days', '30'), 10);
    const maxOutput = Number.parseInt(option('max-output', String(config.defaultMaxOutput)), 10);
    if (!tenantId || !Number.isSafeInteger(expiresDays) || expiresDays < 1 || !Number.isSafeInteger(maxOutput) || maxOutput < 1 || maxOutput > config.absoluteMaxOutput) {
      throw new Error(`Usage: node gateway/src/keys.mjs create --tenant=<id> --label=<label> --expires-days=<positive integer> [--max-output=1..${config.absoluteMaxOutput}]`);
    }
    const expiresAt = new Date(Date.now() + expiresDays * 86400000).toISOString();
    const key = store.createKey({
      tenantId,
      label,
      expiresAt,
      activeLimit: config.perKeyConcurrent,
      rpmLimit: config.defaultRpmLimit,
      dailyRequestLimit: config.defaultDailyRequestLimit,
      maxOutput,
    });
    console.log(JSON.stringify({
      created: true,
      prefix: key.prefix,
      tenant_id: key.tenantId,
      label: key.label,
      expires_at: key.expiresAt,
      max_output: maxOutput,
      api_key: key.rawKey,
      warning: 'Copy this API key now. It is not stored in raw form and cannot be displayed again.',
    }, null, 2));
  } else if (command === 'revoke') {
    const prefix = option('prefix');
    if (!prefix) throw new Error('Usage: node gateway/src/keys.mjs revoke --prefix=<key-prefix>');
    const revoked = store.revokeByPrefix(prefix);
    console.log(JSON.stringify({ revoked, prefix }, null, 2));
  } else {
    throw new Error('Usage: node gateway/src/keys.mjs <create|revoke> [options]');
  }
} finally {
  store.close();
}
