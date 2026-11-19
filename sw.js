/**
 * オフライン対応。アプリ本体は「ネット優先・つながらなければ保存済み」で配るので、
 * 公開し直すと次に開いた時から新しい版になる（バージョン番号を上げ忘れても古いままにならない）。
 * フォントとサムネイルは、一度表示したものを保存して使う。
 */
const VERSION = 'v3';
const SHELL_CACHE = `channelviewer-shell-${VERSION}`;
const ASSET_CACHE = 'channelviewer-assets';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './js/app.js',
  './js/drive.js',
  './js/youtube.js',
  './js/token-waiter.js',
  './manifest.webmanifest',
  './favicon.ico',
  './favicon-16.png',
  './favicon-32.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
];
const ASSET_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'yt3.ggpht.com', 'yt3.googleusercontent.com', 'lh3.googleusercontent.com'];
const MAX_ASSETS = 300;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('channelviewer-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') return cache.match('./index.html');
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') {
    await cache.put(request, res.clone());
    const keys = await cache.keys();
    if (keys.length > MAX_ASSETS) await Promise.all(keys.slice(0, keys.length - MAX_ASSETS).map((k) => cache.delete(k)));
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(request));
  else if (ASSET_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(request));
  // YouTube API・Google ログイン・ドライブは、そのままネットへ（データは端末に保存済み）
});
