import { clubMoods as moods } from './club-check-in.js';
const number = new Intl.NumberFormat('pt-BR');
const score = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const shortDay = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const fullDay = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'UTC' });

function dayDate(day) { return new Date(`${day}T12:00:00Z`); }
function moodAverage(value) { return value == null ? '—' : `${score.format(value)} / 5`; }

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dateElement(day, format = shortDay) {
  const node = element('time', '', format.format(dayDate(day)));
  node.dateTime = day;
  return node;
}

function glyph(icon) {
  const node = element('i', `bi bi-${icon}`);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function statCards(metrics) {
  const cards = element('dl', 'club-rh-stats');
  for (const { label, value, icon, tone } of metrics) {
    const card = element('div', 'club-rh-stat');
    card.dataset.tone = tone;
    const mark = element('span', 'club-rh-stat-mark');
    mark.append(glyph(icon));
    card.append(mark, element('dt', '', label), element('dd', '', value));
    cards.append(card);
  }
  return cards;
}

function detailFeedback(message, onRetry) {
  const feedback = element('div', 'club-rh-notice');
  feedback.setAttribute('role', 'status');
  feedback.append(element('p', '', message));
  if (onRetry) {
    const retry = element('button', 'club-rh-control', 'Tentar novamente');
    retry.type = 'button';
    retry.addEventListener('click', onRetry);
    feedback.append(retry);
  }
  return feedback;
}

function anonymousWeek({ start, comments }) {
  const week = element('details', 'club-rh-anonymous-week');
  const title = element('summary', '', 'Semana de ');
  title.append(dateElement(start, fullDay), element('span', '', `${number.format(comments.length)} comentários`));
  const list = element('ul', 'club-rh-anonymous-list');
  for (const comment of comments) list.append(element('li', '', comment));
  week.append(title, list);
  return week;
}

function distribution(totals) {
  if (!totals.answers) return detailFeedback('As respostas de humor compartilhadas aparecem aqui.');
  const list = element('ul', 'club-rh-distribution');
  for (const [index, mood] of moods.entries()) {
    const count = totals.counts[index];
    const item = element('li', 'club-rh-distribution-item');
    item.dataset.moodLevel = index + 1;
    const name = element('div', 'club-rh-distribution-name');
    const face = element('span', 'club-rh-face', mood.face);
    face.setAttribute('aria-hidden', 'true');
    name.append(face, element('span', '', mood.label));
    const amount = element('strong', '', number.format(count));
    const meter = element('meter');
    meter.max = totals.answers;
    meter.value = count;
    meter.setAttribute('aria-label', `${mood.label}, ${number.format(count)} de ${number.format(totals.answers)} respostas`);
    item.append(name, amount, meter);
    list.append(item);
  }
  return list;
}

function trendTable(trend) {
  const details = element('details', 'club-rh-trend-details');
  details.append(element('summary', '', 'Ver dados por dia'));
  const table = element('table', 'club-rh-trend-table');
  const heading = table.createTHead().insertRow();
  for (const label of ['Dia', 'Check-ins', 'Respostas', 'Média']) {
    const header = element('th', '', label);
    header.scope = 'col';
    heading.append(header);
  }
  const body = table.createTBody();
  for (const { date, checkIns, answers, average } of trend) {
    const row = body.insertRow();
    row.insertCell().append(dateElement(date));
    row.insertCell().textContent = number.format(checkIns);
    row.insertCell().textContent = number.format(answers);
    row.insertCell().textContent = moodAverage(average);
  }
  details.append(table);
  return details;
}

function mountTrendChart(canvas, report) {
  const firstDay = dayDate(report.firstDay);
  const days = report.days;
  const plotted = new Map(report.trend.filter(day => day.average != null).map(day => [day.date, day.average]));
  const dates = Array.from({ length: days }, (_, index) => {
    const date = new Date(firstDay);
    date.setUTCDate(date.getUTCDate() + index);
    return date;
  });

  function draw() {
    const { width, height } = canvas.getBoundingClientRect();
    if (width < 70 || height < 60) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    const style = getComputedStyle(canvas);
    const accent = style.getPropertyValue('--rh-chart-ink').trim();
    const panel = style.getPropertyValue('--rh-surface').trim();
    const left = 25;
    const right = width - 17;
    const top = 15;
    const bottom = height - 29;
    const xAt = index => left + (right - left) * index / (days - 1);
    const yAt = value => bottom - (bottom - top) * (value - 1) / 4;
    context.font = '11px Poppins, sans-serif';
    context.textBaseline = 'middle';
    context.fillStyle = style.getPropertyValue('--muted').trim();
    context.strokeStyle = style.getPropertyValue('--rh-edge').trim();
    context.textAlign = 'right';
    for (let value = 1; value <= 5; value += 1) {
      const y = yAt(value);
      context.fillText(String(value), left - 8, y);
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.stroke();
    }
    context.textAlign = 'center';
    for (const index of [0, Math.floor((days - 1) / 2), days - 1]) {
      context.fillText(shortDay.format(dates[index]), xAt(index), bottom + 18);
    }

    const points = dates.map(date => plotted.get(date.toISOString().slice(0, 10)));
    let started = false;
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.lineJoin = 'round';
    context.beginPath();
    for (const [index, value] of points.entries()) {
      if (value == null) { started = false; continue; }
      if (started) context.lineTo(xAt(index), yAt(value));
      else context.moveTo(xAt(index), yAt(value));
      started = true;
    }
    context.stroke();
    context.fillStyle = accent;
    context.strokeStyle = panel;
    context.lineWidth = 1.25;
    for (const [index, value] of points.entries()) {
      if (value == null) continue;
      context.beginPath();
      context.arc(xAt(index), yAt(value), days > 30 ? 2.5 : 3.5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }

  const resize = new ResizeObserver(draw);
  const theme = new MutationObserver(draw);
  resize.observe(canvas);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  draw();
  return () => { resize.disconnect(); theme.disconnect(); };
}

function renderProfile(profileContent, profile, history) {
  const answers = history.filter(entry => entry.mood != null);
  const sum = answers.reduce((total, entry) => total + entry.mood, 0);
  const metrics = statCards([
    { label: 'Check-ins', value: number.format(history.length), icon: 'check2', tone: 'blue' },
    { label: 'Respostas de humor', value: number.format(answers.length), icon: 'chat-dots', tone: 'amber' },
    { label: 'Média de humor', value: moodAverage(answers.length ? sum / answers.length : null), icon: 'graph-up', tone: 'green' },
  ]);
  const heading = element('h3', '', 'Registros compartilhados');
  const list = element('ul', 'club-rh-history');
  list.setAttribute('aria-label', `Registros compartilhados de ${profile.name}`);
  for (const entry of history) {
    const mood = entry.mood == null ? null : moods[entry.mood - 1];
    const row = element('li', 'club-rh-history-row');
    if (mood) row.dataset.moodLevel = entry.mood;
    const status = element('span', 'club-rh-history-status');
    if (mood) {
      const face = element('span', '', mood.face);
      face.setAttribute('aria-hidden', 'true');
      status.append(face);
    } else status.append(glyph('check2'));
    status.append(document.createTextNode(mood?.label ?? 'Apenas presença'));
    row.append(dateElement(entry.date, fullDay), status);
    list.append(row);
  }
  profileContent.replaceChildren(metrics, heading, list.childNodes.length ? list : detailFeedback('Nenhum registro neste período.'));
}

function comparableName(name) {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim();
}

export function mountClubRhMood(container, { request, onAuthError }) {
  container.innerHTML = `
    <section class="club-rh-mood" aria-labelledby="clubRhMoodTitle">
      <header class="club-rh-heading">
        <div class="club-rh-heading-content">
          <span class="club-rh-heading-mark" aria-hidden="true"><i class="bi bi-graph-up"></i></span>
          <div><h1 id="clubRhMoodTitle">Humor e presença</h1><p>Acompanhe as respostas do MaxHub compartilhadas com o RH.</p></div>
        </div>
        <div class="club-rh-toolbar">
          <label class="club-rh-field club-rh-period" for="clubRhPeriod">
            <span>Período</span>
            <select id="clubRhPeriod"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select>
          </label>
          <button type="button" class="club-rh-control club-rh-refresh"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i>Atualizar dados</button>
        </div>
      </header>
      <div data-rh-part="feedback"></div>
      <div class="club-rh-report" data-rh-part="report" hidden>
        <div data-rh-part="stats"></div>
        <div class="club-rh-charts">
          <section class="club-rh-card" aria-labelledby="clubRhDistributionTitle">
            <h3 id="clubRhDistributionTitle">Distribuição de humor</h3>
            <div data-rh-part="distribution"></div>
          </section>
          <section class="club-rh-card" aria-labelledby="clubRhTrendTitle">
            <h3 id="clubRhTrendTitle">Evolução do humor</h3>
            <div data-rh-part="trend"></div>
          </section>
        </div>
        <section class="club-rh-card" aria-labelledby="clubRhProfilesTitle">
          <div class="club-rh-profiles-head"><h3 id="clubRhProfilesTitle">Perfis com registros</h3>
            <label class="club-rh-field" for="clubRhProfileSearch"><span>Buscar por nome</span><input id="clubRhProfileSearch" type="search" autocomplete="off"></label>
          </div>
          <div data-rh-part="profiles"></div>
        </section>
      </div>
      <section class="club-rh-card club-rh-anonymous" data-rh-part="anonymousSection" aria-labelledby="clubRhAnonymousTitle" hidden>
        <div>
          <h2 id="clubRhAnonymousTitle">Comentários anônimos do termômetro</h2>
          <p class="club-rh-anonymous-note" data-rh-part="anonymousNote"></p>
        </div>
        <div class="club-rh-anonymous-weeks" data-rh-part="anonymousWeeks"></div>
      </section>
      <dialog class="club-rh-dialog" aria-labelledby="clubRhProfileTitle">
        <header class="club-rh-dialog-head">
          <div><h2 id="clubRhProfileTitle"></h2><p data-rh-part="profilePeriod"></p></div>
          <button type="button" class="club-rh-control club-rh-close" aria-label="Fechar perfil" autofocus><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </header>
        <div class="club-rh-dialog-content" data-rh-part="profileContent"></div>
      </dialog>
    </section>`;
  const refs = Object.fromEntries([...container.querySelectorAll('[data-rh-part]')].map(node => [node.dataset.rhPart, node]));
  const period = container.querySelector('#clubRhPeriod');
  const search = container.querySelector('#clubRhProfileSearch');
  const refresh = container.querySelector('.club-rh-refresh');
  const dialog = container.querySelector('dialog');
  const close = dialog.querySelector('.club-rh-close');
  const profileTitle = dialog.querySelector('#clubRhProfileTitle');
  let report;
  let chartCleanup;
  let profileOpener;
  let reportRequest = 0;
  let profileRequest = 0;
  let anonymousRequest = 0;

  async function loadProfile(profile) {
    const current = ++profileRequest;
    refs.profileContent.replaceChildren(detailFeedback('Carregando perfil…'));
    try {
      const data = await request(`/club/check-in/rh/${encodeURIComponent(profile.id)}?days=${period.value}`);
      if (current !== profileRequest || !dialog.open) return;
      profileTitle.textContent = data.profile.name;
      renderProfile(refs.profileContent, data.profile, data.history);
    } catch (error) {
      if (current !== profileRequest || !dialog.open) return;
      const unavailable = error.status === 403 || error.status === 404;
      const message = unavailable ? 'Perfil indisponível neste período.' : 'Não foi possível carregar o perfil.';
      refs.profileContent.replaceChildren(detailFeedback(message, unavailable ? null : () => loadProfile(profile)));
      if (error.status === 401) onAuthError(error);
    }
  }

  function showProfile(profile, button) {
    profileOpener = button;
    profileTitle.textContent = profile.name;
    refs.profilePeriod.textContent = `${fullDay.format(dayDate(report.firstDay))} a ${fullDay.format(dayDate(report.today))}`;
    dialog.showModal();
    void loadProfile(profile);
  }

  function renderProfiles() {
    if (!report) return;
    if (!report.profiles.length) {
      search.disabled = true;
      refs.profiles.replaceChildren(detailFeedback('Nenhum colaborador compartilhou registros neste período.'));
      return;
    }
    search.disabled = false;
    const query = comparableName(search.value);
    const matches = report.profiles.filter(profile => comparableName(profile.name).includes(query));
    if (!matches.length) {
      refs.profiles.replaceChildren(detailFeedback('Nenhum perfil corresponde à busca.'));
      return;
    }
    const list = element('ul', 'club-rh-profile-list');
    for (const profile of matches.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
      const row = element('li');
      const view = element('button', 'club-rh-profile');
      view.type = 'button';
      view.setAttribute('aria-label', `Ver perfil de ${profile.name}`);
      const mark = element('span', 'club-rh-profile-mark');
      mark.append(glyph('person'));
      const identity = element('span', 'club-rh-profile-identity');
      identity.append(element('strong', '', profile.name));
      if (profile.lastDate) {
        const lastDate = element('span', 'club-rh-profile-last', 'Último registro em ');
        lastDate.append(dateElement(profile.lastDate));
        identity.append(lastDate);
      }
      const values = element('span', 'club-rh-profile-values');
      values.append(element('span', '', `${number.format(profile.checkIns)} ${profile.checkIns === 1 ? 'check-in' : 'check-ins'}`), element('strong', '', moodAverage(profile.average)));
      view.append(mark, identity, values, glyph('chevron-right'));
      view.addEventListener('click', () => showProfile(profile, view));
      row.append(view);
      list.append(row);
    }
    refs.profiles.replaceChildren(list);
  }

  function renderReport() {
    const { totals, trend, profiles } = report;
    refs.stats.replaceChildren(statCards([
      { label: 'Check-ins', value: number.format(totals.checkIns), icon: 'check2', tone: 'blue' },
      { label: 'Respostas de humor', value: number.format(totals.answers), icon: 'chat-dots', tone: 'amber' },
      { label: 'Média de humor', value: moodAverage(totals.average), icon: 'graph-up', tone: 'green' },
      { label: 'Pessoas com registros', value: number.format(profiles.length), icon: 'people', tone: 'rose' },
    ]));
    refs.distribution.replaceChildren(distribution(totals));
    refs.trend.replaceChildren();
    refs.report.hidden = false;
    if (trend.some(day => day.answers)) {
      const chart = element('canvas', 'club-rh-chart');
      chart.setAttribute('role', 'img');
      chart.setAttribute('aria-label', 'Gráfico das médias diárias de humor, em uma escala de 1 a 5. Os valores exatos estão nos dados por dia.');
      refs.trend.append(chart);
      chartCleanup = mountTrendChart(chart, report);
    } else refs.trend.append(detailFeedback('A evolução aparece quando há respostas de humor compartilhadas.'));
    if (trend.length) refs.trend.append(trendTable([...trend].sort((a, b) => a.date.localeCompare(b.date))));
    renderProfiles();
  }

  function clearReport() {
    chartCleanup?.();
    chartCleanup = undefined;
    report = undefined;
    profileRequest += 1;
    profileOpener = undefined;
    if (dialog.open) dialog.close();
    profileTitle.textContent = '';
    refs.profilePeriod.textContent = '';
    refs.report.hidden = true;
    for (const key of ['stats', 'distribution', 'trend', 'profiles', 'profileContent']) refs[key].replaceChildren();
  }

  async function loadReport() {
    const current = ++reportRequest;
    clearReport();
    refresh.disabled = true;
    refs.feedback.replaceChildren(detailFeedback('Carregando indicadores…'));
    try {
      const data = await request(`/club/check-in/rh?days=${period.value}`);
      if (current !== reportRequest) return;
      report = data;
      refs.feedback.replaceChildren();
      renderReport();
    } catch (error) {
      if (current !== reportRequest) return;
      clearReport();
      if (error.status === 401) onAuthError(error);
      else if (error.status === 403) refs.feedback.replaceChildren(detailFeedback('Seu acesso não inclui o acompanhamento de check-ins do RH.'));
      else refs.feedback.replaceChildren(detailFeedback('Não foi possível carregar os indicadores.', loadReport));
    } finally {
      if (current === reportRequest) refresh.disabled = false;
    }
  }

  async function loadAnonymousComments() {
    const current = ++anonymousRequest;
    refs.anonymousNote.textContent = '';
    refs.anonymousSection.hidden = false;
    refs.anonymousWeeks.replaceChildren(detailFeedback('Carregando comentários…'));
    try {
      const { weeks, minimum } = await request('/club/check-in/anonymous-comments');
      if (current !== anonymousRequest) return;
      refs.anonymousNote.textContent = `Os comentários ficam disponíveis ao fim de cada semana com pelo menos ${number.format(minimum)} participantes.`;
      refs.anonymousWeeks.replaceChildren(...(weeks.length
        ? weeks.map(anonymousWeek)
        : [detailFeedback('Nenhum grupo de comentários disponível.')]));
    } catch (error) {
      if (current !== anonymousRequest) return;
      refs.anonymousSection.hidden = error.status === 401 || error.status === 403;
      if (error.status === 401) onAuthError(error);
      refs.anonymousWeeks.replaceChildren(detailFeedback('Não foi possível carregar os comentários.', loadAnonymousComments));
    }
  }

  function refreshDashboard() {
    void loadReport();
    void loadAnonymousComments();
  }

  function clearWhenHidden() {
    reportRequest += 1;
    anonymousRequest += 1;
    clearReport();
    refs.feedback.replaceChildren();
    refs.anonymousSection.hidden = true;
    refs.anonymousNote.textContent = '';
    refs.anonymousWeeks.replaceChildren();
  }

  function refreshOnVisibility() {
    if (document.visibilityState === 'visible') refreshDashboard();
    else clearWhenHidden();
  }

  function restoreOnBack(event) {
    if (event.persisted && document.visibilityState === 'visible') refreshDashboard();
  }

  period.addEventListener('change', loadReport);
  refresh.addEventListener('click', refreshDashboard);
  search.addEventListener('input', renderProfiles);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    profileRequest += 1;
    refs.profileContent.replaceChildren();
    profileOpener?.focus({ preventScroll: true });
  });
  document.addEventListener('visibilitychange', refreshOnVisibility);
  window.addEventListener('pageshow', restoreOnBack);
  window.addEventListener('pagehide', clearWhenHidden);
  refreshDashboard();
  return () => {
    clearWhenHidden();
    document.removeEventListener('visibilitychange', refreshOnVisibility);
    window.removeEventListener('pageshow', restoreOnBack);
    window.removeEventListener('pagehide', clearWhenHidden);
    container.replaceChildren();
  };
}
