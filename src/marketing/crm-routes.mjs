import { ApiError } from '../api/validation.mjs';
import { canPerform } from '../platform/policy.mjs';

const BASE = '/marketing/crm';
const ITEM = /^\/(subscribers|campaigns)\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/(prepare|reopen|audience|record))?$/;

export function createMarketingCrmRouter(store) {
  return {
    async handleHttp({ req, res, route, user, send, readBody, logger = console }) {
      try {
        if (!canPerform(user, 'marketing', 'marketingCrmRead')) {
          throw new ApiError(403, 'CRM_FORBIDDEN', 'Você não tem acesso ao CRM de Marketing.');
        }
        const path = route.slice(BASE.length);
        if (!path && req.method === 'GET') return send(res, 200, await store.list());
        if (!canPerform(user, 'marketing', 'marketingCrmManage')) {
          throw new ApiError(403, 'CRM_FORBIDDEN', 'Seu acesso permite consultar o CRM de Marketing.');
        }

        const actor = user._id;
        if (req.method === 'POST' && path === '/subscribers') {
          return send(res, 201, await store.createSubscriber(await readBody(req), actor));
        }
        if (req.method === 'POST' && path === '/campaigns') {
          return send(res, 201, await store.createCampaign(await readBody(req), actor));
        }
        const match = ITEM.exec(path);
        if (match) {
          const [, resource, id, operation] = match;
          if (!operation && req.method === 'PATCH') {
            const body = await readBody(req);
            const updated = resource === 'subscribers'
              ? await store.updateSubscriber(id, body, actor)
              : await store.updateCampaign(id, body, actor);
            return send(res, 200, updated);
          }
          if (resource === 'campaigns' && req.method === 'POST') {
            if (operation === 'prepare') return send(res, 200, await store.prepareCampaign(id, actor));
            if (operation === 'reopen') return send(res, 200, await store.reopenCampaign(id, actor));
            if (operation === 'audience') return send(res, 200, await store.audience(id, actor));
            if (operation === 'record') return send(res, 200, await store.recordCampaign(id, await readBody(req), actor));
          }
        }
        throw new ApiError(404, 'CRM_NOT_FOUND', 'Operação do CRM não encontrada.');
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
          throw new ApiError(409, 'CRM_STATE_CONFLICT', 'O CRM mudou durante a operação. Atualize a página e tente novamente.');
        }
        logger.error('Marketing CRM storage failure', { code: error?.code });
        throw new ApiError(500, 'CRM_ERROR', 'Não foi possível concluir a operação do CRM.');
      }
    }
  };
}
