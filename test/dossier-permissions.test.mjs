import assert from 'node:assert/strict';
import test from 'node:test';
import { canPerform, capabilitiesFor } from '../src/platform/policy.mjs';

test('Dossiê fica restrito ao Sucesso do Cliente e o SMTP ao gerenciamento da Tecnologia', () => {
  const dossierActions = ['dossierRead', 'dossierCreate', 'dossierLink', 'dossierFees'];
  const member = (moduleGrants) => ({ role: 'member', active: true, moduleGrants });
  const viewer = member({ 'sucesso-do-cliente': 'view', tecnologia: 'edit' });
  assert.equal(canPerform(viewer, 'sucesso-do-cliente', 'dossierRead'), true);
  assert.equal(canPerform(viewer, 'sucesso-do-cliente', 'dossierCreate'), false);
  assert.equal(canPerform(viewer, 'tecnologia', 'smtpManage'), false);
  const editor = member({ 'sucesso-do-cliente': 'edit', tecnologia: 'manage' });
  const capabilities = capabilitiesFor(editor);
  for (const action of dossierActions) {
    assert.equal(capabilities['sucesso-do-cliente'][action], true);
    assert.equal(canPerform(editor, 'tecnologia', action), false);
  }
  assert.equal(capabilities.tecnologia.smtpManage, true);
  const blocked = member({ 'sucesso-do-cliente': { level: 'manage', blockedActions: ['dossierRead'] },
    tecnologia: { level: 'manage', blockedActions: ['smtpManage'] } });
  for (const action of dossierActions) assert.equal(canPerform(blocked, 'sucesso-do-cliente', action), false);
  assert.equal(canPerform(blocked, 'tecnologia', 'smtpManage'), false);
});
