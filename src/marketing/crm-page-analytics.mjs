import { createHash } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';

const KEY = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const BLOCK = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const MAX_SECONDS = 14_400;
const MAX_CLICKS = 500;
const MAX_IDENTIFIED_LEADS = 200;
const VISIT_EXPIRY = 6 * 60 * 60_000;
const LEGACY_BLOCKS = [{ id: 'page-intro', type: 'heading', title: 'Introdução' }, { id: 'legacy-form', type: 'form', title: 'Inscrição' }];

const TABLES = [
  `CREATE TABLE IF NOT EXISTS platform_crm_page_visits (
    visit_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    landing_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    subscriber_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    identified_at DATETIME(3) NULL, baseline_seconds INT UNSIGNED NOT NULL DEFAULT 0,
    visible_seconds INT UNSIGNED NOT NULL DEFAULT 0, blocks_json TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
    KEY idx_crm_page_visit_landing (landing_id,campaign_id), KEY idx_crm_page_visit_subscriber (subscriber_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_crm_page_block_metrics (
    visit_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    block_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    block_type VARCHAR(16) NOT NULL, block_title VARCHAR(160) NOT NULL,
    seen TINYINT UNSIGNED NOT NULL DEFAULT 0, visible_seconds INT UNSIGNED NOT NULL DEFAULT 0, clicks INT UNSIGNED NOT NULL DEFAULT 0,
    baseline_seen TINYINT UNSIGNED NOT NULL DEFAULT 0, baseline_seconds INT UNSIGNED NOT NULL DEFAULT 0, baseline_clicks INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (visit_key,block_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_crm_page_submissions (
    lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    visit_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    block_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    attributed TINYINT UNSIGNED NOT NULL DEFAULT 0,
    KEY idx_crm_page_submission_visit (visit_key,block_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

function digest(token) {
  return createHash('sha256').update(token).digest('hex');
}

function tally(value) { return Number(value) || 0; }
function average(seconds, views) { return views ? Math.round(seconds / views) : 0; }

function notFound() {
  throw new ApiError(404, 'CRM_PAGE_NOT_FOUND', 'Página indisponível.');
}

function badEvent() {
  throw new ApiError(400, 'CRM_PAGE_EVENT_INVALID', 'Evento de página inválido.');
}

function dateValue(value) {
  if (value instanceof Date) return value;
  const text = String(value);
  return new Date(text.includes('T') ? text : text.replace(' ', 'T') + 'Z');
}

function validKey(value) { return typeof value === 'string' && KEY.test(value); }

function blockCatalog(page) {
  return Array.isArray(page.blocks) ? page.blocks.filter(block => block && BLOCK.test(block.id)).map(({ id, title, type, text }) => ({
    id, type: String(type || '').slice(0, 16), title: String(title || text || '').slice(0, 160),
  })) : LEGACY_BLOCKS;
}

function boundedNumber(value, limit) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, limit) : 0;
}

function normalizedEvent(input) {
  if (!input || !validKey(input.visitToken)) badEvent();
  if (!['start', 'measure', 'identify'].includes(input.operation)) badEvent();
  const reference = validKey(input.reference) ? input.reference : null;
  if (input.operation === 'identify' && !reference) badEvent();
  const blocks = Array.isArray(input.blocks) ? input.blocks.slice(0, 65).filter(block => block && BLOCK.test(block.id)).map(block => ({
    id: block.id, seen: block.seen === true || Number(block.clicks) > 0 || Number(block.seconds) > 0,
    clicks: boundedNumber(block.clicks, MAX_CLICKS), seconds: boundedNumber(block.seconds, MAX_SECONDS)
  })) : [];
  return { operation: input.operation, key: digest(input.visitToken), reference, blocks, seconds: boundedNumber(input.seconds, MAX_SECONDS) };
}

function presentBlock(row, submissions = {}) {
  const views = tally(row.views);
  const seconds = tally(row.seconds);
  return {
    blockId: row.block_id, title: row.block_title || '', type: row.block_type || '', views, seconds, averageSeconds: average(seconds, views), clicks: tally(row.clicks),
    submissions: tally(submissions.submissions), conversions: tally(submissions.conversions),
  };
}

async function findCampaignLink(connection, page, reference) {
  if (!reference) return null;
  const [[link]] = await connection.execute(`SELECT delivery.campaign_id,
    CASE WHEN contact.status = 'subscribed' AND contact.consent_at = delivery.consent_at THEN delivery.subscriber_id END AS subscriber_id
    FROM platform_crm_delivery_jobs delivery
    JOIN platform_marketing_subscribers contact ON contact.id = delivery.subscriber_id
    JOIN platform_crm_campaign_attributes campaign ON campaign.id = delivery.campaign_id
    WHERE delivery.tracking_token = ? AND delivery.kind = 'campaign' AND delivery.sent_at IS NOT NULL
      AND campaign.landing_id = ? AND delivery.destination_path = ? LIMIT 1`, [reference, page.id, `/inscricao/${page.slug}`]);
  return link ?? null;
}

export class CrmPageAnalytics {
  constructor(platformStore) {
    this.platformStore = platformStore;
  }

  async initialize() {
    for (const sql of TABLES) await this.platformStore.pool.query(sql);
  }

  async record(page, input) {
    if (!page?.id || !ID.test(page.id)) notFound();
    const event = normalizedEvent(input);
    return this.platformStore.transaction(async connection => {
      const now = new Date();
      if (event.operation === 'start') {
        const link = await findCampaignLink(connection, page, event.reference);
        await connection.execute(`INSERT INTO platform_crm_page_visits (visit_key,landing_id,campaign_id,blocks_json,created_at,updated_at)
          VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE visit_key = visit_key`,
          [event.key, page.id, link?.campaign_id ?? null, JSON.stringify(blockCatalog(page)), now, now]);
      }
      const [[visit]] = await connection.execute(`SELECT * FROM platform_crm_page_visits
        WHERE visit_key = ? AND landing_id = ? FOR UPDATE`, [event.key, page.id]);
      if (!visit || now - dateValue(visit.created_at) > VISIT_EXPIRY) notFound();
      const limit = Math.min(MAX_SECONDS, Math.floor((now - dateValue(visit.created_at)) / 1_000) + 1);
      const seconds = Math.max(Math.min(event.seconds, limit), tally(visit.visible_seconds));
      const allowedBlocks = new Map(JSON.parse(visit.blocks_json).map(block => [block.id, block]));
      for (const block of event.blocks) {
        const saved = allowedBlocks.get(block.id);
        if (!saved) continue;
        await connection.execute(`INSERT INTO platform_crm_page_block_metrics (visit_key,block_id,block_type,block_title,seen,clicks,visible_seconds)
          VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE seen = GREATEST(seen,?), clicks = GREATEST(clicks,?),
          visible_seconds = GREATEST(visible_seconds,?)`,
          [event.key, block.id, saved.type, saved.title, Number(block.seen), block.clicks, Math.min(block.seconds, seconds),
            Number(block.seen), block.clicks, Math.min(block.seconds, seconds)]);
      }
      await connection.execute('UPDATE platform_crm_page_visits SET visible_seconds = ?,updated_at = ? WHERE visit_key = ?',
        [seconds, now, event.key]);
      if (event.operation === 'identify' && !visit.identified_at) {
        const link = await findCampaignLink(connection, page, event.reference);
        if (link?.subscriber_id && visit.campaign_id === link.campaign_id) {
          await connection.execute(`UPDATE platform_crm_page_visits
            SET subscriber_id = ?,identified_at = ?,baseline_seconds = ? WHERE visit_key = ?`, [link.subscriber_id, now, seconds, event.key]);
          await connection.execute(`UPDATE platform_crm_page_block_metrics SET baseline_clicks = clicks,
            baseline_seconds = visible_seconds,baseline_seen = seen WHERE visit_key = ?`, [event.key]);
        }
      }
      return true;
    });
  }

  async recordSubmission(page, { leadId, visitToken, blockId }) {
    if (!page?.id || !ID.test(page.id) || !ID.test(leadId || '') || !validKey(visitToken)
      || !BLOCK.test(blockId || '')) return false;
    const filtered = Array.isArray(page.blocks) ? page.blocks.some(block => block.id === blockId && block.type === 'form') : blockId === 'legacy-form';
    if (!filtered) return false;
    const lowerBound = new Date(Date.now() - VISIT_EXPIRY);
    const [result] = await this.platformStore.pool.execute(`INSERT INTO platform_crm_page_submissions (lead_id,visit_key,block_id,attributed)
      SELECT lead.id,visit.visit_key,?,COALESCE(visit.subscriber_id = lead.subscriber_id,0)
      FROM platform_crm_leads lead JOIN platform_crm_page_visits visit ON visit.landing_id = lead.landing_id
      WHERE lead.id = ? AND visit.visit_key = ? AND visit.landing_id = ? AND visit.created_at >= ?
      ON DUPLICATE KEY UPDATE lead_id = lead_id`, [blockId, leadId, digest(visitToken), page.id, lowerBound]);
    return result.affectedRows > 0;
  }

  async report(id, campaignId = null) {
    if (typeof id !== 'string' || !ID.test(id)) notFound();
    if (campaignId !== null && (typeof campaignId !== 'string' || !ID.test(campaignId))) {
      throw new ApiError(400, 'CRM_CAMPAIGN_ID_INVALID', 'Campanha inválida.');
    }
    const { platformStore } = this;
    if (!await platformStore.one('SELECT id FROM platform_crm_landings WHERE id = ?', [id])) notFound();
    const scope = 'visit.landing_id = ?' + (campaignId ? ' AND visit.campaign_id = ?' : '');
    const leadScope = 'lead.landing_id = ?' + (campaignId ? ' AND lead.campaign_id = ?' : '');
    const where = campaignId ? [id, campaignId] : [id];
    const [total, allBlocks, captures, blockCaptures, leads] = await Promise.all([
      platformStore.one(`SELECT COUNT(*) AS visits,SUM(visit.subscriber_id IS NOT NULL) AS identified,
        SUM(visit.visible_seconds) AS seconds FROM platform_crm_page_visits visit WHERE ${scope}`, where),
      platformStore.rows(`SELECT metric.block_id,MAX(metric.block_type) AS block_type,MAX(metric.block_title) AS block_title,
        SUM(metric.seen) AS views,SUM(metric.visible_seconds) AS seconds,SUM(metric.clicks) AS clicks
        FROM platform_crm_page_block_metrics metric JOIN platform_crm_page_visits visit ON visit.visit_key = metric.visit_key
        WHERE ${scope} GROUP BY metric.block_id`, where),
      platformStore.one(`SELECT COUNT(*) AS submissions,COUNT(lead.confirmed_at) AS conversions FROM platform_crm_leads lead WHERE ${leadScope}`, where),
      platformStore.rows(`SELECT submission.block_id,COUNT(*) AS submissions,COUNT(lead.confirmed_at) AS conversions
        FROM platform_crm_page_submissions submission JOIN platform_crm_page_visits visit ON visit.visit_key = submission.visit_key
        JOIN platform_crm_leads lead ON lead.id = submission.lead_id WHERE ${scope} GROUP BY submission.block_id`, where),
      platformStore.rows(`SELECT visit.subscriber_id,contact.email,contact.name,COUNT(*) AS visits,
        SUM(visit.visible_seconds - visit.baseline_seconds) AS seconds,MAX(visit.updated_at) AS last_at
        FROM platform_crm_page_visits visit JOIN platform_marketing_subscribers contact ON contact.id = visit.subscriber_id
        WHERE ${scope} GROUP BY visit.subscriber_id,contact.email,contact.name
        ORDER BY last_at DESC,visit.subscriber_id LIMIT ?`, [...where, MAX_IDENTIFIED_LEADS + 1]),
    ]);
    const visibleLeads = leads.slice(0, MAX_IDENTIFIED_LEADS);
    const byLead = visibleLeads.length ? await this.reportLeadMetrics(scope, where, visibleLeads.map(lead => lead.subscriber_id)) : new Map();
    const allBlockCaptures = new Map(blockCaptures.map(row => [row.block_id, row]));
    const blocks = new Map(allBlocks.map(row => [row.block_id, presentBlock(row, allBlockCaptures.get(row.block_id))]));
    for (const row of blockCaptures) {
      if (!blocks.has(row.block_id)) blocks.set(row.block_id, presentBlock(row, row));
    }
    const visits = tally(total.visits);
    const seconds = tally(total.seconds);
    return {
      visits, seconds, identifiedVisits: tally(total.identified), averageSeconds: average(seconds, visits),
      clicks: allBlocks.reduce((sum, block) => sum + tally(block.clicks), 0), submissions: tally(captures.submissions), conversions: tally(captures.conversions),
      blocks: [...blocks.values()], moreLeads: leads.length > MAX_IDENTIFIED_LEADS,
      leads: visibleLeads.map(lead => {
        const blocks = byLead.get(lead.subscriber_id) ?? [];
        return {
          subscriberId: lead.subscriber_id, email: lead.email, name: lead.name, visits: tally(lead.visits), seconds: tally(lead.seconds),
          lastAt: dateValue(lead.last_at).toISOString(), blocks,
          clicks: blocks.reduce((sum, block) => sum + block.clicks, 0),
          submissions: blocks.reduce((sum, block) => sum + block.submissions, 0),
          conversions: blocks.reduce((sum, block) => sum + block.conversions, 0),
        };
      }),
    };
  }

  async reportLeadMetrics(scope, where, ids) {
    const leadScope = `${scope} AND visit.subscriber_id IN (${ids.map(() => '?').join(',')})`;
    const [metrics, submissions] = await Promise.all([
      this.platformStore.rows(`SELECT visit.subscriber_id,metric.block_id,MAX(metric.block_type) AS block_type,MAX(metric.block_title) AS block_title,
        SUM(metric.seen - metric.baseline_seen OR metric.visible_seconds > metric.baseline_seconds OR metric.clicks > metric.baseline_clicks) AS views,
        SUM(metric.visible_seconds - metric.baseline_seconds) AS seconds,SUM(metric.clicks - metric.baseline_clicks) AS clicks
        FROM platform_crm_page_block_metrics metric JOIN platform_crm_page_visits visit ON visit.visit_key = metric.visit_key
        WHERE ${leadScope} GROUP BY visit.subscriber_id,metric.block_id`, [...where, ...ids]),
      this.platformStore.rows(`SELECT visit.subscriber_id,submission.block_id,COUNT(*) AS submissions,COUNT(lead.confirmed_at) AS conversions
        FROM platform_crm_page_submissions submission JOIN platform_crm_page_visits visit ON visit.visit_key = submission.visit_key
        JOIN platform_crm_leads lead ON lead.id = submission.lead_id
        WHERE ${leadScope} AND submission.attributed = 1 GROUP BY visit.subscriber_id,submission.block_id`, [...where, ...ids]),
    ]);
    const byLead = new Map();
    const captureKey = row => `${row.subscriber_id}:${row.block_id}`;
    const byBlock = new Map(metrics.map(row => [captureKey(row), { row }]));
    for (const submission of submissions) {
      const capture = captureKey(submission);
      const entry = byBlock.get(capture) ?? { row: submission };
      entry.submission = submission;
      byBlock.set(capture, entry);
    }
    for (const { row, submission } of byBlock.values()) {
      const block = presentBlock(row, submission);
      if (!(block.views || block.seconds || block.clicks || block.submissions)) continue;
      const items = byLead.get(row.subscriber_id) ?? [];
      items.push(block);
      byLead.set(row.subscriber_id, items);
    }
    return byLead;
  }
}
