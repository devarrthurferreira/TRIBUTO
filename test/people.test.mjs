import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { sha256 } from '../src/api/validation.mjs';
import { goalDetails, goalFields, meetingFields, noteFields, planFields, surveyFields, surveyRating } from '../src/people/fields.mjs';
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
  assert.equal(surveyFields({ title: 'Pesquisa', question: 'Como está o clima?' }).kind, 'engagement');
  assert.throws(() => surveyFields({ title: 'Pesquisa', question: 'Como está o clima?', kind: 'other' }), { code: 'PEOPLE_INVALID_INPUT' });
  assert.throws(() => planFields({ title: 'PDI', status: 'completed' }), { code: 'PEOPLE_INVALID_INPUT' });
  assert.throws(() => meetingFields({ title: '1:1', participantId: randomUUID(), date: '2027-02-29', time: '10:00' }), { code: 'PEOPLE_INVALID_INPUT' });
});

test('Feedback valida anonimato explícito e notas inteiras para os oito itens da empresa', () => {
  const feedback = { recipientId: randomUUID(), text: 'Colaboração' };
  const ratings = {
    culture: 1, customer: 2, teamwork: 3, communication: 4, commitment: 5, engagement: 1, leadership: 2, active_listening: 3,
  };
  assert.deepEqual(noteFields({ ...feedback, description: ' Na reunião ', anonymous: true, ratings }),
    { ...feedback, description: 'Na reunião', anonymous: true, ratings });
  assert.deepEqual(noteFields(feedback), { ...feedback, description: '', anonymous: false, ratings: {} });
  for (const changes of [
    { anonymous: 'true' }, { ratings: [] }, { ratings: null }, { ratings: { unsupported: 1 } },
    { ratings: { culture: '5' } }, { ratings: { culture: 1.5 } }, { ratings: { culture: 0 } }, { ratings: { culture: 6 } },
  ]) {
    assert.throws(() => noteFields({ ...feedback, ...changes }), { code: 'PEOPLE_INVALID_INPUT' });
  }
});

test('Pessoas usa a sessão e o CSRF da Central, preserva o titular e protege a publicação de pesquisas', async () => {
  const [person, admin, rh, rhViewer] = [
    { role: 'member' }, { role: 'admin' }, { role: 'member', moduleGrants: { rh: 'edit' } },
    { role: 'member', moduleGrants: { rh: 'view' } },
  ].map(user => ({ ...user, _id: randomUUID(), active: true }));
  const sessions = [person, admin, rh, rhViewer].map((user, index) => ({ user, userId: user._id, token: String(index + 1).repeat(64), csrfToken: `test-${index}` }));
  const [personSession, adminSession, rhSession, rhViewerSession] = sessions;
  const goalId = randomUUID();
  const reviewId = randomUUID();
  const surveyId = randomUUID();
  const reviewAssignment = { id: reviewId, status: 'pending', response: null };
  let pending = true;
  const calls = [];
  const people = createPeopleRouter({
    async listGoals(owner) { return owner === person._id ? [{ id: goalId }] : []; },
    async createGoal(owner, fields) { calls.push([owner, fields]); return { id: goalId, ...fields }; },
    async updateGoal(owner, id, fields) { return owner === person._id && id === goalId ? { id, ...fields } : null; },
    async removeGoal(owner, id) { return owner === person._id && id === goalId; },
    async listGoalCheckIns(owner, id) { return owner === person._id && id === goalId ? [] : null; },
    async checkInGoal(owner, id, fields) {
      return owner === person._id && id === goalId ? { item: { id, progress: fields.progress }, checkIn: fields } : null;
    },
    async listNotes(kind, owner, all) { return [{ kind, owner, all }]; },
    async createNote(kind, owner, fields) { return { kind, owner, ...fields }; },
    async listAvailableReviews(owner) { return owner === person._id && pending ? [reviewAssignment] : []; },
    async respondToReview(owner, id, fields) {
      if (owner !== person._id || id !== reviewId || !pending) return null;
      pending = false;
      return { id, status: 'responded', response: fields };
    },
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
    assert.equal((await request(`${privatePath}/check-in`, adminSession)).status, 404);
    assert.equal((await request(`${privatePath}/check-in`, personSession, { method: 'POST', body: { progress: 120 } })).status, 400);
    assert.deepEqual((await request(`${privatePath}/check-in`, personSession, { method: 'POST', body: { progress: 80, notes: ' Etapa 2 ' } })).data,
      { item: { id: goalId, progress: 80 }, checkIn: { progress: 80, notes: 'Etapa 2' } });
    assert.deepEqual((await request(privatePath, personSession, { method: 'DELETE' })).data, { removed: true });
    const feedback = { recipientId: rh._id.toUpperCase(), text: ' Excelente parceria ' };
    assert.equal((await request('/feedback', personSession, { method: 'POST', body: feedback, csrf: '' })).status, 403);
    assert.deepEqual((await request('/feedback', personSession, { method: 'POST', body: feedback })).data.item,
      { kind: 'feedback', owner: person._id, recipientId: rh._id, text: 'Excelente parceria', description: '', anonymous: false, ratings: {} });
    assert.deepEqual((await request('/feedback?scope=all', adminSession)).data.items, [{ kind: 'feedback', owner: admin._id, all: false }]);
    const review = { recipientId: person._id, title: 'Desenvolvimento', text: 'Próximos passos' };
    for (const session of [personSession, rhViewerSession]) {
      assert.equal((await request('/reviews?scope=all', session)).status, 403);
      assert.equal((await request('/reviews', session, { method: 'POST', body: review })).status, 403);
    }
    assert.equal((await request('/reviews', rhSession, { method: 'POST', body: review })).status, 201);
    assert.deepEqual((await request('/reviews?scope=all', rhSession)).data.items, [{ kind: 'review', owner: rh._id, all: true }]);
    assert.deepEqual((await request('/reviews', personSession)).data.items, [{ kind: 'review', owner: person._id, all: false }]);
    const available = '/reviews/available';
    const reviewResponse = `/reviews/${reviewId.toUpperCase()}/response`;
    assert.equal((await request(available)).status, 401);
    assert.deepEqual((await request(available, personSession)).data.items, [reviewAssignment]);
    assert.deepEqual((await request(`${available}?scope=all`, adminSession)).data.items, []);
    assert.deepEqual((await request(available, rhSession)).data.items, []);
    assert.equal((await request(reviewResponse, rhSession, { method: 'POST', body: { text: 'Resposta de outra pessoa' } })).status, 404);
    assert.equal((await request(reviewResponse, personSession, { method: 'POST', body: { text: '' } })).status, 400);
    assert.equal((await request(reviewResponse, personSession, { method: 'POST', body: { text: ' Pronto ' }, csrf: '' })).status, 403);
    assert.deepEqual((await request(reviewResponse, personSession, { method: 'POST', body: { text: ' Pronto ' } })).data.item,
      { id: reviewId, status: 'responded', response: { text: 'Pronto' } });
    assert.deepEqual((await request(available, personSession)).data.items, []);
    const survey = { title: 'Pesquisa da equipe', question: 'Como foi a semana?' };
    assert.equal((await request('/surveys', personSession, { method: 'POST', body: survey })).status, 403);
    assert.equal((await request('/surveys', adminSession, { method: 'POST', body: survey })).status, 201);
    assert.equal((await request('/surveys', adminSession, { method: 'POST', body: { ...survey, kind: 'super_survey' } })).data.item.kind, 'super_survey');
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
