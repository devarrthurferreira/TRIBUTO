import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { completedTenureYears } from '../platform/employment.mjs';
import { applyClubFields, CLUB_COLLECTIONS } from './catalog.mjs';

const SCHEMAS = [`CREATE TABLE IF NOT EXISTS platform_club_catalog (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  collection VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(160) NOT NULL, description TEXT NOT NULL, active TINYINT(1) NOT NULL,
  partner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL, starts_at DATETIME(3) NULL,
  details_json LONGTEXT NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  KEY idx_club_catalog (collection, deleted_at, active, starts_at),
  KEY idx_club_partner (partner_id, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS platform_club_checkins (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  check_date DATE NOT NULL,
  mood TINYINT UNSIGNED NULL CHECK (mood BETWEEN 1 AND 5),
  PRIMARY KEY (user_id, check_date),
  KEY idx_club_checkins_date (check_date, mood)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS platform_club_rh_checkins (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  check_date DATE NOT NULL,
  PRIMARY KEY (user_id, check_date),
  KEY idx_club_rh_checkins_date (check_date),
  CONSTRAINT fk_club_rh_checkin FOREIGN KEY (user_id, check_date)
    REFERENCES platform_club_checkins (user_id, check_date) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS platform_club_mood_comment_claims (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  check_date DATE NOT NULL,
  PRIMARY KEY (user_id, check_date),
  KEY idx_club_mood_comment_claims_date (check_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS platform_club_mood_comments (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  week_start DATE NOT NULL,
  comment_text VARCHAR(1000) NOT NULL,
  KEY idx_club_mood_comments_week (week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS platform_club_saved (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (user_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`];

const CATALOG_WITH_PARTNER = `FROM platform_club_catalog item
  LEFT JOIN platform_club_catalog partner ON partner.id = item.partner_id AND partner.deleted_at IS NULL`;
const VISIBLE_ITEM = 'item.active = 1 AND (item.partner_id IS NULL OR partner.active = 1)';
const SAVABLE_ITEM = `item.deleted_at IS NULL AND item.collection IN ('benefits', 'partners') AND ${VISIBLE_ITEM}`;
const SHARED_CHECK_INS = `FROM platform_club_rh_checkins shared
  INNER JOIN platform_club_checkins checkin ON checkin.user_id = shared.user_id AND checkin.check_date = shared.check_date
  INNER JOIN platform_users person ON person.id = shared.user_id AND person.active = 1`;
const SHARED_DATES = 'WHERE shared.check_date BETWEEN ? AND ?';
const PROFILE_EMPLOYMENT = 'LEFT JOIN platform_user_employment employment ON employment.user_id = person.id';

function moodProfile(row) {
  return { id: row.id, name: row.name, tenureYears: completedTenureYears(row.admission_date) };
}

function moodMetrics(row) {
  return {
    checkIns: Number(row.check_ins),
    answers: Number(row.answers),
    average: row.average === null ? null : Number(row.average),
  };
}

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
  constructor(platformStore, { awardMood } = {}) {
    this.platformStore = platformStore;
    this.awardMood = awardMood;
  }

  async initialize() {
    for (const schema of SCHEMAS) await this.platformStore.pool.query(schema);
  }

  async list(includeInactive) {
    const [rows] = await this.platformStore.pool.execute(`SELECT item.* ${CATALOG_WITH_PARTNER}
      WHERE item.deleted_at IS NULL
        AND (? OR (${VISIBLE_ITEM}))
      ORDER BY item.starts_at, item.title, item.id`, [includeInactive]);
    const catalog = Object.fromEntries(CLUB_COLLECTIONS.map(collection => [collection, []]));
    for (const row of rows) catalog[row.collection].push(asRecord(row));
    return catalog;
  }

  async getMoodHistory(userId, firstDay, today) {
    const [rows] = await this.platformStore.pool.execute(`SELECT checkin.check_date, checkin.mood, shared.user_id IS NOT NULL AS shared_with_rh
      FROM platform_club_checkins checkin LEFT JOIN platform_club_rh_checkins shared
        ON shared.user_id = checkin.user_id AND shared.check_date = checkin.check_date
      WHERE checkin.user_id = ? AND checkin.check_date BETWEEN ? AND ?
      ORDER BY checkin.check_date DESC`, [userId, firstDay, today]);
    return rows.map(row => ({ date: row.check_date, mood: row.mood, sharedWithRh: Number(row.shared_with_rh) === 1 }));
  }

  async saveMood(userId, today, mood, shareWithRh = false) {
    await this.platformStore.transaction(async connection => {
      await connection.execute(`INSERT INTO platform_club_checkins (user_id, check_date, mood)
        VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE mood = COALESCE(VALUES(mood), mood)`, [userId, today, mood]);
      if (shareWithRh) {
        await connection.execute(`INSERT INTO platform_club_rh_checkins (user_id, check_date)
          VALUES (?, ?) ON DUPLICATE KEY UPDATE check_date = VALUES(check_date)`, [userId, today]);
      } else {
        await connection.execute('DELETE FROM platform_club_rh_checkins WHERE user_id = ? AND check_date = ?', [userId, today]);
      }
      if (mood !== null) await this.awardMood?.(connection, userId, 'mood', today);
    });
  }

  async saveAnonymousMoodComment(userId, today, weekStart, comment) {
    return this.platformStore.transaction(async connection => {
      const [[checkin]] = await connection.execute(`SELECT mood FROM platform_club_checkins
        WHERE user_id = ? AND check_date = ? FOR UPDATE`, [userId, today]);
      if (checkin?.mood !== 1 && checkin?.mood !== 2) {
        throw new ApiError(409, 'CLUB_MOOD_COMMENT_UNAVAILABLE', 'O comentário está disponível após uma resposta triste no termômetro de hoje.');
      }
      try {
        await connection.execute(`INSERT INTO platform_club_mood_comment_claims (user_id, check_date)
          VALUES (?, ?)`, [userId, today]);
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return false;
        throw error;
      }
      // O controle de duplicidade não referencia o texto. Só a semana é armazenada com a mensagem.
      await connection.execute(`INSERT INTO platform_club_mood_comments (id, week_start, comment_text)
        VALUES (?, ?, ?)`, [randomUUID(), weekStart, comment]);
      return true;
    });
  }

  async getAnonymousMoodComments(firstWeek, currentWeek, minimum) {
    const [rows] = await this.platformStore.pool.execute(`SELECT message.week_start, message.comment_text
      FROM platform_club_mood_comments message
      JOIN (
        SELECT DATE_SUB(check_date, INTERVAL WEEKDAY(check_date) DAY) AS week_start
        FROM platform_club_mood_comment_claims
        WHERE check_date >= ? AND check_date < ?
        GROUP BY week_start HAVING COUNT(DISTINCT user_id) >= ?
      ) released ON message.week_start = released.week_start
      ORDER BY message.week_start DESC, message.id`, [firstWeek, currentWeek, minimum]);
    const weeks = new Map();
    for (const { week_start: start, comment_text: comment } of rows) {
      if (!weeks.has(start)) weeks.set(start, { start, comments: [] });
      weeks.get(start).comments.push(comment);
    }
    return [...weeks.values()];
  }

  async getRhMoodOverview(firstDay, today) {
    return this.platformStore.transaction(async connection => {
      const period = [firstDay, today];
      const [days] = await connection.execute(`SELECT shared.check_date, COUNT(*) AS check_ins,
        COUNT(checkin.mood) AS answers, ROUND(AVG(checkin.mood), 2) AS average,
        SUM(checkin.mood = 1) AS mood1, SUM(checkin.mood = 2) AS mood2, SUM(checkin.mood = 3) AS mood3,
        SUM(checkin.mood = 4) AS mood4, SUM(checkin.mood = 5) AS mood5
        ${SHARED_CHECK_INS} ${SHARED_DATES} GROUP BY shared.check_date ORDER BY shared.check_date`, period);
      const [people] = await connection.execute(`SELECT person.id, person.name, employment.admission_date, COUNT(*) AS check_ins,
        COUNT(checkin.mood) AS answers, ROUND(AVG(checkin.mood), 2) AS average, MAX(shared.check_date) AS last_date
        ${SHARED_CHECK_INS} ${PROFILE_EMPLOYMENT} ${SHARED_DATES}
        GROUP BY person.id, person.name, employment.admission_date ORDER BY person.name, person.id`, period);
      const totals = { checkIns: 0, answers: 0, average: null, counts: [0, 0, 0, 0, 0] };
      const trend = days.map(row => {
        const metrics = moodMetrics(row);
        totals.checkIns += metrics.checkIns;
        totals.answers += metrics.answers;
        [row.mood1, row.mood2, row.mood3, row.mood4, row.mood5].forEach((count, index) => {
          totals.counts[index] += Number(count);
        });
        return { date: row.check_date, ...metrics };
      });
      if (totals.answers) {
        const score = totals.counts.reduce((sum, count, index) => sum + count * (index + 1), 0);
        totals.average = Math.round(score * 100 / totals.answers) / 100;
      }
      const profiles = people.map(row => ({ ...moodProfile(row), ...moodMetrics(row), lastDate: row.last_date }));
      return { totals, trend, profiles };
    });
  }

  async getRhMoodProfile(userId, firstDay, today) {
    const [rows] = await this.platformStore.pool.execute(`SELECT person.id, person.name, employment.admission_date, shared.check_date, checkin.mood
      ${SHARED_CHECK_INS} ${PROFILE_EMPLOYMENT} ${SHARED_DATES} AND shared.user_id = ?
      ORDER BY shared.check_date DESC`, [firstDay, today, userId]);
    if (!rows.length) return null;
    return {
      profile: moodProfile(rows[0]),
      history: rows.map(row => ({ date: row.check_date, mood: row.mood })),
    };
  }

  async getMoodSummary(firstDay, today, minimum) {
    const [rows] = await this.platformStore.pool.execute(`SELECT check_date, COUNT(*) AS total, ROUND(AVG(mood), 2) AS average,
      SUM(mood = 1) AS mood1, SUM(mood = 2) AS mood2, SUM(mood = 3) AS mood3, SUM(mood = 4) AS mood4, SUM(mood = 5) AS mood5
      FROM platform_club_checkins WHERE check_date >= ? AND check_date < ? AND mood IS NOT NULL
      GROUP BY check_date HAVING COUNT(*) >= ? ORDER BY check_date DESC`, [firstDay, today, minimum]);
    return rows.map(row => ({
      date: row.check_date, total: Number(row.total), average: Number(row.average),
      counts: [row.mood1, row.mood2, row.mood3, row.mood4, row.mood5].map(Number),
    }));
  }

  async listSaved(userId) {
    const [rows] = await this.platformStore.pool.execute(`SELECT item.id ${CATALOG_WITH_PARTNER}
      INNER JOIN platform_club_saved saved ON saved.item_id = item.id
      WHERE saved.user_id = ? AND ${SAVABLE_ITEM} ORDER BY item.id`, [userId]);
    return rows.map(row => row.id);
  }

  async addSaved(userId, id) {
    await this.platformStore.pool.execute(`INSERT INTO platform_club_saved (user_id, item_id)
      SELECT ?, item.id ${CATALOG_WITH_PARTNER} WHERE item.id = ? AND ${SAVABLE_ITEM}
      ON DUPLICATE KEY UPDATE item_id = platform_club_saved.item_id`, [userId, id]);
    const ids = await this.listSaved(userId);
    if (!ids.includes(id)) throw new ApiError(404, 'CLUB_NOT_FOUND', 'Registro do Clube indisponível.');
    return ids;
  }

  async removeSaved(userId, id) {
    await this.platformStore.pool.execute('DELETE FROM platform_club_saved WHERE user_id = ? AND item_id = ?', [userId, id]);
    return this.listSaved(userId);
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
