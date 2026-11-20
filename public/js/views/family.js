import { $, $$, esc, DOW, lsGet, lsSet, shortDate, dateLabel } from '../util.js';
import { S, get, post, patch, del, put, bus, isDevice, isAdultNow } from '../api.js';
import { avatar, toast, errToast, formSheet, confirmDialog, needAdult } from '../ui.js';
import { back } from '../common.js';
import { supplySheet } from './supplies.js';

// ---- 푸시 알림 ----
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const ios = /iphone|ipad/i.test(navigator.userAgent);
    return { s: 'unsupported', msg: ios ? 'iPhone은 Safari에서 ‘홈 화면에 추가’한 앱으로 열어야 알림을 켤 수 있어요. (공유 버튼 → 홈 화면에 추가)' : '이 브라우저는 푸시 알림을 지원하지 않아요.' };
  }
  const { publicKey } = await get('/api/push/key');
  if (!publicKey) return { s: 'noserver', msg: '서버에 푸시 키(VAPID)가 아직 설정되지 않았어요. 설정 안내(README)를 확인해 주세요. 앱 안 알림은 정상 동작해요.' };
  if (Notification.permission === 'denied') return { s: 'denied', msg: '알림이 꺼져 있어요. 기기 설정 > 알림에서 이 앱을 허용해 주세요.' };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return { s: sub && Notification.permission === 'granted' ? 'on' : 'off', publicKey, reg, sub };
}
async function enablePush(st) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('알림 허용이 필요해요.');
  const sub = st.sub || await st.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(st.publicKey) });
  await post('/api/push/subscribe', { subscription: sub.toJSON() });
}
async function disablePush(st) { if (st.sub) { await post('/api/push/unsubscribe', { endpoint: st.sub.endpoint }); await st.sub.unsubscribe(); } }

const AV = (S.info?.avatars) || [];
function memberForm(m) {
  return `<label class="field">이름<input name="name" maxlength="20" value="${esc(m.name)}" required></label>
    <div class="field"><span>아바타</span><div class="icon-pick">${(S.info.avatars || []).map((a) => `<label><input type="radio" name="avatar" value="${a}" ${a === m.avatar ? 'checked' : ''}><span>${a}</span></label>`).join('')}</div></div>
    ${m.kind === 'kid' ? `<div class="field"><span>카드 색</span><div class="color-pick">${(S.info.kidColors || []).map((c) => `<label><input type="radio" name="color" value="${c}" ${c === m.color ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div></div>` : ''}`;
}

export async function mount(el) {
  async function load() {
    S.info = await get('/api/me');
    const info = S.info; const dev = isDevice(); const adult = !dev || isAdultNow();
    const ps = adult ? await pushState().catch(() => ({ s: 'unsupported', msg: '' })) : null;
    const theme = lsGet('theme', 'auto');
    const acts = adult ? await get('/api/activities').catch(() => []) : [];
    const code = info.family.code;
    el.innerHTML = `<header class="page-head"><h1>👨‍👩‍👧‍👦 가족</h1></header>
      <section class="card page-card"><h3>우리 가족 <small class="muted">${esc(info.family.name)}</small></h3><ul class="members">${[...info.adults, ...info.kids].map((m) => `<li>${avatar(m, 'md')}<div class="grow"><b>${esc(m.name)}</b><div class="small muted">${m.kind === 'kid' ? '아이' : ({ mom: '엄마', dad: '아빠', grandma: '할머니' })[m.role] || '어른'}${m.isGuardian ? ' · 부모님 권한' : ''}${m.kind === 'kid' && m.hasPin ? ' · 🔒' : ''}</div></div><button class="btn ghost small" data-edit="${m.id}">수정</button>${m.kind === 'kid' ? `<button class="btn ghost small" data-pin="${m.id}">${m.hasPin ? '🔒 비번' : '🔓 비번'}</button>` : ''}</li>`).join('')}</ul></section>
      <section class="card page-card"><h3>메뉴</h3><div class="big-grid three"><a class="big-btn small" href="#/notebook"><span class="bi">📒</span><b>사진 알림장</b></a><a class="big-btn small" href="#/calendar"><span class="bi">📅</span><b>가족 달력</b></a><a class="big-btn small" href="#/adult"><span class="bi">🔑</span><b>어른 홈</b></a><a class="big-btn small" href="#/family-activity"><span class="bi">🎈</span><b>가족 활동</b></a><button class="big-btn small" id="addsup"><span class="bi">🎒</span><b>준비물 직접 추가</b></button></div></section>
      ${adult ? `<section class="card page-card"><h3>⏱ 활동 타이머 설정</h3><p class="muted small">활동 이름과 기본 시간을 바꿀 수 있어요. 30분 이상 타이머는 5분 전에 한 번 알려 줘요.</p><ul class="rlist">${(acts || []).map((a) => `<li><span class="ri">${esc(a.icon)}</span><div class="grow"><b>${esc(a.name)}</b><div class="small muted">기본 ${a.minutes}분</div></div><button class="btn ghost small" data-act="${a.id}">수정</button><button class="btn ghost small" data-actdel="${a.id}" aria-label="삭제">🗑</button></li>`).join('')}</ul><div class="row gap wrap"><button class="btn ghost" id="addact">+ 활동 추가</button></div>
        <label class="check"><input type="checkbox" id="tsound" ${info.family.timerSound ? 'checked' : ''}> <span>타이머 알람 소리 사용 <small class="muted">(거실 iPad에서 한 번 울려요)</small></span></label></section>` : ''}
      ${adult && code ? `<section class="card page-card"><h3>가족 초대</h3><p class="muted small">어른은 각자 계정으로 같은 가족에 연결해요.</p><div class="code-box"><b id="code">${esc(code)}</b></div><div class="row gap wrap"><button class="btn primary" id="share">초대 링크 보내기</button><button class="btn ghost" id="copy">코드 복사</button><button class="btn ghost" id="rot">코드 새로 만들기</button></div></section>` : ''}
      <section class="card page-card"><h3>화면·알림 설정</h3>
        <div class="field"><span>테마</span><div class="seg">${[['auto', '자동(밤 7시~아침 7시)'], ['light', '낮'], ['dark', '밤']].map(([k, t]) => `<label class="seg-opt"><input type="radio" name="theme" value="${k}" ${theme === k ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
        ${adult ? `<label class="check"><input type="checkbox" id="gs" ${info.family.showGrandmaStatus ? 'checked' : ''}> <span>거실 보드에 할머니 상태 카드 표시</span></label>` : ''}
        ${ps ? `<div class="field"><span>휴대폰 알림</span>${ps.s === 'on' ? '<p class="ok">✅ 이 기기에서 알림을 받고 있어요</p><button class="btn ghost" id="poff">알림 끄기</button>' : ps.s === 'off' ? '<button class="btn primary" id="pon">🔔 알림 허용</button>' : `<p class="muted small">${esc(ps.msg)}</p>`}</div>` : (dev ? '<p class="muted small">이 기기에서 타이머 알림(앱이 닫혀 있거나 잠겨 있을 때)을 받으려면 먼저 어른 확인(🔑)을 한 뒤 이 화면에서 알림을 허용해 주세요.</p><button class="btn ghost" id="adultMode">🔑 어른 확인</button>' : '')}
      </section>
      <section class="card page-card"><button class="btn ghost wide" id="logout">로그아웃</button><p class="muted small center">${dev ? '거실 공용 기기 모드' : '내 휴대폰 모드'} · 우리집 v1</p></section>`;
    bind(ps);
  }
  function bind(ps) {
    const run = (fn) => async () => { try { await fn(); await load(); } catch (e) { errToast(e); } };
    $$('input[name=theme]', el).forEach((r) => r.addEventListener('change', () => { lsSet('theme', r.value); bus.emit('theme'); }));
    $('#gs', el)?.addEventListener('change', run(() => patch('/api/family', { showGrandmaStatus: $('#gs', el).checked })));
    $('#pon', el)?.addEventListener('click', run(() => enablePush(ps)));
    $('#poff', el)?.addEventListener('click', run(() => disablePush(ps)));
    $('#adultMode', el)?.addEventListener('click', async () => { if (await needAdult()) load(); });
    $('#tsound', el)?.addEventListener('change', run(() => patch('/api/family', { timerSound: $('#tsound', el).checked })));
    $('#addsup', el)?.addEventListener('click', () => supplySheet({}));
    $('#addact', el)?.addEventListener('click', run(() => formSheet({ title: '활동 추가', submit: '추가', html: '<label class="field">활동 이름<input name="name" maxlength="20" required></label><label class="field">아이콘<input name="icon" maxlength="4" value="⏱️"></label><label class="field">기본 시간(분)<input name="minutes" inputmode="numeric" value="30"></label>', onSubmit: (v) => post('/api/activities', { name: v.name, icon: v.icon, minutes: Number(v.minutes) }) })));
    $('#logout', el).onclick = async () => { if (await confirmDialog('로그아웃할까요?')) window.__app.logout(); };
    const code = S.info.family.code;
    $('#copy', el)?.addEventListener('click', () => { navigator.clipboard?.writeText(code).then(() => toast('복사했어요')).catch(() => toast(code)); });
    $('#share', el)?.addEventListener('click', async () => {
      const link = `${location.origin}/#/join/${code}`;
      try { if (navigator.share) await navigator.share({ title: '우리집 가족 초대', text: '우리집 가족 앱에 참여해 주세요', url: link }); else { await navigator.clipboard.writeText(link); toast('초대 링크를 복사했어요'); } } catch {}
    });
    $('#rot', el)?.addEventListener('click', run(async () => { if (await confirmDialog('가족 코드를 새로 만들면 이전 코드는 쓸 수 없어요. 계속할까요?')) { await post('/api/family/code/rotate'); S.info = await get('/api/me'); } }));
    el.onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'); const pin = e.target.closest('[data-pin]');
      if (ed) { if (!(await needAdult())) return; const all = [...S.info.adults, ...S.info.kids]; const m = all.find((x) => x.id === Number(ed.dataset.edit)); await run(() => formSheet({ title: `${m.name} 수정`, submit: '저장', cls: 'tall', html: memberForm(m), onSubmit: (v) => patch(`/api/members/${m.id}`, { name: v.name, avatar: v.avatar, ...(v.color ? { color: v.color } : {}) }) }))(); }
      const ae = e.target.closest('[data-act]'); const ad = e.target.closest('[data-actdel]');
      if (ae) { if (!(await needAdult())) return; const a = (await get('/api/activities')).find((x) => x.id === Number(ae.dataset.act)); await run(() => formSheet({ title: `${a.name} 수정`, submit: '저장', html: `<label class="field">활동 이름<input name="name" maxlength="20" value="${esc(a.name)}" required></label><label class="field">아이콘<input name="icon" maxlength="4" value="${esc(a.icon)}"></label><label class="field">기본 시간(분)<input name="minutes" inputmode="numeric" value="${a.minutes}"></label>`, onSubmit: (v) => patch(`/api/activities/${a.id}`, { name: v.name, icon: v.icon, minutes: Number(v.minutes) }) }))(); }
      if (ad) { if (!(await needAdult())) return; if (await confirmDialog('이 활동을 지울까요? 연결된 루틴의 타이머 버튼도 사라져요.', { danger: true })) await run(() => del(`/api/activities/${ad.dataset.actdel}`))(); }
      if (pin) { if (!(await needAdult())) return; const m = S.info.kids.find((x) => x.id === Number(pin.dataset.pin)); await run(() => formSheet({ title: `${m.name} 비밀번호`, submit: '저장', html: `<p class="muted">공용 기기에서 다른 아이가 저금통·사고 싶은 것·메시지를 보지 못하게 4자리 숫자를 정할 수 있어요. 비우면 해제돼요.</p><label class="field">숫자 4자리<input name="pin" inputmode="numeric" maxlength="4" pattern="[0-9]*" autocomplete="off"></label>`, onSubmit: (v) => put(`/api/kids/${m.id}/pin`, { pin: v.pin || null }) }))(); }
    };
  }
  await load();
  return { refresh: load, topics: ['family'] };
}

// ---- 가족 달력 ----
export async function calendar(el) {
  let month = S.info.today.slice(0, 7);
  async function load() {
    const c = await get(`/api/calendar?month=${month}`);
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)); const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const by = {}; c.schedule.forEach((s) => (by[s.date] ||= []).push(s));
    const stampBy = {}; c.stamps.forEach((s) => (stampBy[s.date] ||= []).push(s.kidId));
    el.innerHTML = `${back('/family', '가족 달력', !isDevice() || isAdultNow() ? '<button class="btn small primary" id="addev">+ 일정</button>' : '')}
      <section class="card page-card"><div class="month-nav"><button class="btn ghost" data-m="-1" aria-label="이전 달">‹</button><h3>${y}년 ${m}월</h3><button class="btn ghost" data-m="1" aria-label="다음 달">›</button></div>
      <div class="cal big">${DOW.map((d, i) => `<div class="cal-h ${i === 0 ? 'sun' : ''}">${d}</div>`).join('')}${'<div></div>'.repeat(first.getUTCDay())}${Array.from({ length: days }, (_, i) => { const date = `${month}-${String(i + 1).padStart(2, '0')}`; const list = by[date] || [];
        return `<div class="cal-d ${date === S.info.today ? 'today' : ''}"><span>${i + 1}</span>${list.slice(0, 3).map((s) => `<small class="ev ${s.type}">${s.time ? esc(s.time) + ' ' : ''}${esc(s.title)}</small>`).join('')}${list.length > 3 ? `<small>+${list.length - 3}</small>` : ''}${(stampBy[date] || []).map((k) => `<i>${esc(S.info.kids.find((x) => x.id === k)?.avatar || '💮')}</i>`).join('')}</div>`; }).join('')}</div></section>
      <section class="card page-card"><h3>이번 달 일정·준비물</h3>${c.schedule.length ? `<ul class="sched">${c.schedule.map((s) => `<li><span class="dot ${s.type}"></span><div><b>${shortDate(s.date)} ${s.time ? esc(s.time) + ' ' : ''}${esc(s.title)}</b>${s.kidName ? ` <span class="tag">${esc(s.kidName)}</span>` : ''}${s.supplies ? `<div class="small">🎒 ${esc(s.supplies)}</div>` : ''}${s.type === 'event' && (!isDevice() || isAdultNow()) ? ` <button class="btn ghost small" data-delev="${s.id}">삭제</button>` : ''}</div></li>`).join('')}</ul>` : '<p class="muted">일정이 없어요</p>'}</section>`;
    el.onclick = async (e) => {
      const nv = e.target.closest('[data-m]'); const dv = e.target.closest('[data-delev]');
      try {
        if (nv) { const n = new Date(Date.UTC(y, m - 1 + Number(nv.dataset.m), 1)); month = `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}`; await load(); }
        if (dv) { await del(`/api/events/${dv.dataset.delev}`); load(); }
        if (e.target.id === 'addev') await formSheet({ title: '일정 추가', submit: '추가', html: `<label class="field">일정 이름<input name="title" maxlength="60" required></label><label class="field">날짜<input name="date" type="date" value="${S.info.today}" required></label><div class="field"><span>대상</span><div class="seg"><label class="seg-opt"><input type="radio" name="kidId" value="all" checked><span>모두</span></label>${S.info.kids.map((k) => `<label class="seg-opt"><input type="radio" name="kidId" value="${k.id}"><span>${esc(k.name)}</span></label>`).join('')}</div></div>`, onSubmit: async (v) => { await post('/api/events', { title: v.title, date: v.date, kidId: v.kidId }); load(); } });
      } catch (x) { errToast(x); }
    };
  }
  await load();
  return { refresh: load, topics: ['calendar', 'posts'] };
}
void AV; void dateLabel;
