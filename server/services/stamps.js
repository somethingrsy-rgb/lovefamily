import { err, text, oneOf, id as vid } from '../util.js';
import { ledgerAdd, wallet } from './money.js';
import { activeStamp, dayState, reconcileRequest } from './routines.js';

export const BOARD_SIZE = 30;
export const BOARD_REWARD = 5000;

const nonVoid = (core, kidId) => core.all('SELECT * FROM stamps WHERE kid_id = ? AND voided = 0 ORDER BY approved_at, id', kidId);

// 보상 정합성 복구: 완성된 도장판 수에 맞춰 보상 적립/회수를 '빠짐없이, 중복 없이' 맞춘다.
// board_rewards(kid, board, seq) 유니크 + ledger idem_key 유니크 + 같은 트랜잭션 → 어느 시점에 재시도해도 안전.
export function reconcileRewards(core, kidId, actorId = null) {
  const kid = core.member(kidId);
  const completed = Math.floor(nonVoid(core, kidId).length / BOARD_SIZE);
  const maxBoard = Math.max(completed, core.get('SELECT COALESCE(MAX(board_no),0) m FROM board_rewards WHERE kid_id = ?', kidId).m);
  for (let n = 1; n <= maxBoard; n++) {
    const credits = core.get("SELECT COUNT(*) c FROM board_rewards WHERE kid_id = ? AND board_no = ? AND kind = 'credit'", kidId, n).c;
    const reverses = core.get("SELECT COUNT(*) c FROM board_rewards WHERE kid_id = ? AND board_no = ? AND kind = 'reverse'", kidId, n).c;
    const net = credits - reverses;
    const should = n <= completed ? 1 : 0;
    if (should && net === 0) {
      const seq = credits + reverses + 1;
      const key = `board:${kidId}:${n}:${seq}`;
      const { row } = ledgerAdd(core, { familyId: kid.family_id, kidId, kind: 'stamp_reward', amount: BOARD_REWARD, memo: `도장판 ${n}번째 완성 보상`, actorId, idemKey: key });
      core.run('INSERT OR IGNORE INTO board_rewards (kid_id, board_no, seq, kind, ledger_id, created_at) VALUES (?,?,?,?,?,?)', kidId, n, seq, 'credit', row.id, core.now());
      core.notify({
        familyId: kid.family_id, memberId: kidId, kind: 'board_complete', title: '도장판 완성! 5,000원이 저금통에 들어왔어요',
        body: `${n}번째 도장판을 다 채웠어요.`, url: '/#/kid/wallet', dedupe: `board-complete:${kidId}:${n}:${seq}`,
      });
    } else if (!should && net === 1) {
      const seq = credits + reverses + 1;
      const w = wallet(core, kidId);
      const take = Math.max(0, Math.min(BOARD_REWARD, w.available));
      let ledgerId = null; let settlementId = null;
      if (take > 0) {
        ledgerId = ledgerAdd(core, { familyId: kid.family_id, kidId, kind: 'stamp_reward_adjust', amount: -take, memo: `도장판 ${n}번째 보상 조정(도장 정정)`, actorId, idemKey: `board:${kidId}:${n}:${seq}` }).row.id;
      }
      if (take < BOARD_REWARD) {
        // 이미 건네 준 현금은 장부에서 되돌릴 수 없으므로 별도 정산 내역으로 남긴다.
        settlementId = core.insert('INSERT INTO settlements (family_id, kid_id, amount, reason, created_at) VALUES (?,?,?,?,?)', kid.family_id, kidId, BOARD_REWARD - take, `도장판 ${n}번째 보상 조정: 이미 지급된 현금 정산 필요`, core.now());
      }
      core.run('INSERT OR IGNORE INTO board_rewards (kid_id, board_no, seq, kind, ledger_id, settlement_id, created_at) VALUES (?,?,?,?,?,?,?)', kidId, n, seq, 'reverse', ledgerId, settlementId, core.now());
    }
  }
}

export function approveStamp(core, ctx, requestId) {
  const adult = ctx.adult();
  return core.tx(() => {
    const req = core.get('SELECT * FROM stamp_requests WHERE id = ?', requestId);
    if (!req || req.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 요청이에요.');
    const kid = core.member(req.kid_id);
    // 누군가 이미 줬다면 처리 결과만 보여 준다.
    const done = activeStamp(core, req.kid_id, req.date);
    if (done || req.status === 'approved') {
      const by = core.member((done || core.get('SELECT * FROM stamps WHERE request_id = ?', req.id)).provider_id);
      return { result: 'already', by: { id: by.id, name: by.name }, kidName: kid.name, date: req.date };
    }
    if (req.status !== 'pending') {
      const msg = { stale: '체크가 바뀌어서 이 요청은 더 이상 승인할 수 없어요.', recheck: '다시 확인을 요청한 항목이에요.', voided: '정정된 도장이에요.' }[req.status] || '처리할 수 없는 요청이에요.';
      return { result: 'closed', status: req.status, message: msg, kidName: kid.name, date: req.date };
    }
    const undone = core.get('SELECT COUNT(*) c FROM day_items WHERE day_id = ? AND done = 0', req.day_id).c;
    if (undone > 0) {
      reconcileRequest(core, core.get('SELECT * FROM days WHERE id = ?', req.day_id));
      return { result: 'closed', status: 'stale', message: '체크가 취소되어 승인할 수 없어요.', kidName: kid.name, date: req.date };
    }
    const sid = core.insert('INSERT INTO stamps (family_id, kid_id, date, request_id, provider_id, approved_at) VALUES (?,?,?,?,?,?)', req.family_id, req.kid_id, req.date, req.id, adult.id, core.now());
    core.run("UPDATE stamp_requests SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ?", adult.id, core.now(), req.id);
    core.hooks.afterStampInsert?.(); // 테스트용 장애 주입: 여기서 실패해도 트랜잭션이 통째로 롤백된다
    reconcileRewards(core, req.kid_id, adult.id);
    core.notify({
      familyId: req.family_id, memberId: req.kid_id, kind: 'stamp_approved', title: `${adult.name}이(가) 도장을 줬어요!`,
      body: req.date, url: '/#/kid/stamps', dedupe: `stamp-ok:${sid}`,
    });
    core.refresh(req.family_id, 'approvals', 'home', 'day', 'stamps', 'wallet');
    return { result: 'approved', by: { id: adult.id, name: adult.name }, kidName: kid.name, date: req.date, stampId: sid };
  });
}

export function requestRecheck(core, ctx, requestId, b) {
  const adult = ctx.adult();
  const reason = text(b.reason, '이유', { max: 100 });
  const itemIds = Array.isArray(b.itemIds) ? b.itemIds.map((x) => vid(x, '항목')) : [];
  if (!itemIds.length) throw err(400, 'no_items', '다시 확인할 항목을 골라 주세요.');
  return core.tx(() => {
    const req = core.get('SELECT * FROM stamp_requests WHERE id = ?', requestId);
    if (!req || req.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 요청이에요.');
    if (activeStamp(core, req.kid_id, req.date) || req.status === 'approved') {
      const by = core.member(core.get('SELECT * FROM stamps WHERE request_id = ?', req.id)?.provider_id ?? adult.id);
      return { result: 'already', by: { id: by.id, name: by.name } };
    }
    if (req.status === 'recheck') return { result: 'recheck', by: { id: adult.id, name: adult.name } };
    if (req.status !== 'pending') throw err(409, 'not_pending', '이미 처리된 요청이에요.');
    const items = core.all('SELECT * FROM day_items WHERE day_id = ?', req.day_id);
    const ids = new Set(items.map((i) => i.id));
    if (!itemIds.every((i) => ids.has(i))) throw err(400, 'bad_items', '이 날의 항목이 아니에요.');
    core.run("UPDATE stamp_requests SET status = 'recheck', decided_by = ?, decided_at = ?, recheck_reason = ?, recheck_items = ? WHERE id = ?", adult.id, core.now(), reason, JSON.stringify(itemIds), req.id);
    for (const i of itemIds) core.run('UPDATE day_items SET flag_reason = ? WHERE id = ?', reason, i);
    const names = items.filter((i) => itemIds.includes(i.id)).map((i) => i.name).join(', ');
    core.notify({ familyId: req.family_id, memberId: req.kid_id, kind: 'stamp_recheck', title: `${adult.name}이(가) 다시 확인해 보래요`, body: `${names}: ${reason}`, url: '/#/kid/today', dedupe: `stamp-recheck:${req.id}` });
    core.refresh(req.family_id, 'approvals', 'home', 'day');
    return { result: 'recheck', by: { id: adult.id, name: adult.name } };
  });
}

// 승인된 기록 정정(부모 권한 + 사유). 보상 조건이 바뀌면 조정 내역/정산 내역을 남긴다.
export function voidStamp(core, ctx, stampId, b) {
  const adult = ctx.guardian();
  const reason = text(b.reason, '정정 사유', { max: 100 });
  return core.tx(() => {
    const s = core.get('SELECT * FROM stamps WHERE id = ?', stampId);
    if (!s || s.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 도장이에요.');
    if (s.voided) return { ok: true, already: true };
    core.run('UPDATE stamps SET voided = 1, void_reason = ?, voided_by = ?, voided_at = ? WHERE id = ?', reason, adult.id, core.now(), s.id);
    core.run("UPDATE stamp_requests SET status = 'voided' WHERE id = ?", s.request_id);
    reconcileRewards(core, s.kid_id, adult.id);
    core.refresh(s.family_id, 'home', 'day', 'stamps', 'wallet');
    return { ok: true };
  });
}

export function listApprovals(core, ctx) {
  ctx.adult();
  const reqs = core.all("SELECT * FROM stamp_requests WHERE family_id = ? AND status = 'pending' ORDER BY id", ctx.familyId);
  const recent = core.all("SELECT * FROM stamps WHERE family_id = ? AND voided = 0 ORDER BY approved_at DESC, id DESC LIMIT 6", ctx.familyId);
  return {
    pending: reqs.map((r) => requestDetail(core, r)),
    recent: recent.map((s) => ({ stampId: s.id, kidId: s.kid_id, kidName: core.member(s.kid_id).name, date: s.date, providerName: core.member(s.provider_id).name, at: s.approved_at })),
  };
}

function requestDetail(core, r) {
  const kid = core.member(r.kid_id);
  const items = core.all('SELECT id, name, icon, slot, done, flag_reason FROM day_items WHERE day_id = ? ORDER BY sort, id', r.day_id)
    .map((i) => ({ id: i.id, name: i.name, icon: i.icon, slot: i.slot, done: !!i.done, flag: i.flag_reason }));
  const stamp = core.get('SELECT * FROM stamps WHERE request_id = ? AND voided = 0', r.id);
  return {
    id: r.id, kidId: r.kid_id, kidName: kid.name, kidAvatar: kid.avatar, kidColor: kid.color, date: r.date, status: r.status, createdAt: r.created_at,
    items, decidedBy: r.decided_by ? core.member(r.decided_by)?.name : null, providerName: stamp ? core.member(stamp.provider_id)?.name : null,
    recheckReason: r.recheck_reason,
  };
}

export function getRequestDetail(core, ctx, requestId) {
  ctx.adult();
  const r = core.get('SELECT * FROM stamp_requests WHERE id = ?', requestId);
  if (!r || r.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 요청이에요.');
  return requestDetail(core, r);
}

// 도장판: 아이별 30칸. 30개 채울 때마다 새 판(0/30)으로 시작하고 완성판은 보관.
export function getBoards(core, ctx, kidId) {
  ctx.kid(kidId);
  const stamps = nonVoid(core, kidId);
  const mk = (s, no) => ({ id: s.id, no, date: s.date, providerName: core.member(s.provider_id)?.name, at: s.approved_at });
  const full = Math.floor(stamps.length / BOARD_SIZE);
  const current = stamps.slice(full * BOARD_SIZE).map((s, i) => mk(s, i + 1));
  const completed = [];
  for (let b = 0; b < full; b++) {
    const slice = stamps.slice(b * BOARD_SIZE, (b + 1) * BOARD_SIZE);
    completed.push({ boardNo: b + 1, completedAt: slice[slice.length - 1].approved_at, stamps: slice.map((s, i) => mk(s, i + 1)) });
  }
  const praises = core.all("SELECT p.*, m.name AS from_name FROM praises p JOIN members m ON m.id = p.from_id WHERE p.kid_id = ? AND p.target_type = 'stamp' ORDER BY p.id DESC LIMIT 5", kidId)
    .map((p) => ({ id: p.id, text: p.text, from: p.from_name, at: p.created_at }));
  const settlements = ctx.adultOrNull() ? core.all("SELECT * FROM settlements WHERE kid_id = ? ORDER BY id DESC", kidId).map((s) => ({ id: s.id, amount: s.amount, reason: s.reason, status: s.status, at: s.created_at })) : [];
  return { kidId, boardNo: full + 1, count: current.length, size: BOARD_SIZE, reward: BOARD_REWARD, current, completed, praises, settlements, total: stamps.length };
}

export function settle(core, ctx, settlementId) {
  const adult = ctx.guardian();
  const s = core.get('SELECT * FROM settlements WHERE id = ?', settlementId);
  if (!s || s.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없어요.');
  core.run("UPDATE settlements SET status = 'done', settled_at = ?, settled_by = ? WHERE id = ?", core.now(), adult.id, s.id);
  return { ok: true };
}

export function addPraise(core, ctx, b) {
  const adult = ctx.adult();
  const kid = ctx.kid(vid(b.kidId, '아이'));
  const type = oneOf(b.targetType, ['stamp', 'goal'], '대상');
  const t = text(b.text, '칭찬', { max: 80 });
  core.insert('INSERT INTO praises (family_id, kid_id, from_id, target_type, target_id, text, created_at) VALUES (?,?,?,?,?,?,?)', ctx.familyId, kid.id, adult.id, type, Number(b.targetId) || 0, t, core.now());
  core.notify({ familyId: ctx.familyId, memberId: kid.id, kind: 'praise', title: `${adult.name}의 칭찬`, body: t, url: type === 'stamp' ? '/#/kid/stamps' : '/#/kid/wishes' });
  core.refresh(ctx.familyId, 'stamps', 'wishes');
  return { ok: true };
}

export { dayState };
