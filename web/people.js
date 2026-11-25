const areas = {
  development: {
    title: 'Desempenho e Desenvolvimento',
    intro: 'Defina objetivos, acompanhe suas entregas e registre o que quer desenvolver.',
    icon: 'graph-up', resource: 'goals', listTitle: 'Minhas metas', createLabel: 'Nova meta',
  },
  engagement: {
    title: 'Clima e Engajamento',
    intro: 'Participe das pesquisas de clima e acompanhe os resultados da equipe.',
    icon: 'chat-square-text', resource: 'surveys', listTitle: 'Pesquisas de clima', createLabel: 'Nova pesquisa',
  },
};
const goalStatuses = { planned: 'Planejada', in_progress: 'Em andamento', done: 'Concluída' };
const ratingLabels = ['Muito baixo', 'Baixo', 'Regular', 'Bom', 'Muito bom'];
const localDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const displayDay = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', dateStyle: 'medium' });
const formatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function glyph(name) {
  const element = node('i', `bi bi-${name}`);
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function button(label, kind = '', icon) {
  const element = node('button', `people-button${kind ? ` people-button-${kind}` : ''}`);
  element.type = 'button';
  if (icon) element.append(glyph(icon));
  element.append(document.createTextNode(label));
  return element;
}

function field(label, name, type, value = '', attributes = {}) {
  const wrapper = node('label', 'people-field');
  const caption = node('span', '', label);
  const input = node(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type;
  input.name = name;
  input.value = value ?? '';
  for (const [attribute, setting] of Object.entries(attributes)) input[attribute] = setting;
  wrapper.append(caption, input);
  return wrapper;
}

function stat(label, value) {
  const element = node('div', 'people-stat');
  element.append(node('span', '', label), node('strong', '', value));
  return element;
}

function state(label, kind) {
  const element = node('span', 'people-state', label);
  element.dataset.state = kind;
  return element;
}

function progress(value, maximum, label) {
  const meter = node('progress', 'people-progress');
  meter.value = value;
  meter.max = maximum;
  meter.setAttribute('aria-label', label);
  return meter;
}

function goalCard(item, onEdit) {
  const card = node('article', 'people-card');
  const title = node('h3', '', item.title);
  const head = node('div', 'people-card-head');
  head.append(title, state(goalStatuses[item.status], item.status));
  card.append(head);
  if (item.description) card.append(node('p', 'people-description', item.description));
  const overdue = item.dueAt && item.status !== 'done' && item.dueAt < localDay.format(new Date());
  const detail = node('div', 'people-meta');
  detail.append(glyph('clock-history'));
  detail.append(document.createTextNode(item.dueAt ? `${overdue ? 'Prazo vencido' : 'Prazo'} · ${displayDay.format(new Date(`${item.dueAt}T12:00:00Z`))}` : 'Sem prazo definido'));
  if (overdue) detail.dataset.overdue = 'true';
  card.append(detail);
  const meter = node('div', 'people-meter');
  const labels = node('div');
  labels.append(node('span', '', 'Progresso'), node('strong', '', `${item.progress}%`));
  meter.append(labels, progress(item.progress, 100, `Progresso da meta ${item.title}`));
  card.append(meter);
  const actions = node('div', 'people-card-actions');
  const edit = button('Editar meta');
  edit.setAttribute('aria-label', `Editar meta ${item.title}`);
  edit.addEventListener('click', () => onEdit(item));
  actions.append(edit);
  card.append(actions);
  return card;
}

function surveyResults(item) {
  const result = node('div', 'people-results');
  const title = node('div', 'people-results-heading');
  title.append(node('strong', '', `${formatter.format(item.results.average)} / 5`),
    node('span', '', `${item.results.count} respostas`));
  result.append(title);
  for (const [index, count] of item.results.distribution.entries()) {
    const line = node('div', 'people-result-row');
    const label = `${index + 1} · ${ratingLabels[index]}`;
    line.append(node('span', '', label), progress(count, item.results.count, `${label}: ${count} respostas`),
      node('span', 'people-result-count', count));
    result.append(line);
  }
  return result;
}

function surveyCard(item, { isAdmin, minResponses, onAnswer, onClose }) {
  const card = node('article', 'people-card');
  const open = item.status === 'open';
  const head = node('div', 'people-card-head');
  head.append(node('h3', '', item.title), state(open ? 'Aberta' : 'Encerrada', open ? 'in_progress' : 'planned'));
  card.append(head, node('p', 'people-description', item.question));
  if (item.results) card.append(surveyResults(item));
  else if (!open) card.append(node('p', 'people-privacy-note', `Resultados disponíveis somente a partir de ${minResponses} respostas.`));
  if (item.myRating != null) {
    const detail = node('p', 'people-meta');
    detail.append(glyph('check2'), document.createTextNode(`Sua resposta · ${item.myRating} de 5`));
    card.append(detail);
  }
  if (open) {
    const actions = node('div', 'people-card-actions');
    const answer = button(item.myRating == null ? 'Responder' : 'Alterar resposta', 'primary', 'chat-dots');
    answer.setAttribute('aria-label', `${item.myRating == null ? 'Responder' : 'Alterar resposta de'} ${item.title}`);
    answer.addEventListener('click', () => onAnswer(item));
    actions.append(answer);
    if (isAdmin) {
      const end = button('Encerrar pesquisa');
      end.setAttribute('aria-label', `Encerrar pesquisa ${item.title}`);
      end.addEventListener('click', () => onClose(item));
      actions.append(end);
    }
    card.append(actions);
  }
  return card;
}

export function mountPeople(root, { request, onAuthError }) {
  root.classList.add('people-workspace');
  root.innerHTML = `
    <header class="people-hero">
      <div class="people-hero-content">
        <div class="people-hero-mark" data-people="heroIcon" aria-hidden="true"></div>
        <h1 data-people="title"></h1>
        <p data-people="intro"></p>
      </div>
      <div data-people="heroActions"></div>
    </header>
    <div class="people-stats" data-people="stats" hidden></div>
    <section class="people-list" aria-labelledby="peopleListTitle">
      <header class="people-list-header">
        <div><h2 id="peopleListTitle" data-people="listTitle"></h2><p data-people="privacy"></p></div>
        <label class="people-filter" data-people="filterToggle" hidden>
          <span class="sr-only">Filtrar metas por status</span><select data-people="filter">
            <option value="all">Todos os status</option>
            <option value="planned">Planejadas</option>
            <option value="in_progress">Em andamento</option>
            <option value="done">Concluídas</option>
          </select>
        </label>
      </header>
      <p class="people-feedback" data-people="feedback" role="status" hidden></p>
      <div class="people-content" data-people="content"></div>
    </section>
    <dialog class="people-dialog" aria-labelledby="peopleDialogTitle" data-people="dialog">
      <form data-people="form">
        <header class="people-dialog-header">
          <h2 id="peopleDialogTitle" data-people="dialogTitle"></h2>
          <button type="button" class="people-icon-button" data-people="dialogClose" aria-label="Fechar"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </header>
        <div class="people-fields" data-people="fields"></div>
        <p class="people-error" data-people="error" role="alert" hidden></p>
        <footer class="people-dialog-actions">
          <button type="button" class="people-button" data-people="cancel">Cancelar</button>
          <button type="submit" class="people-button people-button-primary" data-people="submit">Salvar</button>
        </footer>
      </form>
    </dialog>`;
  const ui = Object.fromEntries(Array.from(root.querySelectorAll('[data-people]'), element => [element.dataset.people, element]));

  let currentArea;
  let admin = false;
  let requestVersion = 0;
  let items = [];
  let loaded = false;
  let minResponses = 3;
  let editAction;
  let busy = false;

  function clearBusy() {
    busy = false;
    ui.submit.disabled = ui.cancel.disabled = ui.dialogClose.disabled = false;
  }

  function showFeedback(text) {
    ui.feedback.textContent = text;
    ui.feedback.hidden = !text;
  }

  function renderEmpty(title, message, retry = false) {
    const element = node('div', 'people-empty');
    const stamp = node('span', 'people-empty-mark');
    stamp.append(glyph(areas[currentArea].icon));
    element.append(stamp, node('strong', '', title));
    if (message) element.append(node('p', '', message));
    if (retry) {
      const refresh = button('Tentar novamente', '', 'arrow-clockwise');
      refresh.addEventListener('click', load);
      element.append(refresh);
    }
    ui.content.replaceChildren(element);
  }

  function renderItems() {
    if (!loaded) return;
    const development = currentArea === 'development';
    ui.stats.hidden = false;
    ui.filterToggle.hidden = !development || !items.length;
    if (development) {
      const count = name => items.filter(item => item.status === name).length;
      const average = items.length ? Math.round(items.reduce((sum, item) => sum + item.progress, 0) / items.length) : 0;
      ui.stats.replaceChildren(stat('Metas pessoais', items.length), stat('Em andamento', count('in_progress')),
        stat('Concluídas', count('done')), stat('Progresso médio', items.length ? `${average}%` : '—'));
    } else {
      const openCount = items.filter(item => item.status === 'open').length;
      ui.stats.replaceChildren(stat('Pesquisas abertas', openCount), stat('Suas participações', items.filter(item => item.myRating != null).length),
        stat('Pesquisas encerradas', items.length - openCount));
    }
    const filter = development ? ui.filter.value : 'all';
    const visible = items.filter(item => filter === 'all' || item.status === filter);
    if (!visible.length) {
      if (filter !== 'all') renderEmpty('Nenhuma meta com este status', 'Use o filtro para ver outras metas.');
      else if (development) renderEmpty('Seu plano começa aqui', 'Crie sua primeira meta de desenvolvimento.');
      else renderEmpty('Nenhuma pesquisa de clima', 'As pesquisas da equipe aparecem aqui quando forem abertas.');
      return;
    }
    const grid = node('div', 'people-cards');
    for (const item of visible) {
      grid.append(development ? goalCard(item, openGoal) : surveyCard(item, { isAdmin: admin, minResponses, onAnswer: openAnswer, onClose: openCloseSurvey }));
    }
    ui.content.replaceChildren(grid);
  }

  function renderPrivacy() {
    ui.privacy.textContent = currentArea === 'development' ? 'Suas metas aparecem apenas na sua conta.'
      : `O painel exibe sua própria nota. Os resultados agrupados aparecem após o encerramento, a partir de ${minResponses} respostas.`;
  }

  function applyLayout() {
    const area = areas[currentArea];
    const development = currentArea === 'development';
    root.dataset.peopleArea = currentArea;
    ui.title.textContent = area.title;
    ui.intro.textContent = area.intro;
    ui.heroIcon.replaceChildren(glyph(area.icon));
    ui.listTitle.textContent = area.listTitle;
    renderPrivacy();
    ui.heroActions.replaceChildren();
    if (development || admin) {
      const create = button(area.createLabel, 'primary');
      create.addEventListener('click', () => development ? openGoal() : openSurvey());
      ui.heroActions.append(create);
    }
  }

  async function load() {
    const version = ++requestVersion;
    loaded = false;
    ui.stats.hidden = ui.filterToggle.hidden = true;
    ui.content.setAttribute('aria-busy', 'true');
    renderEmpty('Carregando…');
    try {
      const data = await request(`/people/${areas[currentArea].resource}`);
      if (version !== requestVersion) return;
      items = data.items;
      minResponses = data.minResponses ?? 3;
      loaded = true;
      renderPrivacy();
      renderItems();
    } catch (error) {
      if (version !== requestVersion) return;
      if (error.status === 401) onAuthError?.(error);
      else renderEmpty('Não foi possível carregar esta área', error.message, true);
    } finally {
      if (version === requestVersion) ui.content.setAttribute('aria-busy', 'false');
    }
  }

  function openDialog({ title, elements, submit, action, success, validate }) {
    editAction = { action, success, validate };
    clearBusy();
    ui.error.hidden = true;
    ui.dialogTitle.textContent = title;
    ui.submit.textContent = submit;
    ui.fields.replaceChildren(...elements);
    ui.dialog.showModal();
    ui.fields.querySelector('input, textarea')?.focus();
  }

  function openGoal(item) {
    openDialog({
      title: item ? 'Editar meta de desenvolvimento' : 'Nova meta de desenvolvimento',
      elements: [
        field('Título', 'title', 'text', item?.title, { required: true, maxLength: 160 }),
        field('Descrição', 'description', 'textarea', item?.description, { maxLength: 2000, rows: 4 }),
        field('Prazo', 'dueAt', 'date', item?.dueAt),
        field('Progresso (%)', 'progress', 'number', item?.progress ?? 0, { required: true, min: 0, max: 100, step: 1 }),
      ],
      submit: 'Salvar meta', success: 'Meta salva.',
      validate: data => {
        if (!data.get('title').trim()) return 'Informe um título para a meta.';
      },
      action: data => request(item ? `/people/goals/${encodeURIComponent(item.id)}` : '/people/goals', {
        method: item ? 'PATCH' : 'POST', body: { title: data.get('title').trim(), description: data.get('description').trim(),
          dueAt: data.get('dueAt') || null, progress: Number(data.get('progress')) },
      }),
    });
  }

  function openSurvey() {
    openDialog({
      title: 'Nova pesquisa de clima',
      elements: [field('Título', 'title', 'text', '', { required: true, maxLength: 160 }),
        field('Pergunta de avaliação', 'question', 'textarea', '', { required: true, maxLength: 300, rows: 3 }),
        node('p', 'people-privacy-note', 'A pesquisa é aberta ao publicar. As respostas usam uma escala de 1 a 5.')],
      submit: 'Publicar pesquisa', success: 'Pesquisa publicada.',
      validate: data => {
        if (!data.get('title').trim() || !data.get('question').trim()) return 'Preencha o título e a pergunta.';
      },
      action: data => request('/people/surveys', { method: 'POST', body: { title: data.get('title').trim(), question: data.get('question').trim() } }),
    });
  }

  function openAnswer(item) {
    const scale = node('fieldset', 'people-scale');
    scale.append(node('legend', '', item.question));
    const choices = node('div', 'people-scale-choices');
    for (const [index, label] of ratingLabels.entries()) {
      const value = index + 1;
      const choice = node('label', 'people-scale-option');
      const input = node('input');
      input.type = 'radio';
      input.name = 'rating';
      input.value = value;
      input.required = true;
      input.checked = item.myRating === value;
      choice.append(input, node('strong', '', value), node('span', '', label));
      choices.append(choice);
    }
    scale.append(choices);
    openDialog({
      title: `Responder ${item.title}`, elements: [scale, node('p', 'people-privacy-note', 'Sua nota individual aparece apenas para você no painel. Você pode alterá-la enquanto a pesquisa estiver aberta.')],
      submit: 'Salvar resposta', success: 'Resposta registrada.',
      action: data => request(`/people/surveys/${encodeURIComponent(item.id)}/response`, { method: 'PUT', body: { rating: Number(data.get('rating')) } }),
    });
  }

  function openCloseSurvey(item) {
    openDialog({
      title: 'Encerrar pesquisa',
      elements: [node('p', 'people-confirmation', `Ao encerrar “${item.title}”, a pesquisa deixa de receber respostas. O encerramento é definitivo.`)],
      submit: 'Encerrar pesquisa', success: 'Pesquisa encerrada.',
      action: () => request(`/people/surveys/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { status: 'closed' } }),
    });
    ui.cancel.focus();
  }

  ui.filter.addEventListener('change', renderItems);
  for (const closeButton of [ui.dialogClose, ui.cancel]) closeButton.addEventListener('click', () => ui.dialog.close());
  ui.dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  ui.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!editAction || busy) return;
    const { action, success, validate } = editAction;
    const input = new FormData(ui.form);
    const errorMessage = validate?.(input);
    ui.error.textContent = errorMessage ?? '';
    ui.error.hidden = !errorMessage;
    if (errorMessage) return;
    const version = requestVersion;
    busy = ui.submit.disabled = ui.cancel.disabled = ui.dialogClose.disabled = true;
    try {
      await action(input);
      if (version !== requestVersion) return;
      ui.dialog.close();
      showFeedback(success);
      void load();
    } catch (error) {
      if (version !== requestVersion) return;
      if (error.status === 401) onAuthError?.(error);
      else {
        ui.error.textContent = error.message || 'Não foi possível concluir a operação.';
        ui.error.hidden = false;
      }
    } finally {
      if (version === requestVersion) clearBusy();
    }
  });

  function close() {
    requestVersion += 1;
    currentArea = undefined;
    admin = false;
    editAction = undefined;
    items = [];
    loaded = false;
    clearBusy();
    if (ui.dialog.open) ui.dialog.close();
    ui.stats.hidden = true;
    ui.stats.replaceChildren();
    ui.fields.replaceChildren();
    ui.content.replaceChildren();
    showFeedback('');
  }

  return {
    open({ area, isAdmin = false }) {
      if (!Object.hasOwn(areas, area) || (currentArea === area && admin === isAdmin)) return;
      close();
      currentArea = area;
      admin = isAdmin;
      ui.filter.value = 'all';
      applyLayout();
      void load();
    },
    close,
  };
}
