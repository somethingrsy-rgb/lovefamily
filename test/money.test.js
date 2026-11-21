import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

const asKid = (f, kid) => ({ 'X-Act-Kid': String(kid) });

test('동작 예시: 용돈 5,000 → 도장 보상 5,000 → 문구점 출금 2,000 = 5,000 → 10,000 → 8,000', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const kid = f.ids.yuel;
    await f.mom.ok('POST', `/api/kids/${kid}/opening-balance`, { amount: 0 });
    assert.equal((await f.mom.post(`/api/kids/${kid}/opening-balance`, { amount: 100 })).status, 409, '시작 잔액은 한 번만');
    await f.addMoney(kid, 5000, '용돈');
    assert.equal((await f.wallet(kid)).balance, 5000);
    // 도장 보상 5,000원(서버 서비스 직접 호출로 30개 완성 대신 ledger 규칙 확인은 stamps 테스트에서 함)
    f.core.run("INSERT INTO ledger (family_id, kid_id, kind, amount, memo, date, balance_after, idem_key, created_at) VALUES (1, ?, 'stamp_reward', 5000, 't', '2026-11-20', 10000, 'x', 1)", kid);
    assert.equal((await f.wallet(kid)).balance, 10000);
    const rq = await f.device.ok('POST', `/api/kids/${kid}/requests`, { type: 'withdraw', amount: 2000, purpose: '문구점', toMemberId: f.ids.dad }, asKid(f, kid));
    assert.equal(rq.statusLabel, '기다리는 중');
    // 요청 받은 아빠만 처리 가능 (엄마는 불가)
    assert.equal((await f.mom.post(`/api/money/requests/${rq.id}/approve`)).status, 403);
    const ap = await f.dad.ok('POST', `/api/money/requests/${rq.id}/approve`);
    assert.equal(ap.statusLabel, '줄게요');
    const w1 = await f.wallet(kid);
    assert.equal(w1.balance, 10000); assert.equal(w1.waiting, 2000); assert.equal(w1.available, 8000);
    const paid = await f.dad.ok('POST', `/api/money/requests/${rq.id}/pay`);
    assert.equal(paid.statusLabel, '받았어요');
    const w2 = await f.wallet(kid);
    assert.equal(w2.balance, 8000); assert.equal(w2.waiting, 0); assert.equal(w2.available, 8000);
    const led = await f.mom.ok('GET', `/api/kids/${kid}/ledger?month=2026-11`);
    assert.deepEqual(led.entries.map((e) => e.balanceAfter), [0, 5000, 10000, 8000]);
    assert.deepEqual(led.summary, { received: 10000, spent: 2000, remaining: 8000, cashSpentNote: 0 });
  } finally { await f.close(); }
});

test('⑤ 동시에 들어온 출금·구매가 같은 돈을 중복 사용하지 않는다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const kid = f.ids.yuha;
    await f.addMoney(kid, 10000);
    const H = asKid(f, kid);
    // 출금 두 건(각 6,000): 둘 다 요청은 가능하지만 동시에 승인하면 하나만 성공
    const a = await f.device.ok('POST', `/api/kids/${kid}/requests`, { type: 'withdraw', amount: 6000, purpose: 'A', toMemberId: f.ids.mom }, H);
    const b = await f.device.ok('POST', `/api/kids/${kid}/requests`, { type: 'withdraw', amount: 6000, purpose: 'B', toMemberId: f.ids.mom }, H);
    const rs = await Promise.all([a, b].map((r) => f.mom.post(`/api/money/requests/${r.id}/approve`)));
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
    const w = await f.wallet(kid);
    assert.equal(w.available, 4000); assert.equal(w.waiting, 6000);
    // 구매(목표) + 출금 경합: 사고 싶은 것 8,000원에 4,000 모으고, 남은 사용 가능 금액 이상은 출금 못 함
    const wish = await f.device.ok('POST', `/api/kids/${kid}/wishes`, { name: '레고', price: 4000 }, H);
    await f.device.ok('POST', `/api/wishes/${wish.id}/goal`, {}, H);
    const al = await f.device.ok('POST', `/api/wishes/${wish.id}/allocate`, { amount: 4000 }, H);
    assert.equal(al.wallet.available, 0);
    assert.equal(al.celebrate, true);
    const over = await f.device.post(`/api/wishes/${wish.id}/allocate`, { amount: 1 }, H);
    assert.equal(over.status, 409);
    assert.equal((await f.device.post(`/api/kids/${kid}/requests`, { type: 'withdraw', amount: 1, purpose: 'C', toMemberId: f.ids.mom }, H)).status, 409);
    // 총합 불변식: balance = 10000, goal 4000 + lock 6000 = 10000 → available 0
    const w2 = await f.wallet(kid);
    assert.equal(w2.balance - w2.goalSaved - w2.waiting, 0);
    // 구매 요청 → 승인(배정액 확보, 이중 차감 없음)
    await f.device.ok('POST', `/api/wishes/${wish.id}/buy`, { toMemberId: f.ids.dad }, H);
    const pr = (await f.dad.ok('GET', '/api/adult/home')).money.find((m) => m.type === 'purchase');
    const ap = await f.dad.ok('POST', `/api/money/requests/${pr.id}/approve`);
    assert.equal(ap.status, 'approved');
    assert.equal((await f.wallet(kid)).available, 0);
    // 목표 취소는 구매 요청 정리 전에는 불가
    assert.equal((await f.device.post(`/api/wishes/${wish.id}/cancel-goal`, {}, H)).status, 409);
    // 완료: 실제 금액이 3,500원이면 한 번만 차감, 남은 500원은 사용 가능으로
    const done = await f.dad.ok('POST', `/api/money/requests/${pr.id}/complete`, { actualAmount: 3500 });
    assert.equal(done.statusLabel, '샀어요');
    await f.dad.ok('POST', `/api/money/requests/${pr.id}/complete`, { actualAmount: 3500 }); // 재시도
    const w3 = await f.wallet(kid);
    assert.equal(w3.balance, 6500); assert.equal(w3.goalSaved, 0); assert.equal(w3.available, 500); // 6,000은 출금 잠금
    const wl = await f.device.ok('GET', `/api/kids/${kid}/wishes`, undefined, H);
    assert.equal(wl.wishes.find((x) => x.id === wish.id).status, 'bought');
    assert.equal(f.core.get("SELECT COUNT(*) c FROM ledger WHERE kind = 'purchase'").c, 1);
  } finally { await f.close(); }
});

test('⑥ 취소 시 잡아둔 돈 복원, 지급 완료 재시도 시 한 번만 차감', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const kid = f.ids.yuel; const H = asKid(f, kid);
    await f.addMoney(kid, 8000);
    const r = await f.device.ok('POST', `/api/kids/${kid}/requests`, { type: 'withdraw', amount: 3000, purpose: '간식', toMemberId: f.ids.gma }, H);
    await f.gma.ok('POST', `/api/money/requests/${r.id}/approve`);
    assert.equal((await f.wallet(kid)).available, 5000);
    await f.device.ok('POST', `/api/money/requests/${r.id}/cancel`, {}, H); // 아이가 취소
    const w = await f.wallet(kid);
    assert.equal(w.available, 8000); assert.equal(w.waiting, 0);
    assert.equal((await f.gma.post(`/api/money/requests/${r.id}/pay`)).status, 409, '취소된 요청은 지급 불가');
    // 거절: 사유가 아이에게 보이고 잠금 없음
    const r2 = await f.device.ok('POST', `/api/kids/${kid}/requests`, { type: 'withdraw', amount: 3000, purpose: '게임', toMemberId: f.ids.gma }, H);
    await f.gma.ok('POST', `/api/money/requests/${r2.id}/reject`, { reason: '이번 주는 쉬어요' });
    const seen = await f.device.ok('GET', `/api/money/requests/${r2.id}`, undefined, H);
    assert.equal(seen.rejectReason, '이번 주는 쉬어요');
    // 지급 완료 재시도 (동시 포함) → 한 번만 차감
    const r3 = await f.device.ok('POST', `/api/kids/${kid}/requests`, { type: 'withdraw', amount: 3000, purpose: '문구', toMemberId: f.ids.gma }, H);
    await f.gma.ok('POST', `/api/money/requests/${r3.id}/approve`);
    await Promise.all([1, 2, 3].map(() => f.gma.post(`/api/money/requests/${r3.id}/pay`)));
    await f.gma.post(`/api/money/requests/${r3.id}/pay`);
    assert.equal((await f.wallet(kid)).balance, 5000);
    assert.equal(f.core.get("SELECT COUNT(*) c FROM ledger WHERE kind = 'withdraw'").c, 1);
    // X-Idempotency-Key: 같은 키로 재전송하면 같은 응답
    const k1 = await f.mom.post(`/api/kids/${kid}/deposits`, { amount: 1000, memo: '재시도' }, { 'X-Idempotency-Key': 'abc' });
    const k2 = await f.mom.post(`/api/kids/${kid}/deposits`, { amount: 1000, memo: '재시도' }, { 'X-Idempotency-Key': 'abc' });
    assert.equal(k2.res.headers.get('idempotent-replay'), 'true'); assert.deepEqual(k1.json, k2.json);
    assert.equal((await f.wallet(kid)).balance, 6000);
  } finally { await f.close(); }
});

test('입금 확인: 어른이 현금을 받고 눌러야 한 번 반영되고, 내가 쓴 현금은 잔액·월간 지출에 영향이 없다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const kid = f.ids.yuha; const H = asKid(f, kid);
    const r = await f.device.ok('POST', `/api/kids/${kid}/requests`, { type: 'deposit', amount: 5000, purpose: '할머니 용돈', toMemberId: f.ids.gma }, H);
    assert.equal((await f.wallet(kid)).balance, 0, '확인 전에는 반영 안 됨');
    await Promise.all([1, 2].map(() => f.gma.post(`/api/money/requests/${r.id}/confirm`)));
    assert.equal((await f.wallet(kid)).balance, 5000);
    await f.device.ok('POST', `/api/kids/${kid}/cash-spent`, { amount: 1200, memo: '아이스크림' }, H);
    const led = await f.device.ok('GET', `/api/kids/${kid}/ledger`, undefined, H);
    assert.equal((await f.wallet(kid)).balance, 5000);
    assert.equal(led.summary.spent, 0); assert.equal(led.summary.cashSpentNote, 1200);
    const note = led.entries.find((e) => e.kind === 'cash_spent');
    assert.equal(note.out, 0); assert.equal(note.note, 1200);
    // 잔액 정정: 부모만, 사유 필수, 사용 가능 금액 아래로는 불가
    assert.equal((await f.gma.post(`/api/kids/${kid}/adjust`, { amount: -100, reason: 'x' })).status, 403);
    assert.equal((await f.mom.post(`/api/kids/${kid}/adjust`, { amount: -100 })).status, 400);
    assert.equal((await f.mom.post(`/api/kids/${kid}/adjust`, { amount: -6000, reason: '세어 보니 달라요' })).status, 409);
    const adj = await f.mom.ok('POST', `/api/kids/${kid}/adjust`, { amount: -500, reason: '세어 보니 달라요' });
    assert.equal(adj.wallet.balance, 4500);
    assert.match(adj.ledger.memo, /세어 보니/); assert.equal(adj.ledger.actorName, '엄마');
  } finally { await f.close(); }
});

test('목표 취소는 배정액을 풀어 주고, 저축 미션은 넣고 빼기를 반복해도 같은 금액이 중복 인정되지 않는다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const kid = f.ids.yuel; const H = asKid(f, kid);
    await f.addMoney(kid, 20000);
    const w1 = await f.device.ok('POST', `/api/kids/${kid}/wishes`, { name: '자전거', price: 15000, reason: '타고 싶어서' }, H);
    const w2 = await f.device.ok('POST', `/api/kids/${kid}/wishes`, { name: '인형', price: 3000 }, H);
    await f.device.ok('POST', `/api/wishes/${w1.id}/goal`, {}, H);
    assert.equal((await f.device.post(`/api/wishes/${w2.id}/goal`, {}, H)).status, 409, '현재 목표는 한 개');
    const a = await f.device.ok('POST', `/api/wishes/${w1.id}/allocate`, { amount: 5000 }, H);
    assert.equal(a.wish.need, 10000); assert.equal(a.wallet.goalSaved, 5000); assert.equal(a.wallet.balance, 20000);
    let ms = await f.device.ok('GET', `/api/kids/${kid}/missions`, undefined, H);
    assert.equal(ms.system[0].achieved, true);
    // 빼고 다시 넣어도 순증가는 5,000
    await f.device.ok('POST', `/api/wishes/${w1.id}/allocate`, { amount: 5000, op: 'remove' }, H);
    await f.device.ok('POST', `/api/wishes/${w1.id}/allocate`, { amount: 5000 }, H);
    ms = await f.device.ok('GET', `/api/kids/${kid}/missions`, undefined, H);
    assert.equal(ms.system[0].progress, 1000); // 상한 1,000
    assert.equal(f.core.get('SELECT COUNT(*) c FROM achievements WHERE key = ?', 'weekly_goal').c, 1);
    await f.device.ok('POST', `/api/wishes/${w1.id}/cancel-goal`, {}, H);
    const w = await f.wallet(kid);
    assert.equal(w.goalSaved, 0); assert.equal(w.available, 20000);
    ms = await f.device.ok('GET', `/api/kids/${kid}/missions`, undefined, H);
    assert.equal(ms.system[0].achieved, false, '취소하면 순증가가 0 → 미달성');
    // 용돈 받은 날 기록 미션
    assert.equal(ms.system[1].achieved, true);
  } finally { await f.close(); }
});

test('일회성 미션: 세 분 중 한 분 확인으로 보상이 한 번만 입금된다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const kid = f.ids.yuha; const H = asKid(f, kid);
    const m = await f.mom.ok('POST', '/api/missions', { kidId: kid, title: '안 쓰는 장난감 분류 돕기', reward: 500 });
    assert.equal((await f.device.post(`/api/missions/${m.id}/confirm`, {}, H)).status, 401, '아이는 확인할 수 없다(어른 인증 필요)');
    await f.device.ok('POST', `/api/missions/${m.id}/request`, {}, H);
    const rs = await Promise.all([f.mom, f.dad, f.gma].map((c) => c.post(`/api/missions/${m.id}/confirm`)));
    assert.equal(rs.filter((r) => r.json.result === 'confirmed').length, 1);
    assert.equal(rs.filter((r) => r.json.result === 'already').length, 2);
    assert.equal((await f.wallet(kid)).balance, 500);
    assert.equal(f.core.get("SELECT COUNT(*) c FROM ledger WHERE kind = 'mission_reward'").c, 1);
  } finally { await f.close(); }
});

test('어른은 장부 기록을 지울 수 있다: 잔액·월 합계가 다시 계산되고, 아이·다른 가족은 못 하며, 도장 보상과 잔액이 모자라게 되는 삭제는 막는다', async () => {
  const f = await setup();
  try {
    const kid = f.ids.yuel;
    await f.addMoney(kid, 500, '용돈'); await f.addMoney(kid, 10000, '22'); await f.addMoney(kid, 1000, '용돈');
    const month = f.core.today().slice(0, 7);
    let led = await f.mom.ok('GET', `/api/kids/${kid}/ledger?month=${month}`);
    assert.equal(led.entries.length, 3); assert.equal(led.summary.remaining, 11500);
    assert.ok(led.entries.every((e) => e.deletable));
    const mid = led.entries.find((e) => e.in === 10000);
    // 아이(공용 기기)는 지울 수 없다
    assert.equal((await f.device.del(`/api/ledger/${mid.id}`)).status, 401);
    const r = await f.mom.ok('DELETE', `/api/ledger/${mid.id}`);
    assert.equal(r.wallet.balance, 1500);
    led = await f.mom.ok('GET', `/api/kids/${kid}/ledger?month=${month}`);
    assert.deepEqual(led.entries.map((e) => [e.in, e.balanceAfter]), [[500, 500], [1000, 1500]], '남은 기록의 잔액이 다시 계산된다');
    assert.equal(led.summary.received, 1500);
    assert.equal((await f.mom.ok('GET', `/api/kids/${kid}/wallet`)).balance, 1500);
    assert.equal((await f.mom.del(`/api/ledger/${mid.id}`)).status, 404, '이미 지운 기록');
    // 잔액이 모자라게 되는 삭제는 막는다: 1,000원 출금 후 입금 기록 삭제 시 마이너스
    const dep = led.entries.find((e) => e.in === 1000);
    await f.core.run("INSERT INTO ledger (family_id, kid_id, kind, amount, affects, memo, date, balance_after, idem_key, created_at) VALUES (?,?,'withdraw',-1400,1,'x',?,100,'t:w',1)", f.core.get('SELECT family_id FROM members WHERE id = ?', kid).family_id, kid, f.core.today());
    const bad = await f.mom.del(`/api/ledger/${dep.id}`);
    assert.equal(bad.status, 409); assert.equal(bad.json.error, 'balance_negative');
    assert.equal((await f.mom.ok('GET', `/api/kids/${kid}/wallet`)).balance, 100, '막힌 삭제는 아무것도 바꾸지 않는다');
    // 이 달 기록 모두 지우기(출금을 먼저 지워야 잔액이 모자라지 않는다 → 전체 삭제는 가능)
    const all = await f.mom.ok('POST', `/api/kids/${kid}/ledger/clear`, { month });
    assert.equal(all.removed, 3); assert.equal(all.wallet.balance, 0);
    assert.equal((await f.mom.ok('GET', `/api/kids/${kid}/ledger?month=${month}`)).entries.length, 0);
    assert.equal((await f.device.post(`/api/kids/${kid}/ledger/clear`, { month })).status, 401);
    // 시작 잔액은 지운 뒤 다시 등록할 수 있다
    await f.mom.ok('POST', `/api/kids/${kid}/opening-balance`, { amount: 2000 });
    const o = (await f.mom.ok('GET', `/api/kids/${kid}/ledger?month=${month}`)).entries[0];
    await f.mom.ok('DELETE', `/api/ledger/${o.id}`);
    assert.ok([200, 201].includes((await f.mom.post(`/api/kids/${kid}/opening-balance`, { amount: 3000 })).status), '지운 뒤 시작 잔액 다시 등록');
  } finally { await f.close(); }
});

test('도장판 보상 기록은 지울 수 없다(도장 기록 정정으로만)', async () => {
  const f = await setup({ withRoutines: true });
  try {
    const kid = f.ids.yuha;
    f.core.run("INSERT INTO ledger (family_id, kid_id, kind, amount, affects, memo, date, balance_after, idem_key, created_at) VALUES (?,?,'stamp_reward',5000,1,'보상',?,5000,'t:sr',1)", f.core.get('SELECT family_id FROM members WHERE id = ?', kid).family_id, kid, f.core.today());
    const month = f.core.today().slice(0, 7);
    const e = (await f.mom.ok('GET', `/api/kids/${kid}/ledger?month=${month}`)).entries[0];
    assert.equal(e.deletable, false);
    const r = await f.mom.del(`/api/ledger/${e.id}`);
    assert.equal(r.status, 409); assert.equal(r.json.error, 'protected');
    const all = await f.mom.ok('POST', `/api/kids/${kid}/ledger/clear`, { month });
    assert.equal(all.removed, 0, '이 달 모두 지우기에서도 도장 보상은 남는다');
  } finally { await f.close(); }
});
