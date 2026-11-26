import { access } from 'node:fs/promises';

for (const file of ['../web/index.html', '../web/styles.css', '../web/app.js', '../web/club.js', '../web/club-routes.js', '../web/club.css', '../web/people.js', '../web/people.css',
  '../web/club-check-in.js', '../web/club-check-in.css', '../web/club-rh-mood.js', '../web/club-rh-mood.css',
  '../web/maxhub.js', '../web/maxhub.css', '../web/maxhub-social.js', '../web/maxhub-social.css', '../web/maxhub-people.js', '../web/maxhub-people.css',
  '../web/maxhub-profile.js', '../web/maxhub-profile.css',
  '../web/marketing-tasks.js', '../web/marketing-tasks.css', '../web/marketing-metrics.js', '../web/marketing-metrics.css',
  '../web/marketing-crm.js', '../web/marketing-crm.css', '../web/crm-page-builder.js', '../web/crm-page-builder.css',
  '../web/person-name.js', '../web/crm-page-tracking.js', '../web/marketing.css', '../src/api/main.mjs']) {
  await access(new URL(file, import.meta.url));
}
console.log('Painel e API prontos para publicação.');
