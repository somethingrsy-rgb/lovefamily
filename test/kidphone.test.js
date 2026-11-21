import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, Client } from './helpers.js';

async function pairPhone(f, kidId) {
  const { code } = await f.mom.ok('POST', `/api/kids/${kidId}/pair-code`);
  const phone = new Client(f.base);
  const r = await phone.post('/api/auth/kid-pair', { code });
  return { phone, code, r };
}

test('연결 코드: 어른만 만들 수 있고, 한 번만 쓸 수 있으며, 틀리면 막힌다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    assert.equal((await f.device.post(`/api/kids/${f.ids.yuel}/pair-code`)).status, 401, '공용 기기(어른 확인 전)는 못 만든다');
    const { phone, code, r } = await pairPhone(f, f.ids.yuel);
    assert.equal(r.status, 201);
    const me = await phone.ok('GET', '/api/me');
    assert.equal(me.session.boundKid, f.ids.yuel); assert.equal(me.me, null); assert.equal(me.family.code, undefined, '가족 코드는 보이지 않는다');
    // 같은 코드 재사용 불가
    assert.equal((await new Client(f.base).post('/api/auth/kid-pair', { code })).status, 404);
    // 소문자·공백·하이픈도 허용(입력 편의)
    const c2 = (await f.mom.ok('POST', `/api/kids/${f.ids.yuha}/pair-code`)).code;
    assert.equal((await new Client(f.base).post('/api/auth/kid-pair', { code: ` ${c2.slice(0, 3).toLowerCase()}-${c2.slice(3)} ` })).status, 201);
    // 시간 지난 코드
    const c3 = (await f.mom.ok('POST', `/api/kids/${f.ids.yuel}/pair-code`)).code;
    f.clock.t += 11 * 60000;
    assert.equal((await new Client(f.base).post('/api/auth/kid-pair', { code: c3 })).status, 404);
    // 틀린 코드 반복은 제한된다
    const bad = new Client(f.base); let last;
    for (let i = 0; i < 10; i++) last = await bad.post('/api/auth/kid-pair', { code: 'WRONG' + i });
    assert.equal(last.status, 429);
    // 다른 가족 계정은 우리 아이 코드를 못 만든다
    const other = new Client(f.base); await other.ok('POST', '/api/auth/register', { loginId: 'o@t', password: 'secret9', role: 'mom' });
    assert.equal((await other.post(`/api/kids/${f.ids.yuel}/pair-code`)).status, 404);
  } finally { await f.close(); }
});

test('아이 폰은 자기 것만: 비밀번호 없이 내 저금통·메시지, 형제 것·어른 기능은 전부 막힌다', async () => {
  const f = await setup();
  try {
    await f.mom.ok('PUT', `/api/kids/${f.ids.yuel}/pin`, { pin: '1234' }); // 공용 기기에서는 비밀번호가 필요한 아이
    await f.addMoney(f.ids.yuel, 5000); await f.addMoney(f.ids.yuha, 3000);
    const { phone } = await pairPhone(f, f.ids.yuel);
    // 자기 것: 비밀번호 없이 OK
    assert.equal((await phone.ok('GET', `/api/kids/${f.ids.yuel}/wallet`)).balance, 5000);
    // 형제 것: 헤더로 속여도 불가(저금통·장부·요청·미션·메시지·사진)
    const spoof = { 'X-Act-Kid': String(f.ids.yuha) };
    for (const u of [`/api/kids/${f.ids.yuha}/wallet`, `/api/kids/${f.ids.yuha}/ledger`, `/api/kids/${f.ids.yuha}/wishes`, `/api/kids/${f.ids.yuha}/requests`, `/api/threads/${f.ids.yuha}/${f.ids.mom}`]) {
      assert.equal((await phone.get(u, spoof)).status, 403, u);
    }
    assert.equal((await phone.post('/api/messages', { kidId: f.ids.yuha, adultId: f.ids.dad, body: '위장' }, spoof)).status, 403);
    // 내 이름으로 메시지: 받는 어른에게만
    assert.equal((await phone.post('/api/messages', { kidId: f.ids.yuel, adultId: f.ids.dad, body: '안녕' })).status, 201);
    // 출금 요청 OK, 형제 이름으로는 불가
    assert.equal((await phone.post(`/api/kids/${f.ids.yuel}/requests`, { type: 'withdraw', amount: 1000, purpose: '간식', toMemberId: f.ids.mom })).status, 201);
    assert.equal((await phone.post(`/api/kids/${f.ids.yuha}/requests`, { type: 'withdraw', amount: 1000, purpose: 'x', toMemberId: f.ids.mom })).status, 403);
    // 어른 기능: 재인증 시도·승인·정정·연장·코드 생성 모두 막힘 (엄마 비밀번호를 알아도 불가)
    assert.equal((await phone.post('/api/auth/reauth', { memberId: f.ids.mom, password: f.pw.mom })).status, 403);
    assert.equal((await phone.post(`/api/kids/${f.ids.yuel}/adjust`, { amount: 100, reason: 'x' })).status, 403);
    assert.equal((await phone.get('/api/adult/home')).status, 403);
    assert.equal((await phone.post(`/api/kids/${f.ids.yuel}/pair-code`)).status, 403);
    assert.equal((await phone.post('/api/routines', { kidId: f.ids.yuel, name: 'x', days: 'daily' })).status, 403);
    assert.equal((await phone.put('/api/status', { state: 'home' })).status, 403);
    // 내 루틴 체크 OK, 형제 루틴 체크 불가
    const mine = await f.day(f.ids.yuel); const sib = await f.day(f.ids.yuha);
    assert.equal((await phone.put(`/api/day-items/${mine.items[0].id}`, { done: true })).status, 200);
    assert.equal((await phone.put(`/api/day-items/${sib.items[0].id}`, { done: true })).status, 403);
    // 활동(타이머): 내 것 시작·중단 OK, 형제 것은 불가, 연장은 어른만
    const a = Object.fromEntries((await f.mom.ok('GET', '/api/activities')).map((x) => [x.kind, x]));
    const t = await phone.ok('POST', `/api/kids/${f.ids.yuel}/timers`, { activityId: a.tv.id });
    assert.equal((await phone.post(`/api/kids/${f.ids.yuha}/timers`, { activityId: a.tv.id })).status, 403);
    assert.equal((await phone.post(`/api/timers/${t.id}/extend`, { minutes: 5 })).status, 403);
    assert.equal((await phone.post(`/api/timers/${t.id}/cancel`)).status, 200);
    // 도장 승인 불가
    await f.completeAndRequest(f.ids.yuha);
    const rid = (await f.mom.ok('GET', '/api/approvals')).pending[0].id;
    assert.equal((await phone.post(`/api/stamp-requests/${rid}/approve`)).status, 403);
  } finally { await f.close(); }
});

test('아이 폰 푸시: 그 아이에게 온 알림만 그 폰으로(잠금화면엔 짧은 문구), 형제·어른 폰에는 가지 않고, 연결 해제하면 끊긴다', async () => {
  const f = await setup();
  try {
    const A = await pairPhone(f, f.ids.yuel); const B = await pairPhone(f, f.ids.yuha);
    await A.phone.ok('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/yuel-phone', keys: { p256dh: 'p', auth: 'a' } } });
    await B.phone.ok('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/yuha-phone', keys: { p256dh: 'p', auth: 'a' } } });
    f.pushes.length = 0;
    await f.completeAndRequest(f.ids.yuel);
    const rid = (await f.mom.ok('GET', '/api/approvals')).pending[0].id;
    await f.mom.post(`/api/stamp-requests/${rid}/approve`);
    await f.flush();
    const toKid = f.pushes.filter((p) => p.endpoint.includes('phone'));
    assert.deepEqual(toKid.map((p) => p.endpoint), ['https://push.example/yuel-phone'], '유엘 폰에만');
    assert.match(toKid[0].payload.body, /도장/); assert.ok(!/\d{4}-\d\d/.test(toKid[0].payload.body));
    // 어른이 보낸 답장 → 그 아이 폰으로만
    f.pushes.length = 0;
    await f.dad.ok('POST', '/api/messages', { kidId: f.ids.yuha, adultId: f.ids.dad, body: '비밀 내용 123원' });
    await f.flush();
    const msg = f.pushes.filter((p) => p.endpoint.includes('phone'));
    assert.deepEqual(msg.map((p) => p.endpoint), ['https://push.example/yuha-phone']);
    assert.ok(!msg[0].payload.body.includes('비밀 내용'), '잠금화면에 본문 없음');
    // 활동(타이머) 푸시: 거실 기기 + 그 활동을 하는 아이의 폰(앱을 닫거나 화면이 잠겨 있어도). 형제 폰·어른 폰에는 가지 않는다
    f.pushes.length = 0;
    const tok = await f.elevate('mom', f.pw.mom);
    await f.device.ok('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/ipad', keys: { p256dh: 'p', auth: 'a' } } }, { 'X-Elevation': tok });
    const a = Object.fromEntries((await f.mom.ok('GET', '/api/activities')).map((x) => [x.kind, x]));
    await f.mom.ok('POST', `/api/kids/${f.ids.yuel}/timers`, { activityId: a.brush.id });
    f.clock.t += 6 * 60000; f.app.settle(); await f.flush();
    assert.ok(f.pushes.some((p) => p.endpoint === 'https://push.example/ipad'));
    const tp = f.pushes.filter((p) => p.endpoint.includes('phone'));
    assert.deepEqual([...new Set(tp.map((p) => p.endpoint))], ['https://push.example/yuel-phone'], '유엘 활동 알림은 유엘 폰에만');
    assert.ok(tp.some((p) => /5분|끝났/.test(p.payload.body)), '5분 남았어요/끝났어요 알림');
    assert.ok(tp.every((p) => p.payload.url === `/#/kid/${f.ids.yuel}/timer` && p.payload.sticky), '누르면 활동 화면, 눌러서 확인할 때까지 남는다');
    assert.ok(!f.pushes.some((p) => p.endpoint === 'https://push.example/mom' || p.endpoint === 'https://push.example/yuha-phone'), '어른·형제에게는 가지 않는다');
    // 연결 해제: 목록에 보이고, 해제하면 로그인·푸시가 모두 끊긴다
    const list = await f.mom.ok('GET', `/api/kids/${f.ids.yuel}/devices`);
    assert.equal(list.length, 1); assert.equal(list[0].push, true); assert.equal(list[0].label, '유엘의 휴대폰');
    assert.equal((await f.gma.del(`/api/kid-devices/${list[0].id}`)).status, 200, '어른이면 누구나 해제 가능');
    assert.equal((await A.phone.get('/api/me')).status, 401);
    assert.equal(f.core.get("SELECT COUNT(*) c FROM push_subs WHERE endpoint = 'https://push.example/yuel-phone'").c, 0);
    assert.equal((await B.phone.get('/api/me')).status, 200, '다른 아이 폰은 그대로');
    assert.equal((await f.device.del(`/api/kid-devices/${(await f.mom.ok('GET', `/api/kids/${f.ids.yuha}/devices`))[0].id}`)).status, 401, '아이/공용 기기는 해제 불가');
    // 로그아웃하면 그 폰의 푸시 구독도 정리된다
    await B.phone.ok('POST', '/api/auth/logout');
    assert.equal(f.core.get("SELECT COUNT(*) c FROM push_subs WHERE endpoint = 'https://push.example/yuha-phone'").c, 0);
  } finally { await f.close(); }
});

test('아이 폰은 실시간 도장 쾅 신호와 자기 알림 팝업을 받고, 형제의 활동 알림은 받지 않는다', async () => {
  const f = await setup();
  try {
    const A = await pairPhone(f, f.ids.yuel); const B = await pairPhone(f, f.ids.yuha);
    const listen = async (client) => {
      const ev = []; const ac = new AbortController();
      const res = await fetch(f.base + '/api/stream', { headers: { cookie: client.cookie, 'X-Requested-With': 'lovefamily' }, signal: ac.signal });
      (async () => { try { const rd = res.body.getReader(); const dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; for (const m of dec.decode(value).matchAll(/data: (.*)\n/g)) ev.push(JSON.parse(m[1])); } } catch {} })();
      await new Promise((r) => setTimeout(r, 80)); return { ev, stop: () => ac.abort() };
    };
    const sa = await listen(A.phone); const sb = await listen(B.phone);
    const a = Object.fromEntries((await f.mom.ok('GET', '/api/activities')).map((x) => [x.kind, x]));
    await f.mom.ok('POST', `/api/kids/${f.ids.yuel}/timers`, { activityId: a.brush.id });
    f.clock.t += 5 * 60000 + 1000; f.app.settle();
    await f.completeAndRequest(f.ids.yuel);
    const rid = (await f.mom.ok('GET', '/api/approvals')).pending[0].id;
    await f.mom.post(`/api/stamp-requests/${rid}/approve`);
    await new Promise((r) => setTimeout(r, 150));
    const of = (s, t) => s.ev.filter((e) => e.t === t);
    assert.equal(of(sa, 'stamp').length, 1); assert.equal(of(sb, 'stamp').length, 1, '도장 쾅은 모두에게');
    assert.equal(of(sa, 'timer').length, 1, '내 활동 종료 알림'); assert.equal(of(sb, 'timer').length, 0, '형제 활동 알림은 안 받는다');
    assert.equal(of(sa, 'notify').filter((e) => e.kind === 'stamp_approved').length, 1);
    assert.equal(of(sb, 'notify').filter((e) => e.kind === 'stamp_approved').length, 0);
    sa.stop(); sb.stop();
  } finally { await f.close(); }
});

test('집 안 걷기: 칸 위치가 가족 모든 기기에 공유되고, 잘못된 칸·다른 가족은 막힌다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const listen = async (client, qs = '') => {
      const ev = []; const ac = new AbortController();
      const res = await fetch(f.base + '/api/stream' + qs, { headers: { cookie: client.cookie, 'X-Requested-With': 'lovefamily' }, signal: ac.signal });
      (async () => { try { const rd = res.body.getReader(); const dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; for (const m of dec.decode(value).matchAll(/data: (.*)\n/g)) ev.push(JSON.parse(m[1])); } } catch {} })();
      await new Promise((r) => setTimeout(r, 80)); return { ev, stop: () => ac.abort() };
    };
    const sd = await listen(f.dad);
    assert.deepEqual((await f.device.ok('GET', '/api/home')).walkers, {}, '처음엔 각자 자기 방(저장된 위치 없음)');
    // 아이용 공용 기기에서 유엘을 확인방(12)으로
    await f.device.ok('PUT', `/api/walkers/${f.ids.yuel}`, { cell: '12' });
    await f.device.ok('PUT', `/api/walkers/${f.ids.mom}`, { cell: '00' }); // 거실
    await new Promise((r) => setTimeout(r, 120));
    const w = (await f.dad.ok('GET', '/api/home')).walkers;
    assert.equal(w[f.ids.yuel], '12'); assert.equal(w[f.ids.mom], '00');
    assert.ok(sd.ev.some((e) => e.t === 'refresh' && e.topics.includes('walkers')), '다른 기기에 실시간 신호');
    for (const bad of ['33', '3', 'ab', '', null, '1 2', '012']) assert.equal((await f.device.put(`/api/walkers/${f.ids.yuel}`, { cell: bad })).status, 400, String(bad));
    // 아이 폰도 움직일 수 있다 / 다른 가족 구성원은 못 움직인다
    const { Client } = await import('./helpers.js');
    const { code } = await f.mom.ok('POST', `/api/kids/${f.ids.yuha}/pair-code`);
    const phone = new Client(f.base); await phone.ok('POST', '/api/auth/kid-pair', { code });
    assert.equal((await phone.put(`/api/walkers/${f.ids.yuha}`, { cell: '10' })).status, 200);
    const other = new Client(f.base); await other.ok('POST', '/api/auth/register', { loginId: 'ow@t', password: 'secret9', role: 'mom' });
    assert.equal((await other.put(`/api/walkers/${f.ids.yuel}`, { cell: '00' })).status, 404);
    assert.equal((await new Client(f.base).put(`/api/walkers/${f.ids.yuel}`, { cell: '00' })).status, 401);
    assert.equal((await other.ok('GET', '/api/home')).walkers[f.ids.yuel], undefined, '다른 가족에겐 안 보인다');
    sd.stop();
  } finally { await f.close(); }
});

test('아이 폰: 우리집 대시보드(홈) 정보는 볼 수 있고, 걷기는 자기 캐릭터만 움직일 수 있다', async () => {
  const f = await setup({ withRoutines: true });
  try {
    const { phone } = await pairPhone(f, f.ids.yuel);
    const home = await phone.ok('GET', '/api/home');
    assert.equal(home.kids.length, 2); assert.ok(home.adults.length >= 2);
    assert.equal((await phone.get('/api/adult/home')).status, 403, '어른 전용 홈 패널은 안 열린다');
    assert.equal((await phone.put(`/api/walkers/${f.ids.yuel}`, { cell: '01' })).status, 200);
    assert.equal((await phone.put(`/api/walkers/${f.ids.yuha}`, { cell: '01' })).status, 403, '동생 캐릭터는 못 움직인다');
    assert.equal((await phone.put(`/api/walkers/${f.ids.mom}`, { cell: '01' })).status, 403, '어른 캐릭터도 못 움직인다');
    assert.equal((await f.mom.put(`/api/walkers/${f.ids.yuha}`, { cell: '01' })).status, 200, '어른은 그대로 가능');
  } finally { await f.close(); }
});

test('용돈을 받으면 그 아이 폰(과 거실 기기)에만 "저금통에 쏙" 신호가 가고, 형제 폰에는 가지 않는다', async () => {
  const f = await setup();
  try {
    const a = await pairPhone(f, f.ids.yuel); const b = await pairPhone(f, f.ids.yuha);
    const open = async (client) => {
      const ev = []; const ac = new AbortController();
      const res = await fetch(f.base + '/api/stream', { headers: { cookie: client.cookie, 'X-Requested-With': 'lovefamily' }, signal: ac.signal });
      (async () => { try { const rd = res.body.getReader(); const dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; for (const m of dec.decode(value).matchAll(/data: (.*)\n/g)) ev.push(JSON.parse(m[1])); } } catch {} })();
      await new Promise((r) => setTimeout(r, 80));
      return { ev, stop: () => ac.abort() };
    };
    const sa = await open(a.phone); const sb = await open(b.phone);
    await f.mom.ok('POST', `/api/kids/${f.ids.yuel}/deposits`, { amount: 3000, memo: '용돈' });
    await new Promise((r) => setTimeout(r, 150));
    const got = sa.ev.filter((e) => e.t === 'coins');
    assert.equal(got.length, 1); assert.equal(got[0].amount, 3000); assert.equal(got[0].dir, 'in');
    assert.equal(sb.ev.filter((e) => e.t === 'coins').length, 0, '동생 폰에는 가지 않는다');
    // 같은 입금(재시도)은 두 번 알리지 않는다 — 장부 중복 방지와 같은 키
    sa.stop(); sb.stop();
  } finally { await f.close(); }
});

test('아이가 누른 지폐·동전 그대로 저금통 모션 신호가 간다(500원 2번 → 500원 2개). 꺼낼 때도 똑같이 나온다. 합이 안 맞으면 금액만으로', async () => {
  const f = await setup();
  try {
    const { phone } = await pairPhone(f, f.ids.yuel);
    const ev = []; const ac = new AbortController();
    const res = await fetch(f.base + '/api/stream', { headers: { cookie: phone.cookie, 'X-Requested-With': 'lovefamily' }, signal: ac.signal });
    (async () => { try { const rd = res.body.getReader(); const dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; for (const m of dec.decode(value).matchAll(/data: (.*)\n/g)) ev.push(JSON.parse(m[1])); } } catch {} })();
    await new Promise((r) => setTimeout(r, 80));
    const coins = () => ev.filter((e) => e.t === 'coins');
    // 넣기: 500원 2번
    const d = await phone.ok('POST', `/api/kids/${f.ids.yuel}/requests`, { type: 'deposit', amount: 1000, pieces: [500, 500], purpose: '용돈', toMemberId: f.ids.mom });
    await f.mom.ok('POST', `/api/money/requests/${d.id}/confirm`);
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(coins().map((e) => [e.dir, e.amount, e.pieces]), [['in', 1000, [500, 500]]], '천원 한 장이 아니라 500원 두 개');
    // 합이 안 맞는 조각은 버리고 금액만 보낸다
    const d2 = await phone.ok('POST', `/api/kids/${f.ids.yuel}/requests`, { type: 'deposit', amount: 1000, pieces: [500, 100], purpose: '용돈', toMemberId: f.ids.mom });
    await f.mom.ok('POST', `/api/money/requests/${d2.id}/confirm`);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(coins()[1].pieces, null);
    // 꺼내기: 100원 3개 → 어른이 지급하면 같은 조각이 나온다
    const w = await phone.ok('POST', `/api/kids/${f.ids.yuel}/requests`, { type: 'withdraw', amount: 300, pieces: [100, 100, 100], purpose: '문구점', toMemberId: f.ids.mom });
    await f.mom.ok('POST', `/api/money/requests/${w.id}/approve`);
    await f.mom.ok('POST', `/api/money/requests/${w.id}/pay`);
    await new Promise((r) => setTimeout(r, 120));
    const out = coins().filter((e) => e.dir === 'out');
    assert.equal(out.length, 1); assert.deepEqual(out[0].pieces, [100, 100, 100]); assert.equal(out[0].amount, 300);
    ac.abort();
  } finally { await f.close(); }
});
