// 브라우저 E2E 3: 집 안 걷기 — 건물 뼈대(층 바닥선·기둥 통로)로만 이동하는지, 기기 간 공유되는지
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

const FLOOR_Y = [30.0, 52.4, 73.9];
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

const pos = (p, id) => p.evaluate((i) => { const e = document.querySelector(`[data-walker="${i}"]`); return e ? { x: parseFloat(e.style.left), y: parseFloat(e.style.top), moving: e.classList.contains('moving'), face: e.querySelector('.wk-sprite')?.style.transform || '' } : null; }, id);
const select = async (p, id) => { await p.evaluate(() => window.scrollTo(0, 0)); await p.click(`[data-walker="${id}"]`); await p.waitForSelector('.pad-btn'); };
const press = async (p, dir) => { await p.waitForSelector(`.pad-btn.${dir}:not([disabled])`, { timeout: 8000 }); await p.click(`.pad-btn.${dir}`); };
async function walkAndSample(p, id, dir) {
  await press(p, dir);
  const samples = []; const faces = new Set();
  for (let i = 0; i < 200; i++) {
    const s = await pos(p, id);
    if (s) { samples.push(s); if (s.moving) faces.add(s.face); }
    if (s && !s.moving && samples.length > 3) break;
    await p.waitForTimeout(40);
  }
  return { samples, faces };
}
const onSkeleton = (s) => FLOOR_Y.some((fy) => Math.abs(s.y - fy) < 0.5) || PILLAR_X.some((px) => Math.abs(s.x - px) < 0.5);

// 1) 아빠(아래층 오른쪽 방 22): 위 → 위 로 거실까지. 기둥 통로를 거쳐 층을 오르내려야 한다
await select(ipad, ids.dad);
let all = [];
for (const dir of ['up', 'up']) {
  const r = await walkAndSample(ipad, ids.dad, dir);
  all = all.concat(r.samples.filter((s) => s.moving));
  console.log(`아빠 ${dir}: 걷는 중 샘플 ${r.samples.filter((s) => s.moving).length}개`);
  await ipad.waitForSelector(`[data-walker="${ids.dad}"].idle`);
}
assert.ok(all.length > 20, '걷는 모습이 충분히 샘플링돼야 한다');
const off = all.filter((s) => !onSkeleton(s));
assert.equal(off.length, 0, `뼈대를 벗어난 위치: ${JSON.stringify(off.slice(0, 3))}`);
assert.ok(all.some((s) => PILLAR_X.some((px) => Math.abs(s.x - px) < 0.5) && s.y > FLOOR_Y[0] + 3 && s.y < FLOOR_Y[2] - 3), '기둥 통로로 오르내림');
const fin = await pos(ipad, ids.dad);
assert.ok(Math.abs(fin.y - FLOOR_Y[0]) < 0.5, '거실 바닥에 도착');
console.log('✓ 아빠: 거실까지 이동 전 구간이 바닥선·기둥 통로 위');
await ipad.screenshot({ path: path.join(shots, '50-walk-living.png') });

// 2) 걷는 방향에 맞춰 좌우 반전(왼쪽으로 걸으면 반전)
assert.equal(await ipad.$eval('.pad-btn.right', (e) => e.disabled), true, '오른쪽 끝에서는 오른쪽 불가');
const ll = await walkAndSample(ipad, ids.dad, 'left');   // 거실 가운데(01)로
await ipad.waitForSelector(`[data-walker="${ids.dad}"].idle`);
const rr = await walkAndSample(ipad, ids.dad, 'right');  // 다시 오른쪽(02)
await ipad.waitForSelector(`[data-walker="${ids.dad}"].idle`);
await walkAndSample(ipad, ids.dad, 'left');              // 거실 가운데(01)에서 멈춤
assert.ok([...rr.faces].some((f) => f.includes('scaleX(1)')) && [...ll.faces].some((f) => f.includes('scaleX(-1)')), '방향에 따라 좌우 반전');
console.log('✓ 오른쪽/왼쪽으로 걸을 때 얼굴 방향이 바뀜');

// 3) 같은 칸에 둘이 서면 나란히, 가장자리에서는 그쪽 방향 버튼이 꺼짐
await ipad.click('.pad-head [data-act=close]');
await select(ipad, ids.yuel);
assert.equal(await ipad.$eval('.pad-btn.left', (e) => e.disabled), true, '왼쪽 끝에서는 왼쪽 불가');
assert.equal(await ipad.$eval('.pad-btn.up', (e) => e.disabled), false);
await walkAndSample(ipad, ids.yuel, 'right'); // 유하방(11)
await ipad.waitForSelector(`[data-walker="${ids.yuel}"].idle`);
await ipad.waitForTimeout(700);
const a = await pos(ipad, ids.yuel); const b = await pos(ipad, ids.yuha);
assert.ok(Math.abs(a.x - b.x) > 6 && Math.abs(a.y - b.y) < 0.5, '같은 방의 두 사람은 좌우로 나란히 선다');
console.log('✓ 한 방에 둘이 서면 나란히');

// 4) 다른 기기(휴대폰)에서도 같은 위치로 걸어가서 도착
await phone.waitForFunction(({ id, y }) => { const e = document.querySelector(`[data-walker="${id}"]`); return e && !e.classList.contains('moving') && Math.abs(parseFloat(e.style.top) - y) < 0.6; }, { id: ids.yuel, y: FLOOR_Y[1] }, { timeout: 10000 });
const server = await mom.call('GET', '/api/home');
assert.equal(server.walkers[ids.yuel], '11'); assert.equal(server.walkers[ids.dad], '01');
console.log('✓ 다른 기기에도 같은 위치(서버 공유)');
await phone.evaluate(() => window.scrollTo(0, 0));
await phone.screenshot({ path: path.join(shots, '51-walk-phone.png') });

// 5) 내 방으로: 거실의 아빠가 집(아래층 오른쪽 방)으로 돌아온다
await ipad.click('.pad-head [data-act=close]');
await select(ipad, ids.dad);
await ipad.click('[data-act=home]');
const back = [];
for (let i = 0; i < 300; i++) { const s = await pos(ipad, ids.dad); if (s?.moving) back.push(s); if (s && !s.moving && back.length > 5) break; await ipad.waitForTimeout(40); }
assert.equal(back.filter((s) => !onSkeleton(s)).length, 0, '돌아올 때도 뼈대 위');
assert.equal((await mom.call('GET', '/api/home')).walkers[ids.dad], '22');
console.log('✓ 내 방으로 돌아올 때도 뼈대로만');

// 6) 가로 스크롤 없음(휴대폰)
assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 3 통과 · 스크린샷:', shots);
