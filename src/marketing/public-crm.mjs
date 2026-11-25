import { ApiError } from '../api/validation.mjs';
import { escapeHtml, verifiedDeliveryEvent } from './delivery.mjs';
import { isIP } from 'node:net';

const LANDING = /^\/inscricao\/([a-z0-9][a-z0-9-]{0,99})$/;
const EMAIL_ACTION = /^\/crm\/(confirmar|descadastrar)\/([a-zA-Z0-9_-]{24,128})$/;
const WEBHOOK = '/v1/marketing/resend/webhook';
const WINDOW_MS = 15 * 60_000;

function page(res, { title, description, body = '', status = 200 }) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin',
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'x-robots-tag': 'noindex, nofollow',
    'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | Maximum Contábil</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f9f3f4;color:#32212a;font:16px/1.55 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px}
  main{width:min(100%,550px);background:white;border:1px solid #eddfe3;border-radius:22px;padding:clamp(23px,6vw,52px);box-shadow:0 22px 60px #5d21301c;overflow-wrap:anywhere}
  header{display:inline-grid;background:#731b2c;border-radius:10px;padding:12px}header img{display:block;width:146px;height:auto}h1{margin:22px 0 8px;font-size:clamp(25px,6vw,38px);line-height:1.15}p{white-space:pre-line;color:#604e58}
  form{display:grid;gap:16px;margin-top:24px}label{display:grid;gap:6px;font-weight:600}input:not([type=checkbox]){font:inherit;padding:10px 12px;width:100%;border:1px solid #bdacb5;border-radius:8px}label.consent{display:flex;align-items:flex-start;gap:9px;font-size:14px;font-weight:400}
  button{font:inherit;font-weight:700;padding:11px 16px;background:#831e32;color:white;border:0;border-radius:9px;cursor:pointer}a{color:#832036}small{color:#604e58}
</style><main><header><img src="/maximum-logo.png" alt="Maximum Assessoria Contábil" width="512" height="107"></header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>${body}</main></html>`);
}

async function readBytes(req, max, expectedType) {
  if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== expectedType) {
    throw new ApiError(415, 'CRM_PUBLIC_CONTENT_TYPE', 'Formato da solicitação inválido.');
  }
  const parts = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) throw new ApiError(413, 'CRM_PUBLIC_BODY_SIZE', 'Solicitação acima do limite.');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

function sameSiteForm(req) {
  const site = req.headers['sec-fetch-site'];
  if (site === 'same-origin') return;
  if (site === 'cross-site') throw new ApiError(403, 'CRM_PUBLIC_ORIGIN', 'Origem da solicitação inválida.');
  const origin = req.headers.origin;
  if (origin && (!URL.canParse(origin) || new URL(origin).host.toLowerCase() !== String(req.headers.host).toLowerCase())) {
    throw new ApiError(403, 'CRM_PUBLIC_ORIGIN', 'Origem da solicitação inválida.');
  }
}

function acceptCapture(map, address) {
  const now = Date.now();
  if (map.size >= 5_000) {
    for (const [key, bucket] of map) if (bucket.expires <= now) map.delete(key);
    if (map.size >= 5_000 && !map.has(address)) return false;
  }
  const current = map.get(address);
  const bucket = !current || current.expires <= now ? { count: 0, expires: now + WINDOW_MS } : current;
  bucket.count += 1;
  map.set(address, bucket);
  return bucket.count <= 20;
}

function clientAddress(req) {
  const direct = req.socket.remoteAddress || 'unknown';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(direct)) return direct;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim();
  return isIP(forwarded) ? forwarded : direct;
}

function landingForm(pathname, landing, ref) {
  const reference = /^[a-zA-Z0-9_-]{24,128}$/.test(ref || '') ? ref : '';
  return `<form action="${escapeHtml(pathname)}" method="post">
    <label>Seu nome <input name="name" maxlength="120" autocomplete="name"></label>
    <label>Seu e-mail <input name="email" type="email" maxlength="254" autocomplete="email" required></label>
    <div hidden><label>Site <input name="website" maxlength="100" tabindex="-1" autocomplete="off"></label></div>
    <label class="consent"><input name="consent" type="checkbox" value="yes" required><span>Aceito receber conteúdos e ofertas da Maximum Contábil por e-mail. Posso cancelar a inscrição a qualquer momento.</span></label>
    <input type="hidden" name="ref" value="${escapeHtml(reference)}">
    <button type="submit">${escapeHtml(landing.buttonText || 'Quero me inscrever')}</button>
  </form>`;
}

export function createPublicCrmRouter(store, mail, logger = console) {
  const captures = new Map();
  async function handleLanding(req, res, pathname, slug) {
    const landing = await store.publicLanding(slug);
    if (!landing) return page(res, { title: 'Página indisponível', description: 'Essa página de inscrição não está disponível.', status: 404 });
    if (req.method === 'GET') {
      const ref = new URL(req.url, 'http://localhost').searchParams.get('ref');
      return page(res, { title: landing.title, description: landing.description, body: landingForm(pathname, landing, ref) });
    }
    if (req.method !== 'POST') return page(res, { title: 'Operação indisponível', description: 'Abra a página de inscrição.', status: 405 });
    sameSiteForm(req);
    if (!acceptCapture(captures, clientAddress(req))) throw new ApiError(429, 'CRM_CAPTURE_LIMIT', 'Muitas tentativas. Tente novamente em alguns minutos.');
    const data = new URLSearchParams((await readBytes(req, 4_096, 'application/x-www-form-urlencoded')).toString('utf8'));
    if (!data.get('website')) {
      await store.captureLanding(slug, { email: data.get('email'), name: data.get('name') || '', consent: data.get('consent') === 'yes',
        conversionToken: data.get('ref') || undefined });
    }
    return page(res, { title: 'Pedido recebido', description: mail ? 'Se o endereço for elegível, enviaremos um e-mail para confirmar a inscrição.' : 'Seu pedido de inscrição foi registrado.' });
  }

  async function handleEmailAction(req, res, pathname, action, token) {
    const confirm = action === 'confirmar';
    const title = confirm ? 'Confirmar inscrição' : 'Cancelar inscrição';
    if (req.method === 'GET') return page(res, { title,
      description: confirm ? 'Confirme para receber nossos conteúdos e novidades.' : 'Confirme para deixar de receber nossas campanhas por e-mail.',
      body: `<form action="${escapeHtml(pathname)}" method="post"><button type="submit">${title}</button></form>` });
    if (req.method !== 'POST') return page(res, { title: 'Operação indisponível', description: 'Abra o link recebido por e-mail.', status: 405 });
    const params = new URLSearchParams((await readBytes(req, 4_096, 'application/x-www-form-urlencoded')).toString('utf8'));
    const oneClick = !confirm && params.get('List-Unsubscribe') === 'One-Click';
    if (!oneClick) sameSiteForm(req);
    const completed = confirm ? await store.confirmLead(token) : await store.unsubscribe(token);
    if (!completed) return page(res, { title: 'Link indisponível', description: 'Esse link é inválido ou expirou.', status: 404 });
    if (oneClick) { res.writeHead(204); return res.end(); }
    return page(res, { title: confirm ? 'Inscrição confirmada' : 'Inscrição cancelada', description: confirm
      ? 'Você já pode receber as comunicações da Maximum Contábil.' : 'Este endereço foi retirado da lista de comunicações.' });
  }

  async function handleWebhook(req, res) {
    if (req.method !== 'POST' || !mail?.webhookKey?.length) { res.writeHead(404); return res.end(); }
    const body = await readBytes(req, 96_000, 'application/json');
    const event = verifiedDeliveryEvent(mail.webhookKey, req.headers, body);
    if (!event) { res.writeHead(400); return res.end(); }
    if (event.providerId) await store.trackDelivery(event.providerId, event.type);
    res.writeHead(204);
    return res.end();
  }

  return async (req, res, pathname) => {
    const landing = LANDING.exec(pathname);
    const emailAction = EMAIL_ACTION.exec(pathname);
    const webhook = pathname === WEBHOOK;
    if (!landing && !emailAction && !webhook) return false;
    try {
      if (landing) await handleLanding(req, res, pathname, landing[1]);
      else if (emailAction) await handleEmailAction(req, res, pathname, emailAction[1], emailAction[2]);
      else await handleWebhook(req, res);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      if (status >= 500) logger.error('Falha em um endpoint público do CRM.');
      if (webhook) { res.writeHead(status); res.end(); }
      else page(res, { title: 'Não foi possível concluir', description: status < 500 ? error.message : 'Houve uma falha temporária. Tente novamente em instantes.', status });
    }
    return true;
  };
}
