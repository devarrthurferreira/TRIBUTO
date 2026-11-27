import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { normalizeAttachments } from '../chat/attachments.mjs';

export const WORKSPACE_MODULES = new Set(['guias', 'financeiro', 'documentos']);
export const WORKSPACE_UPLOAD_LIMIT = 2 * 1024 * 1024;
export const WORKSPACE_BODY_LIMIT = 4 * Math.ceil(WORKSPACE_UPLOAD_LIMIT / 3) + 32_000;

const PAGE_SIZE = 25;
const invoiceStatuses = ['aberto', 'pago', 'cancelado'];
const documentStatuses = ['disponivel', 'recebido', 'em-analise', 'conferido'];

function invalid(message) {
  throw new ApiError(400, 'CLIENT_WORKSPACE_INPUT', message);
}

function field(value, maximum, label, required = false) {
  if (value == null || value === '') {
    if (required) invalid('Informe ' + label + '.');
    return null;
  }
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid('Revise ' + label + '.');
  const normalized = value.trim();
  if (!normalized && required) invalid('Informe ' + label + '.');
  return normalized || null;
}

function fileValue(file) {
  if (file == null) return null;
  if (typeof file.base64 !== 'string' || !file.base64 || file.base64.length > Math.ceil(WORKSPACE_UPLOAD_LIMIT / 3) * 4) {
    invalid('Envie um arquivo de até 2 MB.');
  }
  const data = Buffer.from(file.base64, 'base64');
  if (file.base64 !== data.toString('base64')) invalid('O arquivo enviado é inválido.');
  return normalizeAttachments([{ name: file.name, data }])[0];
}

function validateStatus(module, status) {
  if (!(module === 'documentos' ? documentStatuses : invoiceStatuses).includes(status)) invalid('Selecione uma situação válida.');
  return status;
}

const columns = 'id, title, competence, due_date, amount_cents, status, description, filename, file_size, origin, created_at';

function itemView(row) {
  return {
    id: row.id, title: row.title, competence: row.competence, dueDate: row.due_date,
    amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
    status: row.status, description: row.description, filename: row.filename, size: row.file_size,
    origin: row.origin, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at.replace(' ', 'T') + 'Z',
  };
}

export class ClientWorkspaceStore {
  constructor(platformStore) {
    this.platformStore = platformStore;
    this.pool = platformStore.pool;
  }

  async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS platform_client_workspace_items (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      client_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      module VARCHAR(12) CHARACTER SET ascii NOT NULL, origin VARCHAR(10) NOT NULL,
      title VARCHAR(160) NOT NULL, description TEXT NULL, competence CHAR(7) NULL, due_date CHAR(10) NULL,
      amount_cents BIGINT UNSIGNED NULL, status VARCHAR(20) NOT NULL, created_at DATETIME(3) NOT NULL,
      filename VARCHAR(180) NULL, file_size INT UNSIGNED NULL, file_content MEDIUMBLOB NULL,
      KEY idx_client_workspace (client_id, module, created_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  }

  async list(clientId, module, page = 1) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000) invalid('Revise a página solicitada.');
    const [rows] = await this.pool.execute(`SELECT ${columns} FROM platform_client_workspace_items
      WHERE client_id=? AND module=? ORDER BY created_at DESC, id DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}`, [clientId, module]);
    return { items: rows.slice(0, PAGE_SIZE).map(itemView), page, hasMore: page < 1000 && rows.length > PAGE_SIZE };
  }

  async getFile(clientId, module, id) {
    const [[file]] = await this.pool.execute(`SELECT filename AS name, file_size AS size, file_content AS data
      FROM platform_client_workspace_items WHERE client_id=? AND module=? AND id=? AND filename IS NOT NULL`, [clientId, module, id]);
    return file ?? null;
  }

  publish(clientId, module, input, actorId) {
    return this.insert(clientId, module, input, actorId, 'maximum');
  }

  upload(clientId, input) {
    return this.insert(clientId, 'documentos', input, clientId, 'cliente');
  }

  async insert(clientId, module, input, actorId, origin) {
    if (!WORKSPACE_MODULES.has(module)) invalid('Módulo inválido.');
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Informe os dados do registro.');
    const attachment = fileValue(input.file);
    if (module === 'documentos' && !attachment) invalid('Escolha o documento para envio.');
    const title = field(input.title || attachment?.name?.slice(0, 160), 160, 'o título', true);
    const description = field(input.description, 2000, 'a descrição');
    const competence = field(input.competence, 7, 'a competência');
    if (competence && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(competence)) invalid('Informe a competência no formato AAAA-MM.');
    const isDocument = module === 'documentos';
    const dueDate = isDocument ? null : field(input.dueDate, 10, 'o vencimento');
    if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(dueDate)) ||
      new Date(dueDate).toISOString().slice(0, 10) !== dueDate)) invalid('Informe uma data de vencimento válida.');
    const amount = isDocument ? null : input.amountCents ?? null;
    if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) invalid('Informe um valor válido.');
    const status = origin === 'cliente' ? 'recebido' : validateStatus(module, input.status || (isDocument ? 'disponivel' : 'aberto'));
    const id = randomUUID();
    return this.platformStore.transaction(async connection => {
      await connection.execute(`INSERT INTO platform_client_workspace_items
        (id,client_id,module,origin,title,description,competence,due_date,amount_cents,status,created_at,filename,file_size,file_content)
        VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),?,?,?)`,
      [id, clientId, module, origin, title, description, competence, dueDate, amount, status,
        attachment?.name ?? null, attachment?.size ?? null, attachment?.data ?? null]);
      await this.platformStore.insertAudit(connection, origin === 'cliente' ? 'client.document.upload' : 'client.workspace.publish', actorId, clientId, { module, itemId: id });
      return { id };
    });
  }

  async updateStatus(clientId, module, id, status, actorId) {
    validateStatus(module, status);
    return this.platformStore.transaction(async connection => {
      const [[item]] = await connection.execute('SELECT id FROM platform_client_workspace_items WHERE id=? AND client_id=? AND module=? FOR UPDATE', [id, clientId, module]);
      if (!item) throw new ApiError(404, 'CLIENT_WORKSPACE_ITEM', 'Registro não encontrado.');
      await connection.execute('UPDATE platform_client_workspace_items SET status=? WHERE id=? AND client_id=? AND module=?', [status, id, clientId, module]);
      await this.platformStore.insertAudit(connection, 'client.workspace.status', actorId, clientId, { module, itemId: id, status });
      return { id, status };
    });
  }
}
