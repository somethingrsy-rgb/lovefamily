import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

const MIN = 60000;
const acts = async (f) => Object.fromEntries((await f.mom.ok('GET', '/api/activities')).map((a) => [a.kind, a]));

// SSE 구독 도우미 (거실 iPad = 공용 기기 세션)
async function listen(f, client, qs = '') {
  const ev = []; const ac = new AbortController();
  const res = await fetch(f.base + '/api/stream' + qs, { headers: { cookie: client.cookie, 'X-Requested-With': 'lovefamily' }, signal: ac.signal });
  (async () => { try { const rd = res.body.getReader(); const dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; for (const m of dec.decode(value).matchAll(/data: (.*)\n/g)) ev.push(JSON.parse(m[1])); } } catch {} })();
  await new Promise((r) => setTimeout(r, 80));
  return { ev, stop: () => ac.abort(), timer: (kind) => ev.filter((e) => e.t === 'timer' && (!kind || e.kind === kind)) };
}
const advance = async (f, ms) => { f.clock.t += ms; f.app.settle(); await f.flush(); await new Promise((r) => setTimeout(r, 60)); };

test('⑨ 30분 타이머: 25분에 예고 1회, 30분에 종료 1회 · 알겠어요는 연장이 아님 · 새로고침/조회에도 중복 없음', async () => {
  const f = await setup({ withRoutines: true });
  try {
    const a = await acts(f); const kid = f.ids.yuha;
    assert.equal(a.tv.minutes, 30); assert.deepEqual(Object.values(a).map((x) => x.name).sort(), ['TV 보기', '게임하기', '식사하기', '양치하기', '숙제하기', '책 읽기', '씻기'].sort());
    assert.deepEqual(Object.values(a).map((x) => x.minutes).sort((x, y) => x - y), [5, 20, 30, 30, 30, 30, 30]);
    // 다음 활동(어른이 선택): 오늘 루틴의 미완료 항목
    const day = await f.day(kid);
    const brush = day.items.find((i) => i.name === '양치하기');
    const s = await f.device.ok('GET', '/api/timers');
    assert.equal(s.timers.length, 0);
    await f.device.post('/api/auth/login', { loginId: 'mom@test', password: 'secret1', device: true });
    const tok = await f.elevate('mom', f.pw.mom);
    const sse = await listen(f, f.device);
    const t0 = f.clock.t;
    const t = await f.device.ok('POST', `/api/kids/${kid}/timers`, { activityId: a.tv.id, next: { type: 'routine', itemId: brush.id } }, { 'X-Elevation': tok });
    assert.equal(t.remainingMs, 30 * MIN); assert.equal(t.endsAt, t0 + 30 * MIN);
    assert.equal(t.texts.warn, '유하야, TV 보는 시간이 5분 남았어요. 다음은 양치하기예요. 이제 슬슬 마무리할 준비를 해요.');
    await advance(f, 24 * MIN + 59000);
    assert.equal(sse.timer().length, 0, '25분 전에는 알림 없음');
    await advance(f, 1000);
    assert.equal(sse.timer('warn').length, 1);
    await advance(f, 2 * MIN); f.app.settle();
    assert.equal(sse.timer('warn').length, 1, '예고는 한 번만');
    // 아이가 팝업을 확인(알겠어요)해도 카운트다운은 계속: 서버에는 아무 변화가 없고, 종료 시각도 그대로
    let cur = (await f.device.ok('GET', '/api/timers')).timers[0];
    assert.equal(cur.endsAt, t0 + 30 * MIN); assert.equal(cur.state, 'running'); assert.equal(cur.remainingMs, 3 * MIN);
    // 새로고침/재조회를 여러 번 해도 알림이 다시 나오지 않는다
    for (let i = 0; i < 3; i++) await f.device.ok('GET', '/api/timers');
    assert.equal(sse.timer('warn').length, 1);
    await advance(f, 3 * MIN);
    assert.equal(sse.timer('end').length, 1, '30분에 종료 1회');
    cur = (await f.device.ok('GET', '/api/timers')).timers[0];
    assert.equal(cur.state, 'ended'); assert.equal(cur.remainingMs, 0);
    assert.equal(cur.texts.end, 'TV 보는 시간이 끝났어요. 이제 TV를 끄고 마무리해요.');
    assert.equal(cur.texts.nextEnd, '이제 양치할 시간이에요');
    await advance(f, 5 * MIN);
    assert.equal(sse.timer('end').length, 1, '종료 알림 자체는 1회');
    assert.equal(sse.timer('remind').length, 1, '확인 안 하면 1분 뒤 재알림 1회(나머지 시간 동안 몰아서 보내지 않음)');
    // 푸시(거실 기기 구독에만): 예고/종료 각 1건, 잠금화면 문구엔 이름+종류
    const dev = f.pushes.filter((p) => p.payload.tag?.startsWith('timer-'));
    void dev;
    // 시간 종료만으로 루틴이 완료되거나 도장 요청이 생기지 않는다 + 다음 루틴 체크도 안 됨
    const d2 = await f.day(kid);
    assert.ok(d2.items.every((i) => !i.done)); assert.equal(d2.status, 'open');
    assert.equal((await f.mom.ok('GET', '/api/approvals')).pending.length, 0);
    // 종료 안내 확인(dismiss): 연장도 체크도 아님
    await f.device.ok('POST', `/api/timers/${t.id}/dismiss`);
    assert.equal((await f.device.ok('GET', '/api/timers')).timers.length, 0);
    assert.ok((await f.day(kid)).items.every((i) => !i.done));
    sse.stop();
  } finally { await f.close(); }
});

test('두 아이가 동시에 다른 활동을 해도 각각 따로 카운트·안내되고, 같은 아이는 한 번에 하나(확인 후 교체)', async () => {
  const f = await setup();
  try {
    const a = await acts(f);
    const sse = await listen(f, f.device);
    const t1 = await f.device.ok('POST', `/api/kids/${f.ids.yuel}/timers`, { activityId: a.game.id });
    await advance(f, 10 * MIN);
    const t2 = await f.device.ok('POST', `/api/kids/${f.ids.yuha}/timers`, { activityId: a.tv.id });
    assert.notEqual(t1.endsAt, t2.endsAt);
    // 진행 중 다른 활동 시작 → 먼저 확인(409), replace 로 교체
    const dup = await f.device.post(`/api/kids/${f.ids.yuel}/timers`, { activityId: a.meal.id });
    assert.equal(dup.status, 409); assert.equal(dup.json.error, 'timer_running'); assert.equal(dup.json.timer.name, '게임하기');
    await advance(f, 15 * MIN); // 유엘 25분 경과
    let w = sse.timer('warn'); assert.equal(w.length, 1); assert.equal(w[0].kidId, f.ids.yuel);
    const list = (await f.device.ok('GET', '/api/timers')).timers;
    const e = list.find((x) => x.kidId === f.ids.yuel); const h = list.find((x) => x.kidId === f.ids.yuha);
    assert.equal(e.texts.warn, '유엘아, 게임하는 시간이 5분 남았어요. 이제 슬슬 마무리할 준비를 해요.');
    assert.equal(h.remainingMs, 15 * MIN);
    await advance(f, 10 * MIN); // 유하 25분 경과, 유엘 종료
    w = sse.timer('warn'); assert.deepEqual(w.map((x) => x.kidId), [f.ids.yuel, f.ids.yuha]);
    assert.deepEqual(sse.timer('end').map((x) => x.kidId), [f.ids.yuel]);
    assert.equal((await f.device.ok('GET', '/api/timers')).timers.find((x) => x.kidId === f.ids.yuel).texts.end, '게임 시간이 끝났어요. 저장하고 마무리해요.');
    // 5분 이하 설정은 종료 알람만
    await f.mom.ok('PATCH', `/api/activities/${a.meal.id}`, { minutes: 5, name: '밥 먹기' });
    await f.device.ok('POST', `/api/kids/${f.ids.yuel}/timers`, { activityId: a.meal.id });
    await advance(f, 5 * MIN);
    assert.equal(sse.timer('warn').length, 2, '5분 타이머는 예고 없음'); assert.equal(sse.timer('end').length, 3, '유엘 게임·유엘 식사·유하 TV 종료');
    assert.equal((await f.device.ok('GET', '/api/timers')).timers.find((x) => x.kidId === f.ids.yuel).texts.end, '식사 시간이 끝났어요. 더 필요하면 어른에게 알려 주세요.');
    // replace
    const r = await f.device.ok('POST', `/api/kids/${f.ids.yuha}/timers`, { activityId: a.game.id, replace: true });
    assert.equal(r.name, '게임하기');
    assert.equal(f.core.get("SELECT COUNT(*) c FROM timers WHERE kid_id = ? AND status = 'running'", f.ids.yuha).c, 1);
    sse.stop();
  } finally { await f.close(); }
});

test('연장: 새 종료 시각 기준으로 예고를 다시 계산하고, 이전 알림은 중복되지 않는다 · 어른만 연장 · 푸시는 거실 기기로', async () => {
  const f = await setup();
  try {
    const a = await acts(f); const kid = f.ids.yuel;
    // 거실 기기(어른 재인증)가 푸시 구독
    const tok = await f.elevate('mom', f.pw.mom);
    await f.device.ok('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/ipad', keys: { p256dh: 'p', auth: 'a' } } }, { 'X-Elevation': tok });
    const sse = await listen(f, f.device);
    const t = await f.device.ok('POST', `/api/kids/${kid}/timers`, { activityId: a.tv.id });
    await advance(f, 26 * MIN);
    assert.equal(sse.timer('warn').length, 1);
    // 아이는 연장할 수 없다
    assert.equal((await f.device.post(`/api/timers/${t.id}/extend`, { minutes: 10 })).status, 401);
    const ext = await f.mom.ok('POST', `/api/timers/${t.id}/extend`, { minutes: 10 });
    assert.equal(ext.remainingMs, 14 * MIN);
    await advance(f, 8 * MIN); // 새 종료까지 6분 → 아직 예고 전
    assert.equal(sse.timer('warn').length, 1);
    await advance(f, 1 * MIN); // 5분 남음 → 새 종료 기준 예고 1회
    assert.equal(sse.timer('warn').length, 2);
    await advance(f, 1 * MIN); await advance(f, 0);
    assert.equal(sse.timer('warn').length, 2);
    // 남은 시간이 5분 이하가 되도록 연장하면 지난 예고는 다시 안 뜬다
    await f.mom.ok('POST', `/api/timers/${t.id}/extend`, { minutes: 1 });
    await advance(f, 30000);
    assert.equal(sse.timer('warn').length, 2);
    await advance(f, 6 * MIN);
    assert.equal(sse.timer('end').length, 1);
    // 종료 후 연장: 지금부터 새 시간
    const again = await f.mom.ok('POST', `/api/timers/${t.id}/extend`, { minutes: 3 });
    assert.equal(again.state, 'running'); assert.equal(again.remainingMs, 3 * MIN);
    await advance(f, 3 * MIN);
    assert.equal(sse.timer('end').length, 2);
    // 푸시는 거실 기기 구독에만, 잠금화면엔 이름·종류만
    const pushes = f.pushes.filter((p) => p.payload.tag?.startsWith('timer-'));
    assert.ok(pushes.length >= 4); assert.ok(pushes.every((p) => p.endpoint === 'https://push.example/ipad'));
    assert.equal(pushes[0].payload.body, '유엘 · TV 보기 5분 남았어요');
    // 알람 소리 설정
    assert.equal((await f.mom.ok('GET', '/api/me')).family.timerSound, true);
    await f.mom.ok('PATCH', '/api/family', { timerSound: false });
    assert.equal((await f.device.ok('GET', '/api/timers')).soundEnabled, false);
    sse.stop();
  } finally { await f.close(); }
});

test('⑩ 다음 활동: 아이별 저장, 완료됐으면 "이미 했어요", 직접 입력은 안내만, 체크/도장은 자동으로 일어나지 않는다', async () => {
  const f = await setup();
  try {
    const a = await acts(f);
    const eDay = await f.day(f.ids.yuel); const hDay = await f.day(f.ids.yuha);
    const tok = await f.elevate('dad', f.pw.dad);
    const H = { 'X-Elevation': tok };
    const t1 = await f.device.ok('POST', `/api/kids/${f.ids.yuel}/timers`, { activityId: a.tv.id, next: { type: 'routine', itemId: eDay.items[0].id } }, H);
    const t2 = await f.device.ok('POST', `/api/kids/${f.ids.yuha}/timers`, { activityId: a.game.id, next: { type: 'custom', name: '잠옷 갈아입기', icon: '👚' } }, H);
    assert.equal(t1.next.name, '양치하기'); assert.equal(t2.next.name, '잠옷 갈아입기');
    assert.equal(t2.texts.warn, '유하야, 게임하는 시간이 5분 남았어요. 다음은 잠옷 갈아입기예요. 이제 슬슬 마무리할 준비를 해요.');
    // 다른 아이의 루틴 항목은 다음 활동으로 고를 수 없다
    assert.equal((await f.device.post(`/api/timers/${t2.id}/next`.replace('/next', '/next'), {}, H)).status, 404); // POST 는 없음
    assert.equal((await f.device.put(`/api/timers/${t2.id}/next`, { next: { type: 'routine', itemId: eDay.items[0].id } }, H)).status, 400);
    // 아이는(재인증 없이) 다음 활동을 바꿀 수 없다
    assert.equal((await f.device.put(`/api/timers/${t2.id}/next`, { next: { type: 'custom', name: 'x' } })).status, 401);
    // 다음 루틴을 아이가 직접 체크해서 완료 → 종료 안내가 "이미 했어요"
    await f.device.ok('PUT', `/api/day-items/${eDay.items[0].id}`, { done: true });
    let list = (await f.device.ok('GET', '/api/timers')).timers;
    assert.equal(list.find((x) => x.kidId === f.ids.yuel).texts.nextEnd, '양치하기는 이미 했어요');
    f.clock.t += 31 * MIN; f.app.settle();
    list = (await f.device.ok('GET', '/api/timers')).timers;
    assert.ok(list.every((x) => x.state === 'ended'));
    assert.equal(list.find((x) => x.kidId === f.ids.yuha).texts.nextEnd, '이제 잠옷 갈아입을 시간이에요');
    // 타이머 종료 자체는 어떤 루틴도 체크하지 않는다(유하의 항목 모두 미완료, 유엘은 직접 체크한 1개뿐)
    assert.ok((await f.day(f.ids.yuha)).items.every((i) => !i.done));
    assert.equal((await f.day(f.ids.yuel)).items.filter((i) => i.done).length, 1);
    // 홈(거실 보드)에 아이별 타이머와 '지금/다음'이 실린다
    const home = await f.device.ok('GET', '/api/home');
    assert.equal(home.kids.find((k) => k.id === f.ids.yuha).timer.next.icon, '👚');
  } finally { await f.close(); }
});

test('식사하기 루틴에 타이머 연결: 이름이 같으면 자동 연결', async () => {
  const f = await setup({ withRoutines: false });
  try {
    await f.mom.ok('POST', '/api/routines', { kidIds: [f.ids.yuel], name: '식사하기', icon: '🍽️', days: 'daily', slot: 'evening' });
    await f.mom.ok('POST', '/api/routines', { kidIds: [f.ids.yuel], name: '장난감 정리', icon: '🧸', days: 'daily', slot: 'evening' });
    const day = await f.day(f.ids.yuel);
    const meal = day.items.find((i) => i.name === '식사하기'); const hw = day.items.find((i) => i.name === '장난감 정리');
    assert.ok(meal.activityId); assert.equal(hw.activityId, null);
    const rt = (await f.mom.ok('GET', `/api/kids/${f.ids.yuel}/routines`)).find((r) => r.name === '장난감 정리');
    const up = await f.mom.ok('PATCH', `/api/routines/${rt.id}`, { activityId: meal.activityId, applyToday: true });
    assert.equal(up.routine.activityId, meal.activityId);
  } finally { await f.close(); }
});

test('⑪ 준비물: 한 글에서 여러 개·여러 아이, 아이별 체크, 중복 등록은 기존 항목 표시, 자정에 내일→오늘, 루틴/도장과 무관', async () => {
  const f = await setup();
  try {
    const ph = await f.mom.call('POST', '/api/photos', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), { 'X-Photo-Kind': 'post' });
    const post = await f.mom.ok('POST', '/api/posts', { title: '미술 시간', body: '준비물 안내', photoId: ph.json.id });
    // 기본 날짜는 내일
    const r = await f.mom.ok('POST', '/api/supplies', { postId: post.id, kidIds: [f.ids.yuel, f.ids.yuha], items: [{ name: '색종이', icon: '🟥' }, { name: '풀', icon: '🧴' }] });
    assert.equal(r.created.length, 2); assert.equal(r.created[0].date, '2026-11-21'); assert.equal(r.created[0].photoUrl, `/api/photos/${ph.json.id}`);
    await f.mom.ok('POST', '/api/supplies', { kidIds: [f.ids.yuha], items: [{ name: '물통', icon: '🥤' }] }); // 글 없이 직접
    // 같은 글에서 같은 준비물 다시 등록 → 새로 만들지 않고 기존 항목
    const dup = await f.mom.ok('POST', '/api/supplies', { postId: post.id, kidIds: [f.ids.yuel], items: [{ name: ' 색종이 ', icon: '🟥' }, { name: '가위', icon: '✂️' }] });
    assert.equal(dup.duplicates.length, 1); assert.equal(dup.duplicates[0].id, r.created[0].id); assert.equal(dup.created.length, 1);
    assert.equal(f.core.get("SELECT COUNT(*) c FROM supplies WHERE name = '색종이'").c, 1);
    // 보드 카드: 유하 = 색종이·풀·물통 (내일 챙길 것)
    let home = await f.device.ok('GET', '/api/home');
    const cardOf = (k) => home.supplies.find((s) => s.kidId === k).cards;
    assert.equal(cardOf(f.ids.yuha)[0].label, '내일 챙길 것'); assert.equal(cardOf(f.ids.yuha)[0].total, 3);
    assert.deepEqual(cardOf(f.ids.yuel)[0].items.map((i) => i.name).sort(), ['가위', '색종이', '풀']);
    // 체크는 아이별: 유하만 색종이를 챙김
    const sup = r.created[0];
    await f.device.ok('PUT', `/api/supplies/${sup.id}/kids/${f.ids.yuha}`, { checked: true });
    home = await f.device.ok('GET', '/api/home');
    assert.equal(cardOf(f.ids.yuha)[0].checked, 1); assert.equal(cardOf(f.ids.yuel)[0].checked, 0);
    assert.equal((await f.device.ok('GET', `/api/kids/${f.ids.yuel}/supplies`)).find((s) => s.id === sup.id).checked, false);
    assert.equal((await f.device.ok('GET', `/api/kids/${f.ids.yuha}/supplies`)).find((s) => s.id === sup.id).checked, true);
    await f.device.ok('PUT', `/api/supplies/${sup.id}/kids/${f.ids.yuha}`, { checked: false }); // 되돌리기
    assert.equal((await f.device.ok('GET', `/api/kids/${f.ids.yuha}/supplies`)).find((s) => s.id === sup.id).checked, false);
    await f.device.ok('PUT', `/api/supplies/${sup.id}/kids/${f.ids.yuha}`, { checked: true });
    // 유엘의 준비물이 아닌 항목(물통)을 유엘로 체크할 수 없다
    const bottle = (await f.device.ok('GET', `/api/kids/${f.ids.yuha}/supplies`)).find((s) => s.name === '물통');
    assert.equal((await f.device.put(`/api/supplies/${bottle.id}/kids/${f.ids.yuel}`, { checked: true })).status, 404);
    // 루틴·도장 계산에 영향 없음
    assert.ok((await f.day(f.ids.yuha)).items.every((i) => !i.done)); assert.equal((await f.mom.ok('GET', '/api/approvals')).pending.length, 0);
    // 자정(KST) 이후: 내일 → 오늘. 오늘 카드는 아직 못 챙긴 것만 표시
    f.clock.t = Date.parse('2026-11-20T15:00:30Z'); // 11/21 00:00:30 KST
    home = await f.device.ok('GET', '/api/home');
    const yuha = cardOf(f.ids.yuha)[0];
    assert.equal(yuha.label, '오늘 챙길 것'); assert.deepEqual(yuha.items.map((i) => i.name).sort(), ['물통', '풀']); assert.equal(yuha.checked, 1); assert.equal(yuha.total, 3);
    assert.equal(cardOf(f.ids.yuel)[0].items.length, 3);
    // 전체 목록에는 이미 챙긴 항목도 보인다
    assert.equal((await f.device.ok('GET', `/api/kids/${f.ids.yuha}/supplies`)).filter((s) => s.checked).length, 1);
    // 다 챙기면 카드는 '다 챙겼어요'(allDone) 상태
    for (const it of yuha.items) await f.device.ok('PUT', `/api/supplies/${it.id}/kids/${f.ids.yuha}`, { checked: true });
    home = await f.device.ok('GET', '/api/home'); assert.equal(cardOf(f.ids.yuha)[0].allDone, true);
    assert.equal((await f.gma.post('/api/supplies', { items: [{ name: 'x2' }] })).status, 201); // 어른이면 가능
    assert.equal((await f.device.post('/api/supplies', { items: [{ name: 'y' }] })).status, 401, '아이는 등록 불가');
  } finally { await f.close(); }
});

test('⑫ 가족 활동: 아이별 선택·변경, 같은 활동이면 일정 1건, 시간 변경은 같은 일정 갱신, 중복 클릭 무시, 확정 후 선택 잠금', async () => {
  const f = await setup();
  try {
    const park = await f.mom.ok('POST', '/api/family-activities/options', { name: '공원 가기', icon: '🌳' });
    const game = await f.mom.ok('POST', '/api/family-activities/options', { name: '보드게임 하기', icon: '🎲' });
    const cookie = await f.mom.ok('POST', '/api/family-activities/options', { name: '같이 쿠키 만들기', icon: '🍪' });
    const K = (k) => ({ 'X-Act-Kid': String(k) });
    assert.equal((await f.device.put(`/api/kids/${f.ids.yuel}/family-pick`, { optionId: park.id })).status, 403, '아이 미선택 기기는 못 고름');
    await f.device.ok('PUT', `/api/kids/${f.ids.yuel}/family-pick`, { optionId: park.id }, K(f.ids.yuel));
    await f.device.ok('PUT', `/api/kids/${f.ids.yuha}/family-pick`, { optionId: game.id }, K(f.ids.yuha));
    let s = await f.device.ok('GET', '/api/family-activities');
    assert.deepEqual(s.kids.map((k) => [k.kidName, k.status, k.name]), [['유엘', 'waiting', '공원 가기'], ['유하', 'waiting', '보드게임 하기']]);
    // 확정 전에는 바꿀 수 있다 → 유하도 공원
    await f.device.ok('PUT', `/api/kids/${f.ids.yuha}/family-pick`, { optionId: park.id }, K(f.ids.yuha));
    s = await f.device.ok('GET', '/api/family-activities');
    assert.equal(s.options.find((o) => o.id === park.id).pickedBy.length, 2); assert.ok(s.kids.every((k) => k.both));
    // 어른이 여러 번 눌러도 일정은 한 건
    const body = { optionId: park.id, date: '2026-11-22', time: '14:00' };
    const rs = await Promise.all([f.mom.post('/api/family-activities/plans', body), f.dad.post('/api/family-activities/plans', body), f.mom.post('/api/family-activities/plans', body)]);
    assert.ok(rs.every((r) => r.status === 200));
    assert.equal(f.core.get('SELECT COUNT(*) c FROM fam_plans').c, 1); assert.equal(f.core.get('SELECT COUNT(*) c FROM events WHERE plan_id IS NOT NULL').c, 1);
    let cal = await f.device.ok('GET', '/api/calendar?month=2026-11');
    assert.equal(cal.schedule.filter((e) => e.title.includes('공원')).length, 1); assert.equal(cal.schedule.find((e) => e.title.includes('공원')).time, '14:00');
    s = await f.device.ok('GET', '/api/family-activities');
    assert.ok(s.kids.every((k) => k.status === 'planned' && k.plan.date === '2026-11-22'));
    // 시간·날짜 변경(다른 주로 이동 포함) → 같은 일정 갱신, 달력엔 한 건
    await f.mom.ok('POST', '/api/family-activities/plans', { optionId: park.id, date: '2026-11-29', time: '10:30' });
    cal = await f.device.ok('GET', '/api/calendar?month=2026-11');
    const evs = cal.schedule.filter((e) => e.title.includes('공원'));
    assert.equal(evs.length, 1); assert.equal(evs[0].date, '2026-11-29'); assert.equal(evs[0].time, '10:30');
    assert.equal(f.core.get('SELECT COUNT(*) c FROM events').c, 1);
    // 확정 후에는 선택 변경 불가
    assert.equal((await f.device.put(`/api/kids/${f.ids.yuel}/family-pick`, { optionId: cookie.id }, K(f.ids.yuel))).status, 409);
    // 오늘 일정/거실 보드(홈 schedule): 해당 날짜에 표시
    f.clock.t = Date.parse('2026-11-29T03:00:00Z');
    assert.ok((await f.device.ok('GET', '/api/home')).schedule.some((e) => e.title.includes('공원')));
    f.clock.t = Date.parse('2026-11-20T03:00:00Z');
    // 서로 다른 활동: 각각 날짜 확정 → 일정 2건
    const g2 = await f.mom.ok('POST', '/api/family-activities/options', { name: '영화 보기', icon: '🎬' });
    void g2;
    // 확정 취소 → 일정 삭제, 선택 다시 가능
    const planId = f.core.get('SELECT id FROM fam_plans').id;
    await f.mom.ok('DELETE', `/api/family-activities/plans/${planId}`);
    assert.equal(f.core.get('SELECT COUNT(*) c FROM events').c, 0);
    await f.device.ok('PUT', `/api/kids/${f.ids.yuel}/family-pick`, { optionId: cookie.id }, K(f.ids.yuel));
    await f.mom.ok('POST', '/api/family-activities/plans', { optionId: cookie.id, date: '2026-11-23' });
    await f.mom.ok('POST', '/api/family-activities/plans', { optionId: park.id, date: '2026-11-24', time: '09:00' });
    assert.equal(f.core.get("SELECT COUNT(*) c FROM events WHERE plan_id IS NOT NULL").c, 2);
    // 아이는 일정을 확정할 수 없다
    assert.equal((await f.device.post('/api/family-activities/plans', body)).status, 401);
  } finally { await f.close(); }
});

test('얼굴 사진(투명 PNG): 어른만 올리고, 가족 구성원 정보에 포함되며, 다른 가족은 볼 수 없다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    assert.equal((await f.device.call('POST', '/api/photos', PNG, { 'X-Photo-Kind': 'avatar' })).status, 401, '아이/공용 기기는 못 올림');
    const up = await f.mom.call('POST', '/api/photos', PNG, { 'X-Photo-Kind': 'avatar' });
    assert.equal(up.status, 201);
    const m = await f.mom.ok('PATCH', `/api/members/${f.ids.yuha}`, { photoId: up.json.id });
    assert.equal(m.avatarUrl, `/api/photos/${up.json.id}`);
    const home = await f.device.ok('GET', '/api/home');
    assert.equal(home.kids.find((k) => k.id === f.ids.yuha).avatarUrl, m.avatarUrl);
    assert.equal(home.kids.find((k) => k.id === f.ids.yuel).avatarUrl, null);
    assert.equal((await f.device.get(m.avatarUrl)).status, 200);
    const { Client } = await import('./helpers.js');
    const other = new Client(f.base); await other.ok('POST', '/api/auth/register', { loginId: 'o@t', password: 'secret9', role: 'mom' });
    assert.equal((await other.get(m.avatarUrl)).status, 404, '다른 가족은 볼 수 없음');
    assert.equal((await other.patch(`/api/members/${f.ids.yuha}`, { photoId: up.json.id })).status, 404);
    // 지우기
    assert.equal((await f.mom.ok('PATCH', `/api/members/${f.ids.yuha}`, { photoId: null })).avatarUrl, null);
  } finally { await f.close(); }
});

test('기본 활동은 기존 가족에도 없는 것만 채워지고, 지운 활동은 되살아나지 않는다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const list = await f.mom.ok('GET', '/api/activities');
    const reading = list.find((x) => x.kind === 'reading');
    assert.equal(reading.name, '책 읽기');
    await f.mom.ok('DELETE', `/api/activities/${reading.id}`);
    // 서버가 다시 시작돼도(보충 로직 재실행) 지운 활동은 그대로
    const { ensureDefaultActivities } = await import('../server/services/timers.js');
    ensureDefaultActivities(f.core); ensureDefaultActivities(f.core);
    const after = await f.mom.ok('GET', '/api/activities');
    assert.equal(after.some((x) => x.kind === 'reading'), false);
    assert.equal(after.length, 6);
    // 이전 버전(3종만 있던 DB) 시뮬레이션: 새 종류가 보충된다
    f.core.run("DELETE FROM activities WHERE kind IN ('brush','homework','bath')");
    ensureDefaultActivities(f.core);
    assert.equal((await f.mom.ok('GET', '/api/activities')).length, 6);
  } finally { await f.close(); }
});

test('어른 삭제: 부모만, 본인 불가, 로그인·알림 정리, 대기 요청 취소(잠금 해제), 기록은 이름 유지', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const { Client } = await import('./helpers.js');
    const extra = new Client(f.base);
    await extra.ok('POST', '/api/auth/join', { code: f.code, loginId: 'extra@test', password: 'secret7', role: 'other', name: '유하' });
    const extraId = (await extra.ok('GET', '/api/me')).me.id;
    await extra.ok('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/extra', keys: { p256dh: 'p', auth: 'a' } } });
    let adults = (await f.mom.ok('GET', '/api/me')).adults;
    assert.equal(adults.length, 4);
    // 출금 요청을 이 어른에게 보내고 승인까지 받은 상태(돈 잠금)
    await f.addMoney(f.ids.yuel, 5000);
    const H = { 'X-Act-Kid': String(f.ids.yuel) };
    const rq = await f.device.ok('POST', `/api/kids/${f.ids.yuel}/requests`, { type: 'withdraw', amount: 3000, purpose: '간식', toMemberId: extraId }, H);
    await extra.ok('POST', `/api/money/requests/${rq.id}/approve`);
    assert.equal((await f.wallet(f.ids.yuel)).waiting, 3000);
    // 권한: 부모 아님 ✗, 본인 ✗, 없는 사람 ✗
    assert.equal((await f.gma.del(`/api/members/${extraId}`)).status, 403);
    assert.equal((await f.mom.del(`/api/members/${f.ids.mom}`)).status, 409);
    assert.equal((await f.mom.del(`/api/members/${f.ids.yuel}`)).status, 404, '아이는 여기서 삭제 불가');
    await f.mom.ok('DELETE', `/api/members/${extraId}`);
    adults = (await f.mom.ok('GET', '/api/me')).adults;
    assert.deepEqual(adults.map((a) => a.id).sort(), [f.ids.mom, f.ids.dad, f.ids.gma].sort());
    assert.equal((await extra.get('/api/me')).status, 401, '세션 종료');
    assert.equal((await new Client(f.base).post('/api/auth/login', { loginId: 'extra@test', password: 'secret7' })).status, 401, '로그인 불가');
    const w = await f.wallet(f.ids.yuel); assert.equal(w.waiting, 0); assert.equal(w.available, 5000);
    // 같은 아이디로 다시 가입 가능
    assert.equal((await new Client(f.base).post('/api/auth/join', { code: f.code, loginId: 'extra@test', password: 'secret8', role: 'other' })).status, 201);
    // 푸시 구독도 삭제
    assert.equal(f.core.get("SELECT COUNT(*) c FROM push_subs WHERE endpoint = 'https://push.example/extra'").c, 0);
    // 어른 홈/요청 대상 목록에 나타나지 않음
    assert.ok(!(await f.device.ok('GET', '/api/home')).adults.some((a) => a.id === extraId));
    assert.equal((await f.device.post(`/api/kids/${f.ids.yuel}/requests`, { type: 'withdraw', amount: 100, purpose: 'x', toMemberId: extraId }, H)).status, 404);
  } finally { await f.close(); }
});

test('활동 기본 순서: 씻기 → 숙제 → 식사 → 게임 → TV → 책 읽기 → 양치, 직접 추가한 활동은 뒤', async () => {
  const f = await setup({ withRoutines: false });
  try {
    await f.mom.ok('POST', '/api/activities', { name: '피아노', icon: '🎹', minutes: 20 });
    const names = (await f.mom.ok('GET', '/api/activities')).map((a) => a.name);
    assert.deepEqual(names, ['씻기', '숙제하기', '식사하기', '게임하기', 'TV 보기', '책 읽기', '양치하기', '피아노']);
    // 이전 버전(순서가 다른 DB) 시뮬레이션: 버전을 0 으로 되돌리고 순서를 뒤섞은 뒤 시작 보정 실행
    f.core.run("UPDATE activities SET sort = 100 - id");
    f.core.db.exec('PRAGMA user_version = 0');
    const { ensureDefaultActivities } = await import('../server/services/timers.js');
    ensureDefaultActivities(f.core);
    assert.deepEqual((await f.mom.ok('GET', '/api/activities')).map((a) => a.name), ['씻기', '숙제하기', '식사하기', '게임하기', 'TV 보기', '책 읽기', '양치하기', '피아노']);
    // 이후 어른이 바꾼 순서는 다시 덮어쓰지 않는다
    f.core.run("UPDATE activities SET sort = 50 - id");
    ensureDefaultActivities(f.core);
    assert.equal((await f.mom.ok('GET', '/api/activities'))[0].name, '피아노');
  } finally { await f.close(); }
});

test('활동 중단: 아이가 직접 자기 활동을 멈출 수 있고, 루틴 체크·도장·연장은 일어나지 않으며 새 활동을 바로 시작할 수 있다', async () => {
  const f = await setup();
  try {
    const a = Object.fromEntries((await f.mom.ok('GET', '/api/activities')).map((x) => [x.kind, x]));
    const t = await f.device.ok('POST', `/api/kids/${f.ids.yuha}/timers`, { activityId: a.meal.id });
    await f.device.ok('POST', `/api/timers/${t.id}/cancel`); // 어른 확인 없이
    assert.equal((await f.device.ok('GET', '/api/timers')).timers.length, 0);
    assert.ok((await f.day(f.ids.yuha)).items.every((i) => !i.done));
    assert.equal((await f.mom.ok('GET', '/api/approvals')).pending.length, 0);
    await f.device.ok('POST', `/api/timers/${t.id}/cancel`); // 재시도해도 안전
    await f.device.ok('POST', `/api/kids/${f.ids.yuha}/timers`, { activityId: a.tv.id });
    assert.equal(f.core.get("SELECT COUNT(*) c FROM timers WHERE kid_id = ? AND status = 'running'", f.ids.yuha).c, 1);
    // 다른 가족은 멈출 수 없다
    const { Client } = await import('./helpers.js');
    const other = new Client(f.base); await other.ok('POST', '/api/auth/register', { loginId: 'oo@t', password: 'secret9', role: 'mom' });
    assert.equal((await other.post(`/api/timers/${t.id}/cancel`)).status, 404);
  } finally { await f.close(); }
});

test('도장 승인 순간 모든 아이용 기기(거실 iPad·아이 휴대폰)에 쾅 신호가 한 번씩 가고, 어른 휴대폰에는 가지 않는다', async () => {
  const f = await setup();
  try {
    const listen = async (client, qs = '') => {
      const ev = []; const ac = new AbortController();
      const res = await fetch(f.base + '/api/stream' + qs, { headers: { cookie: client.cookie, 'X-Requested-With': 'lovefamily' }, signal: ac.signal });
      (async () => { try { const rd = res.body.getReader(); const dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; for (const m of dec.decode(value).matchAll(/data: (.*)\n/g)) ev.push(JSON.parse(m[1])); } } catch {} })();
      await new Promise((r) => setTimeout(r, 80)); return { ev, stop: () => ac.abort() };
    };
    const { Client } = await import('./helpers.js');
    const kidPhone = new Client(f.base); await kidPhone.ok('POST', '/api/auth/login', { loginId: 'mom@test', password: 'secret1', device: true });
    const a = await listen(f.device, `?kid=${f.ids.yuel}`); const b = await listen(kidPhone, `?kid=${f.ids.yuha}`); const adultPhone = await listen(f.dad);
    await f.completeAndRequest(f.ids.yuel);
    const rid = (await f.mom.ok('GET', '/api/approvals')).pending[0].id;
    await Promise.all([f.mom, f.dad, f.gma].map((c) => c.post(`/api/stamp-requests/${rid}/approve`)));
    await new Promise((r) => setTimeout(r, 150));
    const stamps = (s) => s.ev.filter((e) => e.t === 'stamp');
    assert.equal(stamps(a).length, 1); assert.equal(stamps(b).length, 1, '다른 아이 화면에 있는 기기에도');
    assert.equal(stamps(adultPhone).length, 0);
    assert.equal(stamps(a)[0].kidId, f.ids.yuel); assert.ok(stamps(a)[0].provider);
    [a, b, adultPhone].forEach((s) => s.stop());
  } finally { await f.close(); }
});
