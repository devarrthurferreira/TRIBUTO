import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPlatformRouter } from '../src/platform/routes.mjs';
import { sha256 } from '../src/api/validation.mjs';

const CNPJ_A = '12345678000195';
const CNPJ_B = '98765432000198';
const setupToken = 'initial-setup-secret-' + 'x'.repeat(45);

class MemoryPlatformStore {
  constructor() {
    this.users = new Map(); this.companies = new Map(); this.agents = new Map();
    this.sessions = new Map(); this.items = new Map(); this.documents = new Map(); this.failures = new Map(); this.auditEntries = [];
  }
  async countUsers() { return this.users.size; }
  async createFirstAdmin(user) { if (this.users.size) throw new Error('SETUP_COMPLETE'); this.users.set(user._id, user); }
  async findUserByEmail(email) { return [...this.users.values()].find(x => x.email === email); }
  async findUserById(id) { return this.users.get(id); }
  async listUsers() { return [...this.users.values()]; }
  async createUser(user) { this.users.set(user._id, user); }
  async updateUser(id, changes) { const value = { ...this.users.get(id), ...changes }; this.users.set(id, value); return value; }
  async changePassword(id, hash, currentSessionHash) { this.users.get(id).passwordHash = hash; for (const [key, value] of this.sessions) if (value.userId === id && key !== currentSessionHash) this.sessions.delete(key); }
  async createSession(value) { this.sessions.set(value._id, value); }
  async findSession(hash) { const value = this.sessions.get(hash); return value && value.expiresAt > new Date() ? value : null; }
  async deleteSession(hash) { this.sessions.delete(hash); }
  async reserveLoginAttempt(key) { const value = this.failures.get(key); const count = (value?.until > Date.now() ? value.count : 0) + 1; this.failures.set(key, { count, until: Date.now() + 300_000 }); return count; }
  async clearLoginFailures(key) { this.failures.delete(key); }
  async listCompanies(allowed) { return [...this.companies.values()].filter(x => allowed === null || allowed.includes(x.cnpj)); }
  async companyExists(key) { return this.companies.has(key); }
  async createCompany(company) { this.companies.set(company.cnpj, company); }
  async dashboard(user) { return { companies: (await this.listCompanies(user.role === 'admin' ? null : user.companyCnpjs)).length, users: user.role === 'admin' ? this.users.size : null, documents: user.role === 'admin' || user.moduleGrants.fiscal ? [...this.documents.values()].filter(x => user.role === 'admin' || user.companyCnpjs.includes(x.companyCnpj)).length : null, workItemsOpen: [...this.items.values()].filter(x => x.status !== 'done' && (user.role === 'admin' || user.companyCnpjs.includes(x.companyCnpj) && user.moduleGrants[x.module])).length, agentsOnline: 0 }; }
  async listAgents() { return [...this.agents.values()].map(x => ({ id: x._id, name: x.name, active: x.active, assignments: x.assignments })); }
  async createAgent(agent) { this.agents.set(agent._id, agent); }
  async revokeAgent(id) { const value = this.agents.get(id); if (value) value.active = false; return value; }
  async findAgentByTokenHash(hash) { return [...this.agents.values()].find(x => x.tokenSha256 === hash && x.active); }
  async listWorkItems({ modules, companyCnpjs, module, companyCnpj }) { return [...this.items.values()].filter(x => (module ? x.module === module : modules.includes(x.module)) && (companyCnpjs === null || companyCnpjs.includes(x.companyCnpj)) && (!companyCnpj || x.companyCnpj === companyCnpj)); }
  async getWorkItem(id) { return this.items.get(id); }
  async createWorkItem(item) { this.items.set(item._id, item); }
  async updateWorkItem(id, changes) { const value = { ...this.items.get(id), ...changes }; this.items.set(id, value); return value; }
  async listFiscalDocuments(allowed, cnpj, page, limit) { const documents = [...this.documents.values()].filter(x => (allowed === null || allowed.includes(x.companyCnpj)) && (!cnpj || x.companyCnpj === cnpj)).slice((page - 1) * limit, page * limit).map(({ _id, companyCnpj, source, nsu, documentKey, sha256: hash, receivedAt }) => ({ id: _id, companyCnpj, source, nsu, documentKey, sha256: hash, receivedAt })); return { documents, page, hasMore: false }; }
  async getFiscalDocument(id) { return this.documents.get(id); }
  decryptFiscalXml(value) { return value.xml; }
  async audit(action, actorId, subject) { this.auditEntries.push({ action, actorId, subject }); }
}

async function fixture(run) {
  const store = new MemoryPlatformStore();
  const router = createPlatformRouter({ store, bootstrapTokenSha256: sha256(setupToken), secureCookies: false, logger: { error() {} } });
  const server = http.createServer(async (req, res) => {
    const handled = await router(req, res, new URL(req.url, 'http://localhost').pathname);
    if (!handled) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await run({ store, url }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

async function request(url, path, { method = 'GET', data, cookie, csrf } = {}) {
  const response = await fetch(`${url}${path}`, { method, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const contentType = response.headers.get('content-type') || '';
  return { status: response.status, body: contentType.includes('application/json') ? await response.json() : await response.text(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function setup(url) {
  const result = await request(url, '/v1/platform/setup', { method: 'POST', data: { setupToken, name: 'Arthur', email: 'programacao@maximumcontabil.com.br', password: 'senha-longa-aleatoria-123' } });
  assert.equal(result.status, 201);
  return { cookie: result.cookie, csrf: result.body.csrfToken, user: result.body.user };
}

test('primeiro admin, CSRF, permissões por módulo e empresa, tarefas', async () => fixture(async ({ store, url }) => {
  const initial = await request(url, '/v1/platform/session');
  assert.equal(initial.body.setupRequired, true);
  const admin = await setup(url);
  assert.equal((await request(url, '/v1/platform/session', { cookie: admin.cookie })).body.user.role, 'admin');
  assert.equal((await request(url, '/v1/platform/setup', { method: 'POST', data: { setupToken } })).status, 409);
  const denied = await request(url, '/v1/platform/companies', { method: 'POST', cookie: admin.cookie, data: { cnpj: CNPJ_A, name: 'Empresa A' } });
  assert.equal(denied.status, 403);
  for (const [cnpj, name] of [[CNPJ_A, 'Empresa A'], [CNPJ_B, 'Empresa B']]) {
    assert.equal((await request(url, '/v1/platform/companies', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { cnpj, name } })).status, 201);
  }
  const user = await request(url, '/v1/platform/users', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { name: 'Analista DP', email: 'dp@maximumcontabil.com.br', password: 'outra-senha-longa-123', role: 'member', companyCnpjs: [CNPJ_A], moduleGrants: { dp: 'view' } } });
  assert.equal(user.status, 201);
  const login = await request(url, '/v1/platform/login', { method: 'POST', data: { email: 'dp@maximumcontabil.com.br', password: 'outra-senha-longa-123' } });
  assert.equal(login.status, 200);
  const member = { cookie: login.cookie, csrf: login.body.csrfToken };
  assert.deepEqual((await request(url, '/v1/platform/companies', member)).body.companies.map(x => x.cnpj), [CNPJ_A]);
  assert.equal((await request(url, '/v1/platform/dashboard', member)).body.metrics.documents, null);
  assert.equal((await request(url, '/v1/platform/fiscal/documents', member)).status, 403);
  assert.equal((await request(url, `/v1/platform/work-items?companyCnpj=${CNPJ_B}`, member)).status, 403);
  assert.equal((await request(url, '/v1/platform/work-items', { method: 'POST', ...member, data: { module: 'dp', companyCnpj: CNPJ_A, title: 'Admissão' } })).status, 403);
  const created = await request(url, '/v1/platform/work-items', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { module: 'dp', companyCnpj: CNPJ_A, title: 'Conferir admissão' } });
  assert.equal(created.status, 201);
  assert.equal((await request(url, '/v1/platform/work-items?module=dp', member)).body.items.length, 1);
  assert.equal((await request(url, `/v1/platform/work-items/${created.body.item.id}`, { method: 'PATCH', ...member, data: { status: 'done' } })).status, 403);
  assert.ok(store.auditEntries.some(x => x.action === 'work_item.create'));
}));

test('token do agente é exibido uma vez e XML respeita escopo', async () => fixture(async ({ store, url }) => {
  const admin = await setup(url);
  for (const cnpj of [CNPJ_A, CNPJ_B]) await request(url, '/v1/platform/companies', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { cnpj, name: cnpj } });
  const created = await request(url, '/v1/platform/agents', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { name: 'Servidor Windows', assignments: [{ companyCnpj: CNPJ_A, source: 'NFE', startNsu: '0' }] } });
  assert.equal(created.status, 201);
  assert.match(created.body.token, /^[a-f0-9]{64}$/);
  assert.equal((await store.findAgentByTokenHash(sha256(created.body.token)))._id, created.body.agent.id);
  const listed = await request(url, '/v1/platform/agents', { cookie: admin.cookie });
  assert.equal(listed.body.agents.length, 1);
  assert.equal(JSON.stringify(listed.body).includes(created.body.token), false);
  const id = `${CNPJ_A}:NFE:1`;
  store.documents.set(id, { _id: id, companyCnpj: CNPJ_A, source: 'NFE', nsu: '1', documentKey: '1234', sha256: 'hash', xml: Buffer.from('<NFe/>'), receivedAt: new Date() });
  const fiscal = await request(url, '/v1/platform/fiscal/documents', { cookie: admin.cookie });
  assert.equal(fiscal.body.documents.length, 1);
  const download = await request(url, `/v1/platform/fiscal/documents/${encodeURIComponent(id)}/xml`, { cookie: admin.cookie });
  assert.equal(download.status, 200);
  assert.equal(download.body, '<NFe/>');
  assert.ok(store.auditEntries.some(x => x.action === 'fiscal.xml.download'));
}));

test('troca senha e limita tentativas de login no armazenamento', async () => fixture(async ({ url }) => {
  const admin = await setup(url);
  for (let i = 0; i < 5; i++) assert.equal((await request(url, '/v1/platform/login', { method: 'POST', data: { email: admin.user.email, password: 'errada' } })).status, 401);
  assert.equal((await request(url, '/v1/platform/login', { method: 'POST', data: { email: admin.user.email, password: 'senha-longa-aleatoria-123' } })).status, 429);
  const changed = await request(url, '/v1/platform/change-password', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { currentPassword: 'senha-longa-aleatoria-123', newPassword: 'nova-senha-longa-456' } });
  assert.equal(changed.status, 200);
}));

test('Fiscal filtra XML por carteira e rejeita CNPJ inválido', async () => fixture(async ({ store, url }) => {
  const admin = await setup(url);
  assert.equal((await request(url, '/v1/platform/companies', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { cnpj: '12345678000190', name: 'CNPJ errado' } })).status, 400);
  for (const cnpj of [CNPJ_A, CNPJ_B]) await request(url, '/v1/platform/companies', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { cnpj, name: cnpj } });
  const reader = await request(url, '/v1/platform/users', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { name: 'Fiscal A', email: 'fiscal@maximumcontabil.com.br', password: 'senha-fiscal-longa-789', role: 'member', companyCnpjs: [CNPJ_A], moduleGrants: { fiscal: 'view' } } });
  assert.equal(reader.status, 201);
  const login = await request(url, '/v1/platform/login', { method: 'POST', data: { email: 'fiscal@maximumcontabil.com.br', password: 'senha-fiscal-longa-789' } });
  const cookie = login.cookie;
  for (const cnpj of [CNPJ_A, CNPJ_B]) {
    const id = `${cnpj}:NFE:1`;
    store.documents.set(id, { _id: id, companyCnpj: cnpj, source: 'NFE', nsu: '1', documentKey: cnpj, sha256: 'hash', xml: Buffer.from('<NFe/>') });
  }
  const listed = await request(url, '/v1/platform/fiscal/documents', { cookie });
  assert.deepEqual(listed.body.documents.map(x => x.companyCnpj), [CNPJ_A]);
  assert.equal((await request(url, `/v1/platform/fiscal/documents/${encodeURIComponent(`${CNPJ_B}:NFE:1`)}/xml`, { cookie })).status, 403);
  assert.equal((await request(url, `/v1/platform/fiscal/documents/${encodeURIComponent(`${CNPJ_A}:NFE:1`)}/xml`, { cookie })).status, 200);
}));
