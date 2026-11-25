import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { Client } from './helpers.js';
import { openDb } from '../server/db.js';

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

test('반려동물 이름: 기본 이름 없이 가족이 짓고, 나중에 바꾸고, 비우면 이름 없음', async () => {
  const { app, base } = await boot();
  try {
    const c = new Client(base, 'a');
    await c.ok('POST', '/api/auth/register', { loginId: 'pet@x', password: 'secret1', kids: [{ name: '민', gender: 'boy' }], pets: { ruby: true, yeoni: true }, petNames: { ruby: '나비', yeoni: '  초코 ' } });
    let f = (await c.ok('GET', '/api/me')).family;
    assert.deepEqual(f.petNames, { ruby: '나비', crystal: '', yeoni: '초코' });
    f = await c.ok('PATCH', '/api/family', { petNames: { crystal: '구름이' } });
    assert.deepEqual(f.petNames, { ruby: '나비', crystal: '구름이', yeoni: '초코' }, '보낸 것만 바뀐다');
    f = await c.ok('PATCH', '/api/family', { petNames: { ruby: '  ' } });
    assert.equal(f.petNames.ruby, '', '비우면 이름 없음(화면에서는 고양이/강아지로 보인다)');
    assert.equal((await c.call('PATCH', '/api/family', { petNames: { ruby: '열한글자이름입니다아아' } })).status, 400);
    const d = new Client(base, 'd');
    await d.ok('POST', '/api/auth/register', { loginId: 'pet2@x', password: 'secret1', kids: [{ name: '새', gender: 'girl' }] });
    assert.deepEqual((await d.ok('GET', '/api/me')).family.petNames, { ruby: '', crystal: '', yeoni: '' });
  } finally { await app.close(); }
});

test('반려동물 주인: 가입 때 정하고, 어른은 바꾸고, 아이는 자기 폰에서 주인 없는 동물만 고른다', async () => {
  const { app, base } = await boot();
  try {
    const mom = new Client(base, 'm');
    await mom.ok('POST', '/api/auth/register', { loginId: 'own@x', password: 'secret1', kids: [{ name: '하늘', gender: 'girl' }, { name: '바다', gender: 'boy' }], pets: { ruby: true, crystal: true, yeoni: true }, petOwners: { ruby: 1 } });
    const me = await mom.ok('GET', '/api/me');
    const [k0, k1] = me.kids.map((k) => k.id);
    assert.deepEqual(me.family.petOwners, { ruby: k1, crystal: null, yeoni: null }, '마법사에서 고른 주인만 저장');
    // 어른은 누구에게나
    assert.deepEqual((await mom.ok('PUT', '/api/pets/yeoni/owner', { kidId: k0 })).petOwners.yeoni, k0);
    assert.equal((await mom.call('PUT', '/api/pets/dragon/owner', { kidId: k0 })).status, 404);
    // 아이 폰(하늘): 주인 없는 크리스탈은 고를 수 있고, 남의 동물(다이아=바다)은 못 가져가며, 다른 아이 이름으로는 못 정한다
    const code = (await mom.ok('POST', `/api/kids/${k0}/pair-code`)).code;
    const phone = new Client(base, 'p');
    await phone.ok('POST', '/api/auth/kid-pair', { code });
    assert.equal((await phone.call('PUT', '/api/pets/crystal/owner', { kidId: k0 })).status, 200);
    assert.equal((await phone.call('PUT', '/api/pets/ruby/owner', { kidId: k0 })).status, 409);
    assert.equal((await phone.call('PUT', '/api/pets/crystal/owner', { kidId: k1 })).status, 403);
    // 간식·산책은 그 동물의 주인 아이 폰에서만
    assert.equal((await phone.call('POST', '/api/pets/act', { kidId: k0, kind: 'snack', pet: 'crystal' })).status, 200);
    assert.equal((await phone.call('POST', '/api/pets/act', { kidId: k0, kind: 'walk', pet: 'ruby' })).status, 403, '남의 동물');
    assert.equal((await phone.call('POST', '/api/pets/act', { kidId: k0, kind: 'walk' })).status, 400, '어떤 동물인지 필요');
    assert.equal((await mom.call('POST', '/api/pets/act', { kidId: k0, kind: 'snack', pet: 'crystal' })).status, 403, '어른 폰은 못 한다');
    // 내 동물은 놓아 줄 수 있다
    assert.equal((await phone.call('PUT', '/api/pets/crystal/owner', { kidId: null })).status, 200);
    assert.equal((await mom.ok('GET', '/api/me')).family.petOwners.crystal, null);
  } finally { await app.close(); }
});

test('예전 가족 마이그레이션: 다이아·크리스탈·귀요미 이름과 첫째·둘째 주인이 그대로 저장된다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-mig-'));
  const dbPath = path.join(dir, 'old.db');
  // 이름·주인 칸이 아직 비어 있던 예전 DB 를 만든다(새 컬럼은 비우고, 가족 하나와 아이 둘)
  const first = openDb(dbPath);
  first.exec("INSERT INTO families (id, name, code, created_at) VALUES (1, '옛집', 'OLDCODE1', 1)");
  first.exec("INSERT INTO members (id, family_id, kind, role, name, avatar, color, sort, created_at) VALUES (10, 1, 'kid', 'kid', '첫째', '🐰', '#fff', 0, 1), (11, 1, 'kid', 'kid', '둘째', '🐱', '#fff', 1, 1)");
  first.exec('UPDATE families SET pet_names = NULL, pet_owners = NULL');
  first.close();
  const again = openDb(dbPath); // 다시 열면 채워진다
  const f = again.prepare('SELECT pet_names, pet_owners FROM families WHERE id = 1').get();
  assert.deepEqual(JSON.parse(f.pet_names), { ruby: '다이아', crystal: '크리스탈', yeoni: '귀요미' });
  assert.deepEqual(JSON.parse(f.pet_owners), { ruby: 10, crystal: null, yeoni: 11 });
  again.close();
});

test('방 고르기: 구성원이 지낼 방을 정하고(8곳 중), 잘못된 방은 거절, 비우면 기본 방', async () => {
  const { app, base } = await boot();
  try {
    const mom = new Client(base, 'm');
    await mom.ok('POST', '/api/auth/register', { loginId: 'room@x', password: 'secret1', kids: [{ name: '하늘', gender: 'girl' }, { name: '바다', gender: 'boy' }] });
    const me = await mom.ok('GET', '/api/me');
    assert.equal(me.kids[0].homeCell, null);
    const k = await mom.ok('PATCH', `/api/members/${me.kids[0].id}`, { homeCell: '11' });
    assert.equal(k.homeCell, '11');
    assert.equal((await mom.call('PATCH', `/api/members/${me.kids[0].id}`, { homeCell: '12' })).status, 400, '도장방은 못 고른다');
    assert.equal((await mom.call('PATCH', `/api/members/${me.kids[0].id}`, { homeCell: '99' })).status, 400);
    const a = await mom.ok('PATCH', `/api/members/${me.me.id}`, { homeCell: '22' });
    assert.equal(a.homeCell, '22');
    assert.equal((await mom.ok('PATCH', `/api/members/${me.kids[0].id}`, { homeCell: '' })).homeCell, null);
  } finally { await app.close(); }
});

test('간식·산책: 거실 공용 기기에서도 그 아이의 동물이면 할 수 있고, 어른 개인 폰은 안 된다', async () => {
  const { app, base } = await boot();
  try {
    const mom = new Client(base, 'm'); const device = new Client(base, 'd');
    await mom.ok('POST', '/api/auth/register', { loginId: 'dev@x', password: 'secret1', kids: [{ name: '하늘', gender: 'girl' }, { name: '바다', gender: 'boy' }], pets: { ruby: true, yeoni: true }, petOwners: { ruby: 0 } });
    await device.ok('POST', '/api/auth/login', { loginId: 'dev@x', password: 'secret1', device: true });
    const [k0, k1] = (await mom.ok('GET', '/api/me')).kids.map((k) => k.id);
    assert.equal((await device.call('POST', '/api/pets/act', { kidId: k0, kind: 'snack', pet: 'ruby' })).status, 200, '거실 기기: 하늘의 동물');
    assert.equal((await device.call('POST', '/api/pets/act', { kidId: k1, kind: 'walk', pet: 'ruby' })).status, 403, '바다의 동물이 아님');
    assert.equal((await mom.call('POST', '/api/pets/act', { kidId: k0, kind: 'snack', pet: 'ruby' })).status, 403, '어른 개인 폰');
  } finally { await app.close(); }
});

test('아이끼리 메시지: 두 아이만 주고받고, 받으면 알림이 가고, 읽으면 사라지며, 어른·다른 아이는 못 본다', async () => {
  const { app, base } = await boot();
  try {
    const mom = new Client(base, 'm');
    await mom.ok('POST', '/api/auth/register', { loginId: 'sib@x', password: 'secret1', kids: [{ name: '하늘', gender: 'girl' }, { name: '바다', gender: 'boy' }, { name: '구름', gender: 'girl' }] });
    const [k0, k1, k2] = (await mom.ok('GET', '/api/me')).kids.map((k) => k.id);
    const phone = async (kid) => { const c = new Client(base, `p${kid}`); await c.ok('POST', '/api/auth/kid-pair', { code: (await mom.ok('POST', `/api/kids/${kid}/pair-code`)).code }); return c; };
    const p0 = await phone(k0); const p1 = await phone(k1); const p2 = await phone(k2);
    // 하늘 → 바다
    const sent = await p0.ok('POST', '/api/kid-messages', { kidId: k0, toKidId: k1, body: '같이 놀자!' });
    assert.equal(sent.body, '같이 놀자!'); assert.equal(sent.senderId, k0);
    assert.equal((await p0.call('POST', '/api/kid-messages', { kidId: k0, toKidId: k0, body: '나한테' })).status, 400, '자기 자신에게는 못 보낸다');
    assert.equal((await p0.call('POST', '/api/kid-messages', { kidId: k1, toKidId: k0, body: '바다인 척' })).status, 403, '다른 아이인 척은 못 한다');
    assert.equal((await p0.call('POST', '/api/kid-messages', { kidId: k0, toKidId: k1, body: '   ' })).status, 400, '빈 메시지');
    // 바다: 대화 목록에 안 읽은 1건 + 알림 1건, 읽으면 둘 다 사라진다
    let th = await p1.ok('GET', `/api/kid-threads?kidId=${k1}`);
    assert.equal(th.length, 1); assert.equal(th[0].otherId, k0); assert.equal(th[0].unread, 1); assert.equal(th[0].last.body, '같이 놀자!');
    assert.equal((await p1.ok('GET', `/api/notifications?kidId=${k1}`)).unread, 1);
    assert.equal((await p1.ok('GET', `/api/kid-threads/${k1}/${k0}`)).length, 1);
    await p1.ok('POST', `/api/kid-threads/${k1}/${k0}/read`);
    assert.equal((await p1.ok('GET', `/api/kid-threads?kidId=${k1}`))[0].unread, 0);
    assert.equal((await p1.ok('GET', `/api/notifications?kidId=${k1}`)).unread, 0);
    // 답장
    await p1.ok('POST', '/api/kid-messages', { kidId: k1, toKidId: k0, body: '좋아!' });
    assert.deepEqual((await p0.ok('GET', `/api/kid-threads/${k0}/${k1}`)).map((m) => m.body), ['같이 놀자!', '좋아!']);
    // 셋째 아이·어른은 두 아이의 대화를 볼 수 없다
    assert.equal((await p2.call('GET', `/api/kid-threads/${k2}/${k0}`)).json.length, 0, '구름은 하늘과 대화한 적이 없다');
    assert.equal((await p2.call('GET', `/api/kid-threads/${k0}/${k1}`)).status, 403);
    assert.equal((await mom.call('GET', `/api/kid-threads/${k0}/${k1}`)).status, 403, '어른은 못 본다');
    assert.deepEqual((await mom.ok('GET', `/api/kid-threads?kidId=${k0}`)), [], '어른에게는 빈 목록');
  } finally { await app.close(); }
});
