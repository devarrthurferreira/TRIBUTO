import { destroyChat, initChat, openChat } from './chat.js';
import { mountPortal, setChatNotification } from './portal.js';
import { mountSectorNavigation } from './sectors.js';
import { mountUserWizard } from './user-wizard.js';

const API = '/v1/platform';
const DASHBOARD_PATH = '/home';
const SECTOR_PREFIX = '/setor/';
const $ = (id) => document.getElementById(id);

const modules = [
  { id: 'dp', label: 'Departamento Pessoal', icon: 'person-badge' },
  { id: 'rh', label: 'Recursos Humanos', icon: 'people' },
  { id: 'tecnologia', label: 'Tecnologia', icon: 'laptop' },
  { id: 'marketing', label: 'Marketing', icon: 'megaphone' },
  { id: 'societario', label: 'Societário', icon: 'buildings' },
  { id: 'contabil', label: 'Contábil', icon: 'calculator' },
  { id: 'fiscal', label: 'Fiscal', icon: 'receipt' },
  { id: 'diretoria', label: 'Diretoria', icon: 'briefcase' },
];
const legacyModules = [
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'gestao', label: 'Gestão' },
];
const allModules = [...modules, ...legacyModules];
const adminViews = new Set(['companies', 'users', 'agents']);
const viewLabels = {
  overview: 'Início', ...Object.fromEntries(allModules.map(({ id, label }) => [id, label])),
  companies: 'Empresas/Clientes', 'company-detail': 'Ficha fiscal da empresa', 'client-detail': 'Cadastro do cliente',
  club: 'Clube de Benefícios', users: 'Equipe e acessos', agents: 'Agentes de coleta',
};
const actionLabels = {
  workItemRead: 'Consultar atividades',
  workItemCreate: 'Criar atividades',
  workItemUpdate: 'Alterar atividades',
  fiscalDocumentsRead: 'Consultar documentos fiscais',
  sectorTalkRead: 'Consultar o Talk do setor',
  sectorTalkSend: 'Conversar no Talk do setor',
  whatsappRead: 'Consultar o WhatsApp do setor',
  whatsappReply: 'Responder no WhatsApp',
  whatsappTicketUpdate: 'Alterar chamados do WhatsApp',
};
const actionDependencies = {
  workItemCreate: 'workItemRead', workItemUpdate: 'workItemRead',
  sectorTalkSend: 'sectorTalkRead', whatsappReply: 'whatsappRead', whatsappTicketUpdate: 'whatsappRead',
};
const writeActions = new Set(['workItemCreate', 'workItemUpdate', 'whatsappReply', 'whatsappTicketUpdate']);
const taskStatusLabels = { open: 'Aberta', in_progress: 'Em andamento', done: 'Concluída' };
const state = { session: null, view: 'overview', companies: [], users: [], agents: [], selectedCompanyCnpj: null, nfsePage: 1, nfseHasMore: false, nfseRequest: 0 };

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = String(value);
  return element;
}
function appendEmpty(container, title, description, symbol = '◷') {
  container.replaceChildren();
  const empty = node('div', 'empty-panel');
  const icon = node('span', 'empty-graphic', symbol);
  icon.setAttribute('aria-hidden', 'true');
  empty.append(icon, node('strong', '', title), node('p', '', description));
  container.append(empty);
}
function displayError(error) {
  if (error?.status === 401) { showAuth(false); return; }
  notice(error?.message || 'Não foi possível concluir a operação.', 'error');
}
let noticeTimer;
function notice(message, type = 'success') {
  const box = $('notice');
  box.textContent = message;
  box.className = type === 'success' ? 'notice' : `notice ${type}`;
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { box.hidden = true; }, 6500);
}
function formError(id, message) {
  const element = $(id);
  element.textContent = message;
  element.hidden = !message;
}
function withBusy(button, busy, message = 'Aguarde...') {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = message;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}
async function request(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method) && state.session?.csrfToken) headers['X-CSRF-Token'] = state.session.csrfToken;
  let response;
  try {
    response = await fetch(`${API}${path}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error' });
  } catch {
    throw new Error('A plataforma não respondeu. Verifique sua conexão e tente novamente.');
  }
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.message || data.error || `Erro HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}
function isAdmin() { return state.session?.user?.role === 'admin'; }
function grantFor(module) {
  if (isAdmin()) return 'manage';
  return state.session?.permissions?.[module] || null;
}
function canView(module) { return !!grantFor(module); }
function canUse(module, action) {
  return state.session?.capabilities?.[module]?.[action] === true;
}
function firstName(name) { return String(name || 'equipe').trim().split(/\s+/)[0]; }
function initials(name) {
  return String(name || 'MC').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
}
function cnpjLabel(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 14 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(value || '—');
}
function dateLabel(value) {
  if (!value) return 'Sem prazo';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(date);
}
function moneyLabel(cents) {
  const value = Number(cents);
  return Number.isFinite(value) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100) : '—';
}
function currentCompetence() {
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${date.find((part) => part.type === 'year').value}-${date.find((part) => part.type === 'month').value}`;
}
function monthsBefore(month, count) {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 - count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) return String(month || '—');
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
}
function relativeTime(value) {
  if (!value) return 'Ainda não comunicou';
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta) || delta < 0) return dateLabel(value);
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return 'Há menos de um minuto';
  if (mins < 60) return `Há ${mins} min`;
  if (mins < 1440) return `Há ${Math.floor(mins / 60)} h`;
  return dateLabel(value);
}
function isRecent(value) { return !!value && Number.isFinite(new Date(value).getTime()) && Date.now() - new Date(value).getTime() < 5 * 60_000; }
function companyName(cnpj) { return state.companies.find((company) => company.cnpj === cnpj)?.name || cnpjLabel(cnpj); }

function viewFromLocation() {
  if (location.pathname.startsWith(SECTOR_PREFIX)) return location.pathname.slice(SECTOR_PREFIX.length);
  const fragment = location.hash.slice(1);
  return fragment && fragment !== 'conteudo' ? fragment : 'overview';
}

function viewUrl(view) {
  if (allModules.some(({ id }) => id === view)) return `${SECTOR_PREFIX}${view}`;
  return view === 'overview' ? DASHBOARD_PATH : `${DASHBOARD_PATH}#${view}`;
}

function setPortalContext(view) {
  const currentSector = allModules.find((module) => module.id === view);
  const assignedSectors = allModules.filter(({ id }) => Boolean(state.session?.user?.moduleGrants?.[id]));
  const profileSector = assignedSectors.length === 1 ? assignedSectors[0].label
    : isAdmin() ? 'Administração'
      : assignedSectors.length > 1 ? 'Multissetorial' : 'Central Maximum';
  const label = currentSector?.label || profileSector;
  $('portalSector').textContent = label;
  $('portalSector').title = label;
  $('appView').dataset.view = view;
}

function showAuth(setupRequired, message = '', preserveRoute = false) {
  destroyChat();
  setChatNotification();
  sectorNavigation.leave();
  sectorNavigation.setTalkUnread(0);
  state.session = null;
  state.selectedCompanyCnpj = null;
  state.selectedClientCnpj = null;
  if (location.pathname !== '/' || (!preserveRoute && location.hash)) {
    const fragment = preserveRoute && !location.pathname.startsWith(SECTOR_PREFIX) ? location.hash : '';
    history.replaceState(null, '', `/${fragment}`);
  }
  $('appView').hidden = true;
  $('authView').hidden = false;
  document.title = 'Central Maximum | Maximum Contábil';
  $('setupTokenRow').hidden = !setupRequired;
  $('setupNameRow').hidden = !setupRequired;
  $('confirmPasswordRow').hidden = !setupRequired;
  $('setupToken').required = setupRequired;
  $('setupName').required = setupRequired;
  $('confirmPassword').required = setupRequired;
  $('authEmailLabel').textContent = setupRequired ? 'E-mail' : 'Usuário ou e-mail';
  $('authEmail').type = setupRequired ? 'email' : 'text';
  $('authEmail').placeholder = setupRequired ? 'voce@maximumcontabil.com.br' : 'nome.sobrenome ou seu e-mail';
  $('authPassword').autocomplete = setupRequired ? 'new-password' : 'current-password';
  $('authPassword').minLength = setupRequired ? 10 : 0;
  $('authTitle').textContent = setupRequired ? 'Configure o primeiro acesso' : 'Entrar na Central Maximum';
  $('authDescription').textContent = setupRequired
    ? 'Crie a conta administradora usando o código definido na hospedagem.'
    : 'Use seu acesso da equipe para continuar.';
  $('authSubmit').textContent = setupRequired ? 'Criar acesso administrador' : 'Entrar';
  $('authForm').dataset.setup = String(setupRequired);
  formError('authError', message);
}
function applySession(session) {
  if (!session?.user) { showAuth(!!session?.setupRequired, '', true); return; }
  const view = viewFromLocation();
  const wantedPath = viewUrl(view).split('#')[0];
  if (location.pathname !== wantedPath) {
    location.replace(`${wantedPath}${wantedPath === DASHBOARD_PATH ? location.hash : ''}`);
    return;
  }
  state.session = session;
  $('authView').hidden = true;
  $('appView').hidden = false;
  $('profileName').textContent = session.user.name || session.user.email;
  $('profileRole').textContent = isAdmin() ? 'Administrador' : 'Equipe';
  $('profileInitials').textContent = initials(session.user.name);
  $('profileShortName').textContent = firstName(session.user.name);
  $('greetingName').textContent = firstName(session.user.name);
  $('todayLabel').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date());
  for (const button of document.querySelectorAll('.nav-link')) {
    const view = button.dataset.view;
    if (legacyModules.some((module) => module.id === view)) {
      button.hidden = !session.user.moduleGrants?.[view] || !canView(view);
    } else {
      button.hidden = modules.some((module) => module.id === view) ? !canView(view) : (adminViews.has(view) && !isAdmin());
    }
  }
  const canReadFiscalDocuments = canUse('fiscal', 'fiscalDocumentsRead');
  const canReadWorkItems = allModules.some(({ id }) => canUse(id, 'workItemRead'));
  $('moduleNavigationLabel').hidden = !modules.some(({ id }) => canView(id));
  $('newCompanyButton').hidden = !isAdmin();
  $('newUserButton').hidden = !isAdmin();
  $('portalUsers').hidden = !isAdmin();
  $('portalAgents').hidden = !isAdmin();
  $('railCompanies').hidden = !isAdmin();
  $('fiscalAllCompanies').hidden = !isAdmin();
  $('newAgentButton').hidden = !isAdmin();
  $('storageOverview').hidden = !isAdmin();
  $('homeAgentHealthCard').hidden = !isAdmin();
  $('dashboardAgentMetric').hidden = !isAdmin();
  $('dashboardFiscalMetric').hidden = !canReadFiscalDocuments;
  $('dashboardWorkMetric').hidden = !canReadWorkItems;
  $('homeAlerts').hidden = !canReadWorkItems;
  $('fiscalDocumentTools').hidden = !canReadFiscalDocuments;
  $('technologyOverview').hidden = !canUse('tecnologia', 'workItemRead');
  $('technologyRestricted').hidden = canUse('tecnologia', 'workItemRead');
  document.querySelector('[data-go="tecnologia"]').hidden = !canView('tecnologia');
  renderModuleCards();
  void initialLoad();
  const surface = navigate(view, { replace: true });
  if (surface) {
    initChat(session, { surface, notify: (notification) => {
      setChatNotification(notification);
      sectorNavigation.setTalkUnread(notification.unread);
    } });
    const url = new URL(location.href);
    if (state.view === 'overview' && url.searchParams.has('talk')) {
      url.searchParams.delete('talk');
      history.replaceState(null, '', url);
      openChat();
    }
  }
}
async function initialLoad() {
  const results = await Promise.allSettled([loadDashboard(), loadCompanies(), ...(isAdmin() ? [loadAgents(), loadStorage()] : [])]);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) displayError(failures[0].reason);
}
async function handleAuth(event) {
  event.preventDefault();
  const setup = $('authForm').dataset.setup === 'true';
  const identifier = $('authEmail').value.trim().toLowerCase();
  const password = $('authPassword').value;
  formError('authError', '');
  if (setup && password !== $('confirmPassword').value) return formError('authError', 'As senhas não coincidem.');
  const body = setup
    ? { setupToken: $('setupToken').value.trim(), name: $('setupName').value.trim(), email: identifier, password }
    : { identifier, password };
  withBusy($('authSubmit'), true);
  try {
    const session = await request(setup ? '/setup' : '/login', { method: 'POST', body });
    $('authForm').reset();
    applySession(session);
  } catch (error) {
    formError('authError', error.message);
  } finally {
    withBusy($('authSubmit'), false);
  }
}
async function logout() {
  try { await request('/logout', { method: 'POST', body: {} }); }
  catch (error) { if (error.status !== 401) { displayError(error); return; } }
  state.companies = [];
  state.users = [];
  state.agents = [];
  for (const section of document.querySelectorAll('.work-section')) section.remove();
  showAuth(false);
}

function navigate(view, { replace = false } = {}) {
  const companyRoute = /^company-(\d{14})$/.exec(view);
  const clientRoute = /^client-(\d{14})$/.exec(view);
  const detail = !!companyRoute && canUse('fiscal', 'fiscalDocumentsRead');
  const clientDetail = !!clientRoute && isAdmin();
  const valid = detail || clientDetail || view === 'overview' || view === 'club' || (adminViews.has(view) ? isAdmin() : allModules.some(({ id }) => id === view && canView(id)));
  const route = valid ? view : 'overview';
  const targetUrl = viewUrl(route);
  if (location.pathname !== targetUrl.split('#')[0]) {
    if (replace) location.replace(targetUrl);
    else location.assign(targetUrl);
    return false;
  }
  state.view = detail ? 'company-detail' : clientDetail ? 'client-detail' : route;
  document.title = state.view === 'overview'
    ? 'Central Maximum | Maximum Contábil'
    : `${viewLabels[state.view]} | Central Maximum`;
  if (detail) {
    if (state.selectedCompanyCnpj !== companyRoute[1]) {
      state.nfsePage = 1;
      $('nfseMonthFilter').value = '';
      $('nfseRoleFilter').value = '';
      $('nfseStatusFilter').value = '';
      $('nfseSummaryTo').value = currentCompetence();
      $('nfseSummaryFrom').value = monthsBefore(currentCompetence(), 5);
    }
    state.selectedCompanyCnpj = companyRoute[1];
    updateCompanyHeading();
  }
  state.selectedClientCnpj = clientDetail ? clientRoute[1] : null;
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `view-${state.view}`;
  const activeView = state.view === 'client-detail' || (state.view === 'company-detail' && isAdmin()) ? 'companies'
    : state.view === 'company-detail' ? 'fiscal' : state.view;
  for (const button of document.querySelectorAll('.nav-link')) {
    const current = button.dataset.view === activeView;
    button.classList.toggle('active', current);
    if (current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  setPortalContext(state.view);
  for (const [id, active] of [['railHome', state.view === 'overview'], ['railClub', state.view === 'club'], ['railCompanies', activeView === 'companies']]) {
    if (active) $(id).setAttribute('aria-current', 'page');
    else $(id).removeAttribute('aria-current');
  }
  if (`${location.pathname}${location.hash}` !== targetUrl) history.replaceState(null, '', targetUrl);
  closeMenu();
  const sector = allModules.find(({ id }) => id === state.view);
  const surface = sectorNavigation.activate(sector ? {
    id: sector.id, label: sector.label, session: state.session, admin: isAdmin(),
    content: $(`view-${sector.id}`), activities: canUse(sector.id, 'workItemRead'),
    fiscalDocuments: sector.id === 'fiscal' && canUse('fiscal', 'fiscalDocumentsRead'),
    talk: canUse(sector.id, 'sectorTalkRead'), whatsapp: canUse(sector.id, 'whatsappRead'),
  } : null, { home: state.view === 'overview' });
  $('conteudo').focus({ preventScroll: true });
  if (state.view === 'users') void loadUsers().catch(displayError);
  if (state.view === 'agents') void loadAgents().catch(displayError);
  if (state.view === 'companies') void loadCompanies().catch(displayError);
  if (state.view === 'client-detail') void loadClientDetail(state.selectedClientCnpj).catch(displayError);
  if (state.view === 'fiscal' && canUse('fiscal', 'fiscalDocumentsRead')) void loadFiscalDocuments().catch(displayError);
  if (state.view === 'company-detail') void loadCompanyDetail().catch(displayError);
  if (canUse(state.view, 'workItemRead')) void loadWorkItems(state.view).catch(displayError);
  return surface;
}
function openMenu() { $('sidebar').classList.add('open'); $('menuBackdrop').hidden = false; $('openMenu').setAttribute('aria-expanded', 'true'); }
function closeMenu() { $('sidebar').classList.remove('open'); $('menuBackdrop').hidden = true; $('openMenu').setAttribute('aria-expanded', 'false'); }

function renderModuleCards() {
  const target = $('moduleCards');
  target.replaceChildren();
  const accessible = modules.filter((module) => canView(module.id));
  if (!accessible.length) return appendEmpty(target, 'Nenhum módulo liberado', 'Peça ao administrador acesso às áreas da sua carteira.', '◈');
  for (const module of accessible) {
    const tile = node('a', 'portal-tile');
    tile.href = viewUrl(module.id);
    tile.setAttribute('aria-label', `Abrir ${module.label}`);
    const icon = node('span', 'portal-tile-icon');
    const glyph = node('i', `bi bi-${module.icon}`);
    const arrow = node('i', 'bi bi-arrow-up-right portal-tile-arrow');
    icon.setAttribute('aria-hidden', 'true');
    arrow.setAttribute('aria-hidden', 'true');
    icon.append(glyph);
    tile.append(icon, arrow, node('span', 'portal-tile-label', module.label));
    target.append(tile);
  }
}
async function loadDashboard() {
  const data = await request('/dashboard');
  const metrics = data.metrics || {};
  $('statCompanies').textContent = Number.isFinite(metrics.companies) ? String(metrics.companies) : '—';
  $('statDocuments').textContent = Number.isFinite(metrics.documents) ? String(metrics.documents) : '—';
  $('statRequests').textContent = Number.isFinite(metrics.workItemsOpen) ? String(metrics.workItemsOpen) : '—';
  $('statAgents').textContent = Number.isFinite(metrics.agentsOnline) ? String(metrics.agentsOnline) : '—';
  const openItems = Number.isFinite(metrics.workItemsOpen) ? metrics.workItemsOpen : null;
  if (openItems !== null) {
    $('homeWorkAlerts').textContent = openItems === 0 ? 'Sem atividades abertas' : `${openItems} ${openItems === 1 ? 'atividade aberta' : 'atividades abertas'}`;
    $('homeWorkAlertDescription').textContent = 'Total dos módulos que você pode consultar.';
  } else {
    $('homeWorkAlerts').textContent = 'Atividades indisponíveis';
  }
  $('dashboardFreshness').textContent = 'Atualizado agora';
}
async function loadStorage() {
  const info = await request('/storage');
  if (!isAdmin()) return;
  const size = Number(info.bytes);
  const megabytes = Number.isFinite(size) ? size / 1024 / 1024 : NaN;
  $('storageUsage').textContent = Number.isFinite(megabytes)
    ? `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(megabytes)} MB`
    : 'Indisponível';
  $('storageDescription').textContent = `${info.tableCount || 0} tabelas · dados e índices · medição aproximada`;
}
function fillCompanySelect(select, allOption) {
  const old = select.value;
  select.replaceChildren();
  if (allOption) select.append(new Option('Todas as empresas', ''));
  else select.append(new Option(select === $('workItemCompany') && $('workItemForm').dataset.module === 'tecnologia' ? 'Atividade interna' : 'Selecione a empresa', ''));
  for (const company of state.companies) select.append(new Option(`${company.name} · ${cnpjLabel(company.cnpj)}`, company.cnpj));
  if (old && state.companies.some((company) => company.cnpj === old)) select.value = old;
}
function fillUserCompanyOptions(target = $('userCompanyOptions'), showEmpty = true) {
  const checked = new Set([...target.querySelectorAll('input:checked')].map(input => input.value));
  target.replaceChildren();
  if (!state.companies.length && showEmpty) return target.append(node('small', '', 'Cadastre empresas antes de atribuir a carteira.'));
  for (const company of state.companies) {
    const label = node('label');
    const input = node('input');
    input.type = 'checkbox';
    input.name = 'companyCnpjs';
    input.value = company.cnpj;
    input.checked = checked.has(company.cnpj);
    label.append(input, node('span', '', `${company.name} · ${cnpjLabel(company.cnpj)}`));
    target.append(label);
  }
}
function fillAgentCompanyOptions() {
  const target = $('agentCompanyOptions');
  target.replaceChildren();
  if (!state.companies.length) {
    target.append(node('small', '', 'Cadastre empresas antes de vincular um agente.'));
    updateAgentPairCount();
    return;
  }
  for (const company of state.companies) {
    const label = node('label');
    const input = node('input');
    input.type = 'checkbox';
    input.name = 'agentCompany';
    input.value = company.cnpj;
    label.append(input, node('span', '', `${company.name} · ${cnpjLabel(company.cnpj)}`));
    target.append(label);
  }
  updateAgentPairCount();
}
function updateAgentPairCount() {
  const companies = document.querySelectorAll('#agentCompanyOptions input:checked').length;
  const sources = document.querySelectorAll('#agentForm input[name="agentSource"]:checked').length;
  const count = companies * sources;
  $('agentPairCount').textContent = count ? `${companies} ${companies === 1 ? 'empresa' : 'empresas'} × ${sources} ${sources === 1 ? 'fonte' : 'fontes'} = ${count} ${count === 1 ? 'vínculo' : 'vínculos'}` : 'Selecione pelo menos uma empresa e uma fonte.';
}
async function loadCompanies() {
  const data = await request('/companies');
  state.companies = Array.isArray(data.companies) ? data.companies : [];
  renderCompanies();
  renderFiscalCompanyQuickList();
  if (state.view === 'company-detail') {
    if (!state.companies.some((company) => company.cnpj === state.selectedCompanyCnpj)) navigate(isAdmin() ? 'companies' : 'fiscal');
    else updateCompanyHeading();
  }
  for (const id of ['workItemCompany', 'fiscalCompanyFilter']) fillCompanySelect($(id), id === 'fiscalCompanyFilter');
  fillUserCompanyOptions();
  if ($('userWizardDialog').open) {
    const options = $('newUserCompanyOptions');
    fillUserCompanyOptions(options, false);
    options.dispatchEvent(new Event('change'));
  }
  fillAgentCompanyOptions();
  for (const select of document.querySelectorAll('.work-company-filter')) fillCompanySelect(select, true);
}
function renderCompanies() {
  const filter = $('companySearch').value.trim().toLocaleLowerCase('pt-BR').replace(/\D/g, '');
  const text = $('companySearch').value.trim().toLocaleLowerCase('pt-BR');
  const companies = state.companies.filter((company) => !text || company.name.toLocaleLowerCase('pt-BR').includes(text) || (filter && company.cnpj.includes(filter)));
  $('companiesCount').textContent = `${state.companies.length} ${state.companies.length === 1 ? 'empresa' : 'empresas'}`;
  const target = $('companiesList');
  target.replaceChildren();
  if (!companies.length) return appendEmpty(target, state.companies.length ? 'Nenhuma empresa encontrada' : 'Nenhuma empresa cadastrada', state.companies.length ? 'Tente outra busca.' : 'Cadastre a primeira empresa para organizar a carteira.', '▥');
  for (const company of companies) {
    const row = node('div', 'list-row');
    const main = node('div', 'list-row-main');
    const avatar = node('span', 'row-avatar', initials(company.name));
    const info = node('div');
    info.append(node('strong', '', company.name), node('small', '', cnpjLabel(company.cnpj)));
    main.append(avatar, info);
    const aside = node('span', 'status-pill ' + (company.active === false ? 'status-warning' : 'status-ok'), company.active === false ? 'Inativa' : 'Ativa');
    const actions = node('div', 'company-row-actions');
    actions.append(aside);
    if (isAdmin()) {
      const open = node('a', 'button button-quiet company-open', 'Abrir ficha ↗');
      open.href = viewUrl(`client-${company.cnpj}`);
      actions.append(open);
    }
    row.append(main, actions);
    target.append(row);
  }
}
function renderFiscalCompanyQuickList() {
  const target = $('fiscalCompanyQuickList');
  target.replaceChildren();
  if (!state.companies.length) return appendEmpty(target, 'Nenhuma empresa na carteira', 'Cadastre uma empresa ou peça acesso ao administrador para acompanhar suas NFS-e.', '▥');
  const query = $('fiscalCompanyLookup').value.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const digits = query.replace(/\D/g, '');
  const companies = state.companies.filter(({ name, cnpj }) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(query)
    || (digits && /^[\d.\s/-]+$/.test(query) && cnpj.includes(digits)));
  if (!companies.length) return appendEmpty(target, 'Nenhuma empresa encontrada', 'Busque por outro nome ou CNPJ.', '▥');
  for (const company of companies.slice(0, 12)) {
    const row = node('div', 'list-row');
    const main = node('div', 'list-row-main');
    const info = node('div');
    info.append(node('strong', '', company.name), node('small', '', cnpjLabel(company.cnpj)));
    main.append(node('span', 'row-avatar teal', initials(company.name)), info);
    const button = node('button', 'text-button', 'Ver NFS-e ↗');
    button.type = 'button';
    button.addEventListener('click', () => navigate(`company-${company.cnpj}`));
    row.append(main, button);
    target.append(row);
  }
  if (companies.length > 12) target.append(node('p', 'pagination-note', `Exibindo 12 de ${companies.length} empresas. Refine a busca para localizar uma empresa.`));
}
function openCompanyDialog(company) {
  if (!isAdmin()) return;
  const form = $('companyForm');
  form.reset();
  form.dataset.company = company?.cnpj || '';
  $('companyDialogTitle').textContent = company ? 'Editar empresa' : 'Nova empresa';
  $('companyName').value = company?.name || '';
  $('companyCnpj').value = company ? cnpjLabel(company.cnpj) : '';
  $('companyCnpj').readOnly = Boolean(company);
  $('companyStatusField').hidden = !company;
  $('companyStatus').value = String(company?.active !== false);
  formError('companyError', '');
  $('companyDialog').showModal();
}

async function createCompany(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  formError('companyError', '');
  const editCnpj = $('companyForm').dataset.company;
  const button = event.submitter || $('companyForm').querySelector('[type="submit"]');
  withBusy(button, true);
  try {
    const name = $('companyName').value.trim();
    const companyResult = await request(editCnpj ? `/companies/${editCnpj}` : '/companies', editCnpj
      ? { method: 'PATCH', body: { name, active: $('companyStatus').value === 'true' } }
      : { method: 'POST', body: { name, cnpj: $('companyCnpj').value.replace(/\D/g, '') } });
    if (editCnpj && activeClient?.company.cnpj === editCnpj) {
      activeClient.company = companyResult.company;
      renderClientHeading(activeClient.company);
    }
  } catch (error) {
    formError('companyError', error.message);
    return;
  } finally { withBusy(button, false); }
  $('companyDialog').close();
  notice(editCnpj ? 'Cadastro atualizado.' : 'Empresa cadastrada.');
  void Promise.all([loadCompanies(), loadDashboard()]).catch(displayError);
}

let activeClient;
let clientRequest = 0;
const clientIsVisible = (cnpj) => isAdmin() && state.view === 'client-detail' && state.selectedClientCnpj === cnpj;

function renderClientHeading(company) {
  $('clientDetailTitle').textContent = company?.name || 'Ficha da empresa';
  $('clientDetailCnpj').textContent = company ? `CNPJ ${cnpjLabel(company.cnpj)}` : '';
  $('clientDetailCnpj').hidden = !company;
  $('clientDetailActions').hidden = !company;
  $('clientDetailContent').hidden = !company;
  if (!company) return;
  $('clientRecordCnpj').textContent = cnpjLabel(company.cnpj);
  $('clientRecordSince').textContent = company.createdAt ? dateLabel(company.createdAt) : 'Não informada';
  $('clientDetailStatus').className = `status-pill ${company.active === false ? 'status-warning' : 'status-ok'}`;
  $('clientDetailStatus').textContent = company.active === false ? 'Inativa' : 'Ativa';
  $('clientFiscalLink').href = viewUrl(`company-${company.cnpj}`);
}

function renderClientAccessCount() {
  const count = activeClient.members.filter(member => member.active && member.hasAccess).length;
  $('clientAccessCount').textContent = count === 1 ? '1 membro com acesso' : `${count} membros com acesso`;
}

function renderClientAccess() {
  const target = $('clientAccessList');
  target.replaceChildren();
  const empty = $('clientAccessEmpty');
  if (!activeClient) { empty.hidden = true; return; }
  const { company, members } = activeClient;
  const filter = $('clientAccessSearch').value.trim().toLocaleLowerCase('pt-BR');
  const eligible = members.filter(member => member.active || member.hasAccess);
  const visible = eligible.filter(member => `${member.name} ${member.email}`.toLocaleLowerCase('pt-BR').includes(filter));
  empty.textContent = eligible.length ? 'Nenhuma pessoa encontrada.' : 'Nenhum membro disponível para vincular à carteira.';
  empty.hidden = visible.length > 0;
  renderClientAccessCount();
  for (const member of visible) {
    const row = node('li', 'list-row client-access-row');
    const main = node('div', 'list-row-main');
    const info = node('div', 'client-access-info');
    info.append(node('strong', '', member.name), node('small', '', member.email));
    if (!member.active) info.append(node('small', '', 'Usuário inativo'));
    main.append(node('span', 'row-avatar', initials(member.name)), info);
    const action = node('button', 'button button-quiet');
    action.type = 'button';
    const updateActionLabel = () => {
      action.textContent = member.hasAccess ? 'Revogar acesso' : 'Conceder acesso';
      action.setAttribute('aria-label', `${action.textContent} ${member.hasAccess ? 'de' : 'para'} ${member.name}`);
    };
    updateActionLabel();
    action.addEventListener('click', async () => {
      const entry = activeClient;
      if (!clientIsVisible(company.cnpj) || !entry?.members.includes(member) || member.busy) return;
      member.busy = true;
      withBusy(action, true, 'Salvando…');
      try {
        const data = await request(`/companies/${company.cnpj}/access/${member.id}`, { method: 'PATCH', body: { hasAccess: !member.hasAccess } });
        member.hasAccess = data.hasAccess;
        if (clientIsVisible(company.cnpj) && activeClient === entry) {
          $('clientAccessFeedback').textContent = `${member.hasAccess ? 'Acesso concedido a' : 'Acesso revogado de'} ${member.name}.`;
        }
      } catch (error) { displayError(error); }
      finally {
        member.busy = false;
        withBusy(action, false);
        updateActionLabel();
        if (clientIsVisible(company.cnpj) && activeClient === entry) {
          if (!action.isConnected || !member.active) renderClientAccess();
          else renderClientAccessCount();
        }
      }
    });
    action.disabled = Boolean(member.busy);
    row.append(main, action);
    target.append(row);
  }
}

async function loadClientDetail(cnpj) {
  const serial = ++clientRequest;
  activeClient = undefined;
  $('clientAccessSearch').value = '';
  $('clientLinkPanel').hidden = true;
  $('clientLinkValue').value = '';
  $('clientLinkButton').setAttribute('aria-expanded', 'false');
  $('clientAccessFeedback').textContent = '';
  formError('clientDetailError', '');
  renderClientHeading();
  try {
    const data = await request(`/companies/${cnpj}`);
    if (serial !== clientRequest || !clientIsVisible(cnpj)) return;
    activeClient = { company: data.company, members: data.members };
    renderClientHeading(activeClient.company);
    renderClientAccess();
  } catch (error) {
    if (serial === clientRequest && clientIsVisible(cnpj)) {
      if (error.status === 401) displayError(error);
      else formError('clientDetailError', error.message);
    }
  }
}

function showClientLink() {
  const cnpj = activeClient?.company.cnpj;
  if (!cnpj || !clientIsVisible(cnpj)) return;
  const panel = $('clientLinkPanel');
  panel.hidden = !panel.hidden;
  $('clientLinkButton').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) {
    $('clientLinkValue').value = new URL(viewUrl(`client-${cnpj}`), location.origin).href;
    $('clientLinkValue').focus();
    $('clientLinkValue').select();
  }
}

async function copyClientLink() {
  const input = $('clientLinkValue');
  try {
    await navigator.clipboard.writeText(input.value);
    notice('Link da empresa copiado.');
  } catch {
    input.focus();
    input.select();
    notice('Use o comando de copiar para salvar o link selecionado.', 'error');
  }
}
async function loadUsers() {
  const data = await request('/users');
  state.users = Array.isArray(data.users) ? data.users : [];
  $('usersCount').textContent = `${state.users.length} ${state.users.length === 1 ? 'usuário' : 'usuários'}`;
  const target = $('usersList');
  target.replaceChildren();
  if (!state.users.length) return appendEmpty(target, 'Nenhum usuário cadastrado', 'Crie o primeiro acesso da equipe.', '♙');
  for (const user of state.users) {
    const row = node('div', 'list-row');
    const main = node('div', 'list-row-main');
    const avatar = node('span', 'row-avatar teal', initials(user.name));
    const info = node('div');
    info.append(node('strong', '', user.name), node('small', '', user.email));
    if (user.username) info.append(node('small', '', user.username));
    main.append(avatar, info);
    const side = node('div', 'row-aside');
    side.append(node('strong', '', user.role === 'admin' ? 'Administrador' : 'Membro'));
    const grants = Object.entries(user.moduleGrants || {}).filter(([, value]) => value).map(([key]) => allModules.find((module) => module.id === key)?.label || key);
    side.append(node('small', '', `${grants.length} módulos · ${user.companyCnpjs?.length || 0} empresas`));
    const edit = node('button', 'text-button', 'Editar acesso');
    edit.type = 'button';
    edit.addEventListener('click', () => openUserDialog(user));
    side.append(edit);
    row.append(main, side);
    target.append(row);
  }
}
function renderUserGrants(user, target = $('userGrantOptions')) {
  target.replaceChildren();
  const editable = [...modules, ...legacyModules.filter(({ id }) => user?.moduleGrants?.[id])];
  for (const { id, label } of editable) {
    const currentGrant = user?.moduleGrants?.[id];
    const row = node('div', 'grant-module');
    row.dataset.module = id;
    const permission = node('div', 'grant-level');
    const permissionLabel = node('label', '', label);
    const level = node('select');
    level.id = `${target.id}-${id}`;
    permissionLabel.htmlFor = level.id;
    level.name = `grant-${id}`;
    level.append(new Option('Sem acesso', ''), new Option('Visualizar', 'view'), new Option('Editar', 'edit'), new Option('Gerenciar', 'manage'));
    level.value = typeof currentGrant === 'string' ? currentGrant : currentGrant?.level || '';
    permission.append(permissionLabel, level);
    const actions = node('div', 'grant-actions');
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', `Ações de ${label}`);
    for (const [action, actionLabel] of Object.entries(actionLabels)) {
      if (action === 'fiscalDocumentsRead' && id !== 'fiscal') continue;
      if (legacyModules.some(module => module.id === id) && /^(sectorTalk|whatsapp)/.test(action)) continue;
      const input = node('input');
      input.type = 'checkbox';
      input.value = action;
      input.checked = !currentGrant?.blockedActions?.includes(action);
      const entry = node('label', 'grant-action');
      entry.append(input, node('span', '', actionLabel));
      actions.append(entry);
    }
    const updateActions = () => {
      actions.hidden = !level.value;
      for (const action of actions.querySelectorAll('input')) {
        const dependsOn = actionDependencies[action.value];
        action.disabled = (writeActions.has(action.value) && level.value === 'view')
          || Boolean(dependsOn && !actions.querySelector(`input[value="${dependsOn}"]`).checked);
      }
    };
    level.addEventListener('change', updateActions);
    actions.addEventListener('change', updateActions);
    updateActions();
    row.append(permission, actions);
    target.append(row);
  }
}
function updateGrantEditorRole() {
  const fullAccess = $('userRole').value === 'admin';
  $('userFullAccessNote').hidden = !fullAccess;
  $('userModuleGrants').hidden = fullAccess;
  $('userCompanyGrants').hidden = fullAccess;
}
function openUserDialog(user) {
  const form = $('userForm');
  form.reset();
  fillUserCompanyOptions();
  form.dataset.editId = user.id;
  $('userActive').checked = user.active !== false;
  formError('userError', '');
  $('userName').value = user.name || '';
  $('userEmail').value = user.email || '';
  $('userRole').value = user.role === 'admin' ? 'admin' : 'member';
  for (const input of form.querySelectorAll('input[name="companyCnpjs"]')) input.checked = user.companyCnpjs?.includes(input.value) || false;
  renderUserGrants(user);
  updateGrantEditorRole();
  $('userDialog').showModal();
}
function readUserGrants(target) {
  const grants = {};
  for (const row of target.querySelectorAll('.grant-module')) {
    const level = row.querySelector('select').value;
    if (!level) continue;
    const blockedActions = [...row.querySelectorAll('.grant-actions input:not(:checked)')].map((input) => input.value);
    grants[row.dataset.module] = blockedActions.length ? { level, blockedActions } : level;
  }
  return grants;
}
async function saveUserAccess(event) {
  event.preventDefault();
  formError('userError', '');
  const form = event.currentTarget;
  const editId = form.dataset.editId;
  if (!editId) return;
  const moduleGrants = readUserGrants(form);
  const companyCnpjs = [...form.querySelectorAll('input[name="companyCnpjs"]:checked')].map((input) => input.value);
  const button = event.submitter || form.querySelector('[type="submit"]');
  withBusy(button, true);
  try {
    const body = { name: $('userName').value.trim(), role: $('userRole').value, active: $('userActive').checked, companyCnpjs, moduleGrants };
    await request(`/users/${encodeURIComponent(editId)}`, { method: 'PATCH', body });
    $('userDialog').close();
    form.reset();
    form.dataset.editId = '';
    await loadUsers();
    notice('Permissões atualizadas.');
  } catch (error) { formError('userError', error.message); }
  finally { withBusy(button, false); }
}
function renderAgentHealth() {
  const target = $('overviewAgentHealth');
  target.replaceChildren();
  if (!state.agents.length) return appendEmpty(target, 'Nenhum agente vinculado', 'O servidor Windows aparecerá aqui após o cadastro.', '⌁');
  const healthy = state.agents.filter((agent) => agent.active && isRecent(agent.lastSeenAt)).length;
  const summary = node('div', 'agent-summary');
  summary.append(node('span', 'agent-summary-icon', '⌁'), node('strong', '', `${healthy} de ${state.agents.length} com sinal recente`), node('p', '', 'Atualização baseada no último batimento recebido pela API.'));
  target.append(summary);
}
async function loadAgents() {
  const data = await request('/agents');
  state.agents = Array.isArray(data.agents) ? data.agents : [];
  $('agentsCount').textContent = `${state.agents.length} ${state.agents.length === 1 ? 'agente' : 'agentes'}`;
  renderAgentHealth();
  const target = $('agentsList');
  target.replaceChildren();
  if (!state.agents.length) return appendEmpty(target, 'Nenhum agente cadastrado', 'Vincule o servidor Windows para acompanhar sua comunicação.', '⌁');
  for (const agent of state.agents) {
    const row = node('div', 'list-row');
    const main = node('div', 'list-row-main');
    const info = node('div');
    info.append(node('strong', '', agent.name || agent.id), node('small', '', `${agent.assignments?.length || 0} fontes vinculadas · ${agent.queuedBatches || 0} lotes na fila`));
    main.append(node('span', 'row-avatar teal', '⌁'), info);
    const side = node('div', 'row-aside');
    side.append(node('strong', '', !agent.active ? 'Desativado' : isRecent(agent.lastSeenAt) ? 'Sinal recente' : 'Sem sinal recente'), node('small', '', relativeTime(agent.lastSeenAt)));
    if (agent.active) {
      const revoke = node('button', 'text-button danger-text', 'Revogar token');
      revoke.type = 'button';
      revoke.addEventListener('click', async () => {
        if (!confirm(`Revogar o token do agente ${agent.name || agent.id}? O servidor deixará de sincronizar até receber um novo token.`)) return;
        revoke.disabled = true;
        try { await request(`/agents/${encodeURIComponent(agent.id)}/revoke`, { method: 'POST' }); await loadAgents(); notice('Token revogado. A fila local permanecerá no servidor.'); }
        catch (error) { displayError(error); revoke.disabled = false; }
      });
      side.append(revoke);
    }
    row.append(main, side);
    target.append(row);
  }
}
async function createAgent(event) {
  event.preventDefault();
  formError('agentError', '');
  const button = event.submitter || $('agentForm').querySelector('[type="submit"]');
  withBusy(button, true);
  try {
    const companies = [...document.querySelectorAll('#agentCompanyOptions input:checked')].map((input) => input.value);
    const sources = [...document.querySelectorAll('#agentForm input[name="agentSource"]:checked')].map((input) => input.value);
    if (!companies.length || !sources.length) throw new Error('Selecione ao menos uma empresa e uma fonte.');
    if (companies.length * sources.length > 1000) throw new Error('Limite de 1.000 vínculos por agente. Divida a carteira em dois agentes.');
    const startNsu = $('agentStartNsu').value.trim();
    const assignments = companies.flatMap((companyCnpj) => sources.map((source) => ({ companyCnpj, source, startNsu })));
    const data = await request('/agents', { method: 'POST', body: {
      name: $('agentName').value.trim(),
      assignments,
    } });
    $('agentDialog').close();
    $('agentForm').reset();
    if (!data.token) throw new Error('Agente criado, mas o token não veio na resposta. Gere outra credencial com o administrador.');
    $('agentTokenOnce').textContent = data.token;
    $('tokenDialog').showModal();
    void loadAgents().catch(displayError);
  } catch (error) { formError('agentError', error.message); if (!$('agentDialog').open) notice(error.message, 'error'); }
  finally { withBusy(button, false); }
}
function clearToken() {
  $('agentTokenOnce').textContent = '';
  $('tokenDialog').close();
}
async function copyToken() {
  const token = $('agentTokenOnce').textContent;
  if (!token) return;
  try { await navigator.clipboard.writeText(token); notice('Token copiado. Guarde-o no servidor Windows.'); }
  catch { notice('Não foi possível copiar automaticamente. Selecione o token e copie manualmente.', 'warn'); }
}
async function changePassword(event) {
  event.preventDefault();
  formError('passwordError', '');
  const currentPassword = $('currentPassword').value;
  const newPassword = $('newPassword').value;
  if (newPassword !== $('confirmNewPassword').value) return formError('passwordError', 'As novas senhas não coincidem.');
  const button = event.submitter || $('passwordForm').querySelector('[type="submit"]');
  withBusy(button, true);
  try {
    await request('/change-password', { method: 'POST', body: { currentPassword, newPassword } });
    $('passwordDialog').close();
    $('passwordForm').reset();
    notice('Senha atualizada. As outras sessões desta conta foram encerradas.');
  } catch (error) { formError('passwordError', error.message); }
  finally { withBusy(button, false); }
}
function openWorkItemDialog(module) {
  const form = $('workItemForm');
  const technology = module === 'tecnologia';
  form.reset();
  form.dataset.module = module;
  formError('workItemError', '');
  $('workItemCompany').required = !technology;
  $('workItemCompanyLabel').textContent = technology ? 'Empresa (opcional)' : 'Empresa';
  $('workItemDialogDescription').textContent = technology
    ? 'Registre uma atividade interna de Tecnologia ou associe a uma empresa.'
    : 'Registre uma atividade de acompanhamento para a empresa e o módulo.';
  fillCompanySelect($('workItemCompany'), false);
  $('workItemDialog').showModal();
}
function ensureWorkSection(module) {
  const parent = $(`view-${module}`);
  let section = parent.querySelector('.work-section');
  if (section) return section;
  section = node('article', 'surface work-section');
  section.dataset.module = module;
  const header = node('div', 'work-toolbar');
  const title = node('div');
  title.append(node('h2', '', module === 'tecnologia' ? 'Atividades do setor' : 'Acompanhamento da carteira'));
  const controls = node('div', 'work-filter');
  const filter = node('select', 'work-company-filter');
  filter.setAttribute('aria-label', 'Filtrar atividades por empresa');
  filter.addEventListener('change', () => void loadWorkItems(module).catch(displayError));
  fillCompanySelect(filter, true);
  controls.append(filter);
  if (module === 'tecnologia') {
    const status = node('select', 'work-status-filter');
    status.setAttribute('aria-label', 'Filtrar atividades por situação');
    status.append(new Option('Todas as situações', ''), ...Object.entries(taskStatusLabels).map(([value, label]) => new Option(label, value)));
    status.addEventListener('change', () => void loadWorkItems(module).catch(displayError));
    controls.append(status);
  }
  if (canUse(module, 'workItemCreate')) {
    const add = node('button', 'button button-primary', '+ Nova atividade');
    add.type = 'button';
    add.addEventListener('click', () => openWorkItemDialog(module));
    controls.append(add);
  }
  header.append(title, controls);
  const list = node('div', 'list-content work-items-list');
  list.setAttribute('aria-live', 'polite');
  section.append(header, list);
  parent.append(section);
  return section;
}
async function loadWorkItems(module) {
  const section = ensureWorkSection(module);
  const requestId = Number(section.dataset.requestId || 0) + 1;
  section.dataset.requestId = requestId;
  const filter = section.querySelector('.work-company-filter').value;
  const qs = new URLSearchParams({ module });
  if (filter) qs.set('companyCnpj', filter);
  const data = await request(`/work-items?${qs.toString()}`);
  const linkItemId = new URLSearchParams(location.search).get('atividade');
  const items = Array.isArray(data.items) ? data.items : [];
  let linkedItem = items.find(({ id }) => id === linkItemId);
  if (!linkedItem && /^[0-9a-f-]{36}$/i.test(linkItemId || '') && !filter && !section.dataset.linkViewed) {
    const result = await request(`/work-items/${encodeURIComponent(linkItemId)}`).catch((error) => {
      if (![403, 404].includes(error.status)) throw error;
      return null;
    });
    if (result?.item?.module === module) {
      linkedItem = result.item;
      items.unshift(linkedItem);
    }
  }
  if (!canUse(module, 'workItemRead') || !section.isConnected || Number(section.dataset.requestId) !== requestId) return;
  const target = section.querySelector('.work-items-list');
  target.replaceChildren();
  const statusFilter = section.querySelector('.work-status-filter')?.value;
  const visibleItems = statusFilter ? items.filter(({ status }) => status === statusFilter) : items;
  if (module === 'tecnologia') {
    for (const [status, id] of Object.entries({ open: 'technologyOpen', in_progress: 'technologyInProgress', done: 'technologyDone' })) {
      $(id).textContent = items.filter((item) => item.status === status).length;
    }
  }
  if (!visibleItems.length) {
    const description = filter || statusFilter ? 'Nenhuma atividade corresponde aos filtros aplicados.'
      : canUse(module, 'workItemCreate') ? 'Use “Nova atividade” para registrar uma pendência.' : 'As atividades registradas pela equipe aparecerão aqui.';
    return appendEmpty(target, 'Nenhuma atividade encontrada', description, '◷');
  }
  const canUpdate = canUse(module, 'workItemUpdate');
  let linkedRow;
  for (const item of visibleItems) {
    const row = node('div', 'list-row');
    if (item === linkedItem) {
      row.classList.add('work-item-highlight');
      linkedRow = row;
    }
    const main = node('div', 'list-row-main');
    const info = node('div');
    info.append(node('strong', '', item.title));
    const meta = node('div', 'task-meta');
    meta.append(node('span', '', item.companyCnpj ? companyName(item.companyCnpj) : 'Atividade interna'), node('span', '', item.dueAt ? `Prazo ${dateLabel(item.dueAt)}` : 'Sem prazo'));
    info.append(meta);
    if (item.description) info.append(node('p', 'task-description', item.description));
    main.append(node('span', 'row-avatar', '◷'), info);
    const label = taskStatusLabels[item.status] || 'Aberta';
    if (canUpdate) {
      const status = node('select', `task-status ${item.status || 'open'}`);
      status.setAttribute('aria-label', `Situação de ${item.title}`);
      status.append(...Object.entries(taskStatusLabels).map(([value, text]) => new Option(text, value)));
      status.value = item.status || 'open';
      status.addEventListener('change', async () => {
        status.disabled = true;
        try {
          await request(`/work-items/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { status: status.value } });
          await Promise.all([loadWorkItems(module), loadDashboard()]);
        } catch (error) {
          status.value = item.status || 'open';
          status.disabled = false;
          displayError(error);
        }
      });
      row.append(main, status);
    } else {
      row.append(main, node('span', `task-status ${item.status || 'open'}`, label));
    }
    target.append(row);
  }
  if (linkedRow && !section.dataset.linkViewed && state.view === module) {
    section.dataset.linkViewed = 'true';
    linkedRow.scrollIntoView({ block: 'center' });
  }
}
async function createWorkItem(event) {
  event.preventDefault();
  const module = $('workItemForm').dataset.module;
  formError('workItemError', '');
  const button = event.submitter || $('workItemForm').querySelector('[type="submit"]');
  withBusy(button, true);
  try {
    const companyCnpj = $('workItemCompany').value;
    await request('/work-items', { method: 'POST', body: {
      module, companyCnpj: companyCnpj || null, title: $('workItemTitle').value.trim(),
      description: $('workItemDescription').value.trim(),
      ...($('workItemDue').value ? { dueAt: $('workItemDue').value } : {}),
    } });
    $('workItemDialog').close();
    $('workItemForm').reset();
    await Promise.all([loadWorkItems(module), loadDashboard()]);
    notice('Atividade registrada.');
  } catch (error) { formError('workItemError', error.message); }
  finally { withBusy(button, false); }
}
function updateCompanyHeading() {
  const company = state.companies.find((item) => item.cnpj === state.selectedCompanyCnpj);
  $('backToCompanies').textContent = isAdmin() ? '← Voltar à ficha administrativa' : '← Voltar ao Fiscal';
  $('companyDetailTitle').textContent = company?.name || cnpjLabel(state.selectedCompanyCnpj);
  $('companyDetailCnpj').textContent = `CNPJ ${cnpjLabel(state.selectedCompanyCnpj)} · Consulta fiscal da carteira`;
}
function showCoverage(data, companyCnpj) {
  if (companyCnpj !== state.selectedCompanyCnpj || state.view !== 'company-detail') return;
  const coverage = data?.coverage || data || {};
  const target = $('companyCoverage');
  target.replaceChildren();
  const status = coverage.status || 'not_configured';
  const configured = !['not_configured', 'never_collected', 'none', 'unavailable'].includes(status);
  const symbol = node('span', `coverage-icon ${configured ? '' : 'waiting'}`, configured ? '⌁' : '◷');
  symbol.setAttribute('aria-hidden', 'true');
  const message = node('div');
  message.append(node('strong', '', configured ? 'Registros NFS-e recebidos pela plataforma' : 'Sem NFS-e recebida para esta empresa'));
  const receivedAt = coverage.lastReceivedAt || coverage.lastSeenAt;
  const text = receivedAt ? `Último registro recebido: ${dateLabel(receivedAt)}.` : 'Ainda não há registro de recebimento confirmado.';
  const nsu = coverage.lastNsu ? ` Último NSU registrado: ${coverage.lastNsu}.` : '';
  message.append(node('p', '', `${text}${nsu} A cobertura depende da fonte e da execução do conector; ausência de notas não comprova inexistência.`));
  target.append(symbol, message);
}
async function loadCompanyCoverage(companyCnpj) {
  try { showCoverage(await request(`/companies/${companyCnpj}/nfse/coverage`), companyCnpj); }
  catch (error) {
    if (companyCnpj === state.selectedCompanyCnpj) $('companyCoverage').textContent = 'Cobertura indisponível no momento. Não conclua que não existem notas sem conferir a fonte oficial.';
    throw error;
  }
}
function comparisonCell(count, amountCents) {
  const cell = node('div', 'comparison-values');
  cell.append(node('strong', '', moneyLabel(amountCents)), node('span', '', `${Number(count) || 0} ${Number(count) === 1 ? 'registro' : 'registros'}`));
  return cell;
}
function trendLabel(amount, previous) {
  const current = Number(amount) || 0;
  const prior = Number(previous) || 0;
  if (!prior) return '—';
  const variation = ((current - prior) / Math.abs(prior)) * 100;
  return `${variation >= 0 ? '+' : ''}${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(variation)}%`;
}
async function loadCompanySummary(companyCnpj) {
  const from = $('nfseSummaryFrom').value;
  const to = $('nfseSummaryTo').value;
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || from > to) {
    throw new Error('Selecione um intervalo de competências válido para comparar.');
  }
  const result = await request(`/companies/${companyCnpj}/nfse/summary?${new URLSearchParams({ from, to })}`);
  if (companyCnpj !== state.selectedCompanyCnpj || state.view !== 'company-detail' || from !== $('nfseSummaryFrom').value || to !== $('nfseSummaryTo').value) return;
  const summary = result.summary || {};
  $('nfseIssuedCount').textContent = String(Number(summary.issuedCount) || 0);
  $('nfseReceivedCount').textContent = String(Number(summary.receivedCount) || 0);
  $('nfseCancelledCount').textContent = String(Number(summary.cancelledCount) || 0);
  $('nfseIssuedAmount').textContent = `${moneyLabel(summary.issuedActiveAmountCents)} em notas válidas · ${moneyLabel(summary.issuedAmountCents)} observado`;
  $('nfseReceivedAmount').textContent = `${moneyLabel(summary.receivedActiveAmountCents)} em notas válidas · ${moneyLabel(summary.receivedAmountCents)} observado`;
  const target = $('nfseComparison');
  target.replaceChildren();
  const months = Array.isArray(result.byMonth) ? [...result.byMonth].sort((a, b) => String(a.month).localeCompare(String(b.month))) : [];
  if (!months.length) return appendEmpty(target, 'Nenhuma competência recebida neste intervalo', 'O resultado depende das notas observadas pela fonte e da cobertura da coleta.', '◫');
  const scroll = node('div', 'comparison-scroll');
  const table = node('table', 'comparison-table');
  const head = node('thead');
  const headRow = node('tr');
  for (const label of ['Competência', 'Prestadas válidas', 'Variação prestadas', 'Tomadas válidas', 'Variação tomadas', 'Canceladas']) headRow.append(node('th', '', label));
  head.append(headRow);
  const body = node('tbody');
  for (let index = 0; index < months.length; index++) {
    const current = months[index];
    const prior = months[index - 1];
    const row = node('tr');
    row.append(node('th', '', monthLabel(current.month)));
    const issued = node('td'); issued.append(comparisonCell(current.issuedCount, current.issuedActiveAmountCents));
    const received = node('td'); received.append(comparisonCell(current.receivedCount, current.receivedActiveAmountCents));
    row.append(issued, node('td', 'comparison-trend', prior ? trendLabel(current.issuedActiveAmountCents, prior.issuedActiveAmountCents) : '—'), received, node('td', 'comparison-trend', prior ? trendLabel(current.receivedActiveAmountCents, prior.receivedActiveAmountCents) : '—'), node('td', '', String(Number(current.cancelledCount) || 0)));
    body.append(row);
  }
  table.append(head, body); scroll.append(table); target.append(scroll);
}
function nfseRoleLabel(role) { return ['issued', 'provider'].includes(role) ? 'Prestada' : ['received', 'recipient'].includes(role) ? 'Tomada' : 'NFS-e'; }
function nfseStatusLabel(status) {
  const value = String(status || '').toLowerCase();
  if (['cancelled', 'canceled', 'cancelada'].includes(value)) return 'Cancelada';
  if (['active', 'authorized', 'valid', 'normal', 'autorizada'].includes(value)) return 'Válida';
  return status || 'Situação indisponível';
}
function openNfseDetails(doc) {
  const fields = $('nfseDetailFields');
  fields.replaceChildren();
  const rows = [
    ['Papel na empresa', nfseRoleLabel(doc.role)], ['Situação', nfseStatusLabel(doc.status)],
    ['Chave', doc.documentKey || doc.accessKey], ['Número', doc.number],
    ['Emissão', doc.issuedAt ? dateLabel(doc.issuedAt) : null], ['Competência', doc.competence ? monthLabel(doc.competence) : null],
    ['Prestador', doc.providerCnpj ? cnpjLabel(doc.providerCnpj) : null], ['Tomador', doc.recipientCnpj ? cnpjLabel(doc.recipientCnpj) : null],
    ['Valor', moneyLabel(doc.amountCents)], ['Código do município', doc.municipalityCode], ['NSU', doc.nsu],
  ];
  for (const [label, value] of rows) {
    if (value === null || value === undefined || value === '') continue;
    const item = node('div', 'nfse-detail-field');
    item.append(node('dt', '', label), node('dd', '', value));
    fields.append(item);
  }
  $('nfseDetailDialog').showModal();
}
async function loadCompanyDocuments(companyCnpj) {
  const page = state.nfsePage;
  const requestNumber = ++state.nfseRequest;
  const target = $('nfseCompanyList');
  appendEmpty(target, 'Buscando NFS-e...', 'Consultando os registros recebidos para esta empresa.', '⌕');
  const qs = new URLSearchParams({ page: String(page), limit: '50' });
  if ($('nfseMonthFilter').value) qs.set('month', $('nfseMonthFilter').value);
  if ($('nfseRoleFilter').value) qs.set('role', $('nfseRoleFilter').value);
  if ($('nfseStatusFilter').value) qs.set('status', $('nfseStatusFilter').value);
  const result = await request(`/companies/${companyCnpj}/nfse?${qs}`);
  if (companyCnpj !== state.selectedCompanyCnpj || requestNumber !== state.nfseRequest || state.view !== 'company-detail') return;
  const documents = Array.isArray(result.documents) ? result.documents : [];
  state.nfseHasMore = !!result.hasMore;
  $('nfseCount').textContent = `${documents.length} ${documents.length === 1 ? 'nota' : 'notas'} nesta página`;
  target.replaceChildren();
  if (!documents.length) appendEmpty(target, 'Nenhuma NFS-e neste filtro', 'Confira a competência, os filtros e a cobertura da fonte antes de concluir que não existem notas.', '▤');
  for (const doc of documents) {
    const row = node('div', 'nfse-row');
    const main = node('div', 'nfse-main');
    const top = node('div', 'nfse-row-top');
    top.append(node('strong', '', doc.number ? `NFS-e ${doc.number}` : 'NFS-e sem número informado'), node('span', 'nfse-role', nfseRoleLabel(doc.role)), node('span', `nfse-state ${nfseStatusLabel(doc.status) === 'Cancelada' ? 'cancelled' : ''}`, nfseStatusLabel(doc.status)));
    const key = node('small', 'nfse-key', `Chave: ${doc.documentKey || doc.accessKey || 'Não informada'}`);
    const parties = node('small', '', `Prestador ${cnpjLabel(doc.providerCnpj)} · Tomador ${cnpjLabel(doc.recipientCnpj)} · ${doc.issuedAt ? dateLabel(doc.issuedAt) : 'Emissão não informada'}`);
    main.append(top, key, parties);
    const side = node('div', 'nfse-row-side');
    side.append(node('strong', '', moneyLabel(doc.amountCents)));
    const detail = node('button', 'text-button', 'Ver dados ↗');
    detail.type = 'button';
    detail.addEventListener('click', () => openNfseDetails(doc));
    side.append(detail);
    row.append(main, side);
    target.append(row);
  }
  $('nfsePagination').hidden = page === 1 && !state.nfseHasMore;
  $('nfsePageLabel').textContent = `Página ${page}`;
  $('nfsePreviousPage').disabled = page <= 1;
  $('nfseNextPage').disabled = !state.nfseHasMore;
}
async function loadCompanyDetail() {
  const companyCnpj = state.selectedCompanyCnpj;
  if (!companyCnpj) return;
  updateCompanyHeading();
  const results = await Promise.allSettled([loadCompanyCoverage(companyCnpj), loadCompanySummary(companyCnpj), loadCompanyDocuments(companyCnpj)]);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length && companyCnpj === state.selectedCompanyCnpj) displayError(failures[0].reason);
}
async function loadFiscalDocuments() {
  const filter = $('fiscalCompanyFilter').value;
  const qs = new URLSearchParams({ page: '1', limit: '50' });
  if (filter) qs.set('companyCnpj', filter);
  const data = await request(`/fiscal/documents?${qs.toString()}`);
  const target = $('fiscalDocumentsList');
  target.replaceChildren();
  const documents = Array.isArray(data.documents) ? data.documents : [];
  if (!documents.length) return appendEmpty(target, 'Nenhum documento recebido', 'Quando um conector fiscal estiver ativo, as notas sincronizadas aparecerão aqui.', '▤');
  for (const doc of documents) {
    const row = node('div', 'list-row');
    const main = node('div', 'list-row-main');
    const info = node('div');
    info.append(node('strong', '', doc.documentKey || 'Documento fiscal'), node('small', '', `${companyName(doc.companyCnpj)} · ${doc.source || 'Documento'} · NSU ${doc.nsu || '—'}`));
    main.append(node('span', 'row-avatar', '▤'), info);
    const side = node('div', 'row-aside');
    side.append(node('small', '', doc.receivedAt ? dateLabel(doc.receivedAt) : 'Data indisponível'));
    if (doc.source === 'NFSE' && canUse('fiscal', 'fiscalDocumentsRead')) {
      const open = node('button', 'text-button', 'Abrir empresa ↗');
      open.type = 'button';
      open.addEventListener('click', () => navigate(`company-${doc.companyCnpj}`));
      side.append(open);
    }
    row.append(main, side);
    target.append(row);
  }
  if (data.hasMore) {
    const note = node('div', 'pagination-note', 'Mostrando os 50 registros mais recentes. Abra a empresa para filtrar suas NFS-e por competência.');
    target.append(note);
  }
}

function setupEvents() {
  $('authForm').addEventListener('submit', handleAuth);
  $('logoutButton').addEventListener('click', logout);
  $('changePasswordButton').addEventListener('click', () => $('passwordDialog').showModal());
  $('openMenu').addEventListener('click', openMenu);
  $('closeMenu').addEventListener('click', closeMenu);
  $('menuBackdrop').addEventListener('click', closeMenu);
  for (const button of document.querySelectorAll('button.nav-link')) button.addEventListener('click', () => navigate(button.dataset.view));
  for (const button of document.querySelectorAll('button[data-go]')) button.addEventListener('click', () => navigate(button.dataset.go));
  $('companySearch').addEventListener('input', renderCompanies);
  $('fiscalCompanyLookup').addEventListener('input', renderFiscalCompanyQuickList);
  $('fiscalCompanyFilter').addEventListener('change', () => void loadFiscalDocuments().catch(displayError));
  $('backToCompanies').addEventListener('click', () => navigate(isAdmin() ? `client-${state.selectedCompanyCnpj}` : 'fiscal'));
  $('nfseCompareButton').addEventListener('click', () => void loadCompanySummary(state.selectedCompanyCnpj).catch(displayError));
  for (const id of ['nfseMonthFilter', 'nfseRoleFilter', 'nfseStatusFilter']) $(id).addEventListener('change', () => {
    state.nfsePage = 1;
    void loadCompanyDocuments(state.selectedCompanyCnpj).catch(displayError);
  });
  $('nfseClearFilters').addEventListener('click', () => {
    for (const id of ['nfseMonthFilter', 'nfseRoleFilter', 'nfseStatusFilter']) $(id).value = '';
    state.nfsePage = 1;
    void loadCompanyDocuments(state.selectedCompanyCnpj).catch(displayError);
  });
  $('nfsePreviousPage').addEventListener('click', () => {
    if (state.nfsePage <= 1) return;
    state.nfsePage -= 1;
    void loadCompanyDocuments(state.selectedCompanyCnpj).catch(displayError);
  });
  $('nfseNextPage').addEventListener('click', () => {
    if (!state.nfseHasMore) return;
    state.nfsePage += 1;
    void loadCompanyDocuments(state.selectedCompanyCnpj).catch(displayError);
  });
  $('newCompanyButton').addEventListener('click', () => openCompanyDialog());
  $('clientEditButton').addEventListener('click', () => { if (activeClient) openCompanyDialog(activeClient.company); });
  $('clientAccessSearch').addEventListener('input', renderClientAccess);
  $('clientLinkButton').addEventListener('click', showClientLink);
  $('clientCopyLink').addEventListener('click', () => void copyClientLink());
  const openUserWizard = mountUserWizard({
    request,
    renderGrants: target => renderUserGrants(null, target),
    readGrants: readUserGrants,
    renderCompanies: target => fillUserCompanyOptions(target, false),
    onCreated: user => {
      const username = user?.username;
      notice(username ? `Acesso de ${username} criado.` : 'Acesso criado.');
      void loadUsers().catch(displayError);
    },
  });
  $('newUserButton').addEventListener('click', openUserWizard);
  $('newAgentButton').addEventListener('click', () => $('agentDialog').showModal());
  $('companyForm').addEventListener('submit', createCompany);
  $('userForm').addEventListener('submit', saveUserAccess);
  $('userRole').addEventListener('change', updateGrantEditorRole);
  $('agentForm').addEventListener('submit', createAgent);
  $('workItemForm').addEventListener('submit', createWorkItem);
  $('passwordForm').addEventListener('submit', changePassword);
  $('agentCompanyOptions').addEventListener('change', updateAgentPairCount);
  $('agentForm').addEventListener('change', updateAgentPairCount);
  $('selectAllAgentCompanies').addEventListener('click', () => {
    const options = [...document.querySelectorAll('#agentCompanyOptions input')];
    const select = options.some((input) => !input.checked);
    for (const input of options) input.checked = select;
    $('selectAllAgentCompanies').textContent = select ? 'Limpar seleção' : 'Selecionar todas';
    updateAgentPairCount();
  });
  $('copyAgentToken').addEventListener('click', copyToken);
  $('confirmTokenSaved').addEventListener('click', clearToken);
  $('closeTokenDialog').addEventListener('click', clearToken);
  $('tokenDialog').addEventListener('close', () => { $('agentTokenOnce').textContent = ''; });
  for (const button of document.querySelectorAll('.close-dialog')) button.addEventListener('click', () => button.closest('dialog').close());
  window.addEventListener('hashchange', () => {
    if (state.session?.user && location.hash !== '#conteudo') navigate(viewFromLocation(), { replace: true });
  });
}

setupEvents();
const sectorNavigation = mountSectorNavigation();
mountPortal(() => {
  if (sectorNavigation.open('talk')) return;
  if (state.view === 'overview') openChat();
  else location.assign('/home?talk=1');
}, () => sectorNavigation.open('whatsapp'));
request('/session').then(applySession).catch((error) => showAuth(false, error.message));
