import { ApiError } from '../api/validation.mjs';
import { canPerform } from '../platform/policy.mjs';

const BASE = '/marketing/metrics';
const ITEM_ROUTE = /^\/marketing\/metrics\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(\/readings)?$/;
const TASK_ID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const PAGE_SIZE = 100;
const MAX_REACH = 999_999_999;
const CHANNELS = new Set([
  '', 'linkedin', 'somos-maximum-instagram', 'somos-maximum-tiktok', 'maximum-contabil-instagram',
  'maximum-contabil-tiktok', 'youtube', 'maximum-informa', 'newsletter', 'somos-maximum', 'maximum-contabil',
]);
const LOCAL_DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

function invalid(field) {
  throw new ApiError(400, 'INVALID_INPUT', `Campo inválido: ${field}`);
}

function reach(value, field, { optional = false } = {}) {
  if (optional && value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > MAX_REACH) invalid(field);
  return value;
}

export function socialMetricsFields(input) {
  const fields = {};
  if (input.socialChannel !== undefined) {
    if (!CHANNELS.has(input.socialChannel)) invalid('rede social');
    fields.socialChannel = input.socialChannel;
  }
  if (input.desiredReach !== undefined) fields.desiredReach = reach(input.desiredReach, 'alcance desejado', { optional: true });
  if (input.estimatedReach !== undefined) fields.estimatedReach = reach(input.estimatedReach, 'alcance estimado', { optional: true });
  return fields;
}

function requireAction(user, action) {
  if (!canPerform(user, 'marketing', action)) throw new ApiError(403, 'FORBIDDEN', 'Sem permissão para acessar ou alterar as métricas de Marketing');
}

function readingDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || value < '2000-01-01' || value > LOCAL_DATE.format(new Date())) invalid('data da medição');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid('data da medição');
  return value;
}

function missingMetric() {
  throw new ApiError(404, 'NOT_FOUND', 'Acompanhamento não encontrado');
}

export async function handleMarketingMetrics({ req, res, route, user, send, readBody, store, parseMetadata, pageNumber }) {
  const method = req.method;
  const match = ITEM_ROUTE.exec(route);
  requireAction(user, 'workItemRead');

  if (route === BASE && method === 'GET') {
    const page = pageNumber(new URL(req.url, 'http://localhost').searchParams, 'page', 1, 10_000);
    const { items, hasMore } = await store.listMarketingMetrics(user, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    return send(res, 200, { items, page, hasMore });
  }
  if (route === BASE && method === 'POST') {
    requireAction(user, 'workItemCreate');
    const input = await readBody(req);
    const taskId = input.taskId ?? null;
    if (taskId !== null && (typeof taskId !== 'string' || !TASK_ID.test(taskId))) invalid('tarefa');
    const { item, created } = await store.createMarketingMetric(user, { taskId: taskId?.toLowerCase() ?? null,
      metadata: taskId ? null : parseMetadata(input) });
    return send(res, created ? 201 : 200, { item });
  }
  if (match && !match[2] && method === 'GET') {
    const item = await store.getMarketingMetric(user, match[1]);
    if (!item) missingMetric();
    return send(res, 200, { item });
  }
  if (match && !match[2] && method === 'PATCH') {
    requireAction(user, 'workItemUpdate');
    const input = await readBody(req);
    const fields = parseMetadata(input, { partial: true });
    if (!Object.keys(fields).length) invalid('alterações');
    if (input.expectedUpdatedAt !== undefined && (typeof input.expectedUpdatedAt !== 'string'
      || !Number.isFinite(Date.parse(input.expectedUpdatedAt)))) invalid('versão do acompanhamento');
    const item = await store.updateMarketingMetric(user, match[1], fields, input.expectedUpdatedAt);
    if (!item) missingMetric();
    return send(res, 200, { item });
  }
  if (match && match[2] && method === 'PUT') {
    requireAction(user, 'workItemUpdate');
    const input = await readBody(req);
    const reading = { date: readingDate(input.date), actualReach: reach(input.actualReach, 'alcance real') };
    const item = await store.saveMarketingMetricReading(user, match[1], reading);
    if (!item) missingMetric();
    return send(res, 200, { item });
  }
  throw new ApiError(404, 'NOT_FOUND', 'Rota inexistente');
}
