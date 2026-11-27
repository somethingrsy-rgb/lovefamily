import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [,, file, out, w = '1440', h = '900'] = process.argv;
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: Number(w), height: Number(h) } });
await p.goto('file://' + process.cwd() + '/' + file); await p.waitForTimeout(1500);
await p.screenshot({ path: out, fullPage: true }); await b.close();
