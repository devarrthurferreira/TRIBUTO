import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApiServer } from '../src/api/http.mjs';
import { sha256 } from '../src/api/validation.mjs';
import { createPlatformRouter } from '../src/platform/routes.mjs';
import { replyWindowOpen } from '../src/whatsapp/mysql-store.mjs';
import { createWhatsAppService, readWhatsAppConfig } from '../src/whatsapp/service.mjs';

const environment = {
  WHATSAPP_PHONE_NUMBER_ID: '12345678901234',
  WHATSAPP_SECTOR: 'tecnologia',
  WHATSAPP_ACCESS_TOKEN: 'token-for-automated-whatsapp-test-only',
  WHATSAPP_APP_SECRET: 'secret-for-automated-whatsapp-test-only',
  WHATSAPP_VERIFY_TOKEN: 'verify-token-for-automated-test-only',
  WHATSAPP_GRAPH_VERSION: 'v25.0'
};

function fixtureStore() {
  const records = [];
  const cursor = new Map();
  const id = randomUUID();
  const peer = '5532999998999';
  const incomingName = 'Contato de teste';
  const deliveries = [];
  const pending = new Map();
  const latest = () => records.filter(record => record.direction === 'inbound').at(-1);
  return {
    id, peer, records, deliveries, cursor,
    async recordInbound(_scope, item) {
      if (records.some(record => record.providerId === item.providerId)) return false;
      records.push({ id: String(records.length + 1), text: item.text, at: item.at.toISOString(),
        direction: 'inbound', type: item.type, status: 'received', providerId: item.providerId });
      return true;
    },
    async recordDelivery(_scope, item) { deliveries.push(item); },
    async listConversations(_scope, userId) {
      const last = records.at(-1);
      const unread = records.filter(row => row.direction === 'inbound' && Number(row.id) > (cursor.get(userId) || 0)).length;
      return { unread, hasMore: false, conversations: last ? [{
        id, name: incomingName, phone: peer, lastMessage: last.text, lastAt: last.at, unread, canReply: replyWindowOpen(latest().at)
      }] : [] };
    },
    async history(_scope, conversation, before) {
      if (conversation !== id) return null;
      return { hasMore: false, messages: records.filter(row => !before || Number(row.id) < Number(before)), canReply: replyWindowOpen(latest().at) };
    },
    async markRead(_scope, userId, conversation, through) {
      if (conversation !== id || !records.some(row => row.id === through)) return false;
      cursor.set(userId, Math.max(cursor.get(userId) || 0, Number(through)));
      return true;
    },
    async reserveReply(_scope, conversation, { clientId, actorId, text }) {
      if (conversation !== id) return { reason: 'missing' };
      const previous = pending.get(clientId);
      if (previous) return previous.message.text === text && previous.actorId === actorId
        ? { message: previous.message, fresh: false } : { reason: 'conflict' };
      if (!replyWindowOpen(latest()?.at)) return { reason: 'closed' };
      const message = { id: String(records.length + 1), direction: 'outbound', text, at: new Date().toISOString(), type: 'text', status: 'pending' };
      records.push(message);
      pending.set(clientId, { message, actorId });
      return { message, phone: peer, fresh: true };
    },
    async finishReply(_conversation, clientId, delivery) {
      const { message } = pending.get(clientId);
      message.status = delivery.status;
      return message;
    }
  };
}

test('WhatsApp requires complete scoped config and limits free-form replies to 24 hours', () => {
  assert.equal(readWhatsAppConfig({}), null);
  assert.equal(readWhatsAppConfig({ ...environment, WHATSAPP_GRAPH_VERSION: '../bad' }), null);
  assert.equal(readWhatsAppConfig({ ...environment, WHATSAPP_SECTOR: 'bad' }), null);
  assert.equal(readWhatsAppConfig(environment).graphVersion, 'v25.0');
  const now = Date.parse('2026-11-25T16:00:00Z');
  assert.equal(replyWindowOpen('2026-11-24T16:00:00Z', now), false);
  assert.equal(replyWindowOpen('2026-11-24T16:00:01Z', now), true);
  assert.equal(replyWindowOpen('2026-11-25T16:00:01Z', now), false);
  assert.equal(replyWindowOpen(null, now), false);
});

test('WhatsApp routes verify webhook and connect authorized inbox, read state and replies', async () => {
  const inbox = fixtureStore();
  const users = [
    { token: 'a'.repeat(64), active: true, role: 'member', moduleGrants: { tecnologia: 'edit', dp: 'view' } },
    { token: 'b'.repeat(64), active: true, role: 'member', moduleGrants: { tecnologia: 'view' } },
    { token: 'c'.repeat(64), active: true, role: 'member', moduleGrants: { fiscal: 'edit' } }
  ].map(user => ({ ...user, _id: randomUUID(), csrfToken: randomUUID() }));
  const sessions = new Map(users.map(user => [sha256(user.token), { userId: user._id, csrfToken: user.csrfToken }]));
  const platformStore = {
    async findSession(id) { return sessions.get(id); },
    async findUserById(id) { return users.find(user => user._id === id); }
  };
  const graphCalls = [];
  let providerOnline = true;
  const whatsapp = createWhatsAppService({ config: readWhatsAppConfig(environment), store: inbox, fetcher: async (url, options) => {
    graphCalls.push({ url, payload: JSON.parse(options.body), authorization: options.headers.Authorization });
    if (!providerOnline) throw Error('simulated timeout');
    return Response.json({ messages: [{ id: 'wamid.graph-reply' }] });
  } });
  const server = createApiServer({ store: {}, agentRegistry: {}, whatsapp, platformRouter: createPlatformRouter({ store: platformStore, whatsapp }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const inboxUrl = `${origin}/v1/platform/whatsapp`;
  const hook = `${origin}/v1/whatsapp/webhook`;
  const [edit, view, fiscal] = users;
  const req = (route, user, body, csrf = true) => {
    const headers = user ? { Cookie: `tributo_session=${user.token}` } : {};
    if (body) {
      headers['content-type'] = 'application/json';
      if (csrf) headers['x-csrf-token'] = user.csrfToken;
    }
    return fetch(inboxUrl + route, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) });
  };
  const event = (value) => JSON.stringify({ object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: environment.WHATSAPP_PHONE_NUMBER_ID }, ...value } }] }] });
  const signed = (body, secret = environment.WHATSAPP_APP_SECRET) => fetch(hook, { method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex') }, body });
  const reply = { sector: 'tecnologia', conversation: inbox.id, text: 'Recebemos sua solicitação.', clientId: randomUUID() };
  try {
    const validToken = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.challenge': '42', 'hub.verify_token': environment.WHATSAPP_VERIFY_TOKEN });
    const challenge = await fetch(hook + '?' + validToken);
    assert.equal(challenge.status, 200);
    assert.equal(await challenge.text(), '42');
    validToken.set('hub.verify_token', 'errado');
    assert.equal((await fetch(hook + '?' + validToken)).status, 403);
    assert.equal((await req('?sector=tecnologia', null)).status, 401);
    assert.equal((await req('?sector=tecnologia', fiscal)).status, 403);
    assert.equal((await (await req('?sector=dp', edit)).json()).configured, false);

    const now = String(Math.floor(Date.now() / 1000));
    const incoming = { from: inbox.peer, id: 'wamid.inbound-one', timestamp: now, type: 'text', text: { body: 'Olá!' } };
    const data = event({ messages: [incoming] });
    assert.equal((await signed(data, 'assinatura-inválida')).status, 403);
    assert.equal(inbox.records.length, 0);
    assert.equal((await signed(event({ metadata: { phone_number_id: 'outro' }, messages: [incoming] }))).status, 200);
    assert.equal(inbox.records.length, 0);
    assert.equal((await signed(data)).status, 200);
    assert.equal((await signed(data)).status, 200);
    assert.equal(inbox.records.length, 1);

    const summary = await (await req('?sector=tecnologia', edit)).json();
    assert.equal(summary.configured, true);
    assert.equal(summary.unread, 1);
    assert.equal(summary.conversations[0].phone, inbox.peer);
    assert.equal(summary.conversations[0].canReply, true);
    const history = `/messages?sector=tecnologia&conversation=${inbox.id}`;
    const viewHistory = await (await req(history, view)).json();
    assert.equal(viewHistory.messages[0].text, 'Olá!');
    assert.equal(viewHistory.canReply, false);
    assert.equal((await req(history.replace(inbox.id, randomUUID()), edit)).status, 404);
    assert.equal((await req('/reply', view, reply)).status, 403);
    assert.equal((await req('/reply', edit, reply, false)).status, 403);
    assert.equal(graphCalls.length, 0);

    const read = { sector: 'tecnologia', conversation: inbox.id, through: '1' };
    assert.equal((await req('/read', edit, { ...read, through: '999' })).status, 404);
    assert.equal((await req('/read', edit, read)).status, 200);
    assert.equal((await (await req('?sector=tecnologia', edit)).json()).unread, 0);
    assert.equal((await (await req('?sector=tecnologia', view)).json()).unread, 1);

    const sent = await req('/reply', edit, reply);
    assert.equal(sent.status, 201);
    assert.equal((await sent.json()).message.status, 'accepted');
    assert.equal((await req('/reply', edit, reply)).status, 200);
    assert.equal((await req('/reply', edit, { ...reply, text: 'Alterada' })).status, 409);
    assert.equal(graphCalls.length, 1);
    assert.equal(graphCalls[0].url, `https://graph.facebook.com/v25.0/${environment.WHATSAPP_PHONE_NUMBER_ID}/messages`);
    assert.equal(graphCalls[0].authorization, 'Bearer ' + environment.WHATSAPP_ACCESS_TOKEN);
    assert.equal(graphCalls[0].payload.to, inbox.peer);
    assert.equal(graphCalls[0].payload.biz_opaque_callback_data, reply.clientId);

    const status = { id: 'wamid.graph-reply', recipient_id: inbox.peer, status: 'delivered', biz_opaque_callback_data: reply.clientId };
    assert.equal((await signed(event({ statuses: [status] }))).status, 200);
    assert.equal(inbox.deliveries[0].status, 'delivered');
    assert.equal(inbox.deliveries[0].clientId, reply.clientId);

    providerOnline = false;
    const timedOut = { ...reply, clientId: randomUUID() };
    assert.equal((await (await req('/reply', edit, timedOut)).json()).message.status, 'uncertain');
    assert.equal((await (await req('/reply', edit, timedOut)).json()).message.status, 'uncertain');
    assert.equal(graphCalls.length, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Baileys pairing is restricted to administrators in the configured sector', async () => {
  const admin = { _id: randomUUID(), role: 'admin', active: true, moduleGrants: {} };
  const observer = { _id: randomUUID(), role: 'member', active: true, moduleGrants: { tecnologia: 'manage' } };
  const qrImage = 'data:image/png;base64,dGVzdA==';
  let paired = false;
  const baileysScope = { sector: 'tecnologia', phoneId: 'baileys:5532990000000' };
  const bridge = {
    sector: 'tecnologia',
    scope: () => paired ? baileysScope : null,
    async connect() { paired = true; },
    async cancel() { paired = false; },
    async disconnect() { paired = false; },
    async status({ includeQr } = {}) {
      return paired ? { state: 'qr', ...(includeQr ? { qrImage } : {}) } : { state: 'disconnected' };
    },
  };
  const whatsapp = createWhatsAppService({ bridge, store: fixtureStore() });
  const get = (route, user, input, query = '') => whatsapp.handleHttp({
    req: { method: input ? 'POST' : 'GET', url: '/v1/platform' + route + '?sector=tecnologia' + query },
    route, user, readBody: async () => input, send: (_, status, data) => ({ status, data }),
  });
  const action = { sector: 'tecnologia', action: 'connect' };
  assert.equal((await get('/whatsapp/connections', admin)).data.connection.status, 'disconnected');
  await assert.rejects(get('/whatsapp/connections', observer, action), { status: 403 });
  assert.equal((await get('/whatsapp/connections', admin, action)).data.connection.qrImage, qrImage);
  assert.equal((await get('/whatsapp/connections', admin)).data.connection.qrImage, undefined);
  assert.equal((await get('/whatsapp/connections', admin, null, '&pairing=1')).data.connection.qrImage, qrImage);
  assert.equal((await get('/whatsapp/connections', observer, null, '&pairing=1')).data.connection.qrImage, undefined);
  const cancel = { ...action, action: 'cancel' };
  await assert.rejects(get('/whatsapp/connections', observer, cancel), { status: 403 });
  assert.equal((await get('/whatsapp/connections', admin, cancel)).data.connection.status, 'disconnected');
  assert.equal((await get('/whatsapp/connections', admin, action)).data.connection.qrImage, qrImage);
  assert.equal((await get('/whatsapp/connections', admin, { ...action, action: 'disconnect' })).data.connection.status, 'disconnected');
});
