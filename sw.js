/* Service Worker：壳走"网络优先 + 离线回退"，保证更新即时生效；
   /api/* 与第三方数据一律走网络，不缓存。 */
const CACHE = 'wb-wugc-v9';
const SHELL = [
  './index.html',
  './style.css?v=2',
  './app.js?v=2',
  './js/engine.js?v=2',
  './js/data.js?v=2',
  './js/deep.js?v=3',
  './js/news.js?v=7',
  './js/indices.js?v=5',
  './js/premarket.js?v=5',
  './js/shim.js?v=9',
  './js/pwa.js?v=2',
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

  // 同源静态资源：网络优先，失败再吃缓存
  e.respondWith(
    fetch(req).then((r) => {
      if (r && r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return r;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
