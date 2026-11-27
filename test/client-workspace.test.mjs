import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../src/api/validation.mjs';
import { createClientPortalRouter } from '../src/clients/access-routes.mjs';
import { ClientWorkspaceStore } from '../src/clients/workspace-store.mjs';

test('portal restringe lista, envio e download à empresa e ao módulo da sessão', async t => {
  const client = { id: randomUUID(), active: true, modules: ['documentos', 'guias'] };
  const csrfToken = 'b'.repeat(64);
  let purpose = 'active';
  const file = { name: 'guia.pdf', data: Buffer.from('%PDF-1.7'), size: 8 };
  const id = randomUUID();
  const calls = [];
  const router = createClientPortalRouter({
    clientStore: { async get(key) { return key === client.id ? client : null; } },
    accessStore: {
      async getSession() { return { purpose, clientId: client.id, csrfToken }; },
      async getAccount() { return { status: purpose === 'active' ? 'active' : 'activation_pending' }; },
    },
    workspaceStore: {
      async list(...args) { calls.push(args); return { items: [], page: 1, hasMore: false }; },
      async upload(clientId, data) { calls.push([clientId, data.title]); return { id }; },
      async getFile(clientId, module, key) { calls.push([clientId, module, key]); return module === 'guias' && id === key ? file : null; },
    }, secureCookies: false,
  });
  const server = http.createServer(async (req, res) => {
    try { await router(req, res, new URL(req.url, 'http://localhost').pathname); }
    catch (error) {
      res.writeHead(error instanceof ApiError ? error.status : 500);
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:' + server.address().port + '/v1/client/modules/';
  const session = { cookie: 'maximumClient=' + 'a'.repeat(64) };
  const upload = { method: 'POST', body: JSON.stringify({ title: 'Comprovante', clientId: 'outra' }), headers: { ...session, 'content-type': 'application/json', 'x-csrf-token': csrfToken } };
  assert.equal((await fetch(base + 'guias', { headers: session })).status, 200);
  assert.deepEqual(calls.pop(), [client.id, 'guias', 1]);
  assert.equal((await fetch(base + 'financeiro', { headers: session })).status, 403);
  assert.equal((await fetch(base + 'guias?clientId=outra', { headers: session })).status, 400);
  const download = await fetch(base + 'guias/' + id + '/arquivo', { headers: session });
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.equal(await download.text(), '%PDF-1.7');
  assert.deepEqual(calls.pop(), [client.id, 'guias', id]);
  assert.equal((await fetch(base + 'documentos/' + randomUUID() + '/arquivo', { headers: session })).status, 404);
  assert.equal((await fetch(base + 'documentos', { ...upload, headers: session })).status, 403);
  assert.equal((await fetch(base + 'documentos', upload)).status, 201);
  assert.deepEqual(calls.pop(), [client.id, 'Comprovante']);
  purpose = 'activation';
  assert.equal((await fetch(base + 'documentos', upload)).status, 403);
  purpose = 'active'; client.modules = [];
  assert.equal((await fetch(base + 'guias/' + id + '/arquivo', { headers: session })).status, 403);
  client.active = false;
  assert.equal((await fetch(base + 'documentos', upload)).status, 401);
});

test('documento recebido ignora status forjado, verifica o arquivo e registra o envio junto com a auditoria', async () => {
  let values;
  const audits = [];
  const store = new ClientWorkspaceStore({
    transaction: work => work({ execute: async (_sql, params) => { values = params; } }),
    insertAudit: (_connection, ...args) => audits.push(args),
  });
  await assert.rejects(store.upload('empresa', { title: 'Arquivo sem anexo' }), ApiError);
  await assert.rejects(store.upload('empresa', { file: { name: 'guia.pdf', base64: 'dGV4dG8=' } }), ApiError);
  await assert.rejects(store.publish('empresa', 'guias', { title: 'Guia', dueDate: '2026-02-31' }, 'staff'), ApiError);
  await assert.rejects(store.publish('empresa', 'guias', { title: 'Guia', amountCents: -100 }, 'staff'), ApiError);
  const {id} = await store.upload('empresa', { status: 'conferido', module: 'financeiro', competence: '2026-11',
    file: { name: 'guia.pdf', base64: Buffer.from('%PDF-1.7').toString('base64') } });
  assert.deepEqual(values.slice(0,10), [id, 'empresa', 'documentos', 'cliente', 'guia.pdf', null, '2026-11', null, null, 'recebido']);
  assert.equal(audits[0][0], 'client.document.upload');
  assert.deepEqual(audits[0][3], { module: 'documentos', itemId: id });
});
