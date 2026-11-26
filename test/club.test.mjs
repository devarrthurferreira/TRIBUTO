import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { ApiError, sha256 } from '../src/api/validation.mjs';
import { applyClubFields, clubFields, importClubFields } from '../src/club/catalog.mjs';
import { createClubRouter } from '../src/club/routes.mjs';
import { createPlatformRouter } from '../src/platform/routes.mjs';

const CLUB = '/v1/platform/club';

async function withClubRoutes(store, run, options) {
  const accountFor = role => ({ _id: randomUUID(), role, active: true });
  const [admin, member] = ['admin', 'member'].map(accountFor);
  const sessions = [admin, member].map((user, index) => ({
    userId: user._id, token: String(index + 1).repeat(64), csrfToken: `csrf-${user.role}`,
  }));
  const [adminSession, memberSession] = sessions;
  const platform = {
    async findSession(hash) { return sessions.find(session => sha256(session.token) === hash); },
    async findUserById(id) { return [admin, member].find(user => user._id === id); },
  };
  const club = createClubRouter(store, options);
  const router = createPlatformRouter({ store: platform, club });
  const server = http.createServer((req, res) => router(req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    async function request(path, session, { method = 'GET', input, csrf = session?.csrfToken } = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${CLUB}${path}`, {
        method,
        headers: {
          ...(input ? { 'content-type': 'application/json' } : {}),
          ...(session ? { cookie: `tributo_session=${session.token}` } : {}),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        body: input && JSON.stringify(input),
      });
      return { status: response.status, result: await response.json() };
    }
    await run({ request, admin, member, adminSession, memberSession });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('Clube reutiliza a sessão da Central e restringe alterações a administradores com CSRF', async () => {
  const published = { id: randomUUID(), title: 'Benefício publicado', active: true };
  const draft = { id: randomUUID(), title: 'Rascunho', active: false };
  let saved;
  const store = {
    async list(includeInactive) { return { benefits: includeInactive ? [published, draft] : [published], partners: [], events: [] }; },
    async create(collection, id, fields, actorId) {
      saved = { collection, id, fields, actorId };
      return { ...fields, id };
    },
    async update(collection, id, fields, actorId) {
      assert.equal(collection, saved.collection);
      assert.equal(actorId, saved.actorId);
      return id === saved.id ? { ...saved.fields, ...fields, id } : null;
    },
    async remove(collection, id, actorId) { return collection === saved.collection && id === saved.id && actorId === saved.actorId; },
    async importCatalog(catalog, actorId) { return { received: catalog, actorId }; },
  };
  await withClubRoutes(store, async ({ request, admin, adminSession, memberSession }) => {
    assert.equal((await request('')).status, 401);
    assert.deepEqual((await request('', memberSession)).result.benefits, [published]);
    assert.deepEqual((await request('', adminSession)).result.benefits, [published, draft]);
    const title = 'Feira de benefícios';
    const event = { title, startAt: '2026-12-07T09:00:00-03:00', endAt: '2026-12-07T10:30:00-03:00', active: false };
    assert.equal((await request('/events', memberSession, { method: 'POST', input: event })).status, 403);
    assert.equal((await request('/import', memberSession, { method: 'POST', input: {} })).status, 403);
    assert.equal((await request('/events', adminSession, { method: 'POST', input: event, csrf: '' })).result.error, 'CSRF');
    const importedId = randomUUID();
    const imported = await request('/import', adminSession, { method: 'POST', input: { events: [{ ...event, id: importedId }] } });
    assert.equal(imported.status, 200);
    assert.equal(imported.result.received.events[0].id, importedId);
    assert.equal(imported.result.actorId, admin._id);
    assert.equal((await request('/events', adminSession, { method: 'POST', input: { ...event, url: 'javascript:alert(1)' } })).status, 400);
    const created = await request('/events', adminSession, { method: 'POST', input: event });
    assert.equal(created.status, 201);
    assert.equal(created.result.startAt, '2026-12-07T12:00:00.000Z');
    assert.equal(created.result.active, false);
    assert.equal(saved.actorId, admin._id);
    const path = `/events/${created.result.id}`;
    assert.equal((await request(path, memberSession, { method: 'PATCH', input: { active: true } })).status, 403);
    assert.equal((await request(path, adminSession, { method: 'PATCH', input: { active: true } })).result.active, true);
    assert.equal((await request(path, memberSession, { method: 'DELETE' })).status, 403);
    assert.deepEqual(await request(path, adminSession, { method: 'DELETE' }), { status: 200, result: { removed: true } });
  });
});

test('Check-in usa a data de São Paulo, permite presença sem humor e limita cada pessoa ao próprio histórico', async () => {
  let now = new Date('2026-11-27T02:59:59Z');
  const checkIns = new Map();
  const store = {
    async saveMood(userId, date, mood) {
      const key = `${userId}:${date}`;
      checkIns.set(key, { userId, date, mood: mood ?? checkIns.get(key)?.mood ?? null });
    },
    async getMoodHistory(userId, first, today) {
      assert.equal(first, today === '2026-11-26' ? '2026-10-28' : '2026-10-29');
      return [...checkIns.values()]
        .filter(row => row.userId === userId && row.date >= first && row.date <= today)
        .sort((a, b) => b.date.localeCompare(a.date)).map(({ date, mood }) => ({ date, mood }));
    },
  };
  await withClubRoutes(store, async ({ request, adminSession, memberSession }) => {
    const path = '/check-in';
    const date = '2026-11-26';
    const checkIn = (mood, options) => request(path, memberSession, { method: 'PUT', input: { mood }, ...options });
    assert.equal((await request(path)).status, 401);
    assert.deepEqual((await request(path, memberSession)).result, { today: date, checkedIn: false, todayMood: null, history: [] });
    assert.equal((await checkIn(5, { csrf: '' })).result.error, 'CSRF');
    for (const mood of [undefined, 0, 6, 2.5, '3', true, {}]) assert.equal((await checkIn(mood)).status, 400);
    assert.deepEqual((await checkIn(null)).result, { today: date, checkedIn: true, todayMood: null, history: [{ date, mood: null }] });
    assert.equal((await checkIn(5)).result.todayMood, 5);
    assert.deepEqual((await checkIn(2)).result.history, [{ date, mood: 2 }]);
    assert.equal((await checkIn(null)).result.todayMood, 2);
    assert.deepEqual((await request(path, adminSession)).result.history, []);
    now = new Date('2026-11-27T03:00:00Z');
    assert.deepEqual((await request(path, memberSession)).result, { today: '2026-11-27', checkedIn: false, todayMood: null, history: [{ date, mood: 2 }] });
  }, { clock: () => now });
});

test('A visão de humor da equipe exige administrador e solicita apenas dias encerrados com pelo menos cinco respostas', async () => {
  const summary = [{ date: '2026-11-25', total: 5, average: 3.6, counts: [0, 1, 1, 2, 1] }];
  const store = {
    async getMoodSummary(first, today, minimum) {
      assert.equal(first, '2026-10-27');
      assert.equal(today, '2026-11-26');
      assert.equal(minimum, 5);
      return summary;
    },
  };
  await withClubRoutes(store, async ({ request, adminSession, memberSession }) => {
    assert.equal((await request('/check-in/summary')).status, 401);
    assert.equal((await request('/check-in/summary', memberSession)).status, 403);
    assert.deepEqual(await request('/check-in/summary', adminSession), { status: 200, result: { days: summary, minimum: 5 } });
  }, { clock: () => new Date('2026-11-27T02:59:59Z') });
});

test('Favoritos do Clube exigem sessão e CSRF, são pessoais e omitem itens indisponíveis', async () => {
  const [visibleId, hiddenId] = [randomUUID(), randomUUID()];
  const visible = new Set([visibleId]);
  const savedByUser = new Map();
  const store = {
    async listSaved(userId) { return [...(savedByUser.get(userId) ?? [])].filter(id => visible.has(id)); },
    async addSaved(userId, id) {
      if (!visible.has(id)) throw new ApiError(404, 'CLUB_NOT_FOUND', 'Registro indisponível.');
      const saved = savedByUser.get(userId) ?? new Set();
      savedByUser.set(userId, saved.add(id));
      return this.listSaved(userId);
    },
    async removeSaved(userId, id) {
      savedByUser.get(userId)?.delete(id);
      return this.listSaved(userId);
    },
  };
  await withClubRoutes(store, async ({ request, adminSession, memberSession }) => {
    const path = `/saved/${visibleId}`;
    assert.equal((await request('/saved')).status, 401);
    assert.equal((await request(path, memberSession, { method: 'PUT', csrf: '' })).result.error, 'CSRF');
    assert.equal((await request('/saved/invalid', memberSession, { method: 'PUT' })).status, 400);
    assert.equal((await request(`/saved/${hiddenId}`, memberSession, { method: 'PUT' })).status, 404);
    assert.deepEqual((await request(path, memberSession, { method: 'PUT' })).result.ids, [visibleId]);
    assert.deepEqual((await request(path, memberSession, { method: 'PUT' })).result.ids, [visibleId]);
    assert.deepEqual((await request(path, adminSession, { method: 'DELETE' })).result.ids, []);
    assert.deepEqual((await request('/saved', memberSession)).result.ids, [visibleId]);
    visible.delete(visibleId);
    assert.deepEqual((await request('/saved', memberSession)).result.ids, []);
    assert.deepEqual((await request(path, memberSession, { method: 'DELETE' })).result.ids, []);
  });
});

test('Clube valida datas, links e identificadores estáveis na edição e importação', () => {
  const id = randomUUID();
  const partner = { id, title: 'Academia de teste', whatsapp: '(32) 99999-0001', mapsUrl: 'https://example.test/mapa' };
  const offer = { id: randomUUID(), title: 'Oferta de teste', partnerId: id, rules: 'Consulte as condições.' };
  const catalog = importClubFields({ partners: [partner], benefits: [offer] });
  assert.equal(catalog.partners[0].whatsapp, '5532999990001');
  assert.equal(catalog.benefits[0].kind, 'advantage');
  assert.equal(catalog.benefits[0].partnerId, id);
  assert.throws(() => importClubFields({ partners: [partner], benefits: [{ ...offer, id }] }), { code: 'CLUB_INVALID_INPUT' });
  assert.throws(() => clubFields('partners', { ...partner, websiteUrl: 'https://user:password@example.test' }), { code: 'CLUB_INVALID_INPUT' });
  const event = { title: 'Evento de teste', startAt: '2026-02-08T09:00:00Z' };
  assert.throws(() => clubFields('events', { ...event, startAt: '2026-02-30T09:00:00Z' }), { code: 'CLUB_INVALID_INPUT' });
  const dateChanges = clubFields('events', { endAt: '2026-02-07T09:00:00Z' }, { partial: true });
  assert.throws(() => applyClubFields('events', clubFields('events', event), dateChanges), { code: 'CLUB_INVALID_INPUT' });
});
