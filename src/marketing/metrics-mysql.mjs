import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { canAccessWorkItemCompany } from '../platform/policy.mjs';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS platform_marketing_metrics (
    id CHAR(36) NOT NULL PRIMARY KEY, task_id CHAR(36) NULL,
    metadata_json LONGTEXT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uniq_marketing_metric_task (task_id), KEY idx_marketing_metric_updated (updated_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_marketing_metric_readings (
    metric_id CHAR(36) NOT NULL, measured_on CHAR(10) NOT NULL, actual_reach INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (metric_id, measured_on)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];
const METRIC_SELECT = `SELECT metric.*,
    task.company_cnpj, task.title AS task_title, task.description AS task_description,
    task.status AS task_status, task.due_at AS task_due_at, details.details_json AS task_details_json
  FROM platform_marketing_metrics metric
  LEFT JOIN platform_work_items task ON task.id = metric.task_id
  LEFT JOIN platform_marketing_task_details details ON details.work_item_id = task.id`;
const READINGS_PER_ITEM = 366;

function dateTime(value) {
  return new Date(value instanceof Date ? value : `${String(value).replace(' ', 'T')}Z`).toISOString();
}

function data(value) {
  try {
    const result = typeof value === 'string' ? JSON.parse(value) : value;
    return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  } catch { return {}; }
}

function metricRecord(row) {
  const details = data(row.task_id ? row.task_details_json : row.metadata_json);
  return {
    id: row.id,
    taskId: row.task_id ?? null,
    companyCnpj: row.company_cnpj || null,
    title: row.task_id ? row.task_title : details.title,
    description: (row.task_id ? row.task_description : details.description) || '',
    status: (row.task_id ? row.task_status : details.status) || 'open',
    dueAt: (row.task_id ? row.task_due_at : details.dueAt) || null,
    priority: details.priority || 'normal',
    socialChannel: details.socialChannel || '',
    desiredReach: details.desiredReach ?? null,
    estimatedReach: details.estimatedReach ?? null,
    referenceUrl: details.referenceUrl || '',
    checklist: details.checklist || [],
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at),
    readings: [],
  };
}

function visibleScope(user) {
  const portfolio = user.role === 'admin' ? null : user.companyCnpjs || [];
  if (portfolio === null) return { predicate: `(metric.task_id IS NULL OR task.module = 'marketing')`, params: [] };
  const allowed = portfolio.length ? ` OR task.company_cnpj IN (${portfolio.map(() => '?').join(',')})` : '';
  return {
    predicate: `(metric.task_id IS NULL OR (task.module = 'marketing' AND (task.company_cnpj = ''${allowed})))`,
    params: portfolio,
  };
}

function readingRecord(row) {
  return { date: row.measured_on, actualReach: Number(row.actual_reach),
    createdAt: dateTime(row.created_at), updatedAt: dateTime(row.updated_at) };
}

async function attachReadings(executor, items) {
  if (!items.length) return items;
  const byId = new Map(items.map(item => [item.id, item]));
  const [readings] = await executor.execute(`SELECT metric_id, measured_on, actual_reach, created_at, updated_at FROM (
      SELECT r.*, ROW_NUMBER() OVER (PARTITION BY metric_id ORDER BY measured_on DESC) AS reading_rank
      FROM platform_marketing_metric_readings r WHERE metric_id IN (${items.map(() => '?').join(',')})
    ) ranked WHERE reading_rank <= ? ORDER BY metric_id, measured_on`, [...byId.keys(), READINGS_PER_ITEM]);
  for (const row of readings) byId.get(row.metric_id).readings.push(readingRecord(row));
  return items;
}

async function lockTask(connection, user, id) {
  const [[task]] = await connection.execute(`SELECT company_cnpj FROM platform_work_items WHERE id = ? AND module = 'marketing' FOR UPDATE`, [id]);
  return Boolean(task && canAccessWorkItemCompany(user, 'marketing', task.company_cnpj || null));
}

function nextUpdatedAt(previous) {
  return new Date(Math.max(Date.now(), Date.parse(dateTime(previous)) + 1));
}

export class MarketingMetricsMySqlStore {
  constructor(platformStore) { this.platformStore = platformStore; }

  async initialize() {
    for (const statement of TABLES) await this.platformStore.pool.query(statement);
  }

  async listMarketingMetrics(user, { limit, offset }) {
    const { predicate, params } = visibleScope(user);
    return this.platformStore.transaction(async connection => {
      const [rows] = await connection.execute(`${METRIC_SELECT} WHERE ${predicate}
        ORDER BY metric.updated_at DESC, metric.id DESC LIMIT ? OFFSET ?`, [...params, limit + 1, offset]);
      return { items: await attachReadings(connection, rows.slice(0, limit).map(metricRecord)), hasMore: rows.length > limit };
    });
  }

  async getMarketingMetric(user, id) {
    const { predicate, params } = visibleScope(user);
    return this.platformStore.transaction(async connection => {
      const [[row]] = await connection.execute(`${METRIC_SELECT} WHERE metric.id = ? AND ${predicate}`, [id, ...params]);
      if (!row) return null;
      const [item] = await attachReadings(connection, [metricRecord(row)]);
      return item;
    });
  }

  async readLockedMetric(connection, id) {
    const [[row]] = await connection.execute(`${METRIC_SELECT} WHERE metric.id = ?`, [id]);
    const [readings] = await connection.execute(`SELECT measured_on, actual_reach, created_at, updated_at
      FROM platform_marketing_metric_readings WHERE metric_id = ? ORDER BY measured_on DESC LIMIT ?`, [id, READINGS_PER_ITEM]);
    return { ...metricRecord(row), readings: readings.reverse().map(readingRecord) };
  }

  async editLockedMetric(user, id, update) {
    // The link is immutable. Look it up before opening the transaction so waiting for a lock cannot use a stale snapshot.
    const target = await this.platformStore.one('SELECT task_id FROM platform_marketing_metrics WHERE id = ?', [id]);
    if (!target) return null;
    return this.platformStore.transaction(async connection => {
      // Linked creation and editing always acquire the task lock before the metric lock.
      if (target.task_id && !await lockTask(connection, user, target.task_id)) return null;
      const [[locked]] = await connection.execute('SELECT * FROM platform_marketing_metrics WHERE id = ? FOR UPDATE', [id]);
      if (!locked) return null;
      return update(connection, locked);
    });
  }

  async createMarketingMetric(user, { taskId, metadata }) {
    return this.platformStore.transaction(async connection => {
      if (taskId) {
        if (!await lockTask(connection, user, taskId)) throw new ApiError(404, 'NOT_FOUND', 'Tarefa de Marketing não encontrada');
        // Retrying a linked creation returns the existing record and its readings.
        const [[existing]] = await connection.execute('SELECT id FROM platform_marketing_metrics WHERE task_id = ?', [taskId]);
        if (existing) return { item: await this.readLockedMetric(connection, existing.id), created: false };
      }
      const id = randomUUID();
      const now = new Date();
      await connection.execute(`INSERT INTO platform_marketing_metrics (id, task_id, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`, [id, taskId, metadata && JSON.stringify(metadata), now, now]);
      await this.platformStore.insertAudit(connection, 'marketing_metric.create', user._id, id, { taskId });
      return { item: await this.readLockedMetric(connection, id), created: true };
    });
  }

  async updateMarketingMetric(user, id, fields, expectedUpdatedAt) {
    return this.editLockedMetric(user, id, async (connection, current) => {
      if (current.task_id) throw new ApiError(409, 'METRIC_LINKED_TASK', 'Edite os dados na tarefa vinculada. O acompanhamento é atualizado automaticamente.');
      if (expectedUpdatedAt !== undefined && Date.parse(expectedUpdatedAt) !== Date.parse(dateTime(current.updated_at))) {
        throw new ApiError(409, 'METRIC_UPDATED', 'O acompanhamento foi alterado. Reabra os detalhes para ver a versão atual.');
      }
      await connection.execute('UPDATE platform_marketing_metrics SET metadata_json = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify({ ...data(current.metadata_json), ...fields }), nextUpdatedAt(current.updated_at), id]);
      await this.platformStore.insertAudit(connection, 'marketing_metric.update', user._id, id, { fields: Object.keys(fields) });
      return this.readLockedMetric(connection, id);
    });
  }

  async saveMarketingMetricReading(user, id, { date, actualReach }) {
    return this.editLockedMetric(user, id, async (connection, current) => {
      const [[previous]] = await connection.execute(`SELECT actual_reach FROM platform_marketing_metric_readings
        WHERE metric_id = ? AND measured_on = ?`, [id, date]);
      if (previous && Number(previous.actual_reach) === actualReach) return this.readLockedMetric(connection, id);
      const now = nextUpdatedAt(current.updated_at);
      await connection.execute(`INSERT INTO platform_marketing_metric_readings (metric_id, measured_on, actual_reach, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE actual_reach = ?, updated_at = ?`, [id, date, actualReach, now, now, actualReach, now]);
      await connection.execute('UPDATE platform_marketing_metrics SET updated_at = ? WHERE id = ?', [now, id]);
      await this.platformStore.insertAudit(connection, 'marketing_metric.reading', user._id, id, { date, actualReach });
      return this.readLockedMetric(connection, id);
    });
  }
}
