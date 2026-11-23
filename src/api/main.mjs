import { createApiServer } from './http.mjs';
import { MongoStore } from './mongo-store.mjs';

function readJsonEnv(name) {
  try { return JSON.parse(process.env[name] ?? ''); }
  catch { throw new Error(`${name} precisa conter JSON válido`); }
}

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI obrigatória');
const encryptionKeyBase64 = process.env.XML_ENCRYPTION_KEY;
const encryptionKey = Buffer.from(encryptionKeyBase64 || '', 'base64');
if (!encryptionKeyBase64 || encryptionKey.length !== 32 || encryptionKey.toString('base64') !== encryptionKeyBase64) throw new Error('XML_ENCRYPTION_KEY deve ser base64 de 32 bytes aleatórios');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida');
const store = await MongoStore.connect(uri, process.env.MONGODB_DB || 'tributo', encryptionKey);
const server = createApiServer({ store, agents: readJsonEnv('AGENT_TOKENS_JSON'), jobs: readJsonEnv('COLLECTOR_JOBS_JSON') });
server.listen(port, host, () => console.log(`TRIBUTO API ouvindo em ${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await store.close(); process.exit(0); }));
