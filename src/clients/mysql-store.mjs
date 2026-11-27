import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { clientFields } from './profile-fields.mjs';

const clientSchema = 'CREATE TABLE IF NOT EXISTS platform_client_profiles (' +
  'id CHAR(36) NOT NULL PRIMARY KEY, client_type ENUM(\'pj\', \'pf\', \'caepf\') NOT NULL, document_number VARCHAR(18) NOT NULL, ' +
  'fiscal_cnpj CHAR(14) NULL, nickname VARCHAR(120) NOT NULL, trade_name VARCHAR(160) NULL, legal_name VARCHAR(160) NULL, ' +
  'state_code CHAR(2) NOT NULL, detail_json LONGTEXT NOT NULL, active TINYINT(1) NOT NULL, created_at DATETIME(3) NOT NULL, ' +
  'updated_at DATETIME(3) NOT NULL, UNIQUE KEY uniq_client_document (document_number), UNIQUE KEY uniq_client_fiscal_cnpj (fiscal_cnpj)' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const documentKey = /^(?:\d{3}\.\d{3}\.\d{3}\/\d{3}-\d{2}|[0-9]{11}|[A-Z0-9]{12}[0-9]{2})$/;
const numericCnpj = /^\d{14}$/;
const baseProfileColumns = 'profile.id AS profile_id, profile.nickname, profile.trade_name, profile.legal_name, profile.state_code, JSON_UNQUOTE(JSON_EXTRACT(profile.detail_json, \'$.code\')) AS client_code';
const linkedColumns = "company.id, 'pj' AS client_type, company.cnpj AS document_number, company.cnpj AS fiscal_cnpj, " +
  'company.name AS client_name, company.active, company.created_at, ' + baseProfileColumns;
const separateColumns = 'profile.id, profile.client_type, profile.document_number, profile.fiscal_cnpj, ' +
  'COALESCE(profile.legal_name, profile.trade_name, profile.nickname) AS client_name, profile.active, profile.created_at, ' + baseProfileColumns;
const linkedTables = 'FROM platform_companies company LEFT JOIN platform_client_profiles profile ON profile.fiscal_cnpj = company.cnpj';
const separateTable = 'FROM platform_client_profiles profile WHERE profile.fiscal_cnpj IS NULL';
const inactiveSchedule = Object.freeze({ period: 'disabled', time: null });

function isoDate(date) {
  if (date instanceof Date) return date.toISOString();
  return date ? date.replace(' ', 'T') + 'Z' : null;
}

function detailsOf(row) {
  return row.detail_json ? JSON.parse(row.detail_json) : {};
}

function clientSummary(row) {
  const { profile_id: profileId, client_name: name, fiscal_cnpj: cnpj, trade_name: tradeName, nickname } = row;
  // Old company edits still define the legal name and status of a linked record.
  const dataName = row.legal_name || tradeName || nickname;
  const legalName = cnpj && name !== dataName ? name : row.legal_name ?? null;
  return {
    id: row.id, type: row.client_type, document: row.document_number, cnpj: cnpj ?? null, fiscalEligible: Boolean(cnpj),
    code: row.client_code === 'null' ? null : row.client_code ?? null, name, nickname: nickname ?? name, tradeName: tradeName ?? null, legalName, state: row.state_code ?? null,
    active: Number(row.active) === 1, createdAt: isoDate(row.created_at), profileComplete: Boolean(profileId),
  };
}

function clientDetail(row) {
  const details = detailsOf(row);
  return {
    ...clientSummary(row),
    groupName: details.groupName ?? null, street: details.street ?? null, streetNumber: details.streetNumber ?? null,
    complement: details.complement ?? null, postalCode: details.postalCode ?? null, district: details.district ?? null,
    city: details.city ?? null, nire: details.nire ?? null, phones: details.phones ?? [], website: details.website ?? null,
    registrationExempt: details.registrationExempt ?? null, taxRegime: details.taxRegime ?? null, cnae: details.cnae ?? null,
    stateRegistrations: details.stateRegistrations ?? [], municipalRegistrations: details.municipalRegistrations ?? [],
    contacts: details.contacts ?? [], modules: details.modules ?? [],
    consumerSchedule: details.consumerSchedule ?? inactiveSchedule, invoiceSchedule: details.invoiceSchedule ?? inactiveSchedule,
    serviceInvoiceSchedule: details.serviceInvoiceSchedule ?? inactiveSchedule,
  };
}

function valuesForProfile(id, data, now, createdAt) {
  const { type, document, nickname, tradeName, legalName, state, active, ...details } = data;
  return [id, type, document, numericCnpj.test(document) ? document : null, nickname, tradeName, legalName, state,
    JSON.stringify(details), Number(active), createdAt, now];
}

function duplicateDocument(error) {
  if (error.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'CLIENT_EXISTS', 'Já existe um cliente com este documento.');
  throw error;
}

export class ClientMySqlStore {
  constructor(platformStore) {
    this.platformStore = platformStore;
    this.pool = platformStore.pool;
  }

  async initialize() {
    await this.pool.query(clientSchema);
    // CAEPF stores its own punctuation so a 14-digit CNPJ can never resolve to a person's account.
    const [[column]] = await this.pool.execute(`SELECT CHARACTER_MAXIMUM_LENGTH AS capacity FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_client_profiles' AND COLUMN_NAME = 'document_number'`);
    if (Number(column?.capacity) === 14) {
      await this.pool.query(`ALTER TABLE platform_client_profiles MODIFY client_type ENUM('pj','pf','caepf') NOT NULL,
        MODIFY document_number VARCHAR(18) NOT NULL`);
    }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS platform_client_groups (
      name VARCHAR(120) NOT NULL PRIMARY KEY
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS platform_client_legacy_modules (
      client_id CHAR(36) PRIMARY KEY, modules_json TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  }

  async list() {
    const [rows] = await this.pool.execute(
      'SELECT ' + linkedColumns + ' ' + linkedTables + ' UNION ALL SELECT ' + separateColumns + ' ' + separateTable + ' ORDER BY client_name, id',
    );
    return rows.map(clientSummary);
  }

  async listGroups() {
    const [rows] = await this.pool.execute("SELECT CONVERT(name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS name FROM platform_client_groups UNION " +
      "SELECT CONVERT(JSON_UNQUOTE(JSON_EXTRACT(detail_json, '$.groupName')) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS name FROM platform_client_profiles " +
      "WHERE JSON_TYPE(JSON_EXTRACT(detail_json, '$.groupName')) = 'STRING' ORDER BY name");
    return rows.map(row => row.name);
  }

  async saveGroups(groups, actorId) {
    await this.platformStore.transaction(async connection => {
      await connection.execute('INSERT INTO platform_client_groups (name) VALUES ' +
        groups.map(() => '(?)').join(',') + ' ON DUPLICATE KEY UPDATE name = VALUES(name)', groups);
      await this.platformStore.insertAudit(connection, 'client.groups.import', actorId, 'client-groups', { count: groups.length });
    });
    return this.listGroups();
  }

  listPortalDocuments(cnpj, source, page, limit) {
    return this.platformStore.listFiscalDocuments([cnpj], cnpj, page, limit, { source });
  }

  async get(key, executor = this.pool) {
    if (typeof key !== 'string') return null;
    const identifier = key.trim();
    if (uuid.test(identifier)) {
      return this.find(executor, identifier.toLowerCase(), true);
    }
    const document = identifier.toUpperCase();
    return documentKey.test(document) ? this.find(executor, document) : null;
  }

  async find(executor, key, byId = false, lock = false) {
    const locking = lock ? ' FOR UPDATE' : '';
    if (byId || numericCnpj.test(key)) {
      const field = byId ? 'company.id' : 'company.cnpj';
      const [[linked]] = await executor.execute(
        'SELECT ' + linkedColumns + ', profile.detail_json ' + linkedTables + ' WHERE ' + field + ' = ? LIMIT 1' + locking, [key],
      );
      if (linked) {
        const client = clientDetail(linked);
        if (!client.profileComplete) {
          const [[grant]] = await executor.execute('SELECT modules_json FROM platform_client_legacy_modules WHERE client_id = ?', [client.id]);
          if (grant) client.modules = JSON.parse(grant.modules_json);
        }
        return client;
      }
      if (!byId) return null;
    }
    const field = byId ? 'profile.id' : 'profile.document_number';
    const [[standalone]] = await executor.execute(
      'SELECT ' + separateColumns + ', profile.detail_json ' + separateTable + ' AND ' + field + ' = ? LIMIT 1' + locking, [key],
    );
    return standalone ? clientDetail(standalone) : null;
  }

  async updatePortalModules(id, modules, actorId) {
    return this.platformStore.transaction(async connection => {
      const client = await this.find(connection, id, true, true);
      if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.');
      if (client.profileComplete) {
        const [[profile]] = await connection.execute('SELECT detail_json FROM platform_client_profiles WHERE id=? FOR UPDATE', [client.id]);
        const details = detailsOf(profile);
        await connection.execute('UPDATE platform_client_profiles SET detail_json=?, updated_at=? WHERE id=?',
          [JSON.stringify({ ...details, modules }), new Date(), client.id]);
      } else {
        await connection.execute(`INSERT INTO platform_client_legacy_modules (client_id,modules_json) VALUES (?,?)
          ON DUPLICATE KEY UPDATE modules_json=VALUES(modules_json)`, [client.id, JSON.stringify(modules)]);
      }
      await this.platformStore.insertAudit(connection, 'client.app.modules', actorId, client.id, { modules });
    });
  }

  async create(fields, actorId, { id = randomUUID(), afterWrite } = {}) {
    const data = clientFields(fields);
    const now = new Date();
    return this.platformStore.transaction(async connection => {
      try {
        // A classic CNPJ remains visible to Fiscal, carteiras and the old /companies API.
        if (numericCnpj.test(data.document)) {
          await connection.execute(
            'INSERT INTO platform_companies (cnpj, id, name, active, created_at) VALUES (?, ?, ?, ?, ?)',
            [data.document, id, data.legalName || data.tradeName || data.nickname, Number(data.active), now],
          );
        }
        await connection.execute(
          'INSERT INTO platform_client_profiles (id, client_type, document_number, fiscal_cnpj, nickname, trade_name, legal_name, state_code, detail_json, active, created_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', valuesForProfile(id, data, now, now),
        );
      } catch (error) {
        duplicateDocument(error);
      }
      const client = await this.find(connection, data.document);
      await afterWrite?.(connection, client);
      await this.platformStore.insertAudit(connection, 'client.create', actorId, id);
      return client;
    });
  }

  async update(key, fields, actorId, { afterWrite } = {}) {
    // Resolve UUID to the indexed record key before acquiring the write lock.
    const target = await this.get(key);
    if (!target) return null;
    return this.platformStore.transaction(async connection => {
      const previous = await this.find(connection, target.document, false, true);
      if (!previous || previous.id !== target.id) return null;
      if ((fields.type !== undefined && fields.type !== previous.type) || (fields.document !== undefined && fields.document !== previous.document)) {
        throw new ApiError(409, 'CLIENT_DOCUMENT_FIXED', 'O tipo e o documento do cliente são fixos após o cadastro.');
      }
      const { modules: storedModules, ...profile } = previous;
      const data = clientFields({ ...profile, ...fields });
      // A profile-only PATCH leaves the client's existing selections intact.
      if (!Object.hasOwn(fields, 'modules')) data.modules = storedModules;
      const now = new Date();
      if (previous.cnpj) {
        await connection.execute('UPDATE platform_companies SET name = ?, active = ? WHERE cnpj = ?', [
          data.legalName || data.tradeName || data.nickname, Number(data.active), previous.cnpj,
        ]);
      }
      await connection.execute(
        'INSERT INTO platform_client_profiles (id, client_type, document_number, fiscal_cnpj, nickname, trade_name, legal_name, state_code, detail_json, active, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE ' +
        'nickname = VALUES(nickname), trade_name = VALUES(trade_name), legal_name = VALUES(legal_name), state_code = VALUES(state_code), ' +
        'detail_json = VALUES(detail_json), active = VALUES(active), updated_at = VALUES(updated_at)',
        valuesForProfile(previous.id, data, now, new Date(previous.createdAt)),
      );
      const client = await this.find(connection, target.document);
      await afterWrite?.(connection, client, previous);
      await this.platformStore.insertAudit(connection, 'client.update', actorId, previous.id, { fields: Object.keys(fields) });
      return client;
    });
  }

  async collectionSchedules(documents) {
    const cnpjs = [...new Set(documents.filter(value => typeof value === 'string' && numericCnpj.test(value)))];
    if (!cnpjs.length) return new Map();
    const [rows] = await this.pool.execute(
      'SELECT company.cnpj, company.active, profile.detail_json FROM platform_client_profiles profile ' +
      'INNER JOIN platform_companies company ON company.cnpj = profile.fiscal_cnpj WHERE company.cnpj IN (' + cnpjs.map(() => '?').join(', ') + ')', cnpjs,
    );
    return new Map(rows.map(row => {
      const details = detailsOf(row);
      return [row.cnpj, { active: Number(row.active) === 1, consumerSchedule: details.consumerSchedule ?? inactiveSchedule, invoiceSchedule: details.invoiceSchedule ?? inactiveSchedule,
        serviceInvoiceSchedule: details.serviceInvoiceSchedule ?? inactiveSchedule }];
    }));
  }
}
