import { esc, $, $$ } from './util.js';
import { S, hooks, post, ApiError } from './api.js';
import { kidArtKey } from './layout.js';

const layer = () => document.getElementById('layer');

// 프로필 얼굴: 올린 사진 > 가족 캐릭터 얼굴(기본 이모지를 쓰는 경우) > 이모지
const DEFAULT_AVATARS = new Set(['🐰', '🐱', '👦', '👧', '👩', '👨', '👵', '👴', '🙂']);
const ROLE_FACE = { grandma: 'gma', grandpa: 'gpa', mom: 'mom', dad: 'dad' };
function cartoonFace(m) {
  if (!DEFAULT_AVATARS.has(m.avatar)) return null; // 직접 고른 이모지는 그대로 존중
  const info = S.info; if (!info) return null;
  const ki = m.id ? info.kids.findIndex((k) => k.id === Number(m.id)) : -1;
  if (ki >= 0) return `/assets/chars/face-${kidArtKey(m.id)}.webp`; // 성별에 맞는 기본 얼굴
  const role = m.role || info.adults.find((a) => a.id === Number(m.id))?.role;
  return ROLE_FACE[role] ? `/assets/chars/face-${ROLE_FACE[role]}.webp` : null;
}
// 가족 id 로 프로필을 그린다(올린 사진 > 가족 캐릭터 얼굴 > 이모지). 카드마다 이모지 글자만 따로 받는 곳에서 쓴다.
export const memberAvatar = (id, cls = '', fallback = { avatar: '🙂', color: '#e8e0f5' }) => {
  const m = S.info && [...S.info.kids, ...S.info.adults].find((x) => x.id === Number(id));
  return avatar(m || fallback, cls);
};
export const avatar = (m, cls = '') => {
  const url = m.avatarUrl || cartoonFace(m); // 올린 진짜 사진이 항상 우선
  return url
    ? `<span class="avatar photo ${m.avatarUrl ? '' : 'cartoon'} ${cls}" style="--kc:${esc(m.color)}" aria-hidden="true"><img src="${esc(url)}" alt=""></span>`
    : `<span class="avatar ${cls}" style="--kc:${esc(m.color)}" aria-hidden="true">${esc(m.avatar)}</span>`;
};

// ---- 토스트 / 팝업 ----
export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  layer().appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}
export function errToast(e) { toast(e instanceof ApiError || e?.net ? e.message : '문제가 생겼어요. 다시 해 주세요.', 'bad'); if (!(e instanceof ApiError) && !e?.net) console.error(e); }

export function toastAction(msg, label, fn) {
  const el = document.createElement('div');
  el.className = 'toast action'; el.setAttribute('role', 'status');
  el.innerHTML = `<span></span> <button class="btn small">${esc(label)}</button>`;
  el.firstChild.textContent = msg;
  el.querySelector('button').onclick = () => { el.remove(); fn(); };
  layer().appendChild(el);
  setTimeout(() => el.classList.add('out'), 5200); setTimeout(() => el.remove(), 5700);
}

// 실시간 메시지/요청 팝업
export function popup({ title, body, actionLabel = '열기', onAction, kind = '' }) {
  const el = document.createElement('div');
  el.className = `popup ${kind}`;
  el.setAttribute('role', 'alert');
  el.innerHTML = `<div class="popup-main"><b>${esc(title)}</b><span>${esc(body || '')}</span></div>
    <div class="popup-actions"><button class="btn small primary" data-a="open">${esc(actionLabel)}</button><button class="btn small ghost" data-a="x" aria-label="닫기">✕</button></div>`;
  layer().appendChild(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'open') { close(); onAction?.(); } else if (a === 'x') close();
  });
  setTimeout(close, 12000);
  return close;
}

// ---- 사진 크게 보기(전체 화면) ----
// 사진을 누르면 화면 가득 보여 주고, 한 번 더 누르면 확대해서 손가락으로 밀어 볼 수 있다. ✕ 또는 바깥을 누르거나 뒤로 가기로 닫는다.
export function openPhoto(url, alt = '사진') {
  document.querySelector('.photo-viewer')?.remove();
  const v = document.createElement('div');
  v.className = 'photo-viewer'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-modal', 'true'); v.setAttribute('aria-label', alt);
  v.innerHTML = `<button class="pv-close" aria-label="닫기"><img class="emo" src="/assets/emoji/close-x.webp" alt="" draggable="false"><span>닫기</span></button><div class="pv-scroll"><img src="${esc(url)}" alt="${esc(alt)}" draggable="false"></div><div class="pv-hint">사진을 한 번 더 누르면 확대돼요</div>`;
  document.body.appendChild(v); document.body.classList.add('noscroll');
  const close = () => { v.remove(); document.body.classList.remove('noscroll'); window.removeEventListener('keydown', key); window.removeEventListener('hashchange', close); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', key); window.addEventListener('hashchange', close);
  v.addEventListener('click', (e) => {
    if (e.target.closest('.pv-close')) return close();
    const img = e.target.closest('img');
    if (img) { v.classList.toggle('zoomed'); v.querySelector('.pv-hint')?.remove(); return; }
    close();
  });
  return close;
}

// ---- 시트(모달) ----
let sheetCount = 0;
export const sheetOpen = () => sheetCount > 0;
export function openSheet(html, { cls = '', onClose, dismissible = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  layer().appendChild(wrap);
  sheetCount++;
  document.body.classList.add('noscroll');
  const sheet = wrap.firstElementChild;
  let closed = false;
  const api = {
    el: sheet,
    close(v) {
      if (closed) return; closed = true;
      sheetCount--; if (!sheetCount) document.body.classList.remove('noscroll');
      wrap.remove(); onClose?.(v);
    },
  };
  wrap.addEventListener('click', (e) => { if (e.target === wrap && dismissible) api.close(); });
  sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) api.close(); });
  const first = $('input,textarea,select', sheet);
  if (first && !('ontouchstart' in window)) first.focus();
  return api;
}

export function confirmDialog(msg, { yes = '네', no = '아니요', danger = false } = {}) {
  return new Promise((resolve) => {
    let v = false;
    const sh = openSheet(`<p class="sheet-msg">${esc(msg)}</p><div class="row end gap"><button class="btn ghost" data-close>${esc(no)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(yes)}</button></div>`, { onClose: () => resolve(v) });
    $('[data-yes]', sh.el).onclick = () => { v = true; sh.close(); };
  });
}

// 입력 폼 시트: fields = html 문자열. onSubmit(values:FormData-object, sheet) 가 throw 하면 오류 표시 후 유지
export function formSheet({ title, html, submit = '확인', danger = false, onSubmit, cls = '' }) {
  return new Promise((resolve) => {
    let result;
    const sh = openSheet(`<form novalidate><h2>${esc(title)}</h2>${html}<p class="form-err" role="alert" hidden></p>
      <div class="row end gap sticky-actions"><button type="button" class="btn ghost" data-close>취소</button><button class="btn ${danger ? 'danger' : 'primary'}" type="submit">${esc(submit)}</button></div></form>`,
      { cls, onClose: () => resolve(result) });
    const form = $('form', sh.el);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', form);
      const errEl = $('.form-err', form);
      btn.disabled = true; errEl.hidden = true;
      try {
        const values = Object.fromEntries(new FormData(form).entries());
        result = (await onSubmit(values, sh)) ?? true;
        sh.close(result);
      } catch (err) {
        errEl.textContent = err?.message || '문제가 생겼어요.'; errEl.hidden = false; btn.disabled = false;
        if (!(err instanceof ApiError) && !err?.net) console.error(err);
      }
    });
    sh.form = form;
  });
}

// ---- 공용 기기 어른 재인증 / 아이 비밀번호 ----
hooks.reauth = (want) => new Promise((resolve) => {
  const adults = S.info.adults;
  let sel = want || S.elev?.memberId || adults[0]?.id;
  let ok = false;
  const sh = openSheet(`<form novalidate><h2>어른 확인</h2><p class="muted">승인·정정은 어른만 할 수 있어요. 누구인지 고르고 비밀번호를 눌러 주세요.</p>
    <div class="adult-pick" role="radiogroup">${adults.map((a) => `<button type="button" role="radio" class="adult-opt ${a.id === sel ? 'on' : ''}" data-id="${a.id}" aria-checked="${a.id === sel}">${avatar(a)}<span>${esc(a.name)}</span></button>`).join('')}</div>
    <label class="field">비밀번호<input name="pw" type="password" autocomplete="current-password" inputmode="text" required></label>
    <p class="form-err" role="alert" hidden></p>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary" type="submit">확인</button></div></form>`, { onClose: () => resolve(ok) });
  sh.el.addEventListener('click', (e) => {
    const b = e.target.closest('.adult-opt'); if (!b) return;
    sel = Number(b.dataset.id);
    $$('.adult-opt', sh.el).forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
  });
  $('form', sh.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('.form-err', sh.el); errEl.hidden = true;
    try {
      const r = await post('/api/auth/reauth', { memberId: sel, password: new FormData(e.target).get('pw') }, { noPrompt: true });
      S.elev = { token: r.token, memberId: r.memberId, name: r.name, exp: Date.now() + 9 * 60 * 1000 };
      ok = true; sh.close(true);
    } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
  });
});

hooks.unlock = (kidId) => new Promise((resolve) => {
  const kid = S.info.kids.find((k) => k.id === Number(kidId));
  if (!kid) return resolve(false);
  let pin = ''; let ok = false;
  const sh = openSheet(`<h2>${avatar(kid, 'sm')} ${esc(kid.name)}의 비밀번호</h2><div class="pin-dots" aria-live="polite">${'<i></i>'.repeat(4)}</div>
    <p class="form-err" role="alert" hidden></p>
    <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '←', 0, '확인'].map((n) => `<button type="button" class="btn big" data-k="${n}">${n}</button>`).join('')}</div>
    <div class="row end"><button class="btn ghost" data-close>취소</button></div>`, { onClose: () => resolve(ok) });
  const dots = () => $$('.pin-dots i', sh.el).forEach((d, i) => d.classList.toggle('on', i < pin.length));
  sh.el.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (k == null) return;
    const errEl = $('.form-err', sh.el);
    if (k === '←') pin = pin.slice(0, -1);
    else if (k === '확인') {
      try { await post(`/api/kids/${kid.id}/unlock`, { pin }, { noPrompt: true }); ok = true; sh.close(true); }
      catch (err) { errEl.textContent = err.message; errEl.hidden = false; pin = ''; }
    } else if (pin.length < 4) pin += k;
    dots();
    if (pin.length === 4 && k !== '확인') $('[data-k="확인"]', sh.el).focus();
  });
});

// 어른 권한이 필요한 화면/동작 앞에서: 이미 어른이면 바로, 공용 기기면 재인증
export async function needAdult() {
  if (S.info.session.kind === 'user') return true;
  if (S.elev && S.elev.exp > Date.now()) return true;
  return hooks.reauth();
}

// ---- 사진 선택(촬영/앨범) + 줄여서 업로드 ----
// 얼굴 사진: 투명하지 않은 부분(머리)의 영역을 찾아 정사각형 안에 같은 비율로 맞춘다 → 아이마다 얼굴 크기가 비슷해진다
function normalizeSquare(c, S = 640, fill = 0.94) {
  const w = c.width; const h = c.height;
  const d = c.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return c;
  const bw = x1 - x0 + 1; const bh = y1 - y0 + 1; // 머리 영역의 '면적'을 같게 맞춘다(갸름한 얼굴/넓은 얼굴이어도 비슷한 크기로 보이게). 정사각형을 넘지 않도록만 제한.
  const sc = Math.min((S * 0.75) / Math.sqrt(bw * bh), (S * fill) / bw, (S * fill) / bh);
  const o = document.createElement('canvas'); o.width = S; o.height = S;
  o.getContext('2d').drawImage(c, x0, y0, bw, bh, (S - bw * sc) / 2, (S - bh * sc) / 2, bw * sc, bh * sc);
  return o;
}
async function shrink(file, max = 1600, png = false) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    let c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    if (png) c = normalizeSquare(c);
    return await new Promise((ok) => (png ? c.toBlob((b) => ok(b), 'image/png') : c.toBlob((b) => ok(b), 'image/jpeg', 0.82)));
  } catch { return file; } finally { URL.revokeObjectURL(url); }
}
export function photoPicker({ kind, kidId, label = '사진', alpha = false }) {
  const wrap = document.createElement('div');
  wrap.className = 'photo-picker';
  wrap.innerHTML = `<div class="photo-preview" hidden><img alt="${esc(label)} 미리보기"><button type="button" class="btn small ghost" data-rm>지우기</button></div>
    <div class="row gap wrap"><label class="btn ghost photo-btn">📷 사진 찍기<input type="file" accept="image/*" capture="environment" hidden></label>
    <label class="btn ghost photo-btn">🖼️ 앨범에서 고르기<input type="file" accept="image/*" hidden></label></div><p class="muted small photo-status" hidden></p>`;
  const state = { id: null, busy: false };
  const status = $('.photo-status', wrap); const prev = $('.photo-preview', wrap);
  const onFile = async (file) => {
    if (!file) return;
    state.busy = true; status.hidden = false; status.textContent = '사진을 올리는 중…';
    try {
      const blob = await shrink(file, alpha ? 640 : 1600, alpha);
      const r = await post('/api/photos', blob, { headers: { 'X-Photo-Kind': kind, ...(kidId ? { 'X-Kid-Id': String(kidId) } : {}), 'Content-Type': 'application/octet-stream' } });
      state.id = r.id; $('img', prev).src = r.url; prev.hidden = false; status.hidden = true;
    } catch (e) { status.textContent = e.message || '사진을 올리지 못했어요.'; }
    state.busy = false;
  };
  $$('input[type=file]', wrap).forEach((i) => i.addEventListener('change', () => { onFile(i.files[0]); i.value = ''; }));
  $('[data-rm]', wrap).onclick = () => { state.id = null; prev.hidden = true; };
  wrap.state = state;
  return wrap;
}

// ---- 애니메이션 ----
function overlay(html, ms, cls = '') {
  const el = document.createElement('div');
  el.className = `anim-overlay ${cls}`;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = html;
  layer().appendChild(el);
  setTimeout(() => el.classList.add('out'), ms - 300);
  setTimeout(() => el.remove(), ms);
}
// 도장 그림은 미리 읽어 둔다: 처음 찍을 때 그림을 받느라 끊기지 않게
['/assets/stamp-tool.webp', '/assets/emoji/stamp-mark.webp'].forEach((u) => { const i = new Image(); i.decoding = 'sync'; i.src = u; i.decode?.().catch(() => {}); });
const stampSeen = new Set();
export function playStamp({ kidName, provider, key }) {
  if (key != null) { if (stampSeen.has(key)) return; stampSeen.add(key); }
  // 도장이 위에서 쑥 내려와 "쾅" 찍히고(화면이 살짝 흔들림), 도장이 올라가면 자국이 남는다
  overlay(`<div class="stamp-scene"><div class="stamp-paper"></div><div class="stamp-shadow"></div>
      <div class="stamp-ring"></div>
      <div class="stamp-mark"><img src="/assets/emoji/stamp-mark.webp" alt=""></div>
      <img class="stamp-tool" src="/assets/stamp-tool.webp" alt="" draggable="false">
      <div class="stamp-flash"></div><div class="stamp-bang">쾅!</div></div>
    <div class="anim-text">${esc(provider ? `${provider}${/[가-힣]$/.test(provider) && (provider.charCodeAt(provider.length - 1) - 0xac00) % 28 ? '이' : '가'} 도장을 줬어요!` : '도장을 받았어요!')}</div>${'<i class="confetti"></i>'.repeat(14)}`, 3200, 'stamp-overlay');
}
export const coinsSeen = new Map(); // 아이 id → 마지막으로 '쏙' 모션을 보여 준 시각(같은 입금을 두 번 보여 주지 않기 위함)
// 금액을 지폐·동전으로 나눈다(큰 것부터): 3,700원 → 천원 3장 + 오백원 1개 + 백원 2개. 정확히 그 금액만큼만 보여 준다.
export function splitMoney(amount) {
  const out = []; let left = Math.max(0, Math.round(amount / 100) * 100);
  for (const [v, key] of [[50000, 'b50000'], [10000, 'b10000'], [5000, 'b5000'], [1000, 'b1000'], [500, 'c500'], [100, 'c100']]) {
    while (left >= v) { out.push(key); left -= v; }
  }
  return out;
}
const PIECE_KEY = { 100: 'c100', 500: 'c500', 1000: 'b1000', 5000: 'b5000', 10000: 'b10000', 50000: 'b50000' };
export function playCoins(dir, amount, { hideAmount = false, pieces = null } = {}) {
  // 아이가 누른 그대로(예: 500원 2번 → 500원 동전 2개). 누른 기록이 없으면(어른이 넣은 돈 등) 금액을 지폐·동전으로 나눠서 보여 준다.
  const keys = (Array.isArray(pieces) && pieces.length ? pieces.map((x) => PIECE_KEY[x]).filter(Boolean) : splitMoney(amount)).slice(0, 12);
  const n = Math.max(1, keys.length);
  const coins = (keys.length ? keys : ['c100']).map((src, i) => `<img class="coin ${dir} c${i} ${src.startsWith('b') ? 'bill' : ''}" style="margin-left:${((i % 6) - 2.5) * 34 + (i >= 6 ? 14 : 0)}px;animation-delay:${(i * 0.15).toFixed(2)}s" src="/assets/money/${src}.webp" alt="" draggable="false">`).join('');
  // 저금하면(in): 동전이 다 들어간 뒤 돼지가 좋아서 폴짝폴짝 뛰고 하트가 올라온다
  const hop = 0.15 * (n - 1) + 0.95; // 마지막 동전이 들어가는 시각(초)
  const hearts = dir === 'in' ? '<i class="piggy-heart h0">💕</i><i class="piggy-heart h1">💕</i><i class="piggy-heart h2">💕</i>' : '';
  overlay(`<div class="piggy-anim ${dir}" style="--hop:${hop.toFixed(2)}s"><img class="piggy piggy-pic" src="/assets/money/piggy.webp" alt="" draggable="false">${coins}${hearts}</div><div class="anim-text">${dir === 'in' ? '저금통에 쏙!' : '저금통에서 쏙!'} ${hideAmount ? '' : `${amount.toLocaleString('ko-KR')}원`}</div>`, dir === 'in' ? Math.round((hop + 1.7) * 1000) : Math.round((0.15 * (n - 1) + 1.1) * 1000) + 1000, 'coin-overlay');
}
export function celebrate(text) { overlay(`<div class="party">🎉🐷🎉</div><div class="anim-text">${esc(text)}</div>${'<i class="confetti"></i>'.repeat(18)}`, 2800, 'stamp-overlay'); }
