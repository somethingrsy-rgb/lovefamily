import { $, $$, esc } from '../util.js';
import { post, ApiError } from '../api.js';

const shellHtml = (title, body) => `<div class="auth-card card"><div class="auth-logo">🏠</div><h1>${title}</h1>${body}</div>`;
const errText = (x) => (x instanceof ApiError || x?.net ? x.message : '문제가 생겼어요. 다시 해 주세요.');
const bindForm = (el, fn) => {
  const f = $('form', el); const err = $('.form-err', el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true;
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try { await fn(Object.fromEntries(new FormData(f).entries()), f); }
    catch (x) { err.textContent = errText(x); err.hidden = false; btn.disabled = false; }
  });
};
export const ROLE_OPTS = [['mom', '엄마'], ['dad', '아빠'], ['grandma', '할머니'], ['grandpa', '할아버지'], ['other', '기타 어른']];
const roles = (name = 'role', def = 'mom') => `<div class="seg" role="radiogroup" aria-label="나는">${ROLE_OPTS.map(([v, t]) => `<label class="seg-opt"><input type="radio" name="${name}" value="${v}" ${v === def ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`;

// ---- 복구 코드 보여 주기 (가입·참여·비밀번호 재설정 뒤 / 가족 탭에서 새로 만들 때) ----
export const recoveryBoxHtml = (code) => `<div class="recovery-box"><b id="recCode" aria-label="복구 코드">${esc(code)}</b></div>
  <div class="row gap wrap center"><button type="button" class="btn" id="recCopy">📋 복사하기</button></div>`;
export function bindRecoveryCopy(root, code) {
  $('#recCopy', root)?.addEventListener('click', () => { navigator.clipboard?.writeText(code).then(() => { $('#recCopy', root).textContent = '✅ 복사했어요'; }).catch(() => { $('#recCopy', root).textContent = code; }); });
}
function recoveryScreen(el, { code, title, lead, familyCode, button, onDone }) {
  el.innerHTML = shellHtml(title, `<p class="center">${lead}</p>${recoveryBoxHtml(code)}
    <div class="recovery-note small"><b>복구 코드가 왜 필요해요?</b><br>비밀번호를 잊어버렸을 때 <b>아이디 + 이 코드</b>로 새 비밀번호를 정해요. 이메일을 받지 않아서, 이 코드가 없으면 되찾을 수 없어요.<br>지금만 볼 수 있으니 <b>캡처하거나 적어서</b> 가족이 아는 안전한 곳에 두세요. (나중에 가족 탭에서 새로 만들 수도 있어요)</div>
    ${familyCode ? `<div class="recovery-note small"><b>다른 어른을 초대하려면</b><br>가족 코드 <b class="mono">${esc(familyCode)}</b> 를 알려 주거나, 가족 탭의 <b>가족 초대</b>에서 링크를 보내요.</div>` : ''}
    <label class="check"><input type="checkbox" id="recOk"> <span>복구 코드를 저장했어요</span></label>
    <button class="btn primary big wide" id="recGo" disabled>${button}</button>`);
  bindRecoveryCopy(el, code);
  $('#recOk', el).addEventListener('change', (e) => { $('#recGo', el).disabled = !e.target.checked; });
  $('#recGo', el).addEventListener('click', onDone);
}

export async function login(el) {
  el.innerHTML = shellHtml('우리집', `<p class="muted center">어른 계정으로 로그인해요</p>
    <form novalidate><label class="field">아이디<input name="loginId" autocomplete="username" autocapitalize="none" required></label>
    <label class="field">비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
    <label class="check"><input type="checkbox" name="device"> <span>거실 공용 기기로 쓸게요 <small class="muted">(아이들이 직접 체크하는 기기)</small></span></label>
    <p class="form-err" role="alert" hidden></p><button class="btn primary big wide" type="submit">로그인</button></form>
    <div class="auth-links"><a href="#/register">새 가족 만들기</a><a href="#/join">가족 코드로 참여</a></div>
    <div class="auth-links single"><a href="#/reset">비밀번호를 잊었어요</a></div>
    <div class="auth-links"><a class="btn big wide" href="#/pair">📱 아이 폰 연결</a></div>`);
  bindForm(el, async (v) => { await post('/api/auth/login', { loginId: v.loginId, password: v.password, device: !!v.device }); await window.__app.afterLogin(); });
}

// ---- 새 가족 만들기: 5단계 마법사 (계정 → 가족 → 아이 → 반려동물 → 집) ----
const STEPS = ['계정', '가족', '아이', '반려동물', '집'];
const MAX_WIZ_KIDS = 4;
const PETS = [['ruby', '갈색 고양이', '/assets/cats/ruby-sit.webp'], ['crystal', '하얀 고양이', '/assets/cats/crystal-sit.webp'], ['yeoni', '강아지', '/assets/dog/dog-sit.webp']];
const HOUSE_PICKS = [['pastel', '보라 집', '/assets/house-t.webp'], ['xmas', '크리스마스 집', '/assets/house-xmas-t.webp']];

export async function register(el) {
  const W = { loginId: '', password: '', password2: '', familyName: '우리집', role: 'mom', name: '', kids: [{ name: '', gender: '' }], pets: { ruby: false, crystal: false, yeoni: false }, petNames: { ruby: '', crystal: '', yeoni: '' }, petOwners: { ruby: '', crystal: '', yeoni: '' }, house: 'pastel' };
  let step = 0;
  const dots = () => `<ol class="wiz-steps" aria-label="가입 단계">${STEPS.map((n, i) => `<li class="${i === step ? 'on' : i < step ? 'done' : ''}" ${i === step ? 'aria-current="step"' : ''}><i>${i < step ? '✓' : i + 1}</i><span>${n}</span></li>`).join('')}</ol>`;
  const body = () => {
    if (step === 0) return `<p class="muted center">앞으로 로그인에 쓸 계정을 만들어요</p>
      <label class="field">아이디 <small class="muted">(3자 이상)</small><input name="loginId" autocomplete="username" autocapitalize="none" value="${esc(W.loginId)}" required></label>
      <label class="field">비밀번호 <small class="muted">(6자 이상)</small><input name="password" type="password" autocomplete="new-password" value="${esc(W.password)}" required></label>
      <label class="field">비밀번호 한 번 더<input name="password2" type="password" autocomplete="new-password" value="${esc(W.password2)}" required></label>`;
    if (step === 1) return `<p class="muted center">우리 가족을 소개해 주세요</p>
      <label class="field">가족 이름<input name="familyName" value="${esc(W.familyName)}" maxlength="30"></label>
      <div class="field"><span>나는</span>${roles('role', W.role)}</div>
      <label class="field">내 이름 <small class="muted">(비우면 역할 이름으로 보여요)</small><input name="name" value="${esc(W.name)}" maxlength="20" placeholder="${esc(ROLE_OPTS.find(([v]) => v === W.role)[1])}"></label>
      <p class="small muted">할머니·할아버지·다른 어른은 가입한 뒤 <b>가족 코드</b>로 각자 참여해요.</p>`;
    if (step === 2) return `<p class="muted center">아이의 이름과 성별을 알려 주세요 <small>(캐릭터 모습이 달라져요)</small></p>
      ${W.kids.map((k, i) => `<div class="kid-row"><label class="field grow">${i + 1}번째 아이<input name="kname${i}" value="${esc(k.name)}" maxlength="20" placeholder="이름"></label>
        <div class="seg" role="radiogroup" aria-label="${i + 1}번째 아이 성별">${[['boy', '남자아이'], ['girl', '여자아이']].map(([v, t]) => `<label class="seg-opt"><input type="radio" name="kgender${i}" value="${v}" ${k.gender === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
        ${i > 0 ? `<button type="button" class="btn ghost small" data-rmkid="${i}" aria-label="${i + 1}번째 아이 빼기">✕</button>` : ''}</div>`).join('')}
      ${W.kids.length < MAX_WIZ_KIDS ? '<button type="button" class="btn ghost" id="addKid">+ 아이 추가</button>' : '<p class="small muted">더 필요하면 가입한 뒤 가족 탭에서 추가할 수 있어요 (최대 6명)</p>'}`;
    if (step === 3) return `<p class="muted center">집 안을 돌아다닐 반려동물을 골라 주세요 <small>(없어도 괜찮아요)</small></p>
      <div class="pet-pick">${PETS.map(([id, d, img]) => `<label class="pet-opt"><input type="checkbox" name="pet" value="${id}" ${W.pets[id] ? 'checked' : ''}><span class="pet-card"><img src="${img}" alt="" draggable="false"><b>${esc(W.petNames[id] || d)}</b><small>${W.petNames[id] ? d : '이름을 지어 주세요'}</small></span></label>`).join('')}</div>
      <div class="pet-names">${PETS.filter(([id]) => W.pets[id]).map(([id, d]) => `<div class="pet-setup"><label class="field">${d} 이름<input name="pn_${id}" maxlength="10" value="${esc(W.petNames[id])}" placeholder="이름을 지어 주세요"></label>
        <label class="field">주인 <small class="muted">(간식주기·산책하기를 해요)</small><select name="po_${id}"><option value="">나중에 정할게요</option>${W.kids.filter((k) => k.name).map((k, i) => `<option value="${i}" ${String(W.petOwners[id]) === String(i) ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label></div>`).join('')}</div>`;
    return `<p class="muted center">우리 집 그림을 골라 주세요 <small>(나중에 바꿀 수 있어요)</small></p>
      <div class="wall-grid house-grid">${HOUSE_PICKS.map(([k, n, t]) => `<label class="wall-opt"><input type="radio" name="house" value="${k}" ${W.house === k ? 'checked' : ''}><span class="wall-thumb house-thumb" style="background-image:url(${t})"></span><b>${n}</b></label>`).join('')}</div>
      <p class="small muted center">아이는 순서대로 2층 방에, 엄마·아빠·할머니는 아래층 방에 살아요. 셋째 아이부터는 거실에서 지내요.</p>`;
  };
  // 지금 화면의 입력을 W 에 저장
  const save = () => {
    const g = (n) => el.querySelector(`[name="${n}"]`);
    if (step === 0) { W.loginId = g('loginId').value.trim(); W.password = g('password').value; W.password2 = g('password2').value; }
    else if (step === 1) { W.familyName = g('familyName').value.trim(); W.role = el.querySelector('[name=role]:checked')?.value || 'mom'; W.name = g('name').value.trim(); }
    else if (step === 2) W.kids = W.kids.map((_, i) => ({ name: g(`kname${i}`).value.trim(), gender: el.querySelector(`[name=kgender${i}]:checked`)?.value || '' }));
    else if (step === 3) {
      W.pets = { ruby: false, crystal: false, yeoni: false, ...Object.fromEntries($$('[name=pet]:checked', el).map((c) => [c.value, true])) };
      for (const [id] of PETS) { const i = el.querySelector(`[name=pn_${id}]`); if (i) W.petNames[id] = i.value.trim(); const o = el.querySelector(`[name=po_${id}]`); if (o) W.petOwners[id] = o.value; }
    }
    else W.house = el.querySelector('[name=house]:checked')?.value || 'pastel';
  };
  const check = () => {
    if (step === 0) {
      if (W.loginId.length < 3) return '아이디는 3자 이상으로 해 주세요.';
      if (W.password.length < 6) return '비밀번호는 6자 이상으로 해 주세요.';
      if (W.password !== W.password2) return '비밀번호가 서로 달라요. 한 번 더 확인해 주세요.';
    }
    if (step === 1 && !W.familyName) return '가족 이름을 적어 주세요.';
    if (step === 2) {
      const named = W.kids.filter((k) => k.name);
      if (!named.length) return '아이 이름을 한 명 이상 적어 주세요.';
      if (named.some((k) => !k.gender)) return '아이의 성별을 골라 주세요.';
    }
    if (step === 3) { const miss = PETS.find(([id]) => W.pets[id] && !W.petNames[id]); if (miss) return `${miss[1]}의 이름을 지어 주세요.`; }
    return '';
  };
  function render() {
    el.innerHTML = shellHtml('새 가족 만들기', `${dots()}<form novalidate>${body()}<p class="form-err" role="alert" hidden></p>
      <div class="wiz-nav">${step > 0 ? '<button type="button" class="btn big" id="wizBack">이전</button>' : '<a class="btn ghost big" href="#/login">취소</a>'}<button class="btn primary big grow" type="submit">${step === STEPS.length - 1 ? '가족 만들기' : '다음'}</button></div></form>`);
    $('#addKid', el)?.addEventListener('click', () => { save(); W.kids.push({ name: '', gender: '' }); render(); $$('[name^=kname]', el).at(-1)?.focus(); });
    $$('[data-rmkid]', el).forEach((b) => b.addEventListener('click', () => { save(); W.kids.splice(Number(b.dataset.rmkid), 1); render(); }));
    $$('[name=role]', el).forEach((r) => r.addEventListener('change', () => { save(); render(); })); // 역할을 바꾸면 이름 안내 글이 바뀐다
    $$('[name=pet]', el).forEach((c) => c.addEventListener('change', () => { save(); render(); })); // 동물을 고르면 이름 칸이 나온다
    $('#wizBack', el)?.addEventListener('click', () => { save(); step--; render(); });
    $('form', el).addEventListener('submit', async (e) => {
      e.preventDefault(); save();
      const err = $('.form-err', el); const m = check();
      if (m) { err.textContent = m; err.hidden = false; return; }
      if (step < STEPS.length - 1) { step++; render(); window.scrollTo?.(0, 0); return; }
      const btn = $('button[type=submit]', el); btn.disabled = true; err.hidden = true;
      try {
        const kids = W.kids.filter((k) => k.name);
        const r = await post('/api/auth/register', { loginId: W.loginId, password: W.password, role: W.role, name: W.name || undefined, familyName: W.familyName, kids, pets: W.pets, petNames: Object.fromEntries(Object.entries(W.petNames).filter(([id]) => W.pets[id])), petOwners: Object.fromEntries(Object.entries(W.petOwners).filter(([id, v]) => W.pets[id] && v !== '').map(([id, v]) => [id, Number(v)])), house: W.house });
        recoveryScreen(el, { code: r.recoveryCode, familyCode: r.familyCode, title: '가족이 만들어졌어요 🎉', lead: '마지막으로, <b>복구 코드</b>를 꼭 저장해 주세요.', button: '우리집 시작하기', onDone: () => window.__app.afterLogin() });
      } catch (x) {
        err.textContent = errText(x); err.hidden = false; btn.disabled = false;
        if (/아이디/.test(err.textContent)) { step = 0; render(); const e2 = $('.form-err', el); e2.textContent = errText(x); e2.hidden = false; }
      }
    });
  }
  render();
}

export async function join(el, params) {
  el.innerHTML = shellHtml('가족 코드로 참여', `<p class="muted center">초대 링크나 가족 코드로 같은 가족에 연결해요</p><form novalidate>
    <label class="field">가족 코드<input name="code" value="${esc(params.code || '')}" autocapitalize="characters" maxlength="12" required></label>
    <div class="field">나는 ${roles('role', 'grandma')}</div>
    <label class="field">내 이름<input name="name" maxlength="20" placeholder="할머니"></label>
    <label class="field">아이디<input name="loginId" autocomplete="username" autocapitalize="none" required></label>
    <label class="field">비밀번호 <small class="muted">(6자 이상)</small><input name="password" type="password" autocomplete="new-password" required></label>
    <p class="form-err" role="alert" hidden></p><button class="btn primary big wide" type="submit">참여하기</button></form>
    <div class="auth-links"><a href="#/login">로그인으로 돌아가기</a></div>`);
  bindForm(el, async (v) => {
    const r = await post('/api/auth/join', { code: v.code, loginId: v.loginId, password: v.password, role: v.role, name: v.name || undefined });
    recoveryScreen(el, { code: r.recoveryCode, title: '참여했어요 🎉', lead: '비밀번호를 잊을 때를 위해 <b>복구 코드</b>를 저장해 주세요.', button: '우리집 시작하기', onDone: () => window.__app.afterLogin() });
  });
}

// ---- 비밀번호 재설정: 아이디 + 복구 코드 → 새 비밀번호 ----
export async function reset(el) {
  el.innerHTML = shellHtml('비밀번호 다시 정하기', `<p class="muted center">가입할 때 받은 <b>복구 코드</b>(12자리)가 필요해요</p>
    <form novalidate><label class="field">아이디<input name="loginId" autocomplete="username" autocapitalize="none" required></label>
    <label class="field">복구 코드<input name="recoveryCode" autocapitalize="characters" autocomplete="off" placeholder="XXXX-XXXX-XXXX" maxlength="20" style="letter-spacing:2px" required></label>
    <label class="field">새 비밀번호 <small class="muted">(6자 이상)</small><input name="newPassword" type="password" autocomplete="new-password" required></label>
    <label class="field">새 비밀번호 한 번 더<input name="newPassword2" type="password" autocomplete="new-password" required></label>
    <p class="form-err" role="alert" hidden></p><button class="btn primary big wide" type="submit">비밀번호 바꾸기</button></form>
    <details class="push-help"><summary>복구 코드가 없어요</summary><p class="small">같은 가족의 <b>부모님 권한 어른</b>이 있다면, 그 분이 가족 탭에서 내 계정을 <b>삭제</b>한 뒤 가족 코드로 새로 참여할 수 있어요. 혼자 쓰는 계정이라면 새 가족을 만들어야 해요.</p></details>
    <div class="auth-links"><a href="#/login">로그인으로 돌아가기</a></div>`);
  bindForm(el, async (v) => {
    if (v.newPassword !== v.newPassword2) throw new ApiError(400, { error: 'mismatch', message: '새 비밀번호가 서로 달라요.' });
    const r = await post('/api/auth/reset-password', { loginId: v.loginId, recoveryCode: v.recoveryCode, newPassword: v.newPassword });
    recoveryScreen(el, { code: r.recoveryCode, title: '비밀번호를 바꿨어요 ✅', lead: '이제 새 비밀번호로 로그인해요.<br>방금 쓴 복구 코드는 쓸 수 없어요. <b>새 복구 코드</b>를 저장해 주세요.', button: '로그인하러 가기', onDone: () => { location.hash = '#/login'; } });
  });
}

// 아이 폰 연결: 어른이 만든 6자리 코드를 입력하면 이 폰은 그 아이 전용이 된다
export async function pair(el) {
  el.innerHTML = shellHtml('아이 폰 연결', `<p class="muted center">어른에게 받은 6자리 코드를 넣어 주세요</p>
    <form novalidate><label class="field">연결 코드<input name="code" autocapitalize="characters" autocomplete="off" maxlength="8" inputmode="text" style="font-size:2rem;text-align:center;letter-spacing:6px" required></label>
    <p class="form-err" role="alert" hidden></p><button class="btn primary big wide" type="submit">연결하기</button></form>
    <div class="auth-links"><a href="#/login">돌아가기</a></div>`);
  bindForm(el, async (v) => { await post('/api/auth/kid-pair', { code: v.code }); await window.__app.afterLogin(); });
}
