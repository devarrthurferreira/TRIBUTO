import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/api/http.mjs';
import { sha256, ApiError } from '../src/api/validation.mjs';

const token = 'a'.repeat(64);
const cnpj = '12345678000190';

class MemoryStore {
  constructor() { this.batches = new Map(); this.checkpoints = new Map(); this.heartbeats = new Map(); }
  async getCheckpoint(company, source) { return this.checkpoints.get(`${company}:${source}`) ?? null; }
  async recordHeartbeat(id, value) { this.heartbeats.set(id, value); }
  async commitBatch(agentId, batch, startNsu) {
    const key = `${agentId}:${batch.batchId}`;
    const digest = sha256(JSON.stringify({ company: batch.companyCnpj, source: batch.source, first: batch.firstNsu, last: batch.lastNsu, docs: batch.documents.map(x => [x.nsu, x.documentKey, x.sha256]) }));
    const previous = this.batches.get(key);
    if (previous) {
      if (previous !== digest) throw new ApiError(409, 'BATCH_CONFLICT', 'batchId reutilizado');
      return { existed: true };
    }
    const checkpointKey = `${batch.companyCnpj}:${batch.source}`;
    const last = this.checkpoints.get(checkpointKey);
    if (BigInt(batch.firstNsu) !== BigInt(last ?? startNsu) + 1n) throw new ApiError(409, 'NSU_OUT_OF_SEQUENCE', 'Lacuna na sequência');
    this.batches.set(key, digest);
    this.checkpoints.set(checkpointKey, batch.lastNsu);
    return { existed: false };
  }
}

async function fixture(fn) {
  const store = new MemoryStore();
  const server = createApiServer({
    store,
    agents: [{ id: 'maximum-01', tokenSha256: sha256(token), companies: [cnpj], sources: ['NFE', 'NFSE'] }],
    jobs: [{ id: 'job-nfe', companyCnpj: cnpj, source: 'NFE', startNsu: '0', enabled: true }, { id: 'other-client', companyCnpj: '00000000000000', source: 'NFE', startNsu: '0', enabled: true }],
    logger: { error() {} }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await fn({ store, url }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function batch(overrides = {}) {
  const xml = Buffer.from('<NFe>piloto</NFe>');
  return {
    batchId: 'batch-0001', companyCnpj: cnpj, source: 'NFE', firstNsu: '1', lastNsu: '1',
    documents: [{ nsu: '1', documentKey: '12345678901234567890123456789012345678901234', xmlBase64: xml.toString('base64'), sha256: sha256(xml) }],
    ...overrides
  };
}

async function call(url, path, { method = 'GET', data, auth = token } = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(data ? { 'content-type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined
  });
  return { status: response.status, body: await response.json() };
}

test('agente vê apenas seus CNPJs e publica heartbeat', async () => fixture(async ({ store, url }) => {
  const jobs = await call(url, '/v1/agent/jobs');
  assert.equal(jobs.status, 200);
  assert.deepEqual(jobs.body.jobs.map(x => x.id), ['job-nfe']);
  const health = await call(url, '/v1/agent/heartbeat', { method: 'POST', data: { hostname: 'maximum', version: '0.1.0', queuedBatches: 2, agentId: 'forged' } });
  assert.equal(health.status, 200);
  assert.equal(store.heartbeats.get('maximum-01').queuedBatches, 2);
  assert.equal(store.heartbeats.has('forged'), false);
}));

test('lote confirmado, repetição e conflito', async () => fixture(async ({ store, url }) => {
  const first = await call(url, '/v1/agent/batches', { method: 'POST', data: batch() });
  assert.deepEqual(first, { status: 201, body: { ok: true, batchId: 'batch-0001', committedThroughNsu: '1' } });
  const second = await call(url, '/v1/agent/batches', { method: 'POST', data: batch() });
  assert.equal(second.status, 200);
  assert.equal(store.batches.size, 1);
  assert.equal(store.checkpoints.get(`${cnpj}:NFE`), '1');
  const changedBatch = batch();
  changedBatch.documents[0].documentKey = '12345678901234567890123456789012345678901235';
  const changed = await call(url, '/v1/agent/batches', { method: 'POST', data: changedBatch });
  assert.equal(changed.status, 409);
}));

test('não aceita outro CNPJ, token inválido ou XML adulterado', async () => fixture(async ({ store, url }) => {
  assert.equal((await call(url, '/v1/agent/batches', { method: 'POST', data: batch({ companyCnpj: '00000000000000' }) })).status, 403);
  assert.equal((await call(url, '/v1/agent/jobs', { auth: 'b'.repeat(64) })).status, 401);
  const corrupted = batch();
  corrupted.documents[0].sha256 = '0'.repeat(64);
  assert.equal((await call(url, '/v1/agent/batches', { method: 'POST', data: corrupted })).status, 400);
  assert.equal(store.batches.size, 0);
}));

test('não avança NSU com lacuna ou CNPJ/fonte sem tarefa ativa', async () => fixture(async ({ store, url }) => {
  const gap = batch({ firstNsu: '3', lastNsu: '3', documents: [{ ...batch().documents[0], nsu: '3' }] });
  assert.equal((await call(url, '/v1/agent/batches', { method: 'POST', data: gap })).body.error, 'NSU_OUT_OF_SEQUENCE');
  const incomplete = batch({ firstNsu: '1', lastNsu: '3' });
  assert.equal((await call(url, '/v1/agent/batches', { method: 'POST', data: incomplete })).status, 400);
  const noJob = batch({ source: 'NFSE' });
  assert.equal((await call(url, '/v1/agent/batches', { method: 'POST', data: noJob })).status, 403);
  assert.equal(store.checkpoints.size, 0);
}));

test('recusa dois agentes configurados com o mesmo token', () => {
  const first = { id: 'first', tokenSha256: sha256(token), companies: [cnpj], sources: ['NFE'] };
  assert.throws(() => createApiServer({ store: new MemoryStore(), agents: [first, { ...first, id: 'second' }] }), /token duplicado/);
});

test('agente cadastrado no banco só vê sua tarefa e pode ser revogado', async () => {
  const store = new MemoryStore();
  let active = true;
  const registry = {
    async findAgentByTokenHash(hash) { return hash === sha256(token) ? { _id: 'agent-db', active } : null; },
    async listAgentJobs() { return [{ id: 'nfe-empresa', companyCnpj: cnpj, source: 'NFE', startNsu: '0', enabled: true }]; }
  };
  const server = createApiServer({ store, agentRegistry: registry, logger: { error() {} } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await call(url, '/v1/agent/jobs')).body.jobs.length, 1);
    assert.equal((await call(url, '/v1/agent/batches', { method: 'POST', data: batch() })).status, 201);
    assert.equal((await call(url, '/v1/agent/batches', { method: 'POST', data: batch({ companyCnpj: '00000000000000' }) })).status, 403);
    active = false;
    assert.equal((await call(url, '/v1/agent/jobs')).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
