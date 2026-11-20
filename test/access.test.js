import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, Client } from './helpers.js';

const asKid = (kid) => ({ 'X-Act-Kid': String(kid) });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('⑦ 메시지는 선택한 어른에게만 팝업·푸시가 가고, 대화는 두 사람에게만 열린다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const kid = f.ids.yuel;
    // SSE: 엄마/아빠 휴대폰 + 아이 기기가 각각 구독
    const listen = async (client, qs = '') => {
      const ev = []; const ac = new AbortController();
      const res = await fetch(f.base + '/api/stream' + qs, { headers: { cookie: client.cookie, 'X-Requested-With': 'lovefamily' }, signal: ac.signal });
      (async () => { try { const rd = res.body.getReader(); const dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; for (const m of dec.decode(value).matchAll(/data: (.*)\n/g)) ev.push(JSON.parse(m[1])); } } catch {} })();
      return { ev, stop: () => ac.abort() };
    };
    const sMom = await listen(f.mom); const sDad = await listen(f.dad); const sGma = await listen(f.gma);
    const sKid = await listen(f.device, `?kid=${kid}`);
    await new Promise((r) => setTimeout(r, 100));
    const sent = await f.device.ok('POST', '/api/messages', { kidId: kid, adultId: f.ids.dad, body: '언제 와요?' }, asKid(kid));
    await f.flush(); await new Promise((r) => setTimeout(r, 100));
    const popups = (s) => s.ev.filter((e) => e.t === 'notify' && e.kind === 'message');
    assert.equal(popups(sDad).length, 1, '아빠만 팝업');
    assert.equal(popups(sMom).length, 0); assert.equal(popups(sGma).length, 0); assert.equal(popups(sKid).length, 0);
    // 이벤트에는 본문이 없다(내용은 권한 검증된 API로 다시 읽는다)
    assert.ok(!JSON.stringify(popups(sDad)[0]).includes('언제'));
    const msgPush = f.pushes.filter((p) => p.payload.body.includes('메시지'));
    assert.equal(msgPush.length, 1); assert.equal(msgPush[0].endpoint, 'https://push.example/dad');
    assert.ok(!msgPush[0].payload.body.includes('언제 와요'), '잠금화면에는 본문 미표시');
    assert.match(msgPush[0].payload.body, /유엘/);
    // 읽을 수 있는 사람: 아빠 ○, 엄마 ✕(부모라도 남의 대화는 못 봄), 할머니 ✕
    assert.equal((await f.dad.get(`/api/threads/${kid}/${f.ids.dad}`)).json.length, 1);
    assert.equal((await f.mom.get(`/api/threads/${kid}/${f.ids.dad}`)).status, 403);
    assert.equal((await f.gma.get(`/api/threads/${kid}/${f.ids.dad}`)).status, 403);
    // 같은 알림 재전달(중복 팝업/업무 방지): 알림 id는 같고 dedupe 로 한 번만 생성
    assert.equal(f.core.get("SELECT COUNT(*) c FROM notifications WHERE kind = 'message'").c, 1);
    const nid = popups(sDad)[0].id;
    assert.equal((await f.dad.get(`/api/notifications/${nid}`)).json.body, '언제 와요?');
    assert.equal((await f.mom.get(`/api/notifications/${nid}`)).status, 403);
    // 답장 → 아이 받은 편지함으로만
    await f.dad.ok('POST', '/api/messages', { kidId: kid, adultId: f.ids.dad, body: '곧 가요' });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(sKid.ev.filter((e) => e.t === 'notify' && e.kind === 'message').length, 1);
    const inbox = await f.device.ok('GET', `/api/notifications?kidId=${kid}`, undefined, asKid(kid));
    assert.ok(inbox.items.some((i) => i.body === '곧 가요'));
    // 다른 아이로 전환한 기기는 이 아이의 대화/받은 편지함을 못 본다
    assert.equal((await f.device.get(`/api/threads/${kid}/${f.ids.dad}`, asKid(f.ids.yuha))).status, 403);
    assert.equal((await f.device.get(`/api/notifications?kidId=${kid}`, asKid(f.ids.yuha))).status, 403);
    // 아이가 직접 다른 아이 이름으로 보낼 수도 없다
    assert.equal((await f.device.post('/api/messages', { kidId: kid, adultId: f.ids.dad, body: '해킹' }, asKid(f.ids.yuha))).status, 403);
    assert.equal(sent.body, '언제 와요?');
    [sMom, sDad, sGma, sKid].forEach((s) => s.stop());
  } finally { await f.close(); }
});

test('⑧ 다른 아이·다른 가족의 비공개 장부·대화·사진에 접근할 수 없다', async () => {
  const f = await setup({ withRoutines: false });
  try {
    const [a, b] = [f.ids.yuel, f.ids.yuha];
    await f.addMoney(a, 7000);
    const photoRes = await f.device.call('POST', '/api/photos', PNG, { 'X-Photo-Kind': 'wish', 'X-Kid-Id': String(a), 'X-Act-Kid': String(a) });
    assert.equal(photoRes.status, 201, JSON.stringify(photoRes.json));
    const pid = photoRes.json.id;
    // 다른 가족 계정
    const other = new Client(f.base, 'other');
    await other.ok('POST', '/api/auth/register', { loginId: 'other@test', password: 'secret9', role: 'mom', familyName: '남의집' });
    for (const [m, u] of [['GET', `/api/kids/${a}/wallet`], ['GET', `/api/kids/${a}/ledger`], ['GET', `/api/kids/${a}/wishes`], ['GET', `/api/kids/${a}/stamps`], ['GET', `/api/kids/${a}/day`], ['GET', `/api/photos/${pid}`], ['GET', `/api/threads/${a}/${f.ids.mom}`]]) {
      assert.equal((await other.call(m, u)).status, 404, `${u} 은 남의 가족에게 404`);
    }
    assert.equal((await other.post(`/api/kids/${a}/deposits`, { amount: 1 })).status, 404);
    assert.equal((await other.post(`/api/stamp-requests/1/approve`)).status, 404);
    assert.equal((await other.post('/api/messages', { kidId: a, adultId: f.ids.mom, body: 'x' })).status, 404);
    assert.equal((await new Client(f.base).get('/api/home')).status, 401, '비로그인');
    // 같은 가족 안: 아이 B 로 전환한 기기는 A 의 장부·사진을 못 본다
    const asB = asKid(b);
    for (const u of [`/api/kids/${a}/wallet`, `/api/kids/${a}/ledger`, `/api/kids/${a}/wishes`, `/api/photos/${pid}`, `/api/kids/${a}/requests`, `/api/kids/${a}/missions`]) {
      assert.equal((await f.device.get(u, asB)).status, 403, u);
    }
    assert.equal((await f.device.get(`/api/kids/${a}/wallet`)).status, 403, '아이 미선택');
    assert.equal((await f.device.get(`/api/kids/${a}/wallet`, asKid(a))).status, 200);
    assert.equal((await f.device.get(`/api/photos/${pid}`, asKid(a))).status, 200);
    // 어른 세션은 가족 안의 모든 아이 정보 접근 가능
    assert.equal((await f.dad.get(`/api/photos/${pid}`)).status, 200);
    // 공용 기기: 어른 재인증 없이는 어른 권한 동작 불가 + 잔액 정정/승인은 재인증 후
    assert.equal((await f.device.post(`/api/kids/${a}/adjust`, { amount: -100, reason: 'x' })).status, 401);
    assert.equal((await f.device.get('/api/adult/home')).status, 401);
    const bad = await f.device.post('/api/auth/reauth', { memberId: f.ids.mom, password: 'wrong!!' });
    assert.equal(bad.status, 401);
    const tok = await f.elevate('mom', f.pw.mom);
    assert.equal((await f.device.post(`/api/kids/${a}/adjust`, { amount: -100, reason: '재인증 후 정정' }, { 'X-Elevation': tok })).status, 200);
    // 할머니(부모 권한 없음)가 재인증해도 정정 불가
    const gtok = await f.elevate('gma', f.pw.gma);
    assert.equal((await f.device.post(`/api/kids/${a}/adjust`, { amount: -100, reason: 'x' }, { 'X-Elevation': gtok })).status, 403);
    // 공용 홈에는 개인 잔액·메시지 본문이 없다
    const home = JSON.stringify((await f.device.ok('GET', '/api/home')));
    assert.ok(!/balance|available|잔액|7000|6900/.test(home));
    // CSRF: 커스텀 헤더 없는 변경 요청 거부
    const raw = await fetch(f.base + '/api/notes', { method: 'POST', headers: { cookie: f.mom.cookie, 'Content-Type': 'application/json' }, body: '{"text":"x"}' });
    assert.equal(raw.status, 403);
    // 사진 형식 검증
    assert.equal((await f.mom.call('POST', '/api/photos', Buffer.from('<html>'), { 'X-Photo-Kind': 'post' })).status, 415);
    // 아이 PIN: 잠금 → 해제 전엔 접근 불가
    await f.mom.ok('PUT', `/api/kids/${b}/pin`, { pin: '1234' });
    assert.equal((await f.device.get(`/api/kids/${b}/wallet`, asKid(b))).status, 403);
    assert.equal((await f.device.post(`/api/kids/${b}/unlock`, { pin: '0000' })).status, 401);
    await f.device.ok('POST', `/api/kids/${b}/unlock`, { pin: '1234' });
    assert.equal((await f.device.get(`/api/kids/${b}/wallet`, asKid(b))).status, 200);
  } finally { await f.close(); }
});

test('가족 연결: 초대 코드, 이름·아바타 변경, 상태·알림장·한마디·일정, 사진 알림', async () => {
  const f = await setup({ withRoutines: false });
  try {
    assert.equal((await new Client(f.base).post('/api/auth/join', { code: 'NOPE1234', loginId: 'zzz@t', password: 'secret1' })).status, 404);
    // 이름·아바타 변경
    const up = await f.mom.ok('PATCH', `/api/members/${f.ids.yuel}`, { name: '유엘이', avatar: '🦊' });
    assert.equal(up.name, '유엘이');
    assert.equal((await f.gma.patch(`/api/members/${f.ids.dad}`, { name: '아빠?' })).status, 403);
    // 상태
    await f.dad.ok('PUT', '/api/status', { state: 'heading_home', etaMinutes: 30 });
    f.clock.t += 60000;
    let home = await f.device.ok('GET', '/api/home');
    const dad = home.adults.find((x) => x.id === f.ids.dad);
    assert.equal(dad.status.label, '집에 가는 중'); assert.equal(dad.status.etaAt, Date.parse('2026-11-20T03:00:00Z') + 30 * 60000);
    // 할머니 상태 카드 표시 설정
    await f.mom.ok('PATCH', '/api/family', { showGrandmaStatus: false });
    home = await f.device.ok('GET', '/api/home');
    assert.ok(!home.adults.some((x) => x.role === 'grandma'));
    // 알림장: 사진 + 준비물 + 기한 + 고정 + 게시자 선택 알림
    const ph = await f.mom.call('POST', '/api/photos', PNG, { 'X-Photo-Kind': 'post' });
    const post = await f.mom.ok('POST', '/api/posts', { title: '소풍 안내', body: '도시락 준비', kidId: f.ids.yuel, photoId: ph.json.id, dueDate: '2026-11-20', supplies: '도시락, 물통', pinned: true, notify: true });
    await f.flush();
    assert.equal(post.tag, '유엘이'); assert.equal(post.pinned, true);
    const pushed = f.pushes.filter((p) => p.payload.body === '알림장 · 새 글').map((p) => p.endpoint).sort();
    assert.deepEqual(pushed, ['https://push.example/dad', 'https://push.example/gma']);
    await f.mom.ok('POST', '/api/posts', { title: '조용한 글', body: '알림 없이' });
    await f.flush();
    assert.equal(f.pushes.filter((p) => p.payload.body === '알림장 · 새 글').length, 2, 'notify 를 선택하지 않으면 푸시 없음');
    await f.dad.ok('POST', `/api/posts/${post.id}/read`);
    const list = await f.dad.ok('GET', '/api/posts');
    assert.equal(list[0].id, post.id, '고정된 글이 위');
    assert.equal(list[0].reads.filter((r) => r.readAt).length, 2);
    await f.mom.ok('POST', '/api/events', { title: '치과', date: '2026-11-20', kidId: f.ids.yuha });
    assert.equal((await f.device.post('/api/notes', { text: '아이 미선택' })).status, 403);
    await f.mom.ok('POST', '/api/notes', { text: '오늘 저녁은 카레' });
    await f.device.ok('POST', '/api/notes', { text: '유하가 쓴 한마디' }, asKid(f.ids.yuha));
    home = await f.device.ok('GET', '/api/home');
    assert.deepEqual(home.schedule.map((s) => s.title).sort(), ['소풍 안내', '치과'].sort());
    assert.equal(home.schedule.find((s) => s.type === 'due').supplies, '도시락, 물통');
    assert.equal(home.notes.length, 2);
    const cal = await f.device.ok('GET', '/api/calendar?month=2026-11');
    assert.equal(cal.schedule.length, 2);
    // 아이는 알림장 글을 쓸 수 없다
    assert.equal((await f.device.post('/api/posts', { title: 'x' }, asKid(f.ids.yuha))).status, 401);
    // 푸시 구독 해제 후에는 푸시가 가지 않는다(앱 안 알림은 유지)
    await f.gma.ok('POST', '/api/push/unsubscribe', { endpoint: 'https://push.example/gma' });
    f.pushes.length = 0;
    await f.mom.ok('POST', '/api/posts', { title: '또', notify: true });
    await f.flush();
    assert.deepEqual(f.pushes.map((p) => p.endpoint), ['https://push.example/dad']);
    assert.ok((await f.gma.ok('GET', '/api/notifications')).items.some((n) => n.title.includes('또')));
  } finally { await f.close(); }
});
