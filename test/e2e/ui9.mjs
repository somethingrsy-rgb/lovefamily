// 브라우저 E2E 9: 빠른 시작 — 앱 파일을 폰에 저장해 두고, 지난번 화면을 먼저 보여 준다(서버 응답이 느려도 '불러오는 중'에 오래 머물지 않는다)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ui9-')) });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: 'mom@t', password: 'secret1', role: 'mom' }) });

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ ...devices['iPhone 14'], serviceWorkers: 'allow' });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
// 서비스 워커 파일에는 빌드 번호가 들어 있다
const sw = await (await fetch(base + '/sw.js')).text();
assert.ok(!sw.includes('__BUILD__') && /const BUILD = '[0-9a-f]{10}'/.test(sw), '서비스 워커에 빌드 번호가 들어간다');
await page.goto(base + '/#/login'); await page.fill('input[name=loginId]', 'mom@t'); await page.fill('input[name=password]', 'secret1'); await page.click('button[type=submit]'); await page.waitForSelector('.house');
// 서비스 워커가 앱 파일을 모두 저장할 때까지
await page.waitForFunction(async () => { const ks = await caches.keys(); const k = ks.find((x) => x.startsWith('lovefamily-code-')); if (!k) return false; const keys = await (await caches.open(k)).keys(); return keys.length >= 25; }, null, { timeout: 15000 });
await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
await page.reload(); await page.waitForSelector('.house'); // 서비스 워커가 제어하는 상태로 한 번 더
console.log('✓ 앱 파일을 폰에 저장(서비스 워커)');
// 서버(API) 응답이 3초씩 느려도, 저장해 둔 화면이 먼저 뜬다
await ctx.route('**/api/**', async (route) => { await new Promise((r) => setTimeout(r, 3000)); try { await route.continue(); } catch { /* 이미 끝난 요청 */ } });
const t0 = Date.now();
await page.reload();
await page.waitForSelector('.house', { timeout: 2500 });
const ms = Date.now() - t0;
assert.ok(ms < 2500, `API가 3초 느려도 첫 화면은 먼저 뜬다(${ms}ms)`);
console.log(`✓ 서버가 느려도 첫 화면 ${ms}ms (불러오는 중 없음)`);
await ctx.unroute('**/api/**');
await page.waitForTimeout(3800); // 새 내용으로 바뀌어도 화면이 정상
assert.ok(await page.$('.house .walker'), '뒤에서 새로 받은 뒤에도 정상');
// 로그아웃하면 저장해 둔 화면 정보도 지워진다
const cached = await page.evaluate(() => localStorage.getItem('infoCache'));
assert.ok(cached, '가족 정보를 저장해 둔다');
await page.evaluate(() => window.__app.logout()); await page.waitForTimeout(600);
assert.equal(await page.evaluate(() => localStorage.getItem('infoCache')), 'null', '로그아웃하면 지운다');
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 9 통과');
