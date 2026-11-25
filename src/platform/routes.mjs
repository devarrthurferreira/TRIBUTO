import { randomUUID } from 'node:crypto';
import { ApiError, sha256 } from '../api/validation.mjs';
import { hashPassword, verifyPassword, newSecret, safeEqualHex } from './auth.mjs';
import { lookupCep } from './cep.mjs';
import { handleMarketingMetrics, socialMetricsFields } from '../marketing/metrics-routes.mjs';
import { INTERNAL_WORK_ITEM_MODULES, MODULES, LEVELS, capabilitiesFor, permissionsFor, canAccess, canAccessCompany, canAccessWorkItemCompany, canPerform, hasLoginCredentials, publicUser } from './policy.mjs';

const COOKIE = 'tributo_session';
const SESSION_MS = 12 * 60 * 60_000;
const SETUP_PASSWORD_MIN_LENGTH = 10;
const CNPJ = /^\d{14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[a-z0-9]{1,35}\.[a-z0-9]{1,38}$/;
const NSU = /^(0|[1-9]\d{0,14})$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const WORK_ITEM_STATUSES = ['open', 'in_progress', 'done'];
const MARKETING_PAGE_SIZE = 100;
const LOCAL_DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

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
function optional(value, normalize = candidate => candidate) {
  return value == null || (typeof value === 'string' && !value.trim()) ? null : normalize(value);
}
function optionalField(value, name, min, max) {
  return optional(value, candidate => field(candidate, name, min, max));
}
function email(value) {
  const normalized = field(value, 'email', 4, 254).toLowerCase();
  check(EMAIL.test(normalized), 'email');
  return normalized;
}
function loginIdentifier(value) {
  const normalized = field(value, 'e-mail ou usuário', 3, 254).toLowerCase();
  if (normalized.includes('@')) return email(normalized);
  check(USERNAME.test(normalized), 'usuário');
  return normalized;
}
function dateField(value, name) {
  const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  check(parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, name);
  return value;
}
function cpfNumber(value) {
  const cpf = field(value, 'CPF', 11, 20).replace(/[.\s-]/g, '');
  check(/^\d{11}$/.test(cpf) && !/^(\d)\1{10}$/.test(cpf), 'CPF');
  const digits = [...cpf].map(Number);
  const cpfDigit = (length) => digits.slice(0, length).reduce((sum, digit, index) => sum + digit * (length + 1 - index), 0) * 10 % 11 % 10;
  check(digits[9] === cpfDigit(9) && digits[10] === cpfDigit(10), 'CPF');
  return cpf;
}
function dateOfBirth(value) {
  const birthDate = dateField(value, 'nascimento');
  check(birthDate >= '1900-01-01' && birthDate < LOCAL_DATE.format(new Date()), 'nascimento');
  return birthDate;
}
function phoneNumber(value) {
  const phone = field(value, 'telefone', 10, 24).replace(/[().\s-]/g, '');
  check(/^(?:\+?55)?[1-9]\d{9,10}$/.test(phone), 'telefone');
  return phone.replace(/^\+/, '');
}
function postalCode(value) {
  const cep = field(value, 'CEP', 8, 12).replace(/[\s-]/g, '');
  check(/^\d{8}$/.test(cep), 'CEP');
  return cep;
}
function addressFor(address) {
  check(address && typeof address === 'object' && !Array.isArray(address), 'endereço');
  return { cep: optional(address.cep, postalCode), street: optionalField(address.street, 'logradouro', 2, 160),
    neighborhood: optionalField(address.neighborhood, 'bairro', 1, 100), number: optionalField(address.number, 'número', 1, 30) };
}
function profileFor(input) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'dados pessoais');
  const hasChildren = optional(input.hasChildren);
  check(hasChildren === null || typeof hasChildren === 'boolean', 'possui filhos');
  const childrenCount = optional(input.childrenCount) ?? (hasChildren === false ? 0 : null);
  check(childrenCount === null || (Number.isInteger(childrenCount)
    && (hasChildren === false ? childrenCount === 0 : childrenCount >= 1 && childrenCount <= 99)), 'quantidade de filhos');
  return { firstName: optionalField(input.firstName, 'nome', 1, 50), lastName: optionalField(input.lastName, 'sobrenome', 1, 50),
    cpf: optional(input.cpf, cpfNumber), birthDate: optional(input.birthDate, dateOfBirth), email: optional(input.email, email),
    phone: optional(input.phone, phoneNumber), hasChildren, childrenCount, address: optional(input.address, addressFor) };
}
function usernameFor({ firstName, lastName } = {}) {
  const normalize = (value) => (value || '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 35);
  const username = `${normalize(firstName)}.${normalize(lastName)}`;
  return USERNAME.test(username) ? username : null;
}
function accessPassword(value) {
  check(typeof value === 'string' && value.length >= 12 && value.length <= 128, 'senha de 12 a 128 caracteres');
  return value;
}
function validCnpj(value) {
  if (typeof value !== 'string' || !CNPJ.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const checksum = (length, weights) => { const rest = digits.slice(0, length).reduce((sum, digit, index) => sum + digit * weights[index], 0) % 11; return rest < 2 ? 0 : 11 - rest; };
  return digits[12] === checksum(12, [5,4,3,2,9,8,7,6,5,4,3,2]) && digits[13] === checksum(13, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
}
function cnpj(value) { check(validCnpj(value), 'cnpj'); return value; }
function companyView({ cnpj, name, active, createdAt }) { return { cnpj, name, active, createdAt }; }
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
export async function authenticatePlatformRequest(store, req) {
  const token = cookieValue(req);
  if (!token) return null;
  const session = await store.findSession(sha256(token));
  if (!session) return null;
  const user = await store.findUserById(session.userId);
  return user?.active ? { user, session } : null;
}
function requireAdmin(user) { if (user.role !== 'admin') fail(403, 'FORBIDDEN', 'Acesso restrito a administradores'); }
export function matchesPlatformCsrf(session, value) {
  return typeof value === 'string' && value.length <= 128 && safeEqualHex(sha256(value), sha256(session.csrfToken));
}
function requireCsrf(req, session) {
  if (!matchesPlatformCsrf(session, req.headers['x-csrf-token'])) fail(403, 'CSRF', 'Token de proteção inválido');
}
function sessionView(user, session, setupRequired = false) {
  return { user: publicUser(user), permissions: permissionsFor(user), capabilities: capabilitiesFor(user), csrfToken: session?.csrfToken ?? null, setupRequired };
}
async function validateCompanyGrants(store, companies) {
  check(Array.isArray(companies) && companies.length <= 1000 && companies.every(validCnpj) && new Set(companies).size === companies.length, 'companyCnpjs');
  for (const cnpj of companies) if (!await store.companyExists(cnpj)) fail(400, 'UNKNOWN_COMPANY', 'Empresa não cadastrada');
  return companies;
}
function validateModuleGrants(grants) {
  check(grants && typeof grants === 'object' && !Array.isArray(grants), 'moduleGrants');
  const entries = Object.entries(grants).map(([id, grant]) => {
    const module = MODULES.find(entry => entry.id === id);
    const name = `moduleGrants.${id}`;
    check(module, name);
    if (LEVELS.includes(grant)) return [id, grant];
    check(grant && typeof grant === 'object' && !Array.isArray(grant) && LEVELS.includes(grant.level), name);
    const blocked = grant.blockedActions;
    check(Array.isArray(blocked) && blocked.length <= module.actions.length && blocked.every(action => module.actions.includes(action)) && new Set(blocked).size === blocked.length, `${name}.blockedActions`);
    return [id, blocked.length ? { level: grant.level, blockedActions: blocked } : grant.level];
  });
  return Object.fromEntries(entries);
}
function publicWorkItem(item) {
  return { id: item._id, module: item.module, companyCnpj: item.companyCnpj, title: item.title, description: item.description || '', status: item.status, dueAt: item.dueAt || null, assigneeId: item.assigneeId || null, createdBy: item.createdBy, createdAt: item.createdAt, updatedAt: item.updatedAt,
    ...(item.module === 'marketing' ? { priority: item.priority || 'normal', tags: item.tags || [], checklist: item.checklist || [],
      campaign: item.campaign || '', referenceUrl: item.referenceUrl || '', completedAt: item.completedAt || null,
      socialChannel: item.socialChannel || '', desiredReach: item.desiredReach ?? null, estimatedReach: item.estimatedReach ?? null } : {}) };
}
function dueAt(value) {
  if (value === null || value === '') return null;
  return dateField(value, 'dueAt');
}

function workItemCompany(module, company) {
  return INTERNAL_WORK_ITEM_MODULES.includes(module) && (company == null || company === '') ? null : cnpj(company);
}

function marketingAttributes(input) {
  const fields = socialMetricsFields(input);
  if (input.priority !== undefined) {
    check(['low', 'normal', 'high', 'urgent'].includes(input.priority), 'prioridade');
    fields.priority = input.priority;
  }
  if (input.campaign !== undefined) fields.campaign = field(input.campaign, 'campanha', 0, 120);
  if (input.tags !== undefined) {
    check(Array.isArray(input.tags) && input.tags.length <= 12, 'tags');
    fields.tags = input.tags.map(value => field(value, 'tag', 1, 32));
    check(new Set(fields.tags.map(value => value.normalize('NFC').toLocaleLowerCase('pt-BR'))).size === fields.tags.length, 'tags duplicadas');
  }
  if (input.checklist !== undefined) {
    check(Array.isArray(input.checklist) && input.checklist.length <= 30, 'checklist');
    fields.checklist = input.checklist.map(entry => {
      check(entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.done === 'boolean', 'item do checklist');
      check(entry.id === undefined || (typeof entry.id === 'string' && UUID.test(entry.id)), 'id do item do checklist');
      return { id: entry.id?.toLowerCase() || randomUUID(), title: field(entry.title, 'item do checklist', 1, 140), done: entry.done };
    });
    check(new Set(fields.checklist.map(entry => entry.id)).size === fields.checklist.length, 'itens repetidos no checklist');
  }
  if (input.referenceUrl !== undefined) {
    const value = field(input.referenceUrl, 'link de referência', 0, 1000);
    const url = URL.canParse(value) ? new URL(value) : null;
    check(!value || (url?.protocol === 'https:' && !url.username && !url.password && url.href.length <= 1000), 'link de referência HTTPS');
    fields.referenceUrl = url ? url.href : '';
  }
  return fields;
}

function marketingMetricMetadata(input, { partial = false } = {}) {
  const { priority, checklist, referenceUrl, socialChannel, desiredReach, estimatedReach } = input;
  const fields = marketingAttributes({ priority, checklist, referenceUrl, socialChannel, desiredReach, estimatedReach });
  if (!partial || input.title !== undefined) fields.title = field(input.title, 'título', 3, 200);
  if (input.description !== undefined) fields.description = field(input.description, 'descrição', 0, 2000);
  if (input.status !== undefined) {
    check(WORK_ITEM_STATUSES.includes(input.status), 'status');
    fields.status = input.status;
  }
  if (input.dueAt !== undefined) fields.dueAt = dueAt(input.dueAt);
  return fields;
}

async function validateTaskAssignee(store, assigneeId, module, companyCnpj) {
  check(typeof assigneeId === 'string' && UUID.test(assigneeId), 'responsável');
  const assignee = await store.findUserById(assigneeId);
  if (!canPerform(assignee, module, 'workItemRead') || !canAccessWorkItemCompany(assignee, module, companyCnpj)) {
    fail(400, 'UNKNOWN_ASSIGNEE', 'Responsável sem acesso à empresa e módulo');
  }
}

export function createPlatformRouter({ store, chat, whatsapp, club, crm, bootstrapTokenSha256, secureCookies = true, logger = console }) {
  function loginKey(req, address) { return sha256(`${req.socket.remoteAddress || 'unknown'}:${address}`); }
  async function startSession(res, user) {
    const token = newSecret();
    const session = { _id: sha256(token), userId: user._id, csrfToken: newSecret(), expiresAt: new Date(Date.now() + SESSION_MS), createdAt: new Date() };
    await store.createSession(session);
    res.setHeader('set-cookie', cookieHeader(token, secureCookies));
    return sessionView(user, session);
  }
  return async function handlePlatform(req, res, pathname) {
    if (pathname !== '/v1/platform' && !pathname.startsWith('/v1/platform/')) return false;
    try {
      const route = pathname.slice('/v1/platform'.length);
      if (req.method === 'GET' && route === '/session') {
        const auth = await authenticatePlatformRequest(store, req);
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
        const identifier = loginIdentifier(input.identifier ?? input.email);
        check(typeof input.password === 'string' && input.password.length > 0 && input.password.length <= 256, 'password');
        const user = identifier.includes('@') ? await store.findUserByEmail(identifier) : await store.findUserByUsername(identifier);
        const key = loginKey(req, user?.email || identifier);
        if (await store.reserveLoginAttempt(key) > 5) fail(429, 'TOO_MANY_ATTEMPTS', 'Aguarde antes de tentar novamente');
        if (!user || !user.active || !await verifyPassword(input.password, user.passwordHash)) {
          fail(401, 'INVALID_CREDENTIALS', 'Usuário, e-mail ou senha incorretos');
        }
        await store.clearLoginFailures(key);
        await store.audit('auth.login', user._id, user._id);
        return send(res, 200, await startSession(res, user));
      }

      const auth = await authenticatePlatformRequest(store, req);
      if (!auth) fail(401, 'UNAUTHORIZED', 'Entre para continuar');
      const { user, session } = auth;
      if (req.method !== 'GET' && req.method !== 'HEAD') requireCsrf(req, session);
      if (req.method === 'GET' && route === '/cep') {
        requireAdmin(user);
        const cep = new URL(req.url, 'http://localhost').searchParams.get('cep');
        return send(res, 200, await lookupCep(cep));
      }
      if (chat && (route === '/chat' || route.startsWith('/chat/'))) {
        return await chat.handleHttp({ req, res, route, user, send, readBody: body });
      }
      if (whatsapp && (route === '/whatsapp' || route.startsWith('/whatsapp/'))) {
        return await whatsapp.handleHttp({ req, res, route, user, send, readBody: body });
      }
      if (club && (route === '/club' || route.startsWith('/club/'))) {
        return await club.handleHttp({ req, res, route, user, send, readBody: body, requireAdmin, logger });
      }
      if (route === '/marketing/metrics' || route.startsWith('/marketing/metrics/')) {
        return await handleMarketingMetrics({ req, res, route, user, send, readBody: body, store: store.marketingMetrics,
          parseMetadata: marketingMetricMetadata, pageNumber });
      }
      if (crm && (route === '/marketing/crm' || route.startsWith('/marketing/crm/'))) {
        return await crm.handleHttp({ req, res, route, user, send, readBody: body });
      }
      if (req.method === 'POST' && route === '/logout') {
        await store.deleteSession(session._id);
        chat?.disconnectSession(session._id);
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
        if (!canPerform(user, 'fiscal', 'fiscalDocumentsRead') || !canAccessCompany(user, companyCnpj)) fail(403, 'FORBIDDEN', 'Sem acesso ao Fiscal desta empresa');
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
        if (!canPerform(user, 'fiscal', 'fiscalDocumentsRead')) fail(403, 'FORBIDDEN', 'Sem acesso aos documentos fiscais');
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
        return send(res, 200, { companies: companies.map(companyView) });
      }
      if (req.method === 'POST' && route === '/companies') {
        requireAdmin(user);
        const input = await body(req);
        const company = { _id: randomUUID(), cnpj: cnpj(input.cnpj), name: field(input.name, 'name', 2, 160), active: true, createdAt: new Date() };
        await store.createCompany(company, user._id);
        return send(res, 201, { company: companyView(company) });
      }
      const managedCompany = /^\/companies\/(\d{14})$/.exec(route);
      if (managedCompany && ['GET', 'PATCH'].includes(req.method)) {
        requireAdmin(user);
        const key = cnpj(managedCompany[1]);
        if (req.method === 'GET') {
          const company = await store.getCompany(key);
          if (!company) fail(404, 'NOT_FOUND', 'Empresa não cadastrada');
          const members = (await store.listUsers()).filter(person => person.role === 'member').map(person => ({
            id: person._id, name: person.name, email: person.email, active: person.active,
            hasAccess: person.companyCnpjs?.includes(key) || false,
          }));
          return send(res, 200, { company: companyView(company), members });
        }
        const input = await body(req);
        const changes = {};
        if (input.name !== undefined) changes.name = field(input.name, 'name', 2, 160);
        if (input.active !== undefined) { check(typeof input.active === 'boolean', 'active'); changes.active = input.active; }
        check(Object.keys(changes).length > 0, 'changes');
        const company = await store.updateCompany(key, changes, user._id);
        if (!company) fail(404, 'NOT_FOUND', 'Empresa não cadastrada');
        return send(res, 200, { company: companyView(company) });
      }
      const companyAccess = /^\/companies\/(\d{14})\/access\/([a-f0-9-]{36})$/.exec(route);
      if (companyAccess && req.method === 'PATCH') {
        requireAdmin(user);
        const key = cnpj(companyAccess[1]);
        const input = await body(req);
        check(typeof input.hasAccess === 'boolean', 'hasAccess');
        if (!await store.companyExists(key)) fail(404, 'NOT_FOUND', 'Empresa não cadastrada');
        const result = await store.setCompanyAccess(key, companyAccess[2], input.hasAccess, user._id);
        if (result === 'not_found') fail(404, 'NOT_FOUND', 'Usuário não encontrado');
        if (result === 'admin') fail(409, 'ADMIN_COMPANY_ACCESS', 'Administradores têm acesso a todas as empresas');
        if (result === 'inactive') fail(409, 'USER_INACTIVE', 'Ative o usuário antes de conceder acesso');
        if (result === 'limit') fail(409, 'PORTFOLIO_LIMIT', 'A carteira deste usuário atingiu o limite de empresas');
        return send(res, 200, { hasAccess: result });
      }
      if (req.method === 'GET' && route === '/users') {
        requireAdmin(user);
        return send(res, 200, { users: (await store.listUsers()).map(publicUser) });
      }
      if (req.method === 'POST' && route === '/users') {
        requireAdmin(user);
        const input = await body(req);
        const role = optional(input.role) ?? 'member';
        check(['admin', 'member'].includes(role), 'role');
        const profile = optional(input.profile, profileFor);
        const personalName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
        const name = personalName ? [...personalName].slice(0, 100).join('') : (optionalField(input.name, 'nome completo', 1, 100) ?? 'Usuário sem nome');
        const username = profile ? usernameFor(profile) : null;
        const address = optional(input.email, email);
        const moduleGrants = validateModuleGrants(optional(input.moduleGrants) ?? {});
        const companyCnpjs = await validateCompanyGrants(store, optional(input.companyCnpjs) ?? []);
        const password = optional(input.password, accessPassword);
        const passwordHash = password === null ? null : await hashPassword(password);
        const member = { _id: randomUUID(), name, email: address, username, profile, moduleGrants, companyCnpjs,
          passwordHash, role, active: hasLoginCredentials({ email: address, username, passwordHash }), createdAt: new Date() };
        const savedUsername = await store.createUser(member, user._id);
        return send(res, 201, { user: publicUser({ ...member, username: savedUsername }) });
      }
      const userMatch = /^\/users\/([a-f0-9-]{36})$/.exec(route);
      if (req.method === 'GET' && userMatch) {
        requireAdmin(user);
        const target = await store.findUserById(userMatch[1]);
        if (!target) fail(404, 'NOT_FOUND', 'Usuário não encontrado');
        return send(res, 200, { user: publicUser(target), profile: await store.getUserProfile(target._id) });
      }
      if (req.method === 'PATCH' && userMatch) {
        requireAdmin(user);
        const input = await body(req);
        const target = await store.findUserById(userMatch[1]);
        if (!target) fail(404, 'NOT_FOUND', 'Usuário não encontrado');
        const changes = {};
        if (input.name !== undefined) changes.name = field(input.name, 'name', 1, 100);
        if (input.active !== undefined) { check(typeof input.active === 'boolean', 'active'); changes.active = input.active; }
        if (input.role !== undefined) { check(['admin', 'member'].includes(input.role), 'role'); changes.role = input.role; }
        if (input.companyCnpjs !== undefined) changes.companyCnpjs = await validateCompanyGrants(store, input.companyCnpjs);
        if (input.moduleGrants !== undefined) changes.moduleGrants = validateModuleGrants(input.moduleGrants);
        const address = optional(input.email, email);
        const password = optional(input.password, accessPassword);
        const emailChanged = address !== null && address !== target.email;
        if ((emailChanged || password !== null) && hasLoginCredentials(target)) {
          fail(409, 'USER_ACCESS_ALREADY_READY', 'Este usuário já possui dados de acesso. Reabra a edição para ver o cadastro atualizado.');
        }
        if (emailChanged) changes.email = address;
        if (password !== null) changes.passwordHash = await hashPassword(password);
        check(Object.keys(changes).length > 0, 'changes');
        if (changes.active === true && !hasLoginCredentials({ ...target, ...changes })) {
          fail(409, 'USER_ACCESS_PENDING', 'Informe uma senha e um e-mail ou usuário antes de ativar o acesso.');
        }
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
        if (module && !canPerform(user, module, 'workItemRead')) fail(403, 'FORBIDDEN', 'Sem acesso às tarefas do módulo');
        if (companyCnpj && !canAccessCompany(user, companyCnpj)) fail(403, 'FORBIDDEN', 'Sem acesso à empresa');
        const modules = MODULES.filter(x => canPerform(user, x.id, 'workItemRead')).map(x => x.id);
        const scope = { modules, companyCnpjs: user.role === 'admin' ? null : user.companyCnpjs, module, companyCnpj };
        if (module === 'marketing') {
          const page = pageNumber(url.searchParams, 'page', 1, 10_000);
          const [items, people] = await Promise.all([
            store.listWorkItems({ ...scope, limit: MARKETING_PAGE_SIZE + 1, offset: (page - 1) * MARKETING_PAGE_SIZE }),
            page === 1 ? store.listUsers() : [],
          ]);
          const assignees = people.filter(person => canPerform(person, module, 'workItemRead')
            && (!companyCnpj || canAccessCompany(person, companyCnpj))).map(({ _id: id, name }) => ({ id, name }));
          return send(res, 200, { items: items.slice(0, MARKETING_PAGE_SIZE).map(publicWorkItem),
            ...(page === 1 ? { assignees } : {}), page, hasMore: items.length > MARKETING_PAGE_SIZE });
        }
        const items = await store.listWorkItems(scope);
        return send(res, 200, { items: items.map(publicWorkItem) });
      }
      if (req.method === 'POST' && route === '/work-items') {
        const input = await body(req);
        check(MODULES.some(x => x.id === input.module), 'module');
        const companyCnpj = workItemCompany(input.module, input.companyCnpj);
        if (!canPerform(user, input.module, 'workItemCreate') || !canAccessWorkItemCompany(user, input.module, companyCnpj)) fail(403, 'FORBIDDEN', 'Sem permissão para criar tarefas nesta empresa e módulo');
        if (companyCnpj && !await store.companyExists(companyCnpj)) fail(400, 'UNKNOWN_COMPANY', 'Empresa não cadastrada');
        const now = new Date();
        const marketing = input.module === 'marketing';
        const status = marketing && input.status !== undefined ? input.status : 'open';
        check(WORK_ITEM_STATUSES.includes(status), 'status');
        const item = { _id: randomUUID(), module: input.module, companyCnpj, title: field(input.title, 'title', 3, 200), description: input.description === undefined ? '' : field(input.description, 'description', 0, 2000), status, dueAt: input.dueAt === undefined ? null : dueAt(input.dueAt), assigneeId: input.assigneeId ?? null, createdBy: user._id, createdAt: now, updatedAt: now,
          ...(marketing ? { ...marketingAttributes(input), completedAt: status === 'done' ? now : null } : {}) };
        if (item.assigneeId) {
          await validateTaskAssignee(store, item.assigneeId, item.module, item.companyCnpj);
        } else {
          check(!marketing || item.assigneeId === null, 'responsável');
          item.assigneeId = null;
        }
        await store.createWorkItem(item);
        if (!marketing) await store.audit('work_item.create', user._id, item._id, { companyCnpj: item.companyCnpj, module: item.module });
        return send(res, 201, { item: publicWorkItem(item) });
      }
      const itemMatch = /^\/work-items\/([a-f0-9-]{36})$/.exec(route);
      if (req.method === 'GET' && itemMatch) {
        const item = await store.getWorkItem(itemMatch[1]);
        if (!item || !canPerform(user, item.module, 'workItemRead') || !canAccessWorkItemCompany(user, item.module, item.companyCnpj)) {
          fail(404, 'NOT_FOUND', 'Tarefa não encontrada');
        }
        const result = { item: publicWorkItem(item) };
        if (item.module === 'marketing') result.history = await store.listWorkItemHistory(item._id);
        return send(res, 200, result);
      }
      if (req.method === 'PATCH' && itemMatch) {
        const item = await store.getWorkItem(itemMatch[1]);
        if (!item) fail(404, 'NOT_FOUND', 'Tarefa não encontrada');
        if (!canPerform(user, item.module, 'workItemUpdate') || !canAccessWorkItemCompany(user, item.module, item.companyCnpj)) fail(403, 'FORBIDDEN', 'Sem permissão para editar tarefas nesta empresa e módulo');
        const input = await body(req);
        const marketing = item.module === 'marketing';
        const changes = marketing ? marketingAttributes(input) : {};
        if (marketing && input.companyCnpj !== undefined) {
          const destination = workItemCompany(item.module, input.companyCnpj);
          if (destination !== item.companyCnpj) {
            requireAdmin(user);
            if (destination && !await store.companyExists(destination)) fail(400, 'UNKNOWN_COMPANY', 'Empresa não cadastrada');
            changes.companyCnpj = destination;
          }
        }
        if (input.title !== undefined) changes.title = field(input.title, 'title', 3, 200);
        if (input.description !== undefined) changes.description = field(input.description, 'description', 0, 2000);
        if (input.status !== undefined) { check(WORK_ITEM_STATUSES.includes(input.status), 'status'); changes.status = input.status; }
        if (input.dueAt !== undefined) changes.dueAt = dueAt(input.dueAt);
        if (input.assigneeId !== undefined) changes.assigneeId = input.assigneeId;
        const companyChanged = Object.hasOwn(changes, 'companyCnpj') && changes.companyCnpj !== item.companyCnpj;
        const assigneeChanged = Object.hasOwn(changes, 'assigneeId') && (!marketing || changes.assigneeId !== item.assigneeId);
        if (companyChanged || assigneeChanged) {
          const assigneeId = Object.hasOwn(changes, 'assigneeId') ? changes.assigneeId : item.assigneeId;
          const companyCnpj = companyChanged ? changes.companyCnpj : item.companyCnpj;
          if (assigneeId !== null) await validateTaskAssignee(store, assigneeId, item.module, companyCnpj);
        }
        check(Object.keys(changes).length > 0, 'changes');
        if (marketing && input.expectedUpdatedAt !== undefined && (typeof input.expectedUpdatedAt !== 'string'
          || Date.parse(input.expectedUpdatedAt) !== new Date(item.updatedAt).getTime())) {
          fail(409, 'TASK_UPDATED', 'A tarefa foi alterada. Reabra os detalhes para conferir a versão atual.');
        }
        const expected = marketing ? { updatedAt: item.updatedAt, companyCnpj: item.companyCnpj, assigneeId: item.assigneeId } : undefined;
        const updated = await store.updateWorkItem(item._id, changes, { expected, actorId: user._id });
        if (!updated) fail(409, 'TASK_UPDATED', 'A tarefa foi alterada. Reabra os detalhes para conferir a versão atual.');
        if (!marketing) await store.audit('work_item.update', user._id, item._id, { fields: Object.keys(changes) });
        return send(res, 200, { item: publicWorkItem(updated) });
      }
      return send(res, 404, { error: 'NOT_FOUND', message: 'Rota inexistente' });
    } catch (error) {
      if (error instanceof ApiError) return send(res, error.status, { error: error.code, message: error.message });
      if (error?.message === 'SETUP_COMPLETE') return send(res, 409, { error: 'SETUP_COMPLETE', message: 'Configuração inicial já concluída' });
      if (error?.code === 'DUPLICATE_USER_EMAIL') return send(res, 409, { error: error.code, message: 'E-mail de acesso já cadastrado' });
      if (error?.code === 'DUPLICATE_USER_CPF') return send(res, 409, { error: error.code, message: 'CPF já cadastrado' });
      if (error?.code === 'USER_ACCESS_PENDING') return send(res, 409, { error: error.code, message: 'Informe uma senha e um e-mail ou usuário antes de ativar o acesso.' });
      if (error?.code === 'USER_ACCESS_ALREADY_READY') return send(res, 409, { error: error.code, message: 'Este usuário já possui dados de acesso. Reabra a edição para ver o cadastro atualizado.' });
      if (error?.code === 'USERNAME_UNAVAILABLE') return send(res, 409, { error: error.code, message: 'Não foi possível gerar um nome de usuário disponível' });
      if (error?.code === 11000) return send(res, 409, { error: 'DUPLICATE', message: 'Registro já existente' });
      logger.error('Platform API failure', { error: error?.message ?? String(error) });
      return send(res, 500, { error: 'INTERNAL_ERROR', message: 'Falha interna' });
    }
  };
}
