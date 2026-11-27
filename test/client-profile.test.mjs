import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientFields } from '../src/clients/profile-fields.mjs';
import { validNumericCnpj } from '../src/platform/brazilian-documents.mjs';

const request = {
  type: 'pj', document: '12.ABC.345/01de-35', nickname: 'Cliente', state: 'mg',
  contacts: [{ name: 'Ana', email: 'Ana@example.test' }, { name: 'Lia', phone: '(32) 98765-4321' }],
  cnae: '69.20-6/01', taxRegime: 'simples-nacional',
  stateRegistrations: [{ number: '12.345.678-9', state: 'SP' }, { number: '12.345.678-9', state: 'MG' }],
  municipalRegistrations: [{ number: '08-1527', municipality: 'Juiz de Fora' }],
  modules: ['fiscal', 'contabil'], invoiceSchedule: { period: 'day', time: '07:30' },
  serviceInvoiceSchedule: { period: 'night' },
};

test('valida cliente PJ numérico e alfanumérico com cadastros e horários próprios', () => {
  const client = clientFields(request);
  assert.equal(client.document, '12ABC34501DE35');
  assert.equal(client.state, 'MG');
  assert.equal(client.cnae, '6920601');
  assert.deepEqual(client.invoiceSchedule, { period: 'day', time: '07:30' });
  assert.deepEqual(client.serviceInvoiceSchedule, { period: 'night', time: '22:00' });
  assert.deepEqual(client.contacts, [
    { name: 'Ana', email: 'ana@example.test', phone: null, role: null },
    { name: 'Lia', email: null, phone: '32987654321', role: null },
  ]);
  assert.equal(client.stateRegistrations.length, 2);
  assert.equal(client.municipalRegistrations[0].municipality, 'Juiz de Fora');
  assert.equal(validNumericCnpj(client.document), false);
  assert.equal(clientFields({ ...request, document: '11.222.333/0001-81' }).document, '11222333000181');
  assert.throws(() => clientFields({ ...request, document: '12.ABC.345/01DE-34' }), /CNPJ válido/);
});

test('valida CPF, contato e os limites do cadastro e preserva campos omitidos em alterações', () => {
  const person = { ...request, type: 'pf', document: '529.982.247-25', legalName: 'Ana Gomes', tradeName: 'Ignorado' };
  const client = clientFields(person);
  assert.equal(client.document, '52998224725');
  assert.equal(client.tradeName, null);
  assert.throws(() => clientFields({ ...person, document: '111.111.111-11' }), /CPF válido/);
  assert.throws(() => clientFields({ ...person, legalName: '' }), /Nome completo/);
  assert.throws(() => clientFields({ ...person, contacts: [] }), /1 a 3 contatos/);
  assert.throws(() => clientFields({ ...person, contacts: Array(4).fill(request.contacts[0]) }), /1 a 3 contatos/);
  assert.throws(() => clientFields({ ...person, contacts: [{ name: 'Ana' }] }), /telefone ou um e-mail/);
  assert.throws(() => clientFields({ ...person, stateRegistrations: [...request.stateRegistrations, { number: '123456789', state: 'SP' }] }), /duplicados/);
  assert.throws(() => clientFields({ ...person, invoiceSchedule: { period: 'day', time: '23:00' } }), /período selecionado/);
  assert.deepEqual(clientFields({ active: false }, { partial: true }), { active: false });
});

test('CAEPF mantém chave própria e não se confunde com login por CNPJ', async () => {
  const { normalizeClientUsername } = await import('../src/clients/access-routes.mjs');
  const { document, type } = clientFields({ ...request, type: 'caepf', document: '11222333000193', legalName: 'Titular' });
  assert.equal(type, 'caepf');
  assert.equal(document, '112.223.330/001-93');
  assert.equal(clientFields({ ...request, type, document, legalName: 'Titular' }).document, document);
  assert.equal(normalizeClientUsername(document), document);
  assert.notEqual(normalizeClientUsername('11222333000193'), document);
  assert.equal(validNumericCnpj(document), false);
  assert.throws(() => clientFields({ ...request, type, document: '11222333000181', legalName: 'Titular' }), /CAEPF válido/);
});

test('o cadastro conserva a identificação, o endereço, os dados fiscais e os contatos da empresa', () => {
  const additions = {
    groupName: 'Grupo de teste', street: 'Rua de teste', streetNumber: 'S/N', complement: 'Sala 2',
    district: 'Centro', postalCode: '36000-000', city: 'Juiz de Fora', nire: '12345678901',
    phones: ['(32) 3333-4444', '+55 32 99999-8888'], website: 'https://example.test', registrationExempt: false,
  };
  const profile = clientFields({...request, taxRegime: 'simples-nacional-regular', ...additions});
  assert.equal(profile.postalCode, '36000000');
  assert.equal(profile.state, 'MG');
  assert.equal(profile.taxRegime, 'simples-nacional-regular');
  assert.equal(profile.registrationExempt, false);
  assert.deepEqual(profile.phones, ['3233334444','+5532999998888']);
  assert.deepEqual(clientFields(profile), profile);
  assert.deepEqual(clientFields({ registrationExempt: null }, { partial: true }), { registrationExempt: null });
  assert.throws(() => clientFields({...request, postalCode: '360A0000'}), /CEP/);
  assert.throws(() => clientFields({...request, website: 'javascript:alert(1)'}), /HTTP/);
});
