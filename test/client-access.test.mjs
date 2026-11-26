import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { ApiError, sha256 } from '../src/api/validation.mjs';
import { createClientAccessAdminRouter, createClientPortalRouter, normalizeClientUsername } from '../src/clients/access-routes.mjs';
import { clientAccessView, prepareClientActivation } from '../src/clients/access-store.mjs';

const client = { id: randomUUID(), name: 'Cliente piloto', document: '12ABC34501DE35', active: true };
const admin = { _id: randomUUID(), role: 'admin' };

class MemoryAccess {
  attempts = new Map();
  sessions = new Map();
  account = null;

  async getAccount() { return this.account && { ...this.account }; }
  async getSession(id, now) {
    const value = this.sessions.get(id);
    return value?.expiresAt > now ? value : null;
  }
  async reserveAttempt(key) {
    const count = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, count);
    return count;
  }
  async clearAttempts(key) { this.attempts.delete(key); }
  async deleteSession(id) { this.sessions.delete(id); }
  async reset(record, activation) {
    this.sessions.clear();
    this.account = {
      clientId: record.id, status: 'activation_pending', activationHash: activation.hash,
      activationUsedAt: null, activationExpiresAt: activation.expiresAt.toISOString(), passwordHash: null,
    };
    return clientAccessView(this.account, record.document);
  }
  async revoke(record) {
    this.sessions.clear();
    this.account = { clientId: record.id, status: 'revoked' };
    return clientAccessView(this.account, record.document);
  }
  async startSession(account, session, now) {
    if (!this.account || this.account.status !== account.status || this.account.passwordHash !== account.passwordHash) return false;
    if (session.purpose === 'activation') {
      if (this.account.activationUsedAt || this.account.activationHash !== account.activationHash) return false;
      this.account.activationUsedAt = now.toISOString();
      this.account.activationExpiresAt = session.expiresAt.toISOString();
    } else this.account.lastLoginAt = now.toISOString();
    this.sessions.set(session.id, { ...session, clientId: account.clientId });
    return true;
  }
  async completePassword(account, session, passwordHash, now) {
    if (!this.sessions.has(session.id) || this.account.status !== account.status) return false;
    this.sessions.clear();
    this.account = { clientId: account.clientId, passwordHash, status: 'active', passwordChangedAt: now.toISOString() };
    return true;
  }
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
  return true;
}

async function harness(t, secureCookies = false) {
  const accessStore = new MemoryAccess();
  const clientStore = { async get(key) { return [client.id, client.document].includes(key) ? client : null; } };
  let currentTime = Date.now();
  const portal = createClientPortalRouter({ accessStore, clientStore, secureCookies, clock: () => currentTime });
  const internal = createClientAccessAdminRouter({ accessStore, clientStore });
  const server = http.createServer(async (req, res) => {
    try {
      if (await portal(req, res, req.url)) return;
      const user = req.headers['test-admin'] === '1' ? admin : { role: 'member' };
      if (await internal.handleHttp({
        req, res, route: req.url, user, send,
        requireAdmin(actor) { if (actor.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Restrito'); },
      }) !== false) return;
      send(res, 404, {});
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      send(res, error.status, { error: error.code, message: error.message });
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return {
    advance(ms) { currentTime += ms; },
    async request(path, { method = 'GET', body, headers = {} } = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const cookie = response.headers.get('set-cookie');
      return { status: response.status, cookie, data: await response.json() };
    },
  };
}

test('CPF e CNPJ alfanumérico aceitam somente o documento ou a máscara convencional', () => {
  assert.equal(normalizeClientUsername(' 12.Abc.345/01de-35 '), client.document);
  assert.equal(normalizeClientUsername('529.982.247-25'), '52998224725');
  assert.equal(normalizeClientUsername('-52998224725'), null);
  assert.equal(normalizeClientUsername('12abc34501deAB'), null);
  assert.equal(normalizeClientUsername('12abc34501de35x'), null);
  assert.equal(prepareClientActivation(0).expiresAt.valueOf(), 86_400_000);
});

test('primeiro acesso é de uso único, exige redefinição e revoga credenciais anteriores', async t => {
  const { request } = await harness(t, true);
  const path = `/clients/${client.id}/access`;
  const testAdmin = { 'test-admin': '1' };
  assert.equal((await request(path)).status, 403);
  assert.equal((await request(path, { headers: testAdmin })).data.access.status, 'unconfigured');
  const issued = (await request(`${path}/reset`, { method: 'POST', headers: testAdmin })).data;
  assert.equal(issued.access.status, 'activation_pending');
  assert.match(issued.activationCode, /^[A-Za-z0-9_-]{24}$/);
  assert.equal((await request(path, { headers: testAdmin })).data.activationCode, undefined);
  const login = body => request('/v1/client/login', { method: 'POST', body });
  const credentials = { username: client.document.toLowerCase(), password: issued.activationCode };
  const first = await login(credentials);
  assert.equal(first.status, 200);
  assert.equal(first.data.mustChangePassword, true);
  assert.match(first.cookie, /^__Secure-maximumClient=[a-f0-9]{64}; Path=\/v1\/client; HttpOnly; SameSite=Strict; Max-Age=1200; Secure$/);
  assert.equal((await login(credentials)).status, 401);
  assert.equal((await request(path, { headers: testAdmin })).data.access.status, 'activation_in_progress');
  const firstCookie = first.cookie.split(';')[0];
  const clientHeaders = { cookie: firstCookie, 'x-csrf-token': first.data.csrfToken };
  const privatePassword = 'uma frase fácil de lembrar 123';
  const change = (newPassword, headers) => request('/v1/client/change-password', { method: 'POST', body: { newPassword }, headers });
  assert.equal((await change(privatePassword, { cookie: firstCookie })).status, 403);
  assert.equal((await change(privatePassword, { ...clientHeaders, 'sec-fetch-site': 'same-site' })).status, 403);
  assert.equal((await change(issued.activationCode, clientHeaders)).data.error, 'PASSWORD_REUSE');
  assert.equal((await change('12.ABC.345/01DE-35', clientHeaders)).data.error, 'PASSWORD_REUSE');
  assert.equal((await change(privatePassword, clientHeaders)).status, 200);
  assert.equal((await request('/v1/client/session', { headers: clientHeaders })).data.client, null);
  const status = (await request(path, { headers: testAdmin })).data.access;
  assert.equal(status.status, 'active');
  assert.ok(status.passwordChangedAt);
  assert.equal('passwordHash' in status, false);
  const active = await login({ ...credentials, password: privatePassword });
  assert.equal(active.data.mustChangePassword, false);
  assert.equal(active.data.client.id, client.id);
  const newer = (await request(`${path}/reset`, { method: 'POST', headers: testAdmin })).data;
  assert.notEqual(newer.activationCode, issued.activationCode);
  const activeCookie = active.cookie.split(';')[0];
  assert.equal((await request('/v1/client/session', { headers: { cookie: activeCookie } })).data.client, null);
  assert.equal((await login({ ...credentials, password: privatePassword })).status, 401);
  assert.equal((await request(path, { method: 'DELETE', headers: testAdmin })).data.access.status, 'revoked');
  assert.equal((await login({ ...credentials, password: newer.activationCode })).status, 401);
});

test('limita tentativas e trata código expirado como credencial inválida', async t => {
  const { request, advance } = await harness(t);
  const path = `/clients/${client.id}/access`;
  const headers = { 'test-admin': '1' };
  const issued = (await request(`${path}/reset`, { method: 'POST', headers })).data;
  advance(86_401_000);
  assert.equal(clientAccessView({ status: 'activation_pending', activationHash: sha256(issued.activationCode),
    activationExpiresAt: issued.access.activationExpiresAt }, client.document, Date.now() + 86_400_001).status, 'activation_expired');
  for (let attempt = 0; attempt < 6; attempt++) {
    const reply = await request('/v1/client/login', { method: 'POST', body: { username: client.document, password: issued.activationCode } });
    assert.equal(reply.status, attempt < 5 ? 401 : 429);
  }
});
