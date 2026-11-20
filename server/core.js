import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import { kstDate } from './util.js';

// SSE 허브: 이벤트에는 '무엇이 바뀌었는지' 이름만 싣고 내용은 싣지 않는다.
// 내용은 클라이언트가 권한이 검증되는 API로 다시 읽는다.
export class Hub {
  constructor() { this.conns = new Set(); }
  add(res, meta) {
    const c = { res, ...meta };
    this.conns.add(c);
    res.on('close', () => this.conns.delete(c));
    return c;
  }
  // to: null = 가족 전체(내용 없는 refresh 용), {adults:[memberId], kids:[kidId]} = 지정 수신자
  publish(familyId, event, to = null) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of this.conns) {
      if (c.familyId !== familyId) continue;
      if (to) {
        const okAdult = c.memberId && to.adults?.includes(c.memberId);
        const okKid = c.kidId && to.kids?.includes(c.kidId);
        const okDev = to.devices && c.device;
        if (!okAdult && !okKid && !okDev) continue;
      }
      try { c.res.write(data); } catch { this.conns.delete(c); }
    }
  }
}

export function createCore({ dbPath = ':memory:', now = () => Date.now(), pushSender = null, dataDir = null, appUrl = '' } = {}) {
  const db = openDb(dbPath);
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  let depth = 0;
  let after = [];
  const core = {
    db, now, hub: new Hub(), pushSender, dataDir, appUrl, hooks: {}, pushLog: [],
    today: () => kstDate(now()),
    get: (sql, ...p) => stmt(sql).get(...p),
    all: (sql, ...p) => stmt(sql).all(...p),
    run: (sql, ...p) => stmt(sql).run(...p),
    insert(sql, ...p) { return Number(stmt(sql).run(...p).lastInsertRowid); },
    // 중첩 가능한 쓰기 트랜잭션. 커밋 후에만 afterCommit 콜백(SSE/푸시)이 실행된다.
    tx(fn) {
      if (depth > 0) return fn();
      db.exec('BEGIN IMMEDIATE');
      depth = 1;
      try {
        const r = fn();
        db.exec('COMMIT');
        depth = 0;
        const cbs = after; after = [];
        for (const cb of cbs) { try { cb(); } catch (e) { console.error('afterCommit', e); } }
        return r;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch {}
        depth = 0; after = [];
        throw e;
      }
    },
    afterCommit(cb) { if (depth > 0) after.push(cb); else cb(); },
    refresh(familyId, ...topics) {
      core.afterCommit(() => core.hub.publish(familyId, { t: 'refresh', topics }));
    },
    member: (id) => core.get('SELECT * FROM members WHERE id = ?', id),
    adults: (familyId) => core.all("SELECT * FROM members WHERE family_id = ? AND kind = 'adult' ORDER BY sort, id", familyId),
    kids: (familyId) => core.all("SELECT * FROM members WHERE family_id = ? AND kind = 'kid' ORDER BY sort, id", familyId),
  };
  if (dataDir) fs.mkdirSync(path.join(dataDir, 'photos'), { recursive: true });

  // 알림 1건 생성. dedupe 가 같으면 중복 생성·중복 푸시를 하지 않는다.
  // title/body 는 앱 안에서만 보이는 내용, lock 은 잠금화면 푸시에 쓰는 최소 문구.
  core.notify = ({ familyId, memberId, kind, title, body = '', url = '', dedupe = null, lock, popup = true }) => {
    const r = core.run(
      'INSERT INTO notifications (family_id, member_id, kind, title, body, url, dedupe, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(dedupe) DO NOTHING',
      familyId, memberId, kind, title, body, url, dedupe, now());
    if (!r.changes) return null;
    const nid = Number(r.lastInsertRowid);
    const m = core.member(memberId);
    core.afterCommit(() => {
      const to = m.kind === 'adult' ? { adults: [memberId] } : { kids: [memberId] };
      core.hub.publish(familyId, { t: 'notify', id: nid, kind, popup }, to);
      if (m.kind === 'adult') core.sendPush(memberId, { title: '우리집', body: lock || title, url: url || '/', tag: `n${nid}`, nid });
    });
    return nid;
  };

  // 거실 기기로 등록된 구독에만 보내는 푸시(타이머 등 가족 공용 알림)
  core.sendPushDevices = (familyId, payload) => {
    const subs = core.all('SELECT s.* FROM push_subs s JOIN members m ON m.id = s.member_id WHERE m.family_id = ? AND s.device = 1', familyId);
    core.pushTo(subs, payload);
  };
  core.sendPush = (memberId, payload) => core.pushTo(core.all('SELECT * FROM push_subs WHERE member_id = ?', memberId), payload);
  core.pushTo = (subs, payload) => {
    if (!subs.length || !core.pushSender) return;
    for (const s of subs) {
      Promise.resolve()
        .then(() => core.pushSender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload)))
        .catch((e) => {
          if (e && (e.statusCode === 404 || e.statusCode === 410)) core.run('DELETE FROM push_subs WHERE id = ?', s.id);
          else console.error('push 실패', e?.statusCode || e?.message);
        });
    }
  };
  return core;
}
