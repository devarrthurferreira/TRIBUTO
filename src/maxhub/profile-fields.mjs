import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';

const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const PLATFORM = /^[a-z\d][a-z\d-]{0,39}$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;

function invalid(message) {
  throw new ApiError(400, 'MAXHUB_PROFILE_INPUT', message);
}

function text(value, label, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    invalid(required ? `Informe ${label} com até ${max} caracteres.` : `${label} deve ter até ${max} caracteres.`);
  }
  return value.trim();
}

function url(value, required = false) {
  const address = text(value, 'a URL', 2048, required);
  if (!address) return '';
  try {
    if (/[\u0000-\u001f\u007f]/.test(address)) throw new Error();
    const parsed = new URL(address);
    if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password && parsed.href.length <= 2048) {
      return parsed.href;
    }
  } catch {
    // The protocol and length checks use the same field error as malformed addresses.
  }
  return invalid('Informe uma URL válida que comece com https:// ou http://.');
}

function items(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) invalid(`Informe até ${maximum} itens em ${label}.`);
  return value;
}

function entries(value, label, normalize) {
  const ids = new Set();
  return items(value, 30, label).map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalid(`Revise os dados de ${label}.`);
    const id = item.id == null ? randomUUID() : typeof item.id === 'string' && item.id.toLowerCase();
    if (!id || !UUID.test(id) || ids.has(id)) invalid(`Revise os identificadores de ${label}.`);
    ids.add(id);
    return { id, ...normalize(item) };
  });
}

function personalLink(item) {
  const platform = text(item.platform, 'a rede social', 40, true).toLowerCase();
  if (!PLATFORM.test(platform)) invalid('Informe uma rede social válida.');
  return { platform, url: url(item.url, true), label: text(item.label, 'Nome do link', 100) };
}

function education(item) {
  const startMonth = text(item.startMonth, 'Mês de início', 7);
  const endMonth = text(item.endMonth, 'Mês de conclusão', 7);
  const ongoing = item.ongoing ?? false;
  if (typeof ongoing !== 'boolean' || (ongoing && endMonth) ||
      [startMonth, endMonth].some(month => month && (!MONTH.test(month) || month.startsWith('0000'))) ||
      (startMonth && endMonth && startMonth > endMonth)) {
    invalid('Confira o período da formação.');
  }
  return {
    type: text(item.type, 'o tipo de formação', 60, true),
    title: text(item.title, 'o nome da formação', 120, true),
    institution: text(item.institution, 'Nome da instituição', 120),
    startMonth, endMonth, ongoing,
    credentialUrl: url(item.credentialUrl),
    description: text(item.description, 'Descrição da formação', 800),
  };
}

export function profileDetails(input) {
  const details = {};
  if (input.skills !== undefined) {
    details.skills = [...new Set(items(input.skills, 24, 'habilidades').map(skill => text(skill, 'a habilidade', 60, true)))];
  }
  if (input.personalLinks !== undefined) details.personalLinks = entries(input.personalLinks, 'links pessoais', personalLink);
  if (input.education !== undefined) details.education = entries(input.education, 'educação', education);
  return details;
}
