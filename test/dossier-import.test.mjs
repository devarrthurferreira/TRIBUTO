import assert from 'node:assert/strict';
import test from 'node:test';
import { createDossierRouter } from '../src/dossiers/routes.mjs';

const admin = { active: true, role: 'admin' };
const director = { active: true, role: 'member', moduleGrants: { diretoria: 'manage' } };
const sample = {
  protocolo: 'DOS-20251120145522-TEST1',
  createdAt: '2025-11-20T14:55:22Z',
  dossier: {
    empresa: { nome: 'Empresa fictícia', regimeTributario: 'Lucro Real', cnpj: '12.ABC.345/01DE-35', cidade: 'Colombo', estado: 'PR' },
    grupo: 'Grupo fictício', origem: 'Indicação', dataInicio: '2026-01-01',
    honorarios: { valorMensal: '100.00' },
  },
};

function post({ user = admin, body = { items: [sample] }, importHistorical, readBody } = {}) {
  const router = createDossierRouter({ importHistorical });
  return router.handleHttp({
    req: { method: 'POST' }, route: '/dossiers/import', user,
    readBody: readBody || (async (_req, limit) => {
      assert.equal(limit, 700_000);
      return body;
    }),
    send: (_res, status, response) => ({ status, ...response }),
  });
}

test('somente o administrador ativo pode importar dossiês e a permissão é checada antes do corpo', async () => {
  for (const user of [director, { ...admin, active: false }]) {
    await assert.rejects(post({ user, readBody: () => assert.fail('Leitura indevida do corpo') }),
      { status: 403, code: 'DOSSIER_FORBIDDEN' });
  }
});

test('importação usa dados normalizados e responde com os protocolos sem honorários', async () => {
  for (const imported of [true, false]) {
    const result = await post({ importHistorical: async (user, items) => {
      assert.equal(user, admin);
      assert.equal(items.length, 1);
      const [{ protocolo, createdAt, dossier }] = items;
      assert.equal(protocolo, sample.protocolo);
      assert.equal(createdAt, '2025-11-20T14:55:22.000Z');
      assert.equal(dossier.empresa.cnpj, '12ABC34501DE35');
      assert.equal(dossier.honorarios, undefined);
      return [{ id: 'fake-uuid', protocolo, createdAt, imported }];
    } });
    assert.equal(result.status, imported ? 201 : 200);
    assert.deepEqual(result.items, [{ id: 'fake-uuid', protocolo: sample.protocolo, createdAt: '2025-11-20T14:55:22.000Z', imported }]);
  }
});

test('importação recusa lotes repetidos e valida calendário e data original do protocolo antes de gravar', async () => {
  for (const body of [
    { items: [sample, sample] },
    { items: [{ ...sample, createdAt: '2025-11-20T14:55:21Z' }] },
    { items: [{ ...sample, protocolo: 'DOS-20250231145522-TEST1', createdAt: '2025-02-31T14:55:22Z' }] },
    { items: [{ ...sample, createdAt: '2025-11-20T11:55:22-03:00' }] },
    { items: [{ ...sample, createdAt: null }] },
    { items: [{ ...sample, protocolo: 'DOS-20251120145522-invalid' }] },
    { items: [{ ...sample, honorarios: {} }] },
    { items: [] },
  ]) {
    await assert.rejects(post({ body, importHistorical: () => assert.fail('Lote inválido chegou ao banco') }),
      { status: 400, code: 'DOSSIER_IMPORT_INVALID' });
  }
});
