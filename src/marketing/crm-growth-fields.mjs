import { ApiError } from '../api/validation.mjs';

export const CRM_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const CRM_TOKEN = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TYPES = new Set(['promotion', 'newsletter', 'welcome', 'announcement']);
const PAGE_KINDS = new Set(['landing', 'unsubscribe']);

export function invalidGrowth(message) {
  throw new ApiError(400, 'CRM_INVALID_INPUT', message);
}
export function growthText(value, label, max, required = false) {
  if (value == null && !required) return '';
  const normalized = typeof value === 'string' ? value.trim() : null;
  if (normalized === null || normalized.length > max || (required && !normalized)) {
    invalidGrowth(`Confira ${label} (até ${max} caracteres).`);
  }
  return normalized;
}
export function tagList(value, required = false) {
  if (!Array.isArray(value) || value.length > 20) invalidGrowth('Informe até 20 interesses.');
  const tags = [...new Set(value.map(item => growthText(item, 'o interesse', 45, true).normalize('NFC').toLocaleLowerCase('pt-BR')))];
  if (required && !tags.length) invalidGrowth('Selecione pelo menos um interesse.');
  return tags;
}
function reference(value, name, required = false) {
  if (!required && (value === null || value === '')) return null;
  if (typeof value !== 'string' || !CRM_ID.test(value)) invalidGrowth(`Selecione ${name}.`);
  return value;
}
function choice(value, options, name) {
  if (!options.has(value)) invalidGrowth(`Selecione ${name}.`);
  return value;
}
export function campaignGrowth(input, current = {}) {
  return {
    type: Object.hasOwn(input, 'type') ? choice(input.type, TYPES, 'o tipo de campanha') : current.type ?? 'promotion',
    segmentId: Object.hasOwn(input, 'segmentId') ? reference(input.segmentId, 'um segmento') : current.segmentId ?? null,
    landingId: Object.hasOwn(input, 'landingId') ? reference(input.landingId, 'uma página') : current.landingId ?? null,
    unsubscribePageId: Object.hasOwn(input, 'unsubscribePageId') ? reference(input.unsubscribePageId, 'uma página de descadastro') : current.unsubscribePageId ?? null,
  };
}
export function segmentFields(input, current = {}) {
  return {
    name: growthText(input.name ?? current.name, 'o nome do segmento', 120, true),
    tags: tagList(input.tags ?? current.tags, true),
  };
}
export function landingFields(input, current = {}) {
  const slug = growthText(input.slug ?? current.slug, 'o endereço da página', 80, true).toLowerCase();
  if (slug.length < 3 || !SLUG.test(slug)) invalidGrowth('Use letras, números e hífens no endereço da página.');
  const kind = pageKind(input.kind ?? current.kind);
  return {
    title: growthText(input.title ?? current.title, 'o título da página', 160, true), slug,
    description: growthText(input.description ?? current.description, 'a descrição da página', 4000),
    buttonText: growthText(input.buttonText ?? current.buttonText ?? (kind === 'unsubscribe' ? 'Confirmar descadastro' : 'Quero receber novidades'), 'o texto do botão', 80, true),
    tags: tagList(input.tags ?? current.tags ?? []),
    status: choice(input.status ?? current.status ?? 'draft', new Set(['draft', 'published']), 'a situação da página'),
    kind,
  };
}
export function pageKind(value) {
  return choice(value ?? 'landing', PAGE_KINDS, 'o tipo de página');
}
export function automationFields(input, current = {}) {
  const steps = input.steps ?? current.steps;
  if (!Array.isArray(steps) || !steps.length || steps.length > 8) invalidGrowth('Inclua de 1 a 8 e-mails na automação.');
  return {
    name: growthText(input.name ?? current.name, 'o nome da automação', 120, true),
    landingId: reference(input.landingId ?? current.landingId, 'uma página de captura', true),
    status: choice(input.status ?? current.status ?? 'draft', new Set(['draft', 'active', 'paused']), 'a situação da automação'),
    steps: steps.map(step => {
      const { delayDays } = step ?? {};
      if (!Number.isSafeInteger(delayDays) || delayDays < 0 || delayDays > 90) invalidGrowth('Informe um intervalo de 0 a 90 dias entre e-mails.');
      const subject = growthText(step.subject, 'o assunto do e-mail', 160, true);
      if (/[\u0000-\u001f\u007f]/.test(subject)) invalidGrowth('Use uma única linha no assunto.');
      return { delayDays, subject, content: growthText(step.content, 'o conteúdo do e-mail', 24000, true) };
    }),
  };
}
