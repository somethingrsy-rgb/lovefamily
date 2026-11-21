import { $, esc } from '../util.js';
import { post, ApiError } from '../api.js';

const shellHtml = (title, body) => `<div class="auth-card card"><div class="auth-logo">🏠</div><h1>${title}</h1>${body}</div>`;
const bindForm = (el, fn) => {
  const f = $('form', el); const err = $('.form-err', el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true;
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try { await fn(Object.fromEntries(new FormData(f).entries()), f); }
    catch (x) { err.textContent = x instanceof ApiError || x.net ? x.message : '문제가 생겼어요. 다시 해 주세요.'; err.hidden = false; btn.disabled = false; }
  });
};
const roles = (name = 'role', def = 'mom') => `<div class="seg" role="radiogroup" aria-label="나는">${[['mom', '엄마'], ['dad', '아빠'], ['grandma', '할머니'], ['other', '기타']].map(([v, t]) => `<label class="seg-opt"><input type="radio" name="${name}" value="${v}" ${v === def ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`;

export async function login(el) {
  el.innerHTML = shellHtml('우리집', `<p class="muted center">어른 계정으로 로그인해요</p>
    <form novalidate><label class="field">아이디<input name="loginId" autocomplete="username" autocapitalize="none" required></label>
    <label class="field">비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
    <label class="check"><input type="checkbox" name="device"> <span>거실 공용 기기로 쓸게요 <small class="muted">(아이들이 직접 체크하는 기기)</small></span></label>
    <p class="form-err" role="alert" hidden></p><button class="btn primary big wide" type="submit">로그인</button></form>
    <div class="auth-links"><a href="#/register">새 가족 만들기</a><a href="#/join">가족 코드로 참여</a></div>
    <div class="auth-links"><a class="btn big wide" href="#/pair">📱 아이 폰 연결</a></div>`);
  bindForm(el, async (v) => { await post('/api/auth/login', { loginId: v.loginId, password: v.password, device: !!v.device }); await window.__app.afterLogin(); });
}

export async function register(el) {
  el.innerHTML = shellHtml('새 가족 만들기', `<form novalidate><label class="field">가족 이름<input name="familyName" value="우리집" maxlength="30"></label>
    <div class="field">나는 ${roles()}</div>
    <label class="field">내 이름<input name="name" placeholder="엄마" maxlength="20"></label>
    <div class="grid2"><label class="field">첫째 아이<input name="k1" value="유엘" maxlength="20"></label><label class="field">둘째 아이<input name="k2" value="유하" maxlength="20"></label></div>
    <label class="field">아이디<input name="loginId" autocomplete="username" autocapitalize="none" required></label>
    <label class="field">비밀번호 <small class="muted">(6자 이상)</small><input name="password" type="password" autocomplete="new-password" required></label>
    <p class="form-err" role="alert" hidden></p><button class="btn primary big wide" type="submit">가족 만들기</button></form>
    <div class="auth-links"><a href="#/login">로그인으로 돌아가기</a></div>`);
  bindForm(el, async (v) => {
    const kids = [v.k1, v.k2].filter((n) => n && n.trim()).map((name, i) => ({ name, avatar: ['🐰', '🐱'][i], color: ['#bfe3ff', '#e4d4ff'][i] }));
    await post('/api/auth/register', { loginId: v.loginId, password: v.password, role: v.role, name: v.name || undefined, familyName: v.familyName, kids });
    await window.__app.afterLogin();
  });
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
  bindForm(el, async (v) => { await post('/api/auth/join', { code: v.code, loginId: v.loginId, password: v.password, role: v.role, name: v.name || undefined }); await window.__app.afterLogin(); });
}

// 아이 폰 연결: 어른이 만든 6자리 코드를 입력하면 이 폰은 그 아이 전용이 된다
export async function pair(el) {
  el.innerHTML = shellHtml('아이 폰 연결', `<p class="muted center">어른에게 받은 6자리 코드를 넣어 주세요</p>
    <form novalidate><label class="field">연결 코드<input name="code" autocapitalize="characters" autocomplete="off" maxlength="8" inputmode="text" style="font-size:2rem;text-align:center;letter-spacing:6px" required></label>
    <p class="form-err" role="alert" hidden></p><button class="btn primary big wide" type="submit">연결하기</button></form>
    <div class="auth-links"><a href="#/login">돌아가기</a></div>`);
  bindForm(el, async (v) => { await post('/api/auth/kid-pair', { code: v.code }); await window.__app.afterLogin(); });
}
