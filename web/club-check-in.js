import { CLUB_PATHS } from './club-routes.js';

const moods = [
  { value: 1, face: '😢', label: 'Muito triste' },
  { value: 2, face: '🙁', label: 'Triste' },
  { value: 3, face: '😐', label: 'Neutro' },
  { value: 4, face: '🙂', label: 'Feliz' },
  { value: 5, face: '😄', label: 'Muito feliz' },
];
const dateLabel = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const localDay = new Intl.DateTimeFormat('en', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Sao_Paulo' });
const averageLabel = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function dayDate(day) { return new Date(`${day}T12:00:00Z`); }

function currentDay() {
  const parts = Object.fromEntries(localDay.formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function recentDays(lastDay) {
  const date = dayDate(lastDay);
  date.setUTCDate(date.getUTCDate() - 29);
  return Array.from({ length: 30 }, () => {
    const day = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 1);
    return day;
  });
}

function calendarCell(day, mood) {
  const cell = element('li');
  cell.dataset.date = day;
  const time = element('time', shortDate.format(dayDate(day)));
  time.dateTime = day;
  time.setAttribute('aria-label', dateLabel.format(dayDate(day)));
  const response = moods.find(({ value }) => value === mood);
  if (response) cell.dataset.mood = response.value;
  if (mood === null) cell.dataset.presence = '';
  const marker = element('span', response?.face ?? (mood === null ? '✓' : '–'), 'club-checkin-day-mark');
  marker.setAttribute('aria-hidden', 'true');
  const label = element('span', response?.label ?? (mood === null ? 'Presença sem resposta de humor' : 'Sem check-in'), 'sr-only');
  cell.append(time, marker, label);
  return cell;
}

function renderTeam(destination, { days, minimum }) {
  const privacy = element('p', `Os resultados aparecem após o encerramento do dia, com pelo menos ${minimum} respostas.`);
  destination.replaceChildren(privacy);
  if (!days.length) {
    destination.append(element('p', 'Ainda não há dias com respostas suficientes para mostrar o resultado.', 'club-checkin-empty'));
    return;
  }

  const totals = moods.map(({ value }) => days.reduce((count, day) => count + day.counts[value - 1], 0));
  const total = totals.reduce((sum, count) => sum + count, 0);
  const average = totals.reduce((sum, count, index) => sum + count * (index + 1), 0) / total;
  const stats = element('dl', undefined, 'club-checkin-stats');
  for (const [title, value] of [['Respostas', total], ['Dias com dados', days.length], ['Média de humor', `${averageLabel.format(average)} / 5`]]) {
    const item = element('div');
    item.append(element('dt', title), element('dd', value));
    stats.append(item);
  }
  const distribution = element('ul', undefined, 'club-checkin-distribution');
  for (const { value, label, face } of moods) {
    const row = element('li');
    row.dataset.mood = value;
    const symbol = element('span', face, 'club-checkin-distribution-face');
    symbol.setAttribute('aria-hidden', 'true');
    const meter = element('meter');
    meter.min = 0;
    meter.max = total;
    meter.value = totals[value - 1];
    meter.setAttribute('aria-label', label);
    row.append(symbol, element('span', label), meter, element('strong', totals[value - 1]));
    distribution.append(row);
  }
  const details = element('details', undefined, 'club-checkin-team-days');
  details.append(element('summary', 'Ver resultados por dia'));
  const table = document.createElement('table');
  const heading = table.createTHead().insertRow();
  for (const label of ['Dia', 'Respostas', 'Média / 5']) {
    const cell = element('th', label);
    cell.scope = 'col';
    heading.append(cell);
  }
  const body = table.createTBody();
  for (const day of days) {
    const row = body.insertRow();
    row.insertCell().append(element('time', shortDate.format(dayDate(day.date))));
    row.cells[0].firstChild.dateTime = day.date;
    row.insertCell().textContent = day.total;
    row.insertCell().textContent = averageLabel.format(day.average);
  }
  details.append(table);
  destination.append(stats, distribution, details);
}

export function mountClubCheckIn(container, { request, onAuthError, isAdmin, compact = false }) {
  const mode = compact ? 'compact' : 'full';
  const title = compact ? '<h2 id="clubCheckInTitle">Check-in diário</h2>' : '<h1 id="clubTitle">Check-in diário</h1>';
  container.innerHTML = `
    <section class="club-checkin" data-checkin="${mode}" aria-labelledby="${compact ? 'clubCheckInTitle' : 'clubTitle'}">
      <form class="club-checkin-card club-checkin-form">
        <div class="club-checkin-heading">
          <div class="club-checkin-title">
            <span class="club-checkin-emblem" aria-hidden="true"><i class="bi bi-check2"></i></span>
            <div>${title}<p>Registre sua presença e, se quiser, como está se sentindo.</p></div>
          </div>
          <time class="club-checkin-today" data-checkin-part="date" hidden></time>
        </div>
        <fieldset class="club-checkin-scale" data-checkin-part="scale" disabled>
          <legend>Como você está hoje?</legend>
          <div class="club-checkin-choices">
            ${moods.map(({ value, face, label }) => `
              <label class="club-checkin-choice" data-mood="${value}">
                <input class="sr-only" type="radio" name="mood" value="${value}" required>
                <span class="club-checkin-face" aria-hidden="true">${face}</span>
                <span class="club-checkin-choice-label">${label}</span>
              </label>`).join('')}
          </div>
        </fieldset>
        <div class="club-checkin-actions">
          <button class="club-button club-primary" type="submit" data-checkin-part="submit" disabled>Salvar humor</button>
          <button class="club-button" type="button" data-checkin-part="presence" disabled>Registrar só a presença</button>
          <button class="club-button" type="button" data-checkin-part="retry" hidden>Tentar novamente</button>
          ${compact ? `<a class="club-checkin-history-link" href="${CLUB_PATHS.checkIn}">Ver meu histórico <i aria-hidden="true" class="bi bi-arrow-right"></i></a>` : ''}
        </div>
        <p class="club-checkin-status" data-checkin-part="status" role="status" tabindex="-1"></p>
        <p class="club-checkin-note">Suas respostas individuais ficam disponíveis para você. A visão da equipe mostra resultados consolidados.</p>
      </form>
      ${compact ? '' : `
        <section class="club-checkin-card club-checkin-personal" aria-labelledby="clubCheckInHistoryTitle">
          <h2 id="clubCheckInHistoryTitle">Meu histórico</h2>
          <p>Seus registros dos últimos 30 dias.</p>
          <p data-checkin-part="historyInfo" class="club-checkin-empty">Carregando seu histórico…</p>
          <ol data-checkin-part="history" class="club-checkin-calendar" hidden></ol>
          <p data-checkin-part="historyLegend" class="club-checkin-calendar-legend" hidden><span><b aria-hidden="true">✓</b> Presença sem resposta de humor</span><span><b aria-hidden="true">–</b> Sem check-in</span></p>
        </section>
        ${isAdmin ? `
          <section class="club-checkin-card club-checkin-team" aria-labelledby="clubCheckInTeamTitle">
            <h2 id="clubCheckInTeamTitle">Humor da equipe</h2>
            <p>Distribuição das respostas nos últimos 30 dias encerrados.</p>
            <div data-checkin-part="team" class="club-checkin-team-content"></div>
          </section>` : ''}`}
    </section>`;

  const form = container.querySelector('form');
  const refs = Object.fromEntries([...container.querySelectorAll('[data-checkin-part]')].map(node => [node.dataset.checkinPart, node]));
  const radioButtons = [...refs.scale.querySelectorAll('input')];
  let state = null;
  let loading = false;
  let saving = false;
  let teamLoading = false;
  let disposed = false;

  function status(message, kind = '') {
    refs.status.textContent = message;
    refs.status.dataset.kind = kind;
  }

  function renderControls() {
    refs.scale.disabled = !state || loading || saving;
    refs.submit.disabled = refs.scale.disabled || !form.elements.mood.value || Number(form.elements.mood.value) === state.todayMood;
    refs.submit.textContent = state?.todayMood ? 'Atualizar humor' : 'Salvar humor';
    refs.presence.hidden = Boolean(state?.checkedIn);
    refs.presence.disabled = refs.scale.disabled;
    form.setAttribute('aria-busy', String(loading || saving));
  }

  function renderState(data) {
    state = data;
    refs.date.hidden = false;
    refs.date.dateTime = state.today;
    refs.date.textContent = dateLabel.format(dayDate(state.today));
    for (const radio of radioButtons) radio.checked = Number(radio.value) === state.todayMood;
    if (!compact) {
      const moodsByDay = new Map(state.history.map(({ date, mood }) => [date, mood]));
      refs.history.replaceChildren(...recentDays(state.today).map(day => calendarCell(day, moodsByDay.get(day))));
      refs.history.hidden = refs.historyLegend.hidden = false;
      refs.historyInfo.hidden = true;
    }
  }

  async function loadPersonal() {
    if (saving || loading || disposed) return;
    loading = true;
    status('Carregando check-in…');
    refs.retry.hidden = true;
    renderControls();
    try {
      const data = await request('/club/check-in');
      if (disposed) return;
      renderState(data);
      status(data.todayMood ? 'Humor registrado hoje. Você pode atualizar sua resposta.' : data.checkedIn ? 'Presença registrada hoje.' : '', data.checkedIn ? 'success' : '');
    } catch (error) {
      if (disposed) return;
      if (error.status === 401) { onAuthError(error); return; }
      status('Não foi possível carregar o check-in.', 'error');
      refs.retry.hidden = false;
      if (refs.historyInfo) refs.historyInfo.textContent = 'Não foi possível carregar seu histórico.';
    } finally {
      loading = false;
      if (!disposed) renderControls();
    }
  }

  async function save(mood) {
    if (!state || saving || loading || disposed) return;
    saving = true;
    status('Salvando…');
    renderControls();
    try {
      const data = await request('/club/check-in', { method: 'PUT', body: { mood } });
      if (disposed) return;
      renderState(data);
      status(mood === null ? 'Presença registrada hoje.' : 'Humor registrado hoje.', 'success');
      refs.status.focus({ preventScroll: true });
    } catch (error) {
      if (disposed) return;
      if (error.status === 401) { onAuthError(error); return; }
      status('Não foi possível salvar seu check-in. Tente novamente.', 'error');
    } finally {
      saving = false;
      if (!disposed) renderControls();
    }
  }

  async function loadTeam() {
    if (!refs.team || teamLoading || disposed) return;
    teamLoading = true;
    refs.team.setAttribute('aria-busy', 'true');
    refs.team.querySelector('.club-checkin-team-notice')?.remove();
    const notice = element('div', undefined, 'club-checkin-team-notice');
    const loadingMessage = element('p', 'Carregando resultados…', 'club-checkin-empty');
    loadingMessage.setAttribute('role', 'status');
    notice.append(loadingMessage);
    refs.team.append(notice);
    try {
      const data = await request('/club/check-in/summary');
      if (!disposed) renderTeam(refs.team, data);
    } catch (error) {
      if (disposed) return;
      if (error.status === 401) { onAuthError(error); return; }
      const retry = element('button', 'Tentar novamente', 'club-button');
      retry.type = 'button';
      retry.addEventListener('click', loadTeam);
      loadingMessage.textContent = 'Não foi possível carregar os resultados da equipe.';
      notice.append(retry);
    } finally {
      teamLoading = false;
      if (!disposed) refs.team.setAttribute('aria-busy', 'false');
    }
  }

  function refreshIfNewDay() {
    if (state && document.visibilityState === 'visible' && state.today !== currentDay()) {
      void loadPersonal();
      void loadTeam();
    }
  }

  function restoreAfterNavigation(event) {
    if (!event.persisted) return;
    void loadPersonal();
    void loadTeam();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!refs.submit.disabled) void save(Number(form.elements.mood.value));
  });
  refs.scale.addEventListener('change', renderControls);
  refs.presence.addEventListener('click', () => void save(null));
  refs.retry.addEventListener('click', loadPersonal);
  document.addEventListener('visibilitychange', refreshIfNewDay);
  window.addEventListener('pageshow', restoreAfterNavigation);
  const dayWatcher = setInterval(refreshIfNewDay, 60_000);
  void loadPersonal();
  void loadTeam();

  return () => {
    disposed = true;
    clearInterval(dayWatcher);
    document.removeEventListener('visibilitychange', refreshIfNewDay);
    window.removeEventListener('pageshow', restoreAfterNavigation);
  };
}
