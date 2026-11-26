import { ApiError, sha256 } from '../api/validation.mjs';
import { hashPassword, newSecret, safeEqualHex, verifyPassword } from '../platform/auth.mjs';
import { clientAccessView, clientLoginAttemptKey, prepareClientActivation } from './access-store.mjs';

const PREFIX = '/v1/client/';
const ADMIN_ACCESS = /^\/clients\/([a-f0-9-]{36}|\d{11}|[A-Za-z0-9]{12}\d{2})\/access(\/reset)?$/i;
const PASSWORD_MIN = 15;
const SHORT_SESSION_MS = 20 * 60_000;
const FULL_SESSION_MS = 8 * 60 * 60_000;
const NO_SESSION = { client: null, csrfToken: null, mustChangePassword: false };
const MISSING_CLIENT = '00000000-0000-0000-0000-000000000000';
const DUMMY_HASH = `scrypt$16384$8$1$${Buffer.alloc(16, 97).toString('base64')}$${Buffer.alloc(64, 189).toString('base64')}`;
const RAW_DOCUMENT = /^(?:\d{11}|[A-Z0-9]{12}\d{2})$/;
const MASKED_DOCUMENT = /^(?:\d{3}\.\d{3}\.\d{3}-\d{2}|[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-\d{2})$/;

function fail(status, code, message) { throw new ApiError(status, code, message); }

export function normalizeClientUsername(value) {
  if (typeof value !== 'string') return null;
  const username = value.trim().toUpperCase();
  if (RAW_DOCUMENT.test(username)) return username;
  return MASKED_DOCUMENT.test(username) ? username.replace(/[./-]/g, '') : null;
}

function normalizedPassword(value) {
  return typeof value === 'string' && value.length <= 128 ? value.normalize('NFC') : '';
}

function sameOrigin(req) {
  const context = req.headers['sec-fetch-site'];
  if (context === 'same-origin') return true;
  if (context && context !== 'none') return false;
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    return ['https:', 'http:'].includes(origin.protocol) && origin.host === req.headers.host;
  } catch { return false; }
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) fail(415, 'CONTENT_TYPE', 'Use application/json.');
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 8000) fail(413, 'BODY_TOO_LARGE', 'Solicitação muito grande.');
    parts.push(part);
  }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* malformed request below */ }
  return fail(400, 'INVALID_JSON', 'Dados inválidos.');
}

function send(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(data));
  return true;
}

function sessionView(client, session) {
  return {
    client: { id: client.id, name: client.nickname || client.name, username: client.document },
    csrfToken: session.csrfToken, mustChangePassword: session.purpose === 'activation',
  };
}

function invalidLogin() { fail(401, 'INVALID_CREDENTIALS', 'Usuário ou senha incorretos. Se o código temporário já foi usado ou venceu, peça um novo à Maximum.'); }
function noSession() { fail(401, 'UNAUTHORIZED', 'Sua sessão expirou. Entre novamente.'); }

export function createClientAccessAdminRouter({ accessStore, clientStore }) {
  return {
    async handleHttp({ req, res, route, user, send: reply, requireAdmin }) {
      const match = ADMIN_ACCESS.exec(route);
      if (!match) return false;
      const [, id, resetting] = match;
      if (!(resetting ? req.method === 'POST' : ['GET', 'DELETE'].includes(req.method))) return false;
      requireAdmin(user);
      const client = await clientStore.get(id);
      if (!client) fail(404, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.');
      if (resetting) {
        if (!client.active) fail(409, 'CLIENT_INACTIVE', 'Ative o cadastro para gerar um acesso.');
        const activation = prepareClientActivation();
        const access = await accessStore.reset(client, activation, user._id, clientStore);
        return reply(res, 200, { access, activationCode: activation.code });
      }
      const access = req.method === 'DELETE'
        ? await accessStore.revoke(client, user._id)
        : clientAccessView(await accessStore.getAccount(client.id), client.document);
      return reply(res, 200, { access });
    },
  };
}

export function createClientPortalRouter({ accessStore, clientStore, secureCookies = true, clock = () => Date.now() }) {
  const cookieName = secureCookies ? '__Secure-maximumClient' : 'maximumClient';

  function sessionCookie(res, token, lifeMs = 0) {
    res.setHeader('set-cookie', `${cookieName}=${token}; Path=/v1/client; HttpOnly; SameSite=Strict; Max-Age=${Math.ceil(lifeMs / 1000)}${secureCookies ? '; Secure' : ''}`);
  }

  async function currentSession(req) {
    const entry = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`));
    const token = entry?.slice(cookieName.length + 1);
    if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    const session = await accessStore.getSession(sha256(token), new Date(clock()));
    if (!session) return null;
    const [client, account] = await Promise.all([clientStore.get(session.clientId), accessStore.getAccount(session.clientId)]);
    if (!client?.active || !account || account.status !== (session.purpose === 'activation' ? 'activation_pending' : 'active')) {
      return null;
    }
    return { client, account, session };
  }

  async function reserve(res, key, limit) {
    if (await accessStore.reserveAttempt(key) <= limit) return;
    res.setHeader('retry-after', '300');
    fail(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
  }

  async function login(req, res) {
    const input = await readBody(req);
    const username = normalizeClientUsername(input.username);
    const password = normalizedPassword(input.password);
    if (!username || !password) fail(400, 'INVALID_CREDENTIALS_INPUT', 'Informe o CPF ou CNPJ e a senha.');
    const attemptKey = clientLoginAttemptKey(username);
    await reserve(res, sha256(`client-login:ip:${req.socket.remoteAddress || 'unknown'}`), 300);
    await reserve(res, attemptKey, 5);
    const client = await clientStore.get(username);
    const account = await accessStore.getAccount(client?.id ?? MISSING_CLIENT);
    const passwordMatch = await verifyPassword(password, account?.passwordHash ?? DUMMY_HASH);
    const now = new Date(clock());
    const firstAccess = account?.status === 'activation_pending';
    const activationMatch = firstAccess && !account.activationUsedAt && Date.parse(account.activationExpiresAt) > now.getTime()
      && safeEqualHex(sha256(password), account.activationHash);
    if (!client?.active || !(activationMatch || (account?.status === 'active' && passwordMatch))) invalidLogin();
    const expiresAt = new Date(firstAccess
      ? Math.min(Date.parse(account.activationExpiresAt), now.getTime() + SHORT_SESSION_MS)
      : now.getTime() + FULL_SESSION_MS);
    const token = newSecret();
    const session = { id: sha256(token), csrfToken: newSecret(), purpose: firstAccess ? 'activation' : 'active', expiresAt };
    if (!await accessStore.startSession(account, session, now)) invalidLogin();
    // Login succeeded. The address limit remains in force across accounts.
    try { await accessStore.clearAttempts(attemptKey); } catch { /* a failed cleanup cannot unwind an exchanged code */ }
    sessionCookie(res, token, expiresAt.getTime() - now.getTime());
    return send(res, 200, sessionView(client, session));
  }

  async function changePassword(req, res, { client, account, session }) {
    const input = await readBody(req);
    const password = normalizedPassword(input.newPassword);
    const current = normalizedPassword(input.currentPassword);
    if ([...password].length < PASSWORD_MIN || password.length > 128 || /^\s*$/u.test(password)) {
      fail(400, 'PASSWORD_LENGTH', `Defina uma senha de ${PASSWORD_MIN} a 128 caracteres.`);
    }
    if (normalizeClientUsername(password) === client.document || safeEqualHex(sha256(password), account.activationHash) || password === current) {
      fail(400, 'PASSWORD_REUSE', 'Escolha uma senha diferente do CPF, CNPJ, código temporário e senha atual.');
    }
    if (session.purpose === 'active') {
      const key = sha256(`client-password:account:${client.id}`);
      await reserve(res, key, 5);
      if (!await verifyPassword(current, account.passwordHash)) fail(400, 'CURRENT_PASSWORD', 'A senha atual está incorreta.');
    }
    const hash = await hashPassword(password, PASSWORD_MIN);
    if (!await accessStore.completePassword(account, session, hash, new Date(clock()))) noSession();
    sessionCookie(res, '');
    return send(res, 200, { ok: true });
  }

  return async function handleClientPortal(req, res, pathname) {
    if (!pathname.startsWith(PREFIX)) return false;
    const route = pathname.slice(PREFIX.length);
    if (req.method === 'POST' && !sameOrigin(req)) fail(403, 'INVALID_ORIGIN', 'Origem da solicitação inválida.');
    if (req.method === 'POST' && route === 'login') return login(req, res);
    if (req.method === 'GET' && route === 'session') {
      const auth = await currentSession(req);
      return send(res, 200, auth ? sessionView(auth.client, auth.session) : NO_SESSION);
    }
    if (req.method === 'POST' && (route === 'change-password' || route === 'logout')) {
      const auth = await currentSession(req);
      if (!auth) noSession();
      const csrf = req.headers['x-csrf-token'];
      if (!safeEqualHex(auth.session.csrfToken, csrf)) fail(403, 'CSRF', 'Token de proteção inválido.');
      if (route === 'change-password') return changePassword(req, res, auth);
      await accessStore.deleteSession(auth.session.id);
      sessionCookie(res, '');
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'NOT_FOUND', message: 'Rota inexistente.' });
  };
}
