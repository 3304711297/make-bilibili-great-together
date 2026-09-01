import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
for (const f of ['manifest.json', 'rules.json', 'options.html']) {
  copyFileSync(`src/${f}`, `dist/${f}`);
}
console.log('static files copied');
