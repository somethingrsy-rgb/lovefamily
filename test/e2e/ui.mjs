// 브라우저 E2E (Playwright/Chromium): npm run test:ui
// 거실 iPad(가로, 공용 기기 모드)와 아빠 iPhone(세로)이 동시에 접속해 주요 동선·실시간 반영을 확인한다.
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ui-'));
const app = createApp({ dataDir, pushSender: null });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;

// 시드(개발용 샘플)
class C { cookie = ''; async call(m, u, b) { const r = await fetch(base + u, { method: m, headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie: this.cookie }, body: b === undefined ? undefined : JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; const j = await r.json().catch(() => ({})); if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${JSON.stringify(j)}`); return j; } }
const mom = new C(); const dad = new C();
await mom.call('POST', '/api/auth/register', { loginId: 'mom@t', password: 'secret1', role: 'mom', familyName: '샘플네' });
const me = await mom.call('GET', '/api/me');
await dad.call('POST', '/api/auth/join', { code: me.family.code, loginId: 'dad@t', password: 'secret2', role: 'dad' });
const [yuel, yuha] = me.kids.map((k) => k.id);
for (const [n, i, s, d, k] of [['양치하기', '🪥', 'morning', 'daily', [yuel, yuha]], ['책가방 싸기', '🎒', 'morning', 'daily', [yuel, yuha]], ['숙제하기', '📚', 'after_school', 'daily', [yuel]]]) await mom.call('POST', '/api/routines', { kidIds: k, name: n, icon: i, slot: s, days: d });
await mom.call('POST', `/api/kids/${yuel}/opening-balance`, { amount: 12000 });
await mom.call('PUT', '/api/status', { state: 'working' });
await mom.call('POST', '/api/notes', { text: '오늘 저녁은 카레예요 🍛' });
await mom.call('POST', '/api/posts', { title: '현장학습 안내', body: '도시락을 챙겨 주세요', kidId: yuel, dueDate: new Date().toISOString().slice(0, 10), supplies: '도시락, 물통', pinned: true });

const browser = await chromium.launch();
const errors = [];
const watch = (page, tag) => { page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`)); page.on('console', (m) => { if (m.type() === 'error' && !/status of 401/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); }); };
const login = async (page, id, pw, device) => {
  await page.goto(base + '/#/login');
  await page.fill('input[name=loginId]', id); await page.fill('input[name=password]', pw);
  if (device) await page.check('input[name=device]');
  await page.click('button[type=submit]');
  await page.waitForSelector('.tabs');
};

// 거실 iPad (가로)
const ipadCtx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const ipad = await ipadCtx.newPage(); watch(ipad, 'iPad');
await login(ipad, 'mom@t', 'secret1', true);
await ipad.waitForSelector('.kid-card');
await ipad.screenshot({ path: path.join(shots, '01-ipad-home-landscape.png') });

// 아빠 iPhone (세로)
const phoneCtx = await browser.newContext({ ...devices['iPhone 14'] });
const phone = await phoneCtx.newPage(); watch(phone, 'iPhone');
await login(phone, 'dad@t', 'secret2', false);
await phone.waitForSelector('.kid-card');
await phone.screenshot({ path: path.join(shots, '02-phone-home-adult.png'), fullPage: true });

// 유엘이 iPad 에서 루틴 체크
await ipad.click('.kid-card:has-text("유엘") .kid-main');
await ipad.waitForSelector('.kid-hub');
await ipad.screenshot({ path: path.join(shots, '03-ipad-kid-hub.png') });
await ipad.click('text=오늘 할일');
await ipad.waitForSelector('.check-item');
for (const t of ['양치하기', '책가방 싸기']) { await ipad.click(`.check-item:has-text("${t}")`); await ipad.waitForTimeout(250); }
await ipad.screenshot({ path: path.join(shots, '04-ipad-today-partial.png') });
await ipad.click('.check-item:has-text("숙제하기")');
// 다 해도 어른에게 바로 알리지 않는다: [도장 요청하기]를 눌러야 요청이 간다
await ipad.waitForSelector('#rereq', { timeout: 5000 });
await phone.waitForTimeout(1200);
assert.equal(await phone.$$eval('.popup', (e) => e.length), 0, '요청 전에는 어른 폰에 팝업이 없다');
await ipad.click('#rereq');
await ipad.waitForSelector('.banner.wait', { timeout: 5000 });
// 실시간: 아빠 폰에 요청 팝업/대기 목록이 뜬다 (재접속 없이)
await phone.waitForSelector('.popup', { timeout: 8000 });
await phone.screenshot({ path: path.join(shots, '05-phone-popup.png') });
await phone.click('.popup [data-a=open]');
await phone.waitForSelector('#ok');
assert.match(await phone.textContent('.approve'), /유엘/);
await phone.screenshot({ path: path.join(shots, '06-phone-approve.png'), fullPage: true });
await phone.click('#ok');
await phone.waitForFunction(() => /이미 도장을 줬어요|도장을 줬어요/.test(document.body.innerText));
// iPad 쪽 도장 애니메이션 + 상태가 실시간으로 반영
await ipad.waitForSelector('.stamp-overlay', { timeout: 8000 });
await ipad.screenshot({ path: path.join(shots, '07-ipad-stamp-anim.png') });
await ipad.waitForSelector('.banner.ok', { timeout: 8000 });

// 홈에서 도장 받은 상태
await ipad.goto(base + '/#/'); await ipad.waitForSelector('.kid-card');
await ipad.waitForFunction(() => /도장 받았어요/.test(document.querySelector('.kids').innerText));
await ipad.screenshot({ path: path.join(shots, '08-ipad-home-stamped.png') });

// 저금통(아이 화면): 어른 재인증 없이 보인다
await ipad.click('.kid-card:has-text("유엘") .kid-main'); await ipad.click('text=돼지 저금통');
await ipad.waitForSelector('.piggy-hero');
await ipad.waitForFunction(() => /12,000원/.test(document.querySelector('#total')?.innerText || ''), null, { timeout: 8000 }); // 숫자가 올라가는 중일 수 있다
await ipad.screenshot({ path: path.join(shots, '09-ipad-wallet.png'), fullPage: true });
// 출금 요청(그림 버튼 + 직접 입력)
await ipad.click('#wd');
await ipad.click('.money-btn[data-add="1000"]'); await ipad.click('.money-btn[data-add="500"]');
assert.match(await ipad.textContent('.amount-text'), /1,500원/);
await ipad.screenshot({ path: path.join(shots, '10-ipad-withdraw-sheet.png') });
await ipad.fill('input[name=purpose]', '문구점');
await ipad.click('.adult-pick .adult-opt:has-text("아빠")');
await ipad.click('.sheet button[type=submit]');
await ipad.waitForSelector('.reqs');
// 아빠 휴대폰: 요청 팝업 → 승인 → 지급 완료
await phone.waitForSelector('.popup', { timeout: 8000 });
await phone.click('.popup [data-a=open]');
await phone.waitForSelector('[data-a=approve]');
await phone.click('[data-a=approve]');
await phone.waitForSelector('[data-a=pay]');
await ipad.waitForFunction(() => /줄게요/.test(document.body.innerText), null, { timeout: 8000 });
await phone.click('[data-a=pay]'); await phone.click('.sheet [data-yes]');
await ipad.waitForSelector('.coin-overlay', { timeout: 8000 });
await ipad.screenshot({ path: path.join(shots, '11-ipad-coins-out.png') });
await ipad.waitForFunction(() => /10,500원/.test(document.querySelector('#total')?.innerText || ''), null, { timeout: 8000 });

// 가족에게 말하기 → 아빠에게만 팝업
await ipad.click('a.back'); await ipad.click('text=가족에게 말하기');
await ipad.click('[data-to]:has-text("아빠")');
await ipad.click('[data-p="사랑해요 💕"]');
await phone.waitForSelector('.popup:has-text("유엘")', { timeout: 8000 });
await phone.screenshot({ path: path.join(shots, '12-phone-message-popup.png') });

// 공용 기기에서 어른 메뉴: 재인증 필요
await ipad.goto(base + '/#/'); await ipad.waitForSelector('#adultMenu');
await ipad.click('#adultMenu');
await ipad.waitForSelector('.sheet:has-text("어른 확인")');
await ipad.screenshot({ path: path.join(shots, '13-ipad-reauth.png') });
await ipad.fill('input[name=pw]', 'wrongpw1'); await ipad.click('.sheet button[type=submit]');
await ipad.waitForSelector('.form-err:not([hidden])');
await ipad.fill('input[name=pw]', 'secret1'); await ipad.click('.sheet button[type=submit]');
await ipad.waitForSelector('.adult-panel');
// 루틴 관리 / 도장판 / 가족 / 알림장 / 달력 화면
for (const [href, sel, name] of [['#/routines', '.rlist', '14-ipad-routines'], ['#/stamps', '.stamp-grid', '15-ipad-stamps'], ['#/family', '.members', '16-ipad-family'], ['#/notebook', '.post', '17-ipad-notebook'], ['#/calendar', '.cal', '18-ipad-calendar']]) {
  await ipad.goto(base + '/' + href); await ipad.waitForSelector(sel, { timeout: 8000 });
  await ipad.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
}
// 야간 테마
await ipad.goto(base + '/#/family'); await ipad.waitForSelector('details.fold[data-fold=screen] > summary'); await ipad.click('details.fold[data-fold=screen] > summary'); await ipad.waitForSelector('input[name=theme]');
await ipad.click('.seg-opt:has(input[value=dark])'); await ipad.goto(base + '/#/'); await ipad.waitForSelector('.kid-card');
assert.equal(await ipad.evaluate(() => document.documentElement.dataset.theme), 'dark');
await ipad.screenshot({ path: path.join(shots, '19-ipad-home-dark.png') });

// 휴대폰 화면들
for (const [href, sel, name] of [['#/kid/' + yuel, '.kid-hub', '20-phone-kid-hub'], ['#/kid/' + yuel + '/wallet', '.piggy-hero', '21-phone-wallet'], ['#/kid/' + yuel + '/wishes', '.empty, .goal', '22-phone-wishes'], ['#/stamps', '.stamp-grid', '23-phone-stamps'], ['#/routines', '.rlist', '24-phone-routines']]) {
  await phone.goto(base + '/' + href); await phone.waitForSelector(sel, { timeout: 8000 });
  await phone.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, `${href} 가로 스크롤 발생`);
}

await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 통과 · 스크린샷:', shots);
