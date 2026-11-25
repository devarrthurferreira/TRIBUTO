import { access } from 'node:fs/promises';

for (const file of ['../web/index.html', '../web/styles.css', '../web/app.js', '../web/club.js', '../web/club.css', '../src/api/main.mjs']) {
  await access(new URL(file, import.meta.url));
}
console.log('Painel e API prontos para publicação.');
