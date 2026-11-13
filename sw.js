/* Service Worker：只缓存"壳"（页面/样式/脚本/图标），
   /api/* 全部走本地计算，不经过缓存；数据本身永远实时联网取。 */
const CACHE = 'wb-wugc-v4';
const SHELL = [
  './index.html',
  './style.css?v=2',
  './app.js?v=2',
  './js/engine.js?v=2',
  './js/data.js?v=2',
  './js/deep.js?v=3',
  './js/shim.js?v=2',
  './js/pwa.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 接口与第三方数据：一律走网络，不缓存
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        // 后台更新，下次生效
        fetch(req).then((r) => { if (r && r.ok) caches.open(CACHE).then((c) => c.put(req, r.clone())); }).catch(() => {});
        return hit;
      }
      return fetch(req).then((r) => {
        if (r && r.ok && (req.destination === 'script' || req.destination === 'style' || req.destination === 'document')) {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return r;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
