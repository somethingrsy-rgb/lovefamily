import { err, text, isDate, addDays, id as vid } from '../util.js';

const norm = (s) => s.replace(/\s+/g, '').toLowerCase();

export function supplyOut(core, s) {
  const post = s.post_id ? core.get('SELECT title, photo_id FROM posts WHERE id = ?', s.post_id) : null;
  return {
    id: s.id, name: s.name, icon: s.icon, date: s.date, postId: s.post_id, postTitle: post?.title || null, photoUrl: post?.photo_id ? `/api/photos/${post.photo_id}` : null,
    kids: core.all('SELECT * FROM supply_kids WHERE supply_id = ? ORDER BY kid_id', s.id).map((k) => ({ kidId: k.kid_id, name: core.member(k.kid_id).name, checked: !!k.checked, checkedAt: k.checked_at })),
  };
}

// 어른: 한 글(또는 직접)에서 여러 준비물을 여러 아이에게 등록. 같은 글의 같은 준비물은 새로 만들지 않고 기존 항목을 돌려준다.
export function createSupplies(core, ctx, b) {
  const adult = ctx.adult();
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length || items.length > 20) throw err(400, 'no_items', '준비물을 1~20개 입력해 주세요.');
  const date = b.date ? (isDate(b.date) ? b.date : (() => { throw err(400, 'bad_date', '날짜가 올바르지 않아요.'); })()) : addDays(core.today(), 1);
  const kids = core.kids(ctx.familyId);
  let kidIds = b.kidIds === 'all' || b.kidIds === undefined ? kids.map((k) => k.id) : (Array.isArray(b.kidIds) ? b.kidIds : [b.kidIds]).map((k) => vid(k, '아이'));
  if (!kidIds.length || !kidIds.every((k) => kids.some((x) => x.id === k))) throw err(400, 'bad_kid', '대상 아이를 선택해 주세요.');
  let postId = null;
  if (b.postId != null) {
    const p = core.get('SELECT * FROM posts WHERE id = ?', vid(b.postId, '알림장 글'));
    if (!p || p.family_id !== ctx.familyId) throw err(404, 'not_found', '알림장 글을 찾을 수 없어요.');
    postId = p.id;
  }
  return core.tx(() => {
    const created = []; const duplicates = [];
    for (const it of items) {
      const name = text(it.name, '준비물 이름', { max: 30 });
      const icon = text(it.icon || '🎒', '아이콘', { max: 8 });
      const ex = core.get('SELECT * FROM supplies WHERE family_id = ? AND IFNULL(post_id, 0) = ? AND name_norm = ? AND date = ?', ctx.familyId, postId || 0, norm(name), date);
      if (ex) { duplicates.push(supplyOut(core, ex)); continue; }
      const sid = core.insert('INSERT INTO supplies (family_id, post_id, name, name_norm, icon, date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', ctx.familyId, postId, name, norm(name), icon, date, adult.id, core.now());
      for (const k of kidIds) core.run('INSERT INTO supply_kids (supply_id, kid_id) VALUES (?,?)', sid, k);
      created.push(supplyOut(core, core.get('SELECT * FROM supplies WHERE id = ?', sid)));
    }
    core.refresh(ctx.familyId, 'supplies', 'home');
    return { created, duplicates };
  });
}

// 아이가 챙겼어요 / 되돌리기: 아이별로 따로 기록, 루틴·도장과는 무관
export function setChecked(core, ctx, supplyId, kidId, checked) {
  ctx.kid(kidId);
  if (typeof checked !== 'boolean') throw err(400, 'bad_value', 'checked 값이 필요해요.');
  const s = core.get('SELECT * FROM supplies WHERE id = ?', supplyId);
  if (!s || s.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 준비물이에요.');
  const r = core.run('UPDATE supply_kids SET checked = ?, checked_at = ? WHERE supply_id = ? AND kid_id = ?', checked ? 1 : 0, checked ? core.now() : null, s.id, kidId);
  if (!r.changes) throw err(404, 'not_found', '이 아이의 준비물이 아니에요.');
  core.refresh(ctx.familyId, 'supplies', 'home');
  return supplyOut(core, s);
}
export function deleteSupply(core, ctx, supplyId) {
  ctx.adult();
  const s = core.get('SELECT * FROM supplies WHERE id = ?', supplyId);
  if (!s || s.family_id !== ctx.familyId) throw err(404, 'not_found', '찾을 수 없는 준비물이에요.');
  core.run('DELETE FROM supply_kids WHERE supply_id = ?', s.id); core.run('DELETE FROM supplies WHERE id = ?', s.id);
  core.refresh(ctx.familyId, 'supplies', 'home');
  return { ok: true };
}

// 한 아이의 준비물 전체 목록(챙긴 것 포함). 최근 14일 전부터 앞으로.
export function listSupplies(core, ctx, kidId, { all = true } = {}) {
  ctx.kid(kidId);
  const from = addDays(core.today(), -14);
  const rows = core.all('SELECT s.* FROM supplies s JOIN supply_kids k ON k.supply_id = s.id WHERE s.family_id = ? AND k.kid_id = ? AND s.date >= ? ORDER BY s.date, s.id', ctx.familyId, kidId, from);
  void all;
  return rows.map((s) => { const o = supplyOut(core, s); const mine = o.kids.find((k) => k.kidId === kidId); return { ...o, checked: mine.checked, checkedAt: mine.checkedAt, kids: undefined, withKids: o.kids.map((k) => k.name) }; });
}

// 거실 보드 카드: 한국시간 기준. 오늘 날짜 준비물은 '오늘 챙길 것'(아직 못 챙긴 것만 표시), 내일 것은 '내일 챙길 것'.
export function supplyCards(core, familyId) {
  const today = core.today(); const tomorrow = addDays(today, 1);
  return core.kids(familyId).map((kid) => {
    const rows = core.all('SELECT s.*, k.checked FROM supplies s JOIN supply_kids k ON k.supply_id = s.id WHERE s.family_id = ? AND k.kid_id = ? AND s.date IN (?, ?) ORDER BY s.date, s.id', familyId, kid.id, today, tomorrow);
    const mk = (label, date, onlyOpen) => {
      const list = rows.filter((r) => r.date === date);
      if (!list.length) return null;
      const checked = list.filter((r) => r.checked).length;
      const shown = (onlyOpen ? list.filter((r) => !r.checked) : list).map((r) => ({ ...supplyOut(core, r), checked: !!r.checked, kids: undefined }));
      return { label, date, total: list.length, checked, items: shown, allDone: checked === list.length };
    };
    return { kidId: kid.id, kidName: kid.name, kidAvatar: kid.avatar, kidColor: kid.color, cards: [mk('오늘 챙길 것', today, true), mk('내일 챙길 것', tomorrow, false)].filter(Boolean) };
  });
}
