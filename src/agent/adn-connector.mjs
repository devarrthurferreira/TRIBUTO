// Read-only NFS-e distribution adapter. The CLI/Windows service must persist
// and acknowledge its batch before it advances the CNPJ's distribution NSU.
// This adapter intentionally never publishes the original XML to the panel.
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { gunzipSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const ORIGINS = Object.freeze({
  restricted: 'https://adn.producaorestrita.nfse.gov.br',
  production: 'https://adn.nfse.gov.br',
});
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_XML_BYTES = 300_000;
const TIMEOUT_MS = 30_000;
export const MIN_NO_DOCUMENT_RETRY_MS = 60 * 60_000;
const NSU = /^(0|[1-9]\d{0,14})$/;
const CNPJ = /^\d{14}$/;
const ACCESS_KEY = /^\d{50}$/;

export class AdnFormatError extends Error {
  constructor(message) { super(message); this.name = 'AdnFormatError'; }
}

function ensure(condition, message) { if (!condition) throw new AdnFormatError(message); }
function text(value) { return typeof value === 'string' || typeof value === 'number' ? String(value) : null; }
function onlyDigits(value, lengths) { const str = text(value); return str && lengths.includes(str.length) && /^\d+$/.test(str) ? str : null; }
function cents(value) {
  const str = text(value);
  ensure(str && /^\d{1,12}(?:\.\d{1,2})?$/.test(str), 'Valor líquido não encontrado ou inválido no XML');
  const [whole, fraction = ''] = str.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  ensure(Number.isSafeInteger(result), 'Valor da NFS-e excede limite seguro');
  return result;
}
function date(value) {
  const str = text(value);
  const parsed = str && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(str) ? new Date(str) : null;
  const calendar = str && new Date(`${str.slice(0, 10)}T12:00:00Z`);
  ensure(parsed && Number.isFinite(parsed.getTime()) && Number.isFinite(calendar?.getTime()) && calendar.toISOString().slice(0, 10) === str.slice(0, 10), 'Data de emissão inválida no XML');
  return parsed.toISOString();
}
function unpackXml(encoded) {
  ensure(typeof encoded === 'string' && encoded.length < 1_000_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && encoded.length % 4 === 0, 'ArquivoXml não é base64 válido');
  const gzip = Buffer.from(encoded, 'base64');
  ensure(gzip.toString('base64') === encoded && gzip[0] === 0x1f && gzip[1] === 0x8b, 'ArquivoXml não contém GZip');
  let xml;
  try { xml = gunzipSync(gzip, { maxOutputLength: MAX_XML_BYTES }).toString('utf8'); }
  catch { throw new AdnFormatError('ArquivoXml GZip inválido ou muito grande'); }
  ensure(!/<!DOCTYPE|<!ENTITY/i.test(xml) && XMLValidator.validate(xml) === true, 'XML inválido ou com entidades externas');
  return xml;
}

/**
 * Parse only the standard national NFS-e layout. If a source changes its
 * envelope or XML, stop at that NSU and investigate instead of skipping it.
 */
export function metadataFromAdnItem(item, companyCnpj) {
  ensure(CNPJ.test(companyCnpj), 'CNPJ consultado inválido');
  ensure(item && typeof item === 'object' && !Array.isArray(item), 'Item ADN inválido');
  const nsu = text(item.NSU);
  ensure(NSU.test(nsu || '') && nsu !== '0', 'NSU do documento inválido');
  const type = text(item.TipoDocumento);
  if (type !== 'NFSE') throw new AdnFormatError(`Tipo de DF-e ainda não mapeado: ${type || 'desconhecido'}. NSU preservado.`);
  const documentKey = text(item.ChaveAcesso);
  ensure(ACCESS_KEY.test(documentKey || ''), 'Chave nacional da NFS-e inválida');
  const xml = unpackXml(item.ArquivoXml);
  const parsed = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true,
    parseTagValue: false, parseAttributeValue: false, processEntities: false,
    numberParseOptions: { leadingZeros: false },
  }).parse(xml);
  const info = parsed?.NFSe?.infNFSe;
  ensure(info && typeof info === 'object', 'infNFSe não encontrado no XML');
  const id = text(info['@_Id']);
  ensure(id === `NFS${documentKey}`, 'Chave da resposta não confere com o XML');
  const dps = info.DPS?.infDPS;
  const number = text(info.nNFSe);
  ensure(number && /^\d{1,20}$/.test(number), 'Número da NFS-e inválido');
  const rawIssuedAt = dps?.dhEmi ?? info.dhProc;
  const issuedAt = date(rawIssuedAt);
  const rawCompetence = text(dps?.dCompet);
  const competence = rawCompetence && /^\d{4}-\d{2}(?:-\d{2})?$/.test(rawCompetence) ? rawCompetence.slice(0, 7) : String(rawIssuedAt).slice(0, 7);
  const providerCnpj = onlyDigits(info.emit?.CNPJ ?? info.emit?.CPF ?? dps?.prest?.CNPJ ?? dps?.prest?.CPF, [11, 14]);
  const recipientCnpj = onlyDigits(dps?.toma?.CNPJ ?? dps?.toma?.CPF, [11, 14]);
  ensure(providerCnpj && (providerCnpj === companyCnpj || recipientCnpj === companyCnpj), 'NFS-e não referencia o CNPJ consultado');
  const amountCents = cents(info.valores?.vLiq);
  const municipalityCode = onlyDigits(info.cLocEmi ?? dps?.cLocEmi, [7]);
  // Status is active at issuance; subsequent EVENTO items need separate
  // reconciliation and are never silently accepted as active invoices.
  return {
    nsu, documentKey, number, issuedAt, competence, providerCnpj, recipientCnpj,
    amountCents, status: 'active', municipalityCode, eventType: 'issued',
  };
}

function errorCodes(body) {
  const list = body?.Erros;
  return Array.isArray(list) ? list.map((entry) => text(entry?.Codigo)).filter(Boolean) : [];
}

export function interpretAdnResponse(statusCode, body, companyCnpj) {
  ensure(body && typeof body === 'object' && !Array.isArray(body), 'Resposta JSON do ADN desconhecida');
  const errors = errorCodes(body);
  if (statusCode === 404 && errors.length > 0 && errors.every((code) => ['E2220', 'E2230'].includes(code))) return { kind: 'no_document' };
  if (statusCode !== 200 || errors.length) {
    const code = errors[0] ?? `HTTP_${statusCode}`;
    throw new AdnFormatError(`ADN não confirmou a consulta (${code}); NSU preservado`);
  }
  ensure(['Procuracao', 'CnpjBase', 'InscricaoCertificado'].includes(body.TipoConsulta), 'TipoConsulta ausente ou inesperado');
  const items = Array.isArray(body.LoteDFe) ? body.LoteDFe : body.DFe && typeof body.DFe === 'object' ? [body.DFe] : null;
  ensure(items && items.length > 0 && items.length <= 50, 'Documento ausente ou formato de resposta desconhecido');
  const documents = items.map((item) => metadataFromAdnItem(item, companyCnpj));
  for (let i = 1; i < documents.length; i++) ensure(BigInt(documents[i].nsu) === BigInt(documents[i - 1].nsu) + 1n, 'Lote ADN com intervalo de NSU não contínuo; NSU preservado');
  return { kind: 'documents', authorization: body.TipoConsulta, documents };
}

/** Build a stable, retryable transport batch without forwarding the XML. */
export function batchFromAdn(companyCnpj, expectedNsu, result) {
  ensure(CNPJ.test(companyCnpj || '') && NSU.test(expectedNsu || ''), 'CNPJ ou cursor inválido');
  ensure(result?.kind === 'documents' && Array.isArray(result.documents) && result.documents.length >= 1 && result.documents.length <= 20, 'Lote ADN incompatível com transporte');
  const firstNsu = result.documents[0].nsu;
  const lastNsu = result.documents.at(-1).nsu;
  ensure(BigInt(firstNsu) === BigInt(expectedNsu), 'Resposta ADN não iniciou no NSU esperado; cursor preservado');
  for (let i = 0; i < result.documents.length; i++) {
    const doc = result.documents[i];
    ensure(BigInt(doc.nsu) === BigInt(firstNsu) + BigInt(i), 'Resposta ADN contém lacuna; cursor preservado');
    ensure(doc.providerCnpj === companyCnpj || doc.recipientCnpj === companyCnpj, 'Documento fora do CNPJ consultado');
  }
  return {
    batchId: `adn-${companyCnpj}-${firstNsu}-${lastNsu}`, companyCnpj,
    source: 'NFSE', firstNsu, lastNsu,
    documents: result.documents,
  };
}

/** One read-only request over mutual TLS, with fixed official hosts. */
export async function queryAdnDfe({ environment = 'restricted', pfxPath, passphrase, companyCnpj, nsu }) {
  ensure(Object.hasOwn(ORIGINS, environment), 'Ambiente ADN não permitido');
  ensure(CNPJ.test(companyCnpj || '') && NSU.test(nsu || '') && typeof pfxPath === 'string' && pfxPath.length > 0, 'Parâmetros de consulta inválidos');
  ensure(typeof passphrase === 'string' && passphrase.length > 0, 'Senha do A1 ausente');
  const stat = await readFile(pfxPath);
  ensure(stat.length > 0 && stat.length <= 256_000, 'A1 inválido ou excessivamente grande');
  const url = new URL(`/contribuintes/DFe/${nsu}?cnpjConsulta=${companyCnpj}`, ORIGINS[environment]);
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET', pfx: stat, passphrase, minVersion: 'TLSv1.2', rejectUnauthorized: true,
      timeout: TIMEOUT_MS, headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        reject(new AdnFormatError('ADN respondeu com redirecionamento; requisição não será repetida em outra origem'));
        return;
      }
      const chunks = []; let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) response.destroy(new AdnFormatError('Resposta ADN acima do limite'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(interpretAdnResponse(response.statusCode, body, companyCnpj));
        } catch (error) { reject(error instanceof AdnFormatError ? error : new AdnFormatError('Resposta ADN não é JSON válido')); }
      });
    });
    request.on('timeout', () => request.destroy(new AdnFormatError('Tempo de resposta do ADN esgotado')));
    request.on('error', reject);
    request.end();
  });
}
