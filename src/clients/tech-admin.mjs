import { ApiError } from '../api/validation.mjs';
import { canPerform } from '../platform/policy.mjs';
import { sendAttachment } from '../chat/attachments.mjs';
import { clientFields } from './profile-fields.mjs';
import { WORKSPACE_BODY_LIMIT } from './workspace-store.mjs';

const itemId = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const workspacePath = new RegExp('^/clients/app/(' + itemId + ')(?:/(modules|guias|financeiro|documentos)(?:/(' + itemId + ')(/file)?)?)?$', 'i');

export function requireClientAppManager(user) {
  if (!canPerform(user, 'tecnologia', 'clientAppManage')) {
    throw new ApiError(403, 'FORBIDDEN', 'Você precisa de permissão para gerenciar o APP Cliente.');
  }
}

export async function handleTechClientApp({ req, res, route, user, send, readBody }, clients, workspaceStore) {
  requireClientAppManager(user);
  const { method } = req;
  if (route === '/clients/app' && method === 'GET') {
    return send(res, 200, { clients: await clients.list() });
  }
  const match = workspacePath.exec(route);
  if (!match) throw new ApiError(404, 'NOT_FOUND', 'Rota inexistente.');
  const [, clientId, module, item, file] = match;
  const client = await clients.get(clientId);
  if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.');
  if (!module && method === 'GET') {
    const { id, name, document, code, active, modules, profileComplete } = client;
    return send(res, 200, { client: { id, name, document, code, active, modules, profileComplete } });
  }
  if (module === 'modules' && !item && method === 'PUT') {
    const input = await readBody(req);
    const { modules } = clientFields({ modules: input.modules }, { partial:true });
    if (!Array.isArray(input.modules)) throw new ApiError(400, 'MISSING_MODULES', 'Selecione os módulos de acesso.');
    await clients.updatePortalModules(clientId, modules, user._id);
    return send(res, 200, { modules });
  }
  if (['guias', 'financeiro', 'documentos'].includes(module)) {
    if (!item && method === 'GET') {
      const page = Number(new URL(req.url, 'http://localhost').searchParams.get('page') ?? 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new ApiError(400,'INVALID_PAGE','Página inválida.');
      return send(res, 200, await workspaceStore.list(client.id, module, page));
    }
    if (!item && method === 'POST') {
      if (!client.active) throw new ApiError(409, 'INACTIVE_CLIENT', 'Ative o cadastro antes de publicar.');
      if (!client.modules.includes(module)) throw new ApiError(409, 'CLIENT_MODULE_DISABLED', 'Libere o módulo para a empresa antes de publicar.');
      return send(res, 201, await workspaceStore.publish(client.id, module, await readBody(req, WORKSPACE_BODY_LIMIT), user._id));
    }
    if (file && ['GET','HEAD'].includes(method)) {
      const attachment = await workspaceStore.getFile(client.id, module, item);
      if (!attachment) throw new ApiError(404, 'FILE_NOT_FOUND', 'Arquivo não encontrado.');
      return sendAttachment(res, attachment, method === 'HEAD');
    }
    if (item && !file && method === 'PATCH') {
      const {status} = await readBody(req);
      const updated = await workspaceStore.updateStatus(client.id, module, item, status, user._id);
      if (!updated) throw new ApiError(404, 'ITEM_NOT_FOUND', 'Registro não encontrado.');
      return send(res, 200, updated);
    }
  }
  throw new ApiError(404,'NOT_FOUND','Rota inexistente.');
}
