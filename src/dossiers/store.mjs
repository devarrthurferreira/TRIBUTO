import { randomBytes, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ApiError, sha256 } from '../api/validation.mjs';
import { canAccessCompany, canPerformDossier } from '../platform/policy.mjs';
import { renderFeesMessage } from './documents.mjs';
import { requireDossierImportAdmin } from './import.mjs';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS platform_dossier_links (
    id CHAR(36) NOT NULL PRIMARY KEY,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    label VARCHAR(100) NOT NULL,
    company_cnpj VARCHAR(14) NULL,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    used_at DATETIME(3) NULL,
    revoked_at DATETIME(3) NULL,
    KEY idx_dossier_links_date (created_at, id),
    KEY idx_dossier_links_scope (company_cnpj, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_dossiers (
    id CHAR(36) NOT NULL PRIMARY KEY,
    protocol VARCHAR(38) NOT NULL UNIQUE,
    company_cnpj VARCHAR(14) NOT NULL,
    company_name VARCHAR(180) NOT NULL,
    company_regime VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    group_name VARCHAR(180) NOT NULL,
    origin VARCHAR(160) NOT NULL,
    dossier_json LONGTEXT NOT NULL,
    source ENUM('internal','link') NOT NULL,
    intake_link_id CHAR(36) NULL UNIQUE,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    archived_at DATETIME(3) NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    fees_version INT UNSIGNED NOT NULL DEFAULT 0,
    fees_need_review TINYINT(1) NOT NULL DEFAULT 0,
    KEY idx_dossiers_date (created_at, id),
    KEY idx_dossiers_scope (company_cnpj, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_dossier_reusable_links (
    link_id CHAR(36) NOT NULL PRIMARY KEY
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_dossier_link_submissions (
    link_id CHAR(36) NOT NULL,
    submission_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    dossier_id CHAR(36) NOT NULL UNIQUE,
    payload_hash BINARY(32) NOT NULL,
    PRIMARY KEY (link_id, submission_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_dossier_fee_versions (
    dossier_id CHAR(36) NOT NULL,
    version INT UNSIGNED NOT NULL,
    fees_json LONGTEXT NOT NULL,
    saved_by CHAR(36) NOT NULL,
    saved_at DATETIME(3) NOT NULL,
    PRIMARY KEY (dossier_id, version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const SUMMARY_FIELDS = 'id, protocol, company_cnpj, company_name, company_regime, start_date, group_name, origin, created_at, updated_at, archived_at, revision, fees_version, fees_need_review, source';
const INSERT_DOSSIER = `INSERT INTO platform_dossiers
  (id, protocol, company_cnpj, company_name, company_regime, start_date, group_name, origin, dossier_json,
    source, intake_link_id, created_by, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function sqlDate(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value.replace(' ', 'T') + 'Z';
}

function day(value) { return value instanceof Date ? value.toISOString().slice(0, 10) : value; }

function linkView(row) {
  return {
    id: row.id, label: row.label, companyCnpj: row.company_cnpj,
    createdAt: sqlDate(row.created_at), expiresAt: sqlDate(row.expires_at),
    usedAt: sqlDate(row.used_at), revokedAt: sqlDate(row.revoked_at),
    mode: row.reusable_link_id ? 'reusable' : 'single',
    submissionCount: row.reusable_link_id ? Number(row.submission_count ?? 0) : Number(Boolean(row.used_at)),
  };
}

function feesStatus(row, deliveryState) {
  if (!row.fees_version) return 'unset';
  if (row.fees_need_review) return 'review';
  return deliveryState || 'saved';
}

function summary(row, deliveryState) {
  return {
    id: row.id, protocolo: row.protocol,
    empresa: { nome: row.company_name, cnpj: row.company_cnpj, regimeTributario: row.company_regime },
    dataInicio: day(row.start_date), grupo: row.group_name, origem: row.origin, source: row.source,
    createdAt: sqlDate(row.created_at), updatedAt: sqlDate(row.updated_at), archivedAt: sqlDate(row.archived_at),
    revision: row.revision, feesStatus: feesStatus(row, deliveryState),
  };
}

function formattedProtocol(now) {
  const date = now.toISOString().slice(0, 19).replace(/[^0-9]/g, '');
  return `DOS-${date}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function dossierColumns(dossier) {
  return [dossier.empresa.cnpj, dossier.empresa.nome, dossier.empresa.regimeTributario,
    dossier.dataInicio, dossier.grupo, dossier.origem, JSON.stringify(dossier)];
}

function scope(user, values, { links = false } = {}) {
  if (user.role === 'admin') return '1=1';
  const companies = Array.isArray(user.companyCnpjs) ? user.companyCnpjs : [];
  if (!companies.length) return '1=0';
  values.push(...companies);
  const byCompany = `company_cnpj IN (${companies.map(() => '?').join(',')})`;
  if (!links) return byCompany;
  values.push(user._id);
  return `(${byCompany} AND created_by = ?)`;
}

function checkDossier(row, user, revision) {
  if (!row || !canAccessCompany(user, row.company_cnpj)) {
    throw new ApiError(404, 'DOSSIER_NOT_FOUND', 'Dossiê não encontrado.');
  }
  if (revision !== undefined && row.revision !== revision) {
    throw new ApiError(409, 'DOSSIER_REVISION', 'O dossiê foi alterado. Atualize a ficha antes de continuar.');
  }
}

function requireOpen(row) {
  if (row.archived_at) {
    throw new ApiError(409, 'DOSSIER_ARCHIVED', 'Restaure o dossiê antes de fazer alterações.');
  }
}

function companyScope(user, companyCnpj) {
  if (!canAccessCompany(user, companyCnpj)) {
    throw new ApiError(403, 'DOSSIER_COMPANY_SCOPE', 'Selecione uma empresa da sua carteira.');
  }
}

function expiredLink() {
  return new ApiError(410, 'DOSSIER_LINK_UNAVAILABLE', 'Este link está indisponível, expirado ou já foi utilizado.');
}

async function liveLink(executor, token, lock = false) {
  const [[row]] = await executor.execute(`SELECT link.*, reusable.link_id AS reusable_link_id
    FROM platform_dossier_links link
    LEFT JOIN platform_dossier_reusable_links reusable ON link.id = reusable.link_id
    WHERE token_hash = ? AND (used_at IS NULL OR reusable.link_id IS NOT NULL)
      AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)${lock ? ' FOR UPDATE' : ''}`,
  [sha256(token)]);
  if (!row) throw expiredLink();
  return row;
}


async function getCompany(executor, cnpj, lock = false) {
  const selection = /^\d{14}$/.test(cnpj)
    ? 'SELECT active FROM platform_companies WHERE cnpj = ?'
    : 'SELECT active FROM platform_client_profiles WHERE document_number = ?';
  const [[company]] = await executor.execute(selection + (lock ? ' FOR UPDATE' : ''), [cnpj]);
  return company;
}

async function checkLiveLinkScope(executor, link, companyCnpj, lock = false) {
  const [[row]] = await executor.execute(
    'SELECT id, role, active, company_cnpjs, module_grants FROM platform_users WHERE id = ?' + (lock ? ' FOR UPDATE' : ''),
    [link.created_by]);
  if (!row) throw expiredLink();
  const issuer = {
    _id: row.id, role: row.role, active: Boolean(row.active),
    companyCnpjs: JSON.parse(row.company_cnpjs || '[]'), moduleGrants: JSON.parse(row.module_grants || '{}'),
  };
  if (!canPerformDossier(issuer, 'dossierLink')
    || (issuer.role !== 'admin' && !link.company_cnpj)
    || (companyCnpj && !canAccessCompany(issuer, companyCnpj))) throw expiredLink();
  if (companyCnpj) {
    const company = await getCompany(executor, companyCnpj, lock);
    if (company && !company.active) throw expiredLink();
  }
}

async function dossierRow(executor, id, lock = false) {
  const [[row]] = await executor.execute(`SELECT ${SUMMARY_FIELDS}, dossier_json
    FROM platform_dossiers WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  return row;
}

async function currentFees(executor, dossierId, version) {
  const [[row]] = await executor.execute(
    'SELECT fees_json, saved_at FROM platform_dossier_fee_versions WHERE dossier_id = ? AND version = ?', [dossierId, version]);
  return row ? { ...JSON.parse(row.fees_json), version, savedAt: sqlDate(row.saved_at) } : null;
}

async function insertDossier(connection, owner, dossier, source, linkId) {
  const id = randomUUID();
  const now = new Date();
  const protocolo = formattedProtocol(now);
  await connection.execute(INSERT_DOSSIER, [id, protocolo, ...dossierColumns(dossier), source, linkId, owner, now, now]);
  return { id, protocolo, createdAt: now.toISOString() };
}

export function createDossierStore({ platformStore, smtpStore }) {
  const pool = platformStore.pool;
  return {
    async initialize() {
      for (const statement of TABLES) await pool.query(statement);
    },

    async list(user, { query = '', page = 1, limit = 20, archived = false } = {}) {
      const args = [];
      const clauses = [scope(user, args), archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'];
      if (query) {
        const pattern = `%${query.replace(/[!%_]/g, char => '!' + char)}%`;
        const normalizeCnpj = query.toUpperCase().replace(/[./-]/g, '');
        const documentPattern = /^[A-Z0-9]+$/.test(normalizeCnpj) ? `%${normalizeCnpj}%` : pattern;
        const searchable = ['company_name', 'protocol', 'group_name', 'origin', 'company_cnpj'];
        clauses.push(`(${searchable.map(column => column + " LIKE ? ESCAPE '!'").join(' OR ')})`);
        args.push(...searchable.slice(0, -1).map(() => pattern), documentPattern);
      }
      const filter = clauses.join(' AND ');
      const offset = (page - 1) * limit;
      const [rows, [[{ total }]]] = await Promise.all([
        pool.execute(`SELECT ${SUMMARY_FIELDS} FROM platform_dossiers WHERE ${filter} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
          [...args, limit, offset]).then(([records]) => records),
        pool.execute(`SELECT COUNT(*) AS total FROM platform_dossiers WHERE ${filter}`, args),
      ]);
      const versions = rows.filter(row => row.fees_version > 0 && !row.fees_need_review)
        .map(row => ({ id: row.id, version: row.fees_version }));
      const statuses = versions.length ? await smtpStore.honorariumStatuses(versions) : new Map();
      return { items: rows.map(row => summary(row, statuses.get(row.id))), total: Number(total), page, hasMore: offset + rows.length < Number(total) };
    },

    async read(user, id, { includeFees = false } = {}) {
      const row = await dossierRow(pool, id);
      checkDossier(row, user);
      const version = row.fees_version;
      const status = version && !row.fees_need_review ? await smtpStore.honorariumStatus(id, version) : null;
      const record = { ...summary(row, status), ...JSON.parse(row.dossier_json) };
      if (!includeFees) return record;
      const [honorarios, feeRecipients, [history]] = await Promise.all([
        version ? currentFees(pool, id, version) : null,
        smtpStore.honorariumRecipients(id, version),
        pool.execute(`SELECT version, saved_at FROM platform_dossier_fee_versions
          WHERE dossier_id = ? ORDER BY version DESC LIMIT 20`, [id]),
      ]);
      return {
        ...record,
        honorarios: honorarios && { ...honorarios, needsReview: Boolean(row.fees_need_review) },
        feeRecipients,
        feeHistory: history.map(entry => ({ version: entry.version, savedAt: sqlDate(entry.saved_at) })),
      };
    },

    async create(user, dossier) {
      companyScope(user, dossier.empresa.cnpj);
      return platformStore.transaction(async connection => {
        const record = await insertDossier(connection, user._id, dossier, 'internal', null);
        await platformStore.insertAudit(connection, 'dossier.create', user._id, record.id);
        return record;
      });
    },

    async importHistorical(user, items) {
      requireDossierImportAdmin(user);
      return platformStore.transaction(async connection => {
        const importedItems = new Map();
        // Acquire the protocol locks in the same order for overlapping batches.
        const orderedItems = [...items].sort((a, b) => a.protocolo.localeCompare(b.protocolo));
        for (const { protocolo, createdAt, dossier } of orderedItems) {
          const id = randomUUID();
          const date = new Date(createdAt);
          await connection.execute(INSERT_DOSSIER + ' ON DUPLICATE KEY UPDATE protocol = protocol',
            [id, protocolo, ...dossierColumns(dossier), 'internal', null, user._id, date, date]);
          const [[record]] = await connection.execute(`SELECT id, protocol, created_at, dossier_json
            FROM platform_dossiers WHERE protocol = ? FOR UPDATE`, [protocolo]);
          const imported = record?.id === id;
          if (imported) {
            await platformStore.insertAudit(connection, 'dossier.import', user._id, id);
          } else if (!record || record.protocol !== protocolo || new Date(sqlDate(record.created_at)).toISOString() !== createdAt
            || !isDeepStrictEqual(JSON.parse(record.dossier_json), dossier)) {
            throw new ApiError(409, 'DOSSIER_IMPORT_CONFLICT', 'Já existe um dossiê com este protocolo e dados diferentes.');
          }
          importedItems.set(protocolo, { id: record.id, protocolo, createdAt, imported });
        }
        return items.map(({ protocolo }) => importedItems.get(protocolo));
      });
    },

    async update(user, id, revision, dossier) {
      return platformStore.transaction(async connection => {
        const row = await dossierRow(connection, id, true);
        checkDossier(row, user, revision);
        requireOpen(row);
        if (row.company_cnpj !== dossier.empresa.cnpj) {
          throw new ApiError(409, 'DOSSIER_COMPANY_FIXED', 'O CNPJ fica vinculado ao dossiê após o cadastro.');
        }
        const data = dossierColumns(dossier).slice(1);
        if (row.dossier_json === data.at(-1)) return;
        if (row.fees_version) await smtpStore.supersedeHonorarium(connection, { id, version: row.fees_version });
        await connection.execute(`UPDATE platform_dossiers
          SET company_name = ?, company_regime = ?, start_date = ?, group_name = ?, origin = ?, dossier_json = ?,
            updated_at = UTC_TIMESTAMP(3), revision = revision + 1, fees_need_review = ?
          WHERE id = ?`, [...data, Number(row.fees_version > 0), id]);
        await platformStore.insertAudit(connection, 'dossier.update', user._id, id);
      });
    },

    async saveFees(user, id, revision, fees) {
      return platformStore.transaction(async connection => {
        const row = await dossierRow(connection, id, true);
        checkDossier(row, user, revision);
        requireOpen(row);
        const previous = row.fees_version;
        if (previous && !row.fees_need_review) {
          const last = await currentFees(connection, id, previous);
          const { version, savedAt, ...lastFields } = last;
          if (JSON.stringify(lastFields) === JSON.stringify(fees)) return;
        }
        if (previous) await smtpStore.supersedeHonorarium(connection, { id, version: previous });
        const version = previous + 1;
        await connection.execute(`INSERT INTO platform_dossier_fee_versions (dossier_id, version, fees_json, saved_by, saved_at)
          VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`, [id, version, JSON.stringify(fees), user._id]);
        await connection.execute(`UPDATE platform_dossiers SET fees_version = ?, fees_need_review = 0,
          revision = revision + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [version, id]);
        await platformStore.insertAudit(connection, 'dossier.fees.save', user._id, id, { version });
      });
    },

    async sendFees(user, id, revision) {
      return platformStore.transaction(async connection => {
        const row = await dossierRow(connection, id, true);
        checkDossier(row, user, revision);
        requireOpen(row);
        if (!row.fees_version || row.fees_need_review) {
          throw new ApiError(409, 'DOSSIER_FEES_REVIEW', 'Confira e salve os honorários antes de colocar o envio na fila.');
        }
        const version = row.fees_version;
        const honorarios = await currentFees(connection, id, version);
        const message = renderFeesMessage({ ...JSON.parse(row.dossier_json), protocolo: row.protocol, honorarios });
        const queued = await smtpStore.queueHonorarium(connection, { id, version, message });
        if (queued) await platformStore.insertAudit(connection, 'dossier.fees.queue', user._id, id, { version });
        return queued;
      });
    },

    async setArchived(user, id, revision, archived) {
      return platformStore.transaction(async connection => {
        const row = await dossierRow(connection, id, true);
        checkDossier(row, user, revision);
        if (Boolean(row.archived_at) === archived) return;
        if (archived && row.fees_version) {
          await smtpStore.supersedeHonorarium(connection, { id, version: row.fees_version });
        }
        await connection.execute(`UPDATE platform_dossiers
          SET archived_at = IF(?, UTC_TIMESTAMP(3), NULL), updated_at = UTC_TIMESTAMP(3), revision = revision + 1,
            fees_need_review = ? WHERE id = ?`, [archived, Number(row.fees_need_review || (archived && row.fees_version > 0)), id]);
        await platformStore.insertAudit(connection, archived ? 'dossier.archive' : 'dossier.restore', user._id, id);
      });
    },

    async createLink(user, { companyCnpj, label, expiresInHours, mode = 'single' }) {
      if (user.role !== 'admin' || companyCnpj) companyScope(user, companyCnpj);
      const token = randomBytes(32).toString('base64url');
      const now = new Date();
      const row = { id: randomUUID(), label, company_cnpj: companyCnpj, created_at: now, expires_at: new Date(now.getTime() + expiresInHours * 3600000) };
      if (mode === 'reusable') row.reusable_link_id = row.id;
      await platformStore.transaction(async connection => {
        if (companyCnpj) {
          const company = await getCompany(connection, companyCnpj, true);
          if (company && !company.active) {
            throw new ApiError(409, 'DOSSIER_COMPANY_INACTIVE', 'A empresa vinculada está inativa.');
          }
        }
        await connection.execute(`INSERT INTO platform_dossier_links
          (id, token_hash, label, company_cnpj, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [row.id, sha256(token), label, companyCnpj, user._id, row.created_at, row.expires_at]);
        if (row.reusable_link_id) {
          await connection.execute('INSERT INTO platform_dossier_reusable_links (link_id) VALUES (?)', [row.id]);
        }
        await platformStore.insertAudit(connection, 'dossier.link.create', user._id, row.id, { mode });
      });
      return { link: linkView(row), path: `/dossie#${token}` };
    },

    async listLinks(user) {
      const args = [];
      const clauses = scope(user, args, { links: true });
      const [rows] = await pool.execute(`SELECT link.id, link.label, link.company_cnpj, link.created_at, link.expires_at, link.used_at, link.revoked_at,
        reusable.link_id AS reusable_link_id,
        (SELECT COUNT(*) FROM platform_dossier_link_submissions submitted WHERE submitted.link_id = reusable.link_id) AS submission_count
        FROM platform_dossier_links link
        LEFT JOIN platform_dossier_reusable_links reusable ON link.id = reusable.link_id
        WHERE ${clauses} ORDER BY created_at DESC, id DESC LIMIT 100`, args);
      return rows.map(linkView);
    },

    async revokeLink(user, id) {
      const args = [id];
      const clauses = scope(user, args, { links: true });
      return platformStore.transaction(async connection => {
        const [[link]] = await connection.execute(`SELECT link.id, link.revoked_at, link.used_at, reusable.link_id AS reusable_link_id
          FROM platform_dossier_links link
          LEFT JOIN platform_dossier_reusable_links reusable ON link.id = reusable.link_id
          WHERE id = ? AND ${clauses} FOR UPDATE`, args);
        if (!link) throw new ApiError(404, 'DOSSIER_LINK_NOT_FOUND', 'Link de dossiê não encontrado.');
        if (!link.revoked_at && (!link.used_at || link.reusable_link_id)) {
          await connection.execute('UPDATE platform_dossier_links SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ?', [id]);
          await platformStore.insertAudit(connection, 'dossier.link.revoke', user._id, id);
        }
      });
    },

    async publicLink(token) {
      const link = await liveLink(pool, token);
      await checkLiveLinkScope(pool, link, link.company_cnpj);
      return { expiresAt: sqlDate(link.expires_at), ...(link.reusable_link_id ? { mode: 'reusable' } : {}) };
    },

    async submitFromLink(token, dossier, submissionId) {
      return platformStore.transaction(async connection => {
        const link = await liveLink(connection, token, true);
        if (link.company_cnpj && link.company_cnpj !== dossier.empresa.cnpj) {
          throw new ApiError(400, 'DOSSIER_LINK_COMPANY', 'Use o CNPJ da empresa vinculada ao link.');
        }
        await checkLiveLinkScope(connection, link, dossier.empresa.cnpj, true);
        const reusable = Boolean(link.reusable_link_id);
        let payloadHash;
        if (reusable) {
          if (!submissionId) throw new ApiError(400, 'DOSSIER_SUBMISSION_ID', 'Recarregue o formulário antes de enviar.');
          payloadHash = Buffer.from(sha256(JSON.stringify(dossier)), 'hex');
          const [[previous]] = await connection.execute(`SELECT submission.payload_hash, dossier.protocol, dossier.created_at
            FROM platform_dossier_link_submissions submission JOIN platform_dossiers dossier ON dossier.id = submission.dossier_id
            WHERE submission.link_id = ? AND submission.submission_id = ?`, [link.id, submissionId]);
          if (previous) {
            if (!payloadHash.equals(previous.payload_hash)) {
              throw new ApiError(409, 'DOSSIER_SUBMISSION_CONFLICT', 'Este envio já foi registrado. Abra um novo formulário para enviar outro dossiê.');
            }
            return { protocolo: previous.protocol, receivedAt: sqlDate(previous.created_at), status: 'received' };
          }
        }
        // Reusable submissions keep their provenance and retry key separately from legacy one-use rows.
        const record = await insertDossier(connection, link.created_by, dossier, 'link', reusable ? null : link.id);
        if (reusable) {
          await connection.execute(`INSERT INTO platform_dossier_link_submissions
            (link_id, submission_id, dossier_id, payload_hash) VALUES (?, ?, ?, ?)`, [link.id, submissionId, record.id, payloadHash]);
        } else {
          await connection.execute('UPDATE platform_dossier_links SET used_at = UTC_TIMESTAMP(3) WHERE id = ?', [link.id]);
        }
        await platformStore.insertAudit(connection, 'dossier.link.submit', link.created_by, record.id, { linkId: link.id });
        return { protocolo: record.protocolo, receivedAt: record.createdAt, status: 'received' };
      });
    },
  };
}
