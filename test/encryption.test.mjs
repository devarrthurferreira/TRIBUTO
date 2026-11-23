import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, randomBytes } from 'node:crypto';
import { encryptXml } from '../src/api/mongo-store.mjs';

test('XML cifrado pode ser recuperado com a chave e falha se alterado', () => {
  const key = randomBytes(32);
  const xml = Buffer.from('<NFe><chave>teste</chave></NFe>');
  const protectedXml = encryptXml(xml, key);
  assert.equal(protectedXml.algorithm, 'AES-256-GCM');
  assert.notDeepEqual(protectedXml.ciphertext, xml);
  const decrypt = (ciphertext) => {
    const decipher = createDecipheriv('aes-256-gcm', key, protectedXml.iv);
    decipher.setAuthTag(protectedXml.tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  };
  assert.deepEqual(decrypt(protectedXml.ciphertext), xml);
  const modified = Buffer.from(protectedXml.ciphertext);
  modified[0] ^= 1;
  assert.throws(() => decrypt(modified));
});
