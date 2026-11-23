import { MongoClient } from 'mongodb';
import { createCipheriv, randomBytes } from 'node:crypto';
import { ApiError, sha256 } from './validation.mjs';

export function encryptXml(xml, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(xml), cipher.final()]);
  return { algorithm: 'AES-256-GCM', iv, tag: cipher.getAuthTag(), ciphertext };
}

export class MongoStore {
  static async connect(uri, database, encryptionKey) {
    if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) throw new Error('XML_ENCRYPTION_KEY deve conter 32 bytes');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, retryWrites: true });
    await client.connect();
    const store = new MongoStore(client, database, encryptionKey);
    await store.db.command({ ping: 1 });
    await store.db.collection('documents').createIndex({ companyCnpj: 1, source: 1, nsu: 1 }, { unique: true });
    return store;
  }

  constructor(client, database, encryptionKey) { this.client = client; this.db = client.db(database); this.encryptionKey = encryptionKey; }
  async close() { await this.client.close(); }

  async getCheckpoint(companyCnpj, source) {
    const item = await this.db.collection('checkpoints').findOne({ _id: `${companyCnpj}:${source}` });
    return item?.lastNsu ?? null;
  }

  async recordHeartbeat(agentId, heartbeat) {
    await this.db.collection('agents_health').updateOne({ _id: agentId }, { $set: { ...heartbeat, serverTime: new Date() } }, { upsert: true });
  }

  async commitBatch(agentId, batch, startNsu) {
    const batches = this.db.collection('batches');
    const id = `${agentId}:${batch.batchId}`;
    const digest = sha256(Buffer.from(JSON.stringify({
      companyCnpj: batch.companyCnpj, source: batch.source, firstNsu: batch.firstNsu, lastNsu: batch.lastNsu,
      documents: batch.documents.map(({ nsu, documentKey, sha256: hash }) => ({ nsu, documentKey, sha256: hash }))
    })));
    const existing = await batches.findOne({ _id: id });
    if (existing) {
      if (existing.digest !== digest) throw new ApiError(409, 'BATCH_CONFLICT', 'batchId reutilizado com conteúdo diferente');
      return { existed: true };
    }

    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        const previous = await batches.findOne({ _id: id }, { session });
        if (previous) {
          if (previous.digest !== digest) throw new ApiError(409, 'BATCH_CONFLICT', 'batchId reutilizado com conteúdo diferente');
          return;
        }
        const key = `${batch.companyCnpj}:${batch.source}`;
        const checkpoint = await this.db.collection('checkpoints').findOne({ _id: key }, { session });
        const expectedNsu = BigInt(checkpoint?.lastNsu ?? startNsu) + 1n;
        if (BigInt(batch.firstNsu) !== expectedNsu) throw new ApiError(409, 'NSU_OUT_OF_SEQUENCE', `Próximo NSU esperado: ${expectedNsu}`);
        const receivedAt = new Date();
        await batches.insertOne({ _id: id, agentId, companyCnpj: batch.companyCnpj, source: batch.source, firstNsu: batch.firstNsu, lastNsu: batch.lastNsu, digest, count: batch.documents.length, receivedAt }, { session });
        for (const doc of batch.documents) {
          const docId = `${batch.companyCnpj}:${batch.source}:${doc.nsu}`;
          const prior = await this.db.collection('documents').findOne({ _id: docId }, { session });
          if (prior && prior.sha256 !== doc.sha256) throw new ApiError(409, 'DOCUMENT_CONFLICT', 'NSU já salvo com XML diferente');
          await this.db.collection('documents').updateOne({ _id: docId }, { $setOnInsert: {
            companyCnpj: batch.companyCnpj, source: batch.source, nsu: doc.nsu, documentKey: doc.documentKey,
            sha256: doc.sha256, encryptedXml: encryptXml(doc.xml, this.encryptionKey), receivedAt
          } }, { upsert: true, session });
        }
        await this.db.collection('checkpoints').updateOne({ _id: key }, { $set: { lastNsu: batch.lastNsu, updatedAt: receivedAt } }, { upsert: true, session });
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      return { existed: false };
    } catch (error) {
      // Duas requisições iguais podem disputar a mesma chave única; consulte o lote já confirmado.
      if (error?.code === 11000) {
        const committed = await batches.findOne({ _id: id });
        if (committed?.digest === digest) return { existed: true };
        if (committed) throw new ApiError(409, 'BATCH_CONFLICT', 'batchId reutilizado com conteúdo diferente');
      }
      throw error;
    } finally { await session.endSession(); }
  }
}
