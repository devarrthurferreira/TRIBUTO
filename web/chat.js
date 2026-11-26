import { appendPersonName } from './person-name.js';

const API = '/v1/platform/chat';
const MAX_FILES = 3;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const ACCEPTED_FILE_NAMES = /\.(pdf|png|jpe?g|gif|webp|txt|csv|docx|xlsx|pptx)$/i;
const ACCEPTED_FILES = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.docx,.xlsx,.pptx';
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
const RELATIVE_DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const SECTOR_LINK = /^\/setor\/[a-z]+$/;
const socketScriptPath = '/socket.io/socket.io.js';
let currentChat = null;

function el(tag, css, content) {
  const element = document.createElement(tag);
  if (css) element.className = css;
  if (content !== undefined) element.textContent = content;
  return element;
}

function icon(name) {
  const element = el('i', `bi bi-${name}`);
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function iconButton(name, title) {
  const button = el('button', 'chat-icon-button');
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(icon(name));
  return button;
}

function badge(count) {
  const label = el('span', 'chat-unread', count > 99 ? '99+' : String(count));
  label.setAttribute('aria-hidden', 'true');
  return label;
}

function initials(name) {
  return String(name || '').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
}

function searchable(value) {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
}

function fileSize(size) {
  const kilobytes = size / 1024;
  return kilobytes < 1024 ? `${Math.max(1, Math.round(kilobytes))} KB` : `${(kilobytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function timeLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : TIME.format(date);
}

function activityLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toDateString() === new Date().toDateString() ? TIME.format(date) : RELATIVE_DATE.format(date);
}

function messagePreview(message) {
  if (!message) return '';
  if (message.deletedAt) return 'Mensagem excluída';
  return message.text || message.reference?.label || (message.attachments?.length ? 'Anexo' : '');
}

function restore(userId) {
  try {
    return JSON.parse(sessionStorage.getItem(`maximum-chat:${userId}`)) || {};
  } catch {
    return {};
  }
}

function remember(state, open = state.dialog.open) {
  try {
    sessionStorage.setItem(`maximum-chat:${state.session.user.id}`, JSON.stringify({ open: open && !state.mount, room: state.room?.id || state.pendingRoom || null }));
  } catch {
    // The current page can continue when the browser has disabled session storage.
  }
}

function open(state, roomId) {
  if (state.mount && !state.mount.getClientRects().length) return;
  if (!state.dialog.open) {
    if (state.mount) state.dialog.show();
    else state.dialog.showModal();
  }
  if (!state.mount) state.launcher.setAttribute('aria-expanded', 'true');
  if (roomId && roomId !== state.room?.id) {
    state.pendingRoom = roomId;
    showPendingRoom(state);
  } else if (state.pendingRoom) {
    showPendingRoom(state);
  } else if (state.room && state.historyReady) {
    scrollEnd(state);
    markRead(state);
  }
  remember(state);
  void refreshSummary(state).catch(() => reportSummaryFailure(state));
}

function setNotice(state, message = '') {
  state.refs.status.textContent = message;
  state.refs.status.hidden = !message;
}

function reportSummaryFailure(state) {
  if (state === currentChat && !state.hasSummary) setNotice(state, 'Não foi possível carregar as conversas. Use Atualizar conversas para tentar de novo.');
}

function syncConnection(state, connected) {
  state.connected = connected;
  const connection = state.refs.connection;
  connection.lastElementChild.textContent = connected ? 'Em tempo real' : 'Conectando…';
  connection.dataset.status = connected ? 'online' : 'connecting';
  updateSend(state);
}

function newDraft() {
  return { text: '', files: [], reference: null, clientId: null, sending: false };
}

function draftFor(state, roomId = state.room?.id) {
  if (!state.drafts.has(roomId)) state.drafts.set(roomId, newDraft());
  return state.drafts.get(roomId);
}

function renderDraft(state) {
  const draft = draftFor(state);
  state.refs.text.value = draft.text;
  renderDraftParts(state);
}

function renderDraftParts(state) {
  const draft = draftFor(state);
  const container = state.refs.draftParts;
  container.replaceChildren();
  for (const file of draft.files) {
    const part = el('span', 'chat-draft-chip');
    const title = el('span', '', file.name);
    title.title = file.name;
    const remove = iconButton('x-lg', `Remover ${file.name}`);
    remove.disabled = draft.sending;
    remove.addEventListener('click', () => {
      draft.files = draft.files.filter(entry => entry !== file);
      draft.clientId = null;
      renderDraftParts(state);
    });
    part.append(icon('paperclip'), title, remove);
    container.append(part);
  }
  if (draft.reference) {
    const part = el('span', 'chat-draft-chip');
    const title = el('span', '', draft.reference.label);
    title.title = draft.reference.label;
    const remove = iconButton('x-lg', 'Remover vínculo');
    remove.disabled = draft.sending;
    remove.addEventListener('click', () => {
      draft.reference = null;
      draft.clientId = null;
      renderDraftParts(state);
    });
    part.append(icon('link-45deg'), title, remove);
    container.append(part);
  }
  updateSend(state);
}

function updateSend(state) {
  if (!state.room) return;
  const draft = draftFor(state);
  const hasContent = Boolean(draft.text.trim() || draft.files.length || draft.reference);
  state.refs.composer.hidden = Boolean(state.room.readOnly || state.mutation);
  state.refs.readOnly.hidden = !state.room.readOnly || Boolean(state.mutation);
  state.refs.send.disabled = !state.connected || !state.historyReady || !hasContent || draft.sending;
  state.refs.text.disabled = draft.sending;
  state.refs.attach.disabled = draft.sending;
  state.refs.addReference.disabled = draft.sending || !state.modules.length;
  updateMutationControls(state);
}

function canReviseRoom(room) {
  return room && (room.kind !== 'sector' || !room.readOnly);
}

async function api(state, suffix = '', options = {}) {
  const headers = { Accept: 'application/json' };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = state.session.csrfToken;
  }
  const response = await fetch(`${API}${suffix}`, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: state.abort.signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Não foi possível concluir esta ação.');
  return data;
}

function updateUnread(state, count, message = null) {
  if (state !== currentChat) return;
  state.unread = Math.max(Number(count) || 0, 0);
  state.launcher.querySelector('.chat-unread')?.remove();
  if (state.unread) state.launcher.append(badge(state.unread));
  state.launcher.setAttribute('aria-label', state.unread ? `Abrir chat interno. ${state.unread} não lidas` : 'Abrir chat interno');
  state.notify?.({ unread: state.unread, message });
}

async function refreshSummary(state) {
  const seq = ++state.summarySeq;
  const summary = await api(state);
  if (state !== currentChat || seq !== state.summarySeq) return;
  state.hasSummary = true;
  state.people = summary.people || [];
  state.modules = summary.modules || [];
  state.rooms = summary.rooms || [];
  state.roomLookup = new Map(state.rooms.map(room => [room.id, room]));
  for (const person of state.people) {
    const id = `direct:${person.id}`;
    const known = state.roomLookup.get(id);
    state.roomLookup.set(id, {
      ...(known || { id, name: person.name, kind: 'direct', unread: 0 }),
      online: person.online,
      tenureYears: person.tenureYears ?? known?.tenureYears
    });
  }
  if (state.room) {
    const previous = state.room;
    const room = state.roomLookup.get(previous.id);
    if (room) {
      state.room = room;
      if (previous.name !== room.name || previous.tenureYears !== room.tenureYears) {
        renderRoomName(state.refs.title, room);
      }
      if (canReviseRoom(previous) !== canReviseRoom(room)) {
        if (!canReviseRoom(room)) closeMutation(state, false);
        if (state.historyReady) renderMessages(state);
      }
    } else if (previous.kind === 'sector') {
      clearUnavailableRoom(state);
    }
  }
  updateUnread(state, summary.unread);
  renderRoomList(state);
  showPendingRoom(state);
  updateSend(state);
}

function requestSummary(state) {
  clearTimeout(state.summaryTimer);
  state.summaryTimer = setTimeout(() => {
    void refreshSummary(state).catch(() => reportSummaryFailure(state));
  }, 160);
}

function findRoom(state, roomId) {
  return state.roomLookup.get(roomId);
}

function showPendingRoom(state) {
  if (!state.dialog.open || !state.pendingRoom) return;
  const room = findRoom(state, state.pendingRoom);
  if (room) selectRoom(state, room);
  if (state.hasSummary) state.pendingRoom = null;
}

function conversationVisible(state) {
  return state.dialog.open && document.visibilityState !== 'hidden' && state.refs.messages.getClientRects().length > 0;
}

function renderRoomName(label, room) {
  label.replaceChildren();
  appendPersonName(label, room.name, room.kind === 'direct' ? room.tenureYears : undefined);
}

function renderRoomList(state) {
  const query = searchable(state.refs.search.value.trim());
  const container = state.refs.rooms;
  const focusedRoom = document.activeElement?.dataset.roomId;
  container.replaceChildren();
  const sectors = state.rooms.filter(room => room.kind === 'sector');
  const direct = [...state.roomLookup.values()].filter(room => room.kind === 'direct');
  direct.sort((first, second) => {
    const a = first.lastMessage?.createdAt || '';
    const b = second.lastMessage?.createdAt || '';
    return b.localeCompare(a) || first.name.localeCompare(second.name, 'pt-BR');
  });
  function group(title, list) {
    const matching = list.filter(room => searchable(room.name).includes(query));
    if (!matching.length) return;
    const section = el('section', 'chat-room-group');
    section.append(el('h3', 'chat-room-label', title));
    for (const room of matching) {
      const selected = room.id === state.room?.id;
      const button = el('button', 'chat-room-button');
      button.type = 'button';
      button.dataset.roomId = room.id;
      button.setAttribute('aria-pressed', String(selected));
      const avatar = el('span', `chat-avatar ${room.kind === 'sector' ? 'chat-avatar-sector' : ''}`);
      if (room.kind === 'sector') avatar.append(icon('hash'));
      else {
        avatar.textContent = initials(room.name);
        if (room.online) avatar.append(el('span', 'chat-room-online'));
      }
      avatar.setAttribute('aria-hidden', 'true');
      const titles = el('span', 'chat-room-text');
      const name = el('strong');
      renderRoomName(name, room);
      titles.append(name, el('small', '', messagePreview(room.lastMessage) || (room.kind === 'sector' ? 'Canal do setor' : 'Mensagem direta')));
      const meta = el('span', 'chat-room-meta');
      if (room.lastMessage?.createdAt) meta.append(el('time', '', activityLabel(room.lastMessage.createdAt)));
      if (room.unread) {
        meta.append(badge(room.unread));
        const unread = el('span', 'sr-only', `${room.unread} não lidas`);
        button.append(unread);
      }
      button.append(avatar, titles, meta);
      button.addEventListener('click', () => selectRoom(state, room, true));
      section.append(button);
    }
    container.append(section);
  }
  group('Setores', sectors);
  group('Pessoas', direct);
  if (!container.children.length) {
    container.append(el('p', 'chat-list-empty', state.hasSummary ? (query ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa disponível.') : 'Carregando conversas…'));
  }
  if (focusedRoom) {
    [...container.querySelectorAll('[data-room-id]')].find(button => button.dataset.roomId === focusedRoom)?.focus({ preventScroll: true });
  }
}

function selectRoom(state, room, focus = false) {
  if (state.room?.id === room.id && state.historyReady) {
    state.dialog.dataset.mobileView = 'conversation';
    if (focus) state.refs.title.focus();
    return;
  }
  state.room = room;
  state.messages = new Map();
  state.hasMore = false;
  state.historyReady = false;
  state.roomSeq += 1;
  state.mutation = null;
  state.pendingUpdates.clear();
  state.refs.mutation.hidden = true;
  state.dialog.dataset.mobileView = 'conversation';
  state.refs.blank.hidden = true;
  state.refs.thread.hidden = false;
  renderRoomName(state.refs.title, room);
  state.refs.channelType.textContent = room.kind === 'sector' ? 'Canal do setor' : 'Conversa direta';
  state.refs.linkChooser.hidden = true;
  state.refs.messages.replaceChildren(el('p', 'chat-empty-state', 'Carregando conversa…'));
  state.refs.more.hidden = true;
  setNotice(state);
  remember(state);
  renderRoomList(state);
  renderDraft(state);
  if (focus) state.refs.title.focus();
  void loadHistory(state).catch(error => {
    if (state === currentChat && room.id === state.room?.id) setNotice(state, error.message);
  });
}

function clearUnavailableRoom(state) {
  const { refs, room } = state;
  const focusSearch = refs.thread.contains(document.activeElement);
  state.room = null;
  state.roomSeq += 1;
  state.historyReady = false;
  state.hasMore = false;
  state.messages.clear();
  state.pendingUpdates.clear();
  state.drafts.delete(room.id);
  state.marked.delete(room.id);
  closeMutation(state, false);
  refs.text.value = '';
  refs.draftParts.replaceChildren();
  refs.linkChooser.hidden = true;
  refs.messages.replaceChildren();
  refs.thread.hidden = true;
  refs.blank.hidden = false;
  state.dialog.dataset.mobileView = 'list';
  if (state.pendingRoom === room.id) state.pendingRoom = null;
  remember(state);
  if (focusSearch) refs.search.focus({ preventScroll: true });
}

function scrollEnd(state) {
  state.refs.messages.scrollTop = state.refs.messages.scrollHeight;
}

function nearEnd(state) {
  const messages = state.refs.messages;
  return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 130;
}

function orderedMessages(messages) {
  return new Map([...messages].sort(([first], [second]) => BigInt(first) < BigInt(second) ? -1 : 1));
}

function latestMessage(current, incoming) {
  if (!current) return incoming;
  if (current.deletedAt) return current;
  if (incoming.deletedAt) return incoming;
  return (incoming.editedAt || '') >= (current.editedAt || '') ? incoming : current;
}

function actionButton(label, action) {
  const button = el('button', 'chat-message-action', label);
  button.type = 'button';
  button.dataset.messageAction = action;
  return button;
}

function messageElement(state, message) {
  const sentByMe = message.sender.id === state.session.user.id;
  const item = el('li', `chat-message${sentByMe ? ' chat-message-mine' : ''}`);
  item.dataset.messageId = message.id;
  const avatar = el('span', 'chat-avatar chat-message-avatar', initials(message.sender.name));
  avatar.setAttribute('aria-hidden', 'true');
  const block = el('div', 'chat-message-content');
  const meta = el('div', 'chat-message-meta');
  const time = el('time', '', timeLabel(message.createdAt));
  time.dateTime = message.createdAt;
  const name = el('strong');
  const tenureYears = message.sender.tenureYears ?? (sentByMe ? state.session.user.tenureYears : undefined);
  appendPersonName(name, sentByMe ? 'Você' : message.sender.name, tenureYears);
  meta.append(name, time);
  const body = el('div', 'chat-bubble');
  if (message.deletedAt) {
    body.classList.add('chat-deleted');
    body.append(el('p', '', 'Mensagem excluída'));
    block.append(meta, body);
    item.append(avatar, block);
    return item;
  }
  if (message.editedAt) {
    const edited = el('span', 'chat-edited', 'Editada');
    edited.title = `Editada às ${timeLabel(message.editedAt)}`;
    meta.append(edited);
  }
  if (message.text) body.append(el('p', '', message.text));
  for (const attachment of message.attachments || []) {
    const link = el('a', 'chat-inline-link');
    link.href = `${API}/attachment/${encodeURIComponent(attachment.id)}`;
    link.download = attachment.name;
    const label = el('span', 'chat-link-copy');
    label.append(el('strong', '', attachment.name), el('small', '', fileSize(attachment.size)));
    link.append(icon('file-earmark'), label, icon('download'));
    body.append(link);
  }
  if (message.reference) {
    const reference = message.reference;
    const sector = String(reference.module || reference.id);
    const expectedPath = `/setor/${sector}`;
    const href = typeof reference.href === 'string' ? reference.href : expectedPath;
    const safeLink = SECTOR_LINK.test(expectedPath) && (href === expectedPath || href.startsWith(`${expectedPath}?`) || href.startsWith(`${expectedPath}#`));
    if (safeLink) {
      const link = el('a', 'chat-inline-link');
      link.href = href;
      link.addEventListener('click', event => {
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) remember(state, false);
      });
      const label = el('span', 'chat-link-copy');
      label.append(el('strong', '', reference.label), el('small', '', reference.type === 'task' ? 'Abrir atividade na Central' : 'Abrir setor na Central'));
      link.append(icon('link-45deg'), label);
      body.append(link);
    }
  }
  block.append(meta, body);
  if (sentByMe && canReviseRoom(state.room)) {
    const actions = el('div', 'chat-message-actions');
    for (const [action, label] of [['edit', 'Editar'], ['delete', 'Excluir']]) {
      const button = actionButton(label, action);
      button.setAttribute('aria-label', `${label} mensagem`);
      button.addEventListener('click', () => startMutation(state, message.id, action));
      actions.append(button);
    }
    block.append(actions);
  }
  item.append(avatar, block);
  return item;
}

function renderMessages(state, scrollToBottom = false) {
  const list = state.refs.messages;
  const previousScroll = list.scrollTop;
  const active = document.activeElement?.closest('[data-message-id]');
  const messageId = active?.dataset.messageId;
  const action = document.activeElement?.dataset.messageAction;
  list.replaceChildren();
  if (!state.messages.size) {
    list.append(el('p', 'chat-empty-state', 'Ainda não há mensagens. Comece a conversa abaixo.'));
    return;
  }
  const timeline = el('ol', 'chat-timeline');
  let day = '';
  for (const message of state.messages.values()) {
    const date = new Date(message.createdAt);
    const label = Number.isNaN(date.getTime()) ? '' : DATE.format(date);
    if (label && label !== day) {
      timeline.append(el('li', 'chat-date', label));
      day = label;
    }
    timeline.append(messageElement(state, message));
  }
  list.append(timeline);
  if (scrollToBottom) scrollEnd(state);
  else list.scrollTop = previousScroll;
  if (messageId && action) focusMessageAction(state, messageId, action);
}

async function loadHistory(state, older = false) {
  const roomId = state.room?.id;
  if (!roomId) return;
  const seq = state.roomSeq;
  const before = older ? state.messages.keys().next().value : null;
  const params = new URLSearchParams({ room: roomId });
  if (before) params.set('before', before);
  const list = state.refs.messages;
  const oldHeight = list.scrollHeight;
  const oldPosition = list.scrollTop;
  state.refs.more.disabled = true;
  try {
    const { messages, hasMore } = await api(state, `/messages?${params}`);
    if (state !== currentChat || seq !== state.roomSeq) return;
    const merged = new Map(messages.map(row => [row.id, latestMessage(row, state.pendingUpdates.get(row.id) || row)]));
    for (const [id, message] of state.messages) merged.set(id, latestMessage(message, merged.get(id) || message));
    state.messages = orderedMessages(merged);
    state.hasMore = Boolean(hasMore);
    state.historyReady = true;
    state.refs.more.hidden = !state.hasMore;
    renderMessages(state, !older);
    if (older) list.scrollTop = oldPosition + list.scrollHeight - oldHeight;
    updateSend(state);
    markRead(state);
  } finally {
    if (seq === state.roomSeq) state.refs.more.disabled = false;
  }
}

function markRead(state) {
  if (state !== currentChat || !conversationVisible(state) || !state.historyReady || !state.room || !nearEnd(state)) return;
  const message = Array.from(state.messages.values()).at(-1);
  if (!message || state.marked.get(state.room.id) === message.id) return;
  const room = state.room.id;
  const through = message.id;
  state.marked.set(room, through);
  void api(state, '/read', { method: 'POST', body: JSON.stringify({ room, through }) })
    .then(() => requestSummary(state))
    .catch(() => {
      if (state.marked.get(room) === through) state.marked.delete(room);
    });
}

function receiveMessage(state, message, fromSocket = false) {
  if (state !== currentChat || !message?.id) return;
  if (message.room === state.room?.id && !state.messages.has(message.id)) {
    const atEnd = nearEnd(state);
    state.messages.set(message.id, latestMessage(message, state.pendingUpdates.get(message.id) || message));
    state.messages = orderedMessages(state.messages);
    if (state.historyReady) renderMessages(state, atEnd || message.sender.id === state.session.user.id);
    markRead(state);
  }
  if (fromSocket && message.sender.id !== state.session.user.id && !state.recent.has(message.id)) {
    state.recent.add(message.id);
    if (state.recent.size > 256) state.recent.delete(state.recent.values().next().value);
    const visibleConversation = conversationVisible(state) && state.room?.id === message.room && nearEnd(state);
    if (!visibleConversation) updateUnread(state, state.unread + 1, message);
  }
  requestSummary(state);
}

function applyMessageUpdate(state, message) {
  if (state !== currentChat || !message?.id) return;
  if (message.room === state.room?.id) {
    const previous = state.messages.get(message.id);
    if (previous) {
      const updated = latestMessage(previous, message);
      if (updated !== previous) {
        state.messages.set(message.id, updated);
        renderMessages(state);
      }
    } else {
      state.pendingUpdates.set(message.id, latestMessage(state.pendingUpdates.get(message.id), message));
      if (state.pendingUpdates.size > 100) state.pendingUpdates.delete(state.pendingUpdates.keys().next().value);
    }
    if (message.deletedAt && state.mutation?.id === message.id && !state.mutation.pending) closeMutation(state);
  }
  requestSummary(state);
}

function focusMessageAction(state, id, action) {
  state.refs.messages.querySelector(`[data-message-id="${CSS.escape(id)}"] [data-message-action="${action}"]`)?.focus({ preventScroll: true });
}

function updateMutationControls(state) {
  if (!state.mutation) return;
  const { mutationText, mutationCancel, mutationSubmit } = state.refs;
  const { type, pending } = state.mutation;
  mutationText.disabled = pending;
  mutationCancel.disabled = pending;
  mutationSubmit.disabled = pending || !state.connected || (type === 'edit' && mutationText.value === state.mutation.originalText);
}

function startMutation(state, id, type) {
  const message = state.messages.get(id);
  if (!canReviseRoom(state.room) || !message || message.deletedAt || state.mutation?.pending) return;
  const { mutation, mutationTitle, mutationHint, mutationLabel, mutationText, mutationSubmit, mutationCancel } = state.refs;
  const deleting = type === 'delete';
  state.mutation = { id, type, room: message.room, originalText: message.text, pending: false };
  mutationTitle.textContent = deleting ? 'Excluir mensagem?' : 'Editar mensagem';
  mutationHint.textContent = deleting ? 'O texto, os anexos e os vínculos serão removidos da conversa.' : '';
  mutationHint.hidden = !deleting;
  mutationLabel.hidden = deleting;
  mutationText.value = message.text;
  mutationSubmit.textContent = deleting ? 'Excluir mensagem' : 'Salvar alteração';
  mutationSubmit.classList.toggle('chat-control-danger', deleting);
  mutation.hidden = false;
  setNotice(state);
  updateSend(state);
  (deleting ? mutationCancel : mutationText).focus();
}

function closeMutation(state, focus = true) {
  const previous = state.mutation;
  state.mutation = null;
  state.refs.mutation.hidden = true;
  state.refs.mutationText.value = '';
  updateSend(state);
  if (focus && previous) focusMessageAction(state, previous.id, previous.type);
}

async function submitMutation(state, event) {
  event.preventDefault();
  const action = state.mutation;
  if (!canReviseRoom(state.room) || !action || action.pending || !state.socket?.connected || state.refs.mutationSubmit.disabled) return;
  const { id, room, type } = action;
  const input = { id, room };
  if (type === 'edit') input.text = state.refs.mutationText.value.trim();
  action.pending = true;
  updateMutationControls(state);
  setNotice(state);
  try {
    const result = await state.socket.timeout(15000).emitWithAck(`chat:${type}`, input);
    if (state !== currentChat) return;
    if (!result?.ok) throw new Error(result?.error || 'Não foi possível atualizar a mensagem.');
    applyMessageUpdate(state, result.message);
    if (state.mutation === action) {
      closeMutation(state, type === 'edit');
      if (type === 'delete') state.refs.title.focus({ preventScroll: true });
    }
  } catch (error) {
    if (state === currentChat && state.mutation === action) {
      setNotice(state, error.message === 'operation has timed out'
        ? 'Não foi possível confirmar a alteração. Atualize a conversa para conferir.'
        : error.message);
    }
  } finally {
    action.pending = false;
    if (state.mutation === action) updateMutationControls(state);
  }
}

function addFiles(state, files) {
  const draft = draftFor(state);
  const all = [...draft.files, ...files];
  if (all.length > MAX_FILES || all.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) {
    return setNotice(state, 'Anexe até 3 arquivos por mensagem, somando no máximo 5 MB.');
  }
  if (files.some(file => !file.size || file.size > MAX_FILE_BYTES || !ACCEPTED_FILE_NAMES.test(file.name))) {
    return setNotice(state, 'Use arquivos de até 2 MB em PDF, imagem, texto ou Office.');
  }
  draft.files = all;
  draft.clientId = null;
  setNotice(state);
  renderDraftParts(state);
}

function option(value, label) {
  const entry = el('option', '', label);
  entry.value = value;
  return entry;
}

function openLinkChooser(state) {
  const { linkChooser, modulePicker, taskPicker } = state.refs;
  if (!state.modules.length) return;
  modulePicker.replaceChildren(...state.modules.map(module => option(module.id, module.label)));
  const prior = draftFor(state).reference;
  if (prior?.module) modulePicker.value = prior.module;
  taskPicker.replaceChildren(option('', 'Compartilhar o setor inteiro'));
  linkChooser.hidden = false;
  modulePicker.focus();
  void loadTasks(state, prior?.type === 'task' ? prior.id : null);
}

async function loadTasks(state, selected) {
  const { modulePicker, taskPicker } = state.refs;
  const module = modulePicker.value;
  const seq = ++state.taskSeq;
  taskPicker.replaceChildren(option('', 'Compartilhar o setor inteiro'));
  taskPicker.disabled = true;
  try {
    const params = new URLSearchParams({ module });
    const { tasks } = await api(state, `/tasks?${params}`);
    if (state !== currentChat || seq !== state.taskSeq) return;
    for (const task of tasks || []) taskPicker.append(option(task.id, task.title));
    if (selected && Array.from(taskPicker.options).some(entry => entry.value === selected)) taskPicker.value = selected;
  } catch {
    // A user can share a sector even when it has no accessible activities.
  } finally {
    if (seq === state.taskSeq) taskPicker.disabled = false;
  }
}

async function sendMessage(state, event) {
  event.preventDefault();
  if (!state.room || state.room.readOnly || !state.socket?.connected || state.refs.send.disabled) return;
  const room = state.room.id;
  const draft = draftFor(state);
  const { reference } = draft;
  draft.sending = true;
  setNotice(state);
  renderDraftParts(state);
  try {
    const attachments = await Promise.all(draft.files.map(async file => ({
      name: file.name,
      mime: file.type,
      data: await file.arrayBuffer()
    })));
    const payload = {
      room,
      text: draft.text.trim(),
      clientId: draft.clientId ||= crypto.randomUUID(),
      attachments,
      reference: reference ? { type: reference.type, id: reference.id } : null
    };
    const result = await state.socket.timeout(15000).emitWithAck('chat:send', payload);
    if (!result?.ok) throw new Error(result?.error || 'A mensagem não foi enviada.');
    if (state !== currentChat) return;
    state.drafts.delete(room);
    if (state.room?.id === room) {
      renderDraft(state);
      state.refs.linkChooser.hidden = true;
      state.refs.text.focus();
    }
    receiveMessage(state, result.message);
  } catch (error) {
    if (state !== currentChat || state.room?.id !== room) return;
    setNotice(state, error.message === 'operation has timed out'
      ? 'O envio não foi confirmado. Tente de novo quando a conexão voltar.'
      : error.message);
  } finally {
    draft.sending = false;
    if (state === currentChat && state.room?.id === room) renderDraftParts(state);
  }
}

function connectSocket(state) {
  if (state !== currentChat || state.socket) return;
  if (typeof window.io !== 'function') return setNotice(state, 'O chat em tempo real está indisponível. Atualize a página para reconectar.');
  const socket = window.io({ auth: { csrfToken: state.session.csrfToken }, transports: ['polling'], upgrade: false });
  state.socket = socket;
  socket.on('connect', () => {
    syncConnection(state, true);
    if (state.refs.status.textContent === 'O chat perdeu a conexão. O envio volta quando reconectar.') setNotice(state);
    if (state.wasConnected && state.room) {
      state.roomSeq += 1;
      state.messages.clear();
      state.historyReady = false;
      updateSend(state);
      void loadHistory(state).catch(error => setNotice(state, error.message));
    }
    state.wasConnected = true;
    requestSummary(state);
  });
  socket.on('disconnect', () => {
    syncConnection(state, false);
    setNotice(state, 'O chat perdeu a conexão. O envio volta quando reconectar.');
  });
  socket.on('connect_error', () => {
    syncConnection(state, false);
    setNotice(state, 'O chat perdeu a conexão. O envio volta quando reconectar.');
  });
  socket.on('chat:message', ({ message } = {}) => receiveMessage(state, message, true));
  socket.on('chat:message-updated', ({ message } = {}) => applyMessageUpdate(state, message));
}

function renderShell() {
  const launcher = el('button', 'chat-launcher');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Abrir chat interno');
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'maximumChat');
  launcher.append(icon('chat-dots'));
  const dialog = el('dialog', 'maximum-chat');
  dialog.id = 'maximumChat';
  dialog.setAttribute('aria-labelledby', 'maximumChatHeading');
  dialog.dataset.mobileView = 'list';
  dialog.innerHTML = `
    <header class="chat-header">
      <span class="chat-header-icon"><i class="bi bi-chat-dots" aria-hidden="true"></i></span>
      <div class="chat-header-heading">
        <h2 id="maximumChatHeading">Talk</h2>
        <p data-chat="connection" class="chat-connection" data-status="connecting"><i class="bi bi-circle-fill" aria-hidden="true"></i><span>Conectando…</span></p>
      </div>
      <button type="button" class="chat-icon-button" data-chat="close" aria-label="Fechar chat" title="Fechar chat"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
    </header>
    <p class="chat-status" data-chat="status" role="status" hidden></p>
    <div class="chat-layout">
      <aside class="chat-sidebar" aria-label="Conversas">
        <div class="chat-sidebar-heading"><strong>Conversas</strong><button type="button" class="chat-icon-button" data-chat="refresh" aria-label="Atualizar conversas" title="Atualizar conversas"><i class="bi bi-broadcast" aria-hidden="true"></i></button></div>
        <label class="chat-search"><i class="bi bi-search" aria-hidden="true"></i><span class="sr-only">Buscar pessoas e setores</span><input data-chat="search" type="search" placeholder="Buscar pessoas e setores"></label>
        <div class="chat-rooms" data-chat="rooms"></div>
      </aside>
      <div class="chat-main">
        <div class="chat-blank" data-chat="blank">
          <i class="bi bi-chat-dots" aria-hidden="true"></i>
          <strong>Suas conversas na Central</strong>
          <p>Escolha uma pessoa ou um setor para conversar, enviar arquivos e compartilhar atividades.</p>
        </div>
        <section class="chat-thread" data-chat="thread" aria-labelledby="maximumChatRoomTitle" hidden>
          <header class="chat-thread-header">
            <button type="button" class="chat-icon-button chat-back" data-chat="back" aria-label="Voltar às conversas"><i class="bi bi-arrow-left" aria-hidden="true"></i></button>
            <div><h3 id="maximumChatRoomTitle" data-chat="title" tabindex="-1"></h3><p data-chat="channelType"></p></div>
          </header>
          <button type="button" class="chat-more" data-chat="more" hidden><i class="bi bi-chevron-up" aria-hidden="true"></i> Mensagens anteriores</button>
          <div class="chat-messages" data-chat="messages" role="log" aria-label="Mensagens" aria-live="polite" aria-relevant="additions"></div>
          <p class="chat-read-only" data-chat="readOnly" hidden>Esta conversa está disponível para consulta.</p>
          <form class="chat-mutation" data-chat="mutation" aria-labelledby="maximumChatMutationTitle" hidden>
            <strong id="maximumChatMutationTitle" data-chat="mutationTitle"></strong>
            <p data-chat="mutationHint" hidden></p>
            <label data-chat="mutationLabel"><span class="sr-only">Texto da mensagem</span><textarea data-chat="mutationText" rows="2" maxlength="4000"></textarea></label>
            <div class="chat-mutation-controls">
              <button type="button" class="chat-control" data-chat="mutationCancel">Cancelar</button>
              <button type="submit" class="chat-control chat-control-primary" data-chat="mutationSubmit"></button>
            </div>
          </form>
          <form class="chat-composer" data-chat="composer">
            <div class="chat-link-chooser" data-chat="linkChooser" hidden>
              <label>Setor<select data-chat="modulePicker" aria-label="Setor"></select></label>
              <label>Atividade<select data-chat="taskPicker" aria-label="Atividade"></select></label>
              <div class="chat-chooser-actions">
                <button type="button" data-chat="cancelLink" class="chat-control">Cancelar</button>
                <button type="button" data-chat="useLink" class="chat-control chat-control-primary">Inserir vínculo</button>
              </div>
            </div>
            <div class="chat-draft-parts" data-chat="draftParts"></div>
            <label class="chat-compose-label"><span class="sr-only">Mensagem</span><textarea data-chat="text" rows="2" maxlength="4000" placeholder="Escreva sua mensagem"></textarea></label>
            <div class="chat-composer-actions">
              <input type="file" data-chat="files" accept="${ACCEPTED_FILES}" multiple hidden>
              <button type="button" class="chat-icon-button" data-chat="attach" aria-label="Anexar arquivos" title="Anexar arquivos"><i class="bi bi-paperclip" aria-hidden="true"></i></button>
              <button type="button" class="chat-icon-button" data-chat="addReference" aria-label="Compartilhar setor ou atividade" title="Compartilhar setor ou atividade"><i class="bi bi-link-45deg" aria-hidden="true"></i></button>
              <button type="submit" class="chat-send" data-chat="send" disabled>Enviar <i class="bi bi-send" aria-hidden="true"></i></button>
            </div>
          </form>
        </section>
      </div>
    </div>`;
  document.body.append(launcher, dialog);
  const refs = Object.fromEntries(Array.from(dialog.querySelectorAll('[data-chat]'), node => [node.dataset.chat, node]));
  return { launcher, dialog, refs };
}

function bindChat(state) {
  const { dialog, launcher, refs } = state;
  launcher.addEventListener('click', () => open(state));
  refs.close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (state.mount || dialog.open) return;
    launcher.setAttribute('aria-expanded', 'false');
    remember(state, false);
  });
  dialog.addEventListener('click', event => {
    if (state.mount || event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  refs.back.addEventListener('click', () => {
    dialog.dataset.mobileView = 'list';
    refs.search.focus();
  });
  refs.refresh.addEventListener('click', () => {
    setNotice(state);
    void refreshSummary(state).catch(() => reportSummaryFailure(state));
    if (state.room) void loadHistory(state).catch(error => setNotice(state, error.message));
  });
  refs.search.addEventListener('input', () => renderRoomList(state));
  refs.more.addEventListener('click', () => void loadHistory(state, true).catch(error => setNotice(state, error.message)));
  refs.messages.addEventListener('scroll', () => markRead(state));
  refs.text.addEventListener('input', () => {
    const draft = draftFor(state);
    draft.text = refs.text.value;
    draft.clientId = null;
    updateSend(state);
  });
  refs.text.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || refs.send.disabled) return;
    event.preventDefault();
    refs.composer.requestSubmit();
  });
  refs.attach.addEventListener('click', () => refs.files.click());
  refs.files.addEventListener('change', () => {
    addFiles(state, Array.from(refs.files.files));
    refs.files.value = '';
  });
  refs.addReference.addEventListener('click', () => {
    if (refs.linkChooser.hidden) openLinkChooser(state);
    else refs.linkChooser.hidden = true;
  });
  refs.modulePicker.addEventListener('change', () => void loadTasks(state));
  refs.cancelLink.addEventListener('click', () => {
    refs.linkChooser.hidden = true;
    refs.addReference.focus();
  });
  refs.useLink.addEventListener('click', () => {
    const module = refs.modulePicker.value;
    if (!module) return;
    const task = refs.taskPicker.value;
    const draft = draftFor(state);
    draft.reference = {
      type: task ? 'task' : 'module',
      id: task || module,
      module,
      label: task ? refs.taskPicker.selectedOptions[0].textContent : refs.modulePicker.selectedOptions[0].textContent
    };
    draft.clientId = null;
    refs.linkChooser.hidden = true;
    renderDraftParts(state);
    refs.text.focus();
  });
  refs.composer.addEventListener('submit', event => void sendMessage(state, event));
  refs.mutation.addEventListener('submit', event => void submitMutation(state, event));
  refs.mutationText.addEventListener('input', () => updateMutationControls(state));
  refs.mutationCancel.addEventListener('click', () => closeMutation(state));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.dialog.open) return;
    void refreshSummary(state).then(() => markRead(state)).catch(() => reportSummaryFailure(state));
  }, { signal: state.abort.signal });
}

export function initChat(session, { notify, surface } = {}) {
  if (!session?.user?.id || !session.csrfToken || currentChat?.session.user.id === session.user.id) return;
  if (currentChat) destroyChat();
  const state = {
    ...renderShell(),
    session, notify, mount: null, mutation: null,
    connected: false, wasConnected: false, historyReady: false, hasSummary: false, hasMore: false,
    rooms: [], people: [], modules: [], roomLookup: new Map(),
    abort: new AbortController(), drafts: new Map(), messages: new Map(), marked: new Map(), recent: new Set(), pendingUpdates: new Map(),
    unread: 0, roomSeq: 0, summarySeq: 0, taskSeq: 0
  };
  currentChat = state;
  bindChat(state);
  if (typeof window.io === 'function') connectSocket(state);
  else {
    const script = document.querySelector(`script[src="${socketScriptPath}"]`);
    if (script) {
      script.addEventListener('load', () => connectSocket(state), { once: true, signal: state.abort.signal });
      script.addEventListener('error', () => connectSocket(state), { once: true, signal: state.abort.signal });
    }
    connectSocket(state);
  }
  const saved = restore(session.user.id);
  state.pendingRoom = saved.room;
  if (surface?.mount) setChatSurface(surface);
  if (!state.mount && saved.open) open(state, saved.room);
  else if (!state.dialog.open) void refreshSummary(state).catch(() => reportSummaryFailure(state));
}

export function setChatSurface({ mount = null, show = false } = {}) {
  const state = currentChat;
  if (!state) return;
  if (mount !== state.mount) {
    if (state.dialog.open) state.dialog.close();
    state.mount = mount;
    state.launcher.hidden = Boolean(mount);
    state.refs.close.hidden = Boolean(mount);
    state.dialog.dataset.chatSurface = mount ? 'sector' : 'home';
    (mount || document.body).append(state.dialog);
  }
  if (show) open(state);
  else if (mount && state.dialog.open) state.dialog.close();
}

export function openChat(roomId) {
  if (currentChat) open(currentChat, roomId);
}

export function destroyChat() {
  const state = currentChat;
  if (!state) return;
  currentChat = null;
  state.socket?.disconnect();
  state.abort.abort();
  clearTimeout(state.summaryTimer);
  remember(state, false);
  state.dialog.remove();
  state.launcher.remove();
}
