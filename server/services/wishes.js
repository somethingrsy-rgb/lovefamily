import { err, text, money, id as vid, weekStart, addDays } from '../util.js';
import { wallet, ledgerAdd, reqOut } from './money.js';

const ACTIVE = ['goal', 'ready', 'purchasing'];
export const STATUS_LABEL = { wanted: '사고 싶어요', goal: '모으는 중', ready: '다 모았어요', purchasing: '사도 되는지 기다려요', bought: '내가 모아서 샀어요', canceled: '취소' };

const wishOut = (core, w) => {
  const need = Math.max(0, w.price - w.allocated);
  const out = {
    id: w.id, kidId: w.kid_id, name: w.name, price: w.price, reason: w.reason, photoId: w.photo_id, photoUrl: w.photo_id ? `/api/photos/${w.photo_id}` : null,
    status: w.status, statusLabel: STATUS_LABEL[w.status], allocated: w.allocated, need, createdAt: w.created_at,
    boughtAt: w.bought_at, boughtAmount: w.bought_amount, boughtPhotoUrl: w.bought_photo_id ? `/api/photos/${w.bought_photo_id}` : null,
  };
  if (ACTIVE.includes(w.status)) out.progress = Math.min(1, w.price ? w.allocated / w.price : 0);
  const req = core.get("SELECT * FROM money_requests WHERE wish_id = ? AND type = 'purchase' ORDER BY id DESC LIMIT 1", w.id);
  if (req && w.status === 'purchasing') out.purchase = reqOut(core, req);
  const praise = core.get("SELECT p.text, m.name AS from_name FROM praises p JOIN members m ON m.id = p.from_id WHERE p.kid_id = ? AND p.target_type = 'goal' AND p.target_id = ? ORDER BY p.id DESC LIMIT 1", w.kid_id, w.id);
  if (praise) out.praise = { text: praise.text, from: praise.from_name };
  return out;
};

function loadWish(core, ctx, wid) {
  const w = core.get('SELECT * FROM wishes WHERE id = ?', wid);
  if (!w || w.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 물건이에요.');
  ctx.kidPrivate(w.kid_id);
  return w;
}
function checkPhoto(core, ctx, photoId, kidId) {
  if (photoId == null) return null;
  const p = core.get('SELECT * FROM photos WHERE id = ?', vid(photoId, '사진'));
  if (!p || p.family_id !== ctx.familyId) throw err(400, 'bad_photo', '사진을 찾을 수 없어요.');
  void kidId;
  return p.id;
}
const statusFor = (w) => (w.allocated >= w.price ? 'ready' : 'goal');

export function listWishes(core, ctx, kidId) {
  ctx.kidPrivate(kidId);
  const ws = core.all("SELECT * FROM wishes WHERE kid_id = ? AND status != 'canceled' ORDER BY (status = 'bought'), id DESC", kidId);
  return { wishes: ws.map((w) => wishOut(core, w)), wallet: wallet(core, kidId) };
}

export function createWish(core, ctx, kidId, b) {
  const { kid } = ctx.kidOrAdult(kidId);
  const name = text(b.name, '물건 이름', { max: 40 });
  const price = money(b.price, '예상 가격');
  const reason = text(b.reason, '이유', { max: 100, optional: true });
  const photo = checkPhoto(core, ctx, b.photoId, kid.id);
  const wid = core.insert("INSERT INTO wishes (family_id, kid_id, name, price, reason, photo_id, status, created_at) VALUES (?,?,?,?,?,?, 'wanted', ?)", ctx.familyId, kid.id, name, price, reason, photo, core.now());
  core.refresh(ctx.familyId, 'wishes');
  return wishOut(core, core.get('SELECT * FROM wishes WHERE id = ?', wid));
}

export function updateWish(core, ctx, wid, b) {
  return core.tx(() => {
    const w = loadWish(core, ctx, wid);
    if (w.status === 'bought' || w.status === 'canceled') throw err(409, 'closed', '이미 끝난 물건이에요.');
    if (w.status === 'purchasing') throw err(409, 'purchasing', '구매 요청 중에는 바꿀 수 없어요. 요청을 먼저 취소해 주세요.');
    const name = b.name !== undefined ? text(b.name, '물건 이름', { max: 40 }) : w.name;
    const price = b.price !== undefined ? money(b.price, '예상 가격') : w.price;
    const reason = b.reason !== undefined ? text(b.reason, '이유', { max: 100, optional: true }) : w.reason;
    const photo = b.photoId !== undefined ? checkPhoto(core, ctx, b.photoId, w.kid_id) : w.photo_id;
    let status = w.status;
    if (ACTIVE.includes(w.status)) status = statusFor({ allocated: w.allocated, price }); // 가격이 오르면 부족분이 다시 생긴다
    core.run('UPDATE wishes SET name = ?, price = ?, reason = ?, photo_id = ?, status = ? WHERE id = ?', name, price, reason, photo, status, w.id);
    core.refresh(ctx.familyId, 'wishes', 'wallet');
    return wishOut(core, core.get('SELECT * FROM wishes WHERE id = ?', w.id));
  });
}

export function removeWish(core, ctx, wid) {
  return core.tx(() => {
    const w = loadWish(core, ctx, wid);
    if (ACTIVE.includes(w.status)) throw err(409, 'active_goal', '목표로 모으는 중이에요. 목표를 먼저 취소해 주세요.');
    if (w.status === 'bought') throw err(409, 'closed', '산 물건은 지울 수 없어요.');
    core.run("UPDATE wishes SET status = 'canceled' WHERE id = ?", w.id);
    core.refresh(ctx.familyId, 'wishes');
    return { ok: true };
  });
}

export function setGoal(core, ctx, wid) {
  return core.tx(() => {
    const w = loadWish(core, ctx, wid);
    if (ACTIVE.includes(w.status)) return wishOut(core, w);
    if (w.status !== 'wanted') throw err(409, 'closed', '목표로 정할 수 없는 물건이에요.');
    if (core.get(`SELECT 1 FROM wishes WHERE kid_id = ? AND status IN ('goal','ready','purchasing')`, w.kid_id)) {
      throw err(409, 'one_goal', '지금 목표는 한 개만 정할 수 있어요. 먼저 모으던 목표를 마치거나 취소해 주세요.');
    }
    core.run("UPDATE wishes SET status = 'goal' WHERE id = ?", w.id);
    core.refresh(ctx.familyId, 'wishes');
    return wishOut(core, core.get('SELECT * FROM wishes WHERE id = ?', w.id));
  });
}

// 저금통의 '사용 가능한 돈'을 목표에 담거나(add) 뺀다(remove)
export function allocate(core, ctx, wid, b) {
  const amount = money(b.amount);
  const op = b.op === 'remove' ? 'remove' : 'add';
  return core.tx(() => {
    const w = loadWish(core, ctx, wid);
    if (w.status === 'purchasing') throw err(409, 'purchasing', '구매 요청 중에는 담거나 뺄 수 없어요.');
    if (!['goal', 'ready'].includes(w.status)) throw err(409, 'not_goal', '목표로 정한 물건에만 돈을 담을 수 있어요.');
    if (op === 'add') {
      const w2 = wallet(core, w.kid_id);
      if (amount > w2.available) throw err(409, 'insufficient', `지금 쓸 수 있는 돈은 ${w2.available.toLocaleString('ko-KR')}원이에요.`, { available: w2.available });
      if (amount > w.price - w.allocated) throw err(409, 'over_goal', `목표까지 ${(Math.max(0, w.price - w.allocated)).toLocaleString('ko-KR')}원만 더 담을 수 있어요.`);
    } else if (amount > w.allocated) {
      throw err(409, 'insufficient', `목표에 모아둔 돈은 ${w.allocated.toLocaleString('ko-KR')}원이에요.`);
    }
    const newAlloc = w.allocated + (op === 'add' ? amount : -amount);
    core.insert('INSERT INTO goal_moves (wish_id, kid_id, kind, amount, date, created_at) VALUES (?,?,?,?,?,?)', w.id, w.kid_id, op, amount, core.today(), core.now());
    core.run('UPDATE wishes SET allocated = ?, status = ? WHERE id = ?', newAlloc, statusFor({ allocated: newAlloc, price: w.price }), w.id);
    core.refresh(ctx.familyId, 'wishes', 'wallet');
    const after = core.get('SELECT * FROM wishes WHERE id = ?', w.id);
    return { wish: wishOut(core, after), wallet: wallet(core, w.kid_id), celebrate: after.status === 'ready' && w.status !== 'ready' };
  });
}

export function cancelGoal(core, ctx, wid) {
  return core.tx(() => {
    const w = loadWish(core, ctx, wid);
    if (w.status === 'wanted') return wishOut(core, w);
    if (w.status === 'purchasing') throw err(409, 'purchasing', '구매 요청을 먼저 취소하거나 정리해 주세요.');
    if (!['goal', 'ready'].includes(w.status)) throw err(409, 'closed', '취소할 수 없는 상태예요.');
    if (w.allocated > 0) core.insert('INSERT INTO goal_moves (wish_id, kid_id, kind, amount, date, created_at) VALUES (?,?,?,?,?,?)', w.id, w.kid_id, 'remove', w.allocated, core.today(), core.now());
    core.run("UPDATE wishes SET status = 'wanted', allocated = 0 WHERE id = ?", w.id);
    core.refresh(ctx.familyId, 'wishes', 'wallet');
    return wishOut(core, core.get('SELECT * FROM wishes WHERE id = ?', w.id));
  });
}

// '사고 싶어요': 아이가 사진·금액을 어른에게 보낸다
export function buyRequest(core, ctx, wid, b) {
  return core.tx(() => {
    const w = loadWish(core, ctx, wid);
    const kid = ctx.asKid(w.kid_id);
    if (w.status === 'purchasing') return wishOut(core, w);
    if (w.status !== 'ready') {
      const need = Math.max(0, w.price - w.allocated);
      throw err(409, 'short', `아직 ${need.toLocaleString('ko-KR')}원이 더 필요해요.`, { need });
    }
    const to = ctx.adultMember(vid(b.toMemberId, '받을 어른'));
    const rid = core.insert("INSERT INTO money_requests (family_id, kid_id, type, amount, purpose, to_member_id, status, wish_id, created_at, updated_at) VALUES (?,?,?,?,?,?, 'pending', ?, ?, ?)",
      ctx.familyId, kid.id, 'purchase', w.price, w.name, to.id, w.id, core.now(), core.now());
    core.run("UPDATE wishes SET status = 'purchasing' WHERE id = ?", w.id);
    core.notify({ familyId: ctx.familyId, memberId: to.id, kind: 'money_purchase', title: `${kid.name}이(가) 사고 싶어해요`, body: `${w.name} · ${w.price.toLocaleString('ko-KR')}원`, url: `/#/money/${rid}`, dedupe: `money-req:${rid}`, lock: `${kid.name} · 구매 요청` });
    core.refresh(ctx.familyId, 'wishes', 'requests');
    return wishOut(core, core.get('SELECT * FROM wishes WHERE id = ?', w.id));
  });
}

// ---------- 저축 미션 ----------
// 기본 미션은 거래 기록으로 달성을 계산한다(현금 보상 없음).
//  - 이번 주 목표에 1,000원 담기: 이번 주 '담은 돈 − 뺀 돈'의 순증가 ≥ 1,000 (넣고 빼기를 반복해도 같은 금액은 한 번만 인정)
//  - 용돈 받은 날 저금통에 기록하기: 오늘 입금 기록이 있으면 달성
export function listMissions(core, ctx, kidId) {
  ctx.kidPrivate(kidId);
  const today = core.today();
  const ws = weekStart(today);
  const net = core.get("SELECT COALESCE(SUM(CASE kind WHEN 'add' THEN amount WHEN 'remove' THEN -amount ELSE 0 END),0) s FROM goal_moves WHERE kid_id = ? AND date >= ? AND date <= ?", kidId, ws, addDays(ws, 6)).s;
  const dep = core.get("SELECT COUNT(*) c FROM ledger WHERE kid_id = ? AND kind = 'deposit' AND date = ?", kidId, today).c;
  const sys = [
    { key: 'weekly_goal', title: '이번 주에 목표에 1,000원 담기', target: 1000, progress: Math.max(0, Math.min(1000, net)), achieved: net >= 1000, period: ws },
    { key: 'deposit_day', title: '용돈 받은 날 저금통에 기록하기', target: 1, progress: dep ? 1 : 0, achieved: dep > 0, period: today },
  ];
  for (const m of sys) if (m.achieved) core.run('INSERT OR IGNORE INTO achievements (kid_id, key, period, created_at) VALUES (?,?,?,?)', kidId, m.key, m.period, core.now());
  const history = core.get('SELECT COUNT(*) c FROM achievements WHERE kid_id = ?', kidId).c;
  const custom = core.all("SELECT * FROM missions WHERE kid_id = ? AND status != 'canceled' ORDER BY (status = 'done'), id DESC LIMIT 30", kidId).map((m) => ({
    id: m.id, title: m.title, reward: m.reward, status: m.status, requestedAt: m.requested_at, doneAt: m.done_at, doneBy: m.done_by ? core.member(m.done_by)?.name : null,
  }));
  return { system: sys, custom, achievementCount: history };
}

export function createMission(core, ctx, b) {
  const adult = ctx.adult();
  const kid = ctx.kid(vid(b.kidId, '아이'));
  const title = text(b.title, '미션 이름', { max: 60 });
  const reward = b.reward ? money(b.reward, '보상', { min: 0 }) : 0;
  const mid = core.insert("INSERT INTO missions (family_id, kid_id, title, reward, created_by, created_at) VALUES (?,?,?,?,?,?)", ctx.familyId, kid.id, title, reward, adult.id, core.now());
  core.notify({ familyId: ctx.familyId, memberId: kid.id, kind: 'mission_new', title: '새 미션이 왔어요', body: title, url: '/#/kid/missions' });
  core.refresh(ctx.familyId, 'missions');
  return { id: mid };
}

export function requestMission(core, ctx, mid) {
  return core.tx(() => {
    const m = core.get('SELECT * FROM missions WHERE id = ?', mid);
    if (!m || m.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 미션이에요.');
    const kid = ctx.asKid(m.kid_id);
    if (m.status === 'requested') return { ok: true };
    if (m.status !== 'open') throw err(409, 'closed', '이미 끝난 미션이에요.');
    core.run("UPDATE missions SET status = 'requested', requested_at = ? WHERE id = ?", core.now(), m.id);
    for (const a of core.adults(ctx.familyId)) {
      core.notify({ familyId: ctx.familyId, memberId: a.id, kind: 'mission_request', title: `${kid.name}의 미션 완료 확인`, body: m.title, url: '/#/adult', dedupe: `mission-req:${m.id}:${a.id}`, lock: `${kid.name} · 미션 확인 요청` });
    }
    core.refresh(ctx.familyId, 'missions', 'approvals');
    return { ok: true };
  });
}

// 세 분 중 한 분 확인 → 보상은 한 번만 입금
export function confirmMission(core, ctx, mid, { reject = false } = {}) {
  const adult = ctx.adult();
  return core.tx(() => {
    const m = core.get('SELECT * FROM missions WHERE id = ?', mid);
    if (!m || m.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 미션이에요.');
    if (m.status === 'done') return { result: 'already', by: core.member(m.done_by)?.name };
    if (m.status !== 'requested') throw err(409, 'not_requested', '완료 요청이 없는 미션이에요.');
    if (reject) {
      core.run("UPDATE missions SET status = 'open', requested_at = NULL WHERE id = ?", m.id);
      core.notify({ familyId: ctx.familyId, memberId: m.kid_id, kind: 'mission_back', title: '미션을 조금 더 해 볼까요?', body: m.title, url: '/#/kid/missions' });
    } else {
      let ledgerId = null;
      if (m.reward > 0) ledgerId = ledgerAdd(core, { familyId: ctx.familyId, kidId: m.kid_id, kind: 'mission_reward', amount: m.reward, memo: `미션: ${m.title}`, actorId: adult.id, idemKey: `mission:${m.id}` }).row.id;
      core.run("UPDATE missions SET status = 'done', done_by = ?, done_at = ?, ledger_id = ? WHERE id = ?", adult.id, core.now(), ledgerId, m.id);
      core.notify({ familyId: ctx.familyId, memberId: m.kid_id, kind: 'mission_done', title: `${adult.name}이(가) 미션을 확인했어요!`, body: m.reward ? `${m.reward.toLocaleString('ko-KR')}원 보상이 들어왔어요.` : m.title, url: '/#/kid/missions' });
    }
    core.refresh(ctx.familyId, 'missions', 'approvals', 'wallet');
    return { result: reject ? 'rejected' : 'confirmed', by: adult.name };
  });
}

export function cancelMission(core, ctx, mid) {
  ctx.adult();
  const m = core.get('SELECT * FROM missions WHERE id = ?', mid);
  if (!m || m.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 미션이에요.');
  if (m.status === 'done') throw err(409, 'closed', '이미 끝난 미션이에요.');
  core.run("UPDATE missions SET status = 'canceled' WHERE id = ?", m.id);
  core.refresh(ctx.familyId, 'missions', 'approvals');
  return { ok: true };
}

export function requestedMissions(core, familyId) {
  return core.all("SELECT * FROM missions WHERE family_id = ? AND status = 'requested' ORDER BY id", familyId).map((m) => ({
    id: m.id, kidId: m.kid_id, kidName: core.member(m.kid_id).name, title: m.title, reward: m.reward, requestedAt: m.requested_at,
  }));
}
