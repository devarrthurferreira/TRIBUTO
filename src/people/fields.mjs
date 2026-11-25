import { ApiError } from '../api/validation.mjs';

const GOAL_STATUSES = new Set(['planned', 'in_progress', 'done']);

function invalid(label) {
  throw new ApiError(400, 'PEOPLE_INVALID_INPUT', `Confira o campo ${label}.`);
}

function text(value, label, max, required = false) {
  const result = typeof value === 'string' ? value.trim() : null;
  if (result === null || result.length > max || (required && !result)) invalid(label);
  return result;
}

function dueDate(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) invalid('prazo');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) invalid('prazo');
  return value;
}

export function goalFields(input, { partial = false } = {}) {
  const changes = {};
  if (!partial || input.title !== undefined) changes.title = text(input.title, 'título', 160, true);
  if (input.description !== undefined) changes.description = text(input.description, 'descrição', 2000);
  if (input.dueAt !== undefined) changes.dueAt = dueDate(input.dueAt);
  if (input.progress !== undefined) {
    if (!Number.isInteger(input.progress) || input.progress < 0 || input.progress > 100) invalid('progresso');
    changes.progress = input.progress;
  }
  if (input.status !== undefined) {
    if (!GOAL_STATUSES.has(input.status)) invalid('status');
    changes.status = input.status;
  }
  if (!Object.keys(changes).length) invalid('alterações');
  return changes;
}

export function goalDetails(current, changes) {
  const details = { description: '', dueAt: null, ...current, ...changes };
  let progress = details.progress ?? 0;
  if (changes.status === 'done') progress = 100;
  if (changes.status === 'planned') progress = 0;
  if (changes.status === 'in_progress' && (progress === 0 || progress === 100)) {
    if (changes.progress !== undefined) invalid('progresso em andamento');
    progress = 1;
  }
  const status = progress === 100 ? 'done' : progress > 0 ? 'in_progress' : 'planned';
  return { ...details, progress, status };
}

export function surveyFields(input) {
  return { title: text(input.title, 'título', 160, true), question: text(input.question, 'pergunta', 300, true) };
}

export function closeSurveyFields(input) {
  if (input.status !== 'closed') invalid('encerramento da pesquisa');
}

export function surveyRating(input) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) invalid('resposta de 1 a 5');
  return input.rating;
}
