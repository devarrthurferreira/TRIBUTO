import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createPublicCrmRouter } from '../src/marketing/public-crm.mjs';

test('página pública exibe blocos seguros e registra eventos e conversões pela própria origem', async () => {
  const landing = {
    id: '11111111-1111-4111-8111-111111111111', slug: 'boletim', title: 'Boletim <Maximum>', description: 'Descrição',
    blocks: [
      { id: 'Title_1', type: 'heading', title: 'Bem-vindo <script>alert(1)</script>', color: '#782539', align: 'center' },
      { id: 'cta', type: 'button', title: 'Inscreva-se', url: '#inscricao' },
      { id: 'bad', type: 'button', title: 'Endereço inválido', url: 'javascript:alert(1)' },
      { id: 'form', type: 'form', title: 'Cadastrar', text: 'Receber' },
    ],
  };
  const visitToken = 'd'.repeat(64);
  const reference = 'e'.repeat(64);
  const changes = [];
  const leadId = '22222222-2222-4222-8222-222222222222';
  const router = createPublicCrmRouter({
    async publicLanding(slug) { return slug === landing.slug ? landing : null; },
    async captureLanding(slug, input, options) { changes.push(['capture', slug, input, options]); return { accepted: true, leadId }; },
    pageAnalytics: {
      async record(page, input) { changes.push(['measurement', page.id, input]); },
      async recordSubmission(page, input) { changes.push(['submission', page.id, input]); },
    },
  });
  const server = http.createServer(async (req, res) => {
    if (!await router(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${origin}/inscricao/boletim?ref=${reference}`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'; connect-src 'self'/);
    assert.match(html, /data-crm-block="Title_1"/);
    assert.match(html, /Bem-vindo &lt;script&gt;/);
    assert.match(html, /href="#inscricao"/);
    assert.match(html, /id="inscricao".*data-crm-block="form"/);
    assert.match(html, /Permitir identificação/);
    assert.match(html, /\/crm-page-tracking.js/);
    assert.doesNotMatch(html, /javascript:|alert\(1\)<\/script>|subscriberId/);
    assert.deepEqual(changes, []);

    const event = { operation: 'start', slug: landing.slug, visitToken, reference, seconds: 0 };
    const wrongOrigin = await fetch(`${origin}/crm/pagina/eventos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example.test' }, body: JSON.stringify(event),
    });
    assert.equal(wrongOrigin.status, 403);
    const sent = await fetch(`${origin}/crm/pagina/eventos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event),
    });
    assert.equal(sent.status, 204);
    assert.deepEqual(changes.shift(), ['measurement', landing.id, event]);
    const form = await fetch(`${origin}/inscricao/boletim`, { method: 'POST', body: new URLSearchParams({
      email: 'visitor@example.test', consent: 'yes', ref: reference, visit: visitToken, block: 'form',
    }) });
    assert.equal(form.status, 200);
    assert.doesNotMatch(await form.text(), /visitor@example\.test/);
    assert.equal(changes[0][0], 'capture');
    assert.deepEqual(changes[1], ['submission', landing.id, { leadId, visitToken, blockId: 'form' }]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
