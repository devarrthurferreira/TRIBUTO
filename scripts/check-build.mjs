import { access } from 'node:fs/promises';

for (const file of ['../web/index.html', '../web/styles.css', '../web/app.js', '../src/api/main.mjs']) {
  await access(new URL(file, import.meta.url));
}
console.log('Painel e API prontos para publicação.');
