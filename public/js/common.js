import { $, $$, esc, won, timeLabel, ago, lsGet, lsSet } from './util.js';
import { S, put, isDevice, kidById, hooks } from './api.js';
import { avatar, formSheet, toast, errToast } from './ui.js';

export const back = (href, title, right = '') => `<header class="page-head"><a class="back" href="#${href}" aria-label="뒤로"><img src="/assets/back-arrow2.webp" alt="" draggable="false"></a><h1>${title}</h1><div class="head-right">${right}</div></header>`;
// 하단 탭에서 바로 여는 아이별 화면(급식·시간표): 위쪽 이름표로 아이를 고르고, 마지막으로 본 아이를 기억한다
export const topKidId = (p) => { const kids = S.info.kids; const want = Number(p.id || lsGet('tabkid', 0)); return (kids.find((k) => k.id === want) || kids[0])?.id; };
export const kidTabsHtml = (id) => `<div class="kid-tabs" role="tablist">${S.info.kids.map((k) => `<button role="tab" class="kid-tab ${k.id === id ? 'on' : ''}" aria-selected="${k.id === id}" data-kid="${k.id}" style="--kc:${esc(k.color)}">${avatar(k, 'sm')} ${esc(k.name)}</button>`).join('')}</div>`;
export const kidTabsBind = (el, onPick) => el.querySelectorAll('.kid-tab').forEach((t) => t.addEventListener('click', () => { lsSet('tabkid', Number(t.dataset.kid)); onPick(Number(t.dataset.kid)); }));
export const kidTitle = (kid, text) => `${avatar(kid, 'sm')} ${esc(kid.name)}의 ${text}`;

// ---- 금액 입력 (500원·1,000원·5,000원 그림 버튼 + 직접 입력, 정확한 금액을 글자로도 표시) ----
export const amountHtml = (name = 'amount', { max } = {}) => `<div class="amount-field" data-max="${max ?? ''}">
  <div class="money-btns" role="group" aria-label="금액 더하기">
    <button type="button" class="money-btn" data-add="100"><img class="mimg mcoin" src="/assets/money/c100.webp" alt="" draggable="false"><b>100원</b></button>
    <button type="button" class="money-btn" data-add="500"><img class="mimg mcoin" src="/assets/money/c500.webp" alt="" draggable="false"><b>500원</b></button>
    <button type="button" class="money-btn" data-add="1000"><img class="mimg mbill" src="/assets/money/b1000.webp" alt="" draggable="false"><b>1,000원</b></button>
    <button type="button" class="money-btn" data-add="5000"><img class="mimg mbill" src="/assets/money/b5000.webp" alt="" draggable="false"><b>5,000원</b></button>
    <button type="button" class="money-btn" data-add="10000"><img class="mimg mbill" src="/assets/money/b10000.webp" alt="" draggable="false"><b>10,000원</b></button>
    <button type="button" class="money-btn" data-add="50000"><img class="mimg mbill" src="/assets/money/b50000.webp" alt="" draggable="false"><b>50,000원</b></button>
  </div>
  <label class="field">금액(원) 직접 입력<input name="${name}" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="0"></label>
  <p class="amount-text" aria-live="polite">정확한 금액: <b>0원</b> <button type="button" class="btn small ghost" data-clear>지우기</button></p></div>`;
export function bindAmount(root) {
  const f = $('.amount-field', root); if (!f) return;
  const input = $('input', f); const txt = $('.amount-text b', f);
  f._pieces = []; // 아이가 누른 지폐·동전(누른 순서대로). 금액을 직접 고치면 비운다
  const badges = () => $$('.money-btn', f).forEach((b) => { const n = f._pieces.filter((x) => x === Number(b.dataset.add)).length; let bd = b.querySelector('.mcount'); if (!n) { bd?.remove(); return; } if (!bd) { bd = document.createElement('i'); bd.className = 'mcount'; b.appendChild(bd); } bd.textContent = `×${n}`; });
  const upd = () => { input.value = input.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, ''); txt.textContent = won(Number(input.value || 0)); badges(); };
  input.addEventListener('input', () => { f._pieces = []; upd(); });
  f.addEventListener('click', (e) => {
    const a = e.target.closest('[data-add]');
    if (a) { const sum = f._pieces.reduce((x, y) => x + y, 0); if (sum !== Number(input.value || 0)) f._pieces = []; f._pieces.push(Number(a.dataset.add)); input.value = String(Number(input.value || 0) + Number(a.dataset.add)); upd(); }
    if (e.target.closest('[data-clear]')) { input.value = ''; f._pieces = []; upd(); }
  });
}
export const amountSheet = ({ title, submit, extra = '', max, onSubmit, intro = '' }) => {
  const p = formSheet({ title, submit, html: `${intro}${amountHtml('amount', { max })}${extra}`, onSubmit: (v, sh) => { const a = Number(v.amount); if (!a || a < 1) throw new Error('금액을 입력해 주세요.'); const pc = document.querySelector('.sheet .amount-field')?._pieces || []; return onSubmit({ ...v, amount: a, pieces: pc.reduce((x, y) => x + y, 0) === a ? pc : undefined }, sh); } });
  setTimeout(() => { const s = document.querySelector('.sheet'); if (s) bindAmount(s); }, 0);
  return p;
};

// ---- 공용 기기에서 특정 어른으로 확인 ----
export async function elevateFor(adultId) {
  if (!isDevice()) return S.info.me?.id === adultId;
  if (S.elev && S.elev.exp > Date.now() && S.elev.memberId === adultId) return true;
  await hooks.reauth(adultId);
  return !!(S.elev && S.elev.exp > Date.now() && S.elev.memberId === adultId);
}

// ---- 상태 변경(일하는 중 / 집에 가는 중 / 데리러 가는 중 / 집에 있어요 + 도착 예정) ----
export const STATUS = [['working', '일하는 중', '💼'], ['heading_home', '집에 가는 중', '🚌'], ['picking_up', '데리러 가는 중', '🚗'], ['home', '집에 있어요', '🏠']];
export function statusLine(st, now = Date.now()) {
  if (!st) return '<span class="muted">상태 없음</span>';
  const eta = st.etaAt && st.etaAt > now ? ` · ${timeLabel(st.etaAt)} 도착` : '';
  return `<b>${esc(st.label)}</b>${eta} <span class="muted small">· ${ago(st.updatedAt, now)}</span>`;
}
export async function changeStatus(adultId, state) {
  try {
    if (!(await elevateFor(adultId))) return false;
    let body = { state };
    if (state === 'heading_home' || state === 'picking_up') {
      const choice = await etaSheet();
      if (choice === undefined) return false;
      body = { state, ...choice };
    }
    await put('/api/status', body);
    return true;
  } catch (e) { errToast(e); return false; }
}
function etaSheet() {
  return new Promise((resolve) => {
    let out;
    formSheet({
      title: '도착 예정 시간 (선택)',
      html: `<div class="chips"><button type="button" class="chip" data-m="30">30분 뒤</button><button type="button" class="chip" data-m="60">1시간 뒤</button><button type="button" class="chip" data-m="">정하지 않을래요</button></div>
        <label class="field">직접 입력 (시:분)<input name="etaTime" type="time"></label><input type="hidden" name="etaMinutes">`,
      submit: '저장',
      onSubmit: (v) => { out = v.etaMinutes ? { etaMinutes: Number(v.etaMinutes) } : v.etaTime ? { etaTime: v.etaTime } : {}; },
    }).then(() => resolve(out));
    setTimeout(() => {
      const s = document.querySelector('.sheet'); if (!s) return;
      s.addEventListener('click', (e) => {
        const c = e.target.closest('.chip'); if (!c) return;
        $$('.chip', s).forEach((x) => x.classList.toggle('on', x === c));
        $('input[name=etaMinutes]', s).value = c.dataset.m; $('input[name=etaTime]', s).value = '';
        if (c.dataset.m === '') $('input[name=etaMinutes]', s).value = '';
      });
    }, 0);
  });
}
export const statusButtons = (adultId, cur) => `<div class="status-btns" role="group" aria-label="상태 바꾸기">${STATUS.map(([k, t, ic]) => `<button class="status-btn ${cur === k ? 'on' : ''}" data-status="${k}" data-adult="${adultId}" aria-pressed="${cur === k}"><span>${ic}</span>${t}</button>`).join('')}</div>`;
export function bindStatus(root, after) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-status]'); if (!b) return;
    if (await changeStatus(Number(b.dataset.adult), b.dataset.status)) { toast('상태를 바꿨어요'); after?.(); }
  });
}
export { kidById };
