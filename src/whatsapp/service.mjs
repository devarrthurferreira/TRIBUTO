import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { canAccess, MODULES } from '../platform/policy.mjs';

const WHATSAPP_WEBHOOK = '/v1/whatsapp/webhook';
const SECTORS = new Set(MODULES.map(({ id }) => id));
const PHONE = /^[1-9]\d{6,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEQUENCE = /^[1-9]\d{0,19}$/;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const GRAPH_DEADLINE = 12_000;
const TYPES = Object.freeze({
  audio: 'Áudio recebido',
  button: 'Resposta de botão recebida',
  contacts: 'Contato recebido',
  document: 'Documento recebido',
  image: 'Imagem recebida',
  interactive: 'Resposta interativa recebida',
  location: 'Localização recebida',
  reaction: 'Reação recebida',
  sticker: 'Figurinha recebida',
  video: 'Vídeo recebido'
});
const DELIVERY = Object.freeze({ sent: 1, failed: 2, delivered: 3, read: 4 });

const isUuid = (value) => typeof value === 'string' && UUID.test(value);
const isPhone = (value) => typeof value === 'string' && PHONE.test(value);
const isSequence = (value) => typeof value === 'string' && SEQUENCE.test(value) && BigInt(value) <= 18446744073709551615n;
const isProviderId = (value) => typeof value === 'string' && /^[\x21-\x7e]{1,255}$/.test(value);
const array = (value) => Array.isArray(value) ? value : [];
const invalid = (field) => new ApiError(400, 'WHATSAPP_INVALID_INPUT', `Campo inválido: ${field}`);
const unavailable = () => new ApiError(404, 'WHATSAPP_UNAVAILABLE', 'WhatsApp não configurado para este setor.');

function hasSecret(value, min = 16) {
  return typeof value === 'string' && value.length >= min && value.length <= 4096 && /^[\x21-\x7e]+$/.test(value);
}

// The recipient sector is set by the operator and never trusted from Meta or the browser.
export function readWhatsAppConfig(env = process.env) {
  const { WHATSAPP_PHONE_NUMBER_ID: phoneId, WHATSAPP_SECTOR: sector, WHATSAPP_ACCESS_TOKEN: token,
    WHATSAPP_APP_SECRET: secret, WHATSAPP_VERIFY_TOKEN: verifyToken, WHATSAPP_GRAPH_VERSION: graphVersion } = env;
  if (typeof phoneId !== 'string' || !/^\d{5,32}$/.test(phoneId) || !SECTORS.has(sector)
    || !hasSecret(token, 20) || !hasSecret(secret) || !hasSecret(verifyToken)
    || typeof graphVersion !== 'string' || !/^v[1-9]\d?\.0$/.test(graphVersion)) return null;
  return { phoneId, sector, token, secret, verifyToken, graphVersion };
}

function requestTime(value, now) {
  if (typeof value !== 'string' || !/^\d{10}$/.test(value)) return null;
  const timestamp = Number(value) * 1000;
  if (timestamp > now + 5 * 60_000) return null;
  return new Date(Math.min(now, timestamp));
}

function inboundItem(raw, contacts, now) {
  if (!raw || !isPhone(raw.from) || !isProviderId(raw.id)) return null;
  const at = requestTime(raw.timestamp, now);
  if (!at) return null;
  const name = contacts.get(raw.from);
  const type = raw.type === 'text' || Object.hasOwn(TYPES, raw.type) ? raw.type : 'other';
  const text = type === 'text' && typeof raw.text?.body === 'string' ? raw.text.body.trim().slice(0, 4096) : '';
  return {
    providerId: raw.id, phone: raw.from, name: typeof name === 'string' ? name.trim().slice(0, 120) : '',
    type, text: text || (type === 'text' ? 'Mensagem sem texto' : TYPES[type] || 'Mensagem recebida'), at
  };
}

function deliveryItem(raw) {
  if (!raw || !isPhone(raw.recipient_id) || !isProviderId(raw.id) || !Object.hasOwn(DELIVERY, raw.status)) return null;
  return { phone: raw.recipient_id, providerId: raw.id, status: raw.status, rank: DELIVERY[raw.status],
    clientId: isUuid(raw.biz_opaque_callback_data) ? raw.biz_opaque_callback_data : null };
}

function authorizedSignature(header, secret, payload) {
  if (typeof header !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  return timingSafeEqual(Buffer.from(header.slice(7), 'hex'), expected);
}

function sameSecret(actual, expected) {
  if (typeof actual !== 'string' || actual.length > 4096) return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

async function readRawWebhook(req) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) {
    throw new ApiError(415, 'CONTENT_TYPE', 'Use application/json');
  }
  const parts = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new ApiError(413, 'WHATSAPP_BODY_TOO_LARGE', 'Evento acima de 3 MB.');
    parts.push(chunk);
  }
  return Buffer.concat(parts, length);
}

function plainResponse(res, value) {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(value);
}

export function createWhatsAppService({ config, store, bridge, workspace, fetcher = fetch }) {
  async function handleWebhook(req, res, pathname) {
    if (pathname !== WHATSAPP_WEBHOOK) return false;
    if (!config) throw unavailable();
    if (req.method === 'GET') {
      const query = new URL(req.url, 'http://localhost').searchParams;
      const challenge = query.get('hub.challenge');
      if (query.get('hub.mode') !== 'subscribe' || !/^\d{1,90}$/.test(challenge || '')
        || !sameSecret(query.get('hub.verify_token'), config.verifyToken)) {
        throw new ApiError(403, 'WHATSAPP_VERIFY', 'Verificação indisponível.');
      }
      plainResponse(res, challenge);
      return true;
    }
    if (req.method !== 'POST') throw unavailable();
    if (typeof req.headers['x-hub-signature-256'] !== 'string') {
      throw new ApiError(403, 'WHATSAPP_SIGNATURE', 'Assinatura inválida.');
    }
    const payload = await readRawWebhook(req);
    if (!authorizedSignature(req.headers['x-hub-signature-256'], config.secret, payload)) {
      throw new ApiError(403, 'WHATSAPP_SIGNATURE', 'Assinatura inválida.');
    }
    let event;
    try { event = JSON.parse(payload.toString('utf8')); }
    catch { throw new ApiError(400, 'INVALID_JSON', 'JSON inválido'); }
    if (event?.object === 'whatsapp_business_account') {
      const now = Date.now();
      for (const entry of array(event.entry)) {
        for (const change of array(entry?.changes)) {
          const value = change?.value;
          if (change?.field !== 'messages' || value?.metadata?.phone_number_id !== config.phoneId) continue;
          const contacts = new Map(array(value.contacts).map(contact => [contact?.wa_id, contact?.profile?.name]));
          for (const raw of array(value.messages)) {
            const item = inboundItem(raw, contacts, now);
            if (item) await store.recordInbound(config, item);
          }
          for (const raw of array(value.statuses)) {
            const item = deliveryItem(raw);
            if (item) await store.recordDelivery(config, item);
          }
        }
      }
    }
    plainResponse(res, 'OK');
    return true;
  }

  async function sendExternal(phone, text, clientId) {
    const unknown = { providerId: null, status: 'uncertain', rank: 0 };
    try {
      const response = await fetcher(`https://graph.facebook.com/${config.graphVersion}/${config.phoneId}/messages`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(GRAPH_DEADLINE),
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: phone,
          type: 'text', text: { body: text }, biz_opaque_callback_data: clientId })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        return response.status >= 400 && response.status < 500
          ? { providerId: null, status: 'failed', rank: 2 } : unknown;
      }
      const providerId = data?.messages?.[0]?.id;
      if (!isProviderId(providerId)) return unknown;
      return { providerId, status: 'accepted', rank: 1 };
    } catch {
      return unknown;
    }
  }

  async function handleHttp({ req, res, route, user, send, readBody }) {
    const query = new URL(req.url, 'http://localhost').searchParams;
    const input = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : null;
    const sector = input?.sector ?? query.get('sector');
    if (!SECTORS.has(sector)) throw invalid('sector');
    if (!canAccess(user, sector)) throw new ApiError(403, 'WHATSAPP_FORBIDDEN', 'Sem acesso ao WhatsApp deste setor.');
    const canManage = user.role === 'admin';
    const sectorBridge = bridge?.sector === sector ? bridge : null;
    const scope = (sectorBridge?.scope() || (config?.sector === sector ? config : null));
    const configured = Boolean(scope);
    const provider = sectorBridge || !config ? 'baileys' : 'cloud';
    if (route === '/whatsapp/connections') {
      let unlinkConfirmed;
      if (req.method === 'POST') {
        if (!canManage) throw new ApiError(403, 'WHATSAPP_FORBIDDEN', 'Somente administradores podem gerenciar conexões.');
        if (!sectorBridge) throw unavailable();
        if (input.action === 'connect') await sectorBridge.connect();
        else if (input.action === 'cancel') await sectorBridge.cancel();
        else if (input.action === 'disconnect') {
          const wasLinked = Boolean(sectorBridge.scope());
          const result = await sectorBridge.disconnect();
          if (wasLinked) unlinkConfirmed = result?.unlinkConfirmed;
        }
        else throw invalid('action');
      } else if (req.method !== 'GET') throw unavailable();
      const data = sectorBridge ? await sectorBridge.status({ includeQr: canManage }) : { state: configured ? 'connected' : 'disabled' };
      return send(res, 200, { canManage, unlinkConfirmed, connection: { ...data, status: data.state, provider } });
    }
    const connectionState = sectorBridge ? (await sectorBridge.status()).state : configured ? 'connected' : 'disabled';
    const result = await workspace?.handle({ route, method: req.method, user, sector, input, scope, connectionState,
      provider: provider === 'baileys' ? 'Baileys' : 'WhatsApp Cloud API' });
    if (result) return send(res, 200, result);
    const absence = configured ? await workspace?.absence(sector) : null;
    const canReply = configured && !absence?.enabled && connectionState === 'connected' && canAccess(user, sector, 'edit');
    const canManageTickets = configured && canAccess(user, sector, 'edit');
    if (req.method === 'GET' && route === '/whatsapp') {
      if (!configured) return send(res, 200, { configured, provider, canReply, canManage, conversations: [], unread: 0, hasMore: false });
      const rawPage = query.get('page') ?? '1';
      if (!/^[1-9]\d{0,3}$/.test(rawPage)) throw invalid('page');
      const result = await store.listConversations(scope, user._id, (Number(rawPage) - 1) * 50, { enforceWindow: !sectorBridge });
      const conversations = result.conversations.map((item) => ({ ...item, canReply: item.canReply && canReply }));
      return send(res, 200, { ...result, configured, provider, canReply, canManage, canManageTickets, absence,
        conversations: workspace ? await workspace.decorate(conversations) : conversations });
    }
    if (!configured) throw unavailable();
    const conversation = input?.conversation ?? query.get('conversation');
    if (!isUuid(conversation)) throw invalid('conversation');
    if (req.method === 'GET' && route === '/whatsapp/messages') {
      const before = query.get('before');
      if (before !== null && !isSequence(before)) throw invalid('before');
      const result = await store.history(scope, conversation, before, { enforceWindow: !sectorBridge });
      if (!result) throw new ApiError(404, 'WHATSAPP_CONVERSATION', 'Conversa indisponível.');
      return send(res, 200, { ...result, canReply: result.canReply && canReply });
    }
    if (req.method === 'POST' && route === '/whatsapp/read') {
      if (!isSequence(input.through)) throw invalid('through');
      if (!await store.markRead(scope, user._id, conversation, input.through)) {
        throw new ApiError(404, 'WHATSAPP_CONVERSATION', 'Conversa ou mensagem indisponível.');
      }
      return send(res, 200, { ok: true });
    }
    if (req.method !== 'POST' || route !== '/whatsapp/reply') throw unavailable();
    if (!canReply) throw new ApiError(403, 'WHATSAPP_FORBIDDEN', absence?.enabled ? 'As respostas estão pausadas pelo controle de ausência.' : 'Envio indisponível para este acesso ou conexão.');
    if (!isUuid(input.clientId)) throw invalid('clientId');
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text || text.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw invalid('text');
    const reserved = await store.reserveReply(scope, conversation, { actorId: user._id, clientId: input.clientId, text, enforceWindow: !sectorBridge });
    if (reserved.reason === 'missing') throw new ApiError(404, 'WHATSAPP_CONVERSATION', 'Conversa indisponível.');
    if (reserved.reason === 'closed') throw new ApiError(409, 'WHATSAPP_WINDOW_CLOSED', 'A janela de atendimento de 24 horas foi encerrada.');
    if (reserved.reason === 'conflict') throw new ApiError(409, 'WHATSAPP_DUPLICATE', 'Identificador já utilizado.');
    if (!reserved.fresh) return send(res, 200, { message: reserved.message });
    const delivery = sectorBridge ? await sectorBridge.send(reserved.phone, text, input.clientId, scope) : await sendExternal(reserved.phone, text, input.clientId);
    const message = await store.finishReply(conversation, input.clientId, delivery);
    return send(res, 201, { message });
  }

  return { handleWebhook, handleHttp };
}
