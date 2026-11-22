// 서비스 워커: 앱 껍데기(코드·스타일)를 폰에 통째로 저장해 두고 바로 열고, 그림은 한 번 받으면 계속 쓴다. 푸시 알림 표시/클릭 처리도 한다.
// 빌드 번호는 서버가 넣어 준다: 앱 파일이 바뀌면 번호가 바뀌고, 새 번호의 파일 묶음을 '전부' 받은 뒤에야 바꿔 끼운다(옛 코드와 새 코드가 섞이지 않는다).
const BUILD = '__BUILD__';
const CODE_CACHE = `lovefamily-code-${BUILD}`;
const IMG_CACHE = 'lovefamily-img-v1'; // 그림·아이콘: 빌드가 바뀌어도 유지

async function precache() {
  const c = await caches.open(CODE_CACHE);
  const html = await (await fetch('/', { cache: 'reload' })).text();
  const urls = new Set(['/', '/styles.css', '/manifest.webmanifest']);
  for (const m of html.matchAll(/href="(\/[^"]+\.js)"/g)) urls.add(m[1]);
  await Promise.all([...urls].map(async (u) => { const r = await fetch(u, { cache: 'reload' }); if (!r.ok) throw new Error(`precache ${u} ${r.status}`); await c.put(u, r); }));
}
self.addEventListener('install', (e) => { e.waitUntil(precache().then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('lovefamily-') && k !== CODE_CACHE && k !== IMG_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// API 와 사진(비공개)은 건드리지 않는다. 코드는 저장해 둔 것을 바로(네트워크 대기 없음), 그림은 저장해 둔 것을 바로 + 뒤에서 확인.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;
  if (/^\/(assets|icons)\//.test(url.pathname)) {
    e.respondWith(caches.open(IMG_CACHE).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: false });
      const net = fetch(e.request, { cache: 'no-cache' }).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  e.respondWith(caches.open(CODE_CACHE).then(async (c) => {
    const key = e.request.mode === 'navigate' ? '/' : e.request;
    const hit = await c.match(key);
    if (hit) return hit;
    try { const res = await fetch(e.request); if (res.ok && url.pathname !== '/') c.put(e.request, res.clone()); return res; }
    catch { return (await c.match('/')) || Response.error(); }
  }));
});

// 푸시: 잠금화면에는 서버가 보낸 최소 문구(이름·알림 종류)만 표시한다.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: '새 알림이 있어요' }; }
  e.waitUntil(self.registration.showNotification(d.title || '우리집', {
    body: d.body || '새 알림이 있어요', tag: d.tag || 'lovefamily', data: { url: d.url || '/', nid: d.nid }, icon: '/icons/heart-pink.png', badge: '/icons/badge-heart.png',
    // 안드로이드: 진동 + 다시 울림, 메시지·도장 요청은 눌러서 확인할 때까지 남겨 둔다(잠금 화면에서도 보이도록). iPhone 은 이 옵션들을 무시한다.
    vibrate: Array.isArray(d.vibrate) && d.vibrate.length <= 12 ? d.vibrate.map((n) => Math.min(2000, Number(n) || 0)) : [200, 100, 200], renotify: true, requireInteraction: !!d.sticky, timestamp: Date.now(),
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { url, nid } = e.notification.data || {};
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); c.postMessage({ t: 'open', url: url || '/', nid }); return; }
    }
    await self.clients.openWindow(url || '/');
  })());
});

// 푸시 구독이 만료·교체되면(iPhone에서 가끔) 스스로 다시 구독해서 서버에 알린다 — 그래야 앱을 닫아 둬도 알림이 계속 온다.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const { publicKey } = await (await fetch('/api/push/key', { credentials: 'same-origin', headers: { 'X-Requested-With': 'lovefamily' } })).json();
      if (!publicKey) return;
      const pad = '='.repeat((4 - (publicKey.length % 4)) % 4);
      const raw = atob((publicKey + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const key = Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch('/api/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'lovefamily', 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    } catch { /* 로그인이 풀렸다면 다음에 앱을 열 때 다시 맞춘다 */ }
  })());
});
