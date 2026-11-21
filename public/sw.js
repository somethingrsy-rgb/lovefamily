// 서비스 워커: 앱 껍데기 캐시(오프라인 대비) + 푸시 알림 표시/클릭 처리
const CACHE = 'lovefamily-shell-v3';
const SHELL = ['/', '/styles.css', '/js/main.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// 네트워크 우선, 실패하면 캐시. API 와 사진은 캐시하지 않는다(비공개 데이터).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
  );
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
