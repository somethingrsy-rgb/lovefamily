// 브라우저 E2E 4: 더블클릭 활동창 · 루틴 완료 → 도장 방 걷기 → [도장 요청] → 승인 후 신나는 모습 · 준비물 아이콘 그림 고르기
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
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ui4-')) });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;

class C {
  cookie = '';
  async call(m, u, b, extra = {}) {
    const r = await fetch(base + u, { method: m, headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie: this.cookie, ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const j = await r.json().catch(() => ({}));
    if (r.status >= 300) throw new Error(m + u + r.status + JSON.stringify(j));
    return j;
  }
}
const mom = new C();
await mom.call('POST', '/api/auth/register', { loginId: 'mom@t', password: 'secret1', role: 'mom' });
const me = await mom.call('GET', '/api/me');
await new C().call('POST', '/api/auth/join', { code: me.family.code, loginId: 'dad@t', password: 'secret2', role: 'dad' });
const yuel = me.kids[0].id;
await mom.call('POST', '/api/routines', { kidIds: [yuel], name: '양치하기', icon: '🪥', days: 'daily', slot: 'morning' });

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + '/#/login');
await page.fill('input[name=loginId]', 'mom@t'); await page.fill('input[name=password]', 'secret1'); await page.check('input[name=device]');
await page.click('button[type=submit]');
await page.waitForSelector('.walker');
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('.house').scrollIntoView({ block: 'center' }));

// 1) 한 번 누르면 이동 선택, 빠르게 두 번 누르면 활동창
await page.click(`[data-walker="${yuel}"]`);
assert.ok(await page.$eval(`[data-walker="${yuel}"]`, (e) => e.classList.contains('sel')), '한 번 누르면 선택(이동 활성화)');
await page.waitForTimeout(600); // 더블클릭으로 보지 않을 만큼 기다린 뒤
await page.dblclick(`[data-walker="${yuel}"]`, { force: true }); // 선택 중 흔들리는 캐릭터라 force
await page.waitForFunction((id) => location.hash === `#/kid/${id}`, yuel, { timeout: 4000 });
await page.waitForSelector('.kid-hub', { timeout: 8000 }); // 화면이 완전히 뜬 뒤에 홈으로 돌아간다
console.log('✓ 캐릭터를 두 번 누르면 그 아이 화면(허브)으로');
await page.goto(base + '/#/'); await page.waitForSelector('.walker', { timeout: 8000 }).catch(async () => { console.log('DBG', page.url(), (await page.textContent('body')).slice(0, 200)); throw new Error('home not shown'); }); await page.waitForTimeout(400);

// 2) 루틴을 다 하면 아이가 도장 방으로 걸어가고, 어른에게는 아직 알림이 가지 않는다
const kidHdr = { 'X-Act-Kid': String(yuel) };
const dev = new C(); await dev.call('POST', '/api/auth/login', { loginId: 'mom@t', password: 'secret1', device: true });
const day = await dev.call('GET', `/api/kids/${yuel}/day`);
for (const it of day.items) await dev.call('PUT', `/api/day-items/${it.id}`, { done: true }, kidHdr);
assert.equal((await mom.call('GET', '/api/approvals')).pending.length, 0, '요청 전에는 어른 확인 목록이 비어 있다');
await page.waitForSelector(`[data-walker="${yuel}"].moving`, { timeout: 5000 });
await page.waitForSelector('.bank-req-btn', { timeout: 20000 });
assert.equal((await mom.call('GET', '/api/home')).walkers[yuel], '12');
console.log('✓ 루틴을 다 한 아이가 걸어서 도장 방에 도착 → [도장 요청] 버튼');
await page.screenshot({ path: path.join(shots, '60-bank-request.png') });
assert.equal((await mom.call('GET', '/api/approvals')).pending.length, 0, '버튼을 누르기 전까지 알림 없음');
await page.click('.bank-req-btn');
await page.waitForFunction(async () => (await (await fetch('/api/approvals')).json()).pending?.length === 1, null, { timeout: 5000 }).catch(() => {});
assert.equal((await mom.call('GET', '/api/approvals')).pending.length, 1, '[도장 요청]을 누르면 어른 확인 목록에 생긴다');
console.log('✓ [도장 요청]을 누른 뒤에야 어른에게 요청이 간다');

// 3) 승인하면 그 아이가 두 팔을 번쩍 든 모습으로
const rid = (await mom.call('GET', '/api/approvals')).pending[0].id;
await mom.call('POST', `/api/stamp-requests/${rid}/approve`);
await page.waitForSelector(`[data-walker="${yuel}"] img.cheer`, { timeout: 8000 });
await page.waitForTimeout(3600); // 쾅 애니메이션이 끝난 뒤
await page.evaluate(() => document.querySelector('.house').scrollIntoView({ block: 'center' }));
await page.screenshot({ path: path.join(shots, '61-cheer.png') });
await page.waitForFunction((id) => !document.querySelector(`[data-walker="${id}"] img.cheer`), yuel, { timeout: 5000 });
assert.equal(await page.$(`[data-walker="${yuel}"] img.cheer`), null, '5초 뒤에는 신나는 모습이 끝난다');
console.log('✓ 도장을 받으면 신나는 모습 → 5초 뒤 기본 자세');
await page.waitForFunction(({ id, y }) => { const e = document.querySelector(`[data-walker="${id}"]`); return e && !e.classList.contains('moving') && Math.abs(parseFloat(e.style.top) - y) < 3; }, { id: yuel, y: 52.4 }, { timeout: 20000 }); // 유엘방(1층 왼쪽) 바닥선
assert.equal((await mom.call('GET', '/api/home')).walkers[yuel], '10', '도장을 받은 뒤 자기 방으로 돌아간다');
console.log('✓ 도장 받고 신나는 모습이 끝나면 자기 방으로 자동 복귀');

// 4) 준비물 아이콘: 글자 목록이 아니라 그림으로 고른다
const mp = await (await browser.newContext({ viewport: { width: 420, height: 900 }, hasTouch: true })).newPage(); // 어른 본인 폰
mp.on('pageerror', (e) => errors.push(e.message));
await mp.goto(base + '/#/login');
await mp.fill('input[name=loginId]', 'mom@t'); await mp.fill('input[name=password]', 'secret1');
await mp.click('button[type=submit]');
await mp.waitForSelector('.walker');
await mp.goto(base + '/#/family'); await mp.waitForSelector('#addsup'); await mp.click('#addsup');
await mp.waitForSelector('.icon-pick');
assert.equal(await mp.$$eval('.sup-row select', (e) => e.length), 0, '글자 목록(select)은 더 없다');
assert.ok(await mp.$('.icon-pick img.emo'), '아이콘 칸이 그림으로 보인다');
await mp.click('.icon-pick');
await mp.waitForSelector('.icon-grid');
assert.equal(await mp.$$eval('.icon-grid .icon-opt img.emo', (e) => e.length), 12, '12개 아이콘이 모두 그림');
await mp.screenshot({ path: path.join(shots, '62-supply-icons.png') });
await mp.click('.icon-grid .icon-opt:nth-child(7)'); // 신발
await mp.fill('input[name=nm0]', '실내화');
await mp.click('button:has-text("등록")');
await mp.waitForTimeout(800);
const sup = await mom.call('GET', `/api/kids/${yuel}/supplies`);
assert.ok(sup.some((s) => s.name === '실내화' && s.icon === '👟'), `고른 아이콘으로 저장: ${JSON.stringify(sup.map((s) => [s.name, s.icon]))}`);
console.log('✓ 준비물 아이콘을 그림으로 골라 저장');

await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 4 통과 · 스크린샷:', shots);
