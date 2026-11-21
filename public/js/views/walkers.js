import { $, $$, esc } from '../util.js';
import { S, put, isKidPhone, boundKid } from '../api.js';
import { avatar, toast, errToast } from '../ui.js';
import { timerOf } from '../timers.js';
import { actImgUrl } from '../actimg.js';

// ===== 건물 뼈대(집 그림 1086×1448 기준 %) =====
// 칸은 3×3 격자: 0행=거실(왼·가운데·오른쪽), 1행=유엘방·유하방·확인방, 2행=할머니방·엄마방·아빠방.
// 이동은 항상 '층 바닥선'(수평)과 '기둥 통로'(수직)만 따라간다. 벽이나 방 한가운데를 가로지르지 않는다.
export const FLOOR_Y = [30.0, 52.4, 73.9];       // 각 층 바닥선(발이 닿는 높이)
export const COL_X = [19.6, 50.2, 80.3];          // 각 칸의 가운데
export const PILLAR_X = [35.2, 64.9];             // 층과 층 사이를 오르내리는 기둥 통로
const SPEED = 16;                                  // 초당 이동량(가로 % 기준, 세로는 화면 비율 보정)
const V_SCALE = 1448 / 1086;
const PEOPLE = [
  { key: 'yuel', home: '10', kind: 'kid', idx: 0 }, { key: 'yuha', home: '11', kind: 'kid', idx: 1 },
  { key: 'gma', home: '20', kind: 'adult', role: 'grandma' }, { key: 'mom', home: '21', kind: 'adult', role: 'mom' }, { key: 'dad', home: '22', kind: 'adult', role: 'dad' },
];
const SPRITE = { gma: 149, dad: 152, yuel: 147, yuha: 166, mom: 156 }; // 걷기 시트 프레임 폭(높이는 280)
const rc = (cell) => [Number(cell[0]), Number(cell[1])];
const cellOf = (r, c) => `${r}${c}`;

// 경로: (시작) → 같은 층이면 바로 옆으로, 다른 층이면 가까운 기둥 통로까지 걸어가 오르내린 뒤 칸 가운데로
export function buildPath(fromCell, toCell, startX = null) {
  const [r0, c0] = rc(fromCell); const [r1, c1] = rc(toCell);
  const x0 = startX ?? COL_X[c0]; const y0 = FLOOR_Y[r0]; const x1 = COL_X[c1]; const y1 = FLOOR_Y[r1];
  const pts = [[x0, y0]];
  if (r0 !== r1) {
    const px = PILLAR_X.reduce((best, p) => (Math.abs(x0 - p) + Math.abs(x1 - p) < Math.abs(x0 - best) + Math.abs(x1 - best) ? p : best), PILLAR_X[0]);
    pts.push([px, y0], [px, y1]);
  }
  pts.push([x1, y1]);
  return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
}
const segLen = (a, b) => Math.hypot(b[0] - a[0], (b[1] - a[1]) * V_SCALE);

// ===== 상태(화면을 다시 그려도 유지) =====
const CHEER = new Map();              // 아이 id → 신나는 모습이 끝나는 시각(ms)
export const CHEER_MS = 5000;
const BANK_CELL = '12';              // 도장 방(확인방)
const PENDING = new Map();            // 내가 보냈지만 서버가 아직 확인하지 않은 이동: memberId → 칸
const W = new Map();                   // memberId → { id, key, home, cell, x, y, face, moving }
let selected = null;                   // 선택된 사람 id
let arriveCb = null;                   // 걸어서 도착했을 때 알림(도장 방에 도착하면 [도장 요청] 버튼을 보여 주기 위함)
let lastTap = { id: null, t: 0 };      // 같은 캐릭터를 빠르게 두 번 누르면(더블클릭/더블탭) 활동창을 연다
let P = [];                            // 현재 화면에 그릴 사람 정보
const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function peopleFrom(h) {
  const out = [];
  for (const d of PEOPLE) {
    const m = d.kind === 'kid' ? h.kids[d.idx] : (h.adults.find((a) => a.role === d.role) || S.info.adults.find((a) => a.role === d.role));
    if (!m) continue;
    out.push({ ...d, id: m.id, name: m.name, member: m, status: m.status?.state || null });
  }
  return out;
}
function slotX(cell, id) { // 한 칸에 여럿이면 좌우로 나눠 선다
  const here = [...W.values()].filter((w) => !w.moving && w.cell === cell).map((w) => w.id);
  if (!here.includes(id)) here.push(id);
  here.sort((a, b) => a - b);
  const n = here.length; const i = here.indexOf(id);
  return COL_X[rc(cell)[1]] + (n === 1 ? 0 : (i - (n - 1) / 2) * (n === 2 ? 11 : 9));
}
const baseY = (w) => FLOOR_Y[rc(w.cell)[0]];

// ===== 그리기 =====
function idleImg(p, w) {
  const atHome = w.cell === p.home;
  // 도장을 받은 순간부터 5초 동안은 두 팔을 번쩍 든 '신나는 모습'. 끝나면 기본 자세(활동 중이면 활동 모습)로 돌아온다
  if (p.kind === 'kid' && (CHEER.get(p.id) || 0) > Date.now()) return `<img class="wk-img cheer" src="/assets/chars/${p.key}-cheer.webp" alt="" draggable="false">`;
  if (p.kind === 'kid' && atHome) {
    const t = timerOf(p.id); const url = t && t.state === 'running' && actImgUrl(t.kind, p.id);
    if (url) return `<img class="wk-img act" src="${url}" alt="" draggable="false">`;
  }
  if (p.kind === 'adult' && atHome && (p.role === 'mom' || p.role === 'dad')) {
    if (p.status === 'working') return `<img class="wk-img wide" src="/assets/chars/${p.role}-work.webp" alt="" draggable="false">`;
    if (p.status === 'heading_home' || p.status === 'picking_up') return `<img class="wk-img wide car" src="/assets/chars/${p.role}-car.webp" alt="" draggable="false">`;
  }
  return `<img class="wk-img" src="/assets/chars/${p.key}.webp" alt="" draggable="false">`;
}
function walkerHtml(p) {
  const w = W.get(p.id);
  const timerLift = p.kind === 'kid' && w.cell === p.home && timerOf(p.id) ? 2.9 : 0;
  const x = w.moving ? w.x : slotX(w.cell, p.id); const y = (w.moving ? w.y : baseY(w)) - timerLift;
  const inner = w.moving
    ? `<div class="wk-sprite" style="background-image:url(/assets/walk/${p.key}.webp);--fw:${SPRITE[p.key]};transform:scaleX(${w.face})"></div>`
    : idleImg(p, w);
  return `<button class="walker ${w.moving ? 'moving' : 'idle'} ${selected === p.id ? 'sel' : ''}" data-walker="${p.id}" style="left:${x}%;top:${y}%" aria-label="${esc(p.name)} ${selected === p.id ? '선택됨' : '선택하기'}" aria-pressed="${selected === p.id}">${inner}<i class="wk-shadow"></i></button>`;
}
export const walkersLayerHtml = () => `<div class="walkers" aria-label="집 안을 걷는 가족">${P.map(walkerHtml).join('')}</div>`;
// 도장을 받은 아이를 5초 동안 신나는 모습으로(delay: 도장 쾅 애니메이션이 끝난 뒤부터 보이게 미룰 때)
export function cheer(id, { delay = 0 } = {}) {
  setTimeout(() => {
    CHEER.set(id, Date.now() + CHEER_MS);
    const redo = () => { const p = P.find((x) => x.id === id); const w = W.get(id); if (p && w && !w.moving) refreshOne(p); };
    redo();
    setTimeout(() => {
      redo();
      // 신나는 모습이 끝나면 도장 방에 서 있던 아이는 자기 방으로 걸어서 돌아간다(그 사이 다른 곳으로 옮겼다면 그대로 둔다)
      const p = P.find((x) => x.id === id); const w = W.get(id);
      if (p && w && !w.moving && w.cell === BANK_CELL && p.home !== BANK_CELL) moveTo(id, p.home);
    }, CHEER_MS + 30);
  }, delay);
}
export const anyMoving = () => [...W.values()].some((w) => w.moving);
// 걷는 그림의 크기를 '정수 픽셀'로 맞춘다: 12컷 시트를 소수점 픽셀로 넘기면 컷 사이 경계가 번져서 지글거려 보인다
function snapSprites(root = document) {
  root.querySelectorAll('.wk-sprite').forEach((sp) => {
    const key = (sp.style.backgroundImage.match(/walk\/(\w+)\.webp/) || [])[1]; const fw = SPRITE[key]; if (!fw) return;
    const h = Math.round(sp.parentElement.getBoundingClientRect().height) || Math.round(sp.getBoundingClientRect().height); if (!h) return;
    const w = Math.max(1, Math.round((h * fw) / 280));
    sp.style.width = `${w}px`; sp.style.height = `${h}px`; sp.style.backgroundSize = `${w * 12}px ${h}px`;
  });
}
export const walkerCell = (id) => { const w = W.get(id); return w ? { cell: w.cell, moving: w.moving } : null; };
export const walkPadHtml = () => ''; // 선택 안내창은 쓰지 않는다(캐릭터를 다시 누르면 선택 해제)

function relayout() { // 서 있는 사람들의 자리를 다시 나눈다(CSS 전환으로 부드럽게)
  for (const p of P) {
    const w = W.get(p.id); const el = document.querySelector(`[data-walker="${p.id}"]`);
    if (!el || w.moving) continue;
    const lift = p.kind === 'kid' && w.cell === p.home && timerOf(p.id) ? 2.9 : 0;
    el.style.left = `${slotX(w.cell, p.id)}%`; el.style.top = `${baseY(w) - lift}%`;
  }
}

// ===== 이동 =====
const raf = (fn) => requestAnimationFrame(fn);
export function moveTo(id, targetCell, { remote = false } = {}) {
  const w = W.get(id); const p = P.find((x) => x.id === id);
  if (!w || !p || w.moving || w.cell === targetCell) return;
  const from = w.cell;
  const finalX = (() => { const save = w.cell; w.cell = targetCell; const x = slotX(targetCell, id); w.cell = save; return x; })();
  const path = buildPath(from, targetCell, slotX(from, id));
  path[path.length - 1][0] = finalX;
  w.cell = targetCell;   // 논리 위치는 바로 바꿔 둔다(다른 기기와 같은 값)
  clearTimeout(idleTimer);
  if (!remote) {
    PENDING.set(id, targetCell);
    put(`/api/walkers/${id}`, { cell: targetCell })
      .then(() => { if (PENDING.get(id) === targetCell) PENDING.delete(id); })
      .catch((e) => { PENDING.delete(id); errToast(e); });
  }
  if (reduce()) { w.x = finalX; w.y = FLOOR_Y[rc(targetCell)[0]]; render(); armIdle(); arriveCb?.(p, targetCell); return; }
  w.moving = true; w.x = path[0][0]; w.y = path[0][1];
  const lens = path.slice(1).map((pt, i) => segLen(path[i], pt)); const total = lens.reduce((a, b) => a + b, 0);
  const t0 = performance.now(); let seg = 0;
  refreshOne(p); updatePad(); showTarget(targetCell, id);
  const tick = (now) => {
    let d = Math.min(total, ((now - t0) / 1000) * SPEED);
    let acc = 0; seg = 0;
    while (seg < lens.length - 1 && d > acc + lens[seg]) { acc += lens[seg]; seg++; }
    const a = path[seg]; const b = path[seg + 1]; const f = lens[seg] ? (d - acc) / lens[seg] : 1;
    w.x = a[0] + (b[0] - a[0]) * f; w.y = a[1] + (b[1] - a[1]) * f;
    if (b[0] !== a[0]) { const face = b[0] > a[0] ? 1 : -1; if (face !== w.face) { w.face = face; const sp = document.querySelector(`[data-walker="${id}"] .wk-sprite`); if (sp) sp.style.transform = `scaleX(${face})`; } }
    const el = document.querySelector(`[data-walker="${id}"]`);
    if (el) { el.style.left = `${w.x}%`; el.style.top = `${w.y}%`; }
    if (d < total) raf(tick); else { w.moving = false; w.face = 1; clearTarget(); refreshOne(p); relayout(); updatePad(); armIdle(); arriveCb?.(p, w.cell); }
  };
  raf(tick);
}
function refreshOne(p) {
  const old = document.querySelector(`[data-walker="${p.id}"]`); if (!old) return;
  const tmp = document.createElement('div'); tmp.innerHTML = walkerHtml(p); const nw = tmp.firstElementChild; old.replaceWith(nw); snapSprites(nw);
}
function render() { const layer = document.querySelector('.walkers'); if (layer) { layer.outerHTML = walkersLayerHtml(); snapSprites(); } updatePad(); }

// ===== 방향 패드 =====
function updatePad() {
  const pad = document.getElementById('walkpad'); if (!pad) return; // 안내창이 없으면 아무것도 하지 않는다
  const p = P.find((x) => x.id === selected); const w = p && W.get(p.id);
  if (!p) { pad.innerHTML = '<p class="walk-hint">🚶 캐릭터를 눌러 집 안을 걸어 보세요</p>'; return; }
  const busy = w.moving;
  pad.innerHTML = `<div class="pad-head">${avatar(p.member, 'sm')} <b>${esc(p.name)}</b><button class="btn small ghost" data-act="close" aria-label="선택 해제">✕</button></div>
    <p class="walk-hint">${busy ? '걷는 중이에요…' : '👆 가고 싶은 곳을 눌러 주세요'}</p>
    <div class="row gap wrap center"><button class="btn small" data-act="home" ${w.cell === p.home || busy ? 'disabled' : ''}>🏠 내 방으로</button><button class="btn small ghost" data-act="open">${p.kind === 'kid' ? '화면 열기' : '상태 바꾸기'}</button></div>`;
}

// 눌린 위치(집 그림 %) → 칸. 정원(아래쪽 바깥)이나 벽 밖은 가지 않는다.
export function cellAt(xPct, yPct) {
  if (xPct < 4 || xPct > 96 || yPct < 9 || yPct > 78) return null;
  const row = yPct < 33.5 ? 0 : yPct < 55.7 ? 1 : 2;
  const col = xPct < PILLAR_X[0] ? 0 : xPct < PILLAR_X[1] ? 1 : 2;
  return cellOf(row, col);
}
function clearTarget() { document.querySelectorAll('.walk-target').forEach((e) => e.remove()); }
function showTarget(cell, id) {
  const layer = document.querySelector('.walkers'); if (!layer) return;
  clearTarget();
  layer.insertAdjacentHTML('afterbegin', `<i class="walk-target" style="left:${slotX(cell, id)}%;top:${FLOOR_Y[rc(cell)[0]]}%"></i>`);
}

// ===== 선택 자동 해제: 선택한 채 한 자리에서 5초 동안 이동 요청이 없으면 이동 선택을 끈다 =====
export const IDLE_MS = 5000;
let idleTimer = null;
function deselect() {
  selected = null;
  document.querySelectorAll('.walker.sel').forEach((x) => { x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false'); });
  updatePad();
}
function armIdle() {
  clearTimeout(idleTimer); idleTimer = null;
  if (selected === null) return;
  idleTimer = setTimeout(() => { const w = W.get(selected); if (w?.moving) return armIdle(); deselect(); }, IDLE_MS);
}

// 홈 화면을 다시 그리지 않고, 서버에서 온 위치만 맞춘다(다른 기기에서 누가 움직였을 때 이 화면에서도 걸어서 이동)
export function syncWalkers(h) {
  P = peopleFrom(h);
  const server = h.walkers || {};
  for (const p of P) {
    const target = server[p.id] || p.home;
    if (!W.get(p.id)) W.set(p.id, { id: p.id, key: p.key, home: p.home, cell: target, x: COL_X[rc(target)[1]], y: FLOOR_Y[rc(target)[0]], face: 1, moving: false });
  }
  for (const p of P) { const w = W.get(p.id); const target = server[p.id] || p.home; if (!w.moving && !PENDING.has(p.id) && w.cell !== target) setTimeout(() => moveTo(p.id, target, { remote: true }), 30); }
}

// ===== 연결 =====
export function mountWalkers(houseEl, h, { onOpen, onDouble, onArrive } = {}) {
  P = peopleFrom(h); arriveCb = onArrive || null;
  const server = h.walkers || {};
  for (const p of P) {
    const target = server[p.id] || p.home;
    const w = W.get(p.id);
    if (!w) W.set(p.id, { id: p.id, key: p.key, home: p.home, cell: target, x: COL_X[rc(target)[1]], y: FLOOR_Y[rc(target)[0]], face: 1, moving: false });
  }
  // 다른 기기에서 움직인 사람은 이 화면에서도 걸어서 이동
  const toMove = [];
  for (const p of P) { const w = W.get(p.id); const target = server[p.id] || p.home; if (!w.moving && !PENDING.has(p.id) && w.cell !== target) toMove.push([p.id, target]); }
  const layerHost = houseEl.querySelector('.house');
  if (layerHost) { layerHost.querySelector('.walkers')?.remove(); layerHost.insertAdjacentHTML('beforeend', walkersLayerHtml()); snapSprites(layerHost); }
  updatePad();
  houseEl.addEventListener('click', (e) => {
    const wk = e.target.closest('[data-walker]');
    // 이미 누군가를 선택한 상태에서 '다른 사람' 위를 누르면, 그 사람을 고르는 게 아니라 그 칸으로 가는 것으로 본다
    // (같은 사람을 다시 누르면 선택 해제). 그래서 누가 서 있는 칸의 한가운데도 목적지로 고를 수 있다.
    if (wk && !(selected !== null && Number(wk.dataset.walker) !== selected)) { // 캐릭터 누르기 = 선택/해제
      e.stopPropagation();
      const id = Number(wk.dataset.walker);
      if (isKidPhone() && id !== boundKid()) return; // 아이 폰에서는 자기 캐릭터만 움직일 수 있다
      const now = Date.now(); const dbl = lastTap.id === id && now - lastTap.t < 420; lastTap = { id: dbl ? null : id, t: now };
      if (dbl) { const p = P.find((x) => x.id === id); if (p && onDouble) { onDouble(p); return; } }
      selected = selected === id ? null : id;
      $$('.walker', houseEl).forEach((x) => { const on = Number(x.dataset.walker) === selected; x.classList.toggle('sel', on); x.setAttribute('aria-pressed', on); });
      updatePad(); armIdle(); return;
    }
    const a = e.target.closest('[data-act]');
    if (a) {
      e.stopPropagation();
      const p = P.find((x) => x.id === selected); if (!p) return;
      if (a.dataset.act === 'close') { selected = null; $$('.walker.sel', houseEl).forEach((x) => { x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false'); }); updatePad(); }
      if (a.dataset.act === 'home') moveTo(p.id, p.home);
      if (a.dataset.act === 'open') onOpen?.(p);
      return;
    }
    if (e.target.closest('#walkpad')) { e.stopPropagation(); return; }
    // 선택된 캐릭터가 있으면, 집 안을 누른 곳으로 걸어간다(방 화면으로 넘어가지 않는다)
    const house = e.target.closest('.house'); const p = P.find((x) => x.id === selected);
    if (!house || !p) return;
    e.stopPropagation(); e.preventDefault();
    const r = house.getBoundingClientRect();
    const cell = cellAt(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
    const w = W.get(p.id);
    if (!cell || w.moving || w.cell === cell) { armIdle(); return; }
    moveTo(p.id, cell);
  }, true);
  for (const [id, target] of toMove) setTimeout(() => moveTo(id, target, { remote: true }), 50);
}
void toast;
