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
const taxRegimes = {
  'simples-nacional': 'Simples Nacional', mei: 'MEI', 'lucro-presumido': 'Lucro Presumido', 'lucro-real': 'Lucro Real',
  'lucro-arbitrado': 'Lucro Arbitrado', 'imune-isenta': 'Imune ou isenta', outro: 'Outro',
};
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
    login: ['Entrar no portal', 'Use o CPF ou CNPJ do cadastro e sua senha ou código de primeiro acesso.'],
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
  const fields = [['Apelido', data.nickname], [data.type === 'pf' ? 'Nome completo' : 'Razão social', data.legalName],
    [data.type === 'pf' ? 'CPF' : 'CNPJ', data.document], ['Estado', data.state]];
  if (data.type === 'pj') fields.splice(2, 0, ['Nome fantasia', data.tradeName]);
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
  if (data.page > 1 || data.hasMore) {
    const pagination = element('div', '', 'client-portal-pagination');
    const previous = element('button', 'Anterior', 'button button-quiet');
    previous.type = 'button';
    previous.disabled = data.page === 1;
    previous.addEventListener('click', () => { void openModule(module, data.page - 1, true); });
    const next = element('button', 'Próxima', 'button button-quiet');
    next.type = 'button';
    next.disabled = !data.hasMore;
    next.addEventListener('click', () => { void openModule(module, data.page + 1, true); });
    pagination.append(previous, element('span', 'Página ' + data.page), next);
    block.append(pagination);
  }
  return [collection, block];
}

function renderModule(module, data) {
  if (module.id === 'cadastro') return organization(data);
  if (module.id === 'societario') return registrations(data);
  if (module.id === 'contabil') {
    const cnae = data.cnae?.replace(/^(\d{2})(\d{2})(\d)(\d{2})$/, '$1.$2-$3/$4');
    return [moduleGroup('Enquadramento', fieldRows([['Regime tributário', taxRegimes[data.taxRegime]], ['CNAE principal', cnae]]))];
  }
  return noteList(data, module);
}

async function openModule(module, page, focus) {
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
    feedback('clientModuleStatus', '');
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
