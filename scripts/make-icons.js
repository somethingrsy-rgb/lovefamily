// 아이콘 PNG 생성: public/icons/icon.svg → 180/192/512 (Playwright 의 Chromium 사용, 개발용)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = path.resolve('public/icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const b = await chromium.launch();
const render = async (size, file, pad = 0) => {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const inner = pad ? `<div style="width:${size}px;height:${size}px;background:#e9c7f2;display:grid;place-items:center"><div style="width:${size * (1 - pad * 2)}px;height:${size * (1 - pad * 2)}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div>` : `<div style="width:${size}px;height:${size}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>`;
  await p.setContent(`<body style="margin:0">${inner}</body>`);
  await p.screenshot({ path: path.join(dir, file), omitBackground: false });
  await p.close();
};
await render(180, 'apple-touch-icon.png'); await render(192, 'icon-192.png'); await render(512, 'icon-512.png'); await render(512, 'icon-maskable-512.png', 0.1);
await b.close();
console.log('icons done');
