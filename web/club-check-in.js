export const clubMoods = [
  { value: 1, face: '😢', label: 'Muito triste' },
  { value: 2, face: '🙁', label: 'Triste' },
  { value: 3, face: '😐', label: 'Neutro' },
  { value: 4, face: '🙂', label: 'Feliz' },
  { value: 5, face: '😄', label: 'Muito feliz' },
];
const localDay = new Intl.DateTimeFormat('en', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Sao_Paulo' });

function currentDay() {
  const parts = Object.fromEntries(localDay.formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function mountClubCheckIn(container, { request, onAuthError, onSubmitted }) {
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

  async function loadPersonal() {
    if (sending || loading || disposed) return;
    loading = true;
    status('Carregando…');
    refs.retry.hidden = true;
    renderControls();
    try {
      const data = await request('/club/check-in');
      if (disposed) return;
      state = data;
      const answered = data.todayMood && data.sharedWithRh;
      status(answered ? 'Resposta de hoje enviada ao RH.' : '', answered ? 'success' : '');
    } catch (error) {
      if (disposed) return;
      if (error.status === 401) { onAuthError(error); return; }
      status('Não foi possível carregar suas respostas.', 'error');
      refs.retry.hidden = false;
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
      state = data;
      status('Resposta de hoje enviada ao RH.', 'success');
      onSubmitted?.();
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
