const sections = {
  reviews: { title: 'Avaliações', icon: 'journal-text', intro: 'Consulte avaliações registradas e acompanhe as devolutivas.', resource: 'reviews', action: 'Registrar avaliação' },
  'my-reviews': { title: 'Minhas avaliações', icon: 'person-badge', intro: 'Releia as avaliações que você recebeu.', resource: 'reviews' },
  feedback: { title: 'Feedbacks', icon: 'chat-dots', intro: 'Converse em particular sobre entregas, aprendizados e próximos passos.', resource: 'feedback', action: 'Enviar feedback' },
  pdi: { title: 'Planos de Desenvolvimento', icon: 'folder2-open', intro: 'Planeje o que quer desenvolver e acompanhe o andamento dos seus PDIs.', resource: 'plans', action: 'Novo PDI' },
  meetings: { title: 'Reuniões 1:1', icon: 'clock-history', intro: 'Agende conversas individuais e registre o que será tratado.', resource: 'meetings', action: 'Agendar reunião' },
  objectives: { title: 'Objetivos', icon: 'graph-up', intro: 'Defina objetivos e faça check-ins para acompanhar seu progresso.', resource: 'goals', action: 'Novo objetivo' },
  surveys: { title: 'Pesquisas', icon: 'list-task', intro: 'Participe das pesquisas abertas e consulte os resultados disponíveis.', resource: 'surveys', action: 'Publicar pesquisa' },
};
const statuses = {
  planned: 'Planejado', in_progress: 'Em andamento', done: 'Concluído', draft: 'Rascunho', active: 'Vigente', completed: 'Concluído',
  scheduled: 'Agendada', open: 'Aberta', closed: 'Encerrada',
};
const surveyKinds = {
  engagement: 'Pesquisa de engajamento', satisfaction: 'Pesquisa de satisfação', quick_survey: 'Pesquisa rápida', super_survey: 'Super pesquisa',
};
const filters = {
  reviews: { mine: 'Minhas avaliações', all: 'Todas as avaliações' },
  feedback: { all: 'Todos', received: 'Recebidos', sent: 'Enviados' },
  pdi: { all: 'Todos os status', draft: 'Rascunhos', active: 'Vigentes', completed: 'Concluídos' },
  meetings: { all: 'Todas as reuniões', scheduled: 'Agendadas', completed: 'Concluídas' },
  objectives: { all: 'Todos os status', planned: 'Planejados', in_progress: 'Em andamento', done: 'Concluídos' },
  surveys: { all: 'Todas as pesquisas', open: 'Abertas', closed: 'Encerradas' },
};
const dayFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'America/Sao_Paulo' });
const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function glyph(icon) {
  const element = node('i', `bi bi-${icon}`);
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function button(label, action, { primary = false, icon, subject } = {}) {
  const element = node('button', `people-button${primary ? ' people-button-primary' : ''}`);
  element.type = 'button';
  if (subject) element.setAttribute('aria-label', `${label} · ${subject}`);
  if (icon) element.append(glyph(icon));
  element.append(document.createTextNode(label));
  element.addEventListener('click', action);
  return element;
}

function day(value) {
  if (!value) return '';
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isFinite(parsed.getTime()) ? dayFormat.format(parsed) : '';
}

function field(label, name, type, { value = '', choices, ...attributes } = {}) {
  const wrapper = node('label', 'people-field');
  const control = node(choices ? 'select' : type === 'textarea' ? 'textarea' : 'input');
  if (control.tagName === 'INPUT') control.type = type;
  if (choices) for (const [optionValue, title] of Object.entries(choices)) control.add(new Option(title, optionValue));
  control.name = name;
  control.value = value ?? '';
  Object.assign(control, attributes);
  wrapper.append(node('span', '', label), control);
  return wrapper;
}

function text(data, name) { return String(data.get(name) ?? '').trim(); }
function description(value) { return node('p', 'people-description', value); }

function meta(icon, label) {
  const element = node('p', 'people-meta');
  element.append(glyph(icon), document.createTextNode(label));
  return element;
}

function statusBadge(status) {
  const element = node('span', 'people-state', statuses[status]);
  element.dataset.state = status;
  return element;
}

function meter(value, label, max = 100) {
  const bar = node('progress', 'people-progress');
  bar.value = value;
  bar.max = max;
  bar.setAttribute('aria-label', label);
  return bar;
}

function card(title, status, contents, actions = []) {
  const element = node('article', 'people-card');
  const header = node('header', 'people-card-head');
  header.append(node('h3', '', title));
  if (status) header.append(statusBadge(status));
  element.append(header, ...contents.filter(Boolean));
  if (actions.length) {
    const footer = node('div', 'people-card-actions');
    footer.append(...actions);
    element.append(footer);
  }
  return element;
}

function goalFields(item, descriptionLimit = 2000) {
  return [
    field('Título', 'title', 'text', { value: item?.title, required: true, maxLength: 160 }),
    field('Descrição', 'description', 'textarea', { value: item?.description, maxLength: descriptionLimit, rows: 4 }),
    field('Prazo', 'dueAt', 'date', { value: item?.dueAt }),
  ];
}

export function mountMaxHubPeople(root, { area, request, onAuthError, session }) {
  if (!Object.hasOwn(sections, area)) return () => {};
  const userId = session?.user?.id || session?.user?._id;
  const admin = session?.user?.role === 'admin';
  const reviewsAllowed = admin || ['edit', 'manage'].includes(session?.permissions?.rh);
  const section = area === 'reviews' && !reviewsAllowed ? sections['my-reviews'] : sections[area];
  const usesFilter = filters[area] && (area !== 'reviews' || reviewsAllowed);
  const path = `/people/${section.resource}`;
  const itemPath = item => `${path}/${encodeURIComponent(item.id)}`;
  const panel = node('section', 'people-workspace maxhub-people');
  panel.innerHTML = `
    <header class="maxpeople-heading">
      <div class="maxpeople-heading-mark" aria-hidden="true"></div>
      <div class="maxpeople-heading-body"><h2></h2><p data-ui="intro"></p></div>
      <div class="maxpeople-heading-action" data-ui="headingAction"></div>
    </header>
    <div class="maxpeople-notice" data-ui="feedback" role="status" hidden></div>
    <section class="people-list" aria-label="${section.title}">
      <div class="maxpeople-toolbar" data-ui="toolbar" hidden>
        <strong data-ui="count"></strong>
        <label class="maxpeople-filter"><span class="sr-only">Filtrar ${section.title.toLowerCase()}</span><select data-ui="filter"></select></label>
      </div>
      <div data-ui="items"></div>
    </section>
    <dialog class="people-dialog" aria-labelledby="maxpeopleDialogTitle" data-ui="dialog">
      <form data-ui="form">
        <header class="people-dialog-header">
          <h2 id="maxpeopleDialogTitle" data-ui="dialogTitle"></h2>
          <button type="button" class="people-icon-button" data-ui="close" aria-label="Fechar"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </header>
        <div class="people-fields" data-ui="fields"></div>
        <p class="people-error" data-ui="error" role="alert" hidden></p>
        <footer class="people-dialog-actions" data-ui="footer">
          <button type="button" class="people-button" data-ui="cancel">Cancelar</button>
          <button type="submit" class="people-button people-button-primary" data-ui="submit">Salvar</button>
        </footer>
      </form>
    </dialog>`;
  const ui = Object.fromEntries(Array.from(panel.querySelectorAll('[data-ui]'), element => [element.dataset.ui, element]));
  panel.querySelector('h2').textContent = section.title;
  panel.querySelector('.maxpeople-heading-mark').append(glyph(section.icon));
  ui.intro.textContent = section.intro;
  root.replaceChildren(panel);

  let items = [];
  let minResponses = 3;
  let loaded = false;
  let version = 0;
  let dialogVersion = 0;
  let disposed = false;
  let activeDialog;
  let busy = false;

  function readError(error) {
    if (error.status !== 401) return false;
    onAuthError?.(error);
    return true;
  }

  function feedback(message) {
    ui.feedback.textContent = message;
    ui.feedback.hidden = !message;
  }

  function showState(title, details, retry) {
    const state = node('div', 'people-empty');
    const mark = node('span', 'people-empty-mark');
    mark.append(glyph(section.icon));
    state.append(mark, node('strong', '', title));
    if (details) state.append(node('p', '', details));
    if (retry) state.append(button('Tentar novamente', retry, { icon: 'arrow-clockwise' }));
    ui.items.replaceChildren(state);
  }

  function setDialogBusy(value) {
    busy = value;
    ui.submit.disabled = ui.cancel.disabled = ui.close.disabled = value;
    ui.form.setAttribute('aria-busy', String(value));
  }

  function dialog({ title, fields, submit = 'Salvar', run, success = 'Registro atualizado.' }) {
    dialogVersion++;
    activeDialog = { run, success };
    ui.dialogTitle.textContent = title;
    ui.fields.replaceChildren(...fields);
    ui.error.hidden = true;
    ui.footer.hidden = !run;
    ui.submit.textContent = submit;
    setDialogBusy(false);
    if (!ui.dialog.open) ui.dialog.showModal();
    (ui.fields.querySelector('input, textarea, select') || ui.close).focus();
    return dialogVersion;
  }

  function personalField(label = 'Pessoa', excludeSelf = true) {
    const fieldset = node('fieldset', 'maxpeople-directory');
    const searchField = field('Buscar por nome', 'directoryQuery', 'search', { maxLength: 80, placeholder: 'Digite o nome de quem procura' });
    const selectField = field(label, 'recipientId', 'select', { choices: { '': 'Selecione uma pessoa' }, required: true });
    const search = searchField.querySelector('input');
    const select = selectField.querySelector('select');
    const status = node('p', 'people-meta');
    status.setAttribute('role', 'status');
    fieldset.append(searchField, selectField, status);
    const expectedDialog = dialogVersion + 1;
    let searchVersion = 0;
    let timer;

    async function fetchPeople() {
      if (disposed || expectedDialog !== dialogVersion || !ui.dialog.open) return;
      const current = ++searchVersion;
      const expression = search.value.trim();
      status.textContent = 'Buscando pessoas…';
      try {
        const result = await request(`/maxhub/directory?${new URLSearchParams({ q: expression })}`);
        if (disposed || expectedDialog !== dialogVersion || current !== searchVersion || !ui.dialog.open) return;
        const prior = select.value;
        const people = (result.people || []).filter(person => !excludeSelf || person.id !== userId);
        select.replaceChildren(new Option('Selecione uma pessoa', ''), ...people.map(person => new Option(person.name, person.id)));
        if (people.some(person => person.id === prior)) select.value = prior;
        status.textContent = people.length ? '' : 'Nenhuma pessoa encontrada.';
      } catch (error) {
        if (disposed || expectedDialog !== dialogVersion || current !== searchVersion || !ui.dialog.open || readError(error)) return;
        status.textContent = 'Não foi possível buscar pessoas. Altere a busca para tentar novamente.';
      }
    }

    search.addEventListener('input', () => {
      searchVersion++;
      clearTimeout(timer);
      timer = setTimeout(fetchPeople, 200);
    });
    search.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
    queueMicrotask(fetchPeople);
    return fieldset;
  }

  function editGoal(item) {
    dialog({
      title: item ? 'Editar objetivo' : 'Novo objetivo',
      fields: [...goalFields(item), field('Progresso (%)', 'progress', 'number', { value: item?.progress ?? 0, required: true, min: 0, max: 100, step: 1 })],
      submit: 'Salvar objetivo', success: 'Objetivo salvo.',
      run: data => request(item ? itemPath(item) : path, { method: item ? 'PATCH' : 'POST', body: {
        title: text(data, 'title'), description: text(data, 'description'), dueAt: text(data, 'dueAt') || null, progress: Number(data.get('progress')),
      } }),
    });
  }

  function checkIn(item) {
    dialog({
      title: `Check-in · ${item.title}`,
      fields: [field('Progresso (%)', 'progress', 'number', { value: item.progress, required: true, min: 0, max: 100, step: 1 }),
        field('O que avançou?', 'notes', 'textarea', { maxLength: 2000, rows: 4 })],
      submit: 'Registrar check-in', success: 'Check-in registrado.',
      run: data => request(`${itemPath(item)}/check-in`, { method: 'POST', body: { progress: Number(data.get('progress')), notes: text(data, 'notes') } }),
    });
  }

  async function checkInHistory(item) {
    const title = `Histórico · ${item.title}`;
    const loading = node('p', 'people-meta', 'Carregando check-ins…');
    loading.setAttribute('role', 'status');
    const current = dialog({ title, fields: [loading] });
    try {
      const result = await request(`${itemPath(item)}/check-in`);
      if (disposed || current !== dialogVersion || !ui.dialog.open) return;
      if (!result.items.length) { loading.textContent = 'Nenhum check-in registrado.'; return; }
      const history = node('ol', 'maxpeople-checkins');
      for (const record of result.items) {
        const row = node('li');
        row.append(node('strong', '', `${day(record.day)} · ${record.progress}%`));
        if (record.notes) row.append(description(record.notes));
        history.append(row);
      }
      ui.fields.replaceChildren(history);
    } catch (error) {
      if (disposed || current !== dialogVersion || !ui.dialog.open || readError(error)) return;
      loading.textContent = 'Não foi possível carregar os check-ins.';
      ui.fields.append(button('Tentar novamente', () => checkInHistory(item), { icon: 'arrow-clockwise' }));
    }
  }

  function createFeedback() {
    dialog({
      title: 'Enviar feedback', fields: [personalField('Destinatário'),
        field('Seu feedback', 'text', 'textarea', { required: true, rows: 5, maxLength: 4000 }),
        node('p', 'people-privacy-note', 'O feedback fica disponível para você e para a pessoa escolhida.')],
      submit: 'Enviar feedback', success: 'Feedback enviado.',
      run: data => request(path, { method: 'POST', body: { recipientId: text(data, 'recipientId'), text: text(data, 'text') } }),
    });
  }

  function createReview() {
    dialog({
      title: 'Registrar avaliação', fields: [personalField('Pessoa avaliada'),
        field('Título da avaliação', 'title', 'text', { required: true, maxLength: 160 }),
        field('Observações', 'text', 'textarea', { required: true, rows: 5, maxLength: 4000 })],
      submit: 'Registrar avaliação', success: 'Avaliação registrada.',
      run: data => request(path, { method: 'POST', body: { recipientId: text(data, 'recipientId'), title: text(data, 'title'), text: text(data, 'text') } }),
    });
  }

  function editPlan(item) {
    const fields = goalFields(item, 3000);
    if (!item) fields.push(field('Status inicial', 'status', 'select', { choices: { draft: 'Rascunho', active: 'Vigente' }, value: 'draft' }));
    dialog({
      title: item ? 'Editar PDI' : 'Novo PDI', fields, submit: 'Salvar PDI', success: 'PDI salvo.',
      run: data => request(item ? itemPath(item) : path, { method: item ? 'PATCH' : 'POST', body: {
        title: text(data, 'title'), description: text(data, 'description'), dueAt: text(data, 'dueAt') || null,
        ...(!item ? { status: text(data, 'status') } : {}),
      } }),
    });
  }

  function changePlan(item, activate) {
    const action = activate ? 'Ativar PDI' : 'Concluir PDI';
    dialog({
      title: action, fields: [description(`Confirme a alteração do plano “${item.title}”.`)], submit: action,
      success: activate ? 'PDI ativado.' : 'PDI concluído.',
      run: () => request(itemPath(item), { method: 'PATCH', body: { status: activate ? 'active' : 'completed' } }),
    });
  }

  function scheduleMeeting() {
    dialog({
      title: 'Agendar reunião 1:1', fields: [personalField('Participante'),
        field('Assunto', 'title', 'text', { required: true, maxLength: 160 }),
        field('Data', 'date', 'date', { required: true }), field('Horário de Brasília', 'time', 'time'),
        field('Pauta', 'notes', 'textarea', { rows: 4, maxLength: 3000 })],
      submit: 'Agendar reunião', success: 'Reunião agendada.',
      run: data => request(path, { method: 'POST', body: {
        participantId: text(data, 'recipientId'), title: text(data, 'title'), date: text(data, 'date'), time: text(data, 'time') || null,
        notes: text(data, 'notes'),
      } }),
    });
  }

  function finishMeeting(item) {
    dialog({
      title: 'Finalizar reunião 1:1', fields: [description(`Confirme a finalização da reunião “${item.title}”.`)],
      submit: 'Finalizar reunião', success: 'Reunião finalizada.',
      run: () => request(itemPath(item), { method: 'PATCH', body: { status: 'completed' } }),
    });
  }

  function createSurvey() {
    dialog({
      title: 'Publicar pesquisa', fields: [field('Tipo de pesquisa', 'kind', 'select', { choices: surveyKinds, value: 'engagement' }),
        field('Título', 'title', 'text', { required: true, maxLength: 160 }),
        field('Pergunta', 'question', 'textarea', { required: true, rows: 3, maxLength: 300 })],
      submit: 'Publicar pesquisa', success: 'Pesquisa publicada.',
      run: data => request(path, { method: 'POST', body: { kind: text(data, 'kind'), title: text(data, 'title'), question: text(data, 'question') } }),
    });
  }

  function answerSurvey(item) {
    const ratings = node('fieldset', 'people-scale');
    ratings.append(node('legend', '', item.question));
    const options = node('div', 'people-scale-choices maxpeople-score-choices');
    for (let value = 1; value <= 5; value++) {
      const label = node('label', 'people-scale-option');
      const input = node('input');
      Object.assign(input, { type: 'radio', name: 'rating', value, required: true, checked: item.myRating === value });
      label.append(input, node('strong', '', value));
      options.append(label);
    }
    ratings.append(options, node('p', 'people-meta', '1 é a menor nota. 5 é a maior nota.'));
    dialog({
      title: item.title, fields: [ratings, node('p', 'people-privacy-note', 'Sua nota individual aparece apenas para você no painel.')],
      submit: 'Registrar resposta', success: 'Resposta registrada.',
      run: data => request(`${itemPath(item)}/response`, { method: 'PUT', body: { rating: Number(data.get('rating')) } }),
    });
  }

  function endSurvey(item) {
    dialog({
      title: 'Encerrar pesquisa', fields: [description(`A pesquisa “${item.title}” deixará de receber novas respostas.`)],
      submit: 'Encerrar pesquisa', success: 'Pesquisa encerrada.',
      run: () => request(itemPath(item), { method: 'PATCH', body: { status: 'closed' } }),
    });
  }

  function renderGoal(item) {
    const progress = node('div', 'people-meter');
    const line = node('div');
    line.append(node('span', '', 'Progresso'), node('strong', '', `${item.progress}%`));
    progress.append(line, meter(item.progress, `Progresso · ${item.title}`));
    return card(item.title, item.status, [item.description && description(item.description),
      item.dueAt && meta('clock-history', `Prazo ${day(item.dueAt)}`), progress], [
      button('Registrar check-in', () => checkIn(item), { primary: true, icon: 'check2', subject: item.title }),
      button('Histórico', () => checkInHistory(item), { subject: item.title }), button('Editar', () => editGoal(item), { subject: item.title }),
    ]);
  }

  function renderFeedback(item) {
    const outgoing = item.sender.id === userId;
    return card(`${outgoing ? 'Para' : 'De'} ${outgoing ? item.recipient.name : item.sender.name}`, null,
      [meta('clock-history', day(item.createdAt)), description(item.text)]);
  }

  function renderReview(item) {
    return card(item.title, null, [meta('person', `Avaliação de ${item.recipient.name}`),
      meta('clock-history', `${item.reviewer.name} · ${day(item.createdAt)}`), description(item.text)]);
  }

  function renderPlan(item) {
    const actions = [];
    if (item.status !== 'completed') actions.push(button('Editar', () => editPlan(item), { subject: item.title }));
    if (item.status === 'draft') actions.unshift(button('Ativar PDI', () => changePlan(item, true), { primary: true, subject: item.title }));
    if (item.status === 'active') actions.unshift(button('Concluir PDI', () => changePlan(item, false), { primary: true, subject: item.title }));
    return card(item.title, item.status, [item.description && description(item.description),
      item.dueAt && meta('clock-history', `Prazo ${day(item.dueAt)}`)], actions);
  }

  function renderMeeting(item) {
    const counterpart = item.organizer.id === userId ? item.participant.name : item.organizer.name;
    return card(item.title, item.status, [meta('person', `Com ${counterpart}`),
      meta('clock-history', `${day(item.date)}${item.time ? ` às ${item.time.slice(0, 5)}` : ''}`), item.notes && description(item.notes)],
    item.status === 'scheduled' ? [button('Finalizar reunião', () => finishMeeting(item), { primary: true, subject: item.title })] : []);
  }

  function renderSurvey(item) {
    const actions = [];
    const content = [meta('list-task', surveyKinds[item.kind] || surveyKinds.engagement), description(item.question)];
    if (item.myRating != null) content.push(meta('check2', `Sua resposta · ${item.myRating} de 5`));
    if (item.results) {
      const result = node('div', 'people-results');
      result.append(node('strong', '', `${numberFormat.format(item.results.average)} / 5 · ${item.results.count} respostas`));
      for (const [index, count] of item.results.distribution.entries()) {
        const row = node('div', 'people-result-row');
        row.append(node('span', '', `Nota ${index + 1}`), meter(count, `Nota ${index + 1}`, item.results.count), node('span', '', count));
        result.append(row);
      }
      content.push(result);
    } else if (item.status === 'closed') {
      content.push(node('p', 'people-privacy-note', `Resultados agrupados disponíveis a partir de ${minResponses} respostas.`));
    }
    if (item.status === 'open') {
      actions.push(button(item.myRating == null ? 'Responder' : 'Alterar resposta', () => answerSurvey(item), { primary: true, subject: item.title }));
      if (admin) actions.push(button('Encerrar pesquisa', () => endSurvey(item), { subject: item.title }));
    }
    return card(item.title, item.status, content, actions);
  }

  const creators = { reviews: createReview, feedback: createFeedback, pdi: editPlan, meetings: scheduleMeeting, objectives: editGoal, surveys: createSurvey };
  const renderers = { reviews: renderReview, 'my-reviews': renderReview, feedback: renderFeedback, pdi: renderPlan,
    meetings: renderMeeting, objectives: renderGoal, surveys: renderSurvey };
  const canCreate = section.action && (area !== 'reviews' || reviewsAllowed) && (area !== 'surveys' || admin);
  if (canCreate) ui.headingAction.append(button(section.action, () => creators[area](), { primary: true, icon: 'plus-lg' }));
  if (usesFilter) for (const [value, label] of Object.entries(filters[area])) ui.filter.add(new Option(label, value));

  function visibleItems() {
    if (area === 'my-reviews' || (area === 'reviews' && ui.filter.value !== 'all')) return items.filter(item => item.recipient.id === userId);
    const chosen = ui.filter.value;
    if (!chosen || chosen === 'all' || area === 'reviews') return items;
    if (area === 'feedback') return items.filter(item => item[chosen === 'sent' ? 'sender' : 'recipient'].id === userId);
    return items.filter(item => item.status === chosen);
  }

  function draw() {
    const visible = visibleItems();
    ui.count.textContent = visible.length === 1 ? '1 registro' : `${visible.length} registros`;
    ui.toolbar.hidden = !usesFilter;
    if (!visible.length) { showState('Nenhum registro nesta seleção.'); return; }
    const grid = node('div', 'people-cards');
    grid.append(...visible.map(renderers[area]));
    ui.items.replaceChildren(grid);
  }

  async function load() {
    const current = ++version;
    ui.items.setAttribute('aria-busy', 'true');
    if (!loaded || area === 'reviews') showState('Carregando…');
    try {
      const scope = area === 'reviews' && reviewsAllowed && ui.filter.value === 'all' ? '?scope=all' : '';
      const data = await request(`${path}${scope}`);
      if (disposed || current !== version) return;
      items = data.items || [];
      minResponses = data.minResponses ?? minResponses;
      loaded = true;
      draw();
    } catch (error) {
      if (disposed || current !== version || readError(error)) return;
      showState('Não foi possível carregar os registros.', error.message, load);
    } finally {
      if (!disposed && current === version) ui.items.removeAttribute('aria-busy');
    }
  }

  ui.filter.addEventListener('change', () => area === 'reviews' ? void load() : draw());
  for (const close of [ui.close, ui.cancel]) close.addEventListener('click', () => ui.dialog.close());
  ui.dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  ui.dialog.addEventListener('close', () => { if (!ui.dialog.open) activeDialog = undefined; });
  ui.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!activeDialog?.run || busy || disposed) return;
    const { run, success } = activeDialog;
    const currentDialog = dialogVersion;
    setDialogBusy(true);
    ui.error.hidden = true;
    try {
      await run(new FormData(ui.form));
      if (disposed) return;
      ui.dialog.close();
      feedback(success);
      window.dispatchEvent(new Event('maxhub:points-change'));
      void load();
    } catch (error) {
      if (disposed || readError(error)) return;
      ui.error.textContent = error.message || 'Não foi possível concluir a operação.';
      ui.error.hidden = false;
    } finally {
      if (!disposed && currentDialog === dialogVersion) setDialogBusy(false);
    }
  });
  void load();

  return () => {
    disposed = true;
    if (ui.dialog.open) ui.dialog.close();
    panel.remove();
  };
}
