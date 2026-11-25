import { randomUUID } from 'node:crypto';
import { ApiError, sha256 } from '../api/validation.mjs';
import { hashPassword, verifyPassword, newSecret, safeEqualHex } from './auth.mjs';
import { MODULES, LEVELS, permissionsFor, canAccess, canAccessCompany, publicUser } from './policy.mjs';

const COOKIE = 'tributo_session';
const SESSION_MS = 12 * 60 * 60_000;
const SETUP_PASSWORD_MIN_LENGTH = 10;
const CNPJ = /^\d{14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NSU = /^(0|[1-9]\d{0,14})$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

function fail(status, code, message) { throw new ApiError(status, code, message); }
function check(condition, field) { if (!condition) fail(400, 'INVALID_INPUT', `Campo inválido: ${field}`); }
function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
  return true;
}
async function body(req) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) fail(415, 'CONTENT_TYPE', 'Use application/json');
  const parts = []; let length = 0;
  for await (const part of req) {
    length += part.length;
    if (length > 128_000) fail(413, 'BODY_TOO_LARGE', 'Corpo acima de 128 kB');
    parts.push(part);
  }
  try {
    const data = JSON.parse(Buffer.concat(parts).toString('utf8'));
    check(data && typeof data === 'object' && !Array.isArray(data), 'body');
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(400, 'INVALID_JSON', 'JSON inválido');
  }
}
function field(value, name, min = 1, max = 200) {
  check(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max, name);
  return value.trim();
}
function email(value) {
  const normalized = field(value, 'email', 4, 254).toLowerCase();
  check(EMAIL.test(normalized), 'email');
  return normalized;
}
function validCnpj(value) {
  if (typeof value !== 'string' || !CNPJ.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const checksum = (length, weights) => { const rest = digits.slice(0, length).reduce((sum, digit, index) => sum + digit * weights[index], 0) % 11; return rest < 2 ? 0 : 11 - rest; };
  return digits[12] === checksum(12, [5,4,3,2,9,8,7,6,5,4,3,2]) && digits[13] === checksum(13, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
}
function cnpj(value) { check(validCnpj(value), 'cnpj'); return value; }
function month(value, name) {
  if (value === null) return null;
  check(MONTH.test(value), name);
  return value;
}
function pageNumber(query, key, defaultValue, maximum) {
  const raw = query.get(key);
  if (raw === null) return defaultValue;
  check(/^[1-9]\d*$/.test(raw), key);
  const parsed = Number(raw);
  check(Number.isSafeInteger(parsed) && parsed <= maximum, key);
  return parsed;
}
function cookieValue(req) {
  const match = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`));
  const value = match?.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}
function cookieHeader(token, secure) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_MS / 1000 : 0}${secure ? '; Secure' : ''}`;
}
function requireAdmin(user) { if (user.role !== 'admin') fail(403, 'FORBIDDEN', 'Acesso restrito a administradores'); }
function requireCsrf(req, session) {
  const value = req.headers['x-csrf-token'];
  if (!safeEqualHex(sha256(typeof value === 'string' ? value : ''), sha256(session.csrfToken))) fail(403, 'CSRF', 'Token de proteção inválido');
}
function sessionView(user, session, setupRequired = false) {
  return { user: publicUser(user), permissions: permissionsFor(user), csrfToken: session?.csrfToken ?? null, setupRequired };
}
function validateAccess(input) {
  check(Array.isArray(input.companyCnpjs) && input.companyCnpjs.length <= 1000 && input.companyCnpjs.every(validCnpj) && new Set(input.companyCnpjs).size === input.companyCnpjs.length, 'companyCnpjs');
  check(input.moduleGrants && typeof input.moduleGrants === 'object' && !Array.isArray(input.moduleGrants), 'moduleGrants');
  for (const [module, level] of Object.entries(input.moduleGrants)) check(MODULES.some(x => x.id === module) && LEVELS.includes(level), `moduleGrants.${module}`);
  return { companyCnpjs: input.companyCnpjs, moduleGrants: input.moduleGrants };
}
function publicWorkItem(item) {
  return { id: item._id, module: item.module, companyCnpj: item.companyCnpj, title: item.title, description: item.description || '', status: item.status, dueAt: item.dueAt || null, assigneeId: item.assigneeId || null, createdBy: item.createdBy, createdAt: item.createdAt, updatedAt: item.updatedAt };
}
function dueAt(value) {
  if (value === null || value === '') return null;
  const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  check(parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, 'dueAt');
  return value;
}

export function createPlatformRouter({ store, bootstrapTokenSha256, secureCookies = true, logger = console }) {
  function loginKey(req, address) { return sha256(`${req.socket.remoteAddress || 'unknown'}:${address}`); }
  async function startSession(res, user) {
    const token = newSecret();
    const session = { _id: sha256(token), userId: user._id, csrfToken: newSecret(), expiresAt: new Date(Date.now() + SESSION_MS), createdAt: new Date() };
    await store.createSession(session);
    res.setHeader('set-cookie', cookieHeader(token, secureCookies));
    return sessionView(user, session);
  }
  async function current(req) {
    const token = cookieValue(req);
    if (!token) return null;
    const session = await store.findSession(sha256(token));
    if (!session) return null;
    const user = await store.findUserById(session.userId);
    return user?.active ? { user, session } : null;
  }
  return async function handlePlatform(req, res, pathname) {
    if (pathname !== '/v1/platform' && !pathname.startsWith('/v1/platform/')) return false;
    try {
      const route = pathname.slice('/v1/platform'.length);
      if (req.method === 'GET' && route === '/session') {
        const auth = await current(req);
        return send(res, 200, auth ? sessionView(auth.user, auth.session) : sessionView(null, null, Boolean(bootstrapTokenSha256 && await store.countUsers() === 0)));
      }
      if (req.method === 'POST' && route === '/setup') {
        if (!bootstrapTokenSha256 || await store.countUsers() !== 0) fail(409, 'SETUP_COMPLETE', 'Configuração inicial indisponível');
        const input = await body(req);
        if (typeof input.setupToken !== 'string' || input.setupToken.length < 32 || !safeEqualHex(sha256(input.setupToken), bootstrapTokenSha256)) fail(403, 'INVALID_SETUP_TOKEN', 'Código de configuração inválido');
        if (typeof input.password !== 'string' || input.password.length < SETUP_PASSWORD_MIN_LENGTH || input.password.length > 128) {
          fail(400, 'INVALID_INPUT', `Senha deve ter entre ${SETUP_PASSWORD_MIN_LENGTH} e 128 caracteres`);
        }
        const user = { _id: randomUUID(), name: field(input.name, 'name', 2, 100), email: email(input.email), passwordHash: await hashPassword(input.password, SETUP_PASSWORD_MIN_LENGTH), role: 'admin', active: true, companyCnpjs: [], moduleGrants: {}, createdAt: new Date() };
        await store.createFirstAdmin(user);
        await store.audit('admin.bootstrap', user._id, user._id);
        return send(res, 201, await startSession(res, user));
      }
      if (req.method === 'POST' && route === '/login') {
        const input = await body(req);
        const address = email(input.email);
        check(typeof input.password === 'string' && input.password.length <= 256, 'password');
        const key = loginKey(req, address);
        if (await store.reserveLoginAttempt(key) > 5) fail(429, 'TOO_MANY_ATTEMPTS', 'Aguarde antes de tentar novamente');
        const user = await store.findUserByEmail(address);
        if (!user || !user.active || !await verifyPassword(input.password, user.passwordHash)) {
          fail(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos');
        }
        await store.clearLoginFailures(key);
        await store.audit('auth.login', user._id, user._id);
        return send(res, 200, await startSession(res, user));
      }

      const auth = await current(req);
      if (!auth) fail(401, 'UNAUTHORIZED', 'Entre para continuar');
      const { user, session } = auth;
      if (req.method !== 'GET' && req.method !== 'HEAD') requireCsrf(req, session);
      if (req.method === 'POST' && route === '/logout') {
        await store.deleteSession(session._id);
        res.setHeader('set-cookie', cookieHeader('', secureCookies));
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && route === '/change-password') {
        const input = await body(req);
        check(typeof input.currentPassword === 'string', 'currentPassword');
        if (!await verifyPassword(input.currentPassword, user.passwordHash)) fail(401, 'INVALID_CREDENTIALS', 'Senha atual incorreta');
        check(input.newPassword !== input.currentPassword, 'newPassword');
        const newHash = await hashPassword(input.newPassword);
        await store.changePassword(user._id, newHash, session._id);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && route === '/modules') return send(res, 200, { modules: MODULES.filter(x => canAccess(user, x.id)) });
      if (req.method === 'GET' && route === '/dashboard') {
        return send(res, 200, { metrics: await store.dashboard(user), modules: MODULES.filter(x => canAccess(user, x.id)) });
      }
      if (req.method === 'GET' && route === '/storage') {
        requireAdmin(user);
        return send(res, 200, await store.getStorageUsage());
      }
      const nfsePath = /^\/companies\/(\d{14})\/nfse(?:\/(summary|coverage))?$/.exec(route);
      if (req.method === 'GET' && nfsePath) {
        const companyCnpj = cnpj(nfsePath[1]);
        if (!canAccess(user, 'fiscal') || !canAccessCompany(user, companyCnpj)) fail(403, 'FORBIDDEN', 'Sem acesso ao Fiscal desta empresa');
        if (!await store.companyExists(companyCnpj)) fail(404, 'NOT_FOUND', 'Empresa não encontrada');
        const query = new URL(req.url, 'http://localhost').searchParams;
        if (nfsePath[2] === 'coverage') return send(res, 200, await store.getCompanyNfseCoverage(companyCnpj));
        if (nfsePath[2] === 'summary') {
          const from = month(query.get('from'), 'from');
          const to = month(query.get('to'), 'to');
          check(!from || !to || from <= to, 'from/to');
          return send(res, 200, await store.getCompanyNfseSummary(companyCnpj, { from, to }));
        }
        const requestedMonth = month(query.get('month'), 'month');
        const role = query.get('role');
        const status = query.get('status');
        check(role === null || ['issued', 'received'].includes(role), 'role');
        check(status === null || ['active', 'cancelled', 'substituted', 'unknown'].includes(status), 'status');
        const page = pageNumber(query, 'page', 1, 1000);
        const limit = pageNumber(query, 'limit', 50, 100);
        return send(res, 200, await store.listCompanyNfse(companyCnpj, { month: requestedMonth, role, status, page, limit }));
      }
      if (req.method === 'GET' && route === '/fiscal/documents') {
        if (!canAccess(user, 'fiscal')) fail(403, 'FORBIDDEN', 'Sem acesso ao Fiscal');
        const query = new URL(req.url, 'http://localhost').searchParams;
        const companyCnpj = query.get('companyCnpj');
        if (companyCnpj && !canAccessCompany(user, companyCnpj)) fail(403, 'FORBIDDEN', 'Sem acesso à empresa');
        const page = Number(query.get('page') || '1');
        const limit = Number(query.get('limit') || '50');
        check(Number.isSafeInteger(page) && page >= 1 && page <= 1000, 'page');
        check(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'limit');
        return send(res, 200, await store.listFiscalDocuments(user.role === 'admin' ? null : user.companyCnpjs, companyCnpj, page, limit));
      }
      if (req.method === 'GET' && route === '/companies') {
        const companies = await store.listCompanies(user.role === 'admin' ? null : user.companyCnpjs);
        return send(res, 200, { companies: companies.map(({ cnpj: key, name, active, createdAt }) => ({ cnpj: key, name, active, createdAt })) });
      }
      if (req.method === 'POST' && route === '/companies') {
        requireAdmin(user);
        const input = await body(req);
        const company = { _id: randomUUID(), cnpj: cnpj(input.cnpj), name: field(input.name, 'name', 2, 160), active: true, createdAt: new Date() };
        await store.createCompany(company, user._id);
        return send(res, 201, { company: { cnpj: company.cnpj, name: company.name, active: true, createdAt: company.createdAt } });
      }
      if (req.method === 'GET' && route === '/users') {
        requireAdmin(user);
        return send(res, 200, { users: (await store.listUsers()).map(publicUser) });
      }
      if (req.method === 'POST' && route === '/users') {
        requireAdmin(user);
        const input = await body(req);
        check(['admin', 'member'].includes(input.role), 'role');
        const access = validateAccess(input);
        for (const companyCnpj of access.companyCnpjs) if (!await store.companyExists(companyCnpj)) fail(400, 'UNKNOWN_COMPANY', 'Empresa não cadastrada');
        const member = { _id: randomUUID(), name: field(input.name, 'name', 2, 100), email: email(input.email), passwordHash: await hashPassword(input.password), role: input.role, active: true, ...access, createdAt: new Date() };
        await store.createUser(member, user._id);
        return send(res, 201, { user: publicUser(member) });
      }
      const userMatch = /^\/users\/([a-f0-9-]{36})$/.exec(route);
      if (req.method === 'PATCH' && userMatch) {
        requireAdmin(user);
        const input = await body(req);
        const target = await store.findUserById(userMatch[1]);
        if (!target) fail(404, 'NOT_FOUND', 'Usuário não encontrado');
        const changes = {};
        if (input.name !== undefined) changes.name = field(input.name, 'name', 2, 100);
        if (input.active !== undefined) { check(typeof input.active === 'boolean', 'active'); changes.active = input.active; }
        if (input.role !== undefined) { check(['admin', 'member'].includes(input.role), 'role'); changes.role = input.role; }
        if (input.companyCnpjs !== undefined || input.moduleGrants !== undefined) {
          const access = validateAccess({ companyCnpjs: input.companyCnpjs ?? target.companyCnpjs, moduleGrants: input.moduleGrants ?? target.moduleGrants });
          for (const companyCnpj of access.companyCnpjs) if (!await store.companyExists(companyCnpj)) fail(400, 'UNKNOWN_COMPANY', 'Empresa não cadastrada');
          Object.assign(changes, access);
        }
        check(Object.keys(changes).length > 0, 'changes');
        if (target._id === user._id && (changes.role && changes.role !== 'admin' || changes.active === false)) fail(409, 'SELF_LOCKOUT', 'Não é possível retirar o próprio acesso de administrador');
        const updated = await store.updateUser(target._id, changes);
        await store.audit('user.update', user._id, target._id, { fields: Object.keys(changes) });
        return send(res, 200, { user: publicUser(updated) });
      }
      if (req.method === 'GET' && route === '/agents') {
        requireAdmin(user);
        return send(res, 200, { agents: await store.listAgents() });
      }
      if (req.method === 'POST' && route === '/agents') {
        requireAdmin(user);
        const input = await body(req);
        check(Array.isArray(input.assignments) && input.assignments.length >= 1 && input.assignments.length <= 1000, 'assignments');
        const assignments = [];
        const seen = new Set();
        for (const entry of input.assignments) {
          const companyCnpj = cnpj(entry?.companyCnpj);
          check(['NFE', 'NFSE'].includes(entry?.source), 'assignments.source');
          check(NSU.test(entry?.startNsu), 'assignments.startNsu');
          if (!await store.companyExists(companyCnpj)) fail(400, 'UNKNOWN_COMPANY', 'Empresa não cadastrada');
          const key = `${companyCnpj}:${entry.source}`;
          check(!seen.has(key), 'assignments duplicados'); seen.add(key);
          assignments.push({ companyCnpj, source: entry.source, startNsu: entry.startNsu });
        }
        const token = newSecret();
        const agent = { _id: randomUUID(), name: field(input.name, 'name', 2, 100), active: true, tokenSha256: sha256(token), assignments, createdAt: new Date() };
        await store.createAgent(agent, user._id);
        return send(res, 201, { agent: { id: agent._id, name: agent.name, active: true, assignments }, token });
      }
      const agentMatch = /^\/agents\/([a-f0-9-]{36})\/revoke$/.exec(route);
      if (req.method === 'POST' && agentMatch) {
        requireAdmin(user);
        const agent = await store.revokeAgent(agentMatch[1]);
        if (!agent) fail(404, 'NOT_FOUND', 'Agente não encontrado ou já revogado');
        await store.audit('agent.revoke', user._id, agentMatch[1]);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && route === '/work-items') {
        const url = new URL(req.url, 'http://localhost');
        const module = url.searchParams.get('module');
        const companyCnpj = url.searchParams.get('companyCnpj');
        if (module && !canAccess(user, module)) fail(403, 'FORBIDDEN', 'Sem acesso ao módulo');
        if (companyCnpj && !canAccessCompany(user, companyCnpj)) fail(403, 'FORBIDDEN', 'Sem acesso à empresa');
        const modules = MODULES.filter(x => canAccess(user, x.id)).map(x => x.id);
        const items = await store.listWorkItems({ modules, companyCnpjs: user.role === 'admin' ? null : user.companyCnpjs, module, companyCnpj });
        return send(res, 200, { items: items.map(publicWorkItem) });
      }
      if (req.method === 'POST' && route === '/work-items') {
        const input = await body(req);
        check(MODULES.some(x => x.id === input.module), 'module');
        if (!canAccess(user, input.module, 'edit') || !canAccessCompany(user, input.companyCnpj)) fail(403, 'FORBIDDEN', 'Sem permissão para esta empresa e módulo');
        if (!await store.companyExists(input.companyCnpj)) fail(400, 'UNKNOWN_COMPANY', 'Empresa não cadastrada');
        const now = new Date();
        const item = { _id: randomUUID(), module: input.module, companyCnpj: input.companyCnpj, title: field(input.title, 'title', 3, 200), description: input.description === undefined ? '' : field(input.description, 'description', 0, 2000), status: 'open', dueAt: input.dueAt === undefined ? null : dueAt(input.dueAt), assigneeId: input.assigneeId || null, createdBy: user._id, createdAt: now, updatedAt: now };
        if (item.assigneeId) {
          const assignee = await store.findUserById(item.assigneeId);
          if (!assignee?.active || !canAccess(assignee, item.module) || !canAccessCompany(assignee, item.companyCnpj)) fail(400, 'UNKNOWN_ASSIGNEE', 'Responsável sem acesso à empresa e módulo');
        }
        await store.createWorkItem(item);
        await store.audit('work_item.create', user._id, item._id, { companyCnpj: item.companyCnpj, module: item.module });
        return send(res, 201, { item: publicWorkItem(item) });
      }
      const itemMatch = /^\/work-items\/([a-f0-9-]{36})$/.exec(route);
      if (req.method === 'PATCH' && itemMatch) {
        const item = await store.getWorkItem(itemMatch[1]);
        if (!item) fail(404, 'NOT_FOUND', 'Tarefa não encontrada');
        if (!canAccess(user, item.module, 'edit') || !canAccessCompany(user, item.companyCnpj)) fail(403, 'FORBIDDEN', 'Sem permissão para esta empresa e módulo');
        const input = await body(req);
        const changes = {};
        if (input.title !== undefined) changes.title = field(input.title, 'title', 3, 200);
        if (input.description !== undefined) changes.description = field(input.description, 'description', 0, 2000);
        if (input.status !== undefined) { check(['open', 'in_progress', 'done'].includes(input.status), 'status'); changes.status = input.status; }
        if (input.dueAt !== undefined) changes.dueAt = dueAt(input.dueAt);
        if (input.assigneeId !== undefined) {
          if (input.assigneeId !== null) {
            const assignee = await store.findUserById(input.assigneeId);
            if (!assignee?.active || !canAccess(assignee, item.module) || !canAccessCompany(assignee, item.companyCnpj)) fail(400, 'UNKNOWN_ASSIGNEE', 'Responsável sem acesso à empresa e módulo');
          }
          changes.assigneeId = input.assigneeId;
        }
        check(Object.keys(changes).length > 0, 'changes');
        const updated = await store.updateWorkItem(item._id, changes);
        await store.audit('work_item.update', user._id, item._id, { fields: Object.keys(changes) });
        return send(res, 200, { item: publicWorkItem(updated) });
      }
      return send(res, 404, { error: 'NOT_FOUND', message: 'Rota inexistente' });
    } catch (error) {
      if (error instanceof ApiError) return send(res, error.status, { error: error.code, message: error.message });
      if (error?.message === 'SETUP_COMPLETE') return send(res, 409, { error: 'SETUP_COMPLETE', message: 'Configuração inicial já concluída' });
      if (error?.code === 11000) return send(res, 409, { error: 'DUPLICATE', message: 'Registro já existente' });
      logger.error('Platform API failure', { error: error?.message ?? String(error) });
      return send(res, 500, { error: 'INTERNAL_ERROR', message: 'Falha interna' });
    }
  };
}
