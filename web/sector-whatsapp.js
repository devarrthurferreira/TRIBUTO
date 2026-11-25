const API = '/v1/platform/whatsapp';
const REFRESH_MS = 10_000;
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const SHORT_DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const FULL_DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' });
const DELIVERY_LABELS = {
  queued: 'Na fila', pending: 'Enviando', accepted: 'Aceita para envio', sent: 'Enviada', delivered: 'Entregue',
  read: 'Lida', failed: 'Falha no envio', uncertain: 'Envio não confirmado'
};
const NAVIGATION = [
  { id: 'chats', title: 'Chats', icon: 'chat-dots' },
  { id: 'contacts', title: 'Contatos', icon: 'people' },
  { id: 'tags', title: 'Tags', icon: 'tag' },
  { id: 'connections', title: 'Conexões', icon: 'link-45deg' },
  { id: 'overview', title: 'Visão geral', icon: 'graph-up', pages: [
    { id: 'now', title: 'Agora' },
    { id: 'history', title: 'Histórico de chamados' },
    { id: 'statistics', title: 'Estatísticas de chamados' },
    { id: 'absence', title: 'Controle de ausência' }
  ] },
  { id: 'settings', title: 'Mais opções', icon: 'grid', pages: [
    { id: 'users', title: 'Usuários' },
    { id: 'roles', title: 'Cargos' },
    { id: 'robots', title: 'Robôs' },
    { id: 'departments', title: 'Departamentos' },
    { id: 'integrations', title: 'Integrações' }
  ] }
];
const CONNECTION_LABELS = {
  disabled: 'Indisponível', disconnected: 'Desconectada', connecting: 'Conectando',
  reconnecting: 'Reconectando', qr: 'Aguardando leitura do QR', connected: 'Conectada', error: 'Falha na conexão'
};
const PROVIDER_LABELS = { cloud: 'WhatsApp Business Cloud', baileys: 'WhatsApp Web' };
const PAIRING_STATES = ['connecting', 'reconnecting', 'qr'];
const TICKET_LABELS = { open: 'Aberto', closed: 'Encerrado' };
const QR_IMAGE = /^data:image\/png;base64,[a-z\d+/=]+$/i;
const TAG_COLORS = [
  ['#147a58', 'Verde'], ['#3261ab', 'Azul'], ['#7d4ba5', 'Roxo'],
  ['#a45c0b', 'Âmbar'], ['#b44252', 'Rosa'], ['#526276', 'Cinza']
];

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

async function request(path, { signal, body, token, method = body ? 'POST' : 'GET' } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = token;
  }
  const response = await fetch(API + path, {
    method,
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
    <nav data-wa="navigation" class="wa-navigation" aria-label="Seções do WhatsApp">
      <button type="button" data-wa="refresh" class="wa-nav-button wa-nav-refresh" aria-label="Atualizar WhatsApp" data-label="Atualizar WhatsApp"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i></button>
    </nav>
    <div data-wa="status" class="wa-status" role="status" hidden></div>
    <div data-wa="workspace" class="wa-workspace" hidden></div>
    <div data-wa="offline" class="wa-unavailable" hidden></div>
    <div data-wa="layout" class="wa-layout" hidden>
      <aside data-wa="directory" class="wa-directory" aria-label="Conversas do WhatsApp">
        <label class="wa-search"><i class="bi bi-search" aria-hidden="true"></i><span class="wa-visually-hidden">Buscar conversas do WhatsApp</span><input type="search" data-wa="search" placeholder="Buscar por nome ou número"></label>
        <label data-wa="tagFilterRow" class="wa-form-field" hidden><span class="wa-visually-hidden">Filtrar chats por tag</span><select data-wa="tagFilter"></select></label>
        <div data-wa="conversations" class="wa-conversations"></div>
        <button type="button" data-wa="moreConversations" class="wa-control" hidden>Mais conversas</button>
      </aside>
      <div data-wa="thread" class="wa-thread">
        <div data-wa="placeholder" class="wa-thread-empty"></div>
        <div data-wa="conversation" class="wa-thread-inner" hidden>
          <header class="wa-thread-header">
            <button type="button" data-wa="back" class="wa-control wa-back" aria-label="Voltar às conversas"><i class="bi bi-arrow-left" aria-hidden="true"></i></button>
            <div class="wa-thread-label"><h3 data-wa="name" tabindex="-1"></h3><p data-wa="phone"></p></div>
            <div class="wa-thread-tools" data-wa="threadTools" hidden>
              <button type="button" class="wa-control" data-wa="tagThread" aria-expanded="false" hidden>Tags</button>
              <button type="button" class="wa-control" data-wa="ticket" hidden></button>
            </div>
          </header>
          <form data-wa="threadTags" class="wa-thread-tags" hidden>
            <fieldset class="wa-inline-tags"><legend>Tags da conversa</legend><div data-wa="threadTagOptions"></div></fieldset>
            <button class="wa-control" type="submit">Salvar tags</button>
          </form>
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
  const tag = ui.tagFilter.value;
  const matches = conversations.filter((entry) => searchKey(`${entry.name || ''} ${entry.phone || ''}`).includes(query)
    && (!tag || entry.tags?.includes(tag)));
  if (!matches.length) {
    ui.conversations.replaceChildren(emptyState('chat-dots', query || tag ? 'Nenhum resultado' : 'Nenhuma conversa ainda',
      query || tag ? 'Experimente outro nome, número ou tag.' : 'As mensagens recebidas no número conectado aparecerão aqui.'));
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
  state.ui.replyInfo.textContent = state.absence?.enabled
    ? 'Respostas pausadas pelo controle de ausência.'
    : state.sectorCanReply
    ? state.provider === 'cloud'
      ? 'A resposta fica disponível durante 24 horas após uma mensagem do contato.'
      : 'A conexão do setor precisa estar disponível para enviar respostas.'
    : 'O envio está indisponível para este acesso ou conexão.';
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
  state.ui.tagThread.hidden = !state.canAssignTags || !state.tags.length;
  state.ui.ticket.hidden = !state.canManageTickets || !Object.hasOwn(TICKET_LABELS, entry.status);
  state.ui.ticket.textContent = entry.status === 'closed' ? 'Reabrir chamado' : 'Encerrar chamado';
  state.ui.threadTools.hidden = state.ui.tagThread.hidden && state.ui.ticket.hidden;
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
  state.provider = data.provider || state.provider || 'cloud';
  state.absence = data.absence || null;
  state.canManageConnection = Boolean(data.canManage ?? state.isAdmin);
  state.canManageTickets = Boolean(data.canManageTickets ?? data.canReply);
  state.unread = state.connected ? Math.max(0, Number(data.unread) || 0) : 0;
  state.ui.navUnread.hidden = !state.unread;
  state.ui.navUnread.textContent = state.unread > 99 ? '99+' : String(state.unread);
  if (state.unread) state.ui.navChats.setAttribute('aria-description', `${state.unread} ${state.unread === 1 ? 'mensagem não lida' : 'mensagens não lidas'}`);
  else state.ui.navChats.removeAttribute('aria-description');
  state.sectorCanReply = Boolean(data.canReply);
  state.onUnread?.(state.unread);
  if (!state.connected) {
    if (state.selected) closeThread(state);
    state.conversations = [];
    state.page = 1;
    state.hasMoreConversations = false;
    const panel = emptyState('whatsapp', 'Nenhum número conectado', state.canManageConnection
      ? 'Vincule um número em Conexões para ativar a caixa de entrada.'
      : 'Peça ao setor de Tecnologia para vincular o número deste setor à Central Maximum.');
    if (state.canManageConnection) panel.append(actionButton('Abrir conexões', () => openWorkspace(state, 'connections')));
    state.ui.offline.replaceChildren(panel);
  }
  updateLayout(state);
  if (!state.connected) return;
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
    state.hasMoreConversations = Boolean(data.hasMore);
    state.ui.moreConversations.hidden = !state.hasMoreConversations;
  }
  const selected = state.conversations.find(({ id }) => id === state.selected);
  if (selected) {
    renderThread(state, selected);
    setCanReply(state, selected.canReply && state.sectorCanReply);
  } else if (state.selected) closeThread(state);
  renderConversations(state);
}

function actionButton(label, handle, { symbol, primary = false } = {}) {
  const button = element('button', primary ? 'wa-send' : 'wa-control');
  button.type = 'button';
  if (symbol) button.append(icon(symbol));
  button.append(document.createTextNode(label));
  button.addEventListener('click', () => void handle(button));
  return button;
}

function updateLayout(state) {
  const chats = state.active === 'chats';
  state.ui.layout.hidden = !chats || !state.connected;
  state.ui.offline.hidden = !chats || state.connected;
  state.ui.workspace.hidden = chats;
}

function workspaceRequest(state, path, options = {}) {
  const { body, signal = state.signal, method } = options;
  return body
    ? request(path, { signal, method, token: state.token, body: { sector: state.sector, ...body } })
    : request(path + '?' + new URLSearchParams({ sector: state.sector }), { signal });
}

function closeNavPopover(state, restoreFocus = false) {
  const open = state.navPopover;
  if (!open) return;
  state.navPopover = null;
  open.button.setAttribute('aria-expanded', 'false');
  if (restoreFocus) open.button.focus({ preventScroll: true });
  open.popover.hidden = true;
}

function configureNavigation(state) {
  const { ui, signal } = state;
  for (const group of NAVIGATION) {
    const button = element('button', 'wa-nav-button');
    button.type = 'button';
    button.dataset.tab = group.id;
    button.dataset.label = group.title;
    button.setAttribute('aria-label', group.title);
    button.append(icon(group.icon));

    if (group.id === 'chats') {
      ui.navChats = button;
      ui.navUnread = element('span', 'wa-nav-badge');
      ui.navUnread.hidden = true;
      ui.navUnread.setAttribute('aria-hidden', 'true');
      button.append(ui.navUnread);
    }
    if (!group.pages) {
      button.addEventListener('click', () => openWorkspace(state, group.id));
      ui.refresh.before(button);
      continue;
    }

    const anchor = element('div', 'wa-nav-group');
    const popover = element('div', 'wa-nav-popover');
    popover.id = `wa-nav-${group.id}`;
    popover.hidden = true;
    popover.setAttribute('role', 'group');
    popover.setAttribute('aria-label', group.title);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', popover.id);
    const chevron = icon('chevron-down');
    chevron.classList.add('wa-nav-chevron');
    button.append(chevron);

    for (const page of group.pages) {
      const option = element('button', 'wa-nav-option', page.title);
      option.type = 'button';
      option.dataset.tab = page.id;
      option.append(icon('check2'));
      option.addEventListener('click', () => {
        closeNavPopover(state, true);
        openWorkspace(state, group.id, page.id);
      });
      popover.append(option);
    }
    const showPopover = () => {
      closeNavPopover(state);
      state.navPopover = { button, popover, anchor };
      button.setAttribute('aria-expanded', 'true');
      popover.hidden = false;
    };
    button.addEventListener('click', () => {
      if (state.navPopover?.button === button) closeNavPopover(state);
      else showPopover();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      if (popover.hidden) showPopover();
      popover.firstElementChild?.focus();
    });
    anchor.append(button, popover);
    ui.refresh.before(anchor);
  }

  const closeOutside = ({ target }) => {
    if (state.navPopover && !state.navPopover.anchor.contains(target)) closeNavPopover(state);
  };
  document.addEventListener('focusin', closeOutside, { signal });
  document.addEventListener('click', closeOutside, { signal });
  ui.navigation.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !state.navPopover) return;
    event.preventDefault();
    event.stopPropagation();
    closeNavPopover(state, true);
  });
}

function openWorkspace(state, section, page) {
  const group = NAVIGATION.find(({ id }) => id === section);
  if (!group) return;
  const child = group.pages?.find(({ id }) => id === page) || group.pages?.[0];
  closeNavPopover(state);
  if (state.active === section && state.activePage === child?.id) return;
  state.viewRequest?.abort();
  clearTimeout(state.connectionTimer);
  state.autoPairOnOpen = section === 'connections';
  state.active = section;
  state.activePage = child?.id;
  for (const button of state.ui.navigation.querySelectorAll('[data-tab]')) {
    if (button.dataset.tab === section || button.dataset.tab === child?.id) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
  state.ui.threadTags.hidden = true;
  state.ui.tagThread.setAttribute('aria-expanded', 'false');
  updateLayout(state);
  if (!state.reducedMotion.matches) {
    const view = section === 'chats' ? (state.connected ? state.ui.layout : state.ui.offline) : state.ui.workspace;
    state.viewAnimation?.cancel();
    state.viewAnimation = view.animate([{ opacity: .70, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], {
      duration: 180, easing: 'ease-out'
    });
  }
  setStatus(state);
  if (section === 'chats') {
    void refresh(state, true);
    void refreshTags(state).catch(() => {});
    return;
  }
  void loadWorkspace(state);
}

function startPanel(state, heading, description = '') {
  const section = element('section', 'wa-workspace-panel');
  section.setAttribute('aria-label', heading);
  const intro = element('header', 'wa-panel-heading');
  intro.append(element('h3', '', heading));
  if (description) intro.append(element('p', '', description));
  section.append(intro);
  state.ui.workspace.replaceChildren(section);
  return section;
}

function listOrEmpty(target, entries, makeRow, empty) {
  const list = element('ul', 'wa-workspace-list');
  if (entries.length) {
    for (const entry of entries) list.append(makeRow(entry));
    target.append(list);
  } else target.append(emptyState(...empty));
}

function directoryRow(name, details, extra) {
  const row = element('li', 'wa-directory-row');
  const text = element('div', 'wa-directory-name');
  text.append(element('strong', '', name));
  if (details) text.append(element('small', '', details));
  row.append(text);
  if (extra) row.append(extra);
  return row;
}

function renderContacts(state) {
  const section = startPanel(state, 'Contatos', 'Contatos identificados nas conversas deste setor.');
  const query = element('input', 'wa-search-input');
  query.type = 'search';
  query.placeholder = 'Buscar por nome ou número';
  query.setAttribute('aria-label', 'Buscar contatos');
  const results = element('div', 'wa-workspace-results');
  section.append(query, results);
  const refreshContacts = () => {
    results.replaceChildren();
    const search = searchKey(query.value);
    const list = state.conversations.filter((entry) => searchKey(`${contactName(entry)} ${entry.phone || ''}`).includes(search));
    listOrEmpty(results, list, (entry) => directoryRow(contactName(entry), entry.name === entry.phone ? null : entry.phone,
      actionButton('Ver conversa', () => {
        openWorkspace(state, 'chats');
        openThread(state, entry);
      }, { symbol: 'chat-dots' })), ['people', search ? 'Nenhum contato encontrado' : 'Nenhum contato disponível',
      search ? 'Experimente outra busca.' : 'Os contatos aparecem após a primeira conversa pelo número do setor.']);
    if (state.hasMoreConversations) results.append(actionButton('Mais contatos', async (button) => {
      button.disabled = true;
      try {
        await refreshSummary(state, state.page + 1);
        if (state.active === 'contacts') refreshContacts();
      } catch (error) { showError(state, error); }
      finally { button.disabled = false; }
    }));
  };
  query.addEventListener('input', refreshContacts);
  refreshContacts();
}

function updateTagChoices(state) {
  const current = state.ui.tagFilter.value;
  state.ui.tagFilter.replaceChildren(new Option('Todas as tags', ''), ...state.tags.map(({ id, name }) => new Option(name, id)));
  if (state.tags.some(({ id }) => id === current)) state.ui.tagFilter.value = current;
  state.ui.tagFilterRow.hidden = !state.tags.length;
  if (state.connected) renderConversations(state);
  const entry = state.conversations.find(({ id }) => id === state.selected);
  if (entry) renderThread(state, entry);
}

async function refreshTags(state, signal = state.signal) {
  const data = await workspaceRequest(state, '/tags', { signal });
  if (signal.aborted) return null;
  state.tags = Array.isArray(data.tags) ? data.tags : [];
  state.canManageTags = Boolean(data.canManage);
  state.canAssignTags = Boolean(data.canAssign ?? data.canManage);
  updateTagChoices(state);
  return data;
}

function renderTags(state) {
  const section = startPanel(state, 'Tags', 'Organize as conversas com tags compartilhadas pelo setor.');
  if (state.canManageTags) {
    const form = element('form', 'wa-inline-form');
    form.innerHTML = '<label class="wa-form-field">Nome da tag<input required maxlength="60" placeholder="Ex.: Aguardando retorno"></label><label class="wa-form-field">Cor<select></select></label><button type="submit" class="wa-send">Criar tag</button>';
    const [name, color, save] = form.querySelectorAll('input, select, button');
    color.append(...TAG_COLORS.map(([value, label]) => new Option(label, value)));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await workspaceRequest(state, '/tags', { body: { name: name.value.trim(), color: color.value } });
        await loadWorkspace(state, { preserve: true });
      } catch (error) { showError(state, error); }
      finally { save.disabled = false; }
    });
    section.append(form);
  }
  listOrEmpty(section, state.tags, (tag) => {
    const colorName = TAG_COLORS.find(([value]) => value === tag.color)?.[1];
    return directoryRow(tag.name, colorName, icon('hash'));
  }, ['hash', 'Nenhuma tag cadastrada', state.canManageTags ? 'Crie uma tag para começar a classificar as conversas.' : 'As tags criadas pelo setor aparecerão aqui.']);
}

function toggleThreadTags(state) {
  const entry = state.conversations.find(({ id }) => id === state.selected);
  if (!entry || !state.canAssignTags) return;
  state.ui.threadTags.hidden = !state.ui.threadTags.hidden;
  state.ui.tagThread.setAttribute('aria-expanded', String(!state.ui.threadTags.hidden));
  if (state.ui.threadTags.hidden) return;
  const choices = state.tags.map((tag) => {
    const label = element('label', 'wa-checkbox');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.value = tag.id;
    checkbox.checked = Array.isArray(entry.tags) && entry.tags.includes(tag.id);
    label.append(checkbox, document.createTextNode(tag.name));
    return label;
  });
  state.ui.threadTagOptions.replaceChildren(...choices);
  state.ui.threadTagOptions.querySelector('input')?.focus();
}

async function saveThreadTags(state, event) {
  event.preventDefault();
  const conversation = state.selected;
  if (!conversation || !state.canAssignTags || state.ui.threadTags.hidden) return;
  const tagIds = [...state.ui.threadTagOptions.querySelectorAll('input:checked')].map(({ value }) => value);
  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    await workspaceRequest(state, '/tags', { method: 'PATCH', body: { conversation, tagIds } });
    if (state.selected === conversation && !state.ui.threadTags.hidden) toggleThreadTags(state);
    await refreshSummary(state);
  } catch (error) { showError(state, error); }
  finally { if (button) button.disabled = false; }
}

async function updateTicket(state) {
  const entry = state.conversations.find(({ id }) => id === state.selected);
  if (!entry || !state.canManageTickets || !Object.hasOwn(TICKET_LABELS, entry.status)) return;
  state.ui.ticket.disabled = true;
  try {
    await workspaceRequest(state, '/ticket', { body: { conversation: entry.id, status: entry.status === 'closed' ? 'open' : 'closed' } });
    await refreshSummary(state);
  } catch (error) { showError(state, error); }
  finally { state.ui.ticket.disabled = false; }
}

async function changeConnection(state, action, button) {
  if (state.connectionBusy) return;
  state.connectionBusy = true;
  state.viewRequest?.abort();
  clearTimeout(state.connectionTimer);
  setStatus(state);
  if (button) button.disabled = true;
  const previous = state.connectionData;
  let result, failure;
  if (action === 'connect') renderConnection(state, { ...previous, connection: { ...previous?.connection, status: 'connecting' } });
  try { result = await workspaceRequest(state, '/connections', { body: { action } }); }
  catch (error) { failure = error; }
  finally {
    state.connectionBusy = false;
    if (button) button.disabled = false;
  }
  if (state.signal.aborted) return;
  if (state.active === 'connections') {
    state.autoPairOnOpen = false;
    renderConnection(state, result || previous);
    if (failure) showError(state, failure);
    else if (result.unlinkConfirmed === false) setStatus(state, 'A conexão local foi interrompida. Confira o aparelho na lista de dispositivos do WhatsApp.');
  }
  if (result) void refreshSummary(state).catch(() => {});
}

function connectionButton(state, label, action, options) {
  const button = actionButton(label, (button) => changeConnection(state, action, button), options);
  button.dataset.connectionAction = action;
  button.disabled = Boolean(state.connectionBusy);
  return button;
}

function renderPairing(state, connection, hasQr) {
  const card = element('article', 'wa-workspace-card wa-pairing-card');
  const heading = element('header', 'wa-pairing-heading');
  heading.append(element('h4', '', 'Parear pelo QR Code'), element('p', '', 'Use o celular com o número deste setor.'));
  const frame = element('div', 'wa-qr-frame');
  if (hasQr) {
    const qr = element('img', 'wa-qr');
    qr.src = connection.qrImage;
    qr.alt = 'Código QR de pareamento do WhatsApp deste setor';
    qr.width = qr.height = 230;
    frame.append(qr);
  } else {
    const loading = element('div', 'wa-qr-placeholder');
    loading.setAttribute('role', 'status');
    loading.append(icon('qr-code'), element('span', '', 'Preparando o QR Code…'));
    frame.append(loading);
  }
  const steps = element('ol', 'wa-qr-steps');
  for (const step of ['Abra o WhatsApp no celular.', 'Toque em Aparelhos conectados e em Conectar um aparelho.', 'Aponte a câmera para o código.']) steps.append(element('li', '', step));
  const actions = element('div', 'wa-workspace-actions');
  actions.append(connectionButton(state, 'Cancelar pareamento', 'cancel'));
  card.append(heading, frame, steps, actions);
  return card;
}

function renderConnection(state, data) {
  const { connection = {}, canManage } = data;
  if (connection.provider) state.provider = connection.provider;
  const pending = PAIRING_STATES.includes(connection.status);
  const expiresAt = Date.parse(connection.qrExpiresAt);
  const hasQr = canManage && connection.status === 'qr' && (Number.isNaN(expiresAt) || expiresAt > Date.now())
    && typeof connection.qrImage === 'string' && connection.qrImage.length < 500_000 && QR_IMAGE.test(connection.qrImage);
  clearTimeout(state.connectionTimer);
  if (pending && !state.connectionBusy) {
    const interval = hasQr && Number.isFinite(expiresAt) ? Math.max(250, Math.min(4_000, expiresAt - Date.now())) : 4_000;
    state.connectionTimer = setTimeout(() => {
      if (!document.hidden && state.active === 'connections') void loadWorkspace(state, { preserve: true });
    }, interval);
  }
  const previous = state.connectionData;
  const busy = Boolean(state.connectionBusy);
  state.connectionData = data;
  if (state.ui.workspace.firstElementChild?.classList.contains('wa-connection-area')
    && state.renderedConnectionBusy === busy
    && previous?.canManage === canManage
    && ['status', 'provider', 'phone', 'reason', 'qrImage', 'qrExpiresAt'].every(key => previous?.connection?.[key] === connection[key])
    && Boolean(state.ui.workspace.querySelector('.wa-qr')) === hasQr) return;
  state.renderedConnectionBusy = busy;

  const focusedAction = state.ui.workspace.contains(document.activeElement) && document.activeElement.dataset.connectionAction;
  const section = startPanel(state, 'Conexões');
  section.classList.add('wa-connection-area');
  const grid = element('div', 'wa-connections-grid');
  const card = element('article', 'wa-workspace-card wa-connection-card');
  const line = element('header', 'wa-connection-header');
  const mark = element('span', 'wa-connection-icon');
  mark.append(icon('whatsapp'));
  const title = element('div', 'wa-connection-title');
  title.append(element('h4', '', 'Maximum'), element('p', '', PROVIDER_LABELS[connection.provider] || 'WhatsApp'));
  const pill = element('span', 'wa-pill', CONNECTION_LABELS[connection.status] || CONNECTION_LABELS.disabled);
  pill.dataset.status = connection.status || 'disabled';
  line.append(mark, title, pill);

  const phone = connection.phone?.replace(/^(55)(\d{2})(\d{4,5})(\d{4})$/, '+$1 ($2) $3-$4');
  const details = element('dl', 'wa-connection-details');
  for (const [symbol, label, value] of [['person', 'Número do WhatsApp', phone || 'Sem número vinculado'], ['buildings', 'Setor', state.sectorLabel]]) {
    if (!value) continue;
    const row = element('div', 'wa-connection-detail');
    const term = element('dt');
    term.append(icon(symbol), document.createTextNode(label));
    row.append(term, element('dd', '', value));
    details.append(row);
  }
  card.append(line, details);
  if (connection.reason) card.append(element('p', 'wa-supporting-text', connection.reason));
  else if (connection.status === 'disabled') {
    card.append(element('p', 'wa-supporting-text', 'O servidor ainda precisa habilitar um provedor de WhatsApp para este setor.'));
  }
  grid.append(card);
  if (canManage && connection.provider === 'baileys' && connection.status !== 'disabled') {
    if (pending && !connection.phone) grid.append(renderPairing(state, connection, hasQr));
    else if (!pending) {
      const actions = element('div', 'wa-workspace-actions');
      actions.append(connection.status === 'connected'
        ? connectionButton(state, 'Desconectar número', 'disconnect')
        : connectionButton(state, 'Conectar número', 'connect', { symbol: 'link-45deg', primary: true }));
      card.append(actions);
    }
  }
  section.append(grid);
  if (focusedAction) {
    const next = grid.querySelector(`[data-connection-action="${focusedAction}"]`) || grid.querySelector('[data-connection-action]');
    next?.focus({ preventScroll: true });
  }
}

function renderOverview(state, data) {
  if (state.activePage === 'now') {
    const section = startPanel(state, 'Agora', 'Acompanhe o atendimento atual do setor.');
    const metrics = element('div', 'wa-metrics');
    const numbers = data.now || {};
    for (const [key, label] of [['conversations', 'Conversas'], ['unread', 'Mensagens não lidas'], ['awaiting', 'Chamados abertos']]) {
      const card = element('article', 'wa-workspace-card wa-metric');
      const value = numbers[key] ?? (key === 'unread' ? state.unread : undefined);
      card.append(element('strong', '', Number.isFinite(value) ? value : '—'), element('span', '', label));
      metrics.append(card);
    }
    section.append(metrics);
    return;
  }
  if (state.activePage === 'history') {
    const section = startPanel(state, 'Histórico de chamados', 'Registros de atendimento deste setor.');
    const history = Array.isArray(data.history) ? data.history : [];
    listOrEmpty(section, history, (entry) => {
      const state = TICKET_LABELS[entry.status] || entry.status || '';
      const time = timestamp(entry.updatedAt || entry.at, true);
      return directoryRow(contactName(entry), [state, time].filter(Boolean).join(' · '));
    }, ['clock-history', 'Nenhum chamado registrado', 'O histórico será atualizado à medida que o setor registrar atendimentos.']);
    return;
  }
  const section = startPanel(state, 'Estatísticas de chamados', 'Totais apurados no atendimento deste setor.');
  const values = data.statistics || {};
  const metrics = element('div', 'wa-metrics');
  for (const [keys, label] of [[['conversations', 'total'], 'Chamados'], [['open', 'awaiting'], 'Abertos'], [['closed'], 'Encerrados'], [['unread'], 'Mensagens não lidas'], [['inbound', 'received'], 'Mensagens recebidas'], [['outbound', 'sent'], 'Mensagens enviadas']]) {
    const value = keys.map((key) => values[key]).find(Number.isFinite);
    if (!Number.isFinite(value)) continue;
    const card = element('article', 'wa-workspace-card wa-metric');
    card.append(element('strong', '', value), element('span', '', label));
    metrics.append(card);
  }
  section.append(metrics.childElementCount ? metrics : emptyState('grid', 'Sem estatísticas disponíveis', 'Os totais serão exibidos assim que estiverem disponíveis para este setor.'));
}

function renderAbsence(state, data) {
  const section = startPanel(state, 'Controle de ausência', 'Pause as respostas do setor e defina um aviso para a equipe.');
  if (!data.absence) {
    section.append(emptyState('clock-history', 'Ausência indisponível', 'A configuração ainda não está disponível para este setor.'));
    return;
  }
  const form = element('form', 'wa-settings-form wa-workspace-card');
  form.innerHTML = '<label class="wa-checkbox"><input type="checkbox">Ativar ausência</label><label class="wa-form-field">Aviso interno<textarea rows="3" maxlength="500"></textarea></label>';
  const checkbox = form.querySelector('input');
  const note = form.querySelector('textarea');
  checkbox.checked = Boolean(data.absence.enabled);
  note.value = data.absence.message || '';
  checkbox.disabled = note.disabled = !data.canManage;
  if (data.canManage) {
    const button = element('button', 'wa-send', 'Salvar ausência');
    button.type = 'submit';
    form.append(button);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      button.disabled = true;
      try {
        await workspaceRequest(state, '/settings', { body: { absence: { enabled: checkbox.checked, message: note.value.trim() } } });
        if (state.activePage === 'absence') {
          await loadWorkspace(state, { preserve: true });
          setStatus(state, 'Configuração de ausência salva.');
        }
      } catch (error) { showError(state, error); }
      finally { button.disabled = false; }
    });
  }
  section.append(form);
}

function renderSettings(state, data) {
  const key = state.activePage;
  const config = NAVIGATION.find(({ id }) => id === 'settings').pages.find(({ id }) => id === key);
  const messages = {
    users: ['people', 'Nenhum usuário vinculado', 'Usuários com acesso ao setor aparecerão nesta lista.'],
    roles: ['shield-lock', 'Nenhum cargo disponível', 'Os cargos e permissões serão exibidos quando o setor tiver perfis configurados.'],
    robots: ['gear', 'Nenhum robô configurado', 'As automações configuradas para este setor aparecerão aqui.'],
    departments: ['buildings', 'Nenhum departamento disponível', 'Os departamentos vinculados serão exibidos aqui.'],
    integrations: ['link-45deg', 'Nenhuma integração disponível', 'As conexões e integrações do setor aparecerão aqui.']
  };
  const section = startPanel(state, config.title);
  if (key === 'users' && state.isAdmin) {
    const admin = element('a', 'wa-control wa-workspace-link', 'Gerenciar equipe e acessos');
    admin.href = '/home#users';
    section.append(admin);
  }
  if (key === 'integrations') section.append(actionButton('Gerenciar conexões', () => openWorkspace(state, 'connections'), { symbol: 'link-45deg' }));
  const entries = Array.isArray(data[key]) ? data[key] : [];
  listOrEmpty(section, entries, (item) => {
    const description = item.email || item.description || item.permissions?.join?.(', ') || item.role || '';
    const status = CONNECTION_LABELS[item.status] || item.status;
    return directoryRow(item.name || item.label || 'Registro', description, status ? element('span', 'wa-pill', status) : null);
  }, messages[key]);
}

async function loadWorkspace(state, { preserve = false } = {}) {
  const { active, activePage } = state;
  if (active === 'chats' || state.signal.aborted) return;
  if (active === 'connections' && state.connectionBusy) return;
  state.viewRequest?.abort();
  const controller = new AbortController();
  state.viewRequest = controller;
  const signal = controller.signal;
  const fromCurrentRequest = () => !state.signal.aborted && !signal.aborted && state.viewRequest === controller;
  if (!preserve) {
    const page = NAVIGATION.find(({ id }) => id === active);
    startPanel(state, page.pages?.find(({ id }) => id === activePage)?.title || page.title, 'Carregando…');
  }
  try {
    if (active === 'contacts') {
      const data = await summary(state.sector, signal, 1);
      if (!fromCurrentRequest()) return;
      applySummary(state, data, 1);
      renderContacts(state);
    } else if (active === 'tags') {
      await refreshTags(state, signal);
      if (fromCurrentRequest()) renderTags(state);
    } else if (active === 'connections') {
      const data = await workspaceRequest(state, '/connections', { signal });
      if (!fromCurrentRequest()) return;
      renderConnection(state, data);
      if (state.autoPairOnOpen && !document.hidden) {
        state.autoPairOnOpen = false;
        if (data.canManage && data.connection?.provider === 'baileys' && data.connection.status === 'disconnected' && !data.connection.phone) {
          void changeConnection(state, 'connect');
        }
      }
    } else if (active === 'settings' || activePage === 'absence') {
      const data = await workspaceRequest(state, '/settings', { signal });
      if (fromCurrentRequest()) {
        if (activePage === 'absence') renderAbsence(state, data);
        else renderSettings(state, data);
      }
    } else {
      const data = await workspaceRequest(state, '/overview', { signal });
      if (fromCurrentRequest()) renderOverview(state, data);
    }
  } catch (error) {
    if (fromCurrentRequest()) {
      if (!preserve) {
        const section = startPanel(state, 'Impossível carregar a seção');
        section.append(emptyState('broadcast', 'Os dados não puderam ser consultados', error.message));
        section.append(actionButton('Tentar novamente', () => loadWorkspace(state), { symbol: 'arrow-clockwise' }));
      } else {
        if (active === 'connections' && state.connectionData) renderConnection(state, state.connectionData);
        showError(state, error);
      }
    }
  }
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
  if (state.signal.aborted || state.active !== 'chats' || document.hidden || !state.mobileThread || !atEnd || !latestInbound || !conversation?.unread || state.readThrough.get(selected) === latestInbound.id) return;
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
    state.ui.threadTags.hidden = true;
    state.ui.tagThread.setAttribute('aria-expanded', 'false');
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
  if (state.refreshing || (!force && (document.hidden || state.active !== 'chats'))) return;
  state.refreshing = true;
  state.ui.refresh.disabled = true;
  try {
    await refreshSummary(state);
    if (state.active === 'chats' && state.connected && state.selected && (state.mobileThread || !state.mobile.matches)) await readThread(state);
    if (state.active === 'chats') setStatus(state);
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

export function mountSectorWhatsApp(container, { sector, sectorLabel, session, onUnread } = {}) {
  const controller = new AbortController();
  const state = {
    ...makeShell(container), sector, sectorLabel, onUnread, token: session?.csrfToken, signal: controller.signal,
    mobile: window.matchMedia('(max-width: 730px)'), reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)'),
    connected: false, selected: null, conversations: [], messages: [], sequence: 0, page: 1,
    drafts: new Map(), sending: new Set(), readThrough: new Map(), tags: [],
    isAdmin: session?.user?.role === 'admin'
  };
  const { ui } = state;
  configureNavigation(state);
  setMobileThread(state, false);
  ui.refresh.addEventListener('click', () => {
    if (state.active === 'chats') void refresh(state, true);
    else void loadWorkspace(state);
  });
  ui.search.addEventListener('input', () => renderConversations(state));
  ui.tagFilter.addEventListener('change', () => renderConversations(state));
  ui.tagThread.addEventListener('click', () => toggleThreadTags(state));
  ui.threadTags.addEventListener('submit', (event) => void saveThreadTags(state, event));
  ui.ticket.addEventListener('click', () => void updateTicket(state));
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
    if (document.hidden) return;
    if (state.active === 'chats') void refresh(state);
    if (state.active === 'connections') void loadWorkspace(state, { preserve: true });
  }, { signal: state.signal });
  const timer = setInterval(() => void refresh(state), REFRESH_MS);
  openWorkspace(state, 'chats');
  return () => {
    controller.abort();
    state.viewRequest?.abort();
    clearTimeout(state.connectionTimer);
    clearInterval(timer);
    state.root.remove();
  };
}
