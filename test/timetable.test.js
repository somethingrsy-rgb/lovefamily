import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, Client } from './helpers.js';

// 기준 시각: 금요일 12:00(KST)
test('시간표: 어른이 요일·시각·이름을 정해 만들고, 겹치면 거절하고, 아이는 보기만 한다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const kid = f.ids.yuel; const url = `/api/kids/${kid}/timetable`;
    // 월·수에 같은 수업을 한 번에
    const c = await f.mom.ok('POST', url, { days: [1, 3], start: '13:10', end: '13:50', title: '과학교실', place: '4층 과학3', color: '#d7ecff' });
    assert.equal(c.created.length, 2); assert.deepEqual(c.created.map((x) => x.dow), [1, 3]);
    assert.equal(c.created[0].start, '13:10'); assert.equal(c.created[0].place, '4층 과학3');
    // 검증
    assert.equal((await f.mom.call('POST', url, { days: [1], start: '13:30', end: '14:00', title: '겹침' })).status, 409, '같은 요일 시간 겹침');
    assert.equal((await f.mom.call('POST', url, { days: [2], start: '13:30', end: '13:30', title: '길이 0' })).status, 400);
    assert.equal((await f.mom.call('POST', url, { days: [2], start: '25:00', end: '26:00', title: '시각' })).status, 400);
    assert.equal((await f.mom.call('POST', url, { days: [8], start: '10:00', end: '11:00', title: '요일' })).status, 400);
    assert.equal((await f.mom.call('POST', url, { days: [], start: '10:00', end: '11:00', title: '요일 없음' })).status, 400);
    assert.equal((await f.mom.call('POST', url, { days: [2], start: '10:00', end: '11:00', title: '' })).status, 400);
    // 한 요일이라도 겹치면 전체가 취소된다(일부만 만들어지지 않는다)
    assert.equal((await f.mom.call('POST', url, { days: [2, 3], start: '13:00', end: '13:20', title: '부분 겹침' })).status, 409);
    assert.equal((await f.mom.ok('GET', url)).items.filter((x) => x.dow === 2).length, 0, '화요일에도 만들어지지 않았다');
    // 아이(거실 기기)와 다른 어른 계정: 보기만
    assert.equal((await f.device.call('POST', url, { days: [4], start: '10:00', end: '11:00', title: '못 만듦' })).status, 401);
    const t = await f.device.ok('GET', url);
    assert.equal(t.items.length, 2); assert.equal(t.today, 5, '금요일'); assert.equal(t.nowMin, 12 * 60);
    // 수정·삭제
    const id = c.created[0].id;
    const u = await f.mom.ok('PATCH', `/api/timetable/${id}`, { title: '실험과학', end: '14:00', color: '#e4d6ff' });
    assert.equal(u.title, '실험과학'); assert.equal(u.end, '14:00'); assert.equal(u.start, '13:10');
    assert.equal((await f.mom.call('PATCH', `/api/timetable/${id}`, { start: '15:00' })).status, 400, '끝보다 늦은 시작');
    assert.equal((await f.dad.ok('DELETE', `/api/timetable/${c.created[1].id}`)).ok, true);
    assert.equal((await f.mom.ok('GET', url)).items.length, 1);
  } finally { await f.close(); }
});

test('시간표: 홈 화면 아이 카드에 오늘의 지금·다음 수업이 나온다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const kid = f.ids.yuel; const url = `/api/kids/${kid}/timetable`;
    await f.mom.ok('POST', url, { days: [5], start: '11:30', end: '12:30', title: '축구', place: '운동장' });
    await f.mom.ok('POST', url, { days: [5], start: '13:00', end: '14:00', title: '영어' });
    await f.mom.ok('POST', url, { days: [1], start: '12:00', end: '13:00', title: '월요일 수업' });
    const h = await f.mom.ok('GET', '/api/home');
    const k = h.kids.find((x) => x.id === kid);
    assert.equal(k.timetable.now.title, '축구'); assert.equal(k.timetable.next.title, '영어'); assert.equal(k.timetable.count, 2, '오늘(금) 수업만');
    assert.equal(h.kids.find((x) => x.id === f.ids.yuha).timetable.now, null, '시간표가 없는 아이');
    f.clock.t += 90 * 60 * 1000; // 13:30
    const h2 = await f.mom.ok('GET', '/api/home');
    assert.equal(h2.kids.find((x) => x.id === kid).timetable.now.title, '영어'); assert.equal(h2.kids.find((x) => x.id === kid).timetable.next, null);
  } finally { await f.close(); }
});

test('시간표: 다른 가족의 아이·수업은 보이지도 바꿀 수도 없다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const c = await f.mom.ok('POST', `/api/kids/${f.ids.yuel}/timetable`, { days: [1], start: '09:00', end: '10:00', title: '우리 수업' });
    const other = new Client(f.base, 'other'); // 같은 서버의 다른 가족
    await other.ok('POST', '/api/auth/register', { loginId: 'other@test', password: 'secret9', kids: [{ name: '남', gender: 'boy' }] });
    assert.equal((await other.call('GET', `/api/kids/${f.ids.yuel}/timetable`)).status, 404);
    assert.equal((await other.call('POST', `/api/kids/${f.ids.yuel}/timetable`, { days: [1], start: '09:00', end: '10:00', title: '침입' })).status, 404);
    assert.equal((await other.call('DELETE', `/api/timetable/${c.created[0].id}`)).status, 404);
    assert.equal((await other.call('PATCH', `/api/timetable/${c.created[0].id}`, { title: '변경' })).status, 404);
    assert.equal((await f.mom.ok('GET', `/api/kids/${f.ids.yuel}/timetable`)).items[0].title, '우리 수업', '그대로 남아 있다');
  } finally { await f.close(); }
});
