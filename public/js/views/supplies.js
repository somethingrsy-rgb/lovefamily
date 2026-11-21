import { $, $$, esc, shortDate, dateLabel, addDays } from '../util.js';
import { S, get, post, put, del, isDevice, isAdultNow, kidById, bus } from '../api.js';
import { avatar, toast, errToast, formSheet, openSheet, confirmDialog, needAdult, openPhoto } from '../ui.js';
import { back } from '../common.js';

const kidOf = (id) => kidById(id) || { id: Number(id), name: '아이', avatar: '🙂', color: '#e8e0f5' };
// 아이콘 고르기: 글자 목록(select)은 이모지 그림으로 바꿀 수 없어서, 그림 버튼 + 펼침 칸으로 만든다
const iconPick = (i, v = ICONS[0]) => `<input type="hidden" name="ic${i}" value="${v}"><button type="button" class="icon-pick" aria-label="아이콘 고르기" aria-expanded="false">${v}</button>`;
const ICONS = ['🎒', '💧', '✂️', '🖍️', '🟥', '🧴', '👟', '🎽', '📔', '🍙', '🧻', '🎨'];

// 준비물 등록 시트: 한 번에 여러 개, 대상 아이(유엘/유하/모두), 날짜(기본 내일). postId 가 있으면 원본 알림장과 연결.
export async function supplySheet({ postId = null, postTitle = '', kidId = null, onDone } = {}) {
  if (!(await needAdult())) return;
  const kids = S.info.kids;
  const rows = (n) => Array.from({ length: n }, (_, i) => `<div class="sup-row">${iconPick(i)}<input name="nm${i}" maxlength="30" placeholder="${['물통', '색종이', '체육복', '풀'][i] || '준비물'}" aria-label="준비물 이름"></div>`).join('');
  const tomorrow = addDays(S.info.today, 1);
  await formSheet({
    title: postTitle ? `준비물 추가 · ${postTitle}` : '준비물 직접 추가', submit: '등록', cls: 'tall',
    html: `<div class="field"><span>물건 이름 (여러 개 가능)</span><div id="srows">${rows(4)}</div><button type="button" class="btn ghost small" id="moreRow">+ 한 줄 더</button></div>
      <div class="field"><span>대상 아이</span><div class="seg"><label class="seg-opt"><input type="radio" name="who" value="all" ${kidId ? '' : 'checked'}><span>모두</span></label>${kids.map((k) => `<label class="seg-opt"><input type="radio" name="who" value="${k.id}" ${Number(kidId) === k.id ? 'checked' : ''}><span>${esc(k.name)}</span></label>`).join('')}</div></div>
      <label class="field">가져가는 날짜<input name="date" type="date" value="${tomorrow}" required></label>`,
    onSubmit: async (v, sh) => {
      const n = $$('#srows .sup-row', sh.el).length;
      const items = Array.from({ length: n }, (_, i) => ({ name: (v[`nm${i}`] || '').trim(), icon: v[`ic${i}`] })).filter((x) => x.name);
      if (!items.length) throw new Error('준비물 이름을 입력해 주세요.');
      const r = await post('/api/supplies', { postId, kidIds: v.who === 'all' ? 'all' : [Number(v.who)], items, date: v.date });
      if (r.duplicates.length) {
        await new Promise((res) => { const s2 = openSheet(`<h2>이미 등록된 준비물이 있어요</h2><ul class="sup-dups">${r.duplicates.map((d) => `<li>${esc(d.icon)} <b>${esc(d.name)}</b> · ${shortDate(d.date)} · ${d.kids.map((k) => esc(k.name)).join(', ')}</li>`).join('')}</ul><p class="muted small">${r.created.length ? `새로 ${r.created.length}개는 등록했어요.` : '새로 등록한 것은 없어요.'}</p><div class="row end"><button class="btn primary" data-close>확인</button></div>`, { onClose: res }); void s2; });
      } else toast(`${r.created.length}개 등록했어요`);
      onDone?.();
    },
  });
}
// 시트가 열린 뒤 '한 줄 더' 버튼 동작은 위임으로 처리
document.addEventListener('click', (e) => {
  const pick = e.target.closest('.icon-pick'); const opt = e.target.closest('.icon-opt');
  if (pick) {
    const row = pick.closest('.sup-row'); const open = row.nextElementSibling?.classList.contains('icon-grid');
    document.querySelectorAll('.icon-grid').forEach((g) => g.remove());
    document.querySelectorAll('.icon-pick[aria-expanded=true]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    if (!open) {
      row.insertAdjacentHTML('afterend', `<div class="icon-grid" role="listbox" aria-label="아이콘">${ICONS.map((x) => `<button type="button" class="icon-opt ${row.querySelector('input[type=hidden]').value === x ? 'on' : ''}" role="option" data-ic="${x}" aria-label="아이콘">${x}</button>`).join('')}</div>`);
      pick.setAttribute('aria-expanded', 'true');
    }
    return;
  }
  if (opt) {
    const grid = opt.closest('.icon-grid'); const row = grid.previousElementSibling;
    row.querySelector('input[type=hidden]').value = opt.dataset.ic;
    const b = row.querySelector('.icon-pick'); b.textContent = opt.dataset.ic; b.setAttribute('aria-expanded', 'false');
    grid.remove(); return;
  }
  if (e.target.id !== 'moreRow') return;
  const wrap = document.getElementById('srows'); const i = wrap.children.length;
  const d = document.createElement('div'); d.className = 'sup-row';
  d.innerHTML = `${iconPick(i)}<input name="nm${i}" maxlength="30" placeholder="준비물" aria-label="준비물 이름">`;
  wrap.appendChild(d);
});

// 아이의 준비물 목록(전체: 챙긴 것도 표시). 원본 알림장 사진은 눌러서 본다.
export async function kidSupplies(el, { id }) {
  const kid = kidOf(id);
  async function load() {
    const list = await get(`/api/kids/${id}/supplies`);
    const today = S.info.today; const byDate = {};
    list.forEach((s) => (byDate[s.date] ||= []).push(s));
    const adult = !isDevice() || isAdultNow();
    el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} ${esc(kid.name)}의 챙길 것`, '<button class="btn small primary" id="add">+ 직접 추가</button>')}
      ${Object.keys(byDate).sort().map((d) => `<section class="card page-card"><h3>${d === today ? '오늘 챙길 것' : d === addDays(today, 1) ? '내일 챙길 것' : dateLabel(d)} <small class="muted">${shortDate(d)}</small></h3>
        <ul class="sup-list">${byDate[d].map((s) => `<li class="${s.checked ? 'done' : ''}"><button class="sup-check" data-sup="${s.id}" data-checked="${s.checked ? 1 : 0}" aria-pressed="${s.checked}"><span class="sc-box">${s.checked ? '✔' : ''}</span><span class="sc-ic">${esc(s.icon)}</span><span class="sc-name">${esc(s.name)}${s.postTitle ? `<small>📒 ${esc(s.postTitle)}</small>` : ''}</span></button>${s.photoUrl ? `<button class="btn ghost small" data-photo="${esc(s.photoUrl)}" aria-label="알림장 사진 보기">📷</button>` : ''}${adult ? `<button class="btn ghost small" data-del="${s.id}" aria-label="삭제">🗑</button>` : ''}</li>`).join('')}</ul>
        ${byDate[d].every((s) => s.checked) ? '<p class="ok center"><b>다 챙겼어요! ✅</b></p>' : `<p class="muted center">${byDate[d].filter((s) => s.checked).length}/${byDate[d].length} 챙겼어요</p>`}</section>`).join('') || '<div class="empty card">챙길 것이 없어요 🎒</div>'}`;
    $('#add', el).onclick = () => supplySheet({ kidId: id, onDone: load });
    el.onclick = async (e) => {
      const c = e.target.closest('[data-sup]'); const ph = e.target.closest('[data-photo]'); const dl = e.target.closest('[data-del]');
      try {
        if (c) { await put(`/api/supplies/${c.dataset.sup}/kids/${id}`, { checked: c.dataset.checked !== '1' }); load(); }
        if (ph) openPhoto(ph.dataset.photo, '알림장 원본 사진');
        if (dl && await confirmDialog('이 준비물을 지울까요?', { danger: true })) { await del(`/api/supplies/${dl.dataset.del}`); load(); }
      } catch (x) { errToast(x); }
    };
  }
  await load();
  return { refresh: load, topics: ['supplies'] };
}
void bus; void kidOf;
