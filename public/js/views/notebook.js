import { $, $$, esc, ago, shortDate, kstDate } from '../util.js';
import { S, get, post, patch, del, isDevice, isAdultNow } from '../api.js';
import { avatar, toast, errToast, formSheet, photoPicker, confirmDialog, needAdult, openPhoto } from '../ui.js';
import { back } from '../common.js';
import { supplySheet } from './supplies.js';

export async function mount(el, params) {
  let filter = 'all';
  const adultNow = () => !isDevice() || isAdultNow();
  async function load() {
    const posts = await get('/api/posts');
    const shown = posts.filter((p) => filter === 'all' || (filter === 'common' ? !p.kidId : p.kidId === Number(filter) || !p.kidId));
    el.innerHTML = `${back('/family', '📒 사진 알림장', adultNow() ? '<button class="btn small primary" id="newp">+ 글쓰기</button>' : '<button class="btn small ghost" id="adm">🔑 어른 확인</button>')}
      <div class="chips filter">${[['all', '전체'], ...S.info.kids.map((k) => [String(k.id), k.name]), ['common', '공용']].map(([k, t]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${esc(t)}</button>`).join('')}</div>
      ${shown.map((p) => `<article class="post card ${p.pinned ? 'pinned' : ''}" id="p${p.id}">${p.pinned ? '<span class="pin">📌 중요</span>' : ''}
        <header><h3>${esc(p.title)}</h3><span class="tag">${esc(p.tag)}</span></header>
        ${p.photoUrl ? `<img class="post-photo" src="${esc(p.photoUrl)}" alt="${esc(p.title)} 사진" loading="lazy">` : ''}
        ${p.body ? `<p>${esc(p.body).replace(/\n/g, '<br>')}</p>` : ''}
        <div class="chips">${p.dueDate ? `<span class="tag due">📅 ${shortDate(p.dueDate)}까지</span>` : ''}${p.supplies ? `<span class="tag">🎒 ${esc(p.supplies)}</span>` : ''}</div>
        <footer><span class="small muted">${esc(p.authorName)} · ${ago(p.createdAt)}</span><span class="reads" aria-label="확인한 사람">${p.reads.map((r) => `<span class="read ${r.readAt ? 'on' : ''}" title="${esc(r.name)} ${r.readAt ? '확인' : '아직'}">${esc(r.name)}${r.readAt ? ' ✓' : ''}</span>`).join('')}</span></footer>
        ${adultNow() ? `<div class="row gap wrap">${p.readByMe === false ? `<button class="btn small primary" data-read="${p.id}">확인했어요</button>` : ''}<button class="btn small primary" data-sup="${p.id}" data-title="${esc(p.title)}">🎒 준비물 추가</button><button class="btn small ghost" data-pin="${p.id}" data-on="${p.pinned ? 0 : 1}">${p.pinned ? '고정 해제' : '📌 상단 고정'}</button><button class="btn small ghost" data-edit="${p.id}">✏️ 수정</button><button class="btn small ghost" data-del="${p.id}">삭제</button></div>` : ''}</article>`).join('') || '<div class="empty card">아직 글이 없어요</div>'}`;
    $$('[data-f]', el).forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; load(); }));
    $('#adm', el)?.addEventListener('click', async () => { if (await needAdult()) load(); });
    $('#newp', el)?.addEventListener('click', () => compose());
    el.onclick = async (e) => {
      const pimg = e.target.closest('.post-photo'); if (pimg) return openPhoto(pimg.getAttribute('src'), pimg.getAttribute('alt') || '알림장 사진');
      const sp = e.target.closest('[data-sup]'); if (sp) return supplySheet({ postId: Number(sp.dataset.sup), postTitle: sp.dataset.title, onDone: load });
      const ed = e.target.closest('[data-edit]'); if (ed) { if (await needAdult()) compose(posts.find((x) => x.id === Number(ed.dataset.edit))); return; }
      const r = e.target.closest('[data-read]'); const p = e.target.closest('[data-pin]'); const d = e.target.closest('[data-del]');
      try {
        if (r) { await post(`/api/posts/${r.dataset.read}/read`); load(); }
        if (p) { await post(`/api/posts/${p.dataset.pin}/pin`, { pinned: p.dataset.on === '1' }); load(); }
        if (d && await confirmDialog('이 글을 지울까요?', { danger: true })) { await del(`/api/posts/${d.dataset.del}`); load(); }
      } catch (x) { errToast(x); }
    };
    if (params.postId) $(`#p${params.postId}`, el)?.scrollIntoView({ block: 'center' });
    // 어른이 글을 열어 보면 확인 처리
    if (params.postId && adultNow() && !isDevice()) post(`/api/posts/${params.postId}/read`).catch(() => {});
  }
  // 글쓰기(old 없음) / 수정(old = 고칠 글). 수정할 때 사진은 새로 고르지 않으면 그대로, '사진 지우기'를 체크하면 지운다
  function compose(old = null) {
    const picker = photoPicker({ kind: 'post', label: '알림장' });
    if (old?.photoUrl) { picker.state.id = null; $('img', picker).src = old.photoUrl; $('.photo-preview', picker).hidden = false; }
    const kv = old ? String(old.kidId || 'all') : 'all';
    formSheet({ title: old ? '알림장 수정' : '알림장 쓰기', submit: old ? '저장' : '올리기', cls: 'tall',
      html: `<div id="pp"></div>${old?.photoUrl ? '<label class="check"><input type="checkbox" name="rmphoto"> <span>사진 지우기</span></label>' : ''}<label class="field">제목<input name="title" maxlength="60" value="${esc(old?.title || '')}" required></label><label class="field">내용<textarea name="body" rows="3" maxlength="2000">${esc(old?.body || '')}</textarea></label>
        <div class="field"><span>대상 태그</span><div class="seg"><label class="seg-opt"><input type="radio" name="kidId" value="all" ${kv === 'all' ? 'checked' : ''}><span>공용</span></label>${S.info.kids.map((k) => `<label class="seg-opt"><input type="radio" name="kidId" value="${k.id}" ${kv === String(k.id) ? 'checked' : ''}><span>${esc(k.name)}</span></label>`).join('')}</div></div>
        <label class="field">준비물 (선택)<input name="supplies" maxlength="120" value="${esc(old?.supplies || '')}" placeholder="도시락, 물통"></label><label class="field">제출·준비 기한 (선택)<input name="dueDate" type="date" value="${esc(old?.dueDate || '')}"></label>
        ${old ? '' : '<label class="check"><input type="checkbox" name="pinned"> <span>📌 중요한 글로 상단에 고정</span></label><label class="check"><input type="checkbox" name="notify"> <span>🔔 가족에게 휴대폰 알림 보내기</span></label>'}`,
      onSubmit: async (v) => {
        if (picker.state.busy) throw new Error('사진을 올리는 중이에요. 잠깐만요.');
        if (old) {
          const body = { title: v.title, body: v.body, kidId: v.kidId, supplies: v.supplies, dueDate: v.dueDate || null };
          if (v.rmphoto === 'on') body.photoId = null; else if (picker.state.id) body.photoId = picker.state.id;
          await patch(`/api/posts/${old.id}`, body); toast('고쳤어요'); load(); return;
        }
        await post('/api/posts', { title: v.title, body: v.body, kidId: v.kidId, photoId: picker.state.id, supplies: v.supplies, dueDate: v.dueDate || null, pinned: v.pinned === 'on', notify: v.notify === 'on' });
        toast('올렸어요'); load();
      } });
    setTimeout(() => $('#pp')?.appendChild(picker), 0);
  }
  await load();
  return { refresh: load, topics: ['posts'] };
}
void kstDate; void avatar;
