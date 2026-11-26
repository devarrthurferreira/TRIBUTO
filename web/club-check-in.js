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
            <button type="button" class="club-checkin-choice" data-mood="${value}" disabled>
              <span class="club-checkin-face" aria-hidden="true">${face}</span>
              <span class="club-checkin-choice-label">${label}</span>
            </button>`).join('')}
        </div>
        <p class="club-checkin-status" data-checkin-part="status" role="status"></p>
        <button class="club-button club-checkin-retry" type="button" data-checkin-part="retry" hidden>Tentar novamente</button>
      </div>
    </section>
    <dialog class="club-checkin-dialog" data-checkin-part="dialog" aria-labelledby="clubCheckInCommentTitle" aria-describedby="clubCheckInCommentPrivacy">
      <form data-checkin-part="commentForm">
        <div class="club-checkin-dialog-heading">
          <span class="club-checkin-dialog-icon" aria-hidden="true"><i class="bi bi-chat-heart"></i></span>
          <h2 id="clubCheckInCommentTitle">Deseja adicionar um comentário anônimo?</h2>
        </div>
        <p id="clubCheckInCommentPrivacy">O RH pode ler os comentários em grupo, sem identificação. Evite incluir nomes ou detalhes que possam identificar você.</p>
        <label class="sr-only" for="clubCheckInComment">Seu comentário</label>
        <textarea id="clubCheckInComment" data-checkin-part="comment" placeholder="Escreva seu comentário" rows="4" maxlength="1000" required></textarea>
        <p class="club-checkin-status" data-checkin-part="commentStatus" data-kind="error" role="status"></p>
        <div class="club-checkin-dialog-actions">
          <button class="button-quiet" type="button" data-checkin-part="skip" autofocus>Pular</button>
          <button class="button-primary" type="submit" data-checkin-part="submitComment">Enviar comentário</button>
        </div>
      </form>
    </dialog>`;

  const refs = Object.fromEntries([...container.querySelectorAll('[data-checkin-part]')].map(node => [node.dataset.checkinPart, node]));
  const choices = [...refs.choices.querySelectorAll('button')];
  container.after(refs.dialog);
  container.hidden = true;
  let state = null;
  let loading = false;
  let sending = false;
  let sendingComment = false;
  let disposed = false;

  function status(message, kind = '') {
    refs.status.textContent = message;
    refs.status.dataset.kind = kind;
  }

  function renderControls() {
    refs.choices.setAttribute('aria-busy', String(loading || sending));
    for (const choice of choices) choice.disabled = !state || loading || sending;
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
      container.hidden = data.todayMood != null;
      status('');
    } catch (error) {
      if (disposed) return;
      if (error.status === 401) { onAuthError(error); return; }
      state = null;
      container.hidden = false;
      status('Não foi possível carregar suas respostas.', 'error');
      refs.retry.hidden = false;
    } finally {
      loading = false;
      if (!disposed) renderControls();
    }
  }

  async function sendMood(mood) {
    if (!state || state.todayMood != null || sending || loading || disposed) return;
    sending = true;
    refs.retry.hidden = true;
    status('Enviando ao RH…');
    renderControls();
    try {
      const data = await request('/club/check-in', { method: 'PUT', body: { mood, shareWithRh: true } });
      if (disposed) return;
      state = data;
      container.hidden = true;
      if (data.todayMood === 1 || data.todayMood === 2) refs.dialog.showModal();
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

  async function sendComment(event) {
    event.preventDefault();
    if (sendingComment || disposed) return;
    const comment = refs.comment.value.trim();
    if (!comment) {
      refs.commentStatus.textContent = 'Escreva um comentário ou selecione Pular.';
      refs.comment.focus();
      return;
    }
    sendingComment = true;
    refs.comment.readOnly = true;
    refs.skip.disabled = true;
    refs.submitComment.disabled = true;
    refs.commentStatus.textContent = '';
    try {
      await request('/club/check-in/anonymous-comments', { method: 'POST', body: { comment } });
      if (!disposed) refs.dialog.close();
    } catch (error) {
      if (disposed) return;
      if (error.status === 401) { onAuthError(error); return; }
      refs.commentStatus.textContent = error.status === 409
        ? error.message
        : 'Não foi possível enviar o comentário. Tente novamente ou selecione Pular.';
    } finally {
      sendingComment = false;
      if (!disposed) {
        refs.comment.readOnly = false;
        refs.skip.disabled = false;
        refs.submitComment.disabled = false;
      }
    }
  }

  function refreshIfNewDay() {
    if (state && document.visibilityState === 'visible' && state.today !== currentDay()) {
      if (refs.dialog.open && !sendingComment) refs.dialog.close();
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
  refs.skip.addEventListener('click', () => refs.dialog.close());
  refs.commentForm.addEventListener('submit', sendComment);
  refs.dialog.addEventListener('cancel', event => { if (sendingComment) event.preventDefault(); });
  refs.dialog.addEventListener('close', () => {
    refs.commentForm.reset();
    refs.commentStatus.textContent = '';
  });
  document.addEventListener('visibilitychange', refreshIfNewDay);
  window.addEventListener('pageshow', restoreAfterNavigation);
  const dayWatcher = setInterval(refreshIfNewDay, 60_000);
  void loadPersonal();

  return () => {
    disposed = true;
    clearInterval(dayWatcher);
    refs.dialog.remove();
    document.removeEventListener('visibilitychange', refreshIfNewDay);
    window.removeEventListener('pageshow', restoreAfterNavigation);
  };
}
