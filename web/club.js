const sections = {
  benefits: { label: 'Benefícios', singular: 'benefício', title: 'Benefícios da Maximum', description: 'Conheça os benefícios internos e as orientações para usar cada um.', icon: 'gift', collection: 'benefits', kind: 'benefit' },
  advantages: { label: 'Vantagens', singular: 'vantagem', title: 'Vantagens e descontos', description: 'Confira as condições oferecidas pelos parceiros da Maximum.', icon: 'tag', collection: 'benefits', kind: 'advantage' },
  partners: { label: 'Parceiros', singular: 'parceiro', title: 'Parceiros e locais', description: 'Encontre endereços, contatos e os locais onde você pode aproveitar as vantagens.', icon: 'geo-alt', collection: 'partners' },
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
  title.append(element('h3', '', item.title));
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
  let scrollFrame = 0;
  let scrollTarget = null;

  root.classList.add('club-shell');
  root.innerHTML = `
    <nav class="club-navigation" aria-label="Navegação do Clube" data-club="navigation">
      <button class="club-brand" type="button" data-club-jump="home" aria-label="Clube Maximum, início">
        <span class="club-brand-icon"><i class="bi bi-gift" aria-hidden="true"></i></span>
        <span>Clube <strong>Maximum</strong></span>
      </button>
      <div class="club-nav-links">
        <button type="button" class="club-nav-link" data-club-jump="home" aria-current="location">Início</button>
        <button type="button" class="club-nav-link" data-club-jump="benefits">Benefícios</button>
        <button type="button" class="club-nav-link" data-club-jump="advantages">Vantagens</button>
        <button type="button" class="club-nav-link" data-club-jump="partners">Parceiros</button>
      </div>
      <button type="button" class="club-button club-manage" data-club="manage" title="Gerenciar Clube" aria-label="Gerenciar Clube" hidden><i class="bi bi-gear" aria-hidden="true"></i><span>Gerenciar Clube</span></button>
    </nav>
    <header class="club-hero">
      <div class="club-hero-copy">
        <h1 id="clubTitle" tabindex="-1">Clube Maximum</h1>
        <p>Um espaço para conhecer os benefícios da equipe e aproveitar descontos dos nossos parceiros.</p>
        <button class="club-button club-hero-action" type="button" data-club-jump="benefits">Explorar benefícios <i class="bi bi-arrow-down" aria-hidden="true"></i></button>
      </div>
    </header>
    <div class="club-admin-bar" data-club="adminBar" hidden>
      <span><i class="bi bi-gear" aria-hidden="true"></i> Gestão do catálogo</span>
      <button type="button" class="club-button" data-club="import"><i class="bi bi-upload" aria-hidden="true"></i> Importar catálogo</button>
    </div>
    <p class="club-message" data-club="message" role="status" hidden></p>
    <div class="club-load-state" data-club="loadState" role="status" hidden></div>
    <div class="club-sections" data-club="panels"></div>
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
  const panels = new Map();
  const navLinks = Array.from(root.querySelectorAll('.club-nav-link'));

  for (const [key, section] of Object.entries(sections)) {
    const panel = element('section', 'club-panel');
    panel.dataset.section = key;
    panel.setAttribute('aria-labelledby', `club-heading-${key}`);
    panel.innerHTML = `
      <header class="club-panel-head">
        <span class="club-panel-icon"><i class="bi bi-${section.icon}" aria-hidden="true"></i></span>
        <div class="club-panel-copy">
          <h2 id="club-heading-${key}" tabindex="-1">${section.title}</h2>
          <p>${section.description}</p>
        </div>
        <button type="button" class="club-button club-primary" data-panel="add" hidden>+ Adicionar ${section.singular}</button>
      </header>
      <div class="club-tools" data-panel="tools" hidden>
        <label class="club-search"><i class="bi bi-search" aria-hidden="true"></i><span class="sr-only">Buscar em ${section.label}</span><input type="search" data-panel="search" placeholder="Buscar em ${section.label.toLocaleLowerCase('pt-BR')}"></label>
        <label class="club-filter" data-panel="filter" hidden><span class="sr-only">Filtrar ${section.label.toLocaleLowerCase('pt-BR')} por categoria</span><select data-panel="category"></select></label>
        <p class="club-results" data-panel="results" role="status"></p>
      </div>
      <div class="club-list" data-panel="list"></div>`;
    const refs = Object.fromEntries(Array.from(panel.querySelectorAll('[data-panel]'), (node) => [node.dataset.panel, node]));
    refs.search.addEventListener('input', () => renderResults(key));
    refs.category.addEventListener('change', () => renderResults(key));
    refs.add.addEventListener('click', () => openEditor(key));
    panels.set(key, { panel, ...refs });
    ui.panels.append(panel);
  }

  function markActive(key) {
    for (const link of navLinks) {
      if (link.dataset.clubJump === key) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }

  function updateActiveFromScroll() {
    scrollFrame = 0;
    if (!opened) return;
    const position = window.scrollY;
    if (scrollTarget) {
      if (Math.abs(position - scrollTarget.top) < 2) {
        scrollTarget.reached = true;
        markActive(scrollTarget.key);
        return;
      }
      if (!scrollTarget.reached && performance.now() < scrollTarget.until) return;
      scrollTarget = null;
    }
    const boundary = ui.navigation.getBoundingClientRect().bottom + 24;
    let key = 'home';
    for (const [name, { panel }] of panels) {
      if (panel.getBoundingClientRect().top <= boundary) key = name;
    }
    if (position > 0 && position + window.innerHeight >= document.documentElement.scrollHeight - 2) key = 'partners';
    markActive(key);
  }

  function goTo(key, { focus = true } = {}) {
    const target = key === 'home' ? root : panels.get(key)?.panel;
    if (!target) return;
    markActive(key);
    const heading = target.querySelector(key === 'home' ? 'h1' : 'h2');
    if (focus) heading?.focus({ preventScroll: true });
    const headerHeight = document.querySelector('.portal-header')?.getBoundingClientRect().height ?? 0;
    const navHeight = key === 'home' ? 0 : ui.navigation.offsetHeight;
    const offset = headerHeight + navHeight + 12;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const top = Math.max(0, Math.min(maxScroll, window.scrollY + target.getBoundingClientRect().top - offset));
    const smooth = focus && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollTarget = { key, top, reached: !smooth, until: performance.now() + 900 };
    window.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' });
  }

  for (const jump of root.querySelectorAll('[data-club-jump]')) {
    jump.addEventListener('click', () => goTo(jump.dataset.clubJump));
  }
  window.addEventListener('scroll', () => {
    if (opened && !scrollFrame) scrollFrame = window.requestAnimationFrame(updateActiveFromScroll);
  }, { passive: true });

  function showMessage(message, key) {
    const list = panels.get(key)?.list;
    if (list) list.before(ui.message);
    else ui.panels.before(ui.message);
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
    for (const [key, refs] of panels) {
      refs.add.hidden = !managing || !catalog;
      if (catalog) renderResults(key);
    }
  }

  function emptyState(section, filtered) {
    const empty = element('div', 'club-empty');
    empty.append(icon(section.icon), element('strong', '', filtered ? 'Nenhum resultado encontrado' : 'Ainda não há registros nesta seção'));
    if (filtered) empty.append(element('p', '', 'Tente outra busca ou categoria.'));
    return empty;
  }

  function renderResults(key) {
    if (!catalog) return;
    const section = sections[key];
    const { category, filter, list, results, search, tools } = panels.get(key);
    const partners = new Map(catalog.partners.filter((partner) => managing || isPublished(partner)).map((partner) => [partner.id, partner]));
    const entries = catalog[section.collection].filter((item) => {
      if (!managing && (!isPublished(item) || (item.partnerId && !partners.has(item.partnerId)))) return false;
      return !section.kind || (item.kind || (item.partnerId ? 'advantage' : 'benefit')) === section.kind;
    });
    const categories = [...new Set(entries.map(({ category: label }) => label).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    tools.hidden = !entries.length;
    filter.hidden = !categories.length;
    if (category.dataset.options !== JSON.stringify(categories)) {
      const selected = category.value;
      category.replaceChildren(new Option('Todas as categorias', ''), ...categories.map((label) => new Option(label, label)));
      category.value = categories.includes(selected) ? selected : '';
      category.dataset.options = JSON.stringify(categories);
    }
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
      if (managing) renderAdminActions(card, key, item);
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
      showMessage(message, key);
      await load(true);
      if (opened) (importing ? ui.import : panels.get(key).add).focus({ preventScroll: true });
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

  return {
    open({ isAdmin: canManage }) {
      if (opened && isAdmin === Boolean(canManage)) return;
      opened = true;
      isAdmin = Boolean(canManage);
      managing = false;
      catalog = null;
      goTo('home', { focus: false });
      void load();
    },
    close() {
      if (!opened) return;
      opened = false;
      generation += 1;
      isAdmin = false;
      managing = false;
      catalog = null;
      editing = null;
      activeMutation = null;
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
      scrollTarget = null;
      if (ui.dialog.open) ui.dialog.close();
      ui.fields.replaceChildren();
      ui.manage.hidden = ui.adminBar.hidden = true;
      for (const { list, search, category, results, tools, add } of panels.values()) {
        list.replaceChildren();
        search.value = '';
        category.replaceChildren();
        delete category.dataset.options;
        results.textContent = '';
        tools.hidden = add.hidden = true;
      }
      setLoadState('');
      showMessage('');
      updateBusy(false);
    },
  };
}
