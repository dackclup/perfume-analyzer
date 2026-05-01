// Perfume Analyzer — service worker
//
// Strategy
//   - Pre-cache the app shell (HTML + manifest + the materials JSON) on
//     install so the page loads offline after a single online visit.
//   - Network-first for the HTML pages so deploy bumps land immediately
//     on next online load (HTML is small, sub-second).
//   - Cache-first for the bundled JS files (taxonomy, formulation_engine,
//     etc.) since their bytes only change when the cache-bust query string
//     bumps, and the request URL already includes that parameter.
//   - Stale-while-revalidate for data/materials.json so the page shows
//     cached materials instantly (offline-capable), and a fresh copy
//     replaces the cache for the next visit. The JSON URL also carries
//     a ?v=<DATA_VERSION> query so a content release is never silently
//     served from a stale cache — when the bootstrap fetches with the
//     new version, the request URL doesn't match the old cached entry
//     and falls through to the network.
//   - PubChem REST + structure image responses are bypassed entirely
//     (network-only) so the SW never serves stale chemistry data.
//
// Versioning
//   CACHE_VERSION = `perfume-shell-${manualMajor}-${contentHash}`. The
//   manual major (`v3`, `v4`, …) lives in version.json; the contentHash
//   is auto-derived from SHELL_ASSETS by scripts/release.mjs so any
//   shell content change rebusts the cache without a manual bump. The
//   activate handler purges every previous version.

const CACHE_VERSION = 'perfume-shell-v3-2af7974c';
const SHELL_ASSETS = [
  './',
  './index.html',
  './formulation.html',
  './manifest.webmanifest',
  './data/materials.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // Use addAll's "all-or-nothing" only for the truly required shell;
      // a missing entry would otherwise abort the install and leave the
      // page without offline support. The materials JSON is included so
      // the very first offline load has data to render.
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
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
function isMaterialsJSON(url) {
  // The cache-bust query is preserved in the request URL, so each version
  // is its own cache entry. Old versions are evicted on activate via
  // CACHE_VERSION rotation; see the activate handler above.
  return url.origin === self.location.origin && /\/data\/materials\.json(\?|$)/.test(url.pathname + url.search);
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

  if (isMaterialsJSON(url)) {
    // Three-tier strategy keyed off cache freshness:
    //   1. EXACT version match → stale-while-revalidate (same bytes, fast).
    //      Hit means the user has already loaded this DATA_VERSION; serving
    //      it instantly + background-fetching keeps subsequent reloads
    //      current without blocking first paint.
    //   2. No exact match → NETWORK-FIRST. Different DATA_VERSION in the
    //      URL means a fresh deploy; we want the new bytes, not a stale
    //      sibling. Cache the response on success so the next visit hits
    //      tier 1 instantly.
    //   3. Network failed AND no exact match → fall back to ANY cached
    //      copy via ignoreSearch:true. Covers offline first-visit (the
    //      install pre-cache stored ./data/materials.json with no query)
    //      and transient outages. User sees slightly-stale data instead
    //      of a hard failure.
    //
    // Storage stays versioned (cache.put uses the request URL with its
    // ?v=… query intact), so each DATA_VERSION lives under its own key;
    // the activate handler purges all entries when CACHE_VERSION rotates.
    event.respondWith(
      caches.open(CACHE_VERSION).then(cache =>
        cache.match(req).then(exactCached => {
          const networked = fetch(req).then(res => {
            if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
            return res;
          }).catch(() => null);

          if (exactCached) {
            // Tier 1: SWR — return cached immediately, refresh silently.
            networked.catch(() => {}); // detach: don't unhandled-reject
            return exactCached;
          }
          // Tier 2: network-first.
          return networked.then(res => {
            if (res) return res;
            // Tier 3: ignoreSearch fallback for offline first-visit.
            return cache.match(req, { ignoreSearch: true }).then(any => {
              if (any) return any;
              throw new Error('materials.json: network and cache both unavailable');
            });
          });
        })
      )
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
