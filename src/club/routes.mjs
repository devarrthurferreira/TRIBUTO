import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { canPerform } from '../platform/policy.mjs';
import { clubFields, clubId, importClubFields } from './catalog.mjs';

const RECORD_PATH = /^\/club\/(benefits|partners|events)(?:\/([a-f\d-]{36}))?$/i;
const SAVED_PATH = /^\/club\/saved\/([^/]+)$/;
const RH_MOOD_PATH = /^\/club\/check-in\/rh(?:\/([^/]+))?$/;
const HISTORY_DAYS = 30;
const MIN_SUMMARY_RESPONSES = 5;
const RH_PERIODS = ['7', '30', '90'];
const localDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

function earlierDate(date, days) {
  const boundary = new Date(`${date}T00:00:00Z`);
  boundary.setUTCDate(boundary.getUTCDate() - days);
  return boundary.toISOString().slice(0, 10);
}

function checkInMood(input) {
  const mood = input?.mood;
  if (mood === null || (Number.isInteger(mood) && mood >= 1 && mood <= 5)) return mood;
  throw new ApiError(400, 'CLUB_INVALID_MOOD', 'Selecione uma opção de humor ou confirme apenas a presença.');
}

function shareWithRh(input) {
  const share = input?.shareWithRh;
  if (share === undefined) return false;
  if (typeof share === 'boolean') return share;
  throw new ApiError(400, 'CLUB_INVALID_SHARING', 'Confirme se deseja compartilhar este registro com o RH.');
}

function rhDays(url) {
  const values = new URL(url, 'http://localhost').searchParams.getAll('days');
  if (!values.length) return HISTORY_DAYS;
  if (values.length === 1 && RH_PERIODS.includes(values[0])) return Number(values[0]);
  throw new ApiError(400, 'CLUB_INVALID_PERIOD', 'Selecione um período de 7, 30 ou 90 dias.');
}

export function createClubRouter(store, { clock = () => new Date() } = {}) {
  return {
    async handleHttp({ req, res, route, user, send, readBody, requireAdmin, logger }) {
      try {
        const method = req.method;
        if (route === '/club' && method === 'GET') {
          return send(res, 200, await store.list(user.role === 'admin'));
        }
        if (route === '/club/check-in' && (method === 'GET' || method === 'PUT')) {
          const input = method === 'PUT' ? await readBody(req) : null;
          const today = localDate.format(clock());
          if (method === 'PUT') await store.saveMood(user._id, today, checkInMood(input), shareWithRh(input));
          const rows = await store.getMoodHistory(user._id, earlierDate(today, HISTORY_DAYS - 1), today);
          const current = rows.find(({ date }) => date === today);
          const history = rows.map(({ date, mood }) => ({ date, mood }));
          return send(res, 200, {
            today, checkedIn: Boolean(current), todayMood: current?.mood ?? null, sharedWithRh: Boolean(current?.sharedWithRh), history,
          });
        }
        if (route === '/club/check-in/summary' && method === 'GET') {
          requireAdmin(user);
          const today = localDate.format(clock());
          const days = await store.getMoodSummary(earlierDate(today, HISTORY_DAYS), today, MIN_SUMMARY_RESPONSES);
          return send(res, 200, { days, minimum: MIN_SUMMARY_RESPONSES });
        }
        const rhMood = RH_MOOD_PATH.exec(route);
        if (rhMood && method === 'GET') {
          if (!canPerform(user, 'rh', 'clubMoodRead')) {
            throw new ApiError(403, 'FORBIDDEN', 'Acesso restrito ao acompanhamento de check-ins do RH.');
          }
          const days = rhDays(req.url);
          const today = localDate.format(clock());
          const firstDay = earlierDate(today, days - 1);
          if (rhMood[1]) {
            const result = await store.getRhMoodProfile(clubId(rhMood[1], 'perfil'), firstDay, today);
            if (!result) throw new ApiError(404, 'CLUB_PROFILE_NOT_FOUND', 'Nenhum check-in compartilhado neste período para este perfil.');
            return send(res, 200, result);
          }
          return send(res, 200, { today, firstDay, days, ...await store.getRhMoodOverview(firstDay, today) });
        }
        if (route === '/club/saved' && method === 'GET') {
          return send(res, 200, { ids: await store.listSaved(user._id) });
        }
        const saved = SAVED_PATH.exec(route);
        if (saved && (method === 'PUT' || method === 'DELETE')) {
          const id = clubId(saved[1]);
          const ids = method === 'PUT' ? await store.addSaved(user._id, id) : await store.removeSaved(user._id, id);
          return send(res, 200, { ids });
        }
        if (route === '/club/import' && method === 'POST') {
          requireAdmin(user);
          const catalog = importClubFields(await readBody(req));
          return send(res, 200, await store.importCatalog(catalog, user._id));
        }
        const match = RECORD_PATH.exec(route);
        if (match) {
          const collection = match[1].toLowerCase();
          const id = match[2] ? clubId(match[2]) : null;
          if (method === 'POST' && !id) {
            requireAdmin(user);
            const fields = clubFields(collection, await readBody(req));
            return send(res, 201, await store.create(collection, randomUUID(), fields, user._id));
          }
          if (method === 'PATCH' && id) {
            requireAdmin(user);
            const fields = clubFields(collection, await readBody(req), { partial: true });
            const updated = await store.update(collection, id, fields, user._id);
            if (updated) return send(res, 200, updated);
          }
          if (method === 'DELETE' && id) {
            requireAdmin(user);
            if (await store.remove(collection, id, user._id)) return send(res, 200, { removed: true });
          }
        }
        throw new ApiError(404, 'CLUB_NOT_FOUND', 'Registro do Clube indisponível.');
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_DUP_ENTRY'].includes(error?.code)) {
          throw new ApiError(409, 'CLUB_CONFLICT', 'Os dados mudaram durante a operação. Atualize e tente novamente.');
        }
        logger.error('Club API failure', { code: error?.code });
        throw new ApiError(500, 'CLUB_INTERNAL_ERROR', 'Não foi possível carregar ou atualizar o Clube.');
      }
    },
  };
}
