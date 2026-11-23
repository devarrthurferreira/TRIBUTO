import { randomUUID } from 'node:crypto';
import { createDecipheriv } from 'node:crypto';
import { permissionsFor } from './policy.mjs';

export class PlatformMongoStore {
  constructor(db, client, encryptionKey) { this.db = db; this.client = client; this.encryptionKey = encryptionKey; }

  async initialize() {
    await this.db.collection('platform_users').createIndex({ email: 1 }, { unique: true });
    await this.db.collection('platform_companies').createIndex({ cnpj: 1 }, { unique: true });
    await this.db.collection('platform_sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.db.collection('platform_login_attempts').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.db.collection('platform_agents').createIndex({ tokenSha256: 1 }, { unique: true });
    await this.db.collection('platform_work_items').createIndex({ module: 1, companyCnpj: 1, status: 1, dueAt: 1 });
    await this.db.collection('platform_audit').createIndex({ at: -1 });
  }

  async countUsers() { return this.db.collection('platform_users').countDocuments(); }

  async createFirstAdmin(user) {
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        if (await this.db.collection('platform_users').countDocuments({}, { session })) throw new Error('SETUP_COMPLETE');
        await this.db.collection('platform_setup').insertOne({ _id: 'initial', at: new Date() }, { session });
        await this.db.collection('platform_users').insertOne(user, { session });
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } catch (error) {
      if (error.code === 11000 || error.message === 'SETUP_COMPLETE') throw new Error('SETUP_COMPLETE');
      throw error;
    } finally { await session.endSession(); }
  }

  async findUserByEmail(email) { return this.db.collection('platform_users').findOne({ email }); }
  async findUserById(id) { return this.db.collection('platform_users').findOne({ _id: id }); }
  async listUsers() { return this.db.collection('platform_users').find({}, { projection: { passwordHash: 0 } }).sort({ name: 1 }).toArray(); }
  async insertWithAudit(collection, document, action, actorId, subject, detail = {}) {
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.db.collection(collection).insertOne(document, { session });
        await this.db.collection('platform_audit').insertOne({ _id: randomUUID(), action, actorId, subject, detail, at: new Date() }, { session });
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
  }
  async createUser(user, actorId) { await this.insertWithAudit('platform_users', user, 'user.create', actorId, user._id, { role: user.role }); }
  async updateUser(id, changes) { return this.db.collection('platform_users').findOneAndUpdate({ _id: id }, { $set: { ...changes, updatedAt: new Date() } }, { returnDocument: 'after', projection: { passwordHash: 0 } }); }
  async changePassword(userId, hash, currentSessionHash) {
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.db.collection('platform_users').updateOne({ _id: userId }, { $set: { passwordHash: hash, passwordChangedAt: new Date() } }, { session });
        await this.db.collection('platform_sessions').deleteMany({ userId, _id: { $ne: currentSessionHash } }, { session });
        await this.db.collection('platform_audit').insertOne({ _id: randomUUID(), action: 'auth.password.change', actorId: userId, subject: userId, at: new Date() }, { session });
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
  }

  async createSession(session) { await this.db.collection('platform_sessions').insertOne(session); }
  async findSession(hash) { return this.db.collection('platform_sessions').findOne({ _id: hash, expiresAt: { $gt: new Date() } }); }
  async deleteSession(hash) { await this.db.collection('platform_sessions').deleteOne({ _id: hash }); }
  async deleteOtherSessions(userId, currentHash) { await this.db.collection('platform_sessions').deleteMany({ userId, _id: { $ne: currentHash } }); }
  async deleteAllSessions(userId) { await this.db.collection('platform_sessions').deleteMany({ userId }); }
  async reserveLoginAttempt(key) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000);
    const entry = await this.db.collection('platform_login_attempts').findOneAndUpdate({ _id: key }, [
      { $set: {
        count: { $cond: [{ $gt: ['$expiresAt', now] }, { $add: [{ $ifNull: ['$count', 0] }, 1] }, 1] },
        expiresAt: { $cond: [{ $gt: ['$expiresAt', now] }, '$expiresAt', expiresAt] }
      } }
    ], { upsert: true, returnDocument: 'after' });
    return entry.count;
  }
  async clearLoginFailures(key) { await this.db.collection('platform_login_attempts').deleteOne({ _id: key }); }

  async listCompanies(allowed = null) {
    const filter = allowed === null ? {} : { cnpj: { $in: allowed } };
    return this.db.collection('platform_companies').find(filter).sort({ name: 1 }).toArray();
  }
  async companyExists(cnpj) { return Boolean(await this.db.collection('platform_companies').findOne({ cnpj }, { projection: { _id: 1 } })); }
  async createCompany(company, actorId) { await this.insertWithAudit('platform_companies', company, 'company.create', actorId, company.cnpj); }

  async listWorkItems({ modules, companyCnpjs, module, companyCnpj }) {
    const filter = {
      module: module || { $in: modules },
      ...(companyCnpjs === null ? {} : { companyCnpj: companyCnpj || { $in: companyCnpjs } })
    };
    if (companyCnpjs === null && companyCnpj) filter.companyCnpj = companyCnpj;
    return this.db.collection('platform_work_items').find(filter).sort({ updatedAt: -1 }).limit(500).toArray();
  }
  async getWorkItem(id) { return this.db.collection('platform_work_items').findOne({ _id: id }); }
  async createWorkItem(item) { await this.db.collection('platform_work_items').insertOne(item); }
  async updateWorkItem(id, changes) { return this.db.collection('platform_work_items').findOneAndUpdate({ _id: id }, { $set: { ...changes, updatedAt: new Date() } }, { returnDocument: 'after' }); }

  async dashboard(user) {
    const allowed = user.role === 'admin' ? null : user.companyCnpjs;
    const companyFilter = allowed === null ? {} : { cnpj: { $in: allowed } };
    const documentFilter = allowed === null ? {} : { companyCnpj: { $in: allowed } };
    const workFilter = { module: { $in: Object.keys(permissionsFor(user)) }, status: { $ne: 'done' }, ...(allowed === null ? {} : { companyCnpj: { $in: allowed } }) };
    const fiscalAllowed = user.role === 'admin' || Boolean(user.moduleGrants?.fiscal);
    const [companies, users, documents, workItemsOpen, agents] = await Promise.all([
      this.db.collection('platform_companies').countDocuments(companyFilter),
      user.role === 'admin' ? this.db.collection('platform_users').countDocuments({ active: true }) : Promise.resolve(null),
      fiscalAllowed ? this.db.collection('documents').countDocuments(documentFilter) : Promise.resolve(null),
      this.db.collection('platform_work_items').countDocuments(workFilter),
      user.role === 'admin' ? this.db.collection('platform_agents').find({ active: true }).toArray() : Promise.resolve([])
    ]);
    const recent = new Date(Date.now() - 10 * 60_000);
    const online = agents.length ? await this.db.collection('agents_health').countDocuments({ _id: { $in: agents.map(x => x._id) }, serverTime: { $gte: recent } }) : 0;
    return { companies, users, documents, workItemsOpen, agentsOnline: user.role === 'admin' ? online : null };
  }

  async listFiscalDocuments(allowedCnpjs, companyCnpj, page, limit) {
    const filter = {
      ...(allowedCnpjs === null ? {} : { companyCnpj: companyCnpj || { $in: allowedCnpjs } })
    };
    if (allowedCnpjs === null && companyCnpj) filter.companyCnpj = companyCnpj;
    const docs = await this.db.collection('documents').find(filter, { projection: { encryptedXml: 0 } })
      .sort({ receivedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).toArray();
    return { documents: docs.slice(0, limit).map(({ _id, companyCnpj: cnpj, source, nsu, documentKey, sha256, receivedAt }) => ({ id: _id, companyCnpj: cnpj, source, nsu, documentKey, sha256, receivedAt })), page, hasMore: docs.length > limit };
  }
  async getFiscalDocument(id) { return this.db.collection('documents').findOne({ _id: id }); }
  decryptFiscalXml(document) {
    if (!Buffer.isBuffer(this.encryptionKey) || this.encryptionKey.length !== 32 || document?.encryptedXml?.algorithm !== 'AES-256-GCM') throw new Error('XML_DECRYPTION_UNAVAILABLE');
    const { iv, tag, ciphertext } = document.encryptedXml;
    const bytes = value => Buffer.isBuffer(value) ? value : Buffer.from(value.buffer);
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, bytes(iv));
    decipher.setAuthTag(bytes(tag));
    return Buffer.concat([decipher.update(bytes(ciphertext)), decipher.final()]);
  }

  async createAgent(agent, actorId) { await this.insertWithAudit('platform_agents', agent, 'agent.create', actorId, agent._id, { assignments: agent.assignments.map(x => `${x.companyCnpj}:${x.source}`) }); }
  async findAgentByTokenHash(hash) { return this.db.collection('platform_agents').findOne({ tokenSha256: hash, active: true }); }
  async findAgentById(id) { return this.db.collection('platform_agents').findOne({ _id: id }); }
  async revokeAgent(id) { return this.db.collection('platform_agents').findOneAndUpdate({ _id: id, active: true }, { $set: { active: false, revokedAt: new Date() } }, { returnDocument: 'after' }); }
  async listAgents() {
    const agents = await this.db.collection('platform_agents').find({}, { projection: { tokenSha256: 0 } }).sort({ createdAt: -1 }).toArray();
    const health = await this.db.collection('agents_health').find({ _id: { $in: agents.map(x => x._id) } }).toArray();
    const byId = new Map(health.map(item => [item._id, item]));
    return agents.map(({ _id, name, active, assignments, createdAt }) => ({ id: _id, name, active, assignments, createdAt, lastSeenAt: byId.get(_id)?.serverTime ?? null, queuedBatches: byId.get(_id)?.queuedBatches ?? null }));
  }
  async listAgentJobs(id) {
    const agent = await this.findAgentById(id);
    if (!agent?.active) return [];
    const keys = agent.assignments.map(x => `${x.companyCnpj}:${x.source}`);
    const checkpoints = await this.db.collection('checkpoints').find({ _id: { $in: keys } }).toArray();
    const byKey = new Map(checkpoints.map(x => [x._id, x.lastNsu]));
    return agent.assignments.map((item) => ({
      id: `${id}:${item.companyCnpj}:${item.source}`,
      companyCnpj: item.companyCnpj, source: item.source, startNsu: item.startNsu,
      lastCommittedNsu: byKey.get(`${item.companyCnpj}:${item.source}`) ?? item.startNsu,
      enabled: true
    }));
  }
  async getCheckpoint(cnpj, source) {
    const item = await this.db.collection('checkpoints').findOne({ _id: `${cnpj}:${source}` });
    return item?.lastNsu ?? null;
  }
  async recordAgentHealth(id, heartbeat) {
    await this.db.collection('agents_health').updateOne({ _id: id }, { $set: { ...heartbeat, serverTime: new Date() } }, { upsert: true });
  }

  async audit(action, actorId, subject, detail = {}) {
    await this.db.collection('platform_audit').insertOne({ _id: randomUUID(), action, actorId, subject, detail, at: new Date() });
  }
}
