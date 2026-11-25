import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { io as connect } from 'socket.io-client';
import { createApiServer } from '../src/api/http.mjs';
import { sha256 } from '../src/api/validation.mjs';
import { createChat } from '../src/chat/service.mjs';
import { createPlatformRouter } from '../src/platform/routes.mjs';

test('chat em polling autentica destinatários, guarda mensagens e protege anexos e tarefas', { timeout: 15_000 }, async () => {
  const people = ['Ana', 'Bruno', 'Carla'].map((name, i) => ({
    _id: randomUUID(), name, role: 'member', active: true, companyCnpjs: [],
    moduleGrants: i < 2 ? { tecnologia: 'view' } : {}, token: String(i + 1).repeat(64), csrfToken: randomUUID()
  }));
  const [ana, bruno, carla] = people;
  const task = { _id: randomUUID(), title: 'Atividade da Tecnologia', module: 'tecnologia', companyCnpj: null };
  const sessions = new Map(people.map(person => [sha256(person.token), {
    _id: sha256(person.token), userId: person._id, csrfToken: person.csrfToken
  }]));
  const store = {
    async findSession(id) { return sessions.get(id); },
    async findUserById(id) { return people.find(person => person._id === id); },
    async listUsers() { return people; },
    async getWorkItem(id) { return task._id === id ? task : null; },
    async listWorkItems() { return [task]; },
    async deleteSession(id) { sessions.delete(id); }
  };
  const reads = new Map();
  const messages = [];
  const files = new Map();
  const chatStore = {
    async listRoomActivity(userId, roomKeys) {
      return roomKeys.map(roomKey => {
        const history = messages.filter(message => message.roomKey === roomKey);
        const readThrough = reads.get(`${userId}:${roomKey}`) || 0;
        return { roomKey, lastMessage: history.at(-1), unread: history.filter(message => !message.deletedAt && Number(message.id) > readThrough && message.senderId !== userId).length };
      });
    },
    async listMessages(roomKey, beforeSequence) {
      return { messages: messages.filter(message => message.roomKey === roomKey && (!beforeSequence || Number(message.id) < Number(beforeSequence))), hasMore: false };
    },
    async createMessage(message) {
      const existing = messages.find(row => row.senderId === message.senderId && row.clientId === message.clientId);
      if (existing) return { message: existing.roomKey === message.roomKey ? existing : null, inserted: false };
      message.id = String(messages.length + 1);
      message.createdAt = new Date().toISOString();
      message.attachments = message.attachments.map(({ data, ...metadata }) => {
        files.set(metadata.id, { ...metadata, data, roomKey: message.roomKey });
        return metadata;
      });
      messages.push(message);
      return { message, inserted: true };
    },
    async reviseMessage({ id, roomKey, senderId, text }) {
      const index = messages.findIndex(message => message.id === id && message.roomKey === roomKey && message.senderId === senderId);
      if (index === -1) return { message: null, changed: false };
      const previous = messages[index];
      if (previous.deletedAt || text === previous.text) return { message: previous, changed: false };
      if (text === '' && !previous.attachments.length && !previous.reference) return { message: null, changed: false, empty: true };
      const now = new Date().toISOString();
      const message = { ...previous, text: text ?? '' };
      if (text === null) {
        for (const { id: attachmentId } of previous.attachments) files.delete(attachmentId);
        Object.assign(message, { attachments: [], reference: null, deletedAt: now });
      } else {
        message.editedAt = now;
      }
      messages[index] = message;
      return { message, changed: true };
    },
    async markRead(userId, roomKey, through) {
      if (!messages.some(message => message.id === through && message.roomKey === roomKey)) return false;
      reads.set(`${userId}:${roomKey}`, Number(through));
      return true;
    },
    async getAttachment(id) { return files.get(id); }
  };
  const chat = createChat({ store, chatStore });
  const server = createApiServer({ store: {}, agentRegistry: {}, platformRouter: createPlatformRouter({ store, chat }) });
  const io = chat.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const cookie = person => `tributo_session=${person.token}`;
  const sockets = [];
  function socket(person, csrfToken) {
    const client = connect(url, { autoConnect: false, autoUnref: true, forceNew: true, reconnection: false, transports: ['polling'],
      extraHeaders: { Cookie: cookie(person) }, auth: { csrfToken }
    });
    sockets.push(client);
    client.connect();
    return client;
  }
  function request(person, route = '', body) {
    const options = { headers: { Cookie: cookie(person) } };
    if (body) Object.assign(options, { method: 'POST', body: JSON.stringify(body), headers: {
      ...options.headers, 'content-type': 'application/json', 'x-csrf-token': person.csrfToken
    } });
    return fetch(url + '/v1/platform/chat' + route, options);
  }
  try {
    const rejected = socket(ana, 'invalid');
    await once(rejected, 'connect_error');
    const sender = socket(ana, ana.csrfToken), recipient = socket(bruno, bruno.csrfToken), outsider = socket(carla, carla.csrfToken);
    await Promise.all([sender, recipient, outsider].map(client => once(client, 'connect')));
    assert.equal(sender.io.engine.transport.name, 'polling');
    assert.equal((await fetch(url + '/v1/platform/chat')).status, 401);
    const crossOrigin = await fetch(url + '/socket.io/?EIO=4&transport=polling', { headers: { Origin: 'https://other.example' } });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await fetch(url + '/socket.io/socket.io.js', { method: 'HEAD' })).status, 200);

    const outsiderEvents = [];
    outsider.on('chat:message', event => outsiderEvents.push(event));
    const received = once(recipient, 'chat:message');
    const clientId = randomUUID();
    const input = { clientId, room: 'sector:tecnologia', text: 'Bom dia',
      attachments: [{ name: 'Teste — planilha.csv', mime: 'text/csv', data: Buffer.from('A,B\n1,2') }],
      reference: { type: 'task', id: task._id }
    };
    const sent = await sender.timeout(3000).emitWithAck('chat:send', input);
    assert.equal(sent.ok, true);
    assert.equal(sent.message.attachments[0].size, 7);
    assert.equal((await received)[0].message.reference.href, `/setor/tecnologia?atividade=${task._id}`);
    const replayed = await sender.timeout(3000).emitWithAck('chat:send', input);
    assert.equal(replayed.message.id, sent.message.id);
    assert.equal(messages.length, 1);
    assert.equal((await request(carla, '/messages?room=sector%3Atecnologia')).status, 403);
    assert.deepEqual(outsiderEvents, []);
    const attachmentPath = '/attachment/' + sent.message.attachments[0].id;
    assert.equal((await request(carla, attachmentPath)).status, 404);
    const file = await request(bruno, attachmentPath);
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-disposition'), /^attachment/);
    assert.equal(await file.text(), 'A,B\n1,2');
    assert.equal((await request(bruno)).status, 200);
    assert.equal((await (await request(bruno)).json()).unread, 1);
    assert.equal((await request(bruno, '/read', { room: 'sector:tecnologia', through: sent.message.id })).status, 200);
    assert.equal((await (await request(bruno)).json()).unread, 0);
    const target = { room: 'sector:tecnologia', id: sent.message.id };
    const unauthorizedEdit = await recipient.timeout(3000).emitWithAck('chat:edit', { ...target, text: 'Outro autor' });
    assert.equal(unauthorizedEdit.code, 'CHAT_NOT_FOUND');
    const unauthorizedDelete = await recipient.timeout(3000).emitWithAck('chat:delete', target);
    assert.equal(unauthorizedDelete.code, 'CHAT_NOT_FOUND');
    const outsideEdit = await outsider.timeout(3000).emitWithAck('chat:edit', { ...target, text: 'Outro setor' });
    assert.equal(outsideEdit.code, 'CHAT_FORBIDDEN');
    const editEvent = once(recipient, 'chat:message-updated');
    const edited = await sender.timeout(3000).emitWithAck('chat:edit', { ...target, text: 'Bom dia, atualizado' });
    assert.equal(edited.message.text, 'Bom dia, atualizado');
    assert.ok(edited.message.editedAt);
    assert.equal(edited.message.attachments[0].id, sent.message.attachments[0].id);
    assert.equal((await editEvent)[0].message.text, edited.message.text);
    const editedHistory = (await (await request(bruno, '/messages?room=sector%3Atecnologia')).json()).messages[0];
    assert.equal(editedHistory.editedAt, edited.message.editedAt);
    const deletionEvent = once(recipient, 'chat:message-updated');
    const deleted = await sender.timeout(3000).emitWithAck('chat:delete', target);
    assert.ok(deleted.message.deletedAt);
    assert.equal(deleted.message.text, '');
    assert.equal(deleted.message.reference, null);
    assert.deepEqual(deleted.message.attachments, []);
    assert.equal((await deletionEvent)[0].message.deletedAt, deleted.message.deletedAt);
    assert.equal((await request(bruno, attachmentPath)).status, 404);
    const deletedHistory = (await (await request(bruno, '/messages?room=sector%3Atecnologia')).json()).messages[0];
    assert.equal(deletedHistory.deletedAt, deleted.message.deletedAt);
    const repeatedDeletion = await sender.timeout(3000).emitWithAck('chat:delete', target);
    assert.equal(repeatedDeletion.message.deletedAt, deleted.message.deletedAt);
    const afterDeleteEdit = await sender.timeout(3000).emitWithAck('chat:edit', { ...target, text: 'Recriar mensagem' });
    assert.equal(afterDeleteEdit.code, 'CHAT_DELETED');

    const privateEvent = once(outsider, 'chat:message');
    const privateSent = await sender.timeout(3000).emitWithAck('chat:send', { ...input, clientId: randomUUID(), room: `direct:${carla._id}`, attachments: [] });
    assert.equal(privateSent.ok, true);
    const [privateReceived] = await privateEvent;
    assert.equal(privateReceived.message.room, `direct:${ana._id}`);
    assert.equal(privateReceived.message.reference, null);
    assert.equal((await (await request(carla, `/messages?room=direct%3A${ana._id}`)).json()).messages[0].reference, null);
    const blocked = await outsider.timeout(3000).emitWithAck('chat:send', { ...input, clientId: randomUUID() });
    assert.equal(blocked.code, 'CHAT_FORBIDDEN');
    const invalidFile = await sender.timeout(3000).emitWithAck('chat:send', { ...input, clientId: randomUUID(),
      attachments: [{ name: 'script.html', data: Buffer.from('<script></script>') }]
    });
    assert.equal(invalidFile.code, 'CHAT_ATTACHMENT_TYPE');

    const disconnected = once(outsider, 'disconnect');
    const logout = await fetch(url + '/v1/platform/logout', { method: 'POST', headers: {
      Cookie: cookie(carla), 'content-type': 'application/json', 'x-csrf-token': carla.csrfToken
    }, body: '{}' });
    assert.equal(logout.status, 200);
    await disconnected;
    carla.active = false;
    const afterDeactivation = await (await request(ana)).json();
    assert.equal(afterDeactivation.people.some(person => person.id === carla._id), false);
    assert.equal(afterDeactivation.rooms.find(room => room.id === `direct:${carla._id}`).readOnly, true);
    assert.equal((await (await request(ana, `/messages?room=direct%3A${carla._id}`)).json()).messages.length, 1);
    const archived = await sender.timeout(3000).emitWithAck('chat:send', { clientId: randomUUID(), room: `direct:${carla._id}`, text: 'Conversa encerrada' });
    assert.equal(archived.code, 'CHAT_FORBIDDEN');
  } finally {
    await io.close();
    sockets.forEach(client => client.disconnect());
  }
});
