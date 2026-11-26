import { completedTenureYears } from '../platform/employment.mjs';

const PAGE_SIZE = 50;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS platform_chat_rooms (
    room_key VARCHAR(160) NOT NULL PRIMARY KEY
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS platform_chat_messages (
    sequence_no BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    client_id CHAR(36) NOT NULL,
    room_key VARCHAR(160) NOT NULL,
    sender_id CHAR(36) NOT NULL,
    sender_name VARCHAR(100) NOT NULL,
    message_text TEXT NOT NULL,
    reference_type VARCHAR(32) NULL,
    reference_id VARCHAR(160) NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY idx_chat_client (sender_id, client_id),
    KEY idx_chat_room_sequence (room_key, sequence_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS platform_chat_attachments (
    id CHAR(36) NOT NULL PRIMARY KEY,
    message_sequence BIGINT UNSIGNED NOT NULL,
    sort_index SMALLINT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    mime VARCHAR(127) NOT NULL,
    size_bytes INT UNSIGNED NOT NULL,
    payload LONGBLOB NOT NULL,
    KEY idx_chat_attachment_order (message_sequence, sort_index),
    CONSTRAINT fk_chat_attachment_message FOREIGN KEY (message_sequence)
      REFERENCES platform_chat_messages (sequence_no) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS platform_chat_reads (
    user_id CHAR(36) NOT NULL,
    room_key VARCHAR(160) NOT NULL,
    last_sequence BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, room_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS platform_chat_revisions (
    message_sequence BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    edited_at DATETIME(3) NULL,
    deleted_at DATETIME(3) NULL,
    CONSTRAINT fk_chat_revision_message FOREIGN KEY (message_sequence)
      REFERENCES platform_chat_messages (sequence_no) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`
];

const senderEmployment = 'LEFT JOIN platform_user_employment employment ON employment.user_id = m.sender_id';
const messageColumns = 'm.*, rev.edited_at, rev.deleted_at, employment.admission_date AS sender_admission_date';
const revisionJoin = 'LEFT JOIN platform_chat_revisions rev ON rev.message_sequence = m.sequence_no';

function toAttachment(row) {
  return { id: row.id, name: row.name, mime: row.mime, size: Number(row.size_bytes) };
}

function toMessage(row, attachments = []) {
  const deletedAt = sqlDate(row.deleted_at);
  return {
    id: String(row.sequence_no), clientId: row.client_id, roomKey: row.room_key,
    senderId: row.sender_id, senderName: row.sender_name, tenureYears: completedTenureYears(row.sender_admission_date),
    text: deletedAt ? '' : row.message_text,
    createdAt: sqlDate(row.created_at), editedAt: sqlDate(row.edited_at), deletedAt,
    attachments: deletedAt ? [] : attachments,
    reference: !deletedAt && row.reference_type && row.reference_id ? { type: row.reference_type, id: row.reference_id } : null
  };
}

function sqlDate(value) {
  if (value instanceof Date) return value.toISOString();
  return value ? `${value.replace(' ', 'T')}Z` : null;
}

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

export class ChatMySqlStore {
  constructor(pool) { this.pool = pool; }

  async initialize() {
    for (const table of TABLES) await this.pool.query(table);
  }

  async attachmentsFor(executor, messages) {
    if (!messages.length) return [];
    const ids = messages.map(row => String(row.sequence_no));
    const [attachments] = await executor.execute(`SELECT id, message_sequence, name, mime, size_bytes
      FROM platform_chat_attachments WHERE message_sequence IN (${ids.map(() => 'CAST(? AS UNSIGNED)').join(', ')})
      ORDER BY message_sequence, sort_index`, ids);
    const grouped = new Map(ids.map(id => [id, []]));
    for (const row of attachments) grouped.get(String(row.message_sequence)).push(toAttachment(row));
    return messages.map(row => toMessage(row, grouped.get(String(row.sequence_no))));
  }

  async listMessages(roomKey, beforeSequence = null) {
    const [rows] = await this.pool.execute(`SELECT ${messageColumns} FROM platform_chat_messages m ${revisionJoin} ${senderEmployment}
      WHERE m.room_key = ? ${beforeSequence === null ? '' : 'AND m.sequence_no < CAST(? AS UNSIGNED)'}
      ORDER BY m.sequence_no DESC LIMIT ${PAGE_SIZE + 1}`, beforeSequence === null ? [roomKey] : [roomKey, beforeSequence]);
    const messages = await this.attachmentsFor(this.pool, rows.slice(0, PAGE_SIZE).reverse());
    return { messages, hasMore: rows.length > PAGE_SIZE };
  }

  async createMessage(record) {
    const { clientId, roomKey, senderId, senderName, text, attachments = [], reference = null } = record;
    const connection = await this.pool.getConnection();
    let repeated = false;
    try {
      await connection.beginTransaction();
      // Serialize writes in a room so a newer sequence cannot commit before an older one.
      await connection.execute(`INSERT INTO platform_chat_rooms (room_key) VALUES (?)
        ON DUPLICATE KEY UPDATE room_key = VALUES(room_key)`, [roomKey]);
      try {
        await connection.execute(`INSERT INTO platform_chat_messages
          (client_id, room_key, sender_id, sender_name, message_text, reference_type, reference_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [clientId, roomKey, senderId, senderName, text, reference?.type ?? null, reference?.id ?? null, new Date()]);
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        repeated = true;
        await connection.rollback();
      }
      if (!repeated) {
        const [[row]] = await connection.execute(`SELECT m.*, employment.admission_date AS sender_admission_date
          FROM platform_chat_messages m ${senderEmployment}
          WHERE m.sender_id = ? AND m.client_id = ?`, [senderId, clientId]);
        for (const [position, attachment] of attachments.entries()) {
          await connection.execute(`INSERT INTO platform_chat_attachments
            (id, message_sequence, sort_index, name, mime, size_bytes, payload)
            VALUES (?, CAST(? AS UNSIGNED), ?, ?, ?, ?, ?)`,
          [attachment.id, String(row.sequence_no), position, attachment.name, attachment.mime, attachment.size, attachment.data]);
        }
        const [message] = await this.attachmentsFor(connection, [row]);
        await connection.commit();
        return { message, inserted: true };
      }
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    // A fresh read avoids taking an exclusive lock on a duplicate row while other retries are waiting.
    const [[row]] = await this.pool.execute(`SELECT ${messageColumns} FROM platform_chat_messages m ${revisionJoin} ${senderEmployment}
      WHERE m.sender_id = ? AND m.client_id = ? AND m.room_key = ?`, [senderId, clientId, roomKey]);
    if (!row) return { message: null, inserted: false };
    const [message] = await this.attachmentsFor(this.pool, [row]);
    return { message, inserted: false };
  }

  async reviseMessage({ id, roomKey, senderId, text }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[row]] = await connection.execute(`SELECT * FROM platform_chat_messages
        WHERE sequence_no = CAST(? AS UNSIGNED) AND room_key = ? AND sender_id = ? FOR UPDATE`, [id, roomKey, senderId]);
      if (!row) {
        await connection.rollback();
        return { message: null, changed: false };
      }
      const [[metadata]] = await connection.execute(`SELECT rev.edited_at, rev.deleted_at, employment.admission_date AS sender_admission_date
        FROM platform_chat_messages m ${revisionJoin} ${senderEmployment} WHERE m.sequence_no = CAST(? AS UNSIGNED)`, [id]);
      Object.assign(row, metadata);
      const [previous] = await this.attachmentsFor(connection, [row]);
      if (previous.deletedAt || text === previous.text) {
        await connection.commit();
        return { message: previous, changed: false };
      }
      if (text === '' && !previous.attachments.length && !previous.reference) {
        await connection.rollback();
        return { message: null, changed: false, empty: true };
      }
      const revisedAt = new Date(Math.max(Date.now(), Date.parse(previous.editedAt || previous.createdAt) + 1));
      if (text === null) {
        await connection.execute(`UPDATE platform_chat_messages SET message_text = '', reference_type = NULL, reference_id = NULL
          WHERE sequence_no = CAST(? AS UNSIGNED)`, [id]);
        await connection.execute('DELETE FROM platform_chat_attachments WHERE message_sequence = CAST(? AS UNSIGNED)', [id]);
        row.deleted_at = revisedAt;
      } else {
        await connection.execute('UPDATE platform_chat_messages SET message_text = ? WHERE sequence_no = CAST(? AS UNSIGNED)', [text, id]);
        row.message_text = text;
        row.edited_at = revisedAt;
      }
      await connection.execute(`INSERT INTO platform_chat_revisions (message_sequence, edited_at, deleted_at)
        VALUES (CAST(? AS UNSIGNED), ?, ?)
        ON DUPLICATE KEY UPDATE edited_at = VALUES(edited_at), deleted_at = VALUES(deleted_at)`,
      [id, row.edited_at ? new Date(sqlDate(row.edited_at)) : null, row.deleted_at ?? null]);
      const message = toMessage(row, previous.attachments);
      await connection.commit();
      return { message, changed: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getAttachment(id) {
    const [[row]] = await this.pool.execute(`SELECT a.id, a.name, a.mime, a.size_bytes, a.payload, m.room_key
      FROM platform_chat_attachments a JOIN platform_chat_messages m ON m.sequence_no = a.message_sequence
      WHERE a.id = ?`, [id]);
    return row ? { ...toAttachment(row), data: row.payload, roomKey: row.room_key } : null;
  }

  async markRead(userId, roomKey, sequence) {
    const [[row]] = await this.pool.execute(`SELECT 1 FROM platform_chat_messages
      WHERE room_key = ? AND sequence_no = CAST(? AS UNSIGNED)`, [roomKey, sequence]);
    if (!row) return false;
    await this.pool.execute(`INSERT INTO platform_chat_reads (user_id, room_key, last_sequence)
      VALUES (?, ?, CAST(? AS UNSIGNED))
      ON DUPLICATE KEY UPDATE last_sequence = GREATEST(last_sequence, VALUES(last_sequence))`,
    [userId, roomKey, sequence]);
    return true;
  }

  async listRoomActivity(userId, roomKeys) {
    if (!roomKeys.length) return [];
    const [rows] = await this.pool.execute(`SELECT ${messageColumns}, activity.unread
      FROM (
        SELECT history.room_key, MAX(history.sequence_no) latest,
          SUM(history.sender_id <> ? AND history.sequence_no > COALESCE(read_cursor.last_sequence, 0)
            AND history_revision.deleted_at IS NULL) unread
        FROM platform_chat_messages history
        LEFT JOIN platform_chat_reads read_cursor ON read_cursor.user_id = ? AND read_cursor.room_key = history.room_key
        LEFT JOIN platform_chat_revisions history_revision ON history_revision.message_sequence = history.sequence_no
        WHERE history.room_key IN (${placeholders(roomKeys)})
        GROUP BY history.room_key
      ) activity JOIN platform_chat_messages m ON m.sequence_no = activity.latest ${revisionJoin} ${senderEmployment}`, [userId, userId, ...roomKeys]);
    const activity = new Map(rows.map(row => [row.room_key, row]));
    return roomKeys.map(roomKey => {
      const row = activity.get(roomKey);
      return { roomKey, lastMessage: row ? toMessage(row) : null, unread: row ? Number(row.unread) : 0 };
    });
  }
}
