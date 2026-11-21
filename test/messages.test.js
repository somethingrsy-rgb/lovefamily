import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

test('메시지 읽음 처리: 안 읽은 게 있을 때만 갱신 신호를 보내서, 화면이 끝없이 다시 그려지지 않는다', async () => {
  const f = await setup();
  try {
    const H = { 'X-Act-Kid': String(f.ids.yuel) };
    await f.device.ok('POST', '/api/messages', { kidId: f.ids.yuel, adultId: f.ids.mom, body: '배고파요' }, H);
    const sent = [];
    const orig = f.core.hub.publish.bind(f.core.hub);
    f.core.hub.publish = (fam, ev, to) => { sent.push(ev); return orig(fam, ev, to); };
    await f.mom.ok('POST', `/api/threads/${f.ids.yuel}/${f.ids.mom}/read`);
    assert.equal(sent.filter((e) => e.t === 'refresh' && e.topics.includes('messages')).length, 1, '처음 읽을 때는 한 번 알린다');
    sent.length = 0;
    await f.mom.ok('POST', `/api/threads/${f.ids.yuel}/${f.ids.mom}/read`);
    await f.mom.ok('POST', `/api/threads/${f.ids.yuel}/${f.ids.mom}/read`);
    assert.equal(sent.filter((e) => e.t === 'refresh').length, 0, '이미 읽었으면 갱신 신호가 없다(읽음→갱신→읽음 반복 방지)');
    // 받는 사람에게 알림(앱 안 알림)이 한 번 생긴다
    const n = await f.mom.ok('GET', '/api/notifications');
    assert.ok(n.items.some((x) => x.kind === 'message'), '어른에게 메시지 알림이 있다');
  } finally { await f.close(); }
});
