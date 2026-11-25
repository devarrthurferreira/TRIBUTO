import { randomUUID } from 'node:crypto';

const PAGE_SIZE = 50;
const OPEN_WINDOW = 24 * 60 * 60 * 1000;
const TABLES = [
  `CREATE TABLE IF NOT EXISTS platform_wa_conversations (
    id CHAR(36) NOT NULL PRIMARY KEY,
    phone_number_id VARCHAR(32) NOT NULL,
    sector VARCHAR(32) NOT NULL,
    peer_phone VARCHAR(20) NOT NULL,
    peer_name VARCHAR(120) NOT NULL,
    last_inbound_at DATETIME(3) NULL,
    last_activity_at DATETIME(3) NOT NULL,
    UNIQUE KEY idx_wa_conversation_peer (phone_number_id, sector, peer_phone),
    KEY idx_wa_conversation_activity (phone_number_id, sector, last_activity_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS platform_wa_messages (
    sequence_no BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    conversation_id CHAR(36) NOT NULL,
    provider_id VARCHAR(255) NULL,
    client_id CHAR(36) NULL,
    actor_id CHAR(36) NULL,
    direction VARCHAR(8) NOT NULL,
    message_type VARCHAR(32) NOT NULL,
    message_text TEXT NOT NULL,
    delivery_status VARCHAR(20) NOT NULL,
    status_rank TINYINT UNSIGNED NOT NULL DEFAULT 0,
    occurred_at DATETIME(3) NOT NULL,
    UNIQUE KEY idx_wa_provider_message (conversation_id, provider_id),
    UNIQUE KEY idx_wa_client_message (conversation_id, client_id),
    KEY idx_wa_message_sequence (conversation_id, sequence_no),
    CONSTRAINT fk_wa_message_conversation FOREIGN KEY (conversation_id)
      REFERENCES platform_wa_conversations (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS platform_wa_reads (
    user_id CHAR(36) NOT NULL,
    conversation_id CHAR(36) NOT NULL,
    last_sequence BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, conversation_id),
    CONSTRAINT fk_wa_read_conversation FOREIGN KEY (conversation_id)
      REFERENCES platform_wa_conversations (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`
];

function isoDate(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : `${value.replace(' ', 'T')}Z`;
}

export function replyWindowOpen(iso, now = Date.now()) {
  const started = Date.parse(iso);
  return Number.isFinite(started) && started <= now && now - started < OPEN_WINDOW;
}

function message(row) {
  return {
    id: String(row.sequence_no), text: row.message_text, type: row.message_type,
    direction: row.direction, at: isoDate(row.occurred_at), status: row.delivery_status
  };
}

export class WhatsAppMySqlStore {
  constructor(pool) { this.pool = pool; }

  async initialize() {
    for (const table of TABLES) await this.pool.query(table);
  }

  async transaction(callback) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async conversation(connection, scope, id, lock = false) {
    const [[row]] = await connection.execute(`SELECT * FROM platform_wa_conversations
      WHERE id = ? AND phone_number_id = ? AND sector = ? ${lock ? 'FOR UPDATE' : ''}`,
    [id, scope.phoneId, scope.sector]);
    return row ?? null;
  }

  async recordInbound(scope, item) {
    return this.transaction(async (connection) => {
      await connection.execute(`INSERT INTO platform_wa_conversations
        (id, phone_number_id, sector, peer_phone, peer_name, last_inbound_at, last_activity_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE id = id`,
      [randomUUID(), scope.phoneId, scope.sector, item.phone, item.name, item.at, item.at]);
      const [[row]] = await connection.execute(`SELECT id FROM platform_wa_conversations
        WHERE phone_number_id = ? AND sector = ? AND peer_phone = ?`, [scope.phoneId, scope.sector, item.phone]);
      try {
        await connection.execute(`INSERT INTO platform_wa_messages
          (conversation_id, provider_id, direction, message_type, message_text, delivery_status, occurred_at)
          VALUES (?, ?, 'inbound', ?, ?, 'received', ?)`,
        [row.id, item.providerId, item.type, item.text, item.at]);
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        return false;
      }
      await connection.execute(`UPDATE platform_wa_conversations
        SET peer_name = CASE WHEN ? <> '' AND (last_inbound_at IS NULL OR last_inbound_at <= ?) THEN ? ELSE peer_name END,
          last_inbound_at = GREATEST(COALESCE(last_inbound_at, ?), ?),
          last_activity_at = GREATEST(last_activity_at, ?)
        WHERE id = ?`, [item.name, item.at, item.name, item.at, item.at, item.at, row.id]);
      return true;
    });
  }

  async listConversations(scope, userId, offset = 0, { enforceWindow = true } = {}) {
    const [rows] = await this.pool.execute(`SELECT c.id, c.peer_phone, c.peer_name, c.last_inbound_at, c.last_activity_at,
      (SELECT m.message_text FROM platform_wa_messages m
        WHERE m.conversation_id = c.id ORDER BY m.sequence_no DESC LIMIT 1) last_message,
      (SELECT COUNT(*) FROM platform_wa_messages m WHERE m.conversation_id = c.id
        AND m.direction = 'inbound' AND m.sequence_no > COALESCE(cursor_row.last_sequence, 0)) unread
      FROM platform_wa_conversations c
      LEFT JOIN platform_wa_reads cursor_row ON cursor_row.conversation_id = c.id AND cursor_row.user_id = ?
      WHERE c.phone_number_id = ? AND c.sector = ?
      ORDER BY c.last_activity_at DESC, c.id LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    [userId, scope.phoneId, scope.sector]);
    const [[total]] = await this.pool.execute(`SELECT COUNT(*) unread
      FROM platform_wa_conversations c JOIN platform_wa_messages m ON m.conversation_id = c.id AND m.direction = 'inbound'
      LEFT JOIN platform_wa_reads cursor_row ON cursor_row.conversation_id = c.id AND cursor_row.user_id = ?
      WHERE c.phone_number_id = ? AND c.sector = ? AND m.sequence_no > COALESCE(cursor_row.last_sequence, 0)`,
    [userId, scope.phoneId, scope.sector]);
    return {
      unread: Number(total.unread), hasMore: rows.length > PAGE_SIZE,
      conversations: rows.slice(0, PAGE_SIZE).map(row => ({
        id: row.id, name: row.peer_name || row.peer_phone, phone: row.peer_phone,
        lastMessage: row.last_message || '', lastAt: isoDate(row.last_activity_at), unread: Number(row.unread),
        canReply: !enforceWindow || replyWindowOpen(isoDate(row.last_inbound_at))
      }))
    };
  }

  async history(scope, id, before, { enforceWindow = true } = {}) {
    const conversation = await this.conversation(this.pool, scope, id);
    if (!conversation) return null;
    const [rows] = await this.pool.execute(`SELECT * FROM platform_wa_messages WHERE conversation_id = ?
      ${before ? 'AND sequence_no < CAST(? AS UNSIGNED)' : ''}
      ORDER BY sequence_no DESC LIMIT ${PAGE_SIZE + 1}`, before ? [id, before] : [id]);
    return {
      messages: rows.slice(0, PAGE_SIZE).reverse().map(message), hasMore: rows.length > PAGE_SIZE,
      canReply: !enforceWindow || replyWindowOpen(isoDate(conversation.last_inbound_at))
    };
  }

  async markRead(scope, userId, id, through) {
    if (!await this.conversation(this.pool, scope, id)) return false;
    const [[row]] = await this.pool.execute(`SELECT 1 FROM platform_wa_messages
      WHERE conversation_id = ? AND sequence_no = CAST(? AS UNSIGNED)`, [id, through]);
    if (!row) return false;
    await this.pool.execute(`INSERT INTO platform_wa_reads (user_id, conversation_id, last_sequence)
      VALUES (?, ?, CAST(? AS UNSIGNED))
      ON DUPLICATE KEY UPDATE last_sequence = GREATEST(last_sequence, VALUES(last_sequence))`, [userId, id, through]);
    return true;
  }

  async reserveReply(scope, id, { clientId, actorId, text, enforceWindow = true }) {
    return this.transaction(async (connection) => {
      const conversation = await this.conversation(connection, scope, id, true);
      if (!conversation) return { reason: 'missing' };
      const sql = 'SELECT * FROM platform_wa_messages WHERE conversation_id = ? AND client_id = ?';
      const [[existing]] = await connection.execute(sql, [id, clientId]);
      if (existing) {
        if (existing.actor_id !== actorId || existing.message_text !== text) return { reason: 'conflict' };
        return { message: message(existing), fresh: false };
      }
      const now = new Date();
      if (enforceWindow && !replyWindowOpen(isoDate(conversation.last_inbound_at), now.getTime())) return { reason: 'closed' };
      await connection.execute(`INSERT INTO platform_wa_messages
        (conversation_id, client_id, actor_id, direction, message_type, message_text, delivery_status, occurred_at)
        VALUES (?, ?, ?, 'outbound', 'text', ?, 'pending', ?)`, [id, clientId, actorId, text, now]);
      await connection.execute(`UPDATE platform_wa_conversations
        SET last_activity_at = GREATEST(last_activity_at, ?) WHERE id = ?`, [now, id]);
      const [[row]] = await connection.execute(sql, [id, clientId]);
      return { message: message(row), fresh: true, phone: conversation.peer_phone };
    });
  }

  async finishReply(id, clientId, delivery) {
    const { providerId, status, rank } = delivery;
    await this.pool.execute(`UPDATE platform_wa_messages
      SET provider_id = COALESCE(provider_id, ?), delivery_status = ?, status_rank = ?
      WHERE conversation_id = ? AND client_id = ? AND status_rank <= ?`,
    [providerId, status, rank, id, clientId, rank]);
    const [[row]] = await this.pool.execute(`SELECT * FROM platform_wa_messages
      WHERE conversation_id = ? AND client_id = ?`, [id, clientId]);
    return message(row);
  }

  async recordDelivery(scope, item) {
    await this.pool.execute(`UPDATE platform_wa_messages m
      JOIN platform_wa_conversations c ON c.id = m.conversation_id
      SET m.provider_id = COALESCE(m.provider_id, ?), m.delivery_status = ?, m.status_rank = ?
      WHERE c.phone_number_id = ? AND c.sector = ? AND c.peer_phone = ?
        AND m.direction = 'outbound' AND m.status_rank < ?
        AND (m.provider_id = ? OR (m.client_id = ? AND m.provider_id IS NULL))`,
    [item.providerId, item.status, item.rank, scope.phoneId, scope.sector, item.phone,
      item.rank, item.providerId, item.clientId]);
  }
}
