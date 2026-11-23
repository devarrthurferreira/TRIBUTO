import test from 'node:test';
import assert from 'node:assert/strict';
import { batchDigest, metadata } from '../src/api/mysql-store.mjs';

test('eventos parciais não produzem falsa emissão nem valor', () => {
  const item = metadata({
    nsu: '999999999999999', documentKey: '1'.repeat(50),
    eventType: 'cancelled', status: 'cancelled',
    issuedAt: '2026-11-23T10:30:00-03:00', amountCents: 87500,
    competence: '2026-11'
  });
  assert.equal(item.issuedAt, null);
  assert.equal(item.competence, null);
  assert.equal(item.amountCents, null);
  assert.equal(item.status, 'cancelled');
  assert.equal(item.nsu, '999999999999999');
});

test('digest de lote preserva precisão de NSU e é independente da ordem dos documentos', () => {
  const base = { companyCnpj: '12345678000195', source: 'NFSE', firstNsu: '999999999999998', lastNsu: '999999999999999' };
  const original = { nsu: '999999999999998', documentKey: '1'.repeat(50), eventType: 'issued', status: 'active',
    number: '1000', issuedAt: '2026-11-23T10:30:00-03:00', competence: '2026-11',
    providerCnpj: '12345678000195', recipientCnpj: '12345678909', amountCents: 87500, municipalityCode: '3550308' };
  const cancellation = { nsu: '999999999999999', documentKey: original.documentKey, eventType: 'cancelled', status: 'cancelled' };
  const first = batchDigest({ ...base, documents: [original, cancellation] });
  const reordered = batchDigest({ ...base, documents: [cancellation, original] });
  assert.equal(first, reordered);
  assert.notEqual(first, batchDigest({ ...base, documents: [original, { ...cancellation, status: 'unknown' }] }));
});
