import { randomUUID } from 'node:crypto';
import { INTERNAL_WORK_ITEM_MODULES, MODULES, canPerform } from './policy.mjs';

// All dates are UTC. Configure the mysql2 pool with timezone: 'Z'.
const json = (value) => JSON.stringify(value);
const parse = (value, fallback) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; }
  catch { return fallback; }
};
const bool = (value) => Boolean(value);
const sqlDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  // mysql2 dateStrings yields DATETIME values in the database UTC timezone.
  return String(value).replace(' ', 'T') + 'Z';
};
const sqlMoney = (value) => value === null || value === undefined ? null : String(value);
const userConflict = (code) => Object.assign(new Error(code), { code });

function duplicateKey(error, key) {
  if (error?.code !== 'ER_DUP_ENTRY') return false;
  const keyName = /['`]([^'`]+)['`]$/.exec(error.sqlMessage || error.message)?.[1];
  return keyName?.split('.').at(-1) === key;
}

function user(row) {
  if (!row) return null;
  return {
    _id: row.id, name: row.name, username: row.username ?? null, email: row.email,
    passwordHash: row.password_hash, role: row.role, active: bool(row.active),
    companyCnpjs: parse(row.company_cnpjs, []), moduleGrants: parse(row.module_grants, {}),
    createdAt: sqlDate(row.created_at), updatedAt: sqlDate(row.updated_at), passwordChangedAt: sqlDate(row.password_changed_at)
  };
}
function company(row) {
  if (!row) return null;
  return { _id: row.id, cnpj: row.cnpj, name: row.name, active: bool(row.active), createdAt: sqlDate(row.created_at) };
}
function agent(row) {
  if (!row) return null;
  return { _id: row.id, name: row.name, active: bool(row.active), tokenSha256: row.token_sha256, assignments: parse(row.assignments, []), createdAt: sqlDate(row.created_at), revokedAt: sqlDate(row.revoked_at) };
}
function workItem(row) {
  if (!row) return null;
  return {
    _id: row.id, module: row.module, companyCnpj: row.company_cnpj || null,
    title: row.title, description: row.description, status: row.status,
    dueAt: row.due_at, assigneeId: row.assignee_id, createdBy: row.created_by,
    createdAt: sqlDate(row.created_at), updatedAt: sqlDate(row.updated_at),
    ...(row.module === 'marketing' ? { ...parse(row.details_json, {}), completedAt: sqlDate(row.completed_at) } : {})
  };
}

const WORK_ITEM_SELECT = `SELECT task.*, details.details_json, details.completed_at
  FROM platform_work_items task LEFT JOIN platform_marketing_task_details details ON details.work_item_id = task.id`;
const MARKETING_DETAIL_FIELDS = ['priority', 'tags', 'checklist', 'campaign', 'referenceUrl'];

function marketingDetails(item) {
  return Object.fromEntries(MARKETING_DETAIL_FIELDS.filter(key => item[key] !== undefined).map(key => [key, item[key]]));
}

async function saveMarketingDetails(connection, task, completedAt) {
  const details = json(marketingDetails(task));
  await connection.execute(`INSERT INTO platform_marketing_task_details (work_item_id, details_json, completed_at)
    VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE details_json = ?, completed_at = ?`,
  [task._id, details, completedAt, details, completedAt]);
}

function scope(column, allowed, parameters) {
  if (allowed === null) return '1=1';
  if (!allowed.length) return '1=0';
  parameters.push(...allowed);
  return `${column} IN (${allowed.map(() => '?').join(',')})`;
}

function workItemCompanyScope(allowed, modules, parameters) {
  const companies = scope('company_cnpj', allowed, parameters);
  const internal = INTERNAL_WORK_ITEM_MODULES.filter(module => modules.includes(module));
  return allowed !== null && internal.length
    ? `(${companies} OR (${scope('module', internal, parameters)} AND company_cnpj = ''))`
    : companies;
}

const TABLES = [
  `CREATE TABLE IF NOT EXISTS platform_setup (
    id VARCHAR(16) NOT NULL PRIMARY KEY, created_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_users (
    id CHAR(36) NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL,
    email VARCHAR(254) NOT NULL, password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(10) NOT NULL, active TINYINT(1) NOT NULL,
    company_cnpjs LONGTEXT NOT NULL, module_grants LONGTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NULL,
    password_changed_at DATETIME(3) NULL,
    UNIQUE KEY uniq_platform_user_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_user_profiles (
    user_id CHAR(36) NOT NULL PRIMARY KEY,
    username VARCHAR(74) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    cpf CHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    profile_json LONGTEXT NOT NULL,
    UNIQUE KEY uniq_platform_profile_username (username),
    UNIQUE KEY uniq_platform_profile_cpf (cpf)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_companies (
    cnpj CHAR(14) NOT NULL PRIMARY KEY, id CHAR(36) NOT NULL,
    name VARCHAR(160) NOT NULL, active TINYINT(1) NOT NULL,
    created_at DATETIME(3) NOT NULL, KEY idx_platform_company_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_sessions (
    id CHAR(64) NOT NULL PRIMARY KEY, user_id CHAR(36) NOT NULL,
    csrf_token VARCHAR(128) NOT NULL, expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    KEY idx_platform_session_user (user_id), KEY idx_platform_session_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_login_attempts (
    id CHAR(64) NOT NULL PRIMARY KEY, count INT NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    KEY idx_platform_login_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_agents (
    id CHAR(36) NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL,
    active TINYINT(1) NOT NULL, token_sha256 CHAR(64) NOT NULL,
    assignments LONGTEXT NOT NULL, created_at DATETIME(3) NOT NULL,
    revoked_at DATETIME(3) NULL,
    UNIQUE KEY uniq_platform_agent_token (token_sha256),
    KEY idx_platform_agent_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_work_items (
    id CHAR(36) NOT NULL PRIMARY KEY, module VARCHAR(30) NOT NULL,
    company_cnpj CHAR(14) NOT NULL, title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL, status VARCHAR(20) NOT NULL,
    due_at CHAR(10) NULL, assignee_id CHAR(36) NULL,
    created_by CHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_platform_work_scope (module, company_cnpj, status, due_at),
    KEY idx_platform_work_updated (updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_marketing_task_details (
    work_item_id CHAR(36) NOT NULL PRIMARY KEY,
    details_json LONGTEXT NOT NULL,
    completed_at DATETIME(3) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_audit (
    id CHAR(36) NOT NULL PRIMARY KEY, action VARCHAR(100) NOT NULL,
    actor_id CHAR(36) NOT NULL, subject VARCHAR(200) NOT NULL,
    detail_json LONGTEXT NOT NULL, at DATETIME(3) NOT NULL,
    KEY idx_platform_audit_at (at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

export class PlatformMySqlStore {
  constructor(pool) { this.pool = pool; }

  async initialize() {
    for (const statement of TABLES) await this.pool.query(statement);
    await this.cleanupExpired();
  }

  async cleanupExpired() {
    await this.pool.execute('DELETE FROM platform_sessions WHERE expires_at < UTC_TIMESTAMP(3)');
    await this.pool.execute('DELETE FROM platform_login_attempts WHERE expires_at < UTC_TIMESTAMP(3)');
  }

  async getStorageUsage() {
    const rows = await this.rows(`SELECT TABLE_NAME AS name,
      COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS bytes
      FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) DESC`);
    const tables = rows.map((row) => ({ name: row.name, bytes: Number(row.bytes) }));
    return { bytes: tables.reduce((total, row) => total + row.bytes, 0),
      tableCount: tables.length, tables, approximate: true, measuredAt: new Date().toISOString() };
  }

  async rows(sql, values = []) { const [rows] = await this.pool.execute(sql, values); return rows; }
  async one(sql, values = []) { return (await this.rows(sql, values))[0] ?? null; }
  async count(sql, values = []) { return Number((await this.one(sql, values)).n); }
  async transaction(fn) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }
  async insertAudit(connection, action, actorId, subject, detail = {}) {
    await connection.execute('INSERT INTO platform_audit (id, action, actor_id, subject, detail_json, at) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), action, actorId, subject, json(detail), new Date()]);
  }
  async audit(action, actorId, subject, detail = {}) {
    await this.insertAudit(this.pool, action, actorId, subject, detail);
  }
  async countUsers() { return this.count('SELECT COUNT(*) AS n FROM platform_users'); }
  async createFirstAdmin(record) {
    try {
      await this.transaction(async (connection) => {
        await connection.execute('INSERT INTO platform_setup (id, created_at) VALUES (?, ?)', ['initial', new Date()]);
        const [[row]] = await connection.execute('SELECT COUNT(*) AS n FROM platform_users');
        if (Number(row.n) !== 0) throw new Error('SETUP_COMPLETE');
        await this.insertUser(connection, record);
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' || error.message === 'SETUP_COMPLETE') throw new Error('SETUP_COMPLETE');
      throw error;
    }
  }

  async insertUser(connection, record) {
    await connection.execute(`INSERT INTO platform_users
      (id, name, email, password_hash, role, active, company_cnpjs, module_grants, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record._id, record.name, record.email, record.passwordHash, record.role, Number(record.active), json(record.companyCnpjs), json(record.moduleGrants), record.createdAt]);
  }
  async findUserByEmail(email) {
    return user(await this.one(`SELECT u.*, p.username FROM platform_users u
      LEFT JOIN platform_user_profiles p ON p.user_id = u.id WHERE u.email = ?`, [email]));
  }
  async findUserByUsername(username) {
    return user(await this.one(`SELECT u.*, p.username FROM platform_user_profiles p
      INNER JOIN platform_users u ON u.id = p.user_id WHERE p.username = ?`, [username]));
  }
  async findUserById(id) {
    return user(await this.one(`SELECT u.*, p.username FROM platform_users u
      LEFT JOIN platform_user_profiles p ON p.user_id = u.id WHERE u.id = ?`, [id]));
  }
  async getUserProfile(id) {
    const row = await this.one('SELECT cpf, profile_json FROM platform_user_profiles WHERE user_id = ?', [id]);
    return row ? { ...parse(row.profile_json, {}), cpf: row.cpf } : null;
  }
  async listUsers() {
    return (await this.rows(`SELECT u.id, u.name, u.email, u.role, u.active, u.company_cnpjs, u.module_grants,
      u.created_at, u.updated_at, u.password_changed_at, p.username FROM platform_users u
      LEFT JOIN platform_user_profiles p ON p.user_id = u.id ORDER BY u.name`)).map((row) => {
      const result = user(row);
      delete result.passwordHash;
      return result;
    });
  }
  async createUser(record, actorId) {
    const { cpf, ...profile } = record.profile || {};
    for (let attempt = 1; attempt <= 999; attempt += 1) {
      const username = attempt === 1 ? record.username : `${record.username}${attempt}`;
      try {
        await this.transaction(async (connection) => {
          await this.insertUser(connection, record);
          if (record.profile) await connection.execute('INSERT INTO platform_user_profiles (user_id, username, cpf, profile_json) VALUES (?, ?, ?, ?)',
            [record._id, username, cpf, json(profile)]);
          await this.insertAudit(connection, 'user.create', actorId, record._id, { role: record.role });
        });
        return username;
      } catch (error) {
        if (duplicateKey(error, 'uniq_platform_user_email')) throw userConflict('DUPLICATE_USER_EMAIL');
        if (duplicateKey(error, 'uniq_platform_profile_cpf')) throw userConflict('DUPLICATE_USER_CPF');
        if (!duplicateKey(error, 'uniq_platform_profile_username')) throw new Error('Falha ao gravar cadastro de usuário', { cause: error });
      }
    }
    throw userConflict('USERNAME_UNAVAILABLE');
  }
  async updateUser(id, changes) {
    const fields = { name: 'name', active: 'active', role: 'role', companyCnpjs: 'company_cnpjs', moduleGrants: 'module_grants' };
    const entries = Object.entries(changes).filter(([key]) => Object.hasOwn(fields, key));
    const values = entries.map(([key, value]) => key === 'companyCnpjs' || key === 'moduleGrants' ? json(value) : key === 'active' ? Number(value) : value);
    await this.pool.execute(`UPDATE platform_users SET ${entries.map(([key]) => `${fields[key]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...values, new Date(), id]);
    return this.findUserById(id);
  }
  async changePassword(userId, hash, currentSessionHash) {
    await this.transaction(async (connection) => {
      await connection.execute('UPDATE platform_users SET password_hash = ?, password_changed_at = ? WHERE id = ?', [hash, new Date(), userId]);
      await connection.execute('DELETE FROM platform_sessions WHERE user_id = ? AND id <> ?', [userId, currentSessionHash]);
      await this.insertAudit(connection, 'auth.password.change', userId, userId);
    });
  }

  async createSession(record) {
    await this.pool.execute('INSERT INTO platform_sessions (id, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [record._id, record.userId, record.csrfToken, record.expiresAt, record.createdAt]);
  }
  async findSession(hash) {
    const row = await this.one('SELECT * FROM platform_sessions WHERE id = ? AND expires_at > UTC_TIMESTAMP(3)', [hash]);
    return row ? { _id: row.id, userId: row.user_id, csrfToken: row.csrf_token, expiresAt: sqlDate(row.expires_at), createdAt: sqlDate(row.created_at) } : null;
  }
  async deleteSession(hash) { await this.pool.execute('DELETE FROM platform_sessions WHERE id = ?', [hash]); }
  async deleteOtherSessions(userId, currentHash) { await this.pool.execute('DELETE FROM platform_sessions WHERE user_id = ? AND id <> ?', [userId, currentHash]); }
  async deleteAllSessions(userId) { await this.pool.execute('DELETE FROM platform_sessions WHERE user_id = ?', [userId]); }
  async reserveLoginAttempt(key) {
    const expiry = new Date(Date.now() + 300_000);
    // The unique key makes increments atomic across simultaneous login attempts.
    await this.pool.execute(`INSERT INTO platform_login_attempts (id, count, expires_at) VALUES (?, 1, ?)
      ON DUPLICATE KEY UPDATE count = IF(expires_at > UTC_TIMESTAMP(3), count + 1, 1),
      expires_at = IF(expires_at > UTC_TIMESTAMP(3), expires_at, VALUES(expires_at))`, [key, expiry]);
    return Number((await this.one('SELECT count FROM platform_login_attempts WHERE id = ?', [key])).count);
  }
  async clearLoginFailures(key) { await this.pool.execute('DELETE FROM platform_login_attempts WHERE id = ?', [key]); }

  async listCompanies(allowed = null) {
    const params = [];
    return (await this.rows(`SELECT * FROM platform_companies WHERE ${scope('cnpj', allowed, params)} ORDER BY name`, params)).map(company);
  }
  async getCompany(cnpj) { return company(await this.one('SELECT * FROM platform_companies WHERE cnpj = ?', [cnpj])); }
  async companyExists(cnpj) { return bool(await this.one('SELECT 1 FROM platform_companies WHERE cnpj = ? LIMIT 1', [cnpj])); }
  async createCompany(record, actorId) {
    await this.transaction(async (connection) => {
      await connection.execute('INSERT INTO platform_companies (cnpj, id, name, active, created_at) VALUES (?, ?, ?, ?, ?)',
        [record.cnpj, record._id, record.name, Number(record.active), record.createdAt]);
      await this.insertAudit(connection, 'company.create', actorId, record.cnpj);
    });
  }

  async updateCompany(cnpj, changes, actorId) {
    return this.transaction(async connection => {
      const [[row]] = await connection.execute('SELECT * FROM platform_companies WHERE cnpj = ? FOR UPDATE', [cnpj]);
      if (!row) return null;
      const updated = { ...company(row), ...changes };
      await connection.execute('UPDATE platform_companies SET name = ?, active = ? WHERE cnpj = ?', [updated.name, Number(updated.active), cnpj]);
      await this.insertAudit(connection, 'company.update', actorId, cnpj, { fields: Object.keys(changes) });
      return updated;
    });
  }

  async setCompanyAccess(cnpj, userId, hasAccess, actorId) {
    return this.transaction(async connection => {
      const [[row]] = await connection.execute('SELECT role, active, company_cnpjs FROM platform_users WHERE id = ? FOR UPDATE', [userId]);
      if (!row) return 'not_found';
      if (row.role === 'admin') return 'admin';
      if (hasAccess && !row.active) return 'inactive';
      const portfolio = parse(row.company_cnpjs, []);
      if (portfolio.includes(cnpj) === hasAccess) return hasAccess;
      if (hasAccess && portfolio.length >= 1000) return 'limit';
      const updated = hasAccess ? [...portfolio, cnpj] : portfolio.filter(key => key !== cnpj);
      await connection.execute('UPDATE platform_users SET company_cnpjs = ?, updated_at = ? WHERE id = ?', [json(updated), new Date(), userId]);
      await this.insertAudit(connection, hasAccess ? 'company.access.grant' : 'company.access.revoke', actorId, cnpj, { userId });
      return hasAccess;
    });
  }

  async listWorkItems({ modules, companyCnpjs, module, companyCnpj, limit = 500, offset = 0 }) {
    const params = [];
    const clauses = [module ? 'module = ?' : scope('module', modules, params)];
    if (module) params.push(module);
    if (companyCnpj) {
      clauses.push('company_cnpj = ?'); params.push(companyCnpj);
      if (companyCnpjs !== null && !companyCnpjs.includes(companyCnpj)) return [];
    } else clauses.push(workItemCompanyScope(companyCnpjs, modules, params));
    return (await this.rows(`${WORK_ITEM_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, task.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset])).map(workItem);
  }
  async getWorkItem(id) { return workItem(await this.one(`${WORK_ITEM_SELECT} WHERE task.id = ?`, [id])); }
  async listWorkItemHistory(id) {
    const rows = await this.rows(`SELECT audit.action, audit.at, audit.detail_json, people.name
      FROM platform_audit audit LEFT JOIN platform_users people ON people.id = audit.actor_id
      WHERE audit.subject = ? AND audit.action IN ('work_item.create', 'work_item.update')
      ORDER BY audit.at DESC, audit.id DESC LIMIT 30`, [id]);
    return rows.map(row => {
      const detail = parse(row.detail_json, {});
      return { action: row.action === 'work_item.create' ? 'create' : 'update', at: sqlDate(row.at),
        actorName: row.name || 'Usuário indisponível', fields: detail.fields || [], ...(detail.status ? { status: detail.status } : {}) };
    });
  }
  async createWorkItem(item) {
    const insert = connection => connection.execute(`INSERT INTO platform_work_items (id, module, company_cnpj, title, description, status,
      due_at, assignee_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item._id, item.module, item.companyCnpj ?? '', item.title, item.description, item.status, item.dueAt,
      item.assigneeId, item.createdBy, item.createdAt, item.updatedAt]);
    if (item.module !== 'marketing') return insert(this.pool);
    await this.transaction(async connection => {
      await insert(connection);
      await saveMarketingDetails(connection, item, item.completedAt);
      await this.insertAudit(connection, 'work_item.create', item.createdBy, item._id, { module: item.module, status: item.status });
    });
  }
  async updateWorkItem(id, changes, { expected, actorId } = {}) {
    if (expected) return this.transaction(async connection => {
      // Lock the task before reading or changing its optional details.
      const [[locked]] = await connection.execute('SELECT * FROM platform_work_items WHERE id = ? FOR UPDATE', [id]);
      if (!locked || locked.module !== 'marketing' || sqlDate(locked.updated_at) !== new Date(expected.updatedAt).toISOString()
        || (locked.company_cnpj || null) !== expected.companyCnpj || locked.assignee_id !== expected.assigneeId) return null;
      const [[row]] = await connection.execute(`${WORK_ITEM_SELECT} WHERE task.id = ?`, [id]);
      const current = workItem(row);
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1));
      const updated = { ...current, ...changes, updatedAt };
      const completedAt = updated.status !== 'done' ? null
        : current.status === 'done' ? current.completedAt && new Date(current.completedAt) : updatedAt;
      await this.updateWorkItemFields(connection, id, changes, updatedAt);
      await saveMarketingDetails(connection, updated, completedAt);
      await this.insertAudit(connection, 'work_item.update', actorId, id, { fields: Object.keys(changes), ...(changes.status ? { status: changes.status } : {}) });
      return { ...updated, completedAt: completedAt?.toISOString() ?? null };
    });
    await this.updateWorkItemFields(this.pool, id, changes, new Date());
    return this.getWorkItem(id);
  }
  async updateWorkItemFields(connection, id, changes, updatedAt) {
    const fields = { title: 'title', description: 'description', status: 'status', dueAt: 'due_at', assigneeId: 'assignee_id', companyCnpj: 'company_cnpj' };
    const entries = Object.entries(changes).filter(([key]) => Object.hasOwn(fields, key));
    const assignments = [...entries.map(([key]) => `${fields[key]} = ?`), 'updated_at = ?'];
    await connection.execute(`UPDATE platform_work_items SET ${assignments.join(', ')} WHERE id = ?`,
      [...entries.map(([key, value]) => key === 'companyCnpj' ? value ?? '' : value), updatedAt, id]);
  }

  async dashboard(person) {
    const allowed = person.role === 'admin' ? null : person.companyCnpjs;
    const workModules = MODULES.filter(({ id }) => canPerform(person, id, 'workItemRead')).map(({ id }) => id);
    const companyParams = [], docParams = [], workParams = [];
    const fiscalAllowed = canPerform(person, 'fiscal', 'fiscalDocumentsRead');
    const [companies, users, documents, workItemsOpen, agentsOnline] = await Promise.all([
      this.count(`SELECT COUNT(*) AS n FROM platform_companies WHERE ${scope('cnpj', allowed, companyParams)}`, companyParams),
      person.role === 'admin' ? this.count('SELECT COUNT(*) AS n FROM platform_users WHERE active = 1') : null,
      fiscalAllowed ? this.count(`SELECT COUNT(*) AS n FROM documents WHERE ${scope('company_cnpj', allowed, docParams)}
        AND issued_at IS NOT NULL`, docParams) : null,
      this.count(`SELECT COUNT(*) AS n FROM platform_work_items WHERE ${scope('module', workModules, workParams)} AND status <> 'done' AND ${workItemCompanyScope(allowed, workModules, workParams)}`, workParams),
      person.role === 'admin' ? this.count(`SELECT COUNT(*) AS n FROM platform_agents a JOIN agents_health h ON a.id = h.agent_id
        WHERE a.active = 1 AND h.server_time >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE)`) : null
    ]);
    return { companies, users, documents, workItemsOpen, agentsOnline };
  }

  async listFiscalDocuments(allowedCnpjs, companyCnpj, page, limit) {
    if (companyCnpj && allowedCnpjs !== null && !allowedCnpjs.includes(companyCnpj)) return { documents: [], page, hasMore: false };
    const params = [];
    const predicate = companyCnpj ? (params.push(companyCnpj), 'company_cnpj = ?') : scope('company_cnpj', allowedCnpjs, params);
    const rows = await this.rows(`SELECT * FROM documents WHERE ${predicate} AND issued_at IS NOT NULL
      ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`, [...params, limit + 1, (page - 1) * limit]);
    return { documents: rows.slice(0, limit).map((row) => this.mapFiscalDocument(row)), page, hasMore: rows.length > limit };
  }
  mapFiscalDocument(row) {
    return { id: row.id, companyCnpj: row.company_cnpj, source: row.source,
      nsu: String(row.last_nsu), documentKey: row.document_key,
      sha256: row.metadata_sha256, receivedAt: sqlDate(row.received_at), updatedAt: sqlDate(row.updated_at),
      issuedAt: sqlDate(row.issued_at), competence: row.competence, number: row.number,
      providerCnpj: row.provider_cnpj, recipientCnpj: row.recipient_cnpj,
      amountCents: sqlMoney(row.amount_cents),
      status: row.status || 'unknown', municipalityCode: row.municipality_code,
      eventType: row.event_type };
  }
  async getFiscalDocument(id) {
    const row = await this.one('SELECT * FROM documents WHERE id = ?', [id]);
    return row ? { _id: row.id, ...this.mapFiscalDocument(row) } : null;
  }

  async listCompanyNfse(cnpj, { month, role, status, page, limit }) {
    const predicates = ['company_cnpj = ?', "source = 'NFSE'", 'issued_at IS NOT NULL'];
    const params = [cnpj];
    if (month) {
      predicates.push('competence = ?');
      params.push(month);
    }
    if (role) {
      predicates.push(`${role === 'issued' ? 'provider_cnpj' : 'recipient_cnpj'} = ?`);
      params.push(cnpj);
    }
    if (status) { predicates.push('COALESCE(status, \'unknown\') = ?'); params.push(status); }
    const rows = await this.rows(`SELECT * FROM documents WHERE ${predicates.join(' AND ')}
      ORDER BY issued_at DESC, updated_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit + 1, (page - 1) * limit]);
    return { documents: rows.slice(0, limit).map((row) => ({ ...this.mapFiscalDocument(row),
      role: role || (row.provider_cnpj === cnpj ? 'issued' : row.recipient_cnpj === cnpj ? 'received' : 'unknown')
    })), hasMore: rows.length > limit, page };
  }

  async getCompanyNfseSummary(cnpj, { from, to }) {
    const predicates = ['company_cnpj = ?', "source = 'NFSE'", 'issued_at IS NOT NULL'];
    const params = [cnpj];
    if (from) { predicates.push('competence >= ?'); params.push(from); }
    if (to) { predicates.push('competence <= ?'); params.push(to); }
    const where = predicates.join(' AND ');
    const amounts = `
      SUM(CASE WHEN provider_cnpj = ? THEN 1 ELSE 0 END) AS issued_count,
      SUM(CASE WHEN recipient_cnpj = ? THEN 1 ELSE 0 END) AS received_count,
      COALESCE(SUM(CASE WHEN provider_cnpj = ? THEN amount_cents ELSE 0 END), 0) AS issued_amount_cents,
      COALESCE(SUM(CASE WHEN recipient_cnpj = ? THEN amount_cents ELSE 0 END), 0) AS received_amount_cents,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
      COALESCE(SUM(CASE WHEN provider_cnpj = ? AND status = 'active' THEN amount_cents ELSE 0 END), 0) AS issued_active_amount_cents,
      COALESCE(SUM(CASE WHEN recipient_cnpj = ? AND status = 'active' THEN amount_cents ELSE 0 END), 0) AS received_active_amount_cents`;
    const dimensions = [cnpj, cnpj, cnpj, cnpj, cnpj, cnpj];
    const single = await this.one(`SELECT ${amounts} FROM documents WHERE ${where}`, [...dimensions, ...params]);
    const monthly = await this.rows(`SELECT competence AS month, ${amounts}
      FROM documents WHERE ${where} AND competence IS NOT NULL
      GROUP BY competence ORDER BY competence DESC LIMIT 120`, [...dimensions, ...params]);
    const map = (row) => ({ issuedCount: Number(row?.issued_count || 0), receivedCount: Number(row?.received_count || 0),
      issuedAmountCents: String(row?.issued_amount_cents || 0), receivedAmountCents: String(row?.received_amount_cents || 0),
      cancelledCount: Number(row?.cancelled_count || 0),
      issuedActiveAmountCents: String(row?.issued_active_amount_cents || 0),
      receivedActiveAmountCents: String(row?.received_active_amount_cents || 0) });
    return { summary: map(single), byMonth: monthly.map((row) => ({ month: row.month, ...map(row) })) };
  }

  async getCompanyNfseCoverage(cnpj) {
    const checkpoint = await this.one("SELECT last_nsu, updated_at FROM checkpoints WHERE company_cnpj = ? AND source = 'NFSE'", [cnpj]);
    return { source: 'NFSE', lastNsu: checkpoint ? String(checkpoint.last_nsu) : null,
      lastSeenAt: sqlDate(checkpoint?.updated_at), status: checkpoint ? 'received' : 'never_collected' };
  }

  async createAgent(record, actorId) {
    await this.transaction(async (connection) => {
      await connection.execute(`INSERT INTO platform_agents
        (id, name, active, token_sha256, assignments, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [record._id, record.name, Number(record.active), record.tokenSha256, json(record.assignments), record.createdAt]);
      await this.insertAudit(connection, 'agent.create', actorId, record._id,
        { assignments: record.assignments.map((item) => `${item.companyCnpj}:${item.source}`) });
    });
  }
  async findAgentByTokenHash(hash) { return agent(await this.one('SELECT * FROM platform_agents WHERE token_sha256 = ? AND active = 1', [hash])); }
  async findAgentById(id) { return agent(await this.one('SELECT * FROM platform_agents WHERE id = ?', [id])); }
  async revokeAgent(id) {
    const [result] = await this.pool.execute('UPDATE platform_agents SET active = 0, revoked_at = ? WHERE id = ? AND active = 1', [new Date(), id]);
    return result.affectedRows ? this.findAgentById(id) : null;
  }
  async listAgents() {
    const rows = await this.rows(`SELECT a.id, a.name, a.active, a.assignments, a.created_at,
        h.server_time, h.queued_batches
      FROM platform_agents a LEFT JOIN agents_health h ON h.agent_id = a.id ORDER BY a.created_at DESC`);
    return rows.map((row) => ({ id: row.id, name: row.name, active: bool(row.active),
      assignments: parse(row.assignments, []), createdAt: sqlDate(row.created_at),
      lastSeenAt: sqlDate(row.server_time), queuedBatches: row.queued_batches }));
  }
  async listAgentJobs(id) {
    const current = await this.findAgentById(id);
    if (!current?.active) return [];
    const assignments = current.assignments;
    if (!assignments.length) return [];
    const cnpjs = [...new Set(assignments.map((item) => item.companyCnpj))];
    const checkpoints = await this.rows(`SELECT company_cnpj, source, last_nsu FROM checkpoints
      WHERE company_cnpj IN (${cnpjs.map(() => '?').join(',')})`, cnpjs);
    const byKey = new Map(checkpoints.map((item) => [`${item.company_cnpj}:${item.source}`, item.last_nsu]));
    return assignments.map((item) => ({ id: `${id}:${item.companyCnpj}:${item.source}`,
      companyCnpj: item.companyCnpj, source: item.source, startNsu: item.startNsu,
      lastCommittedNsu: byKey.get(`${item.companyCnpj}:${item.source}`) ?? item.startNsu, enabled: true }));
  }
  async getCheckpoint(cnpj, source) {
    const row = await this.one('SELECT last_nsu FROM checkpoints WHERE company_cnpj = ? AND source = ?', [cnpj, source]);
    return row?.last_nsu ?? null;
  }
  async recordAgentHealth(id, heartbeat) {
    await this.pool.execute(`INSERT INTO agents_health (agent_id, hostname, version, queued_batches, server_time)
      VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE hostname = VALUES(hostname), version = VALUES(version),
      queued_batches = VALUES(queued_batches), server_time = VALUES(server_time)`,
    [id, heartbeat.hostname, heartbeat.version, heartbeat.queuedBatches, new Date()]);
  }
}
