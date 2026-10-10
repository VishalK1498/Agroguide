// Agroguide service worker: lets the site open offline and load faster.
// Pages and the manifest use "network first" (you always get the newest version when online);
// images use "cache first". Firebase and other websites are never touched.
const CACHE = 'agroguide-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
               'sensor.jpeg', 'hydroponics.jpeg', 'robot.jpeg', 'high.jpeg', 'vertical.jpeg', 'solar.jpeg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;       // leave Firebase / fonts / other sites alone
  const isPage = req.mode === 'navigate' || /\.(html|webmanifest|js)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (isPage){
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html') || caches.match('./'))));
  } else {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
  }
});
