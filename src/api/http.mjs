import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ApiError, sha256, validateBatch, validateHeartbeat, validateConfig } from './validation.mjs';
import { serveStatic } from './static.mjs';

const MAX_BODY_BYTES = 1_000_000;

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) throw new ApiError(415, 'CONTENT_TYPE', 'Use application/json');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new ApiError(413, 'BODY_TOO_LARGE', 'Lote acima de 1 MB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'JSON inválido'); }
}

async function resolveAgent(req, agents, agentRegistry) {
  const match = /^Bearer ([A-Za-z0-9._~-]{32,256})$/.exec(req.headers.authorization || '');
  if (!match) throw new ApiError(401, 'UNAUTHORIZED', 'Credencial do agente ausente');
  const hash = sha256(match[1]);
  if (agentRegistry) {
    const agent = await agentRegistry.findAgentByTokenHash(hash);
    if (!agent || !agent.active) throw new ApiError(401, 'UNAUTHORIZED', 'Credencial do agente inválida');
    return { ...agent, id: agent.id ?? agent._id };
  }
  const actual = Buffer.from(hash, 'hex');
  let found;
  for (const agent of agents) {
    const expected = Buffer.from(agent.tokenSha256, 'hex');
    if (timingSafeEqual(actual, expected)) found = agent;
  }
  if (!found) throw new ApiError(401, 'UNAUTHORIZED', 'Credencial do agente inválida');
  return found;
}

function permitted(agent, companyCnpj, source) {
  if (!agent.companies.includes(companyCnpj) || !agent.sources.includes(source)) throw new ApiError(403, 'FORBIDDEN_SCOPE', 'CNPJ ou fonte fora do escopo do agente');
}

export function createApiServer({ store, agents, jobs = [], agentRegistry, platformRouter, whatsapp, logger = console }) {
  if (agentRegistry) {
    if (agents) throw new Error('Escolha agentRegistry ou agents estáticos');
  } else validateConfig(agents, jobs);
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/healthz') return send(res, 200, { ok: true, service: 'tributo-api' });
      if (whatsapp && await whatsapp.handleWebhook(req, res, pathname)) return;
      if (platformRouter && pathname.startsWith('/v1/platform/')) {
        await platformRouter(req, res, pathname);
        return;
      }
      if (await serveStatic(req, res, pathname)) return;
      if (!pathname.startsWith('/v1/agent/')) return send(res, 404, { error: 'NOT_FOUND', message: 'Rota inexistente' });
      const agent = await resolveAgent(req, agents, agentRegistry);
      const assignedJobs = agentRegistry ? await agentRegistry.listAgentJobs(agent.id) : jobs;

      if (req.method === 'GET' && pathname === '/v1/agent/jobs') {
        const allowed = assignedJobs.filter(job => job.enabled && (!agents || (agent.companies.includes(job.companyCnpj) && agent.sources.includes(job.source))));
        const result = agentRegistry ? allowed : await Promise.all(allowed.map(async job => ({ ...job, lastCommittedNsu: await store.getCheckpoint(job.companyCnpj, job.source) ?? job.startNsu })));
        return send(res, 200, { jobs: result });
      }
      if (req.method === 'POST' && pathname === '/v1/agent/heartbeat') {
        const heartbeat = validateHeartbeat(await readJson(req));
        if (agentRegistry?.recordAgentHealth) await agentRegistry.recordAgentHealth(agent.id, heartbeat);
        else await store.recordHeartbeat(agent.id, heartbeat);
        return send(res, 200, { ok: true, serverTime: new Date().toISOString() });
      }
      if (req.method === 'POST' && pathname === '/v1/agent/batches') {
        const batch = validateBatch(await readJson(req));
        if (!agentRegistry) permitted(agent, batch.companyCnpj, batch.source);
        const job = assignedJobs.find(item => item.enabled && item.companyCnpj === batch.companyCnpj && item.source === batch.source);
        if (!job) throw new ApiError(403, 'JOB_DISABLED', 'Coleta deste CNPJ/fonte não está habilitada');
        const { existed } = await store.commitBatch(agent.id, batch, job.startNsu);
        return send(res, existed ? 200 : 201, { ok: true, batchId: batch.batchId, committedThroughNsu: batch.lastNsu });
      }
      return send(res, 404, { error: 'NOT_FOUND', message: 'Rota inexistente' });
    } catch (error) {
      if (error instanceof ApiError) return send(res, error.status, { error: error.code, message: error.message });
      logger.error('API failure', { error: error?.message ?? String(error) });
      return send(res, 500, { error: 'INTERNAL_ERROR', message: 'Falha interna' });
    }
  });
}
