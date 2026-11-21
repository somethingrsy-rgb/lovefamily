// 서비스 워커: 앱 껍데기 캐시(오프라인 대비) + 푸시 알림 표시/클릭 처리
const CACHE = 'lovefamily-shell-v4';
const SHELL = ['/', '/styles.css', '/js/main.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// 이미지·아이콘: 캐시에 있으면 바로 보여 주고 뒤에서 새로 받아 둔다(다음에 반영). 그 밖의 앱 파일: 네트워크 우선, 3초 안에 안 오면 캐시로.
// API 와 사진은 캐시하지 않는다(비공개 데이터).
const put = (req, res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; };
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (/^\/(assets|icons)\//.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => put(e.request, res)).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const fromCache = () => caches.match(e.request).then((r) => r || caches.match('/'));
    const timer = setTimeout(() => fromCache().then((r) => { if (r && !done) { done = true; resolve(r); } }), 3000);
    fetch(e.request).then((res) => { clearTimeout(timer); put(e.request, res); if (!done) { done = true; resolve(res); } })
      .catch(() => { clearTimeout(timer); fromCache().then((r) => { if (!done) { done = true; resolve(r || Response.error()); } }); });
  }));
});

// 푸시: 잠금화면에는 서버가 보낸 최소 문구(이름·알림 종류)만 표시한다.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: '새 알림이 있어요' }; }
  e.waitUntil(self.registration.showNotification(d.title || '우리집', {
    body: d.body || '새 알림이 있어요', tag: d.tag || 'lovefamily', data: { url: d.url || '/', nid: d.nid }, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
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
