// 집 그림 안을 돌아다니는 반려동물: 고양이 두 마리(다이아·크리스탈)와 강아지 귀요미.
// 다이아는 유엘이, 귀요미는 유하가 주인이라 그 아이 곁에 자주 가 있는다. 간식 주기·산책 버튼은 홈의 아이 카드에 있다.
// 층 바닥선을 걷다가 앉고·자고·털을 핥고, 기둥 통로에서는 폴짝 뛰어 다른 층으로 오간다. 누르면 애교를 부린다.
// 사람 캐릭터처럼 정해진 위치를 서버와 맞추지는 않는다(기기마다 자기 마음대로 돌아다닌다).
import { FLOOR_Y, PILLAR_X, COL_X, GARDEN, walkerCell, walkerPos, gardenWalk } from './walkers.js';
import { S, bus, post } from '../api.js';

// 그림 시트(가로로 이어 붙인 프레임): { 너비, 높이, 프레임 수 } — public/assets/cats/*.webp
const SHEET = {
  'ruby-walkR': [167, 131, 12], 'ruby-walkL': [162, 132, 12], 'ruby-up': [175, 157, 12], 'ruby-down': [165, 176, 12],
  'ruby-sit': [122, 152, 1], 'ruby-sleep': [155, 104, 1], 'ruby-groom': [131, 147, 1], 'ruby-aegyo': [164, 120, 1],
  'crystal-walkR': [159, 130, 12], 'crystal-walkL': [161, 130, 12], 'crystal-up': [174, 153, 12], 'crystal-down': [173, 131, 9],
  'crystal-sit': [124, 149, 1], 'crystal-sleep': [159, 109, 1], 'crystal-groom': [139, 150, 1], 'crystal-aegyo': [169, 127, 1], 'crystal-stand': [158, 130, 1],
  'ruby-play-sniff': [156, 132, 12], 'ruby-play-tap': [142, 146, 12], 'ruby-play-bow': [153, 134, 12], 'ruby-play-roll': [174, 153, 12], 'ruby-play-dash': [168, 140, 12], 'ruby-play-sneak': [158, 132, 12],
  'crystal-play-sniff': [141, 139, 12], 'crystal-play-tap': [138, 142, 12], 'crystal-play-bow': [154, 136, 12], 'crystal-play-roll': [163, 153, 12], 'crystal-play-dash': [176, 133, 12], 'crystal-play-sneak': [162, 130, 12],
  // 강아지 귀요미 (public/assets/dog/dog-*.webp). 오르내리기는 뛰는 그림 하나를 같이 쓴다
  'yeoni-walkR': [140, 121, 12], 'yeoni-walkL': [140, 121, 12], 'yeoni-up': [137, 121, 12], 'yeoni-down': [137, 121, 12],
  'yeoni-sit': [102, 135, 1], 'yeoni-sleep': [125, 97, 1], 'yeoni-groom': [107, 132, 1], 'yeoni-aegyo': [114, 127, 1], 'yeoni-stand': [124, 131, 1], 'yeoni-roll': [145, 114, 1],
};
const POSES = { ruby: ['sit', 'sleep', 'groom'], crystal: ['sit', 'sleep', 'groom', 'stand'], yeoni: ['sit', 'sleep', 'groom', 'stand', 'roll'] };
// 그림 파일 경로: 고양이는 cats/, 강아지(귀요미)는 dog/dog-이름.webp, 오르내리기는 dog-jump 하나
const fileOf = (id, name) => (id === 'yeoni' ? `/assets/dog/dog-${name === 'up' || name === 'down' ? 'jump' : name}.webp` : `/assets/cats/${id}-${name}.webp`);
const U = 0.07;                  // 그림 1px 이 집 그림 너비의 몇 %인지(cqw): 고양이 키가 사람의 40% 안팎
const SCALE = { yeoni: 1.15 };   // 반려동물별 크기 배율(귀요미는 15% 크게)
const PLAY_GAP_RATIO = 0.25;     // 장난칠 때 두 마리 사이 빈 공간 = 고양이 한 마리 폭의 이만큼(0.25 = 1/4)
const OWNER = { ruby: 0, yeoni: 1 }; // 주인: 다이아(ruby)=첫째 아이(유엘), 귀요미(yeoni)=둘째 아이(유하)
const OWNER_PULL = 0.55;         // 움직일 때 주인 곁으로 갈 확률
const HOME_CELL = ['10', '11'];  // 아이 순서별 자기 방 칸
const H_SPEED = 3.4;             // 가로 이동(집 너비 %/초): 느긋하게
const V_SPEED = 8;              // 기둥을 오르내리는 속도(%/초)
const MIN_X = 9, MAX_X = 91;     // 방 안쪽 범위
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const cats = [
  { id: 'ruby', x: 24, y: FLOOR_Y[1], face: 1, mode: 'idle', pose: 'sit', until: 0, path: [], seg: 0, key: '' },
  { id: 'crystal', x: 72, y: FLOOR_Y[2], face: -1, mode: 'idle', pose: 'sleep', until: 0, path: [], seg: 0, key: '' },
  { id: 'yeoni', x: 48, y: FLOOR_Y[0], face: 1, mode: 'idle', pose: 'sit', until: 0, path: [], seg: 0, key: '' },
];
window.__pets = cats; // 시험용: 화면 밖에서 상태를 확인·조정한다
let running = false;
let last = 0;

const floorIdx = (y) => FLOOR_Y.reduce((b, f, i) => (Math.abs(f - y) < Math.abs(FLOOR_Y[b] - y) ? i : b), 0);

function spriteHtml(c, name, anim) {
  const [w, h, n] = SHEET[`${c.id}-${name}`];
  const flip = c.face < 0 && !/walk[LR]$/.test(name) ? ' transform:scaleX(-1);' : '';
  const k = U * (SCALE[c.id] || 1);
  const style = `width:${(w * k).toFixed(2)}cqw;height:${(h * k).toFixed(2)}cqw;background-image:url(${fileOf(c.id, name)});background-size:${n * 100}% 100%;${flip}`;
  if (n === 1) return `<div class="pet-sp" style="${style}"></div>`;
  return `<div class="pet-sp anim" style="${style}animation-timing-function:steps(${n},jump-none);animation-duration:${anim === 'jump' ? '.9s' : '1.5s'};"></div>`;
}
// 그림은 한 번 만든 조각을 계속 두고 보이고 숨기기만 한다(방향을 바꿀 때 새 그림을 불러오느라 잠깐 사라지는 일이 없게)
const keyOf = (c, name) => (/walk[LR]$/.test(name) ? name : `${name}|${c.face}`);
function ensureSprite(c, body, name, anim) {
  const key = keyOf(c, name);
  let sp = [...body.children].find((x) => x.dataset.k === key);
  if (!sp) { body.insertAdjacentHTML('beforeend', spriteHtml(c, name, anim)); sp = body.lastElementChild; sp.dataset.k = key; sp.style.display = 'none'; }
  return sp;
}
function setLook(c, el, name, anim = 'walk') {
  const key = keyOf(c, name);
  if (c.key === key) return;
  c.key = key;
  const body = el.querySelector('.pet-body');
  const sp = ensureSprite(c, body, name, anim);
  for (const x of body.children) if (x !== sp) x.style.display = 'none';
  sp.style.display = '';
  if (body.firstElementChild !== sp) body.prepend(sp);
}
function warmUp(c, el) { // 걷는 두 방향 그림을 미리 만들어 둔다
  const body = el.querySelector('.pet-body');
  ensureSprite(c, body, 'walkR', 'walk'); ensureSprite(c, body, 'walkL', 'walk');
}

// ---- 주인 곁: 주인 아이가 지금 서 있는 칸(걷는 중이면 자기 방) 안쪽의 어느 자리 ----
function ownerSpot(c) {
  const idx = OWNER[c.id]; if (idx === undefined) return null;
  const kid = S.info?.kids?.[idx]; if (!kid) return null;
  const wc = walkerCell(kid.id); const cell = wc && !wc.moving ? wc.cell : HOME_CELL[idx];
  const row = Number(cell[0]); const col = Number(cell[1]);
  return { row, x: Math.min(MAX_X, Math.max(MIN_X, COL_X[col] + rnd(-9, 9))) };
}

// ---- 다음 행동 정하기 ----
function chooseNext(c, now) {
  const r = floorIdx(c.y);
  const roll = Math.random();
  if (reduce() || roll < 0.3) { // 쉰다
    c.mode = 'idle'; c.pose = pick(POSES[c.id].filter((p) => p !== c.pose)); c.until = now + rnd(6000, 15000); return;
  }
  let x1 = rnd(MIN_X, MAX_X);
  let r1 = r;
  if (roll > 0.72) r1 = pick([0, 1, 2].filter((i) => i !== r)); // 다른 층으로
  const spot = Math.random() < OWNER_PULL ? ownerSpot(c) : null; // 주인이 있는 방 쪽으로
  if (spot) { r1 = spot.row; x1 = spot.x; }
  const pts = [[c.x, FLOOR_Y[r]]];
  if (r1 !== r) {
    const px = PILLAR_X.reduce((b, p) => (Math.abs(c.x - p) + Math.abs(x1 - p) < Math.abs(c.x - b) + Math.abs(x1 - b) ? p : b), PILLAR_X[0]);
    pts.push([px, FLOOR_Y[r]], [px, FLOOR_Y[r1]]);
  }
  pts.push([x1, FLOOR_Y[r1]]);
  c.path = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  c.seg = 0; c.mode = 'walk';
}

// ---- 만나면 장난: 같은 층에서 가까워지면(약 1분에 한 번쯤) 마주 보고 몇 초 논다 ----
const PLAYS = ['sniff', 'tap', 'bow', 'roll', 'dash', 'sneak'];
const lastPlay = new Map(); // 'a|b' → 마지막 장난 시각
window.__lastPlay = lastPlay; // 시험용
function tryPlay(now) {
  for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) {
    const a = cats[i]; const b = cats[j];
    if (a.id === 'yeoni' || b.id === 'yeoni') continue; // 장난은 고양이 두 마리끼리만
    if (!document.querySelector(`[data-pet="${a.id}"]`) || !document.querySelector(`[data-pet="${b.id}"]`)) continue; // 숨긴 쪽이 있으면 놀지 않는다
    if (['play', 'aegyo', 'snack', 'garden'].some((m) => a.mode === m || b.mode === m)) continue;
    if (Math.abs(a.y - b.y) > 0.5 || Math.abs(a.x - b.x) > 16) continue;
    const key = `${a.id}|${b.id}`;
    if (now - (lastPlay.get(key) ?? -1e9) < 45000) continue;
    lastPlay.set(key, now);
    if (Math.random() > 0.6) continue;
    const left = a.x <= b.x ? a : b; const right = left === a ? b : a;
    const kind = pick(PLAYS); // 두 마리가 같은 동작으로 논다
    left.face = 1; right.face = -1;
    if (kind === 'dash') { const d = Math.random() < 0.5 ? 1 : -1; left.face = right.face = d; left.dash = right.dash = d; } // 달리기는 마주 보지 않고 한쪽 방향으로 함께 달린다
    // 너무 붙어서 겹치지 않게, 가운데를 기준으로 서로 고양이 한 마리 폭의 1/2(PLAY_GAP_RATIO)만큼 비워 선다(천천히 걸어서 벌어진다)
    // 두 마리 사이의 빈 공간 = 고양이 한 마리 폭의 1/2 (폭은 이번 장난 그림의 실제 폭). 가운데 사이 거리 = 폭 + 폭/2
    const wOf = (c) => SHEET[`${c.id}-play-${kind}`][0] * U;
    const avgW = (wOf(a) + wOf(b)) / 2; const dist = avgW * (1 + PLAY_GAP_RATIO);
    const mid = Math.min(Math.max((a.x + b.x) / 2, MIN_X + dist / 2), MAX_X - dist / 2);
    left.tx = mid - dist / 2; right.tx = mid + dist / 2;
    for (const c of [a, b]) { c.mode = 'play'; c.until = now + 6200; c.path = []; c.key = ''; c.playKind = kind; c.hop = 0; }
  }
}

function step(now) {
  tryPlay(now);
  const layer = document.querySelector('.pets');
  if (!layer) { running = false; return; }
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  for (const c of cats) {
    const el = layer.querySelector(`[data-pet="${c.id}"]`); if (!el) continue;
    if (c.mode === 'snack') {
      if (now > c.until) { c.mode = 'idle'; c.pose = 'sit'; c.until = now + rnd(2500, 5000); c.key = ''; el.classList.remove('hop'); }
      else if (now >= c.eatAt) { setLook(c, el, 'aegyo'); el.classList.add('hop'); }
    } else if (c.mode === 'garden') {
      gardenFollow(c, el, dt, now);
    } else if (c.mode === 'play') {
      if (now > c.until) { c.mode = 'idle'; c.pose = 'sit'; c.until = now + rnd(2000, 5000); c.key = ''; c.tx = null; el.classList.remove('hop'); }
      else if (c.playKind === 'dog') { setLook(c, el, Math.floor((now - (c.until - 6200)) / 1100) % 2 ? 'roll' : 'aegyo'); el.classList.add('hop'); }
      else setLook(c, el, `play-${c.playKind}`);
      if (c.playKind === 'dash' && c.tx != null) { // 같은 방향으로 달려 간다(벽에 닿으면 함께 돌아서 반대쪽으로)
        const o = cats.find((x) => x.mode === 'play' && x !== c && x.playKind === 'dash');
        c.tx += c.dash * H_SPEED * 1.5 * dt;
        if (c.tx > MAX_X || c.tx < MIN_X) { c.tx = Math.min(MAX_X, Math.max(MIN_X, c.tx)); c.dash = -c.dash; c.face = c.dash; if (o) { o.dash = c.dash; o.face = c.dash; } }
        if (Math.abs(c.tx - c.x) > 0.2) c.x += Math.sign(c.tx - c.x) * Math.min(Math.abs(c.tx - c.x), H_SPEED * 2.4 * dt);
      } else
      if (c.tx != null && Math.abs(c.tx - c.x) > 0.2) c.x += Math.sign(c.tx - c.x) * Math.min(Math.abs(c.tx - c.x), H_SPEED * dt); // 장난 자리로 벌어진다
    } else if (c.mode === 'aegyo') {
      if (now > c.until) { c.mode = 'idle'; c.until = now + rnd(2000, 5000); c.pose = 'sit'; }
      else { setLook(c, el, 'aegyo'); }
    } else if (c.mode === 'idle') {
      if (!c.until) c.until = now + rnd(2000, 6000);
      setLook(c, el, c.pose);
      if (now > c.until) chooseNext(c, now);
    }
    if (c.mode === 'walk') {
      const a = c.path[c.seg]; const b = c.path[c.seg + 1];
      if (!b) { c.mode = 'idle'; c.pose = 'sit'; c.until = now + rnd(3000, 8000); }
      else {
        const vertical = a[0] === b[0];
        const dx = b[0] - c.x; const dy = b[1] - c.y;
        const dist = Math.hypot(dx, vertical ? dy * 0.75 : dx);
        const sp = (vertical ? V_SPEED : H_SPEED) * dt;
        if (!vertical) c.face = dx >= 0 ? 1 : -1;
        if (dist <= sp) { c.x = b[0]; c.y = b[1]; c.seg += 1; }
        else if (vertical) { c.y += Math.sign(dy) * sp / 0.75; }
        else { c.x += Math.sign(dx) * sp; }
        setLook(c, el, vertical ? (dy < 0 ? 'up' : 'down') : (c.face > 0 ? 'walkR' : 'walkL'), vertical ? 'jump' : 'walk');
      }
    }
    el.style.left = `${c.x}%`; el.style.top = `${c.y}%`;
  }
  requestAnimationFrame(step);
}

// ---- 간식 주기: 쿠키가 아이 방에서 반려동물에게 날아가고, 받은 동물은 제자리에서 신나게 폴짝 ----
const seenAct = new Set();
const petOfKid = (kidId) => { const idx = (S.info?.kids || []).findIndex((k) => k.id === kidId); return cats.find((c) => OWNER[c.id] === idx) || null; };
function snack(c, kidId) {
  const layer = document.querySelector('.pets'); const el = layer?.querySelector(`[data-pet="${c.id}"]`);
  if (!el || c.mode === 'garden' || c.mode === 'snack') return;
  const now = performance.now();
  const from = walkerPos(kidId) || [c.x, c.y - 12];
  const cookie = document.createElement('img'); cookie.className = 'snack-cookie'; cookie.src = '/assets/emoji/cookie.webp'; cookie.alt = '';
  const hy = c.y - 4; // 동물 머리 위쪽
  cookie.style.cssText = `left:${from[0]}%;top:${from[1] - 7}%`;
  layer.appendChild(cookie);
  const FLY = 900;
  cookie.animate([
    { left: `${from[0]}%`, top: `${from[1] - 7}%`, transform: 'translate(-50%,-50%) scale(.8) rotate(0deg)' },
    { left: `${(from[0] + c.x) / 2}%`, top: `${Math.min(from[1] - 7, hy) - 10}%`, transform: 'translate(-50%,-50%) scale(1.1) rotate(180deg)', offset: .5 },
    { left: `${c.x}%`, top: `${hy}%`, transform: 'translate(-50%,-50%) scale(.9) rotate(360deg)' },
  ], { duration: FLY, easing: 'ease-in-out', fill: 'forwards' }).onfinish = () => cookie.remove();
  c.mode = 'snack'; c.key = ''; c.path = []; c.eatAt = now + FLY; c.until = now + FLY + 2600;
  setLook(c, el, 'sit');
  setTimeout(() => { const h = document.createElement('i'); h.className = 'pet-heart'; h.textContent = '💕'; el.appendChild(h); setTimeout(() => h.remove(), 1600); }, FLY);
}

// ---- 산책: 주인 아이와 함께 정원을 15초 돈다. 동물은 아이 뒤를 졸졸 따라간다 ----
const WALK_MS = 15000;
function startWalk(c, kidId) {
  const layer = document.querySelector('.pets'); const el = layer?.querySelector(`[data-pet="${c.id}"]`);
  if (c.mode === 'garden') return;
  const ok = gardenWalk(kidId, WALK_MS, () => endWalk(c));
  if (!ok) return;
  if (!el) return;
  c.mode = 'garden'; c.save = { x: c.x, y: c.y, face: c.face }; c.kid = kidId; c.key = ''; c.path = []; c.gstage = 'out'; c.trail = [];
  el.classList.remove('hop'); el.style.transition = 'opacity .28s ease'; el.style.opacity = '0';
  setTimeout(() => { c.x = GARDEN.door[0] - 6; c.y = GARDEN.door[1]; c.gstage = 'follow'; c.key = ''; el.style.opacity = '1'; }, 300);
}
const TRAIL_MS = 900; // 아이가 0.9초 전에 있던 자리로 따라간다(아이가 방향을 바꿔도 동물이 좌우로 흔들리지 않고, 아이가 지나간 길을 그대로 걷는다)
function gardenFollow(c, el, dt, now) {
  if (c.gstage !== 'follow') return;
  const pos = walkerPos(c.kid); if (!pos) return;
  const tr = (c.trail ||= []); tr.push([now, pos[0], pos[1]]);
  while (tr.length > 2 && tr[1][0] <= now - TRAIL_MS) tr.shift();
  const [, tx, ty] = tr[0]; // 약 0.9초 전 아이 자리
  const dx = tx - c.x; const dy = ty - c.y;
  const sp = 8 * dt; // 아이 걷는 속도(약 6.5%/초)보다 조금 빠르게 따라붙는다
  if (Math.abs(dx) > 0.3) c.x += Math.sign(dx) * Math.min(Math.abs(dx), sp);
  if (Math.abs(dy) > 0.2) c.y += Math.sign(dy) * Math.min(Math.abs(dy), sp);
  if (Math.abs(dx) > 1.5) c.face = dx >= 0 ? 1 : -1; // 어느 정도 멀어졌을 때만 방향을 바꾼다(작은 떨림에는 그대로)
  setLook(c, el, c.face > 0 ? 'walkR' : 'walkL', 'walk'); // 산책 중에는 앉지 않고 계속 걷는 모습
}
function endWalk(c) {
  const el = document.querySelector(`.pets [data-pet="${c.id}"]`);
  if (el) { el.style.opacity = '0'; }
  setTimeout(() => {
    if (c.save) { c.x = c.save.x; c.y = c.save.y; c.face = c.save.face; }
    c.mode = 'idle'; c.pose = 'sit'; c.until = performance.now() + rnd(2000, 5000); c.key = ''; c.gstage = null; c.save = null;
    const e = document.querySelector(`.pets [data-pet="${c.id}"]`); if (e) { e.style.left = `${c.x}%`; e.style.top = `${c.y}%`; e.style.opacity = '1'; }
  }, 300);
}
bus.on('pet', (ev) => {
  if (seenAct.has(ev.key)) return; seenAct.add(ev.key);
  if (!document.querySelector('.house .pets')) return;
  const c = petOfKid(ev.kidId); if (!c) { if (ev.kind === 'walk') gardenWalk(ev.kidId, WALK_MS); return; }
  if (ev.kind === 'snack') snack(c, ev.kidId); else startWalk(c, ev.kidId);
});
export const petName = (kidIdx) => ['다이아', '귀요미'][kidIdx] || '';

// ---- 누르면 애교 ----
function onTap(e) {
  const layer = document.querySelector('.pets'); if (!layer) return;
  if (document.querySelector('.walker.sel')) return; // 사람을 골라 이동시키는 중에는 방해하지 않는다
  if (document.querySelector('body.layout-edit')) return;
  const house = e.target instanceof Element ? e.target.closest('.house') : null; if (!house) return;
  for (const c of cats) {
    const el = layer.querySelector(`[data-pet="${c.id}"]`); if (!el) continue;
    const r = el.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      e.preventDefault(); e.stopPropagation();
      c.mode = 'aegyo'; c.until = performance.now() + 2400; c.key = '';
      const heart = document.createElement('i'); heart.className = 'pet-heart'; heart.textContent = '💕'; el.appendChild(heart); setTimeout(() => heart.remove(), 1600);
      return;
    }
  }
}
let tapBound = false;

// 집 그림 안에 고양이 층을 만들고(없으면) 돌아다니게 한다. enabled=false 면 치운다.
export function mountPets(houseEl, enabled = {}) {
  const house = houseEl?.querySelector?.('.house'); if (!house) return;
  house.querySelector('.pets')?.remove();
  const on = (c) => enabled[c.id] !== false;
  const shown = cats.filter(on);
  if (!shown.length) return;
  const layer = document.createElement('div');
  layer.className = 'pets'; layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = shown.map((c) => `<div class="pet" data-pet="${c.id}" style="left:${c.x}%;top:${c.y}%"><div class="pet-body"></div></div>`).join('');
  house.appendChild(layer);
  cats.forEach((c) => { c.key = ''; const e = layer.querySelector(`[data-pet="${c.id}"]`); if (e) warmUp(c, e); });
  if (!tapBound) { document.addEventListener('click', onTap, true); tapBound = true; }
  if (!running) { running = true; last = performance.now(); requestAnimationFrame(step); }
}
