import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err, text, oneOf, isDate, isMonth, monthRange, id as vid, kstDate, kstMinutesOfDay } from '../util.js';
import { dayState, SLOT_LABEL } from './routines.js';
import { getBoards } from './stamps.js';
import { todoForAdult } from './money.js';
import { requestedMissions } from './wishes.js';
import { publicMember } from './family.js';
import { homeTimers, kidTimer } from './timers.js';
import { supplyCards } from './supplies.js';
import { famActSummary } from './famact.js';

// ---------- 가족 상태 ----------
export const STATUS_LABEL = { working: '일하는 중', heading_home: '집에 가는 중', picking_up: '데리러 가는 중', home: '집에 있어요' };

export function setStatus(core, ctx, b) {
  const adult = ctx.adult();
  const state = oneOf(b.state, Object.keys(STATUS_LABEL), '상태');
  let eta = null;
  if (b.etaMinutes != null) {
    const m = Number(b.etaMinutes);
    if (!Number.isInteger(m) || m < 1 || m > 24 * 60) throw err(400, 'bad_eta', '도착 예정 시간이 올바르지 않아요.');
    eta = core.now() + m * 60000;
  } else if (typeof b.etaTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.etaTime)) {
    const [h, mm] = b.etaTime.split(':').map(Number);
    let diff = h * 60 + mm - kstMinutesOfDay(core.now());
    if (diff <= 0) diff += 24 * 60;
    eta = core.now() + diff * 60000;
  }
  core.run('INSERT INTO statuses (member_id, state, eta_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET state = excluded.state, eta_at = excluded.eta_at, updated_at = excluded.updated_at',
    adult.id, state, eta, core.now());
  core.refresh(ctx.familyId, 'home', 'status');
  return statusOf(core, adult.id);
}
const statusOf = (core, memberId) => {
  const s = core.get('SELECT * FROM statuses WHERE member_id = ?', memberId);
  return s ? { state: s.state, label: STATUS_LABEL[s.state], etaAt: s.eta_at, updatedAt: s.updated_at } : null;
};

// ---------- 사진 (비공개 저장, 권한 확인 후 스트리밍) ----------
const MAX_PHOTO = 8 * 1024 * 1024;
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image/png', 'png'];
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return ['image/webp', 'webp'];
  if (buf.length > 6 && buf.subarray(0, 3).toString() === 'GIF') return ['image/gif', 'gif'];
  return null;
}
export function savePhoto(core, ctx, buf, { kind, kidId }) {
  if (!core.dataDir) throw err(500, 'no_storage', '사진 저장소가 설정되지 않았어요.');
  if (!buf?.length) throw err(400, 'empty', '사진이 비어 있어요.');
  if (buf.length > MAX_PHOTO) throw err(413, 'too_big', '사진은 8MB 이하만 올릴 수 있어요.');
  const t = sniff(buf);
  if (!t) throw err(415, 'bad_image', 'JPG, PNG, WebP 사진만 올릴 수 있어요.');
  kind = oneOf(kind, ['post', 'wish', 'avatar'], '종류');
  let kid = null; let owner = null;
  if (kind === 'wish') {
    const k = ctx.kidPrivate(vid(kidId, '아이'));
    kid = k.id;
    owner = ctx.adultOrNull()?.id ?? k.id;
  } else {
    owner = ctx.adult().id; // 알림장·얼굴 사진은 어른만
  }
  const dir = path.join(core.dataDir, 'photos', String(ctx.familyId));
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${t[1]}`;
  fs.writeFileSync(path.join(dir, name), buf, { mode: 0o600 });
  const pid = core.insert('INSERT INTO photos (family_id, owner_id, kind, kid_id, path, mime, size, created_at) VALUES (?,?,?,?,?,?,?,?)', ctx.familyId, owner, kind, kid, `${ctx.familyId}/${name}`, t[0], buf.length, core.now());
  return { id: pid, url: `/api/photos/${pid}` };
}
export function openPhoto(core, ctx, pid) {
  const p = core.get('SELECT * FROM photos WHERE id = ?', pid);
  // 다른 가족의 사진은 존재 여부도 숨긴다
  if (!p || p.family_id !== ctx.familyId) throw err(404, 'not_found', '사진을 찾을 수 없어요.');
  if (p.kind === 'wish') ctx.kidPrivate(p.kid_id);
  const file = path.join(core.dataDir, 'photos', p.path);
  if (!path.resolve(file).startsWith(path.resolve(core.dataDir, 'photos') + path.sep)) throw err(404, 'not_found', '사진을 찾을 수 없어요.');
  if (!fs.existsSync(file)) throw err(404, 'not_found', '사진을 찾을 수 없어요.');
  return { file, mime: p.mime };
}

// ---------- 알림장 ----------
const postOut = (core, ctx, p) => {
  const a = core.member(p.author_id);
  const out = {
    id: p.id, title: p.title, body: p.body, authorId: p.author_id, authorName: a?.name, kidId: p.kid_id, tag: p.kid_id ? core.member(p.kid_id)?.name : '공용',
    photoUrl: p.photo_id ? `/api/photos/${p.photo_id}` : null, dueDate: p.due_date, supplies: p.supplies, pinned: !!p.pinned, createdAt: p.created_at,
  };
  const me = ctx.adultOrNull();
  const reads = core.all('SELECT member_id, read_at FROM post_reads WHERE post_id = ?', p.id);
  out.reads = core.adults(p.family_id).map((ad) => ({ memberId: ad.id, name: ad.name, readAt: reads.find((r) => r.member_id === ad.id)?.read_at ?? null }));
  out.readByMe = me ? reads.some((r) => r.member_id === me.id) : null;
  return out;
};

export function listPosts(core, ctx, { kidId, limit = 30 } = {}) {
  let rows = core.all('SELECT * FROM posts WHERE family_id = ? ORDER BY pinned DESC, id DESC LIMIT ?', ctx.familyId, Math.min(100, Number(limit) || 30));
  if (kidId) rows = rows.filter((p) => p.kid_id === Number(kidId) || p.kid_id == null);
  return rows.map((p) => postOut(core, ctx, p));
}

export function createPost(core, ctx, b) {
  const adult = ctx.adult();
  const title = text(b.title, '제목', { max: 60 });
  const body = text(b.body, '내용', { max: 2000, optional: true });
  let kidId = null;
  if (b.kidId && b.kidId !== 'all') kidId = ctx.kid(vid(b.kidId, '대상')).id;
  let photo = null;
  if (b.photoId != null) {
    const p = core.get('SELECT * FROM photos WHERE id = ?', vid(b.photoId, '사진'));
    if (!p || p.family_id !== ctx.familyId) throw err(400, 'bad_photo', '사진을 찾을 수 없어요.');
    photo = p.id;
  }
  const due = b.dueDate ? (isDate(b.dueDate) ? b.dueDate : (() => { throw err(400, 'bad_date', '기한 날짜가 올바르지 않아요.'); })()) : null;
  const supplies = text(b.supplies, '준비물', { max: 120, optional: true });
  return core.tx(() => {
    const pid = core.insert('INSERT INTO posts (family_id, author_id, title, body, kid_id, photo_id, due_date, supplies, pinned, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ctx.familyId, adult.id, title, body, kidId, photo, due, supplies, b.pinned ? 1 : 0, core.now());
    core.run('INSERT OR IGNORE INTO post_reads (post_id, member_id, read_at) VALUES (?,?,?)', pid, adult.id, core.now());
    if (b.notify) { // 게시자가 선택했을 때만 가족에게 알림
      for (const a of core.adults(ctx.familyId)) {
        if (a.id === adult.id) continue;
        core.notify({ familyId: ctx.familyId, memberId: a.id, kind: 'post', title: `알림장: ${title}`, body: body.slice(0, 80), url: `/#/notebook/${pid}`, dedupe: `post:${pid}:${a.id}`, lock: '알림장 · 새 글' });
      }
    }
    core.refresh(ctx.familyId, 'posts', 'home', 'calendar');
    return postOut(core, ctx, core.get('SELECT * FROM posts WHERE id = ?', pid));
  });
}

export function pinPost(core, ctx, pid, pinned) {
  ctx.adult();
  const p = core.get('SELECT * FROM posts WHERE id = ?', pid);
  if (!p || p.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 글이에요.');
  core.run('UPDATE posts SET pinned = ? WHERE id = ?', pinned ? 1 : 0, p.id);
  core.refresh(ctx.familyId, 'posts', 'home');
  return postOut(core, ctx, core.get('SELECT * FROM posts WHERE id = ?', p.id));
}
export function deletePost(core, ctx, pid) {
  const adult = ctx.adult();
  const p = core.get('SELECT * FROM posts WHERE id = ?', pid);
  if (!p || p.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 글이에요.');
  if (p.author_id !== adult.id && !adult.is_guardian) throw err(403, 'forbidden', '쓴 사람이나 부모님만 지울 수 있어요.');
  core.run('DELETE FROM post_reads WHERE post_id = ?', p.id);
  core.run('UPDATE supplies SET post_id = NULL WHERE post_id = ?', p.id);
  core.run('DELETE FROM posts WHERE id = ?', p.id);
  core.refresh(ctx.familyId, 'posts', 'home', 'calendar');
  return { ok: true };
}
export function readPost(core, ctx, pid) {
  const adult = ctx.adult();
  const p = core.get('SELECT * FROM posts WHERE id = ?', pid);
  if (!p || p.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 글이에요.');
  core.run('INSERT OR IGNORE INTO post_reads (post_id, member_id, read_at) VALUES (?,?,?)', p.id, adult.id, core.now());
  core.refresh(ctx.familyId, 'posts');
  return postOut(core, ctx, p);
}

// ---------- 가족 한마디 / 일정 ----------
export function listNotes(core, ctx, limit = 10) {
  return core.all('SELECT * FROM notes WHERE family_id = ? ORDER BY id DESC LIMIT ?', ctx.familyId, limit).map((n) => {
    const a = core.member(n.author_id);
    return { id: n.id, text: n.text, authorId: n.author_id, authorName: a?.name, authorAvatar: a?.avatar, at: n.created_at };
  });
}
export function addNote(core, ctx, b) {
  const t = text(b.text, '한마디', { max: 100 });
  const adult = ctx.adultOrNull();
  let author;
  if (adult) author = adult;
  else if (ctx.isDevice && ctx.actKidId()) author = ctx.asKid(ctx.actKidId());
  else throw err(403, 'forbidden', '한마디를 쓸 수 없어요.');
  core.insert('INSERT INTO notes (family_id, author_id, text, created_at) VALUES (?,?,?,?)', ctx.familyId, author.id, t, core.now());
  core.refresh(ctx.familyId, 'notes', 'home');
  return listNotes(core, ctx, 5);
}
export function addEvent(core, ctx, b) {
  const adult = ctx.adult();
  const title = text(b.title, '일정 이름', { max: 60 });
  if (!isDate(b.date)) throw err(400, 'bad_date', '날짜가 올바르지 않아요.');
  const kidId = b.kidId && b.kidId !== 'all' ? ctx.kid(vid(b.kidId, '대상')).id : null;
  const time = typeof b.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.time) ? b.time : null;
  const eid = core.insert('INSERT INTO events (family_id, title, date, time, kid_id, created_by, created_at) VALUES (?,?,?,?,?,?,?)', ctx.familyId, title, b.date, time, kidId, adult.id, core.now());
  core.refresh(ctx.familyId, 'calendar', 'home');
  return { id: eid };
}
export function deleteEvent(core, ctx, eid) {
  ctx.adult();
  const e = core.get('SELECT * FROM events WHERE id = ?', eid);
  if (!e || e.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 일정이에요.');
  if (e.plan_id) core.run("UPDATE fam_plans SET status = 'canceled', updated_at = ? WHERE id = ?", core.now(), e.plan_id);
  core.run('DELETE FROM events WHERE id = ?', e.id);
  core.refresh(ctx.familyId, 'calendar', 'home');
  return { ok: true };
}
// 날짜별 일정: 직접 적은 일정 + 알림장의 준비물/제출 기한
export function scheduleFor(core, familyId, from, to) {
  const out = [];
  for (const e of core.all('SELECT * FROM events WHERE family_id = ? AND date >= ? AND date < ? ORDER BY date, time, id', familyId, from, to))
    out.push({ type: 'event', id: e.id, date: e.date, time: e.time, planId: e.plan_id, title: e.title, kidId: e.kid_id, kidName: e.kid_id ? core.member(e.kid_id)?.name : null });
  for (const p of core.all('SELECT * FROM posts WHERE family_id = ? AND due_date >= ? AND due_date < ? ORDER BY due_date, id', familyId, from, to))
    out.push({ type: 'due', id: p.id, date: p.due_date, title: p.title, supplies: p.supplies, kidId: p.kid_id, kidName: p.kid_id ? core.member(p.kid_id)?.name : null });
  return out;
}
export function familyCalendar(core, ctx, month) {
  if (!isMonth(month)) throw err(400, 'bad_month', '월 형식은 YYYY-MM 이에요.');
  const { first, next } = monthRange(month);
  const kidStamps = core.all("SELECT kid_id, date FROM stamps WHERE family_id = ? AND voided = 0 AND date >= ? AND date < ?", ctx.familyId, first, next)
    .map((s) => ({ kidId: s.kid_id, date: s.date }));
  return { month, schedule: scheduleFor(core, ctx.familyId, first, next), stamps: kidStamps };
}

// ---------- 개인 메시지 (아이 ↔ 어른 한 쌍에게만 열림) ----------
function threadAccess(core, ctx, kidId, adultId) {
  const adult = ctx.adultOrNull();
  const kid = ctx.kidRow(kidId);
  ctx.adultMember(adultId);
  if (adult) {
    if (adult.id !== adultId) throw err(403, 'forbidden', '다른 어른의 대화는 볼 수 없어요.'); // 부모님이라도 남의 대화는 열 수 없다
    return { me: adult, other: kid, meIsKid: false };
  }
  ctx.asKid(kidId);
  return { me: kid, other: core.member(adultId), meIsKid: true };
}
const msgOut = (m) => ({ id: m.id, kidId: m.kid_id, adultId: m.adult_id, senderId: m.sender_id, body: m.body, at: m.created_at, readAt: m.read_at });

export function sendMessage(core, ctx, b) {
  const kidId = vid(b.kidId, '아이');
  const adultId = vid(b.adultId, '어른');
  const body = text(b.body, '메시지', { max: 500 });
  const { me, other, meIsKid } = threadAccess(core, ctx, kidId, adultId);
  return core.tx(() => {
    const mid = core.insert('INSERT INTO messages (family_id, kid_id, adult_id, sender_id, body, created_at) VALUES (?,?,?,?,?,?)', ctx.familyId, kidId, adultId, me.id, body, core.now());
    // 받는 사람 한 명에게만 알림/푸시/팝업
    core.notify({
      familyId: ctx.familyId, memberId: other.id, kind: 'message', title: `${me.name}의 메시지`, body,
      url: meIsKid ? `/#/messages/${kidId}/${adultId}` : '/#/kid/inbox', dedupe: `msg:${mid}`, lock: `${me.name} · 새 메시지`,
    });
    core.refresh(ctx.familyId, 'messages');
    return msgOut(core.get('SELECT * FROM messages WHERE id = ?', mid));
  });
}
export function getThread(core, ctx, kidId, adultId) {
  threadAccess(core, ctx, kidId, adultId);
  return core.all('SELECT * FROM messages WHERE kid_id = ? AND adult_id = ? ORDER BY id DESC LIMIT 100', kidId, adultId).reverse().map(msgOut);
}
export function readThread(core, ctx, kidId, adultId) {
  const { me } = threadAccess(core, ctx, kidId, adultId);
  core.run('UPDATE messages SET read_at = ? WHERE kid_id = ? AND adult_id = ? AND sender_id != ? AND read_at IS NULL', core.now(), kidId, adultId, me.id);
  core.run("UPDATE notifications SET read_at = ? WHERE member_id = ? AND kind = 'message' AND read_at IS NULL AND url IN (?, ?)", core.now(), me.id, `/#/messages/${kidId}/${adultId}`, '/#/kid/inbox');
  core.refresh(ctx.familyId, 'messages');
  return { ok: true };
}
// 내 대화 목록 (어른: 자기에게 온 대화, 아이: 자기 대화)
export function listThreads(core, ctx, kidId) {
  const adult = ctx.adultOrNull();
  let rows;
  if (adult && !kidId) rows = core.all('SELECT kid_id, adult_id FROM messages WHERE adult_id = ? GROUP BY kid_id, adult_id', adult.id);
  else {
    const kid = ctx.kidPrivate(vid(kidId, '아이'));
    rows = core.all('SELECT kid_id, adult_id FROM messages WHERE kid_id = ? GROUP BY kid_id, adult_id', kid.id);
    if (adult) rows = rows.filter((r) => r.adult_id === adult.id);
  }
  const meId = adult ? adult.id : Number(kidId);
  return rows.map((r) => {
    const last = core.get('SELECT * FROM messages WHERE kid_id = ? AND adult_id = ? ORDER BY id DESC LIMIT 1', r.kid_id, r.adult_id);
    const unread = core.get('SELECT COUNT(*) c FROM messages WHERE kid_id = ? AND adult_id = ? AND sender_id != ? AND read_at IS NULL', r.kid_id, r.adult_id, meId).c;
    const kid = core.member(r.kid_id); const ad = core.member(r.adult_id);
    return { kidId: r.kid_id, adultId: r.adult_id, kidName: kid.name, adultName: ad.name, kidAvatar: kid.avatar, adultAvatar: ad.avatar, last: msgOut(last), unread };
  }).sort((a, b) => b.last.at - a.last.at);
}

// ---------- 알림 목록 (받은 편지함) ----------
export function listNotifications(core, ctx, kidId) {
  let memberId;
  const adult = ctx.adultOrNull();
  if (kidId) memberId = ctx.kidPrivate(vid(kidId, '아이')).id;
  else memberId = ctx.adult().id;
  void adult;
  const rows = core.all('SELECT * FROM notifications WHERE member_id = ? ORDER BY id DESC LIMIT 60', memberId);
  return { unread: rows.filter((r) => !r.read_at).length, items: rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, url: n.url, at: n.created_at, read: !!n.read_at })) };
}
export function markNotification(core, ctx, nid) {
  const n = core.get('SELECT * FROM notifications WHERE id = ?', nid);
  if (!n || n.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 알림이에요.');
  const owner = core.member(n.member_id);
  if (owner.kind === 'adult') { if (ctx.adult().id !== owner.id) throw err(403, 'forbidden', '내 알림이 아니에요.'); } else ctx.kidPrivate(owner.id);
  core.run('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?', core.now(), n.id);
  return { ok: true, notification: { id: n.id, kind: n.kind, title: n.title, body: n.body, url: n.url } };
}
export function readAllNotifications(core, ctx, kidId) {
  const memberId = kidId ? ctx.kidPrivate(vid(kidId, '아이')).id : ctx.adult().id;
  core.run('UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL', core.now(), memberId);
  return { ok: true };
}
// 팝업 1건의 내용 (수신자 본인만)
export function getNotification(core, ctx, nid) {
  const n = core.get('SELECT * FROM notifications WHERE id = ?', nid);
  if (!n || n.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 알림이에요.');
  const owner = core.member(n.member_id);
  if (owner.kind === 'adult') { if (ctx.adult().id !== owner.id) throw err(403, 'forbidden', '내 알림이 아니에요.'); } else ctx.kidPrivate(owner.id);
  return { id: n.id, kind: n.kind, title: n.title, body: n.body, url: n.url, at: n.created_at, read: !!n.read_at };
}

// ---------- 푸시 구독 ----------
export function subscribePush(core, ctx, sub) {
  const who = ctx.boundKid ? ctx.kidRow(ctx.boundKid) : ctx.adult(); // 아이 폰은 그 아이에게, 어른은 본인에게
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw err(400, 'bad_sub', '푸시 구독 정보가 올바르지 않아요.');
  if (typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) throw err(400, 'bad_sub', '푸시 구독 정보가 올바르지 않아요.');
  const device = ctx.isDevice && !ctx.boundKid ? 1 : 0; // 거실 기기 구독만 활동(타이머) 알림 대상
  core.run('INSERT INTO push_subs (member_id, endpoint, p256dh, auth, device, session_id, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, session_id = excluded.session_id', who.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, device, ctx.session.id, core.now());
  return { ok: true };
}
export function unsubscribePush(core, ctx, endpoint) {
  const who = ctx.boundKid ? ctx.kidRow(ctx.boundKid) : ctx.adult();
  core.run('DELETE FROM push_subs WHERE endpoint = ? AND member_id = ?', endpoint, who.id);
  return { ok: true };
}

// ---------- 집 안 걷기 ----------
const CELL = /^[012][012]$/;
export function setWalker(core, ctx, memberId, cell) {
  if (typeof cell !== 'string' || !CELL.test(cell)) throw err(400, 'bad_cell', '갈 수 없는 칸이에요.');
  const m = core.member(memberId);
  if (!m || m.family_id !== ctx.familyId || m.removed) throw err(404, 'not_found', '찾을 수 없어요.');
  if (ctx.boundKid && ctx.boundKid !== m.id) throw err(403, 'forbidden', '내 캐릭터만 움직일 수 있어요.'); // 아이 폰은 자기 캐릭터만
  core.run('INSERT INTO walkers (member_id, family_id, cell, updated_at) VALUES (?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET cell = excluded.cell, updated_at = excluded.updated_at', m.id, ctx.familyId, cell, core.now());
  core.refresh(ctx.familyId, 'walkers');
  return { ok: true, memberId: m.id, cell };
}
const walkersOf = (core, familyId) => Object.fromEntries(core.all('SELECT member_id, cell FROM walkers WHERE family_id = ?', familyId).map((w) => [w.member_id, w.cell]));

// ---------- 홈 ----------
// 공용 홈: 개인 메시지 본문·개인 잔액은 절대 싣지 않는다.
export function home(core, ctx) {
  const today = core.today();
  const fam = core.get('SELECT * FROM families WHERE id = ?', ctx.familyId);
  const kids = core.kids(ctx.familyId).map((k) => {
    const d = dayState(core, k.id, today);
    const b = getBoards(core, ctx, k.id);
    return {
      ...publicMember(k, ctx),
      day: { status: d.status, total: d.total, done: d.done, remaining: d.items.filter((i) => !i.done).map((i) => i.name), requestId: d.requestId || null, stampBy: d.stamp?.providerName || null },
      board: { no: b.boardNo, count: b.count, size: b.size },
      timer: kidTimer(core, ctx.familyId, k.id),
    };
  });
  const adults = core.adults(ctx.familyId)
    .filter((a) => a.role !== 'grandma' || fam.show_grandma_status)
    .map((a) => ({ ...publicMember(a), status: statusOf(core, a.id) }));
  const sched = scheduleFor(core, ctx.familyId, today, kstDate(Date.parse(today + 'T00:00:00Z') + 864e5));
  const posts = core.all('SELECT * FROM posts WHERE family_id = ? ORDER BY pinned DESC, id DESC LIMIT 3', ctx.familyId).map((p) => ({
    id: p.id, title: p.title, pinned: !!p.pinned, tag: p.kid_id ? core.member(p.kid_id)?.name : '공용', at: p.created_at, hasPhoto: !!p.photo_id,
  }));
  return {
    now: core.now(), today, family: { name: fam.name }, kids, adults, schedule: sched, posts, notes: listNotes(core, ctx, 3), slotLabel: SLOT_LABEL,
    supplies: supplyCards(core, ctx.familyId), famActivity: famActSummary(core, ctx), timers: homeTimers(core, ctx.familyId), walkers: walkersOf(core, ctx.familyId),
  };
}

// 어른 홈: 도장 확인 대기, 용돈/구매 요청, 미션 확인, 받은 메시지, 안 읽은 알림장
export function adultHome(core, ctx) {
  const adult = ctx.adult();
  const approvals = core.all("SELECT * FROM stamp_requests WHERE family_id = ? AND status = 'pending' ORDER BY id", ctx.familyId).map((r) => {
    const kid = core.member(r.kid_id);
    return { id: r.id, kidId: kid.id, kidName: kid.name, kidAvatar: kid.avatar, kidColor: kid.color, date: r.date, createdAt: r.created_at };
  });
  const unreadMsgs = core.get('SELECT COUNT(*) c FROM messages WHERE adult_id = ? AND sender_id != ? AND read_at IS NULL', adult.id, adult.id).c;
  const unreadPosts = core.get('SELECT COUNT(*) c FROM posts p WHERE p.family_id = ? AND NOT EXISTS (SELECT 1 FROM post_reads r WHERE r.post_id = p.id AND r.member_id = ?)', ctx.familyId, adult.id).c;
  const unreadNotifs = core.get('SELECT COUNT(*) c FROM notifications WHERE member_id = ? AND read_at IS NULL', adult.id).c;
  return {
    me: publicMember(adult), myStatus: statusOf(core, adult.id), approvals, money: todoForAdult(core, adult),
    missions: requestedMissions(core, ctx.familyId), unreadMessages: unreadMsgs, unreadPosts, unreadNotifications: unreadNotifs,
  };
}
