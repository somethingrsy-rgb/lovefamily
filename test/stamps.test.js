import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

test('① 세 어른이 동시에 같은 도장을 눌러도 1개만 기록되고 나머지는 처리 결과만 본다', async () => {
  const f = await setup();
  try {
    const st = await f.completeDay(f.ids.yuel);
    assert.equal(st.status, 'requested');
    const { pending } = await f.mom.ok('GET', '/api/approvals');
    assert.equal(pending.length, 1);
    const rid = pending[0].id;
    const rs = await Promise.all([f.mom, f.dad, f.gma].map((c) => c.post(`/api/stamp-requests/${rid}/approve`)));
    assert.ok(rs.every((r) => r.status === 200));
    const results = rs.map((r) => r.json.result).sort();
    assert.deepEqual(results, ['already', 'already', 'approved']);
    const approved = rs.find((r) => r.json.result === 'approved').json;
    assert.ok(rs.filter((r) => r.json.result === 'already').every((r) => r.json.by.name === approved.by.name));
    const board = await f.mom.ok('GET', `/api/kids/${f.ids.yuel}/stamps`);
    assert.equal(board.count, 1);
    assert.equal((await f.day(f.ids.yuel)).status, 'approved');
    // 네트워크 재시도(같은 요청 다시)도 1개
    await f.mom.post(`/api/stamp-requests/${rid}/approve`);
    assert.equal((await f.mom.ok('GET', `/api/kids/${f.ids.yuel}/stamps`)).count, 1);
    assert.equal(f.core.get('SELECT COUNT(*) c FROM stamps').c, 1);
  } finally { await f.close(); }
});

test('DB 제약: 같은 아이·같은 날짜 도장은 서버 DB가 하나로 보장한다', async () => {
  const f = await setup();
  try {
    await f.completeDay(f.ids.yuel);
    const rid = (await f.mom.ok('GET', '/api/approvals')).pending[0].id;
    await f.mom.post(`/api/stamp-requests/${rid}/approve`);
    const s = f.core.get('SELECT * FROM stamps');
    assert.throws(() => f.core.run('INSERT INTO stamps (family_id, kid_id, date, request_id, provider_id, approved_at) VALUES (?,?,?,?,?,?)', s.family_id, s.kid_id, s.date, 999, s.provider_id, 1), /UNIQUE/);
  } finally { await f.close(); }
});

// 하루 도장 하나씩, n일 채우기 (매일 루틴만 있는 유하)
async function stampDays(f, kid, n, startDate = '2026-11-20') {
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.parse(startDate + 'T03:00:00Z') + i * 864e5);
    f.clock.t = d.getTime();
    await f.completeDay(kid);
    const { pending } = await f.mom.ok('GET', '/api/approvals');
    const req = pending.find((p) => p.kidId === kid);
    const r = await f.mom.post(`/api/stamp-requests/${req.id}/approve`);
    assert.equal(r.json.result, 'approved');
  }
}

test('② 30번째 도장: 5,000원은 1회만 적립 (재시도·재접속·장애 후 복구 포함)', async () => {
  const f = await setup();
  try {
    await stampDays(f, f.ids.yuha, 29);
    assert.equal((await f.wallet(f.ids.yuha)).balance, 0);
    // 장애 주입: 도장 INSERT 직후 보상 적립 전에 실패 → 전체 롤백
    f.clock.t = Date.parse('2026-11-20T03:00:00Z') + 29 * 864e5;
    await f.completeDay(f.ids.yuha);
    const rid = (await f.mom.ok('GET', '/api/approvals')).pending[0].id;
    f.core.hooks.afterStampInsert = () => { throw new Error('boom'); };
    const bad = await f.mom.post(`/api/stamp-requests/${rid}/approve`);
    assert.equal(bad.status, 500);
    f.core.hooks.afterStampInsert = null;
    assert.equal(f.core.get('SELECT COUNT(*) c FROM stamps WHERE kid_id = ?', f.ids.yuha).c, 29, '도장도 롤백');
    assert.equal((await f.wallet(f.ids.yuha)).balance, 0);
    // 재시도 여러 번(동시 포함)
    const rs = await Promise.all([f.mom, f.dad, f.gma, f.mom].map((c) => c.post(`/api/stamp-requests/${rid}/approve`)));
    assert.equal(rs.filter((r) => r.json.result === 'approved').length, 1);
    await f.mom.post(`/api/stamp-requests/${rid}/approve`); // 재접속 후 재시도
    const w = await f.wallet(f.ids.yuha);
    assert.equal(w.balance, 5000);
    const led = await f.mom.ok('GET', `/api/kids/${f.ids.yuha}/ledger?month=2026-12`);
    assert.equal(led.entries.filter((e) => e.kind === 'stamp_reward').length + (await f.mom.ok('GET', `/api/kids/${f.ids.yuha}/ledger?month=2026-11`)).entries.filter((e) => e.kind === 'stamp_reward').length, 1);
    // 도장판: 완성판 보관, 새 판 0/30
    const b = await f.mom.ok('GET', `/api/kids/${f.ids.yuha}/stamps`);
    assert.equal(b.count, 0); assert.equal(b.boardNo, 2); assert.equal(b.completed.length, 1); assert.equal(b.completed[0].stamps.length, 30);
    // 스케줄러의 정합성 점검을 몇 번 돌려도 중복 적립 없음
    f.app.tick(); f.app.tick();
    assert.equal((await f.wallet(f.ids.yuha)).balance, 5000);
  } finally { await f.close(); }
});

test('③ 전날 요청은 원래 루틴 날짜로 승인되고, 예정 루틴이 없는 날은 요청이 만들어지지 않는다', async () => {
  const f = await setup();
  try {
    // 금요일 완료 → 승인 안 한 채로 토요일이 됨
    await f.completeDay(f.ids.yuel);
    const rid = (await f.mom.ok('GET', '/api/approvals')).pending[0].id;
    f.clock.t = Date.parse('2026-11-21T03:00:00Z');
    const r = await f.mom.post(`/api/stamp-requests/${rid}/approve`);
    assert.equal(r.json.result, 'approved'); assert.equal(r.json.date, '2026-11-20');
    const b = await f.mom.ok('GET', `/api/kids/${f.ids.yuel}/stamps`);
    assert.equal(b.current[0].date, '2026-11-20');
    // 예정 루틴이 없는 날: 평일 전용 루틴만 가진 아이 만들기
    await f.mom.ok('POST', '/api/routines', { kidIds: [f.ids.yuha], name: '가방 싸기', days: [1, 2, 3, 4, 5], slot: 'evening' });
    const rts = await f.mom.ok('GET', `/api/kids/${f.ids.yuha}/routines`);
    for (const rt of rts) if (rt.name === '양치하기') await f.mom.ok('PATCH', `/api/routines/${rt.id}`, { days: [1, 2, 3, 4, 5] });
    f.clock.t = Date.parse('2026-11-22T03:00:00Z'); // 일요일
    const day = await f.day(f.ids.yuha);
    assert.equal(day.total, 0); assert.equal(day.status, 'none');
    assert.equal((await f.mom.ok('GET', '/api/approvals')).pending.filter((p) => p.kidId === f.ids.yuha).length, 0);
    const rr = await f.device.post(`/api/kids/${f.ids.yuha}/day/request`, {});
    assert.equal(rr.status, 409);
  } finally { await f.close(); }
});

test('④ 루틴 이름·요일을 고쳐도 과거 기록은 당시 그대로, 수정은 다음 해당 요일부터, 오늘 예외는 승인 전만', async () => {
  const f = await setup();
  try {
    const rts = await f.mom.ok('GET', `/api/kids/${f.ids.yuel}/routines`);
    const homework = rts.find((r) => r.name === '숙제하기');
    await f.completeDay(f.ids.yuel); // 금요일 기록(승인 대기)
    const rid = (await f.mom.ok('GET', '/api/approvals')).pending[0].id;
    await f.mom.post(`/api/stamp-requests/${rid}/approve`);
    // 이름·요일 변경 (오늘은 금요일): 오늘/과거 목록은 그대로
    const up = await f.mom.ok('PATCH', `/api/routines/${homework.id}`, { name: '수학 숙제', days: [2, 4] });
    assert.equal(up.appliedToday, false);
    const fri = await f.day(f.ids.yuel);
    assert.ok(fri.items.some((i) => i.name === '숙제하기'));
    assert.ok(!fri.items.some((i) => i.name === '수학 숙제'));
    // 다음 주 금요일엔 숙제가 없다, 목요일엔 새 이름으로 생긴다
    f.clock.t = Date.parse('2026-11-26T03:00:00Z'); // 목요일
    assert.ok((await f.day(f.ids.yuel)).items.some((i) => i.name === '수학 숙제'));
    f.clock.t = Date.parse('2026-11-27T03:00:00Z'); // 금요일
    assert.ok(!(await f.day(f.ids.yuel)).items.some((i) => i.name.includes('숙제')));
    // 과거 날짜 조회는 당시 이름 유지
    const past = await f.day(f.ids.yuel, '2026-11-20');
    assert.ok(past.items.some((i) => i.name === '숙제하기'));
    // 삭제(소프트)해도 과거 기록 유지 + 오늘 예외 적용
    const cal = await f.mom.ok('GET', `/api/kids/${f.ids.yuel}/calendar?month=2026-11`);
    assert.ok(cal.find((c) => c.date === '2026-11-20' && c.stamp));
    // 오늘 예외: 승인 전 오늘 목록에 한해 적용
    const today = await f.day(f.ids.yuel);
    const brush = (await f.mom.ok('GET', `/api/kids/${f.ids.yuel}/routines`)).find((r) => r.name === '양치하기');
    const ex = await f.mom.ok('PATCH', `/api/routines/${brush.id}`, { name: '양치 3분', applyToday: true });
    assert.equal(ex.appliedToday, true);
    assert.ok((await f.day(f.ids.yuel)).items.some((i) => i.name === '양치 3분'));
    void today;
    // 승인 후에는 오늘 예외가 적용되지 않는다
    await f.completeDay(f.ids.yuel);
    const rid2 = (await f.mom.ok('GET', '/api/approvals')).pending.find((p) => p.kidId === f.ids.yuel).id;
    await f.mom.post(`/api/stamp-requests/${rid2}/approve`);
    const ex2 = await f.mom.ok('PATCH', `/api/routines/${brush.id}`, { name: '양치 5분', applyToday: true });
    assert.equal(ex2.appliedToday, false);
    assert.ok((await f.day(f.ids.yuel)).items.some((i) => i.name === '양치 3분'));
    // 승인된 날 체크 변경 불가
    const it = (await f.day(f.ids.yuel)).items[0];
    assert.equal((await f.device.put(`/api/day-items/${it.id}`, { done: false })).status, 409);
  } finally { await f.close(); }
});

test('요청 대기 중 체크가 취소되면 기존 요청은 승인할 수 없고, 다시 모두 하면 새 요청이 생긴다', async () => {
  const f = await setup();
  try {
    const st = await f.completeDay(f.ids.yuha);
    assert.equal(st.status, 'requested');
    const rid = (await f.mom.ok('GET', '/api/approvals')).pending[0].id;
    const it = st.items[0];
    const un = await f.device.ok('PUT', `/api/day-items/${it.id}`, { done: false });
    assert.equal(un.status, 'open');
    const r = await f.mom.post(`/api/stamp-requests/${rid}/approve`);
    assert.equal(r.json.result, 'closed');
    assert.equal(f.core.get('SELECT COUNT(*) c FROM stamps').c, 0);
    const again = await f.device.ok('PUT', `/api/day-items/${it.id}`, { done: true });
    assert.equal(again.status, 'requested');
    assert.notEqual(again.requestId, rid);
    // 완료 요청은 어른 세 분 모두에게 앱 알림과 푸시(잠금화면엔 이름+종류만)
    await f.flush();
    const mine = f.pushes.filter((p) => p.payload.nid && p.payload.body.includes('도장'));
    assert.ok(mine.length >= 6);
    assert.ok(mine.every((p) => !/\d,\d{3}원|메시지/.test(p.payload.body)));
    assert.equal(new Set(mine.map((p) => p.endpoint)).size, 3);
  } finally { await f.close(); }
});

test('다시 확인: 항목·이유를 남기고 아이가 보완 후 다시 요청하면 새 요청이 생긴다', async () => {
  const f = await setup();
  try {
    const st = await f.completeDay(f.ids.yuel);
    const rid = (await f.mom.ok('GET', '/api/approvals')).pending[0].id;
    const r = await f.dad.post(`/api/stamp-requests/${rid}/recheck`, { itemIds: [st.items[0].id], reason: '양치 안 한 것 같아요' });
    assert.equal(r.json.result, 'recheck');
    const d = await f.day(f.ids.yuel);
    assert.equal(d.status, 'recheck');
    assert.equal(d.recheck.reason, '양치 안 한 것 같아요');
    assert.equal(d.items[0].flag, '양치 안 한 것 같아요');
    assert.equal((await f.mom.post(`/api/stamp-requests/${rid}/approve`)).json.result, 'closed');
    await f.device.ok('PUT', `/api/day-items/${st.items[0].id}`, { done: false });
    const back = await f.device.ok('PUT', `/api/day-items/${st.items[0].id}`, { done: true });
    assert.equal(back.status, 'requested');
    assert.equal(back.items[0].flag, null);
  } finally { await f.close(); }
});

test('도장 정정(부모 권한+사유): 보상 조건이 바뀌면 조정 내역과, 이미 건넨 현금은 정산 내역을 남긴다', async () => {
  const f = await setup();
  try {
    await stampDays(f, f.ids.yuha, 30);
    assert.equal((await f.wallet(f.ids.yuha)).balance, 5000);
    // 이미 5,000원 현금을 꺼내 줬다고 가정: 출금 완료 → 잔액 0
    await f.device.ok('POST', '/api/auth/login', { loginId: 'mom@test', password: 'secret1', device: true });
    const kid = f.ids.yuha;
    const rq = await f.device.ok('POST', `/api/kids/${kid}/requests`, { type: 'withdraw', amount: 5000, purpose: '장난감', toMemberId: f.ids.mom }, { 'X-Act-Kid': String(kid) });
    await f.mom.ok('POST', `/api/money/requests/${rq.id}/approve`);
    await f.mom.ok('POST', `/api/money/requests/${rq.id}/pay`);
    assert.equal((await f.wallet(kid)).balance, 0);
    const stamp = f.core.get('SELECT * FROM stamps WHERE kid_id = ? ORDER BY id LIMIT 1', kid);
    // 할머니(부모 권한 없음)는 정정할 수 없다
    assert.equal((await f.gma.post(`/api/stamps/${stamp.id}/void`, { reason: '실수' })).status, 403);
    assert.equal((await f.mom.post(`/api/stamps/${stamp.id}/void`, {})).status, 400); // 사유 필수
    await f.mom.ok('POST', `/api/stamps/${stamp.id}/void`, { reason: '체크가 잘못됐어요' });
    assert.equal((await f.wallet(kid)).balance, 0);
    const b = await f.mom.ok('GET', `/api/kids/${kid}/stamps`);
    assert.equal(b.settlements.length, 1); assert.equal(b.settlements[0].amount, 5000);
    assert.equal(b.total, 29);
    f.app.tick(); // 반복해도 중복 조정 없음
    assert.equal(f.core.get('SELECT COUNT(*) c FROM settlements').c, 1);
  } finally { await f.close(); }
});
