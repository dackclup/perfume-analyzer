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

