import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  createSmtpTransport, createSmtpNotificationsRouter, processSmtpDelivery, resolvePinnedSmtp,
} from '../src/notifications/smtp-delivery.mjs';
import { HONORARIUM_RECIPIENTS, smtpSettingsFields } from '../src/notifications/smtp-store.mjs';

const fakeSettings = {
  enabled: true, host: 'smtp.test.example', port: 587, username: 'equipe', password: 'secret-for-test-only',
  senderEmail: 'envios@example.com', senderName: 'Maximum',
};
const job = {
  id: 'c5910d8a-a49b-4b64-b39b-03cc4747334f', recipient: HONORARIUM_RECIPIENTS[0].email, allowed: true, attempts: 1,
  message: { subject: 'Honorários v1', text: 'Somente honorários', html: '<p>Somente honorários</p>', attachments: ['ignored'] },
};

test('valida portas e nomes SMTP e não conecta a DNS com endereço privado', async () => {
  assert.deepEqual(smtpSettingsFields(fakeSettings), fakeSettings);
  for (const host of ['localhost', '127.1', 'https://smtp.example.com', 'mail.example.com/path', 'smtp\r\n.example.com']) {
    assert.throws(() => smtpSettingsFields({ ...fakeSettings, host }), { code: 'SMTP_SETTINGS' });
  }
  assert.throws(() => smtpSettingsFields({ ...fakeSettings, port: 25 }), { code: 'SMTP_SETTINGS' });
  for (const address of ['10.1.2.3', '100.100.100.200', '169.254.169.254', '127.0.0.1', '192.168.1.2',
    '192.0.0.192', '198.18.0.1', '::ffff:44.55.66.77', '::1', 'fe80::1', 'fd00::1', '2001:db8::1', '2002:a01:203::1']) {
    await assert.rejects(resolvePinnedSmtp(fakeSettings.host, async () => [{ address, family: address.includes(':') ? 6 : 4 }]));
  }
  await assert.rejects(resolvePinnedSmtp(fakeSettings.host, async () => [
    { address: '8.8.8.8', family: 4 }, { address: '192.168.1.1', family: 4 },
  ]));
  assert.deepEqual(await resolvePinnedSmtp(fakeSettings.host, async () => [
    { address: '2606:4700::1111', family: 6 }, { address: '8.8.8.8', family: 4 },
  ]), { address: '8.8.8.8', family: 4 });
});

test('transporte usa IP fixado, TLS verificado e somente o destinatário fixo da entrega', async () => {
  let connection;
  let options;
  let outbound;
  let destroyed = false;
  const transport = createSmtpTransport({
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    connectSocket(args) {
      connection = args;
      const socket = new EventEmitter();
      socket.destroy = () => { destroyed = true; };
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    },
    createTransport(next) {
      options = next;
      return {
        sendMail(message) {
          outbound = message;
          return new Promise((resolve, reject) => next.getSocket({}, error => error
            ? reject(error) : resolve({ accepted: [job.recipient] })));
        },
        close() {},
      };
    },
  });
  await transport.send(fakeSettings, job);
  assert.deepEqual(connection, { host: '8.8.8.8', port: 587, family: 4 });
  assert.deepEqual(options.tls, { servername: fakeSettings.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
  assert.equal(options.forceAuth, true);
  assert.equal(outbound.to, job.recipient);
  assert.equal(outbound.text, job.message.text);
  assert(!outbound.attachments && !outbound.cc && !outbound.bcc);
  assert.equal(destroyed, true);
  await assert.rejects(transport.send(fakeSettings, { ...job, recipient: 'fora@example.com' }));
});

test('fila aguarda configuração, repete rejeição transitória e preserva resultado incerto', async () => {
  let settings;
  let current = job;
  const deliveries = [];
  const store = {
    recoverExpired() {},
    credentials() { return settings; },
    claimDelivery() { return current; },
    finishDelivery(job, status, when) { deliveries.push({ id: job.id, status, when }); },
  };
  assert.equal(await processSmtpDelivery(store, {}), false);
  settings = fakeSettings;
  const failure = extra => ({ send: async () => { throw Object.assign(new Error('not logged'), extra); } });
  assert.equal(await processSmtpDelivery(store, failure({ responseCode: 451 })), true);
  assert.equal(deliveries.at(-1).status, 'queued');
  assert(deliveries.at(-1).when > new Date());
  assert.equal(await processSmtpDelivery(store, failure({ code: 'ETIMEDOUT', command: 'CONN' })), true);
  assert.equal(deliveries.at(-1).status, 'uncertain');
  assert.equal(deliveries.at(-1).when, null);
  assert.equal(await processSmtpDelivery(store, failure({ responseCode: 550 })), true);
  assert.equal(deliveries.at(-1).status, 'failed');
  assert.equal(await processSmtpDelivery(store, { send: async () => {} }), true);
  assert.equal(deliveries.at(-1).status, 'sent');
  current = { ...job, allowed: false };
  assert.equal(await processSmtpDelivery(store, { send: async () => assert.fail('address outside recipients') }), true);
  assert.equal(deliveries.at(-1).status, 'failed');
});

test('rota SMTP exige administração da Tecnologia e nunca retorna senha', async () => {
  let accessed = false;
  const settings = { ...fakeSettings, password: undefined };
  const router = createSmtpNotificationsRouter({
    settings() { accessed = true; return settings; },
    queueCounts() { return {}; },
    credentials() { return fakeSettings; },
  }, { transport: { verify: async () => true } });
  const context = { req: { method: 'GET' }, route: '/notifications/smtp', send: (_res, status, body) => ({ status, body }) };
  await assert.rejects(router.handleHttp({ ...context, user: { role: 'member', active: true, moduleGrants: { tecnologia: 'edit' } } }), { code: 'FORBIDDEN' });
  assert.equal(accessed, false);
  const user = { _id: 'a', active: true, role: 'admin' };
  const result = await router.handleHttp({ ...context, user });
  assert.equal(result.status, 200);
  assert.equal(result.body.recipients.length, 5);
  assert(!JSON.stringify(result.body).includes(fakeSettings.password));
  assert.deepEqual(await router.handleHttp({ ...context, user, req: { method: 'POST' }, route: '/notifications/smtp/verify' }),
    { status: 200, body: { ok: true } });
});
