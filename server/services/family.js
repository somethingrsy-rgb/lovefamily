import { err, text, oneOf, hashPassword, verifyPassword, randToken, randCode, sha256 } from '../util.js';
import { ELEVATION_MS, UNLOCK_MS } from '../ctx.js';

export const ROLES = ['mom', 'dad', 'grandma', 'other'];
export const ROLE_LABEL = { mom: '엄마', dad: '아빠', grandma: '할머니', other: '어른' };
export const AVATARS = ['🐰', '🐱', '🐻', '🐶', '🦊', '🐼', '🐥', '🦄', '🐯', '🐸', '🐧', '🐨', '🌸', '⭐', '👧', '👦', '👩', '👨', '👵', '👴'];
export const KID_COLORS = ['#bfe3ff', '#e4d4ff', '#ffd9e6', '#ffe9b8', '#cdeccf', '#ffd8bd'];
const DEFAULT_ADULT = { mom: ['👩', '#ffd9e6'], dad: ['👨', '#cfe4ff'], grandma: ['👵', '#ffe9b8'], other: ['🙂', '#e8e0f5'] };
const SESSION_DAYS = { user: 30, device: 120 };

// 가입/로그인 시도 제한 (메모리). 코어 객체에 붙여 둔다.
function throttle(core, key, { check = false, fail = false, clear = false } = {}) {
  const m = (core.loginAttempts ||= new Map());
  const now = core.now();
  let r = m.get(key);
  if (!r || r.until < now) r = { n: 0, until: now + 10 * 60 * 1000 };
  if (check && r.n >= 8) throw err(429, 'too_many', '시도가 너무 많아요. 잠시 후 다시 해 주세요.');
  if (fail) { r.n++; m.set(key, r); }
  if (clear) m.delete(key);
}

function newSession(core, { familyId, kind, userId, memberId }) {
  const token = randToken();
  const now = core.now();
  core.insert('INSERT INTO sessions (token_hash, family_id, kind, user_id, member_id, created_at, expires_at) VALUES (?,?,?,?,?,?,?)',
    sha256(token), familyId, kind, userId, memberId, now, now + SESSION_DAYS[kind] * 864e5);
  return { token, maxAge: SESSION_DAYS[kind] * 86400 };
}

function validateCreds(loginId, password) {
  const login = text(loginId, '아이디', { min: 3, max: 60 });
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) throw err(400, 'bad_password', '비밀번호는 6자 이상으로 해 주세요.');
  return login;
}

function addAdult(core, { familyId, userId, role, name, guardian }) {
  const [avatar, color] = DEFAULT_ADULT[role];
  const sort = core.get('SELECT COUNT(*) c FROM members WHERE family_id = ? AND kind = ?', familyId, 'adult').c;
  return core.insert(
    'INSERT INTO members (family_id, kind, role, name, avatar, color, user_id, is_guardian, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    familyId, 'adult', role, name, avatar, color, userId, guardian ? 1 : 0, sort, core.now());
}

export function register(core, b) {
  const login = validateCreds(b.loginId, b.password);
  const role = oneOf(b.role || 'mom', ROLES, '역할');
  const famName = text(b.familyName || '우리집', '가족 이름', { max: 30 });
  const name = text(b.name || ROLE_LABEL[role], '이름', { max: 20 });
  return core.tx(() => {
    if (core.get('SELECT 1 FROM users WHERE login_id = ?', login)) throw err(409, 'login_taken', '이미 사용 중인 아이디예요.');
    const userId = core.insert('INSERT INTO users (login_id, pw_hash, created_at) VALUES (?,?,?)', login, hashPassword(b.password), core.now());
    const familyId = core.insert('INSERT INTO families (name, code, created_at) VALUES (?,?,?)', famName, randCode(8), core.now());
    const memberId = addAdult(core, { familyId, userId, role, name, guardian: true });
    const kids = Array.isArray(b.kids) && b.kids.length ? b.kids : [{ name: '유엘', avatar: '🐰', color: KID_COLORS[0] }, { name: '유하', avatar: '🐱', color: KID_COLORS[1] }];
    kids.slice(0, 6).forEach((k, i) => {
      core.insert('INSERT INTO members (family_id, kind, role, name, avatar, color, sort, created_at) VALUES (?,?,?,?,?,?,?,?)',
        familyId, 'kid', 'kid', text(k.name, '아이 이름', { max: 20 }), k.avatar || AVATARS[i], k.color || KID_COLORS[i % KID_COLORS.length], i, core.now());
    });
    return { familyId, memberId, userId, session: newSession(core, { familyId, kind: 'user', userId, memberId }) };
  });
}

export function join(core, b) {
  const login = validateCreds(b.loginId, b.password);
  const code = text(b.code, '가족 코드', { max: 20 }).toUpperCase();
  const role = oneOf(b.role || 'other', ROLES, '역할');
  return core.tx(() => {
    const fam = core.get('SELECT * FROM families WHERE code = ?', code);
    if (!fam) throw err(404, 'bad_code', '가족 코드를 찾을 수 없어요. 다시 확인해 주세요.');
    if (core.adults(fam.id).length >= 8) throw err(409, 'family_full', '어른 계정은 최대 8명까지예요.');
    if (core.get('SELECT 1 FROM users WHERE login_id = ?', login)) throw err(409, 'login_taken', '이미 사용 중인 아이디예요.');
    const userId = core.insert('INSERT INTO users (login_id, pw_hash, created_at) VALUES (?,?,?)', login, hashPassword(b.password), core.now());
    const memberId = addAdult(core, { familyId: fam.id, userId, role, name: text(b.name || ROLE_LABEL[role], '이름', { max: 20 }), guardian: role === 'mom' || role === 'dad' });
    core.refresh(fam.id, 'family');
    return { familyId: fam.id, memberId, userId, session: newSession(core, { familyId: fam.id, kind: 'user', userId, memberId }) };
  });
}

export function login(core, b, ip = '') {
  const loginId = text(b.loginId, '아이디', { max: 60 });
  const key = `${loginId.toLowerCase()}|${ip}`;
  throttle(core, key, { check: true });
  const user = core.get('SELECT * FROM users WHERE login_id = ?', loginId);
  if (!user || !verifyPassword(String(b.password || ''), user.pw_hash)) {
    throttle(core, key, { fail: true });
    throw err(401, 'bad_login', '아이디 또는 비밀번호가 맞지 않아요.');
  }
  throttle(core, key, { clear: true });
  const member = core.get("SELECT * FROM members WHERE user_id = ? AND kind = 'adult' ORDER BY id LIMIT 1", user.id);
  if (!member) throw err(404, 'no_family', '연결된 가족이 없어요.');
  const kind = b.device ? 'device' : 'user';
  return { familyId: member.family_id, memberId: member.id, session: newSession(core, { familyId: member.family_id, kind, userId: user.id, memberId: kind === 'user' ? member.id : null }) };
}

export function logout(core, ctx) {
  core.run('DELETE FROM elevations WHERE session_id = ?', ctx.session.id);
  core.run('DELETE FROM kid_unlocks WHERE session_id = ?', ctx.session.id);
  core.run('DELETE FROM sessions WHERE id = ?', ctx.session.id);
}

// 공용 기기에서 어른 권한이 필요할 때: 어른 선택 + 비밀번호 → 10분짜리 elevation 토큰
export function reauth(core, ctx, b, ip = '') {
  const adultId = Number(b.memberId) || ctx.session.member_id;
  const adult = ctx.adultMember(adultId);
  if (!ctx.isDevice && adult.id !== ctx.session.member_id) throw err(403, 'forbidden', '본인만 확인할 수 있어요.');
  const key = `reauth:${adult.id}|${ip}`;
  throttle(core, key, { check: true });
  const user = core.get('SELECT * FROM users WHERE id = ?', adult.user_id);
  if (!user || !verifyPassword(String(b.password || ''), user.pw_hash)) {
    throttle(core, key, { fail: true });
    throw err(401, 'bad_password', '비밀번호가 맞지 않아요.');
  }
  throttle(core, key, { clear: true });
  const token = randToken();
  core.run('DELETE FROM elevations WHERE expires_at < ?', core.now());
  core.run('INSERT INTO elevations (token_hash, session_id, member_id, expires_at) VALUES (?,?,?,?)', sha256(token), ctx.session.id, adult.id, core.now() + ELEVATION_MS);
  return { token, memberId: adult.id, name: adult.name, expiresAt: core.now() + ELEVATION_MS };
}

export function unlockKid(core, ctx, kidId, pin) {
  const kid = ctx.kidRow(kidId);
  if (!kid.pin_hash) return { unlocked: true };
  const key = `pin:${ctx.session.id}:${kid.id}`;
  throttle(core, key, { check: true });
  if (!verifyPassword(String(pin ?? ''), kid.pin_hash)) {
    throttle(core, key, { fail: true });
    throw err(401, 'bad_pin', '비밀번호가 달라요.');
  }
  throttle(core, key, { clear: true });
  core.run('INSERT OR REPLACE INTO kid_unlocks (session_id, kid_id, expires_at) VALUES (?,?,?)', ctx.session.id, kid.id, core.now() + UNLOCK_MS);
  return { unlocked: true };
}

export function setKidPin(core, ctx, kidId, pin) {
  ctx.adult();
  const kid = ctx.kidRow(kidId);
  if (pin == null || pin === '') {
    core.run('UPDATE members SET pin_hash = NULL WHERE id = ?', kid.id);
  } else {
    if (!/^\d{4}$/.test(String(pin))) throw err(400, 'bad_pin', '비밀번호는 숫자 4자리예요.');
    core.run('UPDATE members SET pin_hash = ? WHERE id = ?', hashPassword(String(pin)), kid.id);
  }
  core.run('DELETE FROM kid_unlocks WHERE kid_id = ?', kid.id);
  core.refresh(ctx.familyId, 'family');
  return { ok: true };
}

export function publicMember(m, ctx) {
  const o = { id: m.id, kind: m.kind, role: m.role, name: m.name, avatar: m.avatar, color: m.color };
  if (m.kind === 'adult') o.isGuardian = !!m.is_guardian;
  if (m.kind === 'kid') { o.hasPin = !!m.pin_hash; if (ctx) o.unlocked = ctx.kidUnlocked(m); }
  return o;
}

export function me(core, ctx) {
  const fam = core.get('SELECT * FROM families WHERE id = ?', ctx.familyId);
  const adult = ctx.adultOrNull();
  return {
    session: { kind: ctx.session.kind, memberId: ctx.isDevice ? null : ctx.session.member_id },
    family: { id: fam.id, name: fam.name, showGrandmaStatus: !!fam.show_grandma_status, code: adult ? fam.code : undefined },
    me: !ctx.isDevice && adult ? publicMember(adult) : null,
    elevated: ctx.isDevice && adult ? publicMember(adult) : null,
    kids: core.kids(ctx.familyId).map((k) => publicMember(k, ctx)),
    adults: core.adults(ctx.familyId).map((a) => publicMember(a)),
    avatars: AVATARS,
    kidColors: KID_COLORS,
    today: core.today(),
  };
}

export function updateMember(core, ctx, memberId, b) {
  const adult = ctx.adult();
  const m = core.member(memberId);
  if (!m || m.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없어요.');
  if (m.kind === 'adult' && m.id !== adult.id && !adult.is_guardian) throw err(403, 'forbidden', '다른 어른 정보는 부모님만 바꿀 수 있어요.');
  const name = b.name !== undefined ? text(b.name, '이름', { max: 20 }) : m.name;
  const avatar = b.avatar !== undefined ? text(b.avatar, '아바타', { max: 8 }) : m.avatar;
  const color = b.color !== undefined ? (/^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : (() => { throw err(400, 'bad_color', '색 형식이 올바르지 않아요.'); })()) : m.color;
  let guardian = m.is_guardian;
  if (b.isGuardian !== undefined && m.kind === 'adult') {
    if (!adult.is_guardian) throw err(403, 'guardian_only', '부모님만 권한을 바꿀 수 있어요.');
    guardian = b.isGuardian ? 1 : 0;
    if (!guardian && core.adults(ctx.familyId).filter((a) => a.is_guardian && a.id !== m.id).length === 0) throw err(409, 'last_guardian', '부모님 권한을 가진 어른이 한 명은 있어야 해요.');
  }
  core.run('UPDATE members SET name = ?, avatar = ?, color = ?, is_guardian = ? WHERE id = ?', name, avatar, color, guardian, m.id);
  core.refresh(ctx.familyId, 'family', 'home');
  return publicMember(core.member(m.id), ctx);
}

export function updateFamily(core, ctx, b) {
  const adult = ctx.adult();
  const fam = core.get('SELECT * FROM families WHERE id = ?', ctx.familyId);
  const name = b.name !== undefined ? text(b.name, '가족 이름', { max: 30 }) : fam.name;
  const show = b.showGrandmaStatus !== undefined ? (b.showGrandmaStatus ? 1 : 0) : fam.show_grandma_status;
  core.run('UPDATE families SET name = ?, show_grandma_status = ? WHERE id = ?', name, show, fam.id);
  void adult;
  core.refresh(ctx.familyId, 'family', 'home');
  return me(core, ctx).family;
}

export function rotateCode(core, ctx) {
  ctx.guardian();
  const code = randCode(8);
  core.run('UPDATE families SET code = ? WHERE id = ?', code, ctx.familyId);
  return { code };
}
