import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const agentPath = fileURLToPath(new URL('../src/agent/agent.mjs', import.meta.url));

async function runAgent(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [agentPath, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function document(nsu, source = 'NFE', companyCnpj = '12345678000190') {
  return {
    nsu,
    documentKey: `${nsu}`.padStart(source === 'NFSE' ? 50 : 44, '0'),
    number: nsu,
    issuedAt: '2026-11-23T10:00:00-03:00', competence: '2026-11',
    providerCnpj: companyCnpj, recipientCnpj: null,
    amountCents: 1200, status: 'active', municipalityCode: '3106200', eventType: 'issued'
  };
}

test('mantém lote após ACK inválido e avança checkpoint somente após reenvio confirmado', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tributo-agent-test-'));
  const stateDir = path.join(tempDir, 'state');
  const input = path.join(tempDir, 'batch.json');
  const batch = {
    batchId: 'batch_transport_001',
    companyCnpj: '12345678000190',
    source: 'NFE',
    firstNsu: '1',
    lastNsu: '2',
    documents: [document('1'), document('2')],
  };
  const received = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/agent/jobs' && req.method === 'GET') {
      res.end(JSON.stringify({ jobs: [] }));
      return;
    }
    if (req.url === '/v1/agent/heartbeat' && req.method === 'POST') {
      for await (const _chunk of req) { /* consume request */ }
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/v1/agent/batches' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.end(JSON.stringify({
        ok: true,
        batchId: received.length === 1 ? 'outro_lote' : batch.batchId,
        committedThroughNsu: batch.lastNsu,
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const env = {
      API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      AGENT_TOKEN: 'a'.repeat(64),
      AGENT_STATE_DIR: stateDir,
    };
    await fs.writeFile(input, JSON.stringify({ ...batch, documents: [document('2')] }));
    const gap = await runAgent(['--enqueue', input], env);
    assert.equal(gap.code, 1, gap.stdout);
    assert.deepEqual(await fs.readdir(path.join(stateDir, 'queue')), []);

    await fs.writeFile(input, JSON.stringify(batch));
    const queued = await runAgent(['--enqueue', input], env);
    assert.equal(queued.code, 0, queued.stderr || queued.stdout);

    const first = await runAgent(['--once'], env);
    assert.equal(first.code, 1, first.stdout);
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], batch);
    assert.equal((await fs.readdir(path.join(stateDir, 'queue'))).length, 1);
    await assert.rejects(fs.access(path.join(stateDir, 'checkpoints.json')), { code: 'ENOENT' });

    const retry = await runAgent(['--once'], env);
    assert.equal(retry.code, 0, retry.stderr || retry.stdout);
    assert.equal(received.length, 2);
    assert.deepEqual(received[1], received[0]);
    assert.deepEqual(await fs.readdir(path.join(stateDir, 'queue')), []);
    const checkpoints = JSON.parse(await fs.readFile(path.join(stateDir, 'checkpoints.json'), 'utf8'));
    assert.equal(checkpoints[`NFE:${batch.companyCnpj}`], '2');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('falha de uma empresa preserva sua sequência e não bloqueia outra empresa', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tributo-agent-pairs-'));
  const stateDir = path.join(tempDir, 'state');
  const batches = [
    { batchId: 'batch_A_first', companyCnpj: '12345678000190', source: 'NFE', firstNsu: '1', lastNsu: '1', documents: [document('1')] },
    { batchId: 'batch_A_second', companyCnpj: '12345678000190', source: 'NFE', firstNsu: '2', lastNsu: '2', documents: [document('2')] },
    { batchId: 'batch_B_first', companyCnpj: '98765432000100', source: 'NFSE', firstNsu: '1', lastNsu: '1', documents: [document('1', 'NFSE', '98765432000100')] },
  ];
  const receivedIds = [];
  let failFirstA = true;
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/agent/jobs') return res.end(JSON.stringify({ jobs: [] }));
    if (req.url === '/v1/agent/heartbeat') {
      for await (const _chunk of req) { /* consume request */ }
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url === '/v1/agent/batches') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const batch = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      receivedIds.push(batch.batchId);
      if (batch.batchId === 'batch_A_first' && failFirstA) {
        failFirstA = false;
        return res.end(JSON.stringify({ ok: true, batchId: 'id_errado', committedThroughNsu: batch.lastNsu }));
      }
      return res.end(JSON.stringify({ ok: true, batchId: batch.batchId, committedThroughNsu: batch.lastNsu }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const env = {
      API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      AGENT_TOKEN: 'a'.repeat(64),
      AGENT_STATE_DIR: stateDir,
    };
    for (const batch of batches) {
      const input = path.join(tempDir, `${batch.batchId}.json`);
      await fs.writeFile(input, JSON.stringify(batch));
      assert.equal((await runAgent(['--enqueue', input], env)).code, 0);
    }

    const first = await runAgent(['--once'], env);
    assert.equal(first.code, 1, first.stdout);
    assert.deepEqual(receivedIds, ['batch_A_first', 'batch_B_first']);
    assert.deepEqual((await fs.readdir(path.join(stateDir, 'queue'))).sort(), [
      'batch-batch_A_first.json', 'batch-batch_A_second.json',
    ]);
    const partial = JSON.parse(await fs.readFile(path.join(stateDir, 'checkpoints.json'), 'utf8'));
    assert.equal(partial['NFE:12345678000190'], undefined);
    assert.equal(partial['NFSE:98765432000100'], '1');

    const retry = await runAgent(['--once'], env);
    assert.equal(retry.code, 0, retry.stdout);
    assert.deepEqual(receivedIds, ['batch_A_first', 'batch_B_first', 'batch_A_first', 'batch_A_second']);
    assert.deepEqual(await fs.readdir(path.join(stateDir, 'queue')), []);
    const checkpoints = JSON.parse(await fs.readFile(path.join(stateDir, 'checkpoints.json'), 'utf8'));
    assert.equal(checkpoints['NFE:12345678000190'], '2');
    assert.equal(checkpoints['NFSE:98765432000100'], '1');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('arquivo inválido é isolado em quarentena sem impedir lote válido', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tributo-agent-quarantine-'));
  const stateDir = path.join(tempDir, 'state');
  const input = path.join(tempDir, 'batch.json');
  const batch = {
    batchId: 'batch_B_valid_002', companyCnpj: '98765432000100', source: 'NFSE',
    firstNsu: '1', lastNsu: '1', documents: [document('1', 'NFSE', '98765432000100')],
  };
  const received = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/agent/jobs') return res.end(JSON.stringify({ jobs: [] }));
    if (req.url === '/v1/agent/heartbeat') {
      for await (const _chunk of req) { /* consume request */ }
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url === '/v1/agent/batches') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      received.push(payload.batchId);
      return res.end(JSON.stringify({ ok: true, batchId: payload.batchId, committedThroughNsu: payload.lastNsu }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const env = {
      API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      AGENT_TOKEN: 'a'.repeat(64),
      AGENT_STATE_DIR: stateDir,
    };
    await fs.writeFile(input, JSON.stringify(batch));
    assert.equal((await runAgent(['--enqueue', input], env)).code, 0);
    const badFilename = 'batch-corrupt_item_001.json';
    await fs.writeFile(path.join(stateDir, 'queue', badFilename), '{');

    const cycle = await runAgent(['--once'], env);
    assert.equal(cycle.code, 1, cycle.stdout);
    assert.deepEqual(received, [batch.batchId]);
    assert.deepEqual(await fs.readdir(path.join(stateDir, 'queue')), []);
    const quarantine = await fs.readdir(path.join(stateDir, 'quarantine'));
    assert.equal(quarantine.length, 1);
    assert.ok(quarantine[0].startsWith(`${badFilename}.`));
    assert.equal(await fs.readFile(path.join(stateDir, 'quarantine', quarantine[0]), 'utf8'), '{');
    const checkpoints = JSON.parse(await fs.readFile(path.join(stateDir, 'checkpoints.json'), 'utf8'));
    assert.equal(checkpoints['NFSE:98765432000100'], '1');
    const stillQuarantined = await runAgent(['--once'], env);
    assert.equal(stillQuarantined.code, 1, stillQuarantined.stdout);
    assert.deepEqual(received, [batch.batchId]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
