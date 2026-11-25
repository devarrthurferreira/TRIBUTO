import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { automationFields, campaignGrowth, CRM_TOKEN, segmentFields } from './crm-growth-fields.mjs';
import { subscriberFields } from './crm-rules.mjs';
import { CrmPages } from './crm-pages.mjs';
import { CrmPageAnalytics } from './crm-page-analytics.mjs';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS platform_crm_subscriber_tags (
    subscriber_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tag VARCHAR(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY (subscriber_id,tag), KEY idx_crm_tag (tag,subscriber_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_crm_segments (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, name VARCHAR(120) NOT NULL,
    tags_json TEXT NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_crm_landings (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    slug VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE, title VARCHAR(160) NOT NULL,
    description TEXT NOT NULL, button_text VARCHAR(80) NOT NULL, tags_json TEXT NOT NULL,
    status VARCHAR(12) NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_crm_automations (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    landing_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, name VARCHAR(120) NOT NULL,
    status VARCHAR(12) NOT NULL, steps_json MEDIUMTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
    KEY idx_crm_automation_landing (landing_id,status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_crm_campaign_attributes (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, type VARCHAR(20) NOT NULL,
    segment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    landing_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    conversions INT UNSIGNED NULL, unsubscribes INT UNSIGNED NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_crm_campaign_unsubscribe_pages (
    campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    page_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_crm_leads (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    landing_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subscriber_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    confirmation_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
    confirmation_expires DATETIME(3) NOT NULL, confirmed_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_crm_lead (landing_id,subscriber_id), KEY idx_crm_lead_contact (subscriber_id,created_at),
    KEY idx_crm_lead_campaign (campaign_id,confirmed_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_crm_delivery_jobs (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    subscriber_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    automation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    step_no TINYINT UNSIGNED NULL, kind VARCHAR(12) NOT NULL, status VARCHAR(12) NOT NULL,
    consent_at DATETIME(3) NULL, subject VARCHAR(160) NOT NULL, content MEDIUMTEXT NOT NULL,
    sequence_json MEDIUMTEXT NULL, destination_path VARCHAR(100) NULL,
    confirmation_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    unsubscribe_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tracking_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    claim_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL, claimed_until DATETIME(3) NULL,
    provider_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0, first_attempt_at DATETIME(3) NULL,
    due_at DATETIME(3) NOT NULL, sent_at DATETIME(3) NULL,
    delivered_at DATETIME(3) NULL, opened_at DATETIME(3) NULL, clicked_at DATETIME(3) NULL,
    failed_at DATETIME(3) NULL, unsubscribed_at DATETIME(3) NULL,
    UNIQUE KEY uq_crm_job_campaign (campaign_id,subscriber_id),
    UNIQUE KEY uq_crm_job_automation (lead_id,automation_id,step_no),
    UNIQUE KEY uq_crm_job_unsubscribe (unsubscribe_token), UNIQUE KEY uq_crm_job_tracking (tracking_token),
    UNIQUE KEY uq_crm_job_provider (provider_id), KEY idx_crm_job_due (status,due_at,claimed_until),
    KEY idx_crm_job_automation (automation_id,status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_crm_delivery_events (
    provider_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_type VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    recorded_at DATETIME(3) NOT NULL, PRIMARY KEY (provider_id,event_type), KEY idx_crm_event_time (recorded_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];
const DAY_MS = 86_400_000;
const CONFIRMATION_TTL = 2 * DAY_MS;
const RETRY_WINDOW = 23 * 60 * 60_000;
const MAX_ATTEMPTS = 8;
const EVENT_FIELDS = new Map([['sent','sent_at'], ['delivered','delivered_at'], ['opened','opened_at'], ['clicked','clicked_at'], ['failed','failed_at']]);
const JOB_ELIGIBLE = `(job.kind = 'confirmation' AND lead.confirmation_expires > ?
      AND lead.confirmation_hash = CONVERT(SHA2(job.confirmation_token,256) USING ascii) COLLATE ascii_bin) OR (job.kind <> 'confirmation'
      AND contact.status = 'subscribed' AND contact.consent_at = job.consent_at)`;

function iso(value) {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`)).toISOString();
}
function nowAfter(value) {
  const previous = Date.parse(iso(value));
  return new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0));
}
function token() { return randomBytes(32).toString('hex'); }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function parse(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function missing(label) { throw new ApiError(404, 'CRM_NOT_FOUND', `${label} indisponível.`); }
function conflict(message) { throw new ApiError(409, 'CRM_STATE_CONFLICT', message); }
function tagValues(row) { return parse(row.tags_json); }
function timeFields(row) { return { createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }; }
function segmentRecord(row) { return { id: row.id, name: row.name, tags: tagValues(row), ...timeFields(row) }; }
function automationRecord(row) { return { id: row.id, landingId: row.landing_id, name: row.name, status: row.status,
  steps: parse(row.steps_json), ...timeFields(row) }; }

const COLLECTIONS = {
  segments: { table: 'platform_crm_segments', noun: 'Segmento', fields: segmentFields,
    record: segmentRecord, columns: ['name', 'tags_json'], values: item => [item.name, JSON.stringify(item.tags)] },
  automations: { table: 'platform_crm_automations', noun: 'Automação', fields: automationFields,
    record: automationRecord, columns: ['landing_id', 'name', 'status', 'steps_json'],
    values: item => [item.landingId, item.name, item.status, JSON.stringify(item.steps)] },
};

const DELIVERY_INSERT = `INSERT INTO platform_crm_delivery_jobs (
    id, subscriber_id, campaign_id, lead_id, automation_id, step_no, kind, status, consent_at,
    subject, content, sequence_json, destination_path, confirmation_token, unsubscribe_token, tracking_token, due_at
  ) VALUES `;
const DELIVERY_ROW = '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';

function deliveryValues(message) {
  return [randomUUID(), message.subscriberId, message.campaignId ?? null,
    message.leadId ?? null, message.automationId ?? null, message.step ?? null, message.kind, 'pending', message.consentAt ?? null,
    message.subject, message.content, message.steps ? JSON.stringify(message.steps) : null, message.destinationPath ?? null,
    message.confirmationToken ?? null, token(), token(), message.dueAt];
}

async function insertMessage(connection, message) {
  await connection.execute(DELIVERY_INSERT + DELIVERY_ROW, deliveryValues(message));
}

function insertTags(connection, subscriberId, tags) {
  if (!tags.length) return;
  return connection.execute(`INSERT INTO platform_crm_subscriber_tags (subscriber_id,tag) VALUES
    ${tags.map(() => '(?,?)').join(',')} ON DUPLICATE KEY UPDATE tag = tag`, tags.flatMap(tag => [subscriberId, tag]));
}

export class CrmGrowthStore {
  constructor(platformStore, { deliveryConfigured = false, analyticsConfigured = deliveryConfigured } = {}) {
    this.platformStore = platformStore;
    this.deliveryConfigured = deliveryConfigured;
    this.analyticsConfigured = analyticsConfigured;
    this.pages = new CrmPages(platformStore);
    this.pageAnalytics = new CrmPageAnalytics(platformStore);
  }

  async initialize() {
    for (const statement of TABLES) await this.platformStore.pool.query(statement);
    await this.pages.initialize();
    await this.pageAnalytics.initialize();
    await this.platformStore.pool.execute('DELETE FROM platform_crm_delivery_events WHERE recorded_at < ?', [new Date(Date.now() - 30 * DAY_MS)]);
  }

  async setSubscriberTags(connection, subscriberId, tags) {
    await connection.execute('DELETE FROM platform_crm_subscriber_tags WHERE subscriber_id = ?', [subscriberId]);
    await insertTags(connection, subscriberId, tags);
  }

  async storeCampaignGrowth(connection, id, input, current) {
    const item = campaignGrowth(input, current);
    if (item.segmentId) {
      const [[segment]] = await connection.execute('SELECT id FROM platform_crm_segments WHERE id = ?', [item.segmentId]);
      if (!segment) missing('Segmento');
    }
    if (item.landingId && item.landingId !== current?.landingId) {
      const [[landing]] = await connection.execute(`SELECT page.id FROM platform_crm_landings page
        LEFT JOIN platform_crm_page_designs design ON page.id = design.landing_id
        LEFT JOIN platform_crm_page_kinds page_type ON page_type.landing_id = page.id
        WHERE page.id = ? AND design.archived_at IS NULL AND COALESCE(page_type.page_kind,'landing') = 'landing'`, [item.landingId]);
      if (!landing) missing('Página');
    }
    if (item.unsubscribePageId && item.unsubscribePageId !== current?.unsubscribePageId
      && !await this.pages.publishedUnsubscribe({ id: item.unsubscribePageId }, connection)) {
      conflict('Selecione uma página de descadastro publicada.');
    }
    await connection.execute(`INSERT INTO platform_crm_campaign_attributes (id,type,segment_id,landing_id) VALUES (?,?,?,?)
      ON DUPLICATE KEY UPDATE type = ?, segment_id = ?, landing_id = ?`, [id, item.type, item.segmentId, item.landingId,
      item.type, item.segmentId, item.landingId]);
    if (item.unsubscribePageId !== (current?.unsubscribePageId ?? null)) {
      if (item.unsubscribePageId) {
        await connection.execute(`INSERT INTO platform_crm_campaign_unsubscribe_pages (campaign_id,page_id) VALUES (?,?)
          ON DUPLICATE KEY UPDATE page_id=?`, [id, item.unsubscribePageId, item.unsubscribePageId]);
      } else await connection.execute('DELETE FROM platform_crm_campaign_unsubscribe_pages WHERE campaign_id = ?', [id]);
    }
    return item;
  }

  async listGrowth() {
    const [tags, segments, landings, automations, campaigns, jobs, conversions] = await Promise.all([
      this.platformStore.rows('SELECT * FROM platform_crm_subscriber_tags ORDER BY subscriber_id,tag'),
      this.platformStore.rows('SELECT * FROM platform_crm_segments ORDER BY name,id'),
      this.pages.list(),
      this.platformStore.rows('SELECT * FROM platform_crm_automations ORDER BY updated_at DESC,id'),
      this.platformStore.rows(`SELECT attrs.*, unsubscribe.page_id AS unsubscribe_page_id FROM platform_crm_campaign_attributes attrs
        LEFT JOIN platform_crm_campaign_unsubscribe_pages unsubscribe ON unsubscribe.campaign_id = attrs.id`),
      this.platformStore.rows(`SELECT campaign_id, COUNT(*) AS total, SUM(status IN ('pending','sending')) AS queued,
        SUM(status = 'sent') AS sent, SUM(failed_at IS NOT NULL OR status = 'failed') AS failed,
        SUM(delivered_at IS NOT NULL) AS delivered, SUM(opened_at IS NOT NULL) AS opened, SUM(clicked_at IS NOT NULL) AS clicked,
        SUM(unsubscribed_at IS NOT NULL) AS unsubscribed, MIN(sent_at) AS first_sent
        FROM platform_crm_delivery_jobs WHERE campaign_id IS NOT NULL GROUP BY campaign_id`),
      this.platformStore.rows(`SELECT campaign_id, COUNT(DISTINCT subscriber_id) AS total FROM platform_crm_leads
        WHERE campaign_id IS NOT NULL AND confirmed_at IS NOT NULL GROUP BY campaign_id`),
    ]);
    const tagsFor = new Map();
    for (const { subscriber_id: id, tag } of tags) {
      if (!tagsFor.has(id)) tagsFor.set(id, []);
      tagsFor.get(id).push(tag);
    }
    const jobStats = new Map(jobs.map(row => [row.campaign_id, row]));
    const conversionStats = new Map(conversions.map(row => [row.campaign_id, Number(row.total)]));
    const campaignDetails = new Map(campaigns.map(row => {
      const job = jobStats.get(row.id);
      const measured = value => Number(value) || (this.analyticsConfigured ? 0 : null);
      return [row.id, { type: row.type, segmentId: row.segment_id, landingId: row.landing_id, unsubscribePageId: row.unsubscribe_page_id ?? null,
        deliveryMode: job ? 'native' : 'external',
        queuedCount: Number(job?.queued || 0), failedCount: Number(job?.failed || 0),
        conversionCount: job ? (conversionStats.get(row.id) ?? 0) : row.conversions ?? null,
        unsubscribeCount: job ? Number(job.unsubscribed) : row.unsubscribes ?? null,
        ...(job ? { sentCount: Number(job.sent), deliveredCount: measured(job.delivered), openCount: measured(job.opened),
          clickCount: measured(job.clicked), sentAt: iso(job.first_sent) } : {}) }];
    }));
    return { tagsFor, campaignDetails, segments: segments.map(segmentRecord), landings, automations: automations.map(automationRecord) };
  }

  async putGrowthRecord(collection, id, input, actorId) {
    if (collection === 'landings') return this.pages.put(id, input, actorId);
    const { table, noun, fields, record, columns, values } = COLLECTIONS[collection];
    try {
      return await this.platformStore.transaction(async connection => {
        const [[row]] = id ? await connection.execute(`SELECT * FROM ${table} WHERE id = ? FOR UPDATE`, [id]) : [[]];
        if (id && !row) missing(noun);
        const current = row && record(row);
        const item = fields(input, current);
        if (collection === 'automations') {
          const [[landing]] = await connection.execute('SELECT status FROM platform_crm_landings WHERE id = ?', [item.landingId]);
          if (!landing || (item.status === 'active' && landing.status !== 'published')) conflict('Publique a página antes de ativar a automação.');
        }
        const updated = nowAfter(row?.updated_at);
        const recordId = id ?? randomUUID();
        if (id) await connection.execute(`UPDATE ${table} SET ${columns.map(column => `${column} = ?`).join(',')},updated_at = ? WHERE id = ?`, [...values(item), updated, id]);
        else await connection.execute(`INSERT INTO ${table} (id,${columns.join(',')},created_at,updated_at)
          VALUES (${Array(columns.length + 3).fill('?').join(',')})`, [recordId, ...values(item), updated, updated]);
        await this.platformStore.insertAudit(connection, `marketing.crm.${collection}.${id ? 'update' : 'create'}`, actorId, recordId);
        const [[saved]] = await connection.execute(`SELECT * FROM ${table} WHERE id = ?`, [recordId]);
        return record(saved);
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') conflict('Esse endereço já está em uso por outra página.');
      throw error;
    }
  }

  async getPreparedSegment(connection, id) {
    if (!id) return null;
    const [[row]] = await connection.execute('SELECT * FROM platform_crm_segments WHERE id = ?', [id]);
    return row && tagValues(row);
  }

  async publicLanding(slug) {
    if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return null;
    return this.pages.publicPage(slug);
  }

  async publicUnsubscribePreview(slug) {
    if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return null;
    return this.pages.publishedUnsubscribe({ slug });
  }

  async publicUnsubscribePage(value) {
    if (typeof value !== 'string' || !CRM_TOKEN.test(value)) return null;
    const job = await this.platformStore.one(`SELECT unsubscribe.page_id FROM platform_crm_delivery_jobs delivery
      LEFT JOIN platform_crm_campaign_unsubscribe_pages unsubscribe ON unsubscribe.campaign_id = delivery.campaign_id
      WHERE delivery.unsubscribe_token = ? AND delivery.kind <> 'confirmation' AND (delivery.sent_at IS NOT NULL OR delivery.status = 'sending')`, [value]);
    if (!job) return null;
    const specific = job.page_id && await this.pages.publishedUnsubscribe({ id: job.page_id });
    return specific || this.pages.publishedUnsubscribe();
  }

  async captureLanding(slug, input, { includeLead = false } = {}) {
    if (input.consent !== true) throw new ApiError(400, 'CRM_CONSENT_REQUIRED', 'Confirme que deseja receber mensagens.');
    const { email, name } = subscriberFields(input);
    return this.platformStore.transaction(async connection => {
      const landing = await this.pages.publicPage(slug, connection);
      if (!landing || (landing.blocks && !landing.blocks.some(({ type }) => type === 'form'))) missing('Página');
      const now = new Date();
      const newId = randomUUID();
      await connection.execute(`INSERT INTO platform_marketing_subscribers (id,email,name,status,source,created_at,updated_at)
        VALUES (?,?,?,'pending',?,?,?) ON DUPLICATE KEY UPDATE id = id`, [newId, email, name, `Página ${landing.slug}`, now, now]);
      const [[contact]] = await connection.execute('SELECT id,status FROM platform_marketing_subscribers WHERE email = ? FOR UPDATE', [email]);
      const [[previous]] = await connection.execute('SELECT * FROM platform_crm_leads WHERE landing_id = ? AND subscriber_id = ? FOR UPDATE', [landing.id, contact.id]);
      if ((previous?.confirmed_at && contact.status !== 'unsubscribed')
        || (previous?.confirmation_hash && new Date(iso(previous.confirmation_expires)) > now)) {
        return { accepted: true, ...(includeLead && { leadId: previous.id }) };
      }
      const [[recent]] = await connection.execute('SELECT id FROM platform_crm_leads WHERE subscriber_id = ? AND created_at > ? LIMIT 1',
        [contact.id, new Date(Date.now() - 20 * 60_000)]);
      if (recent) return { accepted: true };
      const ref = typeof input.conversionToken === 'string' && CRM_TOKEN.test(input.conversionToken) ? input.conversionToken : null;
      const [[source]] = ref ? await connection.execute(`SELECT campaign_id FROM platform_crm_delivery_jobs
        WHERE tracking_token = ? AND subscriber_id = ? AND destination_path = ? AND sent_at IS NOT NULL`,
      [ref, contact.id, `/inscricao/${landing.slug}`]) : [[]];
      const confirmToken = token();
      const hash = digest(confirmToken);
      const expires = new Date(Date.now() + CONFIRMATION_TTL);
      const leadId = previous?.id || randomUUID();
      const campaignId = source?.campaign_id ?? null;
      if (previous) await connection.execute(`UPDATE platform_crm_leads SET campaign_id = CASE WHEN confirmed_at IS NULL THEN ? ELSE campaign_id END,
        confirmation_hash = ?, confirmation_expires = ?, created_at = ? WHERE id = ?`,
        [campaignId, hash, expires, now, leadId]);
      else await connection.execute(`INSERT INTO platform_crm_leads (id,landing_id,subscriber_id,campaign_id,confirmation_hash,confirmation_expires,created_at)
        VALUES (?,?,?,?,?,?,?)`, [leadId, landing.id, contact.id, campaignId, hash, expires, now]);
      await insertMessage(connection, { kind: 'confirmation', leadId, subscriberId: contact.id, subject: 'Confirme sua inscrição na Maximum',
        content: 'Para confirmar que deseja receber as novidades da Maximum, use o link abaixo.', confirmationToken: confirmToken, dueAt: now });
      return { accepted: true, ...(includeLead && { leadId }) };
    });
  }

  async confirmLead(value) {
    if (typeof value !== 'string' || !CRM_TOKEN.test(value)) return false;
    return this.platformStore.transaction(async connection => {
      const [[candidate]] = await connection.execute('SELECT subscriber_id,landing_id FROM platform_crm_leads WHERE confirmation_hash = ?', [digest(value)]);
      if (!candidate) return false;
      const landing = await this.pages.publishedById(candidate.landing_id, connection);
      if (!landing) return false;
      const [[contact]] = await connection.execute('SELECT * FROM platform_marketing_subscribers WHERE id = ? FOR UPDATE', [candidate.subscriber_id]);
      const [[lead]] = await connection.execute(`SELECT * FROM platform_crm_leads WHERE confirmation_hash = ? AND confirmation_expires > ? FOR UPDATE`, [digest(value), new Date()]);
      if (!contact || !lead) return false;
      const now = nowAfter(contact.updated_at);
      const consentAt = contact.status === 'subscribed' && contact.consent_at ? new Date(iso(contact.consent_at)) : now;
      await connection.execute(`UPDATE platform_marketing_subscribers SET status = 'subscribed', consent_at = ?, source = ?, updated_at = ? WHERE id = ?`,
        [consentAt, contact.status === 'subscribed' ? contact.source : `Confirmação por e-mail · ${landing.slug}`, now, contact.id]);
      await connection.execute('UPDATE platform_crm_leads SET confirmed_at = COALESCE(confirmed_at, ?), confirmation_hash = NULL WHERE id = ?', [now, lead.id]);
      await insertTags(connection, contact.id, landing.tags);
      return true;
    });
  }

  async unsubscribe(value) {
    if (typeof value !== 'string' || !CRM_TOKEN.test(value)) return false;
    return this.platformStore.transaction(async connection => {
      const [[job]] = await connection.execute(`SELECT id, subscriber_id, consent_at FROM platform_crm_delivery_jobs
        WHERE unsubscribe_token = ? AND kind <> 'confirmation' AND (sent_at IS NOT NULL OR status = 'sending')`, [value]);
      if (!job) return false;
      const now = new Date();
      const [change] = await connection.execute(`UPDATE platform_marketing_subscribers
        SET status = 'unsubscribed', consent_at = NULL, updated_at = GREATEST(updated_at + INTERVAL 1000 MICROSECOND, ?)
        WHERE id = ? AND status = 'subscribed' AND consent_at = ?`, [now, job.subscriber_id, job.consent_at]);
      if (change.affectedRows) {
        await this.invalidateLeadConfirmations(connection, job.subscriber_id);
        await connection.execute(`UPDATE platform_crm_delivery_jobs SET unsubscribed_at = COALESCE(unsubscribed_at,?) WHERE id = ?`, [now, job.id]);
      }
      return true;
    });
  }

  async invalidateLeadConfirmations(connection, subscriberId) {
    await connection.execute('UPDATE platform_crm_leads SET confirmation_hash = NULL WHERE subscriber_id = ? AND confirmation_hash IS NOT NULL', [subscriberId]);
  }

  async queueCampaign(id, actorId) {
    if (!this.deliveryConfigured) throw new ApiError(409, 'CRM_DELIVERY_UNCONFIGURED', 'Configure o provedor de e-mail para iniciar o envio.');
    return this.platformStore.transaction(async connection => {
      const [[campaign]] = await connection.execute('SELECT * FROM platform_marketing_campaigns WHERE id = ? FOR UPDATE', [id]);
      if (!campaign) missing('Campanha');
      if (campaign.status === 'queued' || ['sent','failed'].includes(campaign.status)) {
        const [[job]] = await connection.execute('SELECT id FROM platform_crm_delivery_jobs WHERE campaign_id = ? LIMIT 1', [id]);
        if (job) return { id, status: campaign.status, deliveryMode: 'native' };
      }
      if (campaign.status !== 'prepared') conflict('Prepare o público antes de colocar a campanha na fila.');
      const [[attributes]] = await connection.execute('SELECT landing_id FROM platform_crm_campaign_attributes WHERE id = ?', [id]);
      const landing = attributes?.landing_id ? await this.pages.publishedById(attributes.landing_id, connection) : null;
      if (attributes?.landing_id && !landing) conflict('Publique a página vinculada antes de enviar a campanha.');
      const [recipients] = await connection.execute(`SELECT contact.id,contact.consent_at FROM platform_marketing_campaign_audience audience
        JOIN platform_marketing_subscribers contact ON contact.id = audience.subscriber_id AND contact.consent_at = audience.consent_at
        WHERE audience.campaign_id = ? AND contact.status = 'subscribed' ORDER BY contact.id`, [id]);
      if (!recipients.length) conflict('A campanha ficou sem destinatários com consentimento.');
      const now = new Date();
      const destinationPath = landing && `/inscricao/${landing.slug}`;
      await connection.execute(`INSERT INTO platform_crm_campaign_attributes (id,type) VALUES (?,'promotion')
        ON DUPLICATE KEY UPDATE id = id`, [id]);
      if (landing) {
        await connection.execute('INSERT INTO platform_crm_campaign_email_designs (campaign_id,publication_json) VALUES (?,?)',
          [id, JSON.stringify({ ...landing, templateVersion: 2 })]);
      }
      const messageBytes = Buffer.byteLength(campaign.subject) + Buffer.byteLength(campaign.content) + 614;
      const batchSize = Math.max(1, Math.min(100, Math.floor(350_000 / messageBytes)));
      for (let offset = 0; offset < recipients.length; offset += batchSize) {
        const rows = recipients.slice(offset, offset + batchSize).map(recipient => deliveryValues({ kind: 'campaign', campaignId: id,
          subscriberId: recipient.id, consentAt: new Date(iso(recipient.consent_at)), subject: campaign.subject, content: campaign.content,
          destinationPath, dueAt: now }));
        await connection.execute(DELIVERY_INSERT + rows.map(() => DELIVERY_ROW).join(','), rows.flat());
      }
      await connection.execute(`UPDATE platform_marketing_campaigns SET status = 'queued',audience_count = ?,updated_at = ? WHERE id = ?`, [recipients.length, now, id]);
      await this.platformStore.insertAudit(connection, 'marketing.crm.campaign.queue', actorId, id, { count: recipients.length });
      return { id, status: 'queued', deliveryMode: 'native', queuedCount: recipients.length, audienceCount: recipients.length };
    });
  }

  async previewCampaign(id) {
    const campaign = await this.platformStore.one(`SELECT campaign.subject,campaign.content,attrs.landing_id,email.publication_json
      FROM platform_marketing_campaigns campaign LEFT JOIN platform_crm_campaign_attributes attrs ON attrs.id = campaign.id
      LEFT JOIN platform_crm_campaign_email_designs email ON email.campaign_id = campaign.id WHERE campaign.id = ?`, [id]);
    if (!campaign) missing('Campanha');
    const publication = parse(campaign.publication_json) ?? (campaign.landing_id ? await this.pages.publishedById(campaign.landing_id) : null);
    return { subject: campaign.subject, content: campaign.content, blocks: publication?.blocks ?? null,
      legacy: Boolean(campaign.publication_json && !publication?.templateVersion),
      action: publication ? `/inscricao/${publication.slug}` : null };
  }

  async settleCampaign(connection, id) {
    if (!id) return;
    await connection.execute(`UPDATE platform_marketing_campaigns SET status = CASE WHEN EXISTS (
        SELECT 1 FROM platform_crm_delivery_jobs job WHERE job.campaign_id = ? AND job.status = 'sent'
      ) THEN 'sent' ELSE 'failed' END,updated_at = ? WHERE id = ? AND status = 'queued' AND NOT EXISTS (
        SELECT 1 FROM platform_crm_delivery_jobs job WHERE job.campaign_id = ? AND job.status IN ('pending','sending')
      )`, [id, new Date(), id, id]);
  }

  async claimDelivery() {
    return this.platformStore.transaction(async connection => {
      const now = new Date();
      const cutoff = new Date(Date.now() - RETRY_WINDOW);
      const [[job]] = await connection.execute(`SELECT job.*,contact.email,contact.name,email_design.publication_json,
          (${JOB_ELIGIBLE}) AS eligible
        FROM platform_crm_delivery_jobs job
        JOIN platform_marketing_subscribers contact ON contact.id = job.subscriber_id
        LEFT JOIN platform_crm_leads lead ON lead.id = job.lead_id
        LEFT JOIN platform_crm_campaign_email_designs email_design ON email_design.campaign_id = job.campaign_id
        WHERE ((job.status = 'pending' AND job.due_at <= ?) OR (job.status = 'sending' AND job.claimed_until <= ?))
          AND job.kind IN ('confirmation','campaign')
        ORDER BY job.due_at,job.id LIMIT 1 FOR UPDATE`, [now, now, now]);
      if (!job) return null;
      const eligible = Boolean(Number(job.eligible));
      if (!eligible || job.attempts >= MAX_ATTEMPTS || (job.first_attempt_at && new Date(iso(job.first_attempt_at)) <= cutoff)) {
        await connection.execute(`UPDATE platform_crm_delivery_jobs SET status = ?, failed_at = ?, confirmation_token = NULL,
          claim_token = NULL, claimed_until = NULL WHERE id = ?`, [eligible ? 'failed' : 'skipped', eligible ? now : null, job.id]);
        await this.settleCampaign(connection, job.campaign_id);
        return { skipped: true };
      }
      const claim = token();
      const claimedUntil = new Date(Date.now() + 60_000);
      await connection.execute(`UPDATE platform_crm_delivery_jobs SET status = 'sending', claim_token = ?, claimed_until = ?,
        attempts = attempts + 1, first_attempt_at = COALESCE(first_attempt_at,?) WHERE id = ?`, [claim, claimedUntil, now, job.id]);
      return { id: job.id, claim, kind: job.kind, email: job.email, name: job.name, subject: job.subject, content: job.content,
        destinationPath: job.destination_path, trackingToken: job.tracking_token, unsubscribeToken: job.unsubscribe_token,
        confirmationToken: job.confirmation_token, attempts: Number(job.attempts) + 1, emailPublication: parse(job.publication_json) ?? null };
    });
  }

  async validateDeliveryClaim(id, claim) {
    const now = new Date();
    const eligible = await this.platformStore.one(`SELECT job.id FROM platform_crm_delivery_jobs job
      JOIN platform_marketing_subscribers contact ON contact.id = job.subscriber_id
      LEFT JOIN platform_crm_leads lead ON lead.id = job.lead_id
      WHERE job.id = ? AND job.claim_token = ? AND job.status = 'sending' AND job.claimed_until > ?
      AND (${JOB_ELIGIBLE}) AND job.kind IN ('confirmation','campaign')`, [id, claim, now, now]);
    return Boolean(eligible);
  }

  async completeDelivery(id, claim, providerId) {
    if (typeof providerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(providerId)) throw new Error('Identificador de entrega inválido.');
    return this.platformStore.transaction(async connection => {
      const [[job]] = await connection.execute(`SELECT * FROM platform_crm_delivery_jobs WHERE id = ? AND claim_token = ? AND status = 'sending' FOR UPDATE`, [id, claim]);
      if (!job) return false;
      await connection.execute(`UPDATE platform_crm_delivery_jobs SET status = 'sent',provider_id = ?,sent_at = ?,
        claim_token = NULL,claimed_until = NULL,confirmation_token = NULL WHERE id = ?`, [providerId, new Date(), id]);
      const [events] = await connection.execute('SELECT event_type,recorded_at FROM platform_crm_delivery_events WHERE provider_id = ?', [providerId]);
      for (const event of events) await this.applyDeliveryEvent(connection, providerId, event.event_type, event.recorded_at);
      await this.settleCampaign(connection, job.campaign_id);
      return true;
    });
  }

  async failDelivery(id, claim, { retryAt = null } = {}) {
    return this.platformStore.transaction(async connection => {
      const [[job]] = await connection.execute(`SELECT * FROM platform_crm_delivery_jobs WHERE id = ? AND claim_token = ? AND status = 'sending' FOR UPDATE`, [id, claim]);
      if (!job) return false;
      const retry = retryAt instanceof Date && Number.isFinite(retryAt.getTime()) && job.attempts < MAX_ATTEMPTS
        && retryAt.getTime() < Date.parse(iso(job.first_attempt_at)) + RETRY_WINDOW;
      await connection.execute(`UPDATE platform_crm_delivery_jobs SET status = ?, due_at = ?, failed_at = ?,
        confirmation_token = ?,claim_token = NULL,claimed_until = NULL WHERE id = ?`,
      [retry ? 'pending' : 'failed', retry ? retryAt : new Date(), retry ? null : new Date(), retry ? job.confirmation_token : null, id]);
      if (!retry) await this.settleCampaign(connection, job.campaign_id);
      return true;
    });
  }

  async trackDelivery(providerId, type) {
    if (!EVENT_FIELDS.has(type) || typeof providerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(providerId)) return false;
    const stamp = new Date();
    await this.platformStore.pool.execute(`INSERT INTO platform_crm_delivery_events (provider_id,event_type,recorded_at)
      VALUES (?,?,?) ON DUPLICATE KEY UPDATE event_type = event_type`, [providerId, type, stamp]);
    await this.applyDeliveryEvent(this.platformStore.pool, providerId, type, stamp);
    return true;
  }

  async applyDeliveryEvent(connection, providerId, type, stamp) {
    const field = EVENT_FIELDS.get(type);
    if (field) await connection.execute(`UPDATE platform_crm_delivery_jobs SET ${field} = COALESCE(${field},?) WHERE provider_id = ?`,
      [stamp instanceof Date ? stamp : new Date(iso(stamp)), providerId]);
  }
}
