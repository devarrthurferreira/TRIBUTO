import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createPlatformRouter } from '../src/platform/routes.mjs';
import { INTERNAL_WORK_ITEM_MODULES, canPerform, canAccessWorkItemCompany, hasLoginCredentials } from '../src/platform/policy.mjs';
import { completedTenureYears } from '../src/platform/employment.mjs';
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
    if (account.email && users.some(({ email }) => email === account.email)) throw Object.assign(new Error('DUPLICATE_USER_EMAIL'), { code: 'DUPLICATE_USER_EMAIL' });
    if (profile?.cpf && [...this.profiles.values()].some(({ cpf }) => cpf === profile.cpf)) {
      throw Object.assign(new Error('DUPLICATE_USER_CPF'), { code: 'DUPLICATE_USER_CPF' });
    }
    let username = base;
    for (let attempt = 2; username && users.some((other) => other.username === username); attempt += 1) username = `${base}${attempt}`;
    this.users.set(user._id, { ...account, username, admissionDate: profile?.admissionDate ?? null,
      tenureYears: completedTenureYears(profile?.admissionDate) });
    if (profile) this.profiles.set(user._id, profile);
    return username;
  }
  async updateUser(id, changes) {
    const previous = this.users.get(id);
    const value = { ...previous, ...changes };
    if ((changes.email || changes.passwordHash) && hasLoginCredentials(previous)) {
      throw Object.assign(new Error('USER_ACCESS_ALREADY_READY'), { code: 'USER_ACCESS_ALREADY_READY' });
    }
    if (changes.email && [...this.users.values()].some(user => user._id !== id && user.email === changes.email)) {
      throw Object.assign(new Error('DUPLICATE_USER_EMAIL'), { code: 'DUPLICATE_USER_EMAIL' });
    }
    if (value.active && !hasLoginCredentials(value)) throw Object.assign(new Error('USER_ACCESS_PENDING'), { code: 'USER_ACCESS_PENDING' });
    this.users.set(id, value);
    if (Object.hasOwn(changes, 'admissionDate')) {
      value.tenureYears = completedTenureYears(value.admissionDate);
      const profile = { ...this.profiles.get(id) };
      if (changes.admissionDate === null) delete profile.admissionDate;
      else profile.admissionDate = changes.admissionDate;
      this.profiles.set(id, profile);
    }
    if (changes.passwordHash) for (const [key, session] of this.sessions) if (session.userId === id) this.sessions.delete(key);
    return value;
  }
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
  async listWorkItems({ modules, companyCnpjs, module, companyCnpj, limit = 500, offset = 0 }) {
    return [...this.items.values()].filter(item =>
      (module ? item.module === module : modules.includes(item.module)) &&
      (companyCnpjs === null || companyCnpjs.includes(item.companyCnpj) || INTERNAL_WORK_ITEM_MODULES.includes(item.module) && item.companyCnpj === null) &&
      (!companyCnpj || item.companyCnpj === companyCnpj))
      .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt) || right._id.localeCompare(left._id))
      .slice(offset, offset + limit);
  }
  async getWorkItem(id) { return this.items.get(id); }
  async listWorkItemHistory(id) {
    return this.auditEntries.filter(event => event.subject === id && event.action.startsWith('work_item.')).slice(-30).reverse().map(event => ({
      action: event.action.split('.')[1], at: event.at, actorName: this.users.get(event.actorId)?.name || 'Usuário indisponível',
      fields: event.detail.fields || [], ...(event.detail.status ? { status: event.detail.status } : {})
    }));
  }
  async createWorkItem(item) {
    this.items.set(item._id, item);
    if (item.module === 'marketing') await this.audit('work_item.create', item.createdBy, item._id, { status: item.status });
  }
  async updateWorkItem(id, changes, { expected, actorId } = {}) {
    const previous = this.items.get(id);
    if (!previous || expected && (previous.updatedAt !== expected.updatedAt || previous.companyCnpj !== expected.companyCnpj || previous.assigneeId !== expected.assigneeId)) return null;
    const updatedAt = new Date(Math.max(Date.now(), new Date(previous.updatedAt).getTime() + 1));
    const value = { ...previous, ...changes, updatedAt };
    if (value.module === 'marketing') value.completedAt = value.status !== 'done' ? null : previous.status === 'done' ? previous.completedAt : updatedAt;
    this.items.set(id, value);
    if (value.module === 'marketing') await this.audit('work_item.update', actorId, id, { fields: Object.keys(changes), status: changes.status });
    return value;
  }
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
  async audit(action, actorId, subject, detail = {}) { this.auditEntries.push({ action, actorId, subject, detail, at: new Date() }); }
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

test('admissão conta aniversários completos em São Paulo, inclusive no ano bissexto', () => {
  assert.equal(completedTenureYears('2018-11-26', new Date('2026-11-26T02:59:59Z')), 7);
  assert.equal(completedTenureYears('2018-11-26', new Date('2026-11-26T03:00:00Z')), 8);
  assert.equal(completedTenureYears('2020-02-29', new Date('2025-02-28T22:00:00Z')), 4);
  assert.equal(completedTenureYears('2020-02-29', new Date('2025-03-01T03:00:00Z')), 5);
  assert.equal(completedTenureYears(null), 0);
  assert.equal(completedTenureYears('2099-01-01'), 0);
});

test('admissão é opcional e pode ser corrigida somente na administração de acessos', async () => fixture(async ({ url }) => {
  const path = '/v1/platform';
  const admin = await setup(url);
  const create = profile => request(url, `${path}/users`, {
    ...admin, method: 'POST', data: { profile, email: 'pessoa@example.test', password: 'Senha-sintetica-forte' },
  });
  for (const admissionDate of ['2020-02-30', '2999-01-01', '1899-01-01', false]) {
    assert.equal((await create({ admissionDate })).status, 400);
  }
  const created = await create({ firstName: 'Pessoa', admissionDate: '2018-02-28' });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.admissionDate, '2018-02-28');
  const account = `${path}/users/${created.body.user.id}`;
  const detail = await request(url, account, admin);
  assert.equal(detail.body.profile.admissionDate, '2018-02-28');

  const login = await request(url, `${path}/login`, {
    method: 'POST', data: { email: 'pessoa@example.test', password: 'Senha-sintetica-forte' },
  });
  const member = { cookie: login.cookie, csrf: login.body.csrfToken };
  assert.equal(login.body.user.tenureYears, completedTenureYears('2018-02-28'));
  assert.equal(login.body.user.admissionDate, undefined);
  const update = (data, auth) => request(url, account, { ...auth, method: 'PATCH', data });
  assert.equal((await update({ admissionDate: '2017-01-01' }, member)).status, 403);
  assert.equal((await update({ admissionDate: '2019-02-29' }, admin)).status, 400);
  assert.equal((await update({ admissionDate: '2020-02-29' }, admin)).body.user.admissionDate, '2020-02-29');
  assert.equal((await request(url, `${path}/session`, member)).body.user.tenureYears, completedTenureYears('2020-02-29'));
  assert.equal((await update({ admissionDate: null }, admin)).body.user.admissionDate, null);
  assert.equal((await request(url, account, admin)).body.profile.admissionDate, undefined);
  assert.equal((await request(url, `${path}/session`, member)).body.user.tenureYears, 0);
}));

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

test('cadastro opcional salva fichas incompletas e libera o login após configurar o acesso', async () => fixture(async ({ url }) => {
  const path = '/v1/platform';
  const admin = await setup(url);
  const addUser = (data) => request(url, `${path}/users`, { method: 'POST', ...admin, data });
  const patchUser = (id, data, auth = admin) => request(url, `${path}/users/${id}`, { method: 'PATCH', ...auth, data });
  const login = (identifier, password) => request(url, `${path}/login`, { method: 'POST', data: { identifier, password } });
  const password = 'Senha-sintetica-igual-19';
  const first = await addUser({});
  const second = await addUser({ email: ' ', password: '', role: '', companyCnpjs: null, moduleGrants: null,
    profile: { firstName: '', lastName: null, cpf: '', birthDate: null, email: '', phone: null, address: { cep: '' } } });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.body.user.id, second.body.user.id);
  for (const { body: { user } } of [first, second]) {
    assert.equal(user.name, 'Usuário sem nome');
    assert.equal(user.email, null);
    assert.equal(user.username, undefined);
    assert.equal(user.passwordHash, undefined);
    assert.equal(user.role, 'member');
    assert.equal(user.accessPending, true);
    assert.equal(user.active, false);
    assert.deepEqual(user.companyCnpjs, []);
    assert.deepEqual(user.moduleGrants, {});
  }

  for (const profile of [{ cpf: '000.000.000-00' }, { birthDate: '2020-02-30' }, { address: { cep: '123' } }]) {
    assert.equal((await addUser({ profile })).status, 400);
  }
  assert.equal((await addUser({ password: 'curta' })).status, 400);
  const partial = await addUser({ profile: { firstName: 'Ana', hasChildren: true, address: { neighborhood: 'Centro' } } });
  assert.equal(partial.status, 201);
  assert.equal(partial.body.user.name, 'Ana');
  const detail = await request(url, `${path}/users/${partial.body.user.id}`, admin);
  assert.equal(detail.body.profile.hasChildren, true);
  assert.equal(detail.body.profile.childrenCount, null);
  assert.equal(detail.body.profile.address.neighborhood, 'Centro');
  assert.equal(detail.body.profile.address.cep, null);
  const localName = await addUser({ profile: { firstName: '王', lastName: '小明' }, email: 'email@example.test', password });
  assert.equal(localName.status, 201);
  assert.equal(localName.body.user.username, undefined);
  assert.equal(localName.body.user.name, '王 小明');
  assert.equal(localName.body.user.active, true);
  assert.equal((await login('email@example.test', password)).status, 200);
  const usernameOnly = await addUser({ profile: { firstName: 'João', lastName: 'Lima', email: 'pessoal@example.test' }, password });
  assert.equal(usernameOnly.status, 201);
  assert.equal(usernameOnly.body.user.email, null);
  assert.equal(usernameOnly.body.user.username, 'joao.lima');
  assert.equal(usernameOnly.body.user.accessPending, false);
  assert.equal((await login('joao.lima', password)).status, 200);
  assert.equal((await login('pessoal@example.test', password)).status, 401);

  const pending = await addUser({ email: 'pendente@example.test' });
  assert.equal(pending.status, 201);
  const id = pending.body.user.id;
  assert.equal((await login('pendente@example.test', '')).status, 400);
  assert.equal((await login('pendente@example.test', password)).status, 401);
  assert.equal((await patchUser(id, { active: true })).body.error, 'USER_ACCESS_PENDING');
  const memberLogin = await login('joao.lima', password);
  assert.equal((await patchUser(id, { active: true, password }, { cookie: memberLogin.cookie, csrf: memberLogin.body.csrfToken })).status, 403);
  const ready = await patchUser(id, { password });
  assert.equal(ready.status, 200);
  assert.equal(ready.body.user.accessPending, false);
  assert.equal(ready.body.user.active, false);
  assert.equal((await login('pendente@example.test', password)).status, 401);
  assert.equal((await patchUser(id, { active: true })).status, 200);
  assert.equal((await login('pendente@example.test', password)).status, 200);
  assert.equal((await patchUser(id, { email: 'outro@example.test' })).body.error, 'USER_ACCESS_ALREADY_READY');
  assert.equal((await patchUser(id, { password })).body.error, 'USER_ACCESS_ALREADY_READY');

  const firstId = first.body.user.id;
  assert.equal((await patchUser(firstId, { email: 'email@example.test' })).body.error, 'DUPLICATE_USER_EMAIL');
  assert.equal((await patchUser(firstId, { email: 'novo@example.test', password, active: true })).status, 200);
  assert.equal((await login('novo@example.test', password)).status, 200);
  const list = await request(url, `${path}/users`, admin);
  assert.equal(list.body.users.find(({ id }) => id === second.body.user.id).accessPending, true);
  assert.equal(list.body.users.find(({ id }) => id === firstId).accessPending, false);
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
    ['dp', 'rh', 'tecnologia', 'marketing', 'sucesso-do-cliente', 'societario', 'contabil', 'fiscal', 'diretoria']);

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

test('tarefas de Marketing mantêm checklist, histórico, conclusão e escopo da carteira', async () => fixture(async ({ store, url }) => {
  const platform = '/v1/platform';
  const admin = await setup(url);
  for (const company of [CNPJ_A, CNPJ_B]) {
    assert.equal((await request(url, `${platform}/companies`, { method: 'POST', ...admin, data: { cnpj: company, name: company } })).status, 201);
  }
  async function member(name, moduleGrants, companyCnpjs, admissionDate) {
    const credentials = { email: `${name.toLowerCase()}@example.test`, password: 'senha-exemplo-longa-123' };
    const created = await request(url, `${platform}/users`, { method: 'POST', ...admin,
      data: { ...credentials, name, role: 'member', moduleGrants, companyCnpjs, profile: { admissionDate } } });
    assert.equal(created.status, 201);
    const login = await request(url, `${platform}/login`, { method: 'POST', data: credentials });
    assert.equal(login.status, 200);
    return { id: created.body.user.id, cookie: login.cookie, csrf: login.body.csrfToken };
  }
  const editor = await member('Editora', { marketing: 'edit' }, [CNPJ_A], '2018-03-02');
  const reader = await member('Leitora', { marketing: 'view' }, []);
  const outsider = await member('Outro', { tecnologia: 'edit' }, [CNPJ_A, CNPJ_B]);
  const list = access => request(url, `${platform}/work-items?module=marketing`, access);
  const create = (access, data) => request(url, `${platform}/work-items`, { method: 'POST', ...access, data: { module: 'marketing', ...data } });
  const edit = (access, id, data) => request(url, `${platform}/work-items/${id}`, { method: 'PATCH', ...access, data });
  const details = (access, id) => request(url, `${platform}/work-items/${id}`, access);

  const input = { title: 'Publicar conteúdo', description: 'Briefing privado', priority: 'urgent', campaign: 'Campanha de novembro',
    tags: ['Stories', 'Social'], checklist: [{ title: 'Aprovar arte', done: false }], referenceUrl: 'https://example.test/briefing',
    socialChannel: 'maximum-contabil', desiredReach: 850, estimatedReach: 0 };
  assert.equal((await create(reader, input)).status, 403);
  assert.equal((await list(outsider)).status, 403);
  assert.equal((await create(editor, { ...input, referenceUrl: 'javascript:void(0)' })).status, 400);
  assert.equal((await create(editor, { ...input, tags: ['Social', 'social'] })).status, 400);
  assert.equal((await create(editor, { ...input, socialChannel: 'invalid' })).status, 400);
  assert.equal((await create(editor, { ...input, desiredReach: -1 })).status, 400);
  assert.equal((await create(editor, { ...input, estimatedReach: 1_000_000_000 })).status, 400);
  assert.equal((await create(editor, { ...input, companyCnpj: CNPJ_B })).status, 403);
  assert.equal((await create(editor, { ...input, companyCnpj: CNPJ_A, assigneeId: reader.id })).body.error, 'UNKNOWN_ASSIGNEE');
  assert.equal((await create(editor, { ...input, assigneeId: outsider.id })).body.error, 'UNKNOWN_ASSIGNEE');
  const created = await create(editor, { ...input, assigneeId: editor.id });
  assert.equal(created.status, 201);
  const task = created.body.item;
  assert.equal(task.companyCnpj, null);
  assert.equal(task.completedAt, null);
  assert.equal(task.priority, 'urgent');
  assert.equal(task.socialChannel, 'maximum-contabil');
  assert.equal(task.desiredReach, 850);
  assert.equal(task.estimatedReach, 0);
  assert.ok(task.checklist[0].id);
  assert.deepEqual((await list(reader)).body.items.map(item => item.id), [task.id]);
  const choices = (await list(reader)).body.assignees;
  assert.deepEqual(choices.map(({ name }) => name).sort(), ['Arthur', 'Editora', 'Leitora']);
  assert.ok(choices.every(choice => Object.keys(choice).sort().join(',') === 'id,name,tenureYears'));
  assert.equal(choices.find(choice => choice.id === editor.id).tenureYears, completedTenureYears('2018-03-02'));

  const finished = await edit(editor, task.id, { status: 'done', checklist: [{ ...task.checklist[0], done: true }], expectedUpdatedAt: task.updatedAt });
  assert.equal(finished.status, 200);
  const completed = finished.body.item;
  assert.ok(completed.completedAt);
  assert.equal(completed.checklist[0].done, true);
  assert.equal(completed.desiredReach, 850);
  assert.equal((await edit(editor, task.id, { campaign: 'Tentativa antiga', expectedUpdatedAt: task.updatedAt })).status, 409);
  const retagged = await edit(editor, task.id, { tags: ['Edição'] });
  assert.equal(retagged.body.item.completedAt, completed.completedAt);
  assert.equal((await edit(reader, task.id, { title: 'Tentativa sem acesso' })).status, 403);
  assert.equal((await edit(editor, task.id, { companyCnpj: CNPJ_A, status: 'in_progress' })).status, 403);
  const linked = await edit(admin, task.id, { companyCnpj: CNPJ_A, status: 'in_progress' });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.item.completedAt, null);
  assert.equal(linked.body.item.companyCnpj, CNPJ_A);
  assert.equal((await details(reader, task.id)).status, 404);
  assert.equal((await edit(editor, task.id, { companyCnpj: null })).status, 403);
  assert.equal((await edit(editor, task.id, { companyCnpj: CNPJ_B })).status, 403);
  const record = (await details(editor, task.id)).body;
  assert.deepEqual(record.history.map(({ action }) => action), ['update', 'update', 'update', 'create']);
  assert.equal(record.history[0].actorName, 'Arthur');
  assert.deepEqual(record.history[0].fields.sort(), ['companyCnpj', 'status']);
  assert.equal(JSON.stringify(record.history).includes('Briefing privado'), false);

  const cleared = (await edit(editor, task.id, { socialChannel: '', desiredReach: null, estimatedReach: null })).body.item;
  assert.equal(cleared.socialChannel, '');
  assert.equal(cleared.desiredReach, null);
  assert.equal(cleared.estimatedReach, null);

  const imported = await create(editor, { title: 'Tarefa concluída cadastrada', status: 'done' });
  assert.ok(imported.body.item.completedAt);
  const oldTimestamp = new Date('2025-01-01T12:00:00.000Z');
  for (let i = 0; i < 100; i++) {
    const id = randomUUID();
    store.items.set(id, { ...task, _id: id, title: `Tarefa antiga ${i}`, priority: undefined,
      socialChannel: undefined, desiredReach: undefined, estimatedReach: undefined,
      status: 'done', createdAt: oldTimestamp, updatedAt: oldTimestamp });
  }
  const first = (await list(editor)).body;
  const second = (await request(url, `${platform}/work-items?module=marketing&page=2`, editor)).body;
  assert.equal(first.items.length, 100);
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 2);
  assert.equal(second.hasMore, false);
  assert.equal(second.items[0].priority, 'normal');
  assert.equal(second.items[0].completedAt, null);
  assert.equal(second.items[0].socialChannel, '');
  assert.equal(second.items[0].desiredReach, null);
  assert.equal(second.assignees, undefined);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 102);
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
    profile: { admissionDate: '2015-10-30' },
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
  assert.deepEqual(detail.body.members, [{ id, name: 'Analista Fiscal', email: credentials.email, active: true, hasAccess: false,
    tenureYears: completedTenureYears('2015-10-30') }]);
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
