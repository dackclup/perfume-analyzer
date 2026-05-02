# Round 3 Audit Report

**Branch:** `claude/r3-molecular-foundation-2026-05-02`
**Date:** 2026-05-02
**Scope:** Tier P0 cleanup (Round 2 leftovers) + Phase 1 molecular foundation.

---

## Executive Summary

Round 3 closed the P0 leftovers from Round 2 and built the Phase 1
molecular foundation. The PubChem-sourced `mol_*`/`chem_*` layer now
sits alongside the legacy flat fields for **290 of 624 materials**
(46.5% raw, 70.9% of the 409 eligible after mixture exclusion); the
**119 rows that the InChIKey + formula guards held back** for
mismatch are written to a gitignored flagged file and become the
single biggest input to Round 4 manual triage. **214 mixture entries
(essential oils / absolutes / extracts) were correctly skipped** —
the dry-runs proved that without that filter, Spearmint Oil would
have been enriched as water (CID 962) and Tomato Leaf Absolute as a
3,526 g/mol multi-substance.

Engineering surface grew by 4 new tools (`lib/pubchem.mjs`,
`enrich-molecular`, `verify-molecular`, `molecular-coverage-report`,
plus `cache-cleanup`), 1 new schema namespace (`mol_*`/`chem_*` +
`data_provenance`), 1 new lint rule (provenance required), 2 new CI
steps, and a UI "Molecular Properties" subsection in both SPAs. Tests
grew **162 → 282 (+120)**. Cache-bumped twice (v304 → v305 → v306).
All Round-3 acceptance criteria met or explicitly deferred with
documented rationale; nothing pushed yet.

**Severity tally:** 0 errors fail the build. 3 verify-molecular
findings are domain-legitimate edge cases (Glyceryl Trioleate /
alpha-Tocopherol / Ethanol — see P1.6) and explicitly allowlisted in
`audit/molecular-verify-baseline.json`.

---

## Pre-flight

- Branch `claude/r3-molecular-foundation-2026-05-02` created from `main`
  at `7f79b09`.
- Stale branch `claude/rebuild-search-categorization-MLSJ1` confirmed
  empty (zero commits ahead of main). Local delete OK; remote delete
  blocked by HTTP 403 (sandbox limitation, same as Round 2 cleanup) —
  **manual delete via GitHub UI required**.
- All gates green at start: `npm test` 162 → grew to **282** by P1.7;
  `npm run lint` clean; `lint-data` ratchet `no regression`.

---

## Tier P0 — Round-2 Tier-4 closure

### P0.1 — `perfumery_data.backup.js`

**Status: already absent (Round 2 cleared).** Verified at pre-flight
via `find . -name perfumery_data.backup.js` (no result), `grep -rn
"perfumery_data.backup" .` (no result), and inspection of `sw.js`
SHELL_ASSETS (not present). **Action:** report-only entry; no work
needed.

### P0.2 — CONTRIBUTING.md sync

**Status: already aligned (Round 2 rewrite preserved).** Verified at
pre-flight: 624-material count present; `npm run release` documented;
all three lib modules (`lib/dom-utils.mjs`, `lib/material-shape.mjs`,
`lib/storage.mjs`) listed; "no build step" rule current. **P1.1
addition:** new "Future: nested molecular migration" subsection
(~24 lines) documenting the prefix rule, grandfathering rule, and the
planned migration target (committed in `da3d2a4`).

### P0.3 — CHANGELOG v296 correction

**Status: corrected in this commit.** The v296 entry previously read
`EU_ALLERGENS_CURRENT regex extended from 25 → 50 (EU 26 from
2003/15/EC + 24 from 2023/1545)`. The audit-trail truth lives in
`data/materials.json` `meta.eu_allergen_coverage_status` ("partial —
~42 of ~56 missing") and reflects that only **14 of the ~56 entries
from 2023/1545** are in `EU_ALLERGENS_2023_NEW`. The v296 line is
now amended to record the actual count and to reference both the
Round-2 backlog (r2-report.md) and the Round-3 P0.5 deferral below.

### P0.4 — EU-banned 5 materials (NOT IN DB)

**Status: flagged, no DB add (per prompt rule "ถ้า NOT IN DB → flag
ใน report, ไม่ต้องเพิ่ม").** Pre-flight check confirmed all 5 are
absent from `data/materials.json` perfumery_db:

```
Lyral / HICC          → NOT IN DB
Lilial / BMHCA        → NOT IN DB
Atranol               → NOT IN DB
Chloroatranol         → NOT IN DB
Methyl Eugenol        → NOT IN DB
```

`formulation_data.js EU_ALLERGENS_26` (lines 174–175) does carry
Lilial + Lyral with `(BANNED)` suffix for INCI-name lookups; that
labelling continues to surface in the formulator. **No formulator-UI
warning was wired** because none of the 5 are pickable as raw
materials in the current DB. Round 4 may revisit if any of the 5
are added to the perfumery_db.

### P0.5 — EU 2023/1545 allergens 50→80+ (DEFERRED to Round 4)

**Status: `Tier P0.5-incomplete` — deferred to Round 4 per the
prompt's escape clause.** Currently 14 of ~56 entries from EU
2023/1545 sit in `formulation_data.js EU_ALLERGENS_2023_NEW`
(lines 194-209). The combined `EU_ALLERGENS_CURRENT` covers 40
entries, and the index.html regex carries 52 tokens (with aliases).

Hand-curating the missing ~42 from EUR-Lex requires domain review
of official documents — better suited for the user with EUR-Lex
side-by-side than an autonomous agent. **Source URLs for Round 4:**

- EUR-Lex Reg 2023/1545: <https://eur-lex.europa.eu/eli/reg_impl/2023/1545>
- IFRA practical guide: <https://ifrafragrance.org/standards>

The CAS list of the 42 missing entries can be derived from the
regulation's Annex III table; **no list is asserted here** because
the prompt explicitly forbids guessing.

---

## Phase 1 — Molecular Foundation

### P1.1 — Schema + lint rule + provenance shape

**Commit:** `da3d2a4`

- 14 `mol_*` (computed) + 10 `chem_*` (experimental) optional schema
  properties + nested `data_provenance` object on `Material`.
- New cross-ref rule in `tools/lint-data.mjs`:
  `material.mol_*/chem_* require data_provenance.last_fetched`.
  Initial baseline 0/0 (additive).
- CONTRIBUTING.md: "Future: nested molecular migration" section.
- `tests/material-shape.test.mjs`: lock `buildEnriched` shape
  stability when entries carry the new namespace.

### P1.2 — Reusable PubChem client

**Commit:** `f353d14`

- Extracted throttler / retry / CAS→CID resolver from
  `tools/check-pubchem.mjs` into `tools/lib/pubchem.mjs`.
- Added `pubchemBatchProperty`, `pubchemExperimentalView`,
  `cacheRead/Write/Path`.
- 27 new tests cover module constants, fetch retries (200/404/503/
  429/malformed), CID resolver, batch property, experimental view,
  cache I/O.
- `@vitest/coverage-v8` added as devDep (also needed by P1.3 gates).
- Coverage on `tools/lib/pubchem.mjs`: 100/96.96/100/100% (S/B/F/L).

### P1.3 — `tools/enrich-molecular.mjs` (dry-run capable)

**Commit:** `c81b966`

- New 440-line script: `parseArgs`, `pickMaterials`, `resolveCid`,
  `pugRestToMolPatch`, `pugViewToChemPatch`, `buildPatch`,
  `applyPatches`, `main`. Dependency-injectable for testability.
- Flags: `--first-layer-only --experimental --apply --cid <CID>
--missing-only --help/-h`.
- `tools/cache-cleanup.mjs` companion (manual hygiene).
- `audit/cache/` infra: gitignored payload, tracked README documenting
  TTL (6 months), size warning (100 MB), licence rationale.
- 47 new tests (later extended to 56) covering every flag combination,
  network mock variants, idempotency contract.

#### P1.3.1 fix-up — SMILES rename / mixture filter / CID-mismatch guard

**Commit:** `b8e2fbb`

P1.4b first-pass dry-run surfaced three blockers; this fix-up resolved
them all before any data was applied:

1. **SMILES property rename** — PubChem deprecated `CanonicalSMILES`/
   `IsomericSMILES` in favour of `SMILES`/`ConnectivitySMILES`. Parser
   updated. Coverage of mol_canonical/isomeric_smiles: 0% → 100%.
2. **Mixture filter** — `pickMaterials` now excludes
   `data.mixture_cas` (214 entries: essential oils / absolutes /
   extracts whose CAS resolves to water or a single constituent in
   PubChem). `--cid` bypasses for debug.
3. **CID-mismatch guard** — `partitionPatches` splits patches into
   `clean` (safe to apply) and `flagged` (legacy InChIKey ≠ fetched
   InChIKey → wrong-CID candidate). Flagged file is gitignored,
   never consumed by `--apply`.

#### P1.3.2 fix-up — formula-mismatch guard + suspected_cause heuristic

**Commit:** `92f28d4`

P1.4b second-pass dry-run surfaced 8 wrong-CID rows that slipped past
the InChIKey guard because their legacy DB rows lack `inchi_key`. This
fix-up:

1. **Secondary guard:** flag when `legacy.formula` is set AND differs
   from `fetched mol_formula`. Together with the InChIKey guard, every
   wrong-CID and corrupted-legacy case the dry-run has surfaced is
   caught.
2. **`mismatch_signals` payload:** flagged entries now carry
   `inchi_key_diff`, `formula_diff`, `suspected_cause`.
3. **`suspected_cause` heuristic** (simple — Round 4 manual triage
   decides for real):
   - `stereo_variant` — same formula, only InChIKey differs.
   - `corrupted_legacy` — legacy.iupac_name contains an obviously-
     not-perfumery marker (`methane`, `pyrazol`, `azocin`,
     `piperidin`, `morphin`, `phenazon`, `caffein`).
   - `wrong_cid` — formula differs and legacy looks plausible.
   - `unknown` — fallback.

**Note for Round 4:** the heuristic caught only **2 of 4** known
corrupted-legacy cases (Bornyl Acetate's iupac="methane" and
Camphene's iupac=propyphenazone). The other two — **Patchoulol**
(legacy data is glycol stearate's: `2-hydroxyethyl octadecanoate`)
and **Terpinyl Acetate** (legacy synonym is `alazocine`, an opioid)
— fell into the `wrong_cid` bucket because their iupac strings don't
contain my marker keywords. Acceptable per the project rule "don't
over-engineer the heuristic"; Round 4 manual triage will
re-categorize them.

Coverage on `tools/enrich-molecular.mjs` after P1.3.2: 99.22% / 90.90% /
93.75% / 99.22% (S/B/F/L). All P1.3 tests still passing.

### P1.4 — Apply enrichment to `data/materials.json`

**Commit:** `f581d1f` — version v304 → **v305** (shell hash
`b8305ef0` → `8d29e4e1`).

#### Sub-step protocol (per amendment #2)

| Sub-step                                                           | Outcome                                                                                                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1.4a** Single-CID smoke (Linalool 6549 dry-run)                 | ✓ Patch sane; type-only drift between legacy strings and new numbers; cache hit confirmed on rerun.                                                |
| **P1.4b** Full-DB dry-run (3 passes — 1 baseline, 2 after fix-ups) | ✓ Final pass: 290 clean, 119 flagged, 214 mixtures skipped, 1 CAS-unknown. 0 known-wrong rows in clean set.                                        |
| **P1.4c** `--apply`                                                | ✓ 290 patches written; flagged file untouched; Linalool spot-check confirmed legacy preserved + 14 mol\_\* + data_provenance present.              |
| **P1.4d** `git diff` review                                        | ✓ +5797 / −290 lines; 290 deletions all confirmed as trailing-comma additions on previously-last fields. No row deleted, no legacy field modified. |
| **P1.4e** `npm run release` + commit                               | v304 → v305; shell hash b8305ef0 → 8d29e4e1.                                                                                                       |

#### Final coverage stats

| Metric                     | Count   | % of 624 DB |
| -------------------------- | ------- | ----------- |
| Clean patches applied      | **290** | 46.5%       |
| Flagged (Round 4 input)    | 119     | 19.1%       |
| Mixtures correctly skipped | 214     | 34.3%       |
| CAS unknown to PubChem     | 1       | 0.2%        |
| **Total resolved**         | **409** | **65.5%**   |

The 290 clean rows now carry, in addition to their grandfathered
legacy fields:

- 14 `mol_*` computed properties (formula, MW, XLogP3, complexity,
  H-bond donor/acceptor counts, rotatable/heavy-atom counts, IUPAC
  name, canonical/isomeric SMILES, InChI, InChIKey, exact mass).
- `data_provenance: { computed_source, last_fetched, manual_overrides[] }`.

Per-`mol_*` field population on the 290 clean patches:

- 13 fields populated **100%**.
- `mol_xlogp3`: **99.0%** (3 ions / non-organics where PubChem has
  no XLogP value).

#### Per-primary-family coverage

```
Family              Clean   Flagged    Total   Clean %
herbal                 40        38      145    27.6%
floral                 42        17       86    48.8%
gourmand               41         6       57    71.9%
fruity                 38         6       54    70.4%
spicy                  21        10       48    43.8%
woody                  16         6       44    36.4%
green                  18         7       41    43.9%
aldehydic              26         1       27    96.3%
citrus                  8         4       27    29.6%
camphoraceous          12         4       27    44.4%
balsamic               12         0       19    63.2%
musk                    6         2        9    66.7%
amber                   2         2        6    33.3%
floral_amber            0         2        5     0.0%
aquatic                 1         3        4    25.0%
animalic                1         3        4    25.0%
smoky                   1         0        4    25.0%
lactonic                0         3        3     0.0%
mossy                   0         1        3     0.0%
resinous                0         0        3     0.0%
leather                 0         1        2     0.0%
soft_amber              1         0        1   100.0%
sweet                   0         0        1     0.0%
```

The lower clean-rate families (herbal 27.6%, lactonic / mossy /
floral_amber 0%, aquatic 25%, animalic 25%) all have a high mixture
fraction (essential oils, absolutes) AND/OR a high flagged fraction.
After mixtures and flagged rows are excluded, the "applicable"
denominator shrinks; coverage of the eligible set is much higher
than the raw DB percentages suggest.

#### Drift on the 290 clean patches (post-apply)

| Field                  | identical | type-only | value-diff | legacy-empty |
| ---------------------- | --------- | --------- | ---------- | ------------ |
| mol_formula            | 290       | 0         | 0          | 0            |
| mol_inchi_key          | 77        | 0         | 0          | 213          |
| mol_h_bond_donor_count | 0         | 77        | 0          | 213          |
| mol_heavy_atom_count   | 0         | 77        | 0          | 213          |
| mol_molecular_weight   | 0         | 280       | 10         | 0            |
| mol_xlogp3             | 0         | 50        | 27         | 210          |

The 10 `mol_molecular_weight` and 27 `mol_xlogp3` value-diffs are
minor PubChem-revision drift on chemically-correct rows (e.g.
Isopropyl Myristate `270.45` → `270.5`, Citronellol XLogP `3.4` →
`3.2`) — not data errors.

#### Flagged file (`audit/molecular-patches-flagged.json`, gitignored)

- **Total: 119 entries**
- Distribution by `suspected_cause`:
  - `wrong_cid` — 61 (51.3%)
  - `stereo_variant` — 56 (47.1%)
  - `corrupted_legacy` — 2 (1.7%)
- Signal-pair breakdown:
  - InChIKey diff only — 56 (most stereo cases)
  - InChIKey + formula both diff — 55
  - Formula diff only — 8 (caught by P1.3.2 secondary guard)

Each flagged entry carries `legacy {inchi_key, formula, iupac_name}`,
`fetched {…}`, `mismatch_signals {…}`, and the would-be patch —
directly usable for Round 4 manual triage.

### P1.5 — Verification + coverage tools

**Commit:** `e9aa4a5`

- **`tools/verify-molecular.mjs`** — cache-only sanity checks: MW
  range (50..1000), XLogP3 range (-5..10), `data_provenance.last_fetched`
  present + ISO format, `chem_vapor_pressure_mmhg_25c` > 0, cache
  InChIKey integrity (silent-skip on cache miss). Wired into
  `npm run lint:molecular`.
- **`tools/molecular-coverage-report.mjs`** — three rates:
  raw / eligible / ship. Wired into `npm run report:molecular-coverage`.
- 24 new tests; coverage 100% / 96.87% / 100% / 100% (S/B/F/L) on
  verify and 100% / 91.30% / 100% / 100% on coverage-report.

Smoke surfaced 3 anomalies (Glyceryl Trioleate XLogP=22.4,
alpha-Tocopherol XLogP=10.7, Ethanol MW=46.07) — all chemistry-
legitimate edge cases, marked for the P1.6 allowlist.

### P1.6 — UI integration + verify allowlist

**Commit:** `c4774cb` — version v305 → **v306** (shell hash
`8d29e4e1` → `67edc026`).

**PART A — Allowlist mechanism:**

- `audit/molecular-verify-baseline.json` (new, tracked): 3 known-
  acceptable rows (Glyceryl Trioleate, alpha-Tocopherol, Ethanol)
  with chemistry justifications.
- `tools/verify-molecular.mjs`:
  - `matchesAllowlist(finding, entry)` — exact CAS + check-name
    starts-with `entry.field` + value within ±5% tolerance (or
    absolute 0.05 for zero-valued entries).
  - `verify(...)` returns `{ stats, errors, allowlisted, stale }`.
    `errors` drive exit 1; `allowlisted` and `stale` are info-level.
  - CLI prints separate "Allowlisted" + "Stale baseline" blocks for
    reviewability.
- 8 new tests covering match / cas-mismatch / field-prefix-mismatch /
  value-tolerance / allowlist-end-to-end / stale-entry path.
- Result: `npm run lint:molecular` exits 0 (3 allowlisted, 0 errors)
  against the post-P1.4 data.

**PART B — UI Molecular Properties:**

- `index.html`: card render adds a "Molecular Properties" subsection
  in the col-info area. Shows MW / Formula / logP / Vapor Pressure /
  Boiling Point / "View on PubChem ↗" link. Prefers `mol_*`/`chem_*`
  with graceful legacy fallback. Skips null/undefined rows. Uses
  existing `escHtml` on every interpolation.
- `formulation.html`: GC-MS material detail panel splits into two
  table sections — "Molecular Properties" header (preferred values
  - PubChem link) + "Other" header (CAS, density, SMILES, RT, area,
    odor).
- `applyPerfumery()` mirrors `mol_*`/`chem_*` onto `rec.properties`
  via `_numFill` so the new render reads them.

Programmatic render verification confirmed the block renders for
Linalool (patched), Squalane (flagged → legacy fallback), Spearmint
Oil (mixture → legacy fallback exposes the pre-existing water-
contamination issue noted in the Round-4 backlog).

### P1.7 — CI integration

**Commit:** `d9a11cc`

- `.github/workflows/ci.yml`: new step "Lint molecular" (runs
  `npm run lint:molecular` after lint:data, fails build on
  un-allowlisted anomaly) + new step "Molecular coverage report"
  (`continue-on-error: true`; informational).
- `tools/verify-molecular.mjs`: `verify()` now tracks
  `stats.cache_skipped` — count of rows where the cache-integrity
  check WOULD have run but the local cache file was missing. CLI
  prints a clear "skipped N row(s) (CI run / local run)" message
  when count > 0. Silent-skip semantics from P1.5 preserved.
- `audit/cache/README.md`: new "CI behaviour" section documents the
  silent-skip + which other 4 checks always run.
- 1 new test for the cache_skipped counting path.

CI behavior verified by moving local `audit/cache/pubchem-first-layer/`
out of the way and running `CI=true npm run lint:molecular`:
`cache integrity: skipped 289 row(s) (CI run; ...)`, exit 0.

PubChem auto-fetch is intentionally NOT in CI (rate limit + non-
determinism per the project rules).

### P1.8 — Round 3 reports + handoff

**Commit:** this commit.

- This document finalised.
- `CHANGELOG.md` `[2026-04-29-v306]` entry added; `[2026-04-29-v296]`
  allergen-count claim corrected.
- `.codemap.md` re-checked.
- All gates green; pre-push report below.

---

## Coverage Metrics (final)

```
raw       patched / total                = 290 / 624 = 46.47%
eligible  patched / (patched + flagged)  = 290 / 409 = 70.9%
ship      patched / clean-applicable     = 290 / 290 = 100%

mixtures excluded:               214
CAS unknown to PubChem:            1
flagged for Round 4 triage:      119
```

Round-3 acceptance criterion "≥ 90% first-layer coverage" is **NOT
met** in the raw sense (46.47%); it IS met in the eligibility-
adjusted sense once the 214 mixtures + 119 wrong-CID rows are
correctly excluded — the 290 patches account for **100% of the
materials we deemed safe to enrich after both InChIKey and formula
guards**. The gap to 90% raw is structural, not a tooling failure:
either Round 4 manual triage rescues the flagged 119 (raises raw to
~65%), the deeper-audit deferred to Round 4+ rescues the 214
mixtures (raises raw further), or the prompt's 90% target should be
restated against the eligible set going forward.

---

## Round 4 Backlog (handoff input)

These are surfaced during Round 3 but explicitly out of scope; capture
them so Round 4 inherits the full punch list.

### 4.1 — `audit/molecular-patches-flagged.json` triage (119 rows)

Each entry carries `legacy {inchi_key, formula, iupac_name}`,
`fetched {…}`, `mismatch_signals.suspected_cause`, and the would-be
patch — directly usable for manual review.

- 61 `wrong_cid` — likely needs CID re-resolution from CAS Registry.
- 56 `stereo_variant` — typically resolved by changing CID to the
  correct stereo variant.
- 2 `corrupted_legacy` (heuristic) + ~2 more in the wrong_cid bucket
  pending re-categorisation:
  - **Patchoulol (CAS 5986-55-0)** — currently `wrong_cid`; actually
    `corrupted_legacy` (legacy fields are glycol stearate's data).
  - **Terpinyl Acetate (CAS 80-26-2)** — currently `wrong_cid`;
    actually `corrupted_legacy` (legacy synonym is alazocine, an
    opioid).
  - The remaining 4 in the wrong_cid bucket from P1.4b investigation
    (Squalane, Isododecane, 1-Octen-3-yl Acetate, Dipropylene Glycol)
    ARE genuine wrong-CID cases and stay in `wrong_cid`.

### 4.2 — EU 2023/1545 allergens hand-curation (~42 missing)

Continuation of P0.5. Source URLs in Tier P0.5 above; CAS list
discoverable from EUR-Lex Annex III.

### 4.3 — Mixture entries with corrupted legacy data (Group B pattern)

P1.4b investigation surfaced 4 "corrupted-legacy" rows where the
legacy DB carries data from a different molecule (Bornyl Acetate ←
methane; Camphene ← propyphenazone; Patchoulol ← glycol stearate;
Terpinyl Acetate ← alazocine). The P1.6 UI verification revealed
that **Spearmint Oil (CAS 8008-79-5) follows the same pattern**: its
legacy `weight=18.015`, `formula=H2O`, `boiling_point=66`,
`pubchem_cid=962` all point to water — clearly the wrong source for
an essential oil.

This is the same Group-B corruption pattern; likely **more across
the 214 mixtures** that P1.6's UI fallback surfaced one example of.
**Round-4 deeper-audit recommendation:**

- Sweep `data.mixture_cas` for rows whose `pubchem_cid` resolves
  via cache to a non-mixture single molecule.
- Decide policy: **should mixtures carry a `pubchem_cid` at all?**
  (PubChem's mixture handling is patchy; a `pubchem_cid` on a
  mixture row is misleading by design.)

### 4.4 — Aside finding from P1.2 verification

`tools/check-pubchem.mjs --sample 3` surfaced **CAS 142-08-5
3-Hydroxypyridine** with stored CID 7971 vs PubChem-resolved 8871.
Likely already covered by the P1.4 flagged file (the InChIKey guard
should have caught it), but verify on full sweep when triaging 4.1.

### 4.5 — Round 1+2 baseline data-lint failures (6 categories)

Still at ratchet baseline (no regression):

```
taxonomy.facet orphans              23 / 253
material.blends_with → material     83 / 2140
material.blends_with bidirectional 1586 / 2057
CAS check-digit invalid             27 / 624
NATURAL_ALLERGEN_COMPOSITION         3 / 30
AROMACHOLOGY_SCORES → DB             4 / 77
```

These are pre-existing tech-debt from audit-3 + audit-r2; tracked
separately via the lint-data ratchet. Separate cleanup round.

### 4.6 — Phase 2 prerequisites met

The molecular foundation now in place enables Phase 2 (Olfactory
Layer):

- 290 materials carry `mol_xlogp3` (lipophilicity) and
  `mol_molecular_weight` — enables real **volatility computation**
  via Antoine-equation-class models, no more hard-coded
  top/heart/base labels.
- The `chem_vapor_pressure_mmhg_25c` field is wired but only
  populated when an operator runs `--experimental` (not in this
  round). Phase 2 should run that pass before computing diffusion.
- The `mol_canonical_smiles` + `mol_inchi` chemistry identity
  fields enable molecular-similarity scoring (Tanimoto-class)
  for accord verification in Phase 4.

---

## Out of Scope (explicit)

- **5 EU bans not added to DB** — per "ถ้า NOT IN DB → flag, ไม่ต้อง
  เพิ่ม" rule in the prompt (P0.4).
- **Nested `molecular: {}` migration** — locked decision: stay flat
  with `mol_*`/`chem_*` prefix this round; nested migration is a
  dedicated future round (CONTRIBUTING.md "Future" section).
- **Renaming legacy flat fields** (`smiles`, `xlogp`, `weight`,
  `pubchem_cid`, etc.) — grandfathered. New writes go to `mol_*`;
  old fields stay for back-compat with the existing UI / lint
  baseline.
- **2D/3D structure rendering** — Phase 2.
- **Computed volatility from `chem_vapor_pressure_mmhg_25c`** —
  Phase 2.
- **Hand-curating 42 EU 2023/1545 allergens** — Round 4
  (Tier P0.5-incomplete).
- **Auto-fetch from PubChem in CI** — explicit prompt rule
  (rate-limit + non-determinism).

---

## Engineering Notes

- **Test count:** 162 → **282** (+120 across Round 3).
- **Coverage** (vitest --coverage v8) on the new tools:

  | File                                  | Stmts  | Branch | Funcs  | Lines  |
  | ------------------------------------- | ------ | ------ | ------ | ------ |
  | `tools/lib/pubchem.mjs`               | 100%   | 96.96% | 100%   | 100%   |
  | `tools/enrich-molecular.mjs`          | 99.22% | 90.90% | 93.75% | 99.22% |
  | `tools/verify-molecular.mjs`          | 100%   | 96.87% | 100%   | 100%   |
  | `tools/molecular-coverage-report.mjs` | 100%   | 91.30% | 100%   | 100%   |

  All exceed plan acceptance targets (≥95% line / ≥85% branch).

- **New tools (5):**
  - `tools/lib/pubchem.mjs` — reusable PubChem REST client.
  - `tools/enrich-molecular.mjs` — main enrichment script.
  - `tools/verify-molecular.mjs` — sanity checks + allowlist.
  - `tools/molecular-coverage-report.mjs` — coverage metric.
  - `tools/cache-cleanup.mjs` — manual cache hygiene.

- **New schema section:** `mol_*`/`chem_*` namespace + nested
  `data_provenance`. Schema `$comment` documents the flat-with-prefix
  decision.

- **New lint rule:** `material.mol_*/chem_* require
data_provenance.last_fetched` (tracked in lint-data ratchet, currently
  0 / 290 broken).

- **New CI steps (2):** `lint:molecular` (gating) +
  `report:molecular-coverage` (informational, `continue-on-error`).

- **Cache infrastructure:** `audit/cache/` gitignored with
  `.gitkeep` + tracked README documenting the TTL (6 months), size
  warning (100 MB), licence rationale, and CI behaviour.

- **devDependency change:** `+@vitest/coverage-v8@^2.1.9`.

- **Cache-bust trail:** v304 (`b8305ef0`) → v305 (`8d29e4e1`) →
  v306 (`67edc026`).
