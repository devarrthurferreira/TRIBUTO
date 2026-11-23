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
  companies: 'Empresas', users: 'Equipe e acessos', agents: 'Agentes de coleta',
};
const state = { session: null, view: 'overview', companies: [], users: [], agents: [], modules: [] };

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
  const agentLink = document.querySelector('[data-go="agents"]');
  if (agentLink) agentLink.hidden = !isAdmin();
  if (!isAdmin()) appendEmpty($('overviewAgentHealth'), 'Acesso reservado', 'O monitoramento do servidor fica disponível aos administradores.', '⌁');
  renderModuleCards();
  void initialLoad();
  navigate(location.hash.slice(1) || 'overview');
}
async function initialLoad() {
  const results = await Promise.allSettled([loadDashboard(), loadCompanies(), ...(isAdmin() ? [loadAgents()] : [])]);
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
  const valid = Object.hasOwn(viewLabels, view) && (view === 'overview' || view === 'companies' || (['users', 'agents'].includes(view) ? isAdmin() : canView(view)));
  state.view = valid ? view : 'overview';
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `view-${state.view}`;
  for (const button of document.querySelectorAll('.nav-link')) {
    const current = button.dataset.view === state.view;
    button.classList.toggle('active', current);
    if (current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  $('breadcrumbCurrent').textContent = viewLabels[state.view];
  if (location.hash.slice(1) !== state.view) history.replaceState(null, '', `#${state.view}`);
  closeMenu();
  $('conteudo').focus({ preventScroll: true });
  if (state.view === 'users') void loadUsers().catch(displayError);
  if (state.view === 'agents') void loadAgents().catch(displayError);
  if (state.view === 'companies') void loadCompanies().catch(displayError);
  if (state.view === 'fiscal') void loadFiscalDocuments().catch(displayError);
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
    row.append(main, aside);
    target.append(row);
  }
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
    if (doc.id) {
      const link = node('a', 'download-link', 'Baixar XML ↗');
      link.href = `${API}/fiscal/documents/${encodeURIComponent(doc.id)}/xml`;
      side.append(link);
    }
    row.append(main, side);
    target.append(row);
  }
  if (data.hasMore) {
    const note = node('div', 'pagination-note', 'Mostrando os 50 documentos mais recentes. Mais páginas estarão disponíveis em breve.');
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
