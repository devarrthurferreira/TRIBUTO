import mysql from 'mysql2/promise';
import { sha256, ApiError } from './validation.mjs';
import { TRANSPORT_SCHEMA } from './mysql-schema.mjs';

export function metadata(doc) {
  // Eventos podem chegar sem a NFS-e correspondente. Somente um registro de
  // emissão possui os campos necessários para transformar um placeholder em
  // nota consultável e incluí-lo nos totais.
  const issued = doc.eventType === 'issued';
  return {
    nsu: String(doc.nsu),
    documentKey: doc.documentKey,
    number: issued ? doc.number ?? null : null,
    issuedAt: issued && doc.issuedAt ? new Date(doc.issuedAt).toISOString() : null,
    competence: issued ? doc.competence ?? null : null,
    providerCnpj: issued ? doc.providerCnpj ?? null : null,
    recipientCnpj: issued ? doc.recipientCnpj ?? null : null,
    amountCents: issued && doc.amountCents != null ? String(doc.amountCents) : null,
    status: doc.status ?? null,
    municipalityCode: issued ? doc.municipalityCode ?? null : null,
    eventType: doc.eventType ?? null
  };
}

function digest(data) { return sha256(Buffer.from(JSON.stringify(data))); }

function byNsu(documents) {
  return [...documents].sort((a, b) => {
    const left = BigInt(a.nsu);
    const right = BigInt(b.nsu);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

export function batchDigest(batch) {
  return digest({
    companyCnpj: batch.companyCnpj,
    source: batch.source,
    firstNsu: String(batch.firstNsu),
    lastNsu: String(batch.lastNsu),
    documents: byNsu(batch.documents).map(metadata)
  });
}

// A mesma chave fiscal pode reaparecer em NSUs de eventos; o cadastro da nota
// permanece único por empresa, enquanto cada NSU fica no histórico.
export class MySqlStore {
  constructor(pool) { this.pool = pool; }

  static async connect(config) {
    const pool = mysql.createPool({
      ...config,
      connectionLimit: 8,
      waitForConnections: true,
      queueLimit: 100,
      timezone: 'Z',
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      multipleStatements: false
    });
    try {
      const store = new MySqlStore(pool);
      await pool.query('SELECT 1');
      for (const statement of TRANSPORT_SCHEMA) await pool.query(statement);
      return store;
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async close() { await this.pool.end(); }

  async getCheckpoint(companyCnpj, source) {
    const [rows] = await this.pool.execute('SELECT last_nsu FROM checkpoints WHERE company_cnpj = ? AND source = ?', [companyCnpj, source]);
    return rows[0]?.last_nsu ?? null;
  }

  async recordHeartbeat(agentId, heartbeat) {
    await this.pool.execute(`INSERT INTO agents_health (agent_id, hostname, version, queued_batches, server_time)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE hostname = VALUES(hostname), version = VALUES(version),
        queued_batches = VALUES(queued_batches), server_time = VALUES(server_time)`,
    [agentId, heartbeat.hostname, heartbeat.version, heartbeat.queuedBatches, new Date()]);
  }

  async commitBatch(agentId, batch, startNsu) {
    const id = `${agentId}:${batch.batchId}`;
    const batchHash = batchDigest(batch);
    const [already] = await this.pool.execute('SELECT digest FROM batches WHERE id = ?', [id]);
    if (already.length) {
      if (already[0].digest !== batchHash) throw new ApiError(409, 'BATCH_CONFLICT', 'batchId reutilizado com conteúdo diferente');
      return { existed: true };
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // A chave de checkpoint também serve como trava por CNPJ e fonte. Assim,
      // agentes concorrentes não conseguem confirmar lacunas ou o mesmo NSU.
      await connection.execute(`INSERT INTO checkpoints (company_cnpj, source, last_nsu, updated_at)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE last_nsu = last_nsu`,
      [batch.companyCnpj, batch.source, startNsu, new Date()]);
      const [checkpoints] = await connection.execute('SELECT last_nsu FROM checkpoints WHERE company_cnpj = ? AND source = ? FOR UPDATE', [batch.companyCnpj, batch.source]);
      const [existing] = await connection.execute('SELECT digest FROM batches WHERE id = ? FOR UPDATE', [id]);
      if (existing.length) {
        if (existing[0].digest !== batchHash) throw new ApiError(409, 'BATCH_CONFLICT', 'batchId reutilizado com conteúdo diferente');
        await connection.commit();
        return { existed: true };
      }
      const expectedNsu = BigInt(checkpoints[0].last_nsu) + 1n;
      if (BigInt(batch.firstNsu) !== expectedNsu) throw new ApiError(409, 'NSU_OUT_OF_SEQUENCE', `Próximo NSU esperado: ${expectedNsu}`);
      const receivedAt = new Date();
      await connection.execute(`INSERT INTO batches
        (id, agent_id, company_cnpj, source, first_nsu, last_nsu, digest, document_count, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, agentId, batch.companyCnpj, batch.source, batch.firstNsu, batch.lastNsu, batchHash, batch.documents.length, receivedAt]);

      for (const entry of byNsu(batch.documents)) {
        const doc = metadata(entry);
        const documentId = `${batch.companyCnpj}:${batch.source}:${doc.documentKey}`;
        const eventId = `${batch.companyCnpj}:${batch.source}:${doc.nsu}`;
        const hash = digest(doc);
        const issuedAt = doc.issuedAt ? new Date(doc.issuedAt) : null;
        await connection.execute(`INSERT INTO documents
          (id, company_cnpj, source, document_key, first_nsu, last_nsu, number,
           issued_at, competence, provider_cnpj, recipient_cnpj, amount_cents, status,
           municipality_code, event_type, metadata_sha256, received_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            last_nsu = VALUES(last_nsu),
            number = COALESCE(VALUES(number), number),
            issued_at = COALESCE(VALUES(issued_at), issued_at),
            competence = COALESCE(VALUES(competence), competence),
            provider_cnpj = COALESCE(VALUES(provider_cnpj), provider_cnpj),
            recipient_cnpj = COALESCE(VALUES(recipient_cnpj), recipient_cnpj),
            amount_cents = COALESCE(VALUES(amount_cents), amount_cents),
            status = CASE
              WHEN VALUES(status) IS NULL OR VALUES(status) = 'unknown' THEN COALESCE(status, VALUES(status))
              WHEN status IN ('cancelled', 'substituted') AND VALUES(status) = 'active' THEN status
              ELSE VALUES(status)
            END,
            municipality_code = COALESCE(VALUES(municipality_code), municipality_code),
            event_type = COALESCE(VALUES(event_type), event_type),
            metadata_sha256 = CASE WHEN VALUES(issued_at) IS NOT NULL
              THEN VALUES(metadata_sha256) ELSE metadata_sha256 END,
            updated_at = VALUES(updated_at)`,
        [documentId, batch.companyCnpj, batch.source, doc.documentKey, doc.nsu, doc.nsu,
          doc.number, issuedAt, doc.competence, doc.providerCnpj, doc.recipientCnpj, doc.amountCents,
          doc.status, doc.municipalityCode, doc.eventType, hash, receivedAt, receivedAt]);
        await connection.execute(`INSERT INTO document_events
          (id, document_id, company_cnpj, source, nsu, number, issued_at, competence,
           amount_cents, status, event_type, metadata_sha256, received_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [eventId, documentId, batch.companyCnpj, batch.source, doc.nsu, doc.number,
          issuedAt, doc.competence, doc.amountCents, doc.status, doc.eventType, hash, receivedAt]);
      }
      await connection.execute('UPDATE checkpoints SET last_nsu = ?, updated_at = ? WHERE company_cnpj = ? AND source = ?', [batch.lastNsu, receivedAt, batch.companyCnpj, batch.source]);
      await connection.commit();
      return { existed: false };
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') {
        const [committed] = await this.pool.execute('SELECT digest FROM batches WHERE id = ?', [id]);
        if (committed.length) {
          if (committed[0].digest !== batchHash) throw new ApiError(409, 'BATCH_CONFLICT', 'batchId reutilizado com conteúdo diferente');
          return { existed: true };
        }
        throw new ApiError(409, 'DOCUMENT_CONFLICT', 'NSU ou chave fiscal já registrada com dados diferentes');
      }
      throw error;
    } finally { connection.release(); }
  }
}
