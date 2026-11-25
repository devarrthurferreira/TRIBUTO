import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { sha256 } from '../src/api/validation.mjs';
import { goalDetails, goalFields, surveyRating } from '../src/people/fields.mjs';
import { createPeopleRouter } from '../src/people/routes.mjs';
import { createPlatformRouter } from '../src/platform/routes.mjs';

test('Pessoas normaliza progresso, valida datas e rejeita respostas fora da escala', () => {
  const assigned = goalDetails({}, goalFields({ title: ' Curso de teste ', dueAt: '2028-02-29', progress: 1 }));
  assert.deepEqual(assigned, { title: 'Curso de teste', description: '', dueAt: '2028-02-29', progress: 1, status: 'in_progress' });
  assert.equal(goalDetails(assigned, goalFields({ status: 'done' }, { partial: true })).progress, 100);
  assert.equal(goalDetails(assigned, goalFields({ progress: 0 }, { partial: true })).status, 'planned');
  assert.throws(() => goalFields({ dueAt: '2027-02-29' }, { partial: true }), { code: 'PEOPLE_INVALID_INPUT' });
  assert.throws(() => goalFields({ progress: -1 }, { partial: true }), { code: 'PEOPLE_INVALID_INPUT' });
  assert.throws(() => goalDetails(assigned, { status: 'in_progress', progress: 100 }), { code: 'PEOPLE_INVALID_INPUT' });
  assert.throws(() => surveyRating({ rating: '5' }), { code: 'PEOPLE_INVALID_INPUT' });
  assert.throws(() => surveyRating({ rating: 6 }), { code: 'PEOPLE_INVALID_INPUT' });
});

test('Pessoas usa a sessão e o CSRF da Central, preserva o titular e protege a publicação de pesquisas', async () => {
  const [person, admin] = ['member', 'admin'].map(role => ({ _id: randomUUID(), role, active: true }));
  const sessions = [person, admin].map((user, index) => ({ user, userId: user._id, token: String(index + 1).repeat(64), csrfToken: `test-${user.role}` }));
  const [personSession, adminSession] = sessions;
  const goalId = randomUUID();
  const surveyId = randomUUID();
  const calls = [];
  const people = createPeopleRouter({
    async listGoals(owner) { return owner === person._id ? [{ id: goalId }] : []; },
    async createGoal(owner, fields) { calls.push([owner, fields]); return { id: goalId, ...fields }; },
    async updateGoal(owner, id, fields) { return owner === person._id && id === goalId ? { id, ...fields } : null; },
    async removeGoal(owner, id) { return owner === person._id && id === goalId; },
    async listSurveys() { return []; },
    async createSurvey(actor, fields) { assert.equal(actor, admin._id); return { id: surveyId, ...fields, results: null }; },
    async closeSurvey(actor, id) { assert.equal(actor, admin._id); return { id, status: 'closed', results: null }; },
    async respondToSurvey(actor, id, rating) { assert.equal(actor, person._id); return { id, myRating: rating, results: null }; },
  });
  const router = createPlatformRouter({ people, store: {
    async findSession(hash) { return sessions.find(session => sha256(session.token) === hash); },
    async findUserById(id) { return sessions.find(session => session.userId === id)?.user; },
  } });
  const server = http.createServer((req, res) => router(req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    async function request(path, session, { method = 'GET', body, csrf = session?.csrfToken } = {}) {
      const url = `http://127.0.0.1:${server.address().port}/v1/platform/people${path}`;
      const headers = {};
      if (session) headers.cookie = `tributo_session=${session.token}`;
      if (body) headers['content-type'] = 'application/json';
      if (csrf) headers['x-csrf-token'] = csrf;
      const response = await fetch(url, { method, headers, body: body && JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    }
    assert.equal((await request('/goals')).status, 401);
    const goal = { title: 'Aprender sobre indicadores', progress: 30, ownerId: admin._id };
    assert.equal((await request('/goals', personSession, { method: 'POST', body: goal, csrf: '' })).data.error, 'CSRF');
    assert.equal((await request('/goals', personSession, { method: 'POST', body: goal })).status, 201);
    assert.deepEqual(calls[0], [person._id, { title: goal.title, progress: 30 }]);
    assert.deepEqual((await request('/goals', adminSession)).data.items, []);
    assert.deepEqual((await request('/goals', personSession)).data.items, [{ id: goalId }]);
    const privatePath = `/goals/${goalId}`;
    assert.equal((await request(privatePath, adminSession, { method: 'PATCH', body: { progress: 100 } })).status, 404);
    assert.equal((await request(privatePath, adminSession, { method: 'DELETE' })).status, 404);
    assert.deepEqual((await request(privatePath, personSession, { method: 'DELETE' })).data, { removed: true });
    const survey = { title: 'Pesquisa da equipe', question: 'Como foi a semana?' };
    assert.equal((await request('/surveys', personSession, { method: 'POST', body: survey })).status, 403);
    assert.equal((await request('/surveys', adminSession, { method: 'POST', body: survey })).status, 201);
    assert.equal((await request('/surveys', personSession)).data.minResponses, 3);
    const path = `/surveys/${surveyId}`;
    assert.equal((await request(`${path}/response`, personSession, { method: 'PUT', body: { rating: 4 } })).data.item.myRating, 4);
    assert.equal((await request(path, personSession, { method: 'PATCH', body: { status: 'closed' } })).status, 403);
    assert.equal((await request(path, adminSession, { method: 'PATCH', body: { status: 'open' } })).status, 400);
    assert.equal((await request(path, adminSession, { method: 'PATCH', body: { status: 'closed' } })).data.item.status, 'closed');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
