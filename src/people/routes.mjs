import { ApiError } from '../api/validation.mjs';
import { closeSurveyFields, goalFields, surveyFields, surveyRating } from './fields.mjs';
import { MIN_SURVEY_RESPONSES } from './mysql-store.mjs';

const GOAL = /^\/people\/goals\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i;
const SURVEY = /^\/people\/surveys\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})(\/response)?$/i;

function found(item) {
  if (!item) throw new ApiError(404, 'PEOPLE_NOT_FOUND', 'Registro não encontrado.');
  return item;
}

export function createPeopleRouter(store) {
  return {
    async handleHttp({ req, res, route, user, send, readBody, requireAdmin, logger = console }) {
      try {
        const { _id: userId } = user;
        if (route === '/people/goals') {
          if (req.method === 'GET') return send(res, 200, { items: await store.listGoals(userId) });
          if (req.method === 'POST') return send(res, 201, { item: await store.createGoal(userId, goalFields(await readBody(req))) });
        }
        const goal = GOAL.exec(route);
        if (goal) {
          const id = goal[1].toLowerCase();
          if (req.method === 'PATCH') {
            const changes = goalFields(await readBody(req), { partial: true });
            return send(res, 200, { item: found(await store.updateGoal(userId, id, changes)) });
          }
          if (req.method === 'DELETE') {
            found(await store.removeGoal(userId, id));
            return send(res, 200, { removed: true });
          }
        }
        if (route === '/people/surveys') {
          if (req.method === 'GET') return send(res, 200, { items: await store.listSurveys(userId), minResponses: MIN_SURVEY_RESPONSES });
          if (req.method === 'POST') {
            requireAdmin(user);
            return send(res, 201, { item: await store.createSurvey(userId, surveyFields(await readBody(req))) });
          }
        }
        const survey = SURVEY.exec(route);
        if (survey) {
          const id = survey[1].toLowerCase();
          if (req.method === 'PATCH' && !survey[2]) {
            requireAdmin(user);
            closeSurveyFields(await readBody(req));
            return send(res, 200, { item: found(await store.closeSurvey(userId, id)) });
          }
          if (req.method === 'PUT' && survey[2]) {
            const rating = surveyRating(await readBody(req));
            return send(res, 200, { item: found(await store.respondToSurvey(userId, id, rating)) });
          }
        }
        throw new ApiError(404, 'PEOPLE_NOT_FOUND', 'Área de Pessoas indisponível.');
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
          throw new ApiError(409, 'PEOPLE_CONFLICT', 'O registro mudou. Atualize e tente novamente.');
        }
        logger.error('People API failure', { code: error?.code });
        throw new ApiError(500, 'PEOPLE_INTERNAL_ERROR', 'Não foi possível concluir a operação de Pessoas.');
      }
    },
  };
}
