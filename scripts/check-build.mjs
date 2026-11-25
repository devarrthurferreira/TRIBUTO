import { access } from 'node:fs/promises';

for (const file of ['../web/index.html', '../web/styles.css', '../web/app.js', '../web/club.js', '../web/club.css', '../web/people.js', '../web/people.css',
  '../web/marketing-tasks.js', '../web/marketing-tasks.css', '../web/marketing-metrics.js', '../web/marketing-metrics.css',
  '../web/marketing-crm.js', '../web/marketing-crm.css', '../web/marketing.css', '../src/api/main.mjs']) {
  await access(new URL(file, import.meta.url));
}
console.log('Painel e API prontos para publicação.');
