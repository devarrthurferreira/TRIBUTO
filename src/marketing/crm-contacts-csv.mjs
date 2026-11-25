import { ApiError } from '../api/validation.mjs';
import { tagList } from './crm-growth-fields.mjs';
import { subscriberFields } from './crm-rules.mjs';

const MAX_BYTES = 96_000;
const MAX_ROWS = 500;
const MAX_COLUMNS = 30;

const FIELD_ALIASES = new Map([
  ['email', 'email'], ['endereco de email', 'email'], ['endereco de e mail', 'email'], ['e mail', 'email'],
  ['nome', 'name'], ['name', 'name'], ['nome completo', 'name'],
  ['interesses', 'tags'], ['interesse', 'tags'], ['tags', 'tags'],
  ['status', 'status'], ['situacao', 'status'],
  ['origem', 'source'], ['source', 'source'], ['origem do consentimento', 'source'], ['origem da inscricao', 'source'],
]);
const CONTACT_STATUSES = new Map([
  ['', 'pending'], ['pending', 'pending'], ['pendente', 'pending'],
  ['subscribed', 'subscribed'], ['inscrito', 'subscribed'], ['inscrita', 'subscribed'],
  ['unsubscribed', 'unsubscribed'], ['descadastrado', 'unsubscribed'], ['descadastrada', 'unsubscribed'],
]);

function csvError(message) {
  throw new ApiError(400, 'CRM_CONTACTS_CSV', message);
}

function normalized(value) {
  return value.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

function contactDelimiter(source) {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (const char of source.trimStart()) {
    if (char === '"') quoted = !quoted;
    else if (!quoted) {
      if (char === '\n' || char === '\r') break;
      if (char === ',') commas += 1;
      if (char === ';') semicolons += 1;
    }
  }
  return semicolons > commas ? ';' : ',';
}

function parseRows(source, delimiter) {
  const rows = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  let line = 1;
  let rowLine = 1;

  function finishCell() {
    cells.push(cell);
    if (cells.length > MAX_COLUMNS) csvError(`O CSV aceita até ${MAX_COLUMNS} colunas.`);
    cell = '';
    closed = false;
  }

  function finishRow() {
    finishCell();
    if (cells.some(value => value.trim())) rows.push({ line: rowLine, cells });
    if (rows.length > MAX_ROWS + 1) csvError(`Importe até ${MAX_ROWS} contatos por arquivo.`);
    cells = [];
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const newline = char === '\r' || char === '\n';
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { cell += '"'; index += 1; }
        else { quoted = false; closed = true; }
      } else if (newline) {
        if (char === '\r' && source[index + 1] === '\n') index += 1;
        cell += '\n';
        line += 1;
      } else cell += char;
      continue;
    }
    if (newline) {
      finishRow();
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      line += 1;
      rowLine = line;
    } else if (char === delimiter) {
      finishCell();
    } else if (char === '"' && !closed && !cell.trim()) {
      cell = '';
      quoted = true;
    } else if (closed) {
      if (!/\s/.test(char)) csvError(`Confira as aspas na linha ${line}.`);
    } else if (char === '"') {
      csvError(`Confira as aspas na linha ${line}.`);
    } else cell += char;
  }

  if (quoted) csvError(`Feche as aspas da linha ${rowLine}.`);
  finishRow();
  return rows;
}

function contactRecords(csv) {
  if (typeof csv !== 'string' || !csv.trim()) csvError('Selecione um arquivo CSV com pelo menos um e-mail.');
  if (Buffer.byteLength(csv, 'utf8') > MAX_BYTES) csvError('Selecione um CSV de até 96 KB.');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(csv)) csvError('Salve a lista como CSV UTF-8 antes de importar.');
  const source = csv.replace(/^\ufeff/, '');
  const rows = parseRows(source, contactDelimiter(source));
  const first = rows[0];
  if (!first) csvError('Selecione um arquivo CSV com pelo menos um e-mail.');
  let columns = first.cells.map(value => FIELD_ALIASES.get(normalized(value)));
  if (columns.includes('email')) {
    if (new Set(columns.filter(Boolean)).size !== columns.filter(Boolean).length) csvError('Use apenas uma coluna para cada campo do contato.');
    rows.shift();
  } else if (first.cells.length === 1 && first.cells[0].includes('@')) {
    columns = ['email'];
  } else csvError('Inclua uma coluna chamada e-mail no CSV.');
  if (rows.length > MAX_ROWS) csvError(`Importe até ${MAX_ROWS} contatos por arquivo.`);
  if (!rows.length) csvError('Inclua pelo menos um contato no CSV.');
  return { columns, rows };
}

export async function importCrmContacts(store, csv, actorId) {
  const { columns, rows } = contactRecords(csv);
  const result = { imported: 0, duplicates: 0, invalid: 0, total: rows.length, errors: [] };
  const emails = new Set();
  for (const { line, cells } of rows) {
    try {
      if (cells.length > columns.length) csvError('Use o mesmo número de colunas do cabeçalho.');
      const values = Object.fromEntries(columns.flatMap((key, index) => key ? [[key, cells[index] ?? '']] : []));
      let status = CONTACT_STATUSES.get(normalized(values.status || ''));
      if (!status) csvError('Use pendente, inscrito ou descadastrado como status.');
      if (status === 'subscribed' && !values.source?.trim()) status = 'pending';
      const contact = subscriberFields({ ...values, status });
      if (emails.has(contact.email)) { result.duplicates += 1; continue; }
      const tags = tagList((values.tags || '').split(/[,;|]/).map(value => value.trim()).filter(Boolean));
      await store.createSubscriber({ ...contact, tags }, actorId);
      emails.add(contact.email);
      result.imported += 1;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 409 && error.code === 'CRM_STATE_CONFLICT') {
        result.duplicates += 1;
        continue;
      }
      if (error.status !== 400) throw error;
      result.invalid += 1;
      if (result.errors.length < 20) result.errors.push({ row: line, message: error.message });
    }
  }
  return result;
}

function spreadsheetCell(value) {
  const text = String(value ?? '');
  const safe = /^[\t\n\r]|^[\s\u0000-\u001f\u007f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function exportCrmContacts(store) {
  const records = await store.platformStore.rows(`SELECT contact.id, contact.email, contact.name, contact.status, contact.source, tags.tag
    FROM platform_marketing_subscribers contact
    LEFT JOIN platform_crm_subscriber_tags tags ON tags.subscriber_id = contact.id
    ORDER BY contact.email, contact.id, tags.tag`);
  const contacts = new Map();
  for (const row of records) {
    if (!contacts.has(row.id)) contacts.set(row.id, { ...row, tags: [] });
    if (row.tag) contacts.get(row.id).tags.push(row.tag);
  }
  const statuses = { pending: 'pendente', subscribed: 'inscrito', unsubscribed: 'descadastrado' };
  const rows = ['email;nome;interesses;status;origem'];
  for (const contact of contacts.values()) {
    rows.push([contact.email, contact.name, contact.tags.join('|'), statuses[contact.status], contact.source].map(spreadsheetCell).join(';'));
  }
  return { csv: `\ufeff${rows.join('\r\n')}\r\n`, count: contacts.size };
}
