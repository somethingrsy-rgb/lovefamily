import { $, $$, esc, DOW, lsGet, lsSet, wallPickerHtml, wallCur, housePickerHtml, shortDate, dateLabel } from '../util.js';
import { S, get, post, patch, del, put, bus, isDevice, isAdultNow } from '../api.js';
import { avatar, toast, errToast, formSheet, confirmDialog, needAdult, photoPicker, openSheet } from '../ui.js';
import { back } from '../common.js';
import { houseCur, petLabel, petEnabled, ROOM_OPTIONS } from '../layout.js';
import { recoveryBoxHtml, bindRecoveryCopy, ROLE_OPTS } from './auth.js';
import { supplySheet } from './supplies.js';

// ---- 푸시 알림 ----
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
export async function pushState() {
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
export async function enablePush(st) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('알림 허용이 필요해요.');
  const sub = st.sub || await st.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(st.publicKey) });
  await post('/api/push/subscribe', { subscription: sub.toJSON() });
}
// 앱을 열 때마다: 알림을 허용해 둔 기기는 구독이 살아 있는지 확인해 서버에 다시 알린다(iPhone은 구독이 풀리는 일이 있어서).
export async function syncPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || Notification.permission !== 'granted') return;
    const { publicKey } = await get('/api/push/key', { noPrompt: true });
    if (!publicKey) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
    await post('/api/push/subscribe', { subscription: sub.toJSON() }, { noPrompt: true });
  } catch { /* 어른 확인이 필요한 공용 기기 등에서는 조용히 넘어간다 */ }
}
const PUSH_WHY = { no_vapid: '서버에 푸시 키(VAPID)가 없어요.', no_sub: '이 기기가 아직 알림에 등록되지 않았어요. ‘알림 끄기’ 후 다시 켜 보세요.', failed: '푸시 서비스가 거절했어요. 알림을 껐다가 다시 켜 보세요.' };
export async function testPush() {
  const r = await post('/api/push/test');
  const via = (r.hosts || []).map((h) => (/googleapis|fcm/.test(h) ? '안드로이드(구글)' : /apple/.test(h) ? '애플' : /mozilla/.test(h) ? '파이어폭스' : h)).join(', ');
  if (r.ok) toast(`테스트 알림을 보냈어요${via ? ` (${via} 경로)` : ''}. 화면을 끄고 잠금 화면에 오는지 보세요 🔔`);
  else throw new Error(`${PUSH_WHY[r.reason] || '보내지 못했어요.'}${r.failed?.length ? ` (오류 ${r.failed.join(', ')})` : ''}`);
}
export async function disablePush(st) { if (st.sub) { await post('/api/push/unsubscribe', { endpoint: st.sub.endpoint }); await st.sub.unsubscribe(); } }

const AV = (S.info?.avatars) || [];
function memberForm(m) {
  return `<label class="field">이름<input name="name" maxlength="20" value="${esc(m.name)}" required></label>
    <div class="field"><span>아바타</span><div class="icon-pick">${(S.info.avatars || []).map((a) => `<label><input type="radio" name="avatar" value="${a}" ${a === m.avatar ? 'checked' : ''}><span>${a}</span></label>`).join('')}</div></div>
    <div class="field"><span>얼굴 사진 <small class="muted">(배경이 투명한 PNG가 가장 예뻐요. 가족만 볼 수 있어요)</small></span><div id="facepp"></div><label class="check"><input type="checkbox" name="rmphoto"> <span>사진 지우고 이모지로 되돌리기</span></label></div>
    <div class="field"><span>지낼 방 <small class="muted">(집 그림에서 서 있는 곳)</small></span><div class="room-pick"><label class="room-chip"><input type="radio" name="homeCell" value="" ${!m.homeCell ? 'checked' : ''}><span>기본 방</span></label>${ROOM_OPTIONS.map(([floor, rooms]) => `<div class="room-floor"><b>${floor}</b>${rooms.map(([c, n]) => `<label class="room-chip"><input type="radio" name="homeCell" value="${c}" ${m.homeCell === c ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>`).join('')}</div></div>
    ${m.kind === 'kid' ? `<div class="field"><span>성별 <small class="muted">(집 안 캐릭터가 달라져요)</small></span><div class="seg">${[['boy', '남자아이'], ['girl', '여자아이']].map(([v, t]) => `<label class="seg-opt"><input type="radio" name="gender" value="${v}" ${m.gender === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
    <div class="field"><span>카드 색</span><div class="color-pick">${(S.info.kidColors || []).map((c) => `<label><input type="radio" name="color" value="${c}" ${c === m.color ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div></div>` : ''}`;
}

export async function mount(el) {
  const opened = new Set(); // 펼쳐 둔 설정 칸 (다시 그려도 유지)
  const fo = (k) => (opened.has(k) ? ' open' : '');
  async function load() {
    S.info = await get('/api/me');
    const info = S.info; const dev = isDevice(); const adult = !dev || isAdultNow();
    const ps = adult ? await pushState().catch(() => ({ s: 'unsupported', msg: '' })) : null;
    const theme = (lsGet('theme', 'light') === 'dark' ? 'dark' : 'light');
    const acts = adult ? await get('/api/activities').catch(() => []) : [];
    const code = info.family.code;
    const myId = info.me?.id || S.elev?.memberId || null;
    el.innerHTML = `<header class="page-head"><h1>👨‍👩‍👧‍👦 가족</h1></header>
      <section class="card page-card"><h3>우리 가족 <small class="muted">${esc(info.family.name)}</small></h3><ul class="members">${[...info.adults, ...info.kids].map((m) => `<li>${avatar(m, 'md')}<div class="grow"><b>${esc(m.name)}</b><div class="small muted">${m.kind === 'kid' ? ({ boy: '아이 · 남자아이', girl: '아이 · 여자아이' })[m.gender] || '아이' : (Object.fromEntries(ROLE_OPTS))[m.role] || '어른'}${m.isGuardian ? ' · 부모님 권한' : ''}${m.kind === 'kid' && m.hasPin ? ' · 🔒' : ''}</div></div><div class="m-actions"><button class="btn ghost small" data-edit="${m.id}">수정</button>${m.kind === 'adult' && adult && m.id !== myId ? `<button class="btn ghost small" data-rmadult="${m.id}" aria-label="${esc(m.name)} 삭제">🗑 삭제</button>` : ''}${m.kind === 'kid' && adult ? `<button class="btn ghost small" data-pair="${m.id}">📱 폰 연결</button>` : ''}${m.kind === 'kid' ? `<button class="btn ghost small" data-pin="${m.id}">${m.hasPin ? '🔒 비번' : '🔓 비번'}</button>` : ''}</div></li>`).join('')}</ul>${adult && info.kids.length < 6 ? '<div class="row"><button class="btn ghost" id="addkid">+ 아이 추가</button></div>' : ''}</section>
      <section class="card page-card"><h3>메뉴</h3><div class="big-grid three"><a class="big-btn small" href="#/notebook"><span class="bi">📒</span><b>사진 알림장</b></a><a class="big-btn small" href="#/calendar"><span class="bi">📅</span><b>가족 달력</b></a><a class="big-btn small" href="#/adult"><span class="bi">🔑</span><b>어른 홈</b></a><a class="big-btn small" href="#/family-activity"><span class="bi">🎈</span><b>가족 활동</b></a><button class="big-btn small" id="addsup"><span class="bi">🎒</span><b>준비물 직접 추가</b></button></div></section>
      ${adult ? `<details class="card page-card fold" data-fold="act"${fo('act')}><summary><h3>⏱ 활동 설정</h3></summary><p class="muted small">활동 이름과 기본 시간을 바꿀 수 있어요. 30분 이상 활동은 5분 전에 한 번 알려 줘요.</p><ul class="rlist">${(acts || []).map((a) => `<li><span class="ri">${esc(a.icon)}</span><div class="grow"><b>${esc(a.name)}</b><div class="small muted">기본 ${a.minutes}분</div></div><button class="btn ghost small" data-act="${a.id}">수정</button><button class="btn ghost small" data-actdel="${a.id}" aria-label="삭제">🗑</button></li>`).join('')}</ul><div class="row gap wrap"><button class="btn ghost" id="addact">+ 활동 추가</button></div>
        <label class="check"><input type="checkbox" id="tsound" ${info.family.timerSound ? 'checked' : ''}> <span>활동 알람 소리 사용 <small class="muted">(거실 iPad에서 한 번 울려요)</small></span></label>${[['ruby', '갈색 고양이'], ['crystal', '하얀 고양이'], ['yeoni', '강아지']].map(([k, kind]) => `<div class="pet-block"><div class="pet-line"><label class="check"><input type="checkbox" data-pet-toggle="${k}" ${info.family.pets?.[k] !== false ? 'checked' : ''}> <span>집 그림 안에 <b>${esc(petLabel(k))}</b> 보이기 <small class="muted">(${kind})</small></span></label><button class="btn ghost small" data-pet-name="${k}">이름 짓기</button></div>
          <label class="pet-owner small">주인 <select data-pet-owner="${k}"><option value="">정하지 않음</option>${info.kids.map((kd) => `<option value="${kd.id}" ${info.family.petOwners?.[k] === kd.id ? 'selected' : ''}>${esc(kd.name)}</option>`).join('')}</select><span class="muted">(주인이 간식주기·산책하기를 해요)</span></label></div>`).join('')}</details>` : ''}
      ${adult ? `<details class="card page-card reset-card fold" data-fold="reset"${fo('reset')}><summary><h3>⚠️ 전체 리셋</h3></summary><p class="muted small">테스트하다 쌓인 기록을 한꺼번에 지워요. <b>도장·저금통·알림장·메시지·알림·타이머·준비물·일정</b>이 모두 사라지고 되돌릴 수 없어요. <b>할일·가족·얼굴 사진·활동 종류·설정</b>은 그대로 남아요.</p><button class="btn danger" id="resetall">🧹 전체 리셋</button></details>` : ''}
      ${adult && code ? `<details class="card page-card fold" data-fold="invite"${fo('invite')}><summary><h3>가족 초대</h3></summary><p class="muted small">어른은 각자 계정으로 같은 가족에 연결해요.</p><div class="code-box"><b id="code">${esc(code)}</b></div><div class="row gap wrap"><button class="btn primary" id="share">초대 링크 보내기</button><button class="btn ghost" id="copy">코드 복사</button><button class="btn ghost" id="rot">코드 새로 만들기</button></div></details>` : ''}
      <details class="card page-card fold" data-fold="screen"${fo('screen')}><summary><h3>화면·알림 설정</h3></summary>
        <div class="field"><span>테마</span><div class="seg">${[['light', '낮'], ['dark', '밤']].map(([k, t]) => `<label class="seg-opt"><input type="radio" name="theme" value="${k}" ${theme === k ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
        <div class="field"><span>배경화면 <small class="muted">(낮 테마 · 이 기기만)</small></span>${wallPickerHtml(wallCur())}</div>
        <div class="field"><span>집 그림 <small class="muted">(우리집 화면 · 온 가족)</small></span>${housePickerHtml(houseCur())}</div>
        ${adult ? `<label class="check"><input type="checkbox" id="gs" ${info.family.showGrandmaStatus ? 'checked' : ''}> <span>거실 보드에 조부모(할머니·할아버지) 상태 카드 표시</span></label>` : ''}
        ${ps ? `<div class="field"><span>휴대폰 알림</span>${ps.s === 'on' ? '<p class="ok">✅ 이 기기에서 알림을 받고 있어요</p><div class="row gap wrap"><button class="btn" id="ptest">🔔 테스트 알림 보내기</button><button class="btn ghost" id="poff">알림 끄기</button></div><p class="small muted">앱을 닫거나 화면을 꺼도 알림이 와요. 안 오면 위 버튼으로 점검해 보세요.</p><details class="push-help"><summary>🔒 잠금 화면에 알림이 안 보여요</summary><ol class="small"><li>설정 → 알림 → <b>우리집</b>을 엽니다. (목록에 없으면 홈 화면 앱에서 먼저 알림을 켜 주세요)</li><li><b>알림 허용</b>을 켭니다.</li><li>알림 표시에서 <b>잠금 화면</b>, 알림 센터, 배너를 모두 체크합니다.</li><li>방해 금지·집중 모드가 켜져 있으면 알림이 숨겨져요. 이 앱을 허용 앱에 넣어 주세요.</li><li><b>안드로이드</b>: 설정 → 앱 → 우리집(또는 Chrome) → 알림에서 알림을 켜고, ‘잠금 화면’을 <b>모든 알림 내용 표시</b>로 바꿔 주세요. 중요도는 ‘소리 및 팝업’(긴급)이 좋아요. 배터리 설정에서 이 앱을 ‘제한 없음’으로 두면 앱을 닫아도 더 잘 와요.</li><li>위의 <b>테스트 알림</b> 버튼을 눌러 잠금 화면에 오는지 확인해요.</li></ol></details>' : ps.s === 'off' ? '<button class="btn primary" id="pon">🔔 알림 허용</button>' : `<p class="muted small">${esc(ps.msg)}</p>`}</div>` : (dev ? '<p class="muted small">이 기기에서 활동 알림(앱이 닫혀 있거나 잠겨 있을 때)을 받으려면 먼저 어른 확인(🔑)을 한 뒤 이 화면에서 알림을 허용해 주세요.</p><button class="btn ghost" id="adultMode">🔑 어른 확인</button>' : '')}
      </details>
      ${!dev ? `<details class="card page-card fold" data-fold="account"${fo('account')}><summary><h3>🔑 내 계정 · 비밀번호</h3></summary>
        <p class="muted small">로그인 아이디: <b>${esc(info.me?.name || '')}</b>의 계정</p>
        <div class="row gap wrap"><button class="btn" id="chpw">비밀번호 바꾸기</button><button class="btn ghost" id="newrec">복구 코드 새로 만들기</button></div>
        <p class="small muted">복구 코드는 비밀번호를 잊었을 때 아이디와 함께 쓰는 12자리 코드예요. 새로 만들면 예전 코드는 쓸 수 없어요.</p></details>` : ''}
      <section class="card page-card"><button class="btn ghost wide" id="logout">로그아웃</button><p class="muted small center">${dev ? '거실 공용 기기 모드' : '내 휴대폰 모드'} · 우리집 v1</p></section>`;
    el.querySelectorAll('details.fold').forEach((d) => d.addEventListener('toggle', () => { d.open ? opened.add(d.dataset.fold) : opened.delete(d.dataset.fold); }));
    bind(ps);
  }
  function bind(ps) {
    const run = (fn) => async () => { try { await fn(); await load(); } catch (e) { errToast(e); } };
    $$('input[name=theme]', el).forEach((r) => r.addEventListener('change', () => { lsSet('theme', r.value); bus.emit('theme'); }));
    $$('input[name=wall]', el).forEach((r) => r.addEventListener('change', () => { lsSet('wall', r.value); bus.emit('theme'); }));
    $$('input[name=house]', el).forEach((r) => r.addEventListener('change', async () => {
      try {
        if (!isDevice() || isAdultNow()) { await patch('/api/family', { house: r.value }); S.info.family.house = r.value; lsSet('house', null); toast('집 그림을 바꿨어요 (온 가족 기기에 적용)'); } // 어른: 가족 모두에게
        else { lsSet('house', r.value); toast('이 기기의 집 그림을 바꿨어요'); } // 공용 기기에서 어른 확인 전: 이 기기만
      } catch (e) { errToast(e); }
    }));
    $('#gs', el)?.addEventListener('change', run(() => patch('/api/family', { showGrandmaStatus: $('#gs', el).checked })));
    $('#pon', el)?.addEventListener('click', run(() => enablePush(ps)));
    $('#poff', el)?.addEventListener('click', run(() => disablePush(ps)));
    $('#ptest', el)?.addEventListener('click', async () => { try { await testPush(); } catch (e) { errToast(e); } });
    $('#adultMode', el)?.addEventListener('click', async () => { if (await needAdult()) load(); });
    $('#tsound', el)?.addEventListener('change', run(() => patch('/api/family', { timerSound: $('#tsound', el).checked })));
    $$('[data-pet-toggle]', el).forEach((c) => c.addEventListener('change', run(() => patch('/api/family', { pets: { [c.dataset.petToggle]: c.checked } }))));
    $('#resetall', el)?.addEventListener('click', async () => {
      if (!(await needAdult())) return;
      try {
        const done = await formSheet({ title: '전체 리셋', submit: '모두 지우기', danger: true,
          html: '<p class="muted">도장, 저금통 기록, 알림장, 메시지, 알림, 타이머, 준비물, 일정이 <b>모두 지워지고 되돌릴 수 없어요.</b><br>할일·가족·활동 종류·설정은 남아요.</p><label class="field">계속하려면 <b>리셋</b> 이라고 입력하세요<input name="confirm" autocomplete="off" required></label>',
          onSubmit: async (v) => { await post('/api/family/reset', { confirm: v.confirm }); toast('리셋했어요'); } });
        if (done) { window.location.hash = '#/'; location.reload(); }
      } catch (e) { errToast(e); }
    });
    $('#addsup', el)?.addEventListener('click', () => supplySheet({}));
    $$('[data-pet-owner]', el).forEach((sel) => sel.addEventListener('change', async () => {
      if (!(await needAdult())) { await load(); return; }
      await run(() => put(`/api/pets/${sel.dataset.petOwner}/owner`, { kidId: sel.value ? Number(sel.value) : null }))();
    }));
    $$('[data-pet-name]', el).forEach((b) => b.addEventListener('click', async () => {
      if (!(await needAdult())) return; const k = b.dataset.petName;
      await run(() => formSheet({ title: '반려동물 이름', submit: '저장', html: `<label class="field">이름 <small class="muted">(10자까지)</small><input name="name" maxlength="10" value="${esc(S.info.family.petNames?.[k] || '')}" placeholder="이름을 지어 주세요"></label>`,
        onSubmit: (v) => patch('/api/family', { petNames: { [k]: v.name } }) }))();
    }));
    $('#addkid', el)?.addEventListener('click', async () => {
      if (!(await needAdult())) return;
      await run(() => formSheet({ title: '아이 추가', submit: '추가', html: '<label class="field">이름<input name="name" maxlength="20" required></label><div class="field"><span>성별 <small class="muted">(집 안 캐릭터가 달라져요)</small></span><div class="seg">' + [['boy', '남자아이'], ['girl', '여자아이']].map(([v, t]) => `<label class="seg-opt"><input type="radio" name="gender" value="${v}"><span>${t}</span></label>`).join('') + '</div></div><p class="small muted">추가한 뒤 할일(루틴)을 만들어 주세요.</p>',
        onSubmit: (v) => { if (!v.gender) throw new Error('성별을 골라 주세요.'); return post('/api/kids', { name: v.name, gender: v.gender }); } }))();
    });
    $('#chpw', el)?.addEventListener('click', run(() => formSheet({ title: '비밀번호 바꾸기', submit: '바꾸기',
      html: '<label class="field">지금 비밀번호<input name="oldPassword" type="password" autocomplete="current-password" required></label><label class="field">새 비밀번호 <small class="muted">(6자 이상)</small><input name="newPassword" type="password" autocomplete="new-password" required></label><label class="field">새 비밀번호 한 번 더<input name="newPassword2" type="password" autocomplete="new-password" required></label><p class="small muted">바꾸면 다른 기기의 로그인은 풀려요.</p>',
      onSubmit: async (v) => { if (v.newPassword !== v.newPassword2) throw new Error('새 비밀번호가 서로 달라요.'); await post('/api/me/password', { oldPassword: v.oldPassword, newPassword: v.newPassword }); toast('비밀번호를 바꿨어요'); } })));
    $('#newrec', el)?.addEventListener('click', run(async () => {
      const r = await formSheet({ title: '복구 코드 새로 만들기', submit: '만들기', html: '<p class="muted">새로 만들면 예전 복구 코드는 쓸 수 없어요. 비밀번호를 한 번 더 확인할게요.</p><label class="field">비밀번호<input name="password" type="password" autocomplete="current-password" required></label>',
        onSubmit: (v) => post('/api/me/recovery', { password: v.password }) });
      if (!r?.recoveryCode) return;
      const sh = openSheet(`<h2>새 복구 코드</h2><p class="muted">지금만 볼 수 있어요. 캡처하거나 적어 두세요.</p>${recoveryBoxHtml(r.recoveryCode)}<div class="row end"><button class="btn primary" data-close>저장했어요</button></div>`);
      bindRecoveryCopy(sh.el, r.recoveryCode);
    }));
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
      if (ed) { if (!(await needAdult())) return; const all = [...S.info.adults, ...S.info.kids]; const m = all.find((x) => x.id === Number(ed.dataset.edit)); const picker = photoPicker({ kind: 'avatar', label: '얼굴', alpha: true });
        if (m.avatarUrl) { picker.state.id = null; $('img', picker).src = m.avatarUrl; $('.photo-preview', picker).hidden = false; }
        setTimeout(() => document.getElementById('facepp')?.appendChild(picker), 0);
        await run(() => formSheet({ title: `${m.name} 수정`, submit: '저장', cls: 'tall', html: memberForm(m), onSubmit: (v) => {
          if (picker.state.busy) throw new Error('사진을 올리는 중이에요. 잠깐만요.');
          const body = { name: v.name, avatar: v.avatar, ...(v.color ? { color: v.color } : {}), ...(v.gender ? { gender: v.gender } : {}), homeCell: v.homeCell || null };
          if (v.rmphoto === 'on') body.photoId = null; else if (picker.state.id) body.photoId = picker.state.id;
          return patch(`/api/members/${m.id}`, body);
        } }))(); }
      const pr = e.target.closest('[data-pair]');
      if (pr) { if (!(await needAdult())) return; await pairSheet(S.info.kids.find((x) => x.id === Number(pr.dataset.pair))); return; }
      const rm = e.target.closest('[data-rmadult]');
      if (rm) {
        if (!(await needAdult())) return;
        const m = S.info.adults.find((x) => x.id === Number(rm.dataset.rmadult));
        if (await confirmDialog(`${m.name}(어른) 계정을 삭제할까요? 가족 목록에서 사라지고 로그인할 수 없게 돼요. 이 어른에게 온 대기 중인 요청은 취소돼요.`, { danger: true, yes: '삭제' })) await run(async () => { await del(`/api/members/${m.id}`); toast('삭제했어요'); })();
        return;
      }
      const ae = e.target.closest('[data-act]'); const ad = e.target.closest('[data-actdel]');
      if (ae) { if (!(await needAdult())) return; const a = (await get('/api/activities')).find((x) => x.id === Number(ae.dataset.act)); await run(() => formSheet({ title: `${a.name} 수정`, submit: '저장', html: `<label class="field">활동 이름<input name="name" maxlength="20" value="${esc(a.name)}" required></label><label class="field">아이콘<input name="icon" maxlength="4" value="${esc(a.icon)}"></label><label class="field">기본 시간(분)<input name="minutes" inputmode="numeric" value="${a.minutes}"></label>`, onSubmit: (v) => patch(`/api/activities/${a.id}`, { name: v.name, icon: v.icon, minutes: Number(v.minutes) }) }))(); }
      if (ad) { if (!(await needAdult())) return; if (await confirmDialog('이 활동을 지울까요? 연결된 할일의 활동 버튼도 사라져요.', { danger: true })) await run(() => del(`/api/activities/${ad.dataset.actdel}`))(); }
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

// 아이 폰 연결: 일회용 코드 만들기 + 연결된 폰 목록/해제
async function pairSheet(kid) {
  const dev = await get(`/api/kids/${kid.id}/devices`);
  const sh = openSheet(`<h2>${avatar(kid, 'sm')} ${esc(kid.name)}의 휴대폰 연결</h2>
    <p class="muted">${esc(kid.name)}의 폰에서 앱 주소를 열고 <b>‘아이 폰 연결’</b>을 눌러 아래 코드를 입력해요. 코드는 10분 동안, 한 번만 쓸 수 있어요.</p>
    <div class="code-box" id="pcode"><button class="btn primary big" id="mk">코드 만들기</button></div>
    <h3>연결된 폰</h3>
    <ul class="members" id="devs">${dev.length ? dev.map((d) => `<li><span>📱</span><div class="grow"><b>${esc(d.label)}</b><div class="small muted">${new Date(d.connectedAt + 9 * 3600e3).toISOString().slice(0, 10)} 연결${d.push ? ' · 알림 켜짐' : ''}</div></div><button class="btn ghost small" data-rev="${d.id}">연결 해제</button></li>`).join('') : '<li class="muted">아직 연결된 폰이 없어요</li>'}</ul>
    <div class="row end"><button class="btn ghost" data-close>닫기</button></div>`);
  sh.el.addEventListener('click', async (e) => {
    try {
      if (e.target.closest('#mk')) {
        const r = await post(`/api/kids/${kid.id}/pair-code`);
        $('#pcode', sh.el).innerHTML = `<b>${esc(r.code.slice(0, 3))} ${esc(r.code.slice(3))}</b><p class="small muted">10분 안에 입력해 주세요</p>`;
      }
      const rv = e.target.closest('[data-rev]');
      if (rv && await confirmDialog('이 폰의 연결을 끊을까요? 이 폰에서는 바로 로그아웃돼요.', { danger: true, yes: '연결 해제' })) {
        await del(`/api/kid-devices/${rv.dataset.rev}`); toast('연결을 해제했어요'); sh.close(); pairSheet(kid);
      }
    } catch (x) { errToast(x); }
  });
}
