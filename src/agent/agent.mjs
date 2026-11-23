#!/usr/bin/env node

// Transport for the TRIBUTO collector. It deliberately does not fetch fiscal
// documents, execute jobs, manifest a recipient, or cancel an invoice.
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERSION = '0.1.0';
const MAX_BATCH_FILE_BYTES = 1_000_000;
const MAX_DOCUMENT_XML_BYTES = 300_000;
const MAX_DOCUMENTS = 20;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 60_000;
const stateDir = path.resolve(process.env.AGENT_STATE_DIR || path.join(os.homedir(), '.tributo-agent'));
const queueDir = path.join(stateDir, 'queue');
const quarantineDir = path.join(stateDir, 'quarantine');
const checkpointsFile = path.join(stateDir, 'checkpoints.json');
const identityFile = path.join(stateDir, 'identity.json');

function log(level, message, extra = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), level, message, ...extra })}\n`);
}

function decimal(value, label) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,14})$/.test(value)) {
    throw new Error(`${label} deve ser uma string decimal sem zeros à esquerda`);
  }
  return BigInt(value);
}

function validateBatch(batch) {
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) throw new Error('Lote inválido');
  if (typeof batch.batchId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(batch.batchId)) {
    throw new Error('batchId inválido');
  }
  if (typeof batch.companyCnpj !== 'string' || !/^[0-9]{14}$/.test(batch.companyCnpj)) {
    throw new Error('companyCnpj deve conter 14 dígitos');
  }
  if (!['NFE', 'NFSE'].includes(batch.source)) {
    throw new Error('source deve ser NFE ou NFSE');
  }
  const first = decimal(batch.firstNsu, 'firstNsu');
  const last = decimal(batch.lastNsu, 'lastNsu');
  if (last < first) throw new Error('lastNsu é anterior a firstNsu');
  if (!Array.isArray(batch.documents) || batch.documents.length < 1 || batch.documents.length > MAX_DOCUMENTS) {
    throw new Error(`documents deve conter entre 1 e ${MAX_DOCUMENTS} itens`);
  }

  const nsus = new Set();
  for (const document of batch.documents) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Documento inválido');
    const nsu = decimal(document.nsu, 'documents[].nsu');
    if (nsu < first || nsu > last) throw new Error('NSU de documento fora do intervalo do lote');
    if (nsus.has(document.nsu)) throw new Error('NSU repetido no lote');
    nsus.add(document.nsu);
    if (typeof document.documentKey !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(document.documentKey)) {
      throw new Error('documentKey inválida');
    }
    if (typeof document.xmlBase64 !== 'string' ||
        !/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(document.xmlBase64)) {
      throw new Error('xmlBase64 inválido');
    }
    if (typeof document.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(document.sha256)) {
      throw new Error('sha256 inválido');
    }
    const xml = Buffer.from(document.xmlBase64, 'base64');
    if (xml.length === 0 || xml.length > MAX_DOCUMENT_XML_BYTES || xml.toString('base64') !== document.xmlBase64) {
      throw new Error(`XML inválido ou acima de ${MAX_DOCUMENT_XML_BYTES} bytes`);
    }
    if (createHash('sha256').update(xml).digest('hex') !== document.sha256) {
      throw new Error('sha256 não confere com o XML');
    }
  }
  // A connector must not acknowledge a later NSU while a document from this
  // range is missing; the future fiscal connector can create smaller batches.
  if (last - first + 1n !== BigInt(batch.documents.length)) {
    throw new Error('Lote com lacuna de NSU: inclua exatamente um documento por NSU');
  }
  if (Buffer.byteLength(JSON.stringify(batch)) > MAX_BATCH_FILE_BYTES) throw new Error('Lote acima do limite');
  return batch;
}

async function syncDirectory(directory) {
  // Directory fsync is unavailable on some Windows file systems; file fsync
  // and same-directory rename still protect normal process interruptions.
  try {
    const handle = await fs.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
}

async function atomicWrite(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, file);
    await syncDirectory(path.dirname(file));
  } finally {
    if (handle) await handle.close();
    await fs.unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function prepareState() {
  await fs.mkdir(queueDir, { recursive: true, mode: 0o700 });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Não foi possível ler ${path.basename(file)}: ${error.message}`);
  }
}

async function getAgentId() {
  const identity = await readJson(identityFile, null);
  if (identity) {
    if (typeof identity.agentId !== 'string') throw new Error('identity.json inválido');
    return identity.agentId;
  }
  const agentId = randomUUID();
  await atomicWrite(identityFile, JSON.stringify({ agentId }));
  return agentId;
}

async function enqueue(file) {
  const stat = await fs.stat(file);
  if (stat.size > MAX_BATCH_FILE_BYTES) throw new Error('Arquivo de lote acima do limite');
  const batch = validateBatch(JSON.parse(await fs.readFile(file, 'utf8')));
  const destination = path.join(queueDir, `batch-${batch.batchId}.json`);
  const existing = await readJson(destination, null);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(batch)) throw new Error('batchId já existe com conteúdo diferente');
    log('info', 'Lote já está na fila', { batchId: batch.batchId });
    return;
  }
  await atomicWrite(destination, JSON.stringify(batch));
  log('info', 'Lote adicionado à fila local', { batchId: batch.batchId });
}

function getConfig() {
  const token = process.env.AGENT_TOKEN;
  const rawUrl = process.env.API_BASE_URL;
  if (!token || !rawUrl) throw new Error('Defina AGENT_TOKEN e API_BASE_URL no ambiente do serviço');
  if (!/^[A-Za-z0-9._~-]{32,256}$/.test(token)) throw new Error('AGENT_TOKEN inválido');
  let baseUrl;
  try { baseUrl = new URL(rawUrl); } catch { throw new Error('API_BASE_URL inválida'); }
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname);
  if (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && isLoopback)) {
    throw new Error('API_BASE_URL exige HTTPS; HTTP é permitido apenas para localhost');
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('API_BASE_URL não pode conter credenciais, consulta ou fragmento');
  }
  if (baseUrl.pathname !== '/') throw new Error('API_BASE_URL deve apontar para a origem, sem caminho');
  const pollMs = Number(process.env.AGENT_POLL_MS || DEFAULT_POLL_MS);
  if (!Number.isInteger(pollMs) || pollMs < 10_000 || pollMs > 3_600_000) {
    throw new Error('AGENT_POLL_MS deve estar entre 10000 e 3600000');
  }
  return { baseUrl, token, pollMs };
}

async function apiRequest(config, endpoint, method = 'GET', body) {
  const response = await fetch(new URL(endpoint, config.baseUrl), {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${method} ${endpoint}: HTTP ${response.status}`);
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (endpoint === '/v1/agent/batches') throw new Error('ACK do lote não é JSON');
    return null;
  }
  return response.json();
}

async function listQueue() {
  const names = (await fs.readdir(queueDir)).filter((name) => /^batch-[a-zA-Z0-9_-]{8,80}\.json$/.test(name));
  const entries = [];
  let quarantinedCount;
  try { quarantinedCount = (await fs.readdir(quarantineDir)).length; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    quarantinedCount = 0;
  }
  for (const name of names) {
    try {
      const batch = validateBatch(await readJson(path.join(queueDir, name), null));
      entries.push({ name, companyCnpj: batch.companyCnpj, source: batch.source, firstNsu: BigInt(batch.firstNsu) });
    } catch {
      // The filename has passed the allowlist above, so it cannot escape the
      // queue directory. Keep the original bytes for investigation/restoration.
      await fs.mkdir(quarantineDir, { recursive: true, mode: 0o700 });
      await fs.rename(path.join(queueDir, name), path.join(quarantineDir, `${name}.${randomUUID()}.bad`));
      await syncDirectory(queueDir);
      await syncDirectory(quarantineDir);
      quarantinedCount += 1;
      log('error', 'Arquivo inválido movido para quarentena', { filename: name });
    }
  }
  entries.sort((a, b) => {
    const source = a.source.localeCompare(b.source);
    if (source !== 0) return source;
    const company = a.companyCnpj.localeCompare(b.companyCnpj);
    if (company !== 0) return company;
    if (a.firstNsu < b.firstNsu) return -1;
    if (a.firstNsu > b.firstNsu) return 1;
    return a.name.localeCompare(b.name);
  });
  return { entries, quarantinedCount };
}

async function deliverBatch(config, filename) {
  const file = path.join(queueDir, filename);
  const batch = validateBatch(await readJson(file, null));
  const ack = await apiRequest(config, '/v1/agent/batches', 'POST', batch);
  if (!ack || ack.ok !== true || ack.batchId !== batch.batchId ||
      decimal(ack.committedThroughNsu, 'ACK committedThroughNsu') < BigInt(batch.lastNsu)) {
    throw new Error(`ACK inválido para o lote ${batch.batchId}`);
  }

  const checkpoints = await readJson(checkpointsFile, {});
  if (!checkpoints || typeof checkpoints !== 'object' || Array.isArray(checkpoints)) {
    throw new Error('checkpoints.json inválido');
  }
  const key = `${batch.source}:${batch.companyCnpj}`;
  const previous = checkpoints[key] === undefined ? -1n : decimal(checkpoints[key], 'checkpoint');
  if (BigInt(ack.committedThroughNsu) > previous) {
    checkpoints[key] = ack.committedThroughNsu;
    await atomicWrite(checkpointsFile, JSON.stringify(checkpoints));
  }
  await fs.unlink(file);
  await syncDirectory(queueDir);
  log('info', 'Lote confirmado e removido da fila', { batchId: batch.batchId, source: batch.source });
}

async function oneCycle(config, agentId) {
  const { entries: pending, quarantinedCount } = await listQueue();
  await apiRequest(config, '/v1/agent/heartbeat', 'POST', {
    agentId,
    hostname: os.hostname(),
    version: VERSION,
    queuedBatches: pending.length,
    checkpoints: await readJson(checkpointsFile, {}),
    at: new Date().toISOString(),
  });
  const jobsResponse = await apiRequest(config, '/v1/agent/jobs');
  const jobs = Array.isArray(jobsResponse?.jobs) ? jobsResponse.jobs : [];
  log('info', 'Tarefas disponíveis para futuros conectores; nenhuma executada', { jobs: jobs.length });
  const failedPairs = new Set();
  for (const entry of pending) {
    const pair = `${entry.source}:${entry.companyCnpj}`;
    if (failedPairs.has(pair)) continue;
    try {
      await deliverBatch(config, entry.name);
    } catch (error) {
      failedPairs.add(pair);
      log('error', 'Lote não confirmado; próximos lotes deste CNPJ/fonte aguardam', {
        batchId: entry.name.slice('batch-'.length, -'.json'.length),
        companyCnpj: entry.companyCnpj,
        source: entry.source,
        error: error.message,
      });
    }
  }
  return { failedPairs: failedPairs.size, quarantinedCount };
}

function usage() {
  process.stdout.write('Uso: node src/agent/agent.mjs [--once | --enqueue caminho-do-lote.json | --help]\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') return usage();
  await prepareState();
  if (args.length === 2 && args[0] === '--enqueue') return enqueue(args[1]);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--once')) {
    throw new Error('Argumentos inválidos. Use --help.');
  }
  const config = getConfig();
  const agentId = await getAgentId();
  if (args[0] === '--once') {
    const result = await oneCycle(config, agentId);
    if (result.failedPairs > 0 || result.quarantinedCount > 0) {
      throw new Error(`${result.failedPairs} CNPJ/fonte com falha; ${result.quarantinedCount} arquivo(s) em quarentena`);
    }
    return;
  }

  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  let failures = 0;
  log('info', 'Agente de transporte iniciado', { agentId });
  while (!stopping) {
    try {
      await oneCycle(config, agentId);
      failures = 0;
    } catch (error) {
      failures += 1;
      log('error', 'Falha de sincronização; fila preservada', { error: error.message });
    }
    const delay = Math.min(config.pollMs * (2 ** Math.min(failures, 4)), 300_000);
    const until = Date.now() + delay;
    while (!stopping && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, until - Date.now())));
    }
  }
  log('info', 'Agente encerrado');
}

main().catch((error) => {
  log('error', 'Agente não iniciou ou ciclo único falhou', { error: error.message });
  process.exitCode = 1;
});
