import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createPublicCrmRouter } from '../src/marketing/public-crm.mjs';

async function serve(t, store, logger) {
  const router = createPublicCrmRouter(store, null, logger);
  const server = http.createServer(async (req, res) => {
    if (!await router(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('página do CRM renderiza novos blocos e configurações sem aceitar scripts ou CSS solto', async t => {
  const design = {
    slug: 'informativo', title: 'Informativo', blocks: [
      { id: 'editorial', type: 'hero', title: 'Notícias da Maximum', text: 'Leia nossas novidades.', url: '#inscricao', linkLabel: 'Receber novidades', fontSize: 32, lineHeight: 1.4, padding: 28, margin: 18, maxWidth: 700, borderRadius: 16, borderColor: '#a16483', fontWeight: 'bold' },
      { id: 'capa', type: 'image', url: 'https://assets.example.test/capa.webp', linkUrl: 'https://example.test/noticia?origem=informativo', alt: 'Capa do <informativo>' },
      { id: 'depoimento', type: 'quote', title: 'Equipe', text: 'Planejamento que funciona.' },
      { id: 'itens', type: 'list', title: 'Destaques', text: 'Uma notícia\r\nPróximos eventos\n' },
      { id: 'respiro', type: 'spacer', padding: 36 },
      { id: 'gravacao', type: 'video', title: 'Veja a gravação', url: 'https://example.test/video' },
      { id: 'redes', type: 'links', text: 'Site|https://example.test/sobre\nInseguro|javascript:alert(1)' },
      { id: 'invalido', type: 'image', url: '//assets.example.test/outro.webp', padding: '0;display:none', borderColor: '#fff;background:url(https://example.test/)' },
      { id: 'insc', type: 'form', title: 'Acompanhe', text: 'Inscrever' },
      { id: 'optout', type: 'unsubscribe', title: 'Não deve aparecer em páginas comuns' },
    ],
  };
  const base = await serve(t, { async publicLanding() { return design; } });
  const response = await fetch(`${base}/inscricao/informativo`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /data-crm-block="editorial" style="[^"]*font-size:32px[^"]*padding:28px[^"]*margin-block:18px/);
  assert.match(html, /border-radius:16px;max-width:700px/);
  assert.match(html, /href="#inscricao"[^>]*>Receber novidades/);
  assert.match(html, /href="https:\/\/example\.test\/noticia\?origem=informativo"[^>]*><img src="https:\/\/assets\.example\.test\/capa\.webp" alt="Capa do &lt;informativo&gt;" referrerpolicy="no-referrer"/);
  assert.match(html, /<blockquote><p>Planejamento que funciona\.<\/p><cite>Equipe<\/cite><\/blockquote>/);
  assert.match(html, /<ul><li>Uma notícia<\/li><li>Próximos eventos<\/li><\/ul>/);
  assert.match(html, /min-height:36px;padding:0/);
  assert.match(html, /href="https:\/\/example\.test\/video"[^>]*>Assistir ao vídeo/);
  assert.match(html, /href="https:\/\/example\.test\/sobre"[^>]*>Site/);
  assert.doesNotMatch(html, /javascript:|<iframe|Não deve aparecer|outro.webp|display:none|background:url/);
});

test('descadastro com design próprio continua dependendo do token e não registra métricas', async t => {
  const token = 'a'.repeat(64);
  const design = { title: 'Preferências <Maximum>', description: 'Escolha sobre nossos comunicados.', blocks: [
    { id: 'intro', type: 'text', text: 'Você pode sair quando quiser.' },
    { id: 'logo', type: 'image', url: '/maximum-logo.png', linkUrl: 'https://example.test/politica', alt: 'Logo de teste' },
    { id: 'pixel', type: 'image', url: 'https://assets.example.test/remoto.gif' },
    { id: 'desc', type: 'unsubscribe', title: 'Sair dos comunicados', text: 'Confirmar saída' },
    { id: 'normal-form', type: 'form', title: 'Não coletar outro e-mail' },
  ] };
  const unsubscribe = [];
  const base = await serve(t, {
    async publicUnsubscribePage(value) { return value === token ? design : null; },
    async publicUnsubscribePreview(slug) { return slug === 'preferencias' ? design : null; },
    async unsubscribe(value) { unsubscribe.push(value); return value === token; },
    pageAnalytics: { async record() { assert.fail('Pages de descadastro não devem registrar métricas.'); } },
  });
  const path = `${base}/crm/descadastrar/${token}`;
  const tracked = await fetch(`${path}?ref=${'b'.repeat(64)}`);
  assert.equal(tracked.status, 200);
  assert.doesNotMatch(tracked.headers.get('content-security-policy'), /script-src/);
  assert.match(tracked.headers.get('content-security-policy'), /img-src 'self';/);
  const html = await tracked.text();
  assert.match(html, /Preferências &lt;Maximum&gt;/);
  assert.match(html, new RegExp(`<form action="/crm/descadastrar/${token}" method="post">`));
  assert.match(html, /id="descadastro"/);
  assert.match(html, />Confirmar saída</);
  assert.match(html, /href="https:\/\/example\.test\/politica" rel="noreferrer"[^>]*><img src="\/maximum-logo\.png" alt="Logo de teste"/);
  assert.doesNotMatch(html, /<script|data-crm-block|Permitir identificação|name="email"|Não coletar|remoto\.gif/);

  const previewPath = `${base}/crm/descadastro/preferencias`;
  const preview = await fetch(previewPath);
  const previewHtml = await preview.text();
  assert.equal(preview.status, 200);
  assert.match(previewHtml, /link individual enviado por e-mail/);
  assert.match(previewHtml, /<button type="button" disabled>Confirmar saída/);
  assert.doesNotMatch(previewHtml, /<form/);
  assert.equal((await fetch(previewPath, { method: 'POST', body: new URLSearchParams() })).status, 405);
  assert.equal((await fetch(`${base}/crm/descadastro/rascunho`)).status, 404);
  assert.equal((await fetch(path, { method: 'POST', headers: { Origin: 'https://external.example.test' }, body: new URLSearchParams() })).status, 403);
  assert.deepEqual(unsubscribe, []);

  assert.equal((await fetch(path, { method: 'POST', body: new URLSearchParams() })).status, 200);
  assert.equal((await fetch(path, { method: 'POST', headers: { Origin: 'https://reader.example.test' }, body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }) })).status, 204);
  assert.deepEqual(unsubscribe, [token, token]);
});

test('descadastro padrão permanece disponível quando o projeto personalizado está fora do ar', async t => {
  const token = 'c'.repeat(64);
  const logged = [];
  const base = await serve(t, {
    async publicUnsubscribePage() { throw new Error('fixture private data'); },
    async unsubscribe(value) { return value === token; },
  }, { error(message) { logged.push(message); } });
  const response = await fetch(`${base}/crm/descadastrar/${token}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<button type="submit">Cancelar inscrição/);
  assert.doesNotMatch(logged.join('\n'), /fixture private data|c{64}/);
  assert.equal((await fetch(`${base}/crm/descadastrar/${token}`, { method: 'POST', body: new URLSearchParams() })).status, 200);
});
