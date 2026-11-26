import test from 'node:test';
import assert from 'node:assert/strict';
import { awardMaxcoin, maxHubDay, MAXCOIN_RULES, revokeMaxcoin } from '../src/maxhub/points.mjs';
import { createMaxHubCoreRouter, parseMaxHubImage } from '../src/maxhub/core-routes.mjs';

const id = '02000000-0000-4000-8000-000000000001';
const person = { _id: id, name: 'Lia Costa', role: 'member', active: true };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nC/8AAAAASUVORK5CYII=';

test('Maxcoin usa regras do servidor e calendário de Brasília', async () => {
  assert.deepEqual(MAXCOIN_RULES.map(({ action, points }) => [action, points]), [
    ['visit', 200], ['objective', 500], ['celebrate', 200], ['engagement', 100],
    ['feedback', 500], ['satisfaction', 500], ['one_on_one', 100], ['quick_survey', 500],
    ['pdi_active', 500], ['mood', 200], ['pdi_complete', 500], ['super_survey', 500],
  ]);
  assert.equal(maxHubDay(new Date('2026-11-26T02:59:59.999Z')), '2026-11-25');
  assert.equal(maxHubDay(new Date('2026-11-26T03:00:00.000Z')), '2026-11-26');

  const rows = new Map();
  const connection = {
    async execute(statement, [user, action, eventHash, points]) {
      assert.ok(Buffer.isBuffer(eventHash));
      assert.equal(eventHash.length, 32);
      const key = [user, action, eventHash.toString('hex')].join('/');
      if (/^DELETE FROM/.test(statement)) return [{ affectedRows: Number(rows.delete(key)) }];
      if (rows.has(key)) throw Object.assign(new Error('duplicado'), { code: 'ER_DUP_ENTRY' });
      rows.set(key, points);
      return [{ affectedRows: 1 }];
    },
  };
  assert.equal(await awardMaxcoin(connection, id, 'visit', '2026-11-26'), true);
  assert.equal(await awardMaxcoin(connection, id, 'visit', '2026-11-26'), false);
  assert.equal(await awardMaxcoin(connection, id, 'visit', '2026-11-27'), true);
  assert.equal(await awardMaxcoin(connection, id, 'mood', '2026-11-26'), true);
  assert.equal(await awardMaxcoin(connection, id, 'feedback', 'feedback-1'), true);
  assert.equal(await revokeMaxcoin(connection, id, 'feedback', 'feedback-2'), false);
  assert.equal(await revokeMaxcoin(connection, id, 'feedback', 'feedback-1'), true);
  assert.deepEqual([...rows.values()], [200, 200, 200]);
  await assert.rejects(awardMaxcoin(connection, id, 'client-bonus', 'x'), TypeError);
  await assert.rejects(awardMaxcoin(connection, id, 'mood', ''), TypeError);
  const unavailable = { async execute() { throw Object.assign(new Error('unavailable'), { code: 'ER_LOCK_DEADLOCK' }); } };
  await assert.rejects(awardMaxcoin(unavailable, id, 'mood', '2026-11-26'), { code: 'ER_LOCK_DEADLOCK' });
});

test('MaxHub valida formato, conteúdo e tamanho das imagens', () => {
  assert.equal(parseMaxHubImage(png).mime, 'image/png');
  assert.throws(() => parseMaxHubImage(png, 15), { status: 413 });
  assert.throws(() => parseMaxHubImage(png.replace('image/png', 'image/jpeg')), { status: 400 });
  assert.throws(() => parseMaxHubImage(png.replace('image/png', 'image/svg+xml')), { status: 400 });
  assert.throws(() => parseMaxHubImage(png + '='), { status: 400 });
  assert.throws(() => parseMaxHubImage(png.slice(0, -1)), { status: 400 });
  assert.throws(() => parseMaxHubImage('https://site.test/arquivo.png'), { status: 400 });
});

test('Rotas principais do MaxHub usam o titular da sessão para pontos e perfil', async () => {
  const calls = [];
  const store = {
    async visit(user, day) { calls.push(['visit', user, day]); return true; },
    async points(user) { calls.push(['points', user]); return { total: 200 }; },
    async profile(user) { calls.push(['profile', user._id]); return { name: user.name }; },
    async updateProfile(user, values) { calls.push(['update', user._id, values]); return { bio: values.bio }; },
    async avatar(user) { return user === id ? parseMaxHubImage(png) : null; },
    async directory(query) { calls.push(['directory', query]); return { people: [] }; },
  };
  const router = createMaxHubCoreRouter(store, { clock: () => new Date('2026-11-26T02:59:59Z') });
  async function handle(method, route, input, query = '') {
    const output = {};
    const res = {
      writeHead(status, headers) { Object.assign(output, { status, headers }); },
      end(payload) { output.payload = payload; },
    };
    output.handled = await router.handleHttp({
      req: { method, url: `/v1/platform${route}${query}` }, res, route, user: person,
      send(_res, status, payload) { Object.assign(output, { status, payload }); return true; },
      readBody(_req, limit) { assert.equal(limit, 1_300_000); return input; },
    });
    return output;
  }

  assert.deepEqual((await handle('POST', '/maxhub/visit')).payload, { awarded: true });
  assert.deepEqual((await handle('GET', '/maxhub/points')).payload, { total: 200 });
  assert.deepEqual((await handle('GET', '/maxhub/profile')).payload, { name: person.name });
  assert.equal((await handle('PUT', '/maxhub/profile', { bio: '  Oi  ', photo: null, userId: 'outro' })).payload.bio, 'Oi');
  assert.deepEqual((await handle('GET', '/maxhub/directory', undefined, '?q=%20Lia%20')).payload, { people: [] });
  assert.deepEqual(calls, [
    ['visit', id, '2026-11-25'], ['points', id], ['profile', id], ['update', id, { bio: 'Oi', photo: null }], ['directory', 'Lia'],
  ]);
  await assert.rejects(handle('PUT', '/maxhub/profile', { bio: 'a'.repeat(601) }), { status: 400 });
  await handle('PUT', '/maxhub/profile', {
    skills: ['  Gestão  ', 'Comunicação'],
    personalLinks: [{ id, platform: 'Linkedin', url: 'https://linkedin.com/in/lia', label: 'Minha página' }],
    education: [{ type: 'Curso', title: 'Liderança', institution: 'Maximum', startMonth: '2026-01', ongoing: true }],
  });
  const [, userId, details] = calls.at(-1);
  assert.equal(userId, id);
  assert.deepEqual(details.skills, ['Gestão', 'Comunicação']);
  assert.deepEqual(details.personalLinks, [{ id, platform: 'linkedin', url: 'https://linkedin.com/in/lia', label: 'Minha página' }]);
  assert.match(details.education[0].id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(details.education[0], {
    id: details.education[0].id, type: 'Curso', title: 'Liderança', institution: 'Maximum', startMonth: '2026-01',
    endMonth: '', ongoing: true, credentialUrl: '', description: '',
  });
  await handle('PUT', '/maxhub/profile', { education: [] });
  assert.deepEqual(calls.at(-1), ['update', id, { education: [] }]);
  for (const input of [
    { skills: [' '] },
    { personalLinks: [{ platform: 'instagram', url: 'javascript:alert(1)' }] },
    { personalLinks: [{ platform: 'github', url: 'https://pessoa:senha@example.com' }] },
    { education: [{ type: 'Curso', title: 'Curso ABC', startMonth: '2026-05', endMonth: '2026-04' }] },
    { education: [{ type: 'Curso', title: 'Curso XYZ', ongoing: true, endMonth: '2026-04' }] },
    { admissionDate: '2012-03-04' },
  ]) await assert.rejects(handle('PUT', '/maxhub/profile', input), { status: 400 });
  const image = await handle('GET', `/maxhub/avatar/${id}`);
  assert.equal(image.headers['content-type'], 'image/png');
  assert.equal(image.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(image.headers['cache-control'], 'no-store');
  assert.ok(Buffer.isBuffer(image.payload));
  assert.equal((await handle('HEAD', `/maxhub/avatar/${id}`)).payload, undefined);
  assert.equal((await handle('GET', '/maxhub/feed')).handled, false);
});
