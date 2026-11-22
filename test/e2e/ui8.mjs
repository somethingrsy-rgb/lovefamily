// 브라우저 E2E 8: 말로 보내기 — 🎤를 누르고 말하면 글자가 입력칸에 보이고, 5초 동안 조용하면 자동으로 전송된다(음성 인식은 가짜로 흉내)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ui8-')) });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
let cookie = '';
const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie }, body: b && JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return r.json().catch(() => ({})); };
await call('POST', '/api/auth/register', { loginId: 'mom@t', password: 'secret1', role: 'mom' });
const me = await call('GET', '/api/me'); const yuel = me.kids[0].id; const mom = me.me.id;
const { code } = await call('POST', `/api/kids/${yuel}/pair-code`);

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const errors = [];
const kp = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
kp.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERR', e.message); });
// 가짜 음성 인식: window.__say(글자) 로 말한 것처럼 결과를 보낸다
await kp.addInitScript(() => {
  window.__sr = null;
  window.SpeechRecognition = window.webkitSpeechRecognition = class { constructor() { window.__sr = this; this.started = 0; } start() { this.started++; } abort() { this.aborted = true; } stop() {} };
  window.__say = (t) => { const r = window.__sr; r.onresult({ results: [[{ transcript: t }]] }); };
});
await kp.goto(base + '/#/pair'); await kp.fill('input', code); await kp.click('button[type=submit]'); await kp.waitForSelector('.tab');
await kp.goto(base + `/#/kid/${yuel}/talk/${mom}`); await kp.waitForSelector('#mic');
assert.ok(await kp.isVisible('#mic'), '직접 쓰기 옆에 마이크 버튼');
await kp.click('#mic');
assert.equal(await kp.getAttribute('#mic', 'aria-pressed'), 'true');
await kp.evaluate(() => window.__say('엄마 사랑해요'));
assert.equal(await kp.inputValue('.chat-form input[name=body]'), '엄마 사랑해요', '말한 내용이 입력칸에 글자로 보인다');
const t0 = Date.now();
// 말을 이어 하면 5초를 다시 센다
await kp.waitForTimeout(3000); await kp.evaluate(() => window.__say('엄마 사랑해요 빨리 와요'));
await kp.waitForTimeout(3500);
assert.equal((await call('GET', `/api/threads/${yuel}/${mom}`)).length, 0, '마지막 말 뒤 5초가 안 지났으면 아직 안 보낸다');
const until = async (n, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await call('GET', `/api/threads/${yuel}/${mom}`)).length === n) return true; await kp.waitForTimeout(250); } return false; };
assert.ok(await until(1, 4000), '5초 뒤 자동 전송');
const msgs = await call('GET', `/api/threads/${yuel}/${mom}`);
assert.equal(msgs[0].body, '엄마 사랑해요 빨리 와요', '말한 내용 그대로 전송');
const waited = Date.now() - t0;
assert.ok(waited >= 8000, `마지막 말 뒤 5초 조용해야 보낸다(${waited}ms)`);
assert.equal(await kp.inputValue('.chat-form input[name=body]'), '', '보낸 뒤 입력칸이 비워진다');
console.log('✓ 말하고 5초 조용하면 자동 전송, 말을 이어 하면 다시 5초');
// 말없이 5초 → 아무것도 보내지 않는다. 듣는 중에 ⏹ 를 누르면 바로 보낸다
await kp.click('#mic'); await kp.waitForTimeout(5600);
assert.equal((await call('GET', `/api/threads/${yuel}/${mom}`)).length, 1, '말이 없으면 보내지 않는다');
await kp.click('#mic'); await kp.evaluate(() => window.__say('지금 보내요')); await kp.click('#mic');
assert.ok(await until(2, 3000), '다시 누르면 바로 전송');
console.log('✓ 말이 없으면 안 보냄 · 다시 누르면 바로 보냄');
await kp.screenshot({ path: path.join(os.tmpdir(), 'lf-shots', '95-mic.png') });
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 8 통과');
