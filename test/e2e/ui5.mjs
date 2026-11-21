// 브라우저 E2E 5: 활동 시간은 하루 총 시간 — 일시 중단하면 남은 시간이 보이고, 이어서 하기/그만하기 후 오늘 남은 시간이 카드에 표시된다
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
assert.ok(await page.$('#start:not([disabled])'), '한 번 누르면 고르기만 한다');
assert.equal(await page.$('#pause'), null, '한 번 누른 것만으로는 시작되지 않는다');
await page.waitForTimeout(600);
await page.dblclick('.act-card:has-text("게임하기")'); // 두 번 누르면 바로 시작
await page.waitForSelector('#pause');
console.log('✓ 활동을 두 번 누르면 바로 시작');
// 진행 중 화면: [일시 중단]·[다른 활동 시작]·[그만하기]가 스크롤 없이 한 화면에(휴대폰 크기), '지금' 그림 카드는 없다
{
  const ph = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
  await ph.goto(base + '/#/login');
  await ph.fill('input[name=loginId]', 'mom@t'); await ph.fill('input[name=password]', 'secret1'); await ph.check('input[name=device]');
  await ph.click('button[type=submit]'); await ph.waitForSelector('.walker');
  await ph.goto(base + `/#/kid/${kid}/timer`); await ph.waitForSelector('#pause');
  assert.equal(await ph.$$eval('.now-next', (e) => e.length), 0, "'지금' 그림 카드는 없다");
  const fit = await ph.evaluate(() => { const tabs = document.querySelector('.tabs').getBoundingClientRect().top; return ['#pause', '#stop', '#new'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { s, bottom: Math.round(r.bottom), tabs: Math.round(tabs) }; }); });
  const order = await ph.$$eval('.timer-big .row button', (e) => e.map((x) => x.id)); assert.deepEqual(order, ['pause', 'stop', 'new'], '버튼 순서: 일시 중단 → 그만하기 → 다른 활동 시작');
  for (const b of fit) assert.ok(b.bottom <= b.tabs, `${b.s} 버튼이 스크롤 없이 보여야 한다: ${JSON.stringify(fit)}`);
  await ph.screenshot({ path: path.join(shots, '72-timer-phone.png') });
  await ph.close();
  console.log('✓ 진행 중 화면의 버튼이 스크롤 없이 한 화면에');
}
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

// 대화 화면이 끝없이 다시 그려지지 않는다(읽음 요청이 반복되지 않음)
{
  await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: 'mom@t', password: 'secret1' }) }).then(async (r) => {
    const ck = r.headers.get('set-cookie').split(';')[0];
    const me = await (await fetch(base + '/api/me', { headers: { cookie: ck } })).json();
    const dv = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: 'mom@t', password: 'secret1', device: true }) });
    const dck = dv.headers.get('set-cookie').split(';')[0];
    await fetch(base + '/api/messages', { method: 'POST', headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie: dck, 'X-Act-Kid': String(kid) }, body: JSON.stringify({ kidId: kid, adultId: me.me.id, body: '배고파요' }) });
    const ap = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
    let reads = 0; ap.on('request', (q) => { if (q.url().includes('/read')) reads++; });
    await ap.goto(base + '/#/login'); await ap.fill('input[name=loginId]', 'mom@t'); await ap.fill('input[name=password]', 'secret1'); await ap.click('button[type=submit]'); await ap.waitForSelector('.walker');
    await ap.goto(base + `/#/messages/${kid}/${me.me.id}`); await ap.waitForSelector('.bubbles li.other');
    await ap.fill('.chat-form input', '쓰는 중인 글'); // 입력 중인 글은 화면이 갱신돼도 남아 있어야 한다
    await ap.waitForTimeout(3500);
    assert.ok(reads <= 2, `읽음 요청이 반복되면 안 된다(3.5초 동안 ${reads}번)`);
    assert.equal(await ap.inputValue('.chat-form input'), '쓰는 중인 글', '입력 중인 글이 유지된다');
    await ap.close();
  });
  console.log('✓ 대화 화면: 읽음 요청이 반복되지 않고, 입력 중인 글이 유지됨');
}
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 5 통과 · 스크린샷:', shots);
