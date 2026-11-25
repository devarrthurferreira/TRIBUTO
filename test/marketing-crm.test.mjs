import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketingCrmRouter } from '../src/marketing/crm-routes.mjs';
import { campaignFields, campaignReport, subscriberFields } from '../src/marketing/crm-rules.mjs';
import { automationFields, campaignGrowth, landingFields, segmentFields } from '../src/marketing/crm-growth-fields.mjs';

test('CRM exige consentimento registrado, mantém descadastros e normaliza o e-mail', () => {
  const input = { name: ' Pessoa ', email: ' MAIL@Example.COM ', status: 'subscribed', source: ' Formulário ' };
  const person = subscriberFields(input);
  assert.deepEqual(person, { name: 'Pessoa', source: 'Formulário', status: 'subscribed', email: 'mail@example.com' });
  assert.throws(() => subscriberFields({ ...input, source: '' }), { status: 400 });
  assert.throws(() => subscriberFields({ email: 'lead@example.com\nBcc: user@test.example' }), { status: 400 });
  assert.throws(() => subscriberFields({ email: 'other@example.com' }, person), { status: 400 });
  const suppressed = subscriberFields({ status: 'unsubscribed' }, person);
  assert.throws(() => subscriberFields({ status: 'pending' }, suppressed), { status: 400 });
  assert.throws(() => subscriberFields({ status: 'subscribed' }, suppressed), { status: 400 });
  assert.equal(subscriberFields({ name: 'Novo nome' }, person).source, 'Formulário');
});

test('CRM registra apenas métricas válidas e distingue zero de medição indisponível', () => {
  const campaign = { audienceCount: 20, sentAt: null };
  assert.throws(() => campaignFields({ name: 'Campanha', subject: 'Um\nOutro' }), { status: 400 });
  assert.throws(() => campaignReport({ sentCount: 21 }, campaign), { status: 400 });
  assert.throws(() => campaignReport({ sentCount: 20, deliveredCount: 19, openCount: 20 }, campaign), { status: 400 });
  assert.throws(() => campaignReport({ sentCount: 20, sentAt: '2025-02-30T17:00:00Z' }, campaign), { status: 400 });
  assert.deepEqual(campaignReport({ sentCount: 20, deliveredCount: 19, openCount: 0 }, campaign), {
    sentCount: 20, deliveredCount: 19, openCount: 0, clickCount: null, sentAt: null
  });
  assert.equal(campaignReport({ sentCount: 3, sentAt: '2025-02-03T17:00:00Z' }, campaign).sentAt.toISOString(),
    '2025-02-03T17:00:00.000Z');
});

test('CRM usa permissões próprias e protege as operações de contatos e exportação', async () => {
  const store = {
    list: async () => ({ subscribers: [], campaigns: [] }),
    createSubscriber: async (input, actorId) => ({ input, actorId }),
    audience: async () => ({ recipients: [{ email: 'lead@example.com' }] })
  };
  const router = createMarketingCrmRouter(store);
  const member = { _id: 'user-id', active: true, role: 'member' };
  const readOnly = { ...member, moduleGrants: { marketing: { level: 'edit', blockedActions: ['marketingCrmManage'] } } };
  const editor = { ...member, moduleGrants: { marketing: 'edit' } };
  const taskEditor = { ...member, moduleGrants: { marketing: { level: 'edit', blockedActions: ['marketingCrmRead'] } } };
  const campaignRoute = '/campaigns/00000000-0000-4000-8000-000000000000/audience';
  const data = { email: 'lead@example.com' };
  const request = (user, method = 'GET', path = '') => router.handleHttp({
    req: { method }, res: {}, route: '/marketing/crm' + path, user,
    send: (_, status, result) => ({ status, result }), readBody: async () => data
  });
  assert.equal((await request(readOnly)).status, 200);
  await assert.rejects(request(taskEditor), { status: 403 });
  await assert.rejects(request({ ...member, moduleGrants: { marketing: 'view' } }), { status: 403 });
  await assert.rejects(request(readOnly, 'POST', '/subscribers'), { status: 403 });
  await assert.rejects(request(readOnly, 'POST', campaignRoute), { status: 403 });
  await assert.rejects(request(editor, 'GET', campaignRoute), { status: 404 });
  assert.equal((await request(editor, 'POST', campaignRoute)).result.recipients[0].email, data.email);
  assert.deepEqual(await request(editor, 'POST', '/subscribers'), { status: 201, result: { input: data, actorId: member._id } });
});

test('CRM valida segmentos, páginas de captura e a ordem dos e-mails de automação', () => {
  const landingId = '00000000-0000-4000-8000-000000000000';
  assert.deepEqual(segmentFields({ name: 'Interesses', tags: [' Cursos ', 'CURSOS', 'Saúde'] }).tags, ['cursos', 'saúde']);
  assert.throws(() => segmentFields({ name: 'Interesses', tags: [] }), { status: 400 });
  assert.equal(landingFields({ title: 'Um lançamento', slug: 'Curso-Fiscal' }).slug, 'curso-fiscal');
  assert.equal(landingFields({ title: 'Descadastro', slug: 'saiba-mais', kind: 'unsubscribe' }).buttonText, 'Confirmar descadastro');
  assert.throws(() => landingFields({ title: 'Outro', slug: '../campanha' }), { status: 400 });
  assert.throws(() => landingFields({ title: 'Retorno', slug: 'saiba-mais', kind: 'redirect' }), { status: 400 });
  const flow = { name: 'Boas-vindas', landingId, status: 'active', steps: [
    { delayDays: 0, subject: 'Primeiro contato', content: 'Olá' },
    { delayDays: 3, subject: 'Conteúdo', content: 'Detalhes' },
  ] };
  assert.deepEqual(automationFields(flow).steps.map(step => step.delayDays), [0, 3]);
  assert.throws(() => automationFields({ ...flow, steps: [{ ...flow.steps[0], delayDays: -1 }] }), { status: 400 });
  assert.throws(() => automationFields({ ...flow, steps: [{ ...flow.steps[0], subject: 'Olá\nNovo assunto' }] }), { status: 400 });
  assert.deepEqual(campaignGrowth({ type: 'newsletter', landingId }), { type: 'newsletter', segmentId: null, landingId, unsubscribePageId: null });
  assert.equal(campaignGrowth({}, { unsubscribePageId: landingId }).unsubscribePageId, landingId);
  assert.equal(campaignGrowth({ unsubscribePageId: '' }, { unsubscribePageId: landingId }).unsubscribePageId, null);
  assert.throws(() => campaignGrowth({ type: 'outro' }), { status: 400 });
});

test('CRM limita publicação, automação e fila de e-mail a perfis gestores', async () => {
  const recordId = '00000000-0000-4000-8000-000000000001';
  const manager = { _id: 'manager', active: true, role: 'member', moduleGrants: { marketing: 'edit' } };
  const reader = { ...manager, moduleGrants: { marketing: { level: 'edit', blockedActions: ['marketingCrmManage'] } } };
  const calls = [];
  const router = createMarketingCrmRouter({
    putGrowthRecord: async (...args) => { calls.push(args); return { id: recordId }; },
    queueCampaign: async (...args) => { calls.push(args); return { id: recordId, status: 'queued' }; },
  });
  const fields = { status: 'published' };
  const request = (user, method, path) => router.handleHttp({ req: { method }, res: {}, route: `/marketing/crm${path}`, user,
    send: (_, status, result) => ({ status, result }), readBody: async () => fields });
  await assert.rejects(request(reader, 'PATCH', `/landings/${recordId}`), { status: 403 });
  await assert.rejects(request(reader, 'POST', `/campaigns/${recordId}/queue`), { status: 403 });
  assert.equal((await request(manager, 'POST', '/segments')).status, 201);
  assert.equal((await request(manager, 'PATCH', `/landings/${recordId}`)).status, 200);
  assert.equal((await request(manager, 'POST', `/campaigns/${recordId}/queue`)).result.status, 'queued');
  assert.deepEqual(calls, [['segments', undefined, fields, manager._id], ['landings', recordId, fields, manager._id], [recordId, manager._id]]);
});
