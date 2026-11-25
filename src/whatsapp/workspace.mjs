import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { canAccess, MODULES } from '../platform/policy.mjs';

const TAGS = `CREATE TABLE IF NOT EXISTS platform_wa_tags (
  id CHAR(36) NOT NULL PRIMARY KEY, sector VARCHAR(32) NOT NULL, name VARCHAR(60) NOT NULL,
  color CHAR(7) NOT NULL, UNIQUE KEY idx_wa_sector_tag (sector, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const ASSIGNMENTS = `CREATE TABLE IF NOT EXISTS platform_wa_tag_links (
  conversation_id CHAR(36) NOT NULL, tag_id CHAR(36) NOT NULL,
  PRIMARY KEY (conversation_id, tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
const TICKETS = `CREATE TABLE IF NOT EXISTS platform_wa_tickets (
  conversation_id CHAR(36) NOT NULL PRIMARY KEY, state VARCHAR(10) NOT NULL,
  updated_at DATETIME(3) NOT NULL, actor_id CHAR(36) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
const HISTORY = `CREATE TABLE IF NOT EXISTS platform_wa_ticket_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, conversation_id CHAR(36) NOT NULL,
  state VARCHAR(10) NOT NULL, occurred_at DATETIME(3) NOT NULL, actor_id CHAR(36) NOT NULL,
  KEY idx_wa_ticket_events_conversation (conversation_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
const ABSENCE = `CREATE TABLE IF NOT EXISTS platform_wa_absence (
  sector VARCHAR(32) NOT NULL PRIMARY KEY, enabled TINYINT(1) NOT NULL, message VARCHAR(500) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const iso = value => value instanceof Date ? value.toISOString() : value ? `${value.replace(' ', 'T')}Z` : null;
const bad = field => new ApiError(400, 'WHATSAPP_INVALID_INPUT', `Campo inválido: ${field}`);
const forbidden = () => new ApiError(403, 'WHATSAPP_FORBIDDEN', 'Sem permissão para administrar este recurso.');
const gone = () => new ApiError(404, 'WHATSAPP_CONVERSATION', 'Conversa indisponível.');

export function createWhatsAppWorkspace({ pool, whatsAppStore, platformStore }) {
  async function initialize() {
    for (const definition of [TAGS, ASSIGNMENTS, TICKETS, HISTORY, ABSENCE]) await pool.query(definition);
  }
  async function absence(sector) {
    const [[row]] = await pool.execute('SELECT enabled, message FROM platform_wa_absence WHERE sector = ?', [sector]);
    return { enabled: Boolean(row?.enabled), message: row?.message || '' };
  }
  async function tags(sector) {
    const [rows] = await pool.execute('SELECT id, name, color FROM platform_wa_tags WHERE sector = ? ORDER BY name', [sector]);
    return rows;
  }
  async function decorate(conversations = []) {
    if (!conversations.length) return conversations;
    const ids = conversations.map(({ id }) => id);
    const marker = ids.map(() => '?').join(',');
    const [results, changes] = await Promise.all([
      pool.execute(`SELECT conversation_id, tag_id FROM platform_wa_tag_links WHERE conversation_id IN (${marker})`, ids),
      pool.execute(`SELECT conversation_id, state FROM platform_wa_tickets WHERE conversation_id IN (${marker})`, ids),
    ]);
    const assigned = new Map(ids.map(id => [id, []]));
    for (const row of results[0]) assigned.get(row.conversation_id).push(row.tag_id);
    const states = new Map(changes[0].map(row => [row.conversation_id, row.state]));
    return conversations.map(item => ({ ...item, tags: assigned.get(item.id), status: states.get(item.id) || 'open' }));
  }
  async function overview(scope, userId) {
    if (!scope) {
      return { now: { conversations: 0, unread: 0, awaiting: 0 }, statistics: { total: 0, open: 0, closed: 0, unread: 0 }, history: [] };
    }
    const keys = [scope.phoneId, scope.sector];
    const [totals, events] = await Promise.all([
      pool.execute(`SELECT COUNT(*) total, COALESCE(SUM(COALESCE(ticket.state, 'open') = 'open'),0) opened
        FROM platform_wa_conversations c LEFT JOIN platform_wa_tickets ticket ON ticket.conversation_id = c.id
        WHERE c.phone_number_id = ? AND c.sector = ?`, keys),
      pool.execute(`SELECT ticket_event.id, ticket_event.state, ticket_event.occurred_at, c.peer_name, c.peer_phone
        FROM platform_wa_ticket_events ticket_event JOIN platform_wa_conversations c ON c.id = ticket_event.conversation_id
        WHERE c.phone_number_id = ? AND c.sector = ? ORDER BY ticket_event.id DESC LIMIT 100`, keys),
    ]);
    const { unread } = await whatsAppStore.listConversations(scope, userId);
    const total = Number(totals[0][0].total);
    const open = Number(totals[0][0].opened);
    return { now: { conversations: total, unread, awaiting: open }, statistics: { total, open, closed: total - open, unread },
      history: events[0].map(row => ({ id: String(row.id), name: row.peer_name || row.peer_phone, phone: row.peer_phone,
        status: row.state, updatedAt: iso(row.occurred_at) })) };
  }
  async function handle({ route, method, user, sector, input, scope, provider, connectionState }) {
    const canManage = user.role === 'admin';
    const canManageTickets = canAccess(user, sector, 'edit');
    if (route === '/whatsapp/overview' && method === 'GET') return overview(scope, user._id);
    if (route === '/whatsapp/tags') {
      if (method === 'GET') return { tags: await tags(sector), canManage, canAssign: canManageTickets };
      if (method === 'POST') {
        if (!canManage) throw forbidden();
        const name = typeof input?.name === 'string' ? input.name.trim() : '';
        if (!name || name.length > 60) throw bad('name');
        if (typeof input.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.color)) throw bad('color');
        try {
          await pool.execute('INSERT INTO platform_wa_tags (id, sector, name, color) VALUES (?, ?, ?, ?)',
            [randomUUID(), sector, name, input.color.toLowerCase()]);
        } catch (error) {
          if (error.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'WHATSAPP_DUPLICATE_TAG', 'Essa tag já existe no setor.');
          throw error;
        }
        return { tags: await tags(sector), canManage, canAssign: canManageTickets };
      }
      if (method === 'PATCH') {
        if (!canManageTickets) throw forbidden();
        const { conversation, tagIds } = input;
        if (!UUID.test(conversation || '') || !Array.isArray(tagIds) || tagIds.length > 20
          || new Set(tagIds).size !== tagIds.length || !tagIds.every(id => typeof id === 'string' && UUID.test(id))) throw bad('tagIds');
        const available = new Set((await tags(sector)).map(({ id }) => id));
        if (!tagIds.every(id => available.has(id))) throw bad('tagIds');
        await whatsAppStore.transaction(async connection => {
          if (!scope || !await whatsAppStore.conversation(connection, scope, conversation, true)) throw gone();
          await connection.execute('DELETE FROM platform_wa_tag_links WHERE conversation_id = ?', [conversation]);
          for (const tag of tagIds) await connection.execute('INSERT INTO platform_wa_tag_links (conversation_id, tag_id) VALUES (?, ?)', [conversation, tag]);
        });
        return { tags: tagIds };
      }
    }
    if (route === '/whatsapp/ticket' && method === 'POST') {
      if (!canManageTickets) throw forbidden();
      const { conversation, status } = input;
      if (!UUID.test(conversation || '') || !['open', 'closed'].includes(status)) throw bad('status');
      await whatsAppStore.transaction(async connection => {
        if (!scope || !await whatsAppStore.conversation(connection, scope, conversation, true)) throw gone();
        const [[row]] = await connection.execute('SELECT state FROM platform_wa_tickets WHERE conversation_id = ?', [conversation]);
        if ((row?.state || 'open') === status) return;
        const date = new Date();
        await connection.execute(`INSERT INTO platform_wa_tickets (conversation_id, state, updated_at, actor_id)
          VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE state = VALUES(state), updated_at = VALUES(updated_at), actor_id = VALUES(actor_id)`,
        [conversation, status, date, user._id]);
        await connection.execute('INSERT INTO platform_wa_ticket_events (conversation_id, state, occurred_at, actor_id) VALUES (?, ?, ?, ?)',
          [conversation, status, date, user._id]);
      });
      return { status };
    }
    if (route === '/whatsapp/settings' && method === 'GET') {
      const users = canManage ? (await platformStore.listUsers()).filter(item => item.active && canAccess(item, sector))
        .map(({ name, email, role }) => ({ name, email, role })) : [];
      return { canManage, users, roles: [
        { name: 'Administrador', description: 'Configura conexões, tags e controle de ausência.' },
        { name: 'Equipe do setor', description: 'Consulta as conversas. O nível Editar permite responder e atualizar chamados.' },
      ], departments: MODULES.filter(({ id, legacy }) => !legacy && canAccess(user, id)).map(({ id, label }) => ({ id, label })),
      integrations: [{ name: provider, status: connectionState === 'connected' ? 'Conectado' : 'Sem conexão ativa' }],
      robots: [], absence: await absence(sector) };
    }
    if (route === '/whatsapp/settings' && method === 'POST') {
      if (!canManage) throw forbidden();
      const settings = input?.absence;
      const message = typeof settings?.message === 'string' ? settings.message.trim() : '';
      if (typeof settings?.enabled !== 'boolean' || message.length > 500) throw bad('absence');
      await pool.execute(`INSERT INTO platform_wa_absence (sector, enabled, message)
        VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), message = VALUES(message)`, [sector, Number(settings.enabled), message]);
      return { canManage, absence: { enabled: settings.enabled, message } };
    }
    return null;
  }
  return { initialize, handle, decorate, absence };
}
