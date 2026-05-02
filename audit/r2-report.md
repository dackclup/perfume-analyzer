# Round 2 Audit — Coherence + Performance + A11y + Domain + Security + Code Quality

**Branch**: `claude/audit-r2-2026-05-02`  
**Base**: main @ `e324ecf` (post-Round-1)  
**Date**: 2026-05-02  
**Mode**: Read-only audit followed by tiered implementation; no push until confirmed.

## Finding format

Each finding follows:

```
### [Phase][Sequence] — Short title
**Tier**: -1 | 0 | 1 | 2 | 3 | 4 | 5
**Auto-fixable**: yes | no | partial
**Severity**: critical | high | medium | low | info
**Locus**: file:line(s)
**Evidence**: verbatim quote from code or output
**Why it matters**: ...
**Fix(point)**: minimal local change
**Fix(systemic)**: root-cause-level change preventing recurrence
```

Tier semantics:
- **-1** Round-1 regression (highest priority — fix first)
- **0** Quick win (data fix, doc update)
- **1** Single-source-of-truth addition
- **2** Code structure / lib extraction
- **3** Automation
- **4** Domain-expert review needed (DO NOT fix; flag only)
- **5** Long-term refactor


---

## Phase A — Round 1 Regression Check

Verifies Round-1 deliverables (v294 → v296) actually function as documented in CHANGELOG.md.

### [A1] — CHANGELOG breaking changes verified working

**Tier**: info
**Auto-fixable**: n/a
**Severity**: low
**Locus**: spot-checked all "Breaking" bullets against current state.
**Evidence**:
- `lint:data` shows `material.secondaryFamilies → taxonomy 0 / 187` (the 16 reclassified rows pass).
- `data/materials.json` `meta.version` = `2026-04-29-v296`, `row_count` = 624.
- 135/135 tests pass.
- `lib/dom-utils.mjs`, `lib/material-shape.mjs`, `lib/storage.mjs` all present + delegated from inline scripts.

**Verdict**: CHANGELOG is accurate. No reality drift.

### [A2] — `format:check` fails on Round-1 outputs ⚠ regression

**Tier**: -1
**Auto-fixable**: yes (single `prettier --write`)
**Severity**: medium (CI gate)
**Locus**: `lib/dom-utils.mjs`, `lib/material-shape.mjs`, `lib/storage.mjs`, `tests/dom-utils.test.mjs`, `CHANGELOG.md`, `CONTRIBUTING.md`.
**Evidence**:
```
$ npx prettier --check lib/dom-utils.mjs lib/material-shape.mjs lib/storage.mjs tests/dom-utils.test.mjs CHANGELOG.md CONTRIBUTING.md
[warn] lib/dom-utils.mjs
[warn] lib/material-shape.mjs
[warn] lib/storage.mjs
[warn] tests/dom-utils.test.mjs
[warn] CHANGELOG.md
[warn] CONTRIBUTING.md
[warn] Code style issues found in 6 files. Run Prettier with --write to fix.
```

**Why it matters**: CI workflow `.github/workflows/ci.yml` (added Round 1) runs `npm run format:check`. Either CI was failing silently, or the WebFetched success report was inaccurate. Either way, the next push that pre-commit-checks files runs format:check and fails.

**Fix(point)**: `npx prettier --write` on the 6 files (and any pre-existing dirty ones).
**Fix(systemic)**: Add `format:check` to `scripts/pre-commit.sh` so future drift is caught before push, not after CI fails.

### [A3] — `.prettierignore` still references deleted `perfumery_data.backup.js`

**Tier**: 0
**Auto-fixable**: yes
**Severity**: low (cosmetic)
**Locus**: `.prettierignore:4`
**Evidence**:
```
$ ls perfumery_data.backup.js
ls: cannot access 'perfumery_data.backup.js': No such file or directory

$ git log --all --oneline -- perfumery_data.backup.js
73a20c6 audit-fixes Tier 0 — 8 quick wins      ← deletion
b03fcb8 Clear perfumery_data.js for ground-up rebuild (backup to .backup.js)

$ grep -n perfumery_data.backup .prettierignore
4:perfumery_data.backup.js
```

**Why it matters**: stale ignore rule with no matching file. Misleading reference; repo housekeeping.
**Fix(point)**: remove line 4 from `.prettierignore`.
**Fix(systemic)**: covered by Tier-3 dead-reference scanner (Phase F candidate).

### [A4] — `npm run release` real-world bump+revert works

**Tier**: info
**Auto-fixable**: n/a
**Severity**: low
**Evidence**: snapshotted `version.json` + 5 edited files, ran `npm run release` (v296 → v297, hash `909924ba` → `3347f7d2`); diff showed exactly 5 cache-bust strings updated in `index.html`, 7 in `formulation.html`, plus `version.json`, `sw.js`, `data/materials.json`. Restored snapshots; `npm run release -- --check` returned green at v296.

**Verdict**: scripts/release.mjs round-trips cleanly with no orphan writes.

### [A5] — `lib/storage.mjs` graceful degradation verified

**Tier**: info
**Auto-fixable**: n/a
**Severity**: low
**Evidence**: imported `lib/storage.mjs` into Node with a polyfilled `localStorage`, ran 6 cases (corrupt JSON, validator rejection, missing key, round-trip, missing-key remove, throwing localStorage from private-mode simulation). All returned the documented default.

**Verdict**: localStorage migration is robust. Live-site behaviour cannot be confirmed from CLI but the module-level invariants hold.

### [A6] — Pre-commit hook blocks broken data ✓

**Tier**: info
**Auto-fixable**: n/a
**Severity**: low
**Evidence**: injected an invalid row `{cas:'999-99-9', name:'EVIL_TEST', classification:{primaryFamilies:['__not_a_real_family__']}}` into `data/materials.json`, attempted `git commit`. The hook ran `npm test`, the data-integrity spec failed (`Tests 1 failed | 134 passed`), and the commit did NOT land (working tree was restored). Working as designed.

### [A7] — `npm audit` reports 5 moderate vulnerabilities (devDeps only)

**Tier**: 3
**Auto-fixable**: partial (vitest 2.x → 3.x is breaking)
**Severity**: low (dev-only, no production deps)
**Evidence**:
```
$ npm audit
… 5 moderate severity vulnerabilities (vitest / vite / vite-node) …
To address all issues (including breaking changes), run:
  npm audit fix --force
```

**Why it matters**: this project ships static HTML. devDeps don't reach end users. Still, vitest is the test runner — a vulnerable test runner is a low-risk supply-chain problem.
**Fix(point)**: defer to a vitest 3 upgrade as a separate dedicated PR.
**Fix(systemic)**: Dependabot config + monthly bump cadence (see Phase E systemic candidates).

### [A8] — `node_modules` version mismatch warning at install

**Tier**: 0
**Auto-fixable**: partial
**Severity**: low
**Evidence**: `npm install` ends with "Run `npm audit fix --force`" — see A7. No actual install error.

### Systemic fix candidates (A)

- **Tier -1**: run `npx prettier --write` on the 6 files; commit as the very first Tier-(-1) commit.
- **Tier 0**: drop dead line from `.prettierignore`.
- **Tier 0**: add `npm run format:check` to `scripts/pre-commit.sh` so future drift is caught locally.
- **Tier 3**: Dependabot config (see Phase E).

---

## Phase E — Security

Read-only audit of the static-site attack surface: DOM-injection (XSS),
third-party SRI, transport headers via `<meta>`, secret leakage, npm
audit, and service-worker scope abuse. No source files were modified.

### Surface stats

| File | `innerHTML =` sites | `insertAdjacentHTML` | `esc(` calls | `escHtml(` calls |
|------|--------------------:|---------------------:|-------------:|-----------------:|
| `index.html` | 26 | 1 (L7355) | 74 | 0 |
| `formulation.html` | 50 | 0 | 0 | 115 |

The two pages use different escape helpers (legacy `esc()` in
`index.html`; `escHtml()` from `lib/dom-utils.mjs` in `formulation.html`).
Both produce identical output for the four core entities (`& < > "`),
but only `escHtml()` also escapes `'` (see `lib/dom-utils.mjs`).

Spot-check of ~10 representative `innerHTML =` sites in each file
confirms that **every value derived from a network response or
user-typed string flows through `esc()` / `escHtml()` before
interpolation** — `renderPubchemSections` (index.html L6016, 6022,
6024, 6027, 6036), `renderPills` (L4770), the compare-modal renderer
(L6346, L7130), the search-modal results (formulation.html L2411-2414),
and the brief-results table (L5488-5491) all escape correctly. The
remaining sites interpolate **either** static i18n dictionary values
(`t.searchHintText`, `t.noMaterialsHint`, the LANG_INDEX entries) **or**
developer-controlled constants (`TYPE_LABELS`, `FUNCTION_LABELS`,
`REGULATORY_LABELS`); no third party can mutate either source. Two
edge cases are flagged below.

### [E1] — `handleStructureImgError` rebuilds parent HTML with raw `img.src`

**Tier**: 2
**Auto-fixable**: yes
**Severity**: low
**Locus**: `index.html:4818`
**Evidence**:
```js
parent.innerHTML = '<div ...><a href="' + (img.src.split('?')[0]
  .replace('/rest/pug/compound/cid/','/compound/').replace('/PNG','')) + '" target="_blank" ...
```
**Why it matters**: `img.src` is built from a PubChem CID (numeric)
elsewhere in the codebase, so the realistic XSS likelihood is zero. But
the value is *interpolated unescaped into both an `href` attribute and
the surrounding HTML*, which violates the "always escape at the boundary"
invariant the rest of the file follows. Any future change that lets a
non-numeric CID flow into `img.src` (e.g. a synonym-based URL pattern)
would silently introduce an XSS sink.
**Fix(point)**: route the URL through `esc()` (or build the `<a>` via
`createElement` + `setAttribute`).
**Fix(systemic)**: ESLint rule banning string-concatenation into
`innerHTML` — see "Systemic fix candidates" below.

### [E2] — Toast `innerHTML` only escapes `<`, leaves `& > " '` raw

**Tier**: 2
**Auto-fixable**: yes
**Severity**: low
**Locus**: `index.html:8399`, `formulation.html:1540`
**Evidence**:
```js
'<div>' + String(message).replace(/</g,'&lt;') + '</div>'
```
**Why it matters**: callers pass developer-controlled strings into
`showToast({message})` (search errors, brief-budget warnings, etc.),
so this is a *latent* vulnerability rather than an active one. The
half-escape, however, fails the "all five entities" baseline that the
shared `escHtml()` helper enforces — a future caller forwarding
PubChem text into a toast would render `&` literally (mojibake) and
`'`/`"` raw (attribute-context risk if the string is later re-rendered).
**Fix(point)**: replace `String(message).replace(/</g,'&lt;')` with
`escHtml(message)` (already imported on the formulation side; pull it
into `index.html` via `window.appUtils.escHtml`).
**Fix(systemic)**: same ESLint rule as [E1]; also delete the legacy
local `esc()` in `index.html` once `lib/dom-utils.mjs` is wired in.

### [E3] — No SRI on third-party `<script>` / `<link>` tags

**Tier**: 0
**Auto-fixable**: yes
**Severity**: high
**Locus**: `formulation.html:18` (chart.js), `index.html:34` and
`formulation.html:17` (Google Fonts CSS)
**Evidence**:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans..." rel="stylesheet">
```
`grep -nE 'integrity=' index.html formulation.html` returns zero matches.
**Why it matters**: `chart.js@4` is a *floating* major-version tag —
jsDelivr serves whatever the latest 4.x release is, and a CDN
compromise (or a malicious npm publish at the upstream) would inject
arbitrary JS into the formulation page with full same-origin access to
the user's saved formulas in localStorage. SRI pins a specific build
hash; without it, the user's only trust anchor is jsDelivr's TLS cert.
Google Fonts CSS does not execute JS, but the CSS itself can exfiltrate
attribute values via `url(...)` and is delivered over a different,
header-stripped origin — also worth pinning.
**Fix(point)**:
1. Pin chart.js to an exact version (`chart.js@4.4.6` as of the audit
   date) and add `integrity="sha384-..." crossorigin="anonymous"`.
2. Either pin the Google Fonts CSS hash too, or — preferably — self-host
   the two woff2 files (the CSS only references two weights of IBM Plex)
   to remove the third-party origin entirely.
**Fix(systemic)**: a lint rule that fails on `<script src="https://"`
without `integrity=` (see candidates).

### [E4] — No CSP / referrer / X-Content-Type-Options meta tags

**Tier**: 1
**Auto-fixable**: yes
**Severity**: medium
**Locus**: `index.html:11-33`, `formulation.html:11-15` (head block)
**Evidence**:
```
$ grep -nE '<meta[^>]*http-equiv|...Content-Security-Policy|...referrer|...X-Content-Type'
index.html:21:<meta http-equiv="Cache-Control" ...
index.html:22:<meta http-equiv="Pragma" ...
index.html:23:<meta http-equiv="Expires" ...
formulation.html:12-14: (same three Cache-Control headers)
```
Only cache-busters are present; no `Content-Security-Policy`,
`Referrer-Policy`, or `X-Content-Type-Options`.
**Why it matters**: GitHub Pages cannot inject HTTP response headers,
so `<meta http-equiv>` is the only available mitigation. Without CSP a
bug like [E1]/[E2] becomes a full XSS instead of a contained one;
without `Referrer-Policy` every PubChem fetch leaks the full Pages URL
(including search query, since the path uses fragments) to NCBI; without
`X-Content-Type-Options: nosniff` a misconfigured data file can be
re-interpreted as HTML by Edge/Firefox in legacy modes.
**Fix(point)**: add to both `<head>` blocks:
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
  style-src  'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src   'self' https://fonts.gstatic.com;
  img-src    'self' data: https://pubchem.ncbi.nlm.nih.gov;
  connect-src 'self' https://pubchem.ncbi.nlm.nih.gov;
  frame-ancestors 'none';
  base-uri 'self';
">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta http-equiv="X-Content-Type-Options" content="nosniff">
```
`'unsafe-inline'` is required for both `script-src` and `style-src`
because both pages embed all JS and CSS inline (intentional for
single-file deployability). Removing it is a Tier-5 refactor.
**Fix(systemic)**: bake the CSP into `scripts/release.mjs` so a copy-paste
to a forked repo can't drop it; treat the meta tag as part of the
"shell asset hash" already tracked by `sw.js`.

### [E5] — Secret scan: clean (zero hits)

**Tier**: —
**Auto-fixable**: —
**Severity**: info
**Locus**: repo-wide
**Evidence**: `grep -rniE 'api[_-]?key|aws[_-]access|client[_-]secret|bearer|password'`
returns no matches. The broader `secret|token` pattern hits ~3000 false
positives that are all legitimate domain vocabulary (family tokens,
odor tokens, CAS-number tokens, "civet secretion" / "beaver gland
secretion" in odor descriptions, etc.); none reference cryptographic
material.
**Why it matters**: confirms the static-site model — no API keys are
shipped to the browser, no `.env` is leaking. PubChem REST is
unauthenticated.
**Fix(point)**: none required.
**Fix(systemic)**: add `gitleaks` to CI (see candidates) so a future
commit that introduces an analytics SDK with a write-key gets flagged.

### [E6] — `npm audit`: 5 moderate, 0 high, 0 critical — all dev-only

**Tier**: 3
**Auto-fixable**: yes (semver-major bump)
**Severity**: low
**Locus**: `node_modules/{vitest,vite,vite-node,@vitest/mocker,esbuild}`
**Evidence**:
```
metadata.vulnerabilities: { info:0, low:0, moderate:5, high:0, critical:0 }
metadata.dependencies:    { prod:1, dev:185 }
```
All five advisories chain through `vitest@2.1.4 → vite → esbuild`. The
two upstream CVEs are GHSA-67mh-4wv8-2f99 (esbuild dev-server CORS) and
GHSA-4w7w-66w2-5vf9 (vite dev-server path traversal in `.map` handling).
Both require the **dev server** to be reachable from a hostile network.
**Why it matters**: the runtime bundle ships nothing from these
packages — vitest is `devDependencies` only and is exercised by `npm
test` locally / in CI. Production users never hit this code. Per the
task brief: "Critical/high in production deps would be Tier 0; in dev
deps are Tier 3 — worth fixing but not blocking."
**Fix(point)**: `npm install --save-dev vitest@^4.1.5` (semver-major;
verify the test suite still passes — Vitest 4 dropped a few legacy APIs).
**Fix(systemic)**: schedule `npm audit` as a non-blocking CI warning so
new advisories surface without breaking the green-tick workflow; pair
with Dependabot for automated PRs.

### [E7] — Service worker: cross-origin bypass confirmed correct

**Tier**: —
**Auto-fixable**: —
**Severity**: info
**Locus**: `sw.js:79`
**Evidence**:
```js
// PubChem and other cross-origin chemistry endpoints — never cache.
if (url.origin !== self.location.origin) return;
```
The `fetch` handler aborts before reaching any of the three caching
tiers (network-first shell, SWR materials JSON, cache-first local
scripts) when the request crosses an origin boundary. Returning
without calling `event.respondWith()` yields control to the browser's
default network stack, so PubChem responses are never observable to,
let alone cacheable by, the service worker. This rules out the
"hostile cross-origin response gets cached and re-served as same-origin
on the next visit" pattern.
**Why it matters**: closes the SW-as-cache-poisoning attack vector
described in the brief.
**Fix(point)**: none required.
**Fix(systemic)**: keep this guard as a regression-test target —
adding it to the `tests/` Vitest run (mock `self.addEventListener` and
assert non-respondWith for cross-origin URLs) would prevent a future
"oh let's also cache PubChem PNGs" PR from removing it.

### Systemic fix candidates (E)

1. **Meta-tag CSP + Referrer-Policy + X-Content-Type-Options**
   ([E4]). Bake the three `<meta>` tags into both pages and reference
   them from `scripts/release.mjs` so any future minimal-shell rewrite
   re-emits them. CSP value as drafted above; `'unsafe-inline'` stays
   until inline JS is extracted (Tier-5).

2. **`npm audit` as a non-blocking CI warning** ([E6]). Add a step to
   the existing GitHub Actions workflow:
   ```yaml
   - name: npm audit (warn-only)
     run: npm audit --audit-level=high --omit=dev || true
     continue-on-error: true
   ```
   Pair with `--omit=dev` for the **blocking** check (production-only)
   and a separate dev-deps step that warns. Today both buckets are
   clean of high/critical, so this codifies the policy without changing
   green/red state.

3. **ESLint rule banning unescaped `innerHTML`** ([E1] [E2]). The
   `eslint-plugin-no-unsanitized` package ships
   `no-unsanitized/property` which fires on
   `innerHTML = <expression>` unless the RHS is a literal or a call to
   an allow-listed sanitiser (`escHtml`, `esc`). Add to
   `eslint.config.mjs`:
   ```js
   import noUnsanitized from 'eslint-plugin-no-unsanitized';
   // ...
   plugins: { 'no-unsanitized': noUnsanitized },
   rules: {
     'no-unsanitized/property': ['error', {
       escape: { taggedTemplates: ['escHtml','esc'] }
     }]
   }
   ```
   First run will flag the existing 76 sites; ratchet via a baseline
   file analogous to `audit/lint-data-baseline.json`, then drive the
   count to zero over time.

4. **Dependabot config for weekly dev-dep PRs** ([E3] [E6]). Add
   `.github/dependabot.yml`:
   ```yaml
   version: 2
   updates:
     - package-ecosystem: npm
       directory: "/"
       schedule: { interval: weekly }
       open-pull-requests-limit: 5
       groups:
         vitest-stack: { patterns: ["vitest","vite","@vitest/*"] }
   ```
   Pair with **a separate "manual" job** for the third-party CDN URLs
   in [E3] — Dependabot doesn't track jsDelivr URLs in HTML; a
   `scripts/check-cdn-pins.mjs` that greps for unpinned `@\d` and
   missing `integrity=` would close the loop.

5. **SRI auto-generation script** ([E3]). One-shot helper
   `scripts/sri.mjs <url>` that fetches the resource, prints
   `integrity="sha384-..."`, and refuses to run against a floating
   tag. Wire it into `release.mjs` so a CDN-version bump regenerates
   the hash atomically with the cache-buster.

---

## Phase B — Performance & PWA

Read-only audit of bundle weight, service-worker quality, runtime
performance characteristics, and mobile / PWA reality. No source
files were modified.

### B0 — Bundle weight table

Raw bytes from `wc -c`; gzipped from `gzip -c <file> | wc -c`.

| File | Raw (B) | Gzipped (B) |
|---|---:|---:|
| `index.html` | 447,942 | 137,708 |
| `formulation.html` | 380,006 | 107,393 |
| `data/materials.json` | 1,177,843 | 216,174 |
| `formulation_engine.js` | 169,241 | 51,261 |
| `formulation_data.js` | 99,963 | 26,149 |
| `taxonomy.js` | 2,349 | 1,062 |
| `sw.js` | 6,475 | 2,544 |
| `manifest.webmanifest` | 982 | 531 |
| `lib/dom-utils.mjs` | 4,790 | 1,921 |
| `lib/material-shape.mjs` | 4,159 | 1,637 |
| `lib/storage.mjs` | 3,790 | 1,356 |
| `lib/utils.mjs` | 4,627 | 2,109 |
| `perfumery_data.js` | — | — (file removed in Round 1; no shim, no 404 references in HTML) |

First-load shell budgets (worst-case cold cache, gzip on the wire):

| Page | Shell components (gzipped) | Total gzipped |
|---|---|---:|
| `index.html` (Analyzer) | index.html 138 KB + taxonomy 1 KB + dom-utils 1.9 KB + storage 1.4 KB + materials.json 216 KB | **~358 KB** |
| `formulation.html` (Formulator) | formulation.html 108 KB + taxonomy 1 KB + formulation_data 26 KB + formulation_engine 51 KB + dom-utils 1.9 KB + material-shape 1.6 KB + storage 1.4 KB + materials.json 216 KB + chart.js@4 (CDN, ~70 KB gz) | **~477 KB** |

Analyzer first paint sits at ~358 KB gz, Formulator at ~477 KB gz — both under the 500 KB threshold but the Formulator is within 5% of it. The single biggest line item on every page is `data/materials.json` at 216 KB gz (~1.18 MB raw, ~624 rows). A 1.2 MB JSON parse on a mobile main thread is the dominant cost. `perfumery_data.js` was correctly removed in Round 1; both HTML pages now load `data/materials.json` via the async boot pipeline. No dead `<script src="perfumery_data.js">` refs remain.

### B0.1 — Service Worker quality summary

**Routing strategy** (matches `CONTRIBUTING.md` "Cache-busting" section):

| URL class | Route | Strategy | Notes |
|---|---|---|---|
| `*.html` / `*.webmanifest` / `/` | `isShell` | network-first → cache fallback | Correct. Falls back to `./index.html` for offline first-visit. |
| `/data/materials.json` | `isMaterialsJSON` | three-tier: SWR on exact-version match → network-first on no match → ignoreSearch fallback offline | Correct and well-commented. |
| Local `*.js` (NOT `*.mjs`) | `isLocalScript` | cache-first | **Bug — see [B2.2]: regex `\.js(\?|$)` does not match `.mjs`.** |
| Cross-origin (PubChem, jsDelivr, Google Fonts) | early `return` at line 79 | network-only | Correct (also confirmed safe in [E7]). |

**Update flow**: `skipWaiting()` is in the install handler and `clients.claim()` in activate — so a new SW takes over without a tab refresh. There is **no client-side `controllerchange` listener and no postMessage plumbing**, so the user gets no toast / banner about an updated shell. See [B2.4].

**Error handling**: zero `error` / `messageerror` / `unhandledrejection` listeners on `self`; three `cache.put().catch(() => {})` calls swallow failures silently. See [B2.5].

**Precache completeness**: `SHELL_ASSETS` lists 5 entries — root `/`, two HTMLs, manifest, materials.json. **It does NOT list** `taxonomy.js`, `formulation_data.js`, `formulation_engine.js`, or any of the four `lib/*.mjs` files. See [B2.1].

**Registration parity**: `index.html` registers the SW at line 8417; `formulation.html` does NOT register it anywhere. See [B2.3].

**`navigator.onLine` usage**: zero hits across the entire repo. See [B2.6].

### [B1] — `data/materials.json` is a 1.18 MB synchronous load on every cold visit

**Tier**: 2
**Auto-fixable**: no
**Severity**: medium
**Locus**: `index.html:1291`, `formulation.html:1188`, `data/materials.json` (entire file)
**Evidence**:
```
const res = await fetch('data/materials.json?v=' + encodeURIComponent(DATA_VERSION), { cache: 'default' });
if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
const data = await res.json();
```
File size: `1177843` bytes raw → `216174` bytes gzipped (`wc -c` / `gzip -c | wc -c`).
**Why it matters**: 624 materials × ~1.9 KB/row gets fully fetched + parsed before the inert `<script id="app-init">` fires. On a cold mobile cache (3G/4G fallback) this is the single largest blocking step of first paint, dwarfing all HTML/JS combined. The parse alone (`res.json()`) on a 1.2 MB string blocks the main thread for hundreds of milliseconds on a low-end Android. The file is also a single monolithic JSON, so neither HTTP/2 multiplexing nor partial parse helps. 216 KB gz is the dominant cost on every cold load.
**Fix(point)**: Verify the upstream host emits `Cache-Control: public, max-age=31536000, immutable` on the `?v=…` URL so a returning user hits the disk cache (in addition to the SW's existing SWR strategy).
**Fix(systemic)**: Split `materials.json` into a small "index" payload (CAS + canonical name + primary families + safety summary, ≤ 50 KB gz) loaded synchronously, plus per-material detail blobs fetched on demand when the user opens a card or runs an axis filter that needs the heavy fields. Tier 2 work — touches the `DB` shape and every reader, but pays for itself on every cold load.

### [B2.1] — Service Worker does not precache the bundled JS modules or `lib/*.mjs`

**Tier**: -1
**Auto-fixable**: yes
**Severity**: high
**Locus**: `sw.js:29-35`
**Evidence**:
```
const SHELL_ASSETS = [
  './',
  './index.html',
  './formulation.html',
  './manifest.webmanifest',
  './data/materials.json'
];
```
**Why it matters**: A first-time user who lands on `index.html`, returns offline, and is then routed to `formulation.html` (or vice versa) gets no `formulation_data.js`, `formulation_engine.js`, `taxonomy.js`, or `lib/*.mjs` from the precache. They will only be cached if/when the runtime fetch handler grabs them via `isLocalScript`. CONTRIBUTING.md ("Cache-busting") promises "cache-first for the bundled JS" — that holds only **after** the user has visited each page once online. The install pre-cache documented in the SW header ("Pre-cache the app shell on install so the page loads offline after a single online visit") therefore overstates what is actually shipped.
**Fix(point)**: Add `./taxonomy.js?v=…`, `./formulation_data.js?v=…`, `./formulation_engine.js?v=…`, `./lib/dom-utils.mjs?v=…`, `./lib/material-shape.mjs?v=…`, `./lib/storage.mjs?v=…`, `./lib/utils.mjs?v=…` to `SHELL_ASSETS` (with the current `DATA_VERSION` query string so install-time cache key matches the request URL).
**Fix(systemic)**: Have `scripts/release.mjs` derive `SHELL_ASSETS` from a single declared list (e.g. a JS export under `lib/`) shared with both HTML pages' `<script>` tag generation, so the precache list and the actual `<script src>` set can never drift again. Tier 3.

### [B2.2] — Service Worker `isLocalScript()` regex misses ES module (`.mjs`) files

**Tier**: -1
**Auto-fixable**: yes
**Severity**: high
**Locus**: `sw.js:60-64`
**Evidence**:
```
function isLocalScript(url) {
  // Bundled JS data files served from the same origin. PubChem and
  // other third-party scripts fall through to network-only.
  return url.origin === self.location.origin && /\.js(\?|$)/i.test(url.pathname + url.search);
}
```
**Why it matters**: Round 1 introduced four `.mjs` modules under `lib/` and wired them into both HTML pages as `type="module"` script tags. The pattern `\.js(\?|$)` matches `foo.js?v=…` but does NOT match `foo.mjs?v=…` — verified at the CLI: `node -e "console.log(/\.js(\?|$)/i.test('lib/foo.mjs?v=1'))"` → `false`. Combined with [B2.1] (the `.mjs` files aren't in `SHELL_ASSETS` either), every `lib/*.mjs` request falls through every routing branch in the `fetch` handler, and the SW does NOT call `event.respondWith(...)`. That defaults to plain network fetch — fine online, but **the modules are never cached**, so the inline `window.appUtils` setup in both HTML pages will throw `escHtml is not a function` on a cold offline boot. This is a Round-1 regression: the new ES-module split silently broke the offline guarantee.
**Fix(point)**: Change the regex to `/\.m?js(\?|$)/i` AND add the four `lib/*.mjs` files to `SHELL_ASSETS` ([B2.1]). Both are required — the regex fix alone leaves the first offline visit broken because the modules haven't been visited online yet.
**Fix(systemic)**: Add a tiny `tests/sw-routes.test.mjs` that asserts every URL in the page's `<script src>` list is matched by exactly one of `isShell` / `isLocalScript` / `isMaterialsJSON`. Wire it into the same pre-commit gate that runs `lint-data`. Tier 3.

### [B2.3] — `formulation.html` never registers the service worker

**Tier**: -1
**Auto-fixable**: yes
**Severity**: high
**Locus**: `index.html:8417-8425` vs `formulation.html` (no equivalent block)
**Evidence**: `index.html` ends with
```
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      // Soft-fail: SW registration losing to a network blip or a
      // restrictive CSP is fine — site still works without it.
      if (typeof _devWarn === 'function') _devWarn('SW register failed:', err);
    });
  });
}
```
`grep -n "serviceWorker.register" formulation.html` returns no results.
**Why it matters**: A user who deep-links straight into `formulation.html` (e.g. from a browser bookmark, share link, or app-shortcut) never installs the SW. Subsequent offline visits to either page from that origin will fail because no SW is controlling the client. The bug is silent — the page works perfectly online, masking the missing offline guarantee. The SW *can* still be registered by visiting `index.html` once first, so users who arrive via the analyzer happen to be fine; bookmark-direct users to the formulator are not.
**Fix(point)**: Append the same registration block (the 9 lines at `index.html:8417-8425`) to the bottom of `formulation.html`'s inert `<script id="app-init">`.
**Fix(systemic)**: Hoist the SW-register block into a single `lib/register-sw.mjs` imported by both pages. Tier 2.

### [B2.4] — SW has no `controllerchange`/postMessage update flow

**Tier**: 2
**Auto-fixable**: partial
**Severity**: medium
**Locus**: `sw.js:37-55`
**Evidence**:
```
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
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
```
Page-side: `index.html:8417` registers the SW but adds no `navigator.serviceWorker.addEventListener('controllerchange', …)`.
**Why it matters**: `skipWaiting` + `clients.claim` are present (good — covers the "new SW takes over without a tab close" case). But there is no client-side listener for `controllerchange`, no `postMessage` plumbing, and no UI notice. With network-first HTML and `skipWaiting`, a returning user mid-edit can have a fresh shell silently activate and the tab's in-memory references (`PERFUMERY_DATA`, `results[]`, formula state) are now running on top of a partially-stale module map. In practice this is rare because the page reloads on next navigation, but for a long-lived formulator session it's a footgun.
**Fix(point)**: Add a `navigator.serviceWorker.addEventListener('controllerchange', …)` that surfaces a "New version available — reload?" toast (using the existing `showToast` helper).
**Fix(systemic)**: Adopt the standard "waiting → user-prompted skipWaiting" pattern: SW does NOT call `skipWaiting` automatically; instead it `postMessage`s `'SW_READY'`, the page shows a toast, and the user clicks "Reload" which sends `{ type: 'SKIP_WAITING' }` back. Tier 2.

### [B2.5] — SW lacks `error` / `messageerror` / `unhandledrejection` listeners

**Tier**: 2
**Auto-fixable**: yes
**Severity**: low
**Locus**: `sw.js` (entire file)
**Evidence**: No `self.addEventListener('error', …)`, no `self.addEventListener('unhandledrejection', …)`. Three `.catch(() => {})` swallow errors silently:
```
caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
```
**Why it matters**: A failed `cache.put` (quota exceeded, opaque-response 0-byte limit, transient indexedDB lock) is silently swallowed in three places. There's no telemetry signal back to the page, no console output. A user whose Cache Storage hits its quota will see a working page that simply never updates — the kind of bug that takes weeks to reproduce.
**Fix(point)**: Replace the bare `.catch(() => {})` with `.catch(e => console.warn('[sw] cache.put failed', req.url, e))`.
**Fix(systemic)**: Add a top-level `self.addEventListener('error', …)` and `self.addEventListener('unhandledrejection', …)` that `postMessage`s the page. Tier 3.

### [B2.6] — `navigator.onLine` is unused anywhere; offline UX has no signal

**Tier**: 2
**Auto-fixable**: no
**Severity**: low
**Locus**: `index.html`, `formulation.html`, `sw.js` (verified by `grep -n "navigator.onLine"` — empty across the repo)
**Evidence**: zero hits across the entire repo.
**Why it matters**: When the user is offline, a PubChem fetch attempt waits the full 6 s `TIMEOUTS.fetch` ceiling before giving up, then surfaces a generic "search error" toast. Reading `navigator.onLine` (or listening to `online`/`offline` events) would let the search orchestrator short-circuit cross-origin fetches with a "offline — local DB only" notice, saving ~6 s and giving the user accurate context.
**Fix(point)**: Wrap each PubChem step in `if (navigator.onLine === false) { /* skip */ }` and surface an offline pill in the header.
**Fix(systemic)**: Centralise the "is the network usable" check in `lib/net.mjs` with an `online()` predicate + `online`/`offline` listeners that toggle a `data-net="online|offline"` attribute on `<html>`, so CSS can also style accordingly. Tier 2.

### [B3.1] — Mobile-paste handler races the input-event handler, double-rendering pills

**Tier**: 0
**Auto-fixable**: yes
**Severity**: low
**Locus**: `index.html:4589-4615`
**Evidence**:
```
input.addEventListener("input", () => {
  btn.disabled = !input.value.trim();
  clearSearchError();
  clearTimeout(_pillTimer);
  _pillTimer = setTimeout(() => showPills(input.value), DEBOUNCE.pillSuggestions);
  _writeUrlState();
});
…
input.addEventListener('paste', (e) => {
  setTimeout(() => {
    const cleaned = input.value.replace(/[ ​]/g, ' ').trim();
    if (cleaned !== input.value) {
      input.value = cleaned;
      btn.disabled = !cleaned;
      clearTimeout(_pillTimer);
      _pillTimer = setTimeout(() => showPills(cleaned), DEBOUNCE.pillSuggestions);
      _writeUrlState();
    }
  }, 0);
});
```
**Why it matters**: Two debounce timers compete on paste — the `'input'` handler at line 4589 fires first with the still-untrimmed value, schedules its own `showPills`, then this paste branch *also* schedules `showPills(cleaned)` 150 ms later. Net effect: two queued render passes, the first one with stale text. Cheap, but it's a real double-render on mobile paste, and `_writeUrlState()` runs twice too.
**Fix(point)**: In the `'input'` handler, check `if (e.isTrusted && e.inputType === 'insertFromPaste') return;` so the paste branch owns the post-paste pill render.
**Fix(systemic)**: Combine the input + paste handlers via a single `coalescePillRender(value)` helper that owns the timer; remove the duplicated `_pillTimer` orchestration. Tier 2.

### [B3.2] — `_updateFilterVisibility` walks the entire `FILTER_CACHE` (~624 entries) per chip toggle

**Tier**: 2
**Auto-fixable**: no
**Severity**: low
**Locus**: `index.html:3879-3998`
**Evidence**:
```
for (const fc of FILTER_CACHE.values()) {
  const failures = _axesFailedBy(fc, fc.cas);
  if (failures.size > 1) continue;
  …
}
```
Called via the 80 ms debounce at line 1481 (`DEBOUNCE.filterVisibility: 80`).
**Why it matters**: 624 iterations × 8 axis predicates per toggle. Debounced, so a burst of 5 fast taps coalesces into one — fine. The cost itself is bounded (single-digit ms on desktop, low-tens on mobile), but it scales linearly with DB size and with axes. Once the DB doubles or a 9th axis is added, the 80 ms debounce is the only safety margin. There is no inverted index for "axis failure count" — the function recomputes from scratch every time.
**Fix(point)**: Cache `_axesFailedBy(fc, cas)` per `(cas, axisStateHash)` and short-circuit when `axisStateHash` is unchanged.
**Fix(systemic)**: Move to an inverted-index "axis-value → Set<CAS>" with set intersection (the existing `FILTER_INDEX` at line 3397 is half this — extend it to drive the visibility scan as well). Tier 2.

### [B3.3] — `Object.values(DB)` / `Object.entries(DB)` walked 13× during `index.html` init

**Tier**: 2
**Auto-fixable**: no
**Severity**: low
**Locus**: `index.html:1544, 1558, 1601, 1737, 1765, 1824, 2112, 2128, 3386, 3456, 4701, 5174, 6717`
**Evidence**: `grep -n "for.*of.*materials\|materials.forEach\|materials.filter\|materials.map\|Object.values(DB)\|Object.entries(DB)" index.html` — 13 hits, mostly during data-layer build (synonym index, name index, prefix index, blend reverse index, taxonomy migration, FILTER_CACHE build).
**Why it matters**: Each pass is a full ~624-row sweep. Init currently does ≥ 13 of them sequentially — combined cost is meaningful on a low-end Android (~30-80 ms) and they all block the inert `<script id="app-init">` from fully booting before first render. Most of these passes can be fused (build prefix-IX, syn-IX, name→cas, blend reverse, FILTER_CACHE in a single forEach with a multi-output reducer).
**Fix(point)**: None — each pass is locally minimal.
**Fix(systemic)**: One `buildIndexes(DB)` function that walks once, populates every index in lockstep. Move to `lib/db-indexes.mjs` so the same walker can be reused on Formulator init. Tier 2.

### [B3.4] — `_redrawWheel()` clobbers the wheel `<svg>` via `innerHTML` for every modal open

**Tier**: 2
**Auto-fixable**: no
**Severity**: low
**Locus**: `index.html:6691-6694`, `index.html:6493-6630` (`_buildWheelSvg`)
**Evidence**:
```
function _redrawWheel() {
  const host = document.getElementById('wheelHost');
  if (host) host.innerHTML = _buildWheelSvg();
}
```
**Why it matters**: `_buildWheelSvg` builds a several-kilobyte SVG string from scratch (defs, 14 outer slices, 4 inner bands, cardinal lines, centre disc, chips). Every `openWheelModal` call discards the prior SVG and reparses the new one. The click-handler path explicitly does NOT call `_redrawWheel` (line 6640 comment confirms — animations would interrupt), but every modal re-open does. For a user who toggles the wheel modal a few times to navigate, this is several full SVG reparses.
**Fix(point)**: Build the SVG once on first modal open and reuse the node tree, mutating only the `.active-band` / `.active-seg` / `.is-empty` classes via `classList.toggle` in a separate `_syncWheelHighlights()` pass.
**Fix(systemic)**: Componentise the wheel as a single ES module (`lib/wheel.mjs`) that owns its DOM and exposes `mount(host, state)` / `update(state)`. Tier 2.

### [B3.5] — 50 `innerHTML =` sites in `formulation.html`; `renderActiveTab` does full HTML rebuild

**Tier**: 2
**Auto-fixable**: no
**Severity**: low
**Locus**: `formulation.html` (50 hits per `grep -c "innerHTML\s*="`), `formulation.html:2698-2713` (`renderActiveTab`), `formulation.html:2696` (slider handler)
**Evidence**:
```
document.getElementById('tempSlider').addEventListener('input', debounce(() => renderActiveTab(), 400));
```
plus 50 sites where `someEl.innerHTML = …` rebuilds whole tab bodies.
**Why it matters**: Each tab render rebuilds a multi-kilobyte string and a parse pass. On a phone, the temperature slider + the harmony-tab re-render is the dominant interaction cost. 400 ms debounce covers it, but the underlying pattern (full-tab-body innerHTML rebuild) is the bottleneck. Also: every `innerHTML =` blows away cached `addEventListener` references, which is the right pattern paired with delegated `data-action` handlers but a footgun for any direct listener that survives across renders.
**Fix(point)**: None — the debounce is the right layer for now.
**Fix(systemic)**: Adopt a tiny diffing helper (`lib/render.mjs` with a 50-line `morph(node, html)`) so re-renders patch deltas instead of replacing whole bodies. Tier 5 (large surface).

### [B3.6] — 73 `addEventListener` calls in `formulation.html` and zero `removeEventListener` anywhere

**Tier**: 2
**Auto-fixable**: no
**Severity**: low
**Locus**: `formulation.html` (73 hits — see `grep -c "addEventListener"`)
**Evidence**: `formulation.html`: 73 listeners; `index.html`: 14 listeners; `removeEventListener` never appears in either HTML page.
**Why it matters**: Listeners attached to nodes inside a tab body that gets `innerHTML =`'d will be collected with the GC'd nodes (no leak). Listeners attached to outer chrome (`document.getElementById('btnAddCarrier').addEventListener('click', …)`, `tempSlider`, `productCategory`, etc.) are attached once at boot — also fine. The risk is the middle ground: any code path that re-runs `_renderCompatTabImpl` and re-attaches a listener to the *same outer-chrome node* without removing the prior one will silently double-fire. The current code does not appear to do this, but there's no test or convention to enforce it.
**Fix(point)**: None — current code is OK.
**Fix(systemic)**: Add a `tools/lint-listeners.mjs` static check that flags any `addEventListener` call inside a function whose name matches `/^render/`. Tier 3.

### [B4.1] — Manifest icons are a single inline-data SVG; iOS install + maskable launchers fall back to defaults

**Tier**: 0
**Auto-fixable**: yes
**Severity**: medium
**Locus**: `manifest.webmanifest:13-20`
**Evidence**:
```
"icons": [
  {
    "src": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect width='192' height='192' rx='32' fill='%233b82f6'/><circle cx='96' cy='96' r='60' fill='none' stroke='white' stroke-width='6'/><circle cx='96' cy='96' r='28' fill='none' stroke='white' stroke-width='4'/><line x1='96' y1='12' x2='96' y2='180' stroke='white' stroke-width='3'/><line x1='12' y1='96' x2='180' y2='96' stroke='white' stroke-width='3'/></svg>",
    "type": "image/svg+xml",
    "sizes": "any",
    "purpose": "any"
  }
]
```
`find . -maxdepth 2 -name "*.png" -o -name "*.ico" -o -name "*.svg"` returns no matches — there are zero raster or standalone-SVG icons in the repo.
**Why it matters**: Per the W3C Manifest spec a single `sizes:"any"` SVG is technically valid, but real-world install support is patchy:
- iOS Safari "Add to Home Screen" historically ignores manifest icons and uses `apple-touch-icon` `<link>` tags. Neither HTML page has those.
- Android Chrome will use the SVG, but generates the home-screen icon at multiple sizes; an SVG with hairline 3 px strokes at 192 vb will alias on a low-DPI 48 px launcher.
- `purpose: "any"` provides no maskable icon, so on Android 12+ the launcher overlays the user's adaptive-icon mask on the full SVG and clips the four cardinal lines.
- No `purpose: "monochrome"` either, so the lockscreen / themed-icons mode defaults to the system silhouette.
**Fix(point)**: Generate `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (with safe-zone padding for the 80%-radius circular mask), and add `<link rel="apple-touch-icon" href="icon-192.png">` to both HTML `<head>`s. Add three entries to the manifest with explicit `sizes` and `purpose: "any"` / `purpose: "maskable"` / `purpose: "monochrome"`.
**Fix(systemic)**: A `scripts/build-icons.mjs` that takes one source SVG and emits the four PNGs + the manifest snippet. Tier 3.

### [B4.2] — Manifest has no `id`; `start_url` is bare `./index.html`

**Tier**: 0
**Auto-fixable**: yes
**Severity**: low
**Locus**: `manifest.webmanifest:5-6`
**Evidence**:
```
"start_url": "./index.html",
"scope": "./",
```
No `id` field present.
**Why it matters**: `start_url: "./index.html"` (with no query) means an installed PWA always launches at the bare analyzer, discarding any deep-link state the user had captured. The Round-1 `_writeUrlState()` / `_restoreUrlState()` system reads `location.hash` to restore filter + search state, so the deep-link mechanism is *actually* hash-based — `start_url` having no hash is fine here. But the manifest has no `id` field, so two deploys at different `start_url` values would be treated as different PWAs by Chromium. With the current single value this is moot; flag for awareness if a future short-link redirect lands.
**Fix(point)**: Add `"id": "/perfume-analyzer/"` (or whatever the production scope is) so future `start_url` tweaks don't fork the install identity.
**Fix(systemic)**: Tie the manifest `id` to `version.json`'s slug field. Tier 3.

### [B5.1] — `<meta name="viewport">` is missing `viewport-fit=cover` despite using `safe-area-inset-bottom`

**Tier**: 0
**Auto-fixable**: yes
**Severity**: medium
**Locus**: `index.html:13`, `formulation.html:15`
**Evidence**:
```
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```
`index.html:185` and `index.html:553` and `formulation.html:345` use `env(safe-area-inset-bottom)`:
```
body { … padding-bottom:calc(84px + env(safe-area-inset-bottom)); … }
.downloads { position:fixed; bottom:0; … padding-bottom:calc(var(--space-3) + env(safe-area-inset-bottom)); … }
```
**Why it matters**: Without `viewport-fit=cover`, `env(safe-area-inset-*)` returns `0` on iOS Safari — the very devices these `padding-bottom: env(safe-area-inset-bottom)` declarations target. The fixed download-bar (analyzer) and export-bar (formulator) will sit flush against the home-indicator, not above it as intended.
**Fix(point)**: Change both viewport metas to:
```
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```
**Fix(systemic)**: Single source the viewport meta into a shared snippet that both HTML pages include via build-time concat — or, since there's no build step, codemap-check that the two metas match byte-for-byte. Tier 3.

### [B5.2] — Touch targets: `.chip` baseline 24 px; `.odor-tag` has no `min-height`; `(max-width:600px)` raises only to 40 px

**Tier**: 0
**Auto-fixable**: yes
**Severity**: medium
**Locus**: `index.html:503` (`.chip` baseline), `index.html:999-1000` (`@media`), `formulation.html:512`, `index.html:260` (`.odor-tag`)
**Evidence**:
```
/* index.html base — .chip */
  padding:3px 9px; min-height:24px;

/* index.html @media (max-width:600px) */
  .btn, .chip, .icon-btn { min-height:40px; }

/* formulation.html @media (max-width:600px) */
@media (max-width:600px) { .btn, .chip, .icon-btn { min-height:40px; } }

/* index.html — .odor-tag (no min-height anywhere) */
.odor-tag { padding:2px 10px; border:1px solid var(--border); border-radius:12px; font-size:0.72em; … }
```
**Why it matters**:
- `min-height:24px` for `.chip` is well below the WCAG 2.5.5 (Level AAA, 44×44 CSS px) and Apple HIG (44×44 pt) target sizes; even Material Design's 48×48 dp.
- The `(max-width:600px)` bump to 40 px still falls short of 44 px and excludes any 601-768 px tablet (the very devices the analyzer is hand-friendly on).
- `.odor-tag` (the most-used chip in the analyzer — wheel/family/facet) has zero `min-height` declared, so on small text scales it shrinks below 22 px. There are 24+ `font-size:0.72em` / `0.7em` / `0.75em` chip declarations.
**Fix(point)**: Set `.chip, .odor-tag, .btn, .icon-btn, .preset-chip { min-height:44px; min-width:44px; }` at the base level (not gated by media query). Adjust horizontal padding so non-mobile chip rows don't reflow.
**Fix(systemic)**: A `--touch-target-min: 44px` design token consumed by every interactive primitive's CSS rule, defined once in the shared `:root` token block. Tier 1.

### [B5.3] — Smallest mobile font-size: 0.6 em (~9.6 px) on facet group / pill labels

**Tier**: 0
**Auto-fixable**: yes
**Severity**: medium
**Locus**: `index.html:412, 429, 436, 534`; `formulation.html:276`
**Evidence**:
```
.tag-axis-label { font-size:0.62em; … }
.facet-group-label { font-size:0.6em; … }
.pill-filter-group-label { font-size:0.6em; … }
.match-tag { font-size:0.6em; … }
.cmp-winner-pill  { font-size:0.65em; … }  /* formulation */
```
At a 16 px base, 0.6 em = 9.6 px, 0.62 em = 9.92 px, 0.65 em = 10.4 px.
**Why it matters**: WCAG 2.4.6 / 1.4.4 don't pin a hard minimum, but the iOS HIG / Material guidance calls for ≥ 11 px for "supplementary" text, and the analyzer's primary user (solo, mobile) reads these labels at arm's length. Several of these are uppercase + `letter-spacing:0.08em` + low-contrast (`color:var(--text2)` ≈ #6c7686 on `#fafafa`), compounding the legibility risk.
**Fix(point)**: Raise floor to `0.72em` for the four `*-label` classes; bump contrast on the tokens.
**Fix(systemic)**: Establish a `--fs-xxs: clamp(0.72em, …)` token used by every "label-style" primitive; lint that no rule sets `font-size` below `0.7em` outside of an opt-in `.is-tabular` table-density class. Tier 1.

### [B5.4] — No breakpoint covers 320 px small phones; 16 `@media` queries in `index.html`, 8 in `formulation.html`

**Tier**: 0
**Auto-fixable**: no
**Severity**: low
**Locus**: 24 `@media` blocks total — see `grep -n "@media" index.html formulation.html`
**Evidence**: breakpoints found:
- `index.html`: `prefers-color-scheme: dark`, `prefers-reduced-motion: reduce`, `print`, `(max-width:600px)` (×4), `(min-width:560px)`, `(max-width:480px)` (×2)
- `formulation.html`: `prefers-color-scheme: dark`, `prefers-reduced-motion: reduce` (×3), `print` (×2), `(max-width:860px)`, `(max-width:600px)`
**Why it matters**: The smallest defensive breakpoint is `(max-width:480px)` on the analyzer, `(max-width:600px)` on the formulator. The single most common "small phone" viewport (iPhone SE 1st gen, Galaxy A series narrow mode) is 320 px. Neither page has a `(max-width:360px)` or `(max-width:340px)` breakpoint to tighten gutters / shrink chip rows / hide non-essential metadata for that tier. The formulator's 320 px sidebar is given `grid-template-columns:1fr` only at `860px` — between 320 and 860 px the 320 px sidebar steals 100% of the viewport.
**Fix(point)**: Add `@media (max-width:360px)` block tightening `padding`, `gap`, and dropping non-essential `dt`/`dd` rows in card meta.
**Fix(systemic)**: Move to a token-driven `--gutter`, `--gap`, `--card-cols` system where one token refresh covers every primitive, and add a "320 px small phone" tier as a first-class breakpoint. Tier 1.

### [B5.5] — `safe-area-inset-bottom` referenced; `safe-area-inset-{top,left,right}` and notch-side handling absent

**Tier**: 0
**Auto-fixable**: yes
**Severity**: low
**Locus**: `index.html:185, 553`, `formulation.html:345`
**Evidence**: only `env(safe-area-inset-bottom)` is referenced; landscape-mode notch sides (`safe-area-inset-left`, `…-right`) are not.
**Why it matters**: When a user rotates an iPhone with a notch into landscape, the header (`#header-actions`) and the search box's left edge collide with the notch / dynamic island region. The fixed `.downloads` bar is also unprotected on landscape sides.
**Fix(point)**: Add `padding-left: env(safe-area-inset-left)` / `padding-right: env(safe-area-inset-right)` to `body` and to fixed bars.
**Fix(systemic)**: A shared `.safe-area-pad` utility class applied to every `position:fixed` element. Tier 1.

### [B5.6] — `<meta name="theme-color">` absent on both pages despite manifest declaring one

**Tier**: 0
**Auto-fixable**: yes
**Severity**: low
**Locus**: `index.html` head, `formulation.html` head (both: zero hits for `theme-color`)
**Evidence**: `manifest.webmanifest:10` has `"theme_color": "#3b82f6"`, but neither HTML page emits `<meta name="theme-color" content="#3b82f6">`.
**Why it matters**: Android Chrome reads the manifest `theme_color` only after the SW is registered AND the install prompt has fired. Until then (i.e. the first visit), the URL bar uses the browser default. A `<meta>` tag works on first paint. iOS Safari reads only the meta, never the manifest. Result: the pleasant blue chrome the manifest promises is missing on first-load Android and on every iOS visit.
**Fix(point)**: Add `<meta name="theme-color" content="#3b82f6" media="(prefers-color-scheme: light)">` and a `dark` counterpart to both HTML heads.
**Fix(systemic)**: Single-source the colour token (`--accent`) into a build-time `<meta>` injection. Tier 3.

### Systemic fix candidates (B)

| Tier | Candidate | Resolves |
|---|---|---|
| -1 | **SW route + precache fix** — extend `isLocalScript` regex to `/\.m?js(\?|$)/i`; add `lib/*.mjs`, `taxonomy.js`, `formulation_data.js`, `formulation_engine.js` (with `?v=` query) to `SHELL_ASSETS`; register the SW from `formulation.html` too. | [B2.1], [B2.2], [B2.3] |
| 0 | **Viewport + theme-color polish** — add `viewport-fit=cover`; add `<meta name="theme-color">`; raise smallest font-size floor; add `apple-touch-icon` link tag; add a manifest `id` field. | [B4.1], [B4.2], [B5.1], [B5.3], [B5.6] |
| 1 | **Design-token hardening** — introduce `--touch-target-min:44px`, `--fs-xxs`, `--gutter`, `--gap` tokens used by every primitive; add `(max-width:360px)` tier; `safe-area-inset-{left,right}` on fixed bars. | [B5.2], [B5.3], [B5.4], [B5.5] |
| 2 | **PWA update flow** — drop SW `skipWaiting` from install; add `controllerchange` listener + toast prompt on the page side; SW `postMessage`s the page when a new shell is waiting. | [B2.4] |
| 2 | **`materials.json` index/detail split** — ship a 50 KB index payload synchronously, lazy-load detail blobs per-card. Cuts cold-load JSON parse from ~1.18 MB to ~50 KB on the critical path. | [B0], [B1] |
| 2 | **Wheel / tab componentisation** — extract `lib/wheel.mjs` (mount once, mutate classes) and a tiny `lib/render.mjs` morph helper so 50 `innerHTML =` sites in formulator stop discarding/reparsing the DOM on every tab refresh. | [B3.4], [B3.5] |
| 2 | **Single-pass DB index builder** — `buildIndexes(DB)` walks once and populates prefix-IX, syn-IX, name→cas, blend reverse, FILTER_CACHE in one forEach. Move to `lib/db-indexes.mjs` so the formulator reuses the same walker. | [B3.3] |
| 2 | **Network awareness** — `lib/net.mjs` exporting `online()` and an `online`/`offline` listener that toggles `<html data-net="…">`; PubChem search short-circuits on `offline`. | [B2.6] |
| 2 | **Coalesced search-input handler** — single `coalescePillRender(value)` helper that owns the timer for both `input` and `paste` events. | [B3.1] |
| 2 | **Inverted-index filter visibility** — extend the existing `FILTER_INDEX` (axis-value → Set<CAS>) so `_updateFilterVisibility` can do set intersection instead of a full FILTER_CACHE walk per toggle. | [B3.2] |
| 3 | **SW correctness regression net** — pre-commit gate that asserts every `<script src>` URL matches exactly one SW route; hashes `SHELL_ASSETS` from a single declared list shared with the HTML `<script>` tag generator. | [B2.1], [B2.2] |
| 3 | **Telemetry hooks in SW** — `self.addEventListener('error' / 'unhandledrejection', …)` posts diagnostics back to the page; `cache.put().catch(console.warn)` instead of silent swallow. | [B2.5] |
| 3 | **Icon build pipeline** — `scripts/build-icons.mjs` emits `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` from a single source SVG; manifest snippet auto-updated by `release.mjs`. | [B4.1] |
| 3 | **Listener-leak lint** — `tools/lint-listeners.mjs` flags `addEventListener` calls inside any function whose name matches `/^render/`. | [B3.6] |
| 5 | **DOM-diff render path** — replace the 76 total `innerHTML =` sites with a `morph(node, html)` helper or migrate to a tiny templating library; first-touch surface is large. | [B3.5] |

---

## Phase F — Code quality

### [F1] — Inline JS still growing despite Round-1 lib extraction

**Tier**: 2
**Auto-fixable**: partial
**Severity**: medium
**Locus**: `index.html` (8428 lines), `formulation.html` (6970 lines); `lib/*.mjs` totals 387 lines across 4 modules.
**Evidence**: `wc -l` output:
```
8428 index.html        (Round 1 reported ≈7800 → +628 lines)
6970 formulation.html  (Round 1 reported ≈7000 → -30 lines)
 115 lib/dom-utils.mjs
  79 lib/material-shape.mjs
  82 lib/storage.mjs
 111 lib/utils.mjs
```
Top-level `^function ` counts: index.html = **136**, formulation.html = **80**.

Sample of duplicated/extractable helpers between the two pages (verified by `grep`):

| Helper | index.html | formulation.html | Verdict |
|---|---|---|---|
| `setStatus()` | L1270 | L1168 | duplicated verbatim |
| `showError()` | L1274 | L1172 | duplicated verbatim |
| `window.showToast = function(...)` | L8389 | L1530 | duplicated verbatim (15 + 11 call sites) |
| `applyLangIndex()` / `applyLangForm()` | L8204 | L1425 | shared `LANG_INDEX` walk pattern, drift-prone |
| `_csvEscape()` | L6815 | — | re-implements `csvEscape` already in `lib/utils.mjs:10` |
| `toTitle()` | L8138 | — | one-liner that belongs in lib/ |
| `normalizeKey()` | L5157 | — | overlaps `normaliseMaterialKey` in lib/dom-utils.mjs but ignores Greek/smart-quote folding |
| `fmtA` / `fmtAmt` / `fmtG` | — | L1763, L1828, L2028, L2103 | **defined four times inside formulation.html alone**, near-identical bodies |

**Why it matters**: Round 1's lib extraction has not arrested inline-JS growth — the analyzer is heading toward 9k lines and the formulator above 7k, with provably-duplicate code that is exactly what Round 1's stated R3 goal was meant to consolidate. Each clone is a future drift hazard (esc-vs-escHtml was the same pattern that R3 fixed).
**Fix(point)**: extract `setStatus` / `showError` / `showToast` / `fmt*` / `toTitle` / `_csvEscape` (use existing `csvEscape`) into `lib/dom-utils.mjs` (or a new `lib/format.mjs`).
**Fix(systemic)**: add a CI line-count guard (`wc -l index.html formulation.html` against a baseline; fails on increase without `--bump` opt-in), plus a duplicate-function detector (`grep -h "^function " *.html | sort | uniq -d`) wired into pre-commit.

### [F2] — Test coverage uneven across lib/ — material-shape and storage have zero tests

**Tier**: 3
**Auto-fixable**: yes
**Severity**: medium
**Locus**: `tests/` (3 files, 135 tests); `lib/material-shape.mjs`, `lib/storage.mjs` (untested).
**Evidence**: `ls tests/`:
```
data-integrity.test.mjs
dom-utils.test.mjs
utils.test.mjs
```
- `tests/dom-utils.test.mjs` — 10 tests covering `escHtml`, `debounce`, `normaliseMaterialKey`.
- `tests/utils.test.mjs` — 24 tests covering `lib/utils.mjs` exports (`csvEscape`, etc.).
- `tests/data-integrity.test.mjs` — 101 tests, DB regression (not lib-targeted).
- **No `tests/material-shape.test.mjs`** — `buildEnriched` and `buildFamilyAxes` ship untested despite being a Round-1 breaking change (CHANGELOG: "`enriched` material shape canonicalised … all paths route through `buildEnriched`"). Pure-input-output unit any test suite should pin.
- **No `tests/storage.test.mjs`** — `lsRead`/`lsWrite`/`lsRemove`/`lsGetString`/`lsSetString` ship untested. CHANGELOG flags this module as the gate for ten persistence keys ("corrupted JSON now falls back to the documented default instead of bubbling a deep render crash") — exactly the contract that needs a test.
- `npm test` reports 3 files / 135 tests passing; the suite is healthy but narrow.

**Why it matters**: Two of the three R3 lib modules added by Round 1 have zero unit tests. The shape canonicalisation (`buildEnriched`) is the kind of function whose silent breakage manifests as missing chips/radar bars far downstream; the storage fallbacks are the only guard against a localStorage corruption killing the whole inline script. Phase A5 manually verified storage on the CLI but that's not a CI gate.
**Fix(point)**: add `tests/material-shape.test.mjs` (≥6 cases: minimal entry → 19 fields, missing `mp` table, regulatory mapping, family-axis building) and `tests/storage.test.mjs` (≥6 cases: round-trip, corrupt-JSON fallback, validator rejection, prefix tag warn behaviour, missing key, throwing localStorage).
**Fix(systemic)**: add a coverage threshold to `vitest.config.mjs` (`--coverage` with per-file 70% line-coverage minimum on `lib/`), and gate the pre-commit hook on it.

### [F3] — Underscore-prefixed (private) helpers — sample call counts

**Tier**: 0
**Auto-fixable**: yes
**Severity**: info (no genuine dead code in the sample)
**Locus**: `index.html`, `formulation.html`.
**Evidence**: 10-symbol sample from `grep -nE '^function _[a-zA-Z]'` with `grep -c <name>\b`:

| Symbol | Locus | Reference count | Verdict |
|---|---|---|---|
| `_compareForSort` | `index.html:1436` | 3 | live |
| `_stampResultSeq` | `index.html:1435` | 4 | live |
| `_devWarn` | `index.html:1493` | 11 | live |
| `_clickLog` | `index.html:1499` | 7 | live |
| `_appendShowAllCTA` | `index.html:7373` | 5 | live |
| `_resolveBlendLabel` | `index.html:1717` | 6 | live |
| `_collapseAllSubs` | `index.html:4181` | 3 | live |
| `_redrawWheel` | `index.html:6691` | 5 | live |
| `_extractFemaNumber` | `index.html:5820` | 4 | live |
| `_addPrefix` | `index.html:2099` | 3 | live |

(Counts include the definition line, so 3 = "definition + ≥2 callers".) **No 0-caller dead code in the sample.** The `_` prefix discipline is honoured.

**Why it matters**: The `_` convention is being followed — this is good. The only minor finding is the absence of *enforcement* — a dev could add a `function _foo` and never call it without lint catching it (the inline-script lint surface has no `no-unused-vars`; see F5).
**Fix(point)**: none required; sample is clean.
**Fix(systemic)**: when F5 lands, add `no-unused-vars` for the inline-script ESLint config so unused `_`-prefixed helpers are flagged automatically.

### [F4] — TODO/FIXME census — exactly one marker, still relevant

**Tier**: 0
**Auto-fixable**: no
**Severity**: info
**Locus**: `index.html:2257`.
**Evidence**: full census output:
```
/home/user/perfume-analyzer/index.html:2257:// TODO(stereoisomer-alias-map): when a 2nd stereoisomer family lands
```
Categorised: **still relevant / data-curation note** — defers a stereoisomer alias table until a second stereoisomer family is added. Not actionable without a domain-data trigger. **No FIXME / XXX / HACK markers anywhere** in tracked source (`.js` / `.html` / `.mjs` / `.md`).

**Why it matters**: The codebase is unusually clean of debt markers. The single TODO is well-formed (named cohort `stereoisomer-alias-map`, explicit trigger condition).
**Fix(point)**: leave as-is.
**Fix(systemic)**: optionally add a TODO-format lint rule (`/^\s*\/\/\s*TODO\(([a-z-]+)\):/`) to gate that future TODOs include a named cohort like the existing one — preserves current quality.

### [F5] — ESLint config does not lint scripts/, tests/, or lib/; inline-script JS rules absent

**Tier**: 2
**Auto-fixable**: yes
**Severity**: medium
**Locus**: `eslint.config.mjs:10-48`, `package.json:8-9`.
**Evidence**: `eslint.config.mjs` declares only two configured globs:
- `**/*.html` — html-eslint *structural* rules only (`require-doctype`, `require-lang`, `no-duplicate-id`, `no-multiple-h1`, `require-img-alt`). **No JS rules** apply to the 8428 + 6970 lines of inline `<script>`.
- `tools/**/*.{js,mjs}` — `no-unused-vars`, `no-console: off`, `eqeqeq: smart`.

The `package.json` `lint` script extends the glob to `lib/**/*.{js,mjs}` but **no matching config block exists**, so files there match no config and inherit only ESLint defaults. Round 1 added six CLIs under `scripts/` (`add-allergen.mjs`, `add-material.mjs`, `check-version-drift.mjs`, `install-hooks.mjs`, `release.mjs`, `rename-family.mjs`) — **not in the lint config or the package.json glob**. The `tests/` directory is also unconfigured/unlinted.

**Why it matters**: The largest JS surface (inline scripts in two HTML files = ~15k lines) gets zero JS-level linting (no `no-unused-vars`, no `eqeqeq`, no `no-undef`); six Round-1 Node CLIs that mutate `data/materials.json` and `version.json` get zero linting; the test suite gets zero linting. Round 1's effort to harden the toolchain stops short of its own outputs.
**Fix(point)**: add three more flat-config blocks for `scripts/**/*.{js,mjs}`, `tests/**/*.{js,mjs}` (with vitest globals), and `lib/**/*.{js,mjs}`. Extend the `package.json` `lint`/`lint:fix` globs to include `scripts/` and `tests/`.
**Fix(systemic)**: add a script-rules approach to the html-eslint block (`@html-eslint/eslint-plugin` script-content rules, or migrate inline scripts into `lib/inline-init-*.mjs` modules referenced via `<script type="module">`) so the inline JS inherits `no-unused-vars`/`eqeqeq`/`no-undef`. Otherwise inline-JS quality keeps drifting relative to the Node tools.

### [F6] — package.json: `setup` and `prepare` are duplicates

**Tier**: 0
**Auto-fixable**: yes
**Severity**: low
**Locus**: `package.json:18-19`.
**Evidence**:
```json
"release": "node scripts/release.mjs",
"setup": "node scripts/install-hooks.mjs",
"prepare": "node scripts/install-hooks.mjs",
```
Both `setup` and `prepare` invoke the **same script** with no flag difference. CHANGELOG.md L75-76 confirms intentional dual-entry ("installed by `npm install` (prepare hook) or `npm run setup`") — `prepare` is the npm-lifecycle hook, `setup` is the manual escape hatch.

All other scripts are useful and non-overlapping (`lint`, `lint:fix`, `format`, `format:check`, `lint:blends`, `lint:data`, `lint:version`, `codemap`, `codemap:check`, `release`, `test`, `test:watch`).

**Why it matters**: The duplication is intentional but undocumented in `package.json` itself. A future contributor will likely consolidate them or delete `setup` for "cleanliness". The signal lives only in CHANGELOG.
**Fix(point)**: rename `setup` → `setup:hooks` and add a one-line CONTRIBUTING.md note explaining why both exist.
**Fix(systemic)**: in CONTRIBUTING.md's "Tests" block, document the `npm install` → `prepare` → hook-install chain so the alias is discoverable.

### [F7] — CONTRIBUTING.md drift after Round 1

**Tier**: 0
**Auto-fixable**: yes
**Severity**: medium
**Locus**: `/home/user/perfume-analyzer/CONTRIBUTING.md`.
**Evidence**: cross-reference of CONTRIBUTING.md vs current state of repo (CHANGELOG, package.json, lib/, data/materials.json):

1. **Wrong material count.** L11: `perfumery_data.js  # 417-material DB + trade_names index. Single JSON.` — `data/materials.json` `meta.row_count` is **624**. CHANGELOG v296 documents the migration but CONTRIBUTING still references the old filename and old row count.
2. **Wrong source-of-truth filename.** L11 names `perfumery_data.js`; the live data file is `data/materials.json`. The cheat-sheet table at L142 (`Patch material data | perfumery_data.js`) has the same drift.
3. **`lib/` undercount.** L14: `lib/utils.mjs           # Pure helpers shared with tests.` — `ls lib/` lists four modules (`dom-utils.mjs`, `material-shape.mjs`, `storage.mjs`, `utils.mjs`), all added/expanded by Round 1. CONTRIBUTING omits three of them.
4. **`tools/` undercount.** L16-18 lists `codemap.mjs` and `lint-blends.mjs`; the directory now also has `add-materials.mjs`, `curate-stubs.mjs`, `lint-data.mjs`. The whole `scripts/` directory (6 Round-1 CLIs incl. `release.mjs`, `install-hooks.mjs`, `check-version-drift.mjs`) is missing from the repo-shape section.
5. **Manual cache-bust phrasing borderline.** L66-70 correctly tells contributors to use `npm run release` — but L116 still says "Bump the cache-buster in the same commit" without re-pointing to `npm run release`. A reader landing on L116 first might bump by hand. CHANGELOG explicitly forbids manual bumps.
6. **"Don't introduce a build step" is now ambiguous.** L127-129: "Don't introduce a build step without an explicit ask. The whole site runs from raw files." But Round 1 added ES-module imports (`<script type="module" src="lib/dom-utils.mjs">`); browsers fetch those at runtime — still no bundler/transpile step, but the line should be reworded so a reader doesn't misread "build step" as "any modularisation". Suggest: "Don't introduce a bundler or transpile step — ES modules served directly are fine."
7. **`tests/` description.** L19 is current ("Vitest unit tests for lib/."), but L107-112 ("Tests live under `tests/` and exercise `lib/utils.mjs`") implies single-module coverage and is now stale (also exercises `lib/dom-utils.mjs` and `data/materials.json`).
8. **Wrong size for formulation.html.** L26: `formulation.html is ~4.2k.` Actual = 6970 lines. Likely a typo for 7.2k.
9. **No mention of `audit/`** — directory is in the repo root and unmentioned in the repo-shape diagram.
10. **No mention of `version.json`** — CHANGELOG calls this "single source of truth for both data version and SW shell version" but CONTRIBUTING never names the file.

**Why it matters**: CONTRIBUTING.md is the document new contributors (and per its opening line, LLM editors) read first. After Round 1 it understates the lib/ surface by 75% (1 of 4 modules), points at a renamed/relocated data file, and miscounts the DB by ~50%. The drift contradicts CHANGELOG — precisely the failure mode contributing-doc guidance is meant to prevent.
**Fix(point)**: rewrite the repo-shape diagram to list current `lib/`, `tools/`, `scripts/` contents; update L11 to `data/materials.json # 624-material DB`; reword L127-129 to permit ES modules; cross-link L116 to `npm run release`; fix L26 line count.
**Fix(systemic)**: add a CONTRIBUTING-drift gate — `tools/check-contributing.mjs` asserts row-count number, `lib/` filename list, and HTML line ranges in CONTRIBUTING match reality. Wire into pre-commit alongside `lint:version` and `codemap:check`.

### Systemic fix candidates (F)

Consolidated Tier-2 / Tier-3 levers worth lifting in Round-3:

1. **Coverage threshold in CI** (Tier 3) — vitest `--coverage` with a per-file 70% line-coverage gate on `lib/`, plus the matching tests for `material-shape.mjs` and `storage.mjs` that the threshold would force. Closes the F2 gap.
2. **Lint scripts/, tests/, lib/** (Tier 2) — three new flat-config blocks in `eslint.config.mjs` so the 6 Round-1 CLIs in `scripts/`, the 3 vitest specs in `tests/`, and the 4 modules in `lib/` get the same `no-unused-vars` + `eqeqeq` floor as `tools/`. Closes F5.
3. **JS-level linting for inline scripts** (Tier 2) — extend html-eslint with a script-rules plugin or migrate inline scripts to `<script type="module" src="lib/inline-init-*.mjs">` so the 15k+ lines of inline JS get `no-unused-vars` / `eqeqeq` / `no-undef`. Closes F5 and the F3 enforcement gap.
4. **Extract more helpers to lib/** (Tier 2) — phased plan:
   - **F-2.A** `lib/dom-utils.mjs` ← `setStatus`, `showError`, `showToast` (currently duplicated verbatim across both pages).
   - **F-2.B** new `lib/format.mjs` ← `fmtA`, `fmtAmt`, `fmtG`, `_formatPctDisplay`, `toTitle`, `_csvEscape` (delete in favour of `csvEscape` already in `lib/utils.mjs`).
   - **F-2.C** new `lib/i18n.mjs` ← `applyLangIndex` + `applyLangForm` + the shared `LANG_INDEX` walk pattern.
   Each phase shaves 100-300 lines off index.html / formulation.html and replaces drift-prone clones with one tested module. Closes F1.
5. **Inline-JS line-count budget** (Tier 3) — pre-commit gate `wc -l index.html formulation.html` against a baseline in `audit/inline-js-budget.json`, fails on increase without a `--bump` opt-in. Forces every PR that grows inline JS to declare it. Closes F1's drift vector.
6. **CONTRIBUTING-drift gate** (Tier 3) — `tools/check-contributing.mjs` asserts row-count, `lib/` filename list, and HTML line counts in CONTRIBUTING.md match reality. Closes F7.
7. **Duplicate-function detector** (Tier 3) — pre-commit `grep -h "^function " *.html | sort | uniq -d` fails the commit if the same top-level function name appears in both pages. Catches future setStatus/showError-style clones. Closes F1's regression vector.
8. **package.json `setup` / `prepare` clarity** (Tier 0) — rename `setup` → `setup:hooks` and document the dual-entry rationale in CONTRIBUTING.md. Closes F6.
