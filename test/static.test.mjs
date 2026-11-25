import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/api/http.mjs';
import { sha256 } from '../src/api/validation.mjs';

test('servidor entrega painel e API na mesma origem com headers de proteção', async () => {
  const server = createApiServer({
    store: {},
    agents: [{ id: 'test', tokenSha256: sha256('a'.repeat(64)), companies: [], sources: [] }],
    jobs: []
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await fetch(origin);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);
    assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await html.text(), /TRIBUTO \| Maximum Contábil/);
    const dashboard = await fetch(`${origin}/painel`);
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /id="appView"/);
    for (const asset of ['/styles.css', '/app.js']) assert.equal((await fetch(`${origin}${asset}`)).status, 200);
    assert.equal((await fetch(`${origin}/healthz`)).status, 200);
    assert.equal((await fetch(`${origin}/.env.example`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
