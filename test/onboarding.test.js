import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { Client } from './helpers.js';

async function boot() {
  const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-onb-')) });
  const port = await app.listen(0, '127.0.0.1');
  return { app, base: `http://127.0.0.1:${port}` };
}

test('가입 마법사: 아이 이름·성별, 집 그림, 반려동물을 가족마다 다르게 정할 수 있다', async () => {
  const { app, base } = await boot();
  try {
    const c = new Client(base, 'a');
    const r = await c.ok('POST', '/api/auth/register', {
      loginId: 'new@fam', password: 'secret1', role: 'dad', familyName: '김씨네', name: '김아빠',
      kids: [{ name: '하늘', gender: 'girl' }, { name: '바다', gender: 'boy' }, { name: '구름', gender: 'girl' }],
      house: 'xmas', pets: { ruby: false, crystal: true, yeoni: false },
    });
    assert.match(r.recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const me = await c.ok('GET', '/api/me');
    assert.deepEqual(me.kids.map((k) => [k.name, k.gender]), [['하늘', 'girl'], ['바다', 'boy'], ['구름', 'girl']]);
    assert.equal(me.family.house, 'xmas');
    assert.deepEqual(me.family.pets, { ruby: false, crystal: true, yeoni: false });
    assert.equal(me.me.role, 'dad');
    assert.equal(me.me.isGuardian, true);
    assert.ok(!JSON.stringify(me).includes('유엘'), '다른 가족에는 유엘·유하가 들어가지 않는다');
  } finally { await app.close(); }
});

test('가입 검증: 아이가 없거나 성별이 틀리면 거절, 7명째는 거절', async () => {
  const { app, base } = await boot();
  try {
    const c = new Client(base, 'a');
    const bad = (kids) => c.call('POST', '/api/auth/register', { loginId: 'x' + Math.random().toString(36).slice(2, 8), password: 'secret1', kids });
    assert.equal((await bad([])).status, 400);
    assert.equal((await bad([{ name: '', gender: 'boy' }])).status, 400);
    assert.equal((await bad([{ name: '민', gender: 'robot' }])).status, 400);
    assert.equal((await bad(Array.from({ length: 7 }, (_, i) => ({ name: `a${i}`, gender: 'boy' })))).status, 400);
    assert.equal((await c.call('POST', '/api/auth/register', { loginId: 'okok', password: 'secret1', kids: [{ name: '민', gender: 'boy' }], house: 'castle' })).status, 400);
  } finally { await app.close(); }
});

test('어른 역할: 할아버지·기타 어른으로 참여할 수 있다', async () => {
  const { app, base } = await boot();
  try {
    const mom = new Client(base, 'm'); const gpa = new Client(base, 'g');
    await mom.ok('POST', '/api/auth/register', { loginId: 'mom@x', password: 'secret1', role: 'mom', kids: [{ name: '민', gender: 'boy' }] });
    const code = (await mom.ok('GET', '/api/me')).family.code;
    const j = await gpa.ok('POST', '/api/auth/join', { code, loginId: 'gpa@x', password: 'secret2', role: 'grandpa' });
    assert.ok(j.recoveryCode);
    const me = await mom.ok('GET', '/api/me');
    assert.deepEqual(me.adults.map((a) => a.role).sort(), ['grandpa', 'mom']);
    assert.equal(me.adults.find((a) => a.role === 'grandpa').avatar, '👴');
    assert.equal((await new Client(base, 'z').call('POST', '/api/auth/join', { code, loginId: 'bad@x', password: 'secret3', role: 'alien' })).status, 400);
  } finally { await app.close(); }
});

test('아이 추가(부모님만)·성별 수정, 가족 집 그림 변경', async () => {
  const { app, base } = await boot();
  try {
    const mom = new Client(base, 'm'); const gma = new Client(base, 'g');
    await mom.ok('POST', '/api/auth/register', { loginId: 'mom@y', password: 'secret1', role: 'mom', kids: [{ name: '민', gender: 'boy' }] });
    const code = (await mom.ok('GET', '/api/me')).family.code;
    await gma.ok('POST', '/api/auth/join', { code, loginId: 'gma@y', password: 'secret2', role: 'grandma' });
    assert.equal((await gma.call('POST', '/api/kids', { name: '새', gender: 'girl' })).status, 403, '부모님이 아니면 못 추가');
    const kid = await mom.ok('POST', '/api/kids', { name: '새', gender: 'girl' });
    assert.equal(kid.gender, 'girl');
    const upd = await mom.ok('PATCH', `/api/members/${kid.id}`, { gender: 'boy' });
    assert.equal(upd.gender, 'boy');
    assert.equal((await mom.call('PATCH', `/api/members/${kid.id}`, { gender: 'x' })).status, 400);
    const fam = await mom.ok('PATCH', '/api/family', { house: 'xmas' });
    assert.equal(fam.house, 'xmas');
    assert.equal((await mom.call('PATCH', '/api/family', { house: 'nope' })).status, 400);
  } finally { await app.close(); }
});

test('비밀번호 재설정: 복구 코드로 새 비밀번호를 정하고, 코드는 한 번 쓰면 새로 바뀐다', async () => {
  const { app, base } = await boot();
  try {
    const c = new Client(base, 'a');
    const r = await c.ok('POST', '/api/auth/register', { loginId: 'lost@pw', password: 'oldpass1', kids: [{ name: '민', gender: 'boy' }] });
    const other = new Client(base, 'o');
    const reset = (body) => other.call('POST', '/api/auth/reset-password', body);
    // 틀린 코드·없는 아이디는 같은 메시지
    const wrong = await reset({ loginId: 'lost@pw', recoveryCode: 'AAAA-BBBB-CCCC', newPassword: 'newpass1' });
    assert.equal(wrong.status, 401);
    assert.equal((await reset({ loginId: 'nobody', recoveryCode: r.recoveryCode, newPassword: 'newpass1' })).status, 401);
    assert.equal((await reset({ loginId: 'lost@pw', recoveryCode: r.recoveryCode, newPassword: '123' })).status, 400, '너무 짧은 비밀번호');
    // 소문자·공백이 섞여도 받는다
    const ok = await reset({ loginId: 'lost@pw', recoveryCode: r.recoveryCode.toLowerCase().replaceAll('-', ' '), newPassword: 'newpass1' });
    assert.equal(ok.status, 200);
    assert.notEqual(ok.json.recoveryCode, r.recoveryCode);
    assert.equal((await other.call('POST', '/api/auth/login', { loginId: 'lost@pw', password: 'oldpass1' })).status, 401);
    assert.equal((await other.call('POST', '/api/auth/login', { loginId: 'lost@pw', password: 'newpass1' })).status, 200);
    assert.equal((await c.call('GET', '/api/me')).status, 401, '예전 로그인은 풀린다');
    assert.equal((await new Client(base, 'p').call('POST', '/api/auth/reset-password', { loginId: 'lost@pw', recoveryCode: r.recoveryCode, newPassword: 'again123' })).status, 401, '쓴 코드는 못 쓴다');
  } finally { await app.close(); }
});

test('비밀번호 재설정은 틀리면 횟수 제한이 걸린다', async () => {
  const { app, base } = await boot();
  try {
    const c = new Client(base, 'a');
    await c.ok('POST', '/api/auth/register', { loginId: 'brute@pw', password: 'oldpass1', kids: [{ name: '민', gender: 'boy' }] });
    const o = new Client(base, 'o');
    let last;
    for (let i = 0; i < 9; i++) last = await o.call('POST', '/api/auth/reset-password', { loginId: 'brute@pw', recoveryCode: 'AAAA-AAAA-AAA' + (i % 9 + 2), newPassword: 'newpass1' });
    assert.equal(last.status, 429);
  } finally { await app.close(); }
});

test('로그인한 채 비밀번호 바꾸기 · 복구 코드 다시 만들기', async () => {
  const { app, base } = await boot();
  try {
    const a = new Client(base, 'a'); const a2 = new Client(base, 'a2');
    const r = await a.ok('POST', '/api/auth/register', { loginId: 'chg@pw', password: 'oldpass1', kids: [{ name: '민', gender: 'boy' }] });
    await a2.ok('POST', '/api/auth/login', { loginId: 'chg@pw', password: 'oldpass1' });
    assert.equal((await a.call('POST', '/api/me/password', { oldPassword: 'wrong', newPassword: 'newpass1' })).status, 401);
    assert.equal((await a.call('POST', '/api/me/password', { oldPassword: 'oldpass1', newPassword: '12' })).status, 400);
    await a.ok('POST', '/api/me/password', { oldPassword: 'oldpass1', newPassword: 'newpass1' });
    assert.equal((await a.call('GET', '/api/me')).status, 200, '지금 기기는 로그인 유지');
    assert.equal((await a2.call('GET', '/api/me')).status, 401, '다른 기기는 풀린다');
    assert.equal((await a.call('POST', '/api/me/recovery', { password: 'oldpass1' })).status, 401);
    const nr = await a.ok('POST', '/api/me/recovery', { password: 'newpass1' });
    assert.match(nr.recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const o = new Client(base, 'o');
    assert.equal((await o.call('POST', '/api/auth/reset-password', { loginId: 'chg@pw', recoveryCode: r.recoveryCode, newPassword: 'zzzzzz1' })).status, 401, '옛 코드는 무효');
    assert.equal((await o.call('POST', '/api/auth/reset-password', { loginId: 'chg@pw', recoveryCode: nr.recoveryCode, newPassword: 'zzzzzz1' })).status, 200);
  } finally { await app.close(); }
});
