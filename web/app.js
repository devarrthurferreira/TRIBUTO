const API = '/v1/platform';
const $ = (id) => document.getElementById(id);

const modules = [
  { id: 'fiscal', label: 'Fiscal', icon: '▤', tone: 'blue', description: 'Notas, eventos e acompanhamento fiscal.' },
  { id: 'dp', label: 'Departamento Pessoal', icon: '◫', tone: 'teal', description: 'Rotinas, prazos e indicadores do time.' },
  { id: 'contabil', label: 'Contábil', icon: '◈', tone: 'violet', description: 'Documentos e fechamento por competência.' },
  { id: 'societario', label: 'Societário', icon: '⬡', tone: 'amber', description: 'Processos e histórico das empresas.' },
  { id: 'financeiro', label: 'Financeiro', icon: '◉', tone: 'teal', description: 'Visão financeira com acesso reservado.' },
  { id: 'gestao', label: 'Gestão', icon: '▧', tone: 'blue', description: 'Acompanhamento consolidado da operação.' },
];
const viewLabels = {
  overview: 'Início', fiscal: 'Fiscal', dp: 'Departamento Pessoal', contabil: 'Contábil',
  societario: 'Societário', financeiro: 'Financeiro', gestao: 'Gestão',
  companies: 'Empresas', 'company-detail': 'Ficha da empresa', users: 'Equipe e acessos', agents: 'Agentes de coleta',
};
const state = { session: null, view: 'overview', companies: [], users: [], agents: [], modules: [], selectedCompanyCnpj: null, nfsePage: 1, nfseHasMore: false, nfseRequest: 0 };

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
function canEdit(module) { return ['edit', 'manage'].includes(grantFor(module)); }
function canView(module) { return !!grantFor(module); }
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

function showAuth(setupRequired, message = '') {
  state.session = null;
  state.selectedCompanyCnpj = null;
  $('appView').hidden = true;
  $('authView').hidden = false;
  $('setupTokenRow').hidden = !setupRequired;
  $('setupNameRow').hidden = !setupRequired;
  $('confirmPasswordRow').hidden = !setupRequired;
  $('setupToken').required = setupRequired;
  $('setupName').required = setupRequired;
  $('confirmPassword').required = setupRequired;
  $('authPassword').autocomplete = setupRequired ? 'new-password' : 'current-password';
  $('authTitle').textContent = setupRequired ? 'Configure o primeiro acesso' : 'Entrar no TRIBUTO';
  $('authDescription').textContent = setupRequired
    ? 'Crie a conta administradora usando o código definido na hospedagem.'
    : 'Use seu acesso da equipe para continuar.';
  $('authSubmit').textContent = setupRequired ? 'Criar acesso administrador' : 'Entrar ↗';
  $('authForm').dataset.setup = String(setupRequired);
  formError('authError', message);
}
function applySession(session) {
  if (!session?.user) { showAuth(!!session?.setupRequired); return; }
  state.session = session;
  $('authView').hidden = true;
  $('appView').hidden = false;
  $('profileName').textContent = session.user.name || session.user.email;
  $('profileRole').textContent = isAdmin() ? 'Administrador' : 'Equipe';
  $('profileInitials').textContent = initials(session.user.name);
  $('greetingName').textContent = firstName(session.user.name);
  $('todayLabel').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date());
  for (const button of document.querySelectorAll('.nav-link')) {
    const view = button.dataset.view;
    button.hidden = modules.some((module) => module.id === view) ? !canView(view) : (['users', 'agents'].includes(view) && !isAdmin());
  }
  $('newCompanyButton').hidden = !isAdmin();
  $('newUserButton').hidden = !isAdmin();
  $('newAgentButton').hidden = !isAdmin();
  $('storageOverview').hidden = !isAdmin();
  const agentLink = document.querySelector('[data-go="agents"]');
  if (agentLink) agentLink.hidden = !isAdmin();
  if (!isAdmin()) appendEmpty($('overviewAgentHealth'), 'Acesso reservado', 'O monitoramento do servidor fica disponível aos administradores.', '⌁');
  renderModuleCards();
  void initialLoad();
  navigate(location.hash.slice(1) || 'overview');
}
async function initialLoad() {
  const results = await Promise.allSettled([loadDashboard(), loadCompanies(), ...(isAdmin() ? [loadAgents(), loadStorage()] : [])]);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) displayError(failures[0].reason);
}
async function handleAuth(event) {
  event.preventDefault();
  const setup = $('authForm').dataset.setup === 'true';
  const email = $('authEmail').value.trim().toLowerCase();
  const password = $('authPassword').value;
  formError('authError', '');
  if (setup && password !== $('confirmPassword').value) return formError('authError', 'As senhas não coincidem.');
  const body = setup
    ? { setupToken: $('setupToken').value.trim(), name: $('setupName').value.trim(), email, password }
    : { email, password };
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
  showAuth(false);
  history.replaceState(null, '', location.pathname);
}

function navigate(view) {
  const companyRoute = /^company-(\d{14})$/.exec(view);
  const detail = !!companyRoute && canView('fiscal');
  const valid = detail || (Object.hasOwn(viewLabels, view) && (view === 'overview' || view === 'companies' || (['users', 'agents'].includes(view) ? isAdmin() : canView(view))));
  state.view = detail ? 'company-detail' : valid ? view : 'overview';
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
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `view-${state.view}`;
  for (const button of document.querySelectorAll('.nav-link')) {
    const current = button.dataset.view === (state.view === 'company-detail' ? 'companies' : state.view);
    button.classList.toggle('active', current);
    if (current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  $('breadcrumbCurrent').textContent = state.view === 'company-detail' ? companyName(state.selectedCompanyCnpj) : viewLabels[state.view];
  const route = state.view === 'company-detail' ? `company-${state.selectedCompanyCnpj}` : state.view;
  if (location.hash.slice(1) !== route) history.replaceState(null, '', `#${route}`);
  closeMenu();
  $('conteudo').focus({ preventScroll: true });
  if (state.view === 'users') void loadUsers().catch(displayError);
  if (state.view === 'agents') void loadAgents().catch(displayError);
  if (state.view === 'companies') void loadCompanies().catch(displayError);
  if (state.view === 'fiscal') void loadFiscalDocuments().catch(displayError);
  if (state.view === 'company-detail') void loadCompanyDetail().catch(displayError);
  if (modules.some((module) => module.id === state.view)) void loadWorkItems(state.view).catch(displayError);
}
function openMenu() { $('sidebar').classList.add('open'); $('menuBackdrop').hidden = false; $('openMenu').setAttribute('aria-expanded', 'true'); }
function closeMenu() { $('sidebar').classList.remove('open'); $('menuBackdrop').hidden = true; $('openMenu').setAttribute('aria-expanded', 'false'); }

function renderModuleCards() {
  const target = $('moduleCards');
  target.replaceChildren();
  const accessible = modules.filter((module) => canView(module.id));
  if (!accessible.length) return appendEmpty(target, 'Nenhum módulo liberado', 'Peça ao administrador acesso às áreas da sua carteira.', '◈');
  for (const module of accessible) {
    const card = node('article', 'module-card');
    const top = node('div', 'module-card-top');
    const mark = node('span', `module-mark ${module.tone}`, module.icon);
    mark.setAttribute('aria-hidden', 'true');
    top.append(mark);
    const heading = node('h3', '', module.label);
    const description = node('p', '', module.description);
    const bottom = node('div', 'module-card-bottom');
    const backendModule = state.modules.find((item) => item.id === module.id);
    bottom.append(node('span', '', backendModule?.available ? 'Acesso disponível' : 'Rotinas em preparação'), node('span', 'arrow', '↗'));
    const button = node('button', 'module-open-button', `Abrir ${module.label}`);
    button.type = 'button';
    button.addEventListener('click', () => navigate(module.id));
    card.append(top, heading, description, bottom, button);
    target.append(card);
  }
}
async function loadDashboard() {
  const data = await request('/dashboard');
  state.modules = Array.isArray(data.modules) ? data.modules : [];
  renderModuleCards();
  const metrics = data.metrics || {};
  $('statCompanies').textContent = Number.isFinite(metrics.companies) ? String(metrics.companies) : '—';
  $('statDocuments').textContent = Number.isFinite(metrics.documents) ? String(metrics.documents) : '—';
  $('statRequests').textContent = Number.isFinite(metrics.workItemsOpen) ? String(metrics.workItemsOpen) : '—';
  $('statAgents').textContent = Number.isFinite(metrics.agentsOnline) ? String(metrics.agentsOnline) : '—';
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
  else select.append(new Option('Selecione a empresa', ''));
  for (const company of state.companies) select.append(new Option(`${company.name} · ${cnpjLabel(company.cnpj)}`, company.cnpj));
  if (old && state.companies.some((company) => company.cnpj === old)) select.value = old;
}
function fillUserCompanyOptions() {
  const target = $('userCompanyOptions');
  target.replaceChildren();
  if (!state.companies.length) return target.append(node('small', '', 'Cadastre empresas antes de atribuir a carteira.'));
  for (const company of state.companies) {
    const label = node('label');
    const input = node('input');
    input.type = 'checkbox';
    input.name = 'companyCnpjs';
    input.value = company.cnpj;
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
    if (!state.companies.some((company) => company.cnpj === state.selectedCompanyCnpj)) navigate('companies');
    else updateCompanyHeading();
  }
  for (const id of ['workItemCompany', 'fiscalCompanyFilter']) fillCompanySelect($(id), id === 'fiscalCompanyFilter');
  fillUserCompanyOptions();
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
    if (canView('fiscal')) {
      const open = node('button', 'button button-quiet company-open', 'Abrir empresa ↗');
      open.type = 'button';
      open.addEventListener('click', () => navigate(`company-${company.cnpj}`));
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
  for (const company of state.companies.slice(0, 12)) {
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
  if (state.companies.length > 12) target.append(node('p', 'pagination-note', `Exibindo 12 de ${state.companies.length} empresas. Use a aba Empresas para buscar toda a carteira.`));
}
async function createCompany(event) {
  event.preventDefault();
  formError('companyError', '');
  const button = event.submitter || $('companyForm').querySelector('[type="submit"]');
  withBusy(button, true);
  try {
    await request('/companies', { method: 'POST', body: { name: $('companyName').value.trim(), cnpj: $('companyCnpj').value.replace(/\D/g, '') } });
    $('companyDialog').close();
    $('companyForm').reset();
    await loadCompanies();
    await loadDashboard();
    notice('Empresa cadastrada.');
  } catch (error) { formError('companyError', error.message); }
  finally { withBusy(button, false); }
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
    main.append(avatar, info);
    const side = node('div', 'row-aside');
    side.append(node('strong', '', user.role === 'admin' ? 'Administrador' : 'Membro'));
    const grants = Object.entries(user.moduleGrants || {}).filter(([, value]) => value).map(([key]) => modules.find((module) => module.id === key)?.label || key);
    side.append(node('small', '', `${grants.length} módulos · ${user.companyCnpjs?.length || 0} empresas`));
    const edit = node('button', 'text-button', 'Editar acesso');
    edit.type = 'button';
    edit.addEventListener('click', () => openUserDialog(user));
    side.append(edit);
    row.append(main, side);
    target.append(row);
  }
}
function openUserDialog(user = null) {
  const form = $('userForm');
  form.reset();
  fillUserCompanyOptions();
  form.dataset.editId = user?.id || '';
  $('userDialogTitle').textContent = user ? 'Editar acesso' : 'Novo usuário';
  form.querySelector('[type="submit"]').textContent = user ? 'Salvar alterações' : 'Criar acesso';
  $('userPasswordRow').hidden = !!user;
  $('userPassword').required = !user;
  $('userEmail').disabled = !!user;
  $('userActiveRow').hidden = !user;
  $('userActive').checked = user?.active !== false;
  formError('userError', '');
  if (user) {
    $('userName').value = user.name || '';
    $('userEmail').value = user.email || '';
    $('userRole').value = user.role === 'admin' ? 'admin' : 'member';
    for (const module of modules) form.elements[`grant-${module.id}`].value = user.moduleGrants?.[module.id] || '';
    for (const input of form.querySelectorAll('input[name="companyCnpjs"]')) input.checked = user.companyCnpjs?.includes(input.value) || false;
  }
  $('userDialog').showModal();
}
async function createUser(event) {
  event.preventDefault();
  formError('userError', '');
  const form = event.currentTarget;
  const grants = {};
  for (const module of modules) {
    const value = form.elements[`grant-${module.id}`]?.value;
    if (value) grants[module.id] = value;
  }
  const companyCnpjs = [...form.querySelectorAll('input[name="companyCnpjs"]:checked')].map((input) => input.value);
  const button = event.submitter || form.querySelector('[type="submit"]');
  withBusy(button, true);
  try {
    const editId = form.dataset.editId;
    const body = { name: $('userName').value.trim(), role: $('userRole').value, companyCnpjs, moduleGrants: grants };
    if (editId) body.active = $('userActive').checked;
    else { body.email = $('userEmail').value.trim().toLowerCase(); body.password = $('userPassword').value; }
    await request(editId ? `/users/${encodeURIComponent(editId)}` : '/users', { method: editId ? 'PATCH' : 'POST', body });
    $('userDialog').close();
    form.reset();
    form.dataset.editId = '';
    await loadUsers();
    notice(editId ? 'Permissões atualizadas.' : 'Acesso criado. Entregue a senha inicial por um canal seguro.');
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
function ensureWorkSection(module) {
  const parent = $(`view-${module}`);
  let section = parent.querySelector('.work-section');
  if (section) return section;
  section = node('article', 'surface work-section');
  section.dataset.module = module;
  const header = node('div', 'work-toolbar');
  const title = node('div');
  title.append(node('p', 'eyebrow', 'ATIVIDADES'), node('h3', '', 'Acompanhamento da carteira'));
  const controls = node('div', 'work-filter');
  const filter = node('select', 'work-company-filter');
  filter.setAttribute('aria-label', 'Filtrar atividades por empresa');
  filter.addEventListener('change', () => void loadWorkItems(module).catch(displayError));
  fillCompanySelect(filter, true);
  controls.append(filter);
  if (canEdit(module)) {
    const add = node('button', 'button button-primary', '+ Nova atividade');
    add.type = 'button';
    add.addEventListener('click', () => { $('workItemForm').dataset.module = module; $('workItemDialog').showModal(); });
    controls.append(add);
  }
  header.append(title, controls);
  const list = node('div', 'list-content work-items-list');
  section.append(header, list);
  parent.append(section);
  return section;
}
async function loadWorkItems(module) {
  const section = ensureWorkSection(module);
  const filter = section.querySelector('.work-company-filter').value;
  const qs = new URLSearchParams({ module });
  if (filter) qs.set('companyCnpj', filter);
  const data = await request(`/work-items?${qs.toString()}`);
  const target = section.querySelector('.work-items-list');
  target.replaceChildren();
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) return appendEmpty(target, 'Nenhuma atividade registrada', 'Crie uma atividade para acompanhar esta carteira e este módulo.', '◷');
  for (const item of items) {
    const row = node('div', 'list-row');
    const main = node('div', 'list-row-main');
    const info = node('div');
    info.append(node('strong', '', item.title));
    const meta = node('div', 'task-meta');
    meta.append(node('span', '', companyName(item.companyCnpj)), node('span', '', item.dueAt ? `Prazo ${dateLabel(item.dueAt)}` : 'Sem prazo'));
    info.append(meta);
    main.append(node('span', 'row-avatar', '◷'), info);
    const label = { open: 'Aberta', in_progress: 'Em andamento', done: 'Concluída' };
    const status = node('button', `task-status ${item.status || 'open'}`, label[item.status] || 'Aberta');
    status.type = 'button';
    status.disabled = !canEdit(module);
    if (canEdit(module)) {
      status.title = 'Clique para avançar o status';
      status.addEventListener('click', async () => {
        const next = item.status === 'open' ? 'in_progress' : item.status === 'in_progress' ? 'done' : 'open';
        status.disabled = true;
        try { await request(`/work-items/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { status: next } }); await loadWorkItems(module); }
        catch (error) { displayError(error); status.disabled = false; }
      });
    }
    row.append(main, status);
    target.append(row);
  }
}
async function createWorkItem(event) {
  event.preventDefault();
  const module = $('workItemForm').dataset.module;
  formError('workItemError', '');
  const button = event.submitter || $('workItemForm').querySelector('[type="submit"]');
  withBusy(button, true);
  try {
    await request('/work-items', { method: 'POST', body: {
      module, companyCnpj: $('workItemCompany').value, title: $('workItemTitle').value.trim(),
      description: $('workItemDescription').value.trim(),
      ...( $('workItemDue').value ? { dueAt: $('workItemDue').value } : {} ),
    } });
    $('workItemDialog').close();
    $('workItemForm').reset();
    await loadWorkItems(module);
    await loadDashboard();
    notice('Atividade registrada.');
  } catch (error) { formError('workItemError', error.message); }
  finally { withBusy(button, false); }
}
function updateCompanyHeading() {
  const company = state.companies.find((item) => item.cnpj === state.selectedCompanyCnpj);
  $('companyDetailTitle').textContent = company?.name || cnpjLabel(state.selectedCompanyCnpj);
  $('companyDetailCnpj').textContent = `CNPJ ${cnpjLabel(state.selectedCompanyCnpj)} · Consulta fiscal da carteira`;
  $('breadcrumbCurrent').textContent = company?.name || 'Ficha da empresa';
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
    if (doc.source === 'NFSE' && canView('fiscal')) {
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
  for (const button of document.querySelectorAll('.nav-link')) button.addEventListener('click', () => navigate(button.dataset.view));
  for (const button of document.querySelectorAll('[data-go]')) button.addEventListener('click', () => navigate(button.dataset.go));
  $('companySearch').addEventListener('input', renderCompanies);
  $('fiscalCompanyFilter').addEventListener('change', () => void loadFiscalDocuments().catch(displayError));
  $('backToCompanies').addEventListener('click', () => navigate('companies'));
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
  $('newCompanyButton').addEventListener('click', () => $('companyDialog').showModal());
  $('newUserButton').addEventListener('click', () => openUserDialog());
  $('newAgentButton').addEventListener('click', () => $('agentDialog').showModal());
  $('companyForm').addEventListener('submit', createCompany);
  $('userForm').addEventListener('submit', createUser);
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
  window.addEventListener('hashchange', () => { if (state.session?.user) navigate(location.hash.slice(1)); });
}

setupEvents();
request('/session').then(applySession).catch((error) => showAuth(false, error.message));
