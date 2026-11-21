// 브라우저 E2E 6: 아이 폰(전용 연결)에서도 우리집 대시보드가 보이고, 자기 캐릭터만 움직이며, 어른 기능은 열리지 않는다
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const shots = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'lf-shots');
fs.mkdirSync(shots, { recursive: true });
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ui6-')) });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
let cookie = '';
const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie }, body: b && JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return r.json().catch(() => ({})); };
await call('POST', '/api/auth/register', { loginId: 'mom@t', password: 'secret1', role: 'mom' });
const me = await call('GET', '/api/me'); const [yuel, yuha] = me.kids.map((k) => k.id);
const { code } = await call('POST', `/api/kids/${yuel}/pair-code`);

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const errors = [];
const page = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + '/#/pair');
await page.fill('input', code);
await page.click('button[type=submit]');
await page.waitForSelector('.tab');
// 우리집 대시보드(집 그림·캐릭터·아이 카드)가 보인다
await page.goto(base + '/#/'); await page.waitForSelector('.house .walker', { timeout: 8000 });
assert.equal(await page.$$eval('.tab', (e) => e.length), 4, '탭: 우리집 · 내 화면 · 도장판 · 내 설정');
assert.ok(await page.$('.kid-card'), '아이 카드가 보인다');
assert.equal(await page.isVisible('#adultMenu'), false, '어른 메뉴 버튼은 없다');
assert.equal(!!(await page.$('.adult-panel')), false, '어른 패널은 없다');
console.log('✓ 아이 폰에서 우리집 대시보드 보임');
await page.screenshot({ path: path.join(shots, '80-kidphone-home.png'), fullPage: false });
// 동생 캐릭터는 눌러도 선택되지 않고, 자기 캐릭터만 선택된다
await page.evaluate(() => document.querySelector('.house').scrollIntoView({ block: 'center' }));
await page.click(`[data-walker="${yuha}"]`, { force: true });
assert.equal(await page.$eval(`[data-walker="${yuha}"]`, (e) => e.classList.contains('sel')), false, '동생 캐릭터는 선택되지 않는다');
await page.click(`[data-walker="${yuel}"]`, { force: true });
assert.equal(await page.$eval(`[data-walker="${yuel}"]`, (e) => e.classList.contains('sel')), true, '내 캐릭터는 선택된다');
// 어른 방을 눌러도 상태 바꾸기 창이 열리지 않는다(선택 해제 후)
await page.evaluate(() => document.querySelector('.walker.sel')?.click());
await page.evaluate(() => document.querySelector('[data-room=adult]')?.click());
await page.waitForTimeout(300);
assert.equal(!!(await page.$('.sheet')), false, '어른 상태 바꾸기 창은 열리지 않는다');
console.log('✓ 자기 캐릭터만 움직이고, 어른 기능은 열리지 않음');
// 우리집 탭 ↔ 내 화면 탭
await page.click('.tab[data-tab=today]'); await page.waitForSelector('.kid-hub');
await page.click('.tab[data-tab=home]'); await page.waitForSelector('.house');
console.log('✓ 우리집 ↔ 내 화면 이동');
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 6 통과 · 스크린샷:', shots);
