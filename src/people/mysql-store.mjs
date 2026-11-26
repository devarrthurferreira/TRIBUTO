import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { awardMaxcoin, maxHubDay } from '../maxhub/points.mjs';
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
  `CREATE TABLE IF NOT EXISTS platform_people_survey_kinds (
    survey_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    kind VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    CONSTRAINT fk_people_kind_survey FOREIGN KEY (survey_id) REFERENCES platform_people_surveys (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_people_goal_checkins (
    goal_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    checkin_day CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    progress TINYINT UNSIGNED NOT NULL, notes TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (goal_id, checkin_day),
    CONSTRAINT fk_people_checkin_goal FOREIGN KEY (goal_id) REFERENCES platform_people_goals (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_people_notes (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    kind ENUM('feedback', 'review') NOT NULL,
    sender_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(160) NULL, body TEXT NOT NULL, created_at DATETIME(3) NOT NULL,
    KEY idx_people_notes_sender (kind, sender_id, created_at),
    KEY idx_people_notes_recipient (kind, recipient_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_people_plans (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(160) NOT NULL, description TEXT NOT NULL, due_at CHAR(10) NULL,
    status ENUM('draft', 'active', 'completed') NOT NULL,
    created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
    KEY idx_people_plans_owner (owner_id, updated_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_people_meetings (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    organizer_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    participant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(160) NOT NULL, notes TEXT NOT NULL, scheduled_day CHAR(10) NOT NULL, scheduled_time CHAR(5) NULL,
    created_at DATETIME(3) NOT NULL, completed_at DATETIME(3) NULL,
    KEY idx_people_meetings_organizer (organizer_id, scheduled_day),
    KEY idx_people_meetings_participant (participant_id, scheduled_day)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const SURVEYS = `SELECT survey.*, kind.kind FROM platform_people_surveys survey
    LEFT JOIN platform_people_survey_kinds kind ON kind.survey_id = survey.id`;
const NOTES = `SELECT note.*, sender.name AS sender_name, recipient.name AS recipient_name FROM platform_people_notes note
    JOIN platform_users sender ON sender.id = note.sender_id JOIN platform_users recipient ON recipient.id = note.recipient_id`;
const MEETINGS = `SELECT meeting.*, organizer.name AS organizer_name, participant.name AS participant_name FROM platform_people_meetings meeting
    JOIN platform_users organizer ON organizer.id = meeting.organizer_id JOIN platform_users participant ON participant.id = meeting.participant_id`;

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
    id: row.id, title: row.title, question: row.question, kind: row.kind ?? 'engagement', status: row.closed_at ? 'closed' : 'open',
    createdAt: iso(row.created_at), updatedAt: iso(row.closed_at ?? row.created_at),
    myRating: myRating == null ? null : Number(myRating), results: results ?? null,
  };
}

function checkInRecord(row) {
  return { day: row.checkin_day, progress: Number(row.progress), notes: row.notes, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function noteRecord(row) {
  const from = { id: row.sender_id, name: row.sender_name };
  return {
    id: row.id, recipient: { id: row.recipient_id, name: row.recipient_name }, text: row.body, createdAt: iso(row.created_at),
    ...(row.kind === 'review' ? { reviewer: from, title: row.title } : { sender: from }),
  };
}

function planRecord(row) {
  return {
    id: row.id, title: row.title, description: row.description, dueAt: row.due_at, status: row.status,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function meetingRecord(row) {
  return {
    id: row.id, title: row.title, notes: row.notes, date: row.scheduled_day, time: row.scheduled_time,
    organizer: { id: row.organizer_id, name: row.organizer_name }, participant: { id: row.participant_id, name: row.participant_name },
    status: row.completed_at ? 'completed' : 'scheduled',
    createdAt: iso(row.created_at), completedAt: row.completed_at ? iso(row.completed_at) : null,
  };
}

async function requireOtherParticipant(connection, actorId, personId) {
  if (actorId === personId) throw new ApiError(400, 'PEOPLE_OTHER_PERSON_REQUIRED', 'Selecione outra pessoa da equipe.');
  const [[person]] = await connection.execute('SELECT id FROM platform_users WHERE id = ? AND active = 1 FOR UPDATE', [personId]);
  if (!person) throw new ApiError(404, 'PEOPLE_NOT_FOUND', 'Pessoa não encontrada.');
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

  async listGoalCheckIns(ownerId, id) {
    const rows = await this.platformStore.rows(`SELECT checkin.* FROM platform_people_goals goal
      LEFT JOIN platform_people_goal_checkins checkin ON checkin.goal_id = goal.id
      WHERE goal.id = ? AND goal.owner_id = ? ORDER BY checkin.checkin_day DESC`, [id, ownerId]);
    return rows.length ? rows.filter(row => row.goal_id).map(checkInRecord) : null;
  }

  async checkInGoal(ownerId, id, { progress, notes }) {
    return this.platformStore.transaction(async connection => {
      const [[goal]] = await connection.execute('SELECT * FROM platform_people_goals WHERE id = ? AND owner_id = ? FOR UPDATE', [id, ownerId]);
      if (!goal) return null;
      const now = new Date();
      const day = maxHubDay(now);
      const updatedAt = new Date(Math.max(now.getTime(), Date.parse(iso(goal.updated_at)) + 1));
      await connection.execute(`INSERT INTO platform_people_goal_checkins (goal_id, checkin_day, progress, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE progress = ?, notes = ?, updated_at = ?`,
      [id, day, progress, notes, now, updatedAt, progress, notes, updatedAt]);
      await connection.execute('UPDATE platform_people_goals SET progress = ?, updated_at = ? WHERE id = ?', [progress, updatedAt, id]);
      await awardMaxcoin(connection, ownerId, 'objective', `${id}:${day}`);
      const [[checkIn]] = await connection.execute('SELECT * FROM platform_people_goal_checkins WHERE goal_id = ? AND checkin_day = ?', [id, day]);
      return { item: goalRecord({ ...goal, progress, updated_at: updatedAt }), checkIn: checkInRecord(checkIn) };
    });
  }

  async listNotes(kind, userId, all = false) {
    const scope = all ? '' : ' AND (note.sender_id = ? OR note.recipient_id = ?)';
    const rows = await this.platformStore.rows(`${NOTES} WHERE note.kind = ?${scope} ORDER BY note.created_at DESC, note.id`,
      all ? [kind] : [kind, userId, userId]);
    return rows.map(noteRecord);
  }

  async createNote(kind, userId, { recipientId, title = null, text }) {
    return this.platformStore.transaction(async connection => {
      await requireOtherParticipant(connection, userId, recipientId);
      const id = randomUUID();
      await connection.execute(`INSERT INTO platform_people_notes (id, kind, sender_id, recipient_id, title, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, kind, userId, recipientId, title, text, new Date()]);
      if (kind === 'feedback') await awardMaxcoin(connection, userId, 'feedback', id);
      const [[row]] = await connection.execute(`${NOTES} WHERE note.id = ?`, [id]);
      return noteRecord(row);
    });
  }

  async listPlans(userId) {
    const rows = await this.platformStore.rows('SELECT * FROM platform_people_plans WHERE owner_id = ? ORDER BY updated_at DESC, id', [userId]);
    return rows.map(planRecord);
  }

  async createPlan(userId, { title, description, dueAt, status }) {
    return this.platformStore.transaction(async connection => {
      const id = randomUUID();
      const now = new Date();
      await connection.execute(`INSERT INTO platform_people_plans (id, owner_id, title, description, due_at, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, userId, title, description, dueAt, status, now, now]);
      if (status === 'active') await awardMaxcoin(connection, userId, 'pdi_active', id);
      return { id, title, description, dueAt, status, createdAt: iso(now), updatedAt: iso(now) };
    });
  }

  async updatePlan(userId, id, changes) {
    return this.platformStore.transaction(async connection => {
      const [[row]] = await connection.execute('SELECT * FROM platform_people_plans WHERE id = ? AND owner_id = ? FOR UPDATE', [id, userId]);
      if (!row) return null;
      const current = planRecord(row);
      const plan = { ...current, ...changes };
      const transition = current.status !== plan.status;
      if (transition && !((current.status === 'draft' && plan.status === 'active') || (current.status === 'active' && plan.status === 'completed'))) {
        throw new ApiError(409, 'PEOPLE_PLAN_STATUS', 'A mudança de status solicitada não está disponível para este plano.');
      }
      const now = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1));
      await connection.execute(`UPDATE platform_people_plans SET title = ?, description = ?, due_at = ?, status = ?, updated_at = ? WHERE id = ?`,
        [plan.title, plan.description, plan.dueAt, plan.status, now, id]);
      if (transition) await awardMaxcoin(connection, userId, plan.status === 'active' ? 'pdi_active' : 'pdi_complete', id);
      return { ...plan, updatedAt: iso(now) };
    });
  }

  async listMeetings(userId) {
    const rows = await this.platformStore.rows(`${MEETINGS} WHERE meeting.organizer_id = ? OR meeting.participant_id = ?
      ORDER BY meeting.completed_at IS NOT NULL, meeting.scheduled_day DESC, meeting.scheduled_time DESC, meeting.id`, [userId, userId]);
    return rows.map(meetingRecord);
  }

  async createMeeting(userId, { participantId, title, notes, date, time }) {
    return this.platformStore.transaction(async connection => {
      await requireOtherParticipant(connection, userId, participantId);
      const id = randomUUID();
      await connection.execute(`INSERT INTO platform_people_meetings (id, organizer_id, participant_id, title, notes, scheduled_day, scheduled_time, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, userId, participantId, title, notes, date, time, new Date()]);
      const [[row]] = await connection.execute(`${MEETINGS} WHERE meeting.id = ?`, [id]);
      return meetingRecord(row);
    });
  }

  async completeMeeting(userId, id) {
    return this.platformStore.transaction(async connection => {
      const [[meeting]] = await connection.execute(`SELECT completed_at FROM platform_people_meetings
        WHERE id = ? AND (organizer_id = ? OR participant_id = ?) FOR UPDATE`, [id, userId, userId]);
      if (!meeting) return null;
      if (!meeting.completed_at) {
        await connection.execute('UPDATE platform_people_meetings SET completed_at = ? WHERE id = ?', [new Date(), id]);
        await awardMaxcoin(connection, userId, 'one_on_one', id);
      }
      const [[row]] = await connection.execute(`${MEETINGS} WHERE meeting.id = ?`, [id]);
      return meetingRecord(row);
    });
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
      const [surveys] = await connection.execute(`${SURVEYS} ORDER BY survey.closed_at IS NOT NULL, survey.created_at DESC, survey.id`);
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

  async createSurvey(userId, { title, question, kind = 'engagement' }) {
    return this.platformStore.transaction(async connection => {
      const row = { id: randomUUID(), title, question, kind, created_at: new Date(), closed_at: null };
      await connection.execute('INSERT INTO platform_people_surveys (id, title, question, created_at) VALUES (?, ?, ?, ?)',
        [row.id, title, question, row.created_at]);
      if (kind !== 'engagement') await connection.execute('INSERT INTO platform_people_survey_kinds (survey_id, kind) VALUES (?, ?)', [row.id, kind]);
      await this.platformStore.insertAudit(connection, 'people.survey.create', userId, row.id);
      return surveyRecord(row);
    });
  }

  async closeSurvey(userId, id) {
    return this.platformStore.transaction(async connection => {
      const [[row]] = await connection.execute(`${SURVEYS} WHERE survey.id = ? FOR UPDATE`, [id]);
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
      const [[row]] = await connection.execute(`${SURVEYS} WHERE survey.id = ? FOR UPDATE`, [id]);
      if (!row) return null;
      if (row.closed_at) throw new ApiError(409, 'PEOPLE_SURVEY_CLOSED', 'A pesquisa foi encerrada.');
      const respondentKey = this.respondentKey(id, userId);
      const [[previous]] = await connection.execute('SELECT rating FROM platform_people_survey_responses WHERE survey_id = ? AND respondent_key = ?', [id, respondentKey]);
      await connection.execute(`INSERT INTO platform_people_survey_responses (survey_id, respondent_key, rating)
        VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rating = ?`, [id, respondentKey, rating, rating]);
      if (!previous) {
        // The ledger key is deliberately separate from the pseudonym used to store the vote.
        const eventKey = createHmac('sha256', this.#respondentSecret).update(`reward:${id}:${userId}`).digest('hex');
        await awardMaxcoin(connection, userId, row.kind ?? 'engagement', eventKey);
      }
      return surveyRecord(row, rating);
    });
  }
}
