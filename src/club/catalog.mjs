import { ApiError } from '../api/validation.mjs';

export const CLUB_COLLECTIONS = ['partners', 'benefits', 'events'];
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const ISO_INSTANT = /^([1-9]\d{3}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function invalid(name) {
  throw new ApiError(400, 'CLUB_INVALID_INPUT', `Confira o campo ${name}.`);
}

function text(name, limit, min = 0) {
  return value => {
    const normalized = value == null && min === 0 ? '' : typeof value === 'string' ? value.trim() : null;
    if (normalized === null || normalized.length < min || normalized.length > limit) invalid(name);
    return normalized;
  };
}

function httpsUrl(name) {
  return value => {
    const source = text(name, 1000)(value);
    if (!source) return '';
    const url = URL.canParse(source) ? new URL(source) : null;
    if (url?.protocol !== 'https:' || url.username || url.password || url.href.length > 1000) invalid(`${name} (URL HTTPS)`);
    return url.href;
  };
}

function instant(name, required = false) {
  return value => {
    if (!required && (value == null || value === '')) return null;
    const match = typeof value === 'string' && ISO_INSTANT.exec(value);
    if (!match) invalid(name);
    const day = new Date(`${match[1]}T00:00:00Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== match[1]) invalid(name);
    const date = new Date(value).toISOString();
    if (date.length !== 24 || date < '1000-01-01') invalid(name);
    return date;
  };
}

export function clubId(value, name = 'identificador') {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(name);
  return value.toLowerCase();
}

function numberForWhatsApp(value) {
  const normalized = text('WhatsApp', 32)(value).replace(/[().\s-]/g, '');
  if (!normalized) return '';
  if (/^[1-9]\d{9,10}$/.test(normalized)) return `55${normalized}`;
  if (!/^\+?[1-9]\d{7,14}$/.test(normalized)) invalid('WhatsApp');
  return normalized.replace(/^\+/, '');
}

function benefitKind(value) {
  if (!['benefit', 'advantage'].includes(value)) invalid('tipo de benefício');
  return value;
}

const COMMON_FIELDS = {
  title: text('título', 160, 1), description: text('descrição', 4000),
  active: value => {
    if (value === undefined) return true;
    if (typeof value !== 'boolean') invalid('publicação');
    return value;
  },
  imageUrl: httpsUrl('imagem'),
};
const CATEGORY = text('categoria', 80);
const MAPS = httpsUrl('mapa');
const RESOURCE_URL = httpsUrl('link');
const FIELDS = {
  benefits: {
    category: CATEGORY, partnerId: value => value == null || value === '' ? null : clubId(value, 'parceiro'),
    kind: value => value === undefined ? undefined : benefitKind(value),
    offer: text('chamada', 300), rules: text('condições', 4000), url: RESOURCE_URL,
  },
  partners: {
    category: CATEGORY, address: text('endereço', 500), mapsUrl: MAPS,
    websiteUrl: RESOURCE_URL, whatsapp: numberForWhatsApp, instagram: httpsUrl('Instagram'),
  },
  events: {
    startAt: instant('início do evento', true), endAt: instant('fim do evento'),
    location: text('local do evento', 500), mapsUrl: MAPS, url: RESOURCE_URL,
  },
};

export function clubFields(collection, input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('registro');
  const fields = { ...COMMON_FIELDS, ...FIELDS[collection] };
  const selected = Object.entries(fields).filter(([name]) => !partial || Object.hasOwn(input, name));
  if (!selected.length) invalid('alterações');
  const changes = Object.fromEntries(selected.map(([name, normalize]) => [name, normalize(input[name])]));
  return partial ? changes : applyClubFields(collection, {}, changes);
}

export function applyClubFields(collection, current, changes) {
  const result = { ...current, ...changes };
  if (collection === 'benefits') {
    if (result.partnerId && changes.kind === 'benefit') invalid('tipo de benefício vinculado a parceiro');
    result.kind = result.partnerId ? 'advantage' : result.kind ?? 'benefit';
  }
  if (collection === 'events' && result.endAt && result.endAt < result.startAt) invalid('fim do evento');
  return result;
}

export function importClubFields(input) {
  const ids = new Set();
  const catalog = Object.fromEntries(CLUB_COLLECTIONS.map(collection => {
    const records = input[collection] ?? [];
    if (!Array.isArray(records) || records.length > 250) invalid(`lista de ${collection}`);
    return [collection, records.map(record => {
      const normalized = clubFields(collection, record);
      const id = clubId(record.id);
      if (ids.has(id)) invalid('identificadores repetidos');
      ids.add(id);
      return { ...normalized, id };
    }).sort((left, right) => left.id.localeCompare(right.id))];
  }));
  if (!ids.size) invalid('catálogo vazio');
  return catalog;
}
