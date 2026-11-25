import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import * as baileys from '@whiskeysockets/baileys';
import { createBaileysBridge, readBaileysConfig } from '../src/whatsapp/baileys.mjs';

const config = { sector: 'tecnologia', authKey: Buffer.alloc(32, 42) };
const self = '5511000000001:4@s.whatsapp.net';
const peer = '5511000000002@s.whatsapp.net';
const peerLid = '111234@lid';
const clientId = '1f5c5410-4ac7-41ea-8792-3a8ee486a527';

function memoryPool() {
  const saved = new Map();
  let lock = null;
  const key = (sector, kind, id) => JSON.stringify([sector, kind, id]);
  async function execute(sql, [sector, kind, ...ids]) {
    if (sql.startsWith('SELECT key_id')) return [ids.flatMap(id => {
      const encrypted = saved.get(key(sector, kind, id));
      return encrypted ? [{ key_id: id, encrypted }] : [];
    })];
    if (sql.startsWith('INSERT')) {
      saved.set(key(sector, kind, ids[0]), ids[1]);
      return [];
    }
    if (kind) saved.delete(key(sector, kind, ids[0]));
    else for (const row of saved.keys()) if (JSON.parse(row)[0] === sector) saved.delete(row);
    return [];
  }
  return { saved, execute, async query() {}, async getConnection() {
    const executor = { async execute(sql, params) {
      if (sql.startsWith('SELECT GET_LOCK')) {
        if (lock) return [[{ claimed: 0 }]];
        lock = executor;
        return [[{ claimed: 1 }]];
      }
      if (sql.startsWith('SELECT RELEASE_LOCK')) {
        assert.equal(lock, executor);
        lock = null;
        return [[{ released: 1 }]];
      }
      return execute(sql, params);
    }, async query() {}, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
    return executor;
  } };
}

function harness(pool = memoryPool(), selectedConfig = config) {
  const sockets = [], received = [], deliveries = [];
  const options = { config: selectedConfig, pool, logger: { warn() {} },
    store: { async recordInbound(scope, item) { received.push({ scope, item }); },
      async recordDelivery(scope, item) { deliveries.push({ scope, item }); } },
    loadLibrary: async () => ({ ...baileys, default: settings => {
      const socket = { settings, ev: new EventEmitter(), user: { id: self },
        signalRepository: { lidMapping: { async getPNForLID(jid) { return jid === peerLid ? peer : null; } } },
        async sendMessage(jid, content, sendOptions) { socket.sent = { jid, content, sendOptions }; return { key: { id: sendOptions.messageId } }; },
        async logout() { socket.loggedOut = true; }, async end() { socket.ended = true; } };
      sockets.push(socket);
      return socket;
    } })
  };
  return { bridge: createBaileysBridge(options), sockets, received, deliveries, pool };
}

test('Baileys requer modo explícito, setor ativo e chave AES-256', () => {
  const values = { WHATSAPP_MODE: 'baileys', WHATSAPP_SECTOR: 'tecnologia', WHATSAPP_BAILEYS_AUTH_KEY: '2a'.repeat(32) };
  assert.deepEqual(readBaileysConfig(values), config);
  assert.equal(readBaileysConfig({ ...values, WHATSAPP_MODE: 'cloud' }), null);
  assert.equal(readBaileysConfig({ ...values, WHATSAPP_BAILEYS_AUTH_KEY: 'missing' }), null);
});

test('Baileys gera QR somente após conectar, restaura sessão cifrada e encerra o vínculo quando solicitado', async (t) => {
  const { bridge, sockets, pool } = harness();
  t.after(() => bridge.close());
  await bridge.initialize();
  assert.equal(sockets.length, 0);
  assert.equal((await bridge.connect()).state, 'connecting');
  const [socket] = sockets;
  socket.ev.emit('connection.update', { qr: 'fake-pairing-payload-should-stay-private' });
  const pairing = await bridge.connect();
  assert.match(pairing.qrImage, /^data:image\/png;base64,/);
  assert.equal(bridge.status().qrImage, undefined);
  const secret = Buffer.from('signal material for a test');
  socket.ev.emit('creds.update', { registered: true, me: { id: self }, noiseKey: { private: secret } });
  await socket.settings.auth.keys.set({ 'lid-mapping': { 'contact-key': secret } });
  assert.deepEqual((await socket.settings.auth.keys.get('lid-mapping', ['contact-key']))['contact-key'], secret);
  assert.equal([...pool.saved.values()].some(row => row.includes(secret)), false);
  socket.ev.emit('connection.update', { connection: 'open' });
  assert.deepEqual(await bridge.connect(), { state: 'connected', phone: '5511000000001' });
  assert.deepEqual(bridge.scope(), { sector: 'tecnologia', phoneId: 'baileys:5511000000001' });
  await bridge.close();
  assert.equal(socket.ended, true);

  const locked = harness(pool, { ...config, authKey: Buffer.alloc(32, 17) });
  await locked.bridge.initialize();
  assert.equal(locked.bridge.status().state, 'error');
  assert.equal(locked.sockets.length, 0);
  await locked.bridge.close();

  const resumed = harness(pool);
  t.after(() => resumed.bridge.close());
  await resumed.bridge.initialize();
  assert.equal(resumed.sockets.length, 1);
  assert.deepEqual(resumed.sockets[0].settings.auth.creds.noiseKey.private, secret);
  assert.deepEqual(resumed.bridge.scope(), bridge.scope());
  assert.equal((await resumed.bridge.disconnect()).state, 'disconnected');
  assert.equal(resumed.sockets[0].loggedOut, true);
  assert.equal(pool.saved.size, 0);
  assert.equal(resumed.bridge.scope(), null);
});

test('Baileys preserva escopo, registra somente chats diretos novos e envia texto a uma conversa', async (t) => {
  const { bridge, sockets, received, deliveries } = harness();
  t.after(() => bridge.close());
  await bridge.initialize();
  await bridge.connect();
  const [socket] = sockets;
  socket.ev.emit('connection.update', { connection: 'open' });
  const message = (remoteJid, id, fromMe = false) => ({ key: { remoteJid, id, fromMe },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Contato de teste', message: { conversation: 'Mensagem recebida' } });
  socket.ev.emit('messages.upsert', { type: 'append', messages: [message(peer, 'history')] });
  socket.ev.emit('messages.upsert', { type: 'notify', messages: [message(peerLid, 'direct'), message('100@g.us', 'group'),
    message('55555@lid', 'unknown-lid'), message(peer, 'own', true)] });
  await bridge.connect();
  assert.deepEqual(received.map(({ item }) => [item.phone, item.providerId, item.type]), [['5511000000002', 'direct', 'text']]);
  const sent = await bridge.send('5511000000002', 'Mensagem de teste', clientId, bridge.scope());
  assert.equal(sent.status, 'accepted');
  assert.equal(socket.sent.jid, peer);
  assert.equal(socket.sent.content.text, 'Mensagem de teste');
  assert.equal(socket.sent.sendOptions.messageId, sent.providerId);
  socket.ev.emit('messages.update', [{ key: { fromMe: true, remoteJid: peer, id: sent.providerId },
    update: { status: baileys.WAMessageStatus.DELIVERY_ACK } }]);
  await bridge.connect();
  assert.deepEqual(deliveries.map(({ item }) => [item.status, item.rank, item.clientId]), [['delivered', 3, clientId]]);
  const previous = await bridge.send('5511000000002', 'Conta trocada', clientId, { phoneId: 'baileys:5511000000003' });
  assert.equal(previous.status, 'failed');
  assert.equal(socket.sent.content.text, 'Mensagem de teste');
});

test('Baileys cancela o QR pendente sem desvincular, inclusive quando a leitura acaba de ser confirmada', async (t) => {
  const { bridge, sockets, pool } = harness();
  t.after(() => bridge.close());
  await bridge.initialize();
  await bridge.connect();
  const [pending] = sockets;
  pending.ev.emit('connection.update', { qr: 'test-pending-qr' });
  assert.equal((await bridge.connect()).state, 'qr');
  assert.deepEqual(await bridge.cancel(), { state: 'disconnected', phone: null });
  assert.equal(pending.ended, true);
  assert.equal(pending.loggedOut, undefined);

  await bridge.connect();
  const scanned = sockets[1];
  const cancellation = bridge.cancel();
  scanned.ev.emit('creds.update', { me: { id: self }, account: { details: Buffer.from('signed QR identity') } });
  await cancellation;
  assert.equal(scanned.ended, undefined);
  scanned.ev.emit('connection.update', { connection: 'open' });
  assert.deepEqual(await bridge.cancel(), { state: 'connected', phone: '5511000000001' });
  assert.equal(scanned.loggedOut, undefined);
  await bridge.close();

  const restored = harness(pool);
  t.after(() => restored.bridge.close());
  await restored.bridge.initialize();
  assert.equal(restored.sockets.length, 1);
  assert.deepEqual(restored.bridge.scope(), { sector: 'tecnologia', phoneId: 'baileys:5511000000001' });
});
