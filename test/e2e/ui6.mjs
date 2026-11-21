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
// 용돈이 들어오면 어느 화면에 있든(여기서는 우리집 화면) 저금통에 쏙 모션이 보인다(그 아이 폰)
await page.click('.tab[data-tab=home]'); await page.waitForSelector('.house');
await call('POST', `/api/kids/${yuel}/deposits`, { amount: 3000, memo: '용돈' });
await page.waitForSelector('.coin-overlay', { timeout: 6000 });
assert.match(await page.textContent('.coin-overlay .anim-text'), /저금통에 쏙.*3,000원/, '자기 폰에는 금액도 보인다');
await page.screenshot({ path: path.join(shots, '81-kidphone-coins.png') });
await page.waitForFunction(() => { const el = document.querySelector('.piggy-anim.in .piggy-pic'); return el && getComputedStyle(el).animationName === 'piggyhop'; }, null, { timeout: 3000 });
await page.waitForTimeout(700); // 동전이 다 들어간 뒤 돼지가 폴짝 뛰는 중
await page.screenshot({ path: path.join(shots, '82-piggy-hop.png') });
assert.ok(await page.$('.piggy-anim .piggy-heart'), '하트가 올라온다');
console.log('✓ 저금한 뒤 돼지가 폴짝(하트 포함)');
console.log('✓ 용돈을 받으면 아이 폰 어느 화면에서든 저금통에 쏙 모션');
// 모션에는 넣은 금액만큼만: 3,000원 = 천원 3장
assert.equal(await page.$$eval('.coin-overlay .coin', (e) => e.length), 3, '3,000원은 천원 지폐 3장만 떨어진다');
assert.equal(await page.$$eval('.coin-overlay .coin.bill', (e) => e.length), 3);
await page.waitForSelector('.coin-overlay', { state: 'detached', timeout: 8000 });
await call('POST', `/api/kids/${yuel}/deposits`, { amount: 3700, memo: '용돈' });
await page.waitForSelector('.coin-overlay .coin', { timeout: 6000 });
assert.deepEqual(await page.$$eval('.coin-overlay .coin', (e) => e.map((x) => x.getAttribute('src').split('/').pop())), ['b1000.webp', 'b1000.webp', 'b1000.webp', 'c500.webp', 'c100.webp', 'c100.webp'], '3,700원 = 천원×3 + 오백원 + 백원×2');
await page.waitForSelector('.coin-overlay', { state: 'detached', timeout: 8000 });
await call('POST', `/api/kids/${yuel}/deposits`, { amount: 500, memo: '용돈' });
await page.waitForSelector('.coin-overlay .coin', { timeout: 6000 });
assert.equal(await page.$$eval('.coin-overlay .coin', (e) => e.length), 1, '500원은 오백원 동전 1개만');
console.log('✓ 저금통 모션은 넣은 금액만큼만(3,000원 = 지폐 3장, 500원 = 동전 1개)');
await page.waitForSelector('.coin-overlay', { state: 'detached', timeout: 8000 });
// 말하기: 엄마·아빠 얼굴 그림, 입금 이유는 버튼으로
await page.goto(base + `/#/kid/${yuel}/talk`); await page.waitForSelector('.big-btn[data-to]');
assert.ok(await page.$('.big-btn[data-to] .avatar img'), '엄마·아빠가 이모지 글자가 아니라 얼굴 그림이다');
await page.goto(base + `/#/kid/${yuel}/wallet`); await page.waitForSelector('#dep');
await page.click('#dep'); await page.waitForSelector('[data-reason]');
assert.deepEqual(await page.$$eval('[data-reason]', (e) => e.map((x) => x.dataset.reason)), ['용돈', '도장 30개', '문제집 1권', '세뱃돈']);
await page.click('[data-reason="문제집 1권"]');
assert.equal(await page.inputValue('input[name=purpose]'), '문제집 1권', '버튼을 누르면 이유가 채워진다');
await page.screenshot({ path: path.join(shots, '83-reason-chips.png') });
await page.click('[data-close]'); await page.goto(base + `/#/kid/${yuel}/talk`); await page.waitForSelector('.big-btn[data-to]'); await page.screenshot({ path: path.join(shots, '84-talk-avatars.png') });
await page.goto(base + `/#/kid/${yuel}/wallet`); await page.waitForSelector('#wd'); await page.click('#wd'); await page.waitForSelector('[data-reason="슈퍼"]');
assert.deepEqual(await page.$$eval('[data-reason]', (e) => e.map((x) => x.dataset.reason)), ['문구점', '슈퍼', '친구랑 간식']);
await page.click('[data-reason="친구랑 간식"]');
assert.equal(await page.inputValue('input[name=purpose]'), '친구랑 간식', '쓸 곳도 버튼으로 고른다');
console.log('✓ 돈 꺼내기: 어디에 쓸지 버튼으로 선택');
console.log('✓ 엄마·아빠 얼굴 그림, 입금 이유 버튼');
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 6 통과 · 스크린샷:', shots);
