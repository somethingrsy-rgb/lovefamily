// 개발용 예시 데이터. 실제 가족 정보/코드가 아닌 가짜 샘플이며, 개발 DB 에만 넣는다.
// 사용: npm run seed   (DATA_DIR 의 DB 에 '샘플네' 가족이 없으면 생성)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(dataDir, { recursive: true });
const app = createApp({ dbPath: path.join(dataDir, 'lovefamily.db'), dataDir });
const port = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
const PW = 'sample1234';

class C {
  cookie = '';
  async call(method, url, body, headers = {}) {
    const r = await fetch(base + url, { method, headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json', cookie: this.cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const j = await r.json().catch(() => ({}));
    if (r.status >= 300) throw new Error(`${method} ${url} ${r.status} ${JSON.stringify(j)}`);
    return j;
  }
}

if (app.core.get("SELECT 1 FROM users WHERE login_id = 'mom@sample.test'")) {
  console.log('이미 샘플 데이터가 있어요. (지우려면 data/ 폴더를 삭제하세요)');
} else {
  const mom = new C(); const dad = new C(); const gma = new C();
  await mom.call('POST', '/api/auth/register', { loginId: 'mom@sample.test', password: PW, role: 'mom', familyName: '샘플네' });
  const info = await mom.call('GET', '/api/me');
  await dad.call('POST', '/api/auth/join', { code: info.family.code, loginId: 'dad@sample.test', password: PW, role: 'dad' });
  await gma.call('POST', '/api/auth/join', { code: info.family.code, loginId: 'grandma@sample.test', password: PW, role: 'grandma' });
  const [yuel, yuha] = info.kids.map((k) => k.id);
  const both = [yuel, yuha];
  const R = (kidIds, name, icon, days, slot) => mom.call('POST', '/api/routines', { kidIds, name, icon, days, slot });
  await R(both, '양치하기', '🪥', 'daily', 'morning');
  await R(both, '책가방 싸기', '🎒', 'weekdays', 'morning');
  await R(both, '물 마시기', '💧', 'daily', 'after_school');
  await R([yuel], '숙제하기', '📚', 'weekdays', 'after_school');
  await R(both, '씻기', '🛁', 'daily', 'evening');
  await R(both, '장난감 정리', '🧸', 'daily', 'evening');
  await R(both, '내일 옷 꺼내 두기', '👕', 'daily', 'evening');
  await mom.call('POST', `/api/kids/${yuel}/opening-balance`, { amount: 12000 });
  await mom.call('POST', `/api/kids/${yuha}/opening-balance`, { amount: 7500 });
  await mom.call('PUT', '/api/status', { state: 'working' });
  await dad.call('PUT', '/api/status', { state: 'heading_home', etaMinutes: 40 });
  await mom.call('POST', '/api/notes', { text: '오늘 저녁은 카레예요 🍛' });
  await mom.call('POST', '/api/posts', { title: '현장학습 안내', body: '다음 주 목요일 소풍이에요. 도시락과 물통을 챙겨 주세요.', kidId: yuel, dueDate: '2026-11-26', supplies: '도시락, 물통, 돗자리', pinned: true });
  await mom.call('POST', '/api/missions', { kidId: yuel, title: '안 쓰는 장난감 분류 돕기', reward: 500 });
  console.log('샘플 데이터를 만들었어요.');
  console.log(`  엄마 mom@sample.test / 아빠 dad@sample.test / 할머니 grandma@sample.test  (비밀번호 모두 ${PW})`);
  console.log(`  가족 코드: ${info.family.code}  (개발용 임시 값)`);
}
await app.close();
