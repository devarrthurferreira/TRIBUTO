import { ApiError } from '../api/validation.mjs';
import { validCnpj, validCpf } from '../platform/brazilian-documents.mjs';
import { CLIENT_MODULES } from '../../web/client-modules.js';

export const CLIENT_STATES = Object.freeze('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
export const CLIENT_TAX_REGIMES = Object.freeze(['simples-nacional', 'mei', 'lucro-presumido', 'lucro-real', 'lucro-arbitrado', 'imune-isenta', 'outro']);
const clientModules = new Set(CLIENT_MODULES.map(module => module.id));
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const states = new Set(CLIENT_STATES);
const taxRegimes = new Set(CLIENT_TAX_REGIMES);
const registrationPattern = /^[\p{L}\p{N}][\p{L}\p{N}. /-]*$/u;
const forbiddenText = /[\u0000-\u001f\u007f]/;

function check(condition, message) {
  if (!condition) throw new ApiError(400, 'CLIENT_INPUT', message);
}

function object(value, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), label);
  return value;
}

function text(value, label, limit, required = false) {
  if (value == null && !required) return null;
  const next = typeof value === 'string' ? value.trim() : null;
  check(next !== null && next.length <= limit && !forbiddenText.test(next), 'Revise o campo ' + label + '.');
  check(!required || next.length, 'Preencha o campo ' + label + '.');
  return next || null;
}

function clientType(value) {
  check(value === 'pj' || value === 'pf', 'Selecione Pessoa Jurídica ou Pessoa Física.');
  return value;
}

function documentNumber(value, type) {
  const raw = text(value, 'CPF ou CNPJ', 24, true);
  const document = raw.toUpperCase().replace(/[.\/\s-]/g, '');
  const isCompany = type === 'pj' || (type == null && document.length === 14);
  check(isCompany ? validCnpj(document) : validCpf(document), isCompany ? 'Informe um CNPJ válido.' : 'Informe um CPF válido.');
  return document;
}

function uf(value, required) {
  const state = text(value, 'Estado', 2, required)?.toUpperCase() ?? null;
  check(state === null || states.has(state), 'Selecione um estado brasileiro.');
  return state;
}

function cnaeNumber(value) {
  const code = text(value, 'CNAE Principal', 12)?.replace(/[./\s-]/g, '') ?? null;
  check(code === null || /^\d{7}$/.test(code), 'Informe o CNAE principal no formato 00.00-0/00.');
  return code;
}

function taxRegime(value) {
  const regime = text(value, 'Regime tributário', 32);
  check(regime === null || taxRegimes.has(regime), 'Selecione um regime tributário válido.');
  return regime;
}

function list(value, { min = 0, max, message }) {
  check(Array.isArray(value) && value.length >= min && value.length <= max, message);
  return value;
}

function registrations(value, regionalField, label, normalizeRegion) {
  const entries = list(value, { max: 100, message: 'Informe até 100 inscrições por categoria.' });
  const unique = new Set();
  return entries.map(entry => {
    const input = object(entry, 'Revise os dados de ' + label + '.');
    const number = text(input.number, label, 40, true);
    check(registrationPattern.test(number), 'Revise o número de ' + label + '.');
    const region = normalizeRegion(input[regionalField]);
    const key = number.toUpperCase().replace(/[.\s/-]/g, '') + ':' + (region?.toLocaleUpperCase('pt-BR') ?? '');
    check(!unique.has(key), 'Remova os registros de ' + label + ' duplicados.');
    unique.add(key);
    return { number, [regionalField]: region };
  });
}

function contactPhone(value) {
  const raw = text(value, 'Telefone', 30);
  if (!raw) return null;
  const number = raw.replace(/[().\s-]/g, '');
  check(/^\+?\d{8,15}$/.test(number), 'Informe um telefone válido para cada contato.');
  return number;
}

function contacts(value) {
  return list(value, { min: 1, max: 3, message: 'Cadastre de 1 a 3 contatos do cliente.' }).map(entry => {
    const input = object(entry, 'Revise os dados de contato.');
    const name = text(input.name, 'Nome do contato', 120, true);
    const email = text(input.email, 'E-mail do contato', 254)?.toLowerCase() ?? null;
    const phone = contactPhone(input.phone);
    check(email === null || emailPattern.test(email), 'Informe um e-mail válido para cada contato.');
    check(email || phone, 'Cada contato deve ter um telefone ou um e-mail.');
    return { name, email, phone, role: text(input.role, 'Cargo ou área do contato', 80) };
  });
}

function modules(value) {
  const ids = list(value, { max: clientModules.size, message: 'Revise os módulos de acesso do cliente.' });
  check(ids.every(id => clientModules.has(id)) && new Set(ids).size === ids.length, 'Revise os módulos de acesso do cliente.');
  return ids;
}

export function grantedClientModules(client) {
  const granted = Array.isArray(client.modules) ? client.modules : [];
  return CLIENT_MODULES.filter(module => granted.includes(module.id));
}

function schedule(value, name) {
  if (value == null) return { period: 'disabled', time: null };
  const { period, time } = object(value, 'Revise o horário de ' + name + '.');
  check(['disabled', 'day', 'night'].includes(period), 'Selecione o período de ' + name + '.');
  if (period === 'disabled') return { period, time: null };
  const clock = time == null || time === '' ? (period === 'day' ? '08:00' : '22:00') : time;
  check(typeof clock === 'string' && clockPattern.test(clock), 'Informe um horário válido de ' + name + '.');
  const daytime = clock >= '06:00' && clock < '18:00';
  check(daytime === (period === 'day'), 'O horário de ' + name + ' deve corresponder ao período selecionado.');
  return { period, time: clock };
}

export function clientFields(input, { partial = false } = {}) {
  object(input, 'Revise os dados do cliente.');
  const data = {};
  const supplied = key => !partial || Object.hasOwn(input, key);
  if (supplied('type')) data.type = clientType(input.type);
  if (supplied('document')) data.document = documentNumber(input.document, data.type);
  if (supplied('nickname')) data.nickname = text(input.nickname, 'Apelido', 120, true);
  if (supplied('tradeName')) data.tradeName = data.type === 'pf' ? null : text(input.tradeName, 'Nome fantasia', 160);
  if (supplied('legalName')) data.legalName = text(input.legalName, data.type === 'pf' ? 'Nome completo' : 'Razão social', 160, data.type === 'pf');
  if (supplied('state')) data.state = uf(input.state, true);
  if (supplied('taxRegime')) data.taxRegime = taxRegime(input.taxRegime);
  if (supplied('cnae')) data.cnae = cnaeNumber(input.cnae);
  if (supplied('stateRegistrations')) data.stateRegistrations = registrations(input.stateRegistrations ?? [], 'state', 'inscrição estadual', value => uf(value));
  if (supplied('municipalRegistrations')) data.municipalRegistrations = registrations(input.municipalRegistrations ?? [], 'municipality', 'inscrição municipal', value => text(value, 'Município', 100));
  if (supplied('contacts')) data.contacts = contacts(input.contacts);
  if (supplied('modules')) data.modules = modules(input.modules ?? []);
  if (supplied('invoiceSchedule')) data.invoiceSchedule = schedule(input.invoiceSchedule, 'consultas de NF');
  if (supplied('serviceInvoiceSchedule')) data.serviceInvoiceSchedule = schedule(input.serviceInvoiceSchedule, 'notas de serviço');
  if (supplied('active')) {
    check(input.active === undefined || typeof input.active === 'boolean', 'Revise a situação do cliente.');
    data.active = input.active ?? true;
  }
  return data;
}
