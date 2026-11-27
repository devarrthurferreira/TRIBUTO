import { appendPersonName, personOptionLabel } from './person-name.js';

const MARKETING = 'marketing';
const STATUSES = { open: 'A fazer', in_progress: 'Em andamento', done: 'Concluída' };
const PRIORITIES = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
const WIZARD_STEPS = ['Dados da tarefa', 'Dados de métricas', 'Checklist e link do post'];
export const MARKETING_CHANNELS = {
  linkedin: { title: 'LinkedIn', icons: ['linkedin'] },
  'somos-maximum-instagram': { title: 'Somos Maximum — Instagram', icons: ['instagram'] },
  'somos-maximum-tiktok': { title: 'Somos Maximum — TikTok', icons: ['tiktok'] },
  'maximum-contabil-instagram': { title: 'Maximum Contábil — Instagram', icons: ['instagram'] },
  'maximum-contabil-tiktok': { title: 'Maximum Contábil — TikTok', icons: ['tiktok'] },
  youtube: { title: 'YouTube', icons: ['youtube'] },
  'maximum-informa': { title: 'Maximum Informa', icons: ['megaphone'] },
  newsletter: { title: 'Newsletter', icons: ['newspaper'] },
  'somos-maximum': { title: 'Somos Maximum — Plataforma não informada', icons: ['tag'], legacy: true },
  'maximum-contabil': { title: 'Maximum Contábil — Plataforma não informada', icons: ['tag'], legacy: true },
};
const HISTORY_FIELDS = {
  title: 'título', description: 'descrição', status: 'situação', dueAt: 'prazo', assigneeId: 'responsável',
  companyCnpj: 'empresa', priority: 'prioridade', tags: 'tags', checklist: 'checklist', campaign: 'campanha',
  referenceUrl: 'link do post', socialChannel: 'rede social', desiredReach: 'alcance desejado', estimatedReach: 'alcance estimado',
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
  element.append(icon(name), label);
  return element;
}

export function marketingChannelBadge(channel, { label = true } = {}) {
  if (!Object.hasOwn(MARKETING_CHANNELS, channel)) return null;
  const { title, icons } = MARKETING_CHANNELS[channel];
  const badge = node('span', 'mt-channel');
  badge.append(...icons.map(icon));
  if (label) badge.append(document.createTextNode(title));
  else badge.setAttribute('aria-hidden', 'true');
  return badge;
}

export function mountMarketingChannelSelect(select, placeholder, { showLegacy = false } = {}) {
  const customizable = CSS.supports('appearance: base-select') && 'HTMLSelectedContentElement' in window;
  const preview = customizable ? null : node('span', 'mt-channel-fallback');
  if (customizable) select.classList.add('mt-channel-select');
  else {
    select.before(preview);
    select.addEventListener('change', showSelectedIcon);
  }

  function showSelectedIcon() {
    if (!preview) return;
    const badge = marketingChannelBadge(select.value, { label: false });
    preview.replaceChildren(...(badge ? [badge] : []));
    preview.hidden = !badge;
  }

  return function setChannelOptions(value = '') {
    const options = Object.entries(MARKETING_CHANNELS).filter(([key, channel]) => !channel.legacy || showLegacy || value === key);
    const children = [new Option(placeholder, '')];
    if (customizable) {
      const button = node('button');
      button.type = 'button';
      button.append(node('selectedcontent'));
      children.unshift(button);
    }
    for (const [key, channel] of options) {
      const option = new Option(channel.title, key);
      if (customizable) {
        const content = node('span', 'mt-channel-option');
        content.append(...channel.icons.map(icon), node('span', '', channel.title));
        option.replaceChildren(content);
      }
      children.push(option);
    }
    select.replaceChildren(...children);
    select.value = options.some(([key]) => key === value) ? value : '';
    showSelectedIcon();
  };
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
  const channel = marketingChannelBadge(item.socialChannel);
  if (channel || item.tags?.length) {
    const tags = node('span', 'mt-tags');
    if (channel) tags.append(channel);
    for (const tag of item.tags || []) tags.append(node('span', 'mt-tag', tag));
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
  const assignedName = assignee ? appendPersonName(node('span'), assignee.name, assignee.tenureYears)
    : item.assigneeId ? 'Responsável indisponível' : 'Sem responsável';
  const person = node('span', 'mt-person');
  const initials = assignee ? String(assignee.name || '').trim().split(/\s+/).slice(0,2).map(word => word[0]).join('').toUpperCase() : '–';
  const avatar = node('span', 'mt-person-avatar', initials);
  avatar.setAttribute('aria-hidden', 'true');
  person.append(avatar, assignedName);
  footer.append(person);
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
      <form class="mt-dialog-form" data-mt="form" method="dialog" novalidate>
        <header class="mt-dialog-header">
          <div><p class="mt-eyebrow">Marketing</p><h2 id="marketingTaskDialogTitle" data-mt="dialogTitle"></h2></div>
          <button type="button" class="mt-icon-button" data-mt="close" aria-label="Fechar tarefa">×</button>
        </header>
        <ol class="mt-steps" data-mt="steps" aria-label="Etapas da tarefa" hidden>
          ${WIZARD_STEPS.map((name, index) => `<li><button type="button" data-mt-step="${index}" aria-controls="marketingTaskStep${index + 1}"><span class="mt-step-number" aria-hidden="true">${index + 1}</span><span>${name}</span></button></li>`).join('')}
        </ol>
        <div class="mt-dialog-body" data-mt="dialogBody">
          <p class="mt-feedback" data-mt="loadingDetails" role="status" hidden>Carregando tarefa…</p>
          <fieldset data-mt="fieldSet" class="mt-dialog-fields">
            <section id="marketingTaskStep1" class="mt-dialog-step" aria-labelledby="marketingTaskStep1Title">
              <h3 id="marketingTaskStep1Title" tabindex="-1">Dados da tarefa</h3>
              <div class="mt-form-grid">
                <label class="mt-field mt-wide">Título<input name="title" required minlength="3" maxlength="200" placeholder="Ex. Agendar posts da semana"></label>
                <div class="mt-field"><label for="marketingTaskPriority">Prioridade</label><select id="marketingTaskPriority" name="priority"></select></div>
                <div class="mt-field"><label for="marketingTaskStatus">Status</label><select id="marketingTaskStatus" name="status"></select></div>
                <label class="mt-field mt-wide">Prazo<input type="date" name="dueAt"></label>
                <label class="mt-field mt-wide">Descrição<textarea name="description" rows="4" maxlength="2000" placeholder="Inclua o contexto e as orientações da tarefa"></textarea></label>
              </div>
              <details class="mt-task-organization" data-mt="organization">
                <summary>Organização da tarefa</summary>
                <div class="mt-form-grid">
                  <div class="mt-field"><label for="marketingTaskAssignee">Responsável</label><select id="marketingTaskAssignee" name="assigneeId"></select></div>
                  <div class="mt-field"><label for="marketingTaskCompany">Empresa</label><select id="marketingTaskCompany" name="companyCnpj"></select></div>
                  <label class="mt-field mt-wide">Campanha<input name="campaign" maxlength="120" placeholder="Ex. Planejamento mensal"></label>
                  <div class="mt-field mt-wide"><label for="marketingTaskTags">Tags</label><input id="marketingTaskTags" name="tags" maxlength="416" placeholder="Ex. redes sociais, aprovação" aria-describedby="marketingTaskTagsHelp"><small id="marketingTaskTagsHelp">Separe as tags por vírgula.</small></div>
                </div>
              </details>
            </section>
            <section id="marketingTaskStep2" class="mt-dialog-step" aria-labelledby="marketingTaskStep2Title" hidden>
              <h3 id="marketingTaskStep2Title" tabindex="-1">Dados de métricas</h3>
              <div class="mt-form-grid">
                <div class="mt-field mt-wide">
                  <label for="marketingTaskSocialChannel">Rede social</label>
                  <span class="mt-channel-picker"><select id="marketingTaskSocialChannel" name="socialChannel"></select></span>
                </div>
                <label class="mt-field">Alcance desejado<input name="desiredReach" type="number" inputmode="numeric" min="0" max="999999999" step="1" placeholder="Ex. 20000"></label>
                <label class="mt-field">Alcance estimado<input name="estimatedReach" type="number" inputmode="numeric" min="0" max="999999999" step="1" placeholder="Ex. 15000"></label>
              </div>
            </section>
            <section id="marketingTaskStep3" class="mt-dialog-step" aria-labelledby="marketingTaskStep3Title" hidden>
              <h3 id="marketingTaskStep3Title" tabindex="-1">Checklist e link do post</h3>
              <section class="mt-checklist" aria-labelledby="marketingChecklistTitle">
                <div class="mt-checklist-heading"><h4 id="marketingChecklistTitle">Checklist</h4><span data-mt="checkCount"></span></div>
                <div data-mt="checkRows"></div>
                <div class="mt-check-add" data-mt="checkAddBox">
                  <label class="mt-field"><span class="sr-only">Novo item do checklist</span><input data-mt="checkInput" maxlength="140" placeholder="Novo item do checklist"></label>
                  <button type="button" class="mt-secondary" data-mt="checkAdd">Adicionar item</button>
                </div>
              </section>
              <label class="mt-field">Link do post<input type="url" name="referenceUrl" maxlength="1000" placeholder="https://"></label>
              <a class="mt-reference" data-mt="reference" target="_blank" rel="noopener noreferrer" hidden>Abrir link do post <span aria-hidden="true">↗</span></a>
              <div class="mt-share" data-mt="share" hidden>
                <button type="button" class="mt-secondary" data-mt="copyLink"><i class="bi bi-link-45deg" aria-hidden="true"></i> Copiar link da tarefa</button>
                <input type="text" aria-label="Link da tarefa" data-mt="shareUrl" readonly hidden>
                <p class="mt-feedback" data-mt="shareFeedback" role="status" hidden></p>
              </div>
              <section class="mt-history" data-mt="history" aria-labelledby="marketingTaskHistoryTitle" hidden>
                <h4 id="marketingTaskHistoryTitle">Histórico da tarefa</h4>
                <ol data-mt="historyEntries"></ol>
              </section>
            </section>
          </fieldset>
        </div>
        <p class="mt-error mt-dialog-error" data-mt="dialogError" role="alert" hidden></p>
        <footer class="mt-dialog-footer">
          <button type="button" class="mt-secondary mt-dialog-cancel" data-mt="cancel">Cancelar</button>
          <button type="button" class="mt-secondary" data-mt="back" hidden><i class="bi bi-chevron-left" aria-hidden="true"></i> Voltar</button>
          <button type="button" class="mt-primary" data-mt="next" hidden>Continuar <i class="bi bi-chevron-right" aria-hidden="true"></i></button>
          <button type="submit" class="mt-primary" data-mt="save" hidden>Salvar tarefa</button>
        </footer>
      </form>
    </dialog>`;
  root.replaceChildren(shell);
  return { shell, ui: Object.fromEntries([...shell.querySelectorAll('[data-mt]')].map(el => [el.dataset.mt, el])) };
}

export function mountMarketingTasks(root, { request, companies = [], canCreate, canUpdate, canReassignCompany = false, linkedItemId, onChange } = {}) {
  const { shell, ui } = buildShell(root);
  const field = name => ui.form.elements.namedItem(name);
  const stepButtons = [...ui.steps.querySelectorAll('button')];
  const stepPanels = [...ui.fieldSet.querySelectorAll('.mt-dialog-step')];
  const setChannelOptions = mountMarketingChannelSelect(field('socialChannel'), 'Selecione uma rede');
  const listCompanies = () => typeof companies === 'function' ? companies() || [] : companies;
  const items = new Map();
  let teammates = [];
  let page = 0, more = false, loading = false, disposed = false;
  let activeItem = null, editing = false, saving = false, checklist = [], detailsRequest = 0, openTaskId = '';
  let draggedId = '', moving = false;
  function clearDrag() {
    draggedId = '';
    for (const el of ui.board.querySelectorAll('.mt-dragging,.mt-drop-target')) el.classList.remove('mt-dragging','mt-drop-target');
  }
  async function moveTask(id, status) {
    const prior = items.get(id);
    clearDrag();
    if (!canUpdate || !prior || !Object.hasOwn(STATUSES, status) || prior.status === status || saving || moving || loading || disposed) return;
    moving = true;
    ui.board.setAttribute('aria-busy','true');
    message(ui.error);
    try {
      const { item } = await request('/work-items/' + encodeURIComponent(id), {
        method: 'PATCH', body: { status, expectedUpdatedAt: prior.updatedAt }
      });
      if (disposed) return;
      items.set(item.id,item);
      renderBoard();
      message(ui.feedback, 'Tarefa movida para ' + STATUSES[status] + '.');
      onChange?.();
    } catch (error) {
      if (!disposed) {
        message(ui.error, error.message || 'Não foi possível mover a tarefa.');
        if (error.status === 409) await load(1);
      }
    } finally {
      moving = false;
      if (!disposed) ui.board.removeAttribute('aria-busy');
    }
  }
  let step = 0, visitedStep = 0;

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
    options(ui.assignee, 'Todos', [['unassigned', 'Sem responsável'], ...teammates.map(person => [person.id, personOptionLabel(person)])], ui.assignee.value);
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
      return normalize([item.title, item.description, item.campaign, MARKETING_CHANNELS[item.socialChannel]?.title, company?.name, person?.name, ...(item.tags || [])].join(' ')).includes(filter);
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
      if (canCreate) {
        const add = node('button', 'mt-column-add', '+');
        add.type = 'button';
        add.setAttribute('aria-label', 'Nova tarefa em ' + STATUSES[status]);
        add.disabled = loading && !page;
        add.addEventListener('click', () => startNew(status));
        head.append(add);
      }
      if (canUpdate) {
        column.addEventListener('dragover', event => {
          if (!draggedId || moving || loading || items.get(draggedId)?.status === status) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          column.classList.add('mt-drop-target');
        });
        column.addEventListener('dragleave', event => {
          if (!column.contains(event.relatedTarget)) column.classList.remove('mt-drop-target');
        });
        column.addEventListener('drop', event => {
          if (!draggedId) return;
          event.preventDefault();
          void moveTask(draggedId,status);
        });
      }
      const content = node('div', 'mt-column-content');
      if (!entries.length) content.append(node('p', 'mt-empty', loading && !page ? 'Carregando…' : 'Nenhuma tarefa nesta situação.'));
      else for (const [index,item] of entries.entries()) {
        const card = makeTaskCard(item, { assignees: teammates, companies: portfolio, today, openDetails });
        card.dataset.status = status;
        card.dataset.motion = String(Math.min(index,4));
        if (canUpdate) {
          card.draggable = true;
          card.addEventListener('dragstart', event => {
            if (moving || loading || saving || ui.dialog.open) { event.preventDefault(); return; }
            draggedId = item.id;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', item.id);
            card.classList.add('mt-dragging');
          });
          card.addEventListener('dragend',clearDrag);
        }
        content.append(card);
      }
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
      checkbox.disabled = !editing;
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
      const who = appendPersonName(node('small'), event.actorName, event.actorTenureYears);
      const when = formatDate(event.at, true);
      if (when) who.append(event.actorName ? ` · ${when}` : when);
      entry.append(node('strong', '', text), who);
      ui.historyEntries.append(entry);
    }
  }

  function setOptions(item) {
    for (const [name, values] of [['status', STATUSES], ['priority', PRIORITIES]]) {
      field(name).replaceChildren(...Object.entries(values).map(([value, label]) => new Option(label, value)));
    }
    const assigneeOptions = teammates.map(person => [person.id, personOptionLabel(person)]);
    if (item?.assigneeId && !assigneeOptions.some(([id]) => id === item.assigneeId)) assigneeOptions.push([item.assigneeId, 'Responsável indisponível']);
    options(field('assigneeId'), 'Sem responsável', assigneeOptions);
    const companyOptions = listCompanies().map(company => [company.cnpj, companyLabel(company)]);
    if (item?.companyCnpj && !companyOptions.some(([cnpj]) => cnpj === item.companyCnpj)) companyOptions.push([item.companyCnpj, 'Empresa vinculada']);
    options(field('companyCnpj'), 'Atividade interna', companyOptions);
    setChannelOptions(item?.socialChannel);
  }

  function renderStep(index, focus = false) {
    step = index;
    visitedStep = Math.max(visitedStep, index);
    for (const [position, control] of stepButtons.entries()) {
      const current = position === index;
      if (current) control.setAttribute('aria-current', 'step');
      else control.removeAttribute('aria-current');
      control.disabled = saving || position > visitedStep;
      stepPanels[position].hidden = !current;
    }
    ui.back.hidden = index === 0;
    ui.next.hidden = index === stepPanels.length - 1;
    ui.save.hidden = !editing || !ui.next.hidden;
    ui.dialogBody.scrollTop = 0;
    if (focus) stepPanels[index].querySelector('h3').focus({ preventScroll: true });
  }

  function inputTags() {
    return [...new Map(field('tags').value.split(/[;,]/).map(value => value.trim()).filter(Boolean).map(value => [normalize(value), value])).values()];
  }

  function invalidField(index) {
    if (index === 0) {
      if (field('title').value.trim().length < 3) return ['title', 'Informe um título com pelo menos 3 caracteres.'];
      if (!field('dueAt').validity.valid) return ['dueAt', 'Informe uma data de prazo válida.'];
      const tags = inputTags();
      if (tags.length > 12 || tags.some(tag => tag.length > 32)) return ['tags', 'Use até 12 tags, com no máximo 32 caracteres cada.'];
    }
    if (index === 1) {
      for (const name of ['desiredReach', 'estimatedReach']) {
        if (!field(name).validity.valid) return [name, 'Informe um alcance inteiro entre 0 e 999.999.999.'];
      }
    }
    if (index === 2) {
      const value = field('referenceUrl').value.trim();
      const href = safeUrl(value);
      if (value && (!href || href.length > 1000)) return ['referenceUrl', 'Informe um link HTTPS válido para o post.'];
    }
    return null;
  }

  function validateStep(index) {
    const invalid = editing && invalidField(index);
    if (!invalid) return true;
    const [name, error] = invalid;
    if (step !== index) renderStep(index);
    if (name === 'tags') ui.organization.open = true;
    message(ui.dialogError, error);
    field(name).focus();
    return false;
  }

  function moveStep(index) {
    if (saving || ui.steps.hidden || index < 0 || index >= stepPanels.length || index === step) return;
    message(ui.dialogError);
    for (let position = step; position < index; position++) {
      if (!validateStep(position)) return;
    }
    renderStep(index, true);
  }

  function renderForm(item = null, history = []) {
    activeItem = item;
    editing = item ? Boolean(canUpdate) : Boolean(canCreate);
    ui.dialogTitle.textContent = item ? (editing ? 'Editar tarefa' : 'Detalhes da tarefa') : 'Nova tarefa';
    ui.fieldSet.hidden = false;
    ui.fieldSet.disabled = false;
    for (const control of ui.form.elements) {
      if (control.name) control.disabled = !editing;
    }
    ui.loadingDetails.hidden = true;
    ui.steps.hidden = false;
    ui.cancel.textContent = editing ? 'Cancelar' : 'Fechar';
    ui.save.disabled = false;
    ui.save.textContent = item ? 'Salvar alterações' : 'Salvar tarefa';
    message(ui.dialogError);
    setOptions(item);
    for (const name of ['title', 'description', 'dueAt', 'assigneeId', 'companyCnpj', 'campaign', 'referenceUrl']) field(name).value = item?.[name] || '';
    for (const name of ['desiredReach', 'estimatedReach']) field(name).value = item?.[name] ?? '';
    field('status').value = item?.status || 'open';
    field('priority').value = item?.priority || 'normal';
    field('companyCnpj').disabled = !editing || Boolean(item && !canReassignCompany);
    field('tags').value = item?.tags?.join(', ') || '';
    ui.organization.open = Boolean(item?.assigneeId || item?.companyCnpj || item?.campaign || item?.tags?.length);
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
    visitedStep = item ? stepPanels.length - 1 : 0;
    renderStep(0);
  }

  function startNew(status = 'open') {
    if (!canCreate || saving || moving || ui.dialog.open) return;
    openTaskId = '';
    renderForm();
    if (typeof status === 'string' && Object.hasOwn(STATUSES,status)) field('status').value = status;
    ui.dialog.showModal();
    field('title').focus();
  }

  async function openDetails(id) {
    if (disposed || moving || !TASK_ID.test(id) || ui.dialog.open) return;
    const serial = ++detailsRequest;
    openTaskId = id;
    ui.dialogTitle.textContent = 'Detalhes da tarefa';
    editing = false;
    ui.steps.hidden = ui.fieldSet.hidden = ui.back.hidden = ui.next.hidden = ui.save.hidden = true;
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
    if (ui.checkInput.value.trim()) addChecklistItem();
    return {
      title: values.title.trim(), description: values.description.trim(), status: values.status, priority: values.priority, dueAt: values.dueAt || null,
      assigneeId: values.assigneeId || null,
      companyCnpj: Object.hasOwn(values, 'companyCnpj') ? values.companyCnpj || null : activeItem?.companyCnpj ?? null,
      campaign: values.campaign.trim(),
      socialChannel: values.socialChannel,
      desiredReach: values.desiredReach === '' ? null : field('desiredReach').valueAsNumber,
      estimatedReach: values.estimatedReach === '' ? null : field('estimatedReach').valueAsNumber,
      tags: inputTags(), checklist, referenceUrl: safeUrl(values.referenceUrl.trim()),
    };
  }

  function setSaving(value) {
    saving = value;
    ui.save.disabled = ui.cancel.disabled = ui.close.disabled = ui.back.disabled = ui.next.disabled = value;
    ui.fieldSet.disabled = value;
    for (const [position, control] of stepButtons.entries()) control.disabled = value || position > visitedStep;
    updateCheckCount();
    ui.save.textContent = value ? 'Salvando…' : (activeItem ? 'Salvar alterações' : 'Salvar tarefa');
  }

  async function saveTask(event) {
    event.preventDefault();
    if (!editing || saving) return;
    if (step < stepPanels.length - 1) { moveStep(step + 1); return; }
    message(ui.dialogError);
    if (!stepPanels.every((_, index) => validateStep(index))) return;
    const input = getInput();
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
  ui.back.addEventListener('click', () => moveStep(step - 1));
  ui.next.addEventListener('click', () => moveStep(step + 1));
  for (const [index, control] of stepButtons.entries()) control.addEventListener('click', () => moveStep(index));
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
