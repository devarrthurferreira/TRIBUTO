export const clubMoods = [
  { value: 1, face: '😢', label: 'Muito triste' },
  { value: 2, face: '🙁', label: 'Triste' },
  { value: 3, face: '😐', label: 'Neutro' },
  { value: 4, face: '🙂', label: 'Feliz' },
  { value: 5, face: '😄', label: 'Muito feliz' },
];
const dateLabel = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const localDay = new Intl.DateTimeFormat('en', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Sao_Paulo' });

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

function calendarCell(day, mood, today) {
  const cell = element('li');
  cell.dataset.date = day;
  const time = element('time', shortDate.format(dayDate(day)));
  time.dateTime = day;
  const date = dateLabel.format(dayDate(day));
  time.setAttribute('aria-label', today ? `Hoje, ${date}` : date);
  if (today) time.setAttribute('aria-current', 'date');
  const response = clubMoods.find(({ value }) => value === mood);
  if (response) cell.dataset.mood = response.value;
  if (mood === null) cell.dataset.presence = '';
  const marker = element('span', response?.face ?? (mood === null ? '✓' : '–'), 'club-checkin-day-mark');
  marker.setAttribute('aria-hidden', 'true');
  const label = element('span', response?.label ?? (mood === null ? 'Presença sem resposta de humor' : 'Sem check-in'), 'sr-only');
  cell.append(time, marker, label);
  return cell;
}

export function mountClubCheckIn(container, { request, onAuthError }) {
  container.innerHTML = `
    <section class="club-checkin" aria-labelledby="clubCheckInTitle">
      <form class="club-checkin-card club-checkin-form">
        <div class="club-checkin-heading">
          <div class="club-checkin-title">
            <span class="club-checkin-emblem" aria-hidden="true"><i class="bi bi-check2"></i></span>
            <div><h2 id="clubCheckInTitle">Check-in diário</h2><p>Registre sua presença e, se quiser, como está se sentindo.</p></div>
          </div>
          <div class="club-checkin-meta">
            <time class="club-checkin-today" data-checkin-part="date" hidden></time>
            <span class="club-checkin-badge" data-checkin-part="visibility" hidden></span>
          </div>
        </div>
        <div class="club-checkin-content">
          <fieldset class="club-checkin-scale" data-checkin-part="scale" disabled>
            <legend>Como você está hoje?</legend>
            <div class="club-checkin-choices">
              ${clubMoods.map(({ value, face, label }) => `
                <label class="club-checkin-choice" data-mood="${value}">
                  <input class="sr-only" type="radio" name="mood" value="${value}">
                  <span class="club-checkin-face" aria-hidden="true">${face}</span>
                  <span class="club-checkin-choice-label">${label}</span>
                  <span class="club-checkin-mark" aria-hidden="true">✓</span>
                </label>`).join('')}
            </div>
          </fieldset>
          <label class="club-checkin-share">
            <i class="bi bi-shield-lock" aria-hidden="true"></i>
            <span>
              <strong id="clubCheckInShareLabel">Compartilhar este registro com o RH</strong>
              <span id="clubCheckInShareHint">Ao ativar, o RH autorizado vê seu nome, a data e o humor informado. Você pode mudar esta opção no mesmo dia.</span>
            </span>
            <input type="checkbox" data-checkin-part="share" aria-labelledby="clubCheckInShareLabel" aria-describedby="clubCheckInShareHint" disabled>
          </label>
          <div class="club-checkin-actions">
            <button class="club-button club-primary" type="submit" data-checkin-part="submit" disabled>Salvar humor</button>
            <button class="club-button" type="button" data-checkin-part="presence" disabled>Registrar só a presença</button>
            <button class="club-button" type="button" data-checkin-part="retry" hidden>Tentar novamente</button>
          </div>
          <p class="club-checkin-status" data-checkin-part="status" role="status" tabindex="-1"></p>
        </div>
      </form>
      <details class="club-checkin-card club-checkin-history">
        <summary>
          <i class="bi bi-clock-history" aria-hidden="true"></i>
          <strong>Meu histórico</strong>
          <span>Últimos 30 dias</span>
          <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </summary>
        <div class="club-checkin-history-body">
          <p data-checkin-part="historyInfo" class="club-checkin-history-info">Carregando seu histórico…</p>
          <ol data-checkin-part="history" class="club-checkin-calendar" hidden></ol>
          <p data-checkin-part="historyLegend" class="club-checkin-calendar-legend" hidden><span><b aria-hidden="true">✓</b> Presença sem resposta de humor</span><span><b aria-hidden="true">–</b> Sem check-in</span></p>
        </div>
      </details>
    </section>`;

  const form = container.querySelector('form');
  const refs = Object.fromEntries([...container.querySelectorAll('[data-checkin-part]')].map(node => [node.dataset.checkinPart, node]));
  const radioButtons = [...refs.scale.querySelectorAll('input')];
  let state = null;
  let loading = false;
  let saving = false;
  let disposed = false;

  function status(message, kind = '') {
    refs.status.textContent = message;
    refs.status.dataset.kind = kind;
  }

  function renderControls() {
    const disabled = !state || loading || saving;
    const mood = Number(form.elements.mood.value);
    const moodChanged = Boolean(mood) && mood !== state?.todayMood;
    const sharingChanged = state?.checkedIn && refs.share.checked !== Boolean(state.sharedWithRh);
    refs.scale.disabled = refs.share.disabled = refs.presence.disabled = disabled;
    refs.submit.disabled = disabled || (!moodChanged && !sharingChanged);
    refs.submit.textContent = !moodChanged && sharingChanged ? 'Salvar compartilhamento' : state?.todayMood ? 'Atualizar humor' : 'Salvar humor';
    refs.presence.hidden = Boolean(state?.checkedIn);
    form.setAttribute('aria-busy', String(loading || saving));
  }

  function renderState(data) {
    state = data;
    refs.date.hidden = false;
    refs.date.dateTime = state.today;
    refs.date.textContent = dateLabel.format(dayDate(state.today));
    refs.share.checked = Boolean(state.sharedWithRh);
    refs.visibility.hidden = !state.checkedIn;
    refs.visibility.textContent = state.sharedWithRh ? 'Compartilhado com o RH' : 'Registro privado';
    refs.visibility.dataset.shared = String(Boolean(state.sharedWithRh));
    for (const radio of radioButtons) radio.checked = Number(radio.value) === state.todayMood;
    const moodsByDay = new Map(state.history.map(({ date, mood }) => [date, mood]));
    refs.history.replaceChildren(...recentDays(state.today).map(day => calendarCell(day, moodsByDay.get(day), day === state.today)));
    refs.history.hidden = refs.historyLegend.hidden = false;
    refs.historyInfo.hidden = true;
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
      refs.historyInfo.textContent = 'Não foi possível carregar seu histórico.';
    } finally {
      loading = false;
      if (!disposed) renderControls();
    }
  }

  async function save(mood) {
    if (!state || saving || loading || disposed) return;
    saving = true;
    const sharingOnly = state.checkedIn && mood === null;
    status('Salvando…');
    renderControls();
    try {
      const data = await request('/club/check-in', { method: 'PUT', body: { mood, shareWithRh: refs.share.checked } });
      if (disposed) return;
      renderState(data);
      const message = sharingOnly ? (data.sharedWithRh ? 'Registro compartilhado com o RH.' : 'Compartilhamento com o RH desativado.')
        : mood === null ? 'Presença registrada hoje.' : 'Humor registrado hoje.';
      status(message, 'success');
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

  function refreshIfNewDay() {
    if (state && document.visibilityState === 'visible' && state.today !== currentDay()) {
      void loadPersonal();
    }
  }

  function restoreAfterNavigation(event) {
    if (event.persisted) void loadPersonal();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (refs.submit.disabled) return;
    const mood = Number(form.elements.mood.value);
    void save(mood && mood !== state.todayMood ? mood : null);
  });
  form.addEventListener('change', renderControls);
  refs.presence.addEventListener('click', () => void save(null));
  refs.retry.addEventListener('click', loadPersonal);
  document.addEventListener('visibilitychange', refreshIfNewDay);
  window.addEventListener('pageshow', restoreAfterNavigation);
  const dayWatcher = setInterval(refreshIfNewDay, 60_000);
  void loadPersonal();

  return () => {
    disposed = true;
    clearInterval(dayWatcher);
    document.removeEventListener('visibilitychange', refreshIfNewDay);
    window.removeEventListener('pageshow', restoreAfterNavigation);
  };
}
