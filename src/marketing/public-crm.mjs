import { ApiError } from '../api/validation.mjs';
import { escapeHtml, verifiedDeliveryEvent } from './delivery.mjs';
import { isIP } from 'node:net';

const LANDING = /^\/inscricao\/([a-z0-9][a-z0-9-]{0,99})$/;
const EMAIL_ACTION = /^\/crm\/(confirmar|descadastrar)\/([a-zA-Z0-9_-]{24,128})$/;
const UNSUBSCRIBE_PREVIEW = /^\/crm\/descadastro\/([a-z0-9][a-z0-9-]{0,99})$/;
const WEBHOOK = '/v1/marketing/resend/webhook';
const PAGE_EVENTS = '/crm/pagina/eventos';
const WINDOW_MS = 15 * 60_000;

function page(res, { title, description, body = '', status = 200, landing = false, tracking = false, remoteImages = landing }) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin',
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'x-robots-tag': 'noindex, nofollow',
    'content-security-policy': `default-src 'none'; img-src 'self'${remoteImages ? ' https:' : ''}; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'${tracking ? "; script-src 'self'; connect-src 'self'" : ''}`,
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
  .landing-block h2+p,.landing-block p+.landing-button{margin-top:12px}.landing-block h2+form,.landing-block p+form{margin-top:14px}
  .landing-block ul{padding-inline-start:24px;text-align:left;margin:0}.landing-block li+li{margin-top:4px}.landing-hero{background:#f9f1f4}.landing-quote blockquote{margin:0;padding-inline-start:16px;border-inline-start:3px solid #a9647a}.landing-quote cite{display:block;font-size:.85em;margin-top:6px}
  .landing-links{display:flex;flex-wrap:wrap;gap:9px}.landing-links a{display:inline-block;font-weight:650}.landing-site-preview{padding:10px 14px;border:1px solid #ead9df;border-radius:10px;color:#61182d;font-size:14px;line-height:1.45}.landing-block .landing-site-preview{margin-block:0 12px}
  .landing-button{display:inline-block;text-decoration:none;padding:10px 16px;background:#831e32;color:white;font-weight:650;border-radius:9px}.landing-button:focus-visible,button:focus-visible{outline:2px solid #38303a;outline-offset:3px}
  button:disabled{opacity:.55;cursor:not-allowed}
  .landing-privacy{padding:13px;border:1px solid #ead9df;border-radius:11px;margin:6px 0 22px;font-size:14px}.landing-privacy p{margin:0 0 8px}
  .landing-privacy div{display:flex;flex-wrap:wrap;gap:8px}.landing-privacy button{font-size:13px}.landing-privacy button+button{background:#f1e5e9;color:#61182d}
</style><main${landing ? ' class="landing"' : ''}><header><img src="/maximum-logo.png" alt="Maximum Assessoria Contábil" width="512" height="107" referrerpolicy="no-referrer"></header>${landing ? '' : `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>`}${body}</main>
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

function blockLink(value, { anchor = false, local = true } = {}) {
  const source = String(value || '').trim();
  if (anchor && /^#[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(source)) return source;
  if (local && /^\/(?!\/)[^\\\u0000-\u0020]*$/.test(source)) return source;
  if (!/^https:\/\//i.test(source) || !URL.canParse(source)) return '';
  const url = new URL(source);
  return !url.username && !url.password && url.protocol === 'https:' ? url.href : '';
}

function blockStyle(block) {
  const align = ['left', 'center', 'right'].includes(block.align) ? block.align : 'left';
  const styles = [`text-align:${align}`];
  for (const [value, property] of [[block.color, 'color'], [block.background, 'background-color'], [block.borderColor, 'border-color']]) {
    if (!/^#[a-f\d]{6}$/i.test(value)) continue;
    if (property === 'border-color') styles.push('border-width:1px', 'border-style:solid');
    styles.push(`${property}:${value}`);
  }
  for (const [value, property, min, max] of [
    [block.fontSize, 'font-size', 12, 64], [block.padding, 'padding', 0, 64], [block.margin, 'margin-block', 0, 64],
    [block.borderRadius, 'border-radius', 0, 48], [block.maxWidth, 'max-width', 200, 1_200],
  ]) {
    if (Number.isInteger(value) && value >= min && value <= max) {
      styles.push(`${property}:${value}px`);
      if (property === 'max-width') styles.push('margin-inline:auto');
      if (property === 'font-size') styles.push(`--crm-block-size:${value}px`);
    }
  }
  if (typeof block.lineHeight === 'number' && block.lineHeight >= 1.1 && block.lineHeight <= 2) {
    const size = Math.round(block.lineHeight * 10) / 10;
    styles.push(`line-height:${size}`, `--crm-block-line-height:${size}`);
  }
  const weights = { normal: 400, medium: 500, bold: 700 };
  if (Object.hasOwn(weights, block.fontWeight)) styles.push(`font-weight:${weights[block.fontWeight]}`, `--crm-block-weight:${weights[block.fontWeight]}`);
  if (block.type === 'spacer') styles.push(`min-height:${Number.isInteger(block.padding) && block.padding >= 0 && block.padding <= 64 ? block.padding : 24}px`, 'padding:0');
  return styles.join(';');
}

function heading(value) {
  return value ? `<h2 style="font-size:var(--crm-block-size,clamp(22px,5vw,34px));font-weight:var(--crm-block-weight,700);line-height:var(--crm-block-line-height,1.16)">${escapeHtml(value)}</h2>` : '';
}

function anchor(url, label, className = '') {
  return url ? `<a href="${escapeHtml(url)}"${className ? ` class="${className}"` : ''} rel="noreferrer">${escapeHtml(label)}</a>` : '';
}

function listItems(value) {
  return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 48);
}

function unsubscribeForm(pathname, label, preview = false) {
  if (preview) return '<p class="landing-site-preview">O descadastro é confirmado pelo link individual enviado por e-mail.</p>' +
    `<button type="button" disabled>${escapeHtml(label)}</button>`;
  return `<form action="${escapeHtml(pathname)}" method="post"><button type="submit">${escapeHtml(label)}</button></form>`;
}

function blockContent(pathname, landing, block, { ref, unsubscribe, preview }) {
  const title = block.title || block.text;
  const paragraph = value => value ? `<p>${escapeHtml(value)}</p>` : '';
  const url = blockLink(block.url, { anchor: ['hero', 'button'].includes(block.type), local: block.type !== 'video' });
  switch (block.type) {
    case 'heading': return heading(title);
    case 'text': return paragraph(block.text || block.title);
    case 'hero': return heading(block.title) + paragraph(block.text) + anchor(url, block.linkLabel || 'Saiba mais', 'landing-button');
    case 'image': {
      if (!url || (unsubscribe && !url.startsWith('/'))) return '';
      const image = `<img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt)}" referrerpolicy="no-referrer" loading="lazy">`;
      const linkUrl = blockLink(block.linkUrl, { anchor: true });
      return linkUrl ? `<a href="${escapeHtml(linkUrl)}" rel="noreferrer" aria-label="${escapeHtml(block.alt || 'Abrir link da imagem')}">${image}</a>` : image;
    }
    case 'button': return anchor(url, title || 'Saiba mais', 'landing-button');
    case 'video': return heading(block.title) + paragraph(block.text) + anchor(url, 'Assistir ao vídeo', 'landing-button');
    case 'quote': return `<blockquote>${paragraph(block.text || block.title)}${block.title && block.text ? `<cite>${escapeHtml(block.title)}</cite>` : ''}</blockquote>`;
    case 'list': return heading(block.title) + `<ul>${listItems(block.text).map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
    case 'links': return heading(block.title) + `<div class="landing-links">${listItems(block.text).map(line => {
      const separator = line.indexOf('|');
      return separator > 0 ? anchor(blockLink(line.slice(separator + 1), { local: false }), line.slice(0, separator).trim()) : '';
    }).join('')}</div>`;
    case 'divider': return '<hr>';
    case 'spacer': return '<span aria-hidden="true"></span>';
    case 'form': return unsubscribe ? '' : heading(block.title) + landingForm(pathname, { ...landing, buttonText: block.text || landing.buttonText }, ref, block.id);
    case 'unsubscribe': return unsubscribe ? heading(block.title) + unsubscribeForm(pathname, block.text || landing.buttonText || 'Cancelar inscrição', preview) : '';
    default: return '';
  }
}

function landingBlock(pathname, landing, block, options = {}) {
  const content = blockContent(pathname, landing, block, options);
  if (!content) return '';
  const reserved = { form: 'inscricao', unsubscribe: 'descadastro' };
  const identifier = reserved[block.type] || (Object.values(reserved).includes(block.id) ? `bloco-${block.id}` : block.id);
  const marker = options.unsubscribe ? '' : ` data-crm-block="${escapeHtml(block.id)}"`;
  return `<section id="${escapeHtml(identifier)}" class="landing-block landing-${escapeHtml(block.type)}"${marker} style="${blockStyle(block)}">${content}</section>`;
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
    ${custom ? landing.blocks.map(block => landingBlock(pathname, landing, block, { ref })).join('') :
      `<section id="inscricao" class="landing-block" data-crm-block="legacy-form">${landingForm(pathname, landing, ref)}</section>`}</div>`;
}

function unsubscribeBody(pathname, design, { preview = false } = {}) {
  const blocks = Array.isArray(design.blocks) ? design.blocks : [];
  const rendered = blocks.map(block => landingBlock(pathname, design, block, { unsubscribe: true, preview })).join('');
  const fallback = blocks.some(block => block.type === 'unsubscribe') ? '' :
    `<section class="landing-block" id="descadastro">${unsubscribeForm(pathname, design.buttonText || 'Cancelar inscrição', preview)}</section>`;
  return `<div><h1>${escapeHtml(design.title)}</h1>${design.description ? `<p>${escapeHtml(design.description)}</p>` : ''}${rendered}${fallback}</div>`;
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
    if (req.method === 'GET') {
      if (!confirm) {
        let design;
        try { design = await store.publicUnsubscribePage?.(token); }
        catch { logger.error('Falha ao carregar o design de descadastro do CRM.'); }
        if (design) return page(res, { title: design.title, body: unsubscribeBody(pathname, design), landing: true, remoteImages: false });
      }
      return page(res, { title,
        description: confirm ? 'Confirme para receber nossos conteúdos e novidades.' : 'Confirme para deixar de receber nossas campanhas por e-mail.',
        body: unsubscribeForm(pathname, title) });
    }
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

  async function handleUnsubscribePreview(req, res, pathname, slug) {
    if (req.method !== 'GET') return page(res, { title: 'Operação indisponível', description: 'Confirme pelo link individual de descadastro recebido por e-mail.', status: 405 });
    const design = await store.publicUnsubscribePreview?.(slug);
    if (!design) return page(res, { title: 'Página indisponível', description: 'Esta página de descadastro não está publicada.', status: 404 });
    return page(res, { title: design.title, body: unsubscribeBody(pathname, design, { preview: true }), landing: true, remoteImages: false });
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
    const unsubscribePreview = UNSUBSCRIBE_PREVIEW.exec(pathname);
    const webhook = pathname === WEBHOOK;
    const event = pathname === PAGE_EVENTS;
    if (!landing && !emailAction && !unsubscribePreview && !webhook && !event) return false;
    try {
      if (landing) await handleLanding(req, res, pathname, landing[1]);
      else if (emailAction) await handleEmailAction(req, res, pathname, emailAction[1], emailAction[2]);
      else if (unsubscribePreview) await handleUnsubscribePreview(req, res, pathname, unsubscribePreview[1]);
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
