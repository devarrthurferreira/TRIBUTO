import assert from 'node:assert/strict';
import test from 'node:test';
import { createDossierRouter } from '../src/dossiers/routes.mjs';
import { createDossierStore } from '../src/dossiers/store.mjs';
import { canPerform, canPerformDossier, capabilitiesFor } from '../src/platform/policy.mjs';

const dossierActions = ['dossierRead', 'dossierCreate', 'dossierLink'];
const feeActions = ['dossierFeesRead', 'dossierFees'];
const companyCnpj = '11222333000181';
const member = moduleGrants => ({ role: 'member', active: true, moduleGrants, companyCnpjs: [companyCnpj] });
const admin = { role: 'admin', active: true, moduleGrants: {} };

test('Sucesso do Cliente e Diretoria usam as mesmas permissões para os dossiês', () => {
  for (const module of ['sucesso-do-cliente', 'diretoria']) {
    const viewer = member({ [module]: 'view' });
    assert.equal(canPerformDossier(viewer, 'dossierRead'), true);
    assert.equal(canPerformDossier(viewer, 'dossierCreate'), false);

    const editor = member({ [module]: 'edit' });
    const capabilities = capabilitiesFor(editor);
    for (const action of dossierActions) {
      assert.equal(capabilities[module][action], true);
      assert.equal(canPerformDossier(editor, action), true);
    }

    const readBlocked = member({ [module]: { level: 'manage', blockedActions: ['dossierRead'] } });
    for (const action of dossierActions) assert.equal(canPerformDossier(readBlocked, action), false);
  }
});

test('Dossiê aplica os bloqueios dentro de cada módulo sem combinar permissões parciais', () => {
  const access = member({ diretoria: 'view', 'sucesso-do-cliente': { level: 'manage', blockedActions: ['dossierRead'] } });
  assert.equal(canPerformDossier(access, 'dossierRead'), true);
  for (const action of dossierActions.slice(1)) assert.equal(canPerformDossier(access, action), false);

  const financeBlocked = member({ 'sucesso-do-cliente': 'view', diretoria: { level: 'edit', blockedActions: ['dossierFees'] } });
  assert.equal(canPerformDossier(financeBlocked, 'dossierFees'), false);
  assert.equal(canPerformDossier(financeBlocked, 'dossierLink'), true);
  assert.equal(canPerformDossier(financeBlocked, 'workItemRead'), false);
  assert.equal(canPerformDossier({ ...financeBlocked, active: false }, 'dossierRead'), false);
});

test('Tecnologia mantém SMTP exclusivo para o gerenciamento e não recebe acesso a dossiês', () => {
  const techManager = member({ tecnologia: 'manage' });
  for (const action of [...dossierActions, ...feeActions]) {
    assert.equal(canPerform(techManager, 'tecnologia', action), false);
    assert.equal(canPerformDossier(techManager, action), false);
  }
  assert.equal(canPerform(techManager, 'tecnologia', 'smtpManage'), true);
  assert.equal(canPerform(member({ tecnologia: 'edit' }), 'tecnologia', 'smtpManage'), false);
  assert.equal(canPerform(member({ diretoria: 'manage' }), 'diretoria', 'smtpManage'), false);
  const blocked = member({ tecnologia: { level: 'manage', blockedActions: ['smtpManage'] } });
  assert.equal(canPerform(blocked, 'tecnologia', 'smtpManage'), false);
});

test('permissão explícita da Diretoria controla a leitura, edição e envio de honorários', () => {
  for (const user of [admin, member({ 'sucesso-do-cliente': 'manage' }), member({ tecnologia: 'manage' })]) {
    for (const action of feeActions) assert.equal(canPerformDossier(user, action), false);
  }
  for (const user of [member({ diretoria: 'view' }), { ...admin, moduleGrants: { diretoria: 'view' } }]) {
    assert.equal(canPerformDossier(user, 'dossierFeesRead'), true);
    assert.equal(canPerformDossier(user, 'dossierFees'), false);
  }
  for (const user of [member({ diretoria: 'edit' }), { ...admin, moduleGrants: { diretoria: 'manage' } }]) {
    const capabilities = capabilitiesFor(user);
    for (const action of feeActions) {
      assert.equal(canPerformDossier(user, action), true);
      assert.equal(capabilities.diretoria[action], true);
      assert.equal(Object.hasOwn(capabilities['sucesso-do-cliente'] || {}, action), false);
    }
  }
  for (const blockedAction of ['dossierRead', ...feeActions]) {
    const user = { ...admin, moduleGrants: { diretoria: { level: 'manage', blockedActions: [blockedAction] } } };
    for (const action of feeActions) assert.equal(canPerformDossier(user, action), false);
  }
});

test('API inclui honorários apenas na Diretoria e bloqueia gravação e envio sem permissão', async () => {
  const id = '2c4ea3c0-25bf-485d-a356-fca6abda5407';
  const path = '/dossiers/' + id;
  const editor = member({ diretoria: 'edit', 'sucesso-do-cliente': 'edit' });
  const viewer = member({ diretoria: 'view' });
  const support = member({ 'sucesso-do-cliente': 'edit' });
  const scopedFee = { feesStatus: 'saved', honorarios: { valorMensalCentavos: 200_00 } };
  const saved = [];
  const router = createDossierRouter({
    async list(_user, { includeFees }) { return { items: [{ id, ...(includeFees ? scopedFee : {}) }] }; },
    async read(_user, _id, { includeFees }) { return { id, ...(includeFees ? scopedFee : {}) }; },
    async saveFees() { saved.push('edit'); },
    async sendFees() { saved.push('send'); },
  });
  const invoke = (user, route, { method = 'GET', query = '', data } = {}) => router.handleHttp({
    req: { method, url: '/v1/platform' + route + query }, user, route,
    readBody: async () => data,
    send: (_res, status, body) => ({ status, body }),
  });

  for (const user of [support, admin]) {
    const { body } = await invoke(user, path, { query: '?sector=diretoria' });
    assert.deepEqual(body.dossier, { id });
  }
  for (const query of ['', '?sector=sucesso-do-cliente', '?sector=diretoria&sector=diretoria']) {
    assert.deepEqual((await invoke(editor, '/dossiers', { query })).body.items, [{ id }]);
    await assert.rejects(invoke(editor, path + '/fees', { query, method: 'PUT', data: { revision: 1 } }), { status: 403 });
  }
  const query = '?sector=diretoria';
  assert.deepEqual((await invoke(viewer, path, { query })).body.dossier, { id, ...scopedFee });
  const changes = { revision: 1, valorMensal: '200', vencimentoDia: 10 };
  for (const user of [admin, viewer, support]) {
    await assert.rejects(invoke(user, path + '/fees', { query, method: 'PUT', data: changes }), { status: 403 });
    await assert.rejects(invoke(user, path + '/fees/send', { query, method: 'POST', data: { revision: 1 } }), { status: 403 });
  }
  assert.equal(saved.length, 0);
  assert.equal((await invoke(editor, path + '/fees', { query, method: 'PUT', data: changes })).status, 200);
  assert.equal((await invoke(editor, path + '/fees/send', { query, method: 'POST', data: { revision: 1 } })).status, 202);
  assert.deepEqual(saved, ['edit', 'send']);
});

test('persistência omite inclusive o status de honorários e dispensa leituras financeiras para outros setores', async () => {
  const record = { id: 'dados-de-teste', company_cnpj: companyCnpj, fees_version: 2, dossier_json: '{}' };
  const stage = {
    pool: { execute: async query => query.includes('COUNT(*)') ? [[{ total: 1 }]] : [[record]] },
    transaction: () => assert.fail('Transação financeira indevida'),
  };
  const smtpStore = new Proxy({}, { get: () => assert.fail('Consulta financeira indevida') });
  const store = createDossierStore({ platformStore: stage, smtpStore });
  for (const user of [admin, member({ 'sucesso-do-cliente': 'manage' })]) {
    const list = await store.list(user, { includeFees: true });
    const detail = await store.read(user, record.id, { includeFees: true });
    for (const field of ['feesStatus', 'honorarios', 'feeHistory', 'feeRecipients']) {
      assert.equal(Object.hasOwn(list.items[0], field), false);
      assert.equal(Object.hasOwn(detail, field), false);
    }
    await assert.rejects(store.saveFees(user, record.id, 1, {}), { status: 403 });
    await assert.rejects(store.sendFees(user, record.id, 1), { status: 403 });
  }
});
