import AdmZip from 'adm-zip';
import { readdirSync } from 'node:fs';
const zip = new AdmZip();
for (const f of readdirSync('dist')) zip.addLocalFile(`dist/${f}`);
zip.writeZip('make-bilibili-great-together-extension.zip');
console.log('zip written');
