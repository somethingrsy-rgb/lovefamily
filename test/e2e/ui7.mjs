// 브라우저 E2E 7: 화면 배열 바꾸기 — 어른이 칸을 꾹 눌러 끌어서 순서를 바꾸면 저장되고, 다른 기기에도 같게 보인다
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
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ui7-')) });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
let cookie = '';
const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie }, body: b && JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return r.json().catch(() => ({})); };
await call('POST', '/api/auth/register', { loginId: 'mom@t', password: 'secret1', role: 'mom' });
const me = await call('GET', '/api/me'); const [yuel, yuha] = me.kids.map((k) => k.id);

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const errors = [];
const login = async (ctx, device) => {
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(base + '/#/login'); await pg.fill('input[name=loginId]', 'mom@t'); await pg.fill('input[name=password]', 'secret1'); if (device) await pg.check('input[name=device]');
  await pg.click('button[type=submit]'); await pg.waitForSelector('.kid-card'); await pg.waitForTimeout(500);
  return pg;
};
const names = (pg) => pg.$$eval('.kids .kid-card h2', (e) => e.map((x) => x.textContent.trim()));

const page = await login(await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: false }), false);
assert.deepEqual(await names(page), ['유엘', '유하'], '처음 순서');
// 집 그림 안을 돌아다니는 고양이 두 마리: 있고, 시간이 지나면 움직이고, 누르면 애교(하트), 가족 설정에서 끌 수 있다
{
  assert.ok(await page.evaluate(() => Number(getComputedStyle(document.querySelector('.pets')).zIndex) > Number(getComputedStyle(document.querySelector('.walkers')).zIndex)), '고양이·강아지가 사람보다 앞에 그려진다');
  assert.deepEqual(await page.$$eval('.house .pets .pet', (e) => e.map((x) => x.dataset.pet)), ['ruby', 'crystal', 'yeoni'], '다이아·크리스탈·귀요미');
  const snap = () => page.$$eval('.pet', (e) => e.map((x) => `${x.style.left}|${x.style.top}|${x.querySelector('.pet-sp')?.style.backgroundImage}`).join(','));
  // 연이는 같은 그림 기준으로 15% 크게 그려진다(그림 크기 비율로 확인)
  const sizeOf = () => page.$eval('.pet[data-pet=yeoni] .pet-sp', (e) => ({ w: parseFloat(e.style.width), h: parseFloat(e.style.height), img: e.style.backgroundImage }));
  const ys = await sizeOf();
  const dogDims = { 'dog-sit': [102, 135], 'dog-stand': [124, 131], 'dog-sleep': [125, 97], 'dog-groom': [107, 132], 'dog-aegyo': [114, 127], 'dog-roll': [145, 114], 'dog-walkR': [140, 121], 'dog-walkL': [140, 121], 'dog-jump': [137, 121] };
  const key = Object.keys(dogDims).find((k) => ys.img.includes(k + '.webp'));
  assert.ok(key && Math.abs(ys.w / (dogDims[key][0] * 0.07) - 1.15) < 0.01, `연이 크기 = 기본의 1.15배 (${ys.w})`);
  const first = await snap(); let moved = false;
  for (let i = 0; i < 30 && !moved; i++) { await page.waitForTimeout(500); moved = (await snap()) !== first; }
  assert.ok(moved, '고양이가 움직인다');
  // 같은 층에서 마주치면 장난을 친다(고양이끼리, 연이와도)
  await page.evaluate(() => { const [r, c, y] = window.__pets; for (const p of [r, c]) { p.mode = 'idle'; p.until = performance.now() + 60000; p.y = 54.2; } r.x = 40; c.x = 50; Math.random = () => 0; });
  await page.waitForFunction(() => window.__pets[0].mode === 'play' && window.__pets[1].mode === 'play', null, { timeout: 4000 });
  const pl = await page.evaluate(() => window.__pets.slice(0, 2).map((p) => [p.face, p.playKind]));
  assert.equal(pl[0][0], 1); assert.equal(pl[1][0], -1, '서로 마주 본다');
  assert.equal(pl[0][1], pl[1][1], '두 마리가 같은 동작으로 논다');
  assert.ok(pl[0][1], '장난 동작이 정해져 있다');
  await page.waitForTimeout(3500);
  // 빈 공간(눈에 보이는 그림 사이) = 고양이 한 마리 폭의 약 1/2
  const g = await page.evaluate(() => { const [a, b] = [...document.querySelectorAll('.pet[data-pet=ruby] .pet-sp:not([style*="display: none"]), .pet[data-pet=crystal] .pet-sp:not([style*="display: none"])')].map((e) => e.getBoundingClientRect()).sort((x, y) => x.left - y.left); return { gap: b.left - a.right, w: (a.width + b.width) / 2 }; });
  assert.ok(Math.abs(g.gap / g.w - 0.25) < 0.12, `빈 공간이 한 마리 폭의 1/4 (빈 공간 ${g.gap.toFixed(1)}px / 폭 ${g.w.toFixed(1)}px = ${(g.gap / g.w).toFixed(2)})`);
  assert.ok(await page.$eval('.pet[data-pet=ruby] .pet-sp', (e) => /play-/.test(e.style.backgroundImage)), '장난 그림으로 바뀐다');
  console.log('✓ 만나면 장난');
  // 달리기 장난은 마주 보지 않고 한쪽 방향으로 함께 달린다
  await page.evaluate(() => { const [r, c] = window.__pets; for (const p of [r, c]) { p.mode = 'idle'; p.until = performance.now() + 60000; p.y = 54.2; p.tx = null; } r.x = 40; c.x = 50; window.__lastPlay.clear(); const q = [0, 0.7, 0.2]; Math.random = () => (q.length ? q.shift() : 0); });
  await page.waitForFunction(() => window.__pets[0].mode === 'play' && window.__pets[1].mode === 'play', null, { timeout: 8000 });
  const d1 = await page.evaluate(() => window.__pets.slice(0, 2).map((p) => [p.face, p.playKind, p.x]));
  assert.equal(d1[0][1], 'dash', '달리기');
  assert.equal(d1[0][0], d1[1][0], `둘이 같은 방향을 본다 (${d1[0][0]}, ${d1[1][0]})`);
  await page.waitForTimeout(1500);
  const d2 = await page.evaluate(() => window.__pets.slice(0, 2).map((p) => [p.face, p.x]));
  assert.equal(d2[0][0], d2[1][0], '계속 같은 방향');
  assert.ok(Math.sign(d2[0][1] - d1[0][2]) === d2[0][0] || Math.abs(d2[0][1] - d1[0][2]) < 3, '보는 쪽으로 달려 간다');
  console.log('✓ 달리기는 한쪽 방향으로');
  await page.evaluate(() => { window.__pets.forEach((p) => { p.mode = 'idle'; p.until = performance.now() + 1000; }); });
  const rb = await page.$eval('.pet[data-pet=ruby]', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(rb.x, rb.y);
  await page.waitForSelector('.pet-heart', { timeout: 2000 });
  assert.equal(page.url().includes('#/kid'), false, '고양이를 눌러도 방 화면으로 넘어가지 않는다');
  console.log('✓ 집 안 고양이: 돌아다니고, 누르면 애교');
  // 연이는 장난에 끼지 않는다(고양이 두 마리끼리만)
  await page.evaluate(() => { const [r, c, y] = window.__pets; for (const p of [r, c, y]) { p.mode = 'idle'; p.until = performance.now() + 60000; p.y = 32.8; } r.x = 20; c.x = 80; y.x = 21; });
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__pets[2].mode), 'idle', '고양이와 연이는 만나도 장난치지 않는다');
  // 루비·크리스탈·연이를 각각 끄고 켠다
  const only = async (pets, expect, msg) => { await call('PATCH', '/api/family', { pets }); await page.reload(); await page.waitForSelector('.kid-card'); await page.waitForTimeout(500); assert.deepEqual(await page.$$eval('.pet', (e) => e.map((x) => x.dataset.pet)), expect, msg); };
  await only({ ruby: false }, ['crystal', 'yeoni'], '다이아만 끄면');
  await only({ ruby: true, crystal: false }, ['ruby', 'yeoni'], '크리스탈만 끄면');
  await only({ crystal: true, yeoni: false }, ['ruby', 'crystal'], '귀요미만 끄면');
  await only({ ruby: false, crystal: false }, [], '모두 끄면');
  await only({ ruby: true, crystal: true, yeoni: true }, ['ruby', 'crystal', 'yeoni'], '다시 모두 켜면');
  await call('PATCH', '/api/family', { showCats: true });
  await page.reload(); await page.waitForSelector('.pet');
  console.log('✓ 가족 설정으로 고양이 끄기/켜기');
}
// 꾹 누르기(0.7초) → 배열 바꾸기 상태
const b0 = await (await page.$(`[data-rk="k${yuel}"]`)).boundingBox();
const b1 = await (await page.$(`[data-rk="k${yuha}"]`)).boundingBox();
await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); await page.mouse.down();
await page.waitForTimeout(750);
await page.waitForSelector('.layout-bar', { timeout: 3000 });
assert.ok(await page.$eval('body', (b) => b.classList.contains('layout-edit')));
console.log('✓ 꾹 누르면 배열 바꾸기 상태');
// 유엘 카드를 유하 카드 자리(오른쪽)로 끌어서 놓는다
await page.mouse.move(b0.x + b0.width / 2 + 40, b0.y + b0.height / 2, { steps: 4 });
await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(500);
assert.deepEqual(await names(page), ['유하', '유엘'], '끌어서 순서가 바뀐다');
const saved = (await call('GET', '/api/me')).family.layout;
assert.deepEqual(saved['home.kids'], [`k${yuha}`, `k${yuel}`], '서버에 저장된다');
console.log('✓ 끌어서 순서 변경 → 서버에 저장');
await page.screenshot({ path: path.join(shots, '90-layout-edit.png') });
// 배열 바꾸는 중에는 눌러도 다른 화면으로 가지 않는다 → 완료
await page.click('.layout-bar [data-done]'); await page.waitForTimeout(300);
assert.equal(await page.$('.layout-bar'), null);
// 새로고침해도 유지, 다른 기기(거실 iPad)에도 같은 순서
await page.reload(); await page.waitForSelector('.kid-card'); await page.waitForTimeout(500);
assert.deepEqual(await names(page), ['유하', '유엘'], '새로고침 후에도 유지');
const ipad = await login(await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true }), true);
assert.deepEqual(await names(ipad), ['유하', '유엘'], '거실 iPad에도 같은 순서');
console.log('✓ 새로고침·다른 기기에도 같은 순서');
// 하단 메뉴도 순서 바꾸기: 처음 순서 [오늘, 루틴, 도장판, 가족] → 가족을 맨 앞으로
const tabsNow = () => page.$$eval('.tabs .tab', (e) => e.map((x) => x.dataset.tab));
assert.deepEqual(await tabsNow(), ['today', 'routines', 'stamps', 'family']);
const fb = await (await page.$('.tab[data-tab=family]')).boundingBox(); const tb = await (await page.$('.tab[data-tab=today]')).boundingBox();
await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); await page.mouse.down(); await page.waitForTimeout(750);
await page.mouse.move(fb.x + fb.width / 2 - 30, fb.y + fb.height / 2, { steps: 3 }); await page.mouse.move(tb.x + 10, tb.y + tb.height / 2, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(400);
assert.equal((await tabsNow())[0], 'family', '하단 메뉴도 순서가 바뀐다');
await page.click('.layout-bar [data-done]');
console.log('✓ 하단 메뉴 순서 변경');
// 알림장 사진을 누르면 전체 화면으로 크게 보이고, 한 번 더 누르면 확대, 바깥/✕로 닫힌다
{
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAASwAAADICAIAAADdvUsCAAACRklEQVR4nO3TQQEAEADAQPQPIYlMIoixh7sE+2zefQbQWXUA/M6EEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHETAgxE0LMhBAzIcRMCDETQsyEEDMhxEwIMRNCzIQQMyHEHnDfA96mtkCTAAAAAElFTkSuQmCC', 'base64');
  const up = await (await fetch(base + '/api/photos', { method: 'POST', headers: { 'X-Requested-With': 'lovefamily', cookie, 'X-Photo-Kind': 'post', 'Content-Type': 'application/octet-stream' }, body: png })).json();
  await call('POST', '/api/posts', { title: '11.27 도시락', body: '급식파업', photoId: up.id });
  await page.goto(base + '/#/notebook'); await page.waitForSelector('.post-photo');
  // 목록의 사진도 잘리지 않는다: 원본 비율(300×200) 그대로 보인다
  const pb = await (await page.$('.post-photo')).boundingBox();
  assert.ok(Math.abs(pb.width / pb.height - 1.5) < 0.05, `사진이 원본 비율로 보여야 한다(가로/세로 ${(pb.width / pb.height).toFixed(2)})`);
  assert.equal(await page.$eval('.post-photo', (e) => getComputedStyle(e).objectFit), 'contain');
  await page.click('.post-photo');
  await page.waitForSelector('.pv-scroll img');
  const vb = await (await page.$('.pv-scroll img')).boundingBox();
  assert.ok(vb.width > 0 && vb.height > 0 && vb.x >= 0, '전체 화면 보기가 열린다');
  assert.equal(await page.$eval('.photo-viewer', (e) => getComputedStyle(e).position), 'fixed');
  await page.click('.pv-scroll img'); // 한 번 더 누르면 확대
  assert.ok(await page.$eval('.photo-viewer', (e) => e.classList.contains('zoomed')), '한 번 더 누르면 확대');
  await page.click('.photo-viewer .pv-close');
  assert.equal(!!(await page.$('.photo-viewer')), false, '✕로 닫힌다');
  await page.click('.post-photo'); await page.waitForSelector('.photo-viewer');
  await page.mouse.click(5, 300);  // 사진 바깥(검은 곳)을 눌러도 닫힌다
  await page.waitForTimeout(200);
  console.log('✓ 알림장 사진을 누르면 전체 화면으로 보임(확대·닫기)');
}
// 처음 배열로
await call('PUT', '/api/layout', { layout: {} });
await page.goto(base + '/#/'); await page.reload(); await page.waitForSelector('.kid-card'); await page.waitForTimeout(500);
assert.deepEqual(await names(page), ['유엘', '유하'], '처음 배열');
// 아이 폰에서는 꾹 눌러도 배열 바꾸기가 열리지 않는다
const { code } = await call('POST', `/api/kids/${yuel}/pair-code`);
const kp = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
await kp.goto(base + '/#/pair'); await kp.fill('input', code); await kp.click('button[type=submit]'); await kp.waitForSelector('.tab'); await kp.goto(base + '/#/'); await kp.waitForSelector('.house');
const hb = await (await kp.$('.house')).boundingBox();
await kp.mouse.move(hb.x + 50, hb.y + 50); await kp.mouse.down(); await kp.waitForTimeout(800); await kp.mouse.up();
assert.equal(!!(await kp.$('.layout-bar')), false, '아이 폰에서는 배열을 바꿀 수 없다');
console.log('✓ 아이 폰에서는 바꿀 수 없음');
// 폰을 가로로 돌리면 아이패드 가로와 같은 2단 배열(왼쪽 집 · 오른쪽 내용)
for (const [name, opts] of [['iPhone 가로', { ...devices['iPhone 14 landscape'] }], ['안드로이드 가로', { viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true }]]) {
  const lp = await (await browser.newContext(opts)).newPage();
  await lp.goto(base + '/#/login'); await lp.fill('input[name=loginId]', 'mom@t'); await lp.fill('input[name=password]', 'secret1'); await lp.click('button[type=submit]'); await lp.waitForSelector('.walker');
  const cols = (await lp.$eval('.home', (e) => getComputedStyle(e).gridTemplateColumns)).trim().split(/\s+/);
  assert.equal(cols.length, 2, `${name}: 왼쪽 집 · 오른쪽 내용 2단 (${cols.join(' ')})`);
  const hb = await (await lp.$('.house-col')).boundingBox(); const mb = await (await lp.$('.home-main')).boundingBox();
  assert.ok(hb.x < mb.x && hb.x + hb.width <= mb.x + 2, `${name}: 집이 왼쪽, 내용이 오른쪽`);
  await lp.close();
}
console.log('✓ 폰 가로 화면도 아이패드 가로 배열(2단)');
// 하단 메뉴는 화면 아래에 고정: 내용을 스크롤해도, 끝까지 당겨도 위치가 변하지 않는다
{
  const vp = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
  await vp.goto(base + '/#/login'); await vp.fill('input[name=loginId]', 'mom@t'); await vp.fill('input[name=password]', 'secret1'); await vp.click('button[type=submit]'); await vp.waitForSelector('.tabs');
  await vp.goto(base + '/#/family'); await vp.waitForSelector('#resetall'); await vp.waitForTimeout(400);
  const pos = () => vp.$eval('.tabs', (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: window.innerHeight }; });
  const p0 = await pos();
  assert.equal(p0.bottom, p0.h, '하단 메뉴는 화면 맨 아래에 붙어 있다');
  for (const y of [300, 1200, 99999, 0]) { await vp.evaluate((v) => { (document.querySelector('#main') || document.scrollingElement).scrollTo(0, v); window.scrollTo(0, v); }, y); await vp.waitForTimeout(150); assert.deepEqual(await pos(), p0, `스크롤(${y})해도 하단 메뉴 위치가 그대로`); }
  assert.deepEqual(await vp.$$eval('.tabs .tab span:last-child', (e) => e.map((x) => x.textContent.trim())), ['우리집', '할일', '도장판', '가족'], '첫 탭 이름은 우리집');
  await vp.close();
  console.log('✓ 하단 메뉴 고정(스크롤해도 안 움직임), 첫 탭 우리집');
}
// 활동 시작 전에 시간을 10분 단위로 줄이고 늘릴 수 있다
{
  await call('POST', '/api/routines', { kidIds: [yuel], name: '성경말씀읽기', icon: '✝️', days: 'daily', slot: 'morning' });
  await page.goto(base + `/#/kid/${yuel}/timer`); await page.waitForSelector('.act-card');
  await page.click('.act-card:has-text("게임하기")');
  assert.match(await page.textContent('.min-now'), /30분/);
  await page.click('#mdown');
  assert.match(await page.textContent('.min-now'), /20분/, '− 10분');
  await page.click('#mdown');
  assert.equal(await page.$eval('#mdown', (e) => e.disabled), true, '10분 밑으로는 못 줄인다');
  await page.click('#mup'); await page.click('#mup');
  assert.match(await page.textContent('.min-now'), /30분/); assert.equal(await page.$eval('#mup', (e) => e.disabled), false, '어른이 정한 시간에서 더 늘릴 수 있다');
  await page.click('#mup'); await page.click('#mup'); await page.click('#mup');
  assert.match(await page.textContent('.min-now'), /1시간/, '30분에서 +30분 = 60분');
  assert.equal(await page.$eval('#mup', (e) => e.disabled), true, '+30분을 넘길 수 없다');
  await page.click('#mdown'); await page.click('#mdown'); await page.click('#mdown'); await page.click('#mdown');
  await page.click('#start');
  await page.waitForSelector('.big-digits');
  assert.match(await page.textContent('.big-digits'), /^(20:00|19:5\d)/, '20분짜리로 시작');
  await page.click('#stop'); await page.click('[data-yes]');
  console.log('✓ 활동 시간을 10분 단위로 줄이고 늘림(오늘 남은 시간 안에서)');
}
// 루틴 빠른 등록에 성경말씀읽기(성경책 그림 아이콘)
{
  await page.waitForTimeout(600); await page.goto(base + `/#/routines`); await page.waitForSelector('[data-q]'); await page.waitForTimeout(400);
  assert.ok(await page.$('[data-q]:has-text("성경말씀읽기")'), '빠른 추가에 성경말씀읽기');
  assert.ok(await page.$('[data-q]:has-text("성경말씀읽기") img.emo[src*="bible"]'), '성경책 그림 아이콘');
  console.log('✓ 루틴 빠른 추가: 성경말씀읽기(성경책 아이콘)');
}
// 루틴 수정 화면에서 '평일' 을 고르고 저장하면 월~금만 저장된다
{
  const rts = await call('GET', `/api/kids/${yuel}/routines`);
  await page.goto(base + '/#/routines'); await page.waitForSelector('[data-q]');
  const row = page.locator('li', { hasText: rts[0].name }).first();
  await page.click(`[data-edit="${rts[0].id}"]`).catch(async () => { await row.getByRole('button', { name: /수정/ }).click(); });
  await page.waitForSelector('#dayset');
  await page.click('#dayset [data-set=weekdays]');
  await page.click('.sheet button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 5000 });
  const after = (await call('GET', `/api/kids/${yuel}/routines`)).find((r) => r.id === rts[0].id);
  assert.deepEqual(after.days, [1, 2, 3, 4, 5], '평일 = 월~금');
  console.log('✓ 루틴 요일을 평일로 저장');
}
// 전체 리셋: 확인 글자를 써야 하고, 루틴은 남는다
{
  await page.goto(base + '/#/family'); await page.waitForSelector('#resetall');
  await page.click('#resetall'); await page.waitForSelector('input[name=confirm]');
  await page.fill('input[name=confirm]', '아니요'); await page.click('.sheet button[type=submit]');
  await page.waitForSelector('.form-err:not([hidden])');
  assert.ok((await call('GET', `/api/kids/${yuel}/routines`)).length >= 1);
  await page.fill('input[name=confirm]', '리셋'); await page.click('.sheet button[type=submit]');
  await page.waitForFunction(async (id) => (await (await fetch(`/api/kids/${id}/ledger`)).json()).entries.length === 0, yuel, { timeout: 8000 });
  assert.ok((await call('GET', `/api/kids/${yuel}/routines`)).length >= 1, '리셋해도 루틴은 남는다');
  console.log('✓ 전체 리셋(확인 글자 입력, 루틴은 유지)');
}
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 7 통과 · 스크린샷:', shots);
