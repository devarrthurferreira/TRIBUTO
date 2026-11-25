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
  sent: 'Enviada',
};
const STATUSES = { subscribers: CONTACT_STATUS, campaigns: CAMPAIGN_STATUS };

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
  select.value = current;
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
    input.min = '0';
    input.max = '2147483647';
    input.step = '1';
    input.inputMode = 'numeric';
  }
  if (config.placeholder) input.placeholder = config.placeholder;
  input.required = Boolean(config.required);
  label.append(caption, input);
  if (config.hint) label.append(node('small', '', config.hint));
  return { label, input, caption };
}

function splitMetricInfo(campaign) {
  return [
    ['Preparados', campaign.audienceCount],
    ['Enviados', campaign.sentCount],
    ['Entregues', campaign.deliveredCount],
    ['Aberturas', campaign.openCount],
    ['Cliques', campaign.clickCount],
  ];
}

function metricList(rows) {
  const list = node('dl', 'mcrm-campaign-stats');
  for (const [label, value] of rows) {
    const metric = node('div');
    metric.append(node('dt', '', label), node('dd', '', count(value)));
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
];
const campaignFields = [
  { name: 'name', label: 'Nome da campanha', maxLength: 160, required: true },
  { name: 'subject', label: 'Assunto do e-mail', maxLength: 160 },
  { name: 'content', label: 'Mensagem', type: 'textarea', maxLength: 24000, wide: true },
];
const resultFields = [
  { name: 'sentCount', label: 'E-mails enviados', type: 'number', required: true },
  { name: 'deliveredCount', label: 'E-mails entregues', type: 'number' },
  { name: 'openCount', label: 'Destinatários que abriram', type: 'number' },
  { name: 'clickCount', label: 'Destinatários que clicaram', type: 'number' },
];
const numericValues = new Set(resultFields.map(({ name }) => name));

export function mountMarketingCrm(root, { request, onAuthError } = {}) {
  root.classList.add('mcrm');
  root.innerHTML = `
    <header class="mcrm-header">
      <div>
        <h1>CRM de Marketing</h1>
        <p>Gerencie assinantes e acompanhe suas campanhas de e-mail.</p>
      </div>
      <button class="mcrm-action mcrm-primary" type="button" data-crm="create" hidden></button>
    </header>
    <div class="mcrm-kpis" data-crm="metrics" aria-label="Indicadores do CRM"></div>
    <aside class="mcrm-provider"><i class="bi bi-broadcast" aria-hidden="true"></i><p><strong>Envio por plataforma externa</strong><span>Prepare a campanha e exporte a lista de inscritos. Depois do envio, registre os resultados do seu provedor.</span></p></aside>
    <section class="mcrm-board" aria-label="Contatos e campanhas">
      <div class="mcrm-board-tools">
        <div class="mcrm-tabs" role="tablist" aria-label="Áreas do CRM">
          <button type="button" role="tab" id="mcrm-contacts-tab" aria-controls="mcrm-panel" data-crm="contacts"><i class="bi bi-people" aria-hidden="true"></i> Contatos</button>
          <button type="button" role="tab" id="mcrm-campaigns-tab" aria-controls="mcrm-panel" data-crm="campaigns"><i class="bi bi-megaphone" aria-hidden="true"></i> Campanhas</button>
        </div>
        <div class="mcrm-filters" data-crm="filters">
          <label class="mcrm-search"><i class="bi bi-search" aria-hidden="true"></i><span class="sr-only">Buscar no CRM</span><input type="search" data-crm="search"></label>
          <label class="mcrm-filter"><span class="sr-only">Filtrar por situação</span><select data-crm="status"></select></label>
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
  const tabs = { subscribers: ui.contacts, campaigns: ui.campaigns };
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
      setOptions(ui.status, { '': 'Todas as situações', ...STATUSES[view] });
      render();
    }
    if (moveFocus) tabs[view].focus();
  }

  function renderSummary() {
    const totals = data?.totals || {};
    const cards = [
      ['Contatos', totals.subscribers, 'people'],
      ['Inscritos', totals.subscribed, 'check2'],
      ['Campanhas', totals.campaigns, 'megaphone'],
      ['Aberturas registradas', totals.opened, 'graph-up'],
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
    for (const [name, tab] of Object.entries(tabs)) {
      tab.setAttribute('aria-selected', String(name === view));
      tab.tabIndex = name === view ? 0 : -1;
    }
    ui.panel.setAttribute('aria-labelledby', tabs[view].id);
    ui.panel.setAttribute('aria-busy', String(loading));
    ui.create.hidden = !canCreate || !data;
    const createLabel = view === 'subscribers' ? 'Novo contato' : 'Nova campanha';
    if (ui.create.textContent !== createLabel) ui.create.textContent = createLabel;
    ui.filters.hidden = !data;
    ui.search.placeholder = view === 'subscribers' ? 'Buscar contato' : 'Buscar campanha';
    renderResults();
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
    const records = data[view].filter((record) => {
      const fields = view === 'subscribers' ? [record.name, record.email, record.source] : [record.name, record.subject];
      return (!status || status === record.status) && (!query || fields.some((value) => searchText(value).includes(query)));
    });
    if (records.length) {
      const total = node('p', 'mcrm-result-count', `${count(records.length)} ${records.length === 1 ? 'registro' : 'registros'}`);
      const content = view === 'subscribers' ? renderContacts(records) : renderCampaigns(records);
      ui.panel.replaceChildren(total, content);
      return;
    }
    const filtered = Boolean(status || query);
    const title = filtered ? 'Nenhum resultado' : view === 'subscribers' ? 'Nenhum contato cadastrado' : 'Nenhuma campanha cadastrada';
    const description = filtered ? 'Experimente outra busca ou situação.' : view === 'subscribers'
      ? 'Cadastre contatos e acompanhe quem confirmou a inscrição.'
      : 'Crie um rascunho para preparar sua primeira campanha.';
    ui.panel.replaceChildren(renderEmpty(title, description, view === 'subscribers' ? 'people' : 'megaphone'));
  }

  function renderContacts(records) {
    const wrapper = node('div', 'mcrm-contact-list');
    const table = node('table', 'mcrm-table');
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', 'Contatos do CRM');
    const head = table.createTHead().insertRow();
    const labels = ['Contato', 'Situação', 'Origem', 'Consentimento'];
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
      head.append(identity, statusPill(campaign.status, CAMPAIGN_STATUS));
      card.append(head);
      if (campaign.status !== 'draft') card.append(metricList(splitMetricInfo(campaign)));
      if (campaign.sentAt) card.append(node('p', 'mcrm-sent-at', `Envio registrado em ${date(campaign.sentAt)}`));
      const controls = node('footer', 'mcrm-campaign-actions');
      controls.append(action('Prévia', (event) => preview(campaign, event.currentTarget), { symbol: 'journal-text' }));
      if (canUpdate && campaign.status === 'draft') {
        controls.append(action('Editar', (event) => openCampaign(campaign, event.currentTarget)));
        if (campaign.subject && campaign.content) {
          controls.append(action('Preparar público', (event) => prepare(campaign, event.currentTarget), { primary: true }));
        } else card.append(node('p', 'mcrm-sent-at', 'Preencha o assunto e a mensagem para preparar o público.'));
      }
      if (canUpdate && campaign.status !== 'draft') {
        if (campaign.status === 'prepared') controls.append(
          action('Exportar destinatários', (event) => void exportAudience(campaign, event.currentTarget), { symbol: 'download' }),
          action('Voltar para rascunho', (event) => reopenCampaign(campaign, event.currentTarget)),
        );
        controls.append(action(campaign.status === 'sent' ? 'Atualizar resultados' : 'Registrar envio', (event) => record(campaign, event.currentTarget), { primary: true }));
      }
      card.append(controls);
      list.append(card);
    }
    return list;
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
      const initial = config.name === 'status' ? contact?.status || 'pending' : contact?.[config.name];
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
      submit: (body) => request(path, { method: contact ? 'PATCH' : 'POST', body }),
    });
  }

  function openCampaign(campaign, trigger) {
    if (campaign ? !canUpdate : !canCreate) return;
    const fields = node('div', 'mcrm-field-grid');
    for (const config of campaignFields) fields.append(field(config, campaign?.[config.name]).label);
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
    openDialog({ title: 'Prévia do e-mail', content, trigger });
  }

  function prepare(campaign, trigger) {
    const content = node('div', 'mcrm-form-explanation');
    content.append(
      node('p', '', 'A campanha ficará pronta para exportação dos destinatários. A lista inclui apenas contatos inscritos.'),
      node('p', '', 'O envio será realizado na sua plataforma de e-mail.'),
    );
    openDialog({
      title: 'Preparar público', content, trigger, save: 'Preparar campanha',
      submit: () => request(`${API_PATH}/campaigns/${encodeURIComponent(campaign.id)}/prepare`, { method: 'POST', body: {} }),
    });
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

  ui.contacts.addEventListener('click', () => selectView('subscribers'));
  ui.campaigns.addEventListener('click', () => selectView('campaigns'));
  ui.contacts.parentElement.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const opposite = view === 'subscribers' ? 'campaigns' : 'subscribers';
    selectView(event.key === 'Home' ? 'subscribers' : event.key === 'End' ? 'campaigns' : opposite, true);
  });
  ui.search.addEventListener('input', renderResults);
  ui.status.addEventListener('change', renderResults);
  ui.create.addEventListener('click', () => {
    if (view === 'subscribers') openContact(null, ui.create);
    else openCampaign(null, ui.create);
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
      setOptions(ui.status, { '': 'Todas as situações', ...CONTACT_STATUS });
      displayMessage();
      void reload();
    },
    close,
  };
}
