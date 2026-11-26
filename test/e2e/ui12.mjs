// 브라우저 E2E 12: 급식 탭 — 식단표 붙여넣기, 날짜 넘기기, 아이 폰은 보기만, 어른 아침 알림 설정
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const shots = '/tmp/lf-shots'; fs.mkdirSync(shots, { recursive: true });
const SAMPLE = fs.readFileSync(new URL('../meals-sample.txt', import.meta.url), 'utf8');
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ui12-')) });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
const mk = () => ({ cookie: '', async call(m, u, b) { const r = await fetch(base + u, { method: m, headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie: this.cookie }, body: b && JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; } });
const mom = mk(); await mom.call('POST', '/api/auth/register', { loginId: 'mom@t', password: 'secret1', role: 'mom' });
const me = (await mom.call('GET', '/api/me')).body; const [yuel, yuha] = me.kids.map((k) => k.id);
const { code } = (await mom.call('POST', `/api/kids/${yuel}/pair-code`)).body;

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const errors = [];
const watch = (pg) => { pg.on('pageerror', (e) => errors.push(e.message)); return pg; };
const mp = watch(await (await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 })).newPage());
await mp.goto(base + '/#/login'); await mp.fill('input[name=loginId]', 'mom@t'); await mp.fill('input[name=password]', 'secret1'); await mp.click('button[type=submit]'); await mp.waitForSelector('.kid-card');

// 1) 엄마 폰: 유엘 허브 → 급식 → 식단표 붙여넣기
await mp.goto(`${base}/#/kid/${yuel}`); await mp.click('a:has-text("급식")'); await mp.waitForSelector('.meal-card');
assert.ok((await mp.textContent('.meal-card')).includes('식단이 없어요'));
await mp.click('#paste'); await mp.fill('textarea[name=text]', SAMPLE); await mp.click('form button[type=submit]');
await mp.waitForSelector('.meal-list li'); await mp.waitForTimeout(400);
const first = await mp.$$eval('.meal-list li', (l) => l.map((x) => x.textContent));
assert.equal(first[0], '현미찹쌀밥', '붙여넣은 첫 날(11/2) 첫 메뉴');
console.log('✓ 식단표 붙여넣기 21일');
// 2) 날짜 넘기기(주말은 건너뜀) + 주간 목록 선택
await mp.click('#next'); await mp.waitForTimeout(200);
assert.ok((await mp.textContent('.day-nav h2')).includes('11월 3일'));
await mp.click('.meal-day:has-text("11/6")'); assert.ok((await mp.textContent('.meal-card')).includes('청국장찌개'));
await mp.click('#next'); assert.ok((await mp.textContent('.day-nav h2')).includes('11월 9일'), '금요일 다음은 월요일');
console.log('✓ 날짜 넘기기');
// 3) 하루 고치기
await mp.click('#edit'); await mp.fill('textarea[name=text]', '백미밥\n된장국\n돈가스'); await mp.click('form button[type=submit]');
await mp.waitForFunction(() => document.querySelector('.meal-list li')?.textContent === '백미밥');
console.log('✓ 하루 고치기');
// 4) 아침 알림 설정(엄마)
await mp.waitForSelector('#malert'); assert.equal(await mp.inputValue('#mtime'), '08:00'); assert.ok(await mp.isChecked('#malert'));
await mp.fill('#mtime', '07:40'); await mp.dispatchEvent('#mtime', 'change'); await mp.waitForTimeout(400);
assert.equal((await mom.call('GET', '/api/meals/alert')).body.time, '07:40');
await mp.click('#malert'); await mp.waitForTimeout(300); assert.equal((await mom.call('GET', '/api/meals/alert')).body.enabled, false);
await mp.screenshot({ path: path.join(shots, '90-meals-phone.png') });
console.log('✓ 아침 알림 설정');
// 5) 유엘 폰: 보기만(추가·고치기 버튼 없음, 알림 설정 없음), 유하 식단은 따로
const kp = watch(await (await browser.newContext({ ...devices['Galaxy S9+'] })).newPage());
await kp.goto(base + '/#/pair'); await kp.fill('input', code); await kp.click('button[type=submit]'); await kp.waitForSelector('.tab');
await kp.goto(`${base}/#/kid/${yuel}/meals`); await kp.waitForSelector('.meal-card');
assert.equal((await kp.$$('#paste, #edit, #malert')).length, 0, '아이 폰은 보기만');
await mp.goto(`${base}/#/kid/${yuha}/meals`); await mp.waitForSelector('.meal-card');
assert.ok((await mp.textContent('.meal-card')).includes('식단이 없어요'), '유하는 학교가 달라 따로');
await kp.screenshot({ path: path.join(shots, '91-meals-kid.png') });
console.log('✓ 아이 폰은 보기만 · 아이별로 따로');

await browser.close(); await app.close();
assert.deepEqual(errors, [], '브라우저 오류: ' + errors.join(' | '));
console.log('UI E2E 12 통과 · 스크린샷:', shots);
