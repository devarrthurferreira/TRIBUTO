const PATH = '/marketing/crm';
const BLOCK_LIMIT = 48;
const BLOCKS = {
  hero: { name: 'Destaque', icon: 'megaphone', defaults: { title: 'Destaque da edição', text: 'Apresente a novidade principal.', color: '#ffffff', background: '#822039', padding: 28, borderRadius: 12 } },
  heading: { name: 'Título', icon: 'type', defaults: { title: 'Título da seção' } },
  text: { name: 'Texto', icon: 'journal-text', defaults: { text: 'Escreva aqui o conteúdo da seção.' } },
  image: { name: 'Imagem por link', icon: 'image', defaults: { align: 'center' } },
  button: { name: 'Botão', icon: 'link-45deg', defaults: { title: 'Saiba mais' } },
  quote: { name: 'Citação', icon: 'chat-square-text', defaults: { title: 'Fonte ou autor', text: 'Escreva uma citação ou destaque uma informação.', background: '#f8f0f3' } },
  list: { name: 'Lista', icon: 'list-task', defaults: { title: 'Nesta edição', text: 'Primeiro item\nSegundo item\nTerceiro item' } },
  video: { name: 'Link de vídeo', icon: 'play-fill', defaults: { title: 'Assistir ao vídeo' } },
  links: { name: 'Grupo de links', icon: 'arrow-up-right', defaults: { title: 'Mais conteúdos' } },
  divider: { name: 'Divisor', icon: 'dash-lg', defaults: {} },
  spacer: { name: 'Espaçador', icon: 'sliders', defaults: { padding: 14 } },
  form: { name: 'Formulário', icon: 'card-text', defaults: { title: 'Receba nossas novidades', text: 'Quero me inscrever' } },
  unsubscribe: { name: 'Descadastro', icon: 'envelope', defaults: { title: 'Prefere deixar de receber nossos e-mails?', text: 'Confirmar descadastro' } },
};
const NUMBER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const KINDS = { landing: 'Página de campanha', unsubscribe: 'Página de descadastro' };
const BUILTIN_TEMPLATES = [
  {
    name: 'Informativo', kind: 'landing', description: 'Capa, destaques e chamada para leitura.', title: 'Maximum Informa',
    blocks: [
      { type: 'hero', title: 'Maximum Informa', text: 'Novidades, orientações e lembretes da Maximum Contábil.', color: '#ffffff', background: '#822039', padding: 32, borderRadius: 12, fontSize: 34 },
      { type: 'heading', title: 'Nesta edição', color: '#822039' },
      { type: 'list', title: '', text: 'Orientações para sua empresa\nPrazos para acompanhar\nConteúdos para consultar' },
      { type: 'divider' },
      { type: 'heading', title: 'O que merece sua atenção', color: '#822039' },
      { type: 'text', text: 'Use esta seção para explicar a principal novidade da edição, quem é afetado e o que precisa ser feito.' },
      { type: 'quote', title: 'Fique de olho', text: 'Reserve este espaço para um aviso importante ou um prazo que mereça destaque.' },
      { type: 'heading', title: 'Acompanhe os próximos informativos', color: '#822039' },
      { type: 'form', title: 'Receba o Maximum Informa', text: 'Quero receber o informativo' },
    ],
  },
  {
    name: 'Página de inscrição', kind: 'landing', description: 'Apresentação, detalhes e formulário de inscrição.', title: 'Inscrições Maximum',
    blocks: [
      { type: 'hero', title: 'Inscrições abertas', text: 'Conte o que a pessoa vai receber ao se inscrever.', align: 'center' },
      { type: 'heading', title: 'O que você vai receber' },
      { type: 'list', title: '', text: 'Conteúdos práticos\nOrientações da equipe\nNovidades por e-mail' },
      { type: 'form', title: 'Faça sua inscrição', text: 'Quero me inscrever' },
    ],
  },
  {
    name: 'Descadastro de e-mails', kind: 'unsubscribe', description: 'Confirmação de saída da lista de envios.', title: 'Descadastro de e-mails',
    blocks: [
      { type: 'hero', title: 'Preferências de e-mail', text: 'Você pode escolher se quer continuar recebendo nossas comunicações.', align: 'center' },
      { type: 'unsubscribe', title: 'Cancelar inscrição', text: 'Confirmar descadastro', align: 'center' },
    ],
  },
];

const FONT_WEIGHTS = { '': 'Padrão', normal: 'Normal', medium: 'Médio', bold: 'Negrito' };
const STYLE_NUMBERS = [
  ['fontSize', 'Tamanho da fonte (px)', 12, 64], ['lineHeight', 'Altura da linha', 1.1, 2, 0.1],
  ['padding', 'Margem interna (px)', 0, 64], ['margin', 'Espaço vertical (px)', 0, 64],
  ['maxWidth', 'Largura máxima (px)', 200, 1200], ['borderRadius', 'Arredondamento (px)', 0, 48],
];

function el(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function icon(name) {
  const element = el('i', `bi bi-${name}`);
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function action(label, onClick, { symbol, kind, compact = false } = {}) {
  const button = el('button', `cpe-action${kind ? ` cpe-${kind}` : ''}${compact ? ' cpe-icon-button' : ''}`);
  button.type = 'button';
  if (symbol) button.append(icon(symbol));
  if (compact) { button.setAttribute('aria-label', label); button.title = label; }
  else button.append(document.createTextNode(label));
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function field(label, name, value, settings = {}) {
  const group = el('label', 'cpe-field');
  const input = el(settings.options ? 'select' : settings.multiline ? 'textarea' : 'input');
  input.name = name;
  input.autocomplete = 'off';
  if (settings.options) for (const [val, title] of Object.entries(settings.options)) input.append(new Option(title, val));
  else if (settings.multiline) input.rows = settings.multiline;
  else input.type = settings.type || 'text';
  if (settings.maxLength) input.maxLength = settings.maxLength;
  if (settings.placeholder) input.placeholder = settings.placeholder;
  for (const name of ['min', 'max', 'step']) if (settings[name] !== undefined) input[name] = settings[name];
  input.value = value ?? '';
  group.append(el('span', '', label), input);
  if (settings.hint) group.append(el('small', '', settings.hint));
  return { label: group, input };
}

function cleanSlug(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80).replace(/^-|-$/g, '');
}

function tagsFrom(value) {
  return value.split(',').map(tag => tag.trim()).filter(Boolean);
}

function newBlock(type, fields) {
  return { type, title: '', text: '', url: '', alt: '', align: 'left', color: '', background: '', ...BLOCKS[type].defaults, ...fields, id: crypto.randomUUID() };
}

function blankPage(kind = 'landing') {
  return { title: '', slug: '', description: '', buttonText: 'Quero me inscrever', tags: [], blocks: [], status: 'draft', kind };
}

function normalizePage(page) {
  return { ...blankPage(), ...page, tags: Array.isArray(page.tags) ? [...page.tags] : [], blocks: (page.blocks || []).map(block => ({ ...block })) };
}

function normalizeExistingPage(result) {
  const page = normalizePage(result);
  if (!page.legacyDesign) return page;
  const heading = { ...newBlock('heading'), title: page.title };
  const body = page.description ? [{ ...newBlock('text'), text: page.description }] : [];
  const form = { ...newBlock('form'), title: 'Inscreva-se', text: page.buttonText };
  return { ...page, blocks: [heading, ...body, form] };
}

function templateBlocks(template) {
  return (template.blocks || []).map(block => newBlock(block.type, block));
}

function templateKind(template) {
  return template.kind || (template.blocks?.some(block => block.type === 'unsubscribe') ? 'unsubscribe' : 'landing');
}

function duration(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  const whole = Math.round(value);
  return whole < 60 ? `${whole} s` : `${Math.floor(whole / 60)} min ${whole % 60} s`;
}

function safeHttps(value) {
  if (typeof value !== 'string' || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function safeImage(value) {
  if (typeof value === 'string' && /^\/(?![/\\])/.test(value) && !/[\s\\\u0000-\u001f\u007f]/u.test(value)) return value;
  return safeHttps(value);
}

function hex(value) {
  return /^#[a-f0-9]{6}$/i.test(value || '') ? value : '';
}

function linkRows(value) {
  return (value || '').split(/\r?\n/u).map(line => {
    const [label = '', url = ''] = line.split('|');
    return { label: label.trim(), url: safeHttps(url.trim()) };
  }).filter(row => row.label && row.url);
}

function previewCta(label, symbol) {
  const preview = el('span', 'cpe-preview-cta');
  if (symbol) preview.append(icon(symbol));
  preview.append(document.createTextNode(label));
  return preview;
}

function blockBody(block, submitLabel, kind) {
  const body = el('div', 'cpe-block-content');
  body.dataset.align = block.align || 'left';
  if (hex(block.color)) body.style.setProperty('--cpe-user-color', block.color);
  if (hex(block.background)) body.style.setProperty('--cpe-user-bg', block.background);
  if (hex(block.borderColor)) body.style.setProperty('--cpe-user-border', block.borderColor);
  const weights = { normal: '400', medium: '550', bold: '700' };
  if (weights[block.fontWeight]) body.style.setProperty('--cpe-user-weight', weights[block.fontWeight]);
  for (const [key, , min, max] of STYLE_NUMBERS) {
    const value = block[key];
    if (!Number.isFinite(value) || value < min || value > max) continue;
    const variable = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    body.style.setProperty(`--cpe-user-${variable}`, key === 'lineHeight' ? value : `${value}px`);
  }
  if (block.type === 'heading') body.append(el('h2', 'cpe-preview-heading', block.title || 'Título'));
  if (block.type === 'text') body.append(el('p', 'cpe-preview-text', block.text || 'Texto da seção'));
  if (block.type === 'divider') body.append(el('hr', 'cpe-preview-divider'));
  if (block.type === 'spacer') body.append(el('div', 'cpe-preview-space'));
  if (block.type === 'button' || block.type === 'video') body.append(previewCta(block.title || (block.type === 'video' ? 'Assistir ao vídeo' : 'Botão'), block.type === 'video' ? 'play-fill' : undefined));
  if (block.type === 'hero') {
    const hero = el('div', 'cpe-preview-hero');
    hero.append(el('h2', 'cpe-preview-heading', block.title || 'Destaque'), el('p', 'cpe-preview-text', block.text || 'Texto de abertura'));
    if (block.url) hero.append(previewCta(block.linkLabel || 'Saiba mais'));
    body.append(hero);
  }
  if (block.type === 'quote') {
    const quote = el('blockquote', 'cpe-preview-quote');
    quote.append(el('p', 'cpe-preview-text', block.text || 'Texto da citação'));
    if (block.title) quote.append(el('cite', '', block.title));
    body.append(quote);
  }
  if (block.type === 'list' || block.type === 'links') {
    if (block.title) body.append(el('h3', 'cpe-preview-list-title', block.title));
    const list = el('ul', 'cpe-preview-list');
    const values = block.type === 'list' ? (block.text || 'Item da lista').split(/\r?\n/u).filter(item => item.trim()) : linkRows(block.text).map(row => row.label);
    for (const value of values) list.append(el('li', '', value));
    if (!values.length) list.append(el('li', '', 'Adicione os links nas configurações do bloco.'));
    body.append(list);
  }
  if (block.type === 'image') {
    const placeholder = el('div', 'cpe-image-placeholder');
    placeholder.append(icon('image'), el('span', '', block.alt || 'Imagem'));
    const candidate = safeImage(block.url);
    const src = kind === 'unsubscribe' && !candidate.startsWith('/') ? '' : candidate;
    if (src) {
      const image = el('img', 'cpe-preview-image');
      image.alt = block.alt || '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.draggable = false;
      image.addEventListener('load', () => { placeholder.hidden = true; });
      image.addEventListener('error', () => { image.hidden = true; });
      image.src = src;
      body.append(image);
    }
    body.append(placeholder);
    if (safeImage(block.linkUrl)) {
      const linked = el('span', 'cpe-preview-image-link');
      linked.append(icon('link-45deg'), document.createTextNode('Imagem com link'));
      body.append(linked);
    }
  }
  if (block.type === 'form') {
    const form = el('div', 'cpe-preview-form');
    form.append(el('strong', '', block.title || 'Inscreva-se'));
    for (const label of ['Seu nome', 'Seu e-mail']) form.append(el('span', 'cpe-preview-input', label));
    const consent = el('p', 'cpe-preview-consent');
    consent.append(icon('square'), document.createTextNode('Aceito receber e-mails da Maximum Contábil.'));
    form.append(consent, el('span', 'cpe-preview-cta', block.text || submitLabel));
    body.append(form);
  }
  if (block.type === 'unsubscribe') {
    const form = el('div', 'cpe-preview-form');
    form.append(el('strong', '', block.title || 'Cancelar inscrição'),
      el('p', 'cpe-preview-text', 'Confirme para deixar de receber os e-mails de marketing da Maximum Contábil.'),
      previewCta(block.text || 'Confirmar descadastro'));
    body.append(form);
  }
  return body;
}

export function mountCrmPageBuilder(root, { request, onBack, onSaved, onAuthError } = {}) {
  let generation = 0;
  let active = false;
  let canEdit = false;
  let ready = false;
  let dirty = false;
  let busy = false;
  let currentId = null;
  let page;
  let selectedId = '';
  let section = 'settings';
  let viewport = 'desktop';
  let slugCustom = false;
  let drag;
  let templates = [];
  let analytics;
  let propertiesMode = 'content';
  let modalAction;
  let restoreFocus;
  const targets = {};

  function beforeUnload(event) { if (active && dirty) { event.preventDefault(); event.returnValue = ''; } }

  function announce(message, failure = false) {
    if (!targets.status) return;
    targets.status.textContent = message;
    targets.status.dataset.error = String(failure);
  }

  function renderHeader() {
    targets.pageName.textContent = page.title || 'Nova página';
    const state = page.published || page.status === 'published' ? 'Publicada' : 'Rascunho';
    targets.badge.textContent = state;
    targets.badge.dataset.published = String(state === 'Publicada');
    targets.unsaved.hidden = !dirty && !page.hasUnpublishedChanges;
    targets.unsaved.textContent = dirty ? 'Alterações locais' : 'Rascunho com alterações';
    for (const item of [targets.draft, targets.publish]) item.disabled = !ready || busy || !canEdit;
    targets.back.disabled = busy;
  }

  function setDirty(value = true) {
    dirty = value;
    if (dirty) window.addEventListener('beforeunload', beforeUnload);
    else window.removeEventListener('beforeunload', beforeUnload);
    renderHeader();
  }

  function selectBlock(id, { refocus = false } = {}) {
    selectedId = id;
    section = id ? 'block' : 'settings';
    propertiesMode = 'content';
    renderSelection();
    renderInspector();
    if (refocus) targets.canvas.querySelector(`[data-block-id="${id}"] .cpe-block-select`)?.focus();
  }

  function exposeInspector() {
    if (!window.matchMedia('(max-width: 950px)').matches) return;
    targets.inspector.scrollIntoView({ block: 'start' });
    targets.inspector.querySelector('.cpe-toggle button[aria-pressed="true"]')?.focus({ preventScroll: true });
  }

  function mutation() {
    setDirty();
    renderCanvas();
  }

  function canInsert(type) {
    if (type === 'unsubscribe' && page.kind !== 'unsubscribe' || type === 'form' && page.kind !== 'landing') return false;
    return !['form', 'unsubscribe'].includes(type) || !page.blocks.some(block => block.type === type);
  }

  function insertBlock(type, index = page.blocks.length, { refocus = false } = {}) {
    if (!canEdit || !ready || !Object.hasOwn(BLOCKS, type) || !canInsert(type)) return;
    if (page.blocks.length >= BLOCK_LIMIT) { announce(`A página pode ter até ${BLOCK_LIMIT} blocos.`, true); return; }
    const block = newBlock(type);
    page.blocks.splice(index, 0, block);
    selectedId = block.id;
    section = 'block';
    propertiesMode = 'content';
    mutation();
    renderInspector();
    if (refocus) {
      targets.canvas.querySelector(`[data-block-id="${block.id}"] .cpe-block-select`)?.focus();
      exposeInspector();
    }
    announce(`Bloco ${BLOCKS[type].name} adicionado.`);
  }

  function reorderBlock(id, to, { refocus = false } = {}) {
    if (!canEdit || !ready) return;
    const from = page.blocks.findIndex(block => block.id === id);
    if (from < 0 || from === to || to < 0 || to >= page.blocks.length) return;
    const [block] = page.blocks.splice(from, 1);
    page.blocks.splice(to, 0, block);
    mutation();
    selectBlock(id, { refocus });
    announce(`Bloco movido para a posição ${to + 1}.`);
  }

  function dropBlock(index) {
    const item = drag;
    clearDrag();
    if (!item) return;
    if (item.type) insertBlock(item.type, index);
    else {
      const from = page.blocks.findIndex(block => block.id === item.id);
      if (from >= 0) reorderBlock(item.id, index > from ? index - 1 : index);
    }
  }

  function clearDrag() {
    drag = undefined;
    if (!targets.canvas) return;
    targets.canvas.removeAttribute('data-dragging');
    for (const marker of targets.canvas.querySelectorAll('[data-drop-active]')) marker.removeAttribute('data-drop-active');
  }

  function attachDrag(source, item, operation) {
    if (!canEdit) return;
    source.draggable = true;
    source.addEventListener('dragstart', (event) => {
      if (!ready || !canEdit) { event.preventDefault(); return; }
      drag = item;
      event.dataTransfer.effectAllowed = operation;
      event.dataTransfer.setData('text/plain', item.id || item.type);
      targets.canvas.dataset.dragging = 'true';
    });
    source.addEventListener('dragend', clearDrag);
  }

  function attachDrop(target, index) {
    target.addEventListener('dragover', (event) => {
      if (!drag || !canEdit) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = drag.type ? 'copy' : 'move';
      target.dataset.dropActive = 'true';
    });
    target.addEventListener('dragleave', () => target.removeAttribute('data-drop-active'));
    target.addEventListener('drop', (event) => {
      if (!drag || !canEdit) return;
      event.preventDefault();
      dropBlock(index(event));
    });
  }

  function renderSelection() {
    for (const row of targets.canvas.querySelectorAll('[data-block-id]')) {
      const selected = row.dataset.blockId === selectedId;
      row.dataset.selected = String(selected);
      row.querySelector('.cpe-block-select').setAttribute('aria-pressed', String(selected));
    }
    targets.settings.setAttribute('aria-pressed', String(section === 'settings'));
  }

  function renderCanvas() {
    targets.canvas.dataset.viewport = viewport;
    targets.canvas.replaceChildren();
    for (const paletteButton of targets.library.querySelectorAll('[data-type]')) {
      const type = paletteButton.dataset.type;
      paletteButton.hidden = type === 'form' && page.kind === 'unsubscribe' || type === 'unsubscribe' && page.kind === 'landing';
      paletteButton.disabled = !canEdit || !ready || page.blocks.length >= BLOCK_LIMIT || !canInsert(type);
    }
    if (!ready) return;
    if (!page.blocks.length) {
      const empty = el('div', 'cpe-canvas-empty');
      empty.append(icon('grid'), el('strong', '', 'Área da página'), el('p', '', canEdit ? 'Arraste um bloco para cá ou selecione um item em Blocos.' : 'Esta página ainda não tem blocos.'));
      attachDrop(empty, () => 0);
      targets.canvas.append(empty);
      return;
    }
    for (const [index, block] of page.blocks.entries()) {
      const spec = BLOCKS[block.type];
      if (!spec) continue;
      const row = el('section', 'cpe-canvas-block');
      row.dataset.blockId = block.id;
      row.dataset.type = block.type;
      const edit = () => { selectBlock(block.id); exposeInspector(); };
      const selector = action(`Editar bloco ${index + 1} · ${spec.name}`, edit, { symbol: spec.icon, compact: true });
      selector.classList.add('cpe-block-select');
      selector.addEventListener('keydown', (event) => {
        if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        reorderBlock(block.id, index + (event.key === 'ArrowUp' ? -1 : 1), { refocus: true });
      });
      const body = blockBody(block, page.buttonText, page.kind);
      body.addEventListener('click', edit);
      row.append(selector, body);
      attachDrag(row, { id: block.id }, 'move');
      attachDrop(row, (event) => {
        const rect = row.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2 ? index : index + 1;
      });
      targets.canvas.append(row);
    }
    const tail = el('div', 'cpe-drop-tail');
    tail.append(el('span', '', 'Solte um bloco para adicionar ao final'));
    attachDrop(tail, () => page.blocks.length);
    targets.canvas.append(tail);
    renderSelection();
  }

  function inspectorTitle(label, subline) {
    const heading = el('div', 'cpe-side-heading');
    heading.append(el('h2', '', label));
    if (subline) heading.append(el('p', '', subline));
    return heading;
  }

  function inputFor(parent, label, name, value, settings, update) {
    const control = field(label, name, value, settings);
    control.input.disabled = !canEdit;
    control.input.addEventListener(control.input.tagName === 'SELECT' ? 'change' : 'input', () => update(control.input.value));
    parent.append(control.label);
    return control.input;
  }

  function renderMetrics(parent, summary) {
    if (!currentId || !analytics) {
      parent.append(el('p', 'cpe-note', currentId ? 'Os dados de desempenho ainda estão indisponíveis.' : 'Salve a página para consultar suas métricas.'));
      return;
    }
    const values = [
      [summary ? 'Visualizações' : 'Visitas', summary?.views ?? analytics.visits],
      ['Cliques', summary?.clicks ?? analytics.clicks],
      ['Tempo médio', duration(summary ? summary.averageSeconds : analytics.averageSeconds)],
      ['Conversões', summary?.conversions ?? analytics.conversions],
    ];
    const container = el('dl', 'cpe-metrics');
    for (const [title, value] of values) {
      const item = el('div');
      item.append(el('dt', '', title), el('dd', '', typeof value === 'number' ? NUMBER.format(value) : value ?? '—'));
      container.append(item);
    }
    parent.append(container);
    parent.append(el('p', 'cpe-note', 'Medição da página publicada. O tempo indica a permanência com a página visível.'));
  }

  function pageSettings() {
    const content = el('div', 'cpe-inspector-content');
    const title = field('Título da página', 'title', page.title, { maxLength: 160, placeholder: 'Ex.: Newsletter Maximum' });
    const unsubscribe = page.kind === 'unsubscribe';
    const slug = field('Endereço da página', 'slug', page.slug, { maxLength: 80, placeholder: unsubscribe ? 'cancelar-inscricao' : 'newsletter-maximum',
      hint: unsubscribe ? 'Prévia pública em /crm/descadastro/. O link de descadastro é individual, enviado por e-mail.' : 'Endereço público em /inscricao/.' });
    const purpose = field('Tipo de página', 'kind', page.kind, { options: KINDS });
    title.input.disabled = !canEdit;
    slug.input.disabled = !canEdit;
    purpose.input.disabled = !canEdit || Boolean(currentId);
    purpose.input.addEventListener('change', () => {
      const kind = purpose.input.value;
      const discardedType = kind === 'unsubscribe' ? 'form' : 'unsubscribe';
      const apply = () => {
        page.kind = kind;
        page.blocks = page.blocks.filter(block => block.type !== discardedType);
        mutation();
        renderTemplates();
        renderInspector();
      };
      if (page.blocks.some(block => block.type === discardedType)) {
        purpose.input.value = page.kind;
        openModal('Alterar o tipo de página', [el('p', '', 'O formulário atual será removido do rascunho.')], 'Alterar tipo', apply);
      } else apply();
    });
    if (page.published || page.status === 'published') {
      slug.input.readOnly = true;
      slug.label.querySelector('small').textContent = 'O endereço é fixo após a publicação.';
    }
    title.input.addEventListener('input', () => {
      page.title = title.input.value;
      if (!slugCustom && !slug.input.readOnly) page.slug = slug.input.value = cleanSlug(page.title);
      setDirty();
    });
    slug.input.addEventListener('input', () => { page.slug = slug.input.value; slugCustom = true; setDirty(); });
    slug.input.addEventListener('blur', () => { page.slug = slug.input.value = cleanSlug(slug.input.value); });
    content.append(purpose.label, title.label, slug.label);
    inputFor(content, 'Descrição', 'description', page.description, { multiline: 3, maxLength: 4000 }, (value) => { page.description = value; setDirty(); });
    if (!unsubscribe) inputFor(content, 'Interesses do lead', 'tags', page.tags.join(', '), { maxLength: 939, hint: 'Separe por vírgula. Os interesses são atribuídos após a confirmação.' }, (value) => { page.tags = tagsFrom(value); setDirty(); });
    else content.append(el('p', 'cpe-note cpe-purpose-note', 'O descadastro só é confirmado com o link individual enviado no e-mail. Use a prévia para conferir o layout.'));
    return content;
  }

  function updateBlock(block, key, value) {
    block[key] = value;
    setDirty();
    const row = targets.canvas.querySelector(`[data-block-id="${block.id}"]`);
    if (!row) return;
    const body = blockBody(block, page.buttonText, page.kind);
    body.addEventListener('click', () => { selectBlock(block.id); exposeInspector(); });
    row.querySelector('.cpe-block-content')?.replaceWith(body);
  }

  function blockSettings(block) {
    const content = el('div', 'cpe-inspector-content');
    const edit = (label, name, settings) => inputFor(content, label, name, block[name], settings, value => updateBlock(block, name, value));
    const type = block.type;
    if (['hero', 'heading', 'form', 'unsubscribe', 'button', 'quote', 'list', 'video', 'links'].includes(type)) {
      edit(type === 'button' || type === 'video' ? 'Texto do botão' : type === 'quote' ? 'Fonte ou autor' : 'Título', 'title', { maxLength: 200 });
    }
    if (['hero', 'text', 'quote', 'list', 'links'].includes(type)) {
      const settings = { multiline: 5, maxLength: 4000 };
      if (type === 'list') settings.hint = 'Escreva um item em cada linha.';
      if (type === 'links') settings.hint = 'Em cada linha, escreva o nome e a URL separados por |. Ex.: Instagram | https://instagram.com/…';
      edit(type === 'list' ? 'Itens' : type === 'links' ? 'Links' : 'Texto', 'text', settings);
    }
    if (['form', 'unsubscribe'].includes(type)) edit('Texto do botão', 'text', { maxLength: 80 });
    if (type === 'hero') edit('Texto do botão de destaque', 'linkLabel', { maxLength: 80, placeholder: 'Saiba mais' });
    if (['button', 'image', 'hero', 'video'].includes(type)) {
      const labels = { image: 'URL da imagem', video: 'URL do vídeo', button: 'Endereço do link', hero: 'Endereço do botão de destaque' };
      const privateImage = type === 'image' && page.kind === 'unsubscribe';
      edit(labels[type], 'url', { maxLength: 2048, placeholder: privateImage ? '/maximum-logo.png' : 'https://…', hint: privateImage
        ? 'Use um caminho da Central, por exemplo /maximum-logo.png.' : type === 'image' ? 'Cole o link direto para o arquivo da imagem.' : undefined });
    }
    if (type === 'image') {
      edit('Descrição alternativa', 'alt', { maxLength: 180 });
      edit('Link ao clicar na imagem', 'linkUrl', { maxLength: 2048, placeholder: 'https://…', hint: 'Opcional. Abre este endereço quando a imagem é clicada.' });
    }
    if (type === 'divider' || type === 'spacer') content.append(el('p', 'cpe-note', 'Ajuste o espaço e a aparência na aba Estilo.'));
    return content;
  }

  function styleSettings(block) {
    const content = el('div', 'cpe-inspector-content');
    inputFor(content, 'Alinhamento', 'align', block.align, { options: { left: 'Esquerda', center: 'Centro', right: 'Direita' } }, value => updateBlock(block, 'align', value));
    inputFor(content, 'Peso da fonte', 'fontWeight', block.fontWeight, { options: FONT_WEIGHTS }, value => updateBlock(block, 'fontWeight', value));
    const dimensions = el('div', 'cpe-dimensions');
    for (const [key, label, min, max, step = 1] of STYLE_NUMBERS) {
      inputFor(dimensions, label, key, block[key], { type: 'number', min, max, step, placeholder: 'Padrão' }, value => updateBlock(block, key, value === '' ? undefined : Number(value)));
    }
    content.append(dimensions);
    const colors = el('div', 'cpe-color-grid');
    for (const [key, label, defaultColor] of [['color', 'Cor do texto', '#2c2430'], ['background', 'Fundo do bloco', '#ffffff'], ['borderColor', 'Cor da borda', '#e5d5dc']]) {
      const group = el('div', 'cpe-color');
      const color = field(label, key, hex(block[key]) || defaultColor, { type: 'color' });
      color.input.disabled = !canEdit;
      color.input.addEventListener('input', () => updateBlock(block, key, color.input.value));
      const reset = action(`Limpar ${label.toLocaleLowerCase('pt-BR')}`, () => { color.input.value = defaultColor; updateBlock(block, key, ''); }, { symbol: 'arrow-clockwise', compact: true });
      reset.disabled = !canEdit;
      group.append(color.label, reset);
      colors.append(group);
    }
    content.append(colors);
    return content;
  }

  function blockActions(block) {
    const controls = el('div', 'cpe-order-controls');
    const index = page.blocks.findIndex(item => item.id === block.id);
    const up = action('Subir bloco', () => reorderBlock(block.id, index - 1, { refocus: true }), { symbol: 'chevron-up', compact: true });
    const down = action('Descer bloco', () => reorderBlock(block.id, index + 1, { refocus: true }), { symbol: 'chevron-down', compact: true });
    up.disabled = index === 0;
    down.disabled = index === page.blocks.length - 1;
    const remove = action('Remover bloco', () => {
      const item = page.blocks.findIndex(entry => entry.id === block.id);
      if (item < 0) return;
      page.blocks.splice(item, 1);
      selectedId = '';
      section = 'settings';
      propertiesMode = 'content';
      mutation();
      renderInspector();
      targets.settings.focus();
      announce('Bloco removido.');
    }, { symbol: 'trash', kind: 'danger' });
    controls.append(up, down, remove);
    return controls;
  }

  function renderInspector() {
    if (!ready) { targets.inspector.replaceChildren(inspectorTitle('Configurações')); return; }
    const block = section === 'block' && page.blocks.find(item => item.id === selectedId);
    const options = el('div', 'cpe-toggle');
    const modes = [['content', 'Conteúdo'], ...(block ? [['style', 'Estilo']] : []), ['metrics', 'Métricas']];
    for (const [mode, name] of modes) {
      const toggle = action(name, () => {
        propertiesMode = mode;
        renderInspector();
        targets.inspector.querySelector(`[data-mode="${mode}"]`)?.focus();
      });
      toggle.dataset.mode = mode;
      toggle.setAttribute('aria-pressed', String(propertiesMode === mode));
      options.append(toggle);
    }
    targets.inspector.replaceChildren(inspectorTitle(block ? BLOCKS[block.type]?.name || 'Bloco' : 'Configurações da página'), options);
    if (propertiesMode === 'metrics') {
      const content = el('div', 'cpe-inspector-content');
      const summary = block && analytics ? analytics.blocks?.find(item => item.blockId === block.id) || { views: 0, clicks: 0, averageSeconds: null, conversions: 0 } : null;
      renderMetrics(content, summary);
      targets.inspector.append(content);
    } else targets.inspector.append(block ? propertiesMode === 'style' ? styleSettings(block) : blockSettings(block) : pageSettings());
    if (block && canEdit) targets.inspector.append(blockActions(block));
    renderSelection();
  }

  function renderTemplates() {
    targets.templateList.replaceChildren();
    for (const [group, choices] of [['Prontos para usar', BUILTIN_TEMPLATES], ['Templates salvos', templates]]) {
      if (!choices.length) continue;
      targets.templateList.append(el('p', 'cpe-template-group', group));
      for (const template of choices) {
        const tile = el('div', 'cpe-template-tile');
        const use = action(template.name, () => useTemplate(template), { symbol: 'file-earmark' });
        use.setAttribute('aria-label', `Usar ${template.name}`);
        use.disabled = !canEdit || !ready || Boolean(currentId && templateKind(template) !== page.kind);
        if (use.disabled && templateKind(template) !== page.kind) use.title = `Disponível para ${KINDS[templateKind(template)].toLocaleLowerCase('pt-BR')}.`;
        tile.append(use);
        if (template.description) tile.append(el('p', '', template.description));
        targets.templateList.append(tile);
      }
    }
  }

  function openModal(title, content, label, handler) {
    modalAction = handler;
    restoreFocus = document.activeElement;
    targets.dialogTitle.textContent = title;
    targets.dialogContent.replaceChildren(...content);
    targets.dialogFeedback.hidden = true;
    targets.dialogSubmit.textContent = label;
    targets.dialog.showModal();
    const first = targets.dialogContent.querySelector('input, select, textarea');
    (first || targets.dialogCancel).focus();
  }

  function useTemplate(template) {
    const apply = () => {
      page.kind = templateKind(template);
      page.blocks = templateBlocks(template);
      if (!page.title && template.title) {
        page.title = template.title;
        if (!slugCustom && !page.slug) page.slug = cleanSlug(template.title);
      }
      selectedId = '';
      section = 'settings';
      propertiesMode = 'content';
      mutation();
      renderTemplates();
      renderInspector();
      announce(`Template ${template.name} aplicado.`);
    };
    if (page.blocks.length) openModal('Aplicar template', [el('p', '', 'O template substituirá os blocos atuais desta página.')], 'Aplicar template', apply);
    else apply();
  }

  async function reportError(error, target) {
    if (error?.status === 401) { onAuthError?.(error); return; }
    const message = error?.message || 'Não foi possível concluir a operação.';
    if (!target) announce(message, true);
    else { target.textContent = message; target.hidden = false; }
  }

  function saveTemplate() {
    if (!canEdit || !ready || !page.blocks.length) { announce('Adicione ao menos um bloco para salvar o template.', true); return; }
    const name = field('Nome do template', 'name', '', { maxLength: 120, placeholder: 'Ex.: Newsletter com formulário' });
    name.input.required = true;
    openModal('Salvar template', [name.label], 'Salvar template', async (form) => {
      const when = generation;
      const nameValue = String(form.get('name') || '').trim();
      if (!nameValue) throw new Error('Informe o nome do template.');
      const template = await request(`${PATH}/templates`, { method: 'POST', body: { name: nameValue, kind: page.kind, blocks: page.blocks } });
      if (when !== generation) return;
      templates = [template, ...templates];
      renderTemplates();
      announce('Template salvo.');
    });
  }

  function cancelEditor() {
    if (busy) return;
    if (!dirty) { onBack?.(); return; }
    openModal('Voltar ao CRM', [el('p', '', 'Você tem alterações locais. Salve o rascunho para mantê-las.')], 'Sair sem salvar', () => { setDirty(false); return onBack?.(); });
  }

  function validatePage(publishing) {
    const title = page.title.trim();
    const slug = cleanSlug(page.slug);
    if (!title || slug.length < 3) {
      selectBlock('');
      targets.inspector.querySelector(`[name="${!title ? 'title' : 'slug'}"]`)?.focus();
      throw new Error(!title ? 'Informe o título da página.' : 'Informe um endereço de pelo menos três caracteres.');
    }
    if (publishing && !page.blocks.length) throw new Error('Adicione um bloco antes de publicar a página.');
    if (publishing && page.kind === 'unsubscribe' && !page.blocks.some(block => block.type === 'unsubscribe')) {
      throw new Error('Adicione o bloco Descadastro antes de publicar a página.');
    }
    const invalidImage = page.kind === 'unsubscribe' && page.blocks.find(block => block.type === 'image' && block.url && !safeImage(block.url).startsWith('/'));
    if (invalidImage) {
      selectBlock(invalidImage.id);
      targets.inspector.querySelector('[name="url"]')?.focus();
      throw new Error('Use o caminho de uma imagem da Central na página de descadastro.');
    }
    return { title, slug, description: page.description, buttonText: page.blocks.find(block => block.type === 'form')?.text || page.buttonText,
      tags: page.kind === 'landing' ? page.tags : [], blocks: page.blocks, kind: page.kind };
  }

  async function savePage(status) {
    if (!canEdit || !ready || busy) return;
    const when = generation;
    try {
      const payload = validatePage(status === 'published');
      busy = true;
      targets.workspace.inert = true;
      renderHeader();
      announce(status === 'published' ? 'Publicando página…' : 'Salvando rascunho…');
      const result = await request(`${PATH}/landings${currentId ? `/${encodeURIComponent(currentId)}` : ''}`, {
        method: currentId ? 'PATCH' : 'POST', body: { ...payload, status, ...(page.updatedAt && { expectedUpdatedAt: page.updatedAt }) },
      });
      if (when !== generation) return;
      page = normalizePage(result);
      currentId = page.id;
      slugCustom = true;
      setDirty(false);
      renderCanvas();
      renderTemplates();
      renderInspector();
      announce(status === 'published' ? 'Página publicada.' : 'Rascunho salvo.');
      onSaved?.(page);
      void loadAnalytics(when);
    } catch (error) { if (when === generation) await reportError(error); }
    finally {
      if (when === generation) {
        busy = false;
        targets.workspace.inert = false;
        renderHeader();
      }
    }
  }

  async function loadTemplates(when) {
    try {
      const data = await request(`${PATH}/templates`);
      if (when !== generation) return;
      templates = data.items || [];
      renderTemplates();
    } catch (error) {
      if (when !== generation) return;
      if (error.status === 401) onAuthError?.(error);
      else targets.templateList.append(el('p', 'cpe-note', 'Os templates salvos estão indisponíveis.'));
    }
  }

  async function loadAnalytics(when) {
    if (!currentId) return;
    try {
      const report = await request(`${PATH}/landings/${encodeURIComponent(currentId)}/analytics`);
      if (when !== generation) return;
      analytics = report;
      if (propertiesMode === 'metrics') renderInspector();
    } catch (error) { if (when === generation && error.status === 401) onAuthError?.(error); }
  }

  function renderFrame() {
    root.classList.add('cpe-shell');
    root.innerHTML = `
      <header class="cpe-header">
        <div class="cpe-heading">
          <span class="cpe-brand"><i class="bi bi-grid" aria-hidden="true"></i></span>
          <div class="cpe-heading-text"><h1 data-cpe="pageName">Nova página</h1><div class="cpe-page-state"><span data-cpe="badge" class="cpe-badge">Rascunho</span><span data-cpe="unsaved" hidden></span></div></div>
        </div>
        <div class="cpe-header-actions" data-cpe="actions"></div>
      </header>
      <p class="cpe-status" role="status" data-cpe="status"></p>
      <div class="cpe-workspace" data-cpe="workspace">
        <aside class="cpe-library" aria-label="Biblioteca do editor">
          <section><h2>Blocos</h2><p class="cpe-note">Arraste ou selecione um bloco.</p><div class="cpe-palette" data-cpe="library"></div></section>
          <section class="cpe-library-templates"><div class="cpe-template-heading"><h2>Templates</h2><span data-cpe="templateSave"></span></div><div class="cpe-template-list" data-cpe="templateList"></div></section>
        </aside>
        <section class="cpe-center" aria-label="Prévia da página">
          <div class="cpe-toolbar" data-cpe="toolbar"><p><i class="bi bi-eye" aria-hidden="true"></i> Prévia da página</p><span class="cpe-toggle" data-cpe="viewport"></span></div>
          <div class="cpe-surface"><div class="cpe-device" data-cpe="canvas"></div></div>
        </section>
        <aside class="cpe-inspector" aria-label="Propriedades e métricas" data-cpe="inspector"></aside>
      </div>
      <dialog class="cpe-dialog" data-cpe="dialog" aria-labelledby="cpe-dialog-title">
        <form novalidate data-cpe="dialogForm">
          <h2 id="cpe-dialog-title" data-cpe="dialogTitle"></h2><div data-cpe="dialogContent"></div>
          <p role="alert" class="cpe-dialog-feedback" data-cpe="dialogFeedback" hidden></p>
          <footer><button type="button" class="cpe-action" data-cpe="dialogCancel">Cancelar</button><button class="cpe-action cpe-primary" type="submit" data-cpe="dialogSubmit">Confirmar</button></footer>
        </form>
      </dialog>`;
    for (const item of root.querySelectorAll('[data-cpe]')) targets[item.dataset.cpe] = item;
    targets.draft = action('Salvar Rascunho', () => void savePage('draft'), { symbol: 'floppy' });
    targets.publish = action('Publicar', () => void savePage('published'), { symbol: 'broadcast', kind: 'primary' });
    targets.back = action('Voltar ao CRM', cancelEditor, { symbol: 'arrow-left' });
    targets.draft.hidden = targets.publish.hidden = !canEdit;
    targets.actions.append(targets.draft, targets.publish, targets.back);
    for (const [type, spec] of Object.entries(BLOCKS)) {
      const block = action(spec.name, () => {
        const index = page.blocks.findIndex(item => item.id === selectedId);
        insertBlock(type, index < 0 ? page.blocks.length : index + 1, { refocus: true });
      }, { symbol: spec.icon });
      block.dataset.type = type;
      attachDrag(block, { type }, 'copy');
      targets.library.append(block);
    }
    targets.templateSave.append(action('Salvar template', saveTemplate, { symbol: 'plus-lg', compact: true }));
    targets.templateSave.hidden = !canEdit;
    targets.settings = action('Configurações', () => { selectBlock(''); exposeInspector(); }, { symbol: 'gear' });
    targets.toolbar.append(targets.settings);
    for (const [key, text, symbol] of [['desktop', 'Computador', 'display'], ['mobile', 'Celular', 'phone']]) {
      const device = action(text, () => {
        viewport = key;
        for (const control of targets.viewport.children) control.setAttribute('aria-pressed', String(control.dataset.viewport === key));
        renderCanvas();
      }, { symbol });
      device.dataset.viewport = key;
      device.setAttribute('aria-pressed', String(key === viewport));
      targets.viewport.append(device);
    }
    targets.dialogCancel.addEventListener('click', () => targets.dialog.close());
    targets.dialog.addEventListener('close', () => {
      modalAction = undefined;
      if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
      restoreFocus = undefined;
    });
    targets.dialogForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!modalAction || targets.dialogSubmit.disabled || !targets.dialogForm.reportValidity()) return;
      const when = generation;
      targets.dialogSubmit.disabled = true;
      targets.dialogCancel.disabled = true;
      try { await modalAction(new FormData(targets.dialogForm)); if (when === generation && targets.dialog.open) targets.dialog.close(); }
      catch (error) { if (when === generation) await reportError(error, targets.dialogFeedback); }
      finally { if (when === generation) targets.dialogSubmit.disabled = targets.dialogCancel.disabled = false; }
    });
    targets.dialog.addEventListener('cancel', (event) => { if (targets.dialogSubmit.disabled) event.preventDefault(); });
    renderHeader();
    renderCanvas();
    renderTemplates();
    renderInspector();
  }

  function close() {
    generation += 1;
    active = ready = dirty = busy = false;
    currentId = null;
    clearDrag();
    window.removeEventListener('beforeunload', beforeUnload);
    if (targets.dialog?.open) targets.dialog.close();
    modalAction = restoreFocus = undefined;
    root.replaceChildren();
  }

  return {
    async open({ id = null, canEdit: writable = true, kind = 'landing' } = {}) {
      if (active && currentId === id && writable === canEdit) return;
      close();
      active = true;
      canEdit = writable;
      const when = generation;
      currentId = id;
      page = blankPage(!id && kind === 'unsubscribe' ? kind : 'landing');
      if (page.kind === 'unsubscribe') {
        const template = BUILTIN_TEMPLATES.find(item => item.kind === 'unsubscribe');
        page.title = template.title;
        page.slug = cleanSlug(template.title);
        page.blocks = templateBlocks(template);
      }
      selectedId = '';
      section = 'settings';
      viewport = 'desktop';
      slugCustom = Boolean(id);
      analytics = undefined;
      propertiesMode = 'content';
      templates = [];
      ready = !id;
      renderFrame();
      if (id) {
        announce('Carregando página…');
        try {
          const result = await request(`${PATH}/landings/${encodeURIComponent(id)}`);
          if (when !== generation) return;
          page = normalizeExistingPage(result);
          ready = true;
          announce('');
          renderHeader();
          renderCanvas();
          renderTemplates();
          renderInspector();
        } catch (error) { if (when === generation) await reportError(error); }
      }
      if (when === generation && ready) {
        void loadTemplates(when);
        void loadAnalytics(when);
      }
    },
    close,
    hasUnsavedChanges: () => active && dirty,
  };
}
