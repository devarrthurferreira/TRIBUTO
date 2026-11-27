import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { access, readdir } from 'node:fs/promises';

for (const file of ['../web/index.html', '../web/styles.css', '../web/app.js', '../web/club.js', '../web/club-routes.js', '../web/club.css', '../web/people.js', '../web/people.css',
  '../web/club-check-in.js', '../web/club-check-in.css', '../web/club-rh-mood.js', '../web/club-rh-mood.css',
  '../web/maxhub.js', '../web/maxhub.css', '../web/maxhub-social.js', '../web/maxhub-social.css', '../web/maxhub-people.js', '../web/maxhub-people.css',
  '../web/tech-client.js', '../web/client-registration.js', '../web/client-wizard.js', '../web/client-wizard.css', '../web/client-portal.html', '../web/client-portal.js', '../web/client-portal.css', '../web/client-modules.js',
  '../web/dossier-form.js', '../web/dossier.js', '../web/dossier.css', '../web/dossier-public.html', '../web/dossier-public.js', '../web/smtp-notifications.js', '../web/smtp-notifications.css',
  '../web/feedback-analytics.js', '../web/feedback-analytics.css',
  '../web/maxhub-profile.js', '../web/maxhub-profile.css',
  '../web/marketing-tasks.js', '../web/marketing-tasks.css', '../web/marketing-metrics.js', '../web/marketing-metrics.css',
  '../web/marketing-crm.js', '../web/marketing-crm.css', '../web/crm-page-builder.js', '../web/crm-page-builder.css',
  '../web/person-name.js', '../web/crm-page-tracking.js', '../web/marketing.css', '../src/api/main.mjs']) {
  await access(new URL(file, import.meta.url));
}
const web = new URL('../web/', import.meta.url);
for (const name of await readdir(web)) {
  if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', fileURLToPath(new URL(name, web))], { stdio: 'inherit' });
}
console.log('Painel e API prontos para publicação.');
