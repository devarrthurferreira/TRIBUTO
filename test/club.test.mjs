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
  const accountFor = (role, moduleGrants = {}) => ({ _id: randomUUID(), role, active: true, moduleGrants });
  const admin = accountFor('admin');
  const member = accountFor('member');
  const rhManager = accountFor('member', { rh: 'manage' });
  const rhViewer = accountFor('member', { rh: 'view' });
  const rhBlocked = accountFor('member', { rh: { level: 'manage', blockedActions: ['clubMoodRead'] } });
  const accounts = [admin, member, rhManager, rhViewer, rhBlocked];
  const sessions = accounts.map((user, index) => ({
    userId: user._id, token: String(index + 1).repeat(64), csrfToken: `csrf-${index}`,
  }));
  const [adminSession, memberSession, rhManagerSession, rhViewerSession, rhBlockedSession] = sessions;
  const platform = {
    async findSession(hash) { return sessions.find(session => sha256(session.token) === hash); },
    async findUserById(id) { return accounts.find(user => user._id === id); },
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
    await run({ request, admin, member, adminSession, memberSession, rhManagerSession, rhViewerSession, rhBlockedSession });
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
    assert.deepEqual((await request(path, memberSession)).result, { today: date, checkedIn: false, todayMood: null, sharedWithRh: false, history: [] });
    assert.equal((await checkIn(5, { csrf: '' })).result.error, 'CSRF');
    for (const mood of [undefined, 0, 6, 2.5, '3', true, {}]) assert.equal((await checkIn(mood)).status, 400);
    assert.deepEqual((await checkIn(null)).result, { today: date, checkedIn: true, todayMood: null, sharedWithRh: false, history: [{ date, mood: null }] });
    assert.equal((await checkIn(5)).result.todayMood, 5);
    assert.deepEqual((await checkIn(2)).result.history, [{ date, mood: 2 }]);
    assert.equal((await checkIn(null)).result.todayMood, 2);
    assert.deepEqual((await request(path, adminSession)).result.history, []);
    now = new Date('2026-11-27T03:00:00Z');
    assert.deepEqual((await request(path, memberSession)).result, { today: '2026-11-27', checkedIn: false, todayMood: null, sharedWithRh: false, history: [{ date, mood: 2 }] });
  }, { clock: () => now });
});

test('Gestão de RH consulta apenas os check-ins compartilhados no período e respeita revogação e bloqueios', async () => {
  const checkIns = new Map();
  const today = '2026-11-26';
  const yesterday = '2026-11-25';
  const firstDay = '2026-11-20';
  let employeeId;
  function sharedRows(first, last) {
    assert.equal(last, today);
    return [...checkIns.values()].filter(row => row.sharedWithRh && row.date >= first && row.date <= last);
  }
  const store = {
    async saveMood(userId, date, mood, sharing = false) {
      const key = `${userId}:${date}`;
      checkIns.set(key, { userId, date, mood: mood ?? checkIns.get(key)?.mood ?? null, sharedWithRh: sharing });
    },
    async getMoodHistory(userId, first, last) {
      return [...checkIns.values()].filter(row => row.userId === userId && row.date >= first && row.date <= last)
        .sort((a, b) => b.date.localeCompare(a.date));
    },
    async getRhMoodOverview(first, last) {
      assert.equal(first, firstDay);
      const profiles = sharedRows(first, last).map(row => ({
        id: row.userId, name: 'Colaboradora de teste', checkIns: 1, answers: Number(row.mood !== null), average: row.mood, lastDate: row.date,
      }));
      const totals = { checkIns: profiles.length, answers: Number(profiles[0]?.average != null), average: profiles[0]?.average ?? null,
        counts: [1, 2, 3, 4, 5].map(mood => Number(profiles[0]?.average === mood)) };
      const trend = profiles.map(({ lastDate: date, checkIns: count, answers, average }) => ({ date, checkIns: count, answers, average }));
      return { totals, trend, profiles };
    },
    async getRhMoodProfile(userId, first, last) {
      assert.equal(first, '2026-10-28');
      const history = sharedRows(first, last).filter(row => row.userId === userId).map(({ date, mood }) => ({ date, mood }));
      return history.length ? { profile: { id: employeeId, name: 'Colaboradora de teste' }, history } : null;
    },
  };
  await withClubRoutes(store, async ({ request, member, adminSession, memberSession, rhManagerSession, rhViewerSession, rhBlockedSession }) => {
    employeeId = member._id;
    const overview = '/check-in/rh?days=7';
    const detail = `/check-in/rh/${employeeId}`;
    const update = input => request('/check-in', memberSession, { method: 'PUT', input });

    await store.saveMood(employeeId, yesterday, 1);
    assert.equal((await request(overview)).status, 401);
    for (const session of [memberSession, rhViewerSession, rhBlockedSession]) {
      assert.equal((await request(overview, session)).status, 403);
      assert.equal((await request(detail, session)).status, 403);
    }
    for (const query of ['days=', 'days=8', 'days=7&days=30', 'days=90.0']) {
      assert.equal((await request(`/check-in/rh?${query}`, rhManagerSession)).result.error, 'CLUB_INVALID_PERIOD');
    }
    assert.equal((await request('/check-in/rh/id-invalido', rhManagerSession)).status, 400);
    assert.equal((await request(detail, rhManagerSession)).status, 404);
    for (const shareWithRh of [null, 1, 'true', {}]) {
      assert.equal((await update({ mood: 4, shareWithRh })).result.error, 'CLUB_INVALID_SHARING');
    }
    assert.equal((await update({ mood: null, shareWithRh: true })).result.sharedWithRh, true);
    assert.deepEqual((await request(detail, rhManagerSession)).result.history, [{ date: today, mood: null }]);
    assert.equal((await request(overview, rhManagerSession)).result.totals.average, null);
    assert.equal((await update({ mood: 4, shareWithRh: true })).result.todayMood, 4);
    assert.deepEqual((await request(overview, rhManagerSession)).result, {
      today, firstDay, days: 7, totals: { checkIns: 1, answers: 1, average: 4, counts: [0, 0, 0, 1, 0] },
      trend: [{ date: today, checkIns: 1, answers: 1, average: 4 }],
      profiles: [{ id: employeeId, name: 'Colaboradora de teste', checkIns: 1, answers: 1, average: 4, lastDate: today }],
    });
    assert.deepEqual((await request(detail, adminSession)).result.history, [{ date: today, mood: 4 }]);
    assert.equal((await request(`/check-in/rh/${randomUUID()}`, rhManagerSession)).status, 404);
    const revoked = (await update({ mood: null, shareWithRh: false })).result;
    assert.equal(revoked.sharedWithRh, false);
    assert.deepEqual(revoked.history, [{ date: today, mood: 4 }, { date: yesterday, mood: 1 }]);
    assert.equal((await request(detail, rhManagerSession)).status, 404);
    assert.deepEqual((await request(overview, rhManagerSession)).result.profiles, []);
    assert.equal((await update({ mood: 5 })).result.sharedWithRh, false);
    assert.equal((await request(detail, rhManagerSession)).status, 404);
  }, { clock: () => new Date('2026-11-26T15:00:00Z') });
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

test('Comentários anônimos usam a sessão, o dia de São Paulo e apenas semanas encerradas no painel do RH', async () => {
  let employeeId;
  let eligible = false;
  let text;
  let now = new Date('2026-11-30T02:59:59Z');
  const weeks = [{ start: '2026-11-23', comments: ['Texto sem identificação'] }];
  const store = {
    async saveAnonymousMoodComment(userId, date, week, comment) {
      assert.equal(userId, employeeId);
      assert.equal(date, '2026-11-29');
      assert.equal(week, '2026-11-23');
      if (!eligible) throw new ApiError(409, 'CLUB_MOOD_COMMENT_UNAVAILABLE', 'Sem resposta triste.');
      if (text) return false;
      text = comment;
      return true;
    },
    async getAnonymousMoodComments(first, current, minimum) {
      assert.equal(minimum, 5);
      if (now.getUTCHours() === 2) {
        assert.equal(first, '2026-08-24');
        assert.equal(current, '2026-11-23');
        return [];
      }
      assert.equal(first, '2026-08-31');
      assert.equal(current, '2026-11-30');
      return weeks;
    },
  };
  await withClubRoutes(store, async ({ request, member, memberSession, rhManagerSession, rhViewerSession, rhBlockedSession, adminSession }) => {
    employeeId = member._id;
    const path = '/check-in/anonymous-comments';
    const submit = (comment, options) => request(path, memberSession, {
      method: 'POST', input: { comment, author: 'Autor informado', week: '2026-11-30' }, ...options,
    });

    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, undefined, { method: 'POST', input: { comment: 'Teste' } })).status, 401);
    for (const session of [memberSession, rhViewerSession, rhBlockedSession]) {
      assert.equal((await request(path, session)).status, 403);
    }
    assert.equal((await submit('Teste', { csrf: '' })).result.error, 'CSRF');
    for (const comment of ['', '  ', null, {}, 'a'.repeat(1001)]) {
      assert.equal((await submit(comment)).result.error, 'CLUB_INVALID_COMMENT');
    }
    assert.equal((await submit('Teste')).result.error, 'CLUB_MOOD_COMMENT_UNAVAILABLE');
    eligible = true;
    assert.deepEqual(await submit('  Texto sem identificação \n'), { status: 201, result: { submitted: true } });
    assert.deepEqual(await submit('Outro texto'), { status: 200, result: { submitted: true } });
    assert.equal(text, 'Texto sem identificação');
    assert.deepEqual(await request(path, rhManagerSession), { status: 200, result: { weeks: [], minimum: 5 } });
    now = new Date('2026-11-30T03:00:00Z');
    assert.deepEqual(await request(`${path}?days=1&userId=${employeeId}`, adminSession), {
      status: 200, result: { weeks, minimum: 5 },
    });
  }, { clock: () => now });
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
