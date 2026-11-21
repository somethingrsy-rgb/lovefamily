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
// 아이폰 앱에서 보이는 영역이 어긋나 하단 메뉴가 떠 보일 때 보이는 영역의 아래 끝에 다시 맞춘다(보이는 영역을 흉내 내서 확인)
{
  const vp = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
  await vp.addInitScript(() => { let h = 664, top = 0; Object.defineProperty(window, '__vv', { value: { set(a, b) { h = a; top = b; } } }); const real = window.visualViewport; Object.defineProperty(window, 'visualViewport', { configurable: true, get() { return { get height() { return h; }, get offsetTop() { return top; }, addEventListener() {}, removeEventListener() {}, real }; } }); });
  await vp.goto(base + '/#/login'); await vp.fill('input[name=loginId]', 'mom@t'); await vp.fill('input[name=password]', 'secret1'); await vp.click('button[type=submit]'); await vp.waitForSelector('.tabs');
  await vp.evaluate(() => { window.__vv.set(window.innerHeight - 90, 0); window.__fixTabs(); });
  assert.equal(await vp.$eval('.tabs', (e) => e.style.bottom), '90px', '보이는 영역이 90px 짧아지면 하단 메뉴도 그만큼 올려 맞춘다');
  await vp.evaluate(() => { window.__vv.set(window.innerHeight, 0); window.__fixTabs(); });
  assert.equal(await vp.$eval('.tabs', (e) => e.style.bottom), '', '정상이면 원래 위치');
  await vp.close();
  console.log('✓ 하단 메뉴가 떠 있을 때 보이는 영역 끝으로 다시 맞춤');
}
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 7 통과 · 스크린샷:', shots);
