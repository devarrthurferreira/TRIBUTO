const MARKETING = 'marketing';
const STATUSES = { open: 'A fazer', in_progress: 'Em andamento', done: 'Concluída' };
const PRIORITIES = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
const HISTORY_FIELDS = {
  title: 'título', description: 'descrição', status: 'situação', dueAt: 'prazo', assigneeId: 'responsável',
  companyCnpj: 'empresa', priority: 'prioridade', tags: 'tags', checklist: 'checklist', campaign: 'campanha', referenceUrl: 'link de referência'
};
const UTC_DAY = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });
const LOCAL_TIMESTAMP = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const LOCAL_DAY = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Sao_Paulo' });
const TASK_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function node(tag, className = '', content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function icon(name) {
  const element = node('i', `bi bi-${name}`);
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function labelIcon(name, label) {
  const element = node('span');
  element.append(icon(name), document.createTextNode(label));
  return element;
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
}

function dateKey(value = new Date()) {
  const parts = Object.fromEntries(LOCAL_DAY.formatToParts(value).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateAgo(today, days) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days + 1);
  return date.toISOString().slice(0, 10);
}

function formatDate(value, timestamp = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return (timestamp ? LOCAL_TIMESTAMP : UTC_DAY).format(date);
}

function onOrAfter(value, day) {
  const date = value && new Date(value);
  return Boolean(date && !Number.isNaN(date.getTime()) && dateKey(date) >= day);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function options(select, blank, entries, value = '') {
  select.replaceChildren(new Option(blank, ''), ...entries.map(([key, text]) => new Option(text, key)));
  select.value = entries.some(([key]) => key === value) ? value : '';
}

function companyLabel(company) {
  const cnpj = company.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return `${company.name} · ${cnpj}`;
}

function metric(label, value, note, tone) {
  const card = node('article', 'mt-metric');
  card.dataset.tone = tone;
  card.append(node('span', '', label), node('strong', '', String(value)), node('small', '', note));
  return card;
}

function makeTaskCard(item, { assignees, companies, today, openDetails }) {
  const card = node('button', 'mt-card');
  card.type = 'button';
  card.dataset.taskId = item.id;
  card.setAttribute('aria-label', `Abrir tarefa ${item.title}`);
  const title = node('span', 'mt-card-title', item.title);
  const top = node('span', 'mt-card-top');
  const priority = item.priority || 'normal';
  const chip = node('span', 'mt-chip', PRIORITIES[priority] || PRIORITIES.normal);
  chip.dataset.priority = priority;
  top.append(title, chip);
  card.append(top);
  const company = companies.find(({ cnpj }) => cnpj === item.companyCnpj);
  if (item.campaign || company) card.append(node('span', 'mt-card-campaign', [item.campaign, company?.name].filter(Boolean).join(' · ')));
  if (item.description) card.append(node('span', 'mt-card-description', item.description));
  if (item.tags?.length) {
    const tags = node('span', 'mt-tags');
    for (const tag of item.tags) tags.append(node('span', 'mt-tag', tag));
    card.append(tags);
  }
  if (item.checklist?.length) {
    const done = item.checklist.filter(entry => entry.done).length;
    const progress = node('span', 'mt-card-progress');
    const bar = node('progress', 'mt-progress');
    bar.max = item.checklist.length;
    bar.value = done;
    bar.setAttribute('aria-label', 'Progresso do checklist');
    progress.append(bar, node('span', '', `${done}/${item.checklist.length}`));
    card.append(progress);
  }
  const footer = node('span', 'mt-card-footer');
  const assignee = assignees.find(({ id }) => id === item.assigneeId);
  footer.append(labelIcon('person', assignee?.name || (item.assigneeId ? 'Responsável indisponível' : 'Sem responsável')));
  if (item.dueAt) {
    const due = labelIcon('clock-history', formatDate(item.dueAt));
    if (item.status !== 'done' && item.dueAt < today) due.classList.add('mt-overdue');
    footer.append(due);
  }
  card.append(footer);
  card.addEventListener('click', () => void openDetails(item.id));
  return card;
}

function buildShell(root) {
  const shell = node('section', 'mt-shell');
  shell.setAttribute('aria-labelledby', 'marketingTasksTitle');
  shell.innerHTML = `
    <header class="mt-header">
      <div><p class="mt-eyebrow">Marketing</p><h1 id="marketingTasksTitle">Tarefas</h1><p class="mt-description">Organize a rotina da equipe, os prazos e as entregas das campanhas.</p></div>
      <div class="mt-header-actions">
        <button type="button" class="mt-secondary" data-mt="refresh"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Atualizar</button>
        <button type="button" class="mt-primary" data-mt="newTask"><span aria-hidden="true">+</span> Nova tarefa</button>
      </div>
    </header>
    <div class="mt-metrics" data-mt="metrics" aria-label="Indicadores de tarefas"></div>
    <div class="mt-tools">
      <div class="mt-board-heading"><h3>Quadro de tarefas</h3><span data-mt="result" aria-live="polite"></span></div>
      <div class="mt-filters">
        <label class="mt-search"><span class="sr-only">Buscar tarefas</span><i class="bi bi-search" aria-hidden="true"></i><input type="search" placeholder="Buscar por tarefa, campanha ou tag" data-mt="search"></label>
        <div class="mt-filter"><label for="marketingFilterStatus">Situação</label><select id="marketingFilterStatus" data-mt="status"></select></div>
        <div class="mt-filter"><label for="marketingFilterPriority">Prioridade</label><select id="marketingFilterPriority" data-mt="priority"></select></div>
        <div class="mt-filter"><label for="marketingFilterAssignee">Responsável</label><select id="marketingFilterAssignee" data-mt="assignee"></select></div>
        <div class="mt-filter"><label for="marketingFilterTag">Tag</label><select id="marketingFilterTag" data-mt="tag"></select></div>
        <div class="mt-filter"><label for="marketingFilterPeriod">Período</label><select id="marketingFilterPeriod" data-mt="period"><option value="">Todo o período</option><option value="7">Criadas nos últimos 7 dias</option><option value="30">Criadas nos últimos 30 dias</option></select></div>
      </div>
    </div>
    <p class="mt-error" data-mt="error" role="alert" hidden></p>
    <p class="mt-feedback" data-mt="feedback" role="status" hidden></p>
    <div class="mt-board" data-mt="board" aria-label="Quadro por situação"></div>
    <div class="mt-load-more"><button type="button" class="mt-secondary" data-mt="more" hidden>Carregar mais tarefas</button><button type="button" class="mt-secondary" data-mt="retry" hidden>Tentar novamente</button></div>
    <dialog class="mt-dialog" data-mt="dialog" aria-labelledby="marketingTaskDialogTitle">
      <form class="mt-dialog-form" data-mt="form" method="dialog">
        <header class="mt-dialog-header">
          <div><p class="mt-eyebrow">Marketing</p><h2 id="marketingTaskDialogTitle" data-mt="dialogTitle"></h2></div>
          <button type="button" class="mt-icon-button" data-mt="close" aria-label="Fechar tarefa">×</button>
        </header>
        <div class="mt-dialog-body" data-mt="dialogBody">
          <p class="mt-feedback" data-mt="loadingDetails" role="status" hidden>Carregando tarefa…</p>
          <fieldset data-mt="fieldSet" class="mt-dialog-fields">
            <div class="mt-form-grid">
              <label class="mt-field mt-wide">Título<input name="title" required minlength="3" maxlength="200" placeholder="Ex. Agendar posts da semana"></label>
              <div class="mt-field"><label for="marketingTaskStatus">Situação</label><select id="marketingTaskStatus" name="status"></select></div>
              <div class="mt-field"><label for="marketingTaskPriority">Prioridade</label><select id="marketingTaskPriority" name="priority"></select></div>
              <label class="mt-field">Prazo<input type="date" name="dueAt"></label>
              <div class="mt-field"><label for="marketingTaskAssignee">Responsável</label><select id="marketingTaskAssignee" name="assigneeId"></select></div>
              <label class="mt-field">Campanha<input name="campaign" maxlength="120" placeholder="Ex. Planejamento mensal"></label>
              <div class="mt-field"><label for="marketingTaskCompany">Empresa</label><select id="marketingTaskCompany" name="companyCnpj"></select></div>
              <label class="mt-field mt-wide">Descrição<textarea name="description" rows="3" maxlength="2000" placeholder="Inclua o contexto, entregáveis e orientações da tarefa"></textarea></label>
              <div class="mt-field mt-wide"><label for="marketingTaskTags">Tags</label><input id="marketingTaskTags" name="tags" maxlength="416" placeholder="Ex. redes sociais, aprovação" aria-describedby="marketingTaskTagsHelp"><small id="marketingTaskTagsHelp">Separe as tags por vírgula.</small></div>
              <label class="mt-field mt-wide">Link de referência<input type="url" name="referenceUrl" maxlength="1000" placeholder="https://"></label>
            </div>
            <section class="mt-checklist" aria-labelledby="marketingChecklistTitle">
              <div class="mt-checklist-heading"><h3 id="marketingChecklistTitle">Checklist</h3><span data-mt="checkCount"></span></div>
              <div data-mt="checkRows"></div>
              <div class="mt-check-add" data-mt="checkAddBox">
                <label class="mt-field"><span class="sr-only">Novo item do checklist</span><input data-mt="checkInput" maxlength="140" placeholder="Novo item do checklist"></label>
                <button type="button" class="mt-secondary" data-mt="checkAdd">Adicionar item</button>
              </div>
            </section>
          </fieldset>
          <a class="mt-reference" data-mt="reference" target="_blank" rel="noopener noreferrer" hidden>Abrir referência <span aria-hidden="true">↗</span></a>
          <div class="mt-share" data-mt="share" hidden>
            <button type="button" class="mt-secondary" data-mt="copyLink"><i class="bi bi-link-45deg" aria-hidden="true"></i> Copiar link da tarefa</button>
            <input type="text" aria-label="Link da tarefa" data-mt="shareUrl" readonly hidden>
            <p class="mt-feedback" data-mt="shareFeedback" role="status" hidden></p>
          </div>
          <section class="mt-history" data-mt="history" aria-labelledby="marketingTaskHistoryTitle" hidden>
            <h3 id="marketingTaskHistoryTitle">Histórico da tarefa</h3>
            <ol data-mt="historyEntries"></ol>
          </section>
          <p class="mt-error" data-mt="dialogError" role="alert" hidden></p>
        </div>
        <footer class="mt-dialog-footer"><button type="button" class="mt-secondary" data-mt="cancel">Cancelar</button><button type="submit" class="mt-primary" data-mt="save">Criar tarefa</button></footer>
      </form>
    </dialog>`;
  root.replaceChildren(shell);
  return { shell, ui: Object.fromEntries([...shell.querySelectorAll('[data-mt]')].map(el => [el.dataset.mt, el])) };
}

export function mountMarketingTasks(root, { request, companies = [], canCreate, canUpdate, canReassignCompany = false, linkedItemId, onChange } = {}) {
  const { shell, ui } = buildShell(root);
  const field = name => ui.form.elements.namedItem(name);
  const listCompanies = () => typeof companies === 'function' ? companies() || [] : companies;
  const items = new Map();
  let teammates = [];
  let page = 0, more = false, loading = false, disposed = false;
  let activeItem = null, editing = false, saving = false, checklist = [], detailsRequest = 0, openTaskId = '';

  const message = (target, text = '') => {
    target.textContent = text;
    target.hidden = !text;
  };

  ui.newTask.hidden = !canCreate;
  options(ui.status, 'Todas', Object.entries(STATUSES));
  options(ui.priority, 'Todas', Object.entries(PRIORITIES));
  options(ui.assignee, 'Todos', [['unassigned', 'Sem responsável']]);
  options(ui.tag, 'Todas', []);

  function syncFilters() {
    const tags = [...new Set([...items.values()].flatMap(item => item.tags || []))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    options(ui.tag, 'Todas', tags.map(tag => [tag, tag]), ui.tag.value);
    options(ui.assignee, 'Todos', [['unassigned', 'Sem responsável'], ...teammates.map(({ id, name }) => [id, name])], ui.assignee.value);
  }

  function renderBoard() {
    const today = dateKey();
    const filter = normalize(ui.search.value.trim());
    const periodStart = ui.period.value ? dateAgo(today, Number(ui.period.value)) : '';
    const portfolio = listCompanies();
    const visible = [...items.values()].filter(item => {
      if (ui.status.value && item.status !== ui.status.value) return false;
      if (ui.priority.value && (item.priority || 'normal') !== ui.priority.value) return false;
      if (ui.assignee.value && (item.assigneeId || 'unassigned') !== ui.assignee.value) return false;
      if (ui.tag.value && !item.tags?.includes(ui.tag.value)) return false;
      if (periodStart && !onOrAfter(item.createdAt, periodStart)) return false;
      if (!filter) return true;
      const company = portfolio.find(({ cnpj }) => cnpj === item.companyCnpj);
      const person = teammates.find(({ id }) => id === item.assigneeId);
      return normalize([item.title, item.description, item.campaign, company?.name, person?.name, ...(item.tags || [])].join(' ')).includes(filter);
    });
    const compare = (a, b) => (PRIORITY_RANK[a.priority || 'normal'] - PRIORITY_RANK[b.priority || 'normal'])
      || (a.dueAt || '9999').localeCompare(b.dueAt || '9999') || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    const groups = Object.fromEntries(Object.keys(STATUSES).map(status => [status, visible.filter(item => item.status === status).sort(compare)]));
    const late = visible.filter(item => item.status !== 'done' && item.dueAt && item.dueAt < today).length;
    const completed = groups.done.filter(item => onOrAfter(item.completedAt, dateAgo(today, 30))).length;
    ui.metrics.replaceChildren(
      metric('A fazer', groups.open.length, 'Aguardando início', 'open'),
      metric('Em andamento', groups.in_progress.length, 'Em execução', 'active'),
      metric('Atrasadas', late, 'Com prazo vencido', 'late'),
      metric('Concluídas', groups.done.length, `${completed} nos últimos 30 dias`, 'done'),
    );
    ui.result.textContent = loading && !page ? 'Carregando tarefas…'
      : `${visible.length} ${visible.length === 1 ? 'tarefa' : 'tarefas'}${more ? ' nas páginas carregadas' : ''}`;
    ui.board.replaceChildren(...Object.entries(groups).map(([status, entries]) => {
      const column = node('section', 'mt-column');
      column.dataset.status = status;
      const head = node('header', 'mt-column-header');
      const title = node('h3', '', status === 'done' ? 'Concluídas' : STATUSES[status]);
      title.id = `marketingColumn-${status}`;
      column.setAttribute('aria-labelledby', title.id);
      head.append(title, node('span', 'mt-column-count', String(entries.length)));
      const content = node('div', 'mt-column-content');
      if (!entries.length) content.append(node('p', 'mt-empty', loading && !page ? 'Carregando…' : 'Nenhuma tarefa nesta situação.'));
      else for (const item of entries) content.append(makeTaskCard(item, { assignees: teammates, companies: portfolio, today, openDetails }));
      column.append(head, content);
      return column;
    }));
    ui.more.hidden = !more;
    ui.more.disabled = loading;
    ui.more.textContent = loading ? 'Carregando…' : 'Carregar mais tarefas';
    ui.refresh.disabled = loading;
    ui.newTask.disabled = loading && !page;
  }

  async function load(nextPage = 1) {
    if (loading) return;
    loading = true;
    message(ui.error);
    ui.retry.hidden = true;
    renderBoard();
    try {
      const query = new URLSearchParams({ module: MARKETING, page: String(nextPage) });
      const data = await request(`/work-items?${query}`);
      if (disposed) return;
      if (nextPage === 1) {
        items.clear();
        teammates = Array.isArray(data.assignees) ? data.assignees : [];
      }
      for (const item of data.items || []) items.set(item.id, item);
      page = nextPage;
      more = data.hasMore === true;
      syncFilters();
    } catch (error) {
      if (disposed) return;
      message(ui.error, error.message || 'Não foi possível carregar as tarefas.');
      if (nextPage === 1) ui.retry.hidden = false;
    } finally {
      loading = false;
      if (!disposed) renderBoard();
    }
  }

  function updateCheckCount() {
    ui.checkCount.textContent = `${checklist.filter(item => item.done).length}/${checklist.length} concluídos`;
    ui.checkAdd.disabled = checklist.length >= 30 || saving;
    ui.checkInput.disabled = checklist.length >= 30 || saving;
  }

  function renderChecklist() {
    ui.checkRows.replaceChildren();
    if (!checklist.length) ui.checkRows.append(node('p', 'mt-empty', 'Nenhum item no checklist.'));
    checklist.forEach((entry, index) => {
      const row = node('div', 'mt-check-row');
      const label = node('label', 'mt-check-label');
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.checked = entry.done;
      label.append(checkbox, node('span', '', entry.title));
      checkbox.addEventListener('change', () => { entry.done = checkbox.checked; updateCheckCount(); });
      row.append(label);
      if (editing) {
        const remove = node('button', 'mt-icon-button', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remover item ${entry.title}`);
        remove.addEventListener('click', () => {
          checklist.splice(index, 1);
          renderChecklist();
          ui.checkInput.focus();
        });
        row.append(remove);
      }
      ui.checkRows.append(row);
    });
    updateCheckCount();
  }

  function addChecklistItem() {
    const title = ui.checkInput.value.trim();
    if (!editing || !title || checklist.length >= 30) return;
    checklist.push({ title, done: false });
    ui.checkInput.value = '';
    renderChecklist();
    ui.checkInput.focus();
  }

  function renderHistory(history) {
    ui.historyEntries.replaceChildren();
    ui.history.hidden = !activeItem;
    if (!activeItem) return;
    if (!history.length) ui.historyEntries.append(node('li', 'mt-empty', 'Sem eventos registrados.'));
    for (const event of history) {
      const entry = node('li');
      const names = (event.fields || []).map(key => HISTORY_FIELDS[key]).filter(Boolean);
      const status = names.includes('situação') && STATUSES[event.status];
      const fields = status ? names.filter(name => name !== 'situação') : names;
      const text = event.action === 'create' ? 'Criou a tarefa'
        : status ? `Alterou a situação para ${status.toLocaleLowerCase('pt-BR')}${fields.length ? ` e atualizou ${fields.join(', ')}` : ''}`
        : fields.length ? `Alterou ${fields.join(', ')}` : 'Atualizou a tarefa';
      entry.append(node('strong', '', text), node('small', '', [event.actorName, formatDate(event.at, true)].filter(Boolean).join(' · ')));
      ui.historyEntries.append(entry);
    }
  }

  function setOptions(item) {
    for (const [name, values] of [['status', STATUSES], ['priority', PRIORITIES]]) {
      field(name).replaceChildren(...Object.entries(values).map(([value, label]) => new Option(label, value)));
    }
    const assigneeOptions = teammates.map(({ id, name }) => [id, name]);
    if (item?.assigneeId && !assigneeOptions.some(([id]) => id === item.assigneeId)) assigneeOptions.push([item.assigneeId, 'Responsável indisponível']);
    options(field('assigneeId'), 'Sem responsável', assigneeOptions);
    const companyOptions = listCompanies().map(company => [company.cnpj, companyLabel(company)]);
    if (item?.companyCnpj && !companyOptions.some(([cnpj]) => cnpj === item.companyCnpj)) companyOptions.push([item.companyCnpj, 'Empresa vinculada']);
    options(field('companyCnpj'), 'Atividade interna', companyOptions);
  }

  function renderForm(item = null, history = []) {
    activeItem = item;
    editing = item ? Boolean(canUpdate) : Boolean(canCreate);
    ui.dialogTitle.textContent = item ? (editing ? 'Editar tarefa' : 'Detalhes da tarefa') : 'Nova tarefa';
    ui.fieldSet.hidden = false;
    ui.fieldSet.disabled = !editing;
    ui.loadingDetails.hidden = true;
    ui.cancel.textContent = editing ? 'Cancelar' : 'Fechar';
    ui.save.hidden = !editing;
    ui.save.disabled = false;
    ui.save.textContent = item ? 'Salvar alterações' : 'Criar tarefa';
    message(ui.dialogError);
    setOptions(item);
    for (const name of ['title', 'description', 'dueAt', 'assigneeId', 'companyCnpj', 'campaign', 'referenceUrl']) field(name).value = item?.[name] || '';
    field('status').value = item?.status || 'open';
    field('priority').value = item?.priority || 'normal';
    field('companyCnpj').disabled = Boolean(item && !canReassignCompany);
    field('tags').value = item?.tags?.join(', ') || '';
    checklist = (item?.checklist || []).map(entry => ({ ...entry }));
    ui.checkInput.value = '';
    ui.checkAddBox.hidden = !editing;
    renderChecklist();
    renderHistory(history);
    const href = safeUrl(item?.referenceUrl);
    ui.reference.hidden = !href;
    if (href) ui.reference.href = href;
    else ui.reference.removeAttribute('href');
    ui.share.hidden = !item;
    ui.shareUrl.hidden = true;
    message(ui.shareFeedback);
    ui.dialogBody.scrollTop = 0;
  }

  function startNew() {
    if (!canCreate || saving || ui.dialog.open) return;
    openTaskId = '';
    renderForm();
    ui.dialog.showModal();
    field('title').focus();
  }

  async function openDetails(id) {
    if (disposed || !TASK_ID.test(id) || ui.dialog.open) return;
    const serial = ++detailsRequest;
    openTaskId = id;
    ui.dialogTitle.textContent = 'Detalhes da tarefa';
    ui.fieldSet.hidden = ui.history.hidden = ui.reference.hidden = ui.share.hidden = ui.save.hidden = true;
    ui.loadingDetails.hidden = false;
    ui.cancel.textContent = 'Fechar';
    message(ui.dialogError);
    ui.dialog.showModal();
    ui.close.focus();
    try {
      const { item, history } = await request(`/work-items/${id}`);
      if (disposed || serial !== detailsRequest || !ui.dialog.open) return;
      if (item?.module !== MARKETING) throw new Error('Tarefa de Marketing não encontrada.');
      renderForm(item, history || []);
    } catch (error) {
      if (disposed || serial !== detailsRequest || !ui.dialog.open) return;
      ui.loadingDetails.hidden = true;
      message(ui.dialogError, error.message || 'Não foi possível carregar a tarefa.');
    }
  }

  function getInput() {
    const values = Object.fromEntries(new FormData(ui.form));
    const tags = [...new Map(values.tags.split(/[;,]/).map(value => value.trim()).filter(Boolean).map(value => [normalize(value), value])).values()];
    if (tags.length > 12 || tags.some(tag => tag.length > 32)) throw new Error('Use até 12 tags, com no máximo 32 caracteres cada.');
    if (values.referenceUrl && !safeUrl(values.referenceUrl)) throw new Error('Informe um link HTTPS válido para a referência.');
    const title = values.title.trim();
    if (title.length < 3) throw new Error('Informe um título com pelo menos 3 caracteres.');
    if (ui.checkInput.value.trim()) addChecklistItem();
    return {
      title, description: values.description.trim(), status: values.status, priority: values.priority, dueAt: values.dueAt || null,
      assigneeId: values.assigneeId || null,
      companyCnpj: Object.hasOwn(values, 'companyCnpj') ? values.companyCnpj || null : activeItem?.companyCnpj ?? null,
      campaign: values.campaign.trim(),
      tags, checklist, referenceUrl: values.referenceUrl.trim(),
    };
  }

  function setSaving(value) {
    saving = value;
    ui.save.disabled = ui.cancel.disabled = ui.close.disabled = value;
    ui.fieldSet.disabled = value;
    ui.save.textContent = value ? 'Salvando…' : (activeItem ? 'Salvar alterações' : 'Criar tarefa');
  }

  async function saveTask(event) {
    event.preventDefault();
    if (!editing || saving) return;
    message(ui.dialogError);
    let input;
    try { input = getInput(); }
    catch (error) { message(ui.dialogError, error.message); return; }
    const prior = activeItem;
    const changes = prior ? Object.fromEntries(Object.entries(input).filter(([key, value]) => JSON.stringify(prior[key]) !== JSON.stringify(value))) : input;
    if (prior && !Object.keys(changes).length) { ui.dialog.close(); return; }
    setSaving(true);
    try {
      const data = await request(prior ? `/work-items/${prior.id}` : '/work-items', {
        method: prior ? 'PATCH' : 'POST',
        body: prior ? { ...changes, expectedUpdatedAt: prior.updatedAt } : { ...changes, module: MARKETING },
      });
      if (disposed) return;
      items.set(data.item.id, data.item);
      syncFilters();
      renderBoard();
      openTaskId = data.item.id;
      ui.dialog.close();
      message(ui.feedback, prior ? 'Tarefa atualizada.' : 'Tarefa criada.');
      onChange?.();
    } catch (error) {
      if (!disposed) message(ui.dialogError, error.message || 'Não foi possível salvar a tarefa.');
    } finally {
      if (!disposed) setSaving(false);
    }
  }

  async function copyTaskLink() {
    if (!activeItem) return;
    const url = new URL('/setor/marketing', location.origin);
    url.search = new URLSearchParams({ painel: 'tasks', atividade: activeItem.id });
    try {
      await navigator.clipboard.writeText(url.href);
      message(ui.shareFeedback, 'Link copiado. A tarefa só abre para quem tem acesso.');
    } catch {
      ui.shareUrl.value = url.href;
      ui.shareUrl.hidden = false;
      ui.shareUrl.focus();
      ui.shareUrl.select();
      message(ui.shareFeedback, 'Copie o link selecionado.');
    }
  }

  ui.search.addEventListener('input', renderBoard);
  for (const filter of [ui.status, ui.priority, ui.assignee, ui.tag, ui.period]) filter.addEventListener('change', renderBoard);
  ui.retry.addEventListener('click', () => void load());
  ui.refresh.addEventListener('click', () => void load());
  ui.more.addEventListener('click', () => void load(page + 1));
  ui.newTask.addEventListener('click', startNew);
  ui.checkAdd.addEventListener('click', addChecklistItem);
  ui.copyLink.addEventListener('click', () => void copyTaskLink());
  ui.checkInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); addChecklistItem(); }
  });
  ui.cancel.addEventListener('click', () => ui.dialog.close());
  ui.close.addEventListener('click', () => ui.dialog.close());
  ui.dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  ui.dialog.addEventListener('close', () => {
    detailsRequest++;
    ui.form.reset();
    const trigger = openTaskId && ui.board.querySelector(`[data-task-id="${openTaskId}"]`);
    (trigger || (canCreate ? ui.newTask : ui.search)).focus();
  });
  ui.form.addEventListener('submit', saveTask);
  void load().then(() => { if (linkedItemId) return openDetails(linkedItemId); });
  return () => {
    disposed = true;
    if (ui.dialog.open) ui.dialog.close();
    shell.remove();
  };
}
