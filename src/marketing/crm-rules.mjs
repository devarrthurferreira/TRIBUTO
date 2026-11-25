import { ApiError } from '../api/validation.mjs';

const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const STATUSES = new Set(['pending', 'subscribed', 'unsubscribed']);

function invalid(message) {
  throw new ApiError(400, 'CRM_INVALID_INPUT', message);
}

function text(value, label, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') invalid(`Informe ${label}.`);
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > max) invalid(`Confira ${label} (até ${max} caracteres).`);
  return normalized;
}

function email(value) {
  const result = text(value, 'o e-mail', 254, true).toLowerCase();
  const address = result.split('@')[0];
  if (!EMAIL.test(result) || address.length > 64 || address.startsWith('.') || address.endsWith('.') || address.includes('..')) {
    invalid('Informe um endereço de e-mail válido.');
  }
  return result;
}

function requireChange(values, current) {
  if (current && !Object.keys(values).length) invalid('Informe os dados que deseja alterar.');
}

function dateValue(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) invalid('Confira a data de envio.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)
    || date < new Date('2000-01-01T00:00:00Z') || date > new Date()) {
    invalid('Confira a data de envio.');
  }
  return date;
}

export function subscriberFields(input, current) {
  const values = {};
  if (Object.hasOwn(input, 'name')) values.name = text(input.name, 'o nome', 120);
  if (!current || Object.hasOwn(input, 'email')) values.email = email(input.email);
  if (Object.hasOwn(input, 'source')) values.source = text(input.source, 'a origem da inscrição', 200);
  if (Object.hasOwn(input, 'status')) {
    if (!STATUSES.has(input.status)) invalid('Selecione a situação do contato.');
    values.status = input.status;
  }
  requireChange(values, current);
  if (current && values.email && current.email !== values.email) {
    invalid('O e-mail de um contato é fixo. Cadastre um novo contato para outro endereço.');
  }
  const result = { name: '', source: '', status: 'pending', ...current, ...values };
  const changedToSubscribed = result.status === 'subscribed' && current?.status !== 'subscribed';
  if (current?.status === 'unsubscribed' && result.status === 'pending') {
    invalid('Mantenha o descadastro até registrar uma nova autorização.');
  }
  if (result.status === 'subscribed' && (!result.source || (changedToSubscribed && !values.source))) {
    invalid('Informe a origem do consentimento para confirmar a inscrição.');
  }
  return result;
}

export function campaignFields(input, current) {
  const values = {};
  for (const [field, label, max, required] of [
    ['name', 'o nome da campanha', 160, true],
    ['subject', 'o assunto', 160, false],
    ['content', 'o conteúdo', 24000, false]
  ]) {
    if (!current || Object.hasOwn(input, field)) values[field] = text(input[field], label, max, required);
  }
  requireChange(values, current);
  if (values.subject && /[\u0000-\u001f\u007f]/.test(values.subject)) invalid('Use uma única linha no assunto.');
  return { ...current, ...values };
}

export function campaignReport(input, current) {
  function count(key, label, minimum, maximum, required = false) {
    const value = input[key];
    if (value == null && !required) return null;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      invalid(`Confira ${label} (até ${maximum}).`);
    }
    return value;
  }
  const sentCount = count('sentCount', 'o total enviado', 1, current.audienceCount, true);
  const deliveredCount = count('deliveredCount', 'o total entregue', 0, sentCount);
  const openCount = count('openCount', 'as aberturas únicas', 0, deliveredCount ?? sentCount);
  const clickCount = count('clickCount', 'os cliques únicos', 0, deliveredCount ?? sentCount);
  const sentAt = Object.hasOwn(input, 'sentAt') ? dateValue(input.sentAt) : dateValue(current.sentAt);
  return { sentCount, deliveredCount, openCount, clickCount, sentAt };
}
