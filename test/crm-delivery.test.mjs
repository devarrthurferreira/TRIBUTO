import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { readCrmMailConfig, sendCrmEmail, verifiedDeliveryEvent } from '../src/marketing/delivery.mjs';
import { buildCrmEmailMarkup } from '../src/marketing/crm-email-template.mjs';
import { createPublicCrmRouter } from '../src/marketing/public-crm.mjs';

const mailEnv = {
  CRM_EMAIL_PROVIDER: 'resend', CRM_RESEND_API_KEY: 'fixture-only', CRM_EMAIL_FROM: 'Maximum <boletim@example.test>',
  CRM_PUBLIC_URL: 'https://central.example.test', CRM_RESEND_WEBHOOK_SECRET: `whsec_${Buffer.alloc(32, 17).toString('base64')}`,
};

test('fila do CRM usa idempotência, renderiza somente texto seguro e inclui descadastro', async () => {
  assert.equal(readCrmMailConfig({}), null);
  assert.equal(readCrmMailConfig({ ...mailEnv, CRM_PUBLIC_URL: 'http://central.example.test' }), null);
  const config = readCrmMailConfig(mailEnv);
  const job = { id: 'message-01', email: 'cliente@example.test', subject: 'Teste', content: '<script>teste</script>\nTexto e https://example.test',
    unsubscribeToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', confirmationToken: null, destinationPath: '/inscricao/curso', trackingToken: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' };
  const result = await sendCrmEmail(config, job, async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['Idempotency-Key'], 'maximum-crm/message-01');
    const payload = JSON.parse(init.body);
    assert.deepEqual(payload.to, ['cliente@example.test']);
    assert.ok(payload.html.includes('&lt;script&gt;'));
    assert.ok(payload.html.includes('/inscricao/curso?ref=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'));
    assert.match(payload.headers['List-Unsubscribe'], /https:\/\/central\.example\.test\/crm\/descadastrar/);
    assert.equal(payload.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    return Response.json({ id: 'provedor-01' });
  });
  assert.equal(result, 'provedor-01');
});

test('CRM verifica assinatura e horário do evento antes de contabilizar métricas', () => {
  const key = readCrmMailConfig(mailEnv).webhookKey;
  const stamp = '1795621199';
  const id = 'msg_fixture';
  const body = Buffer.from('{"type":"email.clicked","data":{"email_id":"provedor-01"}}');
  const signature = createHmac('sha256', key).update(`${id}.${stamp}.`).update(body).digest('base64');
  const headers = { 'svix-timestamp': stamp, 'svix-id': id, 'svix-signature': `v1,${signature}` };
  assert.deepEqual(verifiedDeliveryEvent(key, headers, body, Number(stamp) * 1000), { providerId: 'provedor-01', type: 'clicked' });
  assert.equal(verifiedDeliveryEvent(key, headers, Buffer.from('{}'), Number(stamp) * 1000), null);
  assert.equal(verifiedDeliveryEvent(key, headers, body, Number(stamp) * 1000 + 301_000), null);
});

test('campanha usa os blocos publicados como HTML de e-mail, com link individual para o formulário', async () => {
  const config = readCrmMailConfig(mailEnv);
  const ref = 'r'.repeat(32);
  await sendCrmEmail(config, {
    id: 'message-builder', email: 'cliente@example.test', subject: 'Novidades', content: 'Olá!',
    destinationPath: '/inscricao/novidades', trackingToken: ref, unsubscribeToken: 'u'.repeat(32),
    emailPublication: { blocks: [
      { type: 'heading', title: 'Nossos conteúdos', color: '#821D2A' },
      { type: 'text', text: 'Leia as novidades <hoje>' },
      { type: 'form', title: 'Quero participar' },
      { type: 'button', title: 'Link inválido', url: 'javascript:danger()' },
    ] },
  }, async (_url, request) => {
    const payload = JSON.parse(request.body);
    assert.match(payload.html, /<table role="presentation"/);
    assert.match(payload.html, /color:#821D2A/);
    assert.match(payload.html, /Leia as novidades &lt;hoje&gt;/);
    assert.match(payload.html, new RegExp(`href="https://central\\.example\\.test/inscricao/novidades\\?ref=${ref}"[^>]*>Quero participar`));
    assert.match(payload.text, /Nossos conteúdos/);
    assert.doesNotMatch(payload.html, /javascript:|<form|<script/);
    return Response.json({ id: 'provedor-builder' });
  });
});

test('templates recentes aceitam imagem clicável, estilos e links HTTPS sem executar conteúdo do usuário', () => {
  const options = { subject: 'Informativo', action: 'https://central.example.test/inscricao/informativo', origin: 'https://central.example.test', blocks: [
    { type: 'hero', title: 'Informativo <Maximum>', text: 'Novidades', url: '#inscricao', linkLabel: 'Leia a edição', fontSize: 38, padding: 22 },
    { type: 'image', url: 'https://images.example.test/banner.png', linkUrl: '/inscricao/informativo', alt: 'Capa' },
    { type: 'links', text: 'Leia no site|https://example.test\nIgnorar|javascript:alert(1)' },
    { type: 'list', text: 'Primeira novidade\nSegunda novidade' },
  ] };
  const html = buildCrmEmailMarkup(options);
  assert.match(html, /font-size:38px/);
  assert.match(html, /Informativo &lt;Maximum&gt;/);
  assert.match(html, /Leia a edição/);
  assert.match(html, /href="https:\/\/central\.example\.test\/inscricao\/informativo"[^>]*><img src="https:\/\/images\.example\.test\/banner\.png"/);
  assert.match(html, /<li>Primeira novidade<\/li>/);
  assert.doesNotMatch(html, /javascript:|<script|<iframe/);
  const previous = buildCrmEmailMarkup({ ...options, legacy: true });
  assert.match(previous, /padding:12px 24px/);
  assert.doesNotMatch(previous, /Leia a edição|font-size:38px|<a[^>]*><img/);
});

test('captura e ações públicas exigem confirmação via POST e não expõem dados enviados', async () => {
  const changes = [];
  const router = createPublicCrmRouter({
    async publicLanding(slug) { return slug === 'curso' ? { title: 'Curso <teste>', description: 'Conteúdo' } : null; },
    async captureLanding(slug, data) { changes.push(['lead', slug, data]); },
    async confirmLead(token) { changes.push(['confirm', token]); return true; },
    async unsubscribe(token) { changes.push(['unsubscribe', token]); return true; },
  }, null);
  const server = http.createServer(async (req, res) => {
    if (!await router(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const token = 't'.repeat(32);
  try {
    const capture = await fetch(`${origin}/inscricao/curso?ref=${token}`);
    assert.equal(capture.status, 200);
    const form = await capture.text();
    assert.match(form, /Curso &lt;teste&gt;/);
    assert.ok(form.includes(`name="ref" value="${token}"`));
    assert.equal((await fetch(`${origin}/crm/confirmar/${token}`)).status, 200);
    assert.deepEqual(changes, []);
    const denied = await fetch(`${origin}/inscricao/curso`, { method: 'POST', body: new URLSearchParams({ email: 'lead@example.test' }), headers: { Origin: 'https://other.example.test' } });
    assert.equal(denied.status, 403);
    const captured = await fetch(`${origin}/inscricao/curso`, { method: 'POST', headers: { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' },
      body: new URLSearchParams({ email: 'lead@example.test', name: 'Lead', consent: 'yes', ref: token }) });
    assert.equal(captured.status, 200);
    assert.equal((await captured.text()).includes('lead@example.test'), false);
    assert.deepEqual(changes[0], ['lead', 'curso', { email: 'lead@example.test', name: 'Lead', consent: true, conversionToken: token }]);
    assert.equal((await fetch(`${origin}/crm/confirmar/${token}`, { method: 'POST', body: new URLSearchParams() })).status, 200);
    assert.equal((await fetch(`${origin}/crm/descadastrar/${token}`, { method: 'POST', body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }) })).status, 204);
    assert.deepEqual(changes.slice(1), [['confirm', token], ['unsubscribe', token]]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
