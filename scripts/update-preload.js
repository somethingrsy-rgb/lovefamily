// public/js 아래 모든 모듈을 index.html 의 modulepreload 목록에 맞춘다. (새 .js 파일을 추가했다면: npm run preload)
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..', 'public');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(path.join(root, 'js')).filter((f) => f.endsWith('.js')).sort();
const links = files.map((f) => `  <link rel="modulepreload" href="/${path.relative(root, f).split(path.sep).join('/')}">`).join('\n');
const file = path.join(root, 'index.html');
let html = fs.readFileSync(file, 'utf8').replace(/ {2}<link rel="modulepreload"[^\n]*\n/g, '');
html = html.replace('  <link rel="stylesheet" href="/styles.css">\n', `  <link rel="stylesheet" href="/styles.css">\n${links}\n`);
fs.writeFileSync(file, html);
console.log(`${files.length}개 모듈을 index.html 에 반영했어요.`);
