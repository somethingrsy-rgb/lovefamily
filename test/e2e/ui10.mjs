// 브라우저 E2E 10: 간식주기 · 산책하기 (다이아=유엘, 귀요미=유하), 주인 곁에 자주 가 있기
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ui10-')) });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
let cookie = '';
const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie }, body: b && JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; };
await call('POST', '/api/auth/register', { loginId: 'mom@t', password: 'secret1', role: 'mom' });
const me = (await call('GET', '/api/me')).body; const [yuel, yuha] = me.kids.map((k) => k.id);
assert.equal((await call('POST', '/api/pets/act', { kidId: yuel, kind: 'fly' })).status, 400, '모르는 동작은 거절');

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + '/#/login'); await page.fill('input[name=loginId]', 'mom@t'); await page.fill('input[name=password]', 'secret1'); await page.check('input[name=device]');
await page.click('button[type=submit]'); await page.waitForSelector('.kid-card'); await page.waitForSelector('.pet'); await page.waitForTimeout(600);

// 1) 아이 카드마다 [활동][간식주기][산책하기]가 한 줄
const row = await page.$$eval('.kid-card', (cs) => cs.map((c) => [...c.querySelectorAll('.kt-idle > *')].map((b) => ({ t: b.textContent.trim(), y: Math.round(b.getBoundingClientRect().top) }))));
for (const r of row) { assert.deepEqual(r.map((b) => b.t), ['활동', '간식주기', '산책하기'], '버튼 3개'); assert.ok(r.every((b) => b.y === r[0].y), '한 줄'); }
assert.ok(await page.$('.kid-card .kt-pet img.emo'), '쿠키·나무 그림 아이콘');
console.log('✓ 아이마다 활동 · 간식주기 · 산책하기 버튼');

// 2) 간식주기: 유엘 → 다이아(ruby), 쿠키가 날아가고 제자리에서 폴짝
await page.evaluate(() => { const p = window.__pets; p.forEach((c) => { c.mode = 'idle'; c.until = performance.now() + 60000; c.pose = 'sit'; }); });
await page.click(`.kid-card:nth-child(1) [data-pet-act=snack]`);
await page.waitForSelector('.snack-cookie', { timeout: 3000 });
await page.waitForFunction(() => window.__pets[0].mode === 'snack', null, { timeout: 3000 });
await page.waitForTimeout(1300);
assert.ok(await page.$eval('.pet[data-pet=ruby]', (e) => e.classList.contains('hop')), '간식을 받으면 폴짝 뛴다');
assert.ok(await page.$eval('.pet[data-pet=yeoni]', (e) => !e.classList.contains('hop')), '다른 동물은 가만히');
await page.waitForFunction(() => window.__pets[0].mode === 'idle', null, { timeout: 6000 });
console.log('✓ 유엘 간식 → 다이아가 쿠키 받고 제자리에서 폴짝');
await page.click(`.kid-card:nth-child(2) [data-pet-act=snack]`);
await page.waitForFunction(() => window.__pets[2].mode === 'snack', null, { timeout: 3000 });
console.log('✓ 유하 간식 → 귀요미');
await page.waitForFunction(() => window.__pets[2].mode === 'idle', null, { timeout: 6000 });

// 3) 산책하기: 유하와 귀요미가 정원(집 아래쪽)을 약 15초 돈다
const t0 = Date.now();
await page.click(`.kid-card:nth-child(2) [data-pet-act=walk]`);
await page.waitForFunction((id) => document.querySelector(`[data-walker="${id}"]`)?.classList.contains('moving'), yuha, { timeout: 3000 });
await page.waitForFunction(() => window.__pets[2].mode === 'garden', null, { timeout: 3000 });
await page.waitForTimeout(4000);
const at = await page.evaluate((id) => { const w = document.querySelector(`[data-walker="${id}"]`); const d = document.querySelector('.pet[data-pet=yeoni]'); return { wy: parseFloat(w.style.top), dy: parseFloat(d.style.top), wx: parseFloat(w.style.left), dx: parseFloat(d.style.left), o: d.style.opacity }; }, yuha);
assert.ok(at.wy > 80 && at.dy > 80, `정원(집 아래쪽)에 있다 (아이 ${at.wy}, 강아지 ${at.dy})`);
assert.ok(Math.abs(at.wx - at.dx) < 14, `둘이 함께 다닌다 (간격 ${Math.abs(at.wx - at.dx).toFixed(1)}%)`);
await page.waitForFunction((id) => !document.querySelector(`[data-walker="${id}"]`)?.classList.contains('moving'), yuha, { timeout: 20000 });
const secs = (Date.now() - t0) / 1000;
assert.ok(secs > 13 && secs < 19, `산책은 15초 안팎 (${secs.toFixed(1)}초)`);
await page.waitForFunction(() => window.__pets[2].mode === 'idle', null, { timeout: 4000 });
const back = await page.evaluate((id) => parseFloat(document.querySelector(`[data-walker="${id}"]`).style.top), yuha);
assert.ok(back < 80, `산책이 끝나면 자기 방으로 돌아온다 (${back})`);
console.log(`✓ 유하·귀요미 산책 ${secs.toFixed(1)}초 후 복귀`);

// 4) 주인 곁: 다이아는 유엘 방(1층 왼쪽 칸), 귀요미는 유하 방(1층 가운데 칸)에 자주 간다
const stat = await page.evaluate(async () => {
  const out = { ruby: 0, yeoni: 0, walks: 0 };
  for (let i = 0; i < 120; i++) {
    for (const c of window.__pets) { if (c.id === 'crystal') continue; c.mode = 'idle'; c.until = 1; c.x = 50; c.y = 76; c.path = []; }
    await new Promise((r) => setTimeout(r, 40));
    for (const c of window.__pets) { if (c.id === 'crystal' || c.mode !== 'walk') continue; out.walks++; const e = c.path[c.path.length - 1]; if (Math.abs(e[1] - 54.2) < 0.5) { if (c.id === 'ruby' && e[0] < 35.2) out.ruby++; if (c.id === 'yeoni' && e[0] >= 35.2 && e[0] < 64.9) out.yeoni++; } }
  }
  return out;
});
assert.ok(stat.walks > 50 && stat.ruby > 15 && stat.yeoni > 15, `주인 방(유엘=왼쪽, 유하=가운데)으로 자주 간다: ${JSON.stringify(stat)}`);
console.log('✓ 주인 곁에 자주 간다', JSON.stringify(stat));
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 10 통과');
