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
    assert.match(await html.text(), /<title>Central Maximum \| Maximum Contábil<\/title>/);
    for (const path of ['/home', '/painel', '/setor/dp', '/setor/rh', '/setor/tecnologia', '/setor/marketing',
      '/setor/societario', '/setor/contabil', '/setor/fiscal', '/setor/diretoria']) {
      const dashboard = await fetch(`${origin}${path}`);
      assert.equal(dashboard.status, 200);
      assert.match(await dashboard.text(), /id="appView"/);
    }
    const sectorHead = await fetch(`${origin}/setor/tecnologia`, { method: 'HEAD' });
    assert.equal(sectorHead.status, 200);
    assert.match(sectorHead.headers.get('content-type'), /text\/html/);
    assert.equal(await sectorHead.text(), '');
    assert.equal((await fetch(`${origin}/setor/inexistente`)).status, 404);
    for (const asset of ['/styles.css', '/app.js']) assert.equal((await fetch(`${origin}${asset}`)).status, 200);
    for (const [asset, mime] of [['/maximum-logo.png', 'image/png'], ['/maximum-carreiras.webp', 'image/webp'],
      ['/poppins-regular.woff2', 'font/woff2'], ['/poppins-semibold.woff2', 'font/woff2'], ['/poppins-bold.woff2', 'font/woff2']]) {
      const result = await fetch(`${origin}${asset}`);
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('content-type'), mime);
    }
    assert.equal((await fetch(`${origin}/healthz`)).status, 200);
    assert.equal((await fetch(`${origin}/.env.example`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
