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
      <div class="club-checkin-card club-checkin-question">
        <h2 id="clubCheckInTitle">Como você está hoje?</h2>
        <p id="clubCheckInShareHint" class="club-checkin-hint">Ao escolher, você envia seu nome, a data e a resposta ao RH.</p>
        <div class="club-checkin-choices" data-checkin-part="choices" role="group" aria-labelledby="clubCheckInTitle" aria-describedby="clubCheckInShareHint">
          ${clubMoods.map(({ value, face, label }) => `
            <button type="button" class="club-checkin-choice" data-mood="${value}" aria-pressed="false" aria-disabled="true">
              <span class="club-checkin-face" aria-hidden="true">${face}</span>
              <span class="club-checkin-choice-label">${label}</span>
              <span class="club-checkin-mark" aria-hidden="true">✓</span>
            </button>`).join('')}
        </div>
        <p class="club-checkin-status" data-checkin-part="status" role="status"></p>
        <button class="club-button club-checkin-retry" type="button" data-checkin-part="retry" hidden>Tentar novamente</button>
      </div>
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

  const refs = Object.fromEntries([...container.querySelectorAll('[data-checkin-part]')].map(node => [node.dataset.checkinPart, node]));
  const choices = [...refs.choices.querySelectorAll('button')];
  let state = null;
  let loading = false;
  let sending = false;
  let disposed = false;

  function status(message, kind = '') {
    refs.status.textContent = message;
    refs.status.dataset.kind = kind;
  }

  function renderControls() {
    refs.choices.setAttribute('aria-busy', String(loading || sending));
    for (const choice of choices) {
      choice.setAttribute('aria-disabled', String(!state || loading || sending));
      choice.setAttribute('aria-pressed', String(Boolean(state?.sharedWithRh) && Number(choice.dataset.mood) === state.todayMood));
    }
  }

  function renderState(data) {
    state = data;
    const moodsByDay = new Map(state.history.map(({ date, mood }) => [date, mood]));
    refs.history.replaceChildren(...recentDays(state.today).map(day => calendarCell(day, moodsByDay.get(day), day === state.today)));
    refs.history.hidden = refs.historyLegend.hidden = false;
    refs.historyInfo.hidden = true;
  }

  async function loadPersonal() {
    if (sending || loading || disposed) return;
    loading = true;
    status('Carregando…');
    refs.retry.hidden = true;
    renderControls();
    try {
      const data = await request('/club/check-in');
      if (disposed) return;
      renderState(data);
      const answered = data.todayMood && data.sharedWithRh;
      status(answered ? 'Resposta de hoje enviada ao RH.' : '', answered ? 'success' : '');
    } catch (error) {
      if (disposed) return;
      if (error.status === 401) { onAuthError(error); return; }
      status('Não foi possível carregar suas respostas.', 'error');
      refs.retry.hidden = false;
      refs.historyInfo.textContent = 'Não foi possível carregar seu histórico.';
    } finally {
      loading = false;
      if (!disposed) renderControls();
    }
  }

  async function sendMood(mood) {
    if (!state || sending || loading || disposed) return;
    sending = true;
    refs.retry.hidden = true;
    status('Enviando ao RH…');
    renderControls();
    try {
      const data = await request('/club/check-in', { method: 'PUT', body: { mood, shareWithRh: true } });
      if (disposed) return;
      renderState(data);
      status('Resposta de hoje enviada ao RH.', 'success');
    } catch (error) {
      if (disposed) return;
      if (error.status === 401) { onAuthError(error); return; }
      status('Não foi possível confirmar o envio. Escolha uma opção para tentar novamente.', 'error');
    } finally {
      sending = false;
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

  for (const choice of choices) {
    choice.addEventListener('click', () => void sendMood(Number(choice.dataset.mood)));
  }
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
