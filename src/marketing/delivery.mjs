import { createHmac, timingSafeEqual } from 'node:crypto';
import { buildCrmEmailMarkup, emailBody, escapeHtml } from './crm-email-template.mjs';

export { escapeHtml } from './crm-email-template.mjs';

const RESEND_EMAILS = 'https://api.resend.com/emails';
const DELIVERY_TYPES = new Map([
  ['email.sent', 'sent'], ['email.delivered', 'delivered'], ['email.opened', 'opened'], ['email.clicked', 'clicked'],
  ['email.bounced', 'failed'], ['email.failed', 'failed'], ['email.complained', 'failed'], ['email.suppressed', 'failed'],
]);
const DELAYS = [60_000, 300_000, 1_800_000, 3_600_000];

export function readCrmMailConfig(env = process.env) {
  if (env.CRM_EMAIL_PROVIDER !== 'resend') return null;
  const apiKey = env.CRM_RESEND_API_KEY?.trim();
  const from = env.CRM_EMAIL_FROM?.trim();
  const publicUrl = env.CRM_PUBLIC_URL?.trim();
  if (!apiKey || !from || /[\r\n]/.test(from) || !from.includes('@') || !URL.canParse(publicUrl)) return null;
  const url = new URL(publicUrl);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) return null;
  const secret = /^whsec_([A-Za-z0-9+/]+=*)$/.exec(env.CRM_RESEND_WEBHOOK_SECRET?.trim() || '');
  return { apiKey, from, origin: url.origin, webhookKey: secret ? Buffer.from(secret[1], 'base64') : null };
}

function messageFor(config, job) {
  const unsubscribe = job.kind !== 'confirmation' && job.unsubscribeToken && `${config.origin}/crm/descadastrar/${encodeURIComponent(job.unsubscribeToken)}`;
  const confirmation = job.confirmationToken && `${config.origin}/crm/confirmar/${encodeURIComponent(job.confirmationToken)}`;
  const landing = /^\/inscricao\/[a-z0-9-]{1,100}$/.test(job.destinationPath || '') && job.trackingToken
    ? `${config.origin}${job.destinationPath}?ref=${encodeURIComponent(job.trackingToken)}` : '';
  const action = confirmation || landing;
  const actionLabel = confirmation ? 'Confirmar inscrição' : 'Acessar página da campanha';
  const blockCopy = Array.isArray(job.emailPublication?.blocks) ? job.emailPublication.blocks
    .filter(block => block.type === 'heading' || block.type === 'text')
    .map(block => block.type === 'heading' ? block.title || block.text : block.text || block.title) : [];
  const text = [job.content, ...blockCopy, action && `${actionLabel}: ${action}`, unsubscribe && `Cancelar inscrição: ${unsubscribe}`].filter(Boolean).join('\n\n');
  const html = job.emailPublication ? buildCrmEmailMarkup({ subject: job.subject, content: job.content, blocks: job.emailPublication.blocks,
    action, unsubscribe, origin: config.origin }) : [`<p>${emailBody(job.content)}</p>`, action && `<p><a href="${escapeHtml(action)}">${actionLabel}</a></p>`,
    unsubscribe && `<p><a href="${escapeHtml(unsubscribe)}">Cancelar inscrição</a></p>`].filter(Boolean).join('');
  return { from: config.from, to: [job.email], subject: job.subject, text, html,
    ...(unsubscribe && { headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }) };
}

class DeliveryError extends Error {
  constructor(retryable) { super('E-mail não aceito pelo provedor'); this.retryable = retryable; }
}

export async function sendCrmEmail(config, job, fetchEmail = fetch) {
  const response = await fetchEmail(RESEND_EMAILS, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `maximum-crm/${job.id}` },
    body: JSON.stringify(messageFor(config, job)),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new DeliveryError(response.status >= 500 || [408, 429].includes(response.status)
    || (response.status === 409 && result.name === 'concurrent_idempotent_requests'));
  if (typeof result.id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(result.id)) throw new DeliveryError(true);
  return result.id;
}

export function startCrmDelivery(store, config, logger = console) {
  if (!config) return async () => {};
  let stopped = false;
  let timer;
  let running;
  async function deliverNext() {
    const job = await store.claimDelivery();
    if (!job || job.skipped) return;
    if (!await store.validateDeliveryClaim(job.id, job.claim)) return;
    let providerId;
    try {
      providerId = await sendCrmEmail(config, job);
    } catch (error) {
      const delay = error.retryable === false ? null : DELAYS[job.attempts - 1];
      await store.failDelivery(job.id, job.claim, { retryAt: delay ? new Date(Date.now() + delay) : null });
      return;
    }
    await store.completeDelivery(job.id, job.claim, providerId);
  }
  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      running = deliverNext().catch(() => logger.error('Falha ao processar a fila de e-mail do CRM.')).finally(schedule);
    }, 1_400);
    timer.unref();
  }
  schedule();
  return async () => { stopped = true; clearTimeout(timer); await running; };
}

export function verifiedDeliveryEvent(key, headers, raw, now = Date.now()) {
  if (!key?.length) return null;
  const id = headers['svix-id'];
  const stamp = headers['svix-timestamp'];
  const signature = headers['svix-signature'];
  if (typeof id !== 'string' || !/^[\w-]{1,150}$/.test(id) || typeof stamp !== 'string' || !/^\d{10}$/.test(stamp)
    || Math.abs(now - Number(stamp) * 1_000) > 300_000 || typeof signature !== 'string' || signature.length > 2_048) return null;
  const expected = createHmac('sha256', key).update(`${id}.${stamp}.`).update(raw).digest();
  const valid = signature.split(/\s+/).some((part) => {
    if (!/^v1,[A-Za-z0-9+/]{43}=$/.test(part)) return false;
    return timingSafeEqual(expected, Buffer.from(part.slice(3), 'base64'));
  });
  if (!valid) return null;
  try {
    const event = JSON.parse(raw);
    const type = DELIVERY_TYPES.get(event.type);
    const providerId = event.data?.email_id;
    return type && typeof providerId === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(providerId) ? { providerId, type } : {};
  } catch { return null; }
}
