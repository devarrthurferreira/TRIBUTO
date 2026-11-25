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

function renderBlock(block, action, origin) {
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
      contents = linkButton(text || 'Saiba mais', block.url?.startsWith('#') ? action : safeUrl(block.url, origin) || action, '#7d1e39', '#ffffff');
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

export function buildCrmEmailMarkup({ subject, content, blocks, action: rawAction, unsubscribe: rawUnsubscribe, origin } = {}) {
  const action = safeUrl(rawAction, origin);
  const unsubscribe = safeUrl(rawUnsubscribe, origin);
  const rows = (Array.isArray(blocks) ? blocks : []).slice(0, 60).filter(block => block && typeof block.type === 'string')
    .map(block => renderBlock(block, action, origin)).join('');
  const intro = content ? `<tr><td style="padding:20px 24px;font-size:16px;line-height:1.55">${emailBody(content)}</td></tr>` : '';
  const cta = action ? `<tr><td align="center" style="padding:20px 24px 26px">${linkButton('Acessar a página completa', action)}</td></tr>` : '';
  const optOut = unsubscribe ? `<tr><td align="center" style="padding:12px 24px 20px;font-size:12px;color:#6b5564"><a style="color:#6b5564" href="${escapeHtml(unsubscribe)}">Cancelar inscrição</a></td></tr>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background-color:#f9f3f6"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f9f3f6"><tr><td align="center" style="padding:20px 8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#ffffff;color:#33212c;font-family:Arial,Helvetica,sans-serif">${intro}${rows}${cta}${optOut}</table></td></tr></table></body></html>`;
}
