// 아이별 급식 식단: 학교가 달라도 되도록 식단은 아이마다 따로 저장한다. 어른이 가정통신문 식단표를 붙여넣거나 하루씩 고친다.
// 평일 아침(어른마다 켜고 끄고 시각을 정함, 기본 08:00) 그날 급식을 어른 폰으로 알려 준다.
import { err, kstDate, kstMinutesOfDay } from '../util.js';
import { dowOf } from './timetable.js';

const DAY_MS = 864e5;
export const ALERT_WINDOW_MIN = 180; // 알림 시각이 지나고 3시간 안에서만 보낸다(서버가 늦게 켜져도 한밤중에 보내지 않도록)
const MAX_ITEMS = 20;

// 쉼표로 나누되 괄호 안의 쉼표는 나누지 않는다: "짜계치(자장, 달걀, 치즈), 탕수육" → ['짜계치(자장, 달걀, 치즈)', '탕수육']
export function splitMenu(s) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of String(s)) {
    if ('([{（'.includes(ch)) depth++;
    else if (')]}）'.includes(ch)) depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === '，' || ch === '、' || ch === '\n') && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
const cleanItems = (arr) => {
  const items = arr.map((x) => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (items.length > MAX_ITEMS) throw err(400, 'too_many', `메뉴는 ${MAX_ITEMS}개까지 넣을 수 있어요.`);
  if (items.some((x) => x.length > 40)) throw err(400, 'too_long', '메뉴 이름이 너무 길어요.');
  return items;
};

// 연도가 없는 'M/D'에 연도를 붙인다: 지금 달과 6달 넘게 차이 나면 이웃 해로 본다(12월에 1월 식단을 붙여넣는 경우)
export function yearFor(month, nowMs) {
  const d = new Date(nowMs + 9 * 3600e3); const y = d.getUTCFullYear(); const diff = month - (d.getUTCMonth() + 1);
  return diff < -6 ? y + 1 : diff > 6 ? y - 1 : y;
}
// "11/2(월) / 현미찹쌀밥, 근대콩나물된장국(건새우), …" 같은 줄들을 날짜별 식단으로 바꾼다
export function parseMeals(text, nowMs) {
  const days = []; const skipped = [];
  for (const raw of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(?:(\d{4})[./-])?(\d{1,2})\s*[/.\-월]\s*(\d{1,2})\s*일?\s*(?:\([^)]*\))?\s*[/:\-]?\s*(.*)$/.exec(line);
    const month = m ? Number(m[2]) : 0; const day = m ? Number(m[3]) : 0;
    const items = m ? splitMenu(m[4]) : [];
    const year = m && m[1] ? Number(m[1]) : yearFor(month, nowMs);
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const real = m && month >= 1 && month <= 12 && day >= 1 && day <= 31 && new Date(`${date}T00:00:00Z`).getUTCDate() === day;
    if (!real || !items.length) { skipped.push(line.slice(0, 40)); continue; }
    days.push({ date, items });
  }
  return { days, skipped };
}

const out = (r) => ({ date: r.date, dow: ((new Date(`${r.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1, items: JSON.parse(r.items) });
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// 같은 가족 누구나 볼 수 있다(시간표·할일과 같은 공개 정보). from~to(최대 62일), 기본은 이번 주 월요일부터 3주
export function listMeals(core, ctx, kidId, q = {}) {
  ctx.kid(kidId);
  const now = core.now(); const today = kstDate(now);
  const monday = kstDate(now - (dowOf(now) - 1) * DAY_MS);
  const from = isDate(q.from) ? q.from : monday;
  const to = isDate(q.to) ? q.to : kstDate(Date.parse(`${from}T00:00:00Z`) + 20 * DAY_MS);
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 62 * DAY_MS) throw err(400, 'range', '한 번에 62일까지만 볼 수 있어요.');
  return { today, from, to, days: core.all('SELECT * FROM meals WHERE kid_id = ? AND date BETWEEN ? AND ? ORDER BY date', kidId, from, to).map(out) };
}

function upsert(core, ctx, kid, date, items) {
  core.run('INSERT INTO meals (family_id, kid_id, date, items, created_at) VALUES (?,?,?,?,?) ON CONFLICT(kid_id, date) DO UPDATE SET items = excluded.items', ctx.familyId, kid.id, date, JSON.stringify(items), core.now());
}
// 어른: 식단표 붙여넣기(같은 날짜는 덮어쓴다)
export function importMeals(core, ctx, kidId, b) {
  ctx.adult();
  const kid = ctx.kidRow(kidId);
  const { days, skipped } = parseMeals(b?.text, core.now());
  if (!days.length) throw err(400, 'nothing', '날짜별 식단을 찾지 못했어요. 한 줄에 `11/2(월) / 밥, 국, 반찬` 모양으로 붙여넣어 주세요.');
  if (days.length > 120) throw err(400, 'too_many', '한 번에 120일까지만 넣을 수 있어요.');
  return core.tx(() => {
    for (const d of days) upsert(core, ctx, kid, d.date, cleanItems(d.items));
    core.refresh(ctx.familyId, 'meals', 'home');
    return { saved: days.length, skipped, from: days[0].date, to: days[days.length - 1].date };
  });
}
// 어른: 하루 식단을 고친다(비우면 그날 식단 삭제)
export function setMeal(core, ctx, kidId, date, b) {
  ctx.adult();
  const kid = ctx.kidRow(kidId);
  if (!isDate(date)) throw err(400, 'bad_date', '날짜가 올바르지 않아요.');
  const items = cleanItems(Array.isArray(b?.items) ? b.items : splitMenu(b?.text || ''));
  return core.tx(() => {
    if (!items.length) core.run('DELETE FROM meals WHERE kid_id = ? AND date = ?', kid.id, date);
    else upsert(core, ctx, kid, date, items);
    core.refresh(ctx.familyId, 'meals', 'home');
    return { date, items };
  });
}
export function deleteMeal(core, ctx, kidId, date) {
  ctx.adult();
  const kid = ctx.kidRow(kidId);
  if (!isDate(date)) throw err(400, 'bad_date', '날짜가 올바르지 않아요.');
  core.run('DELETE FROM meals WHERE kid_id = ? AND date = ?', kid.id, date);
  core.refresh(ctx.familyId, 'meals', 'home');
  return { ok: true };
}

// ---- 어른마다 정하는 아침 알림 ----
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export function getAlert(core, ctx) {
  const a = ctx.adult();
  // 점검용 현재 상태: 서버가 보는 지금 시각·오늘 식단이 있는 아이 수·마지막으로 보낸 급식 알림 시각
  const now = core.now(); const today = kstDate(now);
  const last = core.get("SELECT created_at FROM notifications WHERE member_id = ? AND kind = 'meal' ORDER BY id DESC LIMIT 1", a.id);
  const sub = core.get('SELECT COUNT(*) AS n FROM push_subs WHERE member_id = ?', a.id).n;
  const status = { serverTime: hhmm(kstMinutesOfDay(now)), weekday: dowOf(now) <= 5, mealKids: todayLines(core, ctx.familyId, today).length, lastSentAt: last ? last.created_at : null, devices: sub };
  return { enabled: !!a.meal_alert, time: hhmm(a.meal_alert_min), status };
}
export function setAlert(core, ctx, b) {
  const a = ctx.adult();
  let enabled = a.meal_alert; let min = a.meal_alert_min;
  if (b?.enabled !== undefined) enabled = b.enabled ? 1 : 0;
  if (b?.time !== undefined) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(b.time));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw err(400, 'bad_time', '알림 시각이 올바르지 않아요. (예: 08:00)');
    min = Number(m[1]) * 60 + Number(m[2]);
  }
  core.run('UPDATE members SET meal_alert = ?, meal_alert_min = ? WHERE id = ?', enabled, min, a.id);
  return { enabled: !!enabled, time: hhmm(min) };
}

function todayLines(core, familyId, today) {
  const lines = [];
  for (const k of core.kids(familyId)) {
    const r = core.get('SELECT * FROM meals WHERE kid_id = ? AND date = ?', k.id, today);
    if (r) lines.push({ kid: k, items: JSON.parse(r.items) });
  }
  return lines;
}
const short = (items) => (items.length > 4 ? `${items.slice(0, 4).join(', ')} 외` : items.join(', '));
const sendMeal = (core, a, lines, dedupe) => core.tx(() => core.notify({
  familyId: a.family_id, memberId: a.id, kind: 'meal', title: '🍽 오늘 급식',
  body: lines.map((l) => `${l.kid.name}: ${l.items.join(', ')}`).join('\n'), url: `/#/kid/${lines[0].kid.id}/meals`,
  dedupe, lock: `🍽 오늘 급식 · ${lines.map((l) => `${l.kid.name} ${short(l.items)}`).join(' / ')}`.slice(0, 110),
}));
// 설정 점검용: 지금 오늘 급식 알림을 한 번 보내 본다(날짜·시각·평일 조건 없이). 이 폰에 알림 구독이 있는지도 알려 준다.
export function testAlert(core, ctx) {
  const a = ctx.adult();
  const lines = todayLines(core, ctx.familyId, core.today());
  const devices = core.get('SELECT COUNT(*) AS n FROM push_subs WHERE member_id = ?', a.id).n;
  if (!lines.length) return { sent: false, reason: 'no_meal', devices };
  sendMeal(core, a, lines, null);
  return { sent: true, devices };
}

// 평일, 각자 정한 시각이 지나면(3시간 안에서) 그날 급식을 한 번만 알린다. 식단이 하나도 없는 날은 보내지 않는다.
export function mealAlerts(core) {
  const now = core.now();
  if (dowOf(now) > 5) return 0;
  const today = kstDate(now); const min = kstMinutesOfDay(now); let sent = 0;
  const adults = core.all("SELECT * FROM members WHERE kind = 'adult' AND removed = 0 AND meal_alert = 1");
  for (const a of adults) {
    if (min < a.meal_alert_min || min > a.meal_alert_min + ALERT_WINDOW_MIN) continue;
    const lines = todayLines(core, a.family_id, today);
    if (!lines.length) continue;
    if (sendMeal(core, a, lines, `meal:${a.id}:${today}`)) sent++;
  }
  return sent;
}
