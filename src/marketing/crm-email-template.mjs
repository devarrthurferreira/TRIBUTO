const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}

function safeUrl(value, origin) {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\\]/.test(value)) return '';
  if (/^\/(?!\/)/.test(value)) return origin ? new URL(value, origin).href : value;
  if (!URL.canParse(value)) return '';
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
}

export function emailBody(content) {
  return String(content || '').split(/(https:\/\/[^\s<>"']+)/g).map((part, index) => {
    const url = index % 2 && safeUrl(part);
    if (url) return `<a href="${escapeHtml(url)}">${escapeHtml(part)}</a>`;
    return escapeHtml(part).replace(/\r?\n/g, '<br>');
  }).join('');
}

function color(value, fallback) {
  return /^#[a-f0-9]{6}$/i.test(value || '') ? value : fallback;
}

function linkButton(label, url, background = '#7d1e39', foreground = '#ffffff') {
  if (!url) return '';
  return `<a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;background-color:${background};color:${foreground};border-radius:7px;text-decoration:none;font-size:15px;font-weight:bold;line-height:1.4">${escapeHtml(label)}</a>`;
}

function dimension(value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function destination(value, action, origin) {
  return typeof value === 'string' && value.startsWith('#') ? action : safeUrl(value, origin);
}

function lines(value) {
  return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

// Keep queued v1 messages byte-compatible with Resend's existing idempotency keys.
function renderLegacyBlock(block, { action, origin }) {
  const text = block.title || block.text || '';
  const align = ['left', 'center', 'right'].includes(block.align) ? block.align : 'left';
  const foreground = color(block.color, '#33212c');
  const background = color(block.background, '#ffffff');
  let contents = '';
  switch (block.type) {
    case 'heading':
      contents = `<h2 style="margin:0;font-size:26px;line-height:1.25">${escapeHtml(text)}</h2>`;
      break;
    case 'text':
      contents = `<p style="margin:0;font-size:16px;line-height:1.55">${emailBody(block.text || text)}</p>`;
      break;
    case 'image': {
      const url = safeUrl(block.url, origin);
      if (url) contents = `<img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt || '')}" style="width:100%;max-width:520px;height:auto;display:inline-block;border:0">`;
      break;
    }
    case 'button':
      contents = linkButton(text || 'Saiba mais', destination(block.url, action, origin) || action);
      break;
    case 'form':
      contents = linkButton(text || 'Abrir formulário de inscrição', action);
      break;
    case 'divider':
      contents = `<hr style="margin:0;border:0;border-top:1px solid ${color(block.color, '#e5d5de')}">`;
      break;
    default:
  }
  return contents ? `<tr><td align="${align}" style="padding:12px 24px;background-color:${background};color:${foreground}">${contents}</td></tr>` : '';
}

function renderBlock(block, { action, unsubscribe, origin }) {
  const text = block.title || block.text || '';
  const align = ['left', 'center', 'right'].includes(block.align) ? block.align : 'left';
  const foreground = color(block.color, '#33212c');
  const background = color(block.background, '#ffffff');
  const fontSize = dimension(block.fontSize, 12, 64, block.type === 'heading' ? 26 : block.type === 'hero' ? 32 : 16);
  const lineHeight = dimension(block.lineHeight, 1.1, 2, 1.5);
  const padding = dimension(block.padding, 0, 64, 12);
  const margin = dimension(block.margin, 0, 64, 0);
  const maxWidth = dimension(block.maxWidth, 200, 1200, 520);
  const radius = dimension(block.borderRadius, 0, 48, 0);
  const border = color(block.borderColor, '');
  const weight = block.fontWeight === 'bold' ? 700 : block.fontWeight === 'medium' ? 500 : block.fontWeight === 'normal' ? 400 : 0;
  const copyStyle = `margin:0;font-size:${fontSize}px;line-height:${lineHeight}${weight ? `;font-weight:${weight}` : ''}`;
  const label = block.title ? `<p style="${copyStyle};font-weight:700;margin-bottom:6px">${escapeHtml(block.title)}</p>` : '';
  let contents = '';
  switch (block.type) {
    case 'heading':
      contents = `<h2 style="${copyStyle}">${escapeHtml(text)}</h2>`;
      break;
    case 'text':
      contents = `<p style="${copyStyle}">${emailBody(block.text || text)}</p>`;
      break;
    case 'image': {
      const url = safeUrl(block.url, origin);
      if (url) {
        const target = destination(block.linkUrl, action, origin);
        const img = `<img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt || '')}" style="width:100%;max-width:${Math.min(maxWidth, 600)}px;height:auto;display:inline-block;border:0;border-radius:${radius}px">`;
        contents = target ? `<a href="${escapeHtml(target)}" style="display:block;text-decoration:none">${img}</a>` : img;
      }
      break;
    }
    case 'button':
      contents = linkButton(text || 'Saiba mais', destination(block.url, action, origin) || action);
      break;
    case 'form':
      contents = linkButton(block.text || block.title || 'Abrir formulário de inscrição', action);
      break;
    case 'unsubscribe':
      contents = unsubscribe ? `<a style="color:${foreground};font-size:${fontSize}px" href="${escapeHtml(unsubscribe)}">${escapeHtml(text || 'Cancelar inscrição')}</a>` : '';
      break;
    case 'divider':
      contents = `<hr style="margin:0;border:0;border-top:1px solid ${color(block.color, '#e5d5de')}">`;
      break;
    case 'hero': {
      const url = destination(block.url, action, origin);
      const description = block.text ? `<p style="margin:10px 0 0;font-size:${Math.min(fontSize, 19)}px;line-height:${lineHeight}">${emailBody(block.text)}</p>` : '';
      contents = `<h2 style="${copyStyle}">${escapeHtml(block.title || '')}</h2>${description}${url ? `<p style="margin:14px 0 0">${linkButton(block.linkLabel || 'Saiba mais', url)}</p>` : ''}`;
      break;
    }
    case 'quote':
      contents = `<blockquote style="${copyStyle};padding-left:12px;border-left:3px solid ${border || '#c98ca0'}">${emailBody(block.text)}</blockquote>${block.title ? `<p style="margin:6px 0 0;font-size:13px">${escapeHtml(block.title)}</p>` : ''}`;
      break;
    case 'list':
      contents = `${label}<ul style="${copyStyle};display:inline-block;text-align:left;padding-left:22px">${lines(block.text).slice(0, 25).map(item => `<li>${emailBody(item)}</li>`).join('')}</ul>`;
      break;
    case 'spacer':
      contents = `<div aria-hidden="true" style="font-size:1px;line-height:${Math.max(1, padding)}px">&nbsp;</div>`;
      break;
    case 'video':
      contents = linkButton(text || 'Assistir ao vídeo', safeUrl(block.url, origin));
      break;
    case 'links':
      contents = label + lines(block.text).slice(0, 12).map(part => {
        const separator = part.indexOf('|');
        const url = separator > 0 && safeUrl(part.slice(separator + 1).trim(), origin);
        return url ? `<a href="${escapeHtml(url)}" style="color:${foreground};display:inline-block;padding:4px 8px;text-decoration:underline">${escapeHtml(part.slice(0, separator).trim())}</a>` : '';
      }).join('');
      break;
    default:
  }
  if (!contents) return '';
  const gap = margin ? `<tr><td height="${margin}" style="height:${margin}px;font-size:1px;line-height:${margin}px">&nbsp;</td></tr>` : '';
  const box = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:${Math.min(maxWidth, 600)}px"><tr><td align="${align}" style="padding:${padding}px;background-color:${background};color:${foreground};border-radius:${radius}px${border ? `;border:1px solid ${border}` : ''}">${contents}</td></tr></table>`;
  return `${gap}<tr><td align="${align}" style="padding:0 12px">${box}</td></tr>`;
}

export function buildCrmEmailMarkup({ subject, content, blocks, action: rawAction, unsubscribe: rawUnsubscribe, origin, legacy = false } = {}) {
  const action = safeUrl(rawAction, origin);
  const unsubscribe = safeUrl(rawUnsubscribe, origin);
  const render = legacy ? renderLegacyBlock : renderBlock;
  const rows = (Array.isArray(blocks) ? blocks : []).slice(0, 60).filter(block => block && typeof block.type === 'string')
    .map(block => render(block, { action, unsubscribe, origin })).join('');
  const intro = content ? `<tr><td style="padding:20px 24px;font-size:16px;line-height:1.55">${emailBody(content)}</td></tr>` : '';
  const cta = action ? `<tr><td align="center" style="padding:20px 24px 26px">${linkButton('Acessar a página completa', action)}</td></tr>` : '';
  const optOut = unsubscribe ? `<tr><td align="center" style="padding:12px 24px 20px;font-size:12px;color:#6b5564"><a style="color:#6b5564" href="${escapeHtml(unsubscribe)}">Cancelar inscrição</a></td></tr>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background-color:#f9f3f6"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f9f3f6"><tr><td align="center" style="padding:20px 8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#ffffff;color:#33212c;font-family:Arial,Helvetica,sans-serif">${intro}${rows}${cta}${optOut}</table></td></tr></table></body></html>`;
}
