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
const SECTIONS = {
  subscribers: { label: 'Contatos', singular: 'contato', icon: 'people', create: 'Novo contato', statuses: CONTACT_STATUS },
  campaigns: { label: 'Campanhas', singular: 'campanha', icon: 'envelope', create: 'Criar campanha', statuses: CAMPAIGN_STATUS },
  landings: { label: 'Páginas', singular: 'página', icon: 'file-earmark', create: 'Criar página', statuses: LANDING_STATUS },
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

function duration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s` : `${Math.round(seconds)} s`;
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

function downloadCsv(csv, filename) {
  const downloadUrl = URL.createObjectURL(new Blob([csv.startsWith('\uFEFF') ? csv : `\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = node('a');
  link.href = downloadUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
}

function downloadRecipients(recipients) {
  const rows = [['Nome', 'E-mail'], ...recipients.map(({ name, email }) => [name, email])];
  downloadCsv(rows.map((row) => row.map(csvCell).join(';')).join('\r\n'), 'central-maximum-destinatarios.csv');
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
  { name: 'content', label: 'Texto de abertura do e-mail', type: 'textarea', maxLength: 24000, wide: true,
    hint: 'O conteúdo da página publicada será incluído no e-mail.' },
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

export function mountMarketingCrm(root, { request, onAuthError, onOpenPage } = {}) {
  root.classList.add('mcrm');
  root.innerHTML = `
    <header class="mcrm-header">
      <div>
        <h1>CRM de Marketing</h1>
        <p>Organize públicos, publique páginas de inscrição e acompanhe campanhas de e-mail.</p>
      </div>
    </header>
    <div class="mcrm-kpis" data-crm="metrics" aria-label="Indicadores do CRM"></div>
    <aside class="mcrm-provider"><i class="bi bi-broadcast" aria-hidden="true"></i><p><strong data-crm="providerTitle"></strong><span data-crm="providerNote"></span></p><button class="mcrm-action" type="button" data-crm="refresh" hidden>Atualizar dados</button></aside>
    <div class="mcrm-workspace">
      <nav class="mcrm-sidebar" aria-label="Navegação do CRM">
        <div class="mcrm-tabs" role="tablist" aria-label="Áreas do CRM" aria-orientation="vertical" data-crm="tabs"></div>
      </nav>
      <section class="mcrm-board" aria-label="Gestão do CRM">
        <div class="mcrm-board-heading">
          <h2 data-crm="sectionTitle"></h2>
          <div class="mcrm-board-actions">
            <button class="mcrm-action" type="button" data-crm="importContacts" hidden>Importar CSV</button>
            <button class="mcrm-action" type="button" data-crm="exportContacts" hidden><i class="bi bi-download" aria-hidden="true"></i>Exportar CSV</button>
            <button class="mcrm-action mcrm-primary" type="button" data-crm="create" hidden></button>
          </div>
        </div>
        <div class="mcrm-board-tools" data-crm="tools">
          <div class="mcrm-campaign-views" data-crm="campaignViews" hidden>
            <button class="mcrm-action" type="button" data-crm="working">Em trabalho</button>
            <button class="mcrm-action" type="button" data-crm="history">Histórico de envios</button>
          </div>
          <div class="mcrm-filters" data-crm="filters">
            <label class="mcrm-search"><i class="bi bi-search" aria-hidden="true"></i><span class="sr-only">Buscar no CRM</span><input type="search" data-crm="search"></label>
            <label class="mcrm-filter" data-crm="statusFilter"><span class="sr-only">Filtrar por situação</span><select data-crm="status"></select></label>
            <label class="mcrm-filter" data-crm="interestFilter" hidden><span class="sr-only">Filtrar por interesse</span><select data-crm="interest"></select></label>
          </div>
        </div>
        <p class="mcrm-message" data-crm="message" role="status" hidden></p>
        <div class="mcrm-panel" id="mcrm-panel" role="tabpanel" data-crm="panel"></div>
      </section>
    </div>
    <div class="mcrm-speed-actions">
      <div class="mcrm-speed-list" id="mcrm-speed-list" aria-label="Atalhos do CRM" data-crm="speedList" hidden>
        <button class="mcrm-action" type="button" data-crm="speedCampaign"><span class="mcrm-speed-icon" aria-hidden="true">+</span>Criar campanha</button>
        <button class="mcrm-action" type="button" data-crm="speedMetrics"><i class="bi bi-graph-up" aria-hidden="true"></i>Métricas</button>
        <button class="mcrm-action" type="button" data-crm="speedPages"><i class="bi bi-file-earmark" aria-hidden="true"></i>Páginas</button>
      </div>
      <button class="mcrm-speed-toggle" type="button" data-crm="speedToggle" aria-expanded="false" aria-controls="mcrm-speed-list" aria-label="Ações rápidas do CRM"><span aria-hidden="true">⋮</span></button>
    </div>
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
  let campaignView = 'working';
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

  function selectView(next, moveFocus = false, nextCampaignView = 'working') {
    if (view !== next || (next === 'campaigns' && campaignView !== nextCampaignView)) {
      view = next;
      campaignView = nextCampaignView;
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
    ui.providerNote.textContent = data?.deliveryConfigured ? 'Use a fila da Central para enviar campanhas às pessoas inscritas.'
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
    ui.sectionTitle.textContent = section.label;
    ui.create.hidden = !canCreate || !data || !section.create;
    const createLabel = section.create || '';
    if (ui.create.textContent !== createLabel) ui.create.textContent = createLabel;
    ui.tools.hidden = !data;
    ui.campaignViews.hidden = view !== 'campaigns';
    ui.working.setAttribute('aria-pressed', String(campaignView === 'working'));
    ui.history.setAttribute('aria-pressed', String(campaignView === 'history'));
    ui.importContacts.hidden = !data || !canCreate || view !== 'subscribers';
    ui.exportContacts.hidden = !data || !canUpdate || view !== 'subscribers';
    ui.speedCampaign.hidden = !canCreate || !data;
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
    const statuses = view !== 'campaigns' ? SECTIONS[view].statuses : Object.fromEntries(Object.entries(CAMPAIGN_STATUS)
      .filter(([status]) => (status === 'sent') === (campaignView === 'history')));
    setOptions(ui.status, { '': 'Todas as situações', ...statuses });
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
    const status = ui.status.value;
    const query = searchText(ui.search.value.trim());
    const interest = view === 'subscribers' ? ui.interest.value : '';
    const records = data[view].filter((record) => {
      const fields = [record.name, record.title, record.email, record.slug, record.source, record.subject, ...(record.tags || [])];
      return (view !== 'campaigns' || (record.status === 'sent') === (campaignView === 'history'))
        && (!status || status === record.status) && (!interest || (record.tags || []).includes(interest))
        && (!query || fields.some((value) => searchText(value).includes(query)));
    });
    if (records.length) {
      if (view === 'campaigns' && campaignView === 'history') records.sort((first, second) =>
        (Date.parse(second.sentAt ?? second.updatedAt) || 0) - (Date.parse(first.sentAt ?? first.updatedAt) || 0));
      const total = node('p', 'mcrm-result-count', `${count(records.length)} ${records.length === 1 ? 'registro' : 'registros'}`);
      const content = view === 'subscribers' ? renderContacts(records) : view === 'campaigns' ? renderCampaigns(records) : renderPages(records);
      if (view === 'campaigns' && campaignView === 'history') ui.panel.replaceChildren(renderHistorySummary(), total, content);
      else ui.panel.replaceChildren(total, content);
      return;
    }
    const filtered = Boolean(status || query || interest);
    const history = view === 'campaigns' && campaignView === 'history';
    const emptyLabels = { subscribers: 'Nenhum contato cadastrado', campaigns: history ? 'Nenhuma campanha enviada' : 'Nenhuma campanha em trabalho', landings: 'Nenhuma página cadastrada' };
    const emptyNotes = { subscribers: 'Cadastre contatos ou importe uma lista CSV.', campaigns: history ? 'Os indicadores aparecem após o primeiro envio.' : 'Vincule uma página publicada para criar uma campanha.',
      landings: 'Crie uma página no editor e publique para compartilhar o link.' };
    const empty = renderEmpty(filtered ? 'Nenhum resultado' : emptyLabels[view],
      filtered ? 'Experimente outra busca ou filtro.' : emptyNotes[view], SECTIONS[view].icon);
    if (history) ui.panel.replaceChildren(renderHistorySummary(), empty);
    else ui.panel.replaceChildren(empty);
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
      const landing = data.landings.find((entry) => entry.id === campaign.landingId);
      const segment = data.segments.find((entry) => entry.id === campaign.segmentId);
      identity.append(node('p', 'mcrm-resource-meta', [CAMPAIGN_TYPES[campaign.type] || 'Promocional', landing?.title, segment && `Público: ${segment.name}`].filter(Boolean).join(' · ')));
      head.append(identity, statusPill(campaign.status, CAMPAIGN_STATUS));
      card.append(head);
      if (campaign.status !== 'draft') card.append(metricList(splitMetricInfo(campaign)));
      if (campaign.sentAt) card.append(node('p', 'mcrm-sent-at', `Envio registrado em ${date(campaign.sentAt)}`));
      if (campaign.failedCount > 0) card.append(node('p', 'mcrm-sent-at', `Falhas registradas: ${count(campaign.failedCount)}`));
      const controls = node('footer', 'mcrm-campaign-actions');
      controls.append(action('Prévia', (event) => preview(campaign, event.currentTarget), { symbol: 'journal-text' }));
      if (campaign.status === 'sent') controls.append(action('Ver análise', (event) => showCampaignAnalysis(campaign, event.currentTarget), { symbol: 'graph-up', primary: true }));
      if (canUpdate && campaign.status === 'draft') {
        controls.append(action('Editar', (event) => openCampaign(campaign, event.currentTarget)));
        if (campaign.subject && (campaign.landingId ? landing?.status === 'published' : campaign.content)) {
          controls.append(action('Preparar público', (event) => prepare(campaign, event.currentTarget), { primary: true }));
        } else card.append(node('p', 'mcrm-sent-at', 'Informe o assunto e vincule uma página publicada ou adicione uma mensagem.'));
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

  function renderPages(records) {
    const list = node('div', 'mcrm-campaign-list');
    for (const item of records) {
      const card = node('article', 'mcrm-campaign');
      const header = node('header', 'mcrm-campaign-head');
      header.append(node('h2', '', item.title), statusPill(item.status, LANDING_STATUS));
      card.append(header);
      const options = node('footer', 'mcrm-campaign-actions');
      if (item.description) card.append(node('p', 'mcrm-resource-meta', item.description));
      if (item.hasUnpublishedChanges) card.append(node('p', 'mcrm-resource-meta', 'Alterações em rascunho'));
      if (item.publishedAt) card.append(node('p', 'mcrm-resource-meta', `Publicada em ${date(item.publishedAt)}`));
      card.append(metricList([['Leads confirmados', item.leadCount], ['Aguardando confirmação', item.pendingCount]]));
      if (item.status === 'published' && /^\/inscricao\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.path)) {
        const link = node('a', 'mcrm-action');
        link.href = item.path;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.append(icon('arrow-up-right'), document.createTextNode('Abrir página'));
        options.append(link, action('Copiar link', () => void copyLandingLink(item.path), { symbol: 'link-45deg' }));
      }
      options.append(action('Ver dados', (event) => showPageAnalysis(item, event.currentTarget), { symbol: 'graph-up' }));
      if (canUpdate) {
        options.append(action('Editar página', () => onOpenPage?.(item.id), { primary: true }));
        if (item.status === 'published') options.append(action('Retirar do ar', (event) => confirmPageAction(item, event.currentTarget, false)));
        options.append(action('Excluir página', (event) => confirmPageAction(item, event.currentTarget, true)));
      }
      card.append(options);
      list.append(card);
    }
    return list;
  }

  function renderHistorySummary() {
    const result = node('section', 'mcrm-report');
    const { totals } = data;
    const percent = (value) => percentage(value, 100);
    result.append(node('h3', '', 'Métricas de e-mail'), metricList([
      ['Taxa de abertura', percent(totals.openRate)], ['Taxa de cliques', percent(totals.clickRate)], ['Taxa de conversão', percent(totals.conversionRate)],
      ['Enviados', totals.sent], ['Entregues', totals.delivered], ['Aberturas', totals.opened], ['Cliques', totals.clicked],
      ['Leads confirmados', totals.leads], ['Leads pendentes', totals.pendingLeads], ['Conversões', totals.conversions], ['Descadastros', totals.unsubscribes],
    ]));
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

  function importContacts(trigger) {
    if (!canCreate) return;
    const panel = node('div', 'mcrm-import');
    const input = node('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.required = true;
    const label = node('label', 'mcrm-field');
    label.append(node('span', '', 'Arquivo CSV'), input);
    panel.append(node('p', 'mcrm-form-note', 'Inclua a coluna email. Nome, interesses, status e origem são opcionais. O limite é de 500 linhas ou 96 KB.'),
      action('Baixar modelo', () => downloadCsv('email;nome;interesses;status;origem\r\ncliente@exemplo.com;Nome do contato;newsletter;pendente;', 'modelo-contatos-maximum.csv'), { symbol: 'download' }), label,
      node('p', 'mcrm-form-note', 'Inscritos precisam ter origem de consentimento. Contatos existentes e descadastrados são preservados.'));
    openDialog({ title: 'Importar contatos', content: panel, trigger, save: 'Importar CSV', submit: async () => {
      const file = input.files?.[0];
      if (!file || file.size > 96 * 1024) throw new Error('Escolha um CSV de até 96 KB.');
      const csv = await file.text();
      const result = await request(`${API_PATH}/contacts/import`, { method: 'POST', body: { csv } });
      const summary = `${count(result.imported)} importados · ${count(result.duplicates)} existentes ou duplicados · ${count(result.invalid)} inválidos`;
      return { message: summary, rows: result.errors || [] };
    } });
  }

  async function exportContacts() {
    const current = generation;
    ui.exportContacts.disabled = true;
    displayMessage();
    try {
      const result = await request(`${API_PATH}/contacts/export`, { method: 'POST', body: {} });
      if (!active || generation !== current) return;
      downloadCsv(result.csv, 'central-maximum-contatos.csv');
      displayMessage(`${count(result.count)} contatos exportados.`);
    } catch (error) {
      if (active && generation === current && !reportAuth(error)) displayMessage(error.message || 'Não foi possível exportar os contatos.', true);
    } finally {
      ui.exportContacts.disabled = false;
    }
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
    const published = data.landings.filter((item) => item.status === 'published' || item.id === campaign?.landingId);
    if (!campaign && !published.length) {
      const panel = node('div', 'mcrm-form-explanation');
      panel.append(node('p', '', 'Publique uma página para usar seus blocos na campanha.'),
        action('Abrir Páginas', () => { ui.dialog.close(); selectView('landings', true); }, { symbol: 'file-earmark' }));
      openDialog({ title: 'Criar campanha', content: panel, trigger });
      return;
    }
    const landings = Object.fromEntries([['', campaign ? 'Sem página vinculada' : 'Selecione uma página publicada'], ...published.map(({ id, title, status }) =>
      [id, status === 'published' ? title : `${title} (fora do ar)`])]);
    const fields = fieldGrid([...campaignFields.slice(0, 2),
      { name: 'landingId', label: 'Página da campanha', type: 'select', options: landings, wide: true, required: !campaign,
        hint: 'A Central gera o HTML do e-mail com os blocos publicados e inclui o link da página.' },
      ...campaignFields.slice(2)], { type: 'promotion', ...campaign });
    fields.querySelector('[name="subject"]').required = !campaign;
    const path = `${API_PATH}/campaigns${campaign ? `/${encodeURIComponent(campaign.id)}` : ''}`;
    openDialog({
      title: campaign ? 'Editar campanha' : 'Criar campanha', content: fields, trigger,
      submit: (body) => request(path, { method: campaign ? 'PATCH' : 'POST', body }),
    });
  }

  function preview(campaign, trigger) {
    const content = node('div', 'mcrm-preview');
    content.append(node('span', 'mcrm-preview-caption', 'Assunto'), node('h3', '', campaign.subject || 'Sem assunto'));
    const landing = data.landings.find((item) => item.id === campaign.landingId);
    const frame = node('iframe', 'mcrm-email-preview');
    frame.setAttribute('title', 'Prévia HTML do e-mail');
    frame.setAttribute('sandbox', '');
    frame.src = `/v1/platform${API_PATH}/campaigns/${encodeURIComponent(campaign.id)}/preview?document=1`;
    content.append(frame);
    if (landing) {
      content.append(node('p', 'mcrm-resource-meta', `Página vinculada: ${landing.title}`));
      if (landing.status === 'published' && /^\/inscricao\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(landing.path)) {
        const link = node('a', 'mcrm-action', 'Abrir página publicada');
        link.href = landing.path;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        content.append(link);
      }
    }
    openDialog({ title: 'Prévia do e-mail', content, trigger });
  }

  function prepare(campaign, trigger) {
    const content = node('div', 'mcrm-form-explanation');
    const segment = data.segments.find((entry) => entry.id === campaign.segmentId);
    content.append(
      node('p', '', `Campanha: ${campaign.name}`),
      node('p', '', 'A lista inclui apenas contatos inscritos com consentimento.'),
    );
    if (segment) content.append(node('p', '', `Público vinculado: ${segment.name}.`));
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

  function confirmPageAction(item, trigger, archive) {
    const label = archive ? 'Excluir página' : 'Retirar do ar';
    const content = node('div', 'mcrm-form-explanation');
    content.append(node('p', '', item.title), node('p', '', archive
      ? 'A página sairá do ar e deixará de aparecer na lista. O histórico das campanhas será preservado.'
      : 'O link público ficará indisponível. Você poderá publicar a página novamente pelo editor.'));
    const path = `${API_PATH}/landings/${encodeURIComponent(item.id)}`;
    openDialog({ title: label, content, trigger, save: label,
      submit: () => archive ? request(path, { method: 'DELETE' }) : request(`${path}/unpublish`, { method: 'POST', body: {} }) });
  }

  async function copyLandingLink(path) {
    const url = new URL(path, location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      displayMessage('Link da página copiado.');
    } catch { displayMessage(url); }
  }

  function showCampaignAnalysis(campaign, trigger) {
    const content = node('div', 'mcrm-analysis');
    const summary = node('section', 'mcrm-analysis-summary');
    summary.append(node('h3', '', 'Desempenho do e-mail'), metricList([
      ...splitMetricInfo(campaign),
      ['Taxa de abertura', percentage(campaign.openCount, campaign.deliveredCount)],
      ['Taxa de cliques', percentage(campaign.clickCount, campaign.deliveredCount)],
      ['Taxa de conversão', percentage(campaign.conversionCount, campaign.sentCount)],
    ]));
    if (campaign.sentAt) summary.append(node('p', 'mcrm-sent-at', `Envio em ${date(campaign.sentAt)}`));
    content.append(summary);
    const pageMetrics = node('section', 'mcrm-page-report');
    content.append(pageMetrics);
    openDialog({ title: `Análise de ${campaign.name}`, content, trigger });
    if (campaign.landingId) void populatePageAnalysis(pageMetrics, campaign.landingId, campaign.id);
  }

  function showPageAnalysis(item, trigger) {
    const content = node('div', 'mcrm-analysis');
    openDialog({ title: `Dados de ${item.title}`, content, trigger });
    void populatePageAnalysis(content, item.id);
  }

  function createReportTable(title, columns, rows) {
    const section = node('section', 'mcrm-analysis-table');
    section.append(node('h3', '', title));
    const wrapper = node('div', 'mcrm-table-scroll');
    const table = node('table', 'mcrm-report-table');
    table.setAttribute('aria-label', title);
    const headers = table.createTHead().insertRow();
    for (const label of columns) {
      const cell = node('th', '', label);
      cell.scope = 'col';
      headers.append(cell);
    }
    const body = table.createTBody();
    for (const cells of rows) {
      const row = body.insertRow();
      for (const value of cells) row.insertCell().textContent = typeof value === 'string' ? value : count(value);
    }
    wrapper.append(table);
    section.append(wrapper);
    return section;
  }

  async function populatePageAnalysis(container, pageId, campaignId) {
    const loadingLabel = node('p', 'mcrm-form-note', 'Carregando dados da página…');
    loadingLabel.setAttribute('role', 'status');
    container.replaceChildren(loadingLabel);
    try {
      const filter = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
      const report = await request(`${API_PATH}/landings/${encodeURIComponent(pageId)}/analytics${filter}`);
      if (!container.isConnected || !ui.dialog.open) return;
      const blockName = (block) => block.title || block.label || block.blockId;
      const names = new Map((report.blocks || []).map((block) => [block.blockId, blockName(block)]));
      container.replaceChildren(node('h3', '', 'Engajamento na página'), metricList([
        ['Visitas', report.visits], ['Visitas atribuídas', report.identifiedVisits], ['Cliques', report.clicks],
        ['Tempo médio ativo', duration(report.averageSeconds)], ['Formulários enviados', report.submissions], ['Conversões', report.conversions],
      ]), node('p', 'mcrm-form-note', 'O tempo ativo é calculado enquanto a página está visível. A atribuição usa o link individual enviado ao contato. Se ele for encaminhado, a visita continua vinculada ao envio original.'));
      if (report.blocks?.length) container.append(createReportTable('Dados por bloco',
        ['Bloco', 'Visualizações', 'Cliques', 'Tempo médio ativo', 'Formulários', 'Conversões'], report.blocks.map((block) => [
          blockName(block), block.views, block.clicks, duration(block.averageSeconds), block.submissions, block.conversions,
        ])));
      const leads = node('section', 'mcrm-analysis-leads');
      leads.append(node('h3', '', 'Atividade por lead'));
      for (const lead of report.leads || []) {
        const detail = node('details', 'mcrm-analysis-lead');
        detail.append(node('summary', '', lead.name ? `${lead.name} · ${lead.email}` : lead.email || 'Lead atribuído'),
          metricList([['Visitas', lead.visits], ['Cliques', lead.clicks], ['Tempo ativo', duration(lead.seconds)],
            ['Formulários', lead.submissions], ['Conversões', lead.conversions], ['Última interação', date(lead.lastAt)]]));
        if (lead.blocks?.length) detail.append(createReportTable('Interações por bloco', ['Bloco', 'Visualizações', 'Cliques', 'Tempo ativo', 'Conversões'],
          lead.blocks.map((block) => [names.get(block.blockId) || block.blockId, block.views, block.clicks, duration(block.seconds), block.conversions])));
        leads.append(detail);
      }
      if (!report.leads?.length) leads.append(node('p', 'mcrm-form-note', 'Ainda não há visitas atribuídas a destinatários de e-mail.'));
      if (report.moreLeads) leads.append(node('p', 'mcrm-form-note', 'As interações mais recentes são exibidas aqui. Os indicadores incluem todo o período.'));
      container.append(leads);
    } catch (error) {
      if (container.isConnected && ui.dialog.open && !reportAuth(error)) {
        loadingLabel.textContent = error.message || 'Não foi possível carregar os dados da página.';
      }
    }
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
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = SECTION_KEYS.indexOf(view);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? SECTION_KEYS.length - 1
      : (index + (event.key === 'ArrowUp' ? -1 : 1) + SECTION_KEYS.length) % SECTION_KEYS.length;
    selectView(SECTION_KEYS[next], true);
  });
  ui.search.addEventListener('input', renderResults);
  ui.status.addEventListener('change', renderResults);
  ui.interest.addEventListener('change', renderResults);
  ui.refresh.addEventListener('click', () => void reload());
  ui.working.addEventListener('click', () => selectView('campaigns', false, 'working'));
  ui.history.addEventListener('click', () => selectView('campaigns', false, 'history'));
  ui.importContacts.addEventListener('click', () => importContacts(ui.importContacts));
  ui.exportContacts.addEventListener('click', () => void exportContacts());
  ui.create.addEventListener('click', () => {
    if (!canCreate || !data) return;
    if (view === 'landings') onOpenPage?.(null);
    else if (view === 'campaigns') openCampaign(null, ui.create);
    else openContact(null, ui.create);
  });

  function speedMenu(expanded) {
    ui.speedList.hidden = !expanded;
    ui.speedToggle.setAttribute('aria-expanded', String(expanded));
  }

  ui.speedToggle.addEventListener('click', () => {
    speedMenu(ui.speedList.hidden);
    if (!ui.speedList.hidden) (ui.speedCampaign.hidden ? ui.speedMetrics : ui.speedCampaign).focus();
  });
  ui.speedCampaign.addEventListener('click', () => {
    speedMenu(false);
    selectView('campaigns');
    openCampaign(null, ui.speedToggle);
  });
  ui.speedMetrics.addEventListener('click', () => {
    speedMenu(false);
    selectView('campaigns', true, 'history');
  });
  ui.speedPages.addEventListener('click', () => {
    speedMenu(false);
    selectView('landings', true);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ui.speedList.hidden) {
      event.preventDefault();
      speedMenu(false);
      ui.speedToggle.focus();
    }
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
      const result = await operation(body);
      if (!active || generation !== current) return;
      ui.dialog.close();
      displayMessage(result?.message || 'Alteração salva.');
      if (result?.rows?.length) ui.message.append(document.createTextNode(`\n${result.rows.map(({ row, message }) => `Linha ${row}: ${message}`).join('\n')}`));
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
    speedMenu(false);
    formError();
    displayMessage();
    setBusy(false);
  }

  return {
    open({ canCreate: mayCreate = true, canUpdate: mayUpdate = true, initialSection } = {}) {
      const initialView = Object.hasOwn(SECTIONS, initialSection) ? initialSection : null;
      if (active && canCreate === mayCreate && canUpdate === mayUpdate) {
        if (initialView && view !== initialView) selectView(initialView);
        return;
      }
      if (active) close();
      generation += 1;
      active = true;
      canCreate = mayCreate;
      canUpdate = mayUpdate;
      view = initialView ?? 'subscribers';
      campaignView = 'working';
      ui.search.value = '';
      resetOptions();
      displayMessage();
      void reload();
    },
    close,
  };
}
