import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { sha256 } from '../src/api/validation.mjs';
import { createPlatformRouter } from '../src/platform/routes.mjs';

test('métricas de Marketing reutilizam a sessão, validam registros e protegem as mutações', async (t) => {
  const metricId = randomUUID();
  const taskId = randomUUID();
  const calls = [];
  const people = [
    { role: 'member', moduleGrants: { marketing: 'edit' } },
    { role: 'member', moduleGrants: { marketing: 'view' } },
    { role: 'member', moduleGrants: { tecnologia: 'edit' } },
    { role: 'member', moduleGrants: { marketing: { level: 'edit', blockedActions: ['workItemUpdate'] } } },
  ].map((person, index) => ({ ...person, _id: randomUUID(), active: true,
    companyCnpjs: [], token: String(index + 1).repeat(64), csrf: `csrf-qa-${index}` }));
  const [editor, reader, outsider, blocked] = people;
  const store = {
    async findSession(hash) {
      const person = people.find(person => sha256(person.token) === hash);
      return person ? { userId: person._id, csrfToken: person.csrf } : null;
    },
    async findUserById(id) { return people.find(person => person._id === id); },
    marketingMetrics: {
      async listMarketingMetrics(user, query) {
        calls.push({ userId: user._id, ...query });
        return { items: [{ id: metricId }], hasMore: true };
      },
      async createMarketingMetric(user, fields) {
        calls.push({ userId: user._id, ...fields });
        return { item: { id: metricId, taskId: fields.taskId }, created: !fields.taskId };
      },
      async updateMarketingMetric(user, id, fields, expectedUpdatedAt) {
        calls.push({ userId: user._id, id, fields, expectedUpdatedAt });
        return { id, ...fields };
      },
      async saveMarketingMetricReading(user, id, reading) {
        calls.push({ userId: user._id, id, reading });
        return { id, readings: [reading] };
      },
    },
  };
  const router = createPlatformRouter({ store });
  const server = createServer((req, res) => router(req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/v1/platform/marketing/metrics`;

  async function request(path, person, { method = 'GET', body, csrf = true } = {}) {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (person) {
      headers.set('cookie', `tributo_session=${person.token}`);
      if (csrf) headers.set('x-csrf-token', person.csrf);
    }
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, payload: await response.json() };
  }
  const post = (person, body) => request('', person, { method: 'POST', body });
  const measure = (person, body) => request(`/${metricId}/readings`, person, { method: 'PUT', body });

  assert.equal((await request('', null)).status, 401);
  assert.equal((await request('', outsider)).status, 403);
  assert.equal((await post(reader, { title: 'Visita ao site' })).status, 403);
  assert.equal((await request('', editor, { method: 'POST', body: { title: 'Visita ao site' }, csrf: false })).payload.error, 'CSRF');
  assert.equal((await request('?page=0', reader)).status, 400);
  assert.equal((await post(editor, { title: 'Visita ao site', desiredReach: -1 })).status, 400);
  assert.equal((await post(editor, { title: 'Visita ao site', socialChannel: 'somos-maximum-youtube' })).status, 400);
  assert.equal((await post(editor, { taskId: 'tarefa-ausente' })).status, 400);
  assert.equal((await measure(editor, { date: '2025-02-30', actualReach: 8 })).status, 400);
  assert.equal((await measure(editor, { date: '2025-01-01', actualReach: 10.5 })).status, 400);
  assert.equal((await measure(blocked, { date: '2025-01-01', actualReach: 8 })).status, 403);
  assert.deepEqual(calls, []);

  const list = await request('?page=2', reader);
  assert.deepEqual(list.payload, { items: [{ id: metricId }], page: 2, hasMore: true });
  assert.deepEqual(calls.pop(), { userId: reader._id, limit: 100, offset: 100 });
  const linked = await post(editor, { taskId });
  assert.equal(linked.status, 200);
  assert.equal(linked.payload.item.taskId, taskId);
  assert.deepEqual(calls.pop(), { userId: editor._id, taskId, metadata: null });

  const standalone = await post(editor, { title: '  Visitas ao site  ', priority: 'high', dueAt: '2025-04-14',
    checklist: [{ title: 'Revisar texto', done: false }], socialChannel: 'newsletter', desiredReach: 820, estimatedReach: 0 });
  assert.equal(standalone.status, 201);
  const { metadata } = calls.pop();
  assert.equal(metadata.title, 'Visitas ao site');
  assert.equal(metadata.socialChannel, 'newsletter');
  assert.equal(metadata.estimatedReach, 0);
  assert.equal(metadata.checklist[0].title, 'Revisar texto');

  for (const brand of ['somos-maximum', 'maximum-contabil']) {
    for (const socialChannel of [brand, `${brand}-instagram`, `${brand}-tiktok`]) {
      const created = await post(editor, { title: 'Alcance por perfil', socialChannel });
      assert.equal(created.status, 201);
      assert.equal(calls.pop().metadata.socialChannel, socialChannel);
    }
  }

  const expectedUpdatedAt = '2025-01-02T16:01:02.012Z';
  assert.equal((await request(`/${metricId}`, editor, { method: 'PATCH', body: { estimatedReach: null, expectedUpdatedAt } })).status, 200);
  assert.deepEqual(calls.pop(), { userId: editor._id, id: metricId, fields: { estimatedReach: null }, expectedUpdatedAt });

  const measured = await measure(editor, { date: '2025-01-01', actualReach: 0 });
  assert.equal(measured.status, 200);
  assert.deepEqual(measured.payload.item.readings, [{ date: '2025-01-01', actualReach: 0 }]);
});
