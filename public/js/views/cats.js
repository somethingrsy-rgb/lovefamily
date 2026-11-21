// 집 그림 안을 돌아다니는 반려동물: 고양이 두 마리(루비·크리스탈)와 강아지 연이.
// 층 바닥선을 걷다가 앉고·자고·털을 핥고, 기둥 통로에서는 폴짝 뛰어 다른 층으로 오간다. 누르면 애교를 부린다.
// 사람 캐릭터처럼 정해진 위치를 서버와 맞추지는 않는다(기기마다 자기 마음대로 돌아다닌다).
import { FLOOR_Y, PILLAR_X } from './walkers.js';

// 그림 시트(가로로 이어 붙인 프레임): { 너비, 높이, 프레임 수 } — public/assets/cats/*.webp
const SHEET = {
  'ruby-walkR': [167, 131, 12], 'ruby-walkL': [162, 132, 12], 'ruby-up': [175, 157, 12], 'ruby-down': [165, 176, 12],
  'ruby-sit': [122, 152, 1], 'ruby-sleep': [155, 104, 1], 'ruby-groom': [131, 147, 1], 'ruby-aegyo': [164, 120, 1],
  'crystal-walkR': [159, 130, 12], 'crystal-walkL': [161, 130, 12], 'crystal-up': [174, 153, 12], 'crystal-down': [173, 131, 9],
  'crystal-sit': [124, 149, 1], 'crystal-sleep': [159, 109, 1], 'crystal-groom': [139, 150, 1], 'crystal-aegyo': [169, 127, 1], 'crystal-stand': [158, 130, 1],
  // 강아지 연이 (public/assets/dog/dog-*.webp). 오르내리기는 뛰는 그림 하나를 같이 쓴다
  'yeoni-walkR': [140, 121, 12], 'yeoni-walkL': [140, 121, 12], 'yeoni-up': [137, 121, 12], 'yeoni-down': [137, 121, 12],
  'yeoni-sit': [102, 135, 1], 'yeoni-sleep': [125, 97, 1], 'yeoni-groom': [107, 132, 1], 'yeoni-aegyo': [114, 127, 1], 'yeoni-stand': [124, 131, 1], 'yeoni-roll': [145, 114, 1],
};
const POSES = { ruby: ['sit', 'sleep', 'groom'], crystal: ['sit', 'sleep', 'groom', 'stand'], yeoni: ['sit', 'sleep', 'groom', 'stand', 'roll'] };
// 그림 파일 경로: 고양이는 cats/, 강아지(연이)는 dog/dog-이름.webp, 오르내리기는 dog-jump 하나
const fileOf = (id, name) => (id === 'yeoni' ? `/assets/dog/dog-${name === 'up' || name === 'down' ? 'jump' : name}.webp` : `/assets/cats/${id}-${name}.webp`);
const U = 0.07;                  // 그림 1px 이 집 그림 너비의 몇 %인지(cqw): 고양이 키가 사람의 40% 안팎
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
let running = false;
let last = 0;

const floorIdx = (y) => FLOOR_Y.reduce((b, f, i) => (Math.abs(f - y) < Math.abs(FLOOR_Y[b] - y) ? i : b), 0);

function spriteHtml(c, name, anim) {
  const [w, h, n] = SHEET[`${c.id}-${name}`];
  const flip = c.face < 0 && !/walk[LR]$/.test(name) ? ' transform:scaleX(-1);' : '';
  const style = `width:${(w * U).toFixed(2)}cqw;height:${(h * U).toFixed(2)}cqw;background-image:url(${fileOf(c.id, name)});background-size:${n * 100}% 100%;${flip}`;
  if (n === 1) return `<div class="pet-sp" style="${style}"></div>`;
  return `<div class="pet-sp anim" style="${style}animation-timing-function:steps(${n},jump-none);animation-duration:${anim === 'jump' ? '.9s' : '1.5s'};"></div>`;
}
function setLook(c, el, name, anim = 'walk') {
  const key = `${name}|${c.face}`;
  if (c.key === key) return;
  c.key = key;
  el.querySelector('.pet-body').innerHTML = spriteHtml(c, name, anim);
}

// ---- 다음 행동 정하기 ----
function chooseNext(c, now) {
  const r = floorIdx(c.y);
  const roll = Math.random();
  if (reduce() || roll < 0.3) { // 쉰다
    c.mode = 'idle'; c.pose = pick(POSES[c.id].filter((p) => p !== c.pose)); c.until = now + rnd(6000, 15000); return;
  }
  const x1 = rnd(MIN_X, MAX_X);
  let r1 = r;
  if (roll > 0.72) r1 = pick([0, 1, 2].filter((i) => i !== r)); // 다른 층으로
  const pts = [[c.x, FLOOR_Y[r]]];
  if (r1 !== r) {
    const px = PILLAR_X.reduce((b, p) => (Math.abs(c.x - p) + Math.abs(x1 - p) < Math.abs(c.x - b) + Math.abs(x1 - b) ? p : b), PILLAR_X[0]);
    pts.push([px, FLOOR_Y[r]], [px, FLOOR_Y[r1]]);
  }
  pts.push([x1, FLOOR_Y[r1]]);
  c.path = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  c.seg = 0; c.mode = 'walk';
}

function step(now) {
  const layer = document.querySelector('.pets');
  if (!layer) { running = false; return; }
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  for (const c of cats) {
    const el = layer.querySelector(`[data-pet="${c.id}"]`); if (!el) continue;
    if (c.mode === 'aegyo') {
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
export function mountPets(houseEl, enabled = true) {
  const house = houseEl?.querySelector?.('.house'); if (!house) return;
  house.querySelector('.pets')?.remove();
  if (!enabled) return;
  const layer = document.createElement('div');
  layer.className = 'pets'; layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = cats.map((c) => `<div class="pet" data-pet="${c.id}" style="left:${c.x}%;top:${c.y}%"><div class="pet-body"></div></div>`).join('');
  house.appendChild(layer);
  cats.forEach((c) => { c.key = ''; });
  if (!tapBound) { document.addEventListener('click', onTap, true); tapBound = true; }
  if (!running) { running = true; last = performance.now(); requestAnimationFrame(step); }
}
