// 체감 속도 점검: 서버 응답이 1.5초 늦은 폰에서, 한 번 본 화면을 다시 열 때 '불러오는 중' 없이 바로 보이는지 모든 화면을 확인한다.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-speed-')) });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
const mk = () => ({ cookie: '', async call(m, u, b) { const r = await fetch(base + u, { method: m, headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie: this.cookie }, body: b && JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; } });
const mom = mk(); await mom.call('POST', '/api/auth/register', { loginId: 'mom@t', password: 'secret1', role: 'mom' });
const me = (await mom.call('GET', '/api/me')).body; const [yuel] = me.kids.map((k) => k.id);

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const pg = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
const errors = []; pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto(base + '/#/login'); await pg.fill('input[name=loginId]', 'mom@t'); await pg.fill('input[name=password]', 'secret1'); await pg.click('button[type=submit]'); await pg.waitForSelector('.kid-card');
await pg.waitForTimeout(800);

const ROUTES = ['/meals', '/timetable', '/bank', '/stamps', '/family', '/notebook', '/calendar', '/routines', '/adult', '/inbox', '/family-activity',
  `/kid/${yuel}`, `/kid/${yuel}/today`, `/kid/${yuel}/timer`, `/kid/${yuel}/wallet`, `/kid/${yuel}/wishes`, `/kid/${yuel}/supplies`, `/kid/${yuel}/talk`, `/kid/${yuel}/inbox`, `/kid/${yuel}/missions`, `/kid/${yuel}/stamps`, `/kid/${yuel}/timetable`, `/kid/${yuel}/meals`];
const go = async (r) => { await pg.evaluate((h) => { location.hash = h; }, '#' + r); };
// 1) 처음 한 번씩 돌아본다(빠른 서버)
for (const r of ROUTES) { await go(r); await pg.waitForTimeout(500); }
// 2) 이제 서버를 느리게(1.5초) 만들고 다시 열어 본다
await pg.route('**/api/**', async (route) => { if (route.request().url().includes('/api/stream')) return route.continue(); await new Promise((x) => setTimeout(x, 1500)); route.continue(); });
const slow = [];
for (const r of ROUTES) {
  await go('/'); await pg.waitForTimeout(300);
  await go(r); await pg.waitForTimeout(350);
  const loading = await pg.$('#main .loading'); const stale = await pg.$('#main.stale');
  const shown = (await pg.textContent('#main')).trim().length;
  if (loading || (!stale && shown < 5)) slow.push(r);
  await pg.waitForTimeout(1700); // 서버 응답이 와서 실제 화면으로 바뀔 때까지
}
console.log(slow.length ? `✗ 느린 화면(저장된 모습이 없어 불러오는 중): ${slow.join(', ')}` : `✓ 모든 화면(${ROUTES.length}개)이 다시 열 때 바로 보여요`);
await browser.close(); await app.close();
assert.deepEqual(errors, [], errors.join(' | '));
assert.deepEqual(slow, [], '느린 화면 있음');
