import { err, text, oneOf, dow, isDate, isMonth, monthRange, id as vid } from '../util.js';

export const SLOTS = ['morning', 'after_school', 'evening'];
export const SLOT_LABEL = { morning: '아침', after_school: '하교 후', evening: '저녁' };
const SLOT_ORDER = { morning: 0, after_school: 1, evening: 2 };
export const DAY_MASKS = { daily: 0b1111111, weekdays: 0b0111110, weekend: 0b1000001 };

export function parseDays(v) {
  if (typeof v === 'string' && DAY_MASKS[v]) return DAY_MASKS[v];
  if (Array.isArray(v) && v.length && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return v.reduce((m, d) => m | (1 << d), 0);
  throw err(400, 'bad_days', '반복 요일을 선택해 주세요.');
}
// 타이머 연결: 명시하면 그 활동, null 이면 연결 없음, 생략하면 이름이 같은 활동(예: 식사하기)에 자동 연결
function resolveActivity(core, familyId, v, name) {
  if (v === null || v === 0 || v === '') return null;
  if (v === undefined) return core.get('SELECT id FROM activities WHERE family_id = ? AND active = 1 AND name = ?', familyId, name)?.id ?? null;
  const a = core.get('SELECT id FROM activities WHERE id = ? AND family_id = ? AND active = 1', Number(v), familyId);
  if (!a) throw err(400, 'bad_activity', '타이머 활동을 찾을 수 없어요.');
  return a.id;
}
export const daysArray = (mask) => [0, 1, 2, 3, 4, 5, 6].filter((d) => (mask >> d) & 1);
const scheduledOn = (routine, date) => ((routine.days >> dow(date)) & 1) === 1;

// 오늘 스냅샷을 만든다. 이미 있으면 그대로(과거·오늘 기록은 루틴 수정과 무관하게 유지).
export function ensureDay(core, kidId, date) {
  const exist = core.get('SELECT * FROM days WHERE kid_id = ? AND date = ?', kidId, date);
  if (exist) return exist;
  if (date !== core.today()) return null;
  return core.tx(() => {
    const again = core.get('SELECT * FROM days WHERE kid_id = ? AND date = ?', kidId, date);
    if (again) return again;
    const kid = core.member(kidId);
    const dayId = core.insert('INSERT INTO days (family_id, kid_id, date, created_at) VALUES (?,?,?,?)', kid.family_id, kidId, date, core.now());
    const rs = core.all('SELECT * FROM routines WHERE kid_id = ? AND active = 1', kidId)
      .filter((r) => scheduledOn(r, date))
      .sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] || a.sort - b.sort || a.id - b.id);
    rs.forEach((r, i) => core.insert('INSERT INTO day_items (day_id, routine_id, name, icon, slot, sort, activity_id) VALUES (?,?,?,?,?,?,?)', dayId, r.id, r.name, r.icon, r.slot, i, r.activity_id));
    return core.get('SELECT * FROM days WHERE id = ?', dayId);
  });
}
export function ensureToday(core, familyId = null) {
  const kids = familyId ? core.kids(familyId) : core.all("SELECT * FROM members WHERE kind = 'kid'");
  for (const k of kids) ensureDay(core, k.id, core.today());
}

export function activeStamp(core, kidId, date) {
  return core.get('SELECT * FROM stamps WHERE kid_id = ? AND date = ? AND voided = 0', kidId, date);
}

// 하루 상태를 항목 상태에 맞춰 정리: 미완료가 생기면 대기 요청 무효화, 모두 완료되면 요청 자동 생성
export function reconcileRequest(core, day) {
  const kid = core.member(day.kid_id);
  const total = core.get('SELECT COUNT(*) c FROM day_items WHERE day_id = ?', day.id).c;
  const undone = core.get('SELECT COUNT(*) c FROM day_items WHERE day_id = ? AND done = 0', day.id).c;
  const pending = core.get("SELECT * FROM stamp_requests WHERE day_id = ? AND status = 'pending'", day.id);
  if (activeStamp(core, day.kid_id, day.date)) return null;
  if (pending && (undone > 0 || total === 0)) {
    core.run("UPDATE stamp_requests SET status = 'stale', decided_at = ? WHERE id = ?", core.now(), pending.id);
    core.refresh(day.family_id, 'approvals', 'home', 'day');
    return null;
  }
  if (!pending && undone === 0 && total > 0) {
    const rid = core.insert("INSERT INTO stamp_requests (family_id, kid_id, day_id, date, status, created_at) VALUES (?,?,?,?, 'pending', ?)", day.family_id, day.kid_id, day.id, day.date, core.now());
    for (const a of core.adults(day.family_id)) {
      core.notify({
        familyId: day.family_id, memberId: a.id, kind: 'stamp_request', popup: true,
        title: `${kid.name}의 도장 확인`, body: `${day.date} 루틴을 모두 했어요. 확인해 주세요.`,
        url: `/#/approve/${rid}`, dedupe: `stamp-req:${rid}:${a.id}`, lock: `${kid.name} · 도장 확인 요청`,
      });
    }
    core.refresh(day.family_id, 'approvals', 'home', 'day');
    return rid;
  }
  return pending?.id ?? null;
}

export function dayState(core, kidId, date) {
  const kid = core.member(kidId);
  const day = ensureDay(core, kidId, date);
  if (!day) return { kidId, date, exists: false, status: 'none', items: [], total: 0, done: 0, editable: false };
  const items = core.all('SELECT * FROM day_items WHERE day_id = ? ORDER BY sort, id', day.id).map((i) => ({
    id: i.id, name: i.name, icon: i.icon, slot: i.slot, slotLabel: SLOT_LABEL[i.slot], done: !!i.done, flag: i.flag_reason || null, activityId: i.activity_id || null,
  }));
  const stamp = activeStamp(core, kidId, date);
  const pending = core.get("SELECT * FROM stamp_requests WHERE day_id = ? AND status = 'pending'", day.id);
  const last = core.get('SELECT * FROM stamp_requests WHERE day_id = ? ORDER BY id DESC LIMIT 1', day.id);
  const done = items.filter((i) => i.done).length;
  let status = 'open';
  if (!items.length) status = 'none';
  else if (stamp) status = 'approved';
  else if (pending) status = 'requested';
  else if (last?.status === 'recheck') status = 'recheck';
  const out = { kidId, date, exists: true, dayId: day.id, status, items, total: items.length, done, editable: !stamp };
  if (stamp) { const p = core.member(stamp.provider_id); out.stamp = { id: stamp.id, providerId: stamp.provider_id, providerName: p?.name, at: stamp.approved_at }; }
  if (pending) out.requestId = pending.id;
  if (status === 'recheck') out.recheck = { reason: last.recheck_reason, items: JSON.parse(last.recheck_items || '[]') };
  void kid;
  return out;
}

export function setItemDone(core, ctx, itemId, done) {
  const item = core.get('SELECT i.*, d.kid_id, d.family_id, d.date, d.id AS did FROM day_items i JOIN days d ON d.id = i.day_id WHERE i.id = ?', itemId);
  if (!item || item.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 항목이에요.');
  ctx.ownOnly(item.kid_id);
  if (typeof done !== 'boolean') throw err(400, 'bad_value', 'done 값이 필요해요.');
  return core.tx(() => {
    if (activeStamp(core, item.kid_id, item.date)) throw err(409, 'locked', '도장을 받은 날은 바꿀 수 없어요.');
    if (!!item.done !== done) {
      core.run('UPDATE day_items SET done = ?, done_at = ?, flag_reason = NULL WHERE id = ?', done ? 1 : 0, done ? core.now() : null, item.id);
    }
    reconcileRequest(core, core.get('SELECT * FROM days WHERE id = ?', item.did));
    core.refresh(ctx.familyId, 'home', 'day');
    return dayState(core, item.kid_id, item.date);
  });
}

// 완료 상태인데 요청이 없을 때(다시 확인 이후 등) 아이가 직접 다시 요청
export function requestStamp(core, ctx, kidId, date) {
  ctx.ownOnly(kidId);
  if (!isDate(date)) throw err(400, 'bad_date', '날짜가 올바르지 않아요.');
  const st = dayState(core, kidId, date);
  if (!st.exists) throw err(404, 'no_day', '그날의 루틴 기록이 없어요.');
  return core.tx(() => {
    if (st.status === 'approved') return st;
    if (st.done < st.total || !st.total) throw err(409, 'incomplete', '아직 끝내지 못한 루틴이 있어요.');
    reconcileRequest(core, core.get('SELECT * FROM days WHERE id = ?', st.dayId));
    core.refresh(ctx.familyId, 'home', 'day');
    return dayState(core, kidId, date);
  });
}

// ---------- 루틴 정의 CRUD ----------
const routineOut = (r) => ({ activityId: r.activity_id || null, id: r.id, kidId: r.kid_id, name: r.name, icon: r.icon, days: daysArray(r.days), slot: r.slot, slotLabel: SLOT_LABEL[r.slot], sort: r.sort });

export function listRoutines(core, ctx, kidId) {
  ctx.kid(kidId);
  return core.all('SELECT * FROM routines WHERE kid_id = ? AND active = 1 ORDER BY sort, id', kidId).map(routineOut);
}

export function createRoutines(core, ctx, b) {
  ctx.adult();
  const kidIds = (Array.isArray(b.kidIds) ? b.kidIds : [b.kidId]).map((k) => vid(k, '아이'));
  if (!kidIds.length) throw err(400, 'bad_kid', '아이를 선택해 주세요.');
  const name = text(b.name, '루틴 이름', { max: 30 });
  const icon = text(b.icon || '✅', '아이콘', { max: 8 });
  const days = parseDays(b.days ?? 'daily');
  const slot = oneOf(b.slot || 'morning', SLOTS, '시간대');
  return core.tx(() => {
    const out = [];
    const activityId = resolveActivity(core, ctx.familyId, b.activityId, name);
    for (const kidId of kidIds) {
      ctx.kid(kidId);
      ensureDay(core, kidId, core.today()); // 오늘 목록은 건드리지 않도록 먼저 스냅샷
      const sort = (core.get('SELECT COALESCE(MAX(sort), -1) m FROM routines WHERE kid_id = ?', kidId).m) + 1;
      const rid = core.insert('INSERT INTO routines (family_id, kid_id, name, icon, days, slot, sort, activity_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', ctx.familyId, kidId, name, icon, days, slot, sort, activityId, core.now(), core.now());
      applyToday(core, core.get('SELECT * FROM routines WHERE id = ?', rid)); // 새 루틴은 오늘이 예정일이면 바로 오늘 목록에(승인 전 한정)
      out.push(routineOut(core.get('SELECT * FROM routines WHERE id = ?', rid)));
    }
    core.refresh(ctx.familyId, 'routines', 'home', 'day');
    return out;
  });
}

// 오늘 목록에 한해 예외 적용(도장 승인 전만)
function applyToday(core, routine) {
  const today = core.today();
  const day = ensureDay(core, routine.kid_id, today);
  if (!day || activeStamp(core, routine.kid_id, today)) return false;
  const item = core.get('SELECT * FROM day_items WHERE day_id = ? AND routine_id = ?', day.id, routine.id);
  const should = routine.active && scheduledOn(routine, today);
  if (item && !should) core.run('DELETE FROM day_items WHERE id = ?', item.id);
  else if (item) core.run('UPDATE day_items SET name = ?, icon = ?, slot = ?, activity_id = ? WHERE id = ?', routine.name, routine.icon, routine.slot, routine.activity_id, item.id);
  else if (should) core.insert('INSERT INTO day_items (day_id, routine_id, name, icon, slot, sort, activity_id) VALUES (?,?,?,?,?,?,?)', day.id, routine.id, routine.name, routine.icon, routine.slot, 999, routine.activity_id);
  reconcileRequest(core, day);
  return true;
}

export function updateRoutine(core, ctx, routineId, b) {
  ctx.adult();
  const r = core.get('SELECT * FROM routines WHERE id = ? AND active = 1', routineId);
  if (!r || r.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 루틴이에요.');
  return core.tx(() => {
    ensureDay(core, r.kid_id, core.today());
    const name = b.name !== undefined ? text(b.name, '루틴 이름', { max: 30 }) : r.name;
    const icon = b.icon !== undefined ? text(b.icon, '아이콘', { max: 8 }) : r.icon;
    const days = b.days !== undefined ? parseDays(b.days) : r.days;
    const slot = b.slot !== undefined ? oneOf(b.slot, SLOTS, '시간대') : r.slot;
    const activityId = b.activityId !== undefined ? resolveActivity(core, ctx.familyId, b.activityId, name) : r.activity_id;
    core.run('UPDATE routines SET name = ?, icon = ?, days = ?, slot = ?, activity_id = ?, updated_at = ? WHERE id = ?', name, icon, days, slot, activityId, core.now(), r.id);
    const applied = b.applyToday ? applyToday(core, core.get('SELECT * FROM routines WHERE id = ?', r.id)) : false;
    core.refresh(ctx.familyId, 'routines', 'home', 'day');
    return { routine: routineOut(core.get('SELECT * FROM routines WHERE id = ?', r.id)), appliedToday: applied };
  });
}

export function deleteRoutine(core, ctx, routineId, applyTodayFlag) {
  ctx.adult();
  const r = core.get('SELECT * FROM routines WHERE id = ? AND active = 1', routineId);
  if (!r || r.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 루틴이에요.');
  return core.tx(() => {
    ensureDay(core, r.kid_id, core.today());
    core.run('UPDATE routines SET active = 0, updated_at = ? WHERE id = ?', core.now(), r.id); // 소프트 삭제: 과거 기록 보존
    const applied = applyTodayFlag ? applyToday(core, core.get('SELECT * FROM routines WHERE id = ?', r.id)) : false;
    core.refresh(ctx.familyId, 'routines', 'home', 'day');
    return { ok: true, appliedToday: applied };
  });
}

export function reorderRoutines(core, ctx, kidId, order) {
  ctx.adult();
  ctx.kid(kidId);
  if (!Array.isArray(order)) throw err(400, 'bad_order', '순서 목록이 필요해요.');
  return core.tx(() => {
    order.forEach((rid, i) => core.run('UPDATE routines SET sort = ? WHERE id = ? AND kid_id = ?', i, rid, kidId));
    core.refresh(ctx.familyId, 'routines');
    return listRoutines(core, ctx, kidId);
  });
}

// 월간 달력: 날짜별 체크 결과·도장 여부 (스냅샷이 있는 날)
export function calendar(core, ctx, kidId, month) {
  ctx.kid(kidId);
  if (!isMonth(month)) throw err(400, 'bad_month', '월 형식은 YYYY-MM 이에요.');
  const { first, next } = monthRange(month);
  const rows = core.all(
    `SELECT d.id, d.date, (SELECT COUNT(*) FROM day_items WHERE day_id = d.id) total,
            (SELECT COUNT(*) FROM day_items WHERE day_id = d.id AND done = 1) done,
            (SELECT COUNT(*) FROM stamps s WHERE s.kid_id = d.kid_id AND s.date = d.date AND s.voided = 0) stamp,
            (SELECT COUNT(*) FROM stamp_requests r WHERE r.day_id = d.id AND r.status = 'pending') pending
       FROM days d WHERE d.kid_id = ? AND d.date >= ? AND d.date < ? ORDER BY d.date`, kidId, first, next);
  return rows.map((r) => ({ date: r.date, total: r.total, done: r.done, stamp: !!r.stamp, pending: !!r.pending }));
}
