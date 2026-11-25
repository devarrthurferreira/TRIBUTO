import { ApiError } from '../api/validation.mjs';
import { applyClubFields, CLUB_COLLECTIONS } from './catalog.mjs';

const SCHEMA = `CREATE TABLE IF NOT EXISTS platform_club_catalog (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  collection VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(160) NOT NULL, description TEXT NOT NULL, active TINYINT(1) NOT NULL,
  partner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL, starts_at DATETIME(3) NULL,
  details_json LONGTEXT NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  KEY idx_club_catalog (collection, deleted_at, active, starts_at),
  KEY idx_club_partner (partner_id, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

function utcIso(value) {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`)).toISOString();
}

function asRecord(row) {
  return {
    ...(typeof row.details_json === 'string' ? JSON.parse(row.details_json) : row.details_json),
    id: row.id, title: row.title, description: row.description, active: Boolean(row.active),
    ...(row.collection === 'benefits' ? { partnerId: row.partner_id } : {}),
    ...(row.collection === 'events' ? { startAt: utcIso(row.starts_at) } : {}),
    createdAt: utcIso(row.created_at), updatedAt: utcIso(row.updated_at),
  };
}

function sqlValues(record) {
  const { id, title, description, active, partnerId = null, startAt, createdAt, updatedAt, ...details } = record;
  return [title, description, active, partnerId, startAt ? new Date(startAt) : null, JSON.stringify(details)];
}

async function lockPartner(connection, id) {
  if (!id) return;
  const [[partner]] = await connection.execute(`SELECT id FROM platform_club_catalog
    WHERE id = ? AND collection = 'partners' AND deleted_at IS NULL FOR UPDATE`, [id]);
  if (!partner) throw new ApiError(400, 'CLUB_PARTNER_NOT_FOUND', 'Selecione um parceiro disponível.');
}

async function insertRecord(connection, collection, record, now) {
  await lockPartner(connection, record.partnerId);
  await connection.execute(`INSERT INTO platform_club_catalog
    (id, collection, title, description, active, partner_id, starts_at, details_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [record.id, collection, ...sqlValues(record), now, now]);
}

export class ClubMySqlStore {
  constructor(platformStore) {
    this.platformStore = platformStore;
  }

  async initialize() {
    await this.platformStore.pool.query(SCHEMA);
  }

  async list(includeInactive) {
    const [rows] = await this.platformStore.pool.execute(`SELECT item.* FROM platform_club_catalog item
      LEFT JOIN platform_club_catalog partner ON partner.id = item.partner_id AND partner.deleted_at IS NULL
      WHERE item.deleted_at IS NULL
        AND (? OR (item.active = 1 AND (item.partner_id IS NULL OR partner.active = 1)))
      ORDER BY item.starts_at, item.title, item.id`, [includeInactive]);
    const catalog = Object.fromEntries(CLUB_COLLECTIONS.map(collection => [collection, []]));
    for (const row of rows) catalog[row.collection].push(asRecord(row));
    return catalog;
  }

  async create(collection, id, fields, actorId) {
    return this.platformStore.transaction(async connection => {
      const now = new Date();
      const record = { ...fields, id };
      await insertRecord(connection, collection, record, now);
      await this.platformStore.insertAudit(connection, 'club.create', actorId, id, { collection });
      return { ...record, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    });
  }

  async update(collection, id, changes, actorId) {
    return this.platformStore.transaction(async connection => {
      // Take the partner lock first, in the same order as unlinking its offers on removal.
      await lockPartner(connection, changes.partnerId);
      const [[row]] = await connection.execute(`SELECT * FROM platform_club_catalog
        WHERE id = ? AND collection = ? AND deleted_at IS NULL FOR UPDATE`, [id, collection]);
      if (!row) return null;
      const current = asRecord(row);
      const now = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1));
      const record = applyClubFields(collection, current, changes);
      await connection.execute(`UPDATE platform_club_catalog SET title = ?, description = ?, active = ?,
        partner_id = ?, starts_at = ?, details_json = ?, updated_at = ? WHERE id = ?`, [...sqlValues(record), now, id]);
      await this.platformStore.insertAudit(connection, 'club.update', actorId, id, { collection, fields: Object.keys(changes) });
      return { ...record, updatedAt: now.toISOString() };
    });
  }

  async remove(collection, id, actorId) {
    return this.platformStore.transaction(async connection => {
      const now = new Date();
      const [result] = await connection.execute(`UPDATE platform_club_catalog SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND collection = ? AND deleted_at IS NULL`, [now, now, id, collection]);
      if (!result.affectedRows) return false;
      if (collection === 'partners') {
        const [[linked]] = await connection.execute(`SELECT id FROM platform_club_catalog
          WHERE partner_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [id]);
        if (linked) throw new ApiError(409, 'CLUB_PARTNER_HAS_OFFERS', 'Edite ou remova as vantagens vinculadas antes de remover o parceiro.');
      }
      await this.platformStore.insertAudit(connection, 'club.remove', actorId, id, { collection });
      return true;
    });
  }

  async importCatalog(catalog, actorId) {
    return this.platformStore.transaction(async connection => {
      const imported = Object.fromEntries(CLUB_COLLECTIONS.map(collection => [collection, 0]));
      const skipped = { ...imported };
      const now = new Date();
      for (const collection of CLUB_COLLECTIONS) {
        for (const record of catalog[collection]) {
          const [[existing]] = await connection.execute('SELECT collection FROM platform_club_catalog WHERE id = ? FOR UPDATE', [record.id]);
          if (existing) {
            if (existing.collection !== collection) throw new ApiError(409, 'CLUB_IMPORT_CONFLICT', 'Um identificador pertence a outra seção do Clube.');
            skipped[collection] += 1;
          } else {
            await insertRecord(connection, collection, record, now);
            imported[collection] += 1;
          }
        }
      }
      await this.platformStore.insertAudit(connection, 'club.import', actorId, 'catalog', { imported, skipped });
      return { imported, skipped };
    });
  }
}
