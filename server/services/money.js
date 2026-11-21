import { err, text, money, id as vid, isMonth, monthRange, isDate } from '../util.js';

const KIND_LABEL = {
  opening: '시작 잔액', deposit: '입금', stamp_reward: '도장판 보상', mission_reward: '미션 보상', withdraw: '출금',
  purchase: '구매', adjust: '잔액 정정', stamp_reward_adjust: '도장 보상 조정', cash_spent: '내가 쓴 현금',
};
// 도장판 보상 기록은 도장 개수와 묶여 있어서 따로 지울 수 없다(도장 기록 정정으로 바꾼다)
const PROTECTED = new Set(['stamp_reward', 'stamp_reward_adjust']);
const GOAL_ACTIVE = "('goal','ready','purchasing')";

// ---------- 잔액 계산 (사용 가능 = 확정 잔액 − 목표 배정액 − 승인된 출금 잠금) ----------
export function balance(core, kidId) {
  return core.get('SELECT COALESCE(SUM(amount), 0) s FROM ledger WHERE kid_id = ? AND affects = 1 AND voided = 0', kidId).s;
}
export function goalSaved(core, kidId) {
  return core.get(`SELECT COALESCE(SUM(allocated), 0) s FROM wishes WHERE kid_id = ? AND status IN ${GOAL_ACTIVE}`, kidId).s;
}
export function locked(core, kidId) {
  return core.get("SELECT COALESCE(SUM(amount), 0) s FROM money_requests WHERE kid_id = ? AND type = 'withdraw' AND status = 'approved'", kidId).s;
}
export function wallet(core, kidId) {
  const total = balance(core, kidId);
  const goal = goalSaved(core, kidId);
  const lock = locked(core, kidId);
  return { balance: total, goalSaved: goal, waiting: lock, available: total - goal - lock };
}

// 장부 기록. idemKey 가 이미 있으면 새로 쓰지 않고 기존 행을 돌려준다(재시도 안전).
export function ledgerAdd(core, { familyId, kidId, kind, amount, affects = 1, memo = '', actorId = null, requestId = null, idemKey, date }) {
  const prev = core.get('SELECT * FROM ledger WHERE idem_key = ?', idemKey);
  if (prev) return { row: prev, created: false };
  const bal = balance(core, kidId) + (affects ? amount : 0);
  const lid = core.insert(
    'INSERT INTO ledger (family_id, kid_id, kind, amount, affects, memo, date, actor_id, balance_after, request_id, idem_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    familyId, kidId, kind, amount, affects, memo, date || core.today(), actorId, bal, requestId, idemKey, core.now());
  // 용돈·보상이 들어오면 아이 폰(그 아이 것만)과 거실 기기에 '저금통에 쏙' 소식을 보낸다
  const isIn = affects && amount > 0 && ['deposit', 'stamp_reward', 'mission_reward'].includes(kind);
  const isOut = affects && amount < 0 && kind === 'withdraw';
  if (isIn || isOut) {
    let pieces = null;
    if (requestId) { const pr = core.get('SELECT pieces FROM money_requests WHERE id = ?', requestId)?.pieces; if (pr) { try { pieces = JSON.parse(pr); } catch { pieces = null; } } }
    core.afterCommit(() => core.hub.publish(familyId, { t: 'coins', dir: isIn ? 'in' : 'out', kidId, amount: Math.abs(amount), pieces, kind, key: `coin:${lid}` }, { kids: [kidId], devices: true }));
  }
  return { row: core.get('SELECT * FROM ledger WHERE id = ?', lid), created: true };
}

const ledgerOut = (core, r) => {
  const actor = r.actor_id ? core.member(r.actor_id) : null;
  const req = r.request_id ? core.get('SELECT status, type FROM money_requests WHERE id = ?', r.request_id) : null;
  return {
    id: r.id, date: r.date, kind: r.kind, kindLabel: KIND_LABEL[r.kind] || r.kind, memo: r.memo, deletable: !PROTECTED.has(r.kind),
    in: r.affects && r.amount > 0 ? r.amount : 0, out: r.affects && r.amount < 0 ? -r.amount : 0,
    note: !r.affects ? Math.abs(r.amount) : 0,
    balanceAfter: r.affects ? r.balance_after : null, actorName: actor?.name || null, requestStatus: req?.status || null, createdAt: r.created_at,
  };
};

export function getWallet(core, ctx, kidId) {
  ctx.kidPrivate(kidId);
  return wallet(core, kidId);
}

export function getLedger(core, ctx, kidId, month) {
  ctx.kidPrivate(kidId);
  month = month || core.today().slice(0, 7);
  if (!isMonth(month)) throw err(400, 'bad_month', '월 형식은 YYYY-MM 이에요.');
  const { first, next } = monthRange(month);
  const rows = core.all('SELECT * FROM ledger WHERE kid_id = ? AND voided = 0 AND date >= ? AND date < ? ORDER BY date, id', kidId, first, next).map((r) => ledgerOut(core, r));
  const spent = core.get('SELECT COALESCE(SUM(-amount),0) s FROM ledger WHERE kid_id = ? AND voided = 0 AND affects = 1 AND amount < 0 AND date >= ? AND date < ?', kidId, first, next).s;
  const received = core.get('SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE kid_id = ? AND voided = 0 AND affects = 1 AND amount > 0 AND date >= ? AND date < ?', kidId, first, next).s;
  const endBal = core.get('SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE kid_id = ? AND voided = 0 AND affects = 1 AND date < ?', kidId, next).s;
  const cash = core.get('SELECT COALESCE(SUM(-amount),0) s FROM ledger WHERE kid_id = ? AND voided = 0 AND affects = 0 AND date >= ? AND date < ?', kidId, first, next).s;
  return { month, entries: rows, summary: { received, spent, remaining: endBal, cashSpentNote: cash } };
}

// ---------- 기록 지우기 (어른) ----------
// 지운 기록은 화면·잔액·월 합계에서 빠진다. 안전을 위해 DB 에는 '지움' 표시로 남겨 두고(복구 가능), 뒤 기록의 잔액을 다시 계산한다.
function renumber(core, kidId) {
  let bal = 0;
  for (const r of core.all('SELECT id, amount, affects FROM ledger WHERE kid_id = ? AND voided = 0 ORDER BY id', kidId)) {
    if (r.affects) bal += r.amount;
    core.run('UPDATE ledger SET balance_after = ? WHERE id = ?', bal, r.id);
  }
}
function voidRows(core, adult, kidId, rows) {
  const now = core.now();
  for (const r of rows) {
    // 시작 잔액은 다시 등록할 수 있도록 중복 방지 키를 풀어 준다
    core.run('UPDATE ledger SET voided = 1, voided_at = ?, voided_by = ?, idem_key = CASE WHEN kind = ? THEN idem_key || ? ELSE idem_key END WHERE id = ?', now, adult.id, 'opening', `:voided:${r.id}`, r.id);
  }
  renumber(core, kidId);
  const w = wallet(core, kidId);
  if (w.balance < 0 || w.available < 0) throw err(409, 'balance_negative', '이 기록을 지우면 잔액이 모자라요. 목표에 담아 둔 돈이나 꺼내기 요청을 먼저 정리해 주세요.');
}
export function deleteLedger(core, ctx, ledgerId) {
  const adult = ctx.adult();
  const r = core.get('SELECT * FROM ledger WHERE id = ? AND voided = 0', vid(ledgerId, '기록'));
  if (!r || r.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 기록이에요.');
  if (PROTECTED.has(r.kind)) throw err(409, 'protected', '도장판 보상 기록은 도장 기록 정정으로만 바꿀 수 있어요.');
  return core.tx(() => { voidRows(core, adult, r.kid_id, [r]); core.refresh(ctx.familyId, 'wallet', 'home'); return { ok: true, wallet: wallet(core, r.kid_id) }; });
}
export function clearLedgerMonth(core, ctx, kidId, month) {
  const adult = ctx.adult();
  ctx.kidRow(kidId);
  if (!isMonth(month)) throw err(400, 'bad_month', '월 형식은 YYYY-MM 이에요.');
  const { first, next } = monthRange(month);
  const rows = core.all("SELECT * FROM ledger WHERE kid_id = ? AND voided = 0 AND date >= ? AND date < ? AND kind NOT IN ('stamp_reward', 'stamp_reward_adjust')", kidId, first, next);
  if (!rows.length) return { ok: true, removed: 0, wallet: wallet(core, kidId) };
  return core.tx(() => { voidRows(core, adult, Number(kidId), rows); core.refresh(ctx.familyId, 'wallet', 'home'); return { ok: true, removed: rows.length, wallet: wallet(core, Number(kidId)) }; });
}

// ---------- 어른이 직접 하는 장부 작업 ----------
export function setOpening(core, ctx, kidId, amount) {
  const adult = ctx.adult();
  ctx.kid(kidId);
  const a = money(amount, '시작 잔액', { min: 0 });
  return core.tx(() => {
    if (core.get("SELECT 1 FROM ledger WHERE idem_key = ? AND voided = 0", `opening:${kidId}`)) throw err(409, 'opening_exists', '시작 잔액은 한 번만 등록할 수 있어요. 틀렸다면 잔액 정정을 써 주세요.');
    ledgerAdd(core, { familyId: ctx.familyId, kidId, kind: 'opening', amount: a, memo: '맡아 둔 현금', actorId: adult.id, idemKey: `opening:${kidId}` });
    core.refresh(ctx.familyId, 'wallet');
    return wallet(core, kidId);
  });
}

// 어른이 현금을 받고 직접 등록 (idemKey 는 클라이언트 X-Idempotency-Key 로 이미 보호되지만 한 번 더 요청 단위로 보호)
export function directDeposit(core, ctx, kidId, b) {
  const adult = ctx.adult();
  ctx.kid(kidId);
  const a = money(b.amount);
  const memo = text(b.memo || '입금', '내용', { max: 60 });
  return core.tx(() => {
    const { row } = ledgerAdd(core, { familyId: ctx.familyId, kidId, kind: 'deposit', amount: a, memo, actorId: adult.id, idemKey: `deposit:${kidId}:${b.idemKey || 'n' + core.now() + Math.random()}` });
    notifyKidMoney(core, ctx.familyId, kidId, 'money_done', '입금됐어요', `${a.toLocaleString('ko-KR')}원이 저금통에 들어왔어요.`);
    core.refresh(ctx.familyId, 'wallet');
    return { ledger: ledgerOut(core, row), wallet: wallet(core, kidId) };
  });
}

export function adjust(core, ctx, kidId, b) {
  const adult = ctx.guardian();
  ctx.kid(kidId);
  const amt = Number(b.amount);
  if (!Number.isSafeInteger(amt) || amt === 0 || Math.abs(amt) > 10_000_000) throw err(400, 'bad_amount', '정정할 금액을 원 단위 정수로 입력해 주세요.');
  const reason = text(b.reason, '정정 사유', { max: 100 });
  return core.tx(() => {
    const w = wallet(core, kidId);
    if (w.available + amt < 0) throw err(409, 'adjust_blocked', `정정 후 사용 가능 금액이 0원보다 작아져요. (현재 사용 가능 ${w.available.toLocaleString('ko-KR')}원)`);
    const { row } = ledgerAdd(core, { familyId: ctx.familyId, kidId, kind: 'adjust', amount: amt, memo: `정정: ${reason}`, actorId: adult.id, idemKey: `adjust:${kidId}:${core.now()}:${Math.random()}` });
    core.refresh(ctx.familyId, 'wallet');
    return { ledger: ledgerOut(core, row), wallet: wallet(core, kidId) };
  });
}

// 내가 쓴 현금: 이미 꺼낸 돈의 사용처 메모. 잔액·월간 지출에는 영향이 없다.
export function cashSpent(core, ctx, kidId, b) {
  const { kid, adult } = ctx.kidOrAdult(kidId);
  const a = money(b.amount);
  const memo = text(b.memo, '쓴 곳', { max: 60 });
  const date = b.date && isDate(b.date) ? b.date : core.today();
  return core.tx(() => {
    const { row } = ledgerAdd(core, { familyId: ctx.familyId, kidId: kid.id, kind: 'cash_spent', amount: -a, affects: 0, memo, actorId: adult?.id ?? null, date, idemKey: `cash:${kid.id}:${core.now()}:${Math.random()}` });
    core.refresh(ctx.familyId, 'wallet');
    return ledgerOut(core, row);
  });
}

// ---------- 요청 (입금 확인 / 출금 / 구매) ----------
const REQ_LABEL = {
  deposit: { pending: '확인 기다리는 중', confirmed: '입금 확인했어요', rejected: '거절됐어요', canceled: '취소했어요' },
  withdraw: { pending: '기다리는 중', approved: '줄게요', paid: '받았어요', rejected: '거절됐어요', canceled: '취소했어요' },
  purchase: { pending: '기다리는 중', approved: '사도 좋아요', completed: '샀어요', rejected: '거절됐어요', canceled: '취소했어요' },
};
export const reqOut = (core, r) => {
  const to = core.member(r.to_member_id);
  const kid = core.member(r.kid_id);
  return {
    id: r.id, kidId: r.kid_id, kidName: kid.name, type: r.type, amount: r.amount, purpose: r.purpose, toMemberId: r.to_member_id, toName: to?.name,
    status: r.status, statusLabel: REQ_LABEL[r.type][r.status], rejectReason: r.reject_reason, wishId: r.wish_id, actualAmount: r.actual_amount,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
};

function notifyKidMoney(core, familyId, kidId, kind, title, body) {
  core.notify({ familyId, memberId: kidId, kind, title, body, url: '/#/kid/wallet', popup: true });
}

const DENOMS = new Set([100, 500, 1000, 5000, 10000, 50000]);
// 아이가 누른 지폐·동전 목록(예: [500, 500]). 금액과 합이 맞지 않거나 이상한 값이면 버린다(그때는 금액만으로 모션을 만든다).
export function cleanPieces(v, amount) {
  if (!Array.isArray(v) || !v.length || v.length > 60) return null;
  if (!v.every((x) => Number.isInteger(x) && DENOMS.has(x))) return null;
  return v.reduce((a, b) => a + b, 0) === amount ? v : null;
}
export function createRequest(core, ctx, kidId, b) {
  const kid = ctx.asKid(kidId);
  const type = b.type === 'deposit' ? 'deposit' : b.type === 'withdraw' ? 'withdraw' : null;
  if (!type) throw err(400, 'bad_type', '요청 종류가 올바르지 않아요.');
  const amount = money(b.amount);
  const purpose = text(b.purpose, type === 'deposit' ? '이유' : '용도', { max: 60 });
  const to = ctx.adultMember(vid(b.toMemberId, '받을 어른'));
  return core.tx(() => {
    if (type === 'withdraw') {
      const w = wallet(core, kid.id);
      if (amount > w.available) throw err(409, 'insufficient', `지금 쓸 수 있는 돈은 ${w.available.toLocaleString('ko-KR')}원이에요.`, { available: w.available });
    }
    const rid = core.insert(
      'INSERT INTO money_requests (family_id, kid_id, type, amount, purpose, to_member_id, status, created_at, updated_at, pieces) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ctx.familyId, kid.id, type, amount, purpose, to.id, 'pending', core.now(), core.now(), (() => { const pc = cleanPieces(b.pieces, amount); return pc ? JSON.stringify(pc) : null; })());
    core.notify({
      familyId: ctx.familyId, memberId: to.id, kind: `money_${type}`, title: `${kid.name}의 ${type === 'deposit' ? '입금' : '출금'} 요청`,
      body: `${amount.toLocaleString('ko-KR')}원 · ${purpose}`, url: `/#/money/${rid}`, dedupe: `money-req:${rid}`, lock: `${kid.name} · ${type === 'deposit' ? '입금' : '출금'} 요청`,
    });
    core.refresh(ctx.familyId, 'requests');
    return reqOut(core, core.get('SELECT * FROM money_requests WHERE id = ?', rid));
  });
}

function loadReq(core, ctx, rid) {
  const r = core.get('SELECT * FROM money_requests WHERE id = ?', rid);
  if (!r || r.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 요청이에요.');
  return r;
}
// 요청을 받을 사람으로 지정된 어른만 처리
function addressee(core, ctx, r) {
  const adult = ctx.adult();
  if (adult.id !== r.to_member_id) throw err(403, 'not_addressee', `${core.member(r.to_member_id).name}에게 온 요청이에요.`);
  return adult;
}
const setStatus = (core, r, status, extra = {}) => {
  core.run('UPDATE money_requests SET status = ?, reject_reason = COALESCE(?, reject_reason), decided_by = COALESCE(?, decided_by), actual_amount = COALESCE(?, actual_amount), ledger_id = COALESCE(?, ledger_id), updated_at = ? WHERE id = ?',
    status, extra.reason ?? null, extra.by ?? null, extra.actual ?? null, extra.ledgerId ?? null, core.now(), r.id);
};

export function getRequest(core, ctx, rid) {
  const r = loadReq(core, ctx, rid);
  ctx.kidPrivate(r.kid_id);
  return reqOut(core, r);
}

export function listRequests(core, ctx, kidId) {
  ctx.kidPrivate(kidId);
  return core.all('SELECT * FROM money_requests WHERE kid_id = ? ORDER BY id DESC LIMIT 50', kidId).map((r) => reqOut(core, r));
}

// 어른이 처리할 요청 (내게 온 활성 요청)
export function todoForAdult(core, adult) {
  return core.all(
    `SELECT * FROM money_requests WHERE to_member_id = ? AND
       ((type = 'deposit' AND status = 'pending') OR (type = 'withdraw' AND status IN ('pending','approved')) OR (type = 'purchase' AND status IN ('pending','approved')))
     ORDER BY id`, adult.id).map((r) => reqOut(core, r));
}

export function approveRequest(core, ctx, rid) {
  return core.tx(() => {
    const r = loadReq(core, ctx, rid);
    const adult = addressee(core, ctx, r);
    if (r.type === 'deposit') throw err(400, 'bad_type', '입금 요청은 ‘입금 확인’을 눌러 주세요.');
    if (r.status === 'approved') return reqOut(core, r); // 재시도 안전
    if (r.status !== 'pending') throw err(409, 'not_pending', '이미 처리된 요청이에요.');
    const kid = core.member(r.kid_id);
    if (r.type === 'withdraw') {
      const w = wallet(core, r.kid_id);
      if (r.amount > w.available) throw err(409, 'insufficient', `사용 가능 금액(${w.available.toLocaleString('ko-KR')}원)이 부족해서 승인할 수 없어요.`, { available: w.available });
      setStatus(core, r, 'approved', { by: adult.id });
      notifyKidMoney(core, r.family_id, kid.id, 'money_approved', '줄게요!', `${r.amount.toLocaleString('ko-KR')}원 출금이 승인됐어요.`);
    } else {
      const wish = core.get('SELECT * FROM wishes WHERE id = ?', r.wish_id);
      if (!wish || wish.status !== 'purchasing') throw err(409, 'wish_changed', '사고 싶은 것 상태가 바뀌었어요.');
      if (wish.allocated < r.amount) throw err(409, 'insufficient', '목표에 모은 돈이 모자라요.');
      setStatus(core, r, 'approved', { by: adult.id }); // 배정액이 그대로 '확보'된 금액. 출금 잠금으로 다시 차감하지 않는다.
      notifyKidMoney(core, r.family_id, kid.id, 'money_approved', '사도 좋아요!', `${wish.name} 구매가 승인됐어요.`);
    }
    core.refresh(r.family_id, 'requests', 'wallet');
    return reqOut(core, core.get('SELECT * FROM money_requests WHERE id = ?', r.id));
  });
}

export function rejectRequest(core, ctx, rid, b) {
  return core.tx(() => {
    const r = loadReq(core, ctx, rid);
    const adult = addressee(core, ctx, r);
    if (r.status === 'rejected') return reqOut(core, r);
    if (r.status !== 'pending' && !(r.type !== 'deposit' && r.status === 'approved')) throw err(409, 'not_pending', '이미 처리된 요청이에요.');
    const reason = text(b?.reason, '거절 사유', { max: 100 });
    setStatus(core, r, 'rejected', { by: adult.id, reason });
    afterEnd(core, r);
    notifyKidMoney(core, r.family_id, r.kid_id, 'money_rejected', '요청이 거절됐어요', reason);
    core.refresh(r.family_id, 'requests', 'wallet');
    return reqOut(core, core.get('SELECT * FROM money_requests WHERE id = ?', r.id));
  });
}

export function cancelRequest(core, ctx, rid) {
  return core.tx(() => {
    const r = loadReq(core, ctx, rid);
    const adult = ctx.adultOrNull();
    if (adult) { if (adult.id !== r.to_member_id) throw err(403, 'not_addressee', '받을 어른만 취소할 수 있어요.'); } else ctx.asKid(r.kid_id);
    if (r.status === 'canceled') return reqOut(core, r);
    if (!['pending', 'approved'].includes(r.status)) throw err(409, 'not_active', '이미 끝난 요청은 취소할 수 없어요.');
    setStatus(core, r, 'canceled'); // 잠금은 status='approved' 합계에서 빠지므로 자동으로 풀린다
    afterEnd(core, r);
    core.refresh(r.family_id, 'requests', 'wallet');
    return reqOut(core, core.get('SELECT * FROM money_requests WHERE id = ?', r.id));
  });
}

// 구매 요청이 끝나면(거절/취소) 사고 싶은 것을 목표 상태로 되돌린다. 배정액은 그대로 유지.
function afterEnd(core, r) {
  if (r.type !== 'purchase') return;
  const w = core.get('SELECT * FROM wishes WHERE id = ?', r.wish_id);
  if (w && w.status === 'purchasing') core.run("UPDATE wishes SET status = ? WHERE id = ?", w.allocated >= w.price ? 'ready' : 'goal', w.id);
}

export function confirmDeposit(core, ctx, rid) {
  return core.tx(() => {
    const r = loadReq(core, ctx, rid);
    const adult = addressee(core, ctx, r);
    if (r.type !== 'deposit') throw err(400, 'bad_type', '입금 요청이 아니에요.');
    if (r.status === 'confirmed') return reqOut(core, r);
    if (r.status !== 'pending') throw err(409, 'not_pending', '이미 처리된 요청이에요.');
    const { row } = ledgerAdd(core, { familyId: r.family_id, kidId: r.kid_id, kind: 'deposit', amount: r.amount, memo: r.purpose, actorId: adult.id, requestId: r.id, idemKey: `req:${r.id}:deposit` });
    setStatus(core, r, 'confirmed', { by: adult.id, ledgerId: row.id });
    notifyKidMoney(core, r.family_id, r.kid_id, 'money_done', '입금됐어요', `${r.amount.toLocaleString('ko-KR')}원이 저금통에 들어왔어요.`);
    core.refresh(r.family_id, 'requests', 'wallet');
    return reqOut(core, core.get('SELECT * FROM money_requests WHERE id = ?', r.id));
  });
}

export function payRequest(core, ctx, rid) {
  return core.tx(() => {
    const r = loadReq(core, ctx, rid);
    const adult = addressee(core, ctx, r);
    if (r.type !== 'withdraw') throw err(400, 'bad_type', '출금 요청이 아니에요.');
    if (r.status === 'paid') return reqOut(core, r); // 재시도 → 한 번만 차감
    if (r.status !== 'approved') throw err(409, 'not_approved', '먼저 승인해 주세요.');
    const { row } = ledgerAdd(core, { familyId: r.family_id, kidId: r.kid_id, kind: 'withdraw', amount: -r.amount, memo: r.purpose, actorId: adult.id, requestId: r.id, idemKey: `req:${r.id}:paid` });
    setStatus(core, r, 'paid', { by: adult.id, ledgerId: row.id });
    notifyKidMoney(core, r.family_id, r.kid_id, 'money_done', '받았어요', `${r.amount.toLocaleString('ko-KR')}원을 받았어요.`);
    core.refresh(r.family_id, 'requests', 'wallet');
    return reqOut(core, core.get('SELECT * FROM money_requests WHERE id = ?', r.id));
  });
}

export function completePurchase(core, ctx, rid, b) {
  return core.tx(() => {
    const r = loadReq(core, ctx, rid);
    const adult = addressee(core, ctx, r);
    if (r.type !== 'purchase') throw err(400, 'bad_type', '구매 요청이 아니에요.');
    if (r.status === 'completed') return reqOut(core, r);
    if (r.status !== 'approved') throw err(409, 'not_approved', '먼저 승인해 주세요.');
    const actual = money(b?.actualAmount ?? r.amount, '실제 금액');
    const wish = core.get('SELECT * FROM wishes WHERE id = ?', r.wish_id);
    const extra = actual - wish.allocated;
    if (extra > 0) {
      const w = wallet(core, r.kid_id);
      if (extra > w.available) throw err(409, 'insufficient', `실제 금액이 모은 돈보다 ${extra.toLocaleString('ko-KR')}원 많아요. 사용 가능 금액이 부족해요.`, { available: w.available });
    }
    const { row } = ledgerAdd(core, { familyId: r.family_id, kidId: r.kid_id, kind: 'purchase', amount: -actual, memo: wish.name, actorId: adult.id, requestId: r.id, idemKey: `req:${r.id}:purchase` });
    // 실제 금액 한 번 차감. 배정액을 0으로 돌리면 남은 배정액(allocated − actual)은 자동으로 사용 가능 금액이 된다.
    core.insert("INSERT INTO goal_moves (wish_id, kid_id, kind, amount, date, created_at) VALUES (?,?,?,?,?,?)", wish.id, wish.kid_id, 'spend', wish.allocated, core.today(), core.now());
    core.run("UPDATE wishes SET status = 'bought', allocated = 0, bought_at = ?, bought_amount = ?, bought_photo_id = ? WHERE id = ?", core.now(), actual, b?.photoId || wish.photo_id, wish.id);
    setStatus(core, r, 'completed', { by: adult.id, actual, ledgerId: row.id });
    notifyKidMoney(core, r.family_id, r.kid_id, 'money_done', '샀어요!', `${wish.name}을(를) 내가 모아서 샀어요.`);
    core.refresh(r.family_id, 'requests', 'wallet', 'wishes');
    return reqOut(core, core.get('SELECT * FROM money_requests WHERE id = ?', r.id));
  });
}

export { notifyKidMoney };
