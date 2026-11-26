import { ApiError } from '../api/validation.mjs';
import { normalizeDossier } from './fields.mjs';

const PROTOCOL = /^DOS-(\d{14})-[A-Z0-9]{5,10}$/;
const UTC_TIMESTAMP = /^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function invalid(message) {
  throw new ApiError(400, 'DOSSIER_IMPORT_INVALID', message);
}

function hasFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function historicalTimestamp(value, protocolTimestamp) {
  if (typeof value !== 'string' || !UTC_TIMESTAMP.test(value)) {
    invalid('Informe a data original do dossiê em UTC.');
  }
  const instant = new Date(value);
  const normalized = value.length === 20 ? value.replace('Z', '.000Z') : value;
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== normalized
    || instant.toISOString().slice(0, 19).replace(/[^0-9]/g, '') !== protocolTimestamp) {
    invalid('A data original deve corresponder à data do protocolo.');
  }
  return normalized;
}

function normalizeImport(body) {
  if (!hasFields(body, ['items']) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 25) {
    invalid('Envie de 1 a 25 dossiês por importação.');
  }
  const protocols = new Set();
  return body.items.map(item => {
    if (!hasFields(item, ['protocolo', 'createdAt', 'dossier'])) {
      invalid('Informe o protocolo, a data original e os dados de cada dossiê.');
    }
    const { protocolo, createdAt, dossier } = item;
    const protocol = typeof protocolo === 'string' && PROTOCOL.exec(protocolo);
    if (!protocol) invalid('Informe um protocolo válido.');
    if (protocols.has(protocolo)) invalid('Cada protocolo pode aparecer apenas uma vez na importação.');
    protocols.add(protocolo);
    return { protocolo, createdAt: historicalTimestamp(createdAt, protocol[1]), dossier: normalizeDossier(dossier) };
  });
}

export function requireDossierImportAdmin(user) {
  if (!user?.active || user.role !== 'admin') {
    throw new ApiError(403, 'DOSSIER_FORBIDDEN', 'A importação de dossiês é restrita a administradores.');
  }
}

export async function importDossiers({ req, res, user, send, readBody, store }) {
  requireDossierImportAdmin(user);
  const items = await store.importHistorical(user, normalizeImport(await readBody(req, 700_000)));
  return send(res, items.some(item => item.imported) ? 201 : 200, { items });
}
