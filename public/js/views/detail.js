import { $, $$, esc, won, shortDate, ago } from '../util.js';
import { S, get, post } from '../api.js';
import { avatar, memberAvatar, toast, errToast, formSheet, confirmDialog } from '../ui.js';
import { back, amountSheet } from '../common.js';

// 도장 확인: 알림을 누르면 해당 아이의 해당 날짜 체크 목록을 바로 연다
export async function approve(el, { id }) {
  async function load() {
    const r = await get(`/api/stamp-requests/${id}`);
    const done = r.status === 'approved';
    const closed = !['pending'].includes(r.status);
    const msg = done ? `<div class="banner ok">💮 ${esc(r.providerName || '어른')}이(가) 도장을 줬어요</div>`
      : r.status === 'recheck' ? `<div class="banner warn">🔎 ${esc(r.decidedBy || '어른')}이(가) 다시 확인을 요청했어요: ${esc(r.recheckReason || '')}</div>`
        : r.status === 'stale' ? '<div class="banner rest">체크가 바뀌어서 이 요청은 끝났어요. 아이가 다시 완료하면 새 요청이 와요.</div>'
          : r.status === 'voided' ? '<div class="banner rest">정정된 도장이에요.</div>' : '';
    el.innerHTML = `${back('/', '도장 확인')}
      <section class="card page-card approve" style="--kc:${esc(r.kidColor)}"><div class="row gap center-v">${memberAvatar(r.kidId, 'lg', { avatar: r.kidAvatar, color: r.kidColor })}<div><h2>${esc(r.kidName)}</h2><p class="muted">${shortDate(r.date)} 할일 · ${ago(r.createdAt)} 요청</p></div></div>
      ${msg}
      <ul class="checks readonly">${r.items.map((i) => `<li><div class="check-item ${i.done ? 'done' : ''} ${i.flag ? 'flag' : ''}"><span class="ci-icon">${esc(i.icon)}</span><span class="ci-name">${esc(i.name)}${i.flag ? `<small>🔎 ${esc(i.flag)}</small>` : ''}</span><span class="ci-box">${i.done ? '✔' : ''}</span></div></li>`).join('')}</ul>
      <div class="row gap wrap"><button class="btn primary big grow" id="ok" ${closed ? 'disabled' : ''}>${done ? '이미 도장을 줬어요' : '도장 주기'}</button><button class="btn ghost big grow" id="re" ${closed ? 'disabled' : ''}>다시 확인</button></div></section>`;
    $('#ok', el).onclick = async () => {
      try {
        const res = await post(`/api/stamp-requests/${id}/approve`);
        toast(res.result === 'approved' ? '도장을 줬어요 💮' : res.result === 'already' ? `${res.by.name}이(가) 이미 도장을 줬어요` : res.message || '처리할 수 없어요');
      } catch (e) { errToast(e); }
      load();
    };
    $('#re', el).onclick = () => formSheet({
      title: '다시 확인 요청', submit: '요청 보내기',
      html: `<p class="muted">다시 해 볼 항목과 이유를 남겨 주세요.</p><div class="checklist">${r.items.map((i) => `<label class="check"><input type="checkbox" name="i${i.id}" value="${i.id}"> <span>${esc(i.icon)} ${esc(i.name)}</span></label>`).join('')}</div><label class="field">이유<input name="reason" maxlength="100" placeholder="양치를 안 한 것 같아요" required></label>`,
      onSubmit: async (v, sh) => {
        const itemIds = $$('input[type=checkbox]:checked', sh.el).map((c) => Number(c.value));
        const res = await post(`/api/stamp-requests/${id}/recheck`, { itemIds, reason: v.reason });
        toast(res.result === 'already' ? `${res.by.name}이(가) 이미 도장을 줬어요` : '다시 확인을 요청했어요'); load();
      },
    });
  }
  await load();
  return { refresh: load, topics: ['approvals', 'day'] };
}

const STEPS = { withdraw: ['pending', 'approved', 'paid'], deposit: ['pending', 'confirmed'], purchase: ['pending', 'approved', 'completed'] };
// 입금 확인 / 출금 승인·지급 / 구매 승인·완료
export async function money(el, { id }) {
  async function load() {
    const r = await get(`/api/money/requests/${id}`);
    const w = await get(`/api/kids/${r.kidId}/wallet`).catch(() => null);
    const me = S.info.me?.id || S.elev?.memberId;
    const mine = r.toMemberId === me;
    const active = ['pending', 'approved'].includes(r.status);
    const label = { deposit: '입금 확인', withdraw: '출금 요청', purchase: '구매 요청' }[r.type];
    const btns = [];
    if (r.type === 'deposit' && r.status === 'pending') btns.push(['confirm', '입금 확인', 'primary'], ['reject', '거절', 'ghost']);
    if (r.type !== 'deposit' && r.status === 'pending') btns.push(['approve', '승인', 'primary'], ['reject', '거절', 'ghost']);
    if (r.type === 'withdraw' && r.status === 'approved') btns.push(['pay', '지급 완료', 'primary'], ['cancel', '취소', 'ghost']);
    if (r.type === 'purchase' && r.status === 'approved') btns.push(['complete', '구매 완료', 'primary'], ['cancel', '취소', 'ghost']);
    el.innerHTML = `${back('/', label)}<section class="card page-card money-detail"><h2>${esc(r.kidName)} · ${won(r.amount)}</h2><p>${esc(r.purpose)}</p>
      <ol class="steps">${STEPS[r.type].map((s, i, a) => { const cur = a.indexOf(r.status); return `<li class="${i <= cur ? 'on' : ''}">${({ pending: '기다리는 중', approved: '줄게요', paid: '받았어요', confirmed: '입금 확인', completed: '샀어요' })[s]}</li>`; }).join('')}</ol>
      ${['rejected', 'canceled'].includes(r.status) ? `<div class="banner rest">${r.status === 'rejected' ? `거절됐어요${r.rejectReason ? `: ${esc(r.rejectReason)}` : ''}` : '취소됐어요'}</div>` : ''}
      ${w ? `<p class="muted small">사용 가능 ${won(w.available)} · 목표에 모은 돈 ${won(w.goalSaved)} · 지급 기다리는 돈 ${won(w.waiting)}</p>` : ''}
      ${!mine && active ? `<p class="banner wait">${esc(r.toName)}에게 온 요청이에요. 처리는 ${esc(r.toName)}만 할 수 있어요.</p>` : ''}
      <div class="row gap wrap">${mine ? btns.map(([a, t, c]) => `<button class="btn ${c} big grow" data-a="${a}">${t}</button>`).join('') : ''}</div></section>`;
    el.onclick = async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      try {
        if (a === 'reject') { await formSheet({ title: '거절 사유', submit: '거절하기', danger: true, html: '<label class="field">아이에게 보여 줄 이유<input name="reason" maxlength="100" required></label>', onSubmit: (v) => post(`/api/money/requests/${id}/reject`, { reason: v.reason }) }); }
        else if (a === 'complete') {
          await amountSheet({ title: '실제로 결제한 금액', submit: '구매 완료', intro: `<p class="muted">요청 금액 ${won(r.amount)}. 실제 금액을 한 번만 차감해요.</p>`, onSubmit: (v) => post(`/api/money/requests/${id}/complete`, { actualAmount: v.amount }) });
        } else if (a === 'cancel') { if (!(await confirmDialog('요청을 취소하고 잡아둔 돈을 풀어 줄까요?', { danger: true }))) return; await post(`/api/money/requests/${id}/cancel`); }
        else if (a === 'pay') { if (!(await confirmDialog(`${won(r.amount)}을 현금으로 줬거나 대신 결제했나요?`, { yes: '지급 완료' }))) return; await post(`/api/money/requests/${id}/pay`); toast('지급 완료로 기록했어요'); }
        else if (a === 'confirm') { if (!(await confirmDialog(`${won(r.amount)}을 실제로 받았나요?`, { yes: '입금 확인' }))) return; await post(`/api/money/requests/${id}/confirm`); toast('저금통에 넣었어요'); }
        else { await post(`/api/money/requests/${id}/${a}`); toast('처리했어요'); }
      } catch (x) { errToast(x); }
      load();
    };
  }
  await load();
  return { refresh: load, topics: ['requests', 'wallet'] };
}
void ago;
