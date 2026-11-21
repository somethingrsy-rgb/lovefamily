import { $, $$, esc } from '../util.js';
import { S, get, post, isDevice, isAdultNow, kidById, bus } from '../api.js';
import { avatar, toast, errToast, formSheet, confirmDialog, needAdult } from '../ui.js';
import { back } from '../common.js';
import { T, loadTimers, timerOf, fmt, remaining, ringSvg, nextCards, audioReady, chime } from '../timers.js';
import { actPic, actImgUrl } from '../actimg.js';

const kidOf = (id) => kidById(id) || { id: Number(id), name: '아이', avatar: '🙂', color: '#e8e0f5' };
const ICONS = ['🛁', '👚', '🪥', '📚', '🍽️', '🧸', '🛏️', '👕', '🧹', '🚿', '📖', '🎒'];

// 활동 시작(진행 중이면 확인 후 교체). 다음 활동은 어른이 고른 경우에만 포함된다.
export async function startFlow(kidId, activityId, next) {
  const body = { activityId, ...(next ? { next } : {}) };
  try {
    await post(`/api/kids/${kidId}/timers`, body);
  } catch (e) {
    if (e.code === 'timer_running') {
      if (!(await confirmDialog(`${e.body.timer.name} 활동이 진행 중이에요. 그만하고 새로 시작할까요?`, { yes: '새로 시작', no: '계속 하기' }))) return false;
      await post(`/api/kids/${kidId}/timers`, { ...body, replace: true });
    } else throw e;
  }
  await loadTimers();
  return true;
}

// 어른이 고르는 '다음 활동': 오늘 루틴의 미완료 항목 또는 직접 입력
export async function nextPicker(kidId) {
  if (!(await needAdult())) return undefined;
  const day = await get(`/api/kids/${kidId}/day`);
  const open = day.items.filter((i) => !i.done);
  let out;
  await formSheet({
    title: '다음 활동 정하기', submit: '정했어요',
    html: `<p class="muted">활동이 끝날 때쯤 아이에게 “다음은 이거예요”라고 미리 알려 줘요. 안 정해도 활동은 시작할 수 있어요.</p>
      <div class="field"><span>오늘 루틴에서 고르기</span>${open.length ? `<div class="next-list">${open.map((i) => `<label class="next-opt"><input type="radio" name="pick" value="r${i.id}"><span>${esc(i.icon)} ${esc(i.name)}</span></label>`).join('')}</div>` : '<p class="muted small">남은 루틴이 없어요</p>'}</div>
      <div class="field"><span>직접 입력</span><div class="icon-pick small">${ICONS.map((i, n) => `<label><input type="radio" name="icon" value="${i}" ${n === 0 ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div><input name="custom" maxlength="30" placeholder="잠옷 갈아입기"></div>
      <label class="check"><input type="radio" name="pick" value="none" checked> <span>정하지 않을래요</span></label>`,
    onSubmit: (v) => {
      if (v.custom?.trim()) out = { type: 'custom', name: v.custom.trim(), icon: v.icon };
      else if (v.pick?.startsWith('r')) out = { type: 'routine', itemId: Number(v.pick.slice(1)) };
      else out = null;
    },
  });
  return out;
}

// 아이 카드/오늘 화면에 쓰는 요약
export function kidTimerHtml(kid) {
  const t = timerOf(kid.id);
  if (!t) return `<a class="btn kt-start" href="#/kid/${kid.id}/timer">⏱ 활동</a>`;
  if (t.state === 'ended') {
    return `<div class="kid-timer ended"><div class="kt-row"><span class="kt-alarm" aria-hidden="true">⏰</span><div class="grow"><b>${esc(t.name)} 시간이 끝났어요</b>${t.texts.nextEnd ? `<div class="small">${esc(t.texts.nextEnd)}</div>` : ''}</div><button class="btn small primary" data-dismiss="${t.id}">확인</button></div></div>`;
  }
  return `<div class="kid-timer running"><a class="kt-row" href="#/kid/${kid.id}/timer" aria-label="${esc(t.name)} 활동 열기">${ringSvg(t, 70, 9)}<div class="grow"><div class="kt-time" data-timer="${t.id}">${fmt(remaining(t))}</div><div class="kt-name">${esc(t.icon)} ${esc(t.name)}</div></div><span class="kt-pic">${actImgUrl(t.kind, kid.id) ? actPic(t.kind, t.icon, kid.id) : ''}</span></a>${t.next ? nextCards(t, true) : ''}</div>`;
}
export function bindDismiss(root, after) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dismiss]'); if (!b) return;
    e.preventDefault();
    try { await post(`/api/timers/${b.dataset.dismiss}/dismiss`); await loadTimers(); after?.(); } catch (x) { errToast(x); }
  });
}

// 활동 화면: 활동 고르기 → 시작 / 진행 중 큰 숫자 + 원형 표시
export async function timerPage(el, { id }) {
  const kid = kidOf(id);
  let acts = []; let sel = null; let nextChoice = null;
  async function load() {
    [acts] = await Promise.all([get('/api/activities'), loadTimers()]);
    draw();
  }
  function draw() {
    const t = timerOf(id);
    const adult = !isDevice() || isAdultNow();
    if (!t) {
      el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} ${esc(kid.name)}의 활동`)}
        <p class="center big-q">무슨 시간이에요?</p>
        <div class="act-grid" role="radiogroup" aria-label="활동 고르기">${acts.map((a) => `<button class="act-card ${sel === a.id ? 'on' : ''}" role="radio" aria-checked="${sel === a.id}" data-act="${a.id}">${actPic(a.kind, a.icon, id, 'big')}<b>${esc(a.name)}</b><small>${a.minutes}분</small></button>`).join('')}</div>
        <div class="card page-card center"><div class="row gap wrap center"><button class="btn ghost" id="next">➡️ 다음 활동 정하기 <small>(어른)</small></button>${nextChoice ? `<span class="tag">다음: ${esc(nextChoice.type === 'custom' ? nextChoice.icon + ' ' + nextChoice.name : '루틴 선택됨')}</span>` : ''}</div></div>
        <button class="btn primary big wide" id="start" ${sel ? '' : 'disabled'}>▶ 시작</button>`;
      el.onclick = async (e) => {
        const a = e.target.closest('[data-act]');
        if (a) { sel = Number(a.dataset.act); draw(); return; }
        try {
          if (e.target.closest('#next')) { const n = await nextPicker(id); if (n !== undefined) { nextChoice = n; draw(); } }
          if (e.target.closest('#start') && sel) { if (await startFlow(id, sel, nextChoice)) { nextChoice = null; sel = null; toast('시작했어요 ⏱'); load(); } }
        } catch (x) { errToast(x); }
      };
      return;
    }
    const ended = t.state === 'ended';
    el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} ${esc(kid.name)}의 활동`)}
      <section class="timer-big card ${ended ? 'ended' : ''}" style="--kc:${esc(kid.color)}">
        ${actImgUrl(t.kind, id) ? `<img class="timer-pic" src="${actImgUrl(t.kind, id)}" alt="">` : ''}
        <div class="ring-wrap">${ringSvg(t, 300, 22)}<div class="ring-center"><div class="big-digits" data-timer="${t.id}">${ended ? '00:00' : fmt(remaining(t))}</div><div>${esc(t.icon)} ${esc(t.name)}</div></div></div>
        ${nextCards(t)}
        <p class="tp-text">${ended ? esc(t.texts.end) : remaining(t) <= 300000 && t.warnAt ? esc(t.texts.warn) : t.next ? `다음 활동: ${esc(t.next.name)}` : '시간이 다 되면 알려 줄게요.'}</p>
        ${ended && t.texts.nextEnd ? `<p class="tp-next">${esc(t.texts.nextEnd)}</p>` : ''}
        <div class="row gap wrap center">${ended ? `${t.next?.type === 'routine' && !t.next.done ? `<a class="btn big" href="#/kid/${id}/today">${esc(t.next.name)} 루틴 열기</a>` : ''}<button class="btn primary big" data-dismiss="${t.id}">확인했어요</button>` : ''}
        ${!ended ? '<button class="btn ghost" id="new">다른 활동 시작</button><button class="btn stop-btn" id="stop">⏹ 중단하기</button>' : ''}</div>
        ${T.sound && !audioReady() ? '<p class="small muted center">🔇 알람 소리를 들으려면 이 화면을 한 번 눌러 주세요.</p>' : ''}
      </section>
      <section class="card page-card adult-set"><h3>🔑 어른 설정 <small class="muted">${isDevice() && !adult ? '(누르면 어른 확인이 필요해요)' : ''}</small></h3><div class="row gap wrap">
        <button class="btn" data-ext="5">+5분</button><button class="btn" data-ext="10">+10분</button><button class="btn" data-ext="30">+30분</button><button class="btn ghost" id="setnext">➡️ 다음 활동 바꾸기</button><button class="btn ghost" id="cancel">활동 끝내기</button><button class="btn ghost" id="test">🔔 소리 확인</button></div></section>`;
    el.onclick = async (e) => {
      const d = e.target.closest('[data-dismiss]'); const x = e.target.closest('[data-ext]');
      try {
        if (d) { await post(`/api/timers/${d.dataset.dismiss}/dismiss`); await loadTimers(); draw(); }
        if (x) { await post(`/api/timers/${t.id}/extend`, { minutes: Number(x.dataset.ext) }); toast(`${x.dataset.ext}분 늘렸어요`); await load(); }
        if (e.target.id === 'new') { if (await confirmDialog('진행 중인 활동은 그만하고 새로 고를까요?', { yes: '새로 고르기' })) { await post(`/api/timers/${t.id}/cancel`); await load(); } }
        if (e.target.closest('#stop')) { if (await confirmDialog('활동을 중단할까요?', { yes: '중단하기', no: '계속 하기', danger: true })) { await post(`/api/timers/${t.id}/cancel`); toast('활동을 중단했어요'); await load(); } }
        if (e.target.id === 'cancel') { if (await confirmDialog('활동을 끝낼까요?', { danger: true })) { await post(`/api/timers/${t.id}/cancel`); await load(); } }
        if (e.target.id === 'setnext') { const n = await nextPicker(id); if (n !== undefined) { await fetchPut(t.id, n); await load(); } }
        if (e.target.id === 'test') { if (!chime('warn')) toast('소리가 꺼져 있거나 화면을 한 번 눌러야 해요'); }
      } catch (er) { errToast(er); }
    };
  }
  await load();
  const off1 = bus.on('timers', () => { if (!document.querySelector('.sheet')) { const t = timerOf(id); const cur = el.querySelector('.timer-big'); if (!!t !== !!cur || (t && cur && cur.classList.contains('ended') !== (t.state === 'ended'))) draw(); } });
  return { refresh: load, topics: ['timers'], destroy: off1 };
}
async function fetchPut(tid, next) {
  const { put } = await import('../api.js');
  return put(`/api/timers/${tid}/next`, { next });
}
void $; void $$;
