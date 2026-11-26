import { lookup } from 'node:dns/promises';
import { BlockList, connect, isIP } from 'node:net';
import nodemailer from 'nodemailer';
import { ApiError } from '../api/validation.mjs';
import { canPerform } from '../platform/policy.mjs';
import { HONORARIUM_RECIPIENTS, smtpSettingsFields } from './smtp-store.mjs';

const denied = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) denied.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  denied.addSubnet(address, prefix, 'ipv6');
}
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

const recipients = new Set(HONORARIUM_RECIPIENTS.map(person => person.email));
const RETRY_DELAYS = [60_000, 5 * 60_000, 30 * 60_000];

class MailFailure extends Error {
  constructor(outcome) { super('Falha de envio SMTP.'); this.outcome = outcome; }
}

function publicAddress(address) {
  const version = isIP(address);
  if (version === 4) return !denied.check(address, 'ipv4');
  return version === 6 && !address.includes('%') && globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
}

export async function resolvePinnedSmtp(host, resolve = lookup) {
  let addresses;
  let deadline;
  try {
    addresses = await Promise.race([
      resolve(host, { all: true }),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new MailFailure('retry')), 9_000); }),
    ]);
  } catch {
    throw new MailFailure('retry');
  } finally { clearTimeout(deadline); }
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new MailFailure('failed');
  return addresses.find(({ family }) => family === 4) ?? addresses[0];
}

export function smtpFailureOutcome(error) {
  if (error instanceof MailFailure) return error.outcome;
  const code = Number(error?.responseCode);
  if (code >= 400 && code <= 499) return 'retry';
  if (code >= 500 && code <= 599) return 'failed';
  if (['EDNS', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error?.code)) return 'retry';
  if (['EAUTH', 'ENOAUTH', 'ETLS', 'EENVELOPE', 'EREQUIRETLS'].includes(error?.code)) return 'failed';
  // Timeout or connection loss after DATA can follow server acceptance.
  return 'uncertain';
}

export function createSmtpTransport({ resolve = lookup, createTransport = nodemailer.createTransport, connectSocket = connect } = {}) {
  async function perform(settings, action) {
    const { address, family } = await resolvePinnedSmtp(settings.host, resolve);
    if (settings.port !== 465 && settings.port !== 587) throw new MailFailure('failed');
    let socket;
    let deadline;
    const transport = createTransport({
      host: address, port: settings.port, secure: settings.port === 465, requireTLS: settings.port === 587,
      servername: settings.host, tls: { servername: settings.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      auth: { user: settings.username, pass: settings.password }, forceAuth: true,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      disableFileAccess: true, disableUrlAccess: true,
      getSocket(_options, callback) {
        // Connect once to the validated literal IP. Nodemailer upgrades this exact socket to TLS.
        socket = connectSocket({ host: address, port: settings.port, family });
        const failed = () => callback(new MailFailure('retry'));
        socket.once('error', failed);
        socket.once('connect', () => {
          socket.removeListener('error', failed);
          callback(null, { connection: socket });
        });
      },
    });
    try {
      return await Promise.race([
        action(transport),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new MailFailure('uncertain')), 35_000);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
      socket?.destroy();
      transport.close();
    }
  }

  return {
    verify(settings) { return perform(settings, transport => transport.verify()); },
    async send(settings, job) {
      if (!recipients.has(job.recipient)) throw new MailFailure('failed');
      const { subject, text, html } = job.message;
      const response = await perform(settings, transport => transport.sendMail({
        from: { name: settings.senderName, address: settings.senderEmail },
        to: job.recipient, subject, text, html,
        messageId: `<honorarios-${job.id}@maximumcontabil.com.br>`,
        disableFileAccess: true, disableUrlAccess: true,
      }));
      if (!response?.accepted?.some(address => address.toLowerCase() === job.recipient)) throw new MailFailure('uncertain');
    },
  };
}

export function createSmtpNotificationsRouter(store, { transport = createSmtpTransport() } = {}) {
  return {
    async handleHttp({ req, res, route, user, send, readBody }) {
      if (route !== '/notifications/smtp' && route !== '/notifications/smtp/verify') return false;
      if (!canPerform(user, 'tecnologia', 'smtpManage')) throw new ApiError(403, 'FORBIDDEN', 'Sem acesso aos envios da Tecnologia.');
      if (route === '/notifications/smtp') {
        if (req.method === 'GET' || req.method === 'PUT') {
          const settings = req.method === 'PUT'
            ? await store.saveSettings(smtpSettingsFields(await readBody(req, 8_000)), user._id)
            : await store.settings();
          return send(res, 200, { settings, recipients: HONORARIUM_RECIPIENTS, queue: await store.queueCounts() });
        }
      }
      if (route === '/notifications/smtp/verify' && req.method === 'POST') {
        let settings;
        try { settings = await store.credentials({ includeDisabled: true }); }
        catch { throw new ApiError(503, 'SMTP_UNAVAILABLE', 'Não foi possível abrir a credencial SMTP. Salve a senha novamente.'); }
        if (!settings) throw new ApiError(409, 'SMTP_NOT_CONFIGURED', 'Salve os dados da conta SMTP antes de testar.');
        try { await transport.verify(settings); }
        catch { throw new ApiError(422, 'SMTP_CONNECTION', 'Não foi possível autenticar no SMTP. Confira o servidor, a porta e a credencial.'); }
        return send(res, 200, { ok: true });
      }
      throw new ApiError(404, 'NOT_FOUND', 'Rota inexistente');
    },
  };
}

export async function processSmtpDelivery(store, transport = createSmtpTransport()) {
  await store.recoverExpired();
  const settings = await store.credentials();
  if (!settings) return false;
  const job = await store.claimDelivery();
  if (!job) return false;
  let status = 'sent';
  let next = null;
  if (!job.allowed) status = 'failed';
  else {
    try { await transport.send(settings, job); }
    catch (error) {
      const outcome = smtpFailureOutcome(error);
      if (outcome === 'retry') {
        const delay = RETRY_DELAYS[job.attempts - 1];
        status = delay ? 'queued' : 'failed';
        if (delay) next = new Date(Date.now() + delay);
      } else status = outcome;
    }
  }
  await store.finishDelivery(job, status, next);
  return true;
}

export function startSmtpDelivery(store, { transport = createSmtpTransport(), logger = console, pollMs = 4_000 } = {}) {
  let stopped = false;
  let timer;
  let running;
  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      running = processSmtpDelivery(store, transport)
        .catch(() => logger.error('Falha ao processar a fila de honorários.'))
        .finally(schedule);
    }, pollMs);
    timer.unref();
  }
  schedule();
  return async () => { stopped = true; clearTimeout(timer); await running; };
}
