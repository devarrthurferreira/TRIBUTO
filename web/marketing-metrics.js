import { MARKETING_CHANNELS, marketingChannelBadge } from './marketing-tasks.js';

const PATH = '/marketing/metrics';
const STATUSES = { open: 'A fazer', in_progress: 'Em andamento', done: 'Concluída' };
const PRIORITIES = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const PRIORITY = ['urgent', 'high', 'normal', 'low'];
const MAX_REACH = 999_999_999;
const READING_LIMIT = 366;
const STEPS = ['Dados do acompanhamento', 'Dados de métricas', 'Checklist e link do post'];
const NUMBERS = new Intl.NumberFormat('pt-BR');
const PERCENT = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
const DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });
const LOCAL_DATE = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Sao_Paulo' });

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(label, className = 'mm-button') {
  const element = node('button', className, label);
  element.type = 'button';
  return element;
}

function anchor(label, url) {
  const element = node('a', 'mm-button', label);
  element.href = url;
  return element;
}

function optionList(select, options, blank) {
  select.replaceChildren(...(blank ? [new Option(blank, '')] : []),
    ...Object.entries(options).map(([key, title]) => new Option(title, key)));
}

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
}

function dateLabel(value) {
  const parsed = new Date(`${value}T12:00:00Z`);
  return value && !Number.isNaN(parsed.getTime()) ? DATE.format(parsed) : 'Sem data';
}

function reachLabel(value) {
  return Number.isFinite(value) ? NUMBERS.format(value) : '—';
}

function deltaLabel(value) {
  return `${value > 0 ? '+' : ''}${NUMBERS.format(value)}`;
}

function safePostUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function readingsFor(item) {
  return item.readings || [];
}

function metricSummary(label, value, note) {
  const card = node('div', 'mm-summary-card');
  card.append(node('span', '', label), node('strong', '', value), node('small', '', note));
  return card;
}

function selectTaskName(task) {
  const channel = MARKETING_CHANNELS[task.socialChannel]?.title;
  return [task.title, channel, task.dueAt && dateLabel(task.dueAt)].filter(Boolean).join(' · ');
}

function summaryStats(items) {
  const summary = { desired: null, estimated: null, actual: 0, measured: 0 };
  for (const item of items) {
    if (item.desiredReach != null) summary.desired = (summary.desired ?? 0) + item.desiredReach;
    if (item.estimatedReach != null) summary.estimated = (summary.estimated ?? 0) + item.estimatedReach;
    const latest = readingsFor(item).at(-1);
    if (latest) {
      summary.actual += latest.actualReach;
      summary.measured += 1;
    }
  }
  return summary;
}

function goalProgress(actual, target) {
  const group = node('div', 'mm-goal');
  const bar = node('progress');
  bar.max = target;
  bar.value = Math.min(actual, target);
  bar.setAttribute('aria-label', 'Progresso em relação ao alcance desejado');
  group.append(bar, node('span', '', `${PERCENT.format(actual / target)} da meta`));
  return group;
}

function makeTaskCard(item, showDetails) {
  const card = node('article', 'mm-card');
  const head = node('div', 'mm-card-head');
  const title = button(item.title, 'mm-card-title');
  title.addEventListener('click', () => showDetails(item));
  head.append(title, node('span', 'mm-status', STATUSES[item.status] || STATUSES.open));
  card.dataset.status = item.status;
  const context = node('div', 'mm-context');
  const channel = marketingChannelBadge(item.socialChannel);
  if (channel) context.append(channel);
  if (item.priority && item.priority !== 'normal') context.append(node('span', 'mm-meta', `Prioridade ${PRIORITIES[item.priority]?.toLocaleLowerCase('pt-BR') || 'normal'}`));
  if (item.dueAt) context.append(node('span', 'mm-meta', `Prazo ${dateLabel(item.dueAt)}`));
  if (item.taskId) context.append(node('span', 'mm-meta', 'Tarefa vinculada'));
  card.append(head);
  if (context.children.length) card.append(context);
  const stats = node('dl', 'mm-stat-row');
  const readings = readingsFor(item);
  const latest = readings.at(-1);
  for (const [label, value] of [['Desejado', item.desiredReach], ['Estimado', item.estimatedReach], ['Real', latest?.actualReach]]) {
    const block = node('div');
    block.append(node('dt', '', label), node('dd', '', reachLabel(value)));
    stats.append(block);
  }
  card.append(stats);
  if (latest && item.desiredReach > 0) card.append(goalProgress(latest.actualReach, item.desiredReach));
  const footer = node('div', 'mm-card-footer');
  const previous = readings.at(-2);
  footer.append(node('span', '', latest ? `Medição em ${dateLabel(latest.date)}` : 'Aguardando a primeira medição'));
  if (previous) {
    const delta = latest.actualReach - previous.actualReach;
    const badge = node('span', 'mm-delta', deltaLabel(delta));
    badge.dataset.direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
    badge.title = 'Variação desde a medição anterior';
    footer.append(badge);
  }
  card.append(footer);
  return card;
}

function wizardMarkup() {
  return `
    <ol class="mm-steps" data-mm="steps"></ol>
    <fieldset class="mm-step" data-mm-step="0">
      <legend>Dados do acompanhamento</legend>
      <div class="mm-fields">
        <label class="mm-field mm-stretch">Título<input name="title" required minlength="3" maxlength="200" placeholder="Ex. Desempenho do post de lançamento"></label>
        <label class="mm-field">Prioridade<select name="priority"></select></label>
        <label class="mm-field">Status<select name="status"></select></label>
        <label class="mm-field">Prazo<input type="date" name="dueAt"></label>
        <label class="mm-field mm-stretch">Descrição<textarea name="description" rows="4" maxlength="2000"></textarea></label>
      </div>
    </fieldset>
    <fieldset class="mm-step" data-mm-step="1" hidden>
      <legend>Dados de métricas</legend>
      <div class="mm-fields">
        <label class="mm-field mm-stretch">Rede social ou canal<span class="mm-channel-field"><select name="socialChannel"></select><span data-mm="channelIcons" aria-hidden="true" hidden></span></span></label>
        <label class="mm-field">Alcance desejado<input type="number" name="desiredReach" min="0" max="${MAX_REACH}" step="1" inputmode="numeric"></label>
        <label class="mm-field">Alcance estimado<input type="number" name="estimatedReach" min="0" max="${MAX_REACH}" step="1" inputmode="numeric"></label>
      </div>
      <p class="mm-helper">O alcance real pode ser registrado depois, em medições por data.</p>
    </fieldset>
    <fieldset class="mm-step" data-mm-step="2" hidden>
      <legend>Checklist e link do post</legend>
      <div class="mm-fields">
        <label class="mm-field mm-stretch">Link do post<input name="referenceUrl" type="url" maxlength="1000" placeholder="https://"></label>
        <div class="mm-stretch"><h3 class="mm-checklist-title">Checklist</h3><div class="mm-check-list" data-mm="checks"></div>
          <div class="mm-check-add"><label class="mm-field"><span class="sr-only">Novo item do checklist</span><input data-mm="checkTitle" maxlength="140" placeholder="Novo item do checklist"></label><button type="button" class="mm-button" data-mm="addCheck">Adicionar item</button></div>
        </div>
      </div>
    </fieldset>`;
}

export function mountMarketingMetrics(root, { request, canCreate = false, canUpdate = false, onAuthError } = {}) {
  root.classList.add('mm-shell');
  root.innerHTML = `
    <header class="mm-header">
      <div><h1 id="marketingMetricsTitle">Métricas</h1><p>Acompanhe o alcance dos conteúdos e compare as medições com suas metas.</p></div>
      <div class="mm-actions"><button type="button" class="mm-button" data-mm="refresh"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Atualizar</button><button type="button" class="mm-button mm-primary" data-mm="new">+ Novo acompanhamento</button></div>
    </header>
    <div class="mm-summary" data-mm="summary" aria-label="Resumo de alcance"></div>
    <section class="mm-results" aria-labelledby="marketingMetricsListTitle">
      <div class="mm-results-head"><h2 id="marketingMetricsListTitle">Acompanhamentos</h2><span data-mm="count" aria-live="polite"></span></div>
      <div class="mm-filters">
        <label class="mm-field">Buscar<input type="search" data-mm="search" placeholder="Título ou canal"></label>
        <label class="mm-field">Canal<select data-mm="filterChannel"></select></label>
        <label class="mm-field">Ordenar por<select data-mm="sort"><option value="recent">Atualização mais recente</option><option value="due">Prazo mais próximo</option><option value="priority">Maior prioridade</option><option value="reach">Maior alcance real</option></select></label>
      </div>
      <p class="mm-error" data-mm="error" role="alert" hidden></p>
      <p class="mm-feedback" data-mm="notice" role="status" hidden></p>
      <div class="mm-list" data-mm="list" aria-busy="false"></div>
      <div class="mm-pagination" data-mm="pagination" hidden><button type="button" class="mm-button" data-mm="more">Carregar mais acompanhamentos</button></div>
    </section>
    <dialog class="mm-dialog" data-mm="editor" aria-labelledby="marketingMetricsEditorTitle">
      <form class="mm-dialog-body" data-mm="form">
        <header class="mm-dialog-head"><h2 id="marketingMetricsEditorTitle" data-mm="editorTitle">Novo acompanhamento</h2><button type="button" class="mm-button mm-icon" data-mm="closeEditor" aria-label="Fechar acompanhamento">×</button></header>
        <div class="mm-dialog-content">
          <div class="mm-mode" data-mm="mode"><p>Como você quer começar?</p><div class="mm-actions"><button type="button" class="mm-button" data-mm="chooseTask"><i class="bi bi-link-45deg" aria-hidden="true"></i> Usar uma tarefa</button><button type="button" class="mm-button mm-primary" data-mm="chooseNew">Criar do zero</button></div></div>
          <div data-mm="linkFields" hidden>
            <p class="mm-helper">O acompanhamento usa os dados da tarefa escolhida. Alterações feitas na tarefa aparecem aqui.</p>
            <label class="mm-field">Tarefa do Marketing<select name="taskId" data-mm="taskSelect"></select></label>
            <div class="mm-task-help" data-mm="taskSummary"></div>
            <button type="button" class="mm-button" data-mm="moreTasks" hidden>Carregar mais tarefas</button>
          </div>
          <div data-mm="standalone" hidden>${wizardMarkup()}</div>
          <p class="mm-error" data-mm="editorError" role="alert" hidden></p>
        </div>
        <footer class="mm-dialog-footer" data-mm="editorFooter" hidden><button type="button" class="mm-button" data-mm="back">Voltar</button><button type="submit" class="mm-button mm-primary" data-mm="save">Continuar</button></footer>
      </form>
    </dialog>
    <dialog class="mm-dialog" data-mm="detail" aria-labelledby="marketingMetricsDetailTitle">
      <div class="mm-dialog-body">
        <header class="mm-dialog-head"><h2 id="marketingMetricsDetailTitle" data-mm="detailTitle"></h2><button type="button" class="mm-button mm-icon" data-mm="closeDetail" aria-label="Fechar medições">×</button></header>
        <div class="mm-dialog-content" data-mm="detailBody"></div>
      </div>
    </dialog>`;
  const ui = Object.fromEntries([...root.querySelectorAll('[data-mm]')].map(element => [element.dataset.mm, element]));
  const steps = [...root.querySelectorAll('[data-mm-step]')];
  const field = (name) => ui.form.elements.namedItem(name);
  const channelNames = Object.fromEntries(Object.entries(MARKETING_CHANNELS).map(([key, channel]) => [key, channel.title]));
  const items = new Map();
  const tasks = new Map();
  let opened = false;
  let generation = 0;
  let taskGeneration = 0;
  let loading = false;
  let loaded = false;
  let page = 0;
  let more = false;
  let saving = false;
  let readingPending = false;
  let mode = '';
  let step = 0;
  let editingId = '';
  let editingVersion = '';
  let checklist = [];
  let taskPage = 0;
  let tasksMore = false;
  let loadingTasks = false;

  optionList(ui.filterChannel, channelNames, 'Todos os canais');
  optionList(field('socialChannel'), channelNames, 'Selecione um canal');
  optionList(field('status'), STATUSES);
  optionList(field('priority'), PRIORITIES);
  for (const [index, title] of STEPS.entries()) {
    const entry = node('li');
    entry.append(node('span', 'mm-step-number', String(index + 1)), node('span', '', title));
    ui.steps.append(entry);
  }
  ui.new.hidden = !canCreate;

  function message(target, content = '') {
    target.hidden = !content;
    target.textContent = content;
  }

  function showError(error, target) {
    if (error.status === 401 && onAuthError) onAuthError(error);
    else message(target, error.message || 'Não foi possível concluir a operação.');
  }

  function renderList() {
    const query = normalized(ui.search.value.trim());
    const visible = [...items.values()].filter(item => (!ui.filterChannel.value || item.socialChannel === ui.filterChannel.value)
      && (!query || normalized([item.title, item.description, channelNames[item.socialChannel]].filter(Boolean).join(' ')).includes(query)));
    function compare(a, b) {
      const byRecent = () => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      if (ui.sort.value === 'due') return (a.dueAt || '9999').localeCompare(b.dueAt || '9999') || byRecent();
      if (ui.sort.value === 'priority') return PRIORITY.indexOf(a.priority || 'normal') - PRIORITY.indexOf(b.priority || 'normal') || byRecent();
      if (ui.sort.value === 'reach') return (readingsFor(b).at(-1)?.actualReach ?? -1) - (readingsFor(a).at(-1)?.actualReach ?? -1) || byRecent();
      return byRecent();
    }
    visible.sort(compare);
    const summary = summaryStats(visible);
    ui.summary.hidden = !loaded;
    ui.summary.replaceChildren(
      metricSummary('Alcance desejado', reachLabel(summary.desired), 'Soma das metas dos conteúdos filtrados'),
      metricSummary('Alcance estimado', reachLabel(summary.estimated), 'Soma das estimativas dos conteúdos filtrados'),
      metricSummary('Alcance real', reachLabel(summary.measured ? summary.actual : null), 'Soma da última medição por conteúdo'),
      metricSummary('Com medição', `${summary.measured}/${visible.length}`, 'Acompanhamentos com alcance registrado'),
    );
    ui.count.textContent = loaded ? `${visible.length} ${visible.length === 1 ? 'acompanhamento' : 'acompanhamentos'}${more ? ' nas páginas carregadas' : ''}` : '';
    ui.list.setAttribute('aria-busy', String(loading));
    ui.refresh.disabled = loading;
    ui.new.disabled = loading && !loaded;
    ui.pagination.hidden = !more;
    ui.more.disabled = loading;
    ui.more.textContent = loading ? 'Carregando…' : 'Carregar mais acompanhamentos';
    if (visible.length) ui.list.replaceChildren(...visible.map(item => makeTaskCard(item, openDetails)));
    else {
      const empty = node('div', 'mm-empty');
      const title = loading ? 'Carregando acompanhamentos…' : !loaded ? 'Dados indisponíveis'
        : items.size ? 'Nenhum resultado para os filtros' : 'Nenhum acompanhamento cadastrado';
      empty.append(node('strong', '', title));
      if (!loading && !items.size && canCreate && loaded) empty.append(node('p', '', 'Vincule uma tarefa do Marketing ou comece um acompanhamento do zero.'));
      ui.list.replaceChildren(empty);
    }
  }

  async function load(nextPage = 1) {
    if (!opened || loading) return;
    const current = generation;
    loading = true;
    message(ui.error);
    renderList();
    try {
      const data = await request(`${PATH}?page=${nextPage}`);
      if (current !== generation) return;
      if (nextPage === 1) items.clear();
      for (const item of data.items || []) items.set(item.id, item);
      loaded = true;
      page = nextPage;
      more = data.hasMore === true;
    } catch (error) {
      if (current === generation) showError(error, ui.error);
    } finally {
      if (current === generation) {
        loading = false;
        renderList();
      }
    }
  }

  function updateChannelIcons() {
    const badge = marketingChannelBadge(field('socialChannel').value, { label: false });
    ui.channelIcons.hidden = !badge;
    ui.channelIcons.replaceChildren(...(badge ? [badge] : []));
  }

  function renderChecklist() {
    ui.checks.replaceChildren(...checklist.map((entry, index) => {
      const row = node('div', 'mm-check-row');
      const label = node('label');
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.checked = entry.done;
      checkbox.addEventListener('change', () => { entry.done = checkbox.checked; });
      const remove = button('×', 'mm-button mm-icon');
      remove.setAttribute('aria-label', `Remover item ${entry.title}`);
      remove.addEventListener('click', () => { checklist.splice(index, 1); renderChecklist(); ui.checkTitle.focus(); });
      label.append(checkbox, node('span', '', entry.title));
      row.append(label, remove);
      return row;
    }));
    ui.addCheck.disabled = checklist.length >= 30;
    ui.checkTitle.disabled = checklist.length >= 30;
  }

  function addChecklistItem() {
    const title = ui.checkTitle.value.trim();
    if (!title || checklist.length >= 30) return;
    checklist.push({ title, done: false });
    ui.checkTitle.value = '';
    renderChecklist();
    if (!ui.checkTitle.disabled) ui.checkTitle.focus();
  }

  function showStep(next, focus = true) {
    step = next;
    for (const [index, panel] of steps.entries()) {
      panel.hidden = index !== step;
      panel.disabled = index !== step;
      if (index === step) ui.steps.children[index].setAttribute('aria-current', 'step');
      else ui.steps.children[index].removeAttribute('aria-current');
    }
    ui.save.textContent = step === steps.length - 1 ? 'Salvar acompanhamento' : 'Continuar';
    ui.back.textContent = editingId && !step ? 'Cancelar' : 'Voltar';
    if (focus) steps[step].querySelector('input, select')?.focus();
  }

  function setMode(value) {
    mode = value;
    ui.mode.hidden = !!mode;
    ui.linkFields.hidden = mode !== 'task';
    ui.standalone.hidden = mode !== 'standalone';
    ui.editorFooter.hidden = !mode;
    ui.taskSelect.disabled = mode !== 'task' || loadingTasks;
    ui.taskSelect.required = mode === 'task';
    message(ui.editorError);
    if (mode === 'task') {
      for (const panel of steps) panel.disabled = true;
      ui.save.textContent = 'Vincular tarefa';
      renderTaskChoices();
      if (!taskPage) void loadTasks(1);
      else ui.taskSelect.focus();
    } else if (mode === 'standalone') {
      showStep(0);
      ui.save.disabled = false;
    } else {
      for (const panel of steps) panel.disabled = true;
      ui.chooseTask.focus();
    }
  }

  function openEditor(item = null) {
    if (item?.taskId || (item ? !canUpdate : !canCreate)) return;
    editingId = item?.id || '';
    editingVersion = item?.updatedAt || '';
    ui.form.reset();
    ui.editorTitle.textContent = item ? 'Editar acompanhamento' : 'Novo acompanhamento';
    for (const name of ['title', 'description', 'dueAt', 'socialChannel', 'desiredReach', 'estimatedReach', 'referenceUrl']) {
      field(name).value = item?.[name] ?? '';
    }
    field('status').value = item?.status || 'open';
    field('priority').value = item?.priority || 'normal';
    checklist = (item?.checklist || []).map(entry => ({ ...entry }));
    updateChannelIcons();
    renderChecklist();
    ui.back.textContent = item ? 'Cancelar' : 'Voltar';
    ui.editor.showModal();
    setMode(item ? 'standalone' : '');
  }

  function renderTaskChoices() {
    const linked = new Set([...items.values()].map(item => item.taskId));
    const selected = ui.taskSelect.value;
    const choices = [...tasks.values()].filter(item => !linked.has(item.id));
    ui.taskSelect.replaceChildren(new Option(loadingTasks && !choices.length ? 'Carregando tarefas…' : 'Selecione uma tarefa', ''),
      ...choices.map(task => new Option(selectTaskName(task), task.id)));
    if (choices.some(task => task.id === selected)) ui.taskSelect.value = selected;
    ui.taskSelect.disabled = mode !== 'task' || (loadingTasks && !choices.length);
    ui.moreTasks.hidden = !tasksMore;
    ui.moreTasks.disabled = loadingTasks;
    ui.save.disabled = saving || !ui.taskSelect.value;
    const selectedTask = tasks.get(ui.taskSelect.value);
    ui.taskSummary.replaceChildren();
    if (selectedTask) {
      const details = [];
      if (selectedTask.desiredReach != null) details.push(`Alcance desejado ${reachLabel(selectedTask.desiredReach)}`);
      if (selectedTask.estimatedReach != null) details.push(`Alcance estimado ${reachLabel(selectedTask.estimatedReach)}`);
      ui.taskSummary.textContent = details.join(' · ');
    } else if (!loadingTasks && !choices.length && taskPage) ui.taskSummary.textContent = 'Nenhuma tarefa disponível nesta página.';
  }

  async function loadTasks(page) {
    if (loadingTasks) return;
    const current = generation;
    const editor = taskGeneration;
    loadingTasks = true;
    renderTaskChoices();
    try {
      const data = await request(`/work-items?module=marketing&page=${page}`);
      if (current !== generation || editor !== taskGeneration) return;
      for (const item of data.items || []) tasks.set(item.id, item);
      taskPage = page;
      tasksMore = data.hasMore === true;
    } catch (error) {
      if (current === generation && editor === taskGeneration) {
        showError(error, ui.editorError);
        tasksMore = true;
      }
    } finally {
      if (current === generation && editor === taskGeneration) {
        loadingTasks = false;
        if (mode === 'task') renderTaskChoices();
      }
    }
  }

  function standalonePayload() {
    return {
      title: field('title').value.trim(), description: field('description').value.trim(),
      priority: field('priority').value, status: field('status').value, dueAt: field('dueAt').value || null,
      socialChannel: field('socialChannel').value, referenceUrl: field('referenceUrl').value.trim(),
      desiredReach: field('desiredReach').value === '' ? null : field('desiredReach').valueAsNumber,
      estimatedReach: field('estimatedReach').value === '' ? null : field('estimatedReach').valueAsNumber,
      checklist: checklist.map(({ id, title, done }) => ({ ...(id ? { id } : {}), title, done })),
    };
  }

  function renderDetails(item) {
    ui.detailTitle.textContent = item.title;
    ui.detailBody.replaceChildren();
    const status = node('p', 'mm-detail-context', `${STATUSES[item.status] || STATUSES.open} · Prioridade ${PRIORITIES[item.priority]?.toLocaleLowerCase('pt-BR') || 'normal'}${item.dueAt ? ` · Prazo ${dateLabel(item.dueAt)}` : ''}`);
    ui.detailBody.append(status);
    const channel = marketingChannelBadge(item.socialChannel);
    if (channel) ui.detailBody.append(channel);
    if (item.description) ui.detailBody.append(node('p', 'mm-prose', item.description));
    const actions = node('div', 'mm-actions mm-detail-actions');
    if (item.taskId) actions.append(anchor('Abrir tarefa vinculada', `/setor/marketing?painel=tasks&atividade=${encodeURIComponent(item.taskId)}`));
    const url = safePostUrl(item.referenceUrl);
    if (url) {
      const post = anchor('Abrir post', url);
      post.target = '_blank';
      post.rel = 'noopener noreferrer';
      actions.append(post);
    }
    if (canUpdate && !item.taskId) {
      const edit = button('Editar acompanhamento');
      edit.addEventListener('click', () => { ui.detail.close(); openEditor(item); });
      actions.append(edit);
    }
    if (actions.children.length) ui.detailBody.append(actions);
    if (item.checklist?.length) {
      const list = node('ul', 'mm-detail-checks');
      for (const entry of item.checklist) {
        const check = node('input');
        check.type = 'checkbox';
        check.checked = entry.done;
        check.disabled = true;
        const line = node('li');
        const label = node('label');
        label.append(check, node('span', '', entry.title));
        line.append(label);
        list.append(line);
      }
      ui.detailBody.append(node('h3', '', 'Checklist'), list);
    }
    const history = readingsFor(item);
    const totals = node('div', 'mm-detail-summary');
    totals.append(metricSummary('Alcance desejado', reachLabel(item.desiredReach), ''),
      metricSummary('Alcance estimado', reachLabel(item.estimatedReach), ''),
      metricSummary('Última medição', reachLabel(history.at(-1)?.actualReach), history.length ? dateLabel(history.at(-1).date) : 'Sem medição'));
    ui.detailBody.append(totals, node('h3', '', 'Histórico de medições'));
    if (history.length) {
      if (history.length === READING_LIMIT) ui.detailBody.append(node('p', 'mm-helper', `Exibindo as ${READING_LIMIT} medições mais recentes.`));
      renderHistory(history);
    }
    else ui.detailBody.append(node('p', 'mm-helper', 'Nenhum alcance real registrado.'));
    if (canUpdate) renderReadingForm(item);
  }

  function renderHistory(history) {
    const tableWrap = node('div', 'mm-history-wrap');
    const table = node('table', 'mm-reading-table');
    const head = table.createTHead().insertRow();
    for (const label of ['Data', 'Alcance real', 'Variação']) {
      const col = node('th', '', label);
      col.scope = 'col';
      head.append(col);
    }
    const rows = table.createTBody();
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const { date, actualReach } = history[index];
      const previous = history[index - 1];
      const row = rows.insertRow();
      row.insertCell().textContent = dateLabel(date);
      row.insertCell().textContent = reachLabel(actualReach);
      row.insertCell().textContent = previous ? deltaLabel(actualReach - previous.actualReach) : '—';
    }
    tableWrap.append(table);
    ui.detailBody.append(tableWrap);
  }

  function renderReadingForm(item) {
    const form = node('form', 'mm-reading-form');
    form.innerHTML = `
      <h3>Registrar alcance real</h3>
      <p class="mm-helper">Uma medição por data. Salvar para a mesma data atualiza o valor.</p>
      <div class="mm-reading-fields">
        <label class="mm-field">Data da medição<input name="date" type="date" required></label>
        <label class="mm-field">Alcance real<input name="actualReach" type="number" min="0" max="${MAX_REACH}" step="1" inputmode="numeric" required></label>
      </div>
      <p class="mm-error" data-reading-error role="alert" hidden></p>
      <button type="submit" class="mm-button mm-primary">Salvar medição</button>`;
    const date = form.elements.namedItem('date');
    date.value = LOCAL_DATE.format(new Date());
    date.max = date.value;
    date.min = '2000-01-01';
    const save = form.querySelector('button');
    const errorBox = form.querySelector('[data-reading-error]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (readingPending || !ui.detail.open) return;
      const current = generation;
      readingPending = true;
      save.disabled = true;
      ui.closeDetail.disabled = true;
      message(errorBox);
      try {
        const body = { date: date.value, actualReach: form.elements.namedItem('actualReach').valueAsNumber };
        const data = await request(`${PATH}/${encodeURIComponent(item.id)}/readings`, { method: 'PUT', body });
        if (current !== generation) return;
        items.set(data.item.id, data.item);
        message(ui.notice, 'Medição salva.');
        renderList();
        if (ui.detail.open) {
          renderDetails(data.item);
          const success = node('p', 'mm-feedback', 'Medição salva.');
          success.setAttribute('role', 'status');
          ui.detailBody.prepend(success);
          ui.closeDetail.focus();
        }
      } catch (error) {
        if (current === generation) showError(error, errorBox);
      } finally {
        if (current === generation) {
          readingPending = false;
          ui.closeDetail.disabled = false;
          save.disabled = false;
        }
      }
    });
    ui.detailBody.append(form);
  }

  function openDetails(item) {
    renderDetails(item);
    ui.detail.showModal();
    ui.closeDetail.focus();
  }

  ui.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || !mode || !ui.editor.open) return;
    if (mode === 'standalone' && step === 0 && field('title').value.trim().length < 3) {
      message(ui.editorError, 'Informe um título com pelo menos três caracteres.');
      field('title').focus();
      return;
    }
    if (mode === 'standalone' && step < steps.length - 1) {
      message(ui.editorError);
      showStep(step + 1);
      return;
    }
    if (mode === 'task' && !ui.taskSelect.value) return;
    if (mode === 'standalone' && ui.checkTitle.value.trim()) addChecklistItem();
    const current = generation;
    const body = mode === 'task' ? { taskId: ui.taskSelect.value } : standalonePayload();
    if (editingId && editingVersion) body.expectedUpdatedAt = editingVersion;
    if (body.referenceUrl && !safePostUrl(body.referenceUrl)) {
      message(ui.editorError, 'Use um link HTTPS para o post.');
      field('referenceUrl').focus();
      return;
    }
    saving = true;
    ui.save.disabled = ui.back.disabled = ui.closeEditor.disabled = true;
    message(ui.editorError);
    try {
      const url = editingId ? `${PATH}/${encodeURIComponent(editingId)}` : PATH;
      const data = await request(url, { method: editingId ? 'PATCH' : 'POST', body });
      if (current !== generation) return;
      items.set(data.item.id, data.item);
      ui.editor.close();
      message(ui.notice, 'Acompanhamento salvo.');
      renderList();
      openDetails(data.item);
    } catch (error) {
      if (current === generation) showError(error, ui.editorError);
    } finally {
      if (current === generation) {
        saving = false;
        ui.save.disabled = ui.back.disabled = ui.closeEditor.disabled = false;
      }
    }
  });

  ui.chooseTask.addEventListener('click', () => setMode('task'));
  ui.chooseNew.addEventListener('click', () => setMode('standalone'));
  ui.back.addEventListener('click', () => {
    message(ui.editorError);
    if (mode === 'standalone' && step) showStep(step - 1);
    else if (editingId) ui.editor.close();
    else setMode('');
  });
  ui.new.addEventListener('click', () => openEditor());
  ui.closeEditor.addEventListener('click', () => ui.editor.close());
  ui.closeDetail.addEventListener('click', () => ui.detail.close());
  ui.editor.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
  ui.detail.addEventListener('cancel', (event) => { if (readingPending) event.preventDefault(); });
  ui.editor.addEventListener('close', () => { taskGeneration += 1; loadingTasks = false; });
  ui.taskSelect.addEventListener('change', renderTaskChoices);
  ui.moreTasks.addEventListener('click', () => void loadTasks(taskPage + 1));
  ui.more.addEventListener('click', () => void load(page + 1));
  ui.refresh.addEventListener('click', () => { taskPage = 0; tasksMore = false; tasks.clear(); void load(); });
  ui.search.addEventListener('input', renderList);
  ui.filterChannel.addEventListener('change', renderList);
  ui.sort.addEventListener('change', renderList);
  ui.addCheck.addEventListener('click', addChecklistItem);
  ui.checkTitle.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addChecklistItem(); } });
  field('socialChannel').addEventListener('change', updateChannelIcons);

  return {
    open() {
      if (opened) return;
      opened = true;
      generation += 1;
      void load();
    },
    close() {
      if (!opened) return;
      opened = false;
      generation += 1;
      for (const dialog of [ui.editor, ui.detail]) if (dialog.open) dialog.close();
      items.clear();
      tasks.clear();
      taskPage = 0;
      page = 0;
      more = false;
      tasksMore = false;
      loadingTasks = loading = loaded = saving = readingPending = false;
      ui.save.disabled = ui.back.disabled = ui.closeEditor.disabled = ui.closeDetail.disabled = false;
      ui.list.replaceChildren();
      ui.summary.replaceChildren();
      ui.detailBody.replaceChildren();
      ui.form.reset();
      ui.checks.replaceChildren();
      message(ui.notice);
      message(ui.error);
    },
  };
}
