import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { prepareClientActivation } from './access-store.mjs';
import { clientFields } from './profile-fields.mjs';

const CLIENT = /^\/clients\/(\d{11}|[a-z\d]{12}\d{2}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i;

export function createClientAdminRouter({ clients, certificates, accessStore, accessAdmin }) {
  async function withCertificate(client) {
    return { ...client, certificate: await certificates.status(client.id) };
  }

  function disableAccess(connection, id, actorId) {
    return accessStore.revokeInTransaction(connection, { id }, actorId);
  }

  return {
    disableAccess,
    async handleHttp(context) {
      const { req, res, route, user, send, readBody, requireAdmin, logger } = context;
      requireAdmin(user);
      const { method } = req;
      try {
        if (method === 'GET' && route === '/clients/config') {
          return send(res, 200, { certificateUploadConfigured: certificates.configured });
        }
        if (method === 'POST' && route === '/clients/certificate/verify') {
          const certificate = certificates.verify(await readBody(req, 710_000));
          return send(res, 200, { certificate });
        }
        if (route === '/clients') {
          if (method === 'GET') return send(res, 200, { clients: await clients.list() });
          if (method === 'POST') {
            const input = await readBody(req, 900_000);
            const fields = clientFields(input);
            const id = randomUUID();
            const certificate = await certificates.prepare(input.certificate, id);
            const activation = fields.active ? prepareClientActivation() : null;
            let access;
            const client = await clients.create(fields, user._id, {
              id,
              afterWrite: async (connection, record) => {
                await certificates.save(connection, record.id, certificate);
                if (activation) {
                  access = await accessStore.installActivation(connection, {
                    clientId: record.id, username: record.document, activation, actorId: user._id,
                  });
                }
              },
            });
            return send(res, 201, { client: await withCertificate(client),
              ...(activation ? { access, activationCode: activation.code, activationExpiresAt: activation.expiresAt } : {}),
            });
          }
        }
        const match = CLIENT.exec(route);
        if (match && (method === 'GET' || method === 'PATCH')) {
          const current = await clients.get(match[1]);
          if (!current) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.');
          if (method === 'GET') return send(res, 200, { client: await withCertificate(current) });
          const input = await readBody(req, 900_000);
          const fields = clientFields(input, { partial: true });
          const certificate = await certificates.prepare(input.certificate, current.id);
          const updated = await clients.update(current.id, fields, user._id, {
            afterWrite: async (connection, record, previous) => {
              await certificates.save(connection, record.id, certificate);
              if (previous.active && !record.active) await disableAccess(connection, record.id, user._id);
            },
          });
          if (!updated) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.');
          return send(res, 200, { client: await withCertificate(updated) });
        }
        if (await accessAdmin.handleHttp(context) !== false) return;
        throw new ApiError(404, 'NOT_FOUND', 'Rota inexistente');
      } catch (error) {
        if (error instanceof ApiError) throw error;
        logger.error('Falha na administração de clientes', { code: error.code });
        throw new ApiError(500, 'CLIENT_ERROR', 'Não foi possível concluir a operação do cliente.');
      }
    },
  };
}
