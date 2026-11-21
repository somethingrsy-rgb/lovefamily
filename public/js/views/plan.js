import { $, $$, esc, dateLabel, addDays } from '../util.js';
import { S, get, post, put, del, isDevice, isAdultNow, kidById } from '../api.js';
import { avatar, memberAvatar, toast, errToast, formSheet, photoPicker, confirmDialog } from '../ui.js';
import { back } from '../common.js';

const kidOf = (id) => kidById(id) || { id: Number(id), name: '아이', avatar: '🙂', color: '#e8e0f5' };
export const when = (p) => { const [y, m, d] = p.date.split('-').map(Number); return `${m}월 ${d}일${p.time ? ' ' + (Number(p.time.slice(0, 2)) < 12 ? '오전' : '오후') + ' ' + (Number(p.time.slice(0, 2)) % 12 || 12) + ':' + p.time.slice(3) : ''}`; };
export const kidLine = (k) => (k.status === 'none' ? '<span class="muted">아직 안 골랐어요</span>' : `${esc(k.icon)} <b>${esc(k.name)}</b> · ${k.status === 'planned' ? `📅 ${esc(when(k.plan))} 확정!` : '가족이 날짜를 정하고 있어요'}${k.both ? ' 💞 둘 다 골랐어요' : ''}`);

// 아이 화면: 후보 중 하나를 골라 [이거 하고 싶어요]
export async function kidPick(el, { id }) {
  const kid = kidOf(id);
  async function load() {
    const s = await get('/api/family-activities');
    const me = s.kids.find((k) => k.kidId === Number(id));
    el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} 이번 주 가족 활동`)}
      <p class="center big-q">이번 주에 가족이랑 뭐 하고 싶어요?</p>
      <section class="card page-card">${s.kids.map((k) => `<div class="pick-line">${memberAvatar(k.kidId, 'sm', { avatar: k.kidAvatar, color: k.kidColor })}<div>${esc(k.kidName)}이(가) 고른 활동: ${kidLine(k)}</div></div>`).join('')}</section>
      <div class="opt-grid">${s.options.map((o) => { const mine = me.optionId === o.id; const locked = !!o.plan && mine;
        return `<article class="opt-card card ${mine ? 'mine' : ''}">${o.photoUrl ? `<img src="${esc(o.photoUrl)}" alt="${esc(o.name)}" loading="lazy">` : `<div class="opt-ic">${esc(o.icon)}</div>`}<h3>${esc(o.icon)} ${esc(o.name)}</h3>
          <div class="chips">${o.pickedBy.map((p) => `<span class="tag">${esc(p.name)}</span>`).join('')}${o.pickedBy.length > 1 ? '<span class="tag due">둘 다 골랐어요</span>' : ''}${o.plan ? `<span class="tag">📅 ${esc(when(o.plan))}</span>` : ''}</div>
          ${mine ? `<button class="btn big wide" ${locked ? 'disabled' : ''} data-unpick="1">${locked ? '날짜가 정해졌어요' : '선택 취소'}</button>` : `<button class="btn primary big wide" data-pick="${o.id}">이거 하고 싶어요</button>`}</article>`; }).join('') || '<div class="empty card">아직 후보가 없어요. 어른에게 물어봐요!</div>'}</div>`;
    el.onclick = async (e) => {
      const p = e.target.closest('[data-pick]'); const u = e.target.closest('[data-unpick]');
      try {
        if (p) { await put(`/api/kids/${id}/family-pick`, { optionId: Number(p.dataset.pick) }); toast('골랐어요! 가족이 날짜를 정할 거예요'); load(); }
        if (u) { await put(`/api/kids/${id}/family-pick`, { optionId: null }); load(); }
      } catch (x) { errToast(x); }
    };
  }
  await load();
  return { refresh: load, topics: ['famact'] };
}

// 어른 화면: 후보 추가, 선택 현황 확인, 날짜·시간 확정/변경/취소
export async function adultPlan(el) {
  async function load() {
    const s = await get('/api/family-activities');
    const tomorrow = addDays(S.info.today, 1);
    el.innerHTML = `${back('/family', '🎈 이번 주 가족 활동', '<button class="btn small primary" id="addopt">+ 후보 추가</button>')}
      <section class="card page-card"><h3>아이들이 고른 활동</h3>${s.kids.map((k) => `<div class="pick-line">${memberAvatar(k.kidId, 'sm', { avatar: k.kidAvatar, color: k.kidColor })}<div><b>${esc(k.kidName)}</b> · ${kidLine(k)}</div></div>`).join('')}</section>
      ${s.options.map((o) => `<article class="card page-card opt-admin"><div class="row gap center-v">${o.photoUrl ? `<img class="wish-photo" src="${esc(o.photoUrl)}" alt="">` : `<span class="opt-ic sm">${esc(o.icon)}</span>`}<div class="grow"><h3>${esc(o.icon)} ${esc(o.name)}</h3><div class="chips">${o.pickedBy.map((p) => `<span class="tag">${esc(p.name)} 선택</span>`).join('') || '<span class="muted small">아직 아무도 안 골랐어요</span>'}${o.pickedBy.length > 1 ? '<span class="tag due">둘 다 골랐어요 · 한 번에 확정</span>' : ''}</div></div><button class="btn ghost small" data-rm="${o.id}" aria-label="후보 삭제">🗑</button></div>
        <form class="plan-form" data-opt="${o.id}" novalidate><label class="field">날짜<input name="date" type="date" value="${o.plan?.date || tomorrow}" required></label><label class="field">시간<input name="time" type="time" value="${o.plan?.time || ''}"></label>
          <div class="row gap"><button class="btn primary grow">${o.plan ? '일정 변경' : '날짜 확정'}</button>${o.plan ? `<button type="button" class="btn ghost" data-cancel="${planId(s, o)}">확정 취소</button>` : ''}</div>${o.plan ? `<p class="ok small">📅 ${esc(when(o.plan))} 확정 — 달력과 거실 보드에 표시돼요</p>` : ''}</form></article>`).join('') || '<div class="empty card">‘공원 가기’, ‘보드게임 하기’처럼 후보를 추가해 보세요</div>'}`;
    $('#addopt', el).onclick = addOption;
    $$('.plan-form', el).forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = $('button', f); btn.disabled = true;
      try { await post('/api/family-activities/plans', { optionId: Number(f.dataset.opt), date: f.date.value, time: f.time.value || null }); toast('일정을 저장했어요'); await load(); } catch (x) { errToast(x); btn.disabled = false; }
    }));
    el.onclick = async (e) => {
      const rm = e.target.closest('[data-rm]'); const c = e.target.closest('[data-cancel]');
      try {
        if (rm && await confirmDialog('이 후보를 지울까요? 이번 주 선택과 확정 일정도 함께 사라져요.', { danger: true })) { await del(`/api/family-activities/options/${rm.dataset.rm}`); load(); }
        if (c) { await del(`/api/family-activities/plans/${c.dataset.cancel}`); load(); }
      } catch (x) { errToast(x); }
    };
  }
  const planId = (s, o) => o.plan.id;
  function addOption() {
    const picker = photoPicker({ kind: 'post', label: '활동' });
    formSheet({ title: '가족 활동 후보', submit: '추가', cls: 'tall', html: `<label class="field">활동 이름<input name="name" maxlength="30" placeholder="공원 가기" required></label>
      <div class="field"><span>아이콘</span><div class="icon-pick">${['🌳', '🎲', '🍪', '🎬', '🚲', '🏖️', '🍕', '🎨', '🛝', '⚽', '🍦', '🏕️'].map((i, n) => `<label><input type="radio" name="icon" value="${i}" ${n === 0 ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div></div><div class="field"><span>사진 (선택)</span><div id="pp"></div></div>`,
      onSubmit: async (v) => { if (picker.state.busy) throw new Error('사진을 올리는 중이에요.'); await post('/api/family-activities/options', { name: v.name, icon: v.icon, photoId: picker.state.id }); load(); } });
    setTimeout(() => $('#pp')?.appendChild(picker), 0);
  }
  await load();
  return { refresh: load, topics: ['famact'] };
}
void isDevice; void isAdultNow; void dateLabel;
