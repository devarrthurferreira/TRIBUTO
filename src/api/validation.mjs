import { createHash } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CNPJ = /^\d{14}$/;
const NSU = /^(0|[1-9]\d{0,14})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCES = new Set(['NFE', 'NFSE']);
const STATUSES = new Set(['active', 'cancelled', 'substituted', 'unknown']);
const EVENTS = new Set(['issued', 'cancelled', 'substituted', 'other']);

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function required(value, condition, field) {
  if (!condition) throw new ApiError(400, 'INVALID_INPUT', `Campo inválido: ${field}`);
  return value;
}

export function validateBatch(body) {
  required(body, body && typeof body === 'object' && !Array.isArray(body), 'body');
  const batchId = required(body.batchId, typeof body.batchId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(body.batchId), 'batchId');
  const companyCnpj = required(body.companyCnpj, CNPJ.test(body.companyCnpj), 'companyCnpj');
  const source = required(body.source, SOURCES.has(body.source), 'source');
  const firstNsu = required(body.firstNsu, NSU.test(body.firstNsu), 'firstNsu');
  const lastNsu = required(body.lastNsu, NSU.test(body.lastNsu) && BigInt(body.lastNsu) >= BigInt(firstNsu), 'lastNsu');
  required(body.documents, Array.isArray(body.documents) && body.documents.length > 0 && body.documents.length <= 20, 'documents');
  required(body.documents, BigInt(lastNsu) - BigInt(firstNsu) + 1n === BigInt(body.documents.length), 'documents (intervalo NSU incompleto)');

  const documents = body.documents.map((entry, index) => {
    required(entry, entry && typeof entry === 'object' && !Array.isArray(entry), `documents[${index}]`);
    const allowed = new Set(['nsu', 'documentKey', 'number', 'issuedAt', 'competence', 'providerCnpj', 'recipientCnpj', 'amountCents', 'status', 'municipalityCode', 'eventType']);
    required(entry, Object.keys(entry).every(key => allowed.has(key)), `documents[${index}] (somente metadados; XML não é aceito)`);
    const nsu = required(entry.nsu, NSU.test(entry.nsu) && BigInt(entry.nsu) >= BigInt(firstNsu) && BigInt(entry.nsu) <= BigInt(lastNsu), `documents[${index}].nsu`);
    const documentKey = required(entry.documentKey, typeof entry.documentKey === 'string' && (source === 'NFSE' ? /^\d{50}$/ : /^\d{44}$/).test(entry.documentKey), `documents[${index}].documentKey`);
    const eventType = required(entry.eventType, EVENTS.has(entry.eventType), `documents[${index}].eventType`);
    // Distribution can deliver a cancellation event before the full invoice.
    // Keep its NSU and key, but never invent the invoice's number or amount.
    if (eventType !== 'issued') {
      required(entry, Object.keys(entry).every(key => ['nsu', 'documentKey', 'eventType', 'status'].includes(key)), `documents[${index}] (evento sem dados da nota)`);
      const status = eventType === 'cancelled' ? 'cancelled' : eventType === 'substituted' ? 'substituted' : 'unknown';
      required(entry, entry.status === undefined || entry.status === status, `documents[${index}].status`);
      const normalized = { nsu, documentKey, number: null, issuedAt: null, competence: null, providerCnpj: null, recipientCnpj: null, amountCents: null, status, municipalityCode: null, eventType };
      return { ...normalized, metadataSha256: sha256(JSON.stringify(normalized)) };
    }
    const number = required(entry.number, typeof entry.number === 'string' && /^\d{1,30}$/.test(entry.number), `documents[${index}].number`);
    const issuedAt = required(entry.issuedAt, typeof entry.issuedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(entry.issuedAt) && !Number.isNaN(Date.parse(entry.issuedAt)), `documents[${index}].issuedAt`);
    const competence = required(entry.competence, typeof entry.competence === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(entry.competence), `documents[${index}].competence`);
    const party = (value, name) => required(value, value === null || (typeof value === 'string' && /^(\d{11}|\d{14})$/.test(value)), `documents[${index}].${name}`);
    const providerCnpj = party(entry.providerCnpj, 'providerCnpj');
    const recipientCnpj = party(entry.recipientCnpj, 'recipientCnpj');
    required(entry, providerCnpj === companyCnpj || recipientCnpj === companyCnpj, `documents[${index}] (empresa fora da nota)`);
    const amountCents = required(entry.amountCents, Number.isSafeInteger(entry.amountCents) && entry.amountCents >= 0, `documents[${index}].amountCents`);
    const status = required(entry.status, STATUSES.has(entry.status), `documents[${index}].status`);
    const municipalityCode = required(entry.municipalityCode, entry.municipalityCode === null || (typeof entry.municipalityCode === 'string' && /^\d{7}$/.test(entry.municipalityCode)), `documents[${index}].municipalityCode`);
    const normalized = { nsu, documentKey, number, issuedAt, competence, providerCnpj, recipientCnpj, amountCents, status, municipalityCode, eventType };
    return { ...normalized, metadataSha256: sha256(JSON.stringify(normalized)) };
  });
  const nsus = new Set(documents.map(item => item.nsu));
  required(nsus, nsus.size === documents.length, 'documents (NSU duplicado)');
  for (let nsu = BigInt(firstNsu); nsu <= BigInt(lastNsu); nsu++) {
    required(nsus, nsus.has(nsu.toString()), 'documents (lacuna de NSU)');
  }
  return { batchId, companyCnpj, source, firstNsu, lastNsu, documents };
}

export function validateHeartbeat(body) {
  required(body, body && typeof body === 'object' && !Array.isArray(body), 'body');
  const hostname = required(body.hostname, typeof body.hostname === 'string' && body.hostname.length >= 1 && body.hostname.length <= 100, 'hostname');
  const version = required(body.version, typeof body.version === 'string' && body.version.length >= 1 && body.version.length <= 30, 'version');
  const queuedBatches = required(body.queuedBatches, Number.isSafeInteger(body.queuedBatches) && body.queuedBatches >= 0 && body.queuedBatches <= 1_000_000, 'queuedBatches');
  return { hostname, version, queuedBatches };
}

export function validateConfig(agents, jobs) {
  if (!Array.isArray(agents) || !agents.length || !Array.isArray(jobs)) throw new Error('AGENT_TOKENS_JSON e COLLECTOR_JOBS_JSON inválidos');
  const ids = new Set();
  const hashes = new Set();
  for (const agent of agents) {
    if (!agent || !/^[a-zA-Z0-9_-]{2,64}$/.test(agent.id) || !SHA256.test(agent.tokenSha256) || !Array.isArray(agent.companies) || !agent.companies.every(x => CNPJ.test(x)) || !Array.isArray(agent.sources) || !agent.sources.every(x => SOURCES.has(x)) || ids.has(agent.id) || hashes.has(agent.tokenSha256)) throw new Error('Configuração de agente inválida ou token duplicado');
    ids.add(agent.id);
    hashes.add(agent.tokenSha256);
  }
  for (const job of jobs) {
    if (!job || !/^[a-zA-Z0-9_-]{2,64}$/.test(job.id) || !CNPJ.test(job.companyCnpj) || !SOURCES.has(job.source) || !NSU.test(job.startNsu) || typeof job.enabled !== 'boolean') throw new Error('Configuração de tarefa inválida');
  }
  const pairs = jobs.map(job => `${job.companyCnpj}:${job.source}`);
  if (new Set(pairs).size !== pairs.length) throw new Error('Tarefas duplicadas para CNPJ/fonte');
}
