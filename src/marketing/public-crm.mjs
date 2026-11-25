import { ApiError } from '../api/validation.mjs';
import { escapeHtml, verifiedDeliveryEvent } from './delivery.mjs';
import { isIP } from 'node:net';

const LANDING = /^\/inscricao\/([a-z0-9][a-z0-9-]{0,99})$/;
const EMAIL_ACTION = /^\/crm\/(confirmar|descadastrar)\/([a-zA-Z0-9_-]{24,128})$/;
const WEBHOOK = '/v1/marketing/resend/webhook';
const PAGE_EVENTS = '/crm/pagina/eventos';
const WINDOW_MS = 15 * 60_000;

function page(res, { title, description, body = '', status = 200, landing = false, tracking = false }) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin',
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'x-robots-tag': 'noindex, nofollow',
    'content-security-policy': `default-src 'none'; img-src 'self'${landing ? ' https:' : ''}; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'${tracking ? "; script-src 'self'; connect-src 'self'" : ''}`,
  });
  res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | Maximum Contábil</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f9f3f4;color:#32212a;font:16px/1.55 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px}
  main{width:min(100%,550px);background:white;border:1px solid #eddfe3;border-radius:22px;padding:clamp(23px,6vw,52px);box-shadow:0 22px 60px #5d21301c;overflow-wrap:anywhere}
  header{display:inline-grid;background:#731b2c;border-radius:10px;padding:12px}header img{display:block;width:146px;height:auto}h1{margin:22px 0 8px;font-size:clamp(25px,6vw,38px);line-height:1.15}p{white-space:pre-line;color:#604e58}
  form{display:grid;gap:16px;margin-top:24px;text-align:left}label{display:grid;gap:6px;font-weight:600}input:not([type=checkbox]){font:inherit;padding:10px 12px;width:100%;border:1px solid #bdacb5;border-radius:8px}label.consent{display:flex;align-items:flex-start;gap:9px;font-size:14px;font-weight:400}
  button{font:inherit;font-weight:700;padding:11px 16px;background:#831e32;color:white;border:0;border-radius:9px;cursor:pointer}a{color:#832036}small{color:#604e58}
  main.landing{width:min(100%,800px);padding:clamp(18px,5vw,44px)}.landing header{margin-bottom:17px}.landing>h1{margin-top:7px}
  .landing-block{display:block;border-radius:12px;padding:clamp(9px,3vw,20px);margin:6px 0}.landing-block h2{margin:0;font-size:clamp(22px,5vw,34px);line-height:1.16}
  .landing-block p{color:inherit;margin:0}.landing-block img{max-width:100%;height:auto;border-radius:11px;vertical-align:middle}.landing-block hr{border:0;border-top:1px solid #d9cbd1}
  .landing-button{display:inline-block;text-decoration:none;padding:10px 16px;background:#831e32;color:white;font-weight:650;border-radius:9px}.landing-button:focus-visible,button:focus-visible{outline:2px solid #38303a;outline-offset:3px}
  .landing-privacy{padding:13px;border:1px solid #ead9df;border-radius:11px;margin:6px 0 22px;font-size:14px}.landing-privacy p{margin:0 0 8px}
  .landing-privacy div{display:flex;flex-wrap:wrap;gap:8px}.landing-privacy button{font-size:13px}.landing-privacy button+button{background:#f1e5e9;color:#61182d}
</style><main${landing ? ' class="landing"' : ''}><header><img src="/maximum-logo.png" alt="Maximum Assessoria Contábil" width="512" height="107"></header>${landing ? '' : `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>`}${body}</main>
${tracking ? '<script src="/crm-page-tracking.js" defer></script>' : ''}</html>`);
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

function acceptCapture(map, address, limit = 20) {
  const now = Date.now();
  if (map.size >= 5_000) {
    for (const [key, bucket] of map) if (bucket.expires <= now) map.delete(key);
    if (map.size >= 5_000 && !map.has(address)) return false;
  }
  const current = map.get(address);
  const bucket = !current || current.expires <= now ? { count: 0, expires: now + WINDOW_MS } : current;
  bucket.count += 1;
  map.set(address, bucket);
  return bucket.count <= limit;
}

function clientAddress(req) {
  const direct = req.socket.remoteAddress || 'unknown';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(direct)) return direct;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim();
  return isIP(forwarded) ? forwarded : direct;
}

function landingForm(pathname, landing, ref, blockId = 'legacy-form') {
  const reference = /^[a-zA-Z0-9_-]{24,128}$/.test(ref || '') ? ref : '';
  return `<form action="${escapeHtml(pathname)}" method="post">
    <label>Seu nome <input name="name" maxlength="120" autocomplete="name"></label>
    <label>Seu e-mail <input name="email" type="email" maxlength="254" autocomplete="email" required></label>
    <div hidden><label>Site <input name="website" maxlength="100" tabindex="-1" autocomplete="off"></label></div>
    <label class="consent"><input name="consent" type="checkbox" value="yes" required><span>Aceito receber conteúdos e ofertas da Maximum Contábil por e-mail. Posso cancelar a inscrição a qualquer momento.</span></label>
    <input type="hidden" name="ref" value="${escapeHtml(reference)}">
    <input type="hidden" name="visit" value="">
    <input type="hidden" name="block" value="${escapeHtml(blockId)}">
    <button type="submit">${escapeHtml(landing.buttonText || 'Quero me inscrever')}</button>
  </form>`;
}

function blockLink(value, type) {
  const source = String(value || '').trim();
  if (type === 'button' && /^#[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(source)) return source;
  if (/^\/(?!\/)[^\\\u0000-\u0020]*$/.test(source)) return source;
  if (!/^https:\/\//i.test(source) || !URL.canParse(source)) return '';
  const url = new URL(source);
  return !url.username && !url.password && url.protocol === 'https:' ? url.href : '';
}

function landingBlock(pathname, landing, block, ref) {
  const align = ['left', 'center', 'right'].includes(block.align) ? block.align : 'left';
  const color = /^#[a-f\d]{6}$/i.test(block.color) ? `color:${block.color};` : '';
  const background = /^#[a-f\d]{6}$/i.test(block.background) ? `background:${block.background};` : '';
  const url = blockLink(block.url, block.type);
  let content = '';
  if (block.type === 'heading') content = `<h2>${escapeHtml(block.title || block.text)}</h2>`;
  else if (block.type === 'text') content = `<p>${escapeHtml(block.text || block.title)}</p>`;
  else if (block.type === 'image' && url) content = `<img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt)}" referrerpolicy="no-referrer" loading="lazy">`;
  else if (block.type === 'button' && url) content = `<a class="landing-button" href="${escapeHtml(url)}" rel="noreferrer">${escapeHtml(block.title || block.text || 'Saiba mais')}</a>`;
  else if (block.type === 'divider') content = '<hr>';
  else if (block.type === 'form') content = `${block.title ? `<h2>${escapeHtml(block.title)}</h2>` : ''}
    ${landingForm(pathname, { ...landing, buttonText: block.text || landing.buttonText }, ref, block.id)}`;
  const anchor = block.type === 'form' ? 'inscricao' : block.id === 'inscricao' ? 'bloco-inscricao' : block.id;
  return content ? `<section id="${escapeHtml(anchor)}" class="landing-block" data-crm-block="${escapeHtml(block.id)}" style="text-align:${align};${color}${background}">${content}</section>` : '';
}

function landingBody(pathname, landing, ref, tracked) {
  const identity = tracked && /^[a-f0-9]{64}$/.test(ref || '') ? `<aside class="landing-privacy" data-crm-choice hidden aria-label="Identificação na visita">
    <p>Este link veio de um e-mail da Maximum. Você pode associar seus cliques e o tempo de uso ao contato que recebeu o e-mail.</p>
    <div><button type="button" data-crm-identify>Permitir identificação</button><button type="button" data-crm-decline>Continuar sem identificação</button></div>
  </aside>` : '';
  const custom = Array.isArray(landing.blocks);
  return `<div data-crm-landing data-slug="${escapeHtml(landing.slug || pathname.slice('/inscricao/'.length))}">
    <div${custom ? '' : ' data-crm-block="page-intro"'}><h1>${escapeHtml(landing.title)}</h1>${landing.description
      ? `<p>${escapeHtml(landing.description)}</p>` : ''}</div>${identity}
    ${custom ? landing.blocks.map(block => landingBlock(pathname, landing, block, ref)).join('') :
      `<section id="inscricao" class="landing-block" data-crm-block="legacy-form">${landingForm(pathname, landing, ref)}</section>`}</div>`;
}

export function createPublicCrmRouter(store, mail, logger = console) {
  const captures = new Map();
  const measurements = new Map();
  async function handleLanding(req, res, pathname, slug) {
    const landing = await store.publicLanding(slug);
    if (!landing) return page(res, { title: 'Página indisponível', description: 'Essa página de inscrição não está disponível.', status: 404 });
    if (req.method === 'GET') {
      const ref = new URL(req.url, 'http://localhost').searchParams.get('ref');
      const tracking = Boolean(store.pageAnalytics);
      return page(res, { title: landing.title, body: landingBody(pathname, landing, ref, tracking), landing: true, tracking });
    }
    if (req.method !== 'POST') return page(res, { title: 'Operação indisponível', description: 'Abra a página de inscrição.', status: 405 });
    sameSiteForm(req);
    if (!acceptCapture(captures, clientAddress(req))) throw new ApiError(429, 'CRM_CAPTURE_LIMIT', 'Muitas tentativas. Tente novamente em alguns minutos.');
    const data = new URLSearchParams((await readBytes(req, 4_096, 'application/x-www-form-urlencoded')).toString('utf8'));
    if (!data.get('website')) {
      const capture = await store.captureLanding(slug, { email: data.get('email'), name: data.get('name') || '', consent: data.get('consent') === 'yes',
        conversionToken: data.get('ref') || undefined }, { includeLead: true });
      if (capture?.leadId && store.pageAnalytics) {
        try {
          await store.pageAnalytics.recordSubmission(landing, { leadId: capture.leadId, visitToken: data.get('visit'), blockId: data.get('block') });
        } catch { logger.error('Falha ao registrar conversão da página de captura.'); }
      }
    }
    return page(res, { title: 'Pedido recebido', description: mail ? 'Se o endereço for elegível, enviaremos um e-mail para confirmar a inscrição.' : 'Seu pedido de inscrição foi registrado.' });
  }

  async function handlePageEvent(req, res) {
    if (req.method !== 'POST' || !store.pageAnalytics) { res.writeHead(404); return res.end(); }
    sameSiteForm(req);
    const body = await readBytes(req, 10_240, 'application/json');
    let input;
    try { input = JSON.parse(body); } catch { throw new ApiError(400, 'CRM_PAGE_EVENT_INVALID', 'Evento de página inválido.'); }
    if (typeof input?.slug !== 'string' || !LANDING.test(`/inscricao/${input.slug}`)) {
      throw new ApiError(400, 'CRM_PAGE_EVENT_INVALID', 'Evento de página inválido.');
    }
    const fresh = input.operation === 'start';
    const address = clientAddress(req) + (fresh ? ':start' : ':measure');
    if (!acceptCapture(measurements, address, fresh ? 100 : 4_000)) {
      throw new ApiError(429, 'CRM_PAGE_EVENT_LIMIT', 'Limite de eventos atingido.');
    }
    const landing = await store.publicLanding(input.slug);
    if (!landing) { res.writeHead(404); return res.end(); }
    await store.pageAnalytics.record(landing, input);
    res.writeHead(204, { 'cache-control': 'no-store' });
    return res.end();
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
    const event = pathname === PAGE_EVENTS;
    if (!landing && !emailAction && !webhook && !event) return false;
    try {
      if (landing) await handleLanding(req, res, pathname, landing[1]);
      else if (emailAction) await handleEmailAction(req, res, pathname, emailAction[1], emailAction[2]);
      else if (event) await handlePageEvent(req, res);
      else await handleWebhook(req, res);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      if (status >= 500) logger.error('Falha em um endpoint público do CRM.');
      if (webhook || event) { res.writeHead(status); res.end(); }
      else page(res, { title: 'Não foi possível concluir', description: status < 500 ? error.message : 'Houve uma falha temporária. Tente novamente em instantes.', status });
    }
    return true;
  };
}
