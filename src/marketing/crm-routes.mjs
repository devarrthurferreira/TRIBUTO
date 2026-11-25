import { ApiError } from '../api/validation.mjs';
import { canPerform } from '../platform/policy.mjs';
import { importCrmContacts, exportCrmContacts } from './crm-contacts-csv.mjs';
import { buildCrmEmailMarkup } from './crm-email-template.mjs';

const BASE = '/marketing/crm';
const ID = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const ITEM = new RegExp(`^/(subscribers|campaigns)/(${ID})(?:/(prepare|reopen|audience|record|queue|preview))?$`);
const GROWTH = /^\/(segments|landings|automations)(?:\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}))?$/;
const PAGE_ACTION = new RegExp(`^/landings/(${ID})(?:/(unpublish|analytics))?$`);
const TEMPLATE = new RegExp(`^/templates/(${ID})$`);

export function createMarketingCrmRouter(store) {
  return {
    async handleHttp({ req, res, route, user, send, readBody, logger = console }) {
      try {
        if (!canPerform(user, 'marketing', 'marketingCrmRead')) {
          throw new ApiError(403, 'CRM_FORBIDDEN', 'Você não tem acesso ao CRM de Marketing.');
        }
        const path = route.slice(BASE.length);
        if (!path && req.method === 'GET') return send(res, 200, await store.list());
        const page = PAGE_ACTION.exec(path);
        const match = ITEM.exec(path);
        if (req.method === 'GET') {
          if (path === '/templates') return send(res, 200, await store.pages.listTemplates());
          if (page && !page[2]) return send(res, 200, await store.pages.get(page[1]));
          if (page?.[2] === 'analytics') {
            const campaignId = new URL(req.url ?? route, 'http://localhost').searchParams.get('campaignId');
            return send(res, 200, await store.pageAnalytics.report(page[1], campaignId));
          }
          if (match?.[1] === 'campaigns' && match[3] === 'preview') {
            const html = buildCrmEmailMarkup(await store.previewCampaign(match[2]));
            const isDocument = new URL(req.url ?? route, 'http://localhost').searchParams.get('document') === '1';
            if (isDocument) {
              res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                'Referrer-Policy': 'no-referrer',
                'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
              });
              res.end(html);
              return;
            }
            return send(res, 200, { html });
          }
        }
        if (!canPerform(user, 'marketing', 'marketingCrmManage')) {
          throw new ApiError(403, 'CRM_FORBIDDEN', 'Seu acesso permite consultar o CRM de Marketing.');
        }

        const actor = user._id;
        if (req.method === 'POST' && path === '/contacts/import') {
          const { csv } = await readBody(req);
          return send(res, 200, await importCrmContacts(store, csv, actor));
        }
        if (req.method === 'POST' && path === '/contacts/export') {
          return send(res, 200, await exportCrmContacts(store));
        }
        if (req.method === 'POST' && path === '/templates') {
          return send(res, 201, await store.pages.saveTemplate(await readBody(req), actor));
        }
        const template = TEMPLATE.exec(path);
        if (template && req.method === 'DELETE') return send(res, 200, await store.pages.archiveTemplate(template[1], actor));
        if (page && req.method === 'POST' && page[2] === 'unpublish') return send(res, 200, await store.pages.retire(page[1], actor));
        if (page && req.method === 'DELETE' && !page[2]) return send(res, 200, await store.pages.retire(page[1], actor, { archive: true }));
        if (req.method === 'POST' && path === '/subscribers') {
          return send(res, 201, await store.createSubscriber(await readBody(req), actor));
        }
        if (req.method === 'POST' && path === '/campaigns') {
          return send(res, 201, await store.createCampaign(await readBody(req), actor));
        }
        const growth = GROWTH.exec(path);
        if (growth) {
          const [, collection, id] = growth;
          if ((!id && req.method === 'POST') || (id && req.method === 'PATCH')) {
            return send(res, id ? 200 : 201, await store.putGrowthRecord(collection, id, await readBody(req), actor));
          }
        }
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
            if (operation === 'queue') return send(res, 200, await store.queueCampaign(id, actor));
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
