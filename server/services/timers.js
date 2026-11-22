import { err, text, money, id as vid, oneOf, kstDate } from '../util.js';
import { warnText, endText, nextEndText } from '../ko.js';

export const KID_EXTRA_MIN = 30; // 아이가 어른이 정한 시간에서 더 늘릴 수 있는 최대(분)
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

// ---------- 하루 총 시간(예산) ----------
// 활동에 정해 둔 시간(예: 게임 30분)은 '하루에 쓸 수 있는 총 시간'이다. 나눠서 해도 되고, 쓴 만큼만 줄어든다.
// 쓴 시간 = 그날 시작한 같은 활동의 (전체 − 남은 시간). 일시 중단·중단하면 그때 남은 시간(remain_ms)이 기록돼 다음에 이어 쓸 수 있다.
const DAY_MS = 864e5;
const dayStartMs = (core) => Date.parse(`${core.today()}T00:00:00+09:00`);
export function consumedMs(t, now) {
  const total = t.duration_ms + t.extended_ms;
  if (t.status === 'running') return Math.min(total, Math.max(0, total - Math.max(0, t.ends_at - now)));
  if (t.status === 'paused' || (t.status === 'canceled' && t.remain_ms != null)) return Math.max(0, total - (t.remain_ms ?? 0));
  if (t.status === 'canceled') return 0; // 예전에 중단된 기록은 남은 시간을 알 수 없어 쓴 것으로 치지 않는다
  return total; // 끝난(ended)·확인한(dismissed) 활동은 다 쓴 것
}
export function budgetFor(core, kidId, act, now = core.now()) {
  const from = dayStartMs(core);
  const rows = core.all('SELECT * FROM timers WHERE kid_id = ? AND activity_id = ? AND started_at >= ? AND started_at < ?', kidId, act.id, from, from + DAY_MS);
  const used = rows.reduce((n, t) => n + consumedMs(t, now), 0);
  const allowance = act.minutes * 60000;
  return { activityId: act.id, allowanceMs: allowance, usedMs: Math.min(allowance, used), leftMs: Math.max(0, allowance - used) };
}
export function listBudgets(core, ctx, kidId) {
  ctx.kid(kidId);
  settleTimers(core, ctx.familyId);
  const now = core.now();
  return core.all('SELECT * FROM activities WHERE family_id = ? AND active = 1 ORDER BY sort, id', ctx.familyId).map((a) => budgetFor(core, Number(kidId), a, now));
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
  const paused = t.status === 'paused';
  const ended = !paused && now >= t.ends_at;
  const total = t.duration_ms + t.extended_ms;
  const act = t.activity_id ? core.get('SELECT * FROM activities WHERE id = ?', t.activity_id) : null;
  const bud = act ? budgetFor(core, t.kid_id, act, now) : null;
  return {
    id: t.id, kidId: t.kid_id, kidName: kid.name, kidAvatar: kid.avatar, kidColor: kid.color, activityId: t.activity_id, name: t.name, icon: t.icon, kind: t.kind,
    startedAt: t.started_at, endsAt: paused ? null : t.ends_at, totalMs: total, remainingMs: paused ? (t.remain_ms ?? 0) : Math.max(0, t.ends_at - now), state: paused ? 'paused' : ended ? 'ended' : 'running', warnAt: !paused && total > WARN_MS ? t.ends_at - WARN_MS : null,
    dayMs: bud ? bud.allowanceMs : null, dayLeftMs: bud ? bud.leftMs : null,
    next, warnKey: `${t.id}:warn:${t.ends_at}`, endKey: `${t.id}:end:${t.ends_at}`,
    texts: {
      warn: warnText(kid.name, t.kind, t.name, next?.name), end: endText(t.kind, t.name),
      nextEnd: next ? nextEndText(next.name, next.done) : null,
    },
  };
}
const ACTIVE = "status IN ('running','ended','paused')";
export const kidTimer = (core, familyId, kidId) => {
  const t = core.get(`SELECT * FROM timers WHERE kid_id = ? AND ${ACTIVE} ORDER BY id DESC LIMIT 1`, kidId);
  return t ? timerOut(core, t) : null;
};
export const homeTimers = (core, familyId) => core.all(`SELECT * FROM timers WHERE family_id = ? AND ${ACTIVE} ORDER BY id`, familyId).map((t) => timerOut(core, t));

// 진동 패턴(ms): 5분 전 예고는 짧게 두 번, 시간이 끝났을 때는 길게 여러 번(안드로이드 폰)
const VIBRATE = { warn: [300, 150, 300], end: [600, 200, 600, 200, 600, 200, 900] };
function alert(core, t, kind) {
  const out = timerOut(core, t);
  const key = kind === 'warn' ? out.warnKey : out.endKey;
  const lock = kind === 'warn' ? `${out.kidName} · ${t.name} 5분 남았어요` : `${out.kidName} · ${t.name} 시간이 끝났어요`;
  core.afterCommit(() => {
    core.hub.publish(t.family_id, { t: 'timer', kind, key, timerId: t.id, kidId: t.kid_id }, { devices: true });
    core.sendPushDevices(t.family_id, { title: '우리집', body: lock, url: '/#/', tag: `timer-${t.id}-${kind}`, nid: null, vibrate: VIBRATE[kind] });
    // 그 아이의 전용 폰에도(앱을 닫아 두거나 화면이 잠겨 있어도 알림이 오도록). 형제·어른 폰에는 가지 않는다.
    core.sendPush(t.kid_id, { title: '우리집', body: lock, url: `/#/kid/${t.kid_id}/timer`, tag: `timer-${t.id}-${kind}`, nid: null, sticky: true, vibrate: VIBRATE[kind] });
  });
}

// 예고/종료를 정확히 한 번씩 발생시키는 상태 정리. 서버 활동(1초)와 모든 조회에서 호출되며 몇 번 불려도 안전하다.
export function settleTimers(core, familyId = null) {
  const now = core.now();
  // 어제 일시 중단해 둔 활동은 자정이 지나면 정리한다(하루 총 시간은 날마다 새로 시작)
  const from = dayStartMs(core);
  const stale = familyId ? core.all("SELECT id FROM timers WHERE status = 'paused' AND started_at < ? AND family_id = ?", from, familyId) : core.all("SELECT id FROM timers WHERE status = 'paused' AND started_at < ?", from);
  for (const r of stale) { core.run("UPDATE timers SET status = 'canceled' WHERE id = ?", r.id); }
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
    const it = core.get('SELECT i.*, d.kid_id, d.family_id, d.date FROM day_items i JOIN days d ON d.id = i.day_id WHERE i.id = ?', vid(n.itemId, '다음 할일'));
    if (!it || it.family_id !== ctx.familyId || it.kid_id !== kidId || it.date !== core.today()) throw err(400, 'bad_next', '오늘 이 아이의 할일이 아니에요.');
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
  ctx.ownOnly(kidId);
  const act = core.get('SELECT * FROM activities WHERE id = ? AND family_id = ? AND active = 1', vid(b.activityId, '활동'), ctx.familyId);
  if (!act) throw err(404, 'not_found', '활동을 찾을 수 없어요.');
  const adult = ctx.adultOrNull();
  // 시간 조정과 '다음 활동' 선택은 어른만
  const override = b.minutes !== undefined && adult ? money(b.minutes, '시간(분)', { min: 1, max: 240 }) : null;
  const kidMinutes = b.minutes !== undefined && !adult ? money(b.minutes, '시간(분)', { min: 1, max: 240 }) : null; // 아이는 아래에서 '남은 시간 안에서 10분 단위로'만 허용
  const next = b.next != null ? (adult ? resolveNext(core, ctx, kidId, b.next) : (() => { ctx.adult(); })()) : resolveNext(core, ctx, kidId, null);
  return core.tx(() => {
    settleTimers(core, ctx.familyId);
    // 같은 활동을 일시 중단해 둔 상태라면 새로 만들지 않고 이어서 한다
    const paused = core.get("SELECT * FROM timers WHERE kid_id = ? AND status = 'paused' AND activity_id = ?", kidId, act.id);
    if (paused && override == null) return doResume(core, ctx, paused);
    const running = core.get("SELECT * FROM timers WHERE kid_id = ? AND status = 'running'", kidId);
    if (running) {
      if (!b.replace) throw err(409, 'timer_running', `${running.name} 활동이 진행 중이에요. 새로 시작할까요?`, { timer: timerOut(core, running) });
      core.run("UPDATE timers SET status = 'canceled', remain_ms = ? WHERE id = ?", Math.max(0, running.ends_at - core.now()), running.id);
    }
    // 다른 활동을 일시 중단해 둔 것은 닫는다(남은 시간은 기록돼 있어 오늘 다시 쓸 수 있다)
    core.run("UPDATE timers SET status = 'canceled' WHERE kid_id = ? AND status = 'paused'", kidId);
    core.run("UPDATE timers SET status = 'dismissed' WHERE kid_id = ? AND status = 'ended'", kidId);
    const now = core.now();
    const left = budgetFor(core, kidId, act, now).leftMs;
    if (override == null && left <= 0) throw err(409, 'budget_used', `오늘 ${act.name} 시간은 다 썼어요. 내일 또 할 수 있어요.`);
    let dur = override != null ? override * 60000 : left;
    if (kidMinutes != null) {
      // 아이가 줄이는 것: 어른이 정한 하루 시간(오늘 남은 시간) 안에서, 10분 단위(남은 시간 전체도 가능)
      const leftMin = Math.ceil(left / 60000);
      const hi = Math.max(leftMin, Math.floor((leftMin + KID_EXTRA_MIN) / 10) * 10); // 어른이 정한 시간에서 최대 +30분까지 늘릴 수 있다
      const ok = kidMinutes >= Math.min(10, leftMin) && kidMinutes <= hi && (kidMinutes % 10 === 0 || kidMinutes === leftMin);
      if (!ok) throw err(400, 'bad_minutes', `시간은 10분 단위로, 어른이 정한 ${leftMin}분에서 최대 ${KID_EXTRA_MIN}분까지만 늘릴 수 있어요.`);
      dur = kidMinutes === leftMin ? left : kidMinutes * 60000;
    }
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
// 종료 안내를 확인(아이): 카드에서 내려갈 뿐, 시간 연장이나 할일 체크는 일어나지 않는다.
export function dismissTimer(core, ctx, tid) {
  const t = loadTimer(core, ctx, tid);
  ctx.kid(t.kid_id);
  ctx.ownOnly(t.kid_id);
  settleTimers(core, ctx.familyId);
  const cur = core.get('SELECT * FROM timers WHERE id = ?', t.id);
  if (cur.status === 'running') throw err(409, 'still_running', '아직 시간이 남아 있어요.');
  if (cur.status === 'ended') { core.run("UPDATE timers SET status = 'dismissed' WHERE id = ?", t.id); core.refresh(ctx.familyId, 'timers', 'home'); }
  return { ok: true };
}
// 아이도 자기 활동은 직접 중단할 수 있다(어른 확인 불필요). 중단은 시간 연장이나 할일 체크와 무관하다.
export function cancelTimer(core, ctx, tid) {
  const t = loadTimer(core, ctx, tid);
  ctx.kid(t.kid_id);
  ctx.ownOnly(t.kid_id);
  if (t.status === 'running') core.run("UPDATE timers SET status = 'canceled', remain_ms = ? WHERE id = ?", Math.max(0, t.ends_at - core.now()), t.id); // 남은 시간은 오늘 다시 쓸 수 있다
  else if (t.status === 'paused') core.run("UPDATE timers SET status = 'canceled' WHERE id = ?", t.id);
  else if (t.status === 'ended') core.run("UPDATE timers SET status = 'canceled', remain_ms = 0 WHERE id = ?", t.id);
  core.refresh(ctx.familyId, 'timers', 'home');
  return { ok: true };
}
// 일시 중단: 남은 시간을 기억해 두고 멈춘다. 이어서 하면 그 시간부터 다시 센다(하루 총 시간 안에서 나눠서 할 수 있다).
export function pauseTimer(core, ctx, tid) {
  const t0 = loadTimer(core, ctx, tid);
  ctx.kid(t0.kid_id);
  ctx.ownOnly(t0.kid_id);
  return core.tx(() => {
    settleTimers(core, ctx.familyId);
    const t = core.get('SELECT * FROM timers WHERE id = ?', t0.id);
    if (t.status === 'paused') return timerOut(core, t);
    if (t.status !== 'running') throw err(409, 'not_running', '진행 중인 활동만 잠깐 멈출 수 있어요.');
    const now = core.now();
    core.run("UPDATE timers SET status = 'paused', remain_ms = ?, paused_at = ? WHERE id = ?", Math.max(0, t.ends_at - now), now, t.id);
    core.refresh(ctx.familyId, 'timers', 'home');
    return timerOut(core, core.get('SELECT * FROM timers WHERE id = ?', t.id));
  });
}
function doResume(core, ctx, t) {
  const now = core.now();
  if (core.get("SELECT 1 FROM timers WHERE kid_id = ? AND status = 'running'", t.kid_id)) throw err(409, 'timer_running', '다른 활동이 진행 중이에요.');
  const remain = t.remain_ms ?? 0;
  if (remain <= 0) throw err(409, 'budget_used', '남은 시간이 없어요.');
  const ends = now + remain;
  // 남은 시간이 5분을 넘으면 예고를 다시 받는다(이미 5분 이하면 예고는 다시 띄우지 않는다)
  core.run("UPDATE timers SET status = 'running', ends_at = ?, remain_ms = NULL, paused_at = NULL, ended_at = NULL, warn_sent_for = ? WHERE id = ?", ends, remain <= WARN_MS ? ends : null, t.id);
  core.refresh(ctx.familyId, 'timers', 'home');
  return timerOut(core, core.get('SELECT * FROM timers WHERE id = ?', t.id));
}
export function resumeTimer(core, ctx, tid) {
  const t0 = loadTimer(core, ctx, tid);
  ctx.kid(t0.kid_id);
  ctx.ownOnly(t0.kid_id);
  return core.tx(() => {
    settleTimers(core, ctx.familyId);
    const t = core.get('SELECT * FROM timers WHERE id = ?', t0.id);
    if (t.status === 'running') return timerOut(core, t);
    if (t.status !== 'paused') throw err(409, 'not_paused', '일시 중단한 활동이 아니에요.');
    return doResume(core, ctx, t);
  });
}
export function extendTimer(core, ctx, tid, b) {
  ctx.adult();
  const m = money(b.minutes, '연장 시간(분)', { min: 1, max: 120 });
  return core.tx(() => {
    settleTimers(core, ctx.familyId);
    const t = loadTimer(core, ctx, tid);
    const now = core.now();
    let ends;
    if (t.status === 'paused') {
      core.run('UPDATE timers SET remain_ms = ?, extended_ms = extended_ms + ? WHERE id = ?', (t.remain_ms ?? 0) + m * 60000, m * 60000, t.id);
      core.refresh(ctx.familyId, 'timers', 'home');
      return timerOut(core, core.get('SELECT * FROM timers WHERE id = ?', t.id));
    }
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
  if (!['running', 'ended', 'paused'].includes(t.status)) throw err(409, 'closed', '이미 끝난 활동이에요.');
  const n = resolveNext(core, ctx, t.kid_id, b.next);
  core.run('UPDATE timers SET next_type = ?, next_item_id = ?, next_name = ?, next_icon = ? WHERE id = ?', n.next_type, n.next_item_id, n.next_name, n.next_icon, t.id);
  core.refresh(ctx.familyId, 'timers', 'home');
  return timerOut(core, core.get('SELECT * FROM timers WHERE id = ?', t.id));
}
