// SSE 허브: 아이 전용 폰에는 자기 아이의 도장·활동·돈 소식만 간다(다른 아이의 도장 쾅 장면이 보이면 안 된다)
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Hub } from '../server/core.js';

const conn = (hub, meta) => { const res = new EventEmitter(); res.out = []; res.write = (d) => res.out.push(JSON.parse(d.replace(/^data: /, ''))); hub.add(res, meta); return res; };

test('아이 폰은 다른 아이의 도장·활동·돈 소식을 받지 않는다', () => {
  const hub = new Hub();
  const yuel = conn(hub, { familyId: 1, bound: 10, device: true, kidId: 10 });
  const yuha = conn(hub, { familyId: 1, bound: 11, device: true, kidId: 11 });
  const living = conn(hub, { familyId: 1, device: true });
  for (const t of ['stamp', 'timer', 'coins']) hub.publish(1, { t, kidId: 10 }, { devices: true });
  assert.deepEqual(yuel.out.map((e) => e.t), ['stamp', 'timer', 'coins'], '유엘 폰은 자기 소식을 받는다');
  assert.deepEqual(yuha.out, [], '유하 폰은 유엘의 도장 쾅을 보면 안 된다');
  assert.deepEqual(living.out.map((e) => e.t), ['stamp', 'timer', 'coins'], '거실 기기는 모두 받는다');
});
