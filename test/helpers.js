import { createApp } from '../server/app.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class Client {
  constructor(base, name) { this.base = base; this.name = name; this.cookie = ''; this.headers = {}; }
  async call(method, url, body, extra = {}) {
    const headers = { 'X-Requested-With': 'lovefamily', cookie: this.cookie, ...this.headers, ...extra };
    let payload;
    if (Buffer.isBuffer(body)) { payload = body; headers['Content-Type'] = 'application/octet-stream'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const r = await fetch(this.base + url, { method, headers, body: payload });
    const sc = r.headers.get('set-cookie');
    if (sc) { const v = sc.split(';')[0]; this.cookie = v.endsWith('=') ? '' : v; }
    const ct = r.headers.get('content-type') || '';
    const json = ct.includes('json') ? await r.json() : null;
    return { status: r.status, json, res: r };
  }
  get(u, h) { return this.call('GET', u, undefined, h); }
  post(u, b = {}, h) { return this.call('POST', u, b, h); }
  put(u, b = {}, h) { return this.call('PUT', u, b, h); }
  patch(u, b = {}, h) { return this.call('PATCH', u, b, h); }
  del(u, h) { return this.call('DELETE', u, undefined, h); }
  // 성공을 기대하는 호출
  async ok(method, u, b, h) {
    const r = await this.call(method, u, b, h);
    if (r.status >= 300) throw new Error(`${method} ${u} → ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  }
}

// 가족 한 세트: 엄마·아빠·할머니(각자 계정) + 거실 기기 + 아이 둘
export async function setup({ withRoutines = true } = {}) {
  const clock = { t: Date.parse('2026-11-20T03:00:00Z') }; // 금요일 낮 12시(KST)
  const pushes = [];
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-'));
  const app = createApp({
    now: () => clock.t, dataDir,
    pushSender: async (sub, payload) => { pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); },
  });
  const port = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const mom = new Client(base, 'mom'); const dad = new Client(base, 'dad'); const gma = new Client(base, 'gma'); const device = new Client(base, 'device');
  await mom.ok('POST', '/api/auth/register', { loginId: 'mom@test', password: 'secret1', role: 'mom', familyName: '테스트집' });
  const info = await mom.ok('GET', '/api/me');
  const code = info.family.code;
  await dad.ok('POST', '/api/auth/join', { code, loginId: 'dad@test', password: 'secret2', role: 'dad' });
  await gma.ok('POST', '/api/auth/join', { code, loginId: 'gma@test', password: 'secret3', role: 'grandma' });
  await device.ok('POST', '/api/auth/login', { loginId: 'mom@test', password: 'secret1', device: true });
  const me = await mom.ok('GET', '/api/me');
  const ids = { mom: me.me.id, dad: (await dad.ok('GET', '/api/me')).me.id, gma: (await gma.ok('GET', '/api/me')).me.id, yuel: me.kids[0].id, yuha: me.kids[1].id };
  const f = { app, clock, pushes, base, mom, dad, gma, device, ids, code, dataDir, core: app.core };
  // 세 어른의 푸시 구독
  for (const [c, n] of [[mom, 'mom'], [dad, 'dad'], [gma, 'gma']]) {
    await c.ok('POST', '/api/push/subscribe', { subscription: { endpoint: `https://push.example/${n}`, keys: { p256dh: 'p', auth: 'a' } } });
  }
  if (withRoutines) {
    await mom.ok('POST', '/api/routines', { kidIds: [ids.yuel, ids.yuha], name: '양치하기', icon: '🪥', days: 'daily', slot: 'morning' });
    await mom.ok('POST', '/api/routines', { kidIds: [ids.yuel], name: '숙제하기', icon: '📚', days: 'weekdays', slot: 'after_school' });
  }
  f.close = () => app.close();
  f.flush = () => new Promise((r) => setTimeout(r, 30)); // 푸시 비동기 완료 대기
  // 헬퍼
  f.day = (kid, date) => mom.ok('GET', `/api/kids/${kid}/day${date ? `?date=${date}` : ''}`);
  f.completeDay = async (kid, date) => {
    const d = await f.day(kid, date);
    let last;
    for (const it of d.items) last = await device.ok('PUT', `/api/day-items/${it.id}`, { done: true });
    return last;
  };
  f.elevate = async (who, pw) => (await device.ok('POST', '/api/auth/reauth', { memberId: ids[who], password: pw })).token;
  f.pw = { mom: 'secret1', dad: 'secret2', gma: 'secret3' };
  f.wallet = async (kid) => mom.ok('GET', `/api/kids/${kid}/wallet`);
  f.addMoney = async (kid, amount, memo = '용돈') => mom.ok('POST', `/api/kids/${kid}/deposits`, { amount, memo });
  return f;
}
