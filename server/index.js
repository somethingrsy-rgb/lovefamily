import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import { createApp } from './app.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// .env 가 있으면 읽는다 (의존성 없이)
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(dataDir, { recursive: true });

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
let pushSender = null;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  pushSender = (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'high' });
} else {
  console.warn('[push] VAPID 키가 없어 휴대폰 푸시가 꺼져 있어요. `npm run vapid` 로 키를 만들어 환경변수에 넣어 주세요. (앱 안 알림·팝업은 정상 동작)');
}

const app = createApp({
  dbPath: path.join(dataDir, 'lovefamily.db'), dataDir, pushSender,
  vapidPublicKey: VAPID_PUBLIC_KEY || null, cookieSecure: process.env.COOKIE_SECURE === '1',
});
const port = await app.listen(Number(process.env.PORT) || 3000, process.env.HOST || '0.0.0.0');
console.log(`우리집 가족 대시보드: http://localhost:${port}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await app.close(); process.exit(0); });
