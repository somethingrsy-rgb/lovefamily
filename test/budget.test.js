import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setup } from './helpers.js';
import { openDb } from '../server/db.js';

const MIN = 60000;
const acts = async (f) => Object.fromEntries((await f.mom.ok('GET', '/api/activities')).map((a) => [a.kind, a]));
const advance = async (f, ms) => { f.clock.t += ms; f.app.settle(); await f.flush(); await new Promise((r) => setTimeout(r, 40)); };

test('활동 시간은 하루 총 시간: 일시 중단하면 남은 시간이 보이고, 이어서/나눠서 해도 하루 총합을 넘지 않는다', async () => {
  const f = await setup();
  try {
    const a = await acts(f); const kid = f.ids.yuel; const url = `/api/kids/${kid}/timers`;
    assert.equal(a.game.minutes, 30);
    const b0 = (await f.device.ok('GET', `/api/kids/${kid}/activity-budget`)).find((x) => x.activityId === a.game.id);
    assert.equal(b0.leftMs, 30 * MIN);
    const t = await f.device.ok('POST', url, { activityId: a.game.id });
    assert.equal(t.remainingMs, 30 * MIN);
    await advance(f, 12 * MIN);
    // 일시 중단: 남은 시간 18분이 알려지고, 시간은 더 흐르지 않는다
    const p = await f.device.ok('POST', `/api/timers/${t.id}/pause`);
    assert.equal(p.state, 'paused'); assert.equal(p.remainingMs, 18 * MIN); assert.equal(p.dayLeftMs, 18 * MIN);
    await advance(f, 40 * MIN); // 한참 지나도(예전 종료 시각을 넘어도) 끝나지 않는다
    let cur = (await f.device.ok('GET', '/api/timers')).timers.find((x) => x.kidId === kid);
    assert.equal(cur.state, 'paused'); assert.equal(cur.remainingMs, 18 * MIN);
    assert.equal(f.pushes.filter((x) => (x.payload.body || '').includes('끝났어요')).length, 0, '일시 중단 중에는 종료 알림이 없다');
    // 이어서 하기: 남은 18분부터 다시 센다
    const r = await f.device.ok('POST', `/api/timers/${t.id}/resume`);
    assert.equal(r.state, 'running'); assert.equal(r.remainingMs, 18 * MIN);
    await advance(f, 8 * MIN);
    // 중단(그만하기) → 오늘 남은 시간은 10분. 다시 시작하면 10분짜리가 된다(하루 총 30분)
    await f.device.ok('POST', `/api/timers/${t.id}/cancel`);
    const b1 = (await f.device.ok('GET', `/api/kids/${kid}/activity-budget`)).find((x) => x.activityId === a.game.id);
    assert.equal(b1.usedMs, 20 * MIN); assert.equal(b1.leftMs, 10 * MIN);
    const t2 = await f.device.ok('POST', url, { activityId: a.game.id });
    assert.equal(t2.remainingMs, 10 * MIN, '남은 하루 시간만큼만 시작');
    await advance(f, 10 * MIN + 1000);
    const end = (await f.device.ok('GET', '/api/timers')).timers.find((x) => x.kidId === kid);
    assert.equal(end.state, 'ended');
    await f.device.ok('POST', `/api/timers/${end.id}/dismiss`);
    // 오늘 게임 시간을 다 썼다 → 시작 불가(어른이 시간을 정해 주면 가능), 다른 활동은 그대로 가능
    const no = await f.device.post(url, { activityId: a.game.id });
    assert.equal(no.status, 409); assert.equal(no.json.error, 'budget_used');
    assert.equal((await f.device.post(url, { activityId: a.tv.id })).status, 201);
  } finally { await f.close(); }
});

test('일시 중단: 다른 활동을 시작해도 남은 시간은 기록되고, 아이별로 따로 계산되며, 다음 날에는 새로 시작한다', async () => {
  const f = await setup();
  try {
    const a = await acts(f);
    const t = await f.device.ok('POST', `/api/kids/${f.ids.yuel}/timers`, { activityId: a.game.id });
    await advance(f, 5 * MIN);
    await f.device.ok('POST', `/api/timers/${t.id}/pause`);
    // 다른 활동을 시작하면 일시 중단한 활동은 닫히지만, 남은 25분은 오늘 계속 쓸 수 있다
    await f.device.ok('POST', `/api/kids/${f.ids.yuel}/timers`, { activityId: a.tv.id });
    const budget = (await f.device.ok('GET', `/api/kids/${f.ids.yuel}/activity-budget`)).find((x) => x.activityId === a.game.id);
    assert.equal(budget.leftMs, 25 * MIN);
    const other = (await f.device.ok('GET', `/api/kids/${f.ids.yuha}/activity-budget`)).find((x) => x.activityId === a.game.id);
    assert.equal(other.leftMs, 30 * MIN, '유하의 게임 시간은 영향 없음');
    // 일시 중단은 아이 본인만(다른 아이 활동은 못 건드림은 ownOnly 로 보장) — 진행 중이 아니면 409
    assert.equal((await f.device.post(`/api/timers/${t.id}/pause`)).status, 409);
    // 다음 날: 하루 총 시간이 새로 시작
    await advance(f, 24 * 60 * MIN);
    const next = (await f.device.ok('GET', `/api/kids/${f.ids.yuel}/activity-budget`)).find((x) => x.activityId === a.game.id);
    assert.equal(next.leftMs, 30 * MIN);
  } finally { await f.close(); }
});

test('같은 활동을 일시 중단해 두고 [시작]하면 새로 만들지 않고 이어서 한다 · 일시 중단 중 어른이 시간을 더해 줄 수 있다', async () => {
  const f = await setup();
  try {
    const a = await acts(f); const kid = f.ids.yuel;
    const t = await f.device.ok('POST', `/api/kids/${kid}/timers`, { activityId: a.tv.id });
    await advance(f, 20 * MIN);
    await f.device.ok('POST', `/api/timers/${t.id}/pause`);
    const again = await f.device.ok('POST', `/api/kids/${kid}/timers`, { activityId: a.tv.id });
    assert.equal(again.id, t.id, '같은 활동은 이어서');
    assert.equal(again.remainingMs, 10 * MIN);
    await f.device.ok('POST', `/api/timers/${t.id}/pause`);
    assert.equal((await f.device.post(`/api/timers/${t.id}/extend`, { minutes: 10 })).status, 401, '시간 추가는 어른만');
    const ext = await f.mom.ok('POST', `/api/timers/${t.id}/extend`, { minutes: 10 });
    assert.equal(ext.state, 'paused'); assert.equal(ext.remainingMs, 20 * MIN);
  } finally { await f.close(); }
});

test('예전 DB(일시 중단이 없던 timers 표)는 열 때 새 모양으로 옮겨지고 기존 기록이 그대로 남는다', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lf-mig-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE timers (
    id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, activity_id INTEGER, name TEXT NOT NULL, icon TEXT NOT NULL, kind TEXT NOT NULL,
    duration_ms INTEGER NOT NULL, extended_ms INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','ended','dismissed','canceled')),
    warn_sent_for INTEGER, end_sent_for INTEGER, next_type TEXT, next_item_id INTEGER, next_name TEXT, next_icon TEXT, ended_at INTEGER, created_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX one_running_timer ON timers(kid_id) WHERE status = 'running';
    INSERT INTO timers (family_id, kid_id, activity_id, name, icon, kind, duration_ms, started_at, ends_at, status, created_at) VALUES (1, 5, 2, '게임하기', 'g', 'game', 1800000, 1000, 1801000, 'running', 1000);`);
  old.close();
  const db = openDb(file);
  const rows = db.prepare('SELECT * FROM timers').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].name, '게임하기'); assert.equal(rows[0].status, 'running');
  db.prepare("UPDATE timers SET status = 'paused', remain_ms = 5 WHERE id = ?").run(rows[0].id); // 이제 paused 가능
  const ins = () => db.prepare("INSERT INTO timers (family_id, kid_id, name, icon, kind, duration_ms, started_at, ends_at, status, created_at) VALUES (1, 5, 'x', 'x', 'game', 1, 1, 2, 'running', 1)").run();
  ins(); // 일시 중단 중이던 아이가 새로 시작은 가능
  assert.throws(ins, /UNIQUE/, '아이당 진행 중 하나 제약 유지');
  db.close();
  openDb(file).close(); // 두 번째 열기도 문제없다
});
