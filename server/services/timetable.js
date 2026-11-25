// 아이별 주간 시간표(학교·학원·방과후 수업표): 요일 + 시작/끝 시각 + 이름·장소·색.
// 어른이 만들고 고치며, 아이는 볼 수만 있다. 같은 아이·같은 요일의 수업은 시간이 겹치지 않는다.
import { err, text, id as vid, kstMinutesOfDay } from '../util.js';

export const TT_COLORS = ['#ffd9e6', '#d7ecff', '#e4d6ff', '#d9f6e7', '#fff1cf', '#ffe0cc'];
const KST_MS = 9 * 3600 * 1000;
export const dowOf = (ms) => ((new Date(ms + KST_MS).getUTCDay() + 6) % 7) + 1; // 1=월 … 7=일

const toMin = (v, label) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim());
  const h = m ? Number(m[1]) : NaN; const mi = m ? Number(m[2]) : NaN;
  if (!m || h > 23 || mi > 59) throw err(400, 'bad_time', `${label} 시각이 올바르지 않아요. (예: 13:10)`);
  return h * 60 + mi;
};
const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const out = (r) => ({ id: r.id, kidId: r.kid_id, dow: r.dow, start: fmt(r.start_min), end: fmt(r.end_min), title: r.title, place: r.place || '', color: r.color });
const colorOf = (c, fallback) => (c === undefined || c === null || c === '' ? fallback : (/^#[0-9a-fA-F]{6}$/.test(c) ? c : (() => { throw err(400, 'bad_color', '색 형식이 올바르지 않아요.'); })()));

function checkNoOverlap(core, kidId, dow, start, end, exceptId = 0) {
  const clash = core.get('SELECT * FROM timetable WHERE kid_id = ? AND dow = ? AND id != ? AND start_min < ? AND end_min > ? LIMIT 1', kidId, dow, exceptId, end, start);
  if (clash) throw err(409, 'overlap', `그 시간에 이미 '${clash.title}'(${fmt(clash.start_min)}~${fmt(clash.end_min)})이 있어요.`);
}

// 같은 가족 누구나 볼 수 있다(할일·도장과 같은 공개 정보)
export function listTimetable(core, ctx, kidId) {
  ctx.kid(kidId);
  const now = core.now();
  return { items: core.all('SELECT * FROM timetable WHERE kid_id = ? ORDER BY dow, start_min', kidId).map(out), today: dowOf(now), nowMin: kstMinutesOfDay(now) };
}

// 어른: 한 수업을 여러 요일에 한 번에 만든다(예: 월·수 같은 시간)
export function createTimetable(core, ctx, kidId, b) {
  ctx.adult();
  const kid = ctx.kidRow(kidId);
  const days = [...new Set((Array.isArray(b.days) ? b.days : [b.dow]).map(Number))];
  if (!days.length || days.length > 7 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw err(400, 'bad_days', '요일을 하나 이상 골라 주세요.');
  const start = toMin(b.start, '시작'); const end = toMin(b.end, '끝');
  if (end <= start) throw err(400, 'bad_range', '끝나는 시각이 시작보다 늦어야 해요.');
  const title = text(b.title, '수업 이름', { max: 30 });
  const place = b.place ? text(b.place, '장소·메모', { max: 30 }) : null;
  const color = colorOf(b.color, TT_COLORS[0]);
  return core.tx(() => {
    for (const d of days) checkNoOverlap(core, kid.id, d, start, end);
    const ids = days.map((d) => core.insert('INSERT INTO timetable (family_id, kid_id, dow, start_min, end_min, title, place, color, created_at) VALUES (?,?,?,?,?,?,?,?,?)', ctx.familyId, kid.id, d, start, end, title, place, color, core.now()));
    core.refresh(ctx.familyId, 'timetable', 'home');
    return { created: ids.map((i) => out(core.get('SELECT * FROM timetable WHERE id = ?', i))) };
  });
}

function rowOf(core, ctx, tid) {
  const r = core.get('SELECT * FROM timetable WHERE id = ?', tid);
  if (!r || r.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 수업이에요.');
  return r;
}
export function updateTimetable(core, ctx, tid, b) {
  ctx.adult();
  const r = rowOf(core, ctx, tid);
  const start = b.start !== undefined ? toMin(b.start, '시작') : r.start_min;
  const end = b.end !== undefined ? toMin(b.end, '끝') : r.end_min;
  if (end <= start) throw err(400, 'bad_range', '끝나는 시각이 시작보다 늦어야 해요.');
  const dow = b.dow !== undefined ? Number(b.dow) : r.dow;
  if (!Number.isInteger(dow) || dow < 1 || dow > 7) throw err(400, 'bad_days', '요일이 올바르지 않아요.');
  const title = b.title !== undefined ? text(b.title, '수업 이름', { max: 30 }) : r.title;
  const place = b.place !== undefined ? (b.place ? text(b.place, '장소·메모', { max: 30 }) : null) : r.place;
  const color = colorOf(b.color, r.color);
  return core.tx(() => {
    checkNoOverlap(core, r.kid_id, dow, start, end, r.id);
    core.run('UPDATE timetable SET dow = ?, start_min = ?, end_min = ?, title = ?, place = ?, color = ? WHERE id = ?', dow, start, end, title, place, color, r.id);
    core.refresh(ctx.familyId, 'timetable', 'home');
    return out(core.get('SELECT * FROM timetable WHERE id = ?', r.id));
  });
}
export function deleteTimetable(core, ctx, tid) {
  ctx.adult();
  const r = rowOf(core, ctx, tid);
  core.run('DELETE FROM timetable WHERE id = ?', r.id);
  core.refresh(ctx.familyId, 'timetable', 'home');
  return { ok: true };
}

// 우리집 화면 아이 카드에 보여 줄 '지금 수업'과 '다음 수업'(오늘 것만)
export function ttNowNext(core, kidId) {
  const now = core.now(); const d = dowOf(now); const m = kstMinutesOfDay(now);
  const rows = core.all('SELECT * FROM timetable WHERE kid_id = ? AND dow = ? ORDER BY start_min', kidId, d);
  const cur = rows.find((r) => r.start_min <= m && m < r.end_min);
  const next = rows.find((r) => r.start_min > m);
  return { now: cur ? out(cur) : null, next: next ? out(next) : null, count: rows.length };
}
void vid;
