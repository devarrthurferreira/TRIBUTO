import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { growthText, invalidGrowth, landingFields, pageKind } from './crm-growth-fields.mjs';

const BLOCK_TYPES = new Set(['heading', 'text', 'image', 'button', 'divider', 'form', 'hero', 'quote', 'list', 'spacer', 'video', 'links', 'unsubscribe']);
const BLOCK_ALIGNMENTS = new Set(['left', 'center', 'right']);
const BLOCK_WEIGHTS = new Set(['normal', 'medium', 'bold']);
const BLOCK_SIZES = { fontSize: [12, 64], padding: [0, 64], margin: [0, 64], maxWidth: [200, 1200], borderRadius: [0, 48] };
const URL_BLOCKS = new Set(['image', 'button', 'hero', 'video']);
const SAFE_BLOCK_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const SAFE_HEX = /^#[a-f0-9]{6}$/i;
const SAFE_ANCHOR = /^#[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const LANDING_COLUMNS = 'page.*, design.draft_json, design.published_json, design.published_at, design.archived_at, page_type.page_kind';
const LANDING_JOIN = `FROM platform_crm_landings page LEFT JOIN platform_crm_page_designs design ON design.landing_id = page.id
  LEFT JOIN platform_crm_page_kinds page_type ON page_type.landing_id = page.id`;
const LANDING_SELECT = `SELECT ${LANDING_COLUMNS} ${LANDING_JOIN}`;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS platform_crm_page_kinds (
    landing_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    page_kind VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    KEY idx_crm_page_kind (page_kind)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
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
  if (['button', 'hero', 'image-link', 'links'].includes(kind) && SAFE_ANCHOR.test(url)) return url;
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

function blockStyles(block) {
  const styles = {};
  for (const [name, [min, max]] of Object.entries(BLOCK_SIZES)) {
    const value = block[name];
    if (value == null || value === '') continue;
    if (!Number.isInteger(value) || value < min || value > max) invalidGrowth('Confira as medidas do bloco.');
    styles[name] = value;
  }
  if (block.lineHeight != null && block.lineHeight !== '') {
    const value = block.lineHeight;
    if (!Number.isFinite(value) || value < 1.1 || value > 2 || !Number.isInteger(value * 10)) invalidGrowth('Confira o espaçamento de linhas do bloco.');
    styles.lineHeight = value;
  }
  if (block.fontWeight) {
    if (!BLOCK_WEIGHTS.has(block.fontWeight)) invalidGrowth('Confira o peso do texto do bloco.');
    styles.fontWeight = block.fontWeight;
  }
  if (block.borderColor) styles.borderColor = blockColor(block.borderColor);
  return styles;
}

function blockContent(block) {
  const isForm = block.type === 'form' || block.type === 'unsubscribe';
  const text = growthText(block.text, 'o texto do bloco', isForm ? 80 : 4000);
  if (block.type !== 'links' || !text) return text;
  const rows = text.split(/\r?\n/).filter(line => line.trim());
  if (rows.length > 12) invalidGrowth('Adicione até 12 links por bloco.');
  return rows.map(line => {
    const separator = line.indexOf('|');
    if (separator < 1) invalidGrowth('Informe os links no formato nome | endereço, um por linha.');
    const label = growthText(line.slice(0, separator), 'o nome do link', 120, true);
    const url = blockUrl(line.slice(separator + 1), 'links');
    if (!url) invalidGrowth('Informe o endereço do link.');
    return `${label}|${url}`;
  }).join('\n');
}

export function pageBlocks(value, { kind } = {}) {
  if (!Array.isArray(value) || value.length > 48) invalidGrowth('Adicione até 48 blocos por página.');
  const ids = new Set();
  let forms = 0;
  let unsubscribes = 0;
  const blocks = value.map(block => {
    if (!block || typeof block !== 'object' || Array.isArray(block) || !BLOCK_TYPES.has(block.type)) {
      invalidGrowth('Selecione um tipo de bloco válido.');
    }
    if (typeof block.id !== 'string' || !SAFE_BLOCK_ID.test(block.id) || ids.has(block.id)) invalidGrowth('Cada bloco precisa ter um identificador único.');
    ids.add(block.id);
    if (block.type === 'form') {
      if (kind === 'unsubscribe') invalidGrowth('Use o bloco Descadastro nas páginas de descadastro.');
      if (++forms > 1) invalidGrowth('Uma página pode ter um formulário de inscrição.');
    }
    if (block.type === 'unsubscribe') {
      if (kind === 'landing') invalidGrowth('O bloco Descadastro pertence a uma página de descadastro.');
      if (++unsubscribes > 1) invalidGrowth('Uma página pode ter um formulário de descadastro.');
    }
    const align = block.align || 'left';
    if (!BLOCK_ALIGNMENTS.has(align)) invalidGrowth('Confira o alinhamento do bloco.');
    const url = URL_BLOCKS.has(block.type) ? blockUrl(block.url, block.type) : '';
    if (kind === 'unsubscribe' && block.type === 'image' && url && !url.startsWith('/')) {
      invalidGrowth('Nas páginas de descadastro, a imagem deve usar um caminho local.');
    }
    return {
      id: block.id, type: block.type, title: growthText(block.title, 'o título do bloco', 200),
      text: blockContent(block),
      url,
      alt: growthText(block.alt, 'o texto alternativo da imagem', 180), align,
      color: blockColor(block.color), background: blockColor(block.background),
      ...(block.type === 'image' && block.linkUrl && { linkUrl: blockUrl(block.linkUrl, 'image-link') }),
      ...(block.type === 'hero' && block.linkLabel && { linkLabel: growthText(block.linkLabel, 'o texto do botão', 80) }),
      ...blockStyles(block),
    };
  });
  if (Buffer.byteLength(JSON.stringify(blocks)) > 112_000) invalidGrowth('Reduza o conteúdo da página antes de salvar.');
  return blocks;
}

function draftFields(row) {
  return { id: row.id, title: row.title, slug: row.slug, description: row.description, buttonText: row.button_text,
    tags: parse(row.tags_json), blocks: parse(row.draft_json) ?? null, kind: row.page_kind ?? 'landing' };
}

function designOf(fields) {
  return { id: fields.id, slug: fields.slug, title: fields.title, description: fields.description,
    buttonText: fields.buttonText, tags: fields.tags, blocks: fields.blocks ?? null, kind: fields.kind ?? 'landing' };
}

function publicationOf(row) {
  if (row.status !== 'published' || row.archived_at) return null;
  const publication = parse(row.published_json);
  return publication ? designOf({ ...publication, kind: publication.kind ?? row.page_kind }) : designOf({ ...draftFields(row), blocks: null });
}

function pagePath(slug, kind) {
  return kind === 'unsubscribe' ? `/crm/descadastro/${slug}` : `/inscricao/${slug}`;
}

export function crmPageRecord(row, { includeBlocks = true } = {}) {
  const { blocks, ...fields } = draftFields(row);
  const publication = publicationOf(row);
  return {
    ...fields, status: row.status, path: pagePath(row.slug, fields.kind), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    published: Boolean(publication), publishedAt: publication ? iso(row.published_at || row.updated_at) : null,
    hasUnpublishedChanges: Boolean(publication && row.published_json && JSON.stringify(publication) !== JSON.stringify(designOf({ ...fields, blocks }))),
    leadCount: Number(row.lead_count || 0), pendingCount: Number(row.pending_count || 0),
    ...(includeBlocks && { blocks: blocks ?? [], legacyDesign: blocks === null }),
  };
}

function templateRecord(row) {
  const design = parse(row.blocks_json);
  const { blocks, kind } = Array.isArray(design) ? { blocks: design, kind: 'landing' } : design;
  return { id: row.id, name: row.name, blocks, kind, createdAt: iso(row.created_at) };
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
        if (current?.kind !== fields.kind && (current?.published || row?.published_at)) conflict('O tipo de uma página publicada é permanente. Crie uma página do outro tipo.');
        const rawBlocks = parse(row?.draft_json);
        const blocks = Object.hasOwn(input, 'blocks') ? pageBlocks(input.blocks, fields) : rawBlocks == null ? null : pageBlocks(rawBlocks, fields);
        if (shouldPublish && blocks !== null && !blocks.length) invalidGrowth('Adicione um bloco antes de publicar a página.');
        if (shouldPublish && fields.kind === 'unsubscribe' && !blocks?.some(block => block.type === 'unsubscribe')) invalidGrowth('Adicione um formulário de descadastro antes de publicar.');
        const now = newer(row?.updated_at);
        const pageId = id ?? randomUUID();
        const publication = shouldPublish ? designOf({ ...fields, id: pageId, blocks }) : row && publicationOf(row);
        const publishedAt = shouldPublish ? now : publication ? row.published_at || row.updated_at : row?.published_at;
        const status = publication ? 'published' : 'draft';
        const values = [fields.slug, fields.title, fields.description, fields.buttonText, JSON.stringify(fields.tags), status];
        if (id) await connection.execute(`UPDATE platform_crm_landings SET slug=?,title=?,description=?,button_text=?,tags_json=?,status=?,updated_at=? WHERE id=?`, [...values, now, id]);
        else await connection.execute(`INSERT INTO platform_crm_landings (id,slug,title,description,button_text,tags_json,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`, [pageId, ...values, now, now]);
        await connection.execute(`INSERT INTO platform_crm_page_kinds (landing_id,page_kind) VALUES (?,?)
          ON DUPLICATE KEY UPDATE page_kind=?`, [pageId, fields.kind, fields.kind]);
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
    const query = `${LANDING_SELECT} WHERE page.slug = ? AND page.status = 'published' AND design.archived_at IS NULL
      AND COALESCE(page_type.page_kind,'landing') = 'landing'${connection ? ' FOR UPDATE' : ''}`;
    const row = connection ? (await connection.execute(query, params))[0][0] : await this.store.one(query, params);
    if (!row) return null;
    return { ...publicationOf(row), path: `/inscricao/${row.slug}`, publishedAt: iso(row.published_at || row.updated_at) };
  }

  async publishedById(id, connection) {
    const query = `${LANDING_SELECT} WHERE page.id = ? AND page.status = 'published' AND design.archived_at IS NULL
      AND COALESCE(page_type.page_kind,'landing') = 'landing'${connection ? ' FOR UPDATE' : ''}`;
    const row = connection ? (await connection.execute(query, [id]))[0][0] : await this.store.one(query, [id]);
    return row ? publicationOf(row) : null;
  }

  async publishedUnsubscribe({ id, slug } = {}, connection) {
    const field = id ? 'page.id' : slug ? 'page.slug' : null;
    const params = field ? [id || slug] : [];
    const query = `${LANDING_SELECT} WHERE page.status = 'published' AND design.archived_at IS NULL
      AND page_type.page_kind = 'unsubscribe'${field ? ` AND ${field} = ?` : ''}
      ORDER BY design.published_at DESC, page.id DESC LIMIT 1`;
    const row = connection ? (await connection.execute(query, params))[0][0] : await this.store.one(query, params);
    return row ? { ...publicationOf(row), path: pagePath(row.slug, 'unsubscribe'), publishedAt: iso(row.published_at || row.updated_at) } : null;
  }

  async saveTemplate(input, actorId) {
    const name = growthText(input.name, 'o nome do template', 120, true);
    const kind = pageKind(input.kind ?? (Array.isArray(input.blocks) && input.blocks.some(block => block?.type === 'unsubscribe') ? 'unsubscribe' : 'landing'));
    const blocks = pageBlocks(input.blocks, { kind });
    if (!blocks.length) invalidGrowth('Adicione um bloco para salvar o template.');
    return this.store.transaction(async connection => {
      const row = { id: randomUUID(), name, blocks_json: JSON.stringify({ kind, blocks }), created_at: new Date() };
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
