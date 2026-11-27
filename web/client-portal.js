import { CLIENT_REGIMES } from './client-registration.js';

const $ = id => document.getElementById(id);
const login = $('clientLogin');
const change = $('clientChange');
const username = $('clientUsername');
const current = $('clientCurrentPassword');
const password = $('clientNewPassword');
const confirmation = $('clientConfirmPassword');
const logout = $('clientLogout');
const accountLogout = $('clientAccountLogout');
const documentDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const noteStatuses = { active: 'Ativa', cancelled: 'Cancelada', substituted: 'Substituída', unknown: 'Sem informação' };
let session;
let view;
let moduleVersion = 0;

async function request(path, body) {
  const response = await fetch(`/v1/client/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session?.csrfToken ? { 'x-csrf-token': session.csrfToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(data?.message || 'Não foi possível concluir a solicitação. Tente novamente.');
    error.status = response.status;
    error.code = data?.error;
    throw error;
  }
  return data;
}

function feedback(id, value) {
  const target = $(id);
  target.textContent = value;
  target.hidden = !value;
}

function show(nextView, { focus = true, notice = '', error = '' } = {}) {
  view = nextView;
  moduleVersion++;
  const isChanging = view === 'activate' || view === 'change';
  const isActive = view === 'account';
  const copy = {
    loading: ['Portal do Cliente', 'Verificando seu acesso…'],
    retry: ['Portal do Cliente', ''],
    login: ['Entrar no portal', 'Use o CNPJ, CPF ou CAEPF do cadastro e sua senha ou código de primeiro acesso.'],
    activate: ['Definir sua primeira senha', 'Crie uma senha pessoal para acessar o portal.'],
    change: ['Alterar senha', 'Confirme sua senha atual e escolha uma nova senha.'],
    account: ['Seu acesso está ativo', 'Você está no Portal do Cliente Maximum.'],
  };
  const [title, description] = copy[view];
  $('clientAuthLayout').hidden = isActive;
  $('clientAccount').hidden = !isActive;
  $('clientSkip').href = isActive ? '#clientWorkspace' : '#clientContent';
  $('clientTitle').textContent = title;
  $('clientDescription').textContent = description;
  $('clientDescription').hidden = !description;
  login.hidden = view !== 'login';
  change.hidden = !isChanging;
  $('clientRetry').hidden = view !== 'retry';
  $('clientActions').hidden = !isChanging;
  $('clientBackToAccount').hidden = view !== 'change';
  $('clientCurrentField').hidden = view !== 'change';
  current.required = view === 'change';
  $('clientName').textContent = isActive ? session.client.name : '';
  $('clientModuleLinks').replaceChildren();
  $('clientModuleData').replaceChildren();
  feedback('clientNotice', notice);
  feedback('clientError', error);
  feedback('clientAccountError', isActive ? error : '');
  if (isActive) {
    renderModuleLinks();
    showAccountRoute(focus);
    return;
  }
  if (focus) $('clientTitle').focus();
}

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function glyph(name) {
  const node = element('i', '', 'bi bi-' + name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function renderModuleLinks() {
  const modules = session.modules ?? [];
  $('clientNoModules').hidden = modules.length > 0;
  $('clientModuleLinks').replaceChildren(...modules.map(({ id, label, icon, description }) => {
    const link = element('a', '', 'client-module-link');
    link.href = '#modulo-' + id;
    const copy = element('div', '', 'client-module-link-copy');
    copy.append(element('strong', label), element('span', description));
    link.append(glyph(icon), copy, glyph('chevron-right'));
    return link;
  }));
}

function fieldRows(rows) {
  const details = element('dl', '', 'client-module-fields');
  for (const [title, value] of rows) {
    const field = element('div');
    field.append(element('dt', title), element('dd', value || 'Não informado'));
    details.append(field);
  }
  return details;
}

function moduleGroup(title, ...content) {
  const group = element('div', '', 'client-module-group');
  group.append(element('h2', title), ...content);
  return group;
}

const empty = text => element('p', text, 'client-portal-empty');

function organization(data) {
  const fields = [
    ['ID da empresa', data.code || '999'], [data.type === 'pf' ? 'Nome completo' : 'Razão social', data.legalName],
    [{ pj: 'CNPJ', pf: 'CPF', caepf: 'CAEPF' }[data.type], data.document], ['Apelido e-Contínuo', data.nickname],
    ['Grupo de empresas', data.groupName],
  ];
  if (data.type !== 'pf') fields.push(['Nome fantasia', data.tradeName]);
  const address = [data.street, data.streetNumber, data.complement].filter(Boolean).join(', ');
  fields.push(['Endereço', address], ['Bairro', data.district], ['Cidade / UF', [data.city, data.state].filter(Boolean).join(' / ')],
    ['CEP', data.postalCode], ['Telefones', data.phones?.join(' · ')], ['Website', data.website]);
  const contacts = data.contacts.map(contact => fieldRows([
    ['Nome', contact.name], ['Cargo ou vínculo', contact.role], ['E-mail', contact.email], ['Telefone', contact.phone],
  ]));
  return [moduleGroup('Cadastro', fieldRows(fields)),
    moduleGroup('Contatos', ...(contacts.length ? contacts : [empty('Nenhum contato cadastrado.')]))];
}

function registrations(data) {
  const state = data.stateRegistrations.map(entry => fieldRows([['Número', entry.number], ['Estado', entry.state]]));
  const municipality = data.municipalRegistrations.map(entry => fieldRows([['Número', entry.number], ['Município', entry.municipality]]));
  return [
    moduleGroup('Registro empresarial', fieldRows([['NIRE', data.nire], ['Empresa isenta', data.registrationExempt === true ? 'Sim' : data.registrationExempt === false ? 'Não' : null]])),
    moduleGroup('Inscrições estaduais', ...(state.length ? state : [empty('Nenhuma inscrição estadual cadastrada.')])),
    moduleGroup('Inscrições municipais', ...(municipality.length ? municipality : [empty('Nenhuma inscrição municipal cadastrada.')])),
  ];
}

function amountLabel(cents) {
  if (!/^\d+$/.test(cents)) return null;
  const value = BigInt(cents);
  const fraction = String(value % 100n).padStart(2, '0');
  return currency.formatToParts(value / 100n).map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

function noteList(data, module) {
  const time = data.schedule.time ? ' a partir das ' + data.schedule.time : '';
  const schedule = !data.collectionAvailable ? 'Coleta automática indisponível para este cadastro.'
    : data.schedule.period === 'day' ? 'Período diurno' + time
      : data.schedule.period === 'night' ? 'Período noturno' + time : 'Coleta desativada';
  const collection = moduleGroup('Programação da coleta', element('p', schedule));
  const invoices = data.documents.map(note => {
    const row = element('li', '', 'client-portal-invoice');
    const heading = element('h3', note.number ? 'Nota ' + note.number : 'Nota sem número');
    const issuedAt = Date.parse(note.issuedAt);
    const date = Number.isFinite(issuedAt) ? documentDate.format(issuedAt) : null;
    const competence = note.competence ? note.competence.slice(5) + '/' + note.competence.slice(0, 4) : null;
    const direction = note.direction === 'issued' ? 'Emitida' : note.direction === 'received' ? 'Recebida' : null;
    row.append(heading, fieldRows([['Emissão', date], ['Competência', competence], ['Movimento', direction],
      ['Valor', amountLabel(note.amountCents)], ['Situação', noteStatuses[note.status]]]));
    return row;
  });
  const list = element('ul', '', 'client-portal-invoices');
  list.append(...invoices);
  const block = moduleGroup('Documentos coletados', invoices.length ? list : empty('Nenhum documento disponível nesta página.'));
  appendPagination(block, data, module);
  return [collection, block];
}

function appendPagination(block, data, module) {
  if (data.page <= 1 && !data.hasMore) return;
  const pagination = element('div', '', 'client-portal-pagination');
  for (const [label, target, disabled] of [['Anterior', data.page - 1, data.page === 1], ['Próxima', data.page + 1, !data.hasMore]]) {
    if (label === 'Próxima') pagination.append(element('span', 'Página ' + data.page));
    const button = element('button', label, 'button button-quiet');
    button.type = 'button';
    button.disabled = disabled;
    button.onclick = () => { void openModule(module, target, true); };
    pagination.append(button);
  }
  block.append(pagination);
}

const workspaceLabels = { aberto: 'Em aberto', pago: 'Pago', cancelado: 'Cancelado', disponivel: 'Disponível',
  recebido: 'Recebido', 'em-analise': 'Em análise', conferido: 'Conferido' };

function uploadForm(module) {
  const form = element('form', '', 'client-upload-form');
  function addField(label, input) {
    const field = element('label', label, 'field');
    field.append(input);
    form.append(field);
    return input;
  }
  const file = addField('Arquivo', element('input'));
  file.type = 'file'; file.required = true;
  file.accept = '.pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp';
  const help = element('small', 'PDF, Word (.docx), Excel (.xlsx), CSV, TXT ou imagem PNG, JPEG ou WebP. Até 2 MB por envio.');
  file.after(help);
  const title = addField('Título (opcional)', element('input'));
  title.maxLength = 160;
  const competence = addField('Competência (opcional)', element('input'));
  competence.type = 'month';
  const description = addField('Observações (opcional)', element('textarea'));
  description.maxLength = 2000; description.rows = 2;
  const send = element('button', 'Enviar documento', 'button button-primary');
  send.type = 'submit';
  const message = element('p'); message.setAttribute('role','status');
  form.append(send, message);
  form.onsubmit = async event => {
    event.preventDefault();
    if (send.disabled) return;
    const document = file.files[0];
    if (!document?.size || document.size > 2 * 1024 * 1024) {
      message.textContent = 'Escolha um arquivo de até 2 MB.'; return;
    }
    send.disabled = true;
    message.textContent = 'Enviando documento…';
    const version = moduleVersion;
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.readAsDataURL(document);
      });
      if (version !== moduleVersion) return;
      await request('modules/documentos', { title: title.value.trim() || document.name.slice(0,160),
        competence: competence.value, description: description.value, file: { name: document.name, base64 } });
      if (version !== moduleVersion) return;
      await openModule(module, 1, false, 'Documento enviado à Maximum.');
    } catch (error) {
      if (version !== moduleVersion) return;
      if (error.code === 'CLIENT_MODULE_FORBIDDEN') await refreshAfterPermissionChange(version, error.message);
      else if (error.status === 401) present(error);
      else message.textContent = error.message;
    } finally { send.disabled = false; }
  };
  return moduleGroup('Enviar documentação', form);
}

function workspaceList(module, data) {
  const isDocument = module.id === 'documentos';
  const list = element('ul', '', 'client-portal-invoices');
  for (const item of data.items) {
    const row = element('li', '', 'client-portal-invoice');
    const header = element('div', '', 'client-entry-heading');
    const badge = element('span', workspaceLabels[item.status] || item.status, 'client-entry-status');
    badge.dataset.status = item.status;
    header.append(element('h3', item.title), badge);
    row.append(header);
    if (item.description) row.append(element('p', item.description, 'client-entry-description'));
    const summary = [];
    if (item.competence) summary.push(['Competência', item.competence.slice(5) + '/' + item.competence.slice(0, 4)]);
    if (isDocument) {
      summary.push(['Enviado por', item.origin === 'cliente' ? 'Sua empresa' : 'Maximum'], ['Data de envio', documentDate.format(new Date(item.createdAt))]);
    } else {
      summary.push(['Vencimento', item.dueDate?.split('-').reverse().join('/')], ['Valor', amountLabel(item.amountCents)]);
    }
    row.append(fieldRows(summary));
    if (item.filename) {
      const download = element('a', 'Baixar ' + item.filename, 'client-file-download');
      download.href = '/v1/client/modules/' + module.id + '/' + encodeURIComponent(item.id) + '/arquivo';
      download.download = item.filename;
      row.append(download);
    }
    list.append(row);
  }
  const titles = { guias: 'Guias disponíveis', financeiro: 'Lançamentos financeiros', documentos: 'Documentos da empresa' };
  const noItems = { guias:'Nenhuma guia disponível nesta página.', financeiro:'Nenhum lançamento disponível nesta página.',
    documentos:'Nenhum documento disponível nesta página.' };
  const block = moduleGroup(titles[module.id], data.items.length ? list : empty(noItems[module.id]));
  appendPagination(block, data, module);
  return isDocument ? [uploadForm(module), block] : [block];
}

function renderModule(module, data) {
  if (module.id === 'cadastro') return organization(data);
  if (module.id === 'societario') return registrations(data);
  if (module.id === 'contabil') {
    const cnae = data.cnae?.replace(/^(\d{2})(\d{2})(\d)(\d{2})$/, '$1.$2-$3/$4');
    return [moduleGroup('Enquadramento', fieldRows([['Regime tributário', CLIENT_REGIMES.get(data.taxRegime)], ['CNAE principal', cnae]]))];
  }
  if (['guias', 'financeiro', 'documentos'].includes(module.id)) return workspaceList(module, data);
  return noteList(data, module);
}

async function openModule(module, page, focus, notice = '') {
  const version = ++moduleVersion;
  $('clientOverview').hidden = true;
  $('clientModule').hidden = false;
  $('clientModuleTitle').textContent = module.label;
  $('clientModuleDescription').textContent = module.description;
  $('clientModuleData').replaceChildren();
  feedback('clientModuleStatus', 'Carregando…');
  feedback('clientAccountError', '');
  if (focus) $('clientModuleTitle').focus();
  try {
    const { data } = await request('modules/' + module.id + (page > 1 ? '?page=' + page : ''));
    if (version !== moduleVersion) return;
    $('clientModuleData').replaceChildren(...renderModule(module, data));
    feedback('clientModuleStatus', notice);
  } catch (error) {
    if (version !== moduleVersion) return;
    feedback('clientModuleStatus', '');
    if (error.code === 'CLIENT_MODULE_FORBIDDEN') {
      await refreshAfterPermissionChange(version, error.message);
      return;
    }
    present(error);
  }
}

async function refreshAfterPermissionChange(version, message) {
  try {
    const data = await request('session');
    if (version !== moduleVersion) return;
    window.history.replaceState(null, '', '#inicio');
    showSession(data);
    if (view === 'account') feedback('clientAccountError', message);
  } catch (error) {
    if (version === moduleVersion) present(error);
  }
}

function showAccountRoute(focus = false) {
  if (view !== 'account') return;
  const selected = window.location.hash.slice('#modulo-'.length);
  const module = window.location.hash.startsWith('#modulo-') && session.modules?.find(item => item.id === selected);
  if (module) {
    void openModule(module, 1, focus);
    return;
  }
  moduleVersion++;
  $('clientModule').hidden = true;
  $('clientModuleData').replaceChildren();
  $('clientOverview').hidden = false;
  if (focus) $('clientName').focus();
}

function showSession(data, focus = true) {
  session = data.client ? data : null;
  show(session ? (session.mustChangePassword ? 'activate' : 'account') : 'login', { focus });
}

async function restoreSession() {
  show('loading', { focus: false });
  try {
    showSession(await request('session'), false);
  } catch {
    show('retry', { error: 'Não foi possível verificar seu acesso.' });
  }
}

function present(error) {
  if (error.status === 401 && error.code === 'UNAUTHORIZED') {
    session = null;
    change.reset();
    show('login', { error: error.message });
  } else {
    feedback(view === 'account' ? 'clientAccountError' : 'clientError', error.message || 'Não foi possível concluir. Tente novamente.');
  }
}

function busy(form, value) {
  form.setAttribute('aria-busy', value ? 'true' : 'false');
  form.querySelector('button[type="submit"]').disabled = value;
  logout.disabled = value;
}

login.addEventListener('submit', async event => {
  event.preventDefault();
  feedback('clientError', '');
  feedback('clientNotice', '');
  busy(login, true);
  const field = $('clientPassword');
  try {
    const data = await request('login', { username: username.value, password: field.value });
    username.value = data.client.username;
    showSession(data);
  } catch (error) {
    present(error);
  } finally {
    field.value = '';
    busy(login, false);
  }
});

change.addEventListener('submit', async event => {
  event.preventDefault();
  feedback('clientError', '');
  if (password.value !== confirmation.value) {
    feedback('clientError', 'As duas senhas precisam ser iguais.');
    confirmation.focus();
    return;
  }
  busy(change, true);
  try {
    await request('change-password', {
      newPassword: password.value,
      ...(session.mustChangePassword ? {} : { currentPassword: current.value }),
    });
    username.value = session.client.username;
    session = null;
    change.reset();
    show('login', { notice: 'Senha definida. Entre com sua nova senha.' });
  } catch (error) {
    present(error);
  } finally {
    busy(change, false);
  }
});

$('clientEditPassword').addEventListener('click', () => {
  change.reset();
  show('change');
  current.focus();
});
$('clientBackToAccount').addEventListener('click', () => {
  change.reset();
  show('account');
});
$('clientSkip').addEventListener('click', event => {
  event.preventDefault();
  $(view === 'account' ? 'clientWorkspace' : 'clientContent').focus();
});
window.addEventListener('hashchange', () => showAccountRoute(true));
$('clientRetry').addEventListener('click', restoreSession);
async function leave() {
  logout.disabled = accountLogout.disabled = true;
  try {
    await request('logout', {});
    session = null;
    change.reset();
    window.history.replaceState(null, '', window.location.pathname);
    show('login');
  } catch (error) {
    present(error);
  } finally {
    logout.disabled = accountLogout.disabled = false;
  }
}
logout.addEventListener('click', leave);
accountLogout.addEventListener('click', leave);

restoreSession();
