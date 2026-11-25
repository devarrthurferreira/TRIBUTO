import { Server } from 'socket.io';
import { ApiError } from '../api/validation.mjs';
import { authenticatePlatformRequest, matchesPlatformCsrf } from '../platform/routes.mjs';
import { canAccess, canAccessWorkItemCompany, canPerform, MODULES } from '../platform/policy.mjs';
import { normalizeAttachments, sendAttachment } from './attachments.mjs';

const byModule = new Map(MODULES.map(module => [module.id, module]));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SEQUENCE = /^[1-9]\d{0,19}$/;
const validSequence = value => typeof value === 'string' && SEQUENCE.test(value) && BigInt(value) <= 18446744073709551615n;
const validId = value => typeof value === 'string' && UUID.test(value);
const sectorKey = id => `sector:${id}`;
const directKey = (first, second) => `direct:${[first, second].sort().join(':')}`;
const NO_ROOM = 'Conversa indisponível para seu acesso.';
const rateWindowMs = 60_000;

function allowedOrigin(req) {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const address = new URL(origin);
    // The browser can attest same-origin when a reverse proxy rewrites Host.
    return ['https:', 'http:'].includes(address.protocol) &&
      (address.host === req.headers.host || fetchSite === 'same-origin');
  } catch {
    return false;
  }
}

function roomForViewer(key, userId) {
  const [kind, first, second] = key.split(':');
  return kind === 'sector' ? key : `direct:${userId === first ? second : first}`;
}

function messageText(value) {
  if (typeof value !== 'string') throw new ApiError(400, 'CHAT_MESSAGE', 'Mensagem inválida.');
  const text = value.trim();
  if (text.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new ApiError(400, 'CHAT_TEXT', 'A mensagem deve ter até 4.000 caracteres.');
  }
  return text;
}

export function createChat({ store, chatStore, logger = console }) {
  let io;
  const sendAttempts = new Map();
  const modulesFor = user => MODULES.filter(({ id, legacy }) => canAccess(user, id) && (!legacy || user.moduleGrants?.[id]));
  const publicModule = ({ id, label }) => ({ id, label });

  function canReadRoom(user, key) {
    const [kind, first, second] = key.split(':');
    return kind === 'sector' ? canAccess(user, first) : kind === 'direct' && [first, second].includes(user._id);
  }

  async function roomKey(user, input, { sending = false } = {}) {
    const [kind, id, trailing] = typeof input === 'string' && input.length <= 60 ? input.split(':') : [];
    if (!id || trailing !== undefined) throw new ApiError(400, 'CHAT_ROOM', 'Selecione uma conversa válida.');
    if (kind === 'sector' && byModule.has(id) && canAccess(user, id)) return sectorKey(id);
    if (kind === 'direct' && validId(id) && id !== user._id) {
      const other = await store.findUserById(id);
      if (other && (!sending || other.active)) return directKey(user._id, id);
    }
    throw new ApiError(403, 'CHAT_FORBIDDEN', NO_ROOM);
  }

  async function resolveReference(user, raw) {
    if (raw?.type === 'module' && byModule.has(raw.id) && canAccess(user, raw.id)) {
      return { type: 'module', id: raw.id, module: raw.id, label: byModule.get(raw.id).label, href: `/setor/${raw.id}` };
    }
    if (raw?.type === 'task' && validId(raw.id)) {
      const item = await store.getWorkItem(raw.id);
      if (item && canPerform(user, item.module, 'workItemRead') && canAccessWorkItemCompany(user, item.module, item.companyCnpj)) {
        return { type: 'task', id: raw.id, module: item.module, label: item.title, href: `/setor/${item.module}?atividade=${raw.id}` };
      }
    }
    return null;
  }

  async function publicMessage(message, user) {
    return {
      id: message.id, clientId: message.clientId, room: roomForViewer(message.roomKey, user._id),
      sender: { id: message.senderId, name: message.senderName },
      text: message.text, createdAt: message.createdAt, attachments: message.attachments,
      editedAt: message.editedAt ?? null, deletedAt: message.deletedAt ?? null,
      reference: message.reference ? await resolveReference(user, message.reference) : null
    };
  }

  async function summary(user) {
    const online = new Set([...(io?.of('/').sockets.values() || [])].map(socket => socket.data.userId));
    const contacts = (await store.listUsers()).filter(person => person._id !== user._id);
    const modules = modulesFor(user);
    const rooms = [
      ...modules.map(({ id, label }) => ({ id: sectorKey(id), key: sectorKey(id), kind: 'sector', name: label })),
      ...contacts.map(person => ({ id: `direct:${person._id}`, key: directKey(user._id, person._id), kind: 'direct', name: person.name, readOnly: !person.active }))
    ];
    const result = new Map((await chatStore.listRoomActivity(user._id, rooms.map(room => room.key))).map(entry => [entry.roomKey, entry]));
    const populated = await Promise.all(rooms.map(async ({ key, ...room }) => {
      const current = result.get(key);
      return { ...room, unread: current?.unread || 0, lastMessage: current?.lastMessage ? await publicMessage(current.lastMessage, user) : null };
    }));
    return {
      people: contacts.filter(person => person.active).map(({ _id: id, name }) => ({ id, name, online: online.has(id) })),
      modules: modules.map(publicModule), rooms: populated.filter(room => room.kind === 'sector' || room.lastMessage),
      unread: populated.reduce((total, room) => total + room.unread, 0)
    };
  }

  async function handleHttp({ req, res, route, user, send, readBody }) {
    if (req.method === 'GET' && route === '/chat') return send(res, 200, await summary(user));
    const query = new URL(req.url, 'http://localhost').searchParams;
    if (req.method === 'GET' && route === '/chat/messages') {
      const key = await roomKey(user, query.get('room'));
      const before = query.get('before');
      if (before !== null && !validSequence(before)) throw new ApiError(400, 'CHAT_CURSOR', 'Posição do histórico inválida.');
      const { messages, hasMore } = await chatStore.listMessages(key, before);
      return send(res, 200, { messages: await Promise.all(messages.map(message => publicMessage(message, user))), hasMore });
    }
    if (req.method === 'POST' && route === '/chat/read') {
      const input = await readBody(req);
      const key = await roomKey(user, input.room);
      if (!validSequence(input.through) || !await chatStore.markRead(user._id, key, input.through)) {
        throw new ApiError(400, 'CHAT_CURSOR', 'Mensagem não pertence a esta conversa.');
      }
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && route === '/chat/tasks') {
      const module = query.get('module');
      if (!canPerform(user, module, 'workItemRead')) throw new ApiError(403, 'CHAT_FORBIDDEN', 'Sem acesso às tarefas do setor.');
      const items = await store.listWorkItems({ modules: [module], companyCnpjs: user.role === 'admin' ? null : user.companyCnpjs, module });
      return send(res, 200, { tasks: items.map(({ _id: id, title, module: sector }) => ({ id, title, module: sector })) });
    }
    const attachmentId = route.startsWith('/chat/attachment/') && route.slice('/chat/attachment/'.length);
    if (['GET', 'HEAD'].includes(req.method) && validId(attachmentId)) {
      const file = await chatStore.getAttachment(attachmentId);
      if (!file || !canReadRoom(user, file.roomKey)) throw new ApiError(404, 'CHAT_NOT_FOUND', 'Anexo não encontrado.');
      return sendAttachment(res, file, req.method === 'HEAD');
    }
    throw new ApiError(404, 'NOT_FOUND', 'Rota inexistente');
  }

  function takeSendSlot(userId) {
    const now = Date.now();
    const previous = sendAttempts.get(userId);
    if (!previous || now >= previous.until) {
      sendAttempts.set(userId, { until: now + rateWindowMs, count: 1 });
      return;
    }
    if (++previous.count > 45) throw new ApiError(429, 'CHAT_RATE', 'Aguarde um instante antes de enviar mais mensagens.');
  }

  async function authenticateSocket(socket) {
    const auth = await authenticatePlatformRequest(store, socket.request);
    return auth && matchesPlatformCsrf(auth.session, socket.handshake.auth?.csrfToken) ? auth : null;
  }

  async function broadcast(event, message) {
    const candidates = [...io.of('/').sockets.values()].filter(socket =>
      message.roomKey.startsWith('sector:') || message.roomKey.split(':').slice(1).includes(socket.data.userId));
    await Promise.all(candidates.map(async socket => {
      const auth = await authenticateSocket(socket);
      if (!auth) return socket.disconnect(true);
      if (canReadRoom(auth.user, message.roomKey)) socket.emit(event, { message: await publicMessage(message, auth.user) });
    }));
  }

  async function sendMessage(auth, input) {
    const { user } = auth;
    const key = await roomKey(user, input?.room, { sending: true });
    if (!validId(input?.clientId)) {
      throw new ApiError(400, 'CHAT_MESSAGE', 'Mensagem inválida.');
    }
    const text = messageText(input.text === undefined ? '' : input.text);
    const attachments = normalizeAttachments(input.attachments);
    const reference = input.reference == null ? null : await resolveReference(user, input.reference);
    if (input.reference != null && !reference) throw new ApiError(403, 'CHAT_REFERENCE', 'Item indisponível para compartilhamento.');
    if (!text && !attachments.length && !reference) throw new ApiError(400, 'CHAT_EMPTY', 'Escreva uma mensagem ou inclua um anexo.');
    const { message, inserted } = await chatStore.createMessage({
      clientId: input.clientId, roomKey: key, senderId: user._id, senderName: user.name, text, attachments,
      reference: reference && { type: reference.type, id: reference.id }
    });
    if (!message || message.roomKey !== key) throw new ApiError(409, 'CHAT_DUPLICATE', 'Identificador de mensagem já utilizado.');
    return { message, event: inserted ? 'chat:message' : null };
  }

  async function reviseMessage(auth, input, deleting) {
    const { user } = auth;
    const key = await roomKey(user, input?.room);
    if (!validSequence(input.id)) throw new ApiError(400, 'CHAT_MESSAGE', 'Mensagem inválida.');
    const text = deleting ? null : messageText(input.text);
    const { message, changed, empty } = await chatStore.reviseMessage({ id: input.id, roomKey: key, senderId: user._id, text });
    if (empty) throw new ApiError(400, 'CHAT_EMPTY', 'A edição deixaria a mensagem vazia.');
    if (!message) throw new ApiError(404, 'CHAT_NOT_FOUND', 'Mensagem indisponível para alteração.');
    if (!deleting && message.deletedAt) throw new ApiError(409, 'CHAT_DELETED', 'Esta mensagem foi excluída.');
    return { message, event: changed ? 'chat:message-updated' : null };
  }

  async function handleSocketAction(socket, input, acknowledge, action) {
    if (typeof acknowledge !== 'function') return;
    try {
      const auth = await authenticateSocket(socket);
      if (!auth) {
        acknowledge({ ok: false, error: 'Entre novamente para acessar o chat.', code: 'UNAUTHORIZED' });
        socket.disconnect(true);
        return;
      }
      takeSendSlot(auth.user._id);
      const { message, event } = await action(auth, input);
      acknowledge({ ok: true, message: await publicMessage(message, auth.user) });
      if (event) void broadcast(event, message).catch(error => logger.error('Chat delivery failed', { code: error.code }));
    } catch (error) {
      if (!(error instanceof ApiError)) logger.error('Chat action failed', { code: error.code });
      acknowledge({
        ok: false, code: error instanceof ApiError ? error.code : 'CHAT_ERROR',
        error: error instanceof ApiError ? error.message : 'Falha ao atualizar a conversa.'
      });
    }
  }

  function attach(server) {
    io = new Server(server, {
      transports: ['polling'], allowUpgrades: false, maxHttpBufferSize: 7_200_000,
      allowRequest: (req, callback) => callback(null, allowedOrigin(req)),
    });
    io.use((socket, next) => {
      authenticateSocket(socket).then(auth => {
        if (!auth) return next(new Error('Entre novamente para acessar o chat.'));
        socket.data.userId = auth.user._id;
        socket.data.sessionId = auth.session._id;
        next();
      }).catch(error => {
        logger.error('Chat session check failed', { code: error.code });
        next(new Error('Chat indisponível no momento.'));
      });
    });
    io.on('connection', socket => {
      socket.on('chat:send', (input, acknowledge) => void handleSocketAction(socket, input, acknowledge, sendMessage));
      socket.on('chat:edit', (input, acknowledge) => void handleSocketAction(socket, input, acknowledge, (auth, body) => reviseMessage(auth, body, false)));
      socket.on('chat:delete', (input, acknowledge) => void handleSocketAction(socket, input, acknowledge, (auth, body) => reviseMessage(auth, body, true)));
    });
    const cleanup = setInterval(() => {
      const now = Date.now();
      for (const [userId, limit] of sendAttempts) if (now >= limit.until) sendAttempts.delete(userId);
    }, rateWindowMs);
    cleanup.unref();
    server.once('close', () => clearInterval(cleanup));
    return io;
  }

  function disconnectSession(id) {
    for (const socket of io?.of('/').sockets.values() || []) {
      if (socket.data.sessionId === id) socket.disconnect(true);
    }
  }

  return { attach, disconnectSession, handleHttp };
}
