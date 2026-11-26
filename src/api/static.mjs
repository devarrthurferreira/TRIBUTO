import { readFile } from 'node:fs/promises';
import { MODULES } from '../platform/policy.mjs';
import { clubPageFromPath } from '../../web/club-routes.js';

const ALLOWED = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/home', ['index.html', 'text/html; charset=utf-8']],
  ['/maxhub', ['index.html', 'text/html; charset=utf-8']],
  ['/maxhub/', ['index.html', 'text/html; charset=utf-8']],
  ['/clube/check-in', ['index.html', 'text/html; charset=utf-8']],
  ['/clube/check-in/', ['index.html', 'text/html; charset=utf-8']],
  ['/painel', ['index.html', 'text/html; charset=utf-8']],
  ['/cliente', ['client-portal.html', 'text/html; charset=utf-8']],
  ['/cliente/', ['client-portal.html', 'text/html; charset=utf-8']],
  ['/client-portal.js', ['client-portal.js', 'text/javascript; charset=utf-8']],
  ['/client-portal.css', ['client-portal.css', 'text/css; charset=utf-8']],
  ['/client-wizard.js', ['client-wizard.js', 'text/javascript; charset=utf-8']],
  ['/client-wizard.css', ['client-wizard.css', 'text/css; charset=utf-8']],
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
  ['/crm-page-builder.js', ['crm-page-builder.js', 'text/javascript; charset=utf-8']],
  ['/crm-page-builder.css', ['crm-page-builder.css', 'text/css; charset=utf-8']],
  ['/crm-page-tracking.js', ['crm-page-tracking.js', 'text/javascript; charset=utf-8']],
  ['/marketing.css', ['marketing.css', 'text/css; charset=utf-8']],
  ['/club.js', ['club.js', 'text/javascript; charset=utf-8']],
  ['/club-routes.js', ['club-routes.js', 'text/javascript; charset=utf-8']],
  ['/club.css', ['club.css', 'text/css; charset=utf-8']],
  ['/club-check-in.js', ['club-check-in.js', 'text/javascript; charset=utf-8']],
  ['/club-check-in.css', ['club-check-in.css', 'text/css; charset=utf-8']],
  ['/club-rh-mood.js', ['club-rh-mood.js', 'text/javascript; charset=utf-8']],
  ['/club-rh-mood.css', ['club-rh-mood.css', 'text/css; charset=utf-8']],
  ['/people.js', ['people.js', 'text/javascript; charset=utf-8']],
  ['/people.css', ['people.css', 'text/css; charset=utf-8']],
  ['/maxhub.js', ['maxhub.js', 'text/javascript; charset=utf-8']],
  ['/maxhub.css', ['maxhub.css', 'text/css; charset=utf-8']],
  ['/maxhub-social.js', ['maxhub-social.js', 'text/javascript; charset=utf-8']],
  ['/maxhub-social.css', ['maxhub-social.css', 'text/css; charset=utf-8']],
  ['/maxhub-profile.js', ['maxhub-profile.js', 'text/javascript; charset=utf-8']],
  ['/maxhub-profile.css', ['maxhub-profile.css', 'text/css; charset=utf-8']],
  ['/maxhub-people.js', ['maxhub-people.js', 'text/javascript; charset=utf-8']],
  ['/maxhub-people.css', ['maxhub-people.css', 'text/css; charset=utf-8']],
  ['/person-name.js', ['person-name.js', 'text/javascript; charset=utf-8']],
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
  const asset = ALLOWED.get(clubPageFromPath(pathname) ? '/home' : pathname);
  if (!asset) return false;
  const file = new URL(`../../web/${asset[0]}`, import.meta.url);
  try {
    const data = await readFile(file);
    const images = pathname === '/setor/marketing' ? "'self' data: https:" : "'self' data:";
    res.writeHead(200, {
      'content-type': asset[1],
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin',
      'content-security-policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src ${images}; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Interface não instalada');
  }
  return true;
}
