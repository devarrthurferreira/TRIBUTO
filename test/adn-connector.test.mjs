import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { metadataFromAdnItem, interpretAdnResponse, batchFromAdn, AdnFormatError } from '../src/agent/adn-connector.mjs';

const companyCnpj = '11222333000181';
const key = '12345678901234567890123456789012345678901234567890';
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${key}">
    <nNFSe>000123</nNFSe><cLocEmi>3106200</cLocEmi>
    <emit><CNPJ>${companyCnpj}</CNPJ></emit>
    <valores><vLiq>125.30</vLiq></valores>
    <DPS><infDPS><dhEmi>2026-11-23T23:00:00-03:00</dhEmi><dCompet>2026-11-01</dCompet>
      <toma><CNPJ>11444777000161</CNPJ></toma></infDPS></DPS>
  </infNFSe>
</NFSe>`;
const item = { NSU: '12', TipoDocumento: 'NFSE', ChaveAcesso: key, ArquivoXml: gzipSync(xml).toString('base64') };

test('extrai somente metadados de uma NFS-e nacional e preserva competência local', () => {
  const doc = metadataFromAdnItem(item, companyCnpj);
  assert.deepEqual(doc, {
    nsu: '12', documentKey: key, number: '000123', issuedAt: '2026-11-24T02:00:00.000Z', competence: '2026-11',
    providerCnpj: companyCnpj, recipientCnpj: '11444777000161', amountCents: 12530,
    status: 'active', municipalityCode: '3106200', eventType: 'issued',
  });
  assert.equal(JSON.stringify(doc).includes('<NFSe'), false);
});

test('não confirma NSU se a resposta puder ocultar evento, XML não confiável ou chave trocada', () => {
  assert.throws(() => metadataFromAdnItem({ ...item, TipoDocumento: 'EVENTO' }, companyCnpj), /não mapeado/);
  assert.throws(() => metadataFromAdnItem({ ...item, ChaveAcesso: '9'.repeat(50) }, companyCnpj), /não confere/);
  const injected = `<!DOCTYPE NFSe [<!ENTITY xxe SYSTEM "file:///c:/private">]>${xml}`;
  assert.throws(() => metadataFromAdnItem({ ...item, ArquivoXml: gzipSync(injected).toString('base64') }, companyCnpj), /entidades externas/);
  assert.throws(() => metadataFromAdnItem(item, '00000000000000'), /não referencia/);
});

test('distingue fim temporário do cursor de falha de procuração e formato desconhecido', () => {
  assert.deepEqual(interpretAdnResponse(404, { Erros: [{ Codigo: 'E2220' }] }, companyCnpj), { kind: 'no_document' });
  assert.throws(() => interpretAdnResponse(400, { Erros: [{ Codigo: 'E2245' }] }, companyCnpj), /E2245/);
  assert.throws(() => interpretAdnResponse(200, { TipoConsulta: 'Procuracao', SomethingElse: [] }, companyCnpj), AdnFormatError);
  assert.equal(interpretAdnResponse(200, { TipoConsulta: 'Procuracao', LoteDFe: [item] }, companyCnpj).documents[0].documentKey, key);
});

test('cria lote repetível sem XML e só a partir do cursor esperado', () => {
  const result = interpretAdnResponse(200, { TipoConsulta: 'Procuracao', LoteDFe: [item] }, companyCnpj);
  const batch = batchFromAdn(companyCnpj, '12', result);
  assert.equal(batch.batchId, `adn-${companyCnpj}-12-12`);
  assert.equal(JSON.stringify(batch).includes('ArquivoXml'), false);
  assert.throws(() => batchFromAdn(companyCnpj, '13', result), /NSU esperado/);
});
