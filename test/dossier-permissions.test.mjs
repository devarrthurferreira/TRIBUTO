import assert from 'node:assert/strict';
import test from 'node:test';
import { canPerform, canPerformDossier, capabilitiesFor } from '../src/platform/policy.mjs';

const dossierActions = ['dossierRead', 'dossierCreate', 'dossierLink', 'dossierFees'];
const member = moduleGrants => ({ role: 'member', active: true, moduleGrants });

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
  for (const action of dossierActions) {
    assert.equal(canPerform(techManager, 'tecnologia', action), false);
    assert.equal(canPerformDossier(techManager, action), false);
  }
  assert.equal(canPerform(techManager, 'tecnologia', 'smtpManage'), true);
  assert.equal(canPerform(member({ tecnologia: 'edit' }), 'tecnologia', 'smtpManage'), false);
  assert.equal(canPerform(member({ diretoria: 'manage' }), 'diretoria', 'smtpManage'), false);
  const blocked = member({ tecnologia: { level: 'manage', blockedActions: ['smtpManage'] } });
  assert.equal(canPerform(blocked, 'tecnologia', 'smtpManage'), false);
});
