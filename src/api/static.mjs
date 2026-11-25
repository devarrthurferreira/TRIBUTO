import { readFile } from 'node:fs/promises';
import { MODULES } from '../platform/policy.mjs';

const ALLOWED = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/home', ['index.html', 'text/html; charset=utf-8']],
  ['/painel', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ...MODULES.map(({ id }) => [`/setor/${id}`, ['index.html', 'text/html; charset=utf-8']]),
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/user-wizard.js', ['user-wizard.js', 'text/javascript; charset=utf-8']],
  ['/user-wizard.css', ['user-wizard.css', 'text/css; charset=utf-8']],
  ['/marketing-tasks.js', ['marketing-tasks.js', 'text/javascript; charset=utf-8']],
  ['/marketing-tasks.css', ['marketing-tasks.css', 'text/css; charset=utf-8']],
  ['/marketing-metrics.js', ['marketing-metrics.js', 'text/javascript; charset=utf-8']],
  ['/marketing-metrics.css', ['marketing-metrics.css', 'text/css; charset=utf-8']],
  ['/marketing-crm.js', ['marketing-crm.js', 'text/javascript; charset=utf-8']],
  ['/marketing-crm.css', ['marketing-crm.css', 'text/css; charset=utf-8']],
  ['/marketing.css', ['marketing.css', 'text/css; charset=utf-8']],
  ['/club.js', ['club.js', 'text/javascript; charset=utf-8']],
  ['/club.css', ['club.css', 'text/css; charset=utf-8']],
  ['/portal.js', ['portal.js', 'text/javascript; charset=utf-8']],
  ['/portal.css', ['portal.css', 'text/css; charset=utf-8']],
  ['/sectors.js', ['sectors.js', 'text/javascript; charset=utf-8']],
  ['/sectors.css', ['sectors.css', 'text/css; charset=utf-8']],
  ['/sector-whatsapp.js', ['sector-whatsapp.js', 'text/javascript; charset=utf-8']],
  ['/sector-whatsapp.css', ['sector-whatsapp.css', 'text/css; charset=utf-8']],
  ['/chat.js', ['chat.js', 'text/javascript; charset=utf-8']],
  ['/chat.css', ['chat.css', 'text/css; charset=utf-8']],
  ['/icons.css', ['icons.css', 'text/css; charset=utf-8']],
  ['/bootstrap-icons.woff2', ['bootstrap-icons.woff2', 'font/woff2']],
  ['/maximum-logo.png', ['maximum-logo.png', 'image/png']],
  ['/maximum-carreiras.webp', ['maximum-carreiras.webp', 'image/webp']],
  ['/poppins-regular.woff2', ['poppins-regular.woff2', 'font/woff2']],
  ['/poppins-semibold.woff2', ['poppins-semibold.woff2', 'font/woff2']],
  ['/poppins-bold.woff2', ['poppins-bold.woff2', 'font/woff2']]
]);

export async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const asset = ALLOWED.get(pathname);
  if (!asset) return false;
  const file = new URL(`../../web/${asset[0]}`, import.meta.url);
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': asset[1],
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Interface não instalada');
  }
  return true;
}
