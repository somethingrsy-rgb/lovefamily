// 브라우저 E2E 2: 활동 타이머(5분 전 예고/종료/새로고침 중복 없음), 다음 활동, 내일 준비물, 가족 활동
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
let skew = 0; const MIN = 60000;
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ui2-')), now: () => Date.now() + skew });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
class C { cookie = ''; async call(m, u, b) { const r = await fetch(base + u, { method: m, headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie: this.cookie }, body: b === undefined ? undefined : JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; const j = await r.json().catch(() => ({})); if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${JSON.stringify(j)}`); return j; } }
const mom = new C();
await mom.call('POST', '/api/auth/register', { loginId: 'mom@t', password: 'secret1', role: 'mom' });
const me = await mom.call('GET', '/api/me');
await new C().call('POST', '/api/auth/join', { code: me.family.code, loginId: 'dad@t', password: 'secret2', role: 'dad' });
const [yuel, yuha] = me.kids.map((k) => k.id);
await mom.call('POST', '/api/routines', { kidIds: [yuel, yuha], name: '양치하기', icon: '🪥', days: 'daily', slot: 'morning' });
await mom.call('POST', '/api/routines', { kidIds: [yuel, yuha], name: '식사하기', icon: '🍽️', days: 'daily', slot: 'evening' });

const browser = await chromium.launch();
const errors = [];
const watch = (page, tag) => { page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`)); page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|409)/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); }); };
const login = async (page, id, pw, device) => { await page.goto(base + '/#/login'); await page.fill('input[name=loginId]', id); await page.fill('input[name=password]', pw); if (device) await page.check('input[name=device]'); await page.click('button[type=submit]'); await page.waitForSelector('.tabs'); };

const ipadCtx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const ipad = await ipadCtx.newPage(); watch(ipad, 'iPad');
await login(ipad, 'mom@t', 'secret1', true);
await ipad.evaluate(() => localStorage.setItem('theme', '"light"'));
await ipad.reload(); await ipad.waitForSelector('.kid-card');
const phoneCtx = await browser.newContext({ ...devices['iPhone 14'] });
const phone = await phoneCtx.newPage(); watch(phone, 'iPhone');
await login(phone, 'dad@t', 'secret2', false);

// 아빠(어른 폰)가 유하의 TV 타이머를 '다음 활동: 잠옷 갈아입기'와 함께 시작
await phone.goto(`${base}/#/kid/${yuha}/timer`);
await phone.waitForSelector('.act-card');
assert.equal((await phone.$$('.act-card')).length, 7);
await phone.click('.act-card:has-text("TV 보기")');
await phone.click('#next');
await phone.fill('input[name=custom]', '잠옷 갈아입기');
await phone.click('.sheet button[type=submit]');
await phone.waitForSelector('.tag:has-text("다음")');
await phone.screenshot({ path: path.join(shots, '30-phone-timer-start.png'), fullPage: true });
await phone.click('#start');
await phone.waitForSelector('.timer-big');
await phone.screenshot({ path: path.join(shots, '31-phone-timer-running.png'), fullPage: true });

// 거실 iPad: 유하 카드에 현재 활동·남은 시간·지금/다음 카드가 실시간으로 나타남
await ipad.waitForSelector('.kid-card:has-text("유하") .kid-timer.running', { timeout: 8000 });
assert.match(await ipad.textContent('.kid-card:has-text("유하") .kt-time'), /^(29|30):\d\d$/);
assert.match(await ipad.textContent('.kid-card:has-text("유하") .now-next'), /TV 보기.*잠옷 갈아입기/s);
// 유엘은 따로: 식사하기 루틴의 [타이머 시작] 버튼으로 시작
await ipad.click('.kid-card:has-text("유엘") .kid-main'); await ipad.waitForSelector('.kid-hub');
await ipad.click('text=오늘 할일'); await ipad.waitForSelector('.item-timer');
await ipad.click('.checks li:has-text("식사하기") .item-timer');
await ipad.waitForSelector('.timer-big');
await ipad.screenshot({ path: path.join(shots, '32-ipad-timer-page.png') });
await ipad.goto(base + '/#/'); await ipad.waitForSelector('.kid-card');
await ipad.waitForSelector('.kid-card:has-text("유엘") .kid-timer.running');
await ipad.screenshot({ path: path.join(shots, '33-ipad-home-two-timers.png') });
// 진행 중 다른 활동 시작 → 확인 대화상자
await ipad.goto(`${base}/#/kid/${yuel}/timer`); await ipad.waitForSelector('.timer-big');
await ipad.click('#new'); await ipad.waitForSelector('.sheet:has-text("새로 고를까요")'); await ipad.click('.sheet:has-text("새로 고를까요") [data-close]');

// 25분 경과 → 유하 예고 팝업 1회 (유엘은 식사 30분이라 같은 시점에 시작했으므로 둘 다 예고)
skew += 25 * MIN; app.settle();
await ipad.goto(base + '/#/'); 
await ipad.waitForSelector('.tp-card.warn', { timeout: 8000 });
const warnCards = await ipad.$$eval('.tp-card.warn', (c) => c.map((x) => x.innerText));
assert.ok(warnCards.some((t) => t.includes('유하야, TV 보는 시간이 5분 남았어요. 다음은 잠옷 갈아입기예요.')), warnCards.join('|'));
assert.ok(warnCards.some((t) => t.includes('유엘아, 식사 시간이 5분 남았어요.')), warnCards.join('|'));
assert.equal(warnCards.length, 2, '아이마다 한 번씩');
await ipad.screenshot({ path: path.join(shots, '34-ipad-warn-popup.png') });
// [알겠어요]: 팝업만 닫히고 타이머는 계속
await ipad.click('.tp-card.warn >> nth=0 >> [data-ok]'); await ipad.click('.tp-card.warn >> [data-ok]');
await ipad.waitForFunction(() => !document.querySelector('.tp-card'));
assert.ok(await ipad.$('.kid-card:has-text("유하") .kid-timer.running'));
assert.match(await ipad.textContent('.kid-card:has-text("유하") .kt-time'), /^0[0-5]:\d\d$/);
// 새로고침해도 예고가 다시 뜨지 않는다
await ipad.reload(); await ipad.waitForSelector('.kid-card'); await ipad.waitForTimeout(1500);
assert.equal((await ipad.$$('.tp-card')).length, 0);

// 5분 뒤 종료: 종료 팝업 + 다음 안내
skew += 5 * MIN + 2000; app.settle();
await ipad.waitForSelector('.tp-card.end', { timeout: 8000 });
const endCards = await ipad.$$eval('.tp-card.end', (c) => c.map((x) => x.innerText));
assert.ok(endCards.some((t) => t.includes('TV 보는 시간이 끝났어요') && t.includes('이제 잠옷 갈아입을 시간이에요')), endCards.join('|'));
assert.ok(endCards.some((t) => t.includes('식사 시간이 끝났어요. 더 필요하면 어른에게 알려 주세요.')));
await ipad.screenshot({ path: path.join(shots, '35-ipad-end-popup.png') });
await ipad.click('.tp-card.end >> nth=0 >> [data-ok]'); await ipad.click('.tp-card.end >> [data-ok]');
assert.ok(await ipad.$('.kid-card:has-text("유하") .kid-timer.ended'));
// 종료만으로 루틴이 체크되거나 도장 요청이 생기지 않음
const approvals = await mom.call('GET', '/api/approvals'); assert.equal(approvals.pending.length, 0);
// 새로고침/잠금 해제 후에도 종료 상태가 바로 보이고 같은 알림이 다시 뜨지 않는다
await ipad.reload(); await ipad.waitForSelector('.kid-timer.ended'); await ipad.waitForTimeout(1500);
assert.equal((await ipad.$$('.tp-card')).length, 0);
await ipad.screenshot({ path: path.join(shots, '36-ipad-home-ended.png') });
// 종료 확인 버튼 → 카드에서 내려감(연장·체크 아님)
await ipad.click('.kid-card:has-text("유하") [data-dismiss]');
await ipad.waitForFunction(() => !document.querySelector('.kid-card .kid-timer.ended') || document.querySelectorAll('.kid-timer.ended').length === 1);

// 내일 준비물: 알림장 글에서 여러 개 등록(엄마 폰 API) → 거실 보드 카드, 아이별 체크
const post = await mom.call('POST', '/api/posts', { title: '미술 시간 안내', body: '색종이와 풀', kidId: 'all' });
await mom.call('POST', '/api/supplies', { postId: post.id, kidIds: [yuha], items: [{ name: '색종이', icon: '🟥' }, { name: '풀', icon: '🧴' }] });
await mom.call('POST', '/api/supplies', { kidIds: [yuel, yuha], items: [{ name: '체육복', icon: '🎽' }] });
await ipad.goto(base + '/#/'); await ipad.waitForSelector('.supplies .sup-chip');
assert.match(await ipad.textContent('.supplies'), /내일 챙길 것.*0\/3 챙겼어요/s);
await ipad.click('.sup-kid:has-text("유하") .sc-btn:has-text("색종이")');
await ipad.waitForSelector('.toast.action');
await ipad.waitForFunction(() => /1\/3 챙겼어요/.test(document.querySelector('.supplies').innerText));
assert.match(await ipad.textContent('.sup-kid:has-text("유엘")'), /0\/1 챙겼어요/);
await ipad.screenshot({ path: path.join(shots, '37-ipad-home-supplies.png'), fullPage: true });
// 알림장 글에서 '준비물 추가' (어른 폰)
await phone.goto(`${base}/#/notebook`); await phone.waitForSelector('[data-sup]');
await phone.click('[data-sup]'); await phone.waitForSelector('.sheet:has-text("준비물 추가")');
await phone.fill('input[name=nm0]', '색종이'); await phone.fill('input[name=nm1]', '가위');
await phone.click('.sheet button[type=submit]');
await phone.waitForSelector('.sheet:has-text("이미 등록된")'); // 중복은 기존 항목을 보여 줌 (대상 '모두'로 등록 시도)
await phone.screenshot({ path: path.join(shots, '38-phone-supply-dup.png') });
await phone.click('.sheet:has-text("이미 등록된") [data-close]');

// 자정(KST) 지나면 '내일' → '오늘'
const kstNow = new Date(Date.now() + skew + 9 * 3600e3);
const toMidnight = Date.parse(new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() + 1)).toISOString()) - (Date.now() + skew + 9 * 3600e3) + 30000;
skew += toMidnight; app.settle();
await ipad.reload(); await ipad.waitForSelector('.supplies .sup-chip');
assert.match(await ipad.textContent('.supplies'), /오늘 챙길 것/);

// 가족 활동: 아이가 고르고 → 어른이 확정 → 일정
const park = await mom.call('POST', '/api/family-activities/options', { name: '공원 가기', icon: '🌳' });
await mom.call('POST', '/api/family-activities/options', { name: '보드게임 하기', icon: '🎲' });
await ipad.goto(`${base}/#/kid/${yuel}/family`); await ipad.waitForSelector('.opt-card');
await ipad.click('.opt-card:has-text("공원 가기") [data-pick]');
await ipad.waitForSelector('.opt-card.mine');
await ipad.goto(`${base}/#/kid/${yuha}/family`); await ipad.waitForSelector('.opt-card');
await ipad.click('.opt-card:has-text("공원 가기") [data-pick]');
await ipad.waitForFunction(() => /둘 다 골랐어요/.test(document.body.innerText));
await ipad.screenshot({ path: path.join(shots, '39-ipad-family-pick.png') });
await ipad.goto(base + '/#/'); await ipad.waitForSelector('.famact');
assert.match(await ipad.textContent('.famact'), /가족이 날짜를 정하고 있어요/);
const d = new Date(Date.now() + skew + 9 * 3600e3 + 3 * 864e5).toISOString().slice(0, 10);
await mom.call('POST', '/api/family-activities/plans', { optionId: park.id, date: d, time: '14:00' });
await ipad.waitForFunction(() => /확정/.test(document.querySelector('.famact').innerText), null, { timeout: 8000 });
await ipad.screenshot({ path: path.join(shots, '40-ipad-home-final.png'), fullPage: true });
// 어른 화면(폰)
await phone.goto(`${base}/#/family-activity`); await phone.waitForSelector('.opt-admin');
await phone.screenshot({ path: path.join(shots, '41-phone-family-plan.png'), fullPage: true });
await phone.goto(`${base}/#/family`); await phone.waitForSelector('text=활동 설정');
await phone.screenshot({ path: path.join(shots, '42-phone-family-settings.png'), fullPage: true });
for (const hash of [`#/kid/${yuha}/supplies`, `#/kid/${yuha}/timer`, `#/kid/${yuha}/family`]) { await phone.goto(base + '/' + hash); await phone.waitForTimeout(600); assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, hash + ' 가로 스크롤'); }
await browser.close(); await app.close();
if (errors.length) { console.error('브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E 2 통과 · 스크린샷:', shots);
