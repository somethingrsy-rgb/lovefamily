import { $, $$, esc, DOW, SLOT, DAYSETS, daysText } from '../util.js';
import { S, get, post, patch, del, put } from '../api.js';
import { avatar, toast, errToast, formSheet, confirmDialog } from '../ui.js';

const QUICK = [['성경말씀읽기', '✝️', 'morning'], ['양치하기', '🪥', 'morning'], ['책가방 싸기', '🎒', 'morning'], ['숙제하기', '📚', 'after_school'], ['씻기', '🛁', 'evening'], ['내일 옷 꺼내 두기', '👕', 'evening'], ['장난감 정리', '🧸', 'evening'], ['잠옷 입기', '👚', 'evening'], ['물 마시기', '💧', 'after_school']];
const ICONS = ['✝️', '🪥', '🎒', '📚', '🛁', '👕', '🧸', '👚', '💧', '🍽️', '🧹', '🎹', '🛏️', '🐶', '📖', '✏️', '🧦', '🥛', '🚿', '⚽', '✅'];

const routineForm = (r = {}, { showBoth, kids, acts = [] } = {}) => `
  <label class="field">할일 이름<input name="name" maxlength="30" value="${esc(r.name || '')}" required></label>
  <div class="field"><span>아이콘</span><div class="icon-pick">${ICONS.map((i) => `<label><input type="radio" name="icon" value="${i}" ${(r.icon || '✅') === i ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div></div>
  <div class="field"><span>반복</span><div class="chips" id="dayset">${[['daily', '매일'], ['weekdays', '평일'], ['weekend', '주말'], ['custom', '요일 선택']].map(([k, t]) => `<button type="button" class="chip" data-set="${k}">${t}</button>`).join('')}</div>
    <div class="dow-pick">${DOW.map((d, i) => `<label class="dow"><input type="checkbox" name="d${i}" ${((r.days || [0, 1, 2, 3, 4, 5, 6]).includes(i)) ? 'checked' : ''}><span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</span></label>`).join('')}</div></div>
  <div class="field"><span>시간대</span><div class="seg">${Object.entries(SLOT).map(([k, t]) => `<label class="seg-opt"><input type="radio" name="slot" value="${k}" ${(r.slot || 'morning') === k ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
  <label class="field">활동 연결 <small class="muted">(식사하기처럼 시간이 정해진 할일 옆에 [활동 시작] 버튼이 생겨요)</small><select name="activityId"><option value="">연결 안 함</option>${acts.map((a) => `<option value="${a.id}" ${r.activityId === a.id ? 'selected' : ''}>${esc(a.icon)} ${esc(a.name)} (${a.minutes}분)</option>`).join('')}</select></label>
  ${showBoth ? `<label class="check"><input type="checkbox" name="both" checked> <span>${kids.map((k) => esc(k.name)).join('·')} 모두에게 추가 <small class="muted">(추가한 뒤 각자 따로 고칠 수 있어요)</small></span></label>` : ''}`;
function bindDays(root) {
  const set = (arr) => $$('.dow input', root).forEach((c, i) => { c.checked = arr.includes(i); });
  $('#dayset', root).addEventListener('click', (e) => { const b = e.target.closest('[data-set]'); if (!b) return; $$('#dayset .chip', root).forEach((x) => x.classList.toggle('on', x === b)); if (DAYSETS[b.dataset.set]) set(DAYSETS[b.dataset.set]); });
}
const readDays = (v) => [0, 1, 2, 3, 4, 5, 6].filter((i) => v[`d${i}`] === 'on');

export async function mount(el) {
  let kidId = S.info.kids[0]?.id;
  async function load() {
    const [list, acts] = await Promise.all([get(`/api/kids/${kidId}/routines`), get('/api/activities').catch(() => [])]);
    const kids = S.info.kids; const kid = kids.find((k) => k.id === kidId);
    el.innerHTML = `<header class="page-head"><h1>📝 할일</h1><div class="head-right"><button class="btn primary" id="add">+ 할일 추가</button></div></header>
      <div class="kid-tabs" role="tablist">${kids.map((k) => `<button role="tab" class="kid-tab ${k.id === kidId ? 'on' : ''}" aria-selected="${k.id === kidId}" data-kid="${k.id}" style="--kc:${esc(k.color)}">${avatar(k, 'sm')} ${esc(k.name)}</button>`).join('')}</div>
      <section class="card page-card"><p class="muted small">수정한 내용은 <b>다음 해당 요일부터</b> 적용돼요. 과거 기록은 그때 모습 그대로 남아요.</p>
      ${list.length ? `<ul class="rlist">${list.map((r, i) => `<li><span class="ri">${esc(r.icon)}</span><div class="grow"><b>${esc(r.name)}</b><div class="small muted">${esc(r.slotLabel)} · ${daysText(r.days)}</div></div>
        <div class="row gap"><button class="btn ghost small" data-up="${r.id}" ${i === 0 ? 'disabled' : ''} aria-label="위로">↑</button><button class="btn ghost small" data-down="${r.id}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="아래로">↓</button><button class="btn ghost small" data-edit="${r.id}">수정</button><button class="btn ghost small" data-del="${r.id}" aria-label="삭제">🗑</button></div></li>`).join('')}</ul>` : '<p class="empty">아직 할일이 없어요. 아래 빠른 추가를 눌러 보세요.</p>'}</section>
      <section class="card page-card"><h3>⚡ 빠른 추가 <small class="muted">누르면 ${esc(kid.name)}에게 매일 할일로 추가돼요 (나중에 수정 가능)</small></h3><div class="chips">${QUICK.map(([n, ic, s], i) => `<button class="chip big" data-q="${i}">${ic} ${esc(n)}</button>`).join('')}</div></section>`;
    const run = (fn) => async () => { try { await fn(); await load(); } catch (e) { errToast(e); } };
    $$('.kid-tab', el).forEach((b) => b.addEventListener('click', () => { kidId = Number(b.dataset.kid); load(); }));
    $('#add', el).onclick = run(() => editForm());
    el.onclick = async (e) => {
      const t = e.target.closest('button'); if (!t) return; const d = t.dataset;
      if (d.q !== undefined) { const [name, icon, slot] = QUICK[Number(d.q)]; return run(() => post('/api/routines', { kidIds: [kidId], name, icon, slot, days: 'daily' }).then(() => toast(`${name} 추가했어요`)))(); }
      if (d.up || d.down) { const id = Number(d.up || d.down); const ids = list.map((r) => r.id); const i = ids.indexOf(id); const j = d.up ? i - 1 : i + 1; [ids[i], ids[j]] = [ids[j], ids[i]]; return run(() => put(`/api/kids/${kidId}/routines/order`, { order: ids }))(); }
      if (d.edit) return run(() => editForm(list.find((r) => r.id === Number(d.edit))))();
      if (d.del) return run(async () => {
        const r = list.find((x) => x.id === Number(d.del));
        let today = false;
        const ok = await formSheet({ title: `‘${r.name}’을(를) 지울까요?`, submit: '지우기', danger: true, html: '<p class="muted">앞으로 목록에서 사라져요. 지난 기록은 그대로 남아요.</p><label class="check"><input type="checkbox" name="today"> <span>오늘 목록에서도 바로 지우기 <small class="muted">(도장 승인 전만)</small></span></label>', onSubmit: (v) => { today = v.today === 'on'; } });
        if (ok === undefined) return;
        await del(`/api/routines/${r.id}${today ? '?applyToday=1' : ''}`); toast('지웠어요');
      })();
    };
    async function editForm(r) {
      const both = !r && kids.length > 1;
      const p = formSheet({ title: r ? '할일 수정' : '할일 추가', submit: r ? '저장' : '추가', cls: 'tall',
        html: `${routineForm(r, { showBoth: both, kids, acts })}${r ? '<label class="check"><input type="checkbox" name="applyToday"> <span>오늘 목록에도 바로 적용 <small class="muted">(도장 승인 전만)</small></span></label>' : ''}`,
        onSubmit: async (v) => {
          const days = readDays(v);
          if (!days.length) throw new Error('반복 요일을 하나 이상 골라 주세요.');
          const body = { name: v.name, icon: v.icon, days, slot: v.slot, activityId: v.activityId ? Number(v.activityId) : null };
          if (r) { const res = await patch(`/api/routines/${r.id}`, { ...body, applyToday: v.applyToday === 'on' }); toast(res.appliedToday ? '오늘부터 바꿨어요' : '다음 해당 요일부터 바뀌어요'); }
          else { await post('/api/routines', { ...body, kidIds: v.both === 'on' ? kids.map((k) => k.id) : [kidId] }); toast('추가했어요'); }
        } });
      setTimeout(() => { const s = $('.sheet'); if (s) bindDays(s); }, 0);
      return p;
    }
  }
  await load();
  return { refresh: load, topics: ['routines'] };
}
