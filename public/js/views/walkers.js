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
const SPEED = 30;                                  // 초당 이동량(가로 % 기준, 세로는 화면 비율 보정)
const V_SCALE = 1448 / 1086;
const PEOPLE = [
  { key: 'yuel', home: '10', kind: 'kid', idx: 0 }, { key: 'yuha', home: '11', kind: 'kid', idx: 1 },
  { key: 'gma', home: '20', kind: 'adult', role: 'grandma' }, { key: 'mom', home: '21', kind: 'adult', role: 'mom' }, { key: 'dad', home: '22', kind: 'adult', role: 'dad' },
];
const SPRITE = { gma: 162, dad: 144, yuel: 140, yuha: 160, mom: 148 }; // 걷기 시트 프레임 폭(높이는 280)
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
const W = new Map();                   // memberId → { id, key, home, cell, x, y, face, moving }
let selected = null;                   // 선택된 사람 id
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
  if (p.kind === 'kid' && atHome) {
    const t = timerOf(p.id); const url = t && t.state !== 'ended' && actImgUrl(t.kind, p.id);
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
export const walkPadHtml = () => '<div class="walk-pad" id="walkpad"></div>';

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
  if (!remote) put(`/api/walkers/${id}`, { cell: targetCell }).catch(errToast);
  if (reduce()) { w.x = finalX; w.y = FLOOR_Y[rc(targetCell)[0]]; render(); return; }
  w.moving = true; w.x = path[0][0]; w.y = path[0][1];
  const lens = path.slice(1).map((pt, i) => segLen(path[i], pt)); const total = lens.reduce((a, b) => a + b, 0);
  const t0 = performance.now(); let seg = 0;
  refreshOne(p); updatePad();
  const tick = (now) => {
    let d = Math.min(total, ((now - t0) / 1000) * SPEED);
    let acc = 0; seg = 0;
    while (seg < lens.length - 1 && d > acc + lens[seg]) { acc += lens[seg]; seg++; }
    const a = path[seg]; const b = path[seg + 1]; const f = lens[seg] ? (d - acc) / lens[seg] : 1;
    w.x = a[0] + (b[0] - a[0]) * f; w.y = a[1] + (b[1] - a[1]) * f;
    if (b[0] !== a[0]) { const face = b[0] > a[0] ? 1 : -1; if (face !== w.face) { w.face = face; const sp = document.querySelector(`[data-walker="${id}"] .wk-sprite`); if (sp) sp.style.transform = `scaleX(${face})`; } }
    const el = document.querySelector(`[data-walker="${id}"]`);
    if (el) { el.style.left = `${w.x}%`; el.style.top = `${w.y}%`; }
    if (d < total) raf(tick); else { w.moving = false; w.face = 1; refreshOne(p); relayout(); updatePad(); }
  };
  raf(tick);
}
function refreshOne(p) {
  const old = document.querySelector(`[data-walker="${p.id}"]`); if (!old) return;
  const tmp = document.createElement('div'); tmp.innerHTML = walkerHtml(p); old.replaceWith(tmp.firstElementChild);
}
function render() { const layer = document.querySelector('.walkers'); if (layer) layer.outerHTML = walkersLayerHtml(); updatePad(); }

// ===== 방향 패드 =====
function updatePad() {
  const pad = document.getElementById('walkpad'); if (!pad) return;
  const p = P.find((x) => x.id === selected); const w = p && W.get(p.id);
  if (!p) { pad.innerHTML = '<p class="walk-hint">🚶 캐릭터를 눌러 집 안을 걸어 보세요</p>'; return; }
  const [r, c] = rc(w.cell);
  const can = { up: r > 0, down: r < 2, left: c > 0, right: c < 2 };
  const busy = w.moving;
  const btn = (dir, label, ok) => `<button class="pad-btn ${dir}" data-dir="${dir}" ${ok && !busy ? '' : 'disabled'} aria-label="${label}">${{ up: '▲', down: '▼', left: '◀', right: '▶' }[dir]}</button>`;
  pad.innerHTML = `<div class="pad-head">${avatar(p.member, 'sm')} <b>${esc(p.name)}</b>${busy ? ' 걷는 중…' : ''}<button class="btn small ghost" data-act="close" aria-label="선택 해제">✕</button></div>
    <div class="pad-row">${btn('left', '왼쪽으로', can.left)}${btn('up', '위로', can.up)}${btn('down', '아래로', can.down)}${btn('right', '오른쪽으로', can.right)}</div>
    <div class="row gap wrap center"><button class="btn small" data-act="home" ${w.cell === p.home || busy ? 'disabled' : ''}>🏠 내 방으로</button><button class="btn small ghost" data-act="open">${p.kind === 'kid' ? '화면 열기' : '상태 바꾸기'}</button></div>`;
}

// ===== 연결 =====
export function mountWalkers(houseEl, h, { onOpen } = {}) {
  P = peopleFrom(h);
  const server = h.walkers || {};
  for (const p of P) {
    const target = server[p.id] || p.home;
    const w = W.get(p.id);
    if (!w) W.set(p.id, { id: p.id, key: p.key, home: p.home, cell: target, x: COL_X[rc(target)[1]], y: FLOOR_Y[rc(target)[0]], face: 1, moving: false });
  }
  // 다른 기기에서 움직인 사람은 이 화면에서도 걸어서 이동
  const toMove = [];
  for (const p of P) { const w = W.get(p.id); const target = server[p.id] || p.home; if (!w.moving && w.cell !== target) toMove.push([p.id, target]); }
  const layerHost = houseEl.querySelector('.house');
  if (layerHost) { layerHost.querySelector('.walkers')?.remove(); layerHost.insertAdjacentHTML('beforeend', walkersLayerHtml()); }
  updatePad();
  houseEl.onclick = (e) => {
    const wk = e.target.closest('[data-walker]');
    if (wk) { const id = Number(wk.dataset.walker); selected = selected === id ? null : id; $$('.walker', houseEl).forEach((x) => { const on = Number(x.dataset.walker) === selected; x.classList.toggle('sel', on); x.setAttribute('aria-pressed', on); }); updatePad(); return; }
    const d = e.target.closest('[data-dir]'); const a = e.target.closest('[data-act]');
    const p = P.find((x) => x.id === selected); if (!p) return; const w = W.get(p.id);
    if (d && !d.disabled) { const [r, c] = rc(w.cell); const nr = r + (d.dataset.dir === 'down') - (d.dataset.dir === 'up'); const nc = c + (d.dataset.dir === 'right') - (d.dataset.dir === 'left'); moveTo(p.id, cellOf(nr, nc)); }
    if (a?.dataset.act === 'close') { selected = null; $$('.walker.sel', houseEl).forEach((x) => { x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false'); }); updatePad(); }
    if (a?.dataset.act === 'home') moveTo(p.id, p.home);
    if (a?.dataset.act === 'open') onOpen?.(p);
  };
  for (const [id, target] of toMove) setTimeout(() => moveTo(id, target, { remote: true }), 50);
}
void toast; void isKidPhone; void boundKid;
