import { ApiError } from '../api/validation.mjs';
import { canAccess, MODULES } from '../platform/policy.mjs';
import { parseMaxHubImage, sendMaxHubImage } from './core-routes.mjs';

const KINDS = new Set(['post', 'celebration', 'announcement']);
const SECTORS = new Set(MODULES.filter(module => !module.legacy).map(module => module.id));
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const POST_PATH = /^\/maxhub\/feed\/([^/]+)(?:\/(image|comments|like))?$/;
const MAX_IMAGE_BYTES = 1024 * 1024;

function invalid(message) { throw new ApiError(400, 'MAXHUB_INVALID_FEED_INPUT', message); }

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid('Identificador inválido.');
  return value.toLowerCase();
}

function ids(value, max, required) {
  if (!Array.isArray(value) || value.length > max || (required && value.length === 0)) {
    invalid(`Selecione até ${max} pessoas${required ? ' para receber a publicação' : ' para mencionar'}.`);
  }
  return [...new Set(value.map(uuid))];
}

function audienceFor(input) {
  if (input?.type === 'all') return { type: 'all' };
  if (input?.type === 'sector' && SECTORS.has(input.sector)) return { type: 'sector', sector: input.sector };
  if (input?.type === 'people') return { type: 'people', userIds: ids(input.userIds, 50, true) };
  invalid('Escolha o público da publicação.');
}

function textFor(raw, maximum) {
  if (typeof raw !== 'string' || raw.length > maximum) invalid(`Escreva até ${maximum.toLocaleString('pt-BR')} caracteres.`);
  return raw.trim();
}

function postInput(input, user) {
  if (!KINDS.has(input?.kind)) invalid('Tipo de publicação inválido.');
  if (input.kind === 'announcement' && !canAccess(user, 'rh', 'edit')) {
    throw new ApiError(403, 'MAXHUB_ANNOUNCEMENT_FORBIDDEN', 'Sua conta não tem permissão para publicar comunicados.');
  }
  const text = textFor(input.text ?? '', 2_000);
  const image = input.image == null ? null : parseMaxHubImage(input.image, MAX_IMAGE_BYTES);
  if (!text && !image) invalid('Escreva uma mensagem ou adicione uma imagem.');
  return { kind: input.kind, text, image, audience: audienceFor(input.audience), mentions: ids(input.mentions ?? [], 12, false),
    ...(input.clientId === undefined ? {} : { clientId: uuid(input.clientId) }) };
}

function feedQuery(url) {
  const query = new URL(url, 'http://localhost').searchParams;
  const kind = query.get('kind');
  if (kind !== null && !KINDS.has(kind)) invalid('Filtro de publicações inválido.');
  const token = query.get('cursor');
  if (token === null) return { kind };
  if (!/^[a-zA-Z0-9_-]{40,100}$/.test(token)) invalid('Página de publicações inválida.');
  const [timestamp, id, ...rest] = Buffer.from(token, 'base64url').toString().split('/');
  const createdAt = new Date(timestamp);
  if (rest.length || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)
    || Number.isNaN(createdAt.getTime()) || !UUID.test(id)) invalid('Página de publicações inválida.');
  return { kind, cursor: { createdAt, id: uuid(id) } };
}

export function createMaxHubFeedRouter(store) {
  return {
    async handleHttp({ req, res, route, user, send, readBody, logger = console }) {
      if (route !== '/maxhub/feed' && !route.startsWith('/maxhub/feed/')) return false;
      const reply = (status, data) => { send(res, status, data); return true; };
      const method = req.method;
      try {
        if (route === '/maxhub/feed' && method === 'GET') return reply(200, await store.list(user, feedQuery(req.url)));
        if (route === '/maxhub/feed' && method === 'POST') {
          const post = await store.create(user, postInput(await readBody(req, 1_450_000), user));
          return reply(201, { post });
        }
        const match = POST_PATH.exec(route);
        if (match) {
          const id = uuid(match[1]);
          const action = match[2];
          if (!action && method === 'DELETE') {
            await store.remove(user, id);
            return reply(200, { deleted: true });
          }
          if (action === 'image' && (method === 'GET' || method === 'HEAD')) {
            sendMaxHubImage(res, await store.getImage(user, id), method === 'HEAD');
            return true;
          }
          if (action === 'comments' && method === 'GET') return reply(200, await store.getComments(user, id));
          if (action === 'comments' && method === 'POST') {
            const text = textFor((await readBody(req))?.text, 600);
            if (!text) invalid('Escreva um comentário para continuar.');
            return reply(201, await store.addComment(user, id, text));
          }
          if (action === 'like' && (method === 'PUT' || method === 'DELETE')) {
            return reply(200, await store.setLike(user, id, method === 'PUT'));
          }
        }
        throw new ApiError(404, 'MAXHUB_FEED_NOT_FOUND', 'Funcionalidade de publicação indisponível.');
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
          throw new ApiError(409, 'MAXHUB_FEED_CONFLICT', 'A publicação mudou durante a operação. Tente novamente.');
        }
        logger.error('MaxHub feed API failure', { code: error?.code });
        throw new ApiError(500, 'MAXHUB_FEED_ERROR', 'Não foi possível concluir a operação no feed.');
      }
    },
  };
}
