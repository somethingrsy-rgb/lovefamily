import { $, $$, esc, dateLabel, shortDate, addDays, won, SLOT } from '../util.js';
import { S, get, post, del, toggleItem, pendingItems, isDevice, isAdultNow, kidById, bus } from '../api.js';
import { avatar, toast, errToast, playStamp, formSheet, confirmDialog } from '../ui.js';
import { back } from '../common.js';
import { morph } from '../morph.js';
import { startFlow } from './timerui.js';

const kidOf = (id) => kidById(id) || { id: Number(id), name: '아이', avatar: '🙂', color: '#e8e0f5' };

// 아이 허브: 큰 버튼 4개
export async function hub(el, { id }) {
  const kid = kidOf(id);
  async function load() {
    const [day, boards] = await Promise.all([get(`/api/kids/${id}/day`), get(`/api/kids/${id}/stamps`)]);
    let unread = 0;
    try { const n = await get(`/api/notifications?kidId=${id}`); unread = n.unread; } catch {}
    const status = { ready: '🎉 다 했어요 · 도장 요청하기', requested: '✋ 다 했어요 · 어른 확인 중', approved: `💮 도장 받았어요${day.stamp ? ` (${esc(day.stamp.providerName)})` : ''}`, recheck: '🔎 다시 확인해 보래요', none: '😴 오늘은 쉬는 날', open: `${day.total - day.done}개 남았어요` }[day.status];
    el.innerHTML = `${back('/', '', '')}
      <section class="kid-hub" style="--kc:${esc(kid.color)}">
        <div class="hub-head">${avatar(kid, 'xxl')}<div><h1>${esc(kid.name)}</h1><p class="hub-state">${status}</p><p class="small">💮 도장 <b>${boards.count}</b>/${boards.size}</p></div></div>
        <div class="big-grid">
          <a class="big-btn" href="#/kid/${id}/today"><span class="bi">✅</span><b>오늘 할일</b><small>${day.done}/${day.total}</small></a>
          <a class="big-btn" href="#/kid/${id}/timer"><span class="bi">⏱️</span><b>활동</b><small>시작하기</small></a>
          <a class="big-btn" href="#/kid/${id}/wallet"><img class="bi-img" src="/assets/money/piggy.webp" alt="" draggable="false"><b>돼지 저금통</b><small>내 돈 보기</small></a>
          <a class="big-btn" href="#/kid/${id}/talk"><span class="bi">💌</span><b>가족에게 말하기</b><small>메시지 보내기</small></a>
        </div>
        <div class="row gap wrap center"><a class="btn ghost" href="#/kid/${id}/wishes">🛍️ 사고 싶은 것</a><a class="btn ghost" href="#/kid/${id}/supplies">🎒 챙길 것</a><a class="btn ghost" href="#/kid/${id}/family">🎈 가족 활동</a><a class="btn ghost" href="#/kid/${id}/missions">🎯 미션</a><a class="btn ghost" href="#/kid/${id}/stamps">💮 도장판</a><a class="btn ghost" href="#/kid/${id}/inbox">📬 받은 편지함${unread ? ` <span class="badge">${unread}</span>` : ''}</a></div>
      </section>`;
  }
  await load();
  return { refresh: load, topics: ['day', 'stamps', 'messages', 'home'] };
}

// 오늘 할일: 항목을 눌러 체크
export async function today(el, { id }) {
  const kid = kidOf(id);
  let date = S.info.today;
  let lastStatus = null;
  async function load() {
    const d = await get(`/api/kids/${id}/day?date=${date}`);
    draw(d);
    if (lastStatus && lastStatus !== 'approved' && d.status === 'approved' && d.date === S.info.today) playStamp({ kidName: kid.name, provider: d.stamp?.providerName, key: d.stamp?.id });
    lastStatus = d.status;
  }
  function draw(d) {
    const pend = pendingItems();
    const groups = ['morning', 'after_school', 'evening'].map((s) => [s, d.items.filter((i) => i.slot === s)]).filter(([, l]) => l.length);
    const isToday = date === S.info.today;
    const banner = {
      ready: `<div class="banner ok">🎉 할일을 다 했어요! 도장 방에서 <b>도장 요청</b>을 눌러요.</div>`,
      requested: `<div class="banner wait">✋ 다 했어요 · 어른 확인 중</div>`,
      approved: `<div class="banner ok">💮 도장 받았어요! ${d.stamp ? `<small>(${esc(d.stamp.providerName)})</small>` : ''}</div>`,
      recheck: `<div class="banner warn">🔎 다시 확인해 보래요: ${esc(d.recheck?.reason || '')}<div class="small">표시된 항목을 다시 해 보고 체크해 주세요.</div></div>`,
      none: `<div class="banner rest">😴 이 날은 예정된 할일이 없어요</div>`,
    }[d.status] || '';
    morph(el, `${back(`/kid/${id}`, `${avatar(kid, 'sm')} ${esc(kid.name)}의 할일`, `<a class="btn small" href="#/kid/${id}/timer">⏱ 활동</a>`)}
      <div class="day-nav"><button class="btn ghost" id="prev" aria-label="전날">‹</button><h2>${dateLabel(date)}${isToday ? ' <span class="tag">오늘</span>' : ''}</h2><button class="btn ghost" id="next" ${isToday ? 'disabled' : ''} aria-label="다음날">›</button></div>
      ${banner}
      ${!d.exists ? '<div class="empty">이 날의 할일 기록이 없어요</div>' : ''}
      ${groups.map(([s, l]) => `<section class="slot"><h3>${SLOT[s]}</h3><ul class="checks">${l.map((i) => {
        const p = pend.get(i.id); const done = p ? p.done : i.done;
        return `<li><button class="check-item ${done ? 'done' : ''} ${i.flag ? 'flag' : ''} ${p ? 'pending' : ''}" data-id="${i.id}" data-done="${done ? 1 : 0}" ${d.editable ? '' : 'disabled'} aria-pressed="${done}">
          <span class="ci-box">${p ? (S.online ? '⏳' : '📥') : done ? '✔' : ''}</span><span class="ci-icon">${esc(i.icon)}</span><span class="ci-name">${esc(i.name)}${i.flag ? `<small>🔎 ${esc(i.flag)}</small>` : ''}</span>
          ${p ? `<em class="ci-note">${S.online ? '저장 중' : '저장 대기'}</em>` : ''}</button>${i.activityId ? `<button class="btn small item-timer" data-tstart="${i.activityId}" aria-label="${esc(i.name)} 활동 시작">⏱ 활동 시작</button>` : ''}</li>`; }).join('')}</ul></section>`).join('')}
      ${d.status === 'recheck' && d.done === d.total ? `<button class="btn primary big wide" id="rereq">다시 확인 요청하기</button>` : ''}
      ${d.status === 'ready' ? `<button class="btn primary big wide" id="rereq">✋ 도장 요청하기</button>` : ''}
      ${d.exists ? `<p class="progress-line">${d.done}/${d.total} 완료 · ${d.status === 'approved' ? '도장을 받아서 바꿀 수 없어요' : '어른이 확인하면 도장을 받아요'}</p>` : ''}`);
  }
  // 눌림은 el 한 곳에서 처리한다(화면을 고쳐 쓰더라도 이벤트가 겹쳐 붙지 않는다)
  el.onclick = async (e) => {
    const t = e.target;
    if (t.closest('#prev')) { date = addDays(date, -1); lastStatus = null; load().catch(errToast); return; }
    if (t.closest('#next') && !t.closest('#next').disabled) { date = addDays(date, 1); lastStatus = null; load().catch(errToast); return; }
    const rq = t.closest('#rereq');
    if (rq) { try { const r = await post(`/api/kids/${id}/day/request`, { date }); toast(r.status === 'requested' ? '어른들께 도장 요청을 보냈어요! ✋' : '다시 요청했어요'); load(); } catch (x) { errToast(x); } return; }
    const ts = t.closest('[data-tstart]');
    if (ts) { try { if (await startFlow(id, Number(ts.dataset.tstart))) location.hash = `#/kid/${id}/timer`; } catch (x) { errToast(x); } return; }
    const b = t.closest('.check-item');
    if (b && !b.disabled) {
      const next = b.dataset.done !== '1';
      b.dataset.done = next ? 1 : 0; b.classList.toggle('done', next); b.classList.add('pending');
      try { await toggleItem(Number(b.dataset.id), next); } catch (x) { errToast(x); }
      load().catch(() => {});
    }
  };
  await load();
  const off = bus.on('notified', (n) => { if (n.kind === 'stamp_approved') load().catch(() => {}); });
  return { refresh: load, topics: ['day', 'home'], destroy: off };
}

// 미션: 저축 미션(자동 표시) + 일회성 미션
export async function missions(el, { id }) {
  const kid = kidOf(id);
  async function load() {
    const m = await get(`/api/kids/${id}/missions`);
    const adult = !isDevice() || isAdultNow();
    el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} ${esc(kid.name)}의 미션`, adult ? '<button class="btn small primary" id="newm">+ 미션 만들기</button>' : '')}
      <section class="card page-card"><h3>🐷 저축 미션 <small class="muted">거래 기록으로 자동 확인해요</small></h3><ul class="missions">${m.system.map((s) => `<li class="${s.achieved ? 'done' : ''}"><span class="mi">${s.achieved ? '🏅' : '🎯'}</span><div class="grow"><b>${esc(s.title)}</b>${s.target > 1 ? `<div class="bar thin"><i style="width:${(s.progress / s.target) * 100}%"></i></div><small class="muted">${won(s.progress)} / ${won(s.target)}</small>` : ''}</div><span>${s.achieved ? '달성!' : '도전 중'}</span></li>`).join('')}</ul><p class="small muted">달성한 저축 미션 ${m.achievementCount}번 (현금 보상은 없어요)</p></section>
      <section class="card page-card"><h3>⭐ 특별 미션 <small class="muted">도장판과는 따로 기록해요</small></h3>${m.custom.length ? `<ul class="missions">${m.custom.map((c) => `<li class="${c.status === 'done' ? 'done' : ''}"><span class="mi">${c.status === 'done' ? '✅' : '⭐'}</span><div class="grow"><b>${esc(c.title)}</b>${c.reward ? `<div class="small">보상 ${won(c.reward)}</div>` : ''}${c.doneBy ? `<div class="small muted">${esc(c.doneBy)}이(가) 확인했어요</div>` : ''}</div>
        ${c.status === 'open' && isDevice() && S.actKid === Number(id) ? `<button class="btn primary small" data-req="${c.id}">다 했어요</button>` : c.status === 'requested' ? '<span class="tag wait">어른 확인 중</span>' : ''}
        ${adult && c.status !== 'done' ? `<button class="btn ghost small" data-cancel="${c.id}" aria-label="미션 취소">✕</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted">아직 특별 미션이 없어요</p>'}</section>`;
    $('#newm', el)?.addEventListener('click', () => formSheet({ title: '일회성 미션 만들기', submit: '만들기',
      html: `<label class="field">미션 이름<input name="title" maxlength="60" placeholder="안 쓰는 장난감 분류 돕기" required></label><label class="field">보상(원, 선택)<input name="reward" inputmode="numeric" placeholder="500"></label>`,
      onSubmit: async (v) => { await post('/api/missions', { kidId: Number(id), title: v.title, reward: Number(v.reward) || 0 }); load(); } }));
    el.onclick = async (e) => {
      const r = e.target.closest('[data-req]'); const c = e.target.closest('[data-cancel]');
      try {
        if (r) { await post(`/api/missions/${r.dataset.req}/request`); toast('어른에게 알렸어요'); load(); }
        if (c && await confirmDialog('이 미션을 없앨까요?')) { await del(`/api/missions/${c.dataset.cancel}`); load(); }
      } catch (x) { errToast(x); }
    };
  }
  await load();
  return { refresh: load, topics: ['missions', 'wallet'] };
}
