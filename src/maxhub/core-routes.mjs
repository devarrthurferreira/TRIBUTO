import { ApiError } from '../api/validation.mjs';
import { normalizeAttachments } from '../chat/attachments.mjs';
import { maxHubDay } from './points.mjs';
import { profileDetails } from './profile-fields.mjs';

const AVATAR = /^\/maxhub\/avatar\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
const IMAGE_BYTES = 450 * 1024;
const IMAGE_DATA = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

function invalidImage() {
  return new ApiError(400, 'MAXHUB_IMAGE_FORMAT', 'Envie uma imagem JPG, PNG ou WebP válida.');
}

export function parseMaxHubImage(value, maxBytes = IMAGE_BYTES) {
  if (typeof value !== 'string') throw invalidImage();
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 32) {
    throw new ApiError(413, 'MAXHUB_IMAGE_SIZE', 'A imagem excede o tamanho permitido.');
  }
  const match = IMAGE_DATA.exec(value);
  if (!match) throw invalidImage();

  const [, mime, base64] = match;
  const data = Buffer.from(base64, 'base64');
  if (!data.length || data.toString('base64') !== base64) throw invalidImage();
  if (data.length > maxBytes) throw new ApiError(413, 'MAXHUB_IMAGE_SIZE', 'A imagem excede o tamanho permitido.');
  try {
    normalizeAttachments([{ name: `imagem.${mime.slice('image/'.length)}`, data }]);
  } catch (error) {
    if (error instanceof ApiError) throw invalidImage();
    throw error;
  }
  return { mime, data };
}

export function sendMaxHubImage(res, { mime, data }, head = false) {
  res.writeHead(200, {
    'content-type': mime,
    'content-length': data.length,
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; sandbox",
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
  });
  res.end(head ? undefined : data);
  return true;
}

function profileFields(input) {
  const { bio, photo } = input;
  const changes = profileDetails(input);
  if (bio !== undefined && (typeof bio !== 'string' || bio.trim().length > 600)) {
    throw new ApiError(400, 'MAXHUB_PROFILE_BIO', 'A descrição deve ter até 600 caracteres.');
  }
  if (bio !== undefined) changes.bio = bio.trim();
  if (photo !== undefined) changes.photo = photo === null ? null : parseMaxHubImage(photo);
  if (!Object.keys(changes).length) {
    throw new ApiError(400, 'MAXHUB_PROFILE_INPUT', 'Informe os dados do perfil que deseja alterar.');
  }
  return changes;
}

export function createMaxHubCoreRouter(store, { clock = () => new Date() } = {}) {
  return {
    async handleHttp({ req, res, route, user, send, readBody }) {
      const { method } = req;
      if (route === '/maxhub/visit' && method === 'POST') {
        const awarded = await store.visit(user._id, maxHubDay(clock()));
        return send(res, 200, { awarded });
      }
      if (route === '/maxhub/leaderboard' && method === 'GET') return send(res, 200, await store.leaderboard(user._id));
      if (route === '/maxhub/points' && method === 'GET') return send(res, 200, await store.points(user._id));
      if (route === '/maxhub/profile' && method === 'GET') return send(res, 200, await store.profile(user));
      if (route === '/maxhub/profile' && method === 'PUT') {
        return send(res, 200, await store.updateProfile(user, profileFields(await readBody(req, 1_300_000))));
      }
      const avatar = AVATAR.exec(route);
      if (avatar && (method === 'GET' || method === 'HEAD')) {
        const image = await store.avatar(avatar[1].toLowerCase());
        if (!image) throw new ApiError(404, 'MAXHUB_AVATAR_NOT_FOUND', 'Foto do perfil indisponível.');
        return sendMaxHubImage(res, image, method === 'HEAD');
      }
      if (route === '/maxhub/directory' && method === 'GET') {
        const query = new URL(req.url, 'http://localhost').searchParams.get('q')?.trim() ?? '';
        if (query.length > 80) throw new ApiError(400, 'MAXHUB_DIRECTORY_QUERY', 'A busca deve ter até 80 caracteres.');
        return send(res, 200, await store.directory(query));
      }
      return false;
    },
  };
}
