# Round 3 Audit Report

**Branch:** `claude/r3-molecular-foundation-2026-05-02`
**Date:** 2026-05-02
**Scope:** Tier P0 cleanup (Round 2 leftovers) + Phase 1 molecular foundation.

This document records Round-3 findings and outcomes. Sections beyond
Phase 1.4 are populated as the round progresses; the outline mirrors
the prompt's Tier P0 + Phase 1 structure (`scripts/r3-prompt.md`,
plan file `cuddly-hatching-wilkes.md`).

---

## Pre-flight

- Branch `claude/r3-molecular-foundation-2026-05-02` created from `main`
  at `7f79b09`.
- Stale branch `claude/rebuild-search-categorization-MLSJ1` confirmed
  empty (zero commits ahead of main). Local delete OK; remote delete
  blocked by HTTP 403 (sandbox limitation, same as Round 2 cleanup) —
  **manual delete via GitHub UI required**.
- All gates green at start: `npm test` 162 → grew to **249** by P1.3.2;
  `npm run lint` clean; `lint-data` ratchet `no regression`.

## Tier P0 — TBD

Sections below to be filled in during P1.8 (round wrap-up):

- P0.1 perfumery_data.backup.js — already absent (Round 2 cleared)
- P0.2 CONTRIBUTING.md — already aligned + added "Future: nested
  molecular migration" subsection in P1.1
- P0.3 CHANGELOG.md v296 correction — TBD
- P0.4 EU-banned 5 materials — none in DB; documented; no DB add
- P0.5 EU 2023/1545 allergens 50→80+ — flagged `Tier P0.5-incomplete`,
  defer to Round 4

## Phase 1.1 — Schema + lint rule + provenance shape

Commit: `da3d2a4` — "r3 P1.1 — molecular schema + lint rule + provenance shape"

- Added 14 `mol_*` (computed) + 10 `chem_*` (experimental) optional
  schema properties + nested `data_provenance` object.
- New cross-ref rule in `tools/lint-data.mjs`:
  `material.mol_*/chem_* require data_provenance.last_fetched`.
  Initial baseline 0/0 (additive).
- CONTRIBUTING.md: "Future: nested molecular migration" section.
- `tests/material-shape.test.mjs`: lock `buildEnriched` shape stability.

## Phase 1.2 — Reusable PubChem client

Commit: `f353d14` — "r3 P1.2 — reusable PubChem client (tools/lib/pubchem.mjs)"

- Extracted throttler / retry / CAS→CID resolver from
  `tools/check-pubchem.mjs` into `tools/lib/pubchem.mjs`.
- Added `pubchemBatchProperty`, `pubchemExperimentalView`,
  `cacheRead/Write/Path`.
- 27 new tests cover module constants, fetch retries (200/404/503/429/
  malformed), CID resolver, batch property, experimental view, cache I/O.
- `@vitest/coverage-v8` added as devDep.
- Coverage on `tools/lib/pubchem.mjs`: 100/96.96/100/100% (S/B/F/L).

## Phase 1.3 — `tools/enrich-molecular.mjs` (dry-run capable)

Commit: `c81b966` — "r3 P1.3 — tools/enrich-molecular.mjs"

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

### P1.3.1 fix-up — SMILES rename / mixture filter / CID-mismatch guard

Commit: `b8e2fbb`

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

### P1.3.2 fix-up — formula-mismatch guard + suspected_cause heuristic

Commit: `92f28d4`

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

## Phase 1.4 — Apply enrichment to `data/materials.json`

Commit: TBD (this commit)

### Sub-step protocol (per amendment #2)

| Sub-step                                                           | Outcome                                                                                                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1.4a** Single-CID smoke (Linalool 6549 dry-run)                 | ✓ Patch sane; type-only drift between legacy strings and new numbers; cache hit confirmed on rerun.                                                |
| **P1.4b** Full-DB dry-run (3 passes — 1 baseline, 2 after fix-ups) | ✓ Final pass: 290 clean, 119 flagged, 214 mixtures skipped, 1 CAS-unknown. 0 known-wrong rows in clean set.                                        |
| **P1.4c** `--apply`                                                | ✓ 290 patches written; flagged file untouched; Linalool spot-check confirmed legacy preserved + 14 mol\_\* + data_provenance present.              |
| **P1.4d** `git diff` review                                        | ✓ +5797 / −290 lines; 290 deletions all confirmed as trailing-comma additions on previously-last fields. No row deleted, no legacy field modified. |
| **P1.4e** `npm run release` + commit                               | This commit. Version v304 → v305; shell hash b8305ef0 → 8d29e4e1.                                                                                  |

### Final coverage stats

| Metric                     | Count   | % of 624 DB |
| -------------------------- | ------- | ----------- |
| Clean patches applied      | **290** | 46.5%       |
| Flagged (Round 4 input)    | 119     | 19.1%       |
| Mixtures correctly skipped | 214     | 34.3%       |
| CAS unknown to PubChem     | 1       | 0.2%        |
| **Total resolved**         | **409** | **65.5%**   |

The 290 clean rows now carry, in addition to their grandfathered legacy
fields:

- 14 `mol_*` computed properties (formula, MW, XLogP3, complexity,
  H-bond donor/acceptor counts, rotatable/heavy-atom counts, IUPAC
  name, canonical/isomeric SMILES, InChI, InChIKey, exact mass).
- `data_provenance: { computed_source, last_fetched, manual_overrides[] }`.

Per-`mol_*` field population on the 290 clean patches:

- `mol_formula`, `mol_molecular_weight`, `mol_complexity`,
  `mol_h_bond_*`, `mol_rotatable_bond_count`, `mol_heavy_atom_count`,
  `mol_iupac_name`, `mol_canonical_smiles`, `mol_isomeric_smiles`,
  `mol_inchi`, `mol_inchi_key`, `mol_exact_mass`: **100%**.
- `mol_xlogp3`: **99.0%** (3 ions / non-organics where PubChem has
  no XLogP value).

### Per-primary-family coverage

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
After mixtures and flagged rows are excluded, the "applicable" denominator
shrinks; coverage of the eligible set is much higher than the raw DB
percentages suggest.

### Drift on the 290 clean patches (post-apply)

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
Isopropyl Myristate `270.45` → `270.5`, Citronellol XLogP `3.4` → `3.2`)
— not data errors.

### Flagged file (`audit/molecular-patches-flagged.json`, gitignored)

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
`fetched {…}`, `mismatch_signals {…}`, and the would-be patch — directly
usable for Round 4 manual triage.

**Round 4 known re-categorisations:**

- Patchoulol (CAS 5986-55-0) — currently `wrong_cid`; actually
  `corrupted_legacy` (legacy fields are glycol stearate's data).
- Terpinyl Acetate (CAS 80-26-2) — currently `wrong_cid`; actually
  `corrupted_legacy` (legacy synonym is alazocine, an opioid).
- The other 4 in the wrong_cid bucket from P1.4b investigation
  (Squalane, Isododecane, 1-Octen-3-yl Acetate, Dipropylene Glycol)
  ARE genuine wrong-CID cases and stay in `wrong_cid`.

### Verification

- `npm run release -- --check` — single version 2026-04-29-v305,
  shell v3 hash `8d29e4e1`.
- `npm run lint:data` — schema validation pass; new rule
  `molecular fields require provenance` reports `0 / 290`; ratchet
  `no regression vs baseline`.
- `npm test` — 249/249 pass.
- `npm run lint` / `format:check` / `codemap:check` — all green.

## Phase 1.5 — Verification + coverage tools

Commit: TBD (this commit)

### `tools/verify-molecular.mjs`

Cache-only sanity checks — no network calls. Exits 0 on clean data,
1 if any anomaly is found. Output: stdout summary + audit/molecular-
verify.json (gitignored alongside the other audit/molecular-\*.json).

Checks (each per-material that carries any `mol_*` field):

| #   | Check                          | Rule                                                                                                      |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | `mol_molecular_weight`         | required + 50..1000 g/mol                                                                                 |
| 2   | `mol_xlogp3`                   | (when present) -5..10                                                                                     |
| 3   | `data_provenance.last_fetched` | required + ISO date `YYYY-MM-DD`                                                                          |
| 4   | `chem_vapor_pressure_mmhg_25c` | (when present) > 0                                                                                        |
| 5   | cache InChIKey integrity       | `audit/cache/pubchem-first-layer/<cid>.json` InChIKey == `mol_inchi_key`. Cache-miss is silently skipped. |

Wired into `npm run lint:molecular`.

### `tools/molecular-coverage-report.mjs`

Three coverage rates for different audiences:

```
raw       patched / total                = % completeness incl. mixtures
eligible  patched / (patched + flagged)  = % of attempted enrichments succeeded
ship      patched / clean-applicable     = round-3 ship rate (100% by construction)
```

Plus per-primary-family breakdown. Output: stdout + `audit/molecular-
coverage.json`. Wired into `npm run report:molecular-coverage`.

### Smoke runs against real data (post-P1.4 apply)

**`npm run lint:molecular`** (verbatim, exit code 1):

```
═══ Molecular verification (offline; cache-only) ═══
  materials in DB:       624
  with mol_* fields:     290
  anomalies:             3

  By check category:
    mol_xlogp3_range                         2
    mol_molecular_weight_range               1

  First 20 anomalies:
    [mol_xlogp3_range] 122-32-7 9-Octadecenoic Acid (9z)-, 1,1',1''-(1,2,3-Propanetriyl) Ester:
                       value=22.4 expected=-5..10
    [mol_xlogp3_range] 59-02-9 alpha-Tocopherol: value=10.7 expected=-5..10
    [mol_molecular_weight_range] 64-17-5 Ethanol: value=46.07 expected=50..1000
```

**Anomaly assessment** — all 3 are LEGITIMATE edge cases, NOT data
errors:

1. **Glyceryl Trioleate (CAS 122-32-7) XLogP3=22.4** — A triglyceride
   emollient (C57H104O6, MW 885). Extreme lipophilicity is real for a
   triester of oleic acid. PubChem value matches.
2. **alpha-Tocopherol (CAS 59-02-9) XLogP3=10.7** — Vitamin E. A
   chromanol with a 16-carbon phytyl tail; XLogP3 just above the
   heuristic ceiling. PubChem value matches.
3. **Ethanol (CAS 64-17-5) MW=46.07** — Common solvent. Below the 50
   g/mol heuristic floor. Actually correct for ethanol.

Action: keep the ranges as-is (they're meant to flag suspicious values
for review), and document these 3 as **known-acceptable**. Round 4 may
add a baseline-allowlist file akin to the lint-data ratchet
(`audit/lint-data-baseline.json`) so CI doesn't fail on these.

**`npm run report:molecular-coverage`** (verbatim, exit code 0):

```
═══ Molecular coverage report ═══
  total materials in DB:        624
  mixtures (excluded):          214
  patched (clean, mol_* set):   290
  flagged (Round 4 triage):     119
  eligible attempted:           409

  Coverage rates:
    raw       patched / total                = 46.47%
    eligible  patched / (patched + flagged)  = 70.9%
    ship      patched / clean-applicable     = 100%
```

Per-family breakdown (selected high-coverage families):

```
balsamic       12 / 19 eligible    100% patched
soft_amber     1 / 1 eligible      100% patched
aldehydic      26 / 27 eligible    96.3% patched
gourmand       41 / 47 eligible    87.2% patched
fruity         38 / 44 eligible    86.4% patched
floral         42 / 59 eligible    71.2% patched
camphoraceous  12 / 16 eligible    75.0% patched
musk            6 / 8 eligible     75.0% patched
green          18 / 25 eligible    72.0% patched
woody          16 / 23 eligible    69.6% patched
spicy          21 / 31 eligible    67.7% patched
```

Lower-coverage families (lactonic / mossy / floral_amber / leather)
have all-or-most of their materials in the flagged set or in
mixture_cas; coverage will improve materially once Round 4 triages
the flagged file.

### Tests

`tests/verify-molecular.test.mjs` (24 cases) covers:

- every check rule with passing + failing fixtures
- batch verify(db, cacheDir) returns correct stats + findings
- coverage-report builder: counts, three rate formulas (raw / eligible /
  ship), per-family breakdown, missing-flagged-file path,
  empty-DB safety, unclassified-material path

Coverage on the two new tools (vitest --coverage v8):

| File                                  | Stmts | Branch | Funcs | Lines |
| ------------------------------------- | ----- | ------ | ----- | ----- |
| `tools/verify-molecular.mjs`          | 100%  | 96.87% | 100%  | 100%  |
| `tools/molecular-coverage-report.mjs` | 100%  | 91.30% | 100%  | 100%  |

Both well above the ≥95%/85% targets.

## Phase 1.6 — UI integration (basic)

(Pending P1.6 commit.)

## Phase 1.7 — CI integration

(Pending P1.7 commit.)

## Phase 1.8 — Round 3 reports + handoff

(Pending P1.8 commit. This document will be finalised here.)

---

## Round 4 backlog (handoff)

These are surfaced during Round 3 but explicitly out of scope; capture
them so Round 4 inherits the full punch list.

1. **`audit/molecular-patches-flagged.json` triage** — 119 rows.
   Per-row payload includes `suspected_cause`; manual review chooses
   correct CID for `wrong_cid` and rewrites legacy formula/iupac/synonyms
   for `corrupted_legacy`.
2. **`Tier P0.5-incomplete`** — EU 2023/1545 allergen list expansion
   (~42 missing). Hand-curate from EUR-Lex.
3. **CAS-CID mismatch follow-up** — `tools/check-pubchem.mjs --sample 3`
   surfaced 142-08-5 3-Hydroxypyridine (DB 7971 vs PubChem 8871) during
   P1.2 verification. Likely already covered by the flagged file but
   verify on full sweep.
4. **`corrupted_legacy` heuristic gaps** — Patchoulol + Terpinyl Acetate
   currently mis-classified as `wrong_cid`. Either expand the marker
   list (stearate, alazocine, antipyrine) or rely on manual review.
