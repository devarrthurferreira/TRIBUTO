import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { ApiError, sha256 } from '../src/api/validation.mjs';
import { exportCrmContacts, importCrmContacts } from '../src/marketing/crm-contacts-csv.mjs';
import { createMarketingCrmRouter } from '../src/marketing/crm-routes.mjs';
import { createPlatformRouter } from '../src/platform/routes.mjs';

function subscribers(existing = []) {
  const contacts = new Map(existing.map(contact => [contact.email, contact]));
  const actors = [];
  return {
    contacts,
    actors,
    async createSubscriber(contact, actorId) {
      if (contacts.has(contact.email)) throw new ApiError(409, 'CRM_STATE_CONFLICT', 'Já existe um contato com esse e-mail.');
      contacts.set(contact.email, contact);
      actors.push(actorId);
    },
  };
}

test('imports CRM CSV aliases, quoted multiline cells, normalized tags and documented consent', async () => {
  const store = subscribers();
  const csv = '\ufeffE-mail;Nome completo;Interesses;Situação;Origem do consentimento\r\n'
    + '  PRIMEIRO@example.test ;"Joana; ""Jô""";"Eventos, Boletim|Eventos";inscrito;"Evento Maximum\r\nFormulário confirmado"\r\n'
    + 'segundo@example.test;Luís;;inscrito;\r\n'
    + 'terceiro@example.test';
  assert.deepEqual(await importCrmContacts(store, csv, 'admin-qa'), { imported: 3, duplicates: 0, invalid: 0, total: 3, errors: [] });
  assert.deepEqual(store.contacts.get('primeiro@example.test'), {
    email: 'primeiro@example.test', name: 'Joana; "Jô"', status: 'subscribed', source: 'Evento Maximum\nFormulário confirmado', tags: ['eventos', 'boletim'],
  });
  assert.equal(store.contacts.get('segundo@example.test').status, 'pending');
  assert.equal(store.contacts.get('terceiro@example.test').status, 'pending');
  assert.deepEqual(store.actors, ['admin-qa', 'admin-qa', 'admin-qa']);
});

test('rejects duplicate imports without editing or reactivating existing contacts', async () => {
  const optedOut = { email: 'original@example.test', status: 'unsubscribed', name: 'Nome original' };
  const store = subscribers([optedOut]);
  const csv = 'email,nome,status,origem\nINVALIDO,Nome\nORIGINAL@example.test,Outro nome,inscrito,Confirmação\n'
    + 'contato@example.test,Nome,pendente,Indicação\nCONTATO@example.test,Outro,inscrito,Evento\n';
  const result = await importCrmContacts(store, csv, 'actor');
  assert.deepEqual(result, { imported: 1, duplicates: 2, invalid: 1, total: 4,
    errors: [{ row: 2, message: 'Informe um endereço de e-mail válido.' }] });
  assert.equal(store.contacts.get(optedOut.email), optedOut);
  assert.equal(store.contacts.get('contato@example.test').status, 'pending');
});

test('accepts a sparse line-by-line email list and rejects malformed, binary or oversized CSV before edits', async () => {
  const store = subscribers();
  assert.equal((await importCrmContacts(store, 'um@example.test\ndois@example.test', 'actor')).imported, 2);
  await assert.rejects(importCrmContacts(store, 'email,nome\ntres@example.test,"sem fechar', 'actor'), /Feche as aspas da linha 2/);
  await assert.rejects(importCrmContacts(store, 'email\ntres@example.test\x00', 'actor'), /CSV UTF-8/);
  await assert.rejects(importCrmContacts(store, `email\n${'x'.repeat(96_000)}`, 'actor'), /até 96 KB/);
  const largeBatch = Array.from({ length: 501 }, (_, index) => `admin${index}@example.test`).join('\n');
  await assert.rejects(importCrmContacts(store, `email\n${largeBatch}`, 'actor'), /até 500 contatos/);
  assert.equal(store.contacts.size, 2);
});

test('exports one spreadsheet-safe CSV row per address, including suppression status and interests', async () => {
  const first = { id: 'a', email: 'um@example.test', name: ' =2+3', status: 'unsubscribed', source: '+campanha' };
  const records = [{ ...first, tag: 'eventos' }, { ...first, tag: 'novidades' },
    { id: 'b', email: 'dois@example.test', name: 'Mário "Jr"', status: 'pending', source: '', tag: null }];
  const store = { platformStore: { rows: async () => records } };
  const { csv, count } = await exportCrmContacts(store);
  assert.equal(count, 2);
  assert.ok(csv.startsWith('\ufeffemail;nome;interesses;status;origem\r\n'));
  assert.ok(csv.includes(`"um@example.test";"' =2+3";"eventos|novidades";"descadastrado";"'+campanha"`));
  assert.ok(csv.includes('"dois@example.test";"Mário ""Jr""";"";"pendente";""'));
  assert.equal((await exportCrmContacts({ platformStore: { rows: async () => [] } })).count, 0);
});

test('CRM CSV routes retain session, manager and CSRF enforcement with a scoped JSON size limit', async () => {
  const managerToken = 'a'.repeat(64);
  const readerToken = 'b'.repeat(64);
  const csrfToken = 'crm-csv-fixture';
  const managerId = 'editor';
  const readerId = 'reader';
  const platform = {
    async findSession(hash) {
      if (hash === sha256(managerToken)) return { userId: managerId, csrfToken };
      if (hash === sha256(readerToken)) return { userId: readerId, csrfToken };
      return null;
    },
    async findUserById(id) {
      return { _id: id, active: true, role: 'member', moduleGrants: {
        marketing: id === managerId ? 'edit' : { level: 'edit', blockedActions: ['marketingCrmManage'] },
      } };
    },
    async rows() { return []; },
  };
  const store = { ...subscribers(), platformStore: platform };
  const router = createPlatformRouter({ store: platform, crm: createMarketingCrmRouter(store) });
  const server = http.createServer((req, res) => router(req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/v1/platform/marketing/crm`;
  function post(path, token, csrf, value = {}) {
    return fetch(`${base}${path}`, { method: 'POST', headers: {
      'Content-Type': 'application/json', ...(token && { Cookie: `tributo_session=${token}` }), ...(csrf && { 'X-CSRF-Token': csrf }),
    }, body: JSON.stringify(value) });
  }
  try {
    assert.equal((await post('/contacts/export')).status, 401);
    assert.equal((await post('/contacts/export', managerToken)).status, 403);
    assert.equal((await post('/contacts/export', readerToken, csrfToken)).status, 403);
    assert.equal((await post('/contacts/import', readerToken, csrfToken)).status, 403);
    const csv = `email,nome\n${Array.from({ length: 350 }, (_, index) => `qa-${index}@example.test,"${'"'.repeat(200)}"`).join('\n')}`;
    assert.ok(Buffer.byteLength(csv) < 96_000);
    assert.ok(Buffer.byteLength(JSON.stringify({ csv })) > 128_000);
    assert.equal((await post('/subscribers', managerToken, csrfToken, { csv })).status, 413);
    const imported = await post('/contacts/import', managerToken, csrfToken, { csv });
    assert.equal(imported.status, 200);
    assert.equal((await imported.json()).imported, 350);
    assert.equal((await post('/contacts/export', managerToken, csrfToken)).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
