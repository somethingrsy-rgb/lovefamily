export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
export const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const KST = 9 * 3600 * 1000;
export const kstParts = (ms) => { const d = new Date(ms + KST); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes() }; };
export const kstDate = (ms) => new Date(ms + KST).toISOString().slice(0, 10);
export const dateLabel = (date) => { const [y, m, d] = date.split('-').map(Number); return `${m}월 ${d}일 ${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}요일`; };
export const shortDate = (date) => { const [, m, d] = date.split('-').map(Number); return `${m}/${d}`; };
export const timeLabel = (ms) => { const p = kstParts(ms); return `${p.h < 12 ? '오전' : '오후'} ${p.h % 12 || 12}:${String(p.min).padStart(2, '0')}`; };
export const ago = (ms, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
};
export const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const SLOT = { morning: '아침', after_school: '하교 후', evening: '저녁' };
export const DAYSETS = { daily: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekend: [0, 6] };
export const daysText = (days) => {
  const s = [...days].sort().join();
  if (s === '0,1,2,3,4,5,6') return '매일';
  if (s === '1,2,3,4,5') return '평일';
  if (s === '0,6') return '주말';
  return days.map((d) => DOW[d]).join('·');
};

// 배경화면 목록 (밝은 테마에서만 보임). 이 기기에만 저장돼요.
export const WALLS = [['cloud', '솜구름'], ['candy', '솜사탕'], ['rose', '로즈'], ['lilac', '라일락'], ['none', '없음']];
export const wallCur = () => { const w = lsGet('wall', 'cloud'); return WALLS.some(([k]) => k === w) ? w : 'cloud'; };
export const wallPickerHtml = (cur) => `<div class="wall-grid">${WALLS.map(([k, n]) => `<label class="wall-opt"><input type="radio" name="wall" value="${k}" ${cur === k ? 'checked' : ''}><span class="wall-thumb${k === 'none' ? ' none' : ''}" ${k === 'none' ? '' : `style="background-image:url(/assets/bg/${k}-t.webp)"`}></span><b>${n}</b></label>`).join('')}</div>`;

// 집 그림 목록 (우리집 화면의 큰 집). 이 기기에만 저장돼요. 방 칸 위치는 모든 그림이 같다.
export const HOUSES = [['pastel', '보라 집', '/assets/house.webp?v=4', '/assets/house-t.webp'], ['xmas', '크리스마스 집', '/assets/house-xmas.webp?v=1', '/assets/house-xmas-t.webp']];
export const houseCur = () => { const h = lsGet('house', 'pastel'); return HOUSES.some(([k]) => k === h) ? h : 'pastel'; };
export const houseSrc = () => HOUSES.find(([k]) => k === houseCur())[2];
export const housePickerHtml = (cur) => `<div class="wall-grid house-grid">${HOUSES.map(([k, n, , t]) => `<label class="wall-opt"><input type="radio" name="house" value="${k}" ${cur === k ? 'checked' : ''}><span class="wall-thumb house-thumb" style="background-image:url(${t})"></span><b>${n}</b></label>`).join('')}</div>`;
