import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { campaignFields, campaignReport, subscriberFields } from './crm-rules.mjs';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS platform_marketing_subscribers (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(120) NOT NULL,
    status VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source VARCHAR(200) NOT NULL,
    consent_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY ux_marketing_subscriber_email (email),
    KEY idx_marketing_subscriber_status (status, consent_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_marketing_campaigns (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    subject VARCHAR(160) NOT NULL,
    content MEDIUMTEXT NOT NULL,
    status VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    audience_count INT UNSIGNED NOT NULL DEFAULT 0,
    sent_count INT UNSIGNED NULL,
    delivered_count INT UNSIGNED NULL,
    open_count INT UNSIGNED NULL,
    click_count INT UNSIGNED NULL,
    sent_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_marketing_campaign_updated (updated_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_marketing_campaign_audience (
    campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subscriber_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    consent_at DATETIME(3) NOT NULL,
    PRIMARY KEY (campaign_id, subscriber_id),
    CONSTRAINT fk_marketing_audience_campaign FOREIGN KEY (campaign_id) REFERENCES platform_marketing_campaigns (id),
    CONSTRAINT fk_marketing_audience_subscriber FOREIGN KEY (subscriber_id) REFERENCES platform_marketing_subscribers (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + 'Z');
  return date.toISOString();
}

function asSubscriber(row) {
  return {
    id: row.id, name: row.name, email: row.email, status: row.status, source: row.source, consentAt: iso(row.consent_at),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}

function asCampaign(row) {
  return {
    id: row.id, name: row.name, subject: row.subject, content: row.content, status: row.status,
    audienceCount: row.audience_count, sentCount: row.sent_count, deliveredCount: row.delivered_count,
    openCount: row.open_count, clickCount: row.click_count, sentAt: iso(row.sent_at),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}

function updatedAfter(record) {
  return new Date(Math.max(Date.now(), Date.parse(record.updatedAt) + 1));
}

function aggregate(subscribers, campaigns) {
  const totals = {
    subscribers: subscribers.length, subscribed: 0, pending: 0, unsubscribed: 0,
    campaigns: campaigns.length, drafts: 0, prepared: 0, sentCampaigns: 0,
    sent: null, delivered: null, opened: null, clicked: null
  };
  for (const { status } of subscribers) totals[status] += 1;
  for (const campaign of campaigns) {
    if (campaign.status === 'draft') totals.drafts += 1;
    if (campaign.status === 'prepared') totals.prepared += 1;
    if (campaign.status !== 'sent') continue;
    totals.sentCampaigns += 1;
    for (const [metric, field] of [
      ['sent', 'sentCount'], ['delivered', 'deliveredCount'], ['opened', 'openCount'], ['clicked', 'clickCount']
    ]) {
      if (campaign[field] !== null) totals[metric] = (totals[metric] ?? 0) + campaign[field];
    }
  }
  return totals;
}

function conflict(message) {
  return new ApiError(409, 'CRM_STATE_CONFLICT', message);
}

async function lockCampaign(connection, id) {
  const [[row]] = await connection.execute('SELECT * FROM platform_marketing_campaigns WHERE id = ? FOR UPDATE', [id]);
  if (!row) throw new ApiError(404, 'CRM_NOT_FOUND', 'Campanha não encontrada.');
  return asCampaign(row);
}

export class MarketingCrmStore {
  constructor(platformStore) { this.platformStore = platformStore; }

  async initialize() {
    for (const query of SCHEMA) await this.platformStore.pool.query(query);
  }

  async list() {
    const [contacts, mailings] = await Promise.all([
      this.platformStore.rows('SELECT * FROM platform_marketing_subscribers ORDER BY updated_at DESC, id'),
      this.platformStore.rows('SELECT * FROM platform_marketing_campaigns ORDER BY updated_at DESC, id')
    ]);
    const subscribers = contacts.map(asSubscriber);
    const campaigns = mailings.map(asCampaign);
    return { subscribers, campaigns, totals: aggregate(subscribers, campaigns) };
  }

  async createSubscriber(input, actorId) {
    const { name, email, status, source } = subscriberFields(input);
    const now = new Date();
    const id = randomUUID();
    const consent = status === 'subscribed' ? now : null;
    try {
      await this.platformStore.transaction(async connection => {
        await connection.execute(`INSERT INTO platform_marketing_subscribers
          (id, email, name, status, source, consent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, email, name, status, source, consent, now, now]);
        await this.platformStore.insertAudit(connection, 'marketing.crm.subscriber.create', actorId, id, { status });
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') throw conflict('Já existe um contato com esse e-mail.');
      throw error;
    }
    return { id, email, name, status, source, consentAt: iso(consent), createdAt: iso(now), updatedAt: iso(now) };
  }

  async updateSubscriber(id, input, actorId) {
    return this.platformStore.transaction(async connection => {
      const [[row]] = await connection.execute('SELECT * FROM platform_marketing_subscribers WHERE id = ? FOR UPDATE', [id]);
      if (!row) throw new ApiError(404, 'CRM_NOT_FOUND', 'Contato não encontrado.');
      const current = asSubscriber(row);
      const change = subscriberFields(input, current);
      const now = updatedAfter(current);
      const consent = change.status === 'subscribed'
        ? (current.status === 'subscribed' && current.consentAt ? new Date(current.consentAt) : now) : null;
      await connection.execute(`UPDATE platform_marketing_subscribers SET
        name = ?, status = ?, source = ?, consent_at = ?, updated_at = ? WHERE id = ?`,
      [change.name, change.status, change.source, consent, now, id]);
      await this.platformStore.insertAudit(connection, 'marketing.crm.subscriber.update', actorId, id, {
        previousStatus: current.status, status: change.status
      });
      return { ...change, consentAt: iso(consent), updatedAt: iso(now) };
    });
  }

  async createCampaign(input, actorId) {
    const id = randomUUID();
    const { name, subject, content } = campaignFields(input);
    const now = new Date();
    await this.platformStore.transaction(async connection => {
      await connection.execute(`INSERT INTO platform_marketing_campaigns
        (id, name, subject, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
      [id, name, subject, content, now, now]);
      await this.platformStore.insertAudit(connection, 'marketing.crm.campaign.create', actorId, id);
    });
    return {
      id, name, subject, content, status: 'draft', audienceCount: 0, sentCount: null,
      deliveredCount: null, openCount: null, clickCount: null, sentAt: null, createdAt: iso(now), updatedAt: iso(now)
    };
  }

  async updateCampaign(id, input, actorId) {
    return this.platformStore.transaction(async connection => {
      const current = await lockCampaign(connection, id);
      if (current.status !== 'draft') throw conflict('Volte a campanha para rascunho antes de editar.');
      const change = campaignFields(input, current);
      const now = updatedAfter(current);
      await connection.execute('UPDATE platform_marketing_campaigns SET name = ?, subject = ?, content = ?, updated_at = ? WHERE id = ?',
        [change.name, change.subject, change.content, now, id]);
      await this.platformStore.insertAudit(connection, 'marketing.crm.campaign.update', actorId, id);
      return { ...change, updatedAt: iso(now) };
    });
  }

  async prepareCampaign(id, actorId) {
    return this.platformStore.transaction(async connection => {
      const current = await lockCampaign(connection, id);
      if (current.status === 'prepared') return current;
      if (current.status !== 'draft') throw conflict('A campanha já registra um envio.');
      if (!current.subject || !current.content) throw conflict('Preencha o assunto e o conteúdo para preparar a campanha.');
      const [result] = await connection.execute(`INSERT INTO platform_marketing_campaign_audience (campaign_id, subscriber_id, consent_at)
        SELECT ?, id, consent_at FROM platform_marketing_subscribers
        WHERE status = 'subscribed' AND consent_at IS NOT NULL`, [id]);
      const audienceCount = result.affectedRows;
      if (!audienceCount) throw conflict('Cadastre ao menos um assinante com consentimento antes de preparar a campanha.');
      const now = updatedAfter(current);
      await connection.execute(`UPDATE platform_marketing_campaigns
        SET status = 'prepared', audience_count = ?, updated_at = ? WHERE id = ?`, [audienceCount, now, id]);
      await this.platformStore.insertAudit(connection, 'marketing.crm.campaign.prepare', actorId, id, { audienceCount });
      return { ...current, status: 'prepared', audienceCount, updatedAt: iso(now) };
    });
  }

  async reopenCampaign(id, actorId) {
    return this.platformStore.transaction(async connection => {
      const current = await lockCampaign(connection, id);
      if (current.status === 'draft') return current;
      if (current.status !== 'prepared') throw conflict('Campanhas com envio registrado não voltam para rascunho.');
      const now = updatedAfter(current);
      await connection.execute('DELETE FROM platform_marketing_campaign_audience WHERE campaign_id = ?', [id]);
      await connection.execute(`UPDATE platform_marketing_campaigns
        SET status = 'draft', audience_count = 0, updated_at = ? WHERE id = ?`, [now, id]);
      await this.platformStore.insertAudit(connection, 'marketing.crm.campaign.reopen', actorId, id);
      return { ...current, status: 'draft', audienceCount: 0, updatedAt: iso(now) };
    });
  }

  async audience(id, actorId) {
    return this.platformStore.transaction(async connection => {
      const current = await lockCampaign(connection, id);
      if (current.status !== 'prepared') throw conflict('Prepare a campanha para exportar o público.');
      const [recipients] = await connection.execute(`SELECT s.email, s.name FROM platform_marketing_campaign_audience a
        INNER JOIN platform_marketing_subscribers s ON s.id = a.subscriber_id
        WHERE a.campaign_id = ? AND s.status = 'subscribed' AND s.consent_at = a.consent_at
        ORDER BY s.email`, [id]);
      await this.platformStore.insertAudit(connection, 'marketing.crm.campaign.export', actorId, id, { audienceCount: recipients.length });
      return { recipients };
    });
  }

  async recordCampaign(id, input, actorId) {
    return this.platformStore.transaction(async connection => {
      const current = await lockCampaign(connection, id);
      if (current.status === 'draft') throw conflict('Prepare a campanha antes de registrar os resultados.');
      const { sentCount, deliveredCount, openCount, clickCount, sentAt } = campaignReport(input, current);
      const now = updatedAfter(current);
      await connection.execute(`UPDATE platform_marketing_campaigns SET status = 'sent',
        sent_count = ?, delivered_count = ?, open_count = ?, click_count = ?, sent_at = ?, updated_at = ? WHERE id = ?`,
      [sentCount, deliveredCount, openCount, clickCount, sentAt, now, id]);
      await this.platformStore.insertAudit(connection, 'marketing.crm.campaign.report', actorId, id, { source: 'manual' });
      return { ...current, status: 'sent', sentCount, deliveredCount, openCount, clickCount, sentAt: iso(sentAt), updatedAt: iso(now) };
    });
  }
}
