// 브라우저 E2E 11: 어른(엄마·아빠)이 먼저 아이에게 메시지 보내기 → 아이 폰에 도착
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ui11-')) });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
const mk = () => ({ cookie: '', async call(m, u, b) { const r = await fetch(base + u, { method: m, headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie: this.cookie }, body: b && JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; } });
const mom = mk(); await mom.call('POST', '/api/auth/register', { loginId: 'mom@t', password: 'secret1', role: 'mom' });
const me = (await mom.call('GET', '/api/me')).body; const [yuel, yuha] = me.kids.map((k) => k.id);
await mk().call('POST', '/api/auth/join', { code: me.family.code, loginId: 'dad@t', password: 'secret2', role: 'dad' });
const { code } = (await mom.call('POST', `/api/kids/${yuel}/pair-code`)).body;

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const errors = [];
const phone = async (login, pw) => {
  const pg = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(base + '/#/login'); await pg.fill('input[name=loginId]', login); await pg.fill('input[name=password]', pw); await pg.click('button[type=submit]'); await pg.waitForSelector('.kid-card'); await pg.waitForTimeout(500);
  return pg;
};
const kid = await (await browser.newContext({ ...devices['Galaxy S9+'] })).newPage(); kid.on('pageerror', (e) => errors.push(e.message));
await kid.goto(base + '/#/pair'); await kid.fill('input', code); await kid.click('button[type=submit]'); await kid.waitForSelector('.tab');

// 1) 엄마 폰: 아이 카드의 [메시지] → 엄마와 유엘의 대화방. 먼저 보낼 수 있다
const m = await phone('mom@t', 'secret1');
await m.click(`[data-rk="k${yuel}"] .kid-links .kl:has-text("메시지")`);
await m.waitForSelector('.chat-form');
assert.match(m.url(), new RegExp(`#/messages/${yuel}/`), '대화방으로 이동');
await m.click('.phrases .chip:has-text("사랑해")');
await m.waitForSelector('.bubbles li.me');
await m.fill('.chat-form input', '숙제 끝나면 말해줘'); await m.press('.chat-form input', 'Enter');
await m.waitForFunction(() => document.querySelectorAll('.bubbles li.me').length === 2);
console.log('✓ 엄마가 먼저 유엘에게 메시지 2개');

// 2) 받은 편지함에서도 아이를 골라 보낼 수 있다
await m.goto(base + '/#/inbox'); await m.waitForSelector('a[href^="#/messages/"]');
assert.equal(await m.$$eval('.page-card a.btn[href^="#/messages/"]', (e) => e.length), 2, '아이 두 명 모두 고를 수 있다');
console.log('✓ 받은 편지함: 아이 고르기');

// 3) 유엘 폰에 도착: 받은 편지함에 엄마와의 대화가 있고, 열면 엄마가 보낸 말이 보이고 답장도 된다
await kid.goto(base + `/#/kid/${yuel}/inbox`); await kid.waitForSelector('.threads li');
assert.ok((await kid.textContent('.threads')).includes('엄마'), '엄마와의 대화');
await kid.click('.threads li a'); await kid.waitForSelector('.bubbles li.other');
assert.equal(await kid.$$eval('.bubbles li.other', (e) => e.length), 2);
await kid.click('.phrases .chip >> nth=0');
await kid.waitForSelector('.bubbles li.me');
console.log('✓ 유엘 폰에서 받고 답장');

// 4) 아빠도 보낼 수 있고, 대화는 어른마다 따로다(서로의 대화는 안 보인다)
const d = await phone('dad@t', 'secret2');
await d.click(`[data-rk="k${yuel}"] .kid-links .kl:has-text("메시지")`); await d.waitForSelector('.chat-form');
assert.equal(await d.$$eval('.bubbles li.me, .bubbles li.other', (e) => e.length), 0, '아빠 대화방은 비어 있다');
await d.fill('.chat-form input', '아빠야'); await d.press('.chat-form input', 'Enter'); await d.waitForSelector('.bubbles li.me');
const t = (await mom.call('GET', `/api/threads?kidId=${yuel}`)).body; assert.equal(t.length, 1, '엄마에게는 엄마 대화만');
console.log('✓ 아빠도 보내고 대화는 따로');

await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 11 통과');
