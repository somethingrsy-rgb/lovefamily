import { $, $$, esc, won, shortDate, lsGet, lsSet, ago } from '../util.js';
import { S, get, post, del, isDevice, isAdultNow, kidById } from '../api.js';
import { avatar, toast, errToast, formSheet, playCoins, needAdult, coinsSeen, confirmDialog } from '../ui.js';
import { back, amountSheet } from '../common.js';

const REASONS = ['용돈', '도장 30개', '문제집 1권', '세뱃돈'];
const WD_REASONS = ['문구점', '슈퍼', '친구랑 간식'];
const kidOf = (id) => kidById(id) || { id: Number(id), name: '아이', avatar: '🙂', color: '#e8e0f5' };
export const adultPick = (name = 'toMemberId') => `<fieldset class="adult-pick-set"><legend>누구에게 보낼까요?</legend><div class="adult-pick">${S.info.adults.map((a, i) => `<label class="adult-opt radio"><input type="radio" name="${name}" value="${a.id}" ${i === 0 ? 'checked' : ''}>${avatar(a)}<span>${esc(a.name)}</span></label>`).join('')}</div></fieldset>`;
const STEP = { withdraw: ['기다리는 중', '줄게요', '꺼냈어요'], deposit: ['기다리는 중', '입금 확인'], purchase: ['기다리는 중', '사도 좋아요', '샀어요'] };
const stepIdx = { pending: 0, approved: 1, paid: 2, confirmed: 1, completed: 2 };

export async function mount(el, { id }) {
  const kid = kidOf(id);
  let month = S.info.today.slice(0, 7);
  const asKid = () => isDevice() && S.actKid === Number(id);
  let lastBal = null; // 이 화면에서 마지막으로 본 잔액
  async function load() {
    const [w, led, reqs] = await Promise.all([get(`/api/kids/${id}/wallet`), get(`/api/kids/${id}/ledger?month=${month}`), get(`/api/kids/${id}/requests`)]);
    draw(w, led, reqs);
    // 서버에서 확정된 변화만 애니메이션으로 보여 준다
    if (asKid()) {
      // 이 화면을 열어 둔 채로 잔액이 바뀐 경우에만(그것도 실시간 신호로 이미 보여 주지 않았을 때만). 예전에 저장해 둔 잔액과 비교하면
      // 화면을 열 때마다 지난 입금·출금 모션이 엉뚱하게 다시 나오므로, 저장값은 쓰지 않는다.
      if (lastBal != null && lastBal !== w.balance && !(Date.now() - (coinsSeen.get(Number(id)) || 0) < 15000)) playCoins(w.balance > lastBal ? 'in' : 'out', Math.abs(w.balance - lastBal));
      lastBal = w.balance;
    }
  }
  function draw(w, led, reqs) {
    const adult = !isDevice() || isAdultNow();
    const active = reqs.filter((r) => ['pending', 'approved'].includes(r.status));
    const recent = reqs.filter((r) => ['rejected', 'canceled'].includes(r.status)).slice(0, 2);
    el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} ${esc(kid.name)}의 돼지 저금통`)}
      <section class="piggy-hero card" style="--kc:${esc(kid.color)}"><img class="piggy-img" src="/assets/money/piggy.webp" alt="" draggable="false"><div><p class="muted">내 돈</p><div class="total" id="total">${won(w.balance)}</div></div></section>
      <section class="money-cards"><div class="mcard"><span>지금 쓸 수 있는 돈</span><b>${won(w.available)}</b></div>
        <a class="mcard link" href="#/kid/${id}/wishes"><span>목표에 모아둔 돈</span><b>${won(w.goalSaved)}</b></a>
        ${w.waiting ? `<div class="mcard wait"><span>지급 기다리는 돈</span><b>${won(w.waiting)}</b></div>` : ''}</section>
      <section class="row gap wrap actions">
        ${asKid() ? `<button class="btn primary big grow" id="dep">💰 돈 넣었어요</button><button class="btn big grow" id="wd">🏧 돈 꺼내기</button><button class="btn ghost big grow" id="cash">🧾 내가 쓴 현금</button>` : ''}
        ${adult ? `<button class="btn primary grow" id="adep">➕ 입금 등록</button><button class="btn ghost" id="open">시작 잔액</button><button class="btn ghost" id="adj">잔액 정정</button>` : (isDevice() ? '<button class="btn ghost small" id="adultMode">🔑 어른 관리</button>' : '')}
      </section>
      ${active.length || recent.length ? `<section class="card page-card"><h3>요청</h3><ul class="reqs">${[...active, ...recent].map((r) => `<li><div><b>${won(r.amount)}</b> ${r.type === 'deposit' ? '입금' : r.type === 'withdraw' ? '출금' : '구매'} · ${esc(r.purpose)} <small class="muted">(${esc(r.toName)}에게)</small></div>
        ${['rejected', 'canceled'].includes(r.status) ? `<div class="small ${r.status === 'rejected' ? 'bad' : 'muted'}">${esc(r.statusLabel)}${r.rejectReason ? `: ${esc(r.rejectReason)}` : ''}</div>`
          : `<ol class="steps mini">${STEP[r.type].map((s, i) => `<li class="${i <= stepIdx[r.status] ? 'on' : ''}">${s}</li>`).join('')}</ol>`}
        ${active.includes(r) && (asKid() || adult) && r.status !== 'paid' ? `<button class="btn ghost small" data-cancel="${r.id}">취소</button>` : ''}</li>`).join('')}</ul></section>` : ''}
      <section class="card page-card"><div class="month-nav"><button class="btn ghost" id="pm" aria-label="이전 달">‹</button><h3>${month.replace('-', '년 ')}월</h3><button class="btn ghost" id="nm" aria-label="다음 달">›</button></div>
        <div class="stats"><div><span>받은 돈</span><b class="in">${won(led.summary.received)}</b></div><div><span>쓴 돈</span><b class="out">${won(led.summary.spent)}</b></div><div><span>남은 돈</span><b>${won(led.summary.remaining)}</b></div></div>
        ${led.summary.cashSpentNote ? `<p class="small muted">🧾 이미 꺼낸 돈을 쓴 기록 ${won(led.summary.cashSpentNote)} (잔액·쓴 돈에는 다시 넣지 않아요)</p>` : ''}
        ${led.entries.length ? `<div class="table-wrap"><table class="ledger"><thead><tr><th>날짜</th><th>내용</th><th>들어온 돈</th><th>나간 돈</th><th>잔액</th><th>처리</th>${adult ? '<th></th>' : ''}</tr></thead><tbody>${led.entries.map((e) => `<tr class="${e.kind === 'cash_spent' ? 'note' : ''}"><td data-l="날짜">${shortDate(e.date)}</td><td data-l="내용"><b>${esc(e.kindLabel)}</b> <span class="muted">${esc(e.memo)}</span>${e.requestStatus ? ` <small class="tag">${esc(({ paid: '받았어요', confirmed: '확인', completed: '샀어요' })[e.requestStatus] || e.requestStatus)}</small>` : ''}</td>
          <td data-l="들어온 돈" class="in">${e.in ? '+' + won(e.in) : ''}</td><td data-l="나간 돈" class="out">${e.out ? '−' + won(e.out) : e.note ? `<span class="muted">(${won(e.note)} 메모)</span>` : ''}</td><td data-l="잔액">${e.balanceAfter == null ? '' : won(e.balanceAfter)}</td><td data-l="처리" class="muted small">${esc(e.actorName || '')}</td>${adult ? `<td>${e.deletable ? `<button class="btn ghost small" data-delled="${e.id}" aria-label="이 기록 지우기">🗑 지우기</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>${adult && led.entries.some((e) => e.deletable) ? '<div class="row end"><button class="btn ghost small danger-text" id="clearmonth">🗑 이 달 기록 모두 지우기</button></div>' : ''}` : '<p class="muted">이 달에는 기록이 없어요</p>'}</section>`;
    const [y, m] = month.split('-').map(Number);
    const shift = (d) => { const n = new Date(Date.UTC(y, m - 1 + d, 1)); month = `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}`; load().catch(errToast); };
    $('#pm', el).onclick = () => shift(-1); $('#nm', el).onclick = () => shift(1);
    $('#adultMode', el)?.addEventListener('click', async () => { if (await needAdult()) load(); });
    const wrap = (fn) => async () => { try { await fn(); await load(); } catch (e) { errToast(e); } };
    $('#dep', el)?.addEventListener('click', wrap(() => amountSheet({ title: '넣은 돈을 알려요', submit: '알리기', intro: '<p class="muted">어른이 실제로 돈을 받고 ‘입금 확인’을 누르면 저금통에 들어가요.</p>', extra: `<div class="field"><span>이유 <small class="muted">(버튼을 누르면 돼요)</small></span><div class="reason-chips">${REASONS.map((r) => `<button type="button" class="chip big" data-reason="${r}">${r}</button>`).join('')}</div><input name="purpose" maxlength="60" placeholder="다른 이유는 직접 쓰기" required></div>${adultPick()}`, onSubmit: async (v) => { await post(`/api/kids/${id}/requests`, { type: 'deposit', amount: v.amount, pieces: v.pieces, purpose: v.purpose, toMemberId: Number(v.toMemberId) }); toast('어른에게 알렸어요'); } })));
    $('#wd', el)?.addEventListener('click', wrap(() => amountSheet({ title: '돈 꺼내기', submit: '요청 보내기', max: w.available, intro: `<p class="muted">지금 쓸 수 있는 돈은 <b>${won(w.available)}</b>이에요.</p>`, extra: `<div class="field"><span>어디에 쓸 거예요? <small class="muted">(버튼을 누르면 돼요)</small></span><div class="reason-chips">${WD_REASONS.map((r) => `<button type="button" class="chip big" data-reason="${r}">${r}</button>`).join('')}</div><input name="purpose" maxlength="60" placeholder="다른 곳은 직접 쓰기" required></div>${adultPick()}`, onSubmit: async (v) => { await post(`/api/kids/${id}/requests`, { type: 'withdraw', amount: v.amount, pieces: v.pieces, purpose: v.purpose, toMemberId: Number(v.toMemberId) }); toast('어른에게 요청했어요'); } })));
    $('#cash', el)?.addEventListener('click', wrap(() => amountSheet({ title: '내가 쓴 현금', submit: '기록하기', intro: '<p class="muted">이미 꺼낸 돈을 어디에 썼는지 적어 둬요. 저금통 잔액은 다시 줄지 않아요.</p>', extra: '<label class="field">어디에 썼어요?<input name="memo" maxlength="60" required></label>', onSubmit: (v) => post(`/api/kids/${id}/cash-spent`, { amount: v.amount, memo: v.memo }) })));
    $('#adep', el)?.addEventListener('click', wrap(() => amountSheet({ title: '입금 등록', submit: '등록', intro: '<p class="muted">현금을 실제로 받은 뒤에 등록해 주세요.</p>', extra: '<label class="field">내용<input name="memo" maxlength="60" value="용돈"></label>', onSubmit: async (v) => { await post(`/api/kids/${id}/deposits`, { amount: v.amount, memo: v.memo }); toast('저금통에 넣었어요'); } })));
    $('#open', el)?.addEventListener('click', wrap(() => amountSheet({ title: '시작 잔액 등록', submit: '등록', intro: '<p class="muted">지금 맡아 둔 현금을 세어 한 번만 등록해요.</p>', onSubmit: (v) => post(`/api/kids/${id}/opening-balance`, { amount: v.amount }) })));
    $('#adj', el)?.addEventListener('click', wrap(() => formSheet({ title: '잔액 정정', submit: '정정하기', danger: true, html: `<p class="muted">실제 현금과 달라졌을 때만 써요. 늘리면 +, 줄이면 −로 입력하고 사유를 남겨요.</p><label class="field">정정 금액(원, 예: -500)<input name="amount" inputmode="text" required></label><label class="field">사유<input name="reason" maxlength="100" required></label>`, onSubmit: (v) => post(`/api/kids/${id}/adjust`, { amount: Number(v.amount), reason: v.reason }) })));
    $$('[data-delled]', el).forEach((b) => b.addEventListener('click', wrap(async () => {
      if (!(await confirmDialog('이 기록을 지울까요? 잔액도 그만큼 다시 계산돼요.', { yes: '지우기', no: '아니요', danger: true }))) return;
      await del(`/api/ledger/${b.dataset.delled}`); toast('기록을 지웠어요');
    })));
    $('#clearmonth', el)?.addEventListener('click', wrap(async () => {
      if (!(await confirmDialog(`${month.replace('-', '년 ')}월 기록을 모두 지울까요? 잔액이 다시 계산되고, 도장판 보상 기록은 남아요.`, { yes: '모두 지우기', no: '아니요', danger: true }))) return;
      const r = await post(`/api/kids/${id}/ledger/clear`, { month }); toast(`${r.removed}개 기록을 지웠어요`);
    }));
    $$('[data-cancel]', el).forEach((b) => b.addEventListener('click', wrap(() => post(`/api/money/requests/${b.dataset.cancel}/cancel`))));
  }
  await load();
  return { refresh: load, topics: ['wallet', 'requests'] };
}
void ago;

// 이유 버튼: 누르면 이유 칸이 채워지고 그 버튼이 선택 표시된다(칸을 직접 고치면 선택 표시는 풀린다)
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-reason]'); if (!b) return;
  const box = b.closest('.field'); const input = box?.querySelector('input[name=purpose]'); if (!input) return;
  input.value = b.dataset.reason;
  box.querySelectorAll('[data-reason]').forEach((x) => x.classList.toggle('on', x === b));
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
document.addEventListener('input', (e) => {
  if (e.target.name !== 'purpose') return;
  e.target.closest('.field')?.querySelectorAll('[data-reason]').forEach((x) => x.classList.toggle('on', x.dataset.reason === e.target.value));
});
