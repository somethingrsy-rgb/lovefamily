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
assert.equal(await page.$$eval('.tab', (e) => e.length), 5, '탭: 우리집 · 내 화면 · 도장판 · 통장 · 내 설정');
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
// 예전에 저장해 둔 잔액이 있어도, 저금통 화면을 열 때 지난 입금·출금 모션이 엉뚱하게 다시 나오지 않는다
await page.click('.sheet [data-close]').catch(() => {}); await page.waitForTimeout(400);
await page.evaluate((id) => localStorage.setItem(`bal:${id}`, '1'), yuel);
await page.goto(base + '/#/'); await page.waitForSelector('.house'); await page.goto(base + `/#/kid/${yuel}/wallet`); await page.waitForSelector('#wd'); await page.waitForTimeout(1200);
assert.equal(await page.$$eval('.coin-overlay', (e) => e.length), 0, '화면을 열기만 했는데 모션이 나오면 안 된다');
console.log('✓ 저금통 화면을 열 때 옛날 모션이 다시 나오지 않음');
// 아이가 500원을 두 번 누르면 저금통에도 500원 2개가 들어간다(천원 한 장이 아니라)
await page.click('.sheet [data-close]').catch(() => {}); await page.waitForTimeout(400);
await page.goto(base + `/#/kid/${yuel}/wallet`); await page.waitForSelector('#dep'); await page.click('#dep'); await page.waitForSelector('[data-add="500"]');
await page.click('[data-add="500"]'); await page.click('[data-add="500"]');
assert.equal((await page.textContent('[data-add="500"] .mcount')).trim(), '×2', '누른 횟수가 표시된다');
await page.click('[data-reason="용돈"]'); await page.click('.sheet button.primary[type=submit], .sheet .btn.primary:has-text("알리기")');
await page.waitForFunction(async (id) => (await (await fetch(`/api/kids/${id}/requests`)).json()).some((r) => r.status === 'pending' && r.type === 'deposit'), yuel, { timeout: 6000 });
const rq = (await call('GET', `/api/kids/${yuel}/requests`)).find((r) => r.status === 'pending' && r.type === 'deposit');
await call('POST', `/api/money/requests/${rq.id}/confirm`);
await page.waitForSelector('.coin-overlay .coin', { timeout: 6000 });
assert.deepEqual(await page.$$eval('.coin-overlay .coin', (e) => e.map((x) => x.getAttribute('src').split('/').pop())), ['c500.webp', 'c500.webp'], '500원 동전 2개가 들어간다');
console.log('✓ 아이가 누른 그대로(500원 2개) 저금통에 들어감');
await page.waitForSelector('.coin-overlay', { state: 'detached', timeout: 8000 });
// 돈 꺼내기: 100원 3번 → 지급되면 100원 3개가 저금통에서 나온다
await page.goto(base + `/#/kid/${yuel}/wallet`); await page.waitForSelector('#wd'); await page.click('#wd'); await page.waitForSelector('[data-add="100"]');
await page.click('[data-add="100"]'); await page.click('[data-add="100"]'); await page.click('[data-add="100"]');
await page.click('[data-reason="문구점"]'); await page.click('.sheet .btn.primary:has-text("요청 보내기")');
await page.waitForFunction(async (id) => (await (await fetch(`/api/kids/${id}/requests`)).json()).some((r) => r.status === 'pending' && r.type === 'withdraw'), yuel, { timeout: 6000 });
const wr = (await call('GET', `/api/kids/${yuel}/requests`)).find((r) => r.status === 'pending' && r.type === 'withdraw');
await call('POST', `/api/money/requests/${wr.id}/approve`); await call('POST', `/api/money/requests/${wr.id}/pay`);
await page.waitForSelector('.coin-overlay .coin.out', { timeout: 6000 });
assert.deepEqual(await page.$$eval('.coin-overlay .coin.out', (e) => e.map((x) => x.getAttribute('src').split('/').pop())), ['c100.webp', 'c100.webp', 'c100.webp']);
assert.match(await page.textContent('.coin-overlay .anim-text'), /저금통에서 쏙/);
console.log('✓ 돈 꺼내기: 누른 그대로(100원 3개) 저금통에서 나옴');
// 승인·완료 소식 팝업은 [열기]가 아니라 [확인]
await page.waitForSelector('.popup:has-text("받았어요")', { timeout: 6000 });
assert.equal((await page.textContent('.popup:has-text("받았어요") [data-a=open]')).trim(), '확인', '결과 소식 팝업 버튼은 확인');
await page.click('.popup:has-text("받았어요") [data-a=open]');
assert.ok(page.url().includes('/wallet'), '확인을 눌러도 화면이 바뀌지 않는다(닫기만)');
await page.waitForSelector('.coin-overlay', { state: 'detached', timeout: 8000 });
// 어른은 저금통 기록을 지울 수 있다(아이 폰에는 지우기 버튼이 없다)
assert.equal(await page.$$eval('[data-delled]', (e) => e.length), 0, '아이 폰에는 지우기 버튼이 없다');
{
  const ap = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  ap.on('pageerror', (e) => errors.push(e.message));
  await ap.goto(base + '/#/login'); await ap.fill('input[name=loginId]', 'mom@t'); await ap.fill('input[name=password]', 'secret1'); await ap.click('button[type=submit]'); await ap.waitForSelector('.walker');
  await ap.goto(base + `/#/kid/${yuel}/wallet`); await ap.waitForSelector('[data-delled]');
  const before = await ap.$$eval('[data-delled]', (e) => e.length);
  assert.equal(before, 5, '입금·출금 5건 모두 지우기 버튼이 있다');
  await ap.screenshot({ path: path.join(shots, '85-ledger-delete.png') });
  await ap.click('[data-delled] >> nth=0'); await ap.click('[data-yes]');
  await ap.waitForFunction((n) => document.querySelectorAll('[data-delled]').length === n - 1, before, { timeout: 5000 });
  await ap.click('#clearmonth'); await ap.click('[data-yes]');
  await ap.waitForFunction(() => document.querySelectorAll('[data-delled]').length === 0, null, { timeout: 5000 });
  console.log('✓ 어른: 기록 하나 지우기 · 이 달 모두 지우기');
  await ap.close();
}
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 6 통과 · 스크린샷:', shots);
