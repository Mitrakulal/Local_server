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
    const activeLimit = Number.parseInt(option('active-limit', String(config.perKeyConcurrent)), 10);
    const rpmLimit = Number.parseInt(option('rpm-limit', String(config.defaultRpmLimit)), 10);
    const dailyRequestLimit = Number.parseInt(option('daily-request-limit', String(config.defaultDailyRequestLimit)), 10);
    if (!tenantId || !Number.isSafeInteger(expiresDays) || expiresDays < 1 || !Number.isSafeInteger(maxOutput) || maxOutput < 1 || maxOutput > config.absoluteMaxOutput || !Number.isSafeInteger(activeLimit) || activeLimit < 1 || activeLimit > config.globalConcurrent || !Number.isSafeInteger(rpmLimit) || rpmLimit < 1 || rpmLimit > 10000 || !Number.isSafeInteger(dailyRequestLimit) || dailyRequestLimit < 1 || dailyRequestLimit > 1000000) {
      throw new Error(`Usage: node gateway/src/keys.mjs create --tenant=<id> --label=<label> --expires-days=<positive integer> [--max-output=1..${config.absoluteMaxOutput}] [--active-limit=1..${config.globalConcurrent}] [--rpm-limit=1..10000] [--daily-request-limit=1..1000000]`);
    }
    const expiresAt = new Date(Date.now() + expiresDays * 86400000).toISOString();
    const key = store.createKey({
      tenantId,
      label,
      expiresAt,
      activeLimit,
      rpmLimit,
      dailyRequestLimit,
      maxOutput,
    });
    console.log(JSON.stringify({
      created: true,
      prefix: key.prefix,
      tenant_id: key.tenantId,
      label: key.label,
      expires_at: key.expiresAt,
      active_limit: key.activeLimit,
      rpm_limit: key.rpmLimit,
      daily_request_limit: key.dailyRequestLimit,
      max_output: maxOutput,
      api_key: key.rawKey,
      warning: 'Copy this API key now. It is not stored in raw form and cannot be displayed again.',
    }, null, 2));
  } else if (command === 'revoke') {
    const prefix = option('prefix');
    if (!prefix) throw new Error('Usage: node gateway/src/keys.mjs revoke --prefix=<key-prefix>');
    const revoked = store.revokeByPrefix(prefix);
    console.log(JSON.stringify({ revoked, prefix }, null, 2));
  } else if (command === 'list') {
    const status = option('status', 'active');
    if (!['active', 'revoked', 'all'].includes(status)) {
      throw new Error('Usage: node gateway/src/keys.mjs list [--status=active|revoked|all]');
    }
    console.log(JSON.stringify({ status, keys: store.listKeys(status) }, null, 2));
  } else if (command === 'revoke-all') {
    if (option('confirm') !== 'REVOKE_ALL_ACTIVE_KEYS') {
      throw new Error('Refusing bulk revocation. Usage: node gateway/src/keys.mjs revoke-all --confirm=REVOKE_ALL_ACTIVE_KEYS');
    }
    console.log(JSON.stringify({ revoked_active_keys: store.revokeAllActiveKeys() }, null, 2));
  } else {
    throw new Error('Usage: node gateway/src/keys.mjs <create|list|revoke|revoke-all> [options]');
  }
} finally {
  store.close();
}
