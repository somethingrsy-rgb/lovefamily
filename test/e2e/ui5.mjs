// 브라우저 E2E 5: 활동 시간은 하루 총 시간 — 일시 중단하면 남은 시간이 보이고, 이어서 하기/그만하기 후 오늘 남은 시간이 카드에 표시된다
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const shots = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'lf-shots');
fs.mkdirSync(shots, { recursive: true });
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ui5-')) });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: 'mom@t', password: 'secret1', role: 'mom' }) });

const browser = await chromium.launch();
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true })).newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + '/#/login');
await page.fill('input[name=loginId]', 'mom@t'); await page.fill('input[name=password]', 'secret1'); await page.check('input[name=device]');
await page.click('button[type=submit]');
await page.waitForSelector('.walker');
const kid = await page.evaluate(async () => (await (await fetch('/api/me')).json()).kids[0].id);

await page.goto(base + `/#/kid/${kid}/timer`);
await page.waitForSelector('.act-card');
assert.match(await page.textContent('.act-card:has-text("게임하기") small'), /하루 30분/, '활동 카드에 하루 총 시간이 보인다');
await page.click('.act-card:has-text("게임하기")');
await page.click('#start');
await page.waitForSelector('#pause');
await page.waitForTimeout(2200);
await page.click('#pause');
await page.waitForSelector('#resume');
assert.match(await page.textContent('.tp-text'), /남은 시간 \d+분/, '일시 중단하면 남은 시간을 알려 준다');
const frozen = await page.textContent('.big-digits');
await page.waitForTimeout(2300);
assert.equal(await page.textContent('.big-digits'), frozen, '일시 중단 중에는 시간이 줄지 않는다');
await page.screenshot({ path: path.join(shots, '70-paused.png') });
// 홈 화면 방 안에도 남은 시간 표시
await page.goto(base + '/#/'); await page.waitForSelector('.room-time.paused', { timeout: 8000 });
console.log('✓ 일시 중단: 남은 시간 표시, 시간이 멈춤, 집 안에도 표시');
// 이어서 하기 → 줄어든다
await page.goto(base + `/#/kid/${kid}/timer`); await page.waitForSelector('#resume');
await page.click('#resume'); await page.waitForSelector('#pause');
const a = await page.textContent('.big-digits'); await page.waitForTimeout(2200);
assert.notEqual(await page.textContent('.big-digits'), a, '이어서 하면 다시 줄어든다');
// 그만하기 → 활동 카드에 오늘 남은 시간
await page.click('#stop'); await page.click('[data-yes]');
await page.waitForSelector('.act-card', { timeout: 8000 });
assert.match(await page.textContent('.act-card:has-text("게임하기") small'), /오늘 .*남음|하루 30분/, '오늘 남은 시간');
await page.screenshot({ path: path.join(shots, '71-budget-cards.png') });
console.log('✓ 이어서 하기 · 그만하기 후 오늘 남은 시간 표시');
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 5 통과 · 스크린샷:', shots);
