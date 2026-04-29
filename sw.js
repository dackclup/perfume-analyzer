// Perfume Analyzer — service worker
//
// Strategy
//   - Pre-cache the app shell (HTML + JS data + manifest) on install
//     so the page loads offline after a single online visit.
//   - Network-first for the HTML pages so deploy bumps land
//     immediately on next online load (HTML is small, sub-second).
//   - Cache-first for the data JS files (perfumery_data.js etc.)
//     since their bytes only change when the cache-bust query string
//     bumps, and the request URL already includes that parameter.
//   - PubChem REST + structure image responses are bypassed entirely
//     (network-only) so the SW never serves stale chemistry data.
//
// Versioning
//   Bump CACHE_VERSION whenever the shell file list changes; the
//   activate handler purges every previous version.

const CACHE_VERSION = 'perfume-shell-v1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './formulation.html',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isShell(url) {
  return /\.(html|webmanifest)$/i.test(url.pathname) || url.pathname.endsWith('/');
}
function isLocalScript(url) {
  // Bundled JS data files served from the same origin. PubChem and
  // other third-party scripts fall through to network-only.
  return url.origin === self.location.origin && /\.js(\?|$)/i.test(url.pathname + url.search);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }

  // PubChem and other cross-origin chemistry endpoints — never cache.
  if (url.origin !== self.location.origin) return;

  if (isShell(url)) {
    // Network-first for HTML so deploys propagate on first online load.
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then(m => m || caches.match('./index.html')))
    );
    return;
  }

  if (isLocalScript(url)) {
    // Cache-first for bundled JS — the cache-bust query in the
    // <script src> tag means changed bytes always carry a new URL,
    // so a cached entry is always either current or pinned to its
    // version string.
    event.respondWith(
      caches.match(req).then(cached =>
        cached ||
        fetch(req).then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
      )
    );
  }
});
