import { ApiError } from '../api/validation.mjs';
import { validCnpj } from '../platform/brazilian-documents.mjs';
import { canPerformDossier } from '../platform/policy.mjs';
import { renderDossierHtml } from './documents.mjs';
import { normalizeDossier, normalizeFees } from './fields.mjs';
import { importDossiers } from './import.mjs';

const PRIVATE_ROOT = '/dossiers';
const PUBLIC_ENDPOINT = '/v1/dossier-link';
const UUID = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const DOSSIER_ROUTE = new RegExp(`^${PRIVATE_ROOT}/(${UUID})(/document|/fees|/fees/send|/archive|/restore)?$`);
const LINK_ROUTE = new RegExp(`^${PRIVATE_ROOT}/links/(${UUID})$`);
const TOKEN = /^Bearer ([A-Za-z0-9_-]{43})$/;
const SUBMISSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const BODY_LIMIT = 700_000;

function requireAction(user, action) {
  if (!canPerformDossier(user, action)) {
    throw new ApiError(403, 'DOSSIER_FORBIDDEN', 'Seu perfil não tem permissão para esta operação no Dossiê.');
  }
}

function expectFields(body, names) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !names.includes(key))) {
    throw new ApiError(400, 'DOSSIER_INPUT', 'Envie apenas os campos previstos para esta operação.');
  }
  return body;
}

function linkOptions(body) {
  const { companyCnpj, label = '', expiresInHours = 72, mode = 'single' } = expectFields(body, ['companyCnpj', 'label', 'expiresInHours', 'mode']);
  let cnpj = null;
  if (companyCnpj !== undefined && companyCnpj !== null && companyCnpj !== '') {
    cnpj = typeof companyCnpj === 'string' && companyCnpj.trim().toUpperCase().replace(/[./-]/g, '');
    if (!validCnpj(cnpj)) throw new ApiError(400, 'DOSSIER_CNPJ', 'Informe um CNPJ válido para vincular o link.');
  }
  if (typeof label !== 'string' || label.length > 100 || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new ApiError(400, 'DOSSIER_LINK_LABEL', 'Informe um rótulo com até 100 caracteres.');
  }
  if (!Number.isSafeInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) {
    throw new ApiError(400, 'DOSSIER_LINK_EXPIRATION', 'Defina uma validade de 1 a 168 horas.');
  }
  if (mode !== 'single' && mode !== 'reusable') {
    throw new ApiError(400, 'DOSSIER_LINK_MODE', 'Escolha se o link pode receber um ou vários dossiês.');
  }
  return { companyCnpj: cnpj, label: label.trim(), expiresInHours, mode };
}

function checkedRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 0xffffffff) {
    throw new ApiError(400, 'DOSSIER_REVISION_INVALID', 'Informe a versão atual do dossiê.');
  }
  return revision;
}

function listOptions(req) {
  const { searchParams } = new URL(req.url, 'http://localhost');
  const query = (searchParams.get('q') || '').trim();
  const page = Number(searchParams.get('page') || 1);
  const limit = Number(searchParams.get('limit') || 20);
  if (query.length > 120 || !Number.isSafeInteger(page) || page < 1 || page > 20000
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, 'DOSSIER_QUERY', 'Revise os filtros e a paginação dos dossiês.');
  }
  return { query, page, limit, archived: searchParams.get('archived') === '1' };
}

function returnDocument(res, dossier, inline) {
  const html = renderDossierHtml(dossier);
  const presentation = inline
    ? "sandbox allow-same-origin allow-modals; frame-ancestors 'self'"
    : "sandbox; frame-ancestors 'none'";
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${dossier.protocolo}.html"`,
    'cache-control': 'private, no-store',
    'content-security-policy': `${presentation}; default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`,
    'x-frame-options': inline ? 'SAMEORIGIN' : 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(html);
  return true;
}

function sanitizedFailure(error, logger) {
  if (error instanceof ApiError) throw error;
  logger?.error('Falha ao operar dossiê', { code: error?.code });
  throw new ApiError(500, 'DOSSIER_ERROR', 'Não foi possível concluir a operação do dossiê.');
}

export function createDossierRouter(store) {
  return {
    async handleHttp({ req, res, route, user, send, readBody, logger }) {
      requireAction(user, 'dossierRead');
      const { method } = req;
      const sectors = new URL(req.url || PRIVATE_ROOT, 'http://localhost').searchParams.getAll('sector');
      const includeFees = sectors.length === 1 && sectors[0] === 'diretoria' && canPerformDossier(user, 'dossierFeesRead');
      const requireFeesEdit = () => {
        if (!includeFees || !canPerformDossier(user, 'dossierFees')) {
          throw new ApiError(403, 'DOSSIER_FORBIDDEN', 'A edição e o envio de honorários exigem permissão da Diretoria.');
        }
      };
      const detail = async id => ({ dossier: await store.read(user, id, { includeFees }) });
      try {
        if (route === PRIVATE_ROOT + '/import' && method === 'POST') {
          return await importDossiers({ req, res, user, send, readBody, store });
        }
        if (route === PRIVATE_ROOT && method === 'GET') {
          return send(res, 200, await store.list(user, { ...listOptions(req), includeFees }));
        }
        if (route === PRIVATE_ROOT && method === 'POST') {
          requireAction(user, 'dossierCreate');
          const { dossier } = expectFields(await readBody(req, BODY_LIMIT), ['dossier']);
          const created = await store.create(user, normalizeDossier(dossier));
          return send(res, 201, await detail(created.id));
        }
        if (route === PRIVATE_ROOT + '/links') {
          requireAction(user, 'dossierLink');
          if (method === 'GET') return send(res, 200, { items: await store.listLinks(user) });
          if (method === 'POST') return send(res, 201, await store.createLink(user, linkOptions(await readBody(req))));
        }
        const link = LINK_ROUTE.exec(route);
        if (link && method === 'DELETE') {
          requireAction(user, 'dossierLink');
          await store.revokeLink(user, link[1]);
          return send(res, 200, { ok: true });
        }
        const match = DOSSIER_ROUTE.exec(route);
        if (match) {
          const [, id, action] = match;
          if (!action && method === 'GET') return send(res, 200, await detail(id));
          if (!action && method === 'PUT') {
            requireAction(user, 'dossierCreate');
            const { dossier, revision } = expectFields(await readBody(req, BODY_LIMIT), ['dossier', 'revision']);
            await store.update(user, id, checkedRevision(revision), normalizeDossier(dossier));
            return send(res, 200, await detail(id));
          }
          if (action === '/document' && method === 'GET') {
            const inline = new URL(req.url, 'http://localhost').searchParams.get('view') === '1';
            return returnDocument(res, await store.read(user, id), inline);
          }
          if (method === 'POST' && (action === '/archive' || action === '/restore')) {
            requireAction(user, 'dossierCreate');
            const { revision } = expectFields(await readBody(req), ['revision']);
            await store.setArchived(user, id, checkedRevision(revision), action === '/archive');
            return send(res, 200, await detail(id));
          }
          if (action === '/fees' && method === 'PUT') {
            requireFeesEdit();
            const body = await readBody(req);
            await store.saveFees(user, id, checkedRevision(body.revision), normalizeFees(body));
            return send(res, 200, await detail(id));
          }
          if (action === '/fees/send' && method === 'POST') {
            requireFeesEdit();
            const { revision } = expectFields(await readBody(req), ['revision']);
            await store.sendFees(user, id, checkedRevision(revision));
            return send(res, 202, await detail(id));
          }
        }
        throw new ApiError(404, 'NOT_FOUND', 'Rota inexistente.');
      } catch (error) {
        if (!includeFees && error?.code === 'HONORARIUM_IN_TRANSIT') {
          throw new ApiError(409, 'DOSSIER_BUSY', 'Aguarde a conclusão da operação em andamento e tente novamente.');
        }
        return sanitizedFailure(error, logger);
      }
    },
  };
}

function sendPublic(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(JSON.stringify(data));
  return true;
}

async function readPublicJson(req) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) {
    throw new ApiError(415, 'CONTENT_TYPE', 'Use application/json.');
  }
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > BODY_LIMIT) throw new ApiError(413, 'BODY_TOO_LARGE', 'O dossiê ultrapassa o limite do formulário.');
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'O formulário está inválido.'); }
}

function originAllowed(req) {
  const site = req.headers['sec-fetch-site'];
  if (site === 'same-origin') return true;
  if (site && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; }
  catch { return false; }
}

export function createPublicDossierRouter(store, { logger = console } = {}) {
  return async (req, res, pathname) => {
    if (pathname !== PUBLIC_ENDPOINT) return false;
    try {
      if (!['GET', 'POST'].includes(req.method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
      if (!originAllowed(req)) throw new ApiError(403, 'INVALID_ORIGIN', 'Origem da solicitação inválida.');
      const token = TOKEN.exec(req.headers.authorization || '')?.[1];
      if (!token) throw new ApiError(410, 'DOSSIER_LINK_UNAVAILABLE', 'Este link está indisponível, expirado ou já foi utilizado.');
      const link = await store.publicLink(token);
      if (req.method === 'GET') return sendPublic(res, 200, link);
      const { dossier, submissionId } = expectFields(await readPublicJson(req), ['dossier', 'submissionId']);
      if (submissionId !== undefined && (typeof submissionId !== 'string' || !SUBMISSION_ID.test(submissionId))) {
        throw new ApiError(400, 'DOSSIER_SUBMISSION_ID', 'Recarregue o formulário antes de enviar.');
      }
      return sendPublic(res, 201, await store.submitFromLink(token, normalizeDossier(dossier), submissionId));
    } catch (error) {
      return sanitizedFailure(error, logger);
    }
  };
}
