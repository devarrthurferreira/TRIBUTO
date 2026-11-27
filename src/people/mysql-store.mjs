import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { awardMaxcoin, maxHubDay } from '../maxhub/points.mjs';
import { completedTenureYears } from '../platform/employment.mjs';
import { FEEDBACK_RATINGS, goalDetails } from './fields.mjs';

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
  `CREATE TABLE IF NOT EXISTS platform_people_feedback_requests (
    note_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    FOREIGN KEY (note_id) REFERENCES platform_people_notes(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_people_feedback_replies (
    note_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    body TEXT NOT NULL, created_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_people_feedback_details (
    note_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    description TEXT NOT NULL, ratings JSON NOT NULL,
    CONSTRAINT fk_people_feedback_note FOREIGN KEY (note_id) REFERENCES platform_people_notes (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_people_anonymous_feedback (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    sender_key BINARY(32) NOT NULL,
    recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    body TEXT NOT NULL, description TEXT NOT NULL, ratings JSON NOT NULL, created_at DATETIME(3) NOT NULL,
    KEY idx_people_anonymous_recipient (recipient_id), KEY idx_people_anonymous_sender (sender_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_people_review_assignments (
    note_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    response TEXT NULL, responded_at DATETIME(3) NULL,
    CONSTRAINT fk_people_review_note FOREIGN KEY (note_id) REFERENCES platform_people_notes (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_people_plans (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(160) NOT NULL, description TEXT NOT NULL, due_at CHAR(10) NULL,
    status ENUM('draft', 'active', 'completed') NOT NULL,
    created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
    KEY idx_people_plans_owner (owner_id, updated_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_plan_details (
    plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    leader_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL, structure_json LONGTEXT NULL,
    KEY plan_leader (leader_id)
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
const NOTE_FIELDS = `note.*, sender.name AS sender_name, recipient.name AS recipient_name,
    sender_employment.admission_date AS sender_admission_date, recipient_employment.admission_date AS recipient_admission_date`;
const NOTE_PEOPLE = `FROM platform_people_notes note
    JOIN platform_users sender ON sender.id = note.sender_id JOIN platform_users recipient ON recipient.id = note.recipient_id
    LEFT JOIN platform_user_employment sender_employment ON sender_employment.user_id = sender.id
    LEFT JOIN platform_user_employment recipient_employment ON recipient_employment.user_id = recipient.id`;
const FEEDBACK = `SELECT ${NOTE_FIELDS}, details.description, details.ratings, req.note_id AS request_id, reply.body AS reply_text, reply.created_at AS reply_at ${NOTE_PEOPLE}
    LEFT JOIN platform_people_feedback_requests req ON req.note_id = note.id
    LEFT JOIN platform_people_feedback_replies reply ON reply.note_id = note.id
    LEFT JOIN platform_people_feedback_details details ON details.note_id = note.id`;
const ANONYMOUS_FEEDBACK = `SELECT feedback.id, feedback.recipient_id, recipient.name AS recipient_name, feedback.body,
    feedback.description, feedback.ratings, reply.body AS reply_text, reply.created_at AS reply_at, feedback.created_at, feedback.sender_key = ? AS sent_by_me,
    recipient_employment.admission_date AS recipient_admission_date
    FROM platform_people_anonymous_feedback feedback LEFT JOIN platform_people_feedback_replies reply ON reply.note_id = feedback.id JOIN platform_users recipient ON recipient.id = feedback.recipient_id
    LEFT JOIN platform_user_employment recipient_employment ON recipient_employment.user_id = recipient.id`;
// Use only participant keys, dates and ratings for analytics. Feedback text stays in the inbox.
const NAMED_FEEDBACK_FROM = `FROM platform_people_notes n
  LEFT JOIN platform_people_feedback_details d ON d.note_id = n.id
  WHERE n.kind = 'feedback' AND NOT EXISTS
    (SELECT 1 FROM platform_people_feedback_requests r WHERE r.note_id = n.id)`;

function ratingColumns(column) {
  return [...FEEDBACK_RATINGS].map(key => {
    const value = `JSON_EXTRACT(${column}, '$.${key}')`;
    return `COUNT(${value}) AS ${key}_count, SUM(${value}) AS ${key}_sum`;
  }).join(', ');
}

function shiftMonth(month, offset) {
  const date = new Date(month + '-01T12:00:00.000Z');
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

// Find the first instant of the local month without relying on MariaDB's optional time-zone tables.
function monthBoundary(month) {
  const midnight = Date.parse(month + '-01T00:00:00Z');
  let lower = midnight;
  let upper = midnight + 86_400_000;
  while (upper - lower > 1) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (maxHubDay(new Date(middle)).slice(0, 7) < month) lower = middle;
    else upper = middle;
  }
  return new Date(upper);
}

const REVIEWS = `SELECT ${NOTE_FIELDS}, assignment.note_id AS assignment_id, assignment.response, assignment.responded_at ${NOTE_PEOPLE}
    LEFT JOIN platform_people_review_assignments assignment ON assignment.note_id = note.id`;
const MEETINGS = `SELECT meeting.*, organizer.name AS organizer_name, participant.name AS participant_name,
    organizer_employment.admission_date AS organizer_admission_date, participant_employment.admission_date AS participant_admission_date
    FROM platform_people_meetings meeting
    JOIN platform_users organizer ON organizer.id = meeting.organizer_id JOIN platform_users participant ON participant.id = meeting.participant_id
    LEFT JOIN platform_user_employment organizer_employment ON organizer_employment.user_id = organizer.id
    LEFT JOIN platform_user_employment participant_employment ON participant_employment.user_id = participant.id`;

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
  return {
    id: row.id, recipient: { id: row.recipient_id, name: row.recipient_name,
      tenureYears: completedTenureYears(row.recipient_admission_date) }, text: row.body, createdAt: iso(row.created_at),
  };
}

function feedbackRecord(row, userId, anonymous = false) {
  const note = noteRecord(row);
  const sent = anonymous ? Number(row.sent_by_me) === 1 : row.sender_id === userId;
  // Show the local calendar date without exposing an anonymous sender's exact time of entry.
  const createdAt = anonymous && !sent ? `${maxHubDay(new Date(note.createdAt))}T12:00:00.000Z` : note.createdAt;
  return {
    ...note, createdAt, anonymous, isRequest: Boolean(row.request_id), reply: row.reply_text ? {text:row.reply_text, createdAt:iso(row.reply_at)} : null, direction: sent ? 'sent' : 'received',
    sender: anonymous ? null : { id: row.sender_id, name: row.sender_name, tenureYears: completedTenureYears(row.sender_admission_date) },
    description: row.description ?? '',
    ratings: typeof row.ratings === 'string' ? JSON.parse(row.ratings) : row.ratings ?? {},
  };
}

function reviewRecord(row) {
  const response = row.responded_at ? { text: row.response, createdAt: iso(row.responded_at) } : null;
  return {
    ...noteRecord(row), reviewer: { id: row.sender_id, name: row.sender_name, tenureYears: completedTenureYears(row.sender_admission_date) },
    title: row.title,
    status: (response && 'responded') || (row.assignment_id && 'pending') || 'recorded', response,
  };
}

const planSelect = `SELECT p.*, d.structure_json, d.leader_id, leader.name AS leader_name, owner.name AS owner_name
  FROM platform_people_plans p LEFT JOIN platform_plan_details d ON d.plan_id=p.id
  LEFT JOIN platform_users leader ON leader.id=d.leader_id LEFT JOIN platform_users owner ON owner.id=p.owner_id`;

function planRecord(row) {
  return {
    ownerId:row.owner_id, ownerName:row.owner_name, leaderId:row.leader_id, leaderName:row.leader_name,
    structure:row.structure_json ? JSON.parse(row.structure_json) : null,
    id: row.id, title: row.title, description: row.description, dueAt: row.due_at, status: row.status,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function meetingRecord(row) {
  return {
    id: row.id, title: row.title, notes: row.notes, date: row.scheduled_day, time: row.scheduled_time,
    organizer: { id: row.organizer_id, name: row.organizer_name, tenureYears: completedTenureYears(row.organizer_admission_date) },
    participant: { id: row.participant_id, name: row.participant_name, tenureYears: completedTenureYears(row.participant_admission_date) },
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
    if (kind === 'feedback') {
      const senderKey = this.#anonymousFeedbackKey(userId);
      const [named, anonymous] = await Promise.all([
        this.platformStore.rows(`${FEEDBACK} WHERE note.kind = 'feedback' AND (note.sender_id = ? OR note.recipient_id = ?)`,
          [userId, userId]),
        this.platformStore.rows(`${ANONYMOUS_FEEDBACK} WHERE feedback.recipient_id = ? OR feedback.sender_key = ?`,
          [senderKey, userId, senderKey]),
      ]);
      return [...named.map(row => feedbackRecord(row, userId)), ...anonymous.map(row => feedbackRecord(row, userId, true))]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    }
    const scope = all ? '' : ' AND (note.sender_id = ? OR note.recipient_id = ?)';
    const rows = await this.platformStore.rows(`${REVIEWS} WHERE note.kind = 'review'${scope} ORDER BY note.created_at DESC, note.id`,
      all ? [] : [userId, userId]);
    return rows.map(reviewRecord);
  }

  async feedbackAnalytics(userId, month) {
    const lastMonth = month || maxHubDay().slice(0, 7);
    const months = Array.from({length: 6}, (_, i) => ({month: shiftMonth(lastMonth, i - 5), received: 0, sent: 0}));
    const bounds = month ? [monthBoundary(month), monthBoundary(shiftMonth(month, 1))] : [];
    const personalBounds = month ? [monthBoundary(months[0].month), bounds[1]] : [];
    const namedPeriod = month ? ' AND n.created_at >= ? AND n.created_at < ?' : '';
    const anonymousPeriod = month ? ' AND a.created_at >= ? AND a.created_at < ?' : '';
    const senderKey = this.#anonymousFeedbackKey(userId);
    const [personal, namedRaters, anonymousRaters] = await Promise.all([
      this.platformStore.rows(`SELECT n.created_at, n.recipient_id = ? AS received, n.sender_id = ? AS sent, d.ratings
        ${NAMED_FEEDBACK_FROM} AND (n.recipient_id = ? OR n.sender_id = ?)${namedPeriod}
        UNION ALL
        SELECT a.created_at, a.recipient_id = ? AS received, a.sender_key = ? AS sent, a.ratings
        FROM platform_people_anonymous_feedback a WHERE (a.recipient_id = ? OR a.sender_key = ?)${anonymousPeriod}`,
        [userId, userId, userId, userId, ...personalBounds, userId, senderKey, userId, senderKey, ...personalBounds]),
      this.platformStore.rows(`SELECT n.sender_id, ${ratingColumns('d.ratings')} ${NAMED_FEEDBACK_FROM}
        AND d.ratings IS NOT NULL${namedPeriod} GROUP BY n.sender_id`, bounds),
      this.platformStore.rows(`SELECT a.sender_key, ${ratingColumns('a.ratings')} FROM platform_people_anonymous_feedback a
        WHERE 1=1${anonymousPeriod} GROUP BY a.sender_key`, bounds),
    ]);
    const buckets = new Map(months.map(bucket => [bucket.month, bucket]));
    const metrics = Object.fromEntries([...FEEDBACK_RATINGS].map(key => [key, {
      receivedSum: 0, receivedCount: 0, companySum: 0, companyCount: 0, raters: new Set(),
    }]));
    let received = 0;
    let sent = 0;
    for (const row of personal) {
      const rowMonth = maxHubDay(new Date(iso(row.created_at))).slice(0, 7);
      const bucket = buckets.get(rowMonth);
      if (bucket) {
        bucket.received += Number(row.received);
        bucket.sent += Number(row.sent);
      }
      if (month && rowMonth !== month) continue;
      received += Number(row.received);
      sent += Number(row.sent);
      if (!Number(row.received)) continue;
      const ratings = typeof row.ratings === 'string' ? JSON.parse(row.ratings) : row.ratings;
      for (const key of FEEDBACK_RATINGS) {
        if (!ratings?.[key]) continue;
        metrics[key].receivedCount++;
        metrics[key].receivedSum += ratings[key];
      }
    }
    for (const row of [...namedRaters, ...anonymousRaters]) {
      // Deduplicate the same rater across named and anonymous notes inside the store.
      const rater = (row.sender_key || this.#anonymousFeedbackKey(row.sender_id)).toString('hex');
      for (const key of FEEDBACK_RATINGS) {
        const count = Number(row[key + '_count']);
        if (!count) continue;
        metrics[key].raters.add(rater);
        metrics[key].companySum += Number(row[key + '_sum']);
        metrics[key].companyCount += count;
      }
    }
    const criteria = Object.fromEntries(Object.entries(metrics).map(([key, m]) => [key, {
      received: m.receivedCount ? m.receivedSum / m.receivedCount : null,
      company: m.raters.size >= MIN_SURVEY_RESPONSES ? m.companySum / m.companyCount : null,
    }]));
    return {received, sent, criteria, months};
  }

  async replyToFeedback(userId, id, text) {
    return this.platformStore.transaction(async connection => {
      const [records] = await connection.execute(`SELECT id FROM platform_people_notes
        WHERE id = ? AND kind = 'feedback' AND recipient_id = ?
        UNION ALL SELECT id FROM platform_people_anonymous_feedback WHERE id = ? AND recipient_id = ?`, [id,userId,id,userId]);
      if (!records.length) return null;
      try {
        await connection.execute('INSERT INTO platform_people_feedback_replies (note_id, body, created_at) VALUES (?, ?, ?)', [id,text,new Date()]);
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw new ApiError(409,'ALREADY_REPLIED','Este registro já foi respondido.');
        throw error;
      }
      return { saved:true };
    });
  }

  #anonymousFeedbackKey(userId) {
    return createHmac('sha256', this.#respondentSecret).update(`feedback-sender:${userId}`).digest();
  }

  async createNote(kind, userId, { recipientId, title = null, text, description = '', anonymous = false, ratings = {}, isRequest = false, requestId = null }) {
    return this.platformStore.transaction(async connection => {
      if (requestId) {
        const [[original]] = await connection.execute(`SELECT n.sender_id FROM platform_people_notes n
          JOIN platform_people_feedback_requests r ON r.note_id = n.id
          WHERE n.id = ? AND n.recipient_id = ? AND n.sender_id = ? FOR UPDATE`, [requestId,userId,recipientId]);
        if (!original) return null;
        try {
          await connection.execute('INSERT INTO platform_people_feedback_replies (note_id,body,created_at) VALUES (?,?,?)',
            [requestId,'Feedback enviado.',new Date()]);
        } catch (error) {
          if (error.code === 'ER_DUP_ENTRY') throw new ApiError(409,'ALREADY_REPLIED','Esta solicitação já foi atendida.');
          throw error;
        }
      }
      await requireOtherParticipant(connection, userId, recipientId);
      const id = randomUUID();
      const now = new Date();
      if (kind === 'feedback' && anonymous) {
        const senderKey = this.#anonymousFeedbackKey(userId);
        await connection.execute(`INSERT INTO platform_people_anonymous_feedback
          (id, sender_key, recipient_id, body, description, ratings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, senderKey, recipientId, text, description, JSON.stringify(ratings), now]);
        // A reward would identify the anonymous sender through changes in the shared ranking.
        const [[row]] = await connection.execute(`${ANONYMOUS_FEEDBACK} WHERE feedback.id = ?`, [senderKey, id]);
        return feedbackRecord(row, userId, true);
      }
      await connection.execute(`INSERT INTO platform_people_notes (id, kind, sender_id, recipient_id, title, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, kind, userId, recipientId, title, text, now]);
      if (kind === 'review') {
        await connection.execute('INSERT INTO platform_people_review_assignments (note_id) VALUES (?)', [id]);
        const [[row]] = await connection.execute(`${REVIEWS} WHERE note.id = ?`, [id]);
        return reviewRecord(row);
      }
      if (description || Object.keys(ratings).length) {
        await connection.execute('INSERT INTO platform_people_feedback_details (note_id, description, ratings) VALUES (?, ?, ?)',
          [id, description, JSON.stringify(ratings)]);
      }
      if (isRequest) await connection.execute('INSERT INTO platform_people_feedback_requests (note_id) VALUES (?)', [id]);
      else await awardMaxcoin(connection, userId, 'feedback', id);
      const [[row]] = await connection.execute(`${FEEDBACK} WHERE note.id = ?`, [id]);
      return feedbackRecord(row, userId);
    });
  }

  async listAvailableReviews(userId) {
    const rows = await this.platformStore.rows(`${REVIEWS} WHERE note.kind = 'review' AND note.recipient_id = ?
      AND assignment.note_id IS NOT NULL AND assignment.responded_at IS NULL ORDER BY note.created_at DESC, note.id`, [userId]);
    return rows.map(reviewRecord);
  }

  async respondToReview(userId, id, { text }) {
    return this.platformStore.transaction(async connection => {
      const [[assignment]] = await connection.execute(`SELECT assignment.response, assignment.responded_at
        FROM platform_people_review_assignments assignment
        JOIN platform_people_notes note ON note.id = assignment.note_id
        WHERE note.kind = 'review' AND note.recipient_id = ? AND assignment.note_id = ? FOR UPDATE`, [userId, id]);
      if (!assignment) return null;
      if (assignment.responded_at) {
        if (assignment.response !== text) throw new ApiError(409, 'PEOPLE_REVIEW_RESPONDED', 'Esta avaliação já foi respondida.');
      } else {
        await connection.execute('UPDATE platform_people_review_assignments SET response = ?, responded_at = ? WHERE note_id = ?',
          [text, new Date(), id]);
      }
      const [[row]] = await connection.execute(`${REVIEWS} WHERE note.id = ?`, [id]);
      return reviewRecord(row);
    });
  }

  async listPlans(userId) {
    const rows = await this.platformStore.rows(`${planSelect} WHERE p.owner_id=? OR d.leader_id=? ORDER BY p.created_at DESC,p.id`, [userId,userId]);
    return rows.map(planRecord);
  }

  async createPlan(userId, { title, description, dueAt, status, leaderId, structure }) {
    return this.platformStore.transaction(async connection => {
      const id = randomUUID();
      const now = new Date();
      await connection.execute(`INSERT INTO platform_people_plans (id, owner_id, title, description, due_at, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, userId, title, description, dueAt, status, now, now]);
      if (leaderId) {
        const [[leader]]=await connection.execute('SELECT id FROM platform_users WHERE id=? AND active=1',[leaderId]);
        if(!leader || leaderId===userId) throw new ApiError(400,'INVALID_LEADER','Selecione uma liderança ativa.');
      }
      if(structure || leaderId) await connection.execute('INSERT INTO platform_plan_details (plan_id,leader_id,structure_json) VALUES (?,?,?)',
        [id,leaderId || null,structure ? JSON.stringify(structure) : null]);
      if (status === 'active') await awardMaxcoin(connection, userId, 'pdi_active', id);
      return { id, title, description, dueAt, status, createdAt: iso(now), updatedAt: iso(now) };
    });
  }

  async updatePlan(userId, id, changes) {
    return this.platformStore.transaction(async connection => {
      const [[row]] = await connection.execute('SELECT * FROM platform_people_plans WHERE id = ? AND owner_id = ? FOR UPDATE', [id, userId]);
      if (!row) return null;
      const current = planRecord(row);
      if(changes.version && changes.version!==current.updatedAt) throw new ApiError(409,'PLAN_VERSION','O plano mudou. Reabra para atualizar.');
      if(changes.structure) await connection.execute(`INSERT INTO platform_plan_details (plan_id,structure_json) VALUES (?,?)
        ON DUPLICATE KEY UPDATE structure_json=VALUES(structure_json)`,[id,JSON.stringify(changes.structure)]);
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
