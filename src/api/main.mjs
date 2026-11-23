import { createApiServer } from './http.mjs';
import { MySqlStore } from './mysql-store.mjs';
import { PlatformMySqlStore } from '../platform/mysql-store.mjs';
import { createPlatformRouter } from '../platform/routes.mjs';

for (const key of ['MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']) {
  if (!process.env[key]) throw new Error(`${key} obrigatória`);
}
const bootstrapTokenSha256 = process.env.BOOTSTRAP_ADMIN_TOKEN_SHA256 || null;
if (bootstrapTokenSha256 && !/^[a-f0-9]{64}$/.test(bootstrapTokenSha256)) throw new Error('BOOTSTRAP_ADMIN_TOKEN_SHA256 deve conter 64 caracteres hex');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida');
const mysqlPort = Number(process.env.MYSQL_PORT || 3306);
if (!Number.isInteger(mysqlPort) || mysqlPort < 1 || mysqlPort > 65535) throw new Error('MYSQL_PORT inválida');
const store = await MySqlStore.connect({
  host: process.env.MYSQL_HOST || '127.0.0.1', port: mysqlPort,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
});
const platformStore = new PlatformMySqlStore(store.pool);
await platformStore.initialize();
if (await platformStore.countUsers() === 0 && !bootstrapTokenSha256) throw new Error('Configure BOOTSTRAP_ADMIN_TOKEN_SHA256 para o primeiro administrador');
const platformRouter = createPlatformRouter({ store: platformStore, bootstrapTokenSha256, secureCookies: process.env.COOKIE_SECURE !== 'false' });
const server = createApiServer({ store, agentRegistry: platformStore, platformRouter });
server.listen(port, host, () => console.log(`TRIBUTO API ouvindo em ${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await store.close(); process.exit(0); }));
