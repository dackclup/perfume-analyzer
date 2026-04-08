# Perfume Analyzer — Refactor Plan

## Final Architecture Status

**Completed:**
- Canonical nested record (`record.*`) is the single source of truth
- All 21 accessor proxies removed — zero flat business-field access remains
- All write paths (applyPerfumery, _applyPubchemProps, scrapeMaterial, PubChem enrichment) write to `mat.record.*` directly
- All read paths (render, export, classification, GHS, validation) read from `mat.record.*` directly
- FILTER_CACHE fully decoupled from raw DB entry shape
- Export consumes canonical record directly
- Classification precomputed once, cached on `record.classification.*`
- Consistent `_` prefix convention for transient UI state

**Retained by design:**
- Single-file architecture (file:// compatibility)
- Transient UI state outside record: `found`, `_open`, `_loadPubchem`, `_ghsCodes`, `_ghsPictograms`, `_ambiguous`, `_notPerfumery`, `_prefetched`, `structure_image_url`, `page_url`, `match_info`
- Classification functions accept both result objects and raw DB entries (dual path for FILTER_CACHE init)

**Deferred:**
- Physical file/module split (requires dev server, breaks file://)
- Full TypeScript types (would need build step)

---

## Pass-3 Status: ACCEPTED (closed after Step 4)

Pass-3 was a strictly observability-only pass: instrument the safest
silent `catch` blocks so future runtime errors in rare PubChem fallback
paths surface in the console instead of being swallowed silently. No
runtime behavior, no Promise semantics, no control flow, no thresholds,
no matchers, no data, and no UI were changed.

**Catches instrumented (4 single-line edits, all logging-only):**

| Step | Line | Location | Pattern |
|---|---|---|---|
| 1 | 1888 | `downloadJSON` PubChem pug_view retry | `console.warn('downloadJSON pug_view:', e)` |
| 2 | 1165 | `scrapeMaterial` Step 9 InChI lookup | `console.warn('scrapeMaterial inchi lookup:', e)` |
| 3 | 1157 | `scrapeMaterial` Step 8 SMILES lookup | `console.warn('scrapeMaterial smiles lookup:', e)` |
| 4 | 1261 | `scrapeMaterial` Use+Manufacturing fetch (perfumery validation) | `console.warn('scrapeMaterial use+manufacturing fetch:', e)` |

All four follow the same shape: `} catch(e) { if (e?.name !== 'AbortError') console.warn(<scoped tag>, e); }`. AbortError (timeout) remains silent. The catch still consumes the rejection (no re-throw), so Promise resolution and downstream control flow are unchanged.

**Intentionally NOT instrumented:**

- **Line 1176** — `scrapeMaterial` Step 10 PubChem name title fetch.
  This is the highest-firing-rate empty catch in the file because
  Step 10 is the most common PubChem fallback path and PubChem returns
  404s for unknown user inputs as a normal outcome. Instrumenting it
  would risk console noise during routine searching. Left as a
  documented intentional silent catch.
- **Lines 1056-1058 and 1240-1242** — six `.catch(()=>null)`
  sentinel-returners on the PubChem property/synonyms/description
  fetches in `_enrichPubchem` and `scrapeMaterial`. These are deliberate
  sentinel-returners (the caller checks `propsRes.status === 'fulfilled'
  ? propsRes.value : null`), not silent swallows. Logging them would
  spam every search session with normal PubChem 404s.

**Verified after Step 4:**
- All 4 patches are 1-line catch replacements; total Pass-3 footprint
  is 4 lines across 4 commits.
- JS syntax clean after every step.
- No matcher order, threshold, confidence, filter, or render template
  changed.
- 10-case smoke test still passes (verified during Pass-2; no Pass-3
  edits could have changed it because all edits are inside catch blocks
  that are not entered on the happy path).

**Deferred items NOT addressed in Pass-3** (still open for a future pass
if a concrete user need arises):

1. `material_type` taxonomy split between `classifyMaterialType` and
   `_buildFilterRecord` (16 disagreeing materials, ~10-line patch with
   mild UI implications).
2. `NAME_TO_CAS` ↔ `TRADES` data collisions (3 keys: `tonka bean`,
   `ambergris`, `norlabdane oxide`) — data-only edit in `perfumery_data.js`
   requiring a small chemistry decision.
3. Plausibility `_stem` helper scope (handles only `-yl alcohol` ↔
   `-anol`; doesn't cover `-ic acid` ↔ `-oate`, `-aldehyde` ↔ `-al`,
   etc.). Each new stem rule is a chance to over-match.
4. Line 1176 silent catch (see above).
5. Six `.catch(()=>null)` sentinel-returners (see above).

---

## Pass-2 Status: ACCEPTED (closed)

- Strict schema audit passed across `calcCompleteness`, `createResult`,
  `_applyPubchemProps`, `applyPerfumery`, `renderResults`, `downloadJSON`,
  and `buildLocalRecord`.
- No schema inconsistencies found. Every field read by `calcCompleteness`
  is actually written by `downloadJSON`. Every canonical-record path used
  by writers and readers matches `createResult`.
- `hasCid` detection via `record.pubchem_url` is verified sound: `mat.page_url`
  is set in exactly two places (`_enrichPubchem` line 1053 and `scrapeMaterial`
  line 1234), both gated on a successfully resolved CID.
- 60/40 completeness weighting verified active: `downloadJSON` awaits
  `mat._loadPubchem` before building the export record, so `pubchem_url`
  is populated for all enriched materials by the time `calcCompleteness` runs.
- No further surgical fixes required in Pass-2.

## Deferred Technical Debt

These items are known and intentionally deferred. None are Pass-2
regressions; all pre-date Pass-2 or are by-design trade-offs.

1. **Silent catch in `downloadJSON` pug_view retry path** (line 1888,
   `} catch(e) {}`). If the per-batch PubChem fetch fails for one
   material during JSON export, that material's `pubchem_sections` stays
   empty and its `pubchem_pct` is lower than it should be. Pre-existing,
   not flagged in earlier audits.

2. **Intentional silent fallbacks in `scrapeMaterial` network branches**
   (lines 1157, 1165, 1176, 1261). Four `} catch(e) {}` inside the
   SMILES / InChI / PubChem-name / Use+Manufacturing fallback chain.
   The result of each catch is immediately checked by the next
   `if (!cid)` or `isPerfPC` test, so they cannot hide a logic bug —
   only network errors. Acceptable.

3. **`material_type` taxonomy split** between `classifyMaterialType`
   (5 values: `single_molecule`, `natural_extract`, `natural_isolate`,
   `solvent_carrier`, `additive`) and `_buildFilterRecord` / FILTER_CACHE
   (4 values: `single_molecule`, `natural_extract`, `natural_isolate`,
   `other`). The render badge and the Type filter use different
   classifications for the same material. Not user-visible at "All",
   but materials labelled `'other'` cannot be selected by any Type radio.

4. **`NAME_TO_CAS` vs `TRADES` data collisions** for `tonka bean`,
   `ambergris`, `norlabdane oxide` — same lowercased term resolves to
   different CAS in the two indexes. Matcher order resolves
   deterministically, so user-visible behavior is stable. Requires
   chemistry judgment to fix at the data layer.

5. **Limited scope of the plausibility stem helper** in `scrapeMaterial`
   Step 10. The `_stem` regex collapses `-yl alcohol` ↔ `-anol` for
   the phenylethyl/phenylethanol class, but does not handle other
   English chemical-name variants like `-ic acid` ↔ `-oate`,
   `-yl` ↔ `-ane`. Future synonym pairs in those families would
   still depend on the token-overlap fallback.

---

## CHANGELOG

### 2026-04-06 — Pass-1 correctness audit (P0/P1 fixes)

**P0 — JSON export completeness undercount:**
- Bug: `calcCompleteness()` checked `record.identifiers?.smiles` but the
  export schema writes `canonical_smiles`. The field was always undefined,
  so every exported record's completeness score undercounted by 1.
- Fix: Check `record.identifiers?.canonical_smiles`.

**P1 — `natural_isolate` regex misclassifies synthetics:**
- Bug: `RE_NATURAL_ISO = /\b(natural|isolate|from .* oil|occurs in)\b/i`
  matched the bare word "natural", so aroma chemicals with descriptions
  like "closest synthetic to natural sandalwood oil" (Javanol),
  "natural sandalwood" (Firsantol), "natural feel" (Tricyclodecenyl
  Propionate), "natural rose character" (Rosalva) were classified as
  natural_isolate in both the render badge and FILTER_CACHE.
- Fix: Tightened to require an explicit claim:
  `\bisolate(?:d|s)?\b | \bfrom\s+\w+(?:\s+\w+)?\s+oil\b | \boccurs\s+in\b | \bnatural\s+(?:form|isolate|source|origin)\b`
  L-Menthol still correctly matches ("natural form of menthol"). Javanol,
  Firsantol, Tricyclodecenyl Propionate, Rosalva, Alpha Santalol now
  correctly resolve to single_molecule.
- `classifyMaterialType` now reuses the same `RE_NATURAL_ISO` constant
  to keep render/filter classification consistent.

**P1 — `classifyIndustryTags` dead branch:**
- Bug: `if (/cosmetic.../) { tags.push('cosmetics'); } else { tags.push('cosmetics'); }`
  — both branches pushed the same tag. Dead code.
- Fix: Simplified to a single `if (!banned) tags.push('cosmetics')`.

**P2 — Search error not cleared on pill-click or new search:**
- Bug: `doSearch()` never called `clearSearchError()`. Pill-click leaves
  a stale "Did you mean?" or "Not found" banner visible until the new
  response arrives.
- Fix: Call `clearSearchError()` at the start of `doSearch()`.

**P2 — Silent error swallowing in background catches:**
- Bug: Three `.catch(()=>{})` in `_enrichPubchem` and the PubChem GHS
  fetch, plus `Promise.allSettled` in `doSearch` silently dropping
  rejected items. This pattern hid the earlier `classifyIndustryTags`
  ReferenceError for weeks.
- Fix: Wrap `_computeClassification` calls in try/catch that logs via
  `console.warn`, log non-`AbortError` errors in the GHS catches, and
  log rejected `scrapeMaterial` promises (and surface them to the user
  with a visible error banner instead of silent drop).

### 2026-04-06 — Data-quality/UX audit fixes (filter buckets + pill ranking)

**Filter classification (FILTER_CACHE):**
- Bug: 9 legitimate perfumery solvents/carriers/antioxidants (Dipropylene
  Glycol, Isopropyl Myristate, Propylene Glycol, Squalane, MCT Oil,
  Isododecane, Tocopherol, Guaiazulene, and Isododecane) had empty
  `odor.description`/`odor.type` fields in the DB, so the old
  `hasPerfumery = odor.description || odor.type || MIXTURES.has(cas)`
  check excluded them. They correctly had `funcRole = solvent/carrier/_other`,
  but that wasn't consulted.
- Fix: Extended `hasPerfumery` to also be true when `funcRole` is truthy.
  8 of 9 orphans now correctly appear under "perfumery"/"cosmetics" filter
  tags. Bergaptene remains excluded (correct: a phototoxin that must be
  removed from finished products, not a perfumery ingredient).

**Pill ranking (PREFIX_IX):**
- Bug: Sort comparator used pure `b.name.length - a.name.length`, so
  long latin/scientific synonyms like "dipteryx odorata absolute" ranked
  before direct canonical matches like "dipropylene glycol" when user
  typed "dip".
- Fix: Prefer canonical-name matches first (where the indexed name
  equals the DB canonical name), falling back to longer-first as a
  tiebreaker. Verified: "dip" now shows Dipropylene Glycol first;
  "lin"/"hed"/"iso"/"osm"/"ros"/"cou" all place canonical matches ahead.

**DB consistency audit:**
- 403 entries, 0 duplicate CAS, 0 duplicate canonical names, 0 empty
  CAS, 0 non-array synonyms/blends_with, 0 invalid CAS format, 0
  blacklisted terms still in TRADES/NAME_TO_CAS indexes.
- Flagged (left unchanged per audit constraints): 3 name collisions
  between NAME_TO_CAS and TRADES (`tonka bean`, `ambergris`,
  `norlabdane oxide`) — these require chemistry judgment.

### 2026-04-05 — Fix ReferenceError in classifyIndustryTags crashing non-banned aromatic materials

**Bug:** `classifyIndustryTags()` used `id.fema` on line 2281 but never declared
an `id` variable (only `cas` was extracted from `r.identifiers`). This caused a
`ReferenceError` that was silently swallowed by `Promise.allSettled` in `doSearch`,
dropping the material from results entirely.

**Why only some materials were affected:**
- Hedione / Iso E Super: `hasRealOdor=true`, `banned=false` → entered the
  perfumery block → hit `id.fema` → crash
- Dipropylene Glycol: `isSolvent=true` → `hasRealOdor=false` → never entered
  the perfumery block → no crash
- Lilial: `banned=true` → `!banned` short-circuited before `id.fema` → no crash

**Fix:** Added `const id = r.identifiers || {};` and derived `cas` from `id.cas`
instead of a separate destructure.

### 2026-04-05 — Final Smoke Test (post-normalizeKey hardening)

All 10 test cases traced end-to-end through the search pipeline — PASS:

| # | Case | Matcher hit | Verified |
|---|------|------------|----------|
| 1 | canonical name `"linalool"` | matchByCanonicalName → _applyLocalMatch (normalizeKey) | card rendered, name_exact 99% |
| 2 | synonym `"linalol"` | matchBySynonym → NAME_TO_CAS | card rendered, synonym_exact 95% |
| 3 | trade name `"iso e super"` | matchByCanonicalName → _applyLocalMatch (normalizeKey) | card rendered, name_exact 99% |
| 4 | CAS `"78-70-6"` | matchByCAS → DB direct | card rendered, cas_exact 99% |
| 5 | blacklisted `"alcohol"` | blocked by SYNONYM_BLACKLIST | no card, correct |
| 6 | blacklisted `"musk"` | blocked by SYNONYM_BLACKLIST | no card, correct |
| 7 | ambiguous fuzzy `"geran"` | matchFuzzyLocal → candidates 0.6+ but <0.8 | "Did you mean?" shown |
| 8 | pill click `doSearch('Linalool')` | normalizeInput → matchByCanonicalName | card rendered |
| 9 | CAS dedup (linalool then linalol) | CAS dedup filter keeps newest | 1 card, no dupes |
| 10 | clearAll then re-search | results=[] → renderResults clears DOM → doSearch works | card rendered |

No additional bugs found. normalizeKey() correctly prevents mixed-case
match.term from breaking TRADES/NAME_TO_CAS/SYN_IX lookups in all paths.

### 2026-04-05 — normalizeKey() hardening for index lookups

**Bug:** mixed-case `match.term` (e.g. `"Linalool"` from `matchByCanonicalName`)
was used directly to look up in `TRADES`, `NAME_TO_CAS`, and `SYN_IX` — all
keyed by lowercase strings. The lookup returned `undefined`, causing
`_applyLocalMatch()` to discard valid local matches. Search results never
rendered because no material was added to the `results` array.

**Fix:**
- Added `normalizeKey(v)` helper that lowercases and trims any lookup term.
- Applied `normalizeKey()` consistently in all matcher functions and
  `_applyLocalMatch()` for every `TRADES[…]`, `NAME_TO_CAS[…]`, `SYN_IX[…]`
  lookup, ensuring no mixed-case term can ever break index resolution.
- Functions updated: `matchByCAS`, `matchBySynonym`, `matchByTradeName`,
  `matchByAlias`, `matchFuzzyLocal`, `_applyLocalMatch`, `applyPerfumery`.

### 2026-04-05 — Canonical Record as Primary Source of Truth

**Canonical record is now the runtime source of truth:**
- `createResult(name)` builds `{record, found, ...ui}` where `record`
  contains: identifiers, names, properties, perfumery, safety,
  classification, match, metadata
- All business data lives in `record.*` — the nested canonical shape
- Flat accessors (`mat.cas_number`, `mat.odor_description`, etc.) are
  `Object.defineProperties` getters/setters that delegate to `record.*`
- Render templates read `mat.cas_number` which transparently reads
  `record.identifiers.cas` — zero template changes needed
- UI-only transient state (`_open`, `structure_image_url`, `page_url`,
  `match_info`, `_loadPubchem`, `_ghsCodes`) remains outside `record`

**Export reads from canonical record directly:**
- `downloadJSON` now reads `mat.record` (aliased as `src`) instead of
  rebuilding from flat mat.* fields
- No more `parseFloat(mat.molecular_weight)` — values are already
  numbers in `record.properties.*`
- PubChem sections fallback reads `src.metadata.pubchem_sections`

**Note:** Accessor proxies were introduced in this pass but subsequently
removed entirely in the final hardening pass. All reads/writes now go
through `mat.record.*` directly. See final architecture status above.

### 2026-04-05 — In-Place Architecture Migration (Tasks 1-2)

**Filter layer decoupled from raw DB shape:**
- Created `FILTER_CACHE` (Map<CAS, FilterRecord>) at startup
- FilterRecord precomputes: noteLow, materialType, funcRole, odorTags,
  hasNoOdorType, hasPerfumery, hasFlavor, funcAll, allText
- `matchesAllFilters()` now reads exclusively from FILTER_CACHE
- `_updateFilterVisibility()` iterates FILTER_CACHE, uses precomputed
  materialType/funcRole/odorTags (no more regex in hot loops)
- Removed all `entry._allText`, `entry._noteLow`, `entry._funcAll`,
  `entry._odorTypeLow`, `entry._hasRealOdor`, `entry._desc` from DB entries
- DB entries are now clean raw data, filter layer is fully decoupled

**Schema normalization completed:**
- mat init uses null for all structured fields (not empty string)
- _applyPubchemProps stores numbers as native JS numbers
- Synonyms cap raised from 15 → 30
- Export uses `??` null-coalescing instead of parseFloat/parseInt
  (properties are already numbers from PubChem)

**Precomputed classification:**
- _computeClassification(mat) sets _material_type and _industry_tags once
- Called at: _applyLocalMatch, _enrichPubchem callback, PubChem path end
- Render and export use cached values with fallback

**Module organization (in-place):**
- Added ═══ MODULE headers throughout index.html:
  Data Layer, Normalized Filter Cache, Filter State, Filter Matching,
  UI Event Bindings, Search Orchestration, Search Matchers,
  Rendering, Classification, JSON Export, Print/PDF

**Physical file split intentionally deferred:**
- `<script type="module">` would break `file://` local usage
- GitHub Pages serves .js correctly but local dev needs a server
- Logical module separation achieved via headers; physical split
  deferred until project moves to a dev server workflow

**Remaining technical debt:**
- Full nested record.identifiers/perfumery/safety shape not yet primary
  internal shape (mat.* flat fields still used in render templates)
- A view-model bridge would be needed to fully replace mat.* in render
  without rewriting all template strings
- buildLocalRecord still reconstructs from mat.* for JSON sections
- PubChem section extraction (extractAllSections) still uses raw format

### 2026-04-05 — Search Pipeline Refactor (P0+P1)

**Files changed:** `index.html`, `perfumery_data.js`, `REFACTOR_PLAN.md`

**Search accuracy improvements:**
1. Replaced monolithic `scrapeMaterial()` with modular matcher pipeline:
   - `matchByCAS()` → `matchByCanonicalName()` → `matchBySynonym()` → `matchByTradeName()` → `matchByAlias()` → `matchFuzzyLocal()` → PubChem fallbacks
2. Each matcher returns structured `MatchResult` with `{type, confidence, input, term, canonical, reason, source, ambiguous_candidates}`
3. Fuzzy threshold raised from 0.6 → 0.8 (prevents false positives)
4. Synonym blacklist blocks generic terms: "pea", "pg", "alcohol", "oil", "musk", "acid", "ester", "water", "base", "note", "top"
5. Risky synonyms ("ipm", "dpg", "mdj", "ies", "oud") get reduced confidence (0.80 vs 0.95)
6. Ambiguous matches (below threshold) return candidates instead of silently picking wrong compound
7. "Did you mean?" UI shows clickable suggestions for ambiguous results
8. Match type + confidence % shown on each result card: `[trade_exact, 99%]`
9. Fixed `bestScore` undefined bug in old fuzzy match confidence calculation
10. Deduplication by CAS in fuzzy candidate list

**Data cleanup:**
- Removed DEET (insecticide), Hyraceum (empty CAS), Benzisothiazolinone, Phenoxyethanol from DB
- Removed blacklisted synonyms from trade_names index
- DB: 403 entries, 916 trade names

**Bugs fixed:**
- `bestScore` variable referenced outside `fuzzyMatchDB()` scope → now returned from matcher
- Empty CAS entries could crash indexing → removed
- Generic synonyms like "alcohol" matched Ethanol instead of showing error → blacklisted

**What remains for later:**
- Full schema migration (Section B) to typed record with null instead of ""
- Numeric fields stored as strings → should be numbers
- Precomputed classification caching
- File structure separation
- `ambiguous_candidates` in JSON export

---

## A. สรุปปัญหา

### Data Schema
1. **Empty string vs null** — ทุก field ใช้ `""` ทั้ง "ยังไม่โหลด" และ "ไม่มีข้อมูล" แยกไม่ได้
2. **Numeric fields เก็บเป็น string** — `molecular_weight: "236.39"` ต้อง parseFloat() ก่อนใช้
3. **Odor source ปนกัน** — `odor_description` มาจากทั้ง local DB และ PubChem ไม่แยก
4. **Classification computed ซ้ำ** — `classifyMaterialType()` + `classifyIndustryTags()` ทำ regex เดียวกันหลายรอบ
5. **Synonyms capped ที่ 15** — สูญเสียข้อมูลโดยไม่จำเป็น

### Search/Matching
1. **Fuzzy threshold 0.6 ต่ำเกินไป** — substring match กับชื่อสั้นๆ ผิดง่าย
2. **Generic synonyms อันตราย** — "pea" → Phenylethyl Alcohol, "alcohol" → Ethanol
3. **Empty CAS** — Hyraceum มี CAS ว่าง จะ crash ถ้า match
4. **SID fallback ไม่น่าเชื่อถือ** — ได้สารผิดบ่อย
5. **Trade name mutations** — ol↔ool swap อาจ match ผิดสาร
6. **ไม่มี confidence scoring** — ทุก match เท่ากัน ไม่ว่าจะ exact CAS หรือ fuzzy

---

## B. Schema ใหม่

### B.1 Canonical Record (1 material = 1 record)

```json
{
  "id": "cas:78-70-6",
  "identifiers": {
    "cas": "78-70-6",
    "fema": "2635",
    "pubchem_cid": 6549,
    "iupac": "3,7-dimethylocta-1,6-dien-3-ol",
    "canonical_smiles": "CC(=CCCC(C)(C=C)O)C",
    "isomeric_smiles": "CC(=CCC/C(=C\\C)O)C",
    "inchi": "InChI=1S/C10H18O/c1-5-10(4,11)8-6-7-9(2)3/h5,7,11H,...",
    "molecular_formula": "C10H18O"
  },
  "names": {
    "canonical": "Linalool",
    "pubchem_title": "Linalool",
    "synonyms": ["linalool", "linalol", "beta-linalool"],
    "trade_names": ["linalool", "linalol", "beta-linalool"],
    "blacklisted_synonyms": []
  },
  "properties": {
    "molecular_weight": 154.25,
    "exact_mass": 154.135765,
    "xlogp": 2.7,
    "tpsa": 20.2,
    "hbond_donor": 1,
    "hbond_acceptor": 1,
    "rotatable_bonds": 4,
    "heavy_atoms": 11
  },
  "perfumery": {
    "odor": {
      "description": "Fresh, floral, woody with light citrus and lavender nuances",
      "type": ["Floral", "Fresh", "Woody"],
      "strength": "Medium",
      "strength_scale": 3,
      "source": "local_db"
    },
    "note": "Top",
    "performance": {
      "tenacity": "Low — volatile top note",
      "duration_text": "~2 hours",
      "duration_hours": 2
    },
    "blends_with": ["Lavender", "Bergamot", "Rosewood"]
  },
  "safety": {
    "ifra_status": "restricted",
    "ifra_guideline": "Restricted — oxidized linalool is a sensitizer",
    "ifra_51_limits": {
      "Fine Fragrance": 16,
      "Body lotion": 4.3,
      "Axillae": 0.9
    },
    "ban_status": null,
    "ghs_codes": ["GHS07", "GHS09"],
    "ghs_source": "pubchem_markup"
  },
  "classification": {
    "material_type": "single_molecule",
    "is_mixture": false,
    "function": "aromatic",
    "industry_tags": ["perfumery", "flavor", "cosmetics"]
  },
  "metadata": {
    "source": "local_db",
    "last_updated": "2026-04-05",
    "data_quality_pct": 95
  }
}
```

### B.2 Field Types

| Category | Fields | Source | Mutable? |
|----------|--------|-------|----------|
| **identifiers** | cas, fema, cid, iupac, smiles, inchi, formula | PubChem + DB | No |
| **names** | canonical, pubchem_title, synonyms, trade_names | DB + PubChem | Yes (curated) |
| **properties** | mw, mass, xlogp, tpsa, hbond, rotatable, heavy | PubChem | No |
| **perfumery** | odor, note, performance, blends_with | Local DB | Yes (expert) |
| **safety** | ifra, ban_status, ghs_codes | DB + PubChem | Yes |
| **classification** | material_type, function, industry_tags | Computed | Auto |
| **metadata** | source, updated, quality | System | Auto |

---

## C. Migration Mapping (Old → New)

| Old Field | New Location | Transform |
|-----------|-------------|-----------|
| `mat.name` | `record.names.canonical` | Direct |
| `mat.cas_number` | `record.identifiers.cas` | Direct |
| `mat.fema_number` | `record.identifiers.fema` | Direct, null if empty |
| `mat._cid` | `record.identifiers.pubchem_cid` | Direct |
| `mat.molecular_weight` | `record.properties.molecular_weight` | `parseFloat()` |
| `mat.exact_mass` | `record.properties.exact_mass` | `parseFloat()` |
| `mat.xlogp` | `record.properties.xlogp` | `parseFloat()` |
| `mat.tpsa` | `record.properties.tpsa` | `parseFloat()` |
| `mat.hbond_donor` | `record.properties.hbond_donor` | `parseInt()` |
| `mat.hbond_acceptor` | `record.properties.hbond_acceptor` | `parseInt()` |
| `mat.rotatable_bond` | `record.properties.rotatable_bonds` | `parseInt()` |
| `mat.heavy_atom` | `record.properties.heavy_atoms` | `parseInt()` |
| `mat.smiles` | `record.identifiers.canonical_smiles` | Direct |
| `mat.isomeric_smiles` | `record.identifiers.isomeric_smiles` | Direct |
| `mat.iupac_name` | `record.identifiers.iupac` | Direct |
| `mat.inchi` | `record.identifiers.inchi` | Direct |
| `mat.molecular_formula` | `record.identifiers.molecular_formula` | Direct |
| `mat.synonyms` | `record.names.synonyms` | Direct (remove cap) |
| `mat.odor_description` | `record.perfumery.odor.description` | Direct |
| `mat.odor_type` | `record.perfumery.odor.type` | Split by `/` → array |
| `mat.odor_strength` | `record.perfumery.odor.strength` | Direct |
| `mat.note_classification` | `record.perfumery.note` | Direct |
| `mat.tenacity` | `record.perfumery.performance.tenacity` | Direct |
| `mat.tenacity_hours` | `record.perfumery.performance.duration_text` | Direct |
| (computed) | `record.perfumery.performance.duration_hours` | Parse from text |
| `mat.ifra_guidelines` | `record.safety.ifra_guideline` | Direct |
| `mat.usage_levels` | `record.safety.ifra_51_limits` | Parse categories |
| `mat.blends_well_with` | `record.perfumery.blends_with` | Direct |
| `mat.structure_image_url` | (UI-only, not in record) | Compute at render |
| `mat.page_url` | (UI-only, not in record) | Compute at render |
| `mat.match_info` | (UI-only, not in record) | Compute at render |
| `mat._ghsCodes` | `record.safety.ghs_codes` | Direct |
| `mat._pubchemTitle` | `record.names.pubchem_title` | Direct |
| `mat._externalPerfumery` | `record.metadata.source` | `"pubchem"` if true |
| `classifyMaterialType()` | `record.classification.material_type` | Precompute once |
| `classifyIndustryTags()` | `record.classification.industry_tags` | Precompute once |

---

## D. Matching Rules (New Pipeline)

### D.1 Match Pipeline (ordered by confidence)

```
Input → normalize(input)
  │
  ├─ Step 1: Exact CAS (regex + DB lookup)
  │   confidence: 0.99, match_type: "cas_exact"
  │
  ├─ Step 2: Exact canonical name
  │   confidence: 0.98, match_type: "name_exact"
  │
  ├─ Step 3: Exact synonym (NAME_TO_CAS)
  │   confidence: 0.95, match_type: "synonym_exact"
  │   skip if synonym in blacklist
  │
  ├─ Step 4: Exact trade name (TRADES)
  │   confidence: 0.95, match_type: "trade_exact"
  │
  ├─ Step 5: Normalized alias (dash/space swap)
  │   confidence: 0.85, match_type: "alias_normalized"
  │
  ├─ Step 6: SMILES/InChI lookup (PubChem)
  │   confidence: 0.90, match_type: "structure_lookup"
  │
  ├─ Step 7: PubChem name lookup
  │   confidence: 0.80, match_type: "pubchem_name"
  │   validate with perfumery filter
  │
  ├─ Step 8: Fuzzy match (threshold ≥ 0.8)
  │   confidence: score * 0.7, match_type: "fuzzy"
  │   if score < 0.8: return ambiguous_candidates
  │
  └─ Step 9: Not found
      return { found: false, candidates: [...top 3] }
```

### D.2 Match Result Object

```javascript
{
  found: true,
  match_type: "synonym_exact",      // which step matched
  match_confidence: 0.95,           // 0-1 score
  matched_input: "linalol",         // what user typed
  matched_term: "linalol",          // what DB entry matched
  matched_canonical: "Linalool",    // resolved name
  confidence_reason: "Exact synonym match in local DB",
  source_priority: "local_db",      // local_db > pubchem > fuzzy
  ambiguous_candidates: null        // populated if confidence < 0.8
}
```

### D.3 Function Signatures

```javascript
// Main entry point
async function findMaterial(input) → { found, match, record }

// Normalize input
function normalizeInput(raw) → string
  // lowercase, trim, remove ®™, collapse whitespace

// Step-by-step matchers
function matchByCAS(input) → MatchResult | null
function matchByCanonicalName(input) → MatchResult | null
function matchBySynonym(input, blacklist) → MatchResult | null
function matchByTradeName(input) → MatchResult | null
function matchByAlias(input) → MatchResult | null
function matchByStructure(input) → Promise<MatchResult | null>
function matchByPubChem(input) → Promise<MatchResult | null>
function matchFuzzy(input, threshold=0.8) → MatchResult | { ambiguous_candidates }

// Validation
function validatePerfumery(record) → { valid, reason }
function isPerfumeryElement(formula) → boolean
function isPerfumeryProperty(mw, tpsa, xlogp) → boolean
```

---

## E. Risky Synonyms

### E.1 Blacklist (remove from search indexes)

| Synonym | Current CAS | Why Blacklist |
|---------|------------|---------------|
| `"pea"` | — | Too generic, abbreviation |
| `"pg"` | 57-55-6 | Ambiguous abbreviation |
| `"alcohol"` | 64-17-5 | Too generic |
| `"oil"` | — | Too generic |
| `"musk"` | — | Ambiguous (many musks) |

### E.2 Mark as Risky (lower confidence)

| Synonym | Current CAS | Compound | Risk |
|---------|------------|----------|------|
| `"oud"` | 94350-09-1 | Agarwood Oil | Short, could be typo |
| `"ipm"` | 110-27-0 | Isopropyl Myristate | Abbreviation |
| `"dpg"` | 25265-71-8 | DPG | Abbreviation |
| `"bit"` | 2634-33-5 | Benzisothiazolinone | Abbreviation |
| `"mdj"` | 24851-98-7 | Hedione | Abbreviation |
| `"ies"` | 54464-57-2 | Iso E Super | Abbreviation |
| `"tec"` | 77-93-0 | Triethyl Citrate | Abbreviation |

### E.3 Empty CAS (fix or remove)

| Name | Current CAS | Action |
|------|------------|--------|
| Hyraceum | `""` | Remove from DB (no CAS available) |

### E.4 Non-Perfumery Materials (remove from DB)

| Name | CAS | Category | Action |
|------|-----|----------|--------|
| DEET | 134-62-3 | Insecticide | Remove |
| Benzisothiazolinone | 2634-33-5 | Preservative | Already removed per user |
| Phenoxyethanol | 122-99-6 | Preservative | Already removed per user |

---

## F. Code Changes Required in index.html

### F.1 Replace mat object init with typed record

```javascript
// OLD
const mat = {name, found:false, cas_number:"", fema_number:"", ...};

// NEW
function createRecord(input) {
  return {
    _input: input,
    found: false,
    match: null,  // MatchResult
    identifiers: { cas:null, fema:null, pubchem_cid:null, ... },
    names: { canonical:null, pubchem_title:null, synonyms:[], trade_names:[] },
    properties: { molecular_weight:null, ... },  // numbers, not strings
    perfumery: { odor:{description:null,type:[],strength:null,source:null}, ... },
    safety: { ifra_status:null, ban_status:null, ghs_codes:[] },
    classification: { material_type:null, function:null, industry_tags:[] },
    metadata: { source:null }
  };
}
```

### F.2 Replace scrapeMaterial with pipeline

```javascript
// OLD: 7 strategies in one huge function
async function scrapeMaterial(name) { ... 200+ lines ... }

// NEW: Pipeline of small matchers
async function findMaterial(input) {
  const normalized = normalizeInput(input);
  const record = createRecord(input);
  
  // Try matchers in order
  const matchers = [
    matchByCAS, matchByCanonicalName, matchBySynonym,
    matchByTradeName, matchByAlias
  ];
  for (const matcher of matchers) {
    const result = matcher(normalized);
    if (result) {
      record.match = result;
      record.found = true;
      applyLocalDB(record, result.cas);
      break;
    }
  }
  
  // PubChem fallbacks (async)
  if (!record.found) {
    const result = await matchByPubChem(normalized);
    if (result) {
      record.match = result;
      record.found = true;
    }
  }
  
  // Fuzzy last resort
  if (!record.found) {
    const result = matchFuzzy(normalized, 0.8);
    if (result?.ambiguous_candidates) {
      record.match = result;
      record.found = false; // let user choose
    }
  }
  
  // Enrich with PubChem
  if (record.found) await enrichFromPubChem(record);
  
  // Validate perfumery relevance
  if (record.found && !record.match?.cas_in_local_db) {
    const valid = validatePerfumery(record);
    if (!valid.valid) { record.found = false; record._notPerfumery = true; }
  }
  
  return record;
}
```

### F.3 Fix fuzzyMatchDB threshold

```javascript
// OLD
if (score > bestScore && score > 0.6) { ... }

// NEW
if (score > bestScore && score > 0.8) { ... }
// AND: skip blacklisted synonyms
// AND: return ambiguous_candidates if best score < 0.9
```

### F.4 Precompute classification

```javascript
// OLD: computed on every render/filter call
classifyMaterialType(mat)  // regex every time
classifyIndustryTags(mat)  // regex every time

// NEW: compute once when record is created
record.classification.material_type = classifyMaterialType(record);
record.classification.industry_tags = classifyIndustryTags(record);
record.classification.function = classifyFunction(record);
// Store result, never recompute
```

### F.5 Separate file structure (recommended)

```
perfume-analyzer/
├── index.html              # UI only (rendering, events)
├── perfumery_data.js        # Raw curated data (DB entries)
├── search_index.js          # Generated: PREFIX_IX, SYN_IX, TRADES
├── schema.js                # Record types, createRecord(), migration
├── matchers.js              # matchByCAS(), matchFuzzy(), etc.
├── classifiers.js           # classifyMaterialType(), classifyIndustryTags()
├── pubchem.js               # PubChem API wrappers
└── REFACTOR_PLAN.md         # This document
```

> Note: Since the app is a single HTML file, these can remain as clearly-separated
> `// ── MODULE: Search ──` sections within index.html, but the logical separation
> should be maintained.

---

## Implementation Priority

| Phase | Task | Impact |
|-------|------|--------|
| **P0** | Fix fuzzy threshold 0.6→0.8 | Prevents false matches |
| **P0** | Remove/fix empty CAS entries | Prevents crashes |
| **P0** | Blacklist generic synonyms | Prevents wrong matches |
| **P1** | Add match_type + confidence to results | Better UX |
| **P1** | Use null instead of "" for missing data | Clean semantics |
| **P1** | Store numbers as numbers | Remove parseFloat noise |
| **P2** | Precompute classification at record creation | Performance |
| **P2** | Split odor.type into array | Better filtering |
| **P2** | Add ambiguous_candidates for low-confidence | Better UX |
| **P3** | Separate file structure | Maintainability |
| **P3** | Full schema migration | Future-proof |

---

# Perfume Analyzer Refactor Plan — QA Checklist

> Permanent regression checklist. Run the relevant section after any
> refactor before merging. Each subsection is grouped by domain so a
> targeted change (e.g. only matchers) only requires re-running that
> section. The full set should be run before any release-style merge.

## A. Search pipeline smoke tests

The 10 end-to-end cases from the
[2026-04-05 Final Smoke Test](#2026-04-05--final-smoke-test-post-normalizekey-hardening)
must all still pass. Required after any refactor touching matchers,
`normalizeKey`, `_applyLocalMatch`, `FILTER_CACHE`, or `doSearch`.

| # | Input | Expected matcher | Expected confidence | Expected UI |
|---|---|---|---|---|
| 1 | `linalool` | `matchByCanonicalName` → `name_exact` | 0.99 | card rendered |
| 2 | `linalol` | `matchBySynonym` | 0.95 | card rendered |
| 3 | `iso e super` | `matchByCanonicalName` → `name_exact` | 0.99 | card rendered |
| 4 | `78-70-6` | `matchByCAS` | 0.99 | card rendered |
| 5 | `alcohol` | (blocked by `SYNONYM_BLACKLIST`) | — | no card; banner shows "not found" |
| 6 | `musk` | (blocked by `SYNONYM_BLACKLIST`); fuzzy may surface ambiguous candidates | — | no card; "Did you mean?" or "not found" banner |
| 7 | `geran` | `matchFuzzyLocal` < 0.8 | — | no card; "Did you mean?" with candidate links |
| 8 | pill click (suggestion) | identical to typing the suggestion text | matches that path | card rendered |
| 9 | CAS dedup: search `linalool` then `linalol` | both resolve to CAS `78-70-6` | — | single card, newest kept |
| 10 | `clearAll` then re-search | `results = []` → `renderResults` clears DOM → next `doSearch` works | — | new card rendered |

## B. Filters and regulatory logic

### Standard filters (Note / Type / Function / Use / Odor)

Manually exercise at least one combination from each filter group:

- **Note:** `Top`, `Middle`, `Base`, `Other`
- **Type:** `Aroma Chemical`, `Natural Extract`, `Natural Isolate`
- **Function:** `Aromatic`, `Fixative`, `Solvent`, `Carrier`, `Additive`
- **Use:** `Perfumery`, `Flavor`, `Cosmetics`
- **Odor:** at least one tag from the auto-built list

For each combination verify:
- Result counts visibly change as filters are toggled.
- Filter options that match zero materials are hidden by `_updateFilterVisibility`.
- Combining filters across groups behaves as logical AND.

### Regulatory filter (Banned / Restricted)

Selecting **Regulatory → Banned / Restricted** must yield exactly **4** materials from the current DB:

| Material | Scope |
|---|---|
| Musk Ambrette | `worldwide` |
| Lilial | `eu` |
| Lyral | `eu` |
| Musk Xylene | `eu` |

The same 4 materials must:
- Render the **banned badge** in the card body.
- Export with a **non-null `ban_status`** in both the JSON `ban_status` field and the CSV `ban_status` column.

If any of these regress, audit `BANNED_CAS` precompute (built once at startup from `getBanStatus`) and the card-render ban-detection path.

## C. Export (JSON / CSV)

### JSON export (`Save.JSON` → `downloadJSON`)

- Each exported record reads from `src = mat.record` (canonical record), not from flat `mat.*` fields.
- `classification.function` matches `FILTER_CACHE.get(cas)?.funcRole` for every known CAS (single source of truth — Task C).
- `metadata.source`, `metadata.is_external`, `metadata.has_pubchem_sections`, and `metadata.data_quality_pct` are all present and `metadata.data_quality_pct` equals top-level `data_completeness_pct`.
- `record.match` is a nested object containing `type`, `confidence`, `input`, `term`, `canonical`, `reason`, `source`, and `ambiguous_candidates`.
- Backwards-compat: every previously-exported flat top-level field (`cas_number`, `fema_number`, `material_type`, `industry_tags`, `pubchem_url`, `structure_image_url`, `is_external_perfumery`, etc.) is still present.

### CSV export (`Save.CSV` → `downloadCSV`)

Header row must contain exactly these 9 columns in order:

```
cas_number, name, material_type, function, ban_status, note, odor_description, usage_levels, industry_tags
```

Sample row spot-check:

| Material | `function` | `ban_status` | `odor_description` | `usage_levels` |
|---|---|---|---|---|
| Linalool | `_aromatic` | empty | non-empty (commas → quoted) | IFRA 51 string |
| Dipropylene Glycol | `solvent` | empty | empty cell | "Used as solvent at 10–50 %" |
| Lilial | `_aromatic` | `eu` | non-empty (commas → quoted) | IFRA prohibition text |

Verify:
- Fields containing commas, double quotes, `\r`, or `\n` are wrapped in double quotes; internal quotes are doubled (RFC 4180).
- Array-typed cells (`industry_tags`) are joined with `;` so they never break a row.
- The file starts with a UTF-8 BOM (`\uFEFF`) so Excel opens it in UTF-8 mode.
- Line endings are `\r\n`.

## D. Status bar and UX text

### Batch summary override (Task B — one-shot consumption)

After a search where some inputs were ambiguous or not-perfumery:

- **First render** (immediately after `doSearch`): `N materials • X ambiguous, Y outside perfumery scope.`
- **Next background re-render** (e.g. from `_enrichPubchem`): `N materials` — override has been consumed and cleared.
- A subsequent clean search: `N materials` (no override set, no stale text).

If the override survives a second render, audit the one-shot clear inside `renderResults`.

### Quick stats (banned / external)

On the default (non-override) path, the status text appends compact counts:

| Result set | Status text |
|---|---|
| Clean (0 banned, 0 external) | `N material(s)` |
| 1 banned, 0 external | `N material(s) • 1 banned` |
| 0 banned, 2 external | `N material(s) • 2 external` |
| 1 banned, 2 external | `N material(s) • 1 banned • 2 external` |

Both counts use existing globals only (`getBanStatus`, `mat.record.metadata.is_external`); the override and quick-stat paths are mutually exclusive (override takes precedence on the first render).

## E. Layout & mobile

### Desktop (≥ 1024px)

- Header (title + subtitle + theme toggle), search box, filter drawer, and result cards render without horizontal overflow.
- Theme toggle is at the top-right of the header row and clicks flip `data-theme` between `light` and `dark` on `<html>`.
- All filter sub-drawers expand/collapse as expected.

### Mobile (~375px width)

- **No horizontal scroll** anywhere in the header + search area.
- Title and subtitle wrap cleanly; theme toggle stays visible at the top-right and never collides with the title block.
- Search input + button **stack vertically**, both full-width, both with comfortable touch-target height (≥ 44px from existing padding).
- Filter drawer collapses to vertical layout without breaking sub-toggles.

If the header/search area overflows on mobile, audit `@media (max-width:600px)` rules for `.header-row`, `.search-box`, `#themeToggle`, and `min-width:0` on flex children.

## F. Print / PDF

`Save.PDF` and `Save.PDF (Full)` (both call `preparePrint`) must produce:

- **Hidden in print:** search box, filter drawer, status bar, downloads bar, theme toggle, card delete buttons, card arrows, "Complete PubChem Data" toggles, "Back to title" links.
- **Visible in print:** card headers, card bodies (forced open via `.card-body { display:block !important }`), names, identifiers, properties, perfumery sections, safety sections, hazard pictograms (where present).
- One card per page break point (`.card { break-before:page }`), except the first card uses `break-before:auto`.
- `Save.PDF (Full)` waits for all unloaded `loadPubchemData(idx)` calls to complete before triggering `window.print()`.
- After printing, removed elements are restored to the DOM via the `cleanup` function bound to `afterprint`.

If any of the hidden elements appear in print output, audit the `@media print` block (currently around lines 192–220) and the DOM removal/restoration logic in `preparePrint`.

## G. Taxonomy Migration (Steps 1–6)

A six-step refactor moved the odor / classification system from a
single closed-list odor-family axis to a three-field primary /
secondary / facets taxonomy. Every step was additive and backward
compatible — no existing field was renamed or removed, no existing
consumer broke.

### Axes

| Field | Type | Cap | Source of truth |
|---|---|---|---|
| `classification.material_type` | string | 1 | `classifyMaterialType(mat)` |
| `classification.functions` | string[] | closed set | `classifyFunctionsFromRecord` + FILTER_CACHE |
| `classification.uses` (alias `industry_tags`) | string[] | closed set | `classifyUses(mat)` |
| `classification.regulatory` | string[] | closed set | `classifyRegulatory(mat)` |
| `classification.source` | string | 1 | `classifySource(mat)` |
| `classification.primaryFamilies` | string[] | 1–3 | `_inferTaxonomy(mat)` (Step 2) |
| `classification.secondaryFamilies` | string[] | 0–3 | `_inferTaxonomy(mat)` (Step 2) |
| `classification.facets` | string[] | 0–8 | `_inferTaxonomy(mat)` (Step 2) |
| `classification.odor_families` | string[] | legacy 17-family | `classifyOdorFamilies(mat)` — **retained for backwards compat** |

### Step-by-step

**Step 1 — foundation (additive constants + helpers).**
Added `PRIMARY_FAMILIES` (22 canonical family ids), `FACET_TAGS` (180+
facet → parent-family map including family self-references),
`TAXONOMY_SYNONYMS` (adjective and compound-phrase folds like
`musky → musk`, `ambery → amber`, `peach_skin → peach`), and the pure
helpers `normalizeTaxonomyToken`, `uniqStable`, `sortByCanonicalOrder`,
`tokenizeOdorSources`. All hoisted above FILTER_CACHE init so the
module-init pass can read them. No wiring into render, filters, or
exports.

**Step 2 — classifier + record wiring.**
Added `_inferTaxonomy(matOrRecord)` (three-pass inference — odor_type
strongest, odor_description medium, blends_with / name / synonyms
weakest; caps 3/3/8; specificity override `leather > animalic`;
conservative `gourmand` guard that requires an explicit gourmand
facet to survive). Thin public wrappers `classifyPrimaryFamilies`,
`classifySecondaryFamilies`, `classifyFacets`. Extended
`record.classification` with `primaryFamilies`, `secondaryFamilies`,
`facets`. `_computeClassification` calls `_inferTaxonomy` once per
material and writes all three fields. Anchor validation (10 hand-crafted
odor_type examples from `Leather Smoky` to `Aldehydic Waxy`) passed 10/10.

**Step 3 — legacy migration parser + FILTER_CACHE precompute.**
Added `migrateLegacyTaxonomy(entry)` — the single conversion point
from raw `perfumery_data.js` entry shape to the new taxonomy arrays.
`_buildFilterRecord` now calls it once per CAS at module init and
stores `primaryFamilies / secondaryFamilies / facets` on every
FILTER_CACHE entry. `_computeClassification` prefers the FILTER_CACHE
precompute over a fresh `_inferTaxonomy` call when the CAS hits the
local DB, so inference runs ONCE per CAS at module init and never
inside `matchesAllFilters`, `_updateFilterVisibility`, or render. A
diagnostic `console.warn` fires if a perfumery candidate (hasRealOdor
|| in MIXTURES) ends up with zero primary families — vehicles and
additives are excluded so the console doesn't spam.

**Step 4 — filter logic (no UI change yet).**
Added `activePrimaryFamilyFilters` and `activeFacetFilters` Sets
alongside the legacy `activeOdorFilters`. Extended `matchesAllFilters`
to AND the new groups on top of every other axis, with **OR inside
each group**. Scaffolding helpers `togglePrimaryFamilyFilter`,
`clearPrimaryFamilyFilters`, `toggleFacetFilter`, `clearFacetFilters`
added for the upcoming UI wiring. 11-case matching-logic unit test
passed 11/11.

**Step 5 — UI wiring.**
Replaced the legacy Odor Family pill sub-drawer with two new
multi-select drawers: **Primary Family** (22 chips, but only families
present in at least one DB entry are rendered → 20 chips in the
current DB) and **Facet** (grouped by parent family in canonical
order, 20 groups, 133 distinct chips in the current DB). Each group
gets a small uppercase header so the chip cloud is scannable on
mobile. `_updateFilterVisibility` now hides chips and entire facet
groups that would have zero count under the current filter combo.
Result cards gained three new badge rows in the body: **Primary**
(strong accent-fill badge), **Secondary** (lighter muted badge),
**Facets** (small transparent chip). The original curated odor
description text in the Odor section is preserved unchanged.

**Step 6 — export + docs + smoke-test pass.**
JSON export `classification` nested view now emits `primaryFamilies`,
`secondaryFamilies`, and `facets` alongside the legacy `odor_families`
array. `odor_families` is explicitly retained so older consumers that
still read the single-axis odor list don't break. Ran a 20-material
smoke test covering balsamic / gourmand / aquatic / aldehydic /
leather / camphoraceous / amber / musk / woody / sweet archetypes —
all produced reasonable primary / secondary / facet assignments.
Applied one tight refinement: the tokenizer's inner-snake_case
expansion now skips when the whole compound already resolves to a
FACET_TAGS key or a TAXONOMY_SYNONYMS fold, which prevents compounds
like `peach-skin` from leaking a spurious `skin → animalic` tag onto
Gamma Undecalactone while still letting Ambroxan's `skin-like` expand
and carry its `skin` facet.

### Backward compatibility invariants
- `ODOR_FAMILY_VALUES` / `ODOR_FAMILY_KEYWORDS` / `classifyOdorFamilies`
  — still defined, still called by `_computeClassification`, still
  populate `FILTER_CACHE.odorFamilies` and `classification.odor_families`.
- `activeOdorFilters` Set — still defined, no UI populates it after
  Step 5, the empty-Set branch in `matchesAllFilters` keeps it inert.
- JSON / CSV export columns — `classification.odor_families` still
  emitted; new fields added next to it, no rename, no removal.
- `FILTER_CACHE` shape — new fields added; existing fields unchanged.
- `record.classification` shape — new fields added; existing fields
  unchanged.
- Search / PubChem fetch / card expand / print / PDF pipelines — all
  untouched.
