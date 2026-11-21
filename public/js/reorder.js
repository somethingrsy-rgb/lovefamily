// 화면 배열 바꾸기: 어른이 칸(카드·패널·하단 메뉴)을 손가락으로 꾹 누르면 '배열 바꾸기' 상태가 되고, 끌어서 순서를 바꾼다.
// 바꾼 순서는 서버(가족 공통)에 저장되어 거실 iPad·가족 휴대폰에 모두 같게 보인다.
//
// 표시 규칙(HTML):  data-rc="칸이름"  = 순서를 바꿀 수 있는 묶음(부모),  그 자식의  data-rk="이름"  = 움직이는 항목.
//                   자식에 data-section 이 있으면 '큰 덩어리'라서, 배열 바꾸기 상태에서 왼쪽 위 손잡이(⠿)를 끌어 옮긴다.
import { S, put, isDevice, isAdultNow, boundKid, bus } from './api.js';
import { toast, errToast, needAdult, confirmDialog } from './ui.js';

const LONG_MS = 550;      // 꾹 누르는 시간
const SLOP = 10;          // 이만큼 움직이면 '스크롤'로 보고 꾹 누르기를 취소
const HANDLE = 46;        // 큰 덩어리 손잡이 크기(px)
let editing = false;
let applying = false;
let press = null;         // 꾹 누르기 대기 중
let drag = null;          // 끌고 있는 중
let swallowClick = false; // 끌기가 끝난 직후의 클릭은 무시

export const isEditing = () => editing;
const layoutOf = () => S.info?.family?.layout || {};
const canEdit = () => !!S.info && !boundKid(); // 아이 전용 폰에서는 바꿀 수 없다(서버도 어른만 허용)

// ---------- 저장된 순서 적용 ----------
export function applyLayout(root = document) {
  const lay = layoutOf();
  applying = true;
  try {
    root.querySelectorAll('[data-rc]').forEach((c) => {
      const order = lay[c.dataset.rc];
      if (!order?.length) return;
      const kids = [...c.children].filter((x) => x.dataset.rk);
      if (kids.length < 2) return;
      const idx = (k) => { const i = order.indexOf(k); return i < 0 ? 1e6 : i; };
      const sorted = kids.map((el, i) => [el, i]).sort((a, b) => idx(a[0].dataset.rk) - idx(b[0].dataset.rk) || a[1] - b[1]).map((x) => x[0]);
      if (sorted.every((el, i) => el === kids[i])) return;
      const after = kids[kids.length - 1].nextSibling;
      sorted.forEach((el) => c.insertBefore(el, after));
    });
  } finally { applying = false; }
}

// 일반 화면(가족·도장판 등)은 맨 위 칸(section.card)들과 허브의 큰 버튼 묶음을 자동으로 표시한다
const slug = (t) => String(t || '').replace(/[^\w가-힣]+/g, '').slice(0, 30);
export function decoratePage(main, routeKey) {
  const secs = [...main.children].filter((x) => x.matches?.('section.card, section.page-card'));
  if (secs.length >= 2) {
    main.dataset.rc = `page:${routeKey}`;
    secs.forEach((s, i) => { s.dataset.rk = slug(s.querySelector('h2,h3')?.textContent) || `s${i}`; s.dataset.section = '1'; });
  }
  main.querySelectorAll('.big-grid').forEach((g, gi) => {
    const btns = [...g.children].filter((x) => x.matches('a,button'));
    if (btns.length < 2) return;
    g.dataset.rc = `grid:${routeKey}:${gi}`;
    btns.forEach((b, i) => { b.dataset.rk = slug(b.querySelector('b')?.textContent) || `b${i}`; });
  });
}

// ---------- 배열 바꾸기 상태 ----------
function bar() {
  let b = document.querySelector('.layout-bar');
  if (b) return b;
  b = document.createElement('div');
  b.className = 'layout-bar'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', '화면 배열 바꾸기');
  b.innerHTML = '<span>✋ 끌어서 순서를 바꿔요</span><button class="btn small" data-done>완료</button><button class="btn small ghost" data-reset>처음 배열로</button>';
  document.body.appendChild(b);
  b.addEventListener('click', async (e) => {
    if (e.target.closest('[data-done]')) exitEdit();
    if (e.target.closest('[data-reset]')) {
      if (!(await confirmDialog('처음 배열로 되돌릴까요? 가족 모두의 화면이 바뀌어요.', { yes: '되돌리기', no: '아니요' }))) return;
      try { await put('/api/layout', { layout: {} }); if (S.info?.family) S.info.family.layout = {}; toast('처음 배열로 되돌렸어요'); exitEdit(); bus.emit('refresh', ['all']); } catch (x) { errToast(x); }
    }
  });
  return b;
}
export function enterEdit() {
  if (editing) return;
  editing = true; document.body.classList.add('layout-edit'); bar();
}
export function exitEdit() {
  editing = false; document.body.classList.remove('layout-edit'); document.querySelector('.layout-bar')?.remove();
}

// ---------- 누른 곳에서 '움직일 항목' 찾기 ----------
function pickItem(e) {
  let el = e.target instanceof Element ? e.target.closest('[data-rk]') : null;
  const cands = [];
  while (el) { if (el.parentElement?.dataset.rc) cands.push(el); el = el.parentElement?.closest('[data-rk]'); }
  if (!cands.length) return null;
  if (editing) { // 큰 덩어리는 왼쪽 위 손잡이로만 잡는다
    for (const c of cands) {
      if (!c.dataset.section) continue;
      const r = c.getBoundingClientRect();
      if (e.clientX - r.left < HANDLE && e.clientY - r.top < HANDLE) return c;
    }
    const small = cands.find((c) => !c.dataset.section);
    return small || null;
  }
  return cands.find((c) => !c.dataset.section) || null; // 꾹 누르기로는 카드·패널·메뉴 같은 작은 항목만
}

// ---------- 포인터 처리 ----------
const stop = (ev) => ev.preventDefault();
function onDown(e) {
  if (!canEdit() || e.button > 0 || e.target.closest?.('.layout-bar, .sheet, .popup, .tp-card')) return;
  if (drag || press) return;
  const item = pickItem(e);
  if (!item) return;
  if (e.target.closest('input, textarea, select')) return;
  if (editing) { press = { item, x: e.clientX, y: e.clientY, id: e.pointerId, immediate: true }; return; }
  press = { item, x: e.clientX, y: e.clientY, id: e.pointerId, t: setTimeout(() => activate(), LONG_MS) };
}
async function activate() {
  const p = press; if (!p) return;
  p.t = null;
  if (isDevice() && !isAdultNow()) {            // 거실 공용 기기: 어른 확인 후에 바꿀 수 있다
    press = null;
    if (!(await needAdult())) return;
  }
  enterEdit();
  if (press === p || !p) { if (p) startDrag(p.item, p.x, p.y, p.id); }
}
function onMove(e) {
  if (drag) return moveDrag(e);
  if (!press || e.pointerId !== press.id) return;
  const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > (press.immediate ? 6 : SLOP);
  if (!far) return;
  if (press.immediate) { const p = press; press = null; startDrag(p.item, p.x, p.y, p.id); moveDrag(e); } // 이미 배열 바꾸기 중: 조금만 움직이면 바로 끌기
  else { clearTimeout(press.t); press = null; } // 스크롤로 판단
}
function onUp() {
  if (press) { clearTimeout(press.t); press = null; }
  if (drag) endDrag();
}
function startDrag(item, x, y, pid) {
  const r = item.getBoundingClientRect();
  drag = { item, c: item.parentElement, gx: x - r.left, gy: y - r.top, pid };
  item.classList.add('rk-dragging');
  document.addEventListener('touchmove', stop, { passive: false });
  navigator.vibrate?.(15);
}
function moveDrag(e) {
  const { item, c, gx, gy } = drag;
  const px = e.clientX, py = e.clientY;
  item.style.transform = '';
  const sibs = [...c.children].filter((x) => x !== item && x.dataset.rk);
  let hit = null; let best = null; let bd = Infinity;
  for (const s of sibs) {
    const r = s.getBoundingClientRect();
    if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) { hit = s; break; }
    const d = Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2));
    if (d < bd) { bd = d; best = s; }
  }
  const target = hit || null;
  if (target) {
    const all = [...c.children];
    applying = true;
    if (all.indexOf(target) < all.indexOf(item)) c.insertBefore(item, target); else c.insertBefore(item, target.nextSibling);
    applying = false;
  }
  void best;
  const r2 = item.getBoundingClientRect();
  item.style.transform = `translate(${px - gx - r2.left}px, ${py - gy - r2.top}px)`;
}
async function endDrag() {
  const { item, c } = drag; drag = null;
  item.style.transform = ''; item.classList.remove('rk-dragging');
  document.removeEventListener('touchmove', stop);
  swallowClick = true; setTimeout(() => { swallowClick = false; }, 350);
  const order = [...c.children].filter((x) => x.dataset.rk).map((x) => x.dataset.rk);
  const lay = { ...layoutOf(), [c.dataset.rc]: order };
  if (S.info?.family) S.info.family.layout = lay;
  try { await put('/api/layout', { layout: lay }); toast('배열을 저장했어요'); } catch (x) { errToast(x); }
}

let started = false;
export function initReorder() {
  if (started) return; started = true;
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
  // 배열 바꾸는 중에는 눌러도 다른 화면으로 넘어가지 않고, 끌기 직후의 클릭도 무시한다
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.layout-bar')) return;
    if (editing || swallowClick) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  // 마우스로 링크(카드)를 끌 때 브라우저가 '링크 끌어다 놓기'를 시작해 우리 끌기가 끊기는 것을 막는다
  document.addEventListener('dragstart', (e) => { if (canEdit() && e.target instanceof Element && e.target.closest('[data-rk]') && (editing || press || drag)) e.preventDefault(); }, true);
  // 안드로이드: 꾹 누르면 뜨는 메뉴를 막는다(우리 칸 위에서만)
  document.addEventListener('contextmenu', (e) => { if (canEdit() && e.target.closest?.('[data-rk]') && !e.target.closest('input, textarea')) e.preventDefault(); }, true);
  // 화면이 다시 그려져도(새로고침·실시간 갱신) 저장된 순서를 다시 적용한다
  let q = false;
  const mo = new MutationObserver(() => { if (applying || drag || q) return; q = true; requestAnimationFrame(() => { q = false; applyLayout(); }); });
  mo.observe(document.body, { childList: true, subtree: true });
  bus.on('reloadInfo', () => applyLayout());
}
