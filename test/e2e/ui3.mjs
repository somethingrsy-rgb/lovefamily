// 브라우저 E2E 3: 집 안 걷기 — 캐릭터를 선택하고 가고 싶은 곳을 누르면 건물 뼈대(층 바닥선·기둥 통로)로만 걸어간다
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

const FLOOR_Y = [33.4, 54.2, 76];
const COL_X = [19.6, 50.2, 80.3];
const PILLAR_X = [35.2, 64.9];
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ui3-')) });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;

class C {
  cookie = '';
  async call(m, u, b) {
    const r = await fetch(base + u, { method: m, headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie: this.cookie }, body: b === undefined ? undefined : JSON.stringify(b) });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const j = await r.json().catch(() => ({}));
    if (r.status >= 300) throw new Error(m + u + r.status + JSON.stringify(j));
    return j;
  }
}
const mom = new C();
await mom.call('POST', '/api/auth/register', { loginId: 'mom@t', password: 'secret1', role: 'mom' });
const me = await mom.call('GET', '/api/me');
await new C().call('POST', '/api/auth/join', { code: me.family.code, loginId: 'dad@t', password: 'secret2', role: 'dad' });
await new C().call('POST', '/api/auth/join', { code: me.family.code, loginId: 'g@t', password: 'secret3', role: 'grandma' });
const ids = { yuel: me.kids[0].id, yuha: me.kids[1].id };
const adults = (await mom.call('GET', '/api/me')).adults;
ids.gma = adults.find((a) => a.role === 'grandma').id; ids.mom = adults.find((a) => a.role === 'mom').id; ids.dad = adults.find((a) => a.role === 'dad').id;

const browser = await chromium.launch();
const errors = [];
async function open(ctxOpts, tag) {
  const p = await (await browser.newContext(ctxOpts)).newPage();
  p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/status of (401|409)/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  await p.goto(base + '/#/login');
  await p.fill('input[name=loginId]', 'mom@t'); await p.fill('input[name=password]', 'secret1'); await p.check('input[name=device]');
  await p.click('button[type=submit]');
  await p.waitForSelector('.walker');
  await p.evaluate(() => localStorage.setItem('theme', '"light"'));
  await p.reload(); await p.waitForSelector('.walker'); await p.waitForTimeout(500);
  return p;
}
const ipad = await open({ viewport: { width: 1180, height: 820 }, hasTouch: true }, 'iPad');
const phone = await open({ ...devices['iPhone 14'] }, 'iPhone');

const pos = (p, id) => p.evaluate((i) => { const e = document.querySelector(`[data-walker="${i}"]`); return e ? { x: parseFloat(e.style.left), y: parseFloat(e.style.top), moving: e.classList.contains('moving'), face: e.querySelector('.wk-sprite')?.style.transform || '', frame: (() => { const sp = e.querySelector('.wk-sprite'); return sp ? getComputedStyle(sp).backgroundPositionX : ''; })() } : null; }, id);
const houseBox = async (p) => { await p.evaluate(() => document.querySelector('.house').scrollIntoView({ block: 'center' })); return p.$eval('.house', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }); };
const select = async (p, id) => { await p.evaluate(() => window.scrollTo(0, 0)); await p.click(`[data-walker="${id}"]`); await p.waitForSelector(`[data-walker="${id}"].sel`); };
// 집 그림 위의 칸을 실제로 눌러 본다(칸의 위쪽 빈 곳: 사람이 서 있지 않은 높이)
async function tapCell(p, row, col) {
  const box = await houseBox(p);
  const rowMid = [21, 44.6, 66.4][row];
  await p.mouse.click(box.x + (COL_X[col] / 100) * box.w, box.y + (rowMid / 100) * box.h);
}
async function walk(p, id, row, col) {
  await tapCell(p, row, col);
  const samples = [];
  for (let i = 0; i < 300; i++) {
    const s = await pos(p, id);
    if (s) samples.push(s);
    if (s && !s.moving && samples.length > 3) break;
    await p.waitForTimeout(40);
  }
  await p.waitForSelector(`[data-walker="${id}"].idle`, { timeout: 8000 });
  return samples.filter((s) => s.moving);
}
const onSkeleton = (s) => FLOOR_Y.some((fy) => Math.abs(s.y - fy) < 0.5) || PILLAR_X.some((px) => Math.abs(s.x - px) < 0.5);

// 0) 선택하지 않고 방을 누르면 예전처럼 그 화면으로 이동(확인방 빈 곳 → 도장판)
const b0 = await houseBox(ipad);
await ipad.mouse.click(b0.x + 0.78 * b0.w, b0.y + 0.44 * b0.h);
await ipad.waitForFunction(() => location.hash.startsWith('#/stamps'), null, { timeout: 4000 });
console.log('✓ 선택 없이 방을 누르면 그 화면(도장판)으로 이동');
await ipad.goto(base + '/#/'); await ipad.waitForSelector('.walker'); await ipad.waitForTimeout(400);

// 1) 아빠(아래층 오른쪽 22)를 선택하고 거실 가운데(01)를 누른다 → 기둥 통로를 거쳐 층을 올라가야 한다
await select(ipad, ids.dad);
assert.equal(await ipad.$$eval('#walkpad, .walk-hint, .pad-head', (e) => e.length), 0, '안내창은 없다');
assert.equal(await ipad.$$eval('.pad-btn', (e) => e.length), 0, '방향 패드 버튼은 없다');
const up = await walk(ipad, ids.dad, 0, 1);
console.log(`아빠 거실로: 걷는 중 샘플 ${up.length}개`);
assert.ok(up.length > 20, '걷는 모습이 충분히 샘플링돼야 한다');
assert.ok(new Set(up.map((s) => s.frame).filter(Boolean)).size >= 6, `걷는 동안 12컷이 바뀌어야 한다(한 동작 고정 금지): ${[...new Set(up.map((s) => s.frame))].join(',')}`);
assert.equal(up.filter((s) => !onSkeleton(s)).length, 0, `뼈대를 벗어난 위치: ${JSON.stringify(up.filter((s) => !onSkeleton(s)).slice(0, 3))}`);
assert.ok(up.some((s) => PILLAR_X.some((px) => Math.abs(s.x - px) < 0.5) && s.y > FLOOR_Y[0] + 3 && s.y < FLOOR_Y[2] - 3), '기둥 통로로 오르내림');
assert.ok(Math.abs((await pos(ipad, ids.dad)).y - FLOOR_Y[0]) < 0.5);
console.log('✓ 아빠: 선택 → 거실을 눌러 이동, 전 구간이 바닥선·기둥 통로 위');
await ipad.screenshot({ path: path.join(shots, '50-walk-living.png') });

// 2) 걷는 방향에 맞춰 좌우 반전 (거실 오른쪽 02로, 다시 왼쪽 00으로)
const faces = { r: new Set(), l: new Set() };
(await walk(ipad, ids.dad, 0, 2)).forEach((s) => faces.r.add(s.face));
(await walk(ipad, ids.dad, 0, 0)).forEach((s) => faces.l.add(s.face));
assert.ok([...faces.r].some((f) => f.includes('scaleX(1)')) && [...faces.l].some((f) => f.includes('scaleX(-1)')), '방향에 따라 좌우 반전');
console.log('✓ 오른쪽/왼쪽으로 걸을 때 얼굴 방향이 바뀜');

// 3) 같은 칸에 둘이 서면 나란히: 유엘을 선택해 유하방(11)을 누른다
await ipad.evaluate(() => document.querySelector('.walker.sel')?.click()); // 같은 캐릭터를 다시 누르면 선택 해제
await select(ipad, ids.yuel);
const yw = await walk(ipad, ids.yuel, 1, 1);   // 유하가 서 있는 칸의 한가운데를 눌러도 목적지로 인식돼야 한다
assert.ok(yw.length > 10, '유엘이 실제로 걸어서 이동');
await ipad.waitForTimeout(700);
const a = await pos(ipad, ids.yuel); const b = await pos(ipad, ids.yuha);
assert.ok(Math.abs(a.x - b.x) > 6 && Math.abs(a.y - b.y) < 0.5, '같은 방의 두 사람은 좌우로 나란히 선다');
assert.ok(a.x > COL_X[0] + 8, '유엘은 원래 방(왼쪽 칸)을 떠나 유하방으로 옮겨 왔다');
console.log('✓ 한 방에 둘이 서면 나란히');

// 4) 다른 기기(휴대폰)에서도 같은 위치로 걸어가서 도착
await phone.waitForFunction(({ id, y }) => { const e = document.querySelector(`[data-walker="${id}"]`); return e && !e.classList.contains('moving') && Math.abs(parseFloat(e.style.top) - y) < 0.6; }, { id: ids.yuel, y: FLOOR_Y[1] }, { timeout: 10000 });
const server = await mom.call('GET', '/api/home');
assert.equal(server.walkers[ids.yuel], '11'); assert.equal(server.walkers[ids.dad], '00');
console.log('✓ 다른 기기에도 같은 위치(서버 공유)');
await phone.evaluate(() => window.scrollTo(0, 0));
await phone.screenshot({ path: path.join(shots, '51-walk-phone.png') });

// 5) 정원처럼 갈 수 없는 곳을 누르면 아무 일도 없다(화면도 바뀌지 않는다)
await ipad.evaluate(() => document.querySelector('.walker.sel')?.click()); // 같은 캐릭터를 다시 누르면 선택 해제
await select(ipad, ids.dad);
const bg = await houseBox(ipad);
// 정원 왼쪽 끝(방향 패드 창과 겹치지 않는 곳)을 누른다
const gx = bg.x + 0.12 * bg.w, gy = bg.y + 0.9 * bg.h;
const hit = await ipad.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.closest('#walkpad') ? 'pad' : e.closest('[data-room]') ? 'room' : e.closest('.house') ? 'house' : 'other'); }, [gx, gy]);
assert.equal(hit, 'house', '정원 왼쪽 끝은 패드가 아니라 집 그림 위');
await ipad.mouse.click(gx, gy);
await ipad.waitForTimeout(300);
assert.equal((await pos(ipad, ids.dad)).moving, false, '정원을 눌러도 가지 않는다');
assert.ok(!ipad.url().includes('#/stamps') && !ipad.url().includes('#/kid'), '화면도 바뀌지 않는다');
console.log('✓ 정원 등 갈 수 없는 곳은 무시');

// 6) 내 방으로: 거실의 아빠가 집으로 돌아온다
await ipad.evaluate(() => window.scrollTo(0, 0)); await tapCell(ipad, 2, 2); // 내 방(아래층 오른쪽)을 눌러 돌아온다
const back = [];
for (let i = 0; i < 300; i++) { const s = await pos(ipad, ids.dad); if (s?.moving) back.push(s); if (s && !s.moving && back.length > 5) break; await ipad.waitForTimeout(40); }
assert.equal(back.filter((s) => !onSkeleton(s)).length, 0, '돌아올 때도 뼈대 위');
assert.equal((await mom.call('GET', '/api/home')).walkers[ids.dad], '22');
console.log('✓ 내 방으로 돌아올 때도 뼈대로만');

// 7) 선택한 채 5초 동안 이동 요청이 없으면 이동 선택이 꺼진다
await ipad.evaluate(() => document.querySelector('.walker.sel')?.click());
await select(ipad, ids.mom);
await ipad.waitForTimeout(3000);
assert.ok(await ipad.$eval(`[data-walker="${ids.mom}"]`, (e) => e.classList.contains('sel')), '3초 뒤에는 아직 선택 상태');
await ipad.waitForTimeout(2600);
assert.equal(await ipad.$eval(`[data-walker="${ids.mom}"]`, (e) => e.classList.contains('sel')), false, '5초 동안 요청이 없으면 선택 해제');
await tapCell(ipad, 0, 1); await ipad.waitForTimeout(300);
assert.ok(ipad.url().includes('#/notebook'), '해제된 뒤에는 방을 누르면 걷지 않고 그 화면(거실→알림장)으로 이동');
console.log('✓ 5초 동안 이동 요청이 없으면 이동 비활성화');

assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 3 통과 · 스크린샷:', shots);
