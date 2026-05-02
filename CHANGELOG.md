# Changelog

All notable changes to this project. Format follows [Keep a Changelog]
(https://keepachangelog.com/en/1.1.0/); versions track `version.json`'s
`data` field (yyyy-mm-dd-vNNN).

## [2026-04-29-v306] — Round 3 molecular foundation

Tier P0 closure of Round-2 Tier-4 leftovers and Phase 1 molecular
property layer (`audit/r3-report.md`). Nine commits across the round
(`da3d2a4` through this commit). PubChem-sourced `mol_*` and `chem_*`
fields plus `data_provenance` now live alongside the legacy flat
fields on **290 of 624 materials** (46.5% raw, 70.9% of the 409
eligible after mixture exclusion). 119 mismatched rows held back to a
gitignored flagged-file for Round 4 manual triage. **Zero known-wrong
rows in the applied set.** Cache bumped twice over the round
(`v304 → v305 → v306`).

### Breaking / behaviour-shift

- **Service worker shell content hash rotates twice** (`b8305ef0` →
  `8d29e4e1` → `67edc026`). Existing PWA installs auto-rotate. Shell
  major `v3` unchanged.
- **`tools/verify-molecular.mjs` return shape changed:** `verify(...)`
  now returns an object with keys `stats / errors / allowlisted / stale`
  (previously `stats / findings`). Callers read `errors` for the
  exit-driving set; `allowlisted` and `stale` are info-level. Internal
  API only.

### Added — Phase 1 molecular foundation

Implementation breakdown lives in `audit/r3-report.md` Phase 1.

Data:

- 290 materials in `data/materials.json` gain 14 `mol_*` fields
  (formula, molecular_weight, xlogp3, complexity, h_bond_donor_count,
  h_bond_acceptor_count, rotatable_bond_count, heavy_atom_count,
  iupac_name, canonical_smiles, isomeric_smiles, inchi, inchi_key,
  exact_mass) plus a nested `data_provenance` object with
  `computed_source`, `last_fetched`, `manual_overrides[]`. Additive
  merge — legacy flat fields untouched.

New tooling under `tools/`:

- `tools/lib/pubchem.mjs` — reusable PUG-REST client (throttler,
  retry, CAS→CID resolver, batch property, experimental view, cache
  I/O). Coverage S/B/F/L = `100% / 96.96% / 100% / 100%`.
- `tools/enrich-molecular.mjs` — main enrichment script with flags
  `--first-layer-only`, `--experimental`, `--apply`, `--cid <CID>`,
  `--missing-only`, `--help/-h`. Idempotent via cache. Coverage
  `99.22% / 90.90% / 93.75% / 99.22%`.
- `tools/verify-molecular.mjs` — cache-only sanity checks (range,
  provenance, vapor-pressure positivity, cache InChIKey integrity)
  with allowlist support. Wired into `npm run lint:molecular`.
  Coverage `100% / 96.87% / 100% / 100%`.
- `tools/molecular-coverage-report.mjs` — three coverage rates (raw,
  eligible, ship) plus a per-family table. Wired into
  `npm run report:molecular-coverage`. Coverage
  `100% / 91.30% / 100% / 100%`.
- `tools/cache-cleanup.mjs` — manual hygiene (`--report`,
  `--prune-older-than <days>`).

Audit infrastructure:

- `audit/cache/` directory (gitignored) with tracked `.gitkeep` and
  `README.md` documenting TTL (6 months), size warning (100 MB),
  licence rationale, and CI behaviour.
- `audit/molecular-patches.json` (gitignored) — clean patches that
  landed in v305.
- `audit/molecular-patches-flagged.json` (gitignored) — 119-entry
  Round-4 triage input. Distribution: 61 `wrong_cid`, 56
  `stereo_variant`, 2 `corrupted_legacy`. Each entry carries
  side-by-side legacy / fetched identifiers and
  `mismatch_signals.suspected_cause`.
- `audit/molecular-verify.json` (gitignored) — verify-molecular full
  report.
- `audit/molecular-coverage.json` (gitignored) — coverage-report
  machine output.
- `audit/molecular-verify-baseline.json` (TRACKED) — three
  known-acceptable anomalies (Glyceryl Trioleate XLogP=22.4,
  alpha-Tocopherol XLogP=10.7, Ethanol MW=46.07). Chemistry-
  legitimate edge cases that would otherwise fail the heuristic
  ranges.

Schema and lint:

- Schema gains a `mol_*` / `chem_*` namespace with 24 new optional
  properties on `Material` plus a nested `data_provenance`. Schema
  `$comment` documents the flat-with-prefix decision and the
  future-migration path.
- New lint rule on the `mol_*` / `chem_*` namespace: every row that
  carries one of those fields must also carry
  `data_provenance.last_fetched`. Tracked in the lint-data ratchet
  (currently `0 / 290 broken`). Legacy flat fields grandfathered;
  enforcement starts on the new namespace only.

UI:

- `index.html` analyzer card now renders a "Molecular Properties"
  subsection in the col-info area: MW, Formula, logP, Vapor
  Pressure, Boiling Point, plus a "View on PubChem ↗" link. Prefers
  `mol_*` / `chem_*` with graceful legacy fallback. Skips
  null/undefined rows.
- `formulation.html` GC-MS material detail panel splits into two
  table sections: a "Molecular Properties" header (preferred values
  plus the PubChem link) and an "Other" header (CAS, density,
  SMILES, RT, area, odor).

CI:

- New step "Lint molecular" — gating.
- New step "Molecular coverage report" — informational
  (`continue-on-error: true`).
- PubChem auto-fetch intentionally NOT wired into CI (rate-limit
  plus non-determinism per project rules).

Other:

- `CONTRIBUTING.md` gains a "Future: nested molecular migration"
  section (~24 lines) documenting the `mol_*` / `chem_*` prefix
  rule, the grandfathering rule, and the planned migration target.
- `devDependencies` gains `@vitest/coverage-v8@^2.1.9` (needed for
  the `≥95% line / ≥85% branch` acceptance gate on the new tools).
- Tests: **+120 across the round** (162 → 282). Three new test files
  (`tests/pubchem-client.test.mjs`,
  `tests/enrich-molecular.test.mjs`,
  `tests/verify-molecular.test.mjs`) plus extensions to
  `tests/material-shape.test.mjs`.

### Changed

- CHANGELOG `[2026-04-29-v296]` allergen-coverage line corrected.
  The v296 entry previously claimed that the
  `EU_ALLERGENS_CURRENT` regex was extended from 25 to 50 entries.
  Actual count: 14 of approximately 56 new entries from EU 2023/1545
  are present in `EU_ALLERGENS_2023_NEW`;
  the combined `EU_ALLERGENS_CURRENT` covers 40 entries (26 from
  2003/15/EC plus 14 from 2023/1545). The audit-trail truth lives in
  `data/materials.json` `meta.eu_allergen_coverage_status`. The v296
  line below is updated to point at the Round-2 Tier-4 backlog and
  the Round-3 P0.5 deferral.
- `sw.js CACHE_VERSION` rotated twice over Round 3:
  v304 `b8305ef0` → v305 `8d29e4e1` → v306 `67edc026`.
- `tools/check-pubchem.mjs` refactored (P1.2) to import the shared
  client from `tools/lib/pubchem.mjs`. Behaviour identical;
  approximately 30 LOC removed at the throttle / retry section.
- `scripts/release.mjs` — v306 cycle wrote new HTML cache-bust
  strings into `index.html` and `formulation.html` and bumped the
  shell content hash automatically.

### Fixed

- **Mixture-data corruption averted.** Without the P1.3.1 mixture
  filter, 214 essential-oil / absolute / extract entries would have
  been enriched with single-molecule data (Spearmint Oil → CID 962
  = water; Tomato Leaf Absolute → 3,526 g/mol multi-substance
  record). The `pickMaterials(db, opts, mixtureCas)` filter now
  drops these before any fetch.
- **Wrong-CID corruption averted.** The InChIKey + formula guards
  in `partitionPatches` (P1.3.1 + P1.3.2) caught 119 rows where the
  stored `pubchem_cid` resolves to a different molecule than the
  legacy fields describe (or where the legacy DB carries data from
  another molecule entirely — e.g. Bornyl Acetate's legacy
  iupac="methane"). All 119 diverted to the flagged file; `--apply`
  ignores them.
- **PubChem SMILES API rename detected mid-round.** P1.4b dry-run
  surfaced 0 / 290 populated SMILES; root cause: PubChem deprecated
  `CanonicalSMILES` + `IsomericSMILES` in favour of `SMILES` +
  `ConnectivitySMILES`. Parser updated in P1.3.1; coverage now 100%.

### Tier P0 — Round-2 Tier-4 closure

- **P0.1** `perfumery_data.backup.js` — verified absent (Round 2
  cleared); no work needed.
- **P0.2** `CONTRIBUTING.md` — already aligned (Round 2 rewrite);
  added "Future: nested molecular migration" section.
- **P0.3** CHANGELOG v296 allergen count — corrected (this entry
  above).
- **P0.4** EU-banned 5 materials (Lyral / Lilial / Atranol /
  Chloroatranol / Methyl Eugenol) — all NOT IN `data/materials.json`
  perfumery_db; flagged in `audit/r3-report.md` per "ถ้า NOT IN DB
  → flag, ไม่ต้องเพิ่ม" rule. `formulation_data.js EU_ALLERGENS_26`
  carries Lilial + Lyral with `(BANNED)` suffix for INCI lookups.
- **P0.5** EU 2023/1545 allergens 50→80+ — **deferred to Round 4**
  as `Tier P0.5-incomplete`. Hand-curating ~42 missing entries
  needs domain review of EUR-Lex Annex III (source URLs in
  `audit/r3-report.md` Tier P0).

### Deferred / Round 4 backlog

See `audit/r3-report.md` "Round 4 Backlog (handoff input)" for the
full punch list. Headlines:

- **119 flagged molecular patches** — manual triage, choose correct
  CID for `wrong_cid`, rewrite legacy text for `corrupted_legacy`.
- **42 EU 2023/1545 allergens** — hand-curate from EUR-Lex.
- **Mixture legacy-data corruption (Group B pattern)** — surfaced
  via P1.6 UI fallback (Spearmint Oil row points to water). Likely
  more across the 214 mixtures; needs deeper audit. Decide policy:
  should mixtures carry a `pubchem_cid` at all?
- **CAS-CID mismatch follow-up** — P1.2 sample surfaced 142-08-5
  3-Hydroxypyridine (DB 7971 vs PubChem 8871).
- **`corrupted_legacy` heuristic gaps** — Patchoulol + Terpinyl
  Acetate currently mis-classified as `wrong_cid`.
- **Round 1+2 baseline data-lint failures (6 categories)** — still
  at ratchet baseline; separate cleanup round.

### Audit metadata (per `data/materials.json` `meta`)

Unchanged from v304 (no domain-data versioning event in this round).

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
- `index.html` `EU_ALLERGENS_CURRENT` regex extended (originally
  reported as "25 → 50"). **Corrected in v306:** actual count is
  **14 of ~56** new entries from EU 2023/1545 added to
  `EU_ALLERGENS_2023_NEW`; combined `EU_ALLERGENS_CURRENT` covers
  **40** entries (26 from 2003/15/EC + 14 from 2023/1545). The
  index.html regex carries 52 tokens (with aliases / alternate
  spellings). Authoritative status lives in `data/materials.json`
  `meta.eu_allergen_coverage_status`. **EU 2023/1545 transition is
  incomplete** — see Round-2 Tier-4 backlog (`audit/r2-report.md`)
  and Round-3 P0.5 deferral (`audit/r3-report.md`); ~42 entries
  await Round 4 hand-curation from EUR-Lex.

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
