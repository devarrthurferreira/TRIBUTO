import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { canAccessCompany, canPerformDossier } from '../platform/policy.mjs';

export const HONORARIUM_RECIPIENTS = Object.freeze([
  ['Bruna Rezende', 'administrativo@maximumcontabil.com.br'],
  ['Danielle Arcoverde', 'administrativo2@maximumcontabil.com.br'],
  ['Alexandre Rezende', 'maximumcontabil@maximumcontabil.com.br'],
  ['Vitoria Santos', 'societario4@maximumcontabil.com.br'],
  ['Thalita Ribeiro', 'sucessodocliente1@maximumcontabil.com.br'],
].map(([name, email]) => Object.freeze({ name, email })));

const PASSWORD_AAD = Buffer.from('maximum-notifications/smtp-password/v1');
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS platform_notification_smtp (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY, enabled TINYINT(1) NOT NULL DEFAULT 0,
    host VARCHAR(253) NOT NULL DEFAULT '', port SMALLINT UNSIGNED NOT NULL DEFAULT 465,
    username VARCHAR(254) NOT NULL DEFAULT '', sender_email VARCHAR(254) NOT NULL DEFAULT '',
    sender_name VARCHAR(120) NOT NULL DEFAULT '', password_envelope VARBINARY(4096) NULL,
    updated_at DATETIME(3) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_honorarium_messages (
    dossier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    fee_version INT UNSIGNED NOT NULL, subject VARCHAR(340) NOT NULL, text_body MEDIUMTEXT NOT NULL,
    html_body MEDIUMTEXT NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (dossier_id, fee_version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_honorarium_deliveries (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    dossier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    fee_version INT UNSIGNED NOT NULL, recipient VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM('queued','sending','sent','failed','uncertain','superseded') NOT NULL DEFAULT 'queued',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0, next_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    lease_until DATETIME(3) NULL, claim CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL, sent_at DATETIME(3) NULL,
    UNIQUE KEY uniq_honorarium_delivery_recipient (dossier_id, fee_version, recipient),
    KEY idx_honorarium_delivery_claim (status, next_at, id),
    KEY idx_honorarium_delivery_lease (status, lease_until),
    CONSTRAINT fk_honorarium_message FOREIGN KEY (dossier_id, fee_version)
      REFERENCES platform_honorarium_messages (dossier_id, fee_version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];
const DEFAULT_SETTINGS = {
  enabled: 0, host: '', port: 465, username: '', sender_email: '', sender_name: '',
  password_envelope: null, updated_at: null,
};
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/u;
const DOMAIN = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z](?:[a-z\d-]{0,61}[a-z\d])?$/i;

function malformed(message) {
  throw new ApiError(400, 'SMTP_SETTINGS', message);
}

function normalizedText(value, name, maximum, { required = false } = {}) {
  if (typeof value !== 'string' || value.length > maximum || CONTROL_CHAR.test(value) || (required && !value.trim())) {
    malformed(`Confira o campo ${name}.`);
  }
  return value.trim();
}

export function smtpSettingsFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.enabled !== 'boolean') {
    malformed('Informe a situação do envio por SMTP.');
  }
  const host = normalizedText(input.host, 'servidor SMTP', 253, { required: true }).toLowerCase();
  if (!DOMAIN.test(host)) malformed('Informe o endereço público do servidor SMTP, sem protocolo ou caminho.');
  const port = Number(input.port);
  if (port !== 465 && port !== 587) malformed('Selecione a porta 465 (TLS) ou 587 (STARTTLS).');
  const username = normalizedText(input.username, 'usuário SMTP', 254, { required: true });
  const senderEmail = normalizedText(input.senderEmail, 'e-mail remetente', 254, { required: true });
  if (!EMAIL.test(senderEmail)) malformed('Informe um e-mail de remetente válido.');
  const senderName = normalizedText(input.senderName ?? '', 'nome do remetente', 120);
  let password;
  if (input.password !== undefined) {
    if (typeof input.password !== 'string' || !input.password || input.password.length > 512 || CONTROL_CHAR.test(input.password)) {
      malformed('Informe uma senha SMTP válida.');
    }
    password = input.password;
  }
  return { enabled: input.enabled, host, port, username, senderEmail, senderName, password };
}

function databaseDate(value) {
  if (value instanceof Date) return value.toISOString();
  return value ? value.replace(' ', 'T') + 'Z' : null;
}

function settingsView(row, available) {
  return {
    enabled: Boolean(Number(row.enabled)), host: row.host, port: Number(row.port), username: row.username,
    senderEmail: row.sender_email, senderName: row.sender_name, hasPassword: Boolean(row.password_envelope),
    updatedAt: databaseDate(row.updated_at), available,
  };
}

function summary(states) {
  for (const status of ['sending', 'queued', 'uncertain', 'failed', 'superseded', 'sent']) {
    if (states.includes(status)) return status;
  }
  return null;
}

async function directorRecipients(executor) {
  const [rows] = await executor.execute(`SELECT email, active, role, company_cnpjs, module_grants
    FROM platform_users WHERE active = 1 AND email IN (${HONORARIUM_RECIPIENTS.map(() => '?').join(', ')})`,
  HONORARIUM_RECIPIENTS.map(({ email }) => email));
  const users = new Map(rows.map(row => [row.email.toLowerCase(), {
    active: Boolean(row.active), role: row.role,
    companyCnpjs: JSON.parse(row.company_cnpjs || '[]'), moduleGrants: JSON.parse(row.module_grants || '{}'),
  }]));
  return HONORARIUM_RECIPIENTS.flatMap(person => {
    const user = users.get(person.email);
    return canPerformDossier(user, 'dossierFeesRead') ? [{ person, user }] : [];
  });
}

export class SmtpMySqlStore {
  #key;

  constructor(platformStore, { encryptionKey = process.env.CLIENT_CERT_ENCRYPTION_KEY } = {}) {
    this.platformStore = platformStore;
    this.pool = platformStore.pool;
    this.#key = typeof encryptionKey === 'string' && /^[\da-f]{64}$/i.test(encryptionKey)
      ? Buffer.from(hkdfSync('sha256', Buffer.from(encryptionKey, 'hex'), Buffer.alloc(0), PASSWORD_AAD, 32))
      : null;
  }

  get available() { return Boolean(this.#key); }

  async initialize() {
    for (const table of SCHEMA) await this.pool.query(table);
    await this.pool.execute('INSERT IGNORE INTO platform_notification_smtp (id) VALUES (1)');
  }

  async settings() {
    const [[row]] = await this.pool.execute('SELECT * FROM platform_notification_smtp WHERE id = 1');
    return settingsView(row ?? DEFAULT_SETTINGS, this.available);
  }

  async saveSettings(fields, actorId) {
    return this.platformStore.transaction(async connection => {
      const [[previous]] = await connection.execute('SELECT * FROM platform_notification_smtp WHERE id = 1 FOR UPDATE');
      if (!this.#key) throw new ApiError(503, 'SMTP_UNAVAILABLE', 'O cofre de credenciais SMTP está indisponível.');
      const { enabled, host, port, username, senderEmail, senderName, password } = fields;
      const sameAccount = host === previous.host && port === Number(previous.port) && username === previous.username;
      if (!password && (!sameAccount || !previous.password_envelope)) malformed('Informe a senha ao cadastrar ou trocar a conta SMTP.');
      let envelope = previous.password_envelope;
      if (password) {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
        cipher.setAAD(PASSWORD_AAD);
        const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
        envelope = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
      }
      const now = new Date();
      await connection.execute(`UPDATE platform_notification_smtp SET enabled = ?, host = ?, port = ?,
        username = ?, sender_email = ?, sender_name = ?, password_envelope = ?, updated_at = ? WHERE id = 1`,
      [Number(enabled), host, port, username, senderEmail, senderName, envelope, now]);
      await this.platformStore.insertAudit(connection, 'notifications.smtp.update', actorId, 'smtp', { enabled });
      return settingsView({
        enabled: Number(enabled), host, port, username, sender_email: senderEmail, sender_name: senderName,
        password_envelope: envelope, updated_at: now,
      }, true);
    });
  }

  async credentials({ includeDisabled = false } = {}) {
    if (!this.#key) return null;
    const [[row]] = await this.pool.execute('SELECT * FROM platform_notification_smtp WHERE id = 1');
    if (!row?.password_envelope || (!includeDisabled && !Number(row.enabled))) return null;
    const envelope = row.password_envelope;
    const decipher = createDecipheriv('aes-256-gcm', this.#key, envelope.subarray(0, 12));
    decipher.setAAD(PASSWORD_AAD);
    decipher.setAuthTag(envelope.subarray(12, 28));
    const password = Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]);
    try { return { ...settingsView(row, true), password: password.toString('utf8') }; }
    finally { password.fill(0); }
  }

  async queueHonorarium(connection, { id, version, message, companyCnpj }) {
    const recipients = (await directorRecipients(connection)).filter(({ user }) => canAccessCompany(user, companyCnpj));
    if (!recipients.length) {
      throw new ApiError(409, 'HONORARIUM_NO_RECIPIENTS', 'Nenhum endereço da lista de envio tem acesso aos honorários desta empresa na Diretoria.');
    }
    const emails = recipients.map(({ person }) => person.email);
    const [[existing]] = await connection.execute(`SELECT 1 FROM platform_honorarium_messages
      WHERE dossier_id = ? AND fee_version = ? FOR UPDATE`, [id, version]);
    let requeued = 0;
    let pending = emails;
    if (existing) {
      const [result] = await connection.execute(`UPDATE platform_honorarium_deliveries SET status = 'queued',
        attempts = 0, next_at = UTC_TIMESTAMP(3), lease_until = NULL, claim = NULL
        WHERE dossier_id = ? AND fee_version = ? AND status = 'failed'
          AND recipient IN (${emails.map(() => '?').join(', ')})`, [id, version, ...emails]);
      requeued = result.affectedRows;
      const [previous] = await connection.execute(`SELECT recipient FROM platform_honorarium_deliveries
        WHERE dossier_id = ? AND fee_version = ?`, [id, version]);
      const recorded = new Set(previous.map(({ recipient }) => recipient));
      pending = emails.filter(email => !recorded.has(email));
    } else {
      const { subject, text, html } = message;
      if (typeof subject !== 'string' || !subject.trim() || subject.length > 340 || CONTROL_CHAR.test(subject)
        || typeof text !== 'string' || !text.trim() || typeof html !== 'string' || !html.trim()
        || Buffer.byteLength(text) > 64_000 || Buffer.byteLength(html) > 128_000) {
        throw new ApiError(400, 'HONORARIUM_MESSAGE', 'Não foi possível preparar a mensagem de honorários.');
      }
      await connection.execute(`INSERT INTO platform_honorarium_messages (dossier_id, fee_version, subject, text_body, html_body)
        VALUES (?, ?, ?, ?, ?)`, [id, version, subject, text, html]);
    }
    if (!pending.length) return Boolean(requeued);
    const rows = pending.map(email => [randomUUID(), id, version, email]);
    await connection.execute(`INSERT INTO platform_honorarium_deliveries (id, dossier_id, fee_version, recipient)
      VALUES ${rows.map(() => '(?, ?, ?, ?)').join(', ')}`, rows.flat());
    return true;
  }

  async supersedeHonorarium(connection, { id, version }) {
    const [rows] = await connection.execute(`SELECT id, status FROM platform_honorarium_deliveries
      WHERE dossier_id = ? AND fee_version = ? FOR UPDATE`, [id, version]);
    if (rows.some(({ status }) => status === 'sending')) {
      throw new ApiError(409, 'HONORARIUM_IN_TRANSIT', 'Aguarde o fim do envio dos honorários para alterar esta versão.');
    }
    await connection.execute(`UPDATE platform_honorarium_deliveries SET status = 'superseded'
      WHERE dossier_id = ? AND fee_version = ? AND status IN ('queued','failed')`, [id, version]);
  }

  async honorariumDetails(id, version, companyCnpj) {
    const [directors, [rows]] = await Promise.all([
      directorRecipients(this.pool),
      version ? this.pool.execute(`SELECT recipient, status, sent_at FROM platform_honorarium_deliveries
        WHERE dossier_id = ? AND fee_version = ?`, [id, version]) : [[]],
    ]);
    const byEmail = new Map(rows.map(row => [row.recipient, row]));
    const recipients = directors.filter(({ user }) => canAccessCompany(user, companyCnpj)).map(({ person }) => {
      const row = byEmail.get(person.email);
      return { ...person, status: row?.status ?? 'not_queued', sentAt: databaseDate(row?.sent_at) };
    });
    return { recipients, status: summary(recipients.map(({ status }) => status)) };
  }

  async honorariumStatuses(items) {
    const active = items.filter(({ version }) => version);
    if (!active.length) return new Map();
    const [directors, [rows]] = await Promise.all([
      directorRecipients(this.pool),
      this.pool.execute(`SELECT dossier_id, recipient, status FROM platform_honorarium_deliveries
        WHERE (dossier_id, fee_version) IN (${active.map(() => '(?, ?)').join(', ')})`,
      active.flatMap(({ id, version }) => [id, version])),
    ]);
    const directorsByEmail = new Map(directors.map(({ person, user }) => [person.email, user]));
    const companiesById = new Map(active.map(({ id, companyCnpj }) => [id, companyCnpj]));
    const byId = new Map();
    for (const { dossier_id: id, recipient, status } of rows) {
      if (!canAccessCompany(directorsByEmail.get(recipient), companiesById.get(id))) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(status);
    }
    return new Map([...byId].map(([id, states]) => [id, summary(states)]));
  }

  async queueCounts() {
    const [rows] = await this.pool.execute(`SELECT status, COUNT(*) AS total FROM platform_honorarium_deliveries
      WHERE status <> 'superseded' GROUP BY status`);
    return Object.fromEntries(rows.map(row => [row.status, Number(row.total)]));
  }

  async recoverExpired() {
    await this.pool.execute(`UPDATE platform_honorarium_deliveries SET status = 'uncertain', lease_until = NULL, claim = NULL
      WHERE status = 'sending' AND lease_until <= UTC_TIMESTAMP(3)`);
  }

  claimDelivery() {
    return this.platformStore.transaction(async connection => {
      const [[delivery]] = await connection.execute(`SELECT id, dossier_id, fee_version, recipient, attempts
        FROM platform_honorarium_deliveries WHERE status = 'queued' AND next_at <= UTC_TIMESTAMP(3)
        ORDER BY next_at, id LIMIT 1 FOR UPDATE`);
      if (!delivery) return null;
      const [[dossier]] = await connection.execute('SELECT company_cnpj FROM platform_dossiers WHERE id = ?', [delivery.dossier_id]);
      const directors = await directorRecipients(connection);
      const allowed = Boolean(dossier) && directors.some(({ person, user }) =>
        person.email === delivery.recipient && canAccessCompany(user, dossier.company_cnpj));
      const [[message]] = allowed ? await connection.execute(`SELECT subject, text_body, html_body FROM platform_honorarium_messages
        WHERE dossier_id = ? AND fee_version = ?`, [delivery.dossier_id, delivery.fee_version]) : [[]];
      const claim = randomUUID();
      await connection.execute(`UPDATE platform_honorarium_deliveries SET status = 'sending',
        claim = ?, lease_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE), attempts = attempts + 1 WHERE id = ?`,
      [claim, delivery.id]);
      return {
        id: delivery.id, recipient: delivery.recipient, allowed: allowed && Boolean(message),
        attempts: Number(delivery.attempts) + 1, claim,
        message: message && { subject: message.subject, text: message.text_body, html: message.html_body },
      };
    });
  }

  async finishDelivery(job, status, retryAt = null) {
    if (!['queued', 'sent', 'failed', 'uncertain'].includes(status)) throw new TypeError('Invalid SMTP delivery state');
    const [result] = await this.pool.execute(`UPDATE platform_honorarium_deliveries SET status = ?,
      next_at = COALESCE(?, next_at), lease_until = NULL, claim = NULL,
      sent_at = IF(? = 'sent', UTC_TIMESTAMP(3), sent_at) WHERE id = ? AND status = 'sending' AND claim = ?`,
    [status, retryAt, status, job.id, job.claim]);
    return Boolean(result.affectedRows);
  }
}
