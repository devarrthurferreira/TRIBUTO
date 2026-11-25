const PATH = '/marketing/crm';
const BLOCK_LIMIT = 48;
const BLOCKS = {
  heading: { name: 'Título', icon: 'type', defaults: { title: 'Título da seção' } },
  text: { name: 'Texto', icon: 'paragraph', defaults: { text: 'Escreva aqui o conteúdo da seção.' } },
  image: { name: 'Imagem', icon: 'image', defaults: {} },
  button: { name: 'Botão', icon: 'cursor', defaults: { title: 'Saiba mais' } },
  divider: { name: 'Divisor', icon: 'dash-lg', defaults: {} },
  form: { name: 'Formulário', icon: 'card-text', defaults: { title: 'Receba nossas novidades', text: 'Quero me inscrever' } },
};
const NUMBER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

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

function newBlock(type) {
  return { id: crypto.randomUUID(), type, title: '', text: '', url: '', alt: '', align: 'left', color: '', background: '', ...BLOCKS[type].defaults };
}

function blankPage() {
  return { title: '', slug: '', description: '', buttonText: 'Quero me inscrever', tags: [], blocks: [], status: 'draft' };
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

function duration(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  const whole = Math.round(value);
  return whole < 60 ? `${whole} s` : `${Math.floor(whole / 60)} min ${whole % 60} s`;
}

function safeImage(value) {
  if (typeof value !== 'string' || /^\/[/\\]/.test(value)) return '';
  if (/^\/(?![/\\])/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function hex(value) {
  return /^#[a-f0-9]{6}$/i.test(value || '') ? value : '';
}

function blockBody(block, submitLabel) {
  const body = el('div', 'cpe-block-content');
  body.dataset.align = block.align || 'left';
  if (hex(block.color)) body.style.setProperty('--cpe-user-color', block.color);
  if (hex(block.background)) body.style.setProperty('--cpe-user-bg', block.background);
  if (block.type === 'heading') body.append(el('h2', 'cpe-preview-heading', block.title || 'Título'));
  if (block.type === 'text') body.append(el('p', 'cpe-preview-text', block.text || 'Texto da seção'));
  if (block.type === 'divider') body.append(el('hr', 'cpe-preview-divider'));
  if (block.type === 'button') body.append(el('span', 'cpe-preview-cta', block.title || 'Botão'));
  if (block.type === 'image') {
    const placeholder = el('div', 'cpe-image-placeholder');
    placeholder.append(icon('image'), el('span', '', block.alt || 'Imagem'));
    const src = safeImage(block.url);
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

  function insertBlock(type, index = page.blocks.length, { refocus = false } = {}) {
    if (!canEdit || !ready || !Object.hasOwn(BLOCKS, type) || (type === 'form' && page.blocks.some(block => block.type === 'form'))) return;
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
      paletteButton.disabled = !canEdit || !ready || page.blocks.length >= BLOCK_LIMIT ||
        (paletteButton.dataset.type === 'form' && page.blocks.some(block => block.type === 'form'));
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
      const body = blockBody(block, page.buttonText);
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
    const slug = field('Endereço da página', 'slug', page.slug, { maxLength: 80, placeholder: 'newsletter-maximum', hint: 'Endereço público em /inscricao/' });
    title.input.disabled = !canEdit;
    slug.input.disabled = !canEdit;
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
    content.append(title.label, slug.label);
    inputFor(content, 'Descrição', 'description', page.description, { multiline: 3, maxLength: 4000 }, (value) => { page.description = value; setDirty(); });
    inputFor(content, 'Interesses do lead', 'tags', page.tags.join(', '), { maxLength: 939, hint: 'Separe por vírgula. Os interesses são atribuídos após a confirmação.' }, (value) => { page.tags = tagsFrom(value); setDirty(); });
    return content;
  }

  function updateBlock(block, key, value) {
    block[key] = value;
    setDirty();
    const row = targets.canvas.querySelector(`[data-block-id="${block.id}"]`);
    if (!row) return;
    const body = blockBody(block, page.buttonText);
    body.addEventListener('click', () => { selectBlock(block.id); exposeInspector(); });
    row.querySelector('.cpe-block-content')?.replaceWith(body);
  }

  function blockSettings(block) {
    const content = el('div', 'cpe-inspector-content');
    const edit = (label, name, settings) => inputFor(content, label, name, block[name], settings, value => updateBlock(block, name, value));
    if (['heading', 'form', 'button'].includes(block.type)) edit(block.type === 'button' ? 'Texto do botão' : 'Título', 'title', { maxLength: 200 });
    if (block.type === 'text' || block.type === 'form') edit(block.type === 'form' ? 'Texto do botão' : 'Texto', 'text', block.type === 'form' ? { maxLength: 80 } : { multiline: 5, maxLength: 4000 });
    if (['button', 'image'].includes(block.type)) edit(block.type === 'button' ? 'Endereço do link' : 'Endereço da imagem', 'url', { maxLength: 2048, placeholder: 'https://…' });
    if (block.type === 'image') edit('Descrição alternativa', 'alt', { maxLength: 180 });
    if (block.type !== 'divider') edit('Alinhamento', 'align', { options: { left: 'Esquerda', center: 'Centro', right: 'Direita' } });
    const colors = el('div', 'cpe-color-grid');
    for (const [key, label, defaultColor] of [['color', 'Cor do texto', '#2c2430'], ['background', 'Fundo do bloco', '#ffffff']]) {
      const group = el('div', 'cpe-color');
      const color = field(label, key, hex(block[key]) || defaultColor, { type: 'color' });
      color.input.disabled = !canEdit;
      color.input.addEventListener('input', () => updateBlock(block, key, color.input.value));
      const reset = action(`Limpar ${label.toLocaleLowerCase('pt-BR')}`, () => { color.input.value = defaultColor; updateBlock(block, key, ''); }, { symbol: 'arrow-clockwise', compact: true });
      reset.disabled = !canEdit;
      group.append(color.label, reset);
      colors.append(group);
    }
    if (block.type !== 'image') content.append(colors);
    const index = page.blocks.findIndex(item => item.id === block.id);
    if (canEdit) {
      const controls = el('div', 'cpe-order-controls');
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
        mutation();
        renderInspector();
        targets.settings.focus();
        announce('Bloco removido.');
      }, { symbol: 'trash', kind: 'danger' });
      controls.append(up, down, remove);
      content.append(controls);
    }
    return content;
  }

  function renderInspector() {
    if (!ready) { targets.inspector.replaceChildren(inspectorTitle('Configurações')); return; }
    const block = section === 'block' && page.blocks.find(item => item.id === selectedId);
    const options = el('div', 'cpe-toggle');
    for (const [mode, name] of [['content', 'Conteúdo'], ['metrics', 'Métricas']]) {
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
    } else targets.inspector.append(block ? blockSettings(block) : pageSettings());
    renderSelection();
  }

  function renderTemplates() {
    targets.templateList.replaceChildren();
    if (!templates.length) { targets.templateList.append(el('p', 'cpe-note', 'Os templates salvos aparecem aqui.')); return; }
    for (const template of templates) {
      const use = action(`Usar ${template.name}`, () => useTemplate(template), { symbol: 'file-earmark' });
      use.disabled = !canEdit || !ready;
      targets.templateList.append(use);
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
      page.blocks = (template.blocks || []).map(block => ({ ...block, id: crypto.randomUUID() }));
      selectedId = '';
      section = 'settings';
      mutation();
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
      const template = await request(`${PATH}/templates`, { method: 'POST', body: { name: nameValue, blocks: page.blocks } });
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
    return { title, slug, description: page.description, buttonText: page.blocks.find(block => block.type === 'form')?.text || page.buttonText,
      tags: page.tags, blocks: page.blocks };
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
      else targets.templateList.replaceChildren(el('p', 'cpe-note', 'Não foi possível consultar os templates.'));
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
          <span class="cpe-brand"><i class="bi bi-columns-gap" aria-hidden="true"></i></span>
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
    async open({ id = null, canEdit: writable = true } = {}) {
      if (active && currentId === id && writable === canEdit) return;
      close();
      active = true;
      canEdit = writable;
      const when = generation;
      currentId = id;
      page = blankPage();
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
