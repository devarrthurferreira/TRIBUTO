import assert from 'node:assert/strict';
import test from 'node:test';
import { crmPageRecord, pageBlocks } from '../src/marketing/crm-pages.mjs';
import { createMarketingCrmRouter } from '../src/marketing/crm-routes.mjs';

const pageId = '12345678-1111-4111-8111-123456789abc';
const block = { id: 'block-1', type: 'heading', title: 'Olá', align: 'center', color: '#AAbbCC' };

test('CRM valida tipos de bloco, referências, CSS e IDs únicos', () => {
  const form = { id: 'block-form', type: 'form', text: 'Inscrever' };
  const button = { id: 'block-button', type: 'button', url: '#inscricao' };
  assert.deepEqual(pageBlocks([block, form, button]).map(({ id, color, url }) => [id, color, url]), [
    ['block-1', '#aabbcc', ''], ['block-form', '', ''], ['block-button', '', '#inscricao'],
  ]);
  assert.equal(pageBlocks([{ ...button, url: '/setor/marketing' }])[0].url, '/setor/marketing');
  for (const value of [[block, block], [{ ...form }, { ...form, id: 'form-2' }],
    [{ ...block, type: 'script' }], [{ ...block, color: 'red;position:absolute' }],
    [{ ...button, url: 'javascript:alert(1)' }], [{ ...button, url: '//site.test/troca' }],
    [{ ...button, url: 'https://user:password@example.test/' }], [{ ...block, id: '"onerror' }]]) {
    assert.throws(() => pageBlocks(value), { status: 400 });
  }
});

test('CRM diferencia alterações em rascunho da versão pública anterior', () => {
  const publication = { id: pageId, slug: 'minha-pagina', title: 'Título público', description: '',
    buttonText: 'Inscrever', tags: [], blocks: pageBlocks([block]) };
  const row = { id: pageId, slug: publication.slug, title: 'Título em edição', description: '', button_text: 'Inscrever',
    tags_json: '[]', status: 'published', draft_json: JSON.stringify(publication.blocks), published_json: JSON.stringify(publication),
    updated_at: '2026-11-25 12:00:05.123', created_at: '2026-11-25 12:00:00.000', published_at: '2026-11-25 12:00:00.000' };
  const page = crmPageRecord(row);
  assert.equal(page.published, true);
  assert.equal(page.hasUnpublishedChanges, true);
  assert.equal(page.publishedAt, '2026-11-25T12:00:00.000Z');
  assert.equal(crmPageRecord({ ...row, title: publication.title }).hasUnpublishedChanges, false);
  assert.equal(crmPageRecord({ ...row, status: 'draft' }).publishedAt, null);
  assert.equal(crmPageRecord(row, { includeBlocks: false }).blocks, undefined);
});

test('CRM protege leitura de páginas e gestão de rascunhos e renderiza prévia com HTML estático', async () => {
  const manager = { _id: 'manager', active: true, role: 'member', moduleGrants: { marketing: 'edit' } };
  const reader = { ...manager, moduleGrants: { marketing: { level: 'edit', blockedActions: ['marketingCrmManage'] } } };
  const calls = [];
  const router = createMarketingCrmRouter({
    pages: {
      get: async id => ({ id }), listTemplates: async () => ({ items: [] }),
      retire: async (...args) => { calls.push(args); return { archived: Boolean(args[2]?.archive) }; },
    },
    pageAnalytics: { report: async (id, campaignId) => ({ id, campaignId }) },
    previewCampaign: async () => ({ subject: 'Prévia <script>', content: 'Informações', blocks: [block] }),
  });
  const request = (user, method, path, suffix = '', res = {}) => router.handleHttp({
    req: { method, url: path + suffix }, res, route: '/marketing/crm' + path, user,
    send: (_, status, result) => ({ status, result }), readBody: async () => ({}),
  });
  assert.equal((await request(reader, 'GET', `/landings/${pageId}`)).result.id, pageId);
  assert.equal((await request(reader, 'GET', `/landings/${pageId}/analytics`, `?campaignId=${pageId}`)).result.campaignId, pageId);
  await assert.rejects(request(reader, 'DELETE', `/landings/${pageId}`), { status: 403 });
  assert.deepEqual((await request(manager, 'DELETE', `/landings/${pageId}`)).result, { archived: true });
  assert.deepEqual(calls, [[pageId, manager._id, { archive: true }]]);
  const preview = `/campaigns/${pageId}/preview`;
  const { result } = await request(reader, 'GET', preview);
  assert.match(result.html, /Prévia &lt;script&gt;/);
  let document;
  let headers;
  await request(reader, 'GET', preview, '?document=1', {
    writeHead(status, fields) { assert.equal(status, 200); headers = fields; },
    end(html) { document = html; },
  });
  assert.equal(document, result.html);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'self'/);
  assert.match(headers['Content-Security-Policy'], /img-src 'self'/);
});
