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

## CHANGELOG

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
