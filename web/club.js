const sections = {
  benefits: { label: 'Benefícios', singular: 'benefício', title: 'Benefícios da Maximum', description: 'Conheça os benefícios internos e as orientações para usar cada um.', icon: 'gift', collection: 'benefits', kind: 'benefit' },
  advantages: { label: 'Vantagens', singular: 'vantagem', title: 'Vantagens e descontos', description: 'Confira as condições oferecidas pelos parceiros da Maximum.', icon: 'tag', collection: 'benefits', kind: 'advantage' },
  partners: { label: 'Parceiros', singular: 'parceiro', title: 'Parceiros e locais', description: 'Encontre endereços, contatos e os locais onde você pode aproveitar as vantagens.', icon: 'geo-alt', collection: 'partners' },
  events: { label: 'Agenda', singular: 'evento', title: 'Agenda de eventos', description: 'Consulte as datas, horários e locais dos encontros da equipe.', icon: 'calendar-event', collection: 'events' },
};
const sectionKeys = Object.keys(sections);
const timezone = { timeZone: 'America/Sao_Paulo' };
const dateParts = new Intl.DateTimeFormat('en-CA', { ...timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const monthName = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const fullDate = new Intl.DateTimeFormat('pt-BR', { ...timezone, dateStyle: 'full' });
const time = new Intl.DateTimeFormat('pt-BR', { ...timezone, timeStyle: 'short' });
const compactMonth = new Intl.DateTimeFormat('pt-BR', { ...timezone, month: 'short' });

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
  events: [
    { name: 'startAt', label: 'Início', type: 'datetime-local', required: true },
    { name: 'endAt', label: 'Término', type: 'datetime-local' },
    { name: 'location', label: 'Local', max: 500 },
    { name: 'mapsUrl', label: 'Link no mapa', type: 'url' },
    { name: 'url', label: 'Link do evento ou inscrição', type: 'url' },
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

function date(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

function localDateTime(value) {
  const parsed = date(value);
  if (!parsed) return '';
  const parts = Object.fromEntries(dateParts.formatToParts(parsed).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function eventTimestamp(value) {
  if (!value) return null;
  const wallTime = Date.parse(`${value}:00Z`);
  const zonedWallTime = Date.parse(`${localDateTime(wallTime)}:00Z`);
  if (!Number.isFinite(zonedWallTime)) return null;
  return new Date(wallTime + (wallTime - zonedWallTime)).toISOString();
}

function monthDate(value) { return new Date(`${value}-01T12:00:00Z`); }
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

function eventTime(item) {
  const start = date(item.startAt);
  const end = date(item.endAt);
  if (!start) return '';
  if (!end) return `${fullDate.format(start)} · ${time.format(start)}`;
  const ending = localDateTime(start).slice(0, 10) === localDateTime(end).slice(0, 10)
    ? time.format(end) : `${fullDate.format(end)} · ${time.format(end)}`;
  return `${fullDate.format(start)} · ${time.format(start)} até ${ending}`;
}

function decorateCard(card, item, section, partner) {
  const dateStamp = date(item.startAt);
  const mark = element('span', 'club-card-mark');
  mark.setAttribute('aria-hidden', 'true');
  if (section.collection === 'events' && dateStamp) {
    mark.classList.add('club-date-mark');
    mark.append(element('strong', '', localDateTime(dateStamp).slice(8, 10)), element('span', '', compactMonth.format(dateStamp).replace('.', '')));
  } else {
    mark.append(icon(section.icon));
  }
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
  } else if (section.collection === 'events') {
    appendDetail(card, eventTime(item), 'clock-history');
    appendDetail(card, item.location, 'geo-alt');
    appendLink(links, item.mapsUrl, 'Ver no mapa', 'geo-alt');
    appendLink(links, item.url, 'Informações e inscrição', 'arrow-up-right');
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

function calendar(month, selectedDay, counts, changeMonth, chooseDay) {
  const first = monthDate(month);
  const grid = element('div', 'club-calendar-grid');
  const card = element('aside', 'club-calendar');
  card.setAttribute('aria-label', 'Calendário da agenda');
  const head = element('div', 'club-calendar-head');
  const previous = button('', 'club-button club-icon-button', 'chevron-left');
  const next = button('', 'club-button club-icon-button', 'chevron-right');
  previous.setAttribute('aria-label', 'Mês anterior');
  next.setAttribute('aria-label', 'Próximo mês');
  previous.addEventListener('click', () => changeMonth(-1, 'Mês anterior'));
  next.addEventListener('click', () => changeMonth(1, 'Próximo mês'));
  head.append(previous, element('h3', '', monthName.format(first)), next);
  card.append(head, grid);

  for (const day of ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']) grid.append(element('span', 'club-weekday', day));
  for (let empty = 0; empty < first.getUTCDay(); empty += 1) grid.append(element('span'));
  const length = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const today = localDateTime(new Date()).slice(0, 10);
  for (let day = 1; day <= length; day += 1) {
    const key = `${month}-${String(day).padStart(2, '0')}`;
    const count = counts.get(key) || 0;
    if (!count) {
      const neutralDay = element('span', 'club-day', String(day));
      if (key === today) neutralDay.setAttribute('aria-current', 'date');
      grid.append(neutralDay);
      continue;
    }
    const control = button(String(day), 'club-day club-day-event');
    control.dataset.day = key;
    control.setAttribute('aria-pressed', String(selectedDay === key));
    control.setAttribute('aria-label', `${fullDate.format(new Date(`${key}T12:00:00Z`))}, ${count} ${count === 1 ? 'evento' : 'eventos'}`);
    if (key === today) control.setAttribute('aria-current', 'date');
    control.addEventListener('click', () => chooseDay(selectedDay === key ? null : key, key));
    grid.append(control);
  }
  const all = button('Mostrar o mês inteiro', 'club-calendar-reset', 'calendar-event');
  all.hidden = !selectedDay;
  all.addEventListener('click', () => chooseDay(null, selectedDay));
  card.append(all);
  return card;
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
  input.value = field.type === 'datetime-local' ? localDateTime(value) : value ?? '';
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
  let view = 'benefits';
  let generation = 0;
  let catalog = null;
  let failed = false;
  let saving = false;
  let activeMutation = null;
  let editing = null;
  let query = '';
  let category = '';
  let month = '';
  let selectedDay = null;

  root.classList.add('club-shell');
  root.innerHTML = `
    <header class="club-hero">
      <div class="club-hero-copy">
        <h1 id="clubTitle">Clube Maximum</h1>
        <p>Benefícios, vantagens e eventos para a equipe Maximum.</p>
      </div>
      <button type="button" class="club-button club-manage" data-club="manage" hidden><i class="bi bi-gear" aria-hidden="true"></i> <span>Gerenciar Clube</span></button>
    </header>
    <nav class="club-tabs" role="tablist" aria-label="Seções do Clube" data-club="tabs"></nav>
    <section class="club-panel" id="clubPanel" role="tabpanel" data-club="panel">
      <header class="club-panel-head">
        <div><h2 data-club="title"></h2><p data-club="description"></p></div>
        <div class="club-management-actions" data-club="management" hidden>
          <button type="button" class="club-button" data-club="import"><i class="bi bi-upload" aria-hidden="true"></i> Importar catálogo</button>
          <button type="button" class="club-button club-primary" data-club="new"></button>
        </div>
      </header>
      <div class="club-tools" data-club="tools" hidden>
        <label class="club-search"><i class="bi bi-search" aria-hidden="true"></i><span class="sr-only">Buscar no Clube</span><input type="search" data-club="search" placeholder="Buscar nesta seção"></label>
        <label class="club-filter" data-club="filter" hidden><span class="sr-only">Filtrar por categoria</span><select data-club="category"></select></label>
        <p class="club-results" data-club="results" role="status"></p>
      </div>
      <p class="club-message" data-club="message" role="status" hidden></p>
      <div data-club="content" aria-busy="false"></div>
    </section>
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
  const ui = Object.fromEntries(Array.from(root.querySelectorAll('[data-club]')).map((node) => [node.dataset.club, node]));
  const tabs = new Map();
  const initialMonth = () => localDateTime(new Date()).slice(0, 7);

  for (const [key, section] of Object.entries(sections)) {
    const tab = button(section.label, 'club-tab', section.icon);
    tab.id = `clubTab-${key}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', ui.panel.id);
    tab.addEventListener('click', () => selectSection(key));
    tabs.set(key, tab);
    ui.tabs.append(tab);
  }

  ui.tabs.addEventListener('keydown', (event) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1 };
    let index = sectionKeys.indexOf(view);
    if (event.key in steps) index = (index + steps[event.key] + sectionKeys.length) % sectionKeys.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = sectionKeys.length - 1;
    else return;
    event.preventDefault();
    selectSection(sectionKeys[index]);
    tabs.get(view).focus();
  });

  function available(items) { return managing ? items : items.filter(isPublished); }

  function selectSection(key) {
    if (view !== key) {
      view = key;
      resetFilter();
      showMessage('');
    }
    render();
  }

  function resetFilter() {
    category = '';
    query = '';
    selectedDay = null;
    ui.search.value = '';
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

  function render() {
    const section = sections[view];
    for (const [key, tab] of tabs) {
      tab.tabIndex = key === view ? 0 : -1;
      tab.setAttribute('aria-selected', String(key === view));
    }
    ui.panel.setAttribute('aria-labelledby', tabs.get(view).id);
    ui.manage.hidden = !isAdmin;
    ui.manage.querySelector('span').textContent = managing ? 'Voltar ao Clube' : 'Gerenciar Clube';
    ui.manage.setAttribute('aria-pressed', String(managing));
    ui.title.textContent = managing ? `Gerenciar ${section.label.toLocaleLowerCase('pt-BR')}` : section.title;
    ui.description.textContent = managing ? 'Edite os registros e escolha o que fica visível para a equipe.' : section.description;
    ui.new.textContent = `+ Adicionar ${section.singular}`;
    ui.management.hidden = !managing || !catalog;
    ui.tools.hidden = !catalog;
    ui.content.setAttribute('aria-busy', String(!catalog && !failed));
    if (!catalog) {
      ui.content.replaceChildren(emptyState(failed ? 'Não foi possível carregar o Clube.' : 'Carregando o Clube…', '', failed ? load : null));
      return;
    }
    renderResults();
  }

  function emptyState(title, description = '', retry) {
    const empty = element('div', 'club-empty');
    empty.append(icon(sections[view].icon), element('strong', '', title));
    if (description) empty.append(element('p', '', description));
    if (retry) {
      const action = button('Tentar novamente', 'club-button', 'arrow-clockwise');
      action.addEventListener('click', () => void retry());
      empty.append(action);
    }
    return empty;
  }

  function renderResults() {
    if (!catalog) return;
    const section = sections[view];
    const partners = new Map(available(catalog.partners).map((partner) => [partner.id, partner]));
    const entries = available(catalog[section.collection]).filter((item) => {
      if (!managing && item.partnerId && !partners.has(item.partnerId)) return false;
      return !section.kind || (item.kind || (item.partnerId ? 'advantage' : 'benefit')) === section.kind;
    });
    const categories = [...new Set(entries.map(({ category: label }) => label).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    ui.filter.hidden = !categories.length;
    if (!categories.includes(category)) category = '';
    if (ui.category.dataset.options !== JSON.stringify(categories)) {
      ui.category.replaceChildren(new Option('Todas as categorias', ''), ...categories.map((label) => new Option(label, label)));
      ui.category.dataset.options = JSON.stringify(categories);
    }
    ui.category.value = category;
    const term = matchText(query);
    const matching = entries.filter((item) => {
      const partner = partners.get(item.partnerId);
      const words = [item.title, item.description, item.offer, item.address, item.location, item.category, partner?.title];
      return (!category || category === item.category) && (!term || matchText(words.join(' ')).includes(term));
    });
    if (section.collection === 'events') matching.sort((a, b) => a.startAt.localeCompare(b.startAt));
    const isAgenda = section.collection === 'events' && !managing;
    const currentMonth = isAgenda ? matching.filter((item) => localDateTime(item.startAt).startsWith(month)) : matching;
    const shown = selectedDay && isAgenda ? currentMonth.filter((item) => localDateTime(item.startAt).startsWith(selectedDay)) : currentMonth;
    ui.results.textContent = `${shown.length} ${shown.length === 1 ? 'resultado' : 'resultados'}`;

    const list = element('div', isAgenda ? 'club-list club-event-list' : 'club-list');
    if (!shown.length) {
      const hasFilters = Boolean(query || category);
      const noEvents = isAgenda && !currentMonth.length;
      const message = hasFilters ? 'Nenhum resultado encontrado' : noEvents ? 'Nenhum evento neste mês' : 'Ainda não há registros nesta seção';
      list.append(emptyState(message, hasFilters ? 'Tente outra busca ou categoria.' : ''));
    }
    for (const item of shown) {
      const card = element('article', 'club-card');
      card.dataset.section = view;
      decorateCard(card, item, section, partners.get(item.partnerId));
      if (managing) renderAdminActions(card, item);
      list.append(card);
    }

    if (!isAgenda) {
      ui.content.replaceChildren(list);
      return;
    }
    const grouped = new Map();
    for (const { startAt } of currentMonth) {
      const day = localDateTime(startAt).slice(0, 10);
      grouped.set(day, (grouped.get(day) || 0) + 1);
    }
    const agenda = element('div', 'club-agenda');
    agenda.append(calendar(month, selectedDay, grouped, changeMonth, chooseDay), list);
    ui.content.replaceChildren(agenda);
  }

  function changeMonth(step, control) {
    const next = monthDate(month);
    next.setUTCMonth(next.getUTCMonth() + step);
    month = next.toISOString().slice(0, 7);
    selectedDay = null;
    renderResults();
    ui.content.querySelector(`[aria-label="${control}"]`)?.focus();
  }

  function chooseDay(day, focusDay) {
    selectedDay = day;
    renderResults();
    ui.content.querySelector(`[data-day="${focusDay}"]`)?.focus();
  }

  function renderAdminActions(card, item) {
    const footer = element('footer', 'club-card-admin');
    const status = element('span', 'club-status', isPublished(item) ? 'Publicado' : 'Oculto');
    status.dataset.published = String(isPublished(item));
    const actions = element('div', 'club-card-actions');
    const edit = button('Editar');
    const remove = button('Remover', 'club-button club-danger-link');
    edit.setAttribute('aria-label', `Editar ${item.title}`);
    remove.setAttribute('aria-label', `Remover ${item.title}`);
    edit.addEventListener('click', () => openEditor(item));
    remove.addEventListener('click', () => openEditor(item, true));
    actions.append(edit, remove);
    footer.append(status, actions);
    card.append(footer);
  }

  function openEditor(item, removing = false) {
    if (!managing || !isAdmin || ui.dialog.open) return;
    const section = sections[view];
    editing = { item, section, removing };
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
      if (section.collection === 'events') ui.fields.append(element('p', 'club-form-note', 'Use o horário de Brasília para cadastrar o evento.'));
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
    const note = element('p', 'club-form-note', 'Selecione um arquivo JSON com os benefícios, parceiros e eventos. Os registros existentes serão preservados. Limite de 128 KB.');
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
    const collections = ['benefits', 'partners', 'events'];
    if (!collections.every((key) => Array.isArray(parsed?.[key]))) throw new Error('O arquivo deve incluir as listas benefits, partners e events.');
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
      if (['startAt', 'endAt'].includes(key)) payload[key] = eventTimestamp(value);
      else if (key === 'partnerId') payload[key] = value || null;
      else if (key !== 'active') payload[key] = value.trim();
    }
    if (section.kind) payload.kind = section.kind;
    return payload;
  }

  async function load(keepMessage = false) {
    if (!opened) return;
    const current = ++generation;
    failed = false;
    if (!keepMessage) showMessage('');
    render();
    try {
      const data = await request('/club');
      if (current !== generation || !opened) return;
      catalog = { benefits: data.benefits || [], partners: data.partners || [], events: data.events || [] };
    } catch (error) {
      if (current !== generation || !opened) return;
      if (error.status === 401) { onAuthError(error); return; }
      failed = true;
      catalog = null;
    }
    render();
  }

  ui.search.addEventListener('input', () => { query = ui.search.value.trim(); selectedDay = null; renderResults(); });
  ui.category.addEventListener('change', () => { category = ui.category.value; selectedDay = null; renderResults(); });
  ui.manage.addEventListener('click', () => {
    if (!isAdmin) return;
    managing = !managing;
    resetFilter();
    showMessage('');
    render();
  });
  ui.new.addEventListener('click', () => openEditor(null));
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
    const { item, section, removing, importing } = editing;
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
        if (body?.endAt && body.endAt < body.startAt) throw new Error('O término deve ser igual ou posterior ao início.');
        await request(url, { method, body });
        message = removing ? 'Registro removido.' : 'Registro salvo.';
      }
      if (current !== generation || !opened) return;
      ui.dialog.close();
      showMessage(message);
      await load(true);
      if (opened) (importing ? ui.import : ui.new).focus();
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
      view = 'benefits';
      catalog = null;
      month = initialMonth();
      resetFilter();
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
      if (ui.dialog.open) ui.dialog.close();
      ui.fields.replaceChildren();
      ui.content.replaceChildren();
      ui.category.replaceChildren();
      delete ui.category.dataset.options;
      ui.results.textContent = '';
      showMessage('');
      updateBusy(false);
    },
  };
}
