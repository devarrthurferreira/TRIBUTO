import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { ApiError, sha256 } from '../src/api/validation.mjs';
import { createMaxHubFeedRouter } from '../src/maxhub/feed-routes.mjs';
import { createPlatformRouter } from '../src/platform/routes.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2kAAAAASUVORK5CYII=', 'base64');
const imageData = `data:image/png;base64,${PNG.toString('base64')}`;

async function withFeed(store, run) {
  const accounts = [{ role: 'member', moduleGrants: {} }, { role: 'member', moduleGrants: { rh: 'edit' } }]
    .map((entry, index) => ({ ...entry, _id: randomUUID(), active: true, token: String(index + 1).repeat(64), csrfToken: `csrf-${index}` }));
  const platform = {
    async findSession(hash) {
      const account = accounts.find(person => sha256(person.token) === hash);
      if (account) return { userId: account._id, csrfToken: account.csrfToken };
    },
    async findUserById(id) { return accounts.find(person => person._id === id); },
  };
  const router = createPlatformRouter({ store: platform, maxhubFeed: createMaxHubFeedRouter(store) });
  const server = http.createServer((req, res) => router(req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    await run(async (path, { account = accounts[0], method = 'GET', body, csrf = account?.csrfToken } = {}) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/platform/maxhub/feed${path}`, {
        method, body: body && JSON.stringify(body),
        headers: {
          ...(account ? { cookie: `tributo_session=${account.token}` } : {}),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
      });
      const result = method === 'HEAD' ? null : response.headers.get('content-type')?.startsWith('image/')
        ? Buffer.from(await response.arrayBuffer()) : await response.json();
      return { status: response.status, headers: response.headers, result };
    }, accounts);
  } finally { await new Promise(resolve => server.close(resolve)); }
}

test('O feed reutiliza sessão e CSRF e valida público, menções, mídia e comunicados', async () => {
  const invited = randomUUID();
  const clientId = randomUUID();
  const recorded = [];
  const store = {
    async list() { return { posts: [], nextCursor: null }; },
    async create(user, input) { recorded.push({ user: user._id, ...input }); return { id: randomUUID() }; },
  };
  const post = { kind: 'celebration', text: '  Parabéns!  ', audience: { type: 'all' },
    mentions: [invited, invited], image: imageData, clientId };

  await withFeed(store, async (request, [member, rh]) => {
    assert.equal((await request('', { account: null })).status, 401);
    assert.equal((await request('', { method: 'POST', csrf: '', body: post })).status, 403);
    const created = await request('', { method: 'POST', body: post });
    assert.equal(created.status, 201);
    assert.ok(created.result.post.id);
    assert.deepEqual(recorded[0], {
      user: member._id, kind: 'celebration', text: 'Parabéns!', audience: { type: 'all' },
      mentions: [invited], image: { mime: 'image/png', data: PNG }, clientId,
    });

    const announcement = { kind: 'announcement', text: 'Comunicado', audience: { type: 'sector', sector: 'rh' } };
    assert.equal((await request('', { method: 'POST', body: announcement })).status, 403);
    assert.equal((await request('', { account: rh, method: 'POST', body: announcement })).status, 201);
    assert.equal(recorded[1].user, rh._id);

    for (const invalid of [
      { audience: { type: 'sector', sector: 'desconhecido' } },
      { audience: { type: 'people', userIds: [invited] } },
      { mentions: ['fora-do-diretorio'] },
      { image: 'data:image/svg+xml;base64,AAA=' },
      { image: `data:image/jpeg;base64,${PNG.toString('base64')}` },
      { image: null, text: ' ' },
      { text: 'a'.repeat(2_001) },
      { clientId: 'invalido' },
    ]) assert.equal((await request('', { method: 'POST', body: { ...post, ...invalid } })).status, 400);
    assert.equal(recorded.length, 2);
  });
});

test('O feed usa cursor por data e aplica o escopo do ator a comentários, reações, imagens e remoção', async () => {
  const id = randomUUID();
  const date = '2026-11-26T09:00:00.000Z';
  const cursor = Buffer.from(`${date}/${id}`).toString('base64url');
  let owner;
  const assertScope = (actor, postId) => {
    assert.equal(postId, id);
    if (actor._id !== owner._id) throw new ApiError(404, 'MAXHUB_POST_NOT_FOUND', 'Publicação indisponível.');
  };
  const store = {
    async list(actor, filter) {
      assert.equal(actor._id, owner._id);
      assert.deepEqual(filter, { kind: 'celebration', cursor: { id, createdAt: new Date(date) } });
      return { posts: [], nextCursor: null };
    },
    async getImage(actor, postId) { assertScope(actor, postId); return { mime: 'image/png', data: PNG }; },
    async getComments(actor, postId) { assertScope(actor, postId); return { comments: [], commentCount: 0 }; },
    async addComment(actor, postId, text) { assertScope(actor, postId); return { comments: [{ text }], commentCount: 1 }; },
    async setLike(actor, postId, liked) { assertScope(actor, postId); return { liked, likeCount: Number(liked) }; },
    async remove(actor, postId) { assertScope(actor, postId); },
  };
  await withFeed(store, async (request, [member, other]) => {
    owner = member;
    assert.equal((await request(`?kind=celebration&cursor=${cursor}`)).status, 200);
    assert.equal((await request('?cursor=malformado')).status, 400);
    assert.equal((await request('?kind=invalido')).status, 400);
    assert.equal((await request(`/${id}/image`, { account: other })).status, 404);
    assert.equal((await request(`/${id}/comments`, { account: other })).status, 404);
    assert.equal((await request(`/${id}/like`, { account: other, method: 'PUT' })).status, 404);
    assert.equal((await request(`/${id}`, { account: other, method: 'DELETE' })).status, 404);
    const image = await request(`/${id}/image`);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.deepEqual(image.result, PNG);
    assert.equal((await request(`/${id}/image`, { method: 'HEAD' })).status, 200);
    assert.deepEqual((await request(`/${id}/comments`, { method: 'POST', body: { text: '  Ótimo! ' } })).result,
      { comments: [{ text: 'Ótimo!' }], commentCount: 1 });
    assert.deepEqual((await request(`/${id}/like`, { method: 'PUT' })).result, { liked: true, likeCount: 1 });
    assert.deepEqual((await request(`/${id}/like`, { method: 'DELETE' })).result, { liked: false, likeCount: 0 });
    assert.deepEqual((await request(`/${id}`, { method: 'DELETE' })).result, { deleted: true });
  });
});
