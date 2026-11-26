import { CLUB_PATHS, clubPageFromPath } from './club-routes.js';

const managementPreference = 'maximum.club.manager';

const sections = {
  benefits: {
    label: 'Benefícios', singular: 'benefício', title: 'Benefícios da Maximum', icon: 'gift', collection: 'benefits', kind: 'benefit',
    description: 'Conheça os benefícios internos da equipe e veja como usar cada um.',
    summary: 'Benefícios da equipe e orientações de acesso.',
    search: 'Buscar por nome ou categoria', empty: 'Nenhum benefício publicado',
  },
  advantages: {
    label: 'Vantagens', singular: 'vantagem', title: 'Vantagens e descontos', icon: 'tag', collection: 'benefits', kind: 'advantage',
    description: 'Explore as ofertas disponíveis e confira as condições antes de usar.',
    summary: 'Descontos e condições especiais dos parceiros.',
    search: 'Buscar por oferta, categoria ou parceiro', empty: 'Nenhuma vantagem publicada',
  },
  partners: {
    label: 'Parceiros', singular: 'parceiro', title: 'Parceiros e locais', icon: 'geo-alt', collection: 'partners',
    description: 'Encontre os parceiros do Clube, consulte endereços e acesse seus canais de contato.',
    summary: 'Endereços, mapas e contatos da rede parceira.',
    search: 'Buscar por nome, segmento ou endereço', empty: 'Nenhum parceiro publicado',
  },
};
const extraFields = {
  benefits: [
    { name: 'category', label: 'Categoria', max: 80, placeholder: 'Ex.: Saúde e bem-estar' },
    { name: 'offer', label: 'Benefício ou condição da oferta', max: 300, placeholder: 'Ex.: 15% de desconto' },
    { name: 'partnerId', label: 'Parceiro', type: 'partner' },
    { name: 'url', label: 'Link para usar', type: 'url' },
    { name: 'rules', label: 'Como usar e condições', type: 'textarea', max: 4000 },
  ],
  partners: [
    { name: 'category', label: 'Segmento', max: 80, placeholder: 'Ex.: Alimentação' },
    { name: 'address', label: 'Endereço', max: 500, placeholder: 'Rua, número, bairro, cidade e UF' },
    { name: 'mapsUrl', label: 'Link no mapa', type: 'url' },
    { name: 'websiteUrl', label: 'Site', type: 'url' },
    { name: 'whatsapp', label: 'WhatsApp', type: 'tel', max: 32, placeholder: 'Ex.: +55 32 99999-9999' },
    { name: 'instagram', label: 'Link do Instagram', type: 'url' },
  ],
};

function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const node = element('i', `bi bi-${name}`);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function button(label, className = 'club-button', symbol = '') {
  const node = element('button', className);
  node.type = 'button';
  if (symbol) node.append(icon(symbol));
  node.append(document.createTextNode(label));
  return node;
}

function isPublished(item) { return item.active !== false; }
function matchText(value) { return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR'); }

function rememberManagement(enabled) {
  try {
    if (enabled) sessionStorage.setItem(managementPreference, '1');
    else sessionStorage.removeItem(managementPreference);
  } catch {} // Management still works when browser storage is disabled.
}

function restoreManagement() {
  const referrer = document.referrer ? new URL(document.referrer) : null;
  const internalNavigation = referrer?.origin === location.origin && clubPageFromPath(referrer.pathname);
  const reloading = performance.getEntriesByType('navigation')[0]?.type === 'reload';
  if (!internalNavigation && !reloading) return false;
  try { return sessionStorage.getItem(managementPreference) === '1'; }
  catch { return false; }
}

function safeLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function appendLink(parent, rawUrl, text, symbol) {
  const url = safeLink(rawUrl);
  if (!url) return;
  const link = element('a', 'club-link');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.append(icon(symbol), document.createTextNode(text));
  parent.append(link);
}

function mapsUrl(address, title) {
  if (!address) return '';
  const params = new URLSearchParams({ api: '1', query: [title, address].filter(Boolean).join(', ') });
  return `https://www.google.com/maps/search/?${params}`;
}

function appendDetail(parent, text, symbol) {
  if (!text) return;
  const line = element('p', 'club-card-detail');
  line.append(icon(symbol), element('span', '', text));
  parent.append(line);
}

function decorateCard(card, item, section, partner) {
  const mark = element('span', 'club-card-mark');
  mark.setAttribute('aria-hidden', 'true');
  mark.append(icon(section.icon));
  const heading = element('div', 'club-card-heading');
  const title = element('div');
  if (item.category) title.append(element('p', 'club-card-category', item.category));
  title.append(element('h2', '', item.title));
  heading.append(mark, title);
  card.append(heading);

  if (item.offer) card.append(element('p', 'club-offer', item.offer));
  if (item.description) card.append(element('p', 'club-card-description', item.description));

  const links = element('div', 'club-links');
  if (section.collection === 'partners') {
    appendDetail(card, item.address, 'geo-alt');
    appendLink(links, safeLink(item.mapsUrl) || mapsUrl(item.address, item.title), 'Ver no mapa', 'geo-alt');
    appendLink(links, item.websiteUrl, 'Site', 'arrow-up-right');
    const number = String(item.whatsapp || '').replace(/\D/g, '');
    if (number) appendLink(links, `https://wa.me/${number}`, 'WhatsApp', 'whatsapp');
    appendLink(links, item.instagram, 'Instagram', 'arrow-up-right');
  } else {
    if (partner) {
      appendDetail(card, partner.title, 'buildings');
      appendLink(links, safeLink(partner.mapsUrl) || mapsUrl(partner.address, partner.title), 'Ver no mapa', 'geo-alt');
    }
    if (item.rules) {
      const rules = element('details', 'club-rules');
      rules.append(element('summary', '', 'Como usar e condições'), element('p', '', item.rules));
      card.append(rules);
    }
    appendLink(links, item.url, section.kind === 'advantage' ? 'Usar vantagem' : 'Acessar benefício', 'arrow-up-right');
  }
  if (links.childElementCount) card.append(links);
}

function entriesInSection(catalog, section, partners, includeHidden) {
  return catalog[section.collection].filter((item) => {
    if (!includeHidden && (!isPublished(item) || (item.partnerId && !partners.has(item.partnerId)))) return false;
    return !section.kind || (item.kind || (item.partnerId ? 'advantage' : 'benefit')) === section.kind;
  });
}

function formField(field, value, partners) {
  const label = element('label', field.wide || field.type === 'textarea' ? 'club-field club-field-wide' : 'club-field');
  label.append(element('span', '', field.label));
  let input;
  if (field.type === 'partner') {
    input = element('select');
    input.append(new Option('Sem parceiro vinculado', ''));
    for (const partner of partners) input.append(new Option(isPublished(partner) ? partner.title : `${partner.title} (oculto)`, partner.id));
  } else if (field.type === 'textarea') {
    input = element('textarea');
    input.rows = 3;
  } else {
    input = element('input');
    input.type = field.type || 'text';
  }
  input.name = field.name;
  input.value = value ?? '';
  if (field.max) input.maxLength = field.max;
  if (field.type === 'url') {
    input.placeholder = 'https://';
    input.pattern = 'https://.+';
    input.maxLength = 1000;
  }
  if (field.placeholder) input.placeholder = field.placeholder;
  input.required = Boolean(field.required);
  label.append(input);
  return label;
}

export function mountClub(root, { request, onAuthError }) {
  let opened = false;
  let isAdmin = false;
  let managing = false;
  let generation = 0;
  let catalog = null;
  let saving = false;
  let activeMutation = null;
  let editing = null;
  let page = 'home';
  let panel = null;

  root.classList.add('club-shell');
  root.innerHTML = `
    <nav class="club-navigation" aria-label="Navegação do Clube">
      <a class="club-brand" href="${CLUB_PATHS.home}" aria-label="Clube Maximum, início">
        <span class="club-brand-icon"><i class="bi bi-gift" aria-hidden="true"></i></span>
        <span>Clube <strong>Maximum</strong></span>
      </a>
      <div class="club-nav-links">
        <a class="club-nav-link" href="${CLUB_PATHS.home}" data-club-page="home">Início</a>
        ${Object.entries(sections).map(([key, { label }]) => `<a class="club-nav-link" href="${CLUB_PATHS[key]}" data-club-page="${key}">${label}</a>`).join('')}
      </div>
      <button type="button" class="club-button club-manage" data-club="manage" title="Gerenciar Clube" aria-label="Gerenciar Clube" hidden><i class="bi bi-gear" aria-hidden="true"></i><span>Gerenciar Clube</span></button>
    </nav>
    <div class="club-admin-bar" data-club="adminBar" hidden>
      <span><i class="bi bi-gear" aria-hidden="true"></i> Gestão do catálogo</span>
      <button type="button" class="club-button" data-club="import"><i class="bi bi-upload" aria-hidden="true"></i> Importar catálogo</button>
    </div>
    <div data-club="content"></div>
    <p class="club-message" data-club="message" role="status" hidden></p>
    <div class="club-load-state" data-club="loadState" role="status" hidden></div>
    <dialog class="club-dialog" data-club="dialog" aria-labelledby="clubDialogTitle">
      <form data-club="form">
        <header class="club-dialog-head">
          <h2 id="clubDialogTitle" data-club="dialogTitle"></h2>
          <button type="button" class="club-button club-icon-button" data-club="dismiss" aria-label="Fechar"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </header>
        <div class="club-dialog-fields" data-club="fields"></div>
        <p class="club-error" role="alert" data-club="error" hidden></p>
        <footer class="club-dialog-actions">
          <button type="button" class="club-button" data-club="cancel">Cancelar</button>
          <button type="submit" class="club-button club-primary" data-club="save">Salvar</button>
        </footer>
      </form>
    </dialog>`;
  const ui = Object.fromEntries(Array.from(root.querySelectorAll('[data-club]'), (node) => [node.dataset.club, node]));
  const navLinks = Array.from(root.querySelectorAll('.club-nav-link'));

  function renderHomePage() {
    ui.content.innerHTML = `
      <header class="club-hero">
        <div class="club-hero-copy">
          <h1 id="clubTitle">Clube Maximum</h1>
          <p>Benefícios para a equipe, descontos e parceiros em um só lugar.</p>
          <a class="club-button club-hero-action" href="${CLUB_PATHS.benefits}">Explorar benefícios <i class="bi bi-arrow-right" aria-hidden="true"></i></a>
        </div>
      </header>
      <section class="club-home-directory" aria-labelledby="clubDirectoryTitle">
        <h2 id="clubDirectoryTitle">Explore o Clube</h2>
        <div class="club-home-grid">
          ${Object.entries(sections).map(([key, section]) => `
            <a class="club-home-card" data-section="${key}" href="${CLUB_PATHS[key]}">
              <span class="club-panel-icon"><i class="bi bi-${section.icon}" aria-hidden="true"></i></span>
              <i class="bi bi-arrow-up-right club-home-arrow" aria-hidden="true"></i>
              <h3>${section.label}</h3>
              <p>${section.summary}</p>
              <span class="club-home-count" data-club-count="${key}" hidden></span>
            </a>`).join('')}
        </div>
      </section>`;
    ui.content.querySelector('.club-hero').after(ui.message, ui.loadState);
  }

  function renderCatalogPage(key) {
    const section = sections[key];
    const rootPanel = element('div', 'club-panel');
    rootPanel.dataset.section = key;
    rootPanel.innerHTML = `
      <header class="club-panel-head">
        <div class="club-panel-copy">
          <span class="club-panel-icon"><i class="bi bi-${section.icon}" aria-hidden="true"></i></span>
          <h1 id="clubTitle">${section.title}</h1>
          <p>${section.description}</p>
        </div>
        <button type="button" class="club-button club-primary" data-panel="add" hidden><i class="bi bi-plus-lg" aria-hidden="true"></i>Adicionar ${section.singular}</button>
      </header>
      <div class="club-tools" data-panel="tools" hidden>
        <label class="club-search"><i class="bi bi-search" aria-hidden="true"></i><span class="sr-only">${section.search}</span><input type="search" data-panel="search" placeholder="${section.search}"></label>
        <label class="club-filter" data-panel="filter" hidden><span class="sr-only">${key === 'partners' ? 'Filtrar por segmento' : 'Filtrar por categoria'}</span><select data-panel="category"></select></label>
        <p class="club-results" data-panel="results" role="status"></p>
      </div>
      <div class="club-list" data-panel="list"></div>`;
    const refs = Object.fromEntries(Array.from(rootPanel.querySelectorAll('[data-panel]'), (node) => [node.dataset.panel, node]));
    refs.search.addEventListener('input', renderResults);
    refs.category.addEventListener('change', renderResults);
    refs.add.addEventListener('click', () => openEditor(key));
    refs.tools.before(ui.message, ui.loadState);
    ui.content.replaceChildren(rootPanel);
    return refs;
  }

  function renderPage() {
    for (const link of navLinks) {
      if (link.dataset.clubPage === page) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    panel = page === 'home' ? null : renderCatalogPage(page);
    if (!panel) renderHomePage();
  }

  function showMessage(message) {
    ui.message.textContent = message;
    ui.message.hidden = !message;
  }

  function showFormError(message) {
    ui.error.textContent = message;
    ui.error.hidden = !message;
  }

  function updateBusy(busy) {
    saving = busy;
    ui.cancel.disabled = busy;
    ui.dismiss.disabled = busy;
    ui.save.disabled = busy;
    ui.form.setAttribute('aria-busy', String(busy));
  }

  function setLoadState(message, retry = false) {
    ui.loadState.hidden = !message;
    ui.loadState.textContent = message;
    if (retry) {
      const retryButton = button('Tentar novamente', 'club-button', 'arrow-clockwise');
      retryButton.addEventListener('click', () => void load());
      ui.loadState.append(retryButton);
    }
  }

  function render() {
    const manageLabel = managing ? 'Voltar ao Clube' : 'Gerenciar Clube';
    ui.manage.hidden = !isAdmin;
    ui.manage.querySelector('span').textContent = manageLabel;
    ui.manage.setAttribute('aria-label', manageLabel);
    ui.manage.setAttribute('aria-pressed', String(managing));
    ui.manage.title = manageLabel;
    ui.adminBar.hidden = !managing || !catalog;
    if (panel) {
      panel.add.hidden = !managing || !catalog;
      if (catalog) renderResults();
    } else if (catalog) {
      const partners = new Map(catalog.partners.filter(isPublished).map((partner) => [partner.id, partner]));
      for (const count of ui.content.querySelectorAll('[data-club-count]')) {
        const section = sections[count.dataset.clubCount];
        const total = entriesInSection(catalog, section, partners, false).length;
        count.textContent = total === 1 ? '1 disponível' : `${total} disponíveis`;
        count.hidden = false;
      }
    }
  }

  function emptyState(section, filtered) {
    const empty = element('div', 'club-empty');
    const title = managing ? 'Nenhum registro cadastrado' : section.empty;
    empty.append(icon(section.icon), element('strong', '', filtered ? 'Nenhum resultado encontrado' : title));
    if (filtered) {
      const clear = button('Limpar filtros');
      clear.addEventListener('click', () => {
        panel.search.value = '';
        panel.category.value = '';
        renderResults();
        panel.search.focus();
      });
      empty.append(clear);
    }
    return empty;
  }

  function renderResults() {
    if (!catalog || !panel) return;
    const section = sections[page];
    const { category, filter, list, results, search, tools } = panel;
    const partners = new Map(catalog.partners.filter((partner) => managing || isPublished(partner)).map((partner) => [partner.id, partner]));
    const entries = entriesInSection(catalog, section, partners, managing);
    const categories = [...new Set(entries.map(({ category: label }) => label).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    tools.hidden = !entries.length;
    filter.hidden = !categories.length;
    if (category.dataset.options !== JSON.stringify(categories)) {
      const selected = category.value;
      const allLabel = page === 'partners' ? 'Todos os segmentos' : 'Todas as categorias';
      category.replaceChildren(new Option(allLabel, ''), ...categories.map((label) => new Option(label, label)));
      category.value = categories.includes(selected) ? selected : '';
      category.dataset.options = JSON.stringify(categories);
    }
    if (tools.hidden) search.value = '';
    const term = matchText(search.value.trim());
    const matching = entries.filter((item) => {
      const words = [item.title, item.description, item.offer, item.address, item.category, partners.get(item.partnerId)?.title];
      return (!category.value || category.value === item.category) && (!term || matchText(words.join(' ')).includes(term));
    });
    results.textContent = `${matching.length} ${matching.length === 1 ? 'resultado' : 'resultados'}`;
    if (!matching.length) {
      list.replaceChildren(emptyState(section, Boolean(term || category.value)));
      return;
    }
    list.replaceChildren(...matching.map((item) => {
      const card = element('article', 'club-card');
      decorateCard(card, item, section, partners.get(item.partnerId));
      if (managing) renderAdminActions(card, page, item);
      return card;
    }));
  }

  function renderAdminActions(card, key, item) {
    const footer = element('footer', 'club-card-admin');
    const status = element('span', 'club-status', isPublished(item) ? 'Publicado' : 'Oculto');
    status.dataset.published = String(isPublished(item));
    const actions = element('div', 'club-card-actions');
    const edit = button('Editar');
    const remove = button('Remover', 'club-button club-danger-link');
    edit.setAttribute('aria-label', `Editar ${item.title}`);
    remove.setAttribute('aria-label', `Remover ${item.title}`);
    edit.addEventListener('click', () => openEditor(key, item));
    remove.addEventListener('click', () => openEditor(key, item, true));
    actions.append(edit, remove);
    footer.append(status, actions);
    card.append(footer);
  }

  function openEditor(key, item, removing = false) {
    if (!managing || !isAdmin || ui.dialog.open) return;
    const section = sections[key];
    editing = { key, item, section, removing };
    showFormError('');
    ui.save.classList.toggle('club-danger', removing);
    ui.save.textContent = removing ? 'Remover' : 'Salvar';
    ui.dialogTitle.textContent = `${removing ? 'Remover' : item ? 'Editar' : 'Adicionar'} ${section.singular}`;
    ui.fields.replaceChildren();
    if (removing) {
      const question = element('p', 'club-remove-question');
      question.append(document.createTextNode('Confirma a remoção de '), element('strong', '', item.title), document.createTextNode(' do Clube?'));
      ui.fields.append(question);
    } else {
      const fields = [
        { name: 'title', label: section.collection === 'partners' ? 'Nome do parceiro' : 'Título', required: true, max: 160, wide: true },
        { name: 'description', label: 'Descrição', type: 'textarea', max: 4000 },
        ...extraFields[section.collection].filter(({ name }) => name !== 'partnerId' || section.kind === 'advantage'),
      ];
      for (const field of fields) ui.fields.append(formField(field, item?.[field.name], catalog.partners));
      const published = element('label', 'club-publish');
      const input = element('input');
      input.type = 'checkbox';
      input.name = 'active';
      input.checked = !item || isPublished(item);
      published.append(input, element('span', '', 'Visível para a equipe'));
      ui.fields.append(published);
    }
    ui.dialog.showModal();
    (removing ? ui.cancel : ui.form.elements.namedItem('title')).focus();
  }

  function openImport() {
    if (!managing || !isAdmin || ui.dialog.open) return;
    editing = { importing: true };
    showFormError('');
    ui.save.classList.remove('club-danger');
    ui.save.textContent = 'Importar';
    ui.dialogTitle.textContent = 'Importar catálogo';
    const note = element('p', 'club-form-note', 'Selecione um arquivo JSON com os benefícios, vantagens e parceiros. Os registros existentes serão preservados. Limite de 128 KB.');
    const label = element('label', 'club-field club-field-wide');
    const input = element('input');
    input.type = 'file';
    input.name = 'catalogFile';
    input.accept = '.json,application/json';
    input.required = true;
    label.append(element('span', '', 'Arquivo do catálogo'), input);
    ui.fields.replaceChildren(note, label);
    ui.dialog.showModal();
    input.focus();
  }

  async function importCatalog(current) {
    const file = ui.form.elements.namedItem('catalogFile').files[0];
    if (!file || file.size > 128000) throw new Error('Escolha um arquivo JSON de até 128 KB.');
    let parsed;
    try { parsed = JSON.parse((await file.text()).trim()); }
    catch { throw new Error('O arquivo deve conter um JSON válido.'); }
    const collections = ['benefits', 'partners'];
    if (!collections.every((key) => Array.isArray(parsed?.[key]))) throw new Error('O arquivo deve incluir as listas benefits e partners.');
    if (current !== generation || !opened) return '';
    const body = Object.fromEntries(collections.map((key) => [key, parsed[key]]));
    const result = await request('/club/import', { method: 'POST', body });
    const count = (key) => collections.reduce((sum, collection) => sum + Number(result[key]?.[collection] || 0), 0);
    return `Importação concluída. ${count('imported')} registro(s) adicionado(s) e ${count('skipped')} já existente(s).`;
  }

  function editorPayload(section) {
    const fields = new FormData(ui.form);
    const payload = { active: fields.has('active') };
    for (const [key, value] of fields) {
      if (key === 'partnerId') payload[key] = value || null;
      else if (key !== 'active') payload[key] = value.trim();
    }
    if (section.kind) payload.kind = section.kind;
    return payload;
  }

  async function load(keepMessage = false) {
    if (!opened) return;
    const current = ++generation;
    if (!keepMessage) showMessage('');
    if (!catalog) setLoadState('Carregando o Clube…');
    render();
    try {
      const data = await request('/club');
      if (current !== generation || !opened) return;
      catalog = { benefits: data.benefits || [], partners: data.partners || [] };
      setLoadState('');
    } catch (error) {
      if (current !== generation || !opened) return;
      if (error.status === 401) { onAuthError(error); return; }
      setLoadState('Não foi possível carregar o Clube.', true);
    }
    render();
  }

  ui.manage.addEventListener('click', () => {
    if (!isAdmin) return;
    managing = !managing;
    rememberManagement(managing);
    showMessage('');
    render();
  });
  ui.import.addEventListener('click', openImport);
  ui.cancel.addEventListener('click', () => ui.dialog.close());
  ui.dismiss.addEventListener('click', () => ui.dialog.close());
  ui.dialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
  ui.dialog.addEventListener('close', () => {
    if (!ui.dialog.open) { editing = null; showFormError(''); }
  });
  ui.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editing || !managing || !isAdmin || saving) return;
    const mutation = editing;
    const { key, item, section, removing, importing } = editing;
    const current = generation;
    activeMutation = mutation;
    updateBusy(true);
    showFormError('');
    try {
      let message;
      if (importing) {
        message = await importCatalog(current);
      } else {
        const url = `/club/${section.collection}${item ? `/${encodeURIComponent(item.id)}` : ''}`;
        const method = removing ? 'DELETE' : item ? 'PATCH' : 'POST';
        const body = removing ? undefined : editorPayload(section);
        await request(url, { method, body });
        message = removing ? 'Registro removido.' : 'Registro salvo.';
      }
      if (current !== generation || !opened) return;
      ui.dialog.close();
      showMessage(message);
      await load(true);
      if (opened && (importing || key === page)) (importing ? ui.import : panel.add).focus({ preventScroll: true });
    } catch (error) {
      if (current !== generation || !opened) return;
      if (error.status === 401) onAuthError(error);
      else showFormError(error.message || 'Não foi possível salvar a alteração.');
    } finally {
      if (activeMutation === mutation) {
        activeMutation = null;
        updateBusy(false);
      }
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (opened && event.persisted && !saving) void load();
  });

  function open({ isAdmin: canManage, page: nextPage = 'home' }) {
    if (opened && isAdmin === Boolean(canManage) && page === nextPage) return;
    close();
    opened = true;
    isAdmin = Boolean(canManage);
    managing = isAdmin && restoreManagement();
    rememberManagement(managing);
    page = nextPage;
    renderPage();
    void load();
  }

  function close() {
    if (!opened) return;
    opened = false;
    generation += 1;
    isAdmin = false;
    managing = false;
    rememberManagement(false);
    catalog = null;
    panel = null;
    editing = null;
    activeMutation = null;
    if (ui.dialog.open) ui.dialog.close();
    ui.fields.replaceChildren();
    ui.content.replaceChildren();
    ui.manage.hidden = ui.adminBar.hidden = true;
    setLoadState('');
    showMessage('');
    updateBusy(false);
  }

  return { open, close };
}
