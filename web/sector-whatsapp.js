const API = '/v1/platform/whatsapp';
const REFRESH_MS = 10_000;
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const SHORT_DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const FULL_DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' });
const DELIVERY_LABELS = {
  queued: 'Na fila', pending: 'Enviando', accepted: 'Aceita para envio', sent: 'Enviada', delivered: 'Entregue',
  read: 'Lida', failed: 'Falha no envio', uncertain: 'Envio não confirmado'
};

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function icon(name) {
  const node = element('i', `bi bi-${name}`);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function timestamp(value, dateOnly = false) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return dateOnly ? FULL_DATE.format(date) : TIME.format(date);
}

function activityDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return date.toDateString() === new Date().toDateString() ? TIME.format(date) : SHORT_DATE.format(date);
}

function contactName(conversation) {
  return conversation?.name || conversation?.phone || 'Contato';
}

function initials(conversation) {
  if (!conversation.name) return 'WA';
  return conversation.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'WA';
}

function searchKey(value) {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
}

async function request(path, { signal, body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = token;
  }
  const response = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers,
    body: body && JSON.stringify(body),
    signal
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    const error = new Error(payload?.message || 'Não foi possível consultar o WhatsApp.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function summary(sector, signal, page = 1) {
  return request('?' + new URLSearchParams({ sector, page }), { signal });
}

export async function getSectorWhatsAppUnread(sector, { signal } = {}) {
  const data = await summary(sector, signal);
  return data.configured ? Math.max(0, Number(data.unread) || 0) : 0;
}

function emptyState(symbol, title, message) {
  const panel = element('div', 'wa-empty');
  panel.append(icon(symbol), element('strong', '', title));
  if (message) panel.append(element('p', '', message));
  return panel;
}

function makeShell(container) {
  const root = element('section', 'wa-inbox');
  root.setAttribute('aria-label', 'Caixa de entrada do WhatsApp');
  root.innerHTML = `
    <header class="wa-header">
      <span class="wa-header-icon"><i class="bi bi-whatsapp" aria-hidden="true"></i></span>
      <div class="wa-heading">
        <h2>WhatsApp</h2>
        <p data-wa="connection">Carregando a caixa de entrada…</p>
      </div>
      <button type="button" data-wa="refresh" class="wa-control" title="Atualizar WhatsApp"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Atualizar</button>
    </header>
    <div data-wa="status" class="wa-status" role="status" hidden></div>
    <div data-wa="offline" class="wa-unavailable" hidden></div>
    <div data-wa="layout" class="wa-layout" hidden>
      <aside data-wa="directory" class="wa-directory" aria-label="Conversas do WhatsApp">
        <label class="wa-search"><i class="bi bi-search" aria-hidden="true"></i><span class="wa-visually-hidden">Buscar conversas do WhatsApp</span><input type="search" data-wa="search" placeholder="Buscar por nome ou número"></label>
        <div data-wa="conversations" class="wa-conversations"></div>
        <button type="button" data-wa="moreConversations" class="wa-control" hidden>Mais conversas</button>
      </aside>
      <div data-wa="thread" class="wa-thread">
        <div data-wa="placeholder" class="wa-thread-empty"></div>
        <div data-wa="conversation" class="wa-thread-inner" hidden>
          <header class="wa-thread-header">
            <button type="button" data-wa="back" class="wa-control wa-back" aria-label="Voltar às conversas"><i class="bi bi-arrow-left" aria-hidden="true"></i></button>
            <div class="wa-thread-label"><h3 data-wa="name" tabindex="-1"></h3><p data-wa="phone"></p></div>
          </header>
          <div data-wa="scroll" class="wa-scroll">
            <button type="button" data-wa="older" class="wa-control wa-older" hidden>Mensagens anteriores</button>
            <div data-wa="messages" class="wa-messages" aria-label="Histórico de mensagens"></div>
          </div>
          <div data-wa="replyInfo" class="wa-reply-info" hidden></div>
          <form data-wa="form" class="wa-composer">
            <label><span class="wa-visually-hidden">Resposta pelo WhatsApp</span><textarea data-wa="input" maxlength="4096" rows="2" placeholder="Escreva sua resposta"></textarea></label>
            <button type="submit" data-wa="send" class="wa-send"><i class="bi bi-send" aria-hidden="true"></i> Enviar</button>
          </form>
        </div>
      </div>
    </div>`;
  const ui = Object.fromEntries([...root.querySelectorAll('[data-wa]')].map((node) => [node.dataset.wa, node]));
  ui.placeholder.append(emptyState('chat-dots', 'Selecione uma conversa', 'Veja o histórico e responda ao contato pela Central.'));
  container.replaceChildren(root);
  return { root, ui };
}

function renderConversations(state) {
  const { ui, conversations, selected } = state;
  const focused = ui.conversations.contains(document.activeElement) ? document.activeElement.dataset.conversationId : null;
  const query = searchKey(ui.search.value.trim());
  const matches = conversations.filter((entry) => searchKey(`${entry.name || ''} ${entry.phone || ''}`).includes(query));
  if (!matches.length) {
    ui.conversations.replaceChildren(emptyState('chat-dots', query ? 'Nenhum resultado' : 'Nenhuma conversa ainda',
      query ? 'Busque por outro nome ou número.' : 'As mensagens recebidas no número conectado aparecerão aqui.'));
    return;
  }
  let restoreFocus;
  ui.conversations.replaceChildren(...matches.map((entry) => {
    const button = element('button', 'wa-contact');
    button.type = 'button';
    button.dataset.conversationId = entry.id;
    button.setAttribute('aria-pressed', String(entry.id === selected));
    const avatar = element('span', 'wa-avatar', initials(entry));
    avatar.setAttribute('aria-hidden', 'true');
    const details = element('span', 'wa-contact-text');
    details.append(element('strong', '', contactName(entry)), element('small', '', entry.lastMessage || entry.phone || 'Conversa'));
    const meta = element('span', 'wa-contact-meta');
    meta.append(element('small', '', activityDate(entry.lastAt)));
    if (entry.unread > 0) {
      const unread = element('span', 'wa-unread', entry.unread > 99 ? '99+' : String(entry.unread));
      unread.setAttribute('aria-label', `${entry.unread} mensagens não lidas`);
      meta.append(unread);
    }
    button.append(avatar, details, meta);
    button.addEventListener('click', () => openThread(state, entry));
    if (entry.id === focused) restoreFocus = button;
    return button;
  }));
  restoreFocus?.focus({ preventScroll: true });
}

function setStatus(state, message = '') {
  state.ui.status.textContent = message;
  state.ui.status.hidden = !message;
}

function setCanReply(state, allowed) {
  state.canReply = Boolean(allowed);
  state.ui.form.hidden = !allowed;
  state.ui.replyInfo.hidden = Boolean(allowed);
  state.ui.replyInfo.textContent = state.sectorCanReply
    ? 'A resposta fica disponível durante 24 horas após uma mensagem do contato.'
    : 'Seu acesso ao WhatsApp deste setor permite consultar conversas.';
}

function syncComposer(state) {
  const sending = state.sending.has(state.selected);
  state.ui.input.disabled = sending;
  state.ui.send.disabled = sending || !state.ui.input.value.trim();
}

function updateMessages(state) {
  const rows = [];
  let lastDate = '';
  for (const message of state.messages) {
    const date = timestamp(message.at, true);
    if (date && date !== lastDate) rows.push(element('p', 'wa-day', date));
    lastDate = date || lastDate;
    const outbound = message.direction === 'outbound';
    const row = element('article', `wa-message ${outbound ? 'wa-message-outgoing' : 'wa-message-incoming'}`);
    row.append(element('p', 'wa-message-text', message.text || 'Conteúdo indisponível nesta caixa de entrada.'));
    const metadata = element('span', 'wa-message-meta', [timestamp(message.at), outbound && (DELIVERY_LABELS[message.status] || '')].filter(Boolean).join(' · '));
    row.append(metadata);
    rows.push(row);
  }
  if (!rows.length) rows.push(emptyState('chat-dots', 'Sem mensagens', 'O histórico desta conversa aparecerá aqui.'));
  state.ui.messages.replaceChildren(...rows);
  state.ui.older.hidden = !state.hasMore;
}

function setMobileThread(state, show) {
  state.root.dataset.mobileView = show ? 'thread' : 'directory';
  state.mobileThread = show;
}

function renderThread(state, entry) {
  state.ui.placeholder.hidden = true;
  state.ui.conversation.hidden = false;
  state.ui.name.textContent = contactName(entry);
  state.ui.phone.textContent = entry.phone || '';
}

function closeThread(state) {
  state.selected = null;
  state.messages = [];
  state.ui.input.value = '';
  syncComposer(state);
  state.ui.conversation.hidden = true;
  state.ui.placeholder.hidden = false;
  setMobileThread(state, false);
  renderConversations(state);
}

function applySummary(state, data, page) {
  state.connected = Boolean(data.configured);
  state.ui.layout.hidden = !state.connected;
  state.ui.offline.hidden = state.connected;
  state.ui.connection.textContent = state.connected ? 'Caixa de entrada do setor' : 'Número não conectado';
  state.sectorCanReply = Boolean(data.canReply);
  state.onUnread?.(state.connected ? Math.max(0, Number(data.unread) || 0) : 0);
  if (!state.connected) {
    state.ui.offline.replaceChildren(emptyState('whatsapp', 'Nenhum número conectado', 'Peça ao setor de Tecnologia para vincular o número deste setor à Central Maximum.'));
    return;
  }
  const entries = Array.isArray(data.conversations) ? data.conversations : [];
  if (page === 1) {
    const latestIds = new Set(entries.map(({ id }) => id));
    state.conversations = [...entries, ...state.conversations.filter(({ id }) => (state.page > 1 || id === state.selected) && !latestIds.has(id))];
  } else {
    const conversations = new Map(state.conversations.map((entry) => [entry.id, entry]));
    for (const entry of entries) conversations.set(entry.id, entry);
    state.conversations = [...conversations.values()];
  }
  if (page >= state.page) {
    state.page = page;
    state.ui.moreConversations.hidden = !data.hasMore;
  }
  const selected = state.conversations.find(({ id }) => id === state.selected);
  if (selected) {
    renderThread(state, selected);
    setCanReply(state, selected.canReply && state.sectorCanReply);
  } else if (state.selected) closeThread(state);
  renderConversations(state);
}

function showError(state, error) {
  if (!state.signal.aborted) setStatus(state, error.message);
}

async function refreshSummary(state, page = 1) {
  const data = await summary(state.sector, state.signal, page);
  if (!state.signal.aborted) applySummary(state, data, page);
}

async function markRead(state, selected) {
  const latestInbound = [...state.messages].reverse().find(({ direction }) => direction === 'inbound');
  const conversation = state.conversations.find(({ id }) => id === selected);
  const scroll = state.ui.scroll;
  const atEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 55;
  if (state.signal.aborted || document.hidden || !state.mobileThread || !atEnd || !latestInbound || !conversation?.unread || state.readThrough.get(selected) === latestInbound.id) return;
  state.readThrough.set(selected, latestInbound.id);
  try {
    await request('/read', { signal: state.signal, token: state.token, body: { sector: state.sector, conversation: selected, through: latestInbound.id } });
    await refreshSummary(state);
  } catch {
    state.readThrough.delete(selected);
  }
}

async function readThread(state, { older = false, scrollToEnd = false } = {}) {
  const selected = state.selected;
  if (!selected) return;
  const sequence = ++state.sequence;
  const query = new URLSearchParams({ sector: state.sector, conversation: selected });
  if (older && state.messages.length) query.set('before', state.messages[0].id);
  const scroll = state.ui.scroll;
  const height = scroll.scrollHeight;
  const top = scroll.scrollTop;
  const nearBottom = height - top - scroll.clientHeight < 55;
  const result = await request('/messages?' + query, { signal: state.signal });
  if (state.signal.aborted || selected !== state.selected || sequence !== state.sequence) return;
  const incoming = Array.isArray(result.messages) ? result.messages : [];
  const combined = new Map(state.messages.map((message) => [message.id, message]));
  for (const message of incoming) combined.set(message.id, message);
  state.messages = [...combined.values()].sort((a, b) => String(a.id).length - String(b.id).length || String(a.id).localeCompare(String(b.id)));
  if (older || !state.historyReady) state.hasMore = Boolean(result.hasMore);
  state.historyReady = true;
  setCanReply(state, result.canReply && state.sectorCanReply);
  updateMessages(state);
  if (older) scroll.scrollTop = top + scroll.scrollHeight - height;
  else if (scrollToEnd || nearBottom) scroll.scrollTop = scroll.scrollHeight;
  if (!older) void markRead(state, selected);
}

function openThread(state, entry) {
  if (state.selected !== entry.id) {
    state.selected = entry.id;
    state.messages = [];
    state.historyReady = false;
    state.hasMore = false;
    state.ui.input.value = state.drafts.get(entry.id)?.text || '';
    syncComposer(state);
    state.ui.messages.replaceChildren(element('p', 'wa-day', 'Carregando mensagens…'));
    state.ui.older.hidden = true;
  }
  setMobileThread(state, true);
  renderThread(state, entry);
  renderConversations(state);
  setCanReply(state, entry.canReply && state.sectorCanReply);
  setStatus(state);
  state.ui.name.focus({ preventScroll: true });
  void readThread(state, { scrollToEnd: true }).catch((error) => showError(state, error));
}

async function refresh(state, force = false) {
  if (state.refreshing || (!force && (document.hidden || !state.connected))) return;
  state.refreshing = true;
  state.ui.refresh.disabled = true;
  try {
    await refreshSummary(state);
    if (state.connected && state.selected && (state.mobileThread || !state.mobile.matches)) await readThread(state);
    setStatus(state);
  } catch (error) {
    showError(state, error);
  } finally {
    state.refreshing = false;
    state.ui.refresh.disabled = false;
  }
}

async function submitReply(state, event) {
  event.preventDefault();
  const conversation = state.selected;
  const text = state.ui.input.value.trim();
  if (!conversation || !state.canReply || !text || state.sending.has(conversation)) return;
  const previous = state.drafts.get(conversation);
  const clientId = previous?.text === text && previous.clientId ? previous.clientId : crypto.randomUUID();
  state.drafts.set(conversation, { text, clientId });
  state.sending.add(conversation);
  syncComposer(state);
  setStatus(state);
  try {
    await request('/reply', { signal: state.signal, token: state.token, body: { sector: state.sector, conversation, text, clientId } });
    state.drafts.delete(conversation);
    if (state.selected === conversation) state.ui.input.value = '';
    await refreshSummary(state);
    if (state.selected === conversation) await readThread(state, { scrollToEnd: true });
  } catch (error) {
    showError(state, error);
  } finally {
    state.sending.delete(conversation);
    if (state.selected === conversation) syncComposer(state);
  }
}

export function mountSectorWhatsApp(container, { sector, session, onUnread } = {}) {
  const controller = new AbortController();
  const state = {
    ...makeShell(container), sector, onUnread, token: session?.csrfToken, signal: controller.signal,
    mobile: window.matchMedia('(max-width: 730px)'), connected: false, selected: null, conversations: [], messages: [], sequence: 0, page: 1,
    drafts: new Map(), sending: new Set(), readThrough: new Map()
  };
  const { ui } = state;
  setMobileThread(state, false);
  ui.refresh.addEventListener('click', () => void refresh(state, true));
  ui.search.addEventListener('input', () => renderConversations(state));
  ui.scroll.addEventListener('scroll', () => void markRead(state, state.selected));
  ui.moreConversations.addEventListener('click', async () => {
    ui.moreConversations.disabled = true;
    try { await refreshSummary(state, state.page + 1); }
    catch (error) { showError(state, error); }
    finally { ui.moreConversations.disabled = false; }
  });
  ui.older.addEventListener('click', () => void readThread(state, { older: true }).catch((error) => showError(state, error)));
  ui.back.addEventListener('click', () => {
    setMobileThread(state, false);
    ui.search.focus();
  });
  ui.input.addEventListener('input', () => {
    state.drafts.set(state.selected, { text: ui.input.value });
    syncComposer(state);
  });
  ui.form.addEventListener('submit', (event) => void submitReply(state, event));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.connected) void refresh(state);
  }, { signal: state.signal });
  const timer = setInterval(() => void refresh(state), REFRESH_MS);
  void refresh(state, true);
  return () => {
    controller.abort();
    clearInterval(timer);
    state.root.remove();
  };
}
