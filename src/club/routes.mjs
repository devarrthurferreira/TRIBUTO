import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { clubFields, clubId, importClubFields } from './catalog.mjs';

const RECORD_PATH = /^\/club\/(benefits|partners|events)(?:\/([a-f\d-]{36}))?$/i;

export function createClubRouter(store) {
  return {
    async handleHttp({ req, res, route, user, send, readBody, requireAdmin, logger }) {
      try {
        const method = req.method;
        if (route === '/club' && method === 'GET') {
          return send(res, 200, await store.list(user.role === 'admin'));
        }
        if (route === '/club/import' && method === 'POST') {
          requireAdmin(user);
          const catalog = importClubFields(await readBody(req));
          return send(res, 200, await store.importCatalog(catalog, user._id));
        }
        const match = RECORD_PATH.exec(route);
        if (match) {
          const collection = match[1].toLowerCase();
          const id = match[2] ? clubId(match[2]) : null;
          if (method === 'POST' && !id) {
            requireAdmin(user);
            const fields = clubFields(collection, await readBody(req));
            return send(res, 201, await store.create(collection, randomUUID(), fields, user._id));
          }
          if (method === 'PATCH' && id) {
            requireAdmin(user);
            const fields = clubFields(collection, await readBody(req), { partial: true });
            const updated = await store.update(collection, id, fields, user._id);
            if (updated) return send(res, 200, updated);
          }
          if (method === 'DELETE' && id) {
            requireAdmin(user);
            if (await store.remove(collection, id, user._id)) return send(res, 200, { removed: true });
          }
        }
        throw new ApiError(404, 'CLUB_NOT_FOUND', 'Registro do Clube indisponível.');
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_DUP_ENTRY'].includes(error?.code)) {
          throw new ApiError(409, 'CLUB_CONFLICT', 'O catálogo mudou durante a operação. Atualize e tente novamente.');
        }
        logger.error('Club API failure', { code: error?.code });
        throw new ApiError(500, 'CLUB_INTERNAL_ERROR', 'Não foi possível carregar ou atualizar o Clube.');
      }
    },
  };
}
