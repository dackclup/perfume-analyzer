> **Historical document.** This coherence audit was conducted
> 2026-05-01 by an earlier Claude Code session. It became the
> planning document that drove Round 1, Round 2, and Round 3
> systemic work.
>
> As of 2026-05-03 (post-Round-3.6):
> - 17/30 findings: addressed in Round 1-3 (see audit/r3-report.md)
> - 4/30 findings: tracked in tools/lint-data.mjs ratchet baseline
> - 6/30 findings: open, scoped for Round 4+ (see audit/r3.5-investigation.md)
> - 3/30 findings: historical commentary
>
> Preserved here as audit-trail provenance. Do not edit the body
> below — modifications belong in successor audit reports.

---

# Perfume Analyzer — Coherence Audit

| Field | Value |
|---|---|
| Date          | 2026-05-01 |
| Branch        | `audit/coherence-2026-05-01` |
| Base commit   | `2200c00a6aadaf67a89265508479a32cb91ed7df` |
| Repo          | dackclup/perfume-analyzer |
| DB rows       | 623 materials · 1066 trade names · 214 mixtures |
| LOC           | index.html 8397 · formulation.html 7024 · engine 4018 · data 1790 · taxonomy 49 · sw 153 |
| `npm test`    | 125/125 passed (24 utils + 101 data-integrity) |
| `npm run lint`| clean |
| `npm run codemap` | regenerated (no diff vs HEAD) |

This audit is **read-only** — no source files were modified. All findings, scripts, and analysis live under `audit/`.

---

## Executive Summary

The user's symptom — _"updates don't merge, data missing, things don't match"_ — is real and reproducible. Investigation across 8 phases (C1–C8) finds **30 individual coherence issues collapsing to 4 root causes**:

1. **No single source of truth for version numbers.** The same release version lives in 9 places per HTML page; SW cache version is on an independent track. `CONTRIBUTING.md` documents three different versioning rules and contradicts the actual code. Effect: contributors miss bumps, browsers silently serve stale shells.
2. **No schema validation on data files.** 13 broken `trade_names` targets, 13 unknown family tokens, 24 orphan facets, 27 CAS check-digit failures, 1 IFRA cap pointing to a non-existent material — all because nothing checks. When the analyzer's `classifyRegulatory` regex was hardcoded with the EU 26 allergen list, no test caught the eventual drift from the canonical map.
3. **`index.html` and `formulation.html` are two SPAs that copy-paste helpers and silently diverge.** `esc()` vs `escHtml()` (different apostrophe handling). `addFromDB` strips classification fields that the analyzer-handoff path preserves. `enriched` object built three different ways inside the formulator alone. Allergen list duplicated in two places.
4. **20 manual rules in CONTRIBUTING.md, only 1 enforced by code.** "Bump version everywhere", "wrap inits in try/catch", "escape user input", "rename family → update 7 files", "after editing structurally run codemap" — all rely on contributor memory. The `git log` shows 12 commits in the last month tagged `(audit #N)`, each fixing a class of bug that no automation prevents from re-occurring.

Cross-ref linter found **1761 broken refs total**; 1586 are uni-directional `blends_with` (curation gap, mitigated by runtime mirror) and **175 are structural failures** that affect runtime (broken trade-name targets, orphan IFRA caps, unknown classification tokens). Built-in `tools/lint-blends.mjs` finds ~80% of the `blends_with` issues but **none** of the other 175.

The fastest disproportionate win is **R2 (data schema validation in CI)** — eliminates ~80% of findings on next PR with ~3 days of work. R1 (single-version-source) ships in half a day. R3 (shared module) is foundational for R4 (kill manual rules) and unlocks the long-term cleanup.

**No source code was modified during this audit.** Every observation has a verbatim file:line cite. Every fix proposal has both a point patch and a systemic answer to "can this bug class happen again after the fix?"

---

## Action Plan

### Tier 0 — Quick wins (≤ 1 day total, can land tomorrow)

| Action | Finding | Effort |
|---|---|---|
| `git rm perfumery_data.backup.js` + remove line from `eslint.config.mjs` | C4.1 | 5 min |
| Update `CONTRIBUTING.md:62-71` to one current versioning paragraph | C1.3 | 10 min |
| Replace formulator's empty `addFromDB` classification with `entry.classification` (3 sites) | C3.2 / C3.3 | 1 hour |
| Build analyzer's allergen-name regex from `EU_ALLERGENS_CURRENT` keys | C7.1 | 1 hour |
| Migrate 13 `secondaryFamilies → facets` for `powdery / ozonic / soft_floral` tokens | C2.4 | 1 hour |
| Fix 13 `trade_names` to use CAS targets, not name targets | C2.1 (point) | 1 hour |
| Decide on `2442-10-6`: add DB row or remove IFRA cap | C2.8 | 30 min |
| Add `npm run codemap` + diff-check to CI | C6 rule #5 | 30 min |

### Tier 1 — Foundational (1 sprint)

| Action | Findings collapsed | Effort |
|---|---|---|
| **R1 — `version.json` + `npm run release` script** | C1.1, C1.2, C1.3, C1.4, C5.1 (storage version part), C6 rule #1, "bump" step in C7 A/B/C/D | M (½ day) |
| **R2 — JSON Schema for `data/materials.json` and `formulation_data.js` cross-tables, CI hard-gated** | C2.1, C2.4, C2.6, C2.7, C2.8, C5.2, C6 rules 10/19/20, C7.1 secondary surface | L (3 days) |
| Promote `audit/scripts/check-cross-refs.mjs` into `tools/lint-data.mjs`; CI hard-gated on **deltas** vs main baseline | C2.2 (ratchet), C2.3, C2.5, C2.7 | M (1 day) |

### Tier 2 — Code-sharing (1 sprint)

| Action | Findings collapsed | Effort |
|---|---|---|
| **R3 — `lib/dom-utils.mjs`** (`escHtml`, `debounce`, `safeInit`); both HTMLs `import` | C3.1, C3.4, C6 rule #4 | M |
| **R3 — `lib/material-shape.mjs`** (`buildEnriched`, `getMaterial`); replace 4 inline copies | C3.2, C3.3, C3.5 | M |
| **R3 — `lib/storage.mjs`** (`lsv()` versioned wrapper); migrate 10 keys | C5.1, C5.2, C5.3, C6 rule #13 | M |

### Tier 3 — Manual-rule automation (1 sprint)

| Action | Findings collapsed | Effort |
|---|---|---|
| **R4 — `.husky/pre-commit`** runs lint + test + lint-data + version-drift + codemap-fresh | C6.1 | S |
| `scripts/add-material.mjs --interactive` covers IFRA / mixture / blends-reverse-ref steps | C7 A, C6 rule #18 | M |
| `scripts/rename-family.mjs` covers all 7 surfaces of Scenario C | C7 C, C6 rule #18 | M |
| `scripts/add-allergen.mjs` covers Scenario D | C7 D, C6 rule #20 | M |
| SW `CACHE_VERSION` derived from `SHELL_ASSETS` content hash (auto-bump) | C1.2, C6 rule #1 (SW half) | S |
| `lib/storage.mjs` migration runner — load → schema check → migrate or reset | C5.1, C5.2, C7.3 | M |

### Tier 4 — Curation cleanup (gradual)

| Action | Findings | Approach |
|---|---|---|
| Backfill 1586 non-bidirectional `blends_with` | C2.2 | `scripts/blends-mirror.mjs --apply` once, then CI ratchet enforces no growth |
| Migrate 7 orphan `SUB_FAMILIES` (claim by ≥1 material) | C2.6 | one-time migration; ratchet on |
| Resolve 83 `blends_with` labels that don't resolve | C2.3 | curate + Greek-letter normaliser in shared lib |
| Add `data.meta = {version, row_count}` to materials.json + assert match in bootstrap | C1.4 | part of R1 release script |

### Conversion metric

For every audit finding fixed, two PRs:
1. The fix itself.
2. The CI rule that would have caught it.

Track in a future `audit/coverage.md`: "Audit-N landed M findings → produced K linter rules."

---

## Recent commit history (top 20)

```
2200c00 test+data: SMILES + heavy-atom + longevity-consistency regression spec (audit-3 #wrap)
b5d672b fix(i18n): TH coverage for filter axes + search hint + empty states + footer (audit-3 #6)
5c08ac4 fix(ui): % clamp toast + search exact-match boost + filter-content grid (audit-3 #5/#11/#12)
82b51a3 fix(engine): longevity floor applied to phase.end so Compat + Evaporation tabs match (audit-3 #7)
4e80d68 fix(data): correct CIDs for Hedione/Ambroxan/Cashmeran/Lyral; Galaxolide → soft_amber; allergen-negation regex (audit-3 critical)
2cdace5 fix(data): Hedione CID + Iso E Super type + Vanillin pollution + Lyral (audit-2: 2 critical) (#463)
8b06c2c fix(compliance): add 7-pair ester→alcohol hydrolysis branch to allergen aggregation (audit #11)
43b0254 fix(engine): perception-weighted longevity floor (audit #7)
9eccdda fix(analyzer): collapse empty wrappers in expanded card body (audit #5)
0bd61fd fix(ui): tighten filter grid + reduce mat-name min-width to 40px (audit #2)
29a26ff fix(analyzer): index user-added PubChem results into FILTER_CACHE so filters apply (audit #3)
718869d fix(analyzer): suppress duplicate toast on session-restored results (audit #1)
e482329 fix(analyzer): disambiguate Heart role from note tier; add NOTE pyramid badge (audit #4)
ceeeeee fix(formulation): wire Thai i18n keys for analysis-card headings (audit #12)
df57b40 fix(formulation): rename INCI Label heading to INCI Allergen Snippet with caption (audit #10)
a027d3b fix(formulation): clarify Total label by replacing 'Fragrance in Product' with 'fragrance dose' (audit #9)
49424c4 fix(analyzer): open Formulator in same tab instead of new tab (audit #6)
e625040 fix(formulation): prevent .mat-name from collapsing to single letter when warning badge present (audit #8)
8c722be Phase 3 polish — Esc-focus + cache-bust + codemap (v291) (#461)
9ff078f Phase 2 refactor — pagination, defensive engine, sessionStorage handoff (v290) (#460)
```

---

## C1 — Version & Cache-Bust Coherence

### Inventory: every active version string

```
formulation.html:1121  <script src="taxonomy.js?v=2026-04-29-v293">
formulation.html:1122  <script src="formulation_data.js?v=2026-04-29-v293">
formulation.html:1123  <script src="formulation_engine.js?v=2026-04-29-v293">
formulation.html:1145    const DATA_VERSION = '2026-04-29-v293';     ← boot-script const
formulation.html:1188    window.DATA_VERSION   = DATA_VERSION;
index.html:1217        <script src="taxonomy.js?v=2026-04-29-v293">
index.html:1242          const DATA_VERSION = '2026-04-29-v293';     ← boot-script const
index.html:1294          window.DATA_VERSION = DATA_VERSION;
index.html:1487        const DATA_VERSION = window.DATA_VERSION ||    ← inert app-init const (FALLBACK)
                       "2026-04-29-v293";
sw.js:25               const CACHE_VERSION = 'perfume-shell-v3';      ← independent v3
```

Active distinct strings: **`2026-04-29-v293`** (1 string, all-synced). ✓ at this snapshot.

### [C1.1] Per-HTML-file version is duplicated 4× — manual sync hazard
- **Type:** manual-sync-point
- **Severity:** High
- **Locations:** `index.html:1217, 1242, 1487, 6763` · `formulation.html:1121-1123, 1145`
- **Evidence:** Every release requires editing **5 occurrences in `index.html` + 4 in `formulation.html` = 9 edits per release**. The current code uses a `sed -i 's/v292/v293/g'` pattern (visible in earlier commit messages: `Cache-bust v292 → v293` followed by edit count of 7 on git diff `--stat`). One missed line ⇒ HTML loads stale taxonomy/data while DATA_VERSION reports new ⇒ silent staleness invisible in any test.
- **Why this happens:** Single source of truth missing — the version is declarative metadata copied into runtime constants and into URL query strings instead of being read once and propagated.
- **Fix (point):** Existing release script in `tools/` can wrap the sed call with a verification step: re-grep + assert single distinct version string; fail if >1.
- **Fix (systemic):** Introduce `version.json` at repo root: `{ "data": "2026-04-29-v293", "shell": "v3" }`. Add `npm run release` (new script) that:
  1. Reads `version.json`, increments per CLI arg
  2. `sed`-replaces every occurrence in HTML/sw.js
  3. Runs `npm test && npm run lint`
  4. Re-greps repo for stray version strings, asserts only the new one remains
  5. Stages files, prints the would-be commit
- **Effort:** S (½ day)

### [C1.2] sw.js `CACHE_VERSION` independent from `DATA_VERSION` — 4 lifetime commits vs 251 HTML commits
- **Type:** version-drift
- **Severity:** Medium
- **Locations:** `sw.js:25` (`perfume-shell-v3`) vs `index.html:1242 / formulation.html:1145` (`2026-04-29-v293`)
- **Evidence:**
  ```
  $ git log --oneline --all -- sw.js
  0793350 SW: exact-version cache → network → any-cache fallback (v287)
  0f0c840 Audit fixes after async-fetch refactor (v285)
  2566711 Materials DB → JSON + async boot (v284)
  48a4db6 ESLint + Prettier + PWA shell (v180)

  $ git log --oneline --since='3 months ago' -- index.html | wc -l
  251
  $ git log --oneline --since='3 months ago' -- sw.js | wc -l
  4
  ```
  In 251 HTML commits the SW cache was rotated only 4 times. The current strategy *deliberately* does not require SW bumps for every HTML change (HTML is network-first, JS/JSON are cache-bust-keyed) — but the two version trains use **completely different syntax** (`2026-04-29-vNNN` vs `vN`), so a contributor must memorise which to bump when.
- **Why this happens:** Coupling between data version and cache infrastructure was never made explicit; comments in `sw.js:14` reference `<DATA_VERSION>` but the constant `CACHE_VERSION` doesn't include it.
- **Fix (point):** Add a one-line comment header in `sw.js` summarising the bump matrix: "Bump `CACHE_VERSION` only when SHELL_ASSETS changes — bumping `DATA_VERSION` alone is enough for content-only releases."
- **Fix (systemic):**
  - Drive `CACHE_VERSION` from a content hash of `SHELL_ASSETS` (compute at build time or via `tools/sw-checksum.mjs` → bake into `sw.js`).
  - The shell name becomes `perfume-shell-<sha8>`; rotation is automatic on shell change, no rotation on data-only release.
  - Removes the human decision "do I need to bump SW too?" from every release.
- **Effort:** M (1 day to add the hash-baking script + tests)

### [C1.3] CONTRIBUTING.md documents a versioning scheme that is no longer used
- **Type:** documentation-drift
- **Severity:** Low (Info)
- **Locations:** `CONTRIBUTING.md:64-66`
- **Evidence:**
  ```
  CONTRIBUTING.md:64:- Bump `index.html`'s `v=2026-04-25-rebuild-vNNN` on every change.
  CONTRIBUTING.md:65:  `index.html`'s `DATA_VERSION` const must match (also `vNNN`).
  CONTRIBUTING.md:66:- Bump `formulation.html`'s `?v=2026-04-29-...` on every change.
  ```
  Reality: both pages now use `2026-04-29-vNNN` (one shared sequence). The doc still describes the old "two-train" approach (`rebuild-vNNN` for index vs `2026-04-29-...` for formulation). A new contributor reading docs might split versions wrongly.
- **Fix (point):** Update CONTRIBUTING.md to describe the unified `2026-04-29-vNNN` scheme.
- **Fix (systemic):** Once `version.json` exists (C1.1 systemic fix), the doc reduces to one line: "`npm run release [patch|minor|major]` — that's it." No more rules to forget.
- **Effort:** S (15 min for doc; subsumed by C1.1 systemic for permanent fix)

### [C1.4] Data file `data/materials.json` shipped to disk does NOT include the version inline
- **Type:** version-drift
- **Severity:** Low
- **Locations:** `data/materials.json` (no top-level version field) vs `index.html:1242` (`DATA_VERSION` is page-scoped)
- **Evidence:** `data/materials.json` is loaded as raw JSON; nothing inside the file declares which release it belongs to. If a partial deploy serves the new HTML (with `?v=v293`) but a CDN cache returns the old JSON body, the browser has no way to detect the mismatch — it just renders the wrong snapshot count.
- **Why this happens:** The cache-bust query is on the URL, but the response body has no self-identification.
- **Fix (point):** Add `data.meta = { version: "2026-04-29-v293", row_count: 623 }` to `data/materials.json`. Bootstrap asserts `data.meta.version === DATA_VERSION` after fetch; on mismatch, console.warn + retry with `?cache=reload`.
- **Fix (systemic):** As part of the release flow (C1.1) `version.json` writer also rewrites `data.meta.version` and the row count. Bootstrap's existing integrity-check stanza (added in Phase 1) gains one more assertion.
- **Effort:** S (½ day)

## C2 — Cross-File Reference Integrity

Built `audit/scripts/check-cross-refs.mjs` (read-only — vm-loads taxonomy.js + formulation_data.js, scans materials.json) and ran. Full breakdown landed in `audit/cross-ref-report.json`.

### Summary table

| Source → Target | Total | Broken |
|---|---|---|
| `material.primaryFamilies → taxonomy` | 619 | 0 |
| `material.secondaryFamilies → taxonomy` | 196 | **13** |
| `material.material_type → TYPE_VALUES` | 0 | 0 |
| `material.functions → FUNCTION_VALUES` | 0 | 0 |
| `material.uses → USE_VALUES` | 0 | 0 |
| `taxonomy.SUB_FAMILIES orphans (no material claims)` | 14 | **7** |
| `taxonomy.FACET_GROUPS orphans` | 253 | **24** |
| `IFRA_51_LIMITS cas → material` | 12 | **1** |
| `material.blends_with → resolvable` | 2140 | **83** |
| `material.blends_with bidirectional` | 2057 | **1586** (77%) |
| `trade_names → material exists by CAS` | 1066 | **13** |
| `mixture_cas → material exists` | 214 | 0 |
| `mixture_cas with single-molecule formula (audit-3 fix verified)` | 214 | 0 |
| `duplicate CAS in DB` | 623 | 0 |
| `CAS check-digit invalid` | 623 | **27** |
| `NATURAL_ALLERGEN_COMPOSITION constituent → EU_ALLERGENS list` | 30 | **3** |
| `ESTER_HYDROLYSIS pair integrity` | 7 | 0 |
| `AROMACHOLOGY_SCORES → DB` | 77 | **4** |

Built-in `tools/lint-blends.mjs` reports `unresolved=81 reciprocity=1513`. Our checker found **2 more broken (83 vs 81)** and **73 more non-bidirectional (1586 vs 1513)** because we resolve via canonical-name + synonym + trade-name (matches runtime), while lint-blends has its own narrower path.

### [C2.1] `trade_names` entries store NAMES instead of CAS — 13 entries
- **Type:** cross-ref-broken
- **Severity:** High (runtime falls back through `NAME_TO_CAS` so users don't notice today)
- **Locations:** `data/materials.json` `trade_names` keys with name-shaped target
- **Evidence:**
  ```
  alcohol denat                → ethanol               (expected CAS like 64-17-5)
  butylated hydroxytoluene     → bht
  d-alpha-tocopherol           → alpha-tocopherol
  dep                          → diethyl phthalate
  dpg                          → dipropylene glycol
  ethyl alcohol                → ethanol
  glyceryl triacetate          → triacetin
  ipm                          → isopropyl myristate
  pg                           → propylene glycol
  phenoxetol                   → phenoxyethanol
  tec                          → triethyl citrate
  tocopherol                   → alpha-tocopherol
  vitamin e                    → alpha-tocopherol
  ```
  Schema expectation (per `index.html:1709`): `if (TRADES[lk]) { const cas = TRADES[lk]; if (DB[cas]) return ...}`. The 13 broken rows fail `DB[cas]` because the value isn't a CAS. Runtime accidentally still resolves via `NAME_TO_CAS[lk]` fallback (`index.html:2065`, `4876`, etc.), so users see no symptom — until a material is renamed and the fallback breaks too.
- **Why this happens:** No schema validation on `trade_names` structure. The migration from `perfumery_data.js` to JSON kept the value form free.
- **Fix (point):** Replace each name target with the canonical CAS:
  ```
  ethanol → 64-17-5,  bht → 128-37-0,  alpha-tocopherol → 59-02-9, ...
  ```
- **Fix (systemic):** JSON Schema for `data/materials.json`:
  ```json
  "trade_names": { "additionalProperties": { "pattern": "^\\d{1,7}-\\d{2}-\\d$" } }
  ```
  Wire it into `npm test` via ajv. Any future broken-target value fails CI.
- **Effort:** S (1 hour for the 13 fixes + ½ day for schema infrastructure)

### [C2.2] 1586 `blends_with` are NOT bidirectional (77% of resolved partnerships)
- **Type:** cross-ref-broken
- **Severity:** High (visible to users — Compatibility tab missing pairings)
- **Locations:** every material with blends_with (`data/materials.json`)
- **Evidence:**
  ```
  Benzaldehyde    → Vanillin       (Vanillin's blends_with does NOT include Benzaldehyde)
  Oud Oil         → Saffron Absolute, Rose Absolute, Orris Butter,
                    Sandalwood Oil   (none of those reciprocate)
  ... +1582 more pairs
  ```
  Runtime mitigates with `REVERSE_BLENDS_INDEX` (`index.html:1444+` per CONTRIBUTING.md), but exports to CSV / Obsidian show only the curated half.
- **Why this happens:** Curators add `blends_with: [B, C, D]` on material A but don't open B, C, D and add A. No automation.
- **Fix (point):** One-shot reciprocity backfill — for every (A→B) without (B→A), append A to B's blends_with. Risk: produces a lot of churn (~1500 entries change). Recommend doing this gradually as part of curation passes, not all-at-once.
- **Fix (systemic):**
  - Existing `tools/lint-blends.mjs` already detects the gap; promote the report's `reciprocity` count to a CI **soft-warning that fails on increase** (use `git diff` against `main` baseline → fail if count grows).
  - Add `tools/blends-mirror.mjs --apply` that backfills the reverse on demand.
  - Long-term: collapse `blends_with` into a top-level `data/blends.json` undirected adjacency list, with a build step that materialises both sides into the served JSON.
- **Effort:** L for full architectural fix; M for the lint+CI gate alone

### [C2.3] 83 `blends_with` labels resolve to NOTHING — including widely-known materials
- **Type:** cross-ref-broken
- **Severity:** Medium
- **Locations:** various; sample:
  ```
  Methyl Cinnamate  → "Strawberry"           (no DB row, no synonym, no shorthand)
  Cinnamyl Acetate  → "Hyacinth"
  Ethyl Linalool    → "Lily of the Valley", "Muguet bases"
  γ-Octalactone     → "γ-Decalactone", "γ-Nonalactone", "γ-Undecalactone"
  Cinnamyl Alcohol  → "Hyacinth Absolute"
  ```
  γ-Decalactone IS in the DB (`706-14-9`) — but the curator wrote `γ-Decalactone` with the Greek γ character while the DB stores `Gamma-Decalactone`. **Pure whitespace/punctuation mismatch.**
- **Why this happens:** Resolver does case-insensitive equality but doesn't normalise Greek-letter prefixes (γ → gamma, α → alpha, β → beta, δ → delta), nor drop em-dashes / non-ASCII apostrophes.
- **Fix (point):** Extend `resolveBlend()` in the existing lint-blends + runtime resolver:
  ```js
  function normaliseGreek(s) {
    return s.toLowerCase()
      .replace(/^(γ|γ-?)\s*/i, 'gamma-').replace(/^(α|α-?)/i, 'alpha-')
      .replace(/^(β|β-?)/i, 'beta-').replace(/^(δ|δ-?)/i, 'delta-')
      .normalize('NFKD');
  }
  ```
- **Fix (systemic):**
  - Single normalisation function in `lib/utils.mjs` (`normaliseMaterialKey`) used by **every** name-resolve site (analyzer search, formulator add-modal, lint-blends, cross-ref check). Currently each site has its own ad-hoc lowercase.
  - Test fixtures: `('γ-Decalactone', 'gamma-decalactone', 'Gamma-Decalactone')` all collapse to one key.
- **Effort:** S (½ day for the helper + tests; rollout to call sites is mechanical)

### [C2.4] 13 secondaryFamilies tokens unknown to taxonomy
- **Type:** cross-ref-broken (drift)
- **Severity:** Medium
- **Locations:** Helional, Calone 1951, Floralozone use `'ozonic'`; Methyl Ionone family + Iris/Orris/Cassie/Mimosa/Heliotrope use `'powdery'`.
- **Evidence:**
  ```
  cas       name                       token
  119-84-6  Dihydrocoumarin            powdery
  1205-17-0 Helional                   ozonic
  127-43-5  Methyl Ionone (gamma)      powdery
  127-51-5  alpha-Isomethyl Ionone     powdery
  28940-11-6 Calone 1951               ozonic
  67634-15-5 Floralozone               ozonic
  79-69-6   alpha-Irone                powdery
  + 6 more
  ```
- **Why this happens:** Curators use accurate olfactive descriptors (`ozonic`, `powdery`) that exist as **facets** but not as Edwards `SUB_FAMILY` tokens. The schema conflates "family" and "facet" — but the runtime engine `materialToRadarWeights` only walks family lists, so the `powdery` axis weight gets sourced from facets, not secondaryFamilies.
- **Fix (point):** Migrate the 13 affected tokens from `secondaryFamilies → facets` (they belong as facets per Edwards taxonomy).
- **Fix (systemic):** Same JSON Schema as C2.1 — `secondaryFamilies` items must be in `MAIN_FAMILIES ∪ SUB_FAMILIES`. CI rejects new violations.
- **Effort:** S (15 min for the 13 fixes + subsumed by C2.1 schema)

### [C2.5] 27 CAS values fail the standard ISO check-digit
- **Type:** cross-ref-broken
- **Severity:** Low (pattern-only; mixture CASes routinely violate ISO check)
- **Locations:** Sample:
  ```
  1365-84-4   trans-Sabinyl Acetate
  58297-61-9  Khusimone
  73650-42-1  Scotch Spearmint Oil
  8022-66-2   Yarrow Oil
  8023-66-5   Narcissus Absolute
  84649-78-1  Black Tea Absolute
  90082-88-7  Pink Pepper Oil
  91745-67-2  Chamomile Cape Oil
  ... +19 more (mostly 8000-/8020-/91700- series natural-mixture CASes)
  ```
- **Why this happens:** Many natural-extract CASes from CAS Registry don't follow the modulo check formula because they're assigned for whole botanical extracts. **Most aren't bugs**; only the synthetics in this list (`1365-84-4 trans-Sabinyl Acetate`, `58297-61-9 Khusimone` if from the synthetic source) need verification.
- **Fix (point):** Spot-check the 4 non-mixture entries against PubChem; the 23 mixture-CASes are expected to violate.
- **Fix (systemic):** Add `tools/lint-cas.mjs --warn-only-non-mixture` to flag check-digit failures only on non-mixture CAS. Surface as a pre-commit warning, not error.
- **Effort:** S

### [C2.6] 7 Edwards `SUB_FAMILIES` are orphan — no material claims them as primary
- **Type:** cross-ref-broken (UI symptom)
- **Severity:** Medium
- **Evidence:**
  ```
  aromatic_fougere, water, soft_floral, woody_amber,
  woods, mossy_woods, dry_woods
  ```
  All 7 sub-families render as wheel slices and chip-strip filters; clicking any of them returns `0 materials` because no material's `classification.primaryFamilies` lists them.
  Materials that *should* claim these (lavender / aromatic herbs → `aromatic_fougere`; aquatic → `water`; iris/orris → `soft_floral`; oakmoss → `mossy_woods`; sandalwood/cedar → `dry_woods`) currently use legacy tokens (`herbal`, `aquatic`, `floral`, `mossy`, `woody`).
- **Why this happens:** The SUB_FAMILY → primaryFamily migration was incomplete. Per `index.html:2466+` `SUB_FAMILY_TO_LEGACY` legacy-token mapping exists for FILTERING, but `primaryFamilies` itself wasn't backfilled.
- **Fix (point):** Run `audit/scripts/migrate-primaryfamilies-to-edwards.mjs` (not built; one-time): for each material with legacy token X, add the mapped Edwards SUB_FAMILY to `secondaryFamilies` (preserve curated `primaryFamilies` for accuracy).
- **Fix (systemic):**
  - Add a CI assertion: every Edwards SUB_FAMILY has ≥1 material claiming it. Failing the assertion either means the wheel slice is empty (UI bug) or a material was un-curated (regression).
- **Effort:** M (the migration touches lots of rows; but small algorithm)

### [C2.7] 24 facets are orphan; 4 AROMACHOLOGY_SCORES rows reference no material; 3 NATURAL_ALLERGEN_COMPOSITION constituents not in EU list
- **Type:** dead-data
- **Severity:** Low (not user-visible)
- **Evidence:**
  - facet orphans: `watery, metallic, laundry, petrichor, fern, melon, strawberry, cherry, ...` (24 total)
  - AROMACHOLOGY_SCORES no-material: `65113-99-7, 81-14-1, 100-51-6, 543-39-5`
  - NATURAL_ALLERGEN constituent missing from EU_ALLERGENS_CURRENT: `115-95-7` (Linalyl Acetate — a marker, not a regulated allergen) referenced 3× in lavender-family compositions.
- **Why this happens:** Each side of these tables was edited independently; no symmetry check.
- **Fix (point):** `audit/scripts/check-cross-refs.mjs` is the symmetry check — promote it to CI (not just for this audit).
- **Fix (systemic):** All cross-table integrity checks live behind `node tools/lint-data.mjs` (rename / merge of `lint-blends.mjs`). Pre-commit hook + CI gate. New finding == new failing test.
- **Effort:** M

### [C2.8] 1 IFRA cap exists for a material that's not in the DB (`2442-10-6`)
- **Type:** cross-ref-broken
- **Severity:** Medium (regulatory data shipping unused)
- **Evidence:** `IFRA_51_LIMITS['2442-10-6']` defined in `formulation_data.js` but no material in `data/materials.json` has that CAS.
  ```
  $ node -e "const d=require('fs');d.readFileSync('formulation_data.js','utf8').split('\n').forEach((l,i)=>{if(l.includes('2442-10-6'))console.log(i+1+': '+l)})"
  61:   '2442-10-6':  { '4': 0.6, '5A': 0.15, '5B': 0.075, ... }, // Coumarin variant?
  ```
  PubChem: `2442-10-6` = 1-Octen-3-yl acetate (also known as Vinyl amyl carbinol acetate / Mushroom alcohol acetate). It's a real perfumery material missing from the curated DB.
- **Why this happens:** IFRA cap was added when curating regulatory data, but the corresponding DB entry was never created.
- **Fix (point):** Add `2442-10-6` to `data/materials.json` via `node tools/add-materials.mjs 2442-10-6`.
- **Fix (systemic):** CI assertion that every key in `IFRA_51_LIMITS` resolves to a DB entry (or its `IFRA_51_CAS_ALIAS` target).
- **Effort:** S

## C3 — Two-SPA Divergence

`index.html` (8397 lines) and `formulation.html` (7024 lines) both have the bulk of their JS inline in a single `<script id="app-init">` block, loaded by an async-fetch bootstrap. They share `taxonomy.js` + (formulation only) `formulation_data.js / formulation_engine.js`. They do NOT share inline helpers; copy-paste / drift hazards are real.

### [C3.1] HTML-escape helpers diverge between pages — `esc` vs `escHtml`
- **Type:** spa-divergence
- **Severity:** Medium (security-adjacent — apostrophe escaping)
- **Locations:** `index.html:8106` (`esc`) vs `formulation.html:1858-1861` (`escHtml`)
- **Evidence:**
  ```js
  // index.html:8106 — analyzer
  function esc(s) { return String(s==null?'':s).replace(/&/g,'&amp;')
                          .replace(/</g,'&lt;').replace(/>/g,'&gt;')
                          .replace(/"/g,'&quot;'); }

  // formulation.html:1858 — formulator
  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  ```
  Two divergences:
  | Aspect | `esc` (analyzer) | `escHtml` (formulator) |
  |---|---|---|
  | Falsy handling | `null/undefined → ''`, but `0` / `false` / `''` → coerced to string | **All falsy → `''`** (drops `0`, `false`) |
  | Apostrophe escape | NOT escaped | `' → &#39;` (safe in `<x attr='...'>`) |

  Both sites build attributes like `<a title="${esc(name)}">`. If `name` contains `'` (e.g. `"Don't"`), the analyzer renders raw apostrophe → safe in `"..."` quoted attributes, **broken** if any code switches the attribute quoting to `'...'`. The formulator-side helper is the correct/safer one.
- **Why this happens:** Two inline scripts each wrote their own helper because there's no shared module to import.
- **Fix (point):** Replace `index.html`'s `esc` body with `formulation.html`'s `escHtml` body. Or rename them both to the same name and inline the same source.
- **Fix (systemic):**
  - Move `escHtml` (the safer one) into `lib/utils.mjs` (already exists in repo for utilities like `csvEscape`, `arcPath`).
  - Both pages add `<script type="module">import { escHtml } from './lib/utils.mjs';</script>` — works without a build step (modules can ship as plain `.mjs`).
  - Add a vitest spec covering the falsy + apostrophe matrix so a future divergence can't ship.
- **Effort:** S (½ day)

### [C3.2] `addFromDB` in formulator drops curated `classification.*` fields, while analyzer's handoff preserves them
- **Type:** spa-divergence
- **Severity:** **High** (root cause of the audit-3 #4/#9 Galaxolide-class / Powdery-spike bugs)
- **Locations:** `formulation.html:2528-2532` vs `index.html:7691-7695`
- **Evidence:**
  ```js
  // formulation.html:2511-2533 — local Add Material modal
  const enriched = {
    cas, name, note, odor_type, odor_strength, odor_description,
    tenacity, tenacity_hours, blends_with, ifra_guideline, usage_levels,
    molecular_weight, density, xlogp, boiling_point, smiles,
    primaryFamilies: [],     // ← EMPTY
    secondaryFamilies: [],   // ← EMPTY
    facets: [],              // ← EMPTY
    functions: [],           // ← EMPTY
    regulatory: [],          // ← EMPTY
  };
  formulation.addMaterial(cas, entry.name, 10, enriched);
  ```
  vs.
  ```js
  // index.html:7691-7702 — Analyzer → Formulator handoff payload
  primaryFamilies:   src.classification?.primaryFamilies   || [],
  secondaryFamilies: src.classification?.secondaryFamilies || [],
  facets:            src.classification?.facets            || [],
  functions:         src.classification?.functions         || [],
  regulatory:        src.classification?.regulatory        || [],
  uses:              src.classification?.uses              || [],
  materialType:      src.classification?.material_type     || null,
  source:            src.classification?.source            || null,
  ```
  Result: a material added through the Formulator's own search modal has **no family/facet/function/regulatory data**, while the same material added via Analyzer-handoff DOES. The `materialToRadarWeights` fallback at `formulation_engine.js:273-284` reads `mat.data.primaryFamilies` first; when empty it falls back to parsing `odor_type` — producing different radar projections for the same material depending on where it was added (the audit-3 Powdery-spike user report).
- **Why this happens:** `enriched` was hand-built once and the `classification.*` mirror was never wired. The handoff path was rebuilt later (audit-2) and got it right.
- **Fix (point):** In `formulation.html:2528-2532`, copy from `entry.classification`:
  ```js
  primaryFamilies:   entry.classification?.primaryFamilies   || [],
  secondaryFamilies: entry.classification?.secondaryFamilies || [],
  facets:            entry.classification?.facets            || [],
  // ...
  ```
- **Fix (systemic):**
  - `enriched = {…}` is constructed in **3 places** in `formulation.html` (lines 2511, 5542, 5618) and again in the analyzer payload — extract a single `materialToEnrichedShape(dbEntry, fc)` helper into `lib/utils.mjs`.
  - The helper has tests pinning the field set, so a future schema change must update one place.
- **Effort:** S (1 hour for point fix; ½ day for shared helper + tests)

### [C3.3] Three call sites in `formulation.html` re-build `enriched` independently
- **Type:** spa-divergence (intra-page duplication)
- **Severity:** Medium
- **Locations:** `formulation.html:2511, 5542, 5618`
- **Evidence:** Three `const enriched = {...}` literals with overlapping but **non-identical** field sets. Site 5542 mirrors 2511; site 5618 is inside `briefToggleMaterial` and is the smallest (omits `density / boiling_point / xlogp` which are needed by thermo). A future field added at one site won't appear at the others — observable as "this material's evaporation curve is flat" depending on whether it was added via Add modal vs Brief vs Apply All.
- **Why this happens:** Code duplication; copy-paste at audit time without extracting.
- **Fix (point):** Extract `buildEnriched(entry, mp)` near the top of `formulation.html`'s inline init block; replace the 3 sites.
- **Fix (systemic):** Same as C3.2 — `lib/utils.mjs` shared helper.
- **Effort:** S

### [C3.4] `debounce` exists only in `formulation.html`; analyzer reimplements timing inline (or not at all)
- **Type:** spa-divergence
- **Severity:** Low (quality)
- **Locations:** `formulation.html:1540` (single canonical `debounce`); `index.html` has no top-level `debounce`. Analyzer's search debouncing uses `setTimeout` ad hoc.
- **Why this happens:** Same root — no shared module.
- **Fix (systemic):** Same `lib/utils.mjs`.
- **Effort:** S (subsumed)

### [C3.5] Analyzer can fetch PubChem-only results that don't exist in the formulator's DB
- **Type:** spa-divergence (data scope)
- **Severity:** Medium
- **Locations:** Analyzer `_enrichPubchem` (audit-3 fix added these to FILTER_CACHE but not to DB) ↔ Formulator `addFromDB(cas)` reads from `DB[cas]` only.
- **Evidence:** A user who searches for `66068-84-6 Iso E Super Plus` (not in DB) in the Analyzer gets a PubChem-fetched card. Clicking Formulate sends it via sessionStorage and the Formulator picks it up (the handoff path is shape-agnostic). But if the user later opens Formulator's own Add modal and searches `Iso E Super Plus`, **0 results** — the Formulator DB doesn't contain external materials.
- **Why this happens:** Two separate "material universes" — Analyzer's runtime-extended DB (DB ∪ PubChem hits) vs Formulator's static DB.
- **Fix (point):** Persist PubChem-only finds back into a session-scoped extension Map that the Formulator's `DB[cas]` lookup falls back to. Lives until tab closes.
- **Fix (systemic):**
  - Same shared module pattern: `getMaterial(cas)` in `lib/utils.mjs` checks DB → sessionStorage extension → null.
  - PubChem fetches in either page register the result through this helper, automatically visible to the other.
- **Effort:** M

### [C3.6] String-utility coverage gap in `lib/utils.mjs`
- **Type:** missing-shared-module
- **Severity:** Info
- **Evidence:** `lib/utils.mjs` exports only `csvEscape, arcPath, STEREO_ALIAS, buildStereoGroups, resolveIFRAParent, cleanOdorDescription, normalizeRegulatoryToken, REGULATORY_LEGACY_ALIASES`. None of the helpers identified above (`escHtml, debounce, normaliseMaterialKey, buildEnriched, getMaterial`) are exported here.
- **Fix (systemic):** Land them all together in one PR — create `lib/material-shape.mjs` (enriched + getMaterial + key normalisation) and `lib/dom-utils.mjs` (escHtml + debounce). Both pages add `<script type="module" src="lib/...mjs">`. Vitest covers each.
- **Effort:** M (foundational change, but unlocks every other C3 fix)

## C4 — Backup File Confusion (`perfumery_data.backup.js`)

### Inventory

```
$ ls -la perfumery_data*.js
-rw-r--r-- 1 root root 331908 Apr 22 13:19 perfumery_data.backup.js

$ git log -1 --format="%ci %s" -- perfumery_data.backup.js
2026-04-22 13:19:27 +0000 Clear perfumery_data.js for ground-up rebuild (backup to .backup.js)
                                                                       ↑ 9 days ago

$ git ls-files perfumery_data.backup.js
perfumery_data.backup.js   ← tracked in repo, ships to production

$ grep "perfumery_data.backup" eslint.config.mjs sw.js index.html formulation.html
eslint.config.mjs:15:      "perfumery_data.backup.js",   ← only ESLint-ignored

$ grep "perfumery_data" sw.js
(no matches)   ← NOT referenced by sw.js
```

### Drift vs live `data/materials.json`

```
Backup DB rows:        490
Live DB rows:          623
In backup, NOT in live:  213   ('81-14-1', '65113-99-7', '515-69-5', '31807-55-3', '18127-01-0', ...)
In live, NOT in backup:  346

Linalool (78-70-6) — same CAS, different content:
  backup  formula="" weight="" smiles=""              (text-curated only)
  live    formula="C10H18O" weight="154.25" smiles="CC(=CCCC(C)(C=C)O)C"
```

### [C4.1] 332 KB legacy snapshot ships to production for no functional reason
- **Type:** stale-artifact
- **Severity:** Medium
- **Locations:** `perfumery_data.backup.js` (root)
- **Evidence:**
  - Tracked in git, deployed to GitHub Pages on every push.
  - Not pre-cached in `sw.js` `SHELL_ASSETS`, but `sw.js:60`'s `isLocalScript` matcher (`/\.js(\?|$)/i`) **would** cache it if any code path ever issued `fetch('perfumery_data.backup.js')`. Today nothing does — but the surface is open.
  - 213 materials in backup were **deleted** by the rebuild and the only place that history lives now (outside git) is this file.
  - 346 materials added post-rebuild (60% of live DB) **never** existed in backup. The backup is not a recoverable rollback target — restoring it would lose 60% of curation.
- **Why this happens:** During the v216 ground-up rebuild on 2026-04-22 the old `perfumery_data.js` was renamed to `.backup.js` instead of deleted, "just in case." The reasoning is now obsolete (live DB is fully reseeded + tested) but the file remains.
- **Fix (point):**
  1. `git rm perfumery_data.backup.js`
  2. Note in commit msg: "history available via `git show b03fcb8:perfumery_data.js`"
  3. Remove the line in `eslint.config.mjs:15`.
- **Fix (systemic):**
  - Repository policy: **no `*.backup.*` files in main branch ever.** Pre-commit hook rejects them.
  - When a rebuild needs a snapshot, write to `data/snapshots/2026-04-22-prerebuild.json` (excluded from SW pre-cache list explicitly, deploy-pruned via `.gitattributes export-ignore` if not needed in dist).
  - Add CI check: assert no path matches `*.backup.*` is present.
- **Effort:** S (10 minutes)

### [C4.2] Two-source-of-truth pattern is the deeper concern
- **Type:** structural
- **Severity:** Low (this specific case) / High (as a pattern signal)
- **Evidence:** Same root cause family as C2.1 (`trade_names` schema drift) and C3.2 (`enriched` shape duplicated 3×). The codebase repeatedly accepts "two places that look the same and might be the same" — sometimes they're not.
- **Fix (systemic):** Adopt the rule: **for every data shape, exactly ONE file declares it.** Anything else either (a) imports / fetches it, or (b) is a clearly-marked archive in `data/snapshots/` with a date-stamped filename.

## C5 — User-Side State Migration

### Inventory: every persisted key

| Key | Page | Shape stored | Version field? | Try/catch on read? |
|---|---|---|---|---|
| `perfume_compare_cart` | analyzer | `string[]` of CAS | No | Yes (`index.html:1390-1394`) |
| `perfume_analyzer_results` | analyzer | `Array<{cas,name,open}>` | No | Yes (`6172-6210`) |
| `perfume_analyzer_sort` | analyzer | string | No | Yes (same try) |
| `perfume_formulation_materials` | both | full payload (analyzer-shape) | No | Yes (formulator side) |
| `perfume_formulation_ts` | both | timestamp | No | n/a |
| `perfume_formulator_autoimport_done_v1` | formulator | flag | **Yes (in key name)** | Yes |
| `perfume_lang` | both | `'en' \| 'th'` | No | n/a (string only) |
| `perfume_theme` | both | string | No | n/a |
| `perfume_saved_formulations` | formulator | `Array<{name,materials[],settings,carriers}>` | No | Yes (`5072-5081`) |
| `perfume_debug` | analyzer | `'1'` flag | No | n/a |

### [C5.1] Only one of 10 keys carries a schema version (`_v1` in `perfume_formulator_autoimport_done_v1`)
- **Type:** migration-missing
- **Severity:** **High** for `perfume_saved_formulations` (loss of user work) / Medium for the others
- **Locations:** all `localStorage.setItem` sites in `index.html` and `formulation.html`
- **Evidence:** None of the writes wrap their value in `{ schema: N, data: ... }`. If the persisted shape ever changes (e.g. add a `dilutionSolvent` field to saved formulas — which audit-2 actually did to `formulation.materials`) old saves still parse but downstream code silently sees `undefined` for the new field. `loadSaved()` at `formulation.html:5072` returns `Array.isArray(parsed) ? parsed : []` — passes any array through unchanged regardless of inner shape.
- **Why this happens:** The first version shipped without versioning, and every subsequent change "didn't break parse" so the wrapper never got introduced.
- **Fix (point):**
  1. Define `STORAGE_SCHEMA = 3` (current shape).
  2. Wrap every write: `localStorage.setItem(K, JSON.stringify({ schema: STORAGE_SCHEMA, data: value }))`.
  3. Wrap every read: `const { schema, data } = JSON.parse(raw); if (schema !== STORAGE_SCHEMA) return migrate(schema, data);` with a small `migrate(from, data)` switch.
  4. Migration functions live in `lib/storage-migrations.mjs` (one per N→N+1 step).
- **Fix (systemic):**
  - Wrapper helper `lsv(key, fallback)` / `lsv.set(key, value)` in `lib/utils.mjs` that handles versioning + try/catch + JSON-parse uniformly. Every site uses this helper, never raw `localStorage.*`.
  - ESLint custom rule: `no-restricted-syntax` flagging `localStorage.getItem(` outside `lib/`.
  - Vitest spec: every shape-change PR must add an N→N+1 migration test.
- **Effort:** M (foundational; 1 day to wire, easy thereafter)

### [C5.2] `perfume_saved_formulations` parsed without per-row shape validation
- **Type:** migration-missing
- **Severity:** Medium-High (user-data corruption silent)
- **Locations:** `formulation.html:5072-5081`
- **Evidence:**
  ```js
  function loadSaved() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { ... return []; }
  }
  ```
  An old save with `{ name, materials: [{ cas, name, pct }], ... }` (no `dilution`) still loads. Then `m.dilution || 100` defaults to 100% — fine. But more invasive shape changes (e.g. Phase-1 added `safety.ifra` defaults to PubChem stubs; if a saved formula references `entry.data` without `safety`, the IFRA panel shows blank instead of "treat as restricted").
- **Fix (point):** Add a `validateSavedFormula(f)` checker that asserts required fields and either (a) discards rows that fail or (b) fills defaults.
- **Fix (systemic):** Same as C5.1 — schema version + migration table.
- **Effort:** S

### [C5.3] `perfume_analyzer_results` restore depends on every CAS still being in DB
- **Type:** cache-stale
- **Severity:** Low
- **Locations:** `index.html:6172-6210`
- **Evidence:**
  ```js
  for (const item of items) {
    if (!item || !item.cas || !DB[item.cas]) continue; // silently dropped
    ...
  }
  ```
  If the DB removes a material (audit-3 did remove 11 from `mixture_cas` — though those still have rows; but a future PR could). User's restored result list silently shrinks. No log, no toast.
- **Fix (point):** When a restored CAS is missing from DB, push a `_stale: true` placeholder + render a small "(no longer in catalog)" notice.
- **Fix (systemic):** Subsumed by C5.1's migration runner — schema bump triggers a "rehydrate-from-CAS-only" pass that warns on dropped rows.
- **Effort:** S

### [C5.4] No "clear all stored state" UI for users hitting corruption edge cases
- **Type:** missing-recovery
- **Severity:** Low (Info)
- **Locations:** —
- **Evidence:** When localStorage corrupts (mid-PWA-update, browser quota games), the only fix today is opening DevTools → Application → Clear storage. Most users won't.
- **Fix (point):** Add a "Reset app data" link inside the data-quality / about modal: clears all `perfume_*` keys + reloads.
- **Fix (systemic):** `lib/utils.mjs` `clearAllAppStorage()` helper, exposed via a dev-mode UI. Also called automatically when schema mismatch is detected (per C5.1).
- **Effort:** S

## C6 — Manual Sync Points Census

Every "remember to also do X" rule embedded in `CONTRIBUTING.md`, in code comments, or implied by the audit fix history. For each rule we ask: **"does automation enforce this today?"**

| # | Manual rule | Source | Automated today? | Gap |
|---|---|---|---|---|
| 1 | Bump version in **9 places per release** (3× `?v=` + 2× `DATA_VERSION` per page, one set per page) | `CONTRIBUTING.md:62-71` | **No** — manual `sed` | Missing release script (C1.1) |
| 2 | When a `let`/`const` is read by init, hoist to top-of-script | `CONTRIBUTING.md:42-56` | **Partial** — `eslint` `no-use-before-define` is configured but only catches definite TDZ; the audit-fix series v184/v187/v188/v189/v192 all slipped through | Tighten ESLint + custom rule for "init reads" |
| 3 | Escape `${user-controlled}` in template literals | `CONTRIBUTING.md:75-77` | **No** | Custom ESLint rule for template-literal taint analysis is non-trivial; pragmatic alternative is "always use `textContent` or `escHtml()`" + lint for inline `innerHTML =` with template literal |
| 4 | Wrap every init call in try/catch | `CONTRIBUTING.md:78-81, 113-116` | **No** | Single `safeInit(name, fn)` helper + ESLint rule that only `safeInit(...)` calls may appear in the init block |
| 5 | Run `node tools/codemap.mjs` after structural edits | `CONTRIBUTING.md:111-113` | **No** | CI: `git diff --exit-code .codemap.md` after running codemap |
| 6 | Bump cache-buster with every behaviour change | `CONTRIBUTING.md:109-110` | **No** | Pre-commit hook: if any `*.html / *.mjs / *.js` (excluding test/audit) changed AND no `?v=` bumped → reject |
| 7 | Add a banner comment on every new logical section | `CONTRIBUTING.md:36-40` | **No** | `tools/codemap.mjs` could `--check` for unbannered top-level functions; add to CI |
| 8 | First-mount-only animation: check `_renderedCas` set | `CONTRIBUTING.md:82-85` | **No** | Hard to lint — surface as a code review checklist |
| 9 | Wheel single-select rule — clicking a slice clears other axes | `CONTRIBUTING.md:86-88` | **No** | Manual; cheap visual UI test would catch it |
| 10 | If you remove a material from DB, also remove from `IFRA_51_LIMITS`, `NATURAL_ALLERGEN_COMPOSITION`, `ESTER_HYDROLYSIS`, `AROMACHOLOGY_SCORES`, `mixture_cas`, `trade_names`, every `blends_with` | implicit | **No** — `audit/scripts/check-cross-refs.mjs` (this audit) catches it ex-post | Promote cross-ref check to CI (C2.7 systemic) |
| 11 | When `enriched` shape adds a field in one of 3 sites, add to all 3 | implicit (`formulation.html:2511, 5542, 5618`) | **No** | Extract single helper (C3.3) |
| 12 | When `safety.ifra` text wording changes, ensure `classifyRegulatory` regex still parses correctly | audit-3 #3 (Cashmeran allergen) | **No** | Engine regex test fixtures pin the parse outcome for known-good strings (a few per category) |
| 13 | When you add a localStorage key, version it (`_v1` suffix or schema wrapper) | NOT IN DOCS | **No** | C5.1 `lsv()` helper |
| 14 | After bumping `data/materials.json`, check `data.meta.version` matches | NOT IN DOCS (because `data.meta` doesn't exist yet) | **No** | C1.4 fix proposal |
| 15 | Don't introduce a build step | `CONTRIBUTING.md:120-122` | **No** | Convention; `package.json` has no `build` script — preserves the rule by absence |
| 16 | Use `.codemap.md` for navigation, never full-read big HTML | `CONTRIBUTING.md:30-34` | **No** (relies on contributor discipline) | n/a (developer-experience rule) |
| 17 | When `tools/add-materials.mjs` lands a stub, it must populate `safety.ifra` default ("treat as restricted") | `tools/lib/material-classifier.mjs` | **Yes** ✅ (Phase-1 audit) | example of a rule that DID get automated |
| 18 | When you rename a family token, all materials referencing the old token must be updated | implicit | **No** | `audit/scripts/check-cross-refs.mjs` → CI (the C2 systemic) |
| 19 | When `mixture_cas` adds an entry, that entry's `formula` field must be empty | audit-2 finding | **No** | One-line check inside cross-ref linter |
| 20 | When a new EU allergen is added to `EU_ALLERGENS_2023_NEW`, materials whose synonyms include it must get `regulatory: ['allergen']` | implicit | **No** | Cross-ref linter |

### [C6.1] Of 20 manual rules, **18 have NO automation** (90%)
- **Type:** manual-sync-point
- **Severity:** **Critical** as a class — every one is a future regression class
- **Why this happens:** Each rule was written reactively after a bug; the documentation captures it but the codebase never grew the enforcement.
- **Fix (point):** n/a — the rules are individually valid; what's missing is enforcement.
- **Fix (systemic):**
  1. **Single `tools/lint-data.mjs`** absorbs `tools/lint-blends.mjs` + this audit's `audit/scripts/check-cross-refs.mjs`. Hard-error mode used in CI; warn-only mode for local dev.
  2. **`scripts/release.mjs`** bumps version, runs lint+test, asserts no version drift, asserts cross-ref clean.
  3. **`.husky/pre-commit`** runs:
     - `npm run lint`
     - `npm test`
     - `node tools/lint-data.mjs --strict`
     - cache-bust diff check
     - codemap freshness check
  4. **CI `.github/workflows/ci.yml`** runs the same + builds an artifact of the heat-map (C8) so PR review sees if the cross-ref count drifted upward.
  5. Document in `CONTRIBUTING.md`: "Every rule documented here MUST be in `package.json` scripts; if you can't automate it, don't put it in the docs — put it in a runtime assertion."
- **Effort:** L (1 sprint to land all systems); but each individual hook is S–M

### [C6.2] The audit fix history is a leading indicator of where rules go unmonitored
- **Type:** trend
- **Severity:** Info
- **Evidence:** Of the last 20 commits, **17 are `fix(...)` titled and 12 are explicitly tagged "(audit #N)"**.
  ```
  $ git log --all --oneline | grep -iE "fix|sync|forget|miss|bump|cache" | wc -l
  ~120 commits in repo history with these keywords
  ```
- **Why this happens:** The codebase ships, users (or audits) find issues, fixes get patched, no automation prevents the same class. The `(audit #N)` tagging itself is a regression signal.
- **Fix (systemic):** Track audit-finding-→-CI-rule conversion as an explicit metric in this report's Action Plan. Goal: every audit finding lands two PRs — (a) the fix, (b) the linter that would have caught it.

## C7 — Update Workflow Trace (4 scenarios)

For each scenario: list every file/section that must change, ID the points where forgetting one step results in silent breakage, and rate "fail loud?".

### Scenario A — Add a new material (1 single-molecule aroma chemical)

| Step | File | Surface | Fail-loud if skipped? |
|---|---|---|---|
| 1 | `data/materials.json` `perfumery_db[]` | new entry with `cas, name, formula, weight, smiles, inchi, synonyms, pubchem_url, pubchem_cid, odor, note, performance, safety, classification, blends_with` | ❌ — `audit/scripts/check-cross-refs.mjs` would catch only after run; not blocked |
| 2 | (optional) `data/materials.json` `trade_names` | shorthand → CAS map entries if it's known by trade name | ❌ — silently absent |
| 3 | (optional) `formulation_data.js` `IFRA_51_LIMITS[cas]` | category caps if regulated | ❌ — runtime treats missing IFRA as "open use" (DANGEROUS for restricted materials) |
| 4 | (optional) `formulation_data.js` `EU_ALLERGENS_2023_NEW[cas]` | only if material is on EU list | ❌ — silently absent |
| 5 | (optional) `formulation_data.js` `NATURAL_ALLERGEN_COMPOSITION[cas]` | only if it's a natural with allergen-bearing constituents | ❌ |
| 6 | (optional) `formulation_data.js` `ESTER_HYDROLYSIS[cas]` | only if it's a hydrolysable ester | ❌ |
| 7 | `data/materials.json` `mixture_cas[]` | only if it's a natural mixture | ❌ — silently absent; not-mixture defaults to single-molecule UI |
| 8 | (existing materials' `blends_with[]`) | if the new material is a known blender for them, add reverse refs | ❌ — `tools/lint-blends.mjs` reports unidirectionality but doesn't fail CI |
| 9 | `data/materials.json` row count in any documentation | "623 materials" stale | ❌ |
| 10 | Bump version in 9 places (C1.1) | for SW + browser cache invalidation | ❌ — users see new entry only after their cache rotates organically |

**Total: 10 places that may need touching, only step 1 is mandatory and even step 1 has no schema check.** `tools/add-materials.mjs --seed` automates 1, 2 partially, 5 not at all.

### Scenario B — Change an IFRA cap

| Step | File | Surface | Fail-loud? |
|---|---|---|---|
| 1 | `formulation_data.js` `IFRA_51_LIMITS[cas]` | mutate the per-category numbers | ❌ |
| 2 | (consequence) saved formulas in users' `localStorage` | recompute compliance on load? | **No** — saved formulas re-evaluate compliance live each load (✓ via `checkIFRACompliance`) so this scenario IS coherence-clean |
| 3 | Analyzer's compliance badge `safetyBadgeForSearch` if it caches | check it doesn't memoise | needs verification — likely fine, but no test |
| 4 | Bump version (cache rotation) | else returning user sees old cap | ❌ — same as C1.1 |

**Coherence risk:** Low — runtime reads `IFRA_51_LIMITS[cas]` on every render. Main risk is cached HTML or stale SW.

### Scenario C — Rename a family (e.g. `herbal` → `aromatic_herbal`)

| Step | Surface | Fail-loud? |
|---|---|---|
| 1 | Update every `entry.classification.primaryFamilies` containing `'herbal'` (~129 rows) | sed across `data/materials.json` | partially loud — schema validator would catch unknown token if added (C2.1) |
| 2 | `taxonomy.js` `MAIN_FAMILY_TO_SUBS / SUB_FAMILY_TO_MAIN` | doesn't apply to `herbal` (not Edwards), but for SUB renames yes | ❌ |
| 3 | `index.html` `SUB_FAMILY_TO_LEGACY` mapping | maps legacy token → Edwards subfamily — the rename ripples here | ❌ |
| 4 | `formulation_engine.js` `FAMILY_TO_AXES` | radar weight mapping references token by name | ❌ — old name silently produces 0 weight on every axis (auditfinding C2.4 same class) |
| 5 | `formulation_data.js` `FAMILY_NOTE_RATIOS / FAMILY_MOOD_DEFAULTS` | family-keyed dicts | ❌ |
| 6 | `lib/material-classifier.mjs` rule output `families:` arrays | curate-stubs assigns family tokens; rename here too | ❌ |
| 7 | URL state for users who deep-linked a filter with old family name | `_writeUrlState` / `_restoreUrlState` | ❌ — old URL silently filters to nothing |
| 8 | `localStorage` `_RESULTS_LS_KEY` cached search results | already CAS-keyed not family-keyed; should be safe | n/a |
| 9 | i18n labels (`MAIN_FAMILY_LABELS` / `SUB_FAMILY_LABELS`) | display strings | ❌ |
| 10 | Documentation / `.codemap.md` | self-regenerates | ✓ if codemap is rerun |

**This is the painful scenario.** No migration script exists for "rename family token X → Y". Doing it manually is 7 file edits; missing any one means silent UI breakage at a *different* layer.

### Scenario D — Add a new EU allergen (e.g. EU 2025 amendment adds 5 substances)

| Step | Surface | Fail-loud? |
|---|---|---|
| 1 | `formulation_data.js` `EU_ALLERGENS_2023_NEW` (or new `EU_ALLERGENS_2025`) | per-CAS `{name, inci, threshold}` entries | ❌ |
| 2 | `EU_ALLERGENS_CURRENT` aggregate (already auto-merges `EU_ALLERGENS_26 ⊕ 2023_NEW`; would need 2025 add to merge call at `formulation_data.js:214`) | ❌ — silent (engine still uses old set) |
| 3 | `formulation_data.js` `NATURAL_ALLERGEN_COMPOSITION` — add the new allergen CAS as a constituent of any natural that contains it | ❌ — without this, hydrolysis branch and natural-composition branch under-declare |
| 4 | `formulation_data.js` `ESTER_HYDROLYSIS` — if any ester yields the new allergen on hydrolysis | ❌ |
| 5 | `index.html` `classifyRegulatory()` hardcoded allergen-name regex (`index.html:8133`) — list of named allergens that auto-flag | ❌ — without this, materials using the canonical name aren't flagged in the analyzer |
| 6 | `index.html` documentation section (data-quality modal) showing "EU 26 + 2023/1545" — needs "+ 2025" | display only |

**Most-easily-forgotten step:** #5 — the hardcoded allergen-name regex in the analyzer's classifier. This is a duplication of the allergen list that lives separately from the canonical `EU_ALLERGENS_CURRENT` map. Drift is silent.

### [C7.1] Two parallel allergen sources of truth
- **Type:** spa-divergence
- **Severity:** **High** (regulatory accuracy)
- **Locations:**
  - `formulation_data.js:154-213` `EU_ALLERGENS_26 / EU_ALLERGENS_2023_NEW / EU_ALLERGENS_CURRENT`
  - `index.html:8133` regex literal
- **Evidence:**
  ```js
  // index.html:8133 — hardcoded regex with allergen names
  /\b(linalool|limonene|citral|geraniol|eugenol|coumarin|farnesol|citronellol|
       cinnamal|cinnamic alcohol|cinnamyl alcohol|isoeugenol|benzyl alcohol|
       benzyl salicylate|benzyl benzoate|benzyl cinnamate|hydroxycitronellal|
       amyl cinnamal|amylcinnamyl alcohol|hexyl cinnamal|methyl heptine carbonate|
       alpha-isomethyl ionone|oakmoss|treemoss|evernia)\b/i
  ```
  This regex has the EU 26 list **inlined**. The canonical map in `formulation_data.js` has 80+ allergens (EU 26 + 2023/1545). Drift is invisible until a user adds e.g. `methyl 2-octynoate (methyl heptine carbonate)` and notices the analyzer doesn't badge it as an allergen.
- **Fix (point):** Build the regex at runtime from `EU_ALLERGENS_CURRENT` keys' canonical names + INCI list.
- **Fix (systemic):** Single `EU_ALLERGENS_CURRENT` is the source. Helper `buildAllergenNameRegex()` in `lib/utils.mjs` is the only producer of this regex. Both pages import it.
- **Effort:** S

### [C7.2] No automated migration script for material/data renames
- **Type:** missing-tooling
- **Severity:** Medium
- **Evidence:** Scenario C above involves 7 file edits across `data/`, `taxonomy.js`, `formulation_data.js`, `formulation_engine.js`, `lib/material-classifier.mjs`, plus i18n and documentation. No script exists.
- **Fix (point):** Document the manual procedure as a checklist in `CONTRIBUTING.md`.
- **Fix (systemic):**
  - `scripts/rename-family.mjs --from <old> --to <new>` runs sed-replace across the 7 surfaces, runs cross-ref linter, runs tests.
  - `scripts/add-allergen.mjs --cas <cas> --name <name> --inci <inci> --threshold <ppm>` does the 5-step add for Scenario D and updates the analyzer regex by re-deriving from the canonical map (which side-steps C7.1 entirely).
  - `scripts/add-material.mjs` already exists in spirit (`tools/add-materials.mjs`) but only handles Step 1; extend it to interactively prompt for IFRA / mixture / blends_with reverse refs.
- **Effort:** M (per script ~1 day; pays back forever after)

### [C7.3] Saved-formula compliance NOT recomputed on data refresh
- **Type:** cache-stale
- **Severity:** Medium
- **Evidence:** When IFRA caps change in `formulation_data.js`, a user opening a saved formula sees the *old* compliance verdict cached in their `localStorage` row. The save shape (`formulation.html:5072+`) stores `{materials, settings, carriers}` but no compliance result — so compliance IS re-run. Verified ✓ for the IFRA path.
  However — if any analysis result (e.g. `_radarChart` data, GC-MS peaks) were ever cached in saved-formula state, this would break. Currently they're not, but there's no test.
- **Fix (point):** Add a vitest spec that loads a saved formula → asserts compliance is re-derived from current `IFRA_51_LIMITS`.
- **Fix (systemic):** `lib/storage-migrations.mjs` (per C5.1) includes a compliance-pass sanity check on every load.
- **Effort:** S

## C8 — Synthesis

### Heat map (file × inconsistency-type)

| | C1 version | C2 cross-ref | C3 SPA-divergence | C4 backup | C5 storage | C6 manual rule | C7 workflow | **Total** |
|---|---|---|---|---|---|---|---|---|
| `data/materials.json` | 1 | 9 | — | — | — | — | 4 | **14** |
| `formulation_data.js` | — | 5 | — | — | — | — | 4 | **9** |
| `index.html` | 4 | 1 | 5 | — | 4 | 17 | 4 | **35** |
| `formulation.html` | 4 | — | 4 | — | 3 | 17 | 2 | **30** |
| `formulation_engine.js` | — | — | 1 | — | — | — | 1 | **2** |
| `taxonomy.js` | — | 1 | — | — | — | 1 | 1 | **3** |
| `sw.js` | 2 | — | — | 1 | — | 1 | 1 | **5** |
| `lib/utils.mjs` | — | 1 (orphan-prevention gap) | 6 (missing exports) | — | 1 | 4 | 4 | **16** |
| `tools/lint-blends.mjs` | — | 7 (coverage gap) | — | — | — | 5 | 4 | **16** |
| `CONTRIBUTING.md` | 1 | — | — | — | — | 17 | — | **18** |
| `package.json` (no `release` script, no `lint:data`) | 1 | 1 | — | — | 1 | 17 | 4 | **24** |
| `perfumery_data.backup.js` | — | — | — | 2 | — | 1 | — | **3** |

**Hot spots** (dark cells if rendered):
- `index.html` and `formulation.html` carry most surface (35 + 30) but the highest density-per-LOC is in `lib/utils.mjs` (16 findings on 100 lines = 16% coverage gap) and `tools/lint-blends.mjs` (existing tool with 5 missing rule families).
- **`package.json` has 24 findings** because almost every "fix" in the table is "add an `npm run X` script". This is itself a finding: missing release tooling is the root contributor to ~half the audit.

### Root-cause grouping

Re-classify the ~30 individual findings into 4 root causes. Each root, if fixed, eliminates many findings:

| Root cause | Findings that disappear if fixed | Effort |
|---|---|---|
| **R1. No single source of truth for version** | C1.1, C1.2, C1.3, C1.4, C5.1 (storage version), most of C6 rule #1, C7 step "Bump version" in every scenario | M |
| **R2. No schema validation on `data/materials.json` + `formulation_data.js`** | C2.1 (trade_names target), C2.4 (secondaryFamily tokens), C2.6 (subfamily orphans), C2.7 (dead-data), C2.8 (IFRA orphan), C5.2 (saved-formula shape), C6 rule #10/#19/#20, C7.1 (allergen drift) | L (foundational) |
| **R3. `index.html` and `formulation.html` don't share a code module** | C3.1–C3.6, C5.1 (`lsv()` helper), C6 rule #11, C7.1 (allergen regex duplication) | M |
| **R4. Manual rules are documented in `CONTRIBUTING.md` instead of automated** | C6.1 (90% of rules unautomated), C6.2 (audit-driven fix loop), C7.2 (missing migration scripts), every "no CI check" marker in C2/C5 | L (1 sprint per system) |

**1761 cross-ref broken refs collapse to 4 root causes.** Patching each finding is whack-a-mole; addressing R1–R4 systemically eliminates the class.

### Architecture changes (ranked by impact ↓)

1. **R2 — JSON Schema + CI for data files.** Single biggest bang/buck. Catches 95% of C2 findings on PR. Effort: ~3 days for `data/materials.json` schema; ~1 day each for `formulation_data.js` sub-tables.
2. **R4 — Promote `tools/lint-blends.mjs` → `tools/lint-data.mjs` covering ALL cross-refs found by `audit/scripts/check-cross-refs.mjs` (this audit).** Run in CI as hard error. Effort: M.
3. **R1 — `version.json` + `npm run release`.** Eliminates 9-place drift + makes SW/HTML version coherence a single bump. Effort: ½ day to land, infinite payoff.
4. **R3 — `lib/dom-utils.mjs` + `lib/material-shape.mjs` + `lib/storage.mjs` shared modules.** Loaded as `<script type="module">` in both HTMLs (no build step). Effort: 1 sprint to migrate; foundational for many later fixes.
5. **Pre-commit hook bundle** (`.husky/`): lint, test, lint-data, version-drift check, codemap-fresh check.
6. **Update workflow CLIs**: `scripts/add-material.mjs`, `scripts/rename-family.mjs`, `scripts/add-allergen.mjs`. Each subsumes a manual checklist into one command.
7. **localStorage versioning + migration runner**.
8. **PWA SW version derived from content hash**, not manually bumped.

### Migration plan (sprints, no breakage)

**Sprint 1 (1 week) — Foundations:**
- Land `version.json` + `npm run release` (R1). No behavior change for users.
- Land JSON Schema for `data/materials.json` (R2 phase 1). CI gates new violations only — historical findings allowed via baseline file.
- Delete `perfumery_data.backup.js` (C4.1).
- Update `CONTRIBUTING.md` to drop the now-dead version-bump section.

**Sprint 2 (1 week) — Linter consolidation:**
- Merge `audit/scripts/check-cross-refs.mjs` rules into `tools/lint-data.mjs`.
- CI gate on `npm run lint:data --strict` for new findings.
- Fix the 13 broken `trade_names` (C2.1) — small targeted PR, validated by new schema.

**Sprint 3 (1 week) — Shared module:**
- Create `lib/dom-utils.mjs` with `escHtml`, `debounce`. Both pages migrate.
- Create `lib/storage.mjs` with `lsv()` versioned wrapper. Migrate `_RESULTS_LS_KEY`, `SAVE_KEY`, etc.
- Create `lib/material-shape.mjs` with `buildEnriched(entry)`. Replace 3 inline copies in `formulation.html`.

**Sprint 4 (1 week) — Manual-rule automation:**
- Pre-commit hook bundle.
- Move analyzer's `classifyRegulatory` allergen regex to derive from `EU_ALLERGENS_CURRENT` (C7.1).
- Script `scripts/rename-family.mjs` + `scripts/add-allergen.mjs`.

**Sprint 5 — Curation cleanup (optional):**
- Backfill 1586 non-bidirectional `blends_with` (C2.2). Use `scripts/blends-mirror.mjs --apply`. CI ratchet so count can never increase.
- Migrate 13 unknown secondaryFamily tokens to facets (C2.4).

### Quick wins (<1 day each)

| Win | Effort |
|---|---|
| `git rm perfumery_data.backup.js` (C4.1) | 5 min |
| Bake the analyzer's allergen-name regex from `EU_ALLERGENS_CURRENT` (C7.1) | 1 hour |
| Add `npm run codemap` to CI (`git diff --exit-code .codemap.md`) | 30 min |
| Fix 13 `trade_names` to use CAS targets (C2.1 point fix) | 1 hour |
| Update `CONTRIBUTING.md:64-66` to drop the obsolete two-train versioning paragraph (C1.3) | 10 min |
| Add `2442-10-6` to DB OR remove its IFRA cap (C2.8) | 30 min |
| Migrate 13 `secondaryFamilies → facets` (C2.4) | 1 hour |
| Replace `addFromDB`'s empty classification with `entry.classification` (C3.2 point fix) | 30 min |
| Extract single `buildEnriched` helper inside `formulation.html` (C3.3) | 1 hour |

### Metrics — current state vs target

| Metric | Now | After R1+R4 | Target |
|---|---|---|---|
| Manual sync rules | 20 | 5 | 0 |
| CI checks | 3 (`test`, `lint`, `codemap` in dev only) | 7 | 7 + per-PR data-diff |
| Cross-ref broken at HEAD | 1761 (1586 non-bidir) | < 50 (only legitimate gaps) | 0 |
| Data files with schema | 0 | 2 | 2 |
| Time to detect (TTD) drift | reactive (audit-driven) | seconds (pre-commit) | seconds |
| Pages sharing helpers | 0 modules | 3 modules (dom/storage/shape) | 3+ |
| Backup / archive files in repo | 1 | 0 | 0 |

### Audit script outputs (reproducible)

```
$ node audit/scripts/check-cross-refs.mjs
                                            (writes audit/cross-ref-report.json)
Cross-ref summary:
material.primaryFamilies → taxonomy                 619       0
material.secondaryFamilies → taxonomy               196       13
material.material_type → TYPE_VALUES                  0        0
material.functions → FUNCTION_VALUES                  0        0
material.uses → USE_VALUES                            0        0
taxonomy.subfamily orphans                           14        7
taxonomy.facet orphans                              253       24
IFRA_51_LIMITS cas → material                        12        1
material.blends_with → material                    2140       83
material.blends_with bidirectional                 2057     1586
trade_names → material exists by CAS               1066       13
mixture_cas → material exists                       214        0
mixture_cas with single-molecule formula            214        0
duplicate CAS in DB                                 623        0
CAS check-digit invalid                             623       27
NATURAL_ALLERGEN_COMPOSITION constituent → EU       30         3
ESTER_HYDROLYSIS pair integrity                      7         0
AROMACHOLOGY_SCORES → DB                            77         4
```

