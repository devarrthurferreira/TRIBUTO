import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { goalDetails } from './fields.mjs';

export const MIN_SURVEY_RESPONSES = 3;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS platform_people_goals (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(160) NOT NULL, description TEXT NOT NULL, due_at CHAR(10) NULL,
    progress TINYINT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL, KEY idx_people_goals_owner (owner_id, updated_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_people_surveys (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    title VARCHAR(160) NOT NULL, question VARCHAR(300) NOT NULL,
    created_at DATETIME(3) NOT NULL, closed_at DATETIME(3) NULL,
    KEY idx_people_surveys_created (created_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_people_survey_responses (
    survey_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    respondent_key BINARY(32) NOT NULL, rating TINYINT UNSIGNED NOT NULL,
    PRIMARY KEY (survey_id, respondent_key),
    CONSTRAINT fk_people_response_survey FOREIGN KEY (survey_id) REFERENCES platform_people_surveys (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_people_settings (
    id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    secret_key BINARY(32) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

function iso(value) {
  return (value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`)).toISOString();
}

function goalRecord(row) {
  return goalDetails({}, {
    id: row.id, title: row.title, description: row.description, dueAt: row.due_at,
    progress: Number(row.progress), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  });
}

function surveyRecord(row, myRating, results) {
  return {
    id: row.id, title: row.title, question: row.question, status: row.closed_at ? 'closed' : 'open',
    createdAt: iso(row.created_at), updatedAt: iso(row.closed_at ?? row.created_at),
    myRating: myRating == null ? null : Number(myRating), results: results ?? null,
  };
}

function aggregateResults(row) {
  return {
    count: Number(row.total), average: Number(Number(row.mean).toFixed(2)),
    distribution: [row.n1, row.n2, row.n3, row.n4, row.n5].map(Number),
  };
}

export class PeopleMySqlStore {
  #respondentSecret;

  constructor(platformStore) { this.platformStore = platformStore; }

  async initialize() {
    for (const statement of SCHEMA) await this.platformStore.pool.query(statement);
    const id = 'survey-respondent-key';
    await this.platformStore.pool.execute(`INSERT INTO platform_people_settings (id, secret_key)
      VALUES (?, ?) ON DUPLICATE KEY UPDATE id = id`, [id, randomBytes(32)]);
    const key = await this.platformStore.one('SELECT secret_key FROM platform_people_settings WHERE id = ?', [id]);
    this.#respondentSecret = key.secret_key;
  }

  async listGoals(ownerId) {
    const rows = await this.platformStore.rows(`SELECT * FROM platform_people_goals WHERE owner_id = ?
      ORDER BY updated_at DESC, id`, [ownerId]);
    return rows.map(goalRecord);
  }

  async createGoal(ownerId, changes) {
    const id = randomUUID();
    const now = new Date();
    const details = goalDetails({}, changes);
    await this.platformStore.pool.execute(`INSERT INTO platform_people_goals
      (id, owner_id, title, description, due_at, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ownerId, details.title, details.description, details.dueAt, details.progress, now, now]);
    return { ...details, id, createdAt: iso(now), updatedAt: iso(now) };
  }

  async updateGoal(ownerId, id, changes) {
    return this.platformStore.transaction(async connection => {
      const [[row]] = await connection.execute('SELECT * FROM platform_people_goals WHERE id = ? AND owner_id = ? FOR UPDATE', [id, ownerId]);
      if (!row) return null;
      const current = goalRecord(row);
      const details = goalDetails(current, changes);
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1));
      await connection.execute(`UPDATE platform_people_goals SET title = ?, description = ?, due_at = ?, progress = ?, updated_at = ?
        WHERE id = ? AND owner_id = ?`, [details.title, details.description, details.dueAt, details.progress, updatedAt, id, ownerId]);
      return { ...details, updatedAt: iso(updatedAt) };
    });
  }

  async removeGoal(ownerId, id) {
    const [result] = await this.platformStore.pool.execute('DELETE FROM platform_people_goals WHERE id = ? AND owner_id = ?', [id, ownerId]);
    return result.affectedRows > 0;
  }

  respondentKey(surveyId, userId) {
    return createHmac('sha256', this.#respondentSecret).update(`${surveyId}:${userId}`).digest();
  }

  async surveyResults(connection, ids) {
    if (!ids.length) return new Map();
    const [rows] = await connection.execute(`SELECT response.survey_id, COUNT(*) AS total, AVG(response.rating) AS mean,
        SUM(response.rating = 1) AS n1, SUM(response.rating = 2) AS n2, SUM(response.rating = 3) AS n3,
        SUM(response.rating = 4) AS n4, SUM(response.rating = 5) AS n5
      FROM platform_people_survey_responses response
      JOIN platform_people_surveys survey ON response.survey_id = survey.id AND survey.closed_at IS NOT NULL
      WHERE response.survey_id IN (${ids.map(() => '?').join(',')})
      GROUP BY response.survey_id HAVING COUNT(*) >= ?`, [...ids, MIN_SURVEY_RESPONSES]);
    return new Map(rows.map(row => [row.survey_id, aggregateResults(row)]));
  }

  async surveyOwnRatings(connection, ids, userId) {
    if (!ids.length) return new Map();
    const [rows] = await connection.execute(`SELECT survey_id, rating FROM platform_people_survey_responses
      WHERE (survey_id, respondent_key) IN (${ids.map(() => '(?, ?)').join(',')})`,
    ids.flatMap(id => [id, this.respondentKey(id, userId)]));
    return new Map(rows.map(row => [row.survey_id, row.rating]));
  }

  async listSurveys(userId) {
    return this.platformStore.transaction(async connection => {
      const [surveys] = await connection.execute('SELECT * FROM platform_people_surveys ORDER BY closed_at IS NOT NULL, created_at DESC, id');
      const items = [];
      for (let offset = 0; offset < surveys.length; offset += 100) {
        const batch = surveys.slice(offset, offset + 100);
        const ratings = await this.surveyOwnRatings(connection, batch.map(row => row.id), userId);
        const results = await this.surveyResults(connection, batch.filter(row => row.closed_at).map(row => row.id));
        for (const row of batch) items.push(surveyRecord(row, ratings.get(row.id), results.get(row.id)));
      }
      return items;
    });
  }

  async createSurvey(userId, { title, question }) {
    return this.platformStore.transaction(async connection => {
      const row = { id: randomUUID(), title, question, created_at: new Date(), closed_at: null };
      await connection.execute('INSERT INTO platform_people_surveys (id, title, question, created_at) VALUES (?, ?, ?, ?)',
        [row.id, title, question, row.created_at]);
      await this.platformStore.insertAudit(connection, 'people.survey.create', userId, row.id);
      return surveyRecord(row);
    });
  }

  async closeSurvey(userId, id) {
    return this.platformStore.transaction(async connection => {
      const [[row]] = await connection.execute('SELECT * FROM platform_people_surveys WHERE id = ? FOR UPDATE', [id]);
      if (!row) return null;
      if (!row.closed_at) {
        row.closed_at = new Date();
        await connection.execute('UPDATE platform_people_surveys SET closed_at = ? WHERE id = ?', [row.closed_at, id]);
        await this.platformStore.insertAudit(connection, 'people.survey.close', userId, id);
      }
      const ratings = await this.surveyOwnRatings(connection, [id], userId);
      const results = await this.surveyResults(connection, [id]);
      return surveyRecord(row, ratings.get(id), results.get(id));
    });
  }

  async respondToSurvey(userId, id, rating) {
    return this.platformStore.transaction(async connection => {
      const [[row]] = await connection.execute('SELECT * FROM platform_people_surveys WHERE id = ? FOR UPDATE', [id]);
      if (!row) return null;
      if (row.closed_at) throw new ApiError(409, 'PEOPLE_SURVEY_CLOSED', 'A pesquisa foi encerrada.');
      const respondentKey = this.respondentKey(id, userId);
      await connection.execute(`INSERT INTO platform_people_survey_responses (survey_id, respondent_key, rating)
        VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rating = ?`, [id, respondentKey, rating, rating]);
      return surveyRecord(row, rating);
    });
  }
}
