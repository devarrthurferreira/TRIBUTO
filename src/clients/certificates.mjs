import { createCipheriv, randomBytes } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { createSecureContext, TLSSocket } from 'node:tls';
import { ApiError } from '../api/validation.mjs';

const MAX_PFX_BYTES = 512 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_PFX_BYTES / 3) * 4;
const FORMAT_VERSION = 1;
const FILE_NAME = /^[^/\\\u0000-\u001f\u007f]{1,160}\.(?:pfx|p12)$/iu;
const SCHEMA = `CREATE TABLE IF NOT EXISTS platform_client_certificates (
  client_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  file_name VARCHAR(180) NOT NULL,
  encrypted MEDIUMBLOB NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value.replace(' ', 'T') + 'Z';
}

function certificateValidity(pfx, passphrase) {
  let socket;
  let certificate;
  try {
    const secureContext = createSecureContext({ pfx, passphrase });
    socket = new TLSSocket(new PassThrough(), { secureContext, isServer: true });
    // A local, unconnected socket provides the standard X.509 accessor.
    certificate = socket.getX509Certificate();
  } catch (error) {
    if (error.message === 'mac verify failure') {
      throw new ApiError(400, 'CLIENT_CERTIFICATE_INVALID', 'A senha não abriu este certificado. Confira a senha e o arquivo.');
    }
  } finally {
    socket?.destroy();
  }
  const validFrom = new Date(certificate?.validFrom);
  const expiresAt = new Date(certificate?.validTo);
  if (!Number.isFinite(validFrom.getTime()) || !(expiresAt.getUTCFullYear() >= 1000 && expiresAt.getUTCFullYear() <= 9999)) {
    throw new ApiError(400, 'CLIENT_CERTIFICATE_INVALID', 'Não foi possível abrir o certificado A1. Confira o arquivo .pfx ou .p12, a chave privada e a senha.');
  }
  const now = Date.now();
  if (expiresAt.getTime() <= now) {
    throw new ApiError(400, 'CLIENT_CERTIFICATE_EXPIRED', 'A senha abriu o certificado, mas ele está vencido. Selecione um certificado vigente.');
  }
  if (validFrom.getTime() > now) {
    throw new ApiError(400, 'CLIENT_CERTIFICATE_NOT_YET_VALID', 'A senha abriu o certificado, mas a validade ainda não começou.');
  }
  return { validFrom, expiresAt };
}

function withCertificateFile(input, use) {
  const { fileName, data, password } = input ?? {};
  const name = typeof fileName === 'string' ? fileName.trim().normalize('NFC') : '';
  if (!FILE_NAME.test(name) || typeof data !== 'string' || !data.length || data.length > MAX_BASE64_LENGTH) {
    throw new ApiError(400, 'CLIENT_CERTIFICATE_FILE', 'Selecione um arquivo .pfx ou .p12 de até 512 KB.');
  }
  if (typeof password !== 'string' || !password.length || password.length > 256 || password.includes('\0')) {
    throw new ApiError(400, 'CLIENT_CERTIFICATE_PASSWORD', 'Informe a senha do certificado A1 com até 256 caracteres.');
  }
  const pfx = Buffer.from(data, 'base64');
  try {
    if (pfx.length > MAX_PFX_BYTES || pfx.toString('base64') !== data) {
      throw new ApiError(400, 'CLIENT_CERTIFICATE_FILE', 'Selecione um arquivo .pfx ou .p12 de até 512 KB.');
    }
    return use({ fileName: name, pfx, password, ...certificateValidity(pfx, password) });
  } finally {
    pfx.fill(0);
  }
}

function sealCertificate(key, clientId, pfx, password) {
  const passphrase = Buffer.from(password, 'utf8');
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(`maximum-client-a1/v${FORMAT_VERSION}:${clientId}`, 'ascii'));
    const length = Buffer.alloc(2);
    length.writeUInt16BE(passphrase.length);
    const body = [cipher.update(length), cipher.update(passphrase), cipher.update(pfx), cipher.final()];
    return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), ...body]);
  } finally {
    passphrase.fill(0);
  }
}

export class ClientCertificateStore {
  #key;

  constructor(pool, { encryptionKey = process.env.CLIENT_CERT_ENCRYPTION_KEY } = {}) {
    this.pool = pool;
    this.#key = typeof encryptionKey === 'string' && /^[0-9a-f]{64}$/i.test(encryptionKey)
      ? Buffer.from(encryptionKey, 'hex') : null;
  }

  get configured() { return this.#key !== null; }

  initialize() { return this.pool.query(SCHEMA); }

  verify(input) {
    return withCertificateFile(input, ({ validFrom, expiresAt }) => ({
      validFrom: validFrom.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }));
  }

  prepare(input, clientId) {
    if (input === undefined || input === null) return input;
    if (!this.#key) {
      throw new ApiError(503, 'CLIENT_CERTIFICATE_UNAVAILABLE', 'O armazenamento de certificados A1 precisa ser configurado no servidor.');
    }
    return withCertificateFile(input, ({ fileName, pfx, password, expiresAt }) => ({
      fileName, expiresAt, encrypted: sealCertificate(this.#key, clientId, pfx, password),
    }));
  }

  async save(connection, clientId, prepared) {
    if (prepared === undefined) return;
    if (prepared === null) {
      await connection.execute('DELETE FROM platform_client_certificates WHERE client_id = ?', [clientId]);
      return;
    }
    const { fileName, expiresAt, encrypted } = prepared;
    await connection.execute(`INSERT INTO platform_client_certificates
      (client_id, file_name, encrypted, expires_at, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), encrypted = VALUES(encrypted),
        expires_at = VALUES(expires_at), created_at = VALUES(created_at)`, [clientId, fileName, encrypted, expiresAt]);
  }

  async status(clientId, executor = this.pool) {
    const [rows] = await executor.execute(
      'SELECT file_name, expires_at, created_at FROM platform_client_certificates WHERE client_id = ?', [clientId]
    );
    const row = rows[0];
    if (!row) return null;
    return { fileName: row.file_name, expiresAt: toIso(row.expires_at), createdAt: toIso(row.created_at) };
  }
}
