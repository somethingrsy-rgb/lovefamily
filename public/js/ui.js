import { esc, $, $$ } from './util.js';
import { S, hooks, post, ApiError } from './api.js';

const layer = () => document.getElementById('layer');

export const avatar = (m, cls = '') => (m.avatarUrl
  ? `<span class="avatar photo ${cls}" style="--kc:${esc(m.color)}" aria-hidden="true"><img src="${esc(m.avatarUrl)}" alt=""></span>`
  : `<span class="avatar ${cls}" style="--kc:${esc(m.color)}" aria-hidden="true">${esc(m.avatar)}</span>`);

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
export function playStamp({ kidName, provider }) {
  overlay(`<div class="stamp-anim"><div class="stamp-paper"></div><div class="stamp-hand">🖐️</div><div class="stamp-mark">도장<br>꾹!</div></div>
    <div class="anim-text">${esc(provider ? `${provider}이(가) 도장을 줬어요!` : '도장을 받았어요!')}</div>${'<i class="confetti"></i>'.repeat(14)}`, 2600, 'stamp-overlay');
}
export function playCoins(dir, amount) {
  const bill = amount >= 50000 ? 'b50000' : amount >= 10000 ? 'b10000' : amount >= 1000 ? 'b1000' : null;
  const n = Math.min(8, Math.max(3, Math.round(amount / 1000) + 2));
  const coins = Array.from({ length: n }, (_, i) => {
    const src = bill && i % 3 === 0 ? bill : amount >= 500 || i % 2 ? 'c500' : 'c100';
    return `<img class="coin ${dir} c${i} ${src.startsWith('b') ? 'bill' : ''}" src="/assets/money/${src}.webp" alt="" draggable="false">`;
  }).join('');
  overlay(`<div class="piggy-anim"><img class="piggy piggy-pic" src="/assets/money/piggy.webp" alt="" draggable="false">${coins}</div><div class="anim-text">${dir === 'in' ? '저금통에 쏙!' : '저금통에서 쏙!'} ${amount.toLocaleString('ko-KR')}원</div>`, 2400, 'coin-overlay');
}
export function celebrate(text) { overlay(`<div class="party">🎉🐷🎉</div><div class="anim-text">${esc(text)}</div>${'<i class="confetti"></i>'.repeat(18)}`, 2800, 'stamp-overlay'); }
