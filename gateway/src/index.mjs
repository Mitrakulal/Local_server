/** Stage 1 entry point: loopback-only gateway process. */
import { loadConfig } from './config.mjs';
import { GatewayStore } from './store.mjs';
import { createGateway } from './gateway.mjs';

const config = loadConfig();
const store = new GatewayStore(config.databasePath, config.keyPepper);
const gateway = createGateway({ config, store });

await gateway.start();
console.info(JSON.stringify({ level: 'info', message: 'gateway_started', host: config.bindHost, port: config.port, model: config.publicModelAlias }));

async function shutdown(signal) {
  console.info(JSON.stringify({ level: 'info', message: 'gateway_shutdown', signal }));
  await gateway.stop();
  store.close();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
