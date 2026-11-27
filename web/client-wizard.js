import { CLIENT_MODULES } from './client-modules.js';

const states = new Map([
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'], ['CE', 'Ceará'],
  ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'], ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'],
  ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'],
  ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'], ['RS', 'Rio Grande do Sul'],
  ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins'],
]);

const regimes = new Map([
  ['simples-nacional', 'Simples Nacional'], ['mei', 'MEI'], ['lucro-presumido', 'Lucro Presumido'],
  ['lucro-real', 'Lucro Real'], ['lucro-arbitrado', 'Lucro Arbitrado'], ['imune-isenta', 'Imune ou isenta'], ['outro', 'Outro'],
]);

const steps = [
  ['Adicionar dados', 'person-badge'], ['Certificado', 'shield-lock'], ['Módulos de acesso', 'grid'],
  ['NFC-e', scheduleSummary(client.consumerSchedule)], ['Consultas de NF', 'receipt'], ['Notas de serviço', 'file-earmark'], ['Dados de acesso', 'key'],
];

const schedules = new Map([
  ['disabled', ['Desativada', '']], ['day', ['Diurno', '08:00']], ['night', ['Noturno', '22:00']],
]);

const scheduleTitles = ['NFC-e', scheduleSummary(client.consumerSchedule)], ['Consultas de NF', 'Notas de serviço'];
const accessStatuses = {
  unconfigured: 'Acesso ainda não configurado',
  activation_pending: 'Aguardando definição da senha',
  activation_in_progress: 'Definição da senha em andamento',
  activation_expired: 'Código de ativação expirado',
  active: 'Senha definida · acesso ativo',
  revoked: 'Acesso revogado',
};
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const maxCertificateBytes = 512 * 1024;
const digits = value => String(value ?? '').replace(/\D/g, '');
const documentValue = (type, value) => type === 'pf' ? digits(value) : String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const clientPath = client => '/clients/' + encodeURIComponent(client.id || client.document || client.cnpj);

export function clientDocumentLabel(type, value) {
  const text = documentValue(type, value).slice(0, type === 'pf' ? 11 : 14);
  if (type === 'pf') {
    return text.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3}\.\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3}\.\d{3}\.\d{3})(\d)/, '$1-$2');
  }
  return text.replace(/^([A-Z0-9]{2})([A-Z0-9])/, '$1.$2').replace(/^([A-Z0-9]{2}\.[A-Z0-9]{3})([A-Z0-9])/, '$1.$2')
    .replace(/^([A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3})([A-Z0-9])/, '$1/$2')
    .replace(/^([A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4})([A-Z0-9])/, '$1-$2');
}

function cnaeLabel(value) {
  return digits(value).slice(0, 7).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2}\.\d{2})(\d)/, '$1-$2')
    .replace(/^(\d{2}\.\d{2}-\d)(\d)/, '$1/$2');
}

function validDocument(type, value) {
  const format = type === 'pf' ? /^\d{11}$/ : /^[A-Z0-9]{12}\d{2}$/;
  if (!format.test(value) || /^(\d)\1+$/.test(value)) return false;
  function checkDigit(base) {
    const sum = Array.from(base, character => character.charCodeAt(0) - 48).reduce((total, number, index) => {
      const position = base.length - index;
      const weight = type === 'pf' ? position + 1 : (position - 1) % 8 + 2;
      return total + number * weight;
    }, 0);
    return sum % 11 < 2 ? 0 : 11 - sum % 11;
  }
  return checkDigit(value.slice(0, -2)) === Number(value.at(-2)) && checkDigit(value.slice(0, -1)) === Number(value.at(-1));
}

function el(tag, className = '', text = '') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function icon(name) {
  const element = el('i', 'bi bi-' + name);
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function button(text, { primary = false, glyph, type = 'button' } = {}) {
  const control = el('button', 'button ' + (primary ? 'button-primary' : 'button-quiet'));
  control.type = type;
  if (glyph) control.append(icon(glyph));
  control.append(text);
  return control;
}

function select(options, value = '') {
  const control = el('select');
  for (const [id, label] of options) control.append(new Option(label, id));
  control.value = value;
  return control;
}

function input(name, { value = '', type = 'text', required = false, length = 160, placeholder = '' } = {}) {
  const control = el('input');
  Object.assign(control, { name, type, required, maxLength: length, placeholder, value });
  return control;
}

let fieldCount = 0;
function field(label, control) {
  const container = el('label', 'client-wizard-field');
  const caption = el('span', '', label);
  caption.id = 'clientWizardField' + ++fieldCount;
  control.setAttribute('aria-labelledby', caption.id);
  container.append(caption, control);
  return container;
}

function formatTime(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? dateTime.format(date) : '';
}

function replaceValue(control, display) {
  if (control.value !== display) control.value = display;
}

function appendDetails(target, rows) {
  for (const [label, value] of rows) {
    if (!value) continue;
    const entry = el('div');
    entry.append(el('dt', '', label), el('dd', '', value));
    target.append(entry);
  }
}

function scheduleSummary(schedule) {
  const [label] = schedules.get(schedule?.period) || schedules.get('disabled');
  return schedule?.period !== 'disabled' && schedule?.time ? label + ' às ' + schedule.time : label;
}

export function renderClientProfile(target, client, { modules = CLIENT_MODULES } = {}) {
  target.replaceChildren();
  if (!client) return;
  const details = el('dl', 'client-wizard-record');
  const type = client.type === 'pf' ? 'Pessoa física' : 'Pessoa jurídica';
  const enabledModules = modules.filter(({ id }) => client.modules?.includes(id)).map(({ label }) => label);
  appendDetails(details, [
    ['Tipo de cliente', type], ['Apelido', client.nickname], ['Nome fantasia', client.tradeName],
    [client.type === 'pf' ? 'Nome completo' : 'Razão social', client.legalName],
    ['Estado', states.get(client.state) || client.state], ['Regime tributário', regimes.get(client.taxRegime)],
    ['CNAE principal', cnaeLabel(client.cnae)],
    ['Inscrições estaduais', (client.stateRegistrations || []).map(({ number, state }) => [number, state].filter(Boolean).join(' · ')).join(', ')],
    ['Inscrições municipais', (client.municipalRegistrations || []).map(({ number, municipality }) => [number, municipality].filter(Boolean).join(' · ')).join(', ')],
    ['Certificado A1', client.certificate?.fileName || 'Não cadastrado'],
    ['Módulos no Portal do Cliente', enabledModules.join(', ') || 'Nenhum módulo liberado'],
    ['NFC-e', scheduleSummary(client.consumerSchedule)], ['Consultas de NF', scheduleSummary(client.invoiceSchedule)], ['Notas de serviço', scheduleSummary(client.serviceInvoiceSchedule)],
  ]);
  target.append(details);
  if (!client.contacts?.length) return;
  const contacts = el('section', 'client-wizard-record-contacts');
  contacts.append(el('h3', '', 'Contatos'));
  const list = el('ul');
  for (const contact of client.contacts) {
    const item = el('li');
    item.append(el('strong', '', contact.name));
    if (contact.role) item.append(el('span', '', contact.role));
    if (contact.email) item.append(el('span', '', contact.email));
    if (contact.phone) item.append(el('span', '', contact.phone));
    list.append(item);
  }
  contacts.append(list);
  target.append(contacts);
}

function drawerMarkup() {
  return '<form class="client-wizard-form" novalidate>' +
    '<header class="client-wizard-header"><div class="client-wizard-header-label"><span class="client-wizard-header-icon" aria-hidden="true"><i class="bi bi-person-badge"></i></span><div><h2 id="clientWizardTitle">Adicionar Cliente</h2><p data-client="subtitle"></p></div></div>' +
    '<button type="button" class="icon-button" data-client="close" aria-label="Fechar"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header>' +
    '<div class="client-wizard-layout"><nav class="client-wizard-nav" data-client="nav" aria-label="Etapas do cadastro"><ol></ol></nav>' +
    '<div class="client-wizard-scroll" data-client="scroll"><div class="client-wizard-panels" data-client="panels"></div>' +
    '<section data-client="accessPanel" class="client-wizard-panel" hidden></section></div></div>' +
    '<footer class="client-wizard-footer"><p class="form-message" role="alert" data-client="error" hidden></p>' +
    '<div class="client-wizard-actions"><button type="button" class="button button-quiet" data-client="back">Voltar</button>' +
    '<button type="button" class="button button-quiet" data-client="cancel">Cancelar</button>' +
    '<button type="submit" class="button button-primary" data-client="next">Continuar</button>' +
    '<button type="button" class="button button-primary" data-client="done" hidden>Concluir</button></div></footer></form>';
}

function personTypeChoice(type, label, glyph) {
  const control = input('type', { type: 'radio', value: type });
  const card = el('label', 'client-wizard-choice');
  card.append(control, icon(glyph), el('span', '', label));
  return { card, control };
}

function schedulePanel(index) {
  const timing = select(Array.from(schedules, ([id, [label]]) => [id, label]));
  const time = input('schedule-' + index, { type: 'time' });
  time.step = '60';
  const timeField = field('Horário da consulta', time);
  const note = el('p', 'client-wizard-note', 'O horário é registrado para o coletor no fuso de Brasília.');
  const grid = el('div', 'client-wizard-fields');
  grid.append(field('Período da consulta', timing), timeField);
  function set({ period = 'disabled', time: saved } = {}) {
    timing.value = schedules.has(period) ? period : 'disabled';
    const active = timing.value !== 'disabled';
    timeField.hidden = !active;
    time.disabled = !active;
    time.value = active ? saved || schedules.get(timing.value)[1] : '';
  }
  timing.addEventListener('change', () => set({ period: timing.value }));
  function value() { return { period: timing.value, time: time.value || null }; }
  function validate() {
    if (timing.value === 'disabled') return true;
    const daytime = time.value >= '06:00' && time.value < '18:00';
    if (time.value && (daytime === (timing.value === 'day'))) return true;
    time.setCustomValidity(timing.value === 'day' ? 'Escolha um horário entre 06:00 e 17:59.' : 'Escolha um horário entre 18:00 e 05:59.');
    time.reportValidity();
    time.setCustomValidity('');
    return false;
  }
  const planning = el('p', 'client-wizard-note', 'Para este documento, o horário fica registrado como planejamento.');
  return { elements: [grid, note, planning], set, value, validate, updateEligibility(eligible) { planning.hidden = eligible; } };
}

function showControlError(control, message) {
  control.setCustomValidity(message);
  control.reportValidity();
  control.setCustomValidity('');
  return false;
}

function readCertificate(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result).split(',')[1]), { once: true });
    reader.addEventListener('error', () => reject(new Error('Não foi possível ler o certificado.')), { once: true });
    reader.readAsDataURL(file);
  });
}

function repeatedSection({ title, empty, addLabel, limit, build }) {
  const group = el('section', 'client-wizard-group');
  const heading = el('h4', '', title);
  const actions = el('div', 'client-wizard-group-heading');
  const add = button(addLabel, { glyph: 'plus-lg' });
  const placeholder = el('p', 'client-wizard-empty', empty);
  const list = el('div', 'client-wizard-repeated');
  const rows = [];
  actions.append(heading, add);
  group.append(actions, placeholder, list);

  function refresh() {
    placeholder.hidden = rows.length > 0;
    add.disabled = rows.length >= limit;
    rows.forEach((row, index) => {
      row.title.textContent = title + ' ' + (index + 1);
      row.remove.setAttribute('aria-label', 'Remover ' + title.toLocaleLowerCase('pt-BR') + ' ' + (index + 1));
    });
  }

  function append(value, focus = false) {
    const { fields, controls, read } = build(value);
    const container = el('fieldset', 'client-wizard-entry');
    const title = el('legend', 'sr-only');
    const remove = button('Remover');
    remove.classList.add('client-wizard-remove');
    const row = { title, container, remove, controls, read };
    remove.addEventListener('click', () => {
      rows.splice(rows.indexOf(row), 1);
      container.remove();
      refresh();
      add.focus();
    });
    container.append(title, fields, remove);
    rows.push(row);
    list.append(container);
    refresh();
    if (focus) controls[0].focus();
  }

  function set(values) {
    rows.length = 0;
    list.replaceChildren();
    for (const value of values || []) append(value);
    refresh();
  }

  add.addEventListener('click', () => append(undefined, true));
  set([]);
  return { group, set, add, rows, values: () => rows.map(row => row.read()) };
}

export function mountClientWizard({ request, modules = CLIENT_MODULES, onSaved, onError }) {
  const dialog = el('dialog', 'client-wizard');
  dialog.id = 'clientWizardDialog';
  dialog.setAttribute('aria-labelledby', 'clientWizardTitle');
  dialog.innerHTML = drawerMarkup();
  document.body.append(dialog);
  const refs = Object.fromEntries(Array.from(dialog.querySelectorAll('[data-client]'), item => [item.dataset.client, item]));
  const title = dialog.querySelector('#clientWizardTitle');
  const form = dialog.querySelector('form');
  const stepList = refs.nav.querySelector('ol');
  const panels = steps.map(([label, glyph], index) => {
    const panel = el('section', 'client-wizard-panel');
    panel.hidden = index !== 0;
    panel.id = 'clientWizardStage' + (index + 1);
    const heading = el('h3', '', label);
    heading.tabIndex = -1;
    panel.setAttribute('aria-labelledby', panel.id + 'Heading');
    heading.id = panel.id + 'Heading';
    const item = el('li');
    const link = button('');
    link.setAttribute('aria-controls', panel.id);
    link.append(el('span', 'client-wizard-number', String(index + 1)), el('span', 'client-wizard-step-label', label));
    link.addEventListener('click', () => {
      if (index < step || (index <= furthest && validateStep(step))) showStep(index);
    });
    item.append(link);
    stepList.append(item);
    const panelHeading = el('div', 'client-wizard-panel-heading');
    panelHeading.append(icon(glyph), heading);
    panel.append(panelHeading);
    refs.panels.append(panel);
    return panel;
  });
  const indicators = [...stepList.querySelectorAll('button')];
  const selection = el('fieldset', 'client-wizard-types');
  selection.append(el('legend', '', 'Selecione o tipo de cliente'));
  const company = personTypeChoice('pj', 'Pessoa Jurídica', 'buildings');
  const person = personTypeChoice('pf', 'Pessoa Física', 'person');
  const types = el('div', 'client-wizard-type-choices');
  types.append(company.card, person.card);
  selection.append(types);

  const identity = el('div', 'client-wizard-fields');
  const documentInput = input('document', { required: true, length: 18, placeholder: '00.000.000/0000-00' });
  documentInput.autocomplete = 'off';
  documentInput.spellcheck = false;
  const documentField = field('CNPJ da empresa *', documentInput);
  const code = input('code', { placeholder: '999', maxLength: 24 });
  const nickname = input('nickname', { required: true, placeholder: 'Apelido' });
  const tradeName = input('tradeName', { placeholder: 'Nome fantasia' });
  const legalName = input('legalName', { placeholder: 'Razão social' });
  const legalField = field('Razão social', legalName);
  const state = select([['', 'Selecione o estado'], ...states]);
  state.name = 'state';
  state.required = true;
  const taxRegime = select([['', 'Selecione o regime'], ...regimes]);
  const taxField = field('Regime tributário', taxRegime);
  const cnae = input('cnae', { length: 10, placeholder: '00.00-0/00' });
  cnae.inputMode = 'numeric';
  const cnaeField = field('CNAE principal', cnae);
  const tradeField = field('Nome fantasia', tradeName);
  identity.append(documentField, field('Código', code), field('Apelido *', nickname), tradeField, legalField, field('Estado *', state), taxField, cnaeField);
  const status = select([['true', 'Ativo'], ['false', 'Inativo']]);
  const statusField = field('Status do cliente', status);
  identity.append(statusField);

  const stateRegistrations = repeatedSection({
    title: 'Inscrição estadual', empty: 'Nenhuma inscrição estadual adicionada. Clique em “Inscrição estadual” para adicionar.',
    addLabel: 'Inscrição estadual', limit: 100,
    build({ number = '', state: uf = '' } = {}) {
      const fields = el('div', 'client-wizard-fields');
      const registration = input('stateRegistration', { required: true, value: number, length: 40 });
      const location = select([['', 'Selecione a UF'], ...states], uf);
      fields.append(field('Número da inscrição estadual *', registration), field('Estado da inscrição', location));
      return { fields, controls: [registration, location], read: () => ({ number: registration.value.trim(), state: location.value || null }) };
    },
  });

  const municipalRegistrations = repeatedSection({
    title: 'Inscrição municipal', empty: 'Nenhuma inscrição municipal adicionada. Clique em “Inscrição municipal” para adicionar.',
    addLabel: 'Inscrição municipal', limit: 100,
    build({ number = '', municipality = '' } = {}) {
      const fields = el('div', 'client-wizard-fields');
      const registration = input('municipalRegistration', { required: true, value: number, length: 40 });
      const city = input('municipality', { value: municipality, length: 120 });
      fields.append(field('Número da inscrição municipal *', registration), field('Município', city));
      return { fields, controls: [registration, city], read: () => ({ number: registration.value.trim(), municipality: city.value.trim() }) };
    },
  });

  const contacts = repeatedSection({
    title: 'Contato', empty: 'Nenhum contato. Clique em “Adicionar contato” para incluir de 1 a 3 contatos.',
    addLabel: 'Adicionar contato', limit: 3,
    build({ name = '', phone = '', email = '', role = '' } = {}) {
      const fields = el('div', 'client-wizard-fields');
      const fullName = input('contactName', { required: true, value: name, length: 120 });
      const address = input('contactEmail', { type: 'email', value: email, length: 254 });
      const number = input('contactPhone', { type: 'tel', value: phone, length: 32, placeholder: '(00) 00000-0000' });
      const job = input('contactRole', { value: role, length: 80 });
      fields.append(field('Nome do contato *', fullName), field('Cargo ou vínculo', job), field('E-mail', address), field('Telefone', number));
      return {
        fields, controls: [fullName, job, address, number],
        read: () => ({ name: fullName.value.trim(), email: address.value.trim(), phone: number.value.trim(), role: job.value.trim() }),
      };
    },
  });
  panels[0].append(selection, el('p', 'client-wizard-required', '* Campos obrigatórios'), identity,
    stateRegistrations.group, municipalRegistrations.group, contacts.group);

  const currentCertificate = el('div', 'client-wizard-summary');
  const certificateStatus = el('strong');
  const certificateCaption = el('small');
  currentCertificate.append(icon('shield-lock'), certificateStatus, certificateCaption);
  const certificateFile = input('certificate-file', { type: 'file' });
  certificateFile.accept = '.pfx,.p12,application/x-pkcs12';
  const certFileField = field('Arquivo do certificado A1', certificateFile);
  const certificatePassword = input('certificate-password', { type: 'password', length: 256 });
  certificatePassword.autocomplete = 'new-password';
  const certPasswordField = field('Senha do certificado', certificatePassword);
  certPasswordField.hidden = true;
  const certificateGrid = el('div', 'client-wizard-fields');
  certificateGrid.append(certFileField, certPasswordField);
  const certificateCheck = button('', { glyph: 'shield-check' });
  const certificateCheckLabel = el('span', '', 'Verificar certificado');
  certificateCheck.append(certificateCheckLabel);
  const clearCert = button('Limpar arquivo');
  const removeCert = button('Remover certificado');
  const certificateActions = el('div', 'client-wizard-certificate-actions');
  certificateActions.append(certificateCheck, clearCert, removeCert);
  const certificateFeedback = el('p', 'client-wizard-certificate-feedback');
  certificateFeedback.setAttribute('role', 'status');
  const certificateFeedbackIcon = icon('info-circle');
  const certificateFeedbackMessage = el('span');
  certificateFeedback.append(certificateFeedbackIcon, certificateFeedbackMessage);
  const certificateBox = el('div', 'client-wizard-certificate');
  certificateBox.append(currentCertificate, certificateGrid, certificateActions, certificateFeedback);
  const configNotice = el('p', 'client-wizard-note', 'O armazenamento de certificados aguarda configuração da Tecnologia.');
  configNotice.hidden = true;
  panels[1].append(el('p', 'client-wizard-description', 'Se tiver um certificado A1, anexe o arquivo .pfx ou .p12 de até 512 KB e verifique a senha.'),
    certificateBox, configNotice);

  const moduleHeader = el('div', 'client-wizard-module-header');
  const moduleCount = el('p', 'client-wizard-module-count');
  moduleCount.setAttribute('role', 'status');
  moduleHeader.append(el('p', 'client-wizard-description', 'Escolha quais áreas o cliente poderá abrir no próprio portal.'), moduleCount);
  const availableModules = el('div', 'client-wizard-module-list');
  const moduleInputs = modules.map(({ id, label, icon: glyph, description }) => {
    const control = input('module', { type: 'checkbox', value: id });
    const option = el('label', 'client-wizard-module');
    const text = el('span', 'client-wizard-module-text');
    const moduleName = el('strong', '', label);
    moduleName.id = 'clientWizardModule' + ++fieldCount;
    control.setAttribute('aria-labelledby', moduleName.id);
    text.append(moduleName);
    if (description) {
      const details = el('span', '', description);
      details.id = moduleName.id + 'Details';
      control.setAttribute('aria-describedby', details.id);
      text.append(details);
    }
    option.append(icon(glyph || 'grid'), text, control);
    availableModules.append(option);
    return control;
  });
  function updateModuleCount() {
    const active = moduleInputs.filter(module => module.checked).length;
    moduleCount.textContent = active === 1 ? '1 módulo liberado' : active + ' módulos liberados';
  }
  availableModules.addEventListener('change', updateModuleCount);
  panels[2].append(moduleHeader, availableModules);

  const consumer = schedulePanel(2);
  const invoice = schedulePanel(0);
  const serviceInvoice = schedulePanel(1);
  panels[3].append(el('p', 'client-wizard-description', 'Defina o período previsto para consultar notas fiscais.'), ...invoice.elements, el('h3', '', 'Captura de NFC-e'), ...consumer.elements);
  panels[4].append(el('p', 'client-wizard-description', 'Defina o período previsto para consultar notas fiscais de serviço (NFS-e).'), ...serviceInvoice.elements);

  const login = input('client-login');
  login.readOnly = true;
  const loginField = field('Login do cliente', login);
  const accessNote = el('p', 'client-wizard-note');
  panels[5].append(loginField, accessNote);

  let step = 0;
  let furthest = 0;
  let client;
  let removedCertificate = false;
  let certificateConfigured;
  let certificateController;
  let certificateVerification;
  let saving = false;
  let accessMode = false;
  let accessVersion = 0;
  let opener;
  const selectedType = () => person.control.checked ? 'pf' : 'pj';
  const currentDocument = () => documentValue(selectedType(), documentInput.value);
  const stepAction = () => step < steps.length - 1 ? 'Continuar' : client ? 'Salvar alterações' : 'Salvar cliente';
  const isCurrent = version => dialog.open && version === accessVersion;

  function showError(message = '') {
    refs.error.hidden = !message;
    refs.error.textContent = message;
  }

  function updateType({ clearDocument = false } = {}) {
    const pf = selectedType() === 'pf';
    if (clearDocument) documentInput.value = '';
    documentField.firstChild.textContent = pf ? 'CPF *' : 'CNPJ da empresa *';
    documentInput.placeholder = pf ? '000.000.000-00' : '00.000.000/0000-00';
    documentInput.inputMode = pf ? 'numeric' : 'text';
    documentInput.autocapitalize = pf ? 'off' : 'characters';
    documentInput.maxLength = pf ? 14 : 18;
    replaceValue(documentInput, clientDocumentLabel(selectedType(), documentInput.value));
    tradeField.hidden = taxField.hidden = cnaeField.hidden = pf;
    legalField.firstChild.textContent = pf ? 'Nome completo *' : 'Razão social';
    legalName.placeholder = pf ? 'Nome completo' : 'Razão social';
    legalName.required = pf;
    const fiscalEligible = !pf && !/[A-Z]/.test(currentDocument());
    invoice.updateEligibility(fiscalEligible);
    consumer.updateEligibility(fiscalEligible);
    serviceInvoice.updateEligibility(fiscalEligible);
  }

  function updateCertificate() {
    const existing = client?.certificate;
    const file = certificateFile.files[0];
    const expiry = formatTime(existing?.expiresAt);
    const expired = existing?.expiresAt && Date.parse(existing.expiresAt) <= Date.now();
    const kept = existing && !removedCertificate && !file;
    certificateFile.disabled = certificateConfigured === false;
    configNotice.hidden = certificateConfigured !== false;
    currentCertificate.dataset.warning = String(Boolean(kept && expired));
    certificateStatus.textContent = file ? file.name : kept ? existing.fileName : 'Nenhum certificado anexado';
    certificateCaption.textContent = file ? 'O certificado será guardado ao salvar o cliente.' : kept && expiry
      ? (expired ? 'Vencido em ' : 'Válido até ') + expiry : removedCertificate ? 'A remoção será aplicada ao salvar.' : '';
    certPasswordField.hidden = !file;
    certificatePassword.required = Boolean(file);
    if (!file) certificatePassword.value = '';
    removeCert.hidden = !existing || Boolean(file);
    removeCert.textContent = removedCertificate ? 'Desfazer remoção' : 'Remover certificado';
    certificateCheck.hidden = clearCert.hidden = !file;
    certificateCheck.disabled = !certificatePassword.value || Boolean(certificateController) || hasVerifiedCertificate();
    certificateCheckLabel.textContent = certificateController ? 'Verificando…' : 'Verificar certificado';
    const state = certificateVerification?.state || '';
    certificateFeedback.hidden = !state;
    certificateFeedback.dataset.state = state;
    const feedbackIcon = state === 'checking' ? 'hourglass-split' : state === 'valid' ? 'check-circle' : 'exclamation-circle';
    certificateFeedbackIcon.className = 'bi bi-' + feedbackIcon;
    certificateFeedbackMessage.textContent = certificateVerification?.message || '';
  }

  function resetCertificateVerification() {
    certificateController?.abort();
    certificateController = undefined;
    certificateVerification = undefined;
  }

  function hasVerifiedCertificate() {
    return certificateVerification?.state === 'valid' && Date.parse(certificateVerification.expiresAt) > Date.now();
  }

  function showStep(index, focus = true) {
    step = index;
    for (const [order, panel] of panels.entries()) {
      panel.hidden = order !== step;
      indicators[order].disabled = saving || order > furthest;
      if (order === step) indicators[order].setAttribute('aria-current', 'step');
      else indicators[order].removeAttribute('aria-current');
      indicators[order].dataset.complete = String(order < furthest);
    }
    refs.subtitle.textContent = 'Etapa ' + (step + 1) + ' de ' + steps.length;
    refs.back.hidden = step === 0;
    refs.next.textContent = stepAction();
    login.value = currentDocument();
    accessNote.textContent = client
      ? 'A situação da senha e a geração de um novo código ficam em “Dados de acesso” na ficha do cliente.'
      : 'O código de ativação é gerado ao salvar. Ele é exibido uma vez e deve ser entregue ao cliente para que defina a própria senha.';
    showError();
    refs.scroll.scrollTop = 0;
    if (focus) panels[step].querySelector('h3').focus({ preventScroll: true });
  }

  function prepareDialog(isAccess) {
    opener = document.activeElement;
    accessVersion++;
    accessMode = isAccess;
    accessGuard = false;
    refs.nav.hidden = refs.panels.hidden = isAccess;
    dialog.classList.toggle('client-wizard-access', isAccess);
    refs.accessPanel.hidden = !isAccess;
    refs.cancel.hidden = refs.next.hidden = refs.back.hidden = isAccess;
    refs.done.hidden = !isAccess;
    form.setAttribute('aria-busy', 'false');
    showError();
  }

  function open(record) {
    if (dialog.open) return;
    client = record;
    prepareDialog(false);
    form.reset();
    step = furthest = 0;
    removedCertificate = false;
    certificateConfigured = undefined;
    resetCertificateVerification();
    company.control.checked = record?.type !== 'pf';
    person.control.checked = record?.type === 'pf';
    company.control.disabled = person.control.disabled = Boolean(record);
    documentInput.value = record?.document || record?.cnpj || '';
    documentInput.readOnly = Boolean(record);
    code.value = record?.code || '';
    nickname.value = record?.nickname || record?.name || '';
    tradeName.value = record?.tradeName || '';
    legalName.value = record?.legalName || (record?.profileComplete === false ? record.name : '') || '';
    state.value = record?.state || '';
    taxRegime.value = record?.taxRegime || '';
    cnae.value = cnaeLabel(record?.cnae);
    status.value = String(record?.active !== false);
    statusField.hidden = !record;
    stateRegistrations.set(record?.stateRegistrations);
    municipalRegistrations.set(record?.municipalRegistrations);
    contacts.set(record?.contacts);
    consumer.set(record?.consumerSchedule || undefined);
    invoice.set(record?.invoiceSchedule || undefined);
    serviceInvoice.set(record?.serviceInvoiceSchedule || undefined);
    for (const module of moduleInputs) module.checked = Boolean(record?.modules?.includes(module.value));
    updateModuleCount();
    updateType();
    updateCertificate();
    title.textContent = record ? 'Editar cliente' : 'Adicionar Cliente';
    showStep(0, false);
    dialog.showModal();
    panels[0].querySelector('h3').focus({ preventScroll: true });
    const version = accessVersion;
    void request('/clients/config').then(result => {
      if (!isCurrent(version) || accessMode) return;
      certificateConfigured = result.certificateUploadConfigured;
      if (certificateConfigured === false) {
        certificateFile.value = '';
        resetCertificateVerification();
      }
      updateCertificate();
    }).catch(error => { if (isCurrent(version) && error.status === 401) onError?.(error); });
  }

  function validateIdentity() {
    const type = selectedType();
    if (!validDocument(type, currentDocument())) {
      return showControlError(documentInput, type === 'pf' ? 'Informe um CPF válido.' : 'Informe um CNPJ válido.');
    }
    if (!nickname.value.trim()) return showControlError(nickname, 'Informe o apelido.');
    if (type === 'pf' && !legalName.value.trim()) return showControlError(legalName, 'Informe o nome completo.');
    if (!state.reportValidity()) return false;
    if (!cnaeField.hidden && cnae.value && digits(cnae.value).length !== 7) {
      return showControlError(cnae, 'Digite os 7 dígitos do CNAE.');
    }
    for (const collection of [stateRegistrations, municipalRegistrations]) {
      for (const row of collection.rows) {
        const [number] = row.controls;
        if (!number.value.trim()) return showControlError(number, 'Informe o número da inscrição ou remova esta linha.');
      }
    }
    if (!contacts.rows.length) {
      showError('Adicione pelo menos um contato para continuar.');
      contacts.add.focus();
      return false;
    }
    for (const row of contacts.rows) {
      const [name, , address, phone] = row.controls;
      if (!name.value.trim()) return showControlError(name, 'Informe o nome do contato.');
      if (!address.value && !phone.value.trim()) return showControlError(address, 'Informe o e-mail ou o telefone do contato.');
      if (!address.reportValidity()) return false;
      if (phone.value.trim() && !/^\+?[\d().\s-]+$/.test(phone.value.trim())) {
        return showControlError(phone, 'Informe um número de telefone válido.');
      }
      if (phone.value.trim() && !/^\d{8,15}$/.test(digits(phone.value))) {
        return showControlError(phone, 'O telefone deve conter de 8 a 15 dígitos.');
      }
    }
    return true;
  }

  function validateCertificateInput() {
    const file = certificateFile.files[0];
    if (!file) return true;
    if (!/\.(?:pfx|p12)$/i.test(file.name) || !file.size || file.size > maxCertificateBytes) {
      return showControlError(certificateFile, 'Escolha um arquivo .pfx ou .p12 válido de até 512 KB.');
    }
    return certificatePassword.reportValidity();
  }

  function validateCertificate() {
    if (!certificateFile.files[0]) return true;
    if (!validateCertificateInput()) return false;
    if (hasVerifiedCertificate()) return true;
    if (certificateController) {
      showError('Aguarde a verificação do certificado.');
    } else {
      if (certificateVerification?.state !== 'error') {
        certificateVerification = { state: 'error', message: 'Verifique o certificado antes de continuar.' };
      }
      updateCertificate();
      certificateCheck.focus();
    }
    return false;
  }

  async function verifyCertificate() {
    const file = certificateFile.files[0];
    if (!file || certificateController || !validateCertificateInput()) return;
    const version = accessVersion;
    const controller = new AbortController();
    const stillCurrent = () => isCurrent(version) && certificateController === controller;
    certificateController = controller;
    certificateVerification = { state: 'checking', message: 'Abrindo o certificado com a senha informada…' };
    showError();
    updateCertificate();
    try {
      const password = certificatePassword.value;
      const data = await readCertificate(file);
      if (!stillCurrent()) return;
      const { certificate } = await request('/clients/certificate/verify', {
        method: 'POST', signal: controller.signal, body: { fileName: file.name, data, password },
      });
      if (!stillCurrent()) return;
      const expiry = formatTime(certificate?.expiresAt);
      if (!expiry || Date.parse(certificate.expiresAt) <= Date.now()) throw new Error('Não foi possível confirmar a validade do certificado.');
      certificateVerification = { state: 'valid', expiresAt: certificate.expiresAt,
        message: 'Senha confirmada. Certificado válido até ' + expiry + '.' };
    } catch (error) {
      if (!stillCurrent()) return;
      if (error.status === 401 && onError) { onError(error); return; }
      certificateVerification = { state: 'error', message: error.message || 'Não foi possível verificar o certificado.' };
    } finally {
      if (stillCurrent()) {
        certificateController = undefined;
        if (step === 1) showError();
        updateCertificate();
      }
    }
  }

  function validateStep(index) {
    showError();
    return [validateIdentity, validateCertificate, () => true, () => invoice.validate() && consumer.validate(), serviceInvoice.validate, () => true][index]();
  }

  async function requestBody() {
    const type = selectedType();
    const body = {
      type, document: currentDocument(), code: code.value.trim(), nickname: nickname.value.trim(),
      tradeName: type === 'pj' ? tradeName.value.trim() : '', legalName: legalName.value.trim(),
      state: state.value, taxRegime: type === 'pj' ? taxRegime.value : '', cnae: type === 'pj' ? digits(cnae.value) : '',
      stateRegistrations: stateRegistrations.values(), municipalRegistrations: municipalRegistrations.values(),
      contacts: contacts.values(), modules: moduleInputs.filter(module => module.checked).map(module => module.value),
      consumerSchedule: consumer.value(), invoiceSchedule: invoice.value(), serviceInvoiceSchedule: serviceInvoice.value(), active: status.value === 'true',
    };
    const file = certificateFile.files[0];
    if (file) {
      const password = certificatePassword.value;
      body.certificate = { fileName: file.name, data: await readCertificate(file), password };
    } else if (removedCertificate) body.certificate = null;
    return body;
  }

  function setBusy(busy) {
    saving = busy;
    form.setAttribute('aria-busy', String(busy));
    refs.scroll.inert = refs.nav.inert = busy;
    for (const control of [refs.back, refs.cancel, refs.close, refs.next, refs.done]) control.disabled = busy;
    if (!accessMode) refs.next.textContent = busy ? 'Salvando…' : stepAction();
  }

  function presentAccessHeading(subtitle) {
    title.textContent = 'Dados de acesso';
    refs.subtitle.textContent = subtitle || client?.nickname || client?.name || '';
    refs.scroll.scrollTop = 0;
    refs.accessPanel.replaceChildren();
  }

  function addAccessCode(activationCode, access, record) {
    const code = input('activation-code', { value: activationCode, length: activationCode.length });
    code.readOnly = true;
    const copy = button('Copiar código', { glyph: 'clipboard' });
    const feedback = el('p', 'client-wizard-note');
    feedback.setAttribute('role', 'status');
    const copyRow = el('div', 'client-wizard-code-copy');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.value);
        feedback.textContent = 'Código copiado.';
      } catch {
        code.focus();
        code.select();
        feedback.textContent = 'Copie o código selecionado.';
      }
    });
    const loginLink = el('a', 'button button-quiet', 'Abrir portal do cliente');
    loginLink.href = '/cliente';
    loginLink.target = '_blank';
    loginLink.rel = 'noopener';
    const expires = formatTime(access?.activationExpiresAt);
    const caption = 'Entregue o login e o código ao cliente para que ele defina a própria senha.' + (expires ? ' Válido até ' + expires + '.' : '');
    const loginDetails = el('dl', 'client-wizard-record');
    appendDetails(loginDetails, [['Login', access?.username || record.document || record.cnpj]]);
    copyRow.append(field('Código de ativação', code), copy);
    refs.accessPanel.append(el('p', 'client-wizard-description', caption), loginDetails, copyRow, loginLink, feedback);
  }

  let accessGuard = false;
  function renderAccess(access, { activationCode, created = false } = {}) {
    const state = access?.status || 'unconfigured';
    const statusLabel = accessStatuses[state] || accessStatuses.unconfigured;
    presentAccessHeading(created ? 'Cliente cadastrado' : '');
    const heading = el('h3', '', statusLabel);
    heading.tabIndex = -1;
    refs.accessPanel.append(heading);
    if (activationCode) addAccessCode(activationCode, access, client);
    else {
      const details = el('dl', 'client-wizard-record');
      appendDetails(details, [
        ['Login', access?.username || client.document || client.cnpj],
        ['Código válido até', state === 'activation_pending' && formatTime(access?.activationExpiresAt)],
        ['Senha definida em', formatTime(access?.passwordChangedAt)],
        ['Último acesso', formatTime(access?.lastLoginAt)],
      ]);
      refs.accessPanel.append(details);
      const controls = el('div', 'client-wizard-access-controls');
      const message = el('p', 'client-wizard-confirmation');
      message.hidden = true;
      const reset = button(state === 'unconfigured' ? 'Gerar código de ativação' : 'Gerar novo código', { primary: true, glyph: 'key' });
      const revoke = button('Revogar acesso');
      revoke.hidden = state === 'unconfigured' || state === 'revoked';
      const cancelAction = button('Cancelar ação');
      cancelAction.hidden = true;
      const ask = (action, prompt) => {
        accessGuard = action;
        message.textContent = prompt;
        message.hidden = false;
        cancelAction.hidden = false;
        reset.textContent = action === 'reset' ? 'Confirmar novo código' : 'Gerar novo código';
        revoke.textContent = action === 'revoke' ? 'Confirmar revogação' : 'Revogar acesso';
      };
      reset.addEventListener('click', () => {
        if (['unconfigured', 'revoked', 'activation_expired'].includes(state) || accessGuard === 'reset') void updateAccess('reset');
        else ask('reset', 'Gerar um novo código encerra as sessões do cliente e exige que ele defina outra senha.');
      });
      revoke.addEventListener('click', () => {
        if (accessGuard === 'revoke') void updateAccess('revoke');
        else ask('revoke', 'Revogar o acesso encerra as sessões e impede o cliente de entrar no portal.');
      });
      cancelAction.addEventListener('click', () => {
        accessGuard = false;
        renderAccess(access);
      });
      controls.append(reset, revoke, cancelAction);
      refs.accessPanel.append(controls, message);
    }
    heading.focus({ preventScroll: true });
  }

  function receiveError(error) {
    if (error.status === 401 && onError) { onError(error); return; }
    showError(error.message || 'Não foi possível concluir a operação. Tente novamente.');
  }

  async function updateAccess(action) {
    if (saving) return;
    showError();
    const reset = action === 'reset';
    const path = clientPath(client) + '/access' + (reset ? '/reset' : '');
    const version = accessVersion;
    setBusy(true);
    try {
      const response = await request(path, { method: reset ? 'POST' : 'DELETE', ...(reset ? { body: {} } : {}) });
      if (!isCurrent(version)) return;
      accessGuard = false;
      setBusy(false);
      renderAccess(response.access || { status: reset ? 'activation_pending' : 'revoked' }, response);
    } catch (error) { if (isCurrent(version)) receiveError(error); }
    finally { if (isCurrent(version)) setBusy(false); }
  }

  async function openAccess(record) {
    if (!record || dialog.open) return;
    client = record;
    prepareDialog(true);
    const version = accessVersion;
    presentAccessHeading();
    const loading = el('p', 'client-wizard-note', 'Consultando dados de acesso…');
    loading.setAttribute('role', 'status');
    refs.accessPanel.append(loading);
    dialog.showModal();
    refs.done.focus({ preventScroll: true });
    try {
      const { access } = await request(clientPath(record) + '/access');
      if (isCurrent(version)) renderAccess(access);
    } catch (error) {
      if (!isCurrent(version)) return;
      loading.textContent = 'Não foi possível carregar a situação do acesso.';
      receiveError(error);
    }
  }

  async function save() {
    const mode = client ? 'edit' : 'create';
    const path = client ? clientPath(client) : '/clients';
    const version = accessVersion;
    setBusy(true);
    let response;
    try {
      const body = await requestBody();
      if (!isCurrent(version)) return;
      response = await request(path, { method: mode === 'edit' ? 'PATCH' : 'POST', body });
    } catch (error) {
      if (!isCurrent(version)) return;
      setBusy(false);
      if (/CERTIFICATE|CERTIFICADO/i.test(error.code || '')) {
        resetCertificateVerification();
        updateCertificate();
        showStep(1);
      }
      if (/DOCUMENT|DUPLICATE|CLIENT_EXISTS/i.test(error.code || '')) showStep(0);
      receiveError(error);
      return;
    }
    if (!isCurrent(version)) return;
    setBusy(false);
    client = response.client;
    resetCertificateVerification();
    certificatePassword.value = certificateFile.value = '';
    if (response.activationCode) {
      const previousFocus = opener;
      prepareDialog(true);
      opener = previousFocus;
      renderAccess(response.access, { activationCode: response.activationCode, created: mode === 'create' });
    } else dialog.close();
    try { await onSaved?.(response.client, { mode }); }
    catch (error) { if (error.status === 401) onError?.(error); }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (accessMode || saving || !validateStep(step)) return;
    if (step + 1 < steps.length) {
      furthest = Math.max(furthest, step + 1);
      showStep(step + 1);
    } else {
      if (certificateFile.files[0] && !hasVerifiedCertificate()) {
        showStep(1);
        validateCertificate();
        return;
      }
      void save();
    }
  });
  refs.back.addEventListener('click', () => showStep(step - 1));
  function clearDialog() {
    accessVersion++;
    setBusy(false);
    resetCertificateVerification();
    form.reset();
    refs.accessPanel.replaceChildren();
    stateRegistrations.set([]);
    municipalRegistrations.set([]);
    contacts.set([]);
    certificateStatus.textContent = certificateCaption.textContent = '';
    refs.subtitle.textContent = '';
    client = null;
    certificatePassword.value = certificateFile.value = '';
    showError();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  function close() {
    if (dialog.open) dialog.close();
    clearDialog();
  }
  for (const control of [refs.close, refs.cancel, refs.done]) control.addEventListener('click', () => { if (!saving) close(); });
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    if (!saving) close();
  });
  company.control.addEventListener('change', () => updateType({ clearDocument: true }));
  person.control.addEventListener('change', () => updateType({ clearDocument: true }));
  documentInput.addEventListener('input', () => updateType());
  cnae.addEventListener('input', () => replaceValue(cnae, cnaeLabel(cnae.value)));
  certificateFile.addEventListener('change', () => {
    if (certificateFile.files[0]) removedCertificate = false;
    certificatePassword.value = '';
    resetCertificateVerification();
    showError();
    updateCertificate();
  });
  certificatePassword.addEventListener('input', () => {
    resetCertificateVerification();
    showError();
    updateCertificate();
  });
  certificateCheck.addEventListener('click', () => { void verifyCertificate(); });
  clearCert.addEventListener('click', () => {
    certificateFile.value = '';
    resetCertificateVerification();
    showError();
    updateCertificate();
    certificateFile.focus();
  });
  removeCert.addEventListener('click', () => {
    certificateFile.value = '';
    removedCertificate = !removedCertificate;
    resetCertificateVerification();
    showError();
    updateCertificate();
  });
  return { open, openAccess, close };
}
