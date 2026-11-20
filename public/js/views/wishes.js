import { $, $$, esc, won } from '../util.js';
import { S, get, post, patch, del, isDevice, isAdultNow, kidById } from '../api.js';
import { avatar, toast, errToast, formSheet, photoPicker, celebrate, confirmDialog } from '../ui.js';
import { back, amountSheet } from '../common.js';
import { adultPick } from './wallet.js';

const kidOf = (id) => kidById(id) || { id: Number(id), name: '아이', avatar: '🙂', color: '#e8e0f5' };

export async function mount(el, { id }) {
  const kid = kidOf(id);
  const asKid = () => isDevice() && S.actKid === Number(id);
  async function load() { draw(await get(`/api/kids/${id}/wishes`)); }
  const photo = (w) => (w.photoUrl ? `<img class="wish-photo" src="${esc(w.photoUrl)}" alt="${esc(w.name)} 사진" loading="lazy">` : '<div class="wish-photo ph">🛍️</div>');
  function goalCard(w, wal) {
    const need = w.need;
    const msg = w.status === 'purchasing' ? `<div class="banner wait">⏳ ${esc(w.purchase?.toName || '어른')}에게 ‘사고 싶어요’를 보냈어요${w.purchase?.status === 'approved' ? ' — <b>사도 좋아요!</b> 결제를 기다려요' : ''}</div>` : '';
    return `<article class="goal card" style="--kc:${esc(kid.color)}"><div class="goal-top">${photo(w)}<div class="grow"><span class="tag">${esc(w.statusLabel)}</span><h2>${esc(w.name)}</h2><p>${won(w.price)}${w.reason ? ` · <span class="muted">${esc(w.reason)}</span>` : ''}</p></div></div>
      <div class="goal-bar" role="progressbar" aria-valuenow="${Math.round(w.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${w.progress * 100}%"></i><span>${Math.round(w.progress * 100)}%</span></div>
      <p class="goal-text"><b>${won(w.allocated)} 모았어요</b>${need > 0 ? ` · ${won(need)} 더 필요해요` : ' · 다 모았어요! 🎉'}</p>
      ${w.praise ? `<p class="praise">👏 ${esc(w.praise.from)}: ${esc(w.praise.text)}</p>` : ''}${msg}
      <div class="row gap wrap">${w.status === 'ready' && asKid() ? `<button class="btn primary big grow" data-buy="${w.id}">🛒 사고 싶어요</button>` : ''}
      ${['goal', 'ready'].includes(w.status) ? `${need > 0 ? `<button class="btn primary grow" data-add="${w.id}" data-avail="${wal.available}" data-need="${need}">➕ 목표에 담기</button>` : ''}<button class="btn ghost" data-rem="${w.id}" data-has="${w.allocated}">➖ 빼기</button><button class="btn ghost" data-cancel="${w.id}">목표 취소</button>` : ''}
      ${isAdultNow() || !isDevice() ? `<button class="btn ghost small" data-edit="${w.id}">가격·내용 수정</button><button class="btn ghost small" data-praise="${w.id}">👏 칭찬</button>` : ''}</div></article>`;
  }
  function draw({ wishes, wallet }) {
    const goal = wishes.find((w) => ['goal', 'ready', 'purchasing'].includes(w.status));
    const others = wishes.filter((w) => w.status === 'wanted');
    const bought = wishes.filter((w) => w.status === 'bought');
    el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} ${esc(kid.name)}의 사고 싶은 것`, '<button class="btn small primary" id="new">+ 추가</button>')}
      <p class="muted center">지금 쓸 수 있는 돈 <b>${won(wallet.available)}</b></p>
      ${goal ? goalCard(goal, wallet) : '<div class="empty card">아직 모으는 목표가 없어요.<br>아래에서 물건을 골라 ‘목표로 정하기’를 눌러요.</div>'}
      <section><h3>사고 싶은 것 목록</h3>${others.length ? `<div class="wish-grid">${others.map((w) => `<article class="wish card">${photo(w)}<h4>${esc(w.name)}</h4><p>${won(w.price)}</p>${w.reason ? `<p class="small muted">${esc(w.reason)}</p>` : ''}<div class="row gap wrap"><button class="btn primary small" data-goal="${w.id}">목표로 정하기</button><button class="btn ghost small" data-edit="${w.id}">수정</button><button class="btn ghost small" data-del="${w.id}" aria-label="삭제">🗑</button></div></article>`).join('')}</div>` : '<p class="muted">사진과 가격을 올려 보세요</p>'}</section>
      <section><h3>🏆 내가 모아서 산 것</h3>${bought.length ? `<div class="wish-grid">${bought.map((w) => `<article class="wish card bought">${w.boughtPhotoUrl ? `<img class="wish-photo" src="${esc(w.boughtPhotoUrl)}" alt="${esc(w.name)}" loading="lazy">` : photo(w)}<h4>${esc(w.name)}</h4><p>${won(w.boughtAmount)}</p></article>`).join('')}</div>` : '<p class="muted">모아서 사면 여기에 사진이 보관돼요</p>'}</section>`;
  }
  const act = (fn) => async () => { try { await fn(); await load(); } catch (e) { errToast(e); } };
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (t.id === 'new') return act(() => wishForm())();
    if (d.goal) return act(() => post(`/api/wishes/${d.goal}/goal`).then(() => toast('목표로 정했어요')))();
    if (d.add) return act(() => amountSheet({ title: '목표에 담기', submit: '담기', max: Math.min(Number(d.avail), Number(d.need)), intro: `<p class="muted">지금 쓸 수 있는 돈 ${won(Number(d.avail))} · 목표까지 ${won(Number(d.need))}</p>`, onSubmit: async (v) => { const r = await post(`/api/wishes/${d.add}/allocate`, { amount: v.amount }); toast(`${won(v.amount)} 담았어요`); if (r.celebrate) setTimeout(() => celebrate('목표를 다 모았어요!'), 300); } }))();
    if (d.rem) return act(() => amountSheet({ title: '목표에서 빼기', submit: '빼기', intro: `<p class="muted">목표에 모아둔 돈 ${won(Number(d.has))}</p>`, onSubmit: (v) => post(`/api/wishes/${d.rem}/allocate`, { amount: v.amount, op: 'remove' }) }))();
    if (d.cancel) return act(async () => { if (await confirmDialog('목표를 취소하면 모아둔 돈이 다시 쓸 수 있는 돈이 돼요. 취소할까요?', { danger: true })) await post(`/api/wishes/${d.cancel}/cancel-goal`); })();
    if (d.buy) return act(() => formSheet({ title: '사고 싶어요', submit: '보내기', html: `<p class="muted">사진과 금액을 어른에게 보내요. 어른이 허락하면 결제해 줄 거예요.</p>${adultPick()}`, onSubmit: async (v) => { await post(`/api/wishes/${d.buy}/buy`, { toMemberId: Number(v.toMemberId) }); toast('어른에게 보냈어요'); } }))();
    if (d.edit) return act(async () => { const all = await get(`/api/kids/${id}/wishes`); await wishForm(all.wishes.find((w) => w.id === Number(d.edit))); })();
    if (d.del) return act(async () => { if (await confirmDialog('이 물건을 목록에서 지울까요?', { danger: true })) await del(`/api/wishes/${d.del}`); })();
    if (d.praise) return act(() => formSheet({ title: '목표에 칭찬 남기기', submit: '남기기', html: '<label class="field">짧은 칭찬<input name="text" maxlength="80" placeholder="꾸준히 모아서 멋져요!" required></label>', onSubmit: (v) => post('/api/praises', { kidId: Number(id), targetType: 'goal', targetId: Number(d.praise), text: v.text }) }))();
  });
  async function wishForm(w) {
    const picker = photoPicker({ kind: 'wish', kidId: id, label: '물건' });
    if (w?.photoUrl) { picker.state.id = w.photoId; $('img', picker).src = w.photoUrl; $('.photo-preview', picker).hidden = false; }
    const p = formSheet({ title: w ? '물건 수정' : '사고 싶은 물건', submit: w ? '저장' : '올리기',
      html: `<div id="pp"></div><label class="field">물건 이름<input name="name" maxlength="40" value="${esc(w?.name || '')}" required></label>
        <label class="field">예상 가격(원)<input name="price" inputmode="numeric" value="${w?.price || ''}" required></label><label class="field">갖고 싶은 이유 (선택)<input name="reason" maxlength="100" value="${esc(w?.reason || '')}"></label>`,
      onSubmit: async (v) => {
        if (picker.state.busy) throw new Error('사진을 올리는 중이에요. 잠깐만요.');
        const body = { name: v.name, price: Number(v.price), reason: v.reason, photoId: picker.state.id };
        if (w) await patch(`/api/wishes/${w.id}`, body); else await post(`/api/kids/${id}/wishes`, body);
        toast('저장했어요');
      } });
    setTimeout(() => $('#pp')?.appendChild(picker), 0);
    return p;
  }
  await load();
  return { refresh: load, topics: ['wishes', 'wallet', 'requests'] };
}
