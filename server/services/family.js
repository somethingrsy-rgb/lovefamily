import fs from 'node:fs';
import path from 'node:path';
import { err, text, oneOf, hashPassword, verifyPassword, randToken, randCode, sha256 } from '../util.js';
import { ELEVATION_MS, UNLOCK_MS } from '../ctx.js';
import { seedActivities } from './timers.js';

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

function newSession(core, { familyId, kind, userId, memberId, boundKid = null, label = null, days = null }) {
  const token = randToken();
  const now = core.now();
  const d = days || SESSION_DAYS[kind];
  core.insert('INSERT INTO sessions (token_hash, family_id, kind, user_id, member_id, created_at, expires_at, bound_kid_id, label) VALUES (?,?,?,?,?,?,?,?,?)',
    sha256(token), familyId, kind, userId, memberId, now, now + d * 864e5, boundKid, label);
  return { token, maxAge: d * 86400 };
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
    seedActivities(core, familyId);
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
  core.run('DELETE FROM push_subs WHERE session_id = ?', ctx.session.id);
  core.run('DELETE FROM elevations WHERE session_id = ?', ctx.session.id);
  core.run('DELETE FROM kid_unlocks WHERE session_id = ?', ctx.session.id);
  core.run('DELETE FROM sessions WHERE id = ?', ctx.session.id);
}

// 공용 기기에서 어른 권한이 필요할 때: 어른 선택 + 비밀번호 → 10분짜리 elevation 토큰
export function reauth(core, ctx, b, ip = '') {
  if (ctx.boundKid) throw err(403, 'adult_only', '어른만 할 수 있어요.');
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
  const o = { id: m.id, kind: m.kind, role: m.role, name: m.name, avatar: m.avatar, color: m.color, avatarUrl: m.avatar_photo_id ? `/api/photos/${m.avatar_photo_id}` : null };
  if (m.kind === 'adult') o.isGuardian = !!m.is_guardian;
  if (m.kind === 'kid') { o.hasPin = !!m.pin_hash; if (ctx) o.unlocked = ctx.kidUnlocked(m); }
  return o;
}

export function me(core, ctx) {
  const fam = core.get('SELECT * FROM families WHERE id = ?', ctx.familyId);
  const adult = ctx.adultOrNull();
  return {
    session: { kind: ctx.session.kind, memberId: ctx.isDevice ? null : ctx.session.member_id, boundKid: ctx.boundKid },
    family: { id: fam.id, name: fam.name, showGrandmaStatus: !!fam.show_grandma_status, timerSound: !!fam.timer_sound, pets: { ruby: !!fam.show_ruby && !!fam.show_cats, crystal: !!fam.show_crystal && !!fam.show_cats, yeoni: !!fam.show_dog }, code: adult ? fam.code : undefined, layout: parseLayout(fam.layout) },
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
  let photo = m.avatar_photo_id;
  if (b.photoId !== undefined) {
    if (b.photoId === null) photo = null;
    else {
      const ph = core.get('SELECT * FROM photos WHERE id = ?', Number(b.photoId));
      if (!ph || ph.family_id !== ctx.familyId || ph.kind !== 'avatar') throw err(400, 'bad_photo', '얼굴 사진을 찾을 수 없어요.');
      photo = ph.id;
    }
  }
  core.run('UPDATE members SET name = ?, avatar = ?, color = ?, is_guardian = ?, avatar_photo_id = ? WHERE id = ?', name, avatar, color, guardian, photo, m.id);
  core.refresh(ctx.familyId, 'family', 'home');
  return publicMember(core.member(m.id), ctx);
}

// 화면 배열(어른이 끌어서 바꾼 순서): { 칸이름: [항목이름, …] }. 가족 모두에게 같게 보인다.
export function parseLayout(v) { try { const o = JSON.parse(v || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } }
export function setLayout(core, ctx, b) {
  ctx.adult();
  const raw = b?.layout;
  if (raw === null || (raw && typeof raw === 'object' && !Object.keys(raw).length)) { core.run('UPDATE families SET layout = NULL WHERE id = ?', ctx.familyId); core.refresh(ctx.familyId, 'family', 'home'); return { layout: {} }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw err(400, 'bad_layout', '배열 정보가 올바르지 않아요.');
  const out = {};
  const keys = Object.keys(raw);
  if (keys.length > 60) throw err(400, 'bad_layout', '배열 정보가 너무 많아요.');
  for (const k of keys) {
    const v = raw[k];
    if (!/^[\w.:\-가-힣]{1,60}$/u.test(k) || !Array.isArray(v) || v.length > 60 || !v.every((x) => typeof x === 'string' && /^[\w.:\-가-힣]{1,60}$/u.test(x))) throw err(400, 'bad_layout', '배열 정보가 올바르지 않아요.');
    out[k] = [...new Set(v)];
  }
  core.run('UPDATE families SET layout = ? WHERE id = ?', JSON.stringify(out), ctx.familyId);
  core.refresh(ctx.familyId, 'family', 'home');
  return { layout: out };
}
// ---------- 전체 리셋(어른) ----------
// 루틴 정의·가족 구성·얼굴 사진·로그인/연결된 기기·활동 종류·설정(배열·알림 소리·고양이 등)·가족 활동 선택지는 그대로 두고,
// 그동안 쌓인 기록(오늘 체크·도장·저금통·알림장·메시지·알림·타이머·준비물 등)을 모두 지운다. 되돌릴 수 없다.
export const RESET_WORD = '리셋';
export function resetFamilyData(core, ctx, b) {
  ctx.adult();
  if (String(b?.confirm || '').trim() !== RESET_WORD) throw err(400, 'confirm_required', `확인을 위해 ‘${RESET_WORD}’ 라고 입력해 주세요.`);
  const fid = ctx.familyId;
  const memberIds = core.all('SELECT id FROM members WHERE family_id = ?', fid).map((m) => m.id);
  const kidIds = core.kids(fid).map((k) => k.id);
  const ph = (a) => a.map(() => '?').join(',') || 'NULL';
  const files = [];
  core.tx(() => {
    const byFamily = ['stamp_requests', 'stamps', 'praises', 'ledger', 'money_requests', 'settlements', 'wishes', 'missions', 'posts', 'notes', 'events', 'messages', 'notifications', 'walkers', 'timers', 'supplies', 'fam_picks', 'fam_plans'];
    // 자식 표를 먼저(참조하는 쪽 → 참조되는 쪽)
    if (kidIds.length) {
      core.run(`DELETE FROM day_items WHERE day_id IN (SELECT id FROM days WHERE family_id = ?)`, fid);
      core.run(`DELETE FROM board_rewards WHERE kid_id IN (${ph(kidIds)})`, ...kidIds);
      core.run(`DELETE FROM goal_moves WHERE kid_id IN (${ph(kidIds)})`, ...kidIds);
      core.run(`DELETE FROM achievements WHERE kid_id IN (${ph(kidIds)})`, ...kidIds);
      core.run(`DELETE FROM supply_kids WHERE kid_id IN (${ph(kidIds)})`, ...kidIds);
    }
    core.run('DELETE FROM post_reads WHERE post_id IN (SELECT id FROM posts WHERE family_id = ?)', fid);
    core.run('DELETE FROM supply_kids WHERE supply_id IN (SELECT id FROM supplies WHERE family_id = ?)', fid);
    for (const t of ['stamps', 'stamp_requests']) core.run(`DELETE FROM ${t} WHERE family_id = ?`, fid);
    core.run('DELETE FROM days WHERE family_id = ?', fid);
    for (const t of byFamily.filter((x) => !['stamps', 'stamp_requests'].includes(x))) core.run(`DELETE FROM ${t} WHERE family_id = ?`, fid);
    core.run(`DELETE FROM statuses WHERE member_id IN (${ph(memberIds)})`, ...memberIds);
    // 알림장·사고 싶은 것 사진은 지우고, 얼굴(avatar) 사진은 남긴다
    for (const ph2 of core.all("SELECT id, path FROM photos WHERE family_id = ? AND kind != 'avatar'", fid)) { files.push(ph2.path); core.run('DELETE FROM photos WHERE id = ?', ph2.id); }
    core.refresh(fid, 'all');
  });
  if (core.dataDir) for (const f of files) { try { fs.unlinkSync(path.join(core.dataDir, 'photos', f)); } catch { /* 이미 없으면 넘어간다 */ } }
  return { ok: true, photosRemoved: files.length };
}
export function updateFamily(core, ctx, b) {
  const adult = ctx.adult();
  const fam = core.get('SELECT * FROM families WHERE id = ?', ctx.familyId);
  const name = b.name !== undefined ? text(b.name, '가족 이름', { max: 30 }) : fam.name;
  const show = b.showGrandmaStatus !== undefined ? (b.showGrandmaStatus ? 1 : 0) : fam.show_grandma_status;
  const sound = b.timerSound !== undefined ? (b.timerSound ? 1 : 0) : fam.timer_sound;
  const cats = b.showCats !== undefined ? (b.showCats ? 1 : 0) : fam.show_cats;
  const dog = b.showDog !== undefined ? (b.showDog ? 1 : 0) : fam.show_dog;
  const pp = b.pets && typeof b.pets === 'object' ? b.pets : {};
  const ruby = pp.ruby !== undefined ? (pp.ruby ? 1 : 0) : fam.show_ruby;
  const crystal = pp.crystal !== undefined ? (pp.crystal ? 1 : 0) : fam.show_crystal;
  const yeoni = pp.yeoni !== undefined ? (pp.yeoni ? 1 : 0) : dog;
  // 예전 '고양이 전체' 설정(show_cats)은 이름별 설정으로 옮겨 오므로, 이름별로 저장할 때는 켜 둔다
  core.run('UPDATE families SET name = ?, show_grandma_status = ?, timer_sound = ?, show_cats = ?, show_dog = ?, show_ruby = ?, show_crystal = ? WHERE id = ?', name, show, sound, (b.pets ? 1 : cats), yeoni, ruby, crystal, fam.id);
  void adult;
  core.refresh(ctx.familyId, 'family', 'home', 'timers');
  return me(core, ctx).family;
}

export function rotateCode(core, ctx) {
  ctx.guardian();
  const code = randCode(8);
  core.run('UPDATE families SET code = ? WHERE id = ?', code, ctx.familyId);
  return { code };
}

// 어른 삭제(부모 권한). 기록(장부 처리자·도장 준 사람 등)은 이름이 남도록 행은 보존하고 로그인·알림·요청만 정리한다.
export function removeAdult(core, ctx, memberId) {
  const me = ctx.guardian();
  const m = core.member(memberId);
  if (!m || m.family_id !== ctx.familyId || m.kind !== 'adult' || m.removed) throw err(404, 'not_found', '찾을 수 없는 어른이에요.');
  if (m.id === me.id) throw err(409, 'self', '내 계정은 여기서 삭제할 수 없어요.');
  return core.tx(() => {
    // 이 어른에게 온 대기 중 요청은 취소해서 아이의 잠긴 돈이 풀리게 한다
    for (const r of core.all("SELECT * FROM money_requests WHERE to_member_id = ? AND status IN ('pending','approved')", m.id)) {
      core.run("UPDATE money_requests SET status = 'canceled', updated_at = ? WHERE id = ?", core.now(), r.id);
      if (r.type === 'purchase') {
        const w = core.get('SELECT * FROM wishes WHERE id = ?', r.wish_id);
        if (w && w.status === 'purchasing') core.run('UPDATE wishes SET status = ? WHERE id = ?', w.allocated >= w.price ? 'ready' : 'goal', w.id);
      }
    }
    const userId = m.user_id;
    core.run('UPDATE members SET removed = 1, user_id = NULL, is_guardian = 0 WHERE id = ?', m.id);
    core.run('DELETE FROM push_subs WHERE member_id = ?', m.id);
    core.run('DELETE FROM elevations WHERE member_id = ?', m.id);
    core.run('DELETE FROM statuses WHERE member_id = ?', m.id);
    if (userId) {
      core.run('DELETE FROM sessions WHERE user_id = ?', userId);
      core.run('DELETE FROM users WHERE id = ?', userId);
    }
    core.refresh(ctx.familyId, 'family', 'home', 'requests', 'wallet', 'status');
    return { ok: true };
  });
}

// ---------- 아이 휴대폰 연결 ----------
// 어른이 아이별 일회용 코드를 만들고, 아이가 자기 폰에 입력하면 그 폰은 그 아이 한 명 전용 로그인이 된다.
const PAIR_MS = 10 * 60 * 1000;
export function createPairCode(core, ctx, kidId) {
  const adult = ctx.adult();
  const kid = ctx.kidRow(kidId);
  const code = randCode(6);
  core.tx(() => {
    core.run('DELETE FROM kid_pair_codes WHERE kid_id = ? OR expires_at < ?', kid.id, core.now());
    core.run('INSERT INTO kid_pair_codes (code_hash, kid_id, family_id, created_by, expires_at) VALUES (?,?,?,?,?)', sha256(code), kid.id, ctx.familyId, adult.id, core.now() + PAIR_MS);
  });
  return { code, kidId: kid.id, kidName: kid.name, expiresAt: core.now() + PAIR_MS };
}
export function kidPair(core, b, ip = '') {
  const key = `pair|${ip}`;
  throttle(core, key, { check: true });
  const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const row = code.length >= 4 ? core.get('SELECT * FROM kid_pair_codes WHERE code_hash = ? AND expires_at > ?', sha256(code), core.now()) : null;
  if (!row) { throttle(core, key, { fail: true }); throw err(404, 'bad_code', '연결 코드가 맞지 않거나 시간이 지났어요. 어른에게 새 코드를 받아 주세요.'); }
  throttle(core, key, { clear: true });
  return core.tx(() => {
    if (!core.run('DELETE FROM kid_pair_codes WHERE code_hash = ?', row.code_hash).changes) throw err(404, 'bad_code', '이미 사용한 코드예요.'); // 한 번만 쓸 수 있다
    const kid = core.member(row.kid_id);
    const session = newSession(core, { familyId: row.family_id, kind: 'device', userId: null, memberId: null, boundKid: row.kid_id, label: `${kid.name}의 휴대폰`, days: 365 });
    core.refresh(row.family_id, 'family');
    return { session, kidId: row.kid_id };
  });
}
export function listKidDevices(core, ctx, kidId) {
  ctx.adult();
  const kid = ctx.kidRow(kidId);
  return core.all('SELECT id, label, created_at FROM sessions WHERE bound_kid_id = ? AND expires_at > ? ORDER BY id', kid.id, core.now())
    .map((s) => ({ id: s.id, label: s.label, connectedAt: s.created_at, push: core.get('SELECT COUNT(*) c FROM push_subs WHERE session_id = ?', s.id).c > 0 }));
}
export function revokeKidDevice(core, ctx, sessionId) {
  ctx.adult();
  const s = core.get('SELECT * FROM sessions WHERE id = ? AND bound_kid_id IS NOT NULL', sessionId);
  if (!s || s.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 기기예요.');
  core.tx(() => {
    core.run('DELETE FROM push_subs WHERE session_id = ?', s.id);
    core.run('DELETE FROM elevations WHERE session_id = ?', s.id);
    core.run('DELETE FROM kid_unlocks WHERE session_id = ?', s.id);
    core.run('DELETE FROM sessions WHERE id = ?', s.id);
    core.refresh(ctx.familyId, 'family');
  });
  return { ok: true };
}
