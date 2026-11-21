import { err, text, money, id as vid, oneOf } from '../util.js';
import { warnText, endText, nextEndText } from '../ko.js';

export const WARN_MS = 5 * 60 * 1000;
const KINDS = ['meal', 'tv', 'game', 'brush', 'homework', 'reading', 'bath', 'other'];
// [이름, 아이콘, 종류, 기본 시간(분)] — 어른이 가족 탭에서 이름·시간을 바꿀 수 있다
const DEFAULTS = [['씻기', '🛁', 'bath', 20], ['숙제하기', '📚', 'homework', 30], ['식사하기', '🍽️', 'meal', 30], ['게임하기', '🎮', 'game', 30], ['TV 보기', '📺', 'tv', 30], ['책 읽기', '📖', 'reading', 30], ['양치하기', '🪥', 'brush', 5]];
const KIND_ORDER = ['bath', 'homework', 'meal', 'game', 'tv', 'reading', 'brush']; // 활동 고르기 화면의 기본 순서

// 기본 활동 중 아직 없는 종류만 채운다(이미 지운 활동은 되살리지 않는다 — 종류가 한 번이라도 있었으면 건너뜀).
export function seedActivities(core, familyId) {
  for (const [name, icon, kind, minutes] of DEFAULTS) {
    if (core.get('SELECT 1 FROM activities WHERE family_id = ? AND kind = ?', familyId, kind)) continue;
    const sort = core.get('SELECT COALESCE(MAX(sort), -1) + 1 n FROM activities WHERE family_id = ?', familyId).n;
    core.insert('INSERT INTO activities (family_id, name, icon, kind, minutes, sort, created_at) VALUES (?,?,?,?,?,?,?)', familyId, name, icon, kind, minutes, sort, core.now());
  }
}
export function ensureDefaultActivities(core) {
  for (const f of core.all('SELECT id FROM families')) core.tx(() => seedActivities(core, f.id));
  // 순서 정리는 DB 버전으로 딱 한 번만(이후 어른이 바꾼 순서는 건드리지 않는다): 기본 7종은 KIND_ORDER 순, 직접 추가한 활동은 그 뒤
  const v = core.db.prepare('PRAGMA user_version').get().user_version;
  if (v < 1) {
    core.tx(() => {
      for (const f of core.all('SELECT id FROM families')) {
        const rows = core.all('SELECT id, kind FROM activities WHERE family_id = ? ORDER BY sort, id', f.id);
        const known = KIND_ORDER.map((k) => rows.find((r) => r.kind === k)).filter(Boolean);
        const rest = rows.filter((r) => !known.includes(r));
        [...known, ...rest].forEach((r, i) => core.run('UPDATE activities SET sort = ? WHERE id = ?', i, r.id));
      }
      core.db.exec('PRAGMA user_version = 1');
    });
  }
}

// ---------- 활동 설정 (어른) ----------
const actOut = (a) => ({ id: a.id, name: a.name, icon: a.icon, kind: a.kind, minutes: a.minutes });
export function listActivities(core, ctx) {
  return core.all('SELECT * FROM activities WHERE family_id = ? AND active = 1 ORDER BY sort, id', ctx.familyId).map(actOut);
}
export function createActivity(core, ctx, b) {
  ctx.adult();
  const sort = core.get('SELECT COALESCE(MAX(sort), -1) + 1 n FROM activities WHERE family_id = ?', ctx.familyId).n;
  const aid = core.insert('INSERT INTO activities (family_id, name, icon, kind, minutes, sort, created_at) VALUES (?,?,?,?,?,?,?)', ctx.familyId,
    text(b.name, '활동 이름', { max: 20 }), text(b.icon || '⏱️', '아이콘', { max: 8 }), oneOf(b.kind || 'other', KINDS, '종류'), money(b.minutes ?? 30, '시간(분)', { min: 1, max: 240 }), sort, core.now());
  core.refresh(ctx.familyId, 'timers', 'activities');
  return actOut(core.get('SELECT * FROM activities WHERE id = ?', aid));
}
export function updateActivity(core, ctx, aid, b) {
  ctx.adult();
  const a = core.get('SELECT * FROM activities WHERE id = ? AND active = 1', aid);
  if (!a || a.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 활동이에요.');
  core.run('UPDATE activities SET name = ?, icon = ?, minutes = ? WHERE id = ?', b.name !== undefined ? text(b.name, '활동 이름', { max: 20 }) : a.name,
    b.icon !== undefined ? text(b.icon, '아이콘', { max: 8 }) : a.icon, b.minutes !== undefined ? money(b.minutes, '시간(분)', { min: 1, max: 240 }) : a.minutes, a.id);
  core.refresh(ctx.familyId, 'timers', 'activities');
  return actOut(core.get('SELECT * FROM activities WHERE id = ?', a.id));
}
export function deleteActivity(core, ctx, aid) {
  ctx.adult();
  const a = core.get('SELECT * FROM activities WHERE id = ? AND active = 1', aid);
  if (!a || a.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 활동이에요.');
  core.run('UPDATE activities SET active = 0 WHERE id = ?', a.id);
  core.run('UPDATE routines SET activity_id = NULL WHERE activity_id = ?', a.id);
  core.refresh(ctx.familyId, 'activities');
  return { ok: true };
}

// ---------- 활동 ----------
// 남은 시간은 항상 ends_at − 현재 시각으로 계산한다. (화면 이동·새로고침·잠금 해제 후에도 동일)
export function timerOut(core, t, now = core.now()) {
  const kid = core.member(t.kid_id);
  let next = null;
  if (t.next_type === 'routine') {
    const it = core.get('SELECT * FROM day_items WHERE id = ?', t.next_item_id);
    if (it) next = { type: 'routine', itemId: it.id, name: it.name, icon: it.icon, done: !!it.done, activityId: it.activity_id || null };
  } else if (t.next_type === 'custom') next = { type: 'custom', name: t.next_name, icon: t.next_icon, done: false };
  const ended = now >= t.ends_at;
  const total = t.duration_ms + t.extended_ms;
  return {
    id: t.id, kidId: t.kid_id, kidName: kid.name, kidAvatar: kid.avatar, kidColor: kid.color, activityId: t.activity_id, name: t.name, icon: t.icon, kind: t.kind,
    startedAt: t.started_at, endsAt: t.ends_at, totalMs: total, remainingMs: Math.max(0, t.ends_at - now), state: ended ? 'ended' : 'running', warnAt: total > WARN_MS ? t.ends_at - WARN_MS : null,
    next, warnKey: `${t.id}:warn:${t.ends_at}`, endKey: `${t.id}:end:${t.ends_at}`,
    texts: {
      warn: warnText(kid.name, t.kind, t.name, next?.name), end: endText(t.kind, t.name),
      nextEnd: next ? nextEndText(next.name, next.done) : null,
    },
  };
}
const ACTIVE = "status IN ('running','ended')";
export const kidTimer = (core, familyId, kidId) => {
  const t = core.get(`SELECT * FROM timers WHERE kid_id = ? AND ${ACTIVE} ORDER BY id DESC LIMIT 1`, kidId);
  return t ? timerOut(core, t) : null;
};
export const homeTimers = (core, familyId) => core.all(`SELECT * FROM timers WHERE family_id = ? AND ${ACTIVE} ORDER BY id`, familyId).map((t) => timerOut(core, t));

function alert(core, t, kind) {
  const out = timerOut(core, t);
  const key = kind === 'warn' ? out.warnKey : out.endKey;
  const lock = kind === 'warn' ? `${out.kidName} · ${t.name} 5분 남았어요` : `${out.kidName} · ${t.name} 시간이 끝났어요`;
  core.afterCommit(() => {
    core.hub.publish(t.family_id, { t: 'timer', kind, key, timerId: t.id, kidId: t.kid_id }, { devices: true });
    core.sendPushDevices(t.family_id, { title: '우리집', body: lock, url: '/#/', tag: `timer-${t.id}-${kind}`, nid: null });
  });
}

// 예고/종료를 정확히 한 번씩 발생시키는 상태 정리. 서버 활동(1초)와 모든 조회에서 호출되며 몇 번 불려도 안전하다.
export function settleTimers(core, familyId = null) {
  const now = core.now();
  const rows = familyId ? core.all("SELECT * FROM timers WHERE status = 'running' AND family_id = ?", familyId) : core.all("SELECT * FROM timers WHERE status = 'running'");
  for (const t of rows) {
    if (now >= t.ends_at) {
      core.tx(() => {
        const fresh = core.get('SELECT * FROM timers WHERE id = ?', t.id);
        if (fresh.status !== 'running' || now < fresh.ends_at) return;
        if (fresh.end_sent_for !== fresh.ends_at) { alert(core, fresh, 'end'); }
        core.run("UPDATE timers SET status = 'ended', end_sent_for = ?, ended_at = ? WHERE id = ?", fresh.ends_at, fresh.ends_at, fresh.id);
        core.refresh(fresh.family_id, 'timers', 'home');
      });
    } else if (t.duration_ms + t.extended_ms > WARN_MS && now >= t.ends_at - WARN_MS && t.warn_sent_for !== t.ends_at) {
      core.tx(() => {
        const fresh = core.get('SELECT * FROM timers WHERE id = ?', t.id);
        if (fresh.status !== 'running' || fresh.warn_sent_for === fresh.ends_at) return;
        core.run('UPDATE timers SET warn_sent_for = ? WHERE id = ?', fresh.ends_at, fresh.id);
        alert(core, fresh, 'warn');
        core.refresh(fresh.family_id, 'timers', 'home');
      });
    }
  }
}

function resolveNext(core, ctx, kidId, n) {
  if (n == null) return { next_type: null, next_item_id: null, next_name: null, next_icon: null };
  if (n.type === 'routine') {
    const it = core.get('SELECT i.*, d.kid_id, d.family_id, d.date FROM day_items i JOIN days d ON d.id = i.day_id WHERE i.id = ?', vid(n.itemId, '다음 루틴'));
    if (!it || it.family_id !== ctx.familyId || it.kid_id !== kidId || it.date !== core.today()) throw err(400, 'bad_next', '오늘 이 아이의 루틴이 아니에요.');
    return { next_type: 'routine', next_item_id: it.id, next_name: it.name, next_icon: it.icon };
  }
  if (n.type === 'custom') return { next_type: 'custom', next_item_id: null, next_name: text(n.name, '다음 활동 이름', { max: 30 }), next_icon: text(n.icon || '➡️', '아이콘', { max: 8 }) };
  throw err(400, 'bad_next', '다음 활동 형식이 올바르지 않아요.');
}

export function listTimers(core, ctx) {
  settleTimers(core, ctx.familyId);
  const fam = core.get('SELECT timer_sound FROM families WHERE id = ?', ctx.familyId);
  return { serverNow: core.now(), soundEnabled: !!fam.timer_sound, timers: homeTimers(core, ctx.familyId) };
}

// 아이가 활동을 고르고 시작. 이미 진행 중이면 replace 확인 없이는 시작하지 않는다.
export function startTimer(core, ctx, kidId, b) {
  ctx.kid(kidId);
  const act = core.get('SELECT * FROM activities WHERE id = ? AND family_id = ? AND active = 1', vid(b.activityId, '활동'), ctx.familyId);
  if (!act) throw err(404, 'not_found', '활동을 찾을 수 없어요.');
  const adult = ctx.adultOrNull();
  // 시간 조정과 '다음 활동' 선택은 어른만
  const minutes = b.minutes !== undefined && adult ? money(b.minutes, '시간(분)', { min: 1, max: 240 }) : act.minutes;
  const next = b.next != null ? (adult ? resolveNext(core, ctx, kidId, b.next) : (() => { ctx.adult(); })()) : resolveNext(core, ctx, kidId, null);
  return core.tx(() => {
    settleTimers(core, ctx.familyId);
    const running = core.get("SELECT * FROM timers WHERE kid_id = ? AND status = 'running'", kidId);
    if (running) {
      if (!b.replace) throw err(409, 'timer_running', `${running.name} 활동이 진행 중이에요. 새로 시작할까요?`, { timer: timerOut(core, running) });
      core.run("UPDATE timers SET status = 'canceled' WHERE id = ?", running.id);
    }
    core.run("UPDATE timers SET status = 'dismissed' WHERE kid_id = ? AND status = 'ended'", kidId);
    const now = core.now(); const dur = minutes * 60000;
    const tid = core.insert(`INSERT INTO timers (family_id, kid_id, activity_id, name, icon, kind, duration_ms, started_at, ends_at, status, next_type, next_item_id, next_name, next_icon, created_at)
      VALUES (?,?,?,?,?,?,?,?,?, 'running', ?,?,?,?, ?)`, ctx.familyId, kidId, act.id, act.name, act.icon, act.kind, dur, now, now + dur, next.next_type, next.next_item_id, next.next_name, next.next_icon, now);
    core.refresh(ctx.familyId, 'timers', 'home');
    return timerOut(core, core.get('SELECT * FROM timers WHERE id = ?', tid));
  });
}

function loadTimer(core, ctx, tid) {
  const t = core.get('SELECT * FROM timers WHERE id = ?', tid);
  if (!t || t.family_id !== ctx.familyId) throw err(404, 'not_found', '활동을 찾을 수 없어요.');
  return t;
}
// 종료 안내를 확인(아이): 카드에서 내려갈 뿐, 시간 연장이나 루틴 체크는 일어나지 않는다.
export function dismissTimer(core, ctx, tid) {
  const t = loadTimer(core, ctx, tid);
  ctx.kid(t.kid_id);
  settleTimers(core, ctx.familyId);
  const cur = core.get('SELECT * FROM timers WHERE id = ?', t.id);
  if (cur.status === 'running') throw err(409, 'still_running', '아직 시간이 남아 있어요.');
  if (cur.status === 'ended') { core.run("UPDATE timers SET status = 'dismissed' WHERE id = ?", t.id); core.refresh(ctx.familyId, 'timers', 'home'); }
  return { ok: true };
}
export function cancelTimer(core, ctx, tid) {
  ctx.adult();
  const t = loadTimer(core, ctx, tid);
  if (['running', 'ended'].includes(t.status)) core.run("UPDATE timers SET status = 'canceled' WHERE id = ?", t.id);
  core.refresh(ctx.familyId, 'timers', 'home');
  return { ok: true };
}
export function extendTimer(core, ctx, tid, b) {
  ctx.adult();
  const m = money(b.minutes, '연장 시간(분)', { min: 1, max: 120 });
  return core.tx(() => {
    settleTimers(core, ctx.familyId);
    const t = loadTimer(core, ctx, tid);
    const now = core.now();
    let ends;
    if (t.status === 'running') ends = t.ends_at + m * 60000;
    else if (t.status === 'ended') {
      if (core.get("SELECT 1 FROM timers WHERE kid_id = ? AND status = 'running'", t.kid_id)) throw err(409, 'timer_running', '다른 활동이 진행 중이에요.');
      ends = now + m * 60000;
    } else throw err(409, 'closed', '이미 끝난 활동이에요.');
    // 새 종료 시각 기준으로 예고를 다시 계산한다. 새 종료까지 5분 이하면 지난 예고는 띄우지 않는다.
    const warnSent = ends - now <= WARN_MS ? ends : t.warn_sent_for;
    core.run("UPDATE timers SET status = 'running', ends_at = ?, extended_ms = extended_ms + ?, warn_sent_for = ?, ended_at = NULL WHERE id = ?", ends, m * 60000, warnSent, t.id);
    core.refresh(ctx.familyId, 'timers', 'home');
    return timerOut(core, core.get('SELECT * FROM timers WHERE id = ?', t.id));
  });
}
export function setNext(core, ctx, tid, b) {
  ctx.adult();
  const t = loadTimer(core, ctx, tid);
  if (!['running', 'ended'].includes(t.status)) throw err(409, 'closed', '이미 끝난 활동이에요.');
  const n = resolveNext(core, ctx, t.kid_id, b.next);
  core.run('UPDATE timers SET next_type = ?, next_item_id = ?, next_name = ?, next_icon = ? WHERE id = ?', n.next_type, n.next_item_id, n.next_name, n.next_icon, t.id);
  core.refresh(ctx.familyId, 'timers', 'home');
  return timerOut(core, core.get('SELECT * FROM timers WHERE id = ?', t.id));
}
