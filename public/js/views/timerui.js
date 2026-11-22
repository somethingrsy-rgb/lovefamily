import { $, $$, esc } from '../util.js';
import { S, get, post, isDevice, isAdultNow, kidById, bus } from '../api.js';
import { avatar, toast, errToast, formSheet, confirmDialog, needAdult } from '../ui.js';
import { back } from '../common.js';
import { T, loadTimers, timerOf, fmt, remaining, ringSvg, nextCards, audioReady, chime, minLabel } from '../timers.js';
import { actPic, actImgUrl } from '../actimg.js';

const kidOf = (id) => kidById(id) || { id: Number(id), name: '아이', avatar: '🙂', color: '#e8e0f5' };
const ICONS = ['🛁', '👚', '🪥', '📚', '🍽️', '🧸', '🛏️', '👕', '🧹', '🚿', '📖', '🎒'];

// 활동 시작(진행 중이면 확인 후 교체). 다음 활동은 어른이 고른 경우에만 포함된다.
export async function startFlow(kidId, activityId, next, minutes) {
  const body = { activityId, ...(next ? { next } : {}), ...(minutes ? { minutes } : {}) };
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
  if (t.state === 'paused') {
    return `<div class="kid-timer paused"><a class="kt-row" href="#/kid/${kid.id}/timer" aria-label="${esc(t.name)} 일시 중단 · 이어서 하기">${ringSvg(t, 70, 9)}<div class="grow"><div class="kt-time">⏸ 남은 시간 ${fmt(remaining(t))}</div><div class="kt-name">${esc(t.icon)} ${esc(t.name)} · 일시 중단</div></div></a></div>`;
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
  let acts = []; let sel = null; let nextChoice = null; let budget = {}; let lastTap = { id: null, t: 0 }; let mins = null; // mins: 아이가 고른 시간(분). null = 어른이 정한 오늘 남은 시간 그대로
  const leftMin = (aid) => { const b = budget[aid]; return b ? Math.max(1, Math.ceil(b.leftMs / 60000)) : (acts.find((x) => x.id === aid)?.minutes || 10); };
  const hiMin = (aid) => { const L = leftMin(aid); return Math.max(L, Math.floor((L + 30) / 10) * 10); }; // 어른이 정한 시간 + 최대 30분
  const curMin = (aid) => Math.min(mins ?? leftMin(aid), hiMin(aid));
  const stepMin = (aid, dir) => { const L = leftMin(aid); const lo = Math.min(10, L); let m = curMin(aid); if (dir < 0) m = m % 10 ? Math.floor(m / 10) * 10 : m - 10; else m = m < L ? Math.min(L, (Math.floor(m / 10) + 1) * 10) : (Math.floor(m / 10) + 1) * 10; mins = Math.max(lo, Math.min(hiMin(aid), m)); };
  async function load() {
    const [a, b] = await Promise.all([get('/api/activities'), get(`/api/kids/${id}/activity-budget`).catch(() => []), loadTimers()]);
    acts = a; budget = Object.fromEntries(b.map((x) => [x.activityId, x]));
    draw();
  }
  // 하루 총 시간: '오늘 남은 시간 18분 / 30분', 다 썼으면 '오늘은 다 했어요'
  const budgetLabel = (a) => { const b = budget[a.id]; if (!b) return `${a.minutes}분`; return b.leftMs <= 0 ? '오늘은 다 했어요' : b.leftMs >= b.allowanceMs ? `하루 ${a.minutes}분` : `오늘 ${minLabel(b.leftMs)} 남음`; };
  function draw() {
    const t = timerOf(id);
    const adult = !isDevice() || isAdultNow();
    if (!t) {
      el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} ${esc(kid.name)}의 활동`)}
        <p class="center big-q">무슨 시간이에요?</p>
        <div class="act-grid" role="radiogroup" aria-label="활동 고르기">${acts.map((a) => `<button class="act-card ${sel === a.id ? 'on' : ''}" role="radio" aria-checked="${sel === a.id}" data-act="${a.id}">${actPic(a.kind, a.icon, id, 'big')}<b>${esc(a.name)}</b><small>${budgetLabel(a)}</small></button>`).join('')}</div>
        <div class="card page-card center"><div class="row gap wrap center"><button class="btn ghost" id="next">➡️ 다음 활동 정하기 <small>(어른)</small></button>${nextChoice ? `<span class="tag">다음: ${esc(nextChoice.type === 'custom' ? nextChoice.icon + ' ' + nextChoice.name : '루틴 선택됨')}</span>` : ''}</div></div>
        ${sel && !(budget[sel] && budget[sel].leftMs <= 0) ? `<div class="card page-card center min-step"><span class="muted small">활동 시간 (어른이 정한 시간에서 10분씩 바꿀 수 있어요 · 최대 +30분)</span><div class="row gap center"><button class="btn big" id="mdown" aria-label="10분 줄이기" ${curMin(sel) <= Math.min(10, leftMin(sel)) ? 'disabled' : ''}>− 10분</button><b class="min-now">${esc(minLabel(curMin(sel) * 60000))}</b><button class="btn big" id="mup" aria-label="10분 늘리기" ${curMin(sel) >= hiMin(sel) ? 'disabled' : ''}>+ 10분</button></div></div>` : ''}
        <button class="btn primary big wide" id="start" ${sel && !(budget[sel] && budget[sel].leftMs <= 0) ? '' : 'disabled'}>▶ 시작</button>`;
      el.onclick = async (e) => {
        const a = e.target.closest('[data-act]');
        if (a) {
          const was = sel; sel = Number(a.dataset.act); if (was !== sel) mins = null; const b = budget[sel]; const used = !!(b && b.leftMs <= 0);
          const now = Date.now(); const dbl = lastTap.id === sel && now - lastTap.t < 450; lastTap = { id: dbl ? null : sel, t: now };
          if (used) { toast('오늘은 이 시간을 다 썼어요. 내일 또 할 수 있어요'); draw(); return; }
          // 활동 그림을 빠르게 두 번 누르면(더블클릭/더블탭) 바로 시작한다
          if (dbl) { if (await startFlow(id, sel, nextChoice, mins != null && mins !== leftMin(sel) ? mins : undefined)) { nextChoice = null; sel = null; mins = null; toast('시작했어요 ⏱'); load(); } return; }
          draw(); return;
        }
        try {
          if (e.target.closest('#next')) { const n = await nextPicker(id); if (n !== undefined) { nextChoice = n; draw(); } }
          if (e.target.closest('#mdown') && sel) { stepMin(sel, -1); draw(); return; }
          if (e.target.closest('#mup') && sel) { stepMin(sel, 1); draw(); return; }
          if (e.target.closest('#start') && sel) { if (await startFlow(id, sel, nextChoice, mins != null && mins !== leftMin(sel) ? mins : undefined)) { nextChoice = null; sel = null; mins = null; toast('시작했어요 ⏱'); load(); } }
        } catch (x) { errToast(x); }
      };
      return;
    }
    const ended = t.state === 'ended'; const paused = t.state === 'paused';
    el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} ${esc(kid.name)}의 활동`)}
      <section class="timer-big card ${ended ? 'ended' : ''} ${paused ? 'paused' : ''}" style="--kc:${esc(kid.color)}">
        ${actImgUrl(t.kind, id) ? `<img class="timer-pic" src="${actImgUrl(t.kind, id)}" alt="">` : ''}
        <div class="ring-wrap">${ringSvg(t, 300, 22)}<div class="ring-center"><div class="big-digits" data-timer="${t.id}">${ended ? '00:00' : fmt(remaining(t))}</div><div>${paused ? '⏸ 일시 중단 · ' : ''}${esc(t.icon)} ${esc(t.name)}</div></div></div>
        ${ended ? nextCards(t) : ''}
        <p class="tp-text">${paused ? `⏸ 잠깐 멈췄어요. <b>남은 시간 ${esc(minLabel(remaining(t)))}</b> · 이어서 하면 여기서부터 다시 셀게요.` : ended ? esc(t.texts.end) : remaining(t) <= 300000 && t.warnAt ? esc(t.texts.warn) : t.next ? `다음 활동: ${esc(t.next.name)}` : '시간이 다 되면 알려 줄게요.'}</p>
        ${ended && t.texts.nextEnd ? `<p class="tp-next">${esc(t.texts.nextEnd)}</p>` : ''}
        <div class="row gap wrap center">${ended ? `${t.next?.type === 'routine' && !t.next.done ? `<a class="btn big" href="#/kid/${id}/today">${esc(t.next.name)} 루틴 열기</a>` : ''}<button class="btn primary big" data-dismiss="${t.id}">확인했어요</button>` : ''}
        ${paused ? '<button class="btn primary big" id="resume">▶ 이어서 하기</button><button class="btn stop-btn" id="stop">⏹ 그만하기</button><button class="btn ghost" id="new">다른 활동 시작</button>' : !ended ? '<button class="btn primary big" id="pause">⏸ 일시 중단</button><button class="btn stop-btn" id="stop">⏹ 그만하기</button><button class="btn ghost" id="new">다른 활동 시작</button>' : ''}</div>
        ${!ended && t.dayMs ? `<p class="small muted center">오늘 남은 <b>${esc(minLabel(t.dayLeftMs))}</b> · 나눠서 해도 돼요</p>` : ''}
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
        if (e.target.closest('#pause')) { const r = await post(`/api/timers/${t.id}/pause`); toast(`⏸ 일시 중단! 남은 시간 ${minLabel(r.remainingMs)}`); await load(); }
        if (e.target.closest('#resume')) { await post(`/api/timers/${t.id}/resume`); toast('▶ 이어서 시작해요'); await load(); }
        if (e.target.closest('#stop')) { if (await confirmDialog('활동을 그만할까요? 남은 시간은 오늘 다시 쓸 수 있어요.', { yes: '그만하기', no: '계속 하기', danger: true })) { await post(`/api/timers/${t.id}/cancel`); await load(); const b = budget[t.activityId]; toast(b ? `그만했어요 · 오늘 ${t.name} 남은 시간 ${minLabel(b.leftMs)}` : '활동을 그만했어요'); } }
        if (e.target.id === 'cancel') { if (await confirmDialog('활동을 끝낼까요?', { danger: true })) { await post(`/api/timers/${t.id}/cancel`); await load(); } }
        if (e.target.id === 'setnext') { const n = await nextPicker(id); if (n !== undefined) { await fetchPut(t.id, n); await load(); } }
        if (e.target.id === 'test') { if (!chime('warn')) toast('소리가 꺼져 있거나 화면을 한 번 눌러야 해요'); }
      } catch (er) { errToast(er); }
    };
  }
  await load();
  const off1 = bus.on('timers', () => { if (!document.querySelector('.sheet')) { const t = timerOf(id); const cur = el.querySelector('.timer-big'); if (!!t !== !!cur || (t && cur && (cur.classList.contains('ended') !== (t.state === 'ended') || cur.classList.contains('paused') !== (t.state === 'paused')))) draw(); } });
  return { refresh: load, topics: ['timers'], destroy: off1 };
}
async function fetchPut(tid, next) {
  const { put } = await import('../api.js');
  return put(`/api/timers/${tid}/next`, { next });
}
void $; void $$;
