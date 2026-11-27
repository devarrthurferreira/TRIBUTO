import { ApiError } from '../api/validation.mjs';

const GOAL_STATUSES = new Set(['planned', 'in_progress', 'done']);
const SURVEY_KINDS = new Set(['engagement', 'satisfaction', 'quick_survey', 'super_survey']);
const PLAN_STATUSES = new Set(['draft', 'active', 'completed']);
const USER_ID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
export const FEEDBACK_RATINGS = new Set([
  'culture', 'customer', 'teamwork', 'communication',
  'commitment', 'engagement', 'leadership', 'active_listening',
]);

function invalid(label) {
  throw new ApiError(400, 'PEOPLE_INVALID_INPUT', `Confira o campo ${label}.`);
}

function text(value, label, max, required = false) {
  const result = typeof value === 'string' ? value.trim() : null;
  if (result === null || result.length > max || (required && !result)) invalid(label);
  return result;
}

function dateField(value, label = 'prazo') {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) invalid(label);
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) invalid(label);
  return value;
}

function fieldsObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('dados do registro');
}

function progress(value) {
  if (!Number.isInteger(value) || value < 0 || value > 100) invalid('progresso');
  return value;
}

function participant(value, label) {
  if (typeof value !== 'string' || !USER_ID.test(value)) invalid(label);
  return value.toLowerCase();
}

export function goalFields(input, { partial = false } = {}) {
  fieldsObject(input);
  const changes = {};
  if (!partial || input.title !== undefined) changes.title = text(input.title, 'título', 160, true);
  if (input.description !== undefined) changes.description = text(input.description, 'descrição', 2000);
  if (input.dueAt !== undefined) changes.dueAt = dateField(input.dueAt);
  if (input.progress !== undefined) changes.progress = progress(input.progress);
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
  fieldsObject(input);
  const kind = input.kind === undefined ? 'engagement' : input.kind;
  if (!SURVEY_KINDS.has(kind)) invalid('tipo de pesquisa');
  return { title: text(input.title, 'título', 160, true), question: text(input.question, 'pergunta', 300, true), kind };
}

export function closeSurveyFields(input) {
  fieldsObject(input);
  if (input.status !== 'closed') invalid('encerramento da pesquisa');
}

export function surveyRating(input) {
  fieldsObject(input);
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) invalid('resposta de 1 a 5');
  return input.rating;
}

export function goalCheckInFields(input) {
  fieldsObject(input);
  return { progress: progress(input.progress), notes: text(input.notes ?? '', 'observações', 2000) };
}

export function noteFields(input, { review = false } = {}) {
  fieldsObject(input);
  const note = {
    recipientId: participant(input.recipientId, 'destinatário'),
    text: text(input.text, review ? 'avaliação' : 'feedback', 4000, true),
  };
  if (review) return { ...note, title: text(input.title, 'título', 160, true) };

  if (input.anonymous !== undefined && typeof input.anonymous !== 'boolean') invalid('envio anônimo');
  const ratings = input.ratings === undefined ? {} : input.ratings;
  if (!ratings || typeof ratings !== 'object' || Array.isArray(ratings)) invalid('itens da empresa');
  for (const [criterion, rating] of Object.entries(ratings)) {
    if (!FEEDBACK_RATINGS.has(criterion) || !Number.isInteger(rating) || rating < 1 || rating > 5) invalid('itens da empresa');
  }
  return { ...note, description: text(input.description ?? '', 'descrição', 4000), anonymous: input.anonymous ?? false, ratings };
}

export function reviewResponseFields(input) {
  fieldsObject(input);
  return { text: text(input.text, 'resposta', 4000, true) };
}

export function planFields(input, { partial = false } = {}) {
  fieldsObject(input);
  const changes = partial ? {} : { description: '', dueAt: null, status: 'draft' };
  if (!partial || input.title !== undefined) changes.title = text(input.title, 'título', 160, true);
  if (input.description !== undefined) changes.description = text(input.description, 'descrição', 3000);
  if (input.dueAt !== undefined) changes.dueAt = dateField(input.dueAt);
  if (input.status !== undefined) {
    if (!PLAN_STATUSES.has(input.status) || (!partial && input.status === 'completed')) invalid('status do plano');
    changes.status = input.status;
  }
  if (input.leaderId !== undefined && !partial) changes.leaderId=participant(input.leaderId,'liderança');
  if (input.structure !== undefined) {
    const s=input.structure;
    fieldsObject(s);
    const start=dateField(s.start,'início');
    if (!start || !Number.isInteger(s.duration) || s.duration<1 || s.duration>1000 ||
        !['dias','semanas','meses'].includes(s.unit) || !Array.isArray(s.blocks) || s.blocks.length>30) invalid('estrutura do plano');
    changes.structure={start,type:text(s.type,'tipo',80,true),duration:s.duration,unit:s.unit,blocks:s.blocks.map(block=>{
      fieldsObject(block);
      if(!Array.isArray(block.tasks) || block.tasks.length>100) invalid('tarefas');
      return {name:text(block.name,'bloco',120,true),tasks:block.tasks.map(task=>{
        fieldsObject(task);
        if(typeof task.done !== 'boolean') invalid('conclusão da tarefa');
        return {name:text(task.name,'tarefa',160,true),done:task.done};
      })};
    })};
    if(changes.dueAt && changes.dueAt < start) invalid('prazo');
  }
  if (input.version !== undefined) changes.version=text(input.version,'versão',32,true);
  if (!Object.keys(changes).length) invalid('alterações');
  return changes;
}

export function meetingFields(input) {
  fieldsObject(input);
  const date = dateField(input.date, 'data da reunião');
  if (!date) invalid('data da reunião');
  const time = input.time === '' ? null : input.time ?? null;
  if (time !== null && (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) invalid('horário');
  return {
    participantId: participant(input.participantId, 'participante'),
    title: text(input.title, 'assunto', 160, true), notes: text(input.notes ?? '', 'observações', 3000), date, time,
  };
}

export function completeMeetingFields(input) {
  fieldsObject(input);
  if (input.status !== 'completed') invalid('encerramento da reunião');
}
