import { err, text, isDate, weekStart, id as vid } from '../util.js';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const optOut = (core, o) => ({ id: o.id, name: o.name, icon: o.icon, photoUrl: o.photo_id ? `/api/photos/${o.photo_id}` : null });

// 이번 주 현황 (공개 정보: 거실 보드·아이 화면·어른 화면 공용)
export function famActSummary(core, ctx) {
  const week = weekStart(core.today());
  const options = core.all('SELECT * FROM fam_options WHERE family_id = ? AND active = 1 ORDER BY id', ctx.familyId);
  const picks = core.all('SELECT * FROM fam_picks WHERE family_id = ? AND week = ?', ctx.familyId, week);
  const plans = core.all("SELECT * FROM fam_plans WHERE family_id = ? AND week = ? AND status = 'planned'", ctx.familyId, week);
  const kids = core.kids(ctx.familyId);
  const planOf = (oid) => plans.find((p) => p.option_id === oid);
  const planOut = (p) => (p ? { id: p.id, date: p.date, time: p.time } : null);
  return {
    week,
    options: options.map((o) => ({ ...optOut(core, o), pickedBy: picks.filter((p) => p.option_id === o.id).map((p) => ({ kidId: p.kid_id, name: core.member(p.kid_id).name })), plan: planOut(planOf(o.id)) })),
    kids: kids.map((k) => {
      const p = picks.find((x) => x.kid_id === k.id); const o = p && options.find((x) => x.id === p.option_id);
      if (!o) return { kidId: k.id, kidName: k.name, kidAvatar: k.avatar, kidColor: k.color, status: 'none' };
      const plan = planOf(o.id);
      return { kidId: k.id, kidName: k.name, kidAvatar: k.avatar, kidColor: k.color, optionId: o.id, name: o.name, icon: o.icon, status: plan ? 'planned' : 'waiting', plan: planOut(plan), both: picks.filter((x) => x.option_id === o.id).length > 1 };
    }),
  };
}

export function addOption(core, ctx, b) {
  const adult = ctx.adult();
  let photo = null;
  if (b.photoId != null) { const p = core.get('SELECT * FROM photos WHERE id = ?', vid(b.photoId, '사진')); if (!p || p.family_id !== ctx.familyId) throw err(400, 'bad_photo', '사진을 찾을 수 없어요.'); photo = p.id; }
  const oid = core.insert('INSERT INTO fam_options (family_id, name, icon, photo_id, created_by, created_at) VALUES (?,?,?,?,?,?)', ctx.familyId, text(b.name, '활동 이름', { max: 30 }), text(b.icon || '🎈', '아이콘', { max: 8 }), photo, adult.id, core.now());
  core.refresh(ctx.familyId, 'famact', 'home');
  return optOut(core, core.get('SELECT * FROM fam_options WHERE id = ?', oid));
}
export function removeOption(core, ctx, oid) {
  ctx.adult();
  const o = core.get('SELECT * FROM fam_options WHERE id = ? AND active = 1', oid);
  if (!o || o.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 후보예요.');
  return core.tx(() => {
    core.run('UPDATE fam_options SET active = 0 WHERE id = ?', o.id);
    core.run('DELETE FROM fam_picks WHERE option_id = ? AND week = ?', o.id, weekStart(core.today()));
    for (const p of core.all("SELECT * FROM fam_plans WHERE option_id = ? AND status = 'planned'", o.id)) cancelPlanRow(core, p);
    core.refresh(ctx.familyId, 'famact', 'home', 'calendar');
    return { ok: true };
  });
}

// 아이: 후보 하나 고르기(확정 전까지 바꿀 수 있음). optionId=null 이면 선택 취소.
export function pick(core, ctx, kidId, optionId) {
  const { kid } = ctx.kidOrAdult(kidId);
  return core.tx(() => {
    const week = weekStart(core.today());
    const cur = core.get('SELECT * FROM fam_picks WHERE week = ? AND kid_id = ?', week, kid.id);
    if (cur && core.get("SELECT 1 FROM fam_plans WHERE week = ? AND option_id = ? AND status = 'planned'", week, cur.option_id)) throw err(409, 'locked', '가족이 날짜를 정해서 바꿀 수 없어요.');
    if (optionId == null) { core.run('DELETE FROM fam_picks WHERE week = ? AND kid_id = ?', week, kid.id); }
    else {
      const o = core.get('SELECT * FROM fam_options WHERE id = ? AND active = 1', vid(optionId, '활동'));
      if (!o || o.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 활동이에요.');
      if (cur?.option_id === o.id) return famActSummary(core, ctx);
      core.run('INSERT INTO fam_picks (family_id, week, kid_id, option_id, picked_at) VALUES (?,?,?,?,?) ON CONFLICT(week, kid_id) DO UPDATE SET option_id = excluded.option_id, picked_at = excluded.picked_at', ctx.familyId, week, kid.id, o.id, core.now());
      for (const a of core.adults(ctx.familyId)) core.notify({ familyId: ctx.familyId, memberId: a.id, kind: 'fam_pick', title: `${kid.name}이(가) 가족 활동을 골랐어요`, body: `${o.icon} ${o.name}`, url: '/#/family-activity', dedupe: `fampick:${week}:${kid.id}:${o.id}:${a.id}`, lock: `${kid.name} · 가족 활동 선택` });
    }
    core.refresh(ctx.familyId, 'famact', 'home');
    return famActSummary(core, ctx);
  });
}

function writeEvent(core, plan, opt, kidTag) {
  const title = `${opt.icon} ${opt.name}`;
  const ev = plan.event_id && core.get('SELECT id FROM events WHERE id = ?', plan.event_id);
  if (ev) core.run('UPDATE events SET title = ?, date = ?, time = ?, kid_id = ? WHERE id = ?', title, plan.date, plan.time, kidTag, ev.id);
  else {
    const eid = core.insert('INSERT INTO events (family_id, title, date, time, kid_id, created_by, created_at, plan_id) VALUES (?,?,?,?,?,?,?,?)', plan.family_id, title, plan.date, plan.time, kidTag, plan.created_by, core.now(), plan.id);
    core.run('UPDATE fam_plans SET event_id = ? WHERE id = ?', eid, plan.id);
  }
}
// 어른: 날짜·시간 확정/변경. (이번 주, 후보) 한 쌍당 일정은 항상 한 건 — 여러 번 눌러도 같은 일정이 갱신된다.
export function confirmPlan(core, ctx, b) {
  const adult = ctx.adult();
  const date = isDate(b.date) ? b.date : (() => { throw err(400, 'bad_date', '날짜를 선택해 주세요.'); })();
  const time = b.time ? (TIME.test(b.time) ? b.time : (() => { throw err(400, 'bad_time', '시간 형식이 올바르지 않아요.'); })()) : null;
  return core.tx(() => {
    const o = core.get('SELECT * FROM fam_options WHERE id = ? AND active = 1', vid(b.optionId, '활동'));
    if (!o || o.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 활동이에요.');
    const week = weekStart(core.today());
    core.run(`INSERT INTO fam_plans (family_id, week, option_id, date, time, status, created_by, updated_at) VALUES (?,?,?,?,?, 'planned', ?, ?)
      ON CONFLICT(week, option_id) DO UPDATE SET date = excluded.date, time = excluded.time, status = 'planned', updated_at = excluded.updated_at`, ctx.familyId, week, o.id, date, time, adult.id, core.now());
    const plan = core.get('SELECT * FROM fam_plans WHERE week = ? AND option_id = ?', week, o.id);
    const pickers = core.all('SELECT kid_id FROM fam_picks WHERE week = ? AND option_id = ?', week, o.id).map((p) => p.kid_id);
    writeEvent(core, plan, o, pickers.length === 1 ? pickers[0] : null);
    for (const k of pickers) core.notify({ familyId: ctx.familyId, memberId: k, kind: 'fam_plan', title: '가족 활동 날짜가 정해졌어요', body: `${o.icon} ${o.name} · ${date}${time ? ' ' + time : ''}`, url: '/#/kid/family', dedupe: `famplan:${plan.id}:${date}:${time}:${k}` });
    core.refresh(ctx.familyId, 'famact', 'home', 'calendar');
    return { plan: { id: plan.id, optionId: o.id, date: plan.date, time: plan.time }, summary: famActSummary(core, ctx) };
  });
}
function cancelPlanRow(core, p) {
  core.run("UPDATE fam_plans SET status = 'canceled', updated_at = ? WHERE id = ?", core.now(), p.id);
  if (p.event_id) { core.run('DELETE FROM events WHERE id = ?', p.event_id); core.run('UPDATE fam_plans SET event_id = NULL WHERE id = ?', p.id); }
}
export function cancelPlan(core, ctx, planId) {
  ctx.adult();
  const p = core.get('SELECT * FROM fam_plans WHERE id = ?', planId);
  if (!p || p.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 일정이에요.');
  core.tx(() => cancelPlanRow(core, p));
  core.refresh(ctx.familyId, 'famact', 'home', 'calendar');
  return famActSummary(core, ctx);
}
