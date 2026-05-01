# Changelog

All notable changes to this project. Format follows [Keep a Changelog]
(https://keepachangelog.com/en/1.1.0/); versions track `version.json`'s
`data` field (yyyy-mm-dd-vNNN).

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
    *increases* vs `audit/lint-data-baseline.json`. Lets us inherit
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
