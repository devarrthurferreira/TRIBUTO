import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sha256 } from '../src/api/validation.mjs';
import { createClientAdminRouter } from '../src/clients/admin-routes.mjs';
import { ClientCertificateStore } from '../src/clients/certificates.mjs';
import { createPlatformRouter } from '../src/platform/routes.mjs';

const firstClient = 'fffeee00-78b3-4af5-aa12-fbcfa12fd3a4';
const anotherClient = 'dfffedc0-78b3-4af5-aa12-fbcfa12fd3a4';
const encryptionKey = '0123456789abcdef'.repeat(4);
const testPassword = 'senha fictícia A1 123';
const availableOpenSsl = spawnSync('openssl', ['version']).status === 0;

function testCertificate() {
  const directory = mkdtempSync(join(tmpdir(), 'tributo-a1-test-'));
  const cert = join(directory, 'cert.pem');
  const key = join(directory, 'key.pem');
  const pfx = join(directory, 'test.pfx');
  const certificateOnly = join(directory, 'certificate-only.pfx');
  try {
    const certificate = spawnSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
      '-subj', '/CN=Certificado ficticio para testes', '-keyout', key, '-out', cert
    ]);
    assert.equal(certificate.status, 0);
    const bundle = spawnSync('openssl', [
      'pkcs12', '-export', '-out', pfx, '-inkey', key, '-in', cert, '-passout', 'stdin'
    ], { input: `${testPassword}\n` });
    assert.equal(bundle.status, 0);
    const noKey = spawnSync('openssl', [
      'pkcs12', '-export', '-out', certificateOnly, '-nokeys', '-in', cert, '-passout', 'stdin'
    ], { input: `${testPassword}\n` });
    assert.equal(noKey.status, 0);
    return { pfx: readFileSync(pfx), certificateOnly: readFileSync(certificateOnly) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function decryptForTest(envelope, clientId) {
  const version = envelope[0];
  assert.equal(version, 1);
  const decrypt = createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), envelope.subarray(1, 13), { authTagLength: 16 });
  decrypt.setAAD(Buffer.from(`maximum-client-a1/v${version}:${clientId}`, 'ascii'));
  decrypt.setAuthTag(envelope.subarray(13, 29));
  return Buffer.concat([decrypt.update(envelope.subarray(29)), decrypt.final()]);
}

test('validates a real PKCS12 key and its password before sealing both for one client', { skip: !availableOpenSsl }, () => {
  const { pfx, certificateOnly } = testCertificate();
  const store = new ClientCertificateStore({}, { encryptionKey });
  const upload = { fileName: 'Cliente teste.p12', data: pfx.toString('base64'), password: testPassword };
  const prepared = store.prepare(upload, firstClient);
  assert.equal(prepared.fileName, upload.fileName);
  assert.ok(prepared.expiresAt > new Date());
  assert.ok(!prepared.encrypted.includes(pfx));
  assert.ok(!prepared.encrypted.includes(Buffer.from(testPassword)));
  assert.notDeepEqual(prepared.encrypted, store.prepare(upload, firstClient).encrypted);
  const plaintext = decryptForTest(prepared.encrypted, firstClient);
  const passwordLength = plaintext.readUInt16BE();
  assert.equal(plaintext.subarray(2, 2 + passwordLength).toString('utf8'), testPassword);
  assert.deepEqual(plaintext.subarray(2 + passwordLength), pfx);
  assert.throws(() => decryptForTest(prepared.encrypted, anotherClient));
  const tampered = Buffer.from(prepared.encrypted);
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => decryptForTest(tampered, firstClient));
  assert.throws(() => store.prepare({ ...upload, password: 'outra-senha' }, firstClient), { code: 'CLIENT_CERTIFICATE_INVALID' });
  assert.throws(() => store.prepare({ ...upload, data: certificateOnly.toString('base64') }, firstClient), { code: 'CLIENT_CERTIFICATE_INVALID' });
});

test('certificate preview needs admin and CSRF, reads just the validity dates, and rejects an expired key', { skip: !availableOpenSsl }, async t => {
  const { pfx } = testCertificate();
  const upload = { fileName: 'teste.pfx', data: pfx.toString('base64'), password: testPassword };
  const certificates = new ClientCertificateStore({}, { encryptionKey });
  const adminToken = '1'.repeat(64);
  const memberToken = '2'.repeat(64);
  const csrfToken = 'test-csrf-token';
  const sessions = new Map([
    [sha256(adminToken), { userId: 'admin', csrfToken }],
    [sha256(memberToken), { userId: 'member', csrfToken }],
  ]);
  const store = {
    async findSession(hash) { return sessions.get(hash); },
    async findUserById(role) { return { role, active: true }; },
  };
  const router = createPlatformRouter({ store, clientAdmin: createClientAdminRouter({ certificates }) });
  const server = createServer((req, res) => { void router(req, res, req.url); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/v1/platform/clients/certificate/verify`;
  const verify = (body, token, csrf) => fetch(url, {
    method: 'POST', body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(token && { cookie: 'tributo_session=' + token }),
      ...(csrf && { 'x-csrf-token': csrf }),
    },
  });
  assert.equal((await verify(upload)).status, 401);
  assert.equal((await verify(upload, memberToken, csrfToken)).status, 403);
  const missingCsrf = await verify(upload, adminToken);
  assert.equal(missingCsrf.status, 403);
  assert.equal((await missingCsrf.json()).error, 'CSRF');
  const wrongPassword = await verify({ ...upload, password: 'outra-senha' }, adminToken, csrfToken);
  assert.equal(wrongPassword.status, 400);
  assert.equal((await wrongPassword.json()).error, 'CLIENT_CERTIFICATE_INVALID');
  const verified = await verify(upload, adminToken, csrfToken);
  assert.equal(verified.status, 200);
  assert.equal(verified.headers.get('cache-control'), 'no-store');
  const { certificate, ...additional } = await verified.json();
  assert.deepEqual(additional, {});
  assert.deepEqual(Object.keys(certificate), ['validFrom', 'expiresAt']);
  assert.ok(Date.parse(certificate.validFrom) <= Date.now() && Date.parse(certificate.expiresAt) > Date.now());
  t.mock.method(Date, 'now', () => Date.parse(certificate.expiresAt));
  const expired = await verify(upload, adminToken, csrfToken);
  assert.equal(expired.status, 400);
  assert.equal((await expired.json()).error, 'CLIENT_CERTIFICATE_EXPIRED');
  assert.throws(() => certificates.prepare(upload, firstClient), { code: 'CLIENT_CERTIFICATE_EXPIRED' });
});

test('checks the filename, strict encoding and size without returning certificate material', () => {
  const configured = new ClientCertificateStore({}, { encryptionKey });
  const unconfigured = new ClientCertificateStore({}, { encryptionKey: '' });
  const upload = { fileName: 'cliente.pfx', data: 'YQ==', password: 'ficticia' };
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.prepare(undefined, firstClient), undefined);
  assert.equal(unconfigured.prepare(null, firstClient), null);
  assert.throws(() => unconfigured.prepare(upload, firstClient), { code: 'CLIENT_CERTIFICATE_UNAVAILABLE' });
  assert.throws(() => configured.prepare({ ...upload, fileName: '../cliente.pfx' }, firstClient), { code: 'CLIENT_CERTIFICATE_FILE' });
  assert.throws(() => configured.prepare({ ...upload, data: 'YQ= =\n' }, firstClient), { code: 'CLIENT_CERTIFICATE_FILE' });
  assert.throws(() => configured.prepare({ ...upload, data: Buffer.alloc(512 * 1024 + 1).toString('base64') }, firstClient), { code: 'CLIENT_CERTIFICATE_FILE' });
  assert.throws(() => configured.prepare({ ...upload, password: '' }, firstClient), { code: 'CLIENT_CERTIFICATE_PASSWORD' });
  assert.throws(() => configured.prepare(upload, firstClient), { code: 'CLIENT_CERTIFICATE_INVALID' });
});

test('writes certificate changes through the caller transaction and selects metadata only', async () => {
  const calls = [];
  const executor = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[{
        file_name: 'cliente.pfx',
        expires_at: '2027-02-04 11:00:00.000',
        created_at: '2026-11-26 14:00:00.000'
      }]];
    }
  };
  const store = new ClientCertificateStore(executor, { encryptionKey });
  await store.save(executor, firstClient, undefined);
  assert.equal(calls.length, 0);
  await store.save(executor, firstClient, {
    fileName: 'cliente.pfx', expiresAt: new Date('2027-02-04T11:00:00Z'), encrypted: Buffer.from('ciphertext test')
  });
  assert.match(calls[0].sql, /INSERT INTO .*platform_client_certificates/);
  assert.equal(calls[0].params[0], firstClient);
  assert.deepEqual(await store.status(firstClient), {
    fileName: 'cliente.pfx', expiresAt: '2027-02-04T11:00:00.000Z', createdAt: '2026-11-26T14:00:00.000Z'
  });
  assert.doesNotMatch(calls[1].sql, /encrypted|SELECT \*/);
  await store.save(executor, firstClient, null);
  assert.match(calls[2].sql, /DELETE FROM .*platform_client_certificates/);
  assert.deepEqual(calls[2].params, [firstClient]);
});
