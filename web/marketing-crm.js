const API_PATH = '/marketing/crm';
const NUMBER = new Intl.NumberFormat('pt-BR');
const DATE = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});
const CONTACT_STATUS = {
  pending: 'Pendente',
  subscribed: 'Inscrito',
  unsubscribed: 'Descadastrado',
};
const CAMPAIGN_STATUS = {
  draft: 'Rascunho',
  prepared: 'Preparada',
  queued: 'Em processamento',
  sent: 'Enviada',
  failed: 'Falha no envio',
};
const CAMPAIGN_TYPES = { promotion: 'Promocional', newsletter: 'Newsletter', welcome: 'Boas-vindas', announcement: 'Lançamento ou comunicado' };
const LANDING_STATUS = { draft: 'Rascunho', published: 'Publicada' };
const AUTOMATION_STATUS = { draft: 'Rascunho', active: 'Ativa', paused: 'Pausada' };
const SECTIONS = {
  subscribers: { label: 'Contatos', singular: 'contato', icon: 'people', create: 'Novo contato', statuses: CONTACT_STATUS },
  campaigns: { label: 'Campanhas', singular: 'campanha', icon: 'envelope', create: 'Nova campanha', statuses: CAMPAIGN_STATUS },
  segments: { label: 'Segmentos', singular: 'segmento', icon: 'tag', create: 'Novo segmento' },
  landings: { label: 'Páginas de captura', singular: 'página de captura', icon: 'file-earmark', create: 'Nova página', statuses: LANDING_STATUS },
  automations: { label: 'Automações', singular: 'automação', icon: 'diagram-3', create: 'Nova automação', statuses: AUTOMATION_STATUS },
  reports: { label: 'Resultados', icon: 'graph-up' },
};
const REPORT_PERCENT = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
const SECTION_KEYS = Object.keys(SECTIONS);

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function icon(name) {
  const element = node('i', `bi bi-${name}`);
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function action(label, onClick, { primary = false, symbol } = {}) {
  const control = node('button', `mcrm-action${primary ? ' mcrm-primary' : ''}`);
  control.type = 'button';
  if (symbol) control.append(icon(symbol));
  control.append(document.createTextNode(label));
  control.addEventListener('click', onClick);
  return control;
}

function date(value) {
  const stamp = value && new Date(value);
  return stamp && Number.isFinite(stamp.getTime()) ? DATE.format(stamp) : '—';
}

function count(value) {
  return Number.isFinite(value) ? NUMBER.format(value) : '—';
}

function searchText(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
}

function statusPill(key, labels) {
  const pill = node('span', 'mcrm-pill', labels[key] || 'Indefinido');
  pill.dataset.status = key;
  return pill;
}

function setOptions(select, options, current = '') {
  select.replaceChildren(...Object.entries(options).map(([value, label]) => new Option(label, value)));
  select.value = current ?? '';
}

function field(config, value = '') {
  const label = node('label', config.wide ? 'mcrm-field mcrm-field-wide' : 'mcrm-field');
  const caption = node('span', '', config.label);
  const input = node(config.type === 'select' || config.type === 'textarea' ? config.type : 'input');
  caption.id = `mcrm-label-${config.name}`;
  input.setAttribute('aria-labelledby', caption.id);
  input.name = config.name;
  if (input instanceof HTMLInputElement) input.type = config.type || 'text';
  if (config.type === 'textarea') input.rows = 7;
  if (config.type === 'select') setOptions(input, config.options, value);
  else input.value = value ?? '';
  if (config.maxLength) input.maxLength = config.maxLength;
  if (config.type === 'number') {
    input.min = config.min ?? '0';
    input.max = config.max ?? '2147483647';
    input.step = '1';
    input.inputMode = 'numeric';
  }
  if (config.placeholder) input.placeholder = config.placeholder;
  input.required = Boolean(config.required);
  label.append(caption, input);
  if (config.hint) label.append(node('small', '', config.hint));
  return { label, input, caption };
}

function tagsFrom(value) {
  return String(value ?? '').split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean);
}

function tagChips(values) {
  const group = node('div', 'mcrm-tags');
  for (const value of values || []) group.append(node('span', 'mcrm-tag', value));
  return group;
}

function percentage(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? REPORT_PERCENT.format(numerator / denominator) : '—';
}

function splitMetricInfo(campaign) {
  return [
    ['Preparados', campaign.audienceCount],
    ['Em fila', campaign.queuedCount],
    ['Enviados', campaign.sentCount],
    ['Entregues', campaign.deliveredCount],
    ['Aberturas', campaign.openCount],
    ['Cliques', campaign.clickCount],
    ['Conversões', campaign.conversionCount],
    ['Descadastros', campaign.unsubscribeCount],
  ];
}

function metricList(rows) {
  const list = node('dl', 'mcrm-campaign-stats');
  for (const [label, value] of rows) {
    const metric = node('div');
    metric.append(node('dt', '', label), node('dd', '', typeof value === 'string' ? value : count(value)));
    list.append(metric);
  }
  return list;
}

function csvCell(value) {
  const source = String(value ?? '');
  const safe = /^[\t\r\n]|^\s*[=+@-]/u.test(source) ? `'${source}` : source;
  return `"${safe.replace(/"/g, '""')}"`;
}

function downloadRecipients(recipients) {
  const rows = [['Nome', 'E-mail'], ...recipients.map(({ name, email }) => [name, email])];
  const csv = rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
  const downloadUrl = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = node('a');
  link.href = downloadUrl;
  link.download = 'central-maximum-destinatarios.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
}

const contactFields = [
  { name: 'name', label: 'Nome', maxLength: 120 },
  { name: 'email', label: 'E-mail', type: 'email', maxLength: 254, required: true },
  { name: 'status', label: 'Situação', type: 'select', options: CONTACT_STATUS, required: true },
  { name: 'source', label: 'Origem do contato', maxLength: 200, placeholder: 'Ex.: Formulário da newsletter', wide: true },
  { name: 'tags', label: 'Interesses', maxLength: 940, placeholder: 'Ex.: newsletter, cursos, ofertas', wide: true, hint: 'Separe os interesses por vírgula.' },
];
const campaignFields = [
  { name: 'name', label: 'Nome da campanha', maxLength: 160, required: true, wide: true },
  { name: 'type', label: 'Tipo de campanha', type: 'select', options: CAMPAIGN_TYPES, required: true },
  { name: 'subject', label: 'Assunto do e-mail', maxLength: 160, wide: true },
  { name: 'content', label: 'Mensagem', type: 'textarea', maxLength: 24000, wide: true },
];
const resultFields = [
  { name: 'sentCount', label: 'E-mails enviados', type: 'number', required: true },
  { name: 'deliveredCount', label: 'E-mails entregues', type: 'number' },
  { name: 'openCount', label: 'Destinatários que abriram', type: 'number' },
  { name: 'clickCount', label: 'Destinatários que clicaram', type: 'number' },
  { name: 'conversionCount', label: 'Conversões', type: 'number' },
  { name: 'unsubscribeCount', label: 'Descadastros', type: 'number' },
];
const numericValues = new Set(resultFields.map(({ name }) => name));

export function mountMarketingCrm(root, { request, onAuthError } = {}) {
  root.classList.add('mcrm');
  root.innerHTML = `
    <header class="mcrm-header">
      <div>
        <h1>CRM de Marketing</h1>
        <p>Organize públicos, publique páginas de inscrição e acompanhe campanhas de e-mail.</p>
      </div>
      <button class="mcrm-action mcrm-primary" type="button" data-crm="create" hidden></button>
    </header>
    <div class="mcrm-kpis" data-crm="metrics" aria-label="Indicadores do CRM"></div>
    <aside class="mcrm-provider"><i class="bi bi-broadcast" aria-hidden="true"></i><p><strong data-crm="providerTitle"></strong><span data-crm="providerNote"></span></p><button class="mcrm-action" type="button" data-crm="refresh" hidden>Atualizar dados</button></aside>
    <section class="mcrm-board" aria-label="Gestão do CRM">
      <div class="mcrm-board-tools">
        <div class="mcrm-tabs" role="tablist" aria-label="Áreas do CRM" data-crm="tabs"></div>
        <div class="mcrm-filters" data-crm="filters">
          <label class="mcrm-search"><i class="bi bi-search" aria-hidden="true"></i><span class="sr-only">Buscar no CRM</span><input type="search" data-crm="search"></label>
          <label class="mcrm-filter" data-crm="statusFilter"><span class="sr-only">Filtrar por situação</span><select data-crm="status"></select></label>
          <label class="mcrm-filter" data-crm="interestFilter" hidden><span class="sr-only">Filtrar por interesse</span><select data-crm="interest"></select></label>
        </div>
      </div>
      <p class="mcrm-message" data-crm="message" role="status" hidden></p>
      <div class="mcrm-panel" id="mcrm-panel" role="tabpanel" data-crm="panel"></div>
    </section>
    <dialog class="mcrm-dialog" aria-labelledby="mcrm-dialog-title" data-crm="dialog">
      <form data-crm="form">
        <header class="mcrm-dialog-head">
          <h2 id="mcrm-dialog-title" data-crm="title"></h2>
          <button class="mcrm-action mcrm-icon-button" type="button" aria-label="Fechar" data-crm="dismiss"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </header>
        <div class="mcrm-dialog-content" data-crm="content"></div>
        <p class="mcrm-dialog-error" data-crm="error" role="alert" hidden></p>
        <footer class="mcrm-dialog-actions">
          <button class="mcrm-action" type="button" data-crm="cancel">Cancelar</button>
          <button class="mcrm-action mcrm-primary" type="submit" data-crm="save">Salvar</button>
        </footer>
      </form>
    </dialog>`;
  const ui = Object.fromEntries([...root.querySelectorAll('[data-crm]')].map((item) => [item.dataset.crm, item]));
  const tabs = Object.fromEntries(Object.entries(SECTIONS).map(([key, section]) => {
    const tab = action(section.label, () => selectView(key), { symbol: section.icon });
    tab.className = '';
    tab.id = `mcrm-${key}-tab`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'mcrm-panel');
    ui.tabs.append(tab);
    return [key, tab];
  }));
  let active = false;
  let canCreate = false;
  let canUpdate = false;
  let view = 'subscribers';
  let data;
  let loading = false;
  let loadFailed = false;
  let busy = false;
  let operation;
  let generation = 0;
  let revision = 0;
  let opener;

  function displayMessage(message = '', error = false) {
    ui.message.textContent = message;
    ui.message.hidden = !message;
    ui.message.dataset.error = String(error);
  }

  function reportAuth(error) {
    if (error?.status !== 401) return false;
    onAuthError?.(error);
    return true;
  }

  async function reload() {
    const requestId = ++revision;
    loading = true;
    loadFailed = false;
    render();
    try {
      const result = await request(API_PATH);
      if (!active || revision !== requestId) return;
      data = {
        subscribers: result.subscribers || [],
        campaigns: result.campaigns || [],
        segments: result.segments || [],
        landings: result.landings || [],
        automations: result.automations || [],
        deliveryConfigured: Boolean(result.deliveryConfigured),
        analyticsConfigured: Boolean(result.analyticsConfigured),
        totals: result.totals || {},
      };
    } catch (error) {
      if (!active || revision !== requestId || reportAuth(error)) return;
      loadFailed = true;
      data = undefined;
    } finally {
      if (active && revision === requestId) {
        loading = false;
        render();
      }
    }
  }

  function selectView(next, moveFocus = false) {
    if (view !== next) {
      view = next;
      ui.search.value = '';
      displayMessage();
      resetOptions();
      render();
    }
    if (moveFocus) tabs[view].focus();
  }

  function renderSummary() {
    const totals = data?.totals || {};
    const cards = [
      ['Inscritos', totals.subscribed, 'check2'],
      ['Leads confirmados', totals.leads, 'people'],
      ['Campanhas', totals.campaigns, 'megaphone'],
      ['Conversões', totals.conversions, 'graph-up'],
    ];
    ui.metrics.replaceChildren(...cards.map(([label, value, symbol]) => {
      const article = node('article', 'mcrm-kpi');
      const glyph = node('span', 'mcrm-kpi-icon');
      glyph.append(icon(symbol));
      const copy = node('div');
      copy.append(node('span', 'mcrm-kpi-label', label), node('strong', '', count(value)));
      article.append(glyph, copy);
      return article;
    }));
  }

  function render() {
    renderSummary();
    ui.providerTitle.textContent = data ? data.deliveryConfigured ? 'Envio de e-mail disponível' : 'Provedor de e-mail pendente' : 'Serviço de e-mail';
    ui.providerNote.textContent = data?.deliveryConfigured ? 'Use a fila da Central para enviar campanhas e e-mails automáticos.'
      : 'Prepare campanhas e exporte a lista de inscritos. Envio direto e confirmação de leads exigem um provedor configurado.';
    if (data?.deliveryConfigured && !data.analyticsConfigured) ui.providerNote.textContent += ' Configure o webhook para receber eventos do provedor.';
    ui.refresh.hidden = !data;
    ui.refresh.disabled = loading;
    for (const [name, tab] of Object.entries(tabs)) {
      tab.setAttribute('aria-selected', String(name === view));
      tab.tabIndex = name === view ? 0 : -1;
    }
    ui.panel.setAttribute('aria-labelledby', tabs[view].id);
    ui.panel.setAttribute('aria-busy', String(loading));
    const section = SECTIONS[view];
    ui.create.hidden = !canCreate || !data || !section.create;
    const createLabel = section.create || '';
    if (ui.create.textContent !== createLabel) ui.create.textContent = createLabel;
    ui.filters.hidden = !data || view === 'reports';
    ui.statusFilter.hidden = !section.statuses;
    if (view === 'subscribers' && data) {
      const interests = [...new Set(data.subscribers.flatMap((contact) => contact.tags || []))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const selected = ui.interest.value;
      ui.interest.replaceChildren(new Option('Todos os interesses', ''), ...interests.map((tag) => new Option(tag, tag)));
      if (interests.includes(selected)) ui.interest.value = selected;
      ui.interestFilter.hidden = !interests.length;
    } else ui.interestFilter.hidden = true;
    ui.search.placeholder = section.singular ? `Buscar ${section.singular}` : '';
    renderResults();
  }

  function resetOptions() {
    setOptions(ui.status, { '': 'Todas as situações', ...SECTIONS[view].statuses });
    ui.interest.value = '';
  }

  function renderEmpty(title, description, symbol, retry = false) {
    const empty = node('div', 'mcrm-empty');
    empty.append(icon(symbol), node('strong', '', title));
    if (description) empty.append(node('p', '', description));
    if (retry) empty.append(action('Tentar novamente', () => void reload(), { symbol: 'arrow-clockwise' }));
    return empty;
  }

  function renderResults() {
    if (!data) {
      const error = loadFailed && !loading;
      ui.panel.replaceChildren(renderEmpty(error ? 'Não foi possível carregar o CRM' : 'Carregando…', '', error ? 'arrow-clockwise' : 'clock-history', error));
      return;
    }
    if (view === 'reports') {
      ui.panel.replaceChildren(renderReports());
      return;
    }
    const status = ui.status.value;
    const query = searchText(ui.search.value.trim());
    const interest = view === 'subscribers' ? ui.interest.value : '';
    const records = data[view].filter((record) => {
      const fields = [record.name, record.title, record.email, record.slug, record.source, record.subject, ...(record.tags || [])];
      if (view === 'automations') fields.push(...(record.steps || []).map((step) => step.subject));
      return (!status || status === record.status) && (!interest || (record.tags || []).includes(interest))
        && (!query || fields.some((value) => searchText(value).includes(query)));
    });
    if (records.length) {
      const total = node('p', 'mcrm-result-count', `${count(records.length)} ${records.length === 1 ? 'registro' : 'registros'}`);
      const content = view === 'subscribers' ? renderContacts(records) : view === 'campaigns' ? renderCampaigns(records) : renderGrowth(records);
      ui.panel.replaceChildren(total, content);
      return;
    }
    const filtered = Boolean(status || query || interest);
    const emptyLabels = { subscribers: 'Nenhum contato cadastrado', campaigns: 'Nenhuma campanha cadastrada', segments: 'Nenhum segmento cadastrado',
      landings: 'Nenhuma página de captura cadastrada', automations: 'Nenhuma automação cadastrada' };
    const emptyNotes = { subscribers: 'Cadastre contatos e acompanhe as inscrições.', campaigns: 'Crie um rascunho e prepare os destinatários.',
      segments: 'Agrupe os contatos por interesses para direcionar campanhas.', landings: 'Crie uma página e compartilhe o link para receber inscrições.',
      automations: 'Vincule uma sequência de e-mails a uma página de captura.' };
    ui.panel.replaceChildren(renderEmpty(filtered ? 'Nenhum resultado' : emptyLabels[view],
      filtered ? 'Experimente outra busca ou filtro.' : emptyNotes[view], SECTIONS[view].icon));
  }

  function renderContacts(records) {
    const wrapper = node('div', 'mcrm-contact-list');
    const table = node('table', 'mcrm-table');
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', 'Contatos do CRM');
    const head = table.createTHead().insertRow();
    const labels = ['Contato', 'Situação', 'Interesses', 'Origem', 'Consentimento'];
    if (canUpdate) labels.push('Ações');
    for (const label of labels) {
      const cell = node('th', '', label);
      cell.scope = 'col';
      head.append(cell);
    }
    const body = table.createTBody();
    for (const contact of records) {
      const row = body.insertRow();
      const person = row.insertCell();
      person.dataset.label = 'Contato';
      person.append(node('strong', '', contact.name || contact.email));
      if (contact.name) person.append(node('small', '', contact.email));
      const status = row.insertCell();
      status.dataset.label = 'Situação';
      status.append(statusPill(contact.status, CONTACT_STATUS));
      const interests = row.insertCell();
      interests.dataset.label = 'Interesses';
      if (contact.tags?.length) interests.append(tagChips(contact.tags));
      else interests.textContent = '—';
      const source = row.insertCell();
      source.dataset.label = 'Origem';
      source.textContent = contact.source || '—';
      const consent = row.insertCell();
      consent.dataset.label = 'Consentimento';
      consent.textContent = date(contact.consentAt);
      if (canUpdate) {
        const options = row.insertCell();
        options.dataset.label = 'Ações';
        const edit = action('Editar', (event) => openContact(contact, event.currentTarget));
        edit.setAttribute('aria-label', `Editar contato ${contact.name || contact.email}`);
        options.append(edit);
      }
    }
    wrapper.append(table);
    return wrapper;
  }

  function renderCampaigns(records) {
    const list = node('div', 'mcrm-campaign-list');
    for (const campaign of records) {
      const card = node('article', 'mcrm-campaign');
      const head = node('header', 'mcrm-campaign-head');
      const identity = node('div');
      identity.append(node('h2', '', campaign.name), node('p', '', campaign.subject || 'Sem assunto'));
      const segment = data.segments.find((entry) => entry.id === campaign.segmentId);
      const landing = data.landings.find((entry) => entry.id === campaign.landingId);
      identity.append(node('p', 'mcrm-resource-meta', [CAMPAIGN_TYPES[campaign.type] || 'Promocional', segment?.name || 'Todos os inscritos', landing?.title].filter(Boolean).join(' · ')));
      head.append(identity, statusPill(campaign.status, CAMPAIGN_STATUS));
      card.append(head);
      if (campaign.status !== 'draft') card.append(metricList(splitMetricInfo(campaign)));
      if (campaign.sentAt) card.append(node('p', 'mcrm-sent-at', `Envio registrado em ${date(campaign.sentAt)}`));
      if (campaign.failedCount > 0) card.append(node('p', 'mcrm-sent-at', `Falhas registradas: ${count(campaign.failedCount)}`));
      const controls = node('footer', 'mcrm-campaign-actions');
      controls.append(action('Prévia', (event) => preview(campaign, event.currentTarget), { symbol: 'journal-text' }));
      if (canUpdate && campaign.status === 'draft') {
        controls.append(action('Editar', (event) => openCampaign(campaign, event.currentTarget)));
        if (campaign.subject && campaign.content) {
          controls.append(action('Preparar público', (event) => prepare(campaign, event.currentTarget), { primary: true }));
        } else card.append(node('p', 'mcrm-sent-at', 'Preencha o assunto e a mensagem para preparar o público.'));
      }
      if (canUpdate && campaign.status === 'prepared') {
        controls.append(
          action('Exportar destinatários', (event) => void exportAudience(campaign, event.currentTarget), { symbol: 'download' }),
          action('Voltar para rascunho', (event) => reopenCampaign(campaign, event.currentTarget)),
        );
        if (data.deliveryConfigured) controls.append(action('Enviar campanha', (event) => queueCampaign(campaign, event.currentTarget), { symbol: 'send', primary: true }));
      }
      if (canUpdate && campaign.deliveryMode !== 'native' && ['prepared', 'sent'].includes(campaign.status)) {
        controls.append(action(campaign.status === 'sent' ? 'Atualizar resultados' : 'Registrar envio', (event) => record(campaign, event.currentTarget)));
      }
      card.append(controls);
      list.append(card);
    }
    return list;
  }

  function renderGrowth(records) {
    const list = node('div', 'mcrm-campaign-list');
    const editors = { segments: openSegment, landings: openLanding, automations: openAutomation };
    for (const item of records) {
      const card = node('article', 'mcrm-campaign');
      const header = node('header', 'mcrm-campaign-head');
      header.append(node('h2', '', item.title || item.name));
      if (SECTIONS[view].statuses) header.append(statusPill(item.status, SECTIONS[view].statuses));
      card.append(header);
      const options = node('footer', 'mcrm-campaign-actions');
      if (view === 'segments') {
        card.append(tagChips(item.tags));
        const eligible = data.subscribers.filter((contact) => contact.status === 'subscribed' && contact.consentAt
          && (contact.tags || []).some((tag) => item.tags.includes(tag))).length;
        card.append(node('p', 'mcrm-resource-meta', `${count(eligible)} contatos inscritos com pelo menos um desses interesses`));
      }
      if (view === 'landings') {
        if (item.description) card.append(node('p', 'mcrm-resource-meta', item.description));
        if (item.tags?.length) card.append(tagChips(item.tags));
        card.append(metricList([['Leads confirmados', item.leadCount], ['Aguardando confirmação', item.pendingCount]]));
        if (item.status === 'published' && /^\/inscricao\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.path)) {
          const link = node('a', 'mcrm-action');
          link.href = item.path;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.append(icon('arrow-up-right'), document.createTextNode('Abrir página'));
          options.append(link, action('Copiar link', () => void copyLandingLink(item.path), { symbol: 'link-45deg' }));
        }
        if (canUpdate) options.append(action(item.status === 'published' ? 'Retirar do ar' : 'Publicar',
          (event) => confirmLanding(item, event.currentTarget), { primary: item.status !== 'published' }));
      }
      if (view === 'automations') {
        const landing = data.landings.find((entry) => entry.id === item.landingId);
        card.append(node('p', 'mcrm-resource-meta', landing ? `Ao confirmar inscrição em ${landing.title}` : 'Página vinculada indisponível'));
        const sequence = node('ol', 'mcrm-sequence-preview');
        for (const step of item.steps || []) {
          const label = step.delayDays === 0 ? 'Sem espera' : `Após ${step.delayDays} ${step.delayDays === 1 ? 'dia' : 'dias'}`;
          const row = node('li');
          row.append(node('strong', '', step.subject), node('small', '', label));
          sequence.append(row);
        }
        card.append(sequence);
      }
      if (canUpdate) options.append(action('Editar', (event) => editors[view](item, event.currentTarget)));
      if (options.childElementCount) card.append(options);
      list.append(card);
    }
    return list;
  }

  function renderReports() {
    const result = node('section', 'mcrm-report');
    const { totals, campaigns } = data;
    const percent = (value) => percentage(value, 100);
    result.append(node('h2', '', 'Resultados das campanhas'), metricList([
      ['Taxa de abertura', percent(totals.openRate)], ['Taxa de cliques', percent(totals.clickRate)], ['Taxa de conversão', percent(totals.conversionRate)],
      ['Enviados', totals.sent], ['Entregues', totals.delivered], ['Aberturas', totals.opened], ['Cliques', totals.clicked],
      ['Leads confirmados', totals.leads], ['Leads pendentes', totals.pendingLeads], ['Conversões', totals.conversions], ['Descadastros', totals.unsubscribes],
    ]));
    const measured = campaigns.filter((campaign) => ['queued', 'sent', 'failed'].includes(campaign.status));
    if (measured.length) {
      const list = node('div', 'mcrm-campaign-list');
      for (const campaign of measured) {
        const card = node('article', 'mcrm-campaign');
        const head = node('header', 'mcrm-campaign-head');
        head.append(node('h3', '', campaign.name), statusPill(campaign.status, CAMPAIGN_STATUS));
        card.append(head, metricList([
          ['Abertura', percentage(campaign.openCount, campaign.deliveredCount)], ['Cliques', percentage(campaign.clickCount, campaign.deliveredCount)],
          ['Conversão', percentage(campaign.conversionCount, campaign.sentCount)], ['Conversões', campaign.conversionCount], ['Descadastros', campaign.unsubscribeCount],
        ]));
        list.append(card);
      }
      result.append(list);
    } else result.append(renderEmpty('Sem campanhas com resultados', 'Os resultados aparecem após o envio ou o registro dos dados de um provedor externo.', 'graph-up'));
    return result;
  }

  function formError(message = '') {
    ui.error.textContent = message;
    ui.error.hidden = !message;
  }

  function setBusy(value) {
    busy = value;
    for (const control of [ui.save, ui.cancel, ui.dismiss]) control.disabled = value;
    ui.form.setAttribute('aria-busy', String(value));
  }

  function openDialog({ title, content, submit, save = 'Salvar', trigger }) {
    if (ui.dialog.open) return;
    operation = submit;
    opener = trigger;
    formError();
    ui.title.textContent = title;
    ui.content.replaceChildren(content);
    ui.cancel.textContent = submit ? 'Cancelar' : 'Fechar';
    ui.save.hidden = !submit;
    ui.save.textContent = save;
    setBusy(false);
    ui.dialog.showModal();
    (ui.content.querySelector('input, textarea, select') || ui.cancel).focus();
  }

  function openContact(contact, trigger) {
    if (contact ? !canUpdate : !canCreate) return;
    const fields = node('div', 'mcrm-field-grid');
    const controls = {};
    for (const config of contactFields) {
      const initial = config.name === 'status' ? contact?.status || 'pending' : config.name === 'tags' ? contact?.tags?.join(', ') : contact?.[config.name];
      const options = contact?.status === 'unsubscribed' && config.name === 'status'
        ? { subscribed: CONTACT_STATUS.subscribed, unsubscribed: CONTACT_STATUS.unsubscribed }
        : config.options;
      const control = field({ ...config, options }, initial);
      controls[config.name] = control;
      fields.append(control.label);
    }
    controls.email.input.readOnly = Boolean(contact);
    const consent = node('p', 'mcrm-form-note');
    const showConsent = () => {
      const subscribed = controls.status.input.value === 'subscribed';
      controls.source.input.required = subscribed;
      controls.source.caption.textContent = subscribed ? 'Origem do consentimento' : 'Origem do contato';
      consent.textContent = subscribed ? 'Marque como inscrito somente quando a pessoa tiver autorizado o recebimento de campanhas.' : '';
      consent.hidden = !subscribed;
    };
    controls.status.input.addEventListener('change', () => {
      if (contact && contact.status !== 'subscribed' && controls.status.input.value === 'subscribed') controls.source.input.value = '';
      showConsent();
    });
    fields.append(consent);
    showConsent();
    const path = `${API_PATH}/subscribers${contact ? `/${encodeURIComponent(contact.id)}` : ''}`;
    openDialog({
      title: contact ? 'Editar contato' : 'Novo contato', content: fields, trigger,
      submit: (body) => request(path, { method: contact ? 'PATCH' : 'POST', body: { ...body, tags: tagsFrom(body.tags) } }),
    });
  }

  function fieldGrid(configs, values = {}) {
    const grid = node('div', 'mcrm-field-grid');
    for (const config of configs) grid.append(field(config, values[config.name]).label);
    return grid;
  }

  function openCampaign(campaign, trigger) {
    if (campaign ? !canUpdate : !canCreate) return;
    const segments = { '': 'Todos os inscritos', ...Object.fromEntries(data.segments.map(({ id, name }) => [id, name])) };
    const landings = { '': 'Sem página de captura', ...Object.fromEntries(data.landings.filter((item) => item.status === 'published' || item.id === campaign?.landingId)
      .map(({ id, title, status }) => [id, status === 'published' ? title : `${title} (fora do ar)`])) };
    const fields = fieldGrid([...campaignFields.slice(0, 2),
      { name: 'segmentId', label: 'Destinatários', type: 'select', options: segments },
      { name: 'landingId', label: 'Página de captura da campanha', type: 'select', options: landings, wide: true, hint: 'O envio pela Central inclui no e-mail um link da página para contar as inscrições atribuídas.' },
      ...campaignFields.slice(2)], { type: 'promotion', ...campaign });
    const path = `${API_PATH}/campaigns${campaign ? `/${encodeURIComponent(campaign.id)}` : ''}`;
    openDialog({
      title: campaign ? 'Editar campanha' : 'Nova campanha', content: fields, trigger,
      submit: (body) => request(path, { method: campaign ? 'PATCH' : 'POST', body }),
    });
  }

  function preview(campaign, trigger) {
    const content = node('div', 'mcrm-preview');
    content.append(node('span', 'mcrm-preview-caption', 'Assunto'), node('h3', '', campaign.subject || 'Sem assunto'));
    content.append(node('div', 'mcrm-preview-body', campaign.content || 'A mensagem ainda está em branco.'));
    const landing = data.landings.find((item) => item.id === campaign.landingId);
    if (landing) content.append(node('p', 'mcrm-resource-meta', `Página vinculada: ${landing.title}`));
    openDialog({ title: 'Prévia do e-mail', content, trigger });
  }

  function prepare(campaign, trigger) {
    const content = node('div', 'mcrm-form-explanation');
    content.append(
      node('p', '', `Campanha: ${campaign.name}`),
      node('p', '', 'A lista inclui apenas contatos inscritos com consentimento. O segmento definido na campanha será aplicado.'),
    );
    openDialog({
      title: 'Preparar público', content, trigger, save: 'Preparar campanha',
      submit: () => request(`${API_PATH}/campaigns/${encodeURIComponent(campaign.id)}/prepare`, { method: 'POST', body: {} }),
    });
  }

  function queueCampaign(campaign, trigger) {
    if (!canUpdate || !data.deliveryConfigured || campaign.status !== 'prepared') return;
    const content = node('div', 'mcrm-form-explanation');
    content.append(node('p', '', `Campanha: ${campaign.name}`),
      node('p', '', `Público preparado: ${count(campaign.audienceCount)} destinatários. O envio começa após a confirmação e a Central revalida a inscrição de cada contato.`));
    openDialog({
      title: 'Confirmar envio da campanha', content, trigger, save: 'Confirmar envio',
      submit: () => request(`${API_PATH}/campaigns/${encodeURIComponent(campaign.id)}/queue`, { method: 'POST', body: {} }),
    });
  }

  function saveGrowth(kind, item, body) {
    return request(`${API_PATH}/${kind}${item ? `/${encodeURIComponent(item.id)}` : ''}`, {
      method: item ? 'PATCH' : 'POST', body,
    });
  }

  function openSegment(item, trigger) {
    const fields = fieldGrid([
      { name: 'name', label: 'Nome do segmento', maxLength: 120, required: true, wide: true },
      { name: 'tags', label: 'Interesses do segmento', maxLength: 940, required: true, wide: true, hint: 'Separe por vírgula. O segmento inclui quem tiver pelo menos um desses interesses.' },
    ], { ...item, tags: item?.tags.join(', ') });
    openDialog({ title: item ? 'Editar segmento' : 'Novo segmento', content: fields, trigger,
      submit: (body) => saveGrowth('segments', item, { ...body, tags: tagsFrom(body.tags) }) });
  }

  function openLanding(item, trigger) {
    const fields = fieldGrid([
      { name: 'title', label: 'Título da página', maxLength: 160, required: true, wide: true },
      { name: 'slug', label: 'Endereço da página', maxLength: 80, required: true, hint: 'A página ficará em /inscricao/seu-endereco.' },
      { name: 'buttonText', label: 'Texto do botão', maxLength: 80, required: true },
      { name: 'description', label: 'Descrição', type: 'textarea', maxLength: 4000, wide: true },
      { name: 'tags', label: 'Interesses associados', maxLength: 940, wide: true, hint: 'Separe por vírgula. Os interesses são atribuídos após a confirmação da inscrição.' },
    ], { buttonText: 'Quero receber novidades', ...item, tags: item?.tags.join(', ') });
    const slugInput = fields.querySelector('[name="slug"]');
    slugInput.pattern = '[a-zA-Z0-9]+(?:\\x2D[a-zA-Z0-9]+)*';
    slugInput.minLength = 3;
    slugInput.readOnly = item?.status === 'published';
    openDialog({ title: item ? 'Editar página de captura' : 'Nova página de captura', content: fields, trigger,
      submit: (body) => saveGrowth('landings', item, { ...body, tags: tagsFrom(body.tags) }) });
  }

  function confirmLanding(item, trigger) {
    const publishing = item.status !== 'published';
    const content = node('div', 'mcrm-form-explanation');
    content.append(node('p', '', item.title), node('p', '', publishing ? 'O formulário ficará disponível para quem acessar o link.'
      : 'O link deixará de receber novas inscrições. Os contatos capturados continuarão disponíveis no CRM.'));
    if (publishing && !data.deliveryConfigured) content.append(node('p', '', 'As inscrições ficarão pendentes de confirmação até que um provedor de e-mail esteja disponível.'));
    const label = publishing ? 'Publicar página' : 'Retirar página do ar';
    openDialog({ title: label, content, trigger, save: label,
      submit: () => saveGrowth('landings', item, { status: publishing ? 'published' : 'draft' }) });
  }

  async function copyLandingLink(path) {
    const url = new URL(path, location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      displayMessage('Link da página copiado.');
    } catch { displayMessage(url); }
  }

  function openAutomation(item, trigger) {
    const landings = { '': 'Selecione uma página', ...Object.fromEntries(data.landings.map(({ id, title, status }) => [id, status === 'published' ? title : `${title} (rascunho)`])) };
    if (!data.landings.length) {
      openDialog({ title: 'Nova automação', content: node('p', 'mcrm-form-note', 'Crie uma página de captura antes de vincular a sequência de e-mails.'), trigger });
      return;
    }
    const fields = fieldGrid([
      { name: 'name', label: 'Nome da automação', maxLength: 120, required: true, wide: true },
      { name: 'landingId', label: 'Página de captura', type: 'select', options: landings, required: true },
      { name: 'status', label: 'Situação', type: 'select', options: AUTOMATION_STATUS, required: true },
    ], { status: 'draft', ...item });
    const sequence = node('div', 'mcrm-sequence-editor');
    const steps = node('div', 'mcrm-steps');
    sequence.append(node('h3', '', 'Sequência de e-mails'),
      node('p', 'mcrm-form-note', 'O primeiro e-mail conta o prazo a partir da confirmação da inscrição. Os próximos contam a partir do envio anterior.'), steps);
    let nextStepKey = 0;
    const add = action('Adicionar e-mail', () => {
      const entry = appendStep({ delayDays: 1 });
      entry.querySelector('input[name$="-subject"]').focus();
    });
    sequence.append(add);
    fields.append(sequence);

    function updateSequence() {
      const entries = [...steps.children];
      entries.forEach((entry, index) => {
        entry.querySelector('legend').textContent = `E-mail ${index + 1}`;
        entry.querySelector('[data-step-action="up"]').disabled = index === 0;
        entry.querySelector('[data-step-action="down"]').disabled = index === entries.length - 1;
        entry.querySelector('[data-step-action="remove"]').disabled = entries.length === 1;
      });
      add.disabled = entries.length >= 8;
    }

    function appendStep(step) {
      const key = ++nextStepKey;
      const entry = node('fieldset', 'mcrm-step');
      entry.append(node('legend'));
      const stepFields = fieldGrid([
        { name: `step-${key}-delayDays`, label: 'Dias de espera', type: 'number', min: 0, max: 90, required: true },
        { name: `step-${key}-subject`, label: 'Assunto', maxLength: 160, required: true },
        { name: `step-${key}-content`, label: 'Mensagem do e-mail', type: 'textarea', maxLength: 24000, required: true, wide: true },
      ], Object.fromEntries(Object.entries(step).map(([name, value]) => [`step-${key}-${name}`, value])));
      const controls = node('div', 'mcrm-step-actions');
      const correction = {
        up: ['Subir na ordem', () => steps.insertBefore(entry, entry.previousElementSibling)],
        down: ['Descer na ordem', () => steps.insertBefore(entry.nextElementSibling, entry)],
        remove: ['Remover e-mail', () => entry.remove()],
      };
      for (const [command, [label, operate]] of Object.entries(correction)) {
        const control = action(label, () => { operate(); updateSequence(); });
        control.dataset.stepAction = command;
        controls.append(control);
      }
      entry.append(stepFields, controls);
      steps.append(entry);
      updateSequence();
      return entry;
    }

    for (const step of item?.steps || [{ delayDays: 0 }]) appendStep(step);
    openDialog({ title: item ? 'Editar automação' : 'Nova automação', content: fields, trigger, submit: () => {
      const form = new FormData(ui.form);
      return saveGrowth('automations', item, {
        name: form.get('name').trim(), landingId: form.get('landingId'), status: form.get('status'),
        steps: [...steps.children].map((entry) => ({
          delayDays: Number(entry.querySelector('input[type="number"]').value),
          subject: entry.querySelector('input[name$="-subject"]').value.trim(), content: entry.querySelector('textarea').value.trim(),
        })),
      });
    } });
  }

  function reopenCampaign(campaign, trigger) {
    const content = node('p', 'mcrm-form-note', 'A campanha voltará para rascunho. Prepare o público novamente para gerar uma nova lista de destinatários.');
    openDialog({
      title: 'Voltar para rascunho', content, trigger, save: 'Voltar para rascunho',
      submit: () => request(`${API_PATH}/campaigns/${encodeURIComponent(campaign.id)}/reopen`, { method: 'POST', body: {} }),
    });
  }

  async function exportAudience(campaign, trigger) {
    const current = generation;
    trigger.disabled = true;
    displayMessage();
    try {
      const result = await request(`${API_PATH}/campaigns/${encodeURIComponent(campaign.id)}/audience`, { method: 'POST', body: {} });
      if (!active || generation !== current) return;
      if (!result.recipients?.length) {
        displayMessage('Nenhum contato inscrito está elegível para exportação.');
        return;
      }
      downloadRecipients(result.recipients);
      displayMessage('Lista de destinatários exportada.');
    } catch (error) {
      if (active && generation === current && !reportAuth(error)) displayMessage(error.message || 'Não foi possível exportar a lista.', true);
    } finally {
      if (trigger.isConnected) trigger.disabled = false;
    }
  }

  function record(campaign, trigger) {
    const fields = node('div', 'mcrm-field-grid');
    fields.append(node('p', 'mcrm-form-note', 'Use os dados do provedor de e-mail. Deixe em branco os indicadores que você ainda não mediu.'));
    for (const config of resultFields) {
      const control = field(config, campaign[config.name]);
      if (config.name === 'sentCount') {
        control.input.min = '1';
        control.input.max = String(campaign.audienceCount);
      }
      fields.append(control.label);
    }
    const sendTime = campaign.sentAt && new Date(campaign.sentAt);
    const toLocal = (value) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    const timestamp = field({ name: 'sentAt', label: 'Data e horário do envio', type: 'datetime-local', wide: true,
      hint: 'Use o fuso horário configurado neste dispositivo.' }, sendTime ? toLocal(sendTime) : '');
    timestamp.input.min = '2000-01-01T00:00';
    timestamp.input.max = toLocal(new Date());
    fields.append(timestamp.label);
    openDialog({
      title: campaign.status === 'sent' ? 'Atualizar resultados' : 'Registrar envio', content: fields, trigger,
      submit: (body) => request(`${API_PATH}/campaigns/${encodeURIComponent(campaign.id)}/record`, {
        method: 'POST', body: { ...body, sentAt: body.sentAt ? new Date(body.sentAt).toISOString() : null },
      }),
    });
  }

  ui.tabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = SECTION_KEYS.indexOf(view);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? SECTION_KEYS.length - 1
      : (index + (event.key === 'ArrowLeft' ? -1 : 1) + SECTION_KEYS.length) % SECTION_KEYS.length;
    selectView(SECTION_KEYS[next], true);
  });
  ui.search.addEventListener('input', renderResults);
  ui.status.addEventListener('change', renderResults);
  ui.interest.addEventListener('change', renderResults);
  ui.refresh.addEventListener('click', () => void reload());
  ui.create.addEventListener('click', () => {
    if (!canCreate || !data) return;
    const editors = { subscribers: openContact, campaigns: openCampaign, segments: openSegment, landings: openLanding, automations: openAutomation };
    editors[view]?.(null, ui.create);
  });
  for (const button of [ui.cancel, ui.dismiss]) button.addEventListener('click', () => ui.dialog.close());
  ui.dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  ui.dialog.addEventListener('close', () => {
    operation = undefined;
    const target = opener?.isConnected ? opener : ui.create.hidden ? tabs[view] : ui.create;
    if (active) target.focus();
    opener = undefined;
  });

  ui.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!operation || busy) return;
    const current = generation;
    const body = Object.fromEntries([...new FormData(ui.form)].map(([key, value]) => [
      key, numericValues.has(key) ? value === '' ? null : Number(value) : String(value).trim(),
    ]));
    setBusy(true);
    formError();
    try {
      await operation(body);
      if (!active || generation !== current) return;
      ui.dialog.close();
      displayMessage('Alteração salva.');
      await reload();
    } catch (error) {
      if (active && generation === current && !reportAuth(error)) formError(error.message || 'Não foi possível salvar a alteração.');
    } finally {
      if (active && generation === current) setBusy(false);
    }
  });

  function close() {
    if (!active) return;
    active = false;
    generation += 1;
    revision += 1;
    data = undefined;
    loading = false;
    loadFailed = false;
    operation = undefined;
    opener = undefined;
    ui.dialog.close();
    ui.content.replaceChildren();
    ui.panel.replaceChildren();
    ui.metrics.replaceChildren();
    formError();
    displayMessage();
    setBusy(false);
  }

  return {
    open({ canCreate: mayCreate = true, canUpdate: mayUpdate = true } = {}) {
      if (active && canCreate === mayCreate && canUpdate === mayUpdate) return;
      if (active) close();
      generation += 1;
      active = true;
      canCreate = mayCreate;
      canUpdate = mayUpdate;
      view = 'subscribers';
      ui.search.value = '';
      resetOptions();
      displayMessage();
      void reload();
    },
    close,
  };
}
