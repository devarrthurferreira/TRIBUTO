import { ApiError } from '../api/validation.mjs';
import { canAccess } from '../platform/policy.mjs';
import { closeSurveyFields, completeMeetingFields, goalCheckInFields, goalFields,
  meetingFields, noteFields, planFields, reviewResponseFields, surveyFields, surveyRating } from './fields.mjs';
import { MIN_SURVEY_RESPONSES } from './mysql-store.mjs';

const GOAL = /^\/people\/goals\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})(\/check-in)?$/i;
const SURVEY = /^\/people\/surveys\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})(\/response)?$/i;
const PLAN = /^\/people\/plans\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i;
const MEETING = /^\/people\/meetings\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i;
const REVIEW_RESPONSE = /^\/people\/reviews\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\/response$/i;

function found(item) {
  if (!item) throw new ApiError(404, 'PEOPLE_NOT_FOUND', 'Registro não encontrado.');
  return item;
}

function requireRhEditor(user) {
  if (!canAccess(user, 'rh', 'edit')) throw new ApiError(403, 'FORBIDDEN', 'Acesso restrito à equipe autorizada de Recursos Humanos.');
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
          if (goal[2]) {
            if (req.method === 'GET') return send(res, 200, { items: found(await store.listGoalCheckIns(userId, id)) });
            if (req.method === 'POST') return send(res, 200, found(await store.checkInGoal(userId, id, goalCheckInFields(await readBody(req)))));
          } else if (req.method === 'PATCH') {
            const changes = goalFields(await readBody(req), { partial: true });
            return send(res, 200, { item: found(await store.updateGoal(userId, id, changes)) });
          } else if (req.method === 'DELETE') {
            found(await store.removeGoal(userId, id));
            return send(res, 200, { removed: true });
          }
        }
        if (route === '/people/feedback/requests' && req.method === 'POST') {
          const { recipientId, text } = noteFields(await readBody(req));
          return send(res, 201, { item: await store.createNote('feedback', userId, { recipientId, text, isRequest:true }) });
        }
        const fulfill = /^\/people\/feedback\/([a-f\d-]{36})\/fulfill$/i.exec(route);
        if (fulfill && req.method === 'POST') {
          const fields = noteFields(await readBody(req));
          return send(res, 201, { item: found(await store.createNote('feedback', userId, { ...fields, requestId:fulfill[1] })) });
        }
        const reply = /^\/people\/feedback\/([a-f\d-]{36})\/reply$/i.exec(route);
        if (reply && req.method === 'POST') {
          const { text } = reviewResponseFields(await readBody(req));
          return send(res, 201, found(await store.replyToFeedback(userId, reply[1], text)));
        }
        if (route === '/people/feedback' || route === '/people/reviews') {
          const review = route === '/people/reviews';
          const kind = review ? 'review' : 'feedback';
          if (req.method === 'GET') {
            const all = review && new URL(req.url, 'http://localhost').searchParams.get('scope') === 'all';
            if (all) requireRhEditor(user);
            return send(res, 200, { items: await store.listNotes(kind, userId, all) });
          }
          if (req.method === 'POST') {
            if (review) requireRhEditor(user);
            return send(res, 201, { item: await store.createNote(kind, userId, noteFields(await readBody(req), { review })) });
          }
        }
        if (route === '/people/reviews/available' && req.method === 'GET') {
          return send(res, 200, { items: await store.listAvailableReviews(userId) });
        }
        const reviewResponse = REVIEW_RESPONSE.exec(route);
        if (reviewResponse && req.method === 'POST') {
          const response = reviewResponseFields(await readBody(req));
          const item = found(await store.respondToReview(userId, reviewResponse[1].toLowerCase(), response));
          return send(res, 200, { item });
        }
        if (route === '/people/plans') {
          if (req.method === 'GET') return send(res, 200, { items: await store.listPlans(userId) });
          if (req.method === 'POST') return send(res, 201, { item: await store.createPlan(userId, planFields(await readBody(req))) });
        }
        const plan = PLAN.exec(route);
        if (plan && req.method === 'PATCH') {
          const fields = planFields(await readBody(req), { partial: true });
          return send(res, 200, { item: found(await store.updatePlan(userId, plan[1].toLowerCase(), fields)) });
        }
        if (route === '/people/meetings') {
          if (req.method === 'GET') return send(res, 200, { items: await store.listMeetings(userId) });
          if (req.method === 'POST') return send(res, 201, { item: await store.createMeeting(userId, meetingFields(await readBody(req))) });
        }
        const meeting = MEETING.exec(route);
        if (meeting && req.method === 'PATCH') {
          completeMeetingFields(await readBody(req));
          return send(res, 200, { item: found(await store.completeMeeting(userId, meeting[1].toLowerCase())) });
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
