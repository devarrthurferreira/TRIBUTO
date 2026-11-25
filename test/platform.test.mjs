import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPlatformRouter } from '../src/platform/routes.mjs';
import { canPerform, canAccessWorkItemCompany } from '../src/platform/policy.mjs';
import { sha256 } from '../src/api/validation.mjs';

const CNPJ_A = '12345678000195';
const CNPJ_B = '98765432000198';
const setupToken = 'initial-setup-secret-' + 'x'.repeat(45);

class MemoryPlatformStore {
  constructor() {
    this.users = new Map(); this.companies = new Map(); this.agents = new Map();
    this.profiles = new Map();
    this.sessions = new Map(); this.items = new Map(); this.documents = new Map(); this.failures = new Map(); this.auditEntries = [];
  }
  async countUsers() { return this.users.size; }
  async createFirstAdmin(user) { if (this.users.size) throw new Error('SETUP_COMPLETE'); this.users.set(user._id, user); }
  async findUserByEmail(email) { return [...this.users.values()].find(x => x.email === email); }
  async findUserByUsername(username) { return [...this.users.values()].find(x => x.username === username); }
  async findUserById(id) { return this.users.get(id); }
  async getUserProfile(id) { return this.profiles.get(id) ?? null; }
  async listUsers() { return [...this.users.values()]; }
  async createUser(user) {
    const { profile, username: base, ...account } = user;
    const users = [...this.users.values()];
    if (users.some(({ email }) => email === account.email)) throw Object.assign(new Error('DUPLICATE_USER_EMAIL'), { code: 'DUPLICATE_USER_EMAIL' });
    if (profile && [...this.profiles.values()].some(({ cpf }) => cpf === profile.cpf)) {
      throw Object.assign(new Error('DUPLICATE_USER_CPF'), { code: 'DUPLICATE_USER_CPF' });
    }
    let username = base;
    for (let attempt = 2; username && users.some((other) => other.username === username); attempt += 1) username = `${base}${attempt}`;
    this.users.set(user._id, { ...account, username });
    if (profile) this.profiles.set(user._id, profile);
    return username;
  }
  async updateUser(id, changes) { const value = { ...this.users.get(id), ...changes }; this.users.set(id, value); return value; }
  async changePassword(id, hash, currentSessionHash) { this.users.get(id).passwordHash = hash; for (const [key, value] of this.sessions) if (value.userId === id && key !== currentSessionHash) this.sessions.delete(key); }
  async createSession(value) { this.sessions.set(value._id, value); }
  async findSession(hash) { const value = this.sessions.get(hash); return value && value.expiresAt > new Date() ? value : null; }
  async deleteSession(hash) { this.sessions.delete(hash); }
  async reserveLoginAttempt(key) { const value = this.failures.get(key); const count = (value?.until > Date.now() ? value.count : 0) + 1; this.failures.set(key, { count, until: Date.now() + 300_000 }); return count; }
  async clearLoginFailures(key) { this.failures.delete(key); }
  async listCompanies(allowed) { return [...this.companies.values()].filter(x => allowed === null || allowed.includes(x.cnpj)); }
  async getCompany(key) { return this.companies.get(key); }
  async companyExists(key) { return this.companies.has(key); }
  async createCompany(company) { this.companies.set(company.cnpj, company); }
  async updateCompany(key, changes, actorId) {
    const previous = this.companies.get(key);
    if (!previous) return null;
    const updated = { ...previous, ...changes };
    this.companies.set(key, updated);
    await this.audit('company.update', actorId, key);
    return updated;
  }
  async setCompanyAccess(key, id, hasAccess, actorId) {
    const person = this.users.get(id);
    if (!person) return 'not_found';
    if (person.role === 'admin') return 'admin';
    if (hasAccess && !person.active) return 'inactive';
    if (person.companyCnpjs.includes(key) === hasAccess) return hasAccess;
    if (hasAccess && person.companyCnpjs.length >= 1000) return 'limit';
    person.companyCnpjs = hasAccess ? [...person.companyCnpjs, key] : person.companyCnpjs.filter(value => value !== key);
    await this.audit(hasAccess ? 'company.access.grant' : 'company.access.revoke', actorId, key);
    return hasAccess;
  }
  async dashboard(user) {
    const companyScope = user.role === 'admin' ? null : user.companyCnpjs;
    const documents = canPerform(user, 'fiscal', 'fiscalDocumentsRead')
      ? [...this.documents.values()].filter(x => companyScope === null || companyScope.includes(x.companyCnpj)).length
      : null;
    const workItemsOpen = [...this.items.values()].filter(item => item.status !== 'done' &&
      canPerform(user, item.module, 'workItemRead') && canAccessWorkItemCompany(user, item.module, item.companyCnpj)).length;
    return { companies: (await this.listCompanies(companyScope)).length, users: user.role === 'admin' ? this.users.size : null, documents, workItemsOpen, agentsOnline: 0 };
  }
  async getStorageUsage() { return { bytes: 4096, tableCount: 2, approximate: true, tables: [] }; }
  async listAgents() { return [...this.agents.values()].map(x => ({ id: x._id, name: x.name, active: x.active, assignments: x.assignments })); }
  async createAgent(agent) { this.agents.set(agent._id, agent); }
  async revokeAgent(id) { const value = this.agents.get(id); if (value) value.active = false; return value; }
  async findAgentByTokenHash(hash) { return [...this.agents.values()].find(x => x.tokenSha256 === hash && x.active); }
  async listWorkItems({ modules, companyCnpjs, module, companyCnpj }) {
    return [...this.items.values()].filter(item =>
      (module ? item.module === module : modules.includes(item.module)) &&
      (companyCnpjs === null || companyCnpjs.includes(item.companyCnpj) || item.module === 'tecnologia' && item.companyCnpj === null) &&
      (!companyCnpj || item.companyCnpj === companyCnpj));
  }
  async getWorkItem(id) { return this.items.get(id); }
  async createWorkItem(item) { this.items.set(item._id, item); }
  async updateWorkItem(id, changes) { const value = { ...this.items.get(id), ...changes }; this.items.set(id, value); return value; }
  async listFiscalDocuments(allowed, cnpj, page, limit) {
    const rows = [...this.documents.values()].filter(x => (allowed === null || allowed.includes(x.companyCnpj)) && (!cnpj || x.companyCnpj === cnpj));
    const documents = rows.slice((page - 1) * limit, page * limit).map(({ _id, companyCnpj, source, nsu, documentKey, receivedAt }) => ({ id: _id, companyCnpj, source, nsu, documentKey, receivedAt }));
    return { documents, page, hasMore: rows.length > page * limit };
  }
  async listCompanyNfse(cnpj, { month, role, status, page, limit }) {
    const rows = [...this.documents.values()].filter(x => x.companyCnpj === cnpj && x.source === 'NFSE' && (!month || x.competence === month) && (!role || x.role === role) && (!status || x.status === status));
    return { documents: rows.slice((page - 1) * limit, page * limit), page, hasMore: rows.length > page * limit };
  }
  async getCompanyNfseSummary(cnpj, { from, to }) {
    const rows = [...this.documents.values()].filter(x => x.companyCnpj === cnpj && x.source === 'NFSE' && (!from || x.competence >= from) && (!to || x.competence <= to));
    const summarize = (items) => ({
      issuedCount: items.filter(x => x.role === 'issued').length,
      receivedCount: items.filter(x => x.role === 'received').length,
      cancelledCount: items.filter(x => x.status === 'cancelled').length,
      issuedAmountCents: String(items.filter(x => x.role === 'issued').reduce((sum, x) => sum + Number(x.amountCents), 0)),
      receivedAmountCents: String(items.filter(x => x.role === 'received').reduce((sum, x) => sum + Number(x.amountCents), 0)),
      issuedActiveAmountCents: String(items.filter(x => x.role === 'issued' && x.status === 'active').reduce((sum, x) => sum + Number(x.amountCents), 0)),
      receivedActiveAmountCents: String(items.filter(x => x.role === 'received' && x.status === 'active').reduce((sum, x) => sum + Number(x.amountCents), 0)),
    });
    return { summary: summarize(rows), byMonth: [...new Set(rows.map(x => x.competence))].sort().map(month => ({ month, ...summarize(rows.filter(x => x.competence === month)) })) };
  }
  async getCompanyNfseCoverage(cnpj) {
    const rows = [...this.documents.values()].filter(x => x.companyCnpj === cnpj && x.source === 'NFSE');
    return { source: 'NFSE', lastNsu: rows.at(-1)?.nsu ?? null, lastSeenAt: rows.at(-1)?.receivedAt ?? null, status: rows.length ? 'received' : 'never_collected' };
  }
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

test('cadastro guiado normaliza usuário, separa dados pessoais e usa o mesmo limite de login por e-mail ou usuário', async () => fixture(async ({ store, url }) => {
  const path = '/v1/platform';
  const admin = await setup(url);
  const company = { cnpj: CNPJ_A, name: 'Empresa de teste' };
  assert.equal((await request(url, `${path}/companies`, { method: 'POST', ...admin, data: company })).status, 201);
  const profile = { firstName: 'João Pedro', lastName: 'D’Ávila', cpf: '529.982.247-25', birthDate: '1996-02-29', email: 'Pessoal@example.test',
    phone: '+55 (32) 99999-9999', hasChildren: true, childrenCount: 2,
    address: { cep: '36015-010', street: 'Rua de teste', neighborhood: 'Centro', number: 'S/N' } };
  const password = 'senha-do-usuario-123';
  const accountData = { email: 'acesso@example.test', password, role: 'member', companyCnpjs: [CNPJ_A], moduleGrants: { fiscal: 'view' }, profile };
  const addUser = (data) => request(url, `${path}/users`, { method: 'POST', ...admin, data });
  assert.equal((await addUser({ ...accountData, profile: { ...profile, cpf: '11111111111' } })).status, 400);
  assert.equal((await addUser({ ...accountData, profile: { ...profile, birthDate: '1997-02-29' } })).status, 400);
  assert.equal((await addUser({ ...accountData, profile: { ...profile, childrenCount: 0 } })).status, 400);
  assert.equal((await addUser({ ...accountData, profile: { ...profile, hasChildren: false } })).status, 400);
  const created = await addUser(accountData);
  assert.equal(created.status, 201);
  assert.equal(created.body.user.username, 'joaopedro.davila');
  assert.deepEqual(created.body.user.companyCnpjs, [CNPJ_A]);
  assert.deepEqual(created.body.user.moduleGrants, { fiscal: 'view' });
  const assertSafeUser = ({ user, profile }) => {
    assert.equal(profile, undefined);
    for (const key of ['passwordHash', 'profile', 'cpf', 'birthDate', 'address']) assert.equal(user[key], undefined);
  };
  assertSafeUser(created.body);
  const duplicateEmail = await addUser({ ...accountData, profile: { ...profile, cpf: '111.444.777-35' } });
  assert.equal(duplicateEmail.status, 409);
  assert.equal(duplicateEmail.body.error, 'DUPLICATE_USER_EMAIL');
  const duplicateCpf = await addUser({ ...accountData, email: 'segundo@example.test' });
  assert.equal(duplicateCpf.status, 409);
  assert.equal(duplicateCpf.body.error, 'DUPLICATE_USER_CPF');
  const second = await addUser({ ...accountData, email: 'segundo@example.test', profile: { ...profile, cpf: '111.444.777-35', hasChildren: false, childrenCount: null } });
  assert.equal(second.status, 201);
  assert.equal(second.body.user.username, 'joaopedro.davila2');

  const route = `${path}/users/${created.body.user.id}`;
  const adminDetail = await request(url, route, admin);
  assert.equal(adminDetail.status, 200);
  assert.deepEqual(adminDetail.body.profile, { ...profile, cpf: '52998224725', phone: '5532999999999', email: 'pessoal@example.test', address: { ...profile.address, cep: '36015010' } });
  assertSafeUser({ user: adminDetail.body.user });
  const list = await request(url, `${path}/users`, admin);
  list.body.users.forEach(user => assertSafeUser({ user }));
  const login = (identifier, password) => request(url, `${path}/login`, { method: 'POST', data: { identifier, password } });
  const result = await login('  JO AOPEDRO.DAVILA  ', password);
  assert.equal(result.status, 400);
  const validLogin = await login('  JOAOPEDRO.DAVILA  ', password);
  assert.equal(validLogin.status, 200);
  assertSafeUser(validLogin.body);
  assertSafeUser((await request(url, `${path}/session`, { cookie: validLogin.cookie })).body);
  assert.equal((await request(url, route, { cookie: validLogin.cookie })).status, 403);
  assert.equal((await request(url, `${path}/users`, { cookie: validLogin.cookie, csrf: validLogin.body.csrfToken, method: 'POST', data: accountData })).status, 403);
  assert.equal((await request(url, `${path}/login`, { method: 'POST', data: { email: accountData.email, password } })).status, 200);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const identifier = attempt % 2 ? accountData.email : created.body.user.username;
    assert.equal((await login(identifier, 'senha-errada')).status, 401);
  }
  assert.equal((await login(accountData.email, password)).status, 429);
  assert.equal((await store.findUserById(created.body.user.id)).profile, undefined);
}));

test('senha inicial de dez caracteres autentica o primeiro administrador', async () => fixture(async ({ store, url }) => {
  const credentials = { email: 'admin@example.test', password: 'Test@abc42' };
  const firstAdmin = { ...credentials, setupToken, name: 'Programação' };
  const short = await request(url, '/v1/platform/setup', { method: 'POST', data: { ...firstAdmin, password: 'short' } });
  assert.equal(short.status, 400);
  assert.equal(await store.countUsers(), 0);
  const created = await request(url, '/v1/platform/setup', { method: 'POST', data: firstAdmin });
  assert.equal(created.status, 201);
  const login = await request(url, '/v1/platform/login', { method: 'POST', data: credentials });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'admin');
  assert.equal((await request(url, '/v1/platform/dashboard', { cookie: login.cookie })).status, 200);
}));

test('primeiro admin, CSRF, permissões por módulo e empresa, tarefas', async () => fixture(async ({ store, url }) => {
  const initial = await request(url, '/v1/platform/session');
  assert.equal(initial.body.setupRequired, true);
  const admin = await setup(url);
  assert.equal((await request(url, '/v1/platform/session', { cookie: admin.cookie })).body.user.role, 'admin');
  assert.equal((await request(url, '/v1/platform/storage', { cookie: admin.cookie })).body.bytes, 4096);
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
  assert.equal((await request(url, '/v1/platform/storage', member)).status, 403);
  assert.equal((await request(url, `/v1/platform/work-items?companyCnpj=${CNPJ_B}`, member)).status, 403);
  assert.equal((await request(url, '/v1/platform/work-items', { method: 'POST', ...member, data: { module: 'dp', companyCnpj: CNPJ_A, title: 'Admissão' } })).status, 403);
  const created = await request(url, '/v1/platform/work-items', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { module: 'dp', companyCnpj: CNPJ_A, title: 'Conferir admissão' } });
  assert.equal(created.status, 201);
  assert.equal((await request(url, '/v1/platform/work-items?module=dp', member)).body.items.length, 1);
  assert.equal((await request(url, `/v1/platform/work-items/${created.body.item.id}`, { method: 'PATCH', ...member, data: { status: 'done' } })).status, 403);
  assert.ok(store.auditEntries.some(x => x.action === 'work_item.create'));
}));

test('Tecnologia aceita demandas internas e aplica bloqueios por ação', async () => fixture(async ({ url }) => {
  const admin = await setup(url);
  const path = '/v1/platform';
  const listed = await request(url, `${path}/modules`, admin);
  assert.deepEqual(listed.body.modules.filter(module => !module.legacy).map(module => module.id),
    ['dp', 'rh', 'tecnologia', 'marketing', 'societario', 'contabil', 'fiscal', 'diretoria']);

  const password = 'senha-tecnologia-longa';
  const credentials = { email: 'tecnologia@example.test', password };
  const createUser = { ...credentials, name: 'Tecnologia', role: 'member', companyCnpjs: [], moduleGrants: {
    tecnologia: { level: 'edit', blockedActions: ['workItemUpdate'] },
    fiscal: { level: 'view', blockedActions: ['fiscalDocumentsRead'] }
  } };
  const person = await request(url, `${path}/users`, { method: 'POST', ...admin, data: createUser });
  assert.equal(person.status, 201);
  const loggedIn = await request(url, `${path}/login`, { method: 'POST', data: credentials });
  const member = { cookie: loggedIn.cookie, csrf: loggedIn.body.csrfToken };
  assert.equal(loggedIn.body.permissions.tecnologia, 'edit');
  assert.deepEqual(loggedIn.body.capabilities.tecnologia, {
    workItemRead: true, workItemCreate: true, workItemUpdate: false,
    sectorTalkRead: true, sectorTalkSend: true, whatsappRead: true, whatsappReply: true, whatsappTicketUpdate: true
  });

  const requestItem = (access, item) => request(url, `${path}/work-items`, { method: 'POST', ...access, data: item });
  const company = await request(url, `${path}/companies`, { method: 'POST', ...admin, data: { cnpj: CNPJ_A, name: 'Empresa A' } });
  assert.equal(company.status, 201);
  const otherItem = await requestItem(admin, { module: 'tecnologia', companyCnpj: CNPJ_A, title: 'Demanda da empresa' });
  assert.equal(otherItem.status, 201);
  const internal = await requestItem(member, { module: 'tecnologia', title: 'Atualizar estações', companyCnpj: null });
  assert.equal(internal.status, 201);
  assert.equal(internal.body.item.companyCnpj, null);
  assert.equal((await requestItem(member, { module: 'tecnologia', title: 'Demanda sem acesso', companyCnpj: CNPJ_A })).status, 403);
  const memberItems = await request(url, `${path}/work-items?module=tecnologia`, member);
  assert.deepEqual(memberItems.body.items.map(item => item.id), [internal.body.item.id]);
  const itemPath = `${path}/work-items/${internal.body.item.id}`;
  const complete = { method: 'PATCH', data: { status: 'done' } };
  assert.equal((await request(url, itemPath, { ...complete, ...member })).status, 403);
  assert.equal((await request(url, itemPath, { ...complete, ...admin })).status, 200);
  assert.equal((await request(url, `${path}/fiscal/documents`, member)).status, 403);
  assert.equal((await request(url, `${path}/dashboard`, member)).body.metrics.documents, null);

  const userPath = `${path}/users/${person.body.user.id}`;
  const edited = await request(url, userPath, { method: 'PATCH', ...admin, data: { moduleGrants: { tecnologia: { level: 'manage', blockedActions: ['workItemRead', 'sectorTalkRead', 'whatsappRead'] } } } });
  assert.equal(edited.status, 200);
  const refreshed = await request(url, `${path}/session`, member);
  assert.deepEqual(refreshed.body.capabilities.tecnologia, {
    workItemRead: false, workItemCreate: false, workItemUpdate: false,
    sectorTalkRead: false, sectorTalkSend: false, whatsappRead: false, whatsappReply: false, whatsappTicketUpdate: false
  });
  assert.equal((await request(url, `${path}/work-items?module=tecnologia`, member)).status, 403);
  assert.deepEqual((await request(url, `${path}/work-items`, member)).body.items, []);
  assert.equal((await requestItem(member, { module: 'tecnologia', title: 'Bloqueada' })).status, 403);
  assert.equal((await request(url, itemPath, { ...complete, ...member })).status, 403);
  const invalid = await request(url, userPath, { method: 'PATCH', ...admin, data: { moduleGrants: { tecnologia: { level: 'edit', blockedActions: ['fiscalDocumentsRead'] } } } });
  assert.equal(invalid.status, 400);
}));

test('token do agente é exibido uma vez e documentos não expõem XML', async () => fixture(async ({ store, url }) => {
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
  store.documents.set(id, { _id: id, companyCnpj: CNPJ_A, source: 'NFE', nsu: '1', documentKey: '1234', receivedAt: new Date() });
  const fiscal = await request(url, '/v1/platform/fiscal/documents', { cookie: admin.cookie });
  assert.equal(fiscal.body.documents.length, 1);
  assert.equal(JSON.stringify(fiscal.body).includes('xml'), false);
  assert.equal((await request(url, `/v1/platform/fiscal/documents/${encodeURIComponent(id)}/xml`, { cookie: admin.cookie })).status, 404);
}));

test('troca senha e limita tentativas de login no armazenamento', async () => fixture(async ({ url }) => {
  const admin = await setup(url);
  for (let i = 0; i < 5; i++) assert.equal((await request(url, '/v1/platform/login', { method: 'POST', data: { email: admin.user.email, password: 'errada' } })).status, 401);
  assert.equal((await request(url, '/v1/platform/login', { method: 'POST', data: { email: admin.user.email, password: 'senha-longa-aleatoria-123' } })).status, 429);
  const changed = await request(url, '/v1/platform/change-password', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { currentPassword: 'senha-longa-aleatoria-123', newPassword: 'nova-senha-longa-456' } });
  assert.equal(changed.status, 200);
}));

test('Fiscal isola dados de NFS-e por empresa, filtra competência e respeita acesso ao módulo', async () => fixture(async ({ store, url }) => {
  const admin = await setup(url);
  assert.equal((await request(url, '/v1/platform/companies', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { cnpj: '12345678000190', name: 'CNPJ errado' } })).status, 400);
  for (const cnpj of [CNPJ_A, CNPJ_B]) await request(url, '/v1/platform/companies', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { cnpj, name: cnpj } });
  const reader = await request(url, '/v1/platform/users', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { name: 'Fiscal A', email: 'fiscal@maximumcontabil.com.br', password: 'senha-fiscal-longa-789', role: 'member', companyCnpjs: [CNPJ_A], moduleGrants: { fiscal: 'view' } } });
  assert.equal(reader.status, 201);
  const login = await request(url, '/v1/platform/login', { method: 'POST', data: { email: 'fiscal@maximumcontabil.com.br', password: 'senha-fiscal-longa-789' } });
  const cookie = login.cookie;
  const notes = [
    { companyCnpj: CNPJ_A, source: 'NFSE', nsu: '1', documentKey: 'A'.repeat(50), role: 'issued', status: 'active', competence: '2026-09', amountCents: '12500', issuedAt: '2026-09-10T12:00:00Z' },
    { companyCnpj: CNPJ_A, source: 'NFSE', nsu: '2', documentKey: 'B'.repeat(50), role: 'received', status: 'cancelled', competence: '2026-10', amountCents: '9900', issuedAt: '2026-10-10T12:00:00Z' },
    { companyCnpj: CNPJ_B, source: 'NFSE', nsu: '1', documentKey: 'C'.repeat(50), role: 'issued', status: 'active', competence: '2026-09', amountCents: '500000', issuedAt: '2026-09-10T12:00:00Z' },
  ];
  notes.forEach(note => store.documents.set(`${note.companyCnpj}:${note.nsu}`, { _id: `${note.companyCnpj}:${note.nsu}`, ...note, receivedAt: new Date() }));
  const listed = await request(url, '/v1/platform/fiscal/documents', { cookie });
  assert.deepEqual(listed.body.documents.map(x => x.companyCnpj), [CNPJ_A, CNPJ_A]);
  const query = await request(url, `/v1/platform/companies/${CNPJ_A}/nfse?month=2026-09&role=issued&status=active&page=1&limit=50`, { cookie });
  assert.equal(query.status, 200);
  assert.deepEqual(query.body.documents.map(x => x.documentKey), ['A'.repeat(50)]);
  const cancelled = await request(url, `/v1/platform/companies/${CNPJ_A}/nfse?status=cancelled`, { cookie });
  assert.deepEqual(cancelled.body.documents.map(x => x.documentKey), ['B'.repeat(50)]);
  const summary = await request(url, `/v1/platform/companies/${CNPJ_A}/nfse/summary?from=2026-09&to=2026-10`, { cookie });
  assert.equal(summary.body.summary.issuedCount, 1);
  assert.equal(summary.body.summary.receivedCount, 1);
  assert.equal(summary.body.summary.cancelledCount, 1);
  assert.equal(summary.body.summary.receivedActiveAmountCents, '0');
  assert.deepEqual(summary.body.byMonth.map(x => x.month), ['2026-09', '2026-10']);
  const coverage = await request(url, `/v1/platform/companies/${CNPJ_A}/nfse/coverage`, { cookie });
  assert.equal(coverage.body.status, 'received');
  assert.equal((await request(url, `/v1/platform/companies/${CNPJ_B}/nfse`, { cookie })).status, 403);
  assert.equal((await request(url, `/v1/platform/companies/${CNPJ_B}/nfse/summary?from=2026-09&to=2026-10`, { cookie })).status, 403);
  assert.equal((await request(url, `/v1/platform/companies/${CNPJ_B}/nfse/coverage`, { cookie })).status, 403);
  assert.equal((await request(url, `/v1/platform/companies/${CNPJ_A}/nfse?month=2026-13`, { cookie })).status, 400);
  assert.equal((await request(url, `/v1/platform/companies/${CNPJ_A}/nfse?status=invalid`, { cookie })).status, 400);
  const dpMember = await request(url, '/v1/platform/users', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, data: { name: 'Pessoa DP', email: 'dp2@maximumcontabil.com.br', password: 'senha-dp-12234567890', role: 'member', companyCnpjs: [CNPJ_A], moduleGrants: { dp: 'view' } } });
  assert.equal(dpMember.status, 201);
  const dpLogin = await request(url, '/v1/platform/login', { method: 'POST', data: { email: 'dp2@maximumcontabil.com.br', password: 'senha-dp-12234567890' } });
  assert.equal((await request(url, `/v1/platform/companies/${CNPJ_A}/nfse`, { cookie: dpLogin.cookie })).status, 403);
}));

test('cadastro e carteira de uma empresa exigem administração e preservam o acesso fiscal autorizado', async () => fixture(async ({ store, url }) => {
  const admin = await setup(url);
  const customerPath = `/v1/platform/companies/${CNPJ_A}`;
  const credentials = { email: 'fiscal-carteira@example.test', password: 'senha-fiscal-carteira-789' };
  for (const cnpj of [CNPJ_A, CNPJ_B]) {
    assert.equal((await request(url, '/v1/platform/companies', { method: 'POST', ...admin, data: { cnpj, name: 'Empresa original' } })).status, 201);
  }
  const created = await request(url, '/v1/platform/users', { method: 'POST', ...admin, data: {
    ...credentials, name: 'Analista Fiscal', role: 'member', companyCnpjs: [CNPJ_B], moduleGrants: { fiscal: 'view' },
  } });
  assert.equal(created.status, 201);
  const id = created.body.user.id;
  const member = { cookie: (await request(url, '/v1/platform/login', { method: 'POST', data: credentials })).cookie };
  member.csrf = (await request(url, '/v1/platform/session', member)).body.csrfToken;
  const grantPath = `${customerPath}/access/${id}`;

  assert.equal((await request(url, customerPath)).status, 401);
  assert.equal((await request(url, customerPath, member)).status, 403);
  assert.equal((await request(url, customerPath, { method: 'PATCH', ...member, data: { name: 'Nome indevido' } })).status, 403);
  assert.equal((await request(url, grantPath, { method: 'PATCH', ...member, data: { hasAccess: true } })).status, 403);
  assert.equal((await request(url, `${customerPath}/nfse`, member)).status, 403);

  const detail = await request(url, customerPath, admin);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.members, [{ id, name: 'Analista Fiscal', email: credentials.email, active: true, hasAccess: false }]);
  const edited = await request(url, customerPath, { method: 'PATCH', ...admin, data: { name: 'Cliente atualizado', active: false } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.company.name, 'Cliente atualizado');
  assert.equal((await request(url, customerPath, admin)).body.company.active, false);
  assert.equal((await request(url, `${customerPath}/access/${admin.user.id}`, { method: 'PATCH', ...admin, data: { hasAccess: false } })).status, 409);

  const grant = hasAccess => request(url, grantPath, { method: 'PATCH', ...admin, data: { hasAccess } });
  assert.deepEqual((await grant(true)).body, { hasAccess: true });
  assert.deepEqual((await grant(true)).body, { hasAccess: true });
  assert.equal((await request(url, customerPath, member)).status, 403);
  assert.equal((await request(url, `${customerPath}/nfse`, member)).status, 200);
  assert.deepEqual((await store.findUserById(id)).companyCnpjs, [CNPJ_B, CNPJ_A]);
  assert.deepEqual((await store.findUserById(id)).moduleGrants, { fiscal: 'view' });
  assert.deepEqual((await grant(false)).body, { hasAccess: false });
  assert.equal((await request(url, `${customerPath}/nfse`, member)).status, 403);
  assert.deepEqual((await store.findUserById(id)).companyCnpjs, [CNPJ_B]);
  assert.deepEqual(store.auditEntries.filter(entry => entry.action.startsWith('company.')).map(entry => entry.action),
    ['company.update', 'company.access.grant', 'company.access.revoke']);
}));
