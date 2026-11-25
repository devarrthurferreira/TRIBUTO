import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { growthText, invalidGrowth, landingFields } from './crm-growth-fields.mjs';

const BLOCK_TYPES = new Set(['heading', 'text', 'image', 'button', 'divider', 'form']);
const BLOCK_ALIGNMENTS = new Set(['left', 'center', 'right']);
const SAFE_BLOCK_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const SAFE_HEX = /^#[a-f0-9]{6}$/i;
const SAFE_ANCHOR = /^#[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const LANDING_COLUMNS = 'page.*, design.draft_json, design.published_json, design.published_at, design.archived_at';
const LANDING_JOIN = 'FROM platform_crm_landings page LEFT JOIN platform_crm_page_designs design ON design.landing_id = page.id';
const LANDING_SELECT = `SELECT ${LANDING_COLUMNS} ${LANDING_JOIN}`;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS platform_crm_page_designs (
    landing_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    draft_json MEDIUMTEXT NULL, published_json MEDIUMTEXT NULL, published_at DATETIME(3) NULL,
    archived_at DATETIME(3) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_crm_page_templates (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    name VARCHAR(120) NOT NULL, blocks_json MEDIUMTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL, archived_at DATETIME(3) NULL,
    KEY idx_crm_page_template (archived_at,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_crm_campaign_email_designs (
    campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    publication_json MEDIUMTEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

function parse(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function iso(value) {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`)).toISOString();
}
function newer(value) {
  const previous = Date.parse(iso(value));
  return new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0));
}
function missing(label) { throw new ApiError(404, 'CRM_NOT_FOUND', `${label} indisponível.`); }
function conflict(message) { throw new ApiError(409, 'CRM_STATE_CONFLICT', message); }

function blockUrl(value, kind) {
  const url = growthText(value, 'o endereço do bloco', 2048);
  if (!url) return '';
  if (kind === 'button' && SAFE_ANCHOR.test(url)) return url;
  if (/^\/(?![\\/])/.test(url) && !/[\\\s\u0000-\u001f\u007f]/.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return parsed.href;
  } catch { /* Validation below covers malformed URLs. */ }
  return invalidGrowth('Informe um endereço HTTPS ou um caminho local para o bloco.');
}

function blockColor(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !SAFE_HEX.test(value)) invalidGrowth('Informe uma cor hexadecimal de seis dígitos.');
  return value.toLowerCase();
}

export function pageBlocks(value) {
  if (!Array.isArray(value) || value.length > 48) invalidGrowth('Adicione até 48 blocos por página.');
  const ids = new Set();
  let forms = 0;
  const blocks = value.map(block => {
    if (!block || typeof block !== 'object' || Array.isArray(block) || !BLOCK_TYPES.has(block.type)) {
      invalidGrowth('Selecione um tipo de bloco válido.');
    }
    if (typeof block.id !== 'string' || !SAFE_BLOCK_ID.test(block.id) || ids.has(block.id)) invalidGrowth('Cada bloco precisa ter um identificador único.');
    ids.add(block.id);
    if (block.type === 'form' && ++forms > 1) invalidGrowth('Uma página pode ter um formulário de inscrição.');
    const align = block.align || 'left';
    if (!BLOCK_ALIGNMENTS.has(align)) invalidGrowth('Confira o alinhamento do bloco.');
    return {
      id: block.id, type: block.type, title: growthText(block.title, 'o título do bloco', 200),
      text: growthText(block.text, 'o texto do bloco', block.type === 'form' ? 80 : 4000),
      url: ['image', 'button'].includes(block.type) ? blockUrl(block.url, block.type) : '',
      alt: growthText(block.alt, 'o texto alternativo da imagem', 180), align,
      color: blockColor(block.color), background: blockColor(block.background),
    };
  });
  if (Buffer.byteLength(JSON.stringify(blocks)) > 112_000) invalidGrowth('Reduza o conteúdo da página antes de salvar.');
  return blocks;
}

function draftFields(row) {
  return { id: row.id, title: row.title, slug: row.slug, description: row.description, buttonText: row.button_text,
    tags: parse(row.tags_json), blocks: parse(row.draft_json) ?? null };
}

function designOf(fields) {
  return { id: fields.id, slug: fields.slug, title: fields.title, description: fields.description,
    buttonText: fields.buttonText, tags: fields.tags, blocks: fields.blocks ?? null };
}

function publicationOf(row) {
  if (row.status !== 'published' || row.archived_at) return null;
  return parse(row.published_json) ?? designOf({ ...draftFields(row), blocks: null });
}

export function crmPageRecord(row, { includeBlocks = true } = {}) {
  const { blocks, ...fields } = draftFields(row);
  const publication = publicationOf(row);
  return {
    ...fields, status: row.status, path: `/inscricao/${row.slug}`, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    published: Boolean(publication), publishedAt: publication ? iso(row.published_at || row.updated_at) : null,
    hasUnpublishedChanges: Boolean(publication && row.published_json && JSON.stringify(publication) !== JSON.stringify(designOf({ ...fields, blocks }))),
    leadCount: Number(row.lead_count || 0), pendingCount: Number(row.pending_count || 0),
    ...(includeBlocks && { blocks: blocks ?? [], legacyDesign: blocks === null }),
  };
}

function templateRecord(row) {
  return { id: row.id, name: row.name, blocks: parse(row.blocks_json), createdAt: iso(row.created_at) };
}

export class CrmPages {
  constructor(platformStore) { this.store = platformStore; }

  async initialize() {
    for (const query of SCHEMA) await this.store.pool.query(query);
  }

  async list() {
    const rows = await this.store.rows(`SELECT ${LANDING_COLUMNS}, leads.lead_count, leads.pending_count ${LANDING_JOIN} LEFT JOIN (
      SELECT landing_id, COUNT(confirmed_at) AS lead_count, SUM(confirmed_at IS NULL) AS pending_count
      FROM platform_crm_leads GROUP BY landing_id
    ) leads ON leads.landing_id = page.id WHERE design.archived_at IS NULL ORDER BY page.updated_at DESC,page.id`);
    return rows.map(row => crmPageRecord(row, { includeBlocks: false }));
  }

  async get(id) {
    const row = await this.store.one(`${LANDING_SELECT} WHERE page.id = ? AND design.archived_at IS NULL`, [id]);
    if (!row) missing('Página');
    return crmPageRecord(row);
  }

  async put(id, input, actorId) {
    try {
      return await this.store.transaction(async connection => {
        const [[row]] = id ? await connection.execute(`${LANDING_SELECT} WHERE page.id = ? FOR UPDATE`, [id]) : [[]];
        if (id && (!row || row.archived_at)) missing('Página');
        const current = row && crmPageRecord(row);
        if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== current?.updatedAt) {
          conflict('A página mudou durante a edição. Recarregue antes de salvar novamente.');
        }
        const fields = landingFields(input, current);
        const shouldPublish = input.status === 'published';
        if (current?.published && current.slug !== fields.slug) conflict('Retire a página do ar antes de alterar o endereço.');
        const blocks = Object.hasOwn(input, 'blocks') ? pageBlocks(input.blocks) : parse(row?.draft_json) ?? null;
        if (shouldPublish && blocks !== null && !blocks.length) invalidGrowth('Adicione um bloco antes de publicar a página.');
        const now = newer(row?.updated_at);
        const pageId = id ?? randomUUID();
        const publication = shouldPublish ? designOf({ ...fields, id: pageId, blocks }) : row && publicationOf(row);
        const publishedAt = shouldPublish ? now : publication && (row.published_at || row.updated_at);
        const status = publication ? 'published' : 'draft';
        const values = [fields.slug, fields.title, fields.description, fields.buttonText, JSON.stringify(fields.tags), status];
        if (id) await connection.execute(`UPDATE platform_crm_landings SET slug=?,title=?,description=?,button_text=?,tags_json=?,status=?,updated_at=? WHERE id=?`, [...values, now, id]);
        else await connection.execute(`INSERT INTO platform_crm_landings (id,slug,title,description,button_text,tags_json,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`, [pageId, ...values, now, now]);
        const draftJson = blocks ? JSON.stringify(blocks) : null;
        const publishedJson = publication ? JSON.stringify(publication) : null;
        await connection.execute(`INSERT INTO platform_crm_page_designs (landing_id,draft_json,published_json,published_at)
          VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE draft_json=?,published_json=?,published_at=?`,
        [pageId, draftJson, publishedJson, publishedAt || null, draftJson, publishedJson, publishedAt || null]);
        const operation = shouldPublish ? 'publish' : id ? 'update' : 'create';
        await this.store.insertAudit(connection, `marketing.crm.landings.${operation}`, actorId, pageId);
        const [[saved]] = await connection.execute(`${LANDING_SELECT} WHERE page.id = ?`, [pageId]);
        return crmPageRecord(saved);
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') conflict('Esse endereço já está em uso por outra página.');
      throw error;
    }
  }

  async retire(id, actorId, { archive = false } = {}) {
    return this.store.transaction(async connection => {
      const [[row]] = await connection.execute(`${LANDING_SELECT} WHERE page.id = ? FOR UPDATE`, [id]);
      if (!row || row.archived_at) missing('Página');
      const now = newer(row.updated_at);
      await connection.execute(`UPDATE platform_crm_landings SET status='draft',updated_at=? WHERE id=?`, [now, id]);
      await connection.execute(`INSERT INTO platform_crm_page_designs (landing_id,archived_at) VALUES (?,?)
        ON DUPLICATE KEY UPDATE archived_at=?`, [id, archive ? now : null, archive ? now : null]);
      const operation = archive ? 'archive' : 'unpublish';
      await this.store.insertAudit(connection, `marketing.crm.landings.${operation}`, actorId, id);
      if (archive) return { id, archived: true };
      return crmPageRecord({ ...row, status: 'draft', updated_at: now });
    });
  }

  async publicPage(slug, connection) {
    const params = [slug];
    const query = `${LANDING_SELECT} WHERE page.slug = ? AND page.status = 'published' AND design.archived_at IS NULL${connection ? ' FOR UPDATE' : ''}`;
    const row = connection ? (await connection.execute(query, params))[0][0] : await this.store.one(query, params);
    if (!row) return null;
    return { ...publicationOf(row), path: `/inscricao/${row.slug}`, publishedAt: iso(row.published_at || row.updated_at) };
  }

  async publishedById(id, connection) {
    const query = `${LANDING_SELECT} WHERE page.id = ? AND page.status = 'published' AND design.archived_at IS NULL${connection ? ' FOR UPDATE' : ''}`;
    const row = connection ? (await connection.execute(query, [id]))[0][0] : await this.store.one(query, [id]);
    return row ? publicationOf(row) : null;
  }

  async saveTemplate(input, actorId) {
    const name = growthText(input.name, 'o nome do template', 120, true);
    const blocks = pageBlocks(input.blocks);
    if (!blocks.length) invalidGrowth('Adicione um bloco para salvar o template.');
    return this.store.transaction(async connection => {
      const row = { id: randomUUID(), name, blocks_json: JSON.stringify(blocks), created_at: new Date() };
      await connection.execute('INSERT INTO platform_crm_page_templates (id,name,blocks_json,created_at) VALUES (?,?,?,?)',
        [row.id, name, row.blocks_json, row.created_at]);
      await this.store.insertAudit(connection, 'marketing.crm.templates.create', actorId, row.id);
      return templateRecord(row);
    });
  }

  async listTemplates() {
    const rows = await this.store.rows(`SELECT * FROM platform_crm_page_templates WHERE archived_at IS NULL ORDER BY created_at DESC,id`);
    return { items: rows.map(templateRecord) };
  }

  async archiveTemplate(id, actorId) {
    return this.store.transaction(async connection => {
      const [result] = await connection.execute(`UPDATE platform_crm_page_templates SET archived_at=? WHERE id=? AND archived_at IS NULL`, [new Date(), id]);
      if (!result.affectedRows) missing('Template');
      await this.store.insertAudit(connection, 'marketing.crm.templates.archive', actorId, id);
      return { id, archived: true };
    });
  }
}
