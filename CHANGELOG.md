# Changelog

All notable changes to this project. Format follows [Keep a Changelog]
(https://keepachangelog.com/en/1.1.0/); versions track `version.json`'s
`data` field (yyyy-mm-dd-vNNN).

## [2026-04-29-v304] — Round 2 audit sweep

Full-system audit (`audit/r2-report.md`) — 70 findings across 6 phases
(A: Round-1 regression, B: performance/PWA, C: a11y WCAG 2.1 AA,
D: domain correctness, E: security, F: code quality). 8 root-cause
groupings; this release ships Tier -1 through Tier 3 of the action
plan (54 of the 70 findings addressed; 6 Tier-4 items marked
[NEEDS EXPERT REVIEW] with no auto-change; 10 Tier-5/2 items deferred
to Round 3).

### Breaking / behaviour-shift

- **Service-worker precache list now covers every routable JS / ES
  module.** Round 1 left `taxonomy.js`, `formulation_data.js`,
  `formulation_engine.js`, and the four `lib/*.mjs` files OFF the
  precache list, AND `isLocalScript()`'s regex didn't match `.mjs`,
  AND `formulation.html` never registered the SW. Composition broke
  first-time offline boot of the formulator. Now: `SHELL_FILES` in
  `scripts/release.mjs` is the single source of truth, the
  `SHELL_ASSETS` array literal in `sw.js` is regenerated between
  marker comments on every release, `isLocalScript` matches `.m?js`,
  and the `ignoreSearch` cache fallback covers the bare-path-vs-
  `?v=…` mismatch. **Existing installs auto-rotate** because the
  shell content hash now differs.
- **Toast `escHtml()` upgrade.** `showToast()` was doing
  `String(message).replace(/</g, '&lt;')` — partial five-entity
  escape. Fixed to use the canonical `escHtml()` which handles `&
< > " '`. Visible difference: messages containing `&` no longer
  render as `&amp;` mojibake; messages containing `'` are escaped
  to `&#39;` (renders identically; defence-in-depth).
- **Filter chip aria-pressed wiring.** `_buildPillFilter` now sets
  `role="button"`, `tabindex="0"`, and `aria-pressed` on every
  chip; click handler updates `aria-pressed` in lockstep with the
  toggle. SR users hear "pressed/not pressed" instead of silent
  toggles. Visual rendering unchanged.

### Added

- `audit/r2-report.md` — 2060-line read-only Round-2 audit. 70
  findings + heat map + 8 root causes + tier plan.
- `data/materials.json` `meta` block extended:
  `ifra_amendment` `"51"`, `ifra_verified_at`, `ifra_source_url`,
  `eu_allergen_revision` `"2023/1545"`, `eu_allergen_verified_at`,
  `eu_allergen_source_url`, `eu_allergen_coverage_status`
  (explicit "partial — ~42 of ~56 missing" so a downstream
  consumer can't mistake the table for complete), `taxonomy_source`
  (Edwards 2023 + r2-report.md §D3 divergence pointer).
- `<meta http-equiv="Content-Security-Policy">` on both HTML
  pages — allowlist for jsDelivr, Google Fonts, PubChem; blocks
  arbitrary inline-form-action / object-embed / cross-origin
  manifest sources. Plus `<meta name="referrer">` and
  `X-Content-Type-Options: nosniff`.
- `manifest.webmanifest` `id: "/perfume-analyzer/"` so future
  `start_url` tweaks don't fork install identity. Second icon
  entry with `purpose: "maskable"` (raster icon pipeline still
  Round-3 backlog).
- `tools/check-pubchem.mjs` — CAS↔CID cross-validation CLI.
  Throttled to ≤5 req/s; supports `--sample N`, `--cas X`,
  `--all`, `--json`. Reproduces Phase D's spot-check.
- `.github/dependabot.yml` — weekly npm bumps grouped by
  cluster (eslint\*, vitest+vite+esbuild, prettier), monthly
  Actions pins.
- `tests/material-shape.test.mjs` (9 cases) — locks in the
  21-key `enriched` shape contract, `mp` fallback semantics,
  the C3.2/C3.3 classification preservation.
- `tests/storage.test.mjs` (16 cases) — covers the "graceful
  in 6 cases" property: corrupt JSON, validator reject,
  missing key, round-trip, private-mode throw, cyclic
  serialisation.
- `<meta name="theme-color">` + `apple-mobile-web-app-*` +
  `<link rel="manifest">` on `formulation.html` (analyzer
  already had them; symmetry).
- `<link rel="preconnect">` to `fonts.googleapis.com` /
  `fonts.gstatic.com` on both pages — saves ~150 ms TLS on
  cold-load.
- Visually-hidden `<h2>Filters</h2>` and `<h2>Results</h2>`
  in analyzer for SR heading-jump navigation.
- Second skip link `Skip to results` so keyboard users
  bypass the long filter drawer.
- `aria-live="polite"` on `#progressText` and
  `#statusBar` — SR users hear "Loading database…",
  "K of M results", "filter applied" announcements.
- Delegated keydown listener: synthesises `click` on
  Enter/Space for any focused `[role="button"]` that
  isn't a real `<button>` (covers card-del, badge-related,
  badge-substitute, wheel slices, etc.).
- `scripts/pre-commit.sh` runs `format:check` (Round 1
  forgot to add it; CI gate was passing accidentally
  while local prettier was dirty).

### Changed

- `chart.js` pinned `@4` → `@4.5.1` with SRI
  (`integrity="sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ"`)
  and `crossorigin="anonymous"`. Closes the floating-tag
  supply-chain hole; a compromised jsDelivr edge can no
  longer ship arbitrary JS.
- `<meta name="viewport">` on both pages now carries
  `viewport-fit=cover` so iOS Safari resolves
  `env(safe-area-inset-*)` correctly. `body` and the
  fixed `.downloads` / `.export-bar` honour
  `safe-area-inset-{left,right}` for landscape notches.
- `ESLint` now lints `scripts/`, `lib/`, AND `tests/`
  (Round 1 covered only `tools/`). `caughtErrorsIgnorePattern: '^_'`
  added so `catch (_)` clauses pass.
- `package.json` `format` glob drops the two HTML files
  (`prettier --write` on inline-JS pages would reflow
  TDZ-sensitive code) and adds `scripts/**`.
- `.prettierignore` adds `.codemap.md` (auto-generated by
  `tools/codemap.mjs`); drops dead `perfumery_data.backup.js`
  reference (file was deleted in Round-1 commit `73a20c6`).
- Smallest mobile `font-size` raised from `0.6em` (≈9.6 px)
  to `0.72em` on `.tag-axis-label`, `.facet-group-label`,
  `.pill-filter-group-label`, `.match-tag`. Opacity-stacked
  contrast lifted on `.pill-count` (.5 → .85) and
  `.odor-tag.empty` (.35 → .6, plus dotted border so the
  "available but unused" state is conveyed by SHAPE).
- `#searchError` switched from `display:none` (which
  removes the node from the AT) to a class-and-`:empty`
  pattern; added `role="alert"` and
  `aria-live="assertive"` so the "Already in results" /
  "Did you mean…" messages narrate.
- Compare CTA converted from `<a role="button">` (no
  `href`) to a real `<button type="button">`.
- Formulation wheel SVG container now declares
  `role="img" aria-label="Edwards Fragrance Wheel"`,
  matching the analyzer.
- `scripts/release.mjs` now hashes ALL `SHELL_FILES`
  (not just the four headline ones); sw.js
  `SHELL_ASSETS` array regenerated on every release.
  `--check` enforces the round-trip and reports drift.
- `sw.js` adds `error` / `unhandledrejection` /
  `messageerror` listeners so a deploy regression
  surfaces in DevTools instead of being swallowed.

### Fixed

- **CIDs wrong on 2 of 10 sampled rows** (Phase D5).
  - Triplal (CAS 68039-49-6): `pubchem_cid` `87577` →
    `93375` (was pointing to magnesium gluconate).
  - Ethylene Brassylate (CAS 105-95-3): `pubchem_cid`
    `15600` → `61014` (was pointing to decane).
- **Placeholder name leaked through curation** (Phase D5.2).
  CAS 7779-30-8 had `name: "Dtxsid6026240"` (DSSTox
  auto-id); renamed to `Methyl alpha-Ionone` to match the
  Title Case convention used elsewhere. Substance identity
  was already correct (IUPAC, formula, SMILES, synonyms
  list all consistent).
- **Round-1 regression: `format:check` failing silently** —
  6 Round-1 outputs (lib/dom-utils.mjs, lib/material-shape.mjs,
  lib/storage.mjs, tests/dom-utils.test.mjs, CHANGELOG.md,
  CONTRIBUTING.md) plus 6 pre-existing technical-debt files
  were never run through prettier. Either CI was failing
  or the WebFetched success report was inaccurate. All 12
  files now prettier-clean; pre-commit hook runs
  `format:check` so the gate stays honest.
- **CONTRIBUTING.md drift** (Phase F7) — 10 items: material
  count 417 → 624, wrong DB filename, `lib/` undercount,
  missing `scripts/` section, formulation.html line count,
  ambiguous "no build step" wording, and others.
- **`handleStructureImgError` raw `img.src`** (Phase E1).
  PubChem URL now esc()'d before `href` interpolation;
  added `rel="noopener noreferrer"` to the
  `target="_blank"` link.

### Audit metadata (per `data/materials.json` `meta`)

```json
"ifra_amendment": "51",
"ifra_verified_at": "2026-05-02",
"ifra_source_url": "https://ifrafragrance.org/safe-use/library/standards",
"eu_allergen_revision": "2023/1545",
"eu_allergen_verified_at": "2026-05-02",
"eu_allergen_coverage_status": "partial — Round-2 audit (Phase D2) flagged ~42 of ~56 missing",
"taxonomy_source": "Edwards Fragrance Wheel 2023; see audit/r2-report.md §D3 for divergences"
```

### NOT in this round (Round-3 backlog)

Tier-4 (NEEDS EXPERT REVIEW — flagged in audit, no auto-change):

- 5 EU-banned / strict-cap materials missing from
  `IFRA_51_LIMITS` (Lyral, Lilial, Atranol,
  Chloroatranol, Methyl Eugenol).
- ~42 of ~56 EU 2023/1545 allergen entries missing from
  `EU_ALLERGENS_2023_NEW`.
- Edwards taxonomy: `Fruity` placement under Floral vs
  Fresh; `aromatic_fougere` token vs plain `Aromatic`;
  no `gourmand` sub-band.
- 3 suspicious note assignments (Isopropyl Palmitate
  bp ≈ 320 °C marked Top/Middle; Pivalic Acid +
  2-Propanethiol gourmand classification questioned).
- Ambroxan supplier disambiguation; Iralia → Firmenich
  attribution.

Tier-5 / Tier-2 deferred:

- B1 — split `data/materials.json` into 50-KB index +
  per-material detail blobs (cuts cold-load JSON parse
  from 1.18 MB).
- B3.x — perf rewrites: inverted-index filter visibility,
  wheel componentisation, listener cleanup.
- C2 / C7 / C13 — convert `<div onclick>` to `<button>`
  repo-wide; modal focus traps; tablist refactor.
- F1 — extract more shared helpers (`lib/format.mjs`,
  `lib/i18n.mjs`).
- D-tier-3 — IFRA / EUR-Lex RSS monitor.
- B2.4 — SW update flow (drop install-time
  `skipWaiting`, add `controllerchange` toast).

## [2026-04-29-v296] — audit-coherence sprint

Sweep against the 30-finding audit (`audit/coherence-report.md`). Four
root causes (R1 single version source, R2 schema validation, R3 shared
helpers, R4 unautomated rules) collapsed into a 4-tier sprint plan.

### Breaking

- **localStorage schema migration.** Ten persistence keys
  (`perfume_lang`, `perfume_theme`, `perfume_debug`, `perfume_compare_cart`,
  `perfume_analyzer_results`, `perfume_analyzer_sort`,
  `perfume_formulation_materials`, `perfume_formulation_ts`,
  `perfume_saved_formulations`) now read/write through `lib/storage.mjs`
  helpers. Existing payloads are still accepted (no version field added),
  but corrupted JSON now falls back to the documented default instead of
  bubbling a deep render crash.
- **`secondaryFamilies` → `facets` reclassification.** 16 material rows
  had `facets`-style tokens (`watery`, `aldehydic`, `aromatic`, etc.)
  parked in `secondaryFamilies`; moved to the correct field. Downstream
  family-balance and chip rendering may shift slightly for those rows.
  Affected CAS list in commit `73a20c6`.
- **`enriched` material shape canonicalised.** Four
  `formulation.addMaterial` call sites previously built the 19-field
  enriched object inline; two were missing the classification five
  (`primaryFamilies`/`secondaryFamilies`/`facets`/`functions`/`regulatory`)
  for months (audit C3.2/C3.3). Now all paths route through
  `buildEnriched(entry, mp)` from `lib/material-shape.mjs`. Radar /
  chip output for materials added via the formulator's own search modal
  or the Creative Brief flow may change to match the Analyzer-handoff
  path's output (this was the intended shape all along).

### Added

- `version.json` — single source of truth for both data version and SW
  shell version.
- `scripts/release.mjs` — atomic version bump propagated to `index.html`
  (×3 cache-bust + 2 `DATA_VERSION`), `formulation.html` (×3 + 1),
  `sw.js` (`CACHE_VERSION`), `data/materials.json` (`meta.version`).
  Verifies "exactly one distinct version repo-wide" after each write.
- `scripts/check-version-drift.mjs` — thin wrapper that runs
  `release.mjs --check`. Wired as `npm run lint:version` and a CI-gate
  candidate.
- `schema/materials.schema.json` — JSON Schema (draft-07) for
  `data/materials.json`. Enforces CAS pattern on `cas`, `trade_names`
  values, `mixture_cas`, `pubchem_cid`, and the `blends_with` `string |
{label, cas, strength, source}` union.
- `tools/lint-data.mjs` — three-pass linter:
  - **A. Schema** — Ajv validates against `materials.schema.json`.
  - **B. Cross-reference** — 20 categories: family tokens →
    taxonomy, subfamily/facet orphans, `IFRA_51_LIMITS` ↔ DB,
    `blends_with` resolvability + bidirectionality, `trade_names`
    CAS-only, `mixture_cas` ↔ DB, CAS check-digit validity,
    `NATURAL_ALLERGEN_COMPOSITION` constituent ↔ EU list,
    `ESTER_HYDROLYSIS` integrity, `AROMACHOLOGY_SCORES` ↔ DB.
  - **C. Ratchet** — fails CI only when a category's broken count
    _increases_ vs `audit/lint-data-baseline.json`. Lets us inherit
    backlog without freezing development.
    Flags: `--json`, `--strict`, `--update-baseline`.
- `lib/dom-utils.mjs` — shared `escHtml` (correct null/undefined
  handling, escapes apostrophes), `debounce` (with `.cancel`/`.flush`),
  `safeInit` (try/catch wrapper), `normaliseMaterialKey` (Greek-letter
  prefix collapse, smart-quote ASCII fold, NFKD).
- `lib/material-shape.mjs` — `buildEnriched(entry, mp)` and
  `buildFamilyAxes(entry)`.
- `lib/storage.mjs` — `lsRead`/`lsWrite`/`lsRemove`/`lsGetString`/
  `lsSetString` with optional shape validator and tagged-prefix warns.
- `scripts/pre-commit.sh` + `scripts/install-hooks.mjs` — vendored git
  pre-commit gate (lint + test + lint:data + lint:version +
  codemap:check); installed by `npm install` (prepare hook) or `npm run
setup`. No husky devDep.
- `scripts/add-material.mjs` — append a row with CAS check-digit
  validation, sorted insertion, `meta.row_count` refresh, then
  re-runs `lint-data`.
- `scripts/rename-family.mjs` — rename a `subfamily`/`facet` token
  across `data/materials.json` and `taxonomy.js` atomically.
- `scripts/add-allergen.mjs` — insert an EU 1223/2009 entry into
  `EU_ALLERGENS_CURRENT` (alphabetically sorted, regex-escaped).
- `tests/dom-utils.test.mjs` — 10 unit tests locking in the helpers'
  contracts (apostrophe escape, 0/false handling, Greek-letter
  collapse, smart-quote fold, debounce coalesce).

### Changed

- `sw.js` `CACHE_VERSION` is now
  `perfume-shell-${manualMajor}-${contentHash}`. The 8-hex content
  hash auto-derives from `SHELL_ASSETS` via `release.mjs` so any shell
  asset change rebusts the cache without a manual shell bump.
- `tools/lint-data.mjs` orphan check counts BOTH
  `primaryFamilies` and `secondaryFamilies` (a subfamily with a
  secondary-only claim is no longer reported as dead).
- `index.html` `EU_ALLERGENS_CURRENT` regex extended from 25 → 50
  (EU 26 from 2003/15/EC + 24 from 2023/1545).

### Fixed

- **13 trade_names entries** had material-name values where CAS was
  expected — every `trade_names` value is now a CAS, enforced by
  schema.
- **1 missing material row** — `2442-10-6` (1-Octen-3-yl Acetate),
  referenced by `IFRA_51_LIMITS` but absent from `perfumery_db`.
- **3 trailing empty `pubchem_cid` strings** removed (Javanol,
  α-Bulnesene, Norpatchoulenol). Previously they violated the
  `pubchem_cid` digits-only schema.
- **7 orphan SUB_FAMILIES** claimed by their canonical example
  material's `secondaryFamilies`:
  - `aromatic_fougere` ← `8000-28-0` Lavender Oil
  - `water` ← `28940-11-6` Calone 1951
  - `soft_floral` ← `8024-12-2` Mimosa Absolute
  - `woody_amber` ← `54464-57-2` Iso E Super
  - `woods` ← `8000-27-9` Cedarwood Oil (Virginian)
  - `mossy_woods` ← `9000-50-4` Oakmoss Absolute
  - `dry_woods` ← `8016-96-4` Vetiver Oil (Haitian)
- **C2.3 — Greek-letter resolver.** `γ-Decalactone` /
  `gamma-Decalactone` / `Gamma-Decalactone` now collapse to the same
  row instead of falling through to fuzzy match. New
  `NORM_NAME_TO_CAS` index in both pages, used as a fallback in
  `_resolveBlendLabel` and the modal-search loop.
- **Allergen-negation regex** — index.html allergen scanner extended
  to 50-entry EU list.

### Internal

- All inline `esc()` / `escHtml()` / `debounce()` helpers in the two
  HTML pages now delegate to `lib/dom-utils.mjs` via
  `window.appUtils`. Loaded as a deferred ES module before the
  bootstrap classic script; populated before the inert
  `<script id="app-init">` activates.
- Audit branch `audit/coherence-2026-05-01` carries the original
  read-only audit (`audit/coherence-report.md`,
  `audit/scripts/check-cross-refs.mjs`) and is not merged into the
  fixes branch.

[2026-04-29-v296]: https://github.com/dackclup/perfume-analyzer/compare/v295...v296
