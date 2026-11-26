import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup } from './helpers.js';
import { parseMeals, splitMenu } from '../server/services/meals.js';

const SAMPLE = fs.readFileSync(new URL('./meals-sample.txt', import.meta.url), 'utf8'); // 실제 식단표(BOM 포함)

test('급식: 괄호 안 쉼표는 나누지 않고, 식단표 붙여넣기를 날짜별로 읽는다', () => {
  assert.deepEqual(splitMenu('쌀밥(자율), 짜계치(자장, 달걀, 치즈), 탕수육(대파꿔바)'), ['쌀밥(자율)', '짜계치(자장, 달걀, 치즈)', '탕수육(대파꿔바)']);
  const { days, skipped } = parseMeals(SAMPLE, Date.parse('2026-11-20T03:00:00Z'));
  assert.equal(days.length, 21); assert.equal(skipped.length, 0);
  assert.equal(days[0].date, '2026-11-02'); assert.equal(days[0].items.length, 7); assert.equal(days[0].items[1], '근대콩나물된장국(건새우)');
  assert.deepEqual(days[17].items.slice(0, 2), ['쌀밥(자율)', '짜계치(자장, 달걀, 치즈)'], '11/25');
  // 12월에 붙여넣은 1월 식단은 다음 해로
  assert.equal(parseMeals('1/5(월) / 밥, 국', Date.parse('2026-12-20T03:00:00Z')).days[0].date, '2027-01-05');
  // 이상한 줄은 건너뛴다
  const bad = parseMeals('안녕하세요\n13/40 / 밥\n11/5(목) /\n11/6(금) / 밥', Date.parse('2026-11-20T03:00:00Z'));
  assert.equal(bad.days.length, 1); assert.equal(bad.skipped.length, 3);
});

test('급식: 어른만 넣고 고치고, 아이·가족은 보기만, 아이별로 따로 저장', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const { yuel, yuha } = f.ids; const url = (k) => `/api/kids/${k}/meals`;
    const r = await f.mom.ok('POST', `${url(yuel)}/import`, { text: SAMPLE });
    assert.equal(r.saved, 21); assert.equal(r.from, '2026-11-02'); assert.equal(r.to, '2026-11-30');
    assert.equal((await f.mom.call('POST', `${url(yuel)}/import`, { text: '그냥 글' })).status, 400);
    // 오늘(금 11/20)이 들어 있는 이번 주부터 3주
    const l = await f.device.ok('GET', url(yuel));
    assert.equal(l.today, '2026-11-20'); assert.equal(l.from, '2026-11-16');
    assert.equal(l.days.find((d) => d.date === '2026-11-20').items[0], '카레라이스'); assert.equal(l.days.find((d) => d.date === '2026-11-20').dow, 5);
    // 유하는 학교가 달라서 따로: 아직 없음 → 다른 식단
    assert.equal((await f.mom.ok('GET', url(yuha))).days.length, 0);
    await f.mom.ok('PUT', `${url(yuha)}/2026-11-20`, { text: '백미밥, 된장국(두부, 파), 돈가스' });
    assert.deepEqual((await f.mom.ok('GET', url(yuha))).days[0].items, ['백미밥', '된장국(두부, 파)', '돈가스']);
    assert.equal((await f.mom.ok('GET', `${url(yuel)}?from=2026-11-20&to=2026-11-20`)).days[0].items[0], '카레라이스', '유엘 식단은 그대로');
    // 권한: 거실 기기(어른 확인 없음)는 못 바꾼다
    assert.equal((await f.device.call('PUT', `${url(yuel)}/2026-11-20`, { items: ['x'] })).status, 401);
    assert.equal((await f.device.call('POST', `${url(yuel)}/import`, { text: SAMPLE })).status, 401);
    assert.equal((await f.mom.call('PUT', `${url(yuel)}/abcd`, { items: ['x'] })).status, 400);
    // 하루 지우기(비우거나 DELETE)
    await f.mom.ok('PUT', `${url(yuha)}/2026-11-20`, { items: [] });
    assert.equal((await f.mom.ok('GET', url(yuha))).days.length, 0);
    await f.mom.ok('DELETE', `${url(yuel)}/2026-11-20`);
    assert.equal((await f.mom.ok('GET', `${url(yuel)}?from=2026-11-20&to=2026-11-20`)).days.length, 0);
    assert.equal((await f.mom.call('GET', `${url(yuel)}?from=2026-01-01&to=2026-12-31`)).status, 400, '62일 넘는 범위');
  } finally { await f.close(); }
});

test('급식 알림: 평일 정한 시각에 정한 어른에게만, 하루 한 번, 식단 없으면 안 보냄', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const { yuel, yuha } = f.ids; const KST = 9 * 3600e3;
    const at = (h, m = 0, day = '2026-11-20') => Date.parse(`${day}T00:00:00Z`) - KST + (h * 60 + m) * 60e3;
    await f.mom.ok('POST', `/api/kids/${yuel}/meals/import`, { text: SAMPLE });
    await f.mom.ok('PUT', `/api/kids/${yuha}/meals/2026-11-20`, { items: ['백미밥', '돈가스'] });
    const notes = async (c) => (await c.ok('GET', '/api/notifications')).items.filter((n) => n.kind === 'meal');
    // 기본값: 켜짐 08:00
    assert.deepEqual(await f.mom.ok('GET', '/api/meals/alert'), { enabled: true, time: '08:00' });
    // 아빠는 끄고, 할머니는 9시로
    assert.deepEqual(await f.dad.ok('PUT', '/api/meals/alert', { enabled: false }), { enabled: false, time: '08:00' });
    assert.equal((await f.gma.ok('PUT', '/api/meals/alert', { time: '9:00' })).time, '09:00');
    assert.equal((await f.gma.call('PUT', '/api/meals/alert', { time: '25:00' })).status, 400);
    assert.equal((await f.device.call('GET', '/api/meals/alert')).status, 401);
    // 7:59 → 아직
    f.clock.t = at(7, 59); assert.equal(f.app.meals(), 0);
    // 8:00 → 엄마만(두 아이 식단이 한 알림에)
    f.clock.t = at(8, 0); assert.equal(f.app.meals(), 1); await f.flush();
    const mn = await notes(f.mom);
    assert.equal(mn.length, 1); assert.match(mn[0].body, /유엘: 카레라이스/); assert.match(mn[0].body, /유하: 백미밥, 돈가스/);
    assert.equal((await notes(f.dad)).length, 0, '끈 사람은 안 받음'); assert.equal((await notes(f.gma)).length, 0, '9시 전');
    // 같은 날 다시 돌려도 중복 없음
    f.clock.t = at(8, 30); assert.equal(f.app.meals(), 0);
    // 9:00 → 할머니
    f.clock.t = at(9, 0); assert.equal(f.app.meals(), 1);
    // 알림 시각에서 3시간이 지난 뒤(서버가 늦게 켜짐)에는 새로 보내지 않는다
    await f.dad.ok('PUT', '/api/meals/alert', { enabled: true, time: '08:00' });
    f.clock.t = at(11, 30); assert.equal(f.app.meals(), 0);
    // 주말·식단 없는 날은 안 보냄
    f.clock.t = at(8, 0, '2026-11-21'); assert.equal(f.app.meals(), 0, '토요일');
    f.clock.t = at(8, 0, '2026-11-23'); await f.mom.ok('DELETE', `/api/kids/${yuel}/meals/2026-11-23`); assert.equal(f.app.meals(), 0, '식단 없는 월요일');
    f.clock.t = at(8, 0, '2026-11-24'); assert.equal(f.app.meals(), 2, '화요일 8시: 엄마·아빠(할머니는 9시)');
  } finally { await f.close(); }
});

test('급식 알림 점검: 지금 보내 보기는 식단이 있을 때만, 폰 알림 구독 여부를 알려 주고 실제 푸시가 나간다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const { yuel } = f.ids;
    const base = (await f.mom.ok('POST', '/api/meals/alert/test'));
    assert.equal(base.sent, false); assert.equal(base.reason, 'no_meal');
    await f.mom.ok('POST', `/api/kids/${yuel}/meals/import`, { text: SAMPLE });
    const before = f.pushes.length;
    const r = await f.mom.ok('POST', '/api/meals/alert/test'); assert.equal(r.sent, true); assert.equal(r.devices, base.devices); await f.flush();
    if (base.devices) { assert.ok(f.pushes.length > before, '실제 푸시가 나감'); assert.match(f.pushes.at(-1).payload.body, /오늘 급식 · 유엘 카레라이스/); }
    // 이 폰에 알림 구독을 하나 더 하면 기기 수가 늘어난다
    await f.mom.ok('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/mom-extra', keys: { p256dh: 'p', auth: 'a' } } });
    assert.equal((await f.mom.ok('POST', '/api/meals/alert/test')).devices, base.devices + 1);
    assert.equal((await f.device.call('POST', '/api/meals/alert/test')).status, 401, '어른 확인 없이는 안 됨');
    // 같은 날 정시 알림은 점검 알림과 별개로 한 번 더 간다(점검이 정시 알림을 막지 않는다)
    f.clock.t = Date.parse('2026-11-20T08:00:00+09:00'); assert.ok(f.app.meals() >= 1);
  } finally { await f.close(); }
});
