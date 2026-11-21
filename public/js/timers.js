import { esc, lsGet, lsSet } from './util.js';
import { S, get, post, bus, isDevice } from './api.js';
import { actPic } from './actimg.js';

// ---- 상태: 서버가 알려 준 '종료 시각'과 서버-기기 시계 차이로 남은 시간을 계산한다 ----
export const T = { timers: [], offset: 0, sound: true, loaded: false };
export const nowMs = () => Date.now() + T.offset;
export const remaining = (t) => Math.max(0, t.endsAt - nowMs());
export const timerOf = (kidId) => T.timers.find((t) => t.kidId === Number(kidId)) || null;
export function fmt(ms) {
  const s = Math.ceil(ms / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
  const mm = String(m).padStart(2, '0'); const ss = String(x).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
export function ringSvg(t, size = 120, stroke = 10) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="남은 시간 ${fmt(remaining(t))}"><circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"/>
    <circle class="ring-fg ${t.state === 'ended' ? 'done' : remaining(t) <= 300000 ? 'soon' : ''}" data-ring="${t.id}" data-c="${c}" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac(t))}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}
const frac = (t) => (t.state === 'ended' ? 0 : Math.min(1, remaining(t) / t.totalMs));
export const nextCards = (t, small = false) => `<div class="now-next ${small ? 'small' : ''}"><div class="nn-card now"><small>지금</small>${actPic(t.kind, t.icon, t.kidId, 'nn')}<b>${esc(t.name)}</b></div>${t.next ? `<span class="nn-arrow" aria-hidden="true">→</span><div class="nn-card next ${t.next.done ? 'done' : ''}"><small>다음</small><span class="nn-ic">${esc(t.next.icon)}</span><b>${esc(t.next.name)}</b>${t.next.done ? '<em>이미 했어요</em>' : ''}</div>` : ''}</div>`;

export async function loadTimers() {
  const r = await get('/api/timers', { noPrompt: true });
  T.offset = r.serverNow - Date.now(); T.sound = r.soundEnabled; T.timers = r.timers; T.loaded = true;
  bus.emit('timers');
  catchUp();
  return T.timers;
}

// ---- 1초 틱: 화면에 있는 활동 숫자/링만 갱신(재렌더 없음) ----
const reloaded = new Set();
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); loadTimers().catch(() => {}); } });
function tick() {
  for (const t of T.timers) {
    const rem = remaining(t);
    document.querySelectorAll(`[data-timer="${t.id}"]`).forEach((el) => { el.textContent = t.state === 'ended' ? '00:00' : fmt(rem); });
    document.querySelectorAll(`[data-elapsed="${t.id}"]`).forEach((el) => { el.textContent = fmt(Math.max(0, t.totalMs - rem)); });
    document.querySelectorAll(`[data-bar="${t.id}"]`).forEach((el) => { el.style.width = `${(100 * (1 - rem / t.totalMs)).toFixed(1)}%`; });
    document.querySelectorAll(`[data-ring="${t.id}"]`).forEach((el) => { el.setAttribute('stroke-dashoffset', String(Number(el.dataset.c) * (1 - frac(t)))); if (rem <= 300000) el.classList.add('soon'); });
    if (t.state === 'running' && rem <= 0 && !reloaded.has(t.id + ':' + t.endsAt)) { reloaded.add(t.id + ':' + t.endsAt); loadTimers().catch(() => {}); }
  }
}

// ---- 알림(팝업 + 부드러운 알람) ----
const seen = new Set(lsGet('seenTimerKeys', []));
const markSeen = (k) => { seen.add(k); lsSet('seenTimerKeys', [...seen].slice(-120)); };
let audio = null;
function unlockAudio() {
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch {}
}
['pointerdown', 'keydown', 'touchstart'].forEach((e) => window.addEventListener(e, unlockAudio, { passive: true }));
export const audioReady = () => !!audio && audio.state === 'running';
export function chime(kind) {
  if (!T.sound || !audio || audio.state !== 'running') return false;
  const notes = kind === 'end' ? [659.25, 523.25, 392] : [523.25, 659.25]; // 짧고 부드러운 두~세 음
  const t0 = audio.currentTime + 0.02;
  notes.forEach((f, i) => {
    const o = audio.createOscillator(); const g = audio.createGain();
    o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(audio.destination);
    const s = t0 + i * 0.32;
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.18, s + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.7);
    o.start(s); o.stop(s + 0.75);
  });
  return true;
}

function popupHost() {
  let h = document.querySelector('.tp-wrap');
  if (!h) { h = document.createElement('div'); h.className = 'tp-wrap'; h.setAttribute('role', 'alertdialog'); h.setAttribute('aria-label', '활동 알림'); document.getElementById('layer').appendChild(h); }
  return h;
}
export function showAlert(kind, t, { quiet = false } = {}) {
  const host = popupHost();
  const next = t.next;
  const openRoutine = kind === 'end' && next?.type === 'routine' && !next.done;
  const card = document.createElement('div');
  card.className = `tp-card ${kind}`;
  card.style.setProperty('--kc', t.kidColor);
  card.dataset.key = kind === 'warn' ? t.warnKey : t.endKey;
  card.innerHTML = `<div class="tp-head"><span class="avatar md" style="--kc:${esc(t.kidColor)}">${esc(t.kidAvatar)}</span><h2>${esc(t.kidName)} · ${kind === 'warn' ? '5분 남았어요' : '시간이 끝났어요'}</h2></div>
    ${nextCards(t)}
    <p class="tp-text">${esc(kind === 'warn' ? t.texts.warn : t.texts.end)}</p>
    ${kind === 'end' && t.texts.nextEnd ? `<p class="tp-next">${esc(t.texts.nextEnd)}</p>` : ''}
    <div class="row gap wrap center"><button class="btn primary big" data-ok>알겠어요</button>${openRoutine ? `<button class="btn big" data-open>${esc(next.name)} 루틴 열기</button>` : ''}</div>
    ${T.sound && !audioReady() ? '<p class="small muted center">🔇 소리를 들으려면 화면을 한 번 눌러 주세요</p>' : ''}`;
  const close = () => { card.remove(); if (!host.children.length) host.remove(); };
  // [알겠어요]는 팝업만 닫는다. 카운트다운·시간·루틴 체크에는 아무 영향이 없다.
  card.querySelector('[data-ok]').onclick = close;
  card.querySelector('[data-open]')?.addEventListener('click', () => { close(); location.hash = `#/kid/${t.kidId}/today`; });
  host.appendChild(card);
  if (!quiet) chime(kind);
}

// 같은 알림 키는 한 번만 보여 준다(새로고침·재접속·여러 번 조회해도 중복 없음)
function present(kind, t, quiet) {
  const key = kind === 'warn' ? t.warnKey : t.endKey;
  if (seen.has(key)) return;
  markSeen(key);
  showAlert(kind, t, { quiet });
}
// 화면이 닫혀 있다가 돌아온 경우: 이미 끝난 활동은 종료 상태를 바로 보여 주고, 지난 5분 예고는 다시 띄우지 않는다.
function catchUp() {
  if (!isDevice()) return;
  const now = nowMs();
  for (const t of T.timers) {
    if (t.state === 'ended') { if (now - t.endsAt < 30 * 60000) present('end', t, now - t.endsAt > 60000); }
    else if (t.warnAt && now >= t.warnAt) present('warn', t, false);
  }
}
bus.on('timer', async (ev) => {
  if (!isDevice()) return;
  try { await loadTimers(); } catch { return; }
  const t = T.timers.find((x) => x.id === ev.timerId);
  if (!t) return;
  // 서버가 보낸 key 와 같은 알림만 (연장 등으로 key 가 바뀐 이전 알림은 무시)
  if (ev.kind === 'warn' && t.warnKey === ev.key) present('warn', t, false);
  if (ev.kind === 'end' && t.endKey === ev.key) present('end', t, false);
});
bus.on('refresh', (topics) => { if (S.info && (topics.includes('timers') || topics.includes('all') || topics.includes('home'))) loadTimers().catch(() => {}); });
export function startTimerManager() { if (S.info) loadTimers().catch(() => {}); }
void post;
