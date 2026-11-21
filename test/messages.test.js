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

test('테스트 알림: 구독된 기기로 푸시가 가고, 구독이 없거나 만료되면 이유를 알려 준다(만료 구독은 정리)', async () => {
  const f = await setup();
  try {
    const r = await f.mom.ok('POST', '/api/push/test');
    assert.equal(r.ok, true); assert.equal(r.sent, 1);
    assert.ok(f.pushes.some((p) => p.endpoint === 'https://push.example/mom' && /테스트/.test(p.payload.body)), '엄마 기기로 테스트 알림');
    assert.equal(f.pushes.filter((p) => p.endpoint !== 'https://push.example/mom').length, 0, '다른 사람 기기로는 가지 않는다');
    // 구독 없는 사람
    const none = await f.dad.ok('POST', '/api/push/unsubscribe', { endpoint: 'https://push.example/dad' });
    assert.ok(none.ok);
    const r2 = await f.dad.ok('POST', '/api/push/test');
    assert.equal(r2.ok, false); assert.equal(r2.reason, 'no_sub');
    // 푸시 서비스가 만료(410)라고 하면 구독을 지우고 실패로 알린다
    const old = f.core.pushSender;
    f.core.pushSender = async () => { const e = new Error('gone'); e.statusCode = 410; throw e; };
    const r3 = await f.gma.ok('POST', '/api/push/test');
    f.core.pushSender = old;
    assert.equal(r3.ok, false); assert.deepEqual(r3.failed, [410]);
    assert.equal(f.core.get('SELECT COUNT(*) c FROM push_subs WHERE endpoint = ?', 'https://push.example/gma').c, 0, '만료된 구독은 지운다');
  } finally { await f.close(); }
});
