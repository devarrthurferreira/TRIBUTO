import { randomBytes } from 'node:crypto';
import { sha256, ApiError } from '../api/validation.mjs';

const ACTIVATION_LIFE_MS = 24 * 60 * 60_000;
const ACCOUNT_COLUMNS = `client_id, status, password_hash, activation_hash, activation_used_at, activation_expires_at,
  password_changed_at, last_login_at`;
const TABLES = [
  `CREATE TABLE IF NOT EXISTS platform_client_accounts (
    client_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    activation_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    activation_used_at DATETIME(3) NULL, activation_expires_at DATETIME(3) NULL,
    password_changed_at DATETIME(3) NULL, last_login_at DATETIME(3) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_client_sessions (
    id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    client_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    purpose VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    csrf_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    expires_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL,
    KEY idx_client_session_client_expiry (client_id, expires_at),
    KEY idx_client_session_expiry (expires_at),
    CONSTRAINT fk_client_session_account FOREIGN KEY (client_id) REFERENCES platform_client_accounts (client_id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

function isoDate(value) {
  if (value == null) return null;
  return (value instanceof Date ? value : new Date(`${value.replace(' ', 'T')}Z`)).toISOString();
}

function accountFrom(row) {
  if (!row) return null;
  return {
    clientId: row.client_id, status: row.status, passwordHash: row.password_hash,
    activationHash: row.activation_hash, activationUsedAt: isoDate(row.activation_used_at),
    activationExpiresAt: isoDate(row.activation_expires_at),
    passwordChangedAt: isoDate(row.password_changed_at), lastLoginAt: isoDate(row.last_login_at),
  };
}

export function clientAccessView(account, username, now = Date.now()) {
  let status = account?.status ?? 'unconfigured';
  if (status === 'activation_pending') {
    if (Date.parse(account.activationExpiresAt) <= now) status = 'activation_expired';
    else if (account.activationUsedAt) status = 'activation_in_progress';
  }
  return {
    username, status,
    activationExpiresAt: account?.activationExpiresAt ?? null,
    passwordChangedAt: account?.passwordChangedAt ?? null,
    lastLoginAt: account?.lastLoginAt ?? null,
  };
}

export function prepareClientActivation(now = Date.now()) {
  const code = randomBytes(18).toString('base64url');
  return { code, hash: sha256(code), expiresAt: new Date(now + ACTIVATION_LIFE_MS) };
}

export function clientLoginAttemptKey(username) { return sha256(`client-login:account:${username}`); }

export class ClientAccessStore {
  constructor(platformStore) {
    this.platformStore = platformStore;
    this.pool = platformStore.pool;
  }

  async initialize() {
    for (const statement of TABLES) await this.pool.query(statement);
    await this.pool.execute('DELETE FROM platform_client_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
  }

  async getAccount(clientId, connection = this.pool, lock = false) {
    const [[row]] = await connection.execute(
      `SELECT ${ACCOUNT_COLUMNS} FROM platform_client_accounts WHERE client_id = ?${lock ? ' FOR UPDATE' : ''}`,
      [clientId],
    );
    return accountFrom(row);
  }

  async installActivation(connection, { clientId, username, activation, actorId, action = 'client.access.issue' }) {
    await connection.execute(`
      INSERT INTO platform_client_accounts (client_id, status, activation_hash, activation_expires_at)
      VALUES (?, 'activation_pending', ?, ?)
      ON DUPLICATE KEY UPDATE status = 'activation_pending', password_hash = NULL, activation_hash = VALUES(activation_hash),
        activation_used_at = NULL, activation_expires_at = VALUES(activation_expires_at)`,
    [clientId, activation.hash, activation.expiresAt]);
    await connection.execute('DELETE FROM platform_client_sessions WHERE client_id = ?', [clientId]);
    await connection.execute('DELETE FROM platform_login_attempts WHERE id = ?', [clientLoginAttemptKey(username)]);
    if (actorId) await this.platformStore.insertAudit(connection, action, actorId, clientId);
    return clientAccessView(await this.getAccount(clientId, connection), username);
  }

  reset(client, activation, actorId, clientStore) {
    return this.platformStore.transaction(async connection => {
      const current = await clientStore.find(connection, client.document, false, true);
      if (!current?.active || current.id !== client.id) {
        throw new ApiError(409, 'CLIENT_INACTIVE', 'Ative o cadastro para gerar um acesso.');
      }
      return this.installActivation(connection, {
        clientId: current.id, username: current.document, activation, actorId, action: 'client.access.reset',
      });
    });
  }

  revoke(client, actorId) {
    return this.platformStore.transaction(connection => this.revokeInTransaction(connection, client, actorId));
  }

  async revokeInTransaction(connection, client, actorId) {
    await connection.execute(`
      INSERT INTO platform_client_accounts (client_id, status) VALUES (?, 'revoked')
      ON DUPLICATE KEY UPDATE status = 'revoked', password_hash = NULL, activation_hash = NULL,
        activation_used_at = NULL, activation_expires_at = NULL`, [client.id]);
    await connection.execute('DELETE FROM platform_client_sessions WHERE client_id = ?', [client.id]);
    await this.platformStore.insertAudit(connection, 'client.access.revoke', actorId, client.id);
    return clientAccessView(await this.getAccount(client.id, connection), client.document);
  }

  startSession(account, session, now) {
    return this.platformStore.transaction(async connection => {
      const current = await this.getAccount(account.clientId, connection, true);
      if (!current || current.status !== account.status) return false;
      if (session.purpose === 'activation') {
        if (current.activationUsedAt || !current.activationHash || current.activationHash !== account.activationHash
          || Date.parse(current.activationExpiresAt) <= now.getTime()) return false;
        await connection.execute(`UPDATE platform_client_accounts SET activation_used_at = ?, activation_expires_at = ?
          WHERE client_id = ?`, [now, session.expiresAt, current.clientId]);
      } else {
        if (!current.passwordHash || current.passwordHash !== account.passwordHash) return false;
        await connection.execute(`UPDATE platform_client_accounts SET last_login_at = ? WHERE client_id = ?`, [now, current.clientId]);
      }
      await connection.execute(`DELETE FROM platform_client_sessions WHERE client_id = ? AND expires_at <= ?`, [current.clientId, now]);
      await connection.execute(`INSERT INTO platform_client_sessions (id, client_id, purpose, csrf_token, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`, [session.id, current.clientId, session.purpose, session.csrfToken, session.expiresAt, now]);
      return true;
    });
  }

  async getSession(id, now, connection = this.pool, lock = false) {
    const [[row]] = await connection.execute(`SELECT id, client_id, purpose, csrf_token FROM platform_client_sessions
      WHERE id = ? AND expires_at > ?${lock ? ' FOR UPDATE' : ''}`, [id, now]);
    return row ? { id: row.id, clientId: row.client_id, purpose: row.purpose, csrfToken: row.csrf_token } : null;
  }

  deleteSession(id) {
    return this.pool.execute('DELETE FROM platform_client_sessions WHERE id = ?', [id]);
  }

  completePassword(account, session, newHash, now) {
    return this.platformStore.transaction(async connection => {
      const current = await this.getAccount(account.clientId, connection, true);
      if (!current || current.status !== account.status || current.passwordHash !== account.passwordHash
        || current.activationHash !== account.activationHash) return false;
      const live = await this.getSession(session.id, now, connection, true);
      if (!live || live.clientId !== account.clientId || live.purpose !== session.purpose) return false;
      await connection.execute(`UPDATE platform_client_accounts SET status = 'active',
        password_hash = ?, activation_hash = NULL, activation_used_at = NULL, activation_expires_at = NULL, password_changed_at = ?
        WHERE client_id = ?`, [newHash, now, account.clientId]);
      await connection.execute('DELETE FROM platform_client_sessions WHERE client_id = ?', [account.clientId]);
      await this.platformStore.insertAudit(connection, 'client.access.password_set', account.clientId, account.clientId);
      return true;
    });
  }

  reserveAttempt(key) { return this.platformStore.reserveLoginAttempt(key); }
  clearAttempts(key) { return this.platformStore.clearLoginFailures(key); }
}
