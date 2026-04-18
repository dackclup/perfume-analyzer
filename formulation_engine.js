// ============================================================
// formulation_engine.js — Calculation Engines for Perfume
// Formulation Lab
// ============================================================
// Part 3a: Shared utilities (parsers, helpers, constants)
// Part 3b: System 5 — IFRA Safety & Compliance
// Part 3c: System 3 — Compatibility Graph & Allocation
// Part 3d: System 1 — Thermodynamics & Evaporation
// Part 3e: System 2 — Psychophysics & Odor Perception
// Part 3f: System 4 — Chemical Dynamics & Maturation
// Part 3g: System 6 — Aromachology & Mood
// ============================================================

"use strict";

// ─── LRU-ish memoization helper (bounded cache for pure functions) ─────
// Used to wrap heavy computations whose result depends only on explicit
// arguments (simulateEvaporation, buildVPTable, buildOdorValueTable).
// Caller provides a deterministic string key function.
function _memoize(fn, keyFn, maxSize) {
  maxSize = maxSize || 8;
  const cache = new Map();
  const wrapped = function() {
    const key = keyFn.apply(null, arguments);
    if (cache.has(key)) {
      // Mark recently-used by re-inserting
      const v = cache.get(key);
      cache.delete(key);
      cache.set(key, v);
      return v;
    }
    const v = fn.apply(this, arguments);
    cache.set(key, v);
    // Evict oldest when over capacity
    if (cache.size > maxSize) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    return v;
  };
  wrapped._cache = cache;
  wrapped._clear = () => cache.clear();
  return wrapped;
}

// Build a content-based key for a materials array — safe because the cache
// holds structured return values; two calls with identical content yield
// identical results. Uses CAS + pct only; `data` is effectively immutable
// across a session (pulled from the DB on add).
function _materialsKey(materials) {
  if (!materials || !materials.length) return '<empty>';
  let s = '';
  for (const m of materials) {
    s += (m.cas || '') + ':' + (m.pct == null ? '' : m.pct.toFixed(4)) + '|';
  }
  return s;
}

// ─────────────────────────────────────────────────────────────
// SHARED UTILITIES
// Kept in sync with the parse/classify helpers in index.html so the
// formulation page can be loaded standalone without pulling in the
// materials-browser script bundle.
// ─────────────────────────────────────────────────────────────

// Gas constant (J / mol·K)
const R_GAS = 8.314;

// Parse usage range — supports "0.1–2 %" and "IFRA 51: X% ... / Y% ..."
function parseUsageRange(s) {
  if (!s) return { min: null, max: null };
  const mRange = s.match(/([\d.]+)\s*[–\-]\s*([\d.]+)\s*%/);
  if (mRange) return { min: parseFloat(mRange[1]), max: parseFloat(mRange[2]) };
  const allPcts = [...s.matchAll(/([\d.]+)\s*%/g)].map(m => parseFloat(m[1]));
  if (allPcts.length) return { min: Math.min(...allPcts), max: Math.max(...allPcts) };
  return { min: null, max: null };
}

// Parse IFRA 51 category limits: "IFRA 51: 16% Fine Fragrance / 4.3% Body lotion"
// → { "Fine Fragrance": 16, "Body lotion": 4.3 }
function parseIFRA51(s) {
  if (!s || !s.includes('IFRA 51')) return null;
  const limits = {};
  const pairs = s.replace(/^IFRA 51:\s*/i, '').split('/').map(p => p.trim());
  for (const p of pairs) {
    const m = p.match(/([\d.]+)%\s+(.+)/);
    if (m) limits[m[2].trim()] = parseFloat(m[1]);
  }
  return Object.keys(limits).length ? limits : null;
}

// Ordinal scale for odor strength text → 0-5 number.
// Order matters: composite strings like "medium to high" must be tested
// before their substrings ("high", "medium") so they don't short-circuit
// into the wrong bucket.
function odorStrengthScale(s) {
  if (!s) return null;
  const sl = s.toLowerCase();
  if (sl.includes('extremely high')) return 5;
  if (sl.includes('very high'))      return 5;
  if (sl.includes('medium to high')) return 3.5;
  if (sl.includes('high'))           return 4;
  if (sl.includes('low to medium'))  return 2;
  if (sl.includes('medium'))         return 3;
  if (sl.includes('low'))            return 1;
  if (sl.includes('none'))           return 0;
  return null;
}

// One-hot note classification
function noteOneHot(s) {
  if (!s) return { is_top: false, is_middle: false, is_base: false };
  const sl = s.toLowerCase();
  return {
    is_top:    sl.includes('top'),
    is_middle: sl.includes('middle') || sl.includes('mid') || sl.includes('heart'),
    is_base:   sl.includes('base'),
  };
}

// Classify note text into canonical tier(s)
function classifyNoteTier(note) {
  if (!note) return [];
  const n = note.toLowerCase();
  const tiers = [];
  if (n.includes('top'))    tiers.push('top');
  if (n.includes('middle') || n.includes('mid') || n.includes('heart')) tiers.push('middle');
  if (n.includes('base'))   tiers.push('base');
  return tiers.length ? tiers : [];
}

// Get primary note tier (first match)
function primaryNoteTier(note) {
  const tiers = classifyNoteTier(note);
  return tiers[0] || null;
}

// Clamp a number between min and max
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// Round to N decimal places
function roundN(val, n) {
  const f = Math.pow(10, n);
  return Math.round(val * f) / f;
}

// Resolve a material name to CAS using DB, NAME_TO_CAS, TRADES, and BLEND_TARGET_RESOLUTION
// This function expects these globals to be available from the page context
function resolveNameToCAS(name) {
  if (!name) return null;
  const nl = name.toLowerCase().trim();

  // Direct DB lookup by canonical name
  if (typeof DB !== 'undefined') {
    for (const [cas, entry] of Object.entries(DB)) {
      if (entry.name.toLowerCase() === nl) return cas;
    }
  }

  // NAME_TO_CAS index (synonyms)
  if (typeof NAME_TO_CAS !== 'undefined' && NAME_TO_CAS[nl]) {
    return NAME_TO_CAS[nl];
  }

  // TRADES index (trade names)
  if (typeof TRADES !== 'undefined' && TRADES[nl]) {
    const tradeCAS = TRADES[nl];
    // TRADES maps name → CAS directly
    if (typeof DB !== 'undefined' && DB[tradeCAS]) return tradeCAS;
    return tradeCAS;
  }

  // BLEND_TARGET_RESOLUTION fallback
  if (typeof BLEND_TARGET_RESOLUTION !== 'undefined' && BLEND_TARGET_RESOLUTION[nl] !== undefined) {
    return BLEND_TARGET_RESOLUTION[nl]; // may be null for group terms
  }

  return null;
}

// Get a material's primary families (from enriched data or DB lookup)
function getMaterialFamilies(matData) {
  // Try enriched data first
  if (matData.primaryFamilies && matData.primaryFamilies.length) {
    return matData.primaryFamilies;
  }
  // Fallback: infer from odor_type
  if (matData.odor_type) {
    const parts = matData.odor_type.toLowerCase().split(/\s*[\/,]\s*/);
    return parts.map(p => p.trim()).filter(Boolean);
  }
  return [];
}

// ─────────────────────────────────────────────────────────────
// SYSTEM 5: IFRA Safety & Compliance Engine
// ─────────────────────────────────────────────────────────────

/**
 * Check IFRA compliance for a formulation.
 * @param {Array} materials - [{cas, name, pct, data:{usage_levels, ifra_guideline, ...}}]
 * @param {string} categoryId - IFRA category key (e.g. "4" for Fine Fragrance)
 * @param {number} fragPct - Fragrance concentration in finished product (e.g. 15 for 15%)
 * @returns {Array} [{cas, name, pctInConcentrate, pctInProduct, ifraMax, compliant, margin, status, banStatus}]
 */
function checkIFRACompliance(materials, categoryId, fragPct) {
  const cat = IFRA_CATEGORIES[categoryId];
  if (!cat) return [];

  return materials.map(mat => {
    const usage = mat.data?.usage_levels || null;
    const ifraText = mat.data?.ifra_guideline || '';

    // Parse IFRA 51 structured limits
    const ifra51 = parseIFRA51(usage);
    const usageRange = parseUsageRange(usage);

    // Actual % in finished product
    const pctInConcentrate = mat.pct || 0;
    const pctInProduct = roundN(pctInConcentrate * (fragPct / 100), 4);

    // Determine max allowed %
    let ifraMax = null;
    let ifraSource = null;
    let banStatus = null;

    // Authoritative: centralised IFRA_51_LIMITS[cas] overrides any
    // text-parsed value. Supports two shapes:
    //   { "<catId>": <pct> }          — numeric Cat-specific cap
    //   { prohibited: true, reason }  — banned across every category
    // Lets curated per-CAS rules (e.g. Lavender Absolute Cat.4 @ 6.66%,
    // 7-Methoxycoumarin fully prohibited) land deterministically even
    // when the material's free-text `safety.ifra` is narrative.
    if (typeof IFRA_51_LIMITS !== 'undefined' && IFRA_51_LIMITS[mat.cas]) {
      const entry = IFRA_51_LIMITS[mat.cas];
      if (entry.prohibited === true) {
        ifraMax = 0;
        ifraSource = 'IFRA 51 table (prohibited)';
        // Use 'banned' so the existing UI red-badge path fires
        // (formulation.html:2216, :2970). The table's `prohibited:
        // true` shape is the authoritative signal; 'banned' is the
        // engine's existing vocabulary for the same idea.
        banStatus = 'banned';
      } else if (entry[categoryId] != null) {
        ifraMax = entry[categoryId];
        ifraSource = 'IFRA 51 table (Cat.' + categoryId + ')';
      }
    }

    if (ifraMax === null && ifra51 && cat.key) {
      // Try exact category key match
      ifraMax = ifra51[cat.key] ?? null;
      if (ifraMax !== null) ifraSource = 'IFRA 51 (' + cat.key + ')';
    }

    // Fallback: try matching partial key names
    if (ifraMax === null && ifra51) {
      for (const [k, v] of Object.entries(ifra51)) {
        if (cat.name.toLowerCase().includes(k.toLowerCase()) ||
            k.toLowerCase().includes(cat.name.split(/[\s\/]/)[0].toLowerCase())) {
          ifraMax = v;
          ifraSource = 'IFRA 51 (' + k + ')';
          break;
        }
      }
    }

    // Detect ban status from IFRA guideline text AND usage text.
    // Many banned materials (Lilial, Lyral, Musk Xylene/Ambrette, Bergaptene)
    // have the "Prohibited"/"must not be used" phrasing in `safety.usage`
    // rather than in `safety.ifra`, so we must check both.
    // (banStatus was initialised above and may already be 'prohibited'
    //  from the IFRA_51_LIMITS table lookup.)
    const ifraLower = (ifraText || '').toLowerCase();
    const usageLower = (usage || '').toLowerCase();
    // Strip "no restriction"/"no restrictions"/"not restricted"/"not banned"
    // so negations don't false-positive below.
    const bothLower = (ifraLower + ' ' + usageLower)
      .replace(/no\s+restrict\w*/g, '')
      .replace(/not\s+restrict\w*/g, '')
      .replace(/no\s+prohibit\w*/g, '')
      .replace(/not\s+banned/g, '')
      .replace(/unregulated/g, '')
      .replace(/no\s+limit/g, '');
    if (/\bbanned\b|\bprohibit/.test(bothLower) ||
        /must not be used/.test(bothLower) ||
        /must be removed/.test(bothLower)) {
      banStatus = 'banned';
    } else if (/\brestrict|\bregulated|\blimited\b/.test(bothLower)) {
      banStatus = 'restricted';
    }

    // Compliance check
    let compliant = true;
    let status = 'ok';
    let margin = null;

    if (banStatus === 'banned') {
      compliant = false;
      status = 'banned';
    } else if (ifraMax !== null) {
      compliant = pctInProduct <= ifraMax;
      margin = ifraMax > 0 ? roundN((ifraMax - pctInProduct) / ifraMax * 100, 1) : 0;
      status = compliant ? 'ok' : 'danger';
    } else {
      // No specific IFRA limit found — check usage range against % in product
      if (usageRange.max !== null && pctInProduct > usageRange.max) {
        status = 'warn';
      }
    }

    return {
      cas: mat.cas,
      name: mat.name,
      pctInConcentrate,
      pctInProduct,
      ifraMax,
      ifraSource,
      compliant,
      margin,
      status,
      banStatus,
      usageRange,
    };
  });
}

/**
 * Aggregate allergen exposure across all materials in the formulation.
 * Accounts for both pure allergen chemicals and allergens hidden inside
 * natural ingredients (essential oils, absolutes, resins).
 * @param {Array} materials - [{cas, name, pct, data:{...}}]
 * @param {number} fragPct - Fragrance concentration in finished product (%)
 * @param {string} categoryId - IFRA product category
 * @returns {Object} { allergens: [{cas, name, inci, totalPpm, sources, exceedsThreshold}], threshold }
 */
function aggregateAllergens(materials, fragPct, categoryId) {
  const cat = IFRA_CATEGORIES[categoryId];
  const isRinseOff = cat ? cat.rinseOff : false;
  const threshold = isRinseOff ? ALLERGEN_THRESHOLD_RINSEOFF : ALLERGEN_THRESHOLD_LEAVEON;

  // Accumulate allergen ppm from all sources
  const allergenMap = {}; // CAS → { name, inci, totalPpm, sources[] }

  for (const mat of materials) {
    const pctInProduct = (mat.pct / 100) * (fragPct / 100) * 100; // % in product
    const ppmInProduct = pctInProduct * 10000; // convert % to ppm

    // Case 1: Material itself IS an allergen
    if (EU_ALLERGENS_26[mat.cas]) {
      const a = EU_ALLERGENS_26[mat.cas];
      if (!allergenMap[mat.cas]) {
        allergenMap[mat.cas] = { name: a.name, inci: a.inci, totalPpm: 0, sources: [] };
      }
      allergenMap[mat.cas].totalPpm += ppmInProduct;
      allergenMap[mat.cas].sources.push({ from: mat.name, ppm: roundN(ppmInProduct, 2), type: 'direct' });
    }

    // Case 2: Material is a natural containing allergens
    const natComp = NATURAL_ALLERGEN_COMPOSITION[mat.cas];
    if (natComp) {
      for (const [allergenCAS, allergenPct] of Object.entries(natComp)) {
        if (!EU_ALLERGENS_26[allergenCAS]) continue; // only track EU 26
        const a = EU_ALLERGENS_26[allergenCAS];
        const contribPpm = ppmInProduct * (allergenPct / 100);

        if (!allergenMap[allergenCAS]) {
          allergenMap[allergenCAS] = { name: a.name, inci: a.inci, totalPpm: 0, sources: [] };
        }
        allergenMap[allergenCAS].totalPpm += contribPpm;
        allergenMap[allergenCAS].sources.push({
          from: mat.name,
          ppm: roundN(contribPpm, 2),
          type: 'natural',
          pctInNatural: allergenPct,
        });
      }
    }
  }

  // Build sorted result
  const allergens = Object.entries(allergenMap)
    .map(([cas, info]) => ({
      cas,
      name: info.name,
      inci: info.inci,
      totalPpm: roundN(info.totalPpm, 2),
      sources: info.sources,
      exceedsThreshold: info.totalPpm > threshold,
    }))
    .sort((a, b) => b.totalPpm - a.totalPpm);

  return { allergens, threshold, isRinseOff };
}

/**
 * Generate INCI ingredient label for the formulation.
 * Sorted by descending concentration (standard INCI ordering).
 * Allergens exceeding declaration threshold are appended at the end.
 * @param {Array} materials - [{cas, name, pct, data:{...}}]
 * @param {Object} allergenResult - output of aggregateAllergens()
 * @returns {string} INCI label text
 */
/**
 * Carrier/solvent INCI name mapping.
 */
const CARRIER_INCI = {
  ethanol: 'ALCOHOL DENAT.',
  dpg: 'DIPROPYLENE GLYCOL',
  ipm: 'ISOPROPYL MYRISTATE',
  coconut_oil: 'CAPRYLIC/CAPRIC TRIGLYCERIDE',
};

function generateINCILabel(materials, allergenResult, carrier) {
  // Fix 1E: EU INCI format — Carrier, PARFUM, then allergens
  const inciParts = [];

  // 1. Carrier/solvent first (largest component)
  const carrierInci = CARRIER_INCI[carrier] || CARRIER_INCI.ethanol;
  inciParts.push(carrierInci);

  // 2. PARFUM (fragrance compound)
  inciParts.push('PARFUM');

  // 3. Declared allergens (exceeding threshold) — sorted by total ppm descending
  if (allergenResult && allergenResult.allergens) {
    const declared = allergenResult.allergens
      .filter(a => a.exceedsThreshold)
      .sort((a, b) => b.totalPpm - a.totalPpm)
      .map(a => a.inci);
    inciParts.push(...declared);
  }

  // Remove duplicates while preserving order
  const seen = new Set();
  const unique = inciParts.filter(p => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  return unique.join(', ');
}

/**
 * Get overall safety summary for the formulation.
 * @param {Array} complianceResults - output of checkIFRACompliance()
 * @param {Object} allergenResult - output of aggregateAllergens()
 * @returns {Object} { overallStatus, bannedCount, dangerCount, warnCount, okCount, declaredAllergenCount }
 */
function getSafetySummary(complianceResults, allergenResult) {
  let bannedCount = 0, dangerCount = 0, warnCount = 0, okCount = 0;

  for (const r of complianceResults) {
    if (r.status === 'banned') bannedCount++;
    else if (r.status === 'danger') dangerCount++;
    else if (r.status === 'warn') warnCount++;
    else okCount++;
  }

  const declaredAllergenCount = allergenResult
    ? allergenResult.allergens.filter(a => a.exceedsThreshold).length
    : 0;

  let overallStatus = 'ok';
  if (bannedCount > 0) overallStatus = 'banned';
  else if (dangerCount > 0) overallStatus = 'danger';
  else if (warnCount > 0) overallStatus = 'warn';

  return { overallStatus, bannedCount, dangerCount, warnCount, okCount, declaredAllergenCount };
}

// ─────────────────────────────────────────────────────────────
// SYSTEM 3: Compatibility Graph & Allocation Engine
// ─────────────────────────────────────────────────────────────

/**
 * Build an undirected compatibility graph from blends_with data.
 * Nodes are CAS numbers, edges mean "blends well together".
 * @param {Object} db - The perfumery DB keyed by CAS
 * @returns {Map<string, Set<string>>} adjacency map
 */
function buildCompatibilityGraph(db) {
  const graph = new Map();

  for (const [cas, entry] of Object.entries(db)) {
    if (!graph.has(cas)) graph.set(cas, new Set());

    for (const target of (entry.blends_with || [])) {
      const targetCAS = resolveNameToCAS(target);
      if (!targetCAS || targetCAS === cas) continue;

      graph.get(cas).add(targetCAS);
      if (!graph.has(targetCAS)) graph.set(targetCAS, new Set());
      graph.get(targetCAS).add(cas); // undirected
    }
  }

  return graph;
}

/**
 * Find materials compatible with ALL selected materials.
 * Uses neighbor intersection scoring: candidates that appear in
 * more neighbors of selected materials score higher.
 * @param {Array<string>} selectedCASes - CAS numbers of selected materials
 * @param {Map} graph - from buildCompatibilityGraph()
 * @param {Object} db - perfumery DB
 * @param {number} maxResults - max suggestions to return
 * @returns {Array} [{cas, name, score, maxScore, note, odorType}]
 */
function findCompatibleMaterials(selectedCASes, graph, db, maxResults) {
  maxResults = maxResults || 20;
  const selectedSet = new Set(selectedCASes);
  const candidates = new Map(); // CAS → score

  for (const cas of selectedCASes) {
    const neighbors = graph.get(cas);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (selectedSet.has(n)) continue;
      candidates.set(n, (candidates.get(n) || 0) + 1);
    }
  }

  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxResults)
    .map(([cas, score]) => ({
      cas,
      name: db[cas] ? db[cas].name : cas,
      score,
      maxScore: selectedCASes.length,
      note: db[cas] ? db[cas].note : null,
      odorType: db[cas] ? (db[cas].odor && db[cas].odor.type) : null,
    }));
}

/**
 * Compute a harmony score for the current formulation.
 * Measures how well the selected materials blend with each other
 * based on graph connectivity.
 * @param {Array<string>} selectedCASes
 * @param {Map} graph
 * @returns {Object} {score: 0-100, pairs, connectedPairs, totalPairs}
 */
// Common perfumery discords — family pairs that tend to clash at significant
// concentration. Severity 0-1 reduces the pair score by up to 50% when both
// families appear in a pair of materials at non-trivial pct.
// Sources: Arctander, Calkin & Jellinek, Poucher — standard perfumery texts.
const DISCORD_PAIRS = [
  // Cool aromatic ↔ warm cloying
  { a: 'mint',       b: 'gourmand',   severity: 0.7 },
  { a: 'mint',       b: 'amber',      severity: 0.5 },
  { a: 'mint',       b: 'oriental',   severity: 0.5 },
  { a: 'camphor',    b: 'gourmand',   severity: 0.7 },
  { a: 'camphor',    b: 'floral',     severity: 0.5 },
  { a: 'eucalyptol', b: 'floral',     severity: 0.5 },
  { a: 'medicinal',  b: 'floral',     severity: 0.6 },
  { a: 'medicinal',  b: 'gourmand',   severity: 0.6 },
  // Animalic / fecal ↔ delicate light
  { a: 'fecal',      b: 'citrus',     severity: 0.6 },
  { a: 'fecal',      b: 'fresh',      severity: 0.7 },
  { a: 'animalic',   b: 'aquatic',    severity: 0.5 },
  // Ozonic / aquatic ↔ heavy oriental / gourmand
  { a: 'aquatic',    b: 'oriental',   severity: 0.5 },
  { a: 'aquatic',    b: 'gourmand',   severity: 0.5 },
  { a: 'aquatic',    b: 'resinous',   severity: 0.5 },
  // Green / galbanum ↔ sweet gourmand
  { a: 'green',      b: 'gourmand',   severity: 0.4 },
  // Sharp spice ↔ delicate aldehyde
  { a: 'spicy',      b: 'aldehydic',  severity: 0.4 },
  // Rubbery / phenolic ↔ sweet floral
  { a: 'phenolic',   b: 'floral',     severity: 0.5 },
  { a: 'rubbery',    b: 'gourmand',   severity: 0.4 },
];

function detectDiscord(familiesA, familiesB) {
  if (!familiesA || !familiesB || !familiesA.length || !familiesB.length) return 0;
  const aSet = new Set(familiesA.map(f => String(f).toLowerCase().trim()));
  const bSet = new Set(familiesB.map(f => String(f).toLowerCase().trim()));
  let maxSeverity = 0;
  for (const d of DISCORD_PAIRS) {
    if ((aSet.has(d.a) && bSet.has(d.b)) || (aSet.has(d.b) && bSet.has(d.a))) {
      if (d.severity > maxSeverity) maxSeverity = d.severity;
    }
  }
  return maxSeverity;
}

function computeHarmonyScore(materialsOrCases, graph, opts) {
  opts = opts || {};
  const fastMode = !!opts.fastMode;
  // Backward-compat: accept either an array of CAS strings (legacy) or an
  // array of material objects { cas, pct, data }. Legacy falls back to the
  // simple binary-graph behavior; modern call path uses the multi-factor
  // weighted score below.
  const isLegacy = materialsOrCases.length > 0 && typeof materialsOrCases[0] === 'string';
  if (isLegacy) {
    const selectedCASes = materialsOrCases;
    if (selectedCASes.length < 2) return { score: 100, connectedPairs: 0, totalPairs: 0, pairs: [], method: 'graph-binary' };
    const pairs = [];
    let connectedPairs = 0, totalPairs = 0;
    for (let i = 0; i < selectedCASes.length; i++) {
      for (let j = i + 1; j < selectedCASes.length; j++) {
        totalPairs++;
        const a = selectedCASes[i], b = selectedCASes[j];
        const neighbors = graph.get(a);
        const connected = neighbors ? neighbors.has(b) : false;
        if (connected) connectedPairs++;
        pairs.push({ a, b, connected });
      }
    }
    const score = totalPairs > 0 ? Math.round(connectedPairs / totalPairs * 100) : 100;
    return { score, connectedPairs, totalPairs, pairs, method: 'graph-binary' };
  }

  // Multi-factor weighted harmony
  const materials = materialsOrCases;
  if (materials.length < 2) {
    return { score: 100, connectedPairs: 0, totalPairs: 0, pairs: [], method: 'multi-factor' };
  }

  // Pre-compute heavy per-material data. In fastMode we skip the radar
  // cosine-similarity calculation entirely — connectivity + discord + pct
  // weight are the dominant signals and inner hill-climb iterations don't
  // need the extra precision.
  const radars = fastMode ? null : materials.map(m => {
    const w = materialToRadarWeights(m.data || {});
    return RADAR_AXES.map(a => w[a] || 0);
  });
  const familiesList = materials.map(m => getMaterialFamilies(m.data || {}));

  function cosSim(v1, v2) {
    let dot = 0, n1 = 0, n2 = 0;
    for (let k = 0; k < v1.length; k++) {
      dot += v1[k] * v2[k];
      n1  += v1[k] * v1[k];
      n2  += v2[k] * v2[k];
    }
    if (n1 === 0 || n2 === 0) return 0;
    return dot / (Math.sqrt(n1) * Math.sqrt(n2));
  }

  const pairs = [];
  const discords = [];
  let connectedCount = 0;
  let weightedSum = 0;
  let totalWeight  = 0;
  // Per-pair connectivity matrix — used for triangle synergy detection
  const connMatrix = Array.from({ length: materials.length }, () => new Array(materials.length).fill(false));

  for (let i = 0; i < materials.length; i++) {
    for (let j = i + 1; j < materials.length; j++) {
      const a = materials[i], b = materials[j];

      // Factor 1 — graph connectivity (explicit blends_with, symmetric)
      const nA = graph && graph.get ? graph.get(a.cas) : null;
      const nB = graph && graph.get ? graph.get(b.cas) : null;
      const connected = (nA && nA.has(b.cas)) || (nB && nB.has(a.cas));
      if (connected) connectedCount++;
      connMatrix[i][j] = connMatrix[j][i] = !!connected;

      // Factor 2 — descriptor cosine similarity (skipped in fastMode)
      const sim = fastMode ? 0 : cosSim(radars[i], radars[j]);

      // Factor 3 — discord penalty (known bad family pairs)
      const discordSev = detectDiscord(familiesList[i], familiesList[j]);

      // Combined pair score: explicit connection = 1.0; otherwise scale
      // descriptor sim into 0.3..1.0 so unrelated materials don't tank
      // the score when the DB graph is sparse. Discord reduces up to 50%.
      // In fastMode (sim=0) unrelated pairs score 0.3 which is still a
      // valid gradient signal.
      let pairScore = connected ? 1.0 : 0.3 + 0.7 * sim;
      pairScore = Math.max(0, pairScore - 0.5 * discordSev);

      // Weight by geometric mean of pct — significant pairs matter more.
      const w = Math.max(0.01, Math.sqrt((a.pct || 0) * (b.pct || 0)));

      weightedSum += pairScore * w;
      totalWeight += w;
      if (!fastMode) {
        pairs.push({
          a: a.cas, b: b.cas, connected,
          descriptorSim: roundN(sim, 2),
          discord: roundN(discordSev, 2),
          pairScore: roundN(pairScore, 2),
          weight: roundN(w, 2),
        });
      }
      if (discordSev > 0) {
        discords.push({ a: a.cas, b: b.cas, nameA: a.name, nameB: b.name, severity: roundN(discordSev, 2) });
      }
    }
  }

  // Triangle synergy — fraction of fully-connected 3-material triples,
  // capped to a small bonus so it can't overwhelm the pairwise signal.
  let fullTriangles = 0, totalTriangles = 0;
  for (let i = 0; i < materials.length; i++) {
    for (let j = i + 1; j < materials.length; j++) {
      for (let k = j + 1; k < materials.length; k++) {
        totalTriangles++;
        if (connMatrix[i][j] && connMatrix[j][k] && connMatrix[i][k]) fullTriangles++;
      }
    }
  }
  const triangleBonus = totalTriangles > 0 ? (fullTriangles / totalTriangles) * 5 : 0; // up to +5

  // Note-tier diversity — classical perfumery prefers top+middle+base coverage.
  // Missing a tier hurts; all three present gets the full multiplier.
  const tiersPresent = { top: false, middle: false, base: false };
  for (const m of materials) {
    const ts = classifyNoteTier(m.data?.note || '');
    for (const t of ts) tiersPresent[t] = true;
  }
  const tierCount = (tiersPresent.top ? 1 : 0) + (tiersPresent.middle ? 1 : 0) + (tiersPresent.base ? 1 : 0);
  // 0 → 0.85, 1 → 0.90, 2 → 0.95, 3 → 1.00
  const diversityFactor = 0.85 + 0.05 * tierCount;

  const baseScore = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 100;
  const finalScore = Math.max(0, Math.min(100, Math.round((baseScore + triangleBonus) * diversityFactor)));

  return {
    score: finalScore,
    baseScore: Math.round(baseScore),
    triangleBonus: roundN(triangleBonus, 1),
    diversityFactor: roundN(diversityFactor, 2),
    tierCount,
    tiersPresent,
    connectedPairs: connectedCount,
    totalPairs: pairs.length,
    fullTriangles,
    totalTriangles,
    discords,
    pairs,
    method: 'multi-factor',
  };
}

/**
 * Analyze note tier balance of the formulation.
 * A well-balanced perfume typically has all three tiers represented.
 * @param {Array} materials - [{cas, pct, data:{note}}]
 * @returns {Object} {top, middle, base, missing[], balanced}
 */
function analyzeNoteBalance(materials) {
  const tiers = { top: 0, middle: 0, base: 0 };
  let unclassifiedPct = 0;
  const unclassifiedMats = [];

  for (const mat of materials) {
    const note = mat.data?.note || '';
    const classified = classifyNoteTier(note);
    if (classified.length === 0) {
      unclassifiedPct += mat.pct;
      unclassifiedMats.push({ cas: mat.cas, name: mat.name, pct: mat.pct });
    } else {
      // Fix 1B: split contribution evenly across tiers to prevent inflation
      const share = mat.pct / classified.length;
      for (const t of classified) {
        tiers[t] += share;
      }
    }
  }

  const total = tiers.top + tiers.middle + tiers.base + unclassifiedPct;
  const missing = [];
  if (tiers.top === 0) missing.push('top');
  if (tiers.middle === 0) missing.push('middle');
  if (tiers.base === 0) missing.push('base');

  // Ideal tier ranges depend on fragrance family — an oriental or woody
  // scent is legitimately base-heavy (~55% base) and shouldn't be flagged
  // against a floral/general-purpose range. Use FAMILY_NOTE_RATIOS as the
  // center target and apply a ±10% window around each center.
  const dominantFamily = detectDominantFamily(materials);
  const center = (typeof FAMILY_NOTE_RATIOS !== 'undefined' && FAMILY_NOTE_RATIOS[dominantFamily])
    ? FAMILY_NOTE_RATIOS[dominantFamily]
    : { top: 0.225, mid: 0.40, base: 0.30 }; // 15–30 / 30–50 / 20–40 general default
  const band = 10; // ±10% window
  const clamp01 = (v) => Math.max(0, Math.min(100, v));
  const idealRanges = {
    top:    { min: clamp01(center.top * 100 - band),  max: clamp01(center.top * 100 + band) },
    middle: { min: clamp01(center.mid * 100 - band),  max: clamp01(center.mid * 100 + band) },
    base:   { min: clamp01(center.base * 100 - band), max: clamp01(center.base * 100 + band) },
  };
  const classifiedTotal = tiers.top + tiers.middle + tiers.base;
  const pctOf = v => classifiedTotal > 0 ? (v / classifiedTotal) * 100 : 0;
  const tierPct = { top: pctOf(tiers.top), middle: pctOf(tiers.middle), base: pctOf(tiers.base) };
  const outOfRange = [];
  for (const t of ['top', 'middle', 'base']) {
    if (tiers[t] === 0) continue; // already captured in `missing`
    if (tierPct[t] < idealRanges[t].min) outOfRange.push({ tier: t, actual: roundN(tierPct[t], 1), direction: 'low', ideal: idealRanges[t] });
    else if (tierPct[t] > idealRanges[t].max) outOfRange.push({ tier: t, actual: roundN(tierPct[t], 1), direction: 'high', ideal: idealRanges[t] });
  }

  return {
    top:    roundN(tiers.top, 1),
    middle: roundN(tiers.middle, 1),
    base:   roundN(tiers.base, 1),
    unclassified: roundN(unclassifiedPct, 1),
    unclassifiedMats,
    total:  roundN(total, 1),
    missing,
    outOfRange,
    balanced: missing.length === 0 && outOfRange.length === 0,
    family: dominantFamily,
    ideal: {
      top:    Math.round(idealRanges.top.min) + '-' + Math.round(idealRanges.top.max) + '%',
      middle: Math.round(idealRanges.middle.min) + '-' + Math.round(idealRanges.middle.max) + '%',
      base:   Math.round(idealRanges.base.min) + '-' + Math.round(idealRanges.base.max) + '%',
    },
    idealRanges,
    method: 'label',
  };
}

/**
 * Perception-based note balance — the tier % reflect integrated perceived
 * intensity over time windows (what an observer actually smells), not the
 * static label on each material. Uses simulated headspace concentration,
 * ODT, Stevens exponent, and Hill saturation.
 *
 * Windows (hours): top 0–0.5, middle 0.5–4, base 4–12.
 *
 * Falls back to the label-based analyzeNoteBalance when ODT coverage is
 * poor (< 50% of materials have ODT data) or the simulation yields no
 * signal.
 *
 * @param {Array} materials - [{cas, name, pct, data:{note,...}}]
 * @param {number} tempC - skin/ambient temperature
 * @returns same shape as analyzeNoteBalance plus { method, odtCoverage }
 */
function analyzeNoteBalancePerception(materials, tempC) {
  if (!materials || !materials.length) {
    return analyzeNoteBalance(materials || []);
  }

  // Data-quality gate: the perception integral is only meaningful when
  // BOTH the odor threshold AND the vapor pressure are well-characterised.
  //  - ODT via QSAR/strength-estimate fallbacks is coarse but acceptable.
  //  - VP via Clausius-Clapeyron from a boiling point alone (Kistiakowsky
  //    ΔHvap) systematically overestimates VP by 1–2 orders of magnitude
  //    for heavy polar aroma chemicals (e.g. ionones, Iso E Super's
  //    cousins) because it ignores polarity corrections over a 200 °C
  //    extrapolation. That causes mid/base notes to behave like top notes
  //    and collapses the pyramid to ~100 % Top. We therefore require an
  //    Antoine-grade VP for the material to count toward vpCoverage.
  let withODT = 0;
  let withVP = 0;
  for (const mat of materials) {
    const odt = getODT(mat.cas, mat.data);
    if (odt && odt.ppb != null && isFinite(odt.ppb) && odt.ppb > 0) withODT++;
    const vp = getVaporPressure(mat.cas, tempC || 25, mat.data);
    if (vp && vp.method === 'antoine' && vp.vp_mmHg > 0 && isFinite(vp.vp_mmHg)) withVP++;
  }
  const odtCoverage = withODT / materials.length;
  const vpCoverage  = withVP  / materials.length;
  if (odtCoverage < 0.5 || vpCoverage < 0.5) {
    return Object.assign({}, analyzeNoteBalance(materials), {
      method: 'label',
      odtCoverage: roundN(odtCoverage, 2),
      vpCoverage:  roundN(vpCoverage,  2),
    });
  }

  // Dense sample points so trapezoidal integration captures the top burst
  const times = [0, 0.083, 0.25, 0.5, 1, 2, 4, 6, 8, 12];
  const sim = simulateEvaporation(materials, tempC || 25, times);
  const windows = { top: [0, 0.5], middle: [0.5, 4], base: [4, 12] };
  const integrals = { top: 0, middle: 0, base: 0 };

  for (let mi = 0; mi < materials.length; mi++) {
    const mat = materials[mi];
    const odt = getODT(mat.cas, mat.data);
    const n = getStevensExponent(mat.data);
    const curve = sim.curves[mi];
    if (!odt || odt.ppb == null || !(odt.ppb > 0) || !curve) continue;

    const psi = times.map((t, ti) => {
      const conc = curve.concentrations[ti] || 0;
      const ov = calcOdorValue(conc, odt.ppb);
      return hillPerceivedIntensity(ov, n);
    });

    // Trapezoidal integrate over each window
    for (const tier of Object.keys(windows)) {
      const [tMin, tMax] = windows[tier];
      let integral = 0;
      for (let i = 0; i < times.length - 1; i++) {
        const t1 = times[i], t2 = times[i + 1];
        if (t2 <= tMin) continue;
        if (t1 >= tMax) break;
        const a = Math.max(t1, tMin);
        const b = Math.min(t2, tMax);
        if (b <= a) continue;
        // Linear-interpolate PSI at window boundaries
        const frac1 = (a - t1) / (t2 - t1);
        const frac2 = (b - t1) / (t2 - t1);
        const psi_a = psi[i] + (psi[i + 1] - psi[i]) * frac1;
        const psi_b = psi[i] + (psi[i + 1] - psi[i]) * frac2;
        integral += (psi_a + psi_b) * 0.5 * (b - a);
      }
      integrals[tier] += integral;
    }
  }

  const total = integrals.top + integrals.middle + integrals.base;
  if (total <= 0) {
    // Simulation produced no perceivable intensity — fall back to label
    return Object.assign({}, analyzeNoteBalance(materials), { method: 'label', odtCoverage: roundN(odtCoverage, 2) });
  }

  const pct = {
    top:    (integrals.top    / total) * 100,
    middle: (integrals.middle / total) * 100,
    base:   (integrals.base   / total) * 100,
  };

  // Family-specific ideal ranges (same as label method)
  const dominantFamily = detectDominantFamily(materials);
  const center = (typeof FAMILY_NOTE_RATIOS !== 'undefined' && FAMILY_NOTE_RATIOS[dominantFamily])
    ? FAMILY_NOTE_RATIOS[dominantFamily]
    : { top: 0.225, mid: 0.40, base: 0.30 };
  const band = 10;
  const clamp01 = v => Math.max(0, Math.min(100, v));
  const idealRanges = {
    top:    { min: clamp01(center.top * 100 - band),  max: clamp01(center.top * 100 + band) },
    middle: { min: clamp01(center.mid * 100 - band),  max: clamp01(center.mid * 100 + band) },
    base:   { min: clamp01(center.base * 100 - band), max: clamp01(center.base * 100 + band) },
  };

  const missing = [];
  if (pct.top < 0.5)    missing.push('top');
  if (pct.middle < 0.5) missing.push('middle');
  if (pct.base < 0.5)   missing.push('base');

  const outOfRange = [];
  for (const t of ['top', 'middle', 'base']) {
    if (pct[t] < 0.5) continue;
    if (pct[t] < idealRanges[t].min) outOfRange.push({ tier: t, actual: roundN(pct[t], 1), direction: 'low', ideal: idealRanges[t] });
    else if (pct[t] > idealRanges[t].max) outOfRange.push({ tier: t, actual: roundN(pct[t], 1), direction: 'high', ideal: idealRanges[t] });
  }

  return {
    top:    roundN(pct.top, 1),
    middle: roundN(pct.middle, 1),
    base:   roundN(pct.base, 1),
    unclassified: 0,
    unclassifiedMats: [],
    total: 100,
    missing,
    outOfRange,
    balanced: missing.length === 0 && outOfRange.length === 0,
    family: dominantFamily,
    ideal: {
      top:    Math.round(idealRanges.top.min) + '-' + Math.round(idealRanges.top.max) + '%',
      middle: Math.round(idealRanges.middle.min) + '-' + Math.round(idealRanges.middle.max) + '%',
      base:   Math.round(idealRanges.base.min) + '-' + Math.round(idealRanges.base.max) + '%',
    },
    idealRanges,
    method: 'perception',
    odtCoverage: roundN(odtCoverage, 2),
    vpCoverage:  roundN(vpCoverage,  2),
  };
}

/**
 * Combined fitness score for a formulation — merges harmony, pyramid
 * alignment, IFRA compliance, and discord-free state into a single
 * 0–100 objective. Used by Apply Suggested / Apply Optimized / ★ Brief
 * as the optimization target, and reported as a before/after delta in
 * the UI so users can see the button actually improved the formula.
 *
 * @param {Array} materials - [{cas, name, pct, data}]
 * @param {Object} opts - { catId, fragPct, tempC, graph }
 * @returns {{ score, harmony, pyramid, ifra, discordFree, breakdown }}
 */
function computeFormulaFitness(materials, opts) {
  opts = opts || {};
  if (!materials || !materials.length) {
    return { score: 0, harmony: 0, pyramid: 0, ifra: 100, discordFree: 100, breakdown: null };
  }

  // 1. Harmony (0–100)
  const harm = computeHarmonyScore(materials, opts.graph || new Map(), { fastMode: !!opts.fastMode });
  const harmony = harm.score || 0;

  // 2. Pyramid alignment (0–100) — 100 if balanced, penalty grows with
  //    out-of-range distance as a fraction of the ideal window width.
  //    fastMode uses label-based analyzeNoteBalance which skips the
  //    simulateEvaporation pass — ~10x cheaper, used inside hill-climb.
  let pyramid = 100;
  if (materials.length >= 2) {
    const bal = opts.fastMode
      ? analyzeNoteBalance(materials)
      : analyzeNoteBalancePerception(materials, opts.tempC || 25);
    if (bal.missing && bal.missing.length) pyramid -= bal.missing.length * 20;
    if (bal.outOfRange && bal.outOfRange.length) {
      const classifiedTotal = (bal.top || 0) + (bal.middle || 0) + (bal.base || 0);
      for (const o of bal.outOfRange) {
        const actualPct = classifiedTotal > 0 ? (bal[o.tier] / classifiedTotal) * 100 : 0;
        const range = o.ideal;
        const dist = o.direction === 'low'
          ? Math.max(0, range.min - actualPct)
          : Math.max(0, actualPct - range.max);
        const windowW = Math.max(1, range.max - range.min);
        pyramid -= Math.min(30, (dist / windowW) * 30);
      }
    }
    pyramid = Math.max(0, Math.min(100, pyramid));
  }

  // 3. IFRA compliance (0–100) — % of materials compliant for the category
  let ifra = 100;
  if (opts.catId && opts.fragPct) {
    const comp = checkIFRACompliance(materials, opts.catId, opts.fragPct);
    const total = comp.length || 1;
    const violators = comp.filter(c => c.compliant === false || c.banStatus === 'banned').length;
    ifra = Math.max(0, Math.min(100, ((total - violators) / total) * 100));
  }

  // 4. Discord-free (0–100) — 100 if no discord, else 100 − 100×max severity
  let discordFree = 100;
  if (harm.discords && harm.discords.length) {
    const maxSev = harm.discords.reduce((m, d) => Math.max(m, d.severity || 0), 0);
    discordFree = Math.max(0, Math.min(100, 100 - maxSev * 100));
  }

  const score = Math.round(
    0.40 * harmony +
    0.35 * pyramid +
    0.15 * ifra +
    0.10 * discordFree
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    harmony: Math.round(harmony),
    pyramid: Math.round(pyramid),
    ifra: Math.round(ifra),
    discordFree: Math.round(discordFree),
    breakdown: { harmWeight: 0.40, pyrWeight: 0.35, ifraWeight: 0.15, discWeight: 0.10 },
  };
}

/**
 * Hill-climb on computeFormulaFitness. Shared between suggestAllocation,
 * optimizeAllocation, and generateFromBrief so all three end at a local
 * optimum of the same objective.
 *
 * Uses two move types per iteration:
 *   A. single-index ±δ with proportional peer redistribution
 *   B. pairwise transfer — shift k% from i to j directly
 * Step size δ decays over iterations.
 *
 * @param {Array<number>} pctsIn - starting pcts (will not be mutated)
 * @param {Array} materials - full material list (for .cas, .data, etc.)
 * @param {Array<number>} unlockedIdx - indices allowed to change
 * @param {Array<number>} ifraMaxes - per-material IFRA cap in concentrate
 * @param {Object} opts - { catId, fragPct, tempC, graph } for fitness
 * @param {number} iters - total iterations
 * @returns {{ pcts: Array<number>, fitness: number }}
 */
function _hillClimbFitness(pctsIn, materials, unlockedIdx, ifraMaxes, opts, iters) {
  iters = iters || 50;
  const pcts = pctsIn.slice();
  const matsWithPct = () => materials.map((m, i) => ({ cas: m.cas, name: m.name, pct: pcts[i], data: m.data }));
  // Inside the hill-climb the fitness is called hundreds of times; use
  // label-based pyramid (~10x cheaper than perception-based) — the label
  // and perception pyramid agree on gradient direction for small pct
  // perturbations, so the final local optimum is essentially the same.
  const hcOpts = Object.assign({}, opts, { fastMode: true });
  let bestFitness = computeFormulaFitness(matsWithPct(), hcOpts).score;
  let stagnant = 0; // consecutive no-improvement passes

  for (let iter = 0; iter < iters; iter++) {
    const progress = iter / iters;
    const delta = 2.5 * (1 - progress) + 0.5; // 3.0 → 0.5
    let improvedAny = false;

    // Move A — single-index ±δ with proportional peer redistribution
    for (const i of unlockedIdx) {
      for (const sign of [1, -1]) {
        const step = sign * delta;
        const newI = Math.min(ifraMaxes[i], Math.max(0, pcts[i] + step));
        const diff = newI - pcts[i];
        if (Math.abs(diff) < 1e-6) continue;
        const peers = unlockedIdx.filter(k => k !== i && pcts[k] > 0 && pcts[k] < ifraMaxes[k] - 0.001);
        if (!peers.length) continue;
        const peerSum = peers.reduce((s, k) => s + pcts[k], 0);
        if (peerSum <= 0) continue;

        const savedI = pcts[i];
        const saved = peers.map(k => pcts[k]);
        pcts[i] = newI;
        for (const k of peers) pcts[k] = Math.max(0, pcts[k] - diff * (pcts[k] / peerSum));
        const newFit = computeFormulaFitness(matsWithPct(), hcOpts).score;
        if (newFit > bestFitness + 0.01) {
          bestFitness = newFit;
          improvedAny = true;
          break;
        } else {
          pcts[i] = savedI;
          peers.forEach((k, idx) => { pcts[k] = saved[idx]; });
        }
      }
    }

    // Move B — pairwise transfer (i → j). Skip early when few unlocked.
    if (unlockedIdx.length >= 3 && iter % 2 === 0) {
      // Only try a subset of pairs to keep per-iter cost bounded
      const stride = Math.max(1, unlockedIdx.length - 1);
      for (let a = 0; a < unlockedIdx.length; a++) {
        const i = unlockedIdx[a];
        const j = unlockedIdx[(a + 1 + (iter % stride)) % unlockedIdx.length];
        if (i === j) continue;
        const k = delta; // transfer amount
        if (pcts[i] - k < 0 || pcts[j] + k > ifraMaxes[j]) continue;
        const savedI = pcts[i], savedJ = pcts[j];
        pcts[i] -= k;
        pcts[j] += k;
        const newFit = computeFormulaFitness(matsWithPct(), hcOpts).score;
        if (newFit > bestFitness + 0.01) {
          bestFitness = newFit;
          improvedAny = true;
        } else {
          pcts[i] = savedI;
          pcts[j] = savedJ;
        }
      }
    }

    // Stronger early exit: stop after 3 consecutive stagnant passes
    // (4 in the first 30% to let the optimizer warm up)
    if (improvedAny) stagnant = 0;
    else stagnant++;
    const allowed = progress < 0.3 ? 4 : 3;
    if (stagnant >= allowed) break;
  }
  return { pcts, fitness: bestFitness };
}

/**
 * Suggest initial percentage allocation using Dirichlet-inspired priors.
 * Stronger materials get lower %, base notes get more than top notes.
 * @param {Array} materials - [{cas, name, data:{note, odor_strength}}]
 * @returns {Array} [{cas, name, suggestedPct}]
 */
function suggestAllocation(materials, fragPct, locked) {
  if (!materials.length) return [];
  fragPct = fragPct || 18;
  locked = locked || new Set();

  const alphas = materials.map(mat => {
    const note = (mat.data?.note || '').toLowerCase();
    const strength = odorStrengthScale(mat.data?.odor_strength) || 3;

    // Multi-tier notes ("Top / Middle", "Middle / Base") get the average of
    // their tiers rather than whichever keyword appears first in the string.
    const alphaByTier = { top: 2.0, middle: 3.5, base: 5.0 };
    const tierKeys = classifyNoteTier(note);
    let baseAlpha;
    if (tierKeys.length) {
      baseAlpha = tierKeys.reduce((s, t) => s + alphaByTier[t], 0) / tierKeys.length;
    } else {
      baseAlpha = 3.0;
    }

    const strengthFactor = 3 / clamp(strength, 0.5, 5);
    return baseAlpha * strengthFactor;
  });

  // ─── Harmony-aware reweighting of priors ─────────────────────────────
  // For each material, adjust its Dirichlet alpha based on how it relates
  // to the rest of the formula via descriptor similarity and known discord
  // family pairs. Also boost tiers that are missing so the suggestion
  // spreads across top/mid/base when possible.
  if (materials.length >= 2) {
    const radars = materials.map(m => {
      const w = materialToRadarWeights(m.data || {});
      return RADAR_AXES.map(a => w[a] || 0);
    });
    const famList = materials.map(m => getMaterialFamilies(m.data || {}));
    for (let i = 0; i < materials.length; i++) {
      let bonus = 0;
      for (let j = 0; j < materials.length; j++) {
        if (i === j) continue;
        // descriptor cosine similarity
        let dot = 0, n1 = 0, n2 = 0;
        for (let k = 0; k < radars[i].length; k++) {
          dot += radars[i][k] * radars[j][k];
          n1  += radars[i][k] * radars[i][k];
          n2  += radars[j][k] * radars[j][k];
        }
        const sim = (n1 > 0 && n2 > 0) ? dot / (Math.sqrt(n1) * Math.sqrt(n2)) : 0;
        bonus += sim * 0.15;
        // Discord penalty
        const disc = detectDiscord(famList[i], famList[j]);
        if (disc > 0) bonus -= disc * 0.3;
      }
      alphas[i] = Math.max(0.1, alphas[i] * (1 + bonus / Math.max(1, materials.length - 1)));
    }
    // Tier-missing boost: if a tier has no material, skip (nothing to boost);
    // if it has few, slightly increase their alphas so suggestion tilts toward
    // the underrepresented tier.
    const tierCount = { top: 0, middle: 0, base: 0 };
    const tierMats = { top: [], middle: [], base: [] };
    for (let i = 0; i < materials.length; i++) {
      const ts = classifyNoteTier(materials[i].data?.note || '');
      for (const t of ts) { tierCount[t]++; tierMats[t].push(i); }
    }
    for (const t of ['top', 'middle', 'base']) {
      if (tierCount[t] > 0 && tierCount[t] <= Math.ceil(materials.length / 4)) {
        for (const i of tierMats[t]) alphas[i] *= 1.2;
      }
    }
  }

  // Normalize to sum to 100%
  const sum = alphas.reduce((a, b) => a + b, 0);
  let pcts = materials.map((mat, i) => roundN((alphas[i] / sum) * 100, 2));

  // Keep locked materials at their current percentage
  for (let i = 0; i < materials.length; i++) {
    if (locked.has(materials[i].cas)) pcts[i] = materials[i].pct;
  }

  // Clamp to IFRA/usage limits (convert to max % in concentrate)
  const fixed = new Set(); // locked + IFRA-clamped
  for (let i = 0; i < materials.length; i++) {
    if (locked.has(materials[i].cas)) { fixed.add(i); continue; }
    const mat = materials[i];
    const ifra51 = parseIFRA51(mat.data?.usage_levels);
    const usageRange = parseUsageRange(mat.data?.usage_levels);
    let maxInProduct = usageRange.max || 100;
    if (ifra51) {
      for (const v of Object.values(ifra51)) { if (v < maxInProduct) maxInProduct = v; }
    }
    const maxInConcentrate = maxInProduct / (fragPct / 100);
    if (pcts[i] > maxInConcentrate) {
      pcts[i] = roundN(maxInConcentrate * 0.9, 2); // 90% safety margin
      fixed.add(i);
    }
  }

  // Re-normalize ONLY non-fixed materials to fill remaining budget
  const fixedSum = [...fixed].reduce((s, i) => s + pcts[i], 0);
  const remainTarget = 100 - fixedSum;
  const remainSum = pcts.reduce((s, p, i) => s + (fixed.has(i) ? 0 : p), 0);
  if (remainSum > 0 && remainTarget > 0) {
    for (let i = 0; i < pcts.length; i++) {
      if (!fixed.has(i)) pcts[i] = roundN(pcts[i] / remainSum * remainTarget, 2);
    }
  }

  // Fix rounding drift: adjust largest non-fixed material so total is exactly 100%
  const finalSum = pcts.reduce((a, b) => a + b, 0);
  if (Math.abs(finalSum - 100) > 0.005) {
    let maxIdx = -1, maxVal = 0;
    for (let i = 0; i < pcts.length; i++) {
      if (!fixed.has(i) && pcts[i] > maxVal) { maxVal = pcts[i]; maxIdx = i; }
    }
    if (maxIdx >= 0) pcts[maxIdx] = roundN(pcts[maxIdx] + (100 - finalSum), 2);
  }

  // ─── Polish: 40-iter hill-climb on fitness ───────────────────────────
  // Same objective as Apply Optimized but fewer iterations — turns the
  // Dirichlet priors into a genuine local optimum of harmony + pyramid.
  if (materials.length >= 2) {
    const unlockedIdx = [];
    for (let i = 0; i < materials.length; i++) if (!fixed.has(i)) unlockedIdx.push(i);
    if (unlockedIdx.length >= 2) {
      const ifraMaxes = materials.map((mat, i) => {
        const ifra51 = parseIFRA51(mat.data?.usage_levels);
        const range = parseUsageRange(mat.data?.usage_levels);
        let mp = range.max != null ? range.max : 100;
        if (ifra51) for (const v of Object.values(ifra51)) if (v < mp) mp = v;
        return mp / (fragPct / 100);
      });
      const result = _hillClimbFitness(pcts, materials, unlockedIdx, ifraMaxes,
        { catId: null, fragPct: fragPct, tempC: 25, graph: null }, 25);
      for (let i = 0; i < materials.length; i++) pcts[i] = roundN(result.pcts[i], 2);

      // Re-fix sum to 100 after rounding
      const s2 = pcts.reduce((a, b) => a + b, 0);
      if (Math.abs(s2 - 100) > 0.005) {
        let mi = -1, mv = 0;
        for (let i = 0; i < pcts.length; i++) if (!fixed.has(i) && pcts[i] > mv) { mv = pcts[i]; mi = i; }
        if (mi >= 0) pcts[mi] = roundN(pcts[mi] + (100 - s2), 2);
      }
    }
  }

  return materials.map((mat, i) => ({
    cas: mat.cas,
    name: mat.name,
    suggestedPct: pcts[i],
  }));
}

/**
 * Run constrained optimization to balance the formulation.
 * Adjusts percentages to improve note balance + harmony while
 * respecting IFRA limits. Uses simple iterative projection.
 * @param {Array} materials - [{cas, name, pct, data:{...}}]
 * @param {Map} graph - compatibility graph
 * @param {string} categoryId - IFRA category
 * @param {number} fragPct - fragrance concentration
 * @param {number} iterations - optimization steps (default 50)
 * @param {Set} locked - CAS numbers to keep fixed (Fix 4C)
 * @returns {Array} [{cas, name, optimizedPct}]
 */
/**
 * C4: Detect the dominant olfactive family of a formulation.
 * Weighted by percentage — the family with highest total % wins.
 */
function detectDominantFamily(materials) {
  const familyPct = {};
  for (const mat of materials) {
    const families = getMaterialFamilies(mat.data || {});
    const share = mat.pct / (families.length || 1);
    for (const f of families) {
      const fl = f.toLowerCase();
      // Map to wheel segment names
      const seg = (typeof FRAGRANCE_WHEEL !== 'undefined' && FRAGRANCE_WHEEL.familyToSegment)
        ? FRAGRANCE_WHEEL.familyToSegment[fl] || fl : fl;
      familyPct[seg] = (familyPct[seg] || 0) + share;
    }
  }
  let best = 'default', bestPct = 0;
  for (const [fam, pct] of Object.entries(familyPct)) {
    if (pct > bestPct) { best = fam; bestPct = pct; }
  }
  return best;
}

function optimizeAllocation(materials, graph, categoryId, fragPct, iterations, locked) {
  iterations = iterations || 50;
  locked = locked || new Set();
  if (materials.length < 2) {
    return materials.map(m => ({ cas: m.cas, name: m.name, optimizedPct: m.pct }));
  }

  let pcts = materials.map(m => m.pct);
  const n = pcts.length;

  const ifraMaxes = materials.map(mat => {
    const ifra51 = parseIFRA51(mat.data?.usage_levels);
    const cat = IFRA_CATEGORIES[categoryId];
    if (ifra51 && cat && cat.key && ifra51[cat.key] != null) {
      return ifra51[cat.key] / (fragPct / 100);
    }
    const range = parseUsageRange(mat.data?.usage_levels);
    return (range.max != null ? range.max : 100) / (fragPct / 100);
  });

  const lr = 0.5;
  for (let iter = 0; iter < iterations; iter++) {
    const grad = new Array(n).fill(0);

    // Fix 1B: split dual-note contribution evenly in optimizer
    const tiers = { top: 0, middle: 0, base: 0 };
    const tierIdx = { top: [], middle: [], base: [] };
    for (let i = 0; i < n; i++) {
      const classified = classifyNoteTier(materials[i].data?.note || '');
      const share = classified.length > 0 ? pcts[i] / classified.length : 0;
      for (const t of classified) {
        tiers[t] += share;
        tierIdx[t].push(i);
      }
    }

    // C4: Use family-specific note ratios if available
    const total = pcts.reduce((a, b) => a + b, 0) || 1;
    const dominantFamily = detectDominantFamily(materials);
    const ratios = (typeof FAMILY_NOTE_RATIOS !== 'undefined' && FAMILY_NOTE_RATIOS[dominantFamily])
      ? FAMILY_NOTE_RATIOS[dominantFamily] : { top: 0.20, mid: 0.45, base: 0.35 };
    const targetTop = total * ratios.top;
    const targetMid = total * ratios.mid;
    const targetBase = total * ratios.base;

    for (const i of tierIdx.top)    grad[i] += (targetTop - tiers.top) / (tierIdx.top.length || 1) * 0.01;
    for (const i of tierIdx.middle) grad[i] += (targetMid - tiers.middle) / (tierIdx.middle.length || 1) * 0.01;
    for (const i of tierIdx.base)   grad[i] += (targetBase - tiers.base) / (tierIdx.base.length || 1) * 0.01;

    // Fix 4C: skip locked materials
    for (let i = 0; i < n; i++) {
      if (locked.has(materials[i].cas)) continue;
      pcts[i] = pcts[i] + lr * grad[i];
    }

    // Project: clamp unlocked, re-normalize only non-IFRA-capped materials
    const lockedSum = materials.reduce((s, m, i) => s + (locked.has(m.cas) ? pcts[i] : 0), 0);
    const targetUnlocked = Math.max(100 - lockedSum, 0);
    const ifraCapped = new Set();
    for (let i = 0; i < n; i++) {
      if (locked.has(materials[i].cas)) continue;
      const before = pcts[i];
      pcts[i] = clamp(pcts[i], Math.min(0.01, ifraMaxes[i]), ifraMaxes[i]);
      if (pcts[i] < before) ifraCapped.add(i);
    }
    // Exclude IFRA-capped materials from re-normalization so they stay within limits
    const cappedSum = [...ifraCapped].reduce((s, i) => s + pcts[i], 0);
    const remainTarget = targetUnlocked - cappedSum;
    const remainSum = pcts.reduce((s, v, i) => s + (!locked.has(materials[i].cas) && !ifraCapped.has(i) ? v : 0), 0);
    if (remainSum > 0 && remainTarget > 0) {
      for (let i = 0; i < n; i++) {
        if (locked.has(materials[i].cas) || ifraCapped.has(i)) continue;
        pcts[i] = pcts[i] / remainSum * remainTarget;
      }
    }
  }

  // Final IFRA clamp after optimization loop
  for (let i = 0; i < n; i++) {
    if (locked.has(materials[i].cas)) continue;
    pcts[i] = Math.min(pcts[i], ifraMaxes[i]);
  }

  // ─── Phase 2: harmony/pyramid-aware hill climb + random restarts ──────
  // Tries multiple starting points (gradient-descent result + perturbations)
  // and returns the best across all. Each run uses two move types:
  //   A. single-index ±δ with proportional peer redistribution
  //   B. pairwise swap — transfer k% from material i to material j
  // This escapes local optima the single-index move can't exit.
  const unlockedIdx = [];
  for (let i = 0; i < n; i++) if (!locked.has(materials[i].cas)) unlockedIdx.push(i);

  if (unlockedIdx.length >= 2) {
    const fitnessOpts = { catId: categoryId, fragPct: fragPct, tempC: 25, graph: graph };

    // Run 2 starting points: current pcts + one perturbed variant. More
    // restarts gave marginal fitness gains (<1 point) at 50%+ time cost,
    // so 2 is the sweet spot for interactive feel.
    const starts = [pcts.slice()];
    {
      const noisy = pcts.slice();
      for (const i of unlockedIdx) {
        const noise = (Math.random() * 2 - 1) * 0.15 * Math.max(1, noisy[i]);
        noisy[i] = Math.max(0.1, Math.min(ifraMaxes[i], noisy[i] + noise));
      }
      const ls = materials.reduce((s, m, i) => s + (locked.has(m.cas) ? noisy[i] : 0), 0);
      const target = Math.max(0, 100 - ls);
      const unSum = unlockedIdx.reduce((s, i) => s + noisy[i], 0) || 1;
      for (const i of unlockedIdx) noisy[i] = noisy[i] / unSum * target;
      starts.push(noisy);
    }

    let bestPcts = null, bestFit = -Infinity;
    for (const startPcts of starts) {
      const result = _hillClimbFitness(startPcts, materials, unlockedIdx, ifraMaxes, fitnessOpts, 50);
      if (result.fitness > bestFit) { bestFit = result.fitness; bestPcts = result.pcts; }
    }
    for (let i = 0; i < n; i++) pcts[i] = bestPcts[i];

    // Final IFRA clamp (peer redistribution could edge past)
    for (let i = 0; i < n; i++) {
      if (locked.has(materials[i].cas)) continue;
      pcts[i] = Math.min(pcts[i], ifraMaxes[i]);
    }
  }

  // Round and fix sum to exactly 100%
  let rounded = pcts.map(p => roundN(p, 2));
  const roundedSum = rounded.reduce((a, b) => a + b, 0);
  if (roundedSum > 0 && Math.abs(roundedSum - 100) > 0.005) {
    // Adjust the largest unlocked material to compensate rounding error
    let maxIdx = 0, maxVal = 0;
    for (let i = 0; i < rounded.length; i++) {
      if (!locked.has(materials[i].cas) && rounded[i] > maxVal) { maxVal = rounded[i]; maxIdx = i; }
    }
    rounded[maxIdx] = roundN(rounded[maxIdx] + (100 - roundedSum), 2);
  }

  return materials.map((m, i) => ({
    cas: m.cas,
    name: m.name,
    optimizedPct: rounded[i],
    locked: locked.has(m.cas),
  }));
}

// ─────────────────────────────────────────────────────────────
// SYSTEM 1: Thermodynamics & Evaporation Engine
// ─────────────────────────────────────────────────────────────

/**
 * Calculate vapor pressure using the Antoine equation.
 * log10(P_mmHg) = A - B / (C + T_celsius)
 * @param {string} cas - CAS number
 * @param {number} tempC - temperature in Celsius
 * @returns {Object|null} {vp_mmHg, method, confidence}
 */
function antoineVP(cas, tempC) {
  const coeff = ANTOINE_COEFFICIENTS[cas];
  if (!coeff) return null;

  const vp = Math.pow(10, coeff.A - coeff.B / (coeff.C + tempC));
  const inRange = tempC >= coeff.range[0] && tempC <= coeff.range[1];

  return {
    vp_mmHg: vp,
    method: 'antoine',
    confidence: inRange ? 'high' : 'medium',
    note: inRange ? null : 'Extrapolated outside valid range',
  };
}

/**
 * Estimate enthalpy of vaporization using Kistiakowsky equation.
 * deltaH_vap = (36.6 + R * ln(T_bp_K)) * T_bp_K  [J/mol]
 * @param {number} bpCelsius - boiling point in Celsius
 * @returns {number} deltaH_vap in J/mol
 */
function kistiakowskyDeltaHvap(bpCelsius) {
  const T_bp_K = bpCelsius + 273.15;
  return (36.6 + R_GAS * Math.log(T_bp_K)) * T_bp_K;
}

/**
 * Calculate vapor pressure using Clausius-Clapeyron approximation.
 * ln(P2/P1) = (deltaH_vap / R) * (1/T1 - 1/T2)
 * Reference point: boiling point (P1 = 760 mmHg, T1 = BP)
 * @param {number} bpCelsius - boiling point in Celsius
 * @param {number} tempC - target temperature in Celsius
 * @param {number} refVP - optional reference VP at refTemp (mmHg)
 * @param {number} refTemp - reference temperature for refVP (Celsius)
 * @returns {Object} {vp_mmHg, method, confidence}
 */
function clausiusClapeyronVP(bpCelsius, tempC, refVP, refTemp) {
  const deltaH = kistiakowskyDeltaHvap(bpCelsius);

  let T1_K, P1;
  if (refVP != null && refTemp != null) {
    T1_K = refTemp + 273.15;
    P1 = refVP;
  } else {
    T1_K = bpCelsius + 273.15;
    P1 = 760; // mmHg at boiling point
  }

  const T2_K = tempC + 273.15;
  const lnRatio = (deltaH / R_GAS) * (1 / T1_K - 1 / T2_K);
  const vp = P1 * Math.exp(lnRatio);

  return {
    vp_mmHg: Math.max(vp, 0),
    method: 'clausius-clapeyron',
    confidence: 'medium',
  };
}

/**
 * Get vapor pressure for a material at a given temperature.
 * Tries Antoine first, then Clausius-Clapeyron fallback.
 * @param {string} cas
 * @param {number} tempC
 * @param {Object} matData - enriched material data (may have boiling_point, vapor_pressure from PubChem)
 * @returns {Object} {vp_mmHg, method, confidence} or {vp_mmHg:null, method:'none', confidence:'none'}
 */
function getVaporPressure(cas, tempC, matData) {
  // Strategy 1: Antoine (exact coefficients)
  const antoine = antoineVP(cas, tempC);
  if (antoine) return antoine;

  // Strategy 2: Clausius-Clapeyron with boiling point
  const bp = matData?.boiling_point || null;
  if (bp != null) {
    const refVP = matData?.vapor_pressure || null;
    return clausiusClapeyronVP(bp, tempC, refVP, 25);
  }

  // No data available
  return { vp_mmHg: null, method: 'none', confidence: 'none' };
}

/**
 * Calculate Hildebrand solubility parameter for activity coefficient estimation.
 * delta = sqrt((deltaH_vap - R*T) / V_m)
 * V_m = MW / density
 * @param {number} bpCelsius
 * @param {number} mw - molecular weight
 * @param {number} density - g/cm³
 * @param {number} tempC
 * @returns {number|null} solubility parameter in (J/cm³)^0.5
 */
function hildebrandSolParam(bpCelsius, mw, density, tempC) {
  if (!bpCelsius || !mw || !density) return null;
  const deltaH = kistiakowskyDeltaHvap(bpCelsius);
  const T_K = tempC + 273.15;
  const V_m = mw / density; // cm³/mol
  const delta_sq = (deltaH - R_GAS * T_K) / V_m;
  if (delta_sq <= 0) return null;
  return Math.sqrt(delta_sq);
}

/**
 * Estimate activity coefficient using Hildebrand model.
 * ln(gamma_i) = V_i * (delta_i - delta_mix)^2 / (R * T)
 * For perfumery dilutions gamma is typically close to 1.
 * @param {number} delta_i - solubility param of component
 * @param {number} delta_mix - weighted avg solubility param of mixture
 * @param {number} V_m - molar volume of component (cm³/mol)
 * @param {number} tempC
 * @returns {number} gamma (activity coefficient, >= 1)
 */
function activityCoefficient(delta_i, delta_mix, V_m, tempC) {
  if (delta_i == null || delta_mix == null || !V_m) return 1.0;
  const T_K = tempC + 273.15;
  const lnGamma = V_m * Math.pow(delta_i - delta_mix, 2) / (R_GAS * T_K);
  return Math.exp(lnGamma);
}


/**
 * Calculate skin permeability coefficient using Potts-Guy equation.
 * log10(Kp_cm_s) = 0.71 * logP - 0.0061 * MW - 2.72
 * @param {number} logP - partition coefficient
 * @param {number} mw - molecular weight
 * @returns {number} Kp in cm/s
 */
function pottsGuyKp(logP, mw) {
  if (logP == null || !mw) return null;
  const logKp = 0.71 * logP - 0.0061 * mw - 2.72;
  return Math.pow(10, logKp);
}

/**
 * Calculate evaporation rate constant.
 * k_evap proportional to VP * MW^(-0.5) / density
 * Normalized so that results are in relative units (not absolute).
 * @param {number} vp_mmHg
 * @param {number} mw
 * @param {number} density
 * @returns {number} relative evaporation rate
 */
function evaporationRate(vp_mmHg, mw, density) {
  if (!vp_mmHg || !mw) return 0;
  const d = density || 1.0;
  return vp_mmHg * Math.pow(mw, -0.5) / d;
}

/**
 * Simulate headspace concentration over time for a formulation.
 * Uses first-order evaporation: C(t) = C0 * exp(-k_evap * t)
 * @param {Array} materials - [{cas, name, pct, data:{...}}]
 * @param {number} tempC
 * @param {Array<number>} timePointsH - hours [0, 0.5, 1, 2, 4, 8, 12, 24]
 * @returns {Object} {timePoints, curves: [{cas, name, note, concentrations:[]}], totals:[]}
 */
function simulateEvaporation(materials, tempC, timePointsH, useActivityCoeff) {
  timePointsH = timePointsH || [0, 0.25, 0.5, 1, 2, 4, 8, 12, 24];
  useActivityCoeff = useActivityCoeff !== false; // default ON

  const curves = [];

  // A1: Helper to get enriched properties (MATERIAL_PROPERTIES fallback)
  function getProps(cas, matData) {
    const mp = (typeof MATERIAL_PROPERTIES !== 'undefined') ? MATERIAL_PROPERTIES[cas] : null;
    return {
      mw: matData?.molecular_weight || (mp && mp.mw) || 150,
      density: matData?.density || (mp && mp.density) || 1.0,
      logP: matData?.xlogp || matData?.logp || (mp && mp.logP) || null,
      bp: matData?.boiling_point || (mp && mp.bp) || null,
    };
  }

  // A2: Pre-compute mixture Hildebrand solubility parameter for activity coefficients
  const matProps = materials.map(mat => getProps(mat.cas, mat.data));
  let delta_mix = 15; // default if computation fails
  if (useActivityCoeff) {
    const solParams = matProps.map(p => ({
      delta: hildebrandSolParam(p.bp, p.mw, p.density, tempC),
      Vm: p.mw / p.density,
    }));
    const totalVol = materials.reduce((s, m, i) =>
      s + (m.pct / 100) * (solParams[i].Vm || 150), 0);
    if (totalVol > 0) {
      delta_mix = materials.reduce((s, m, i) => {
        const phi = (m.pct / 100) * (solParams[i].Vm || 150) / totalVol;
        return s + phi * (solParams[i].delta || 15);
      }, 0);
    }
  }

  for (let idx = 0; idx < materials.length; idx++) {
    const mat = materials[idx];
    const props = matProps[idx];
    const vpResult = getVaporPressure(mat.cas, tempC, mat.data);
    const vp = vpResult.vp_mmHg || 0;
    const mw = props.mw;
    const density = props.density;
    const logP = props.logP;

    const k = evaporationRate(vp, mw, density) * 12;

    // Skin absorption rate via Potts-Guy
    const kp = pottsGuyKp(logP, mw);
    const k_abs = kp ? kp * 3600 * 0.1 : 0;

    // A2: Activity coefficient (Hildebrand/Scatchard-regular solution)
    let gamma = 1.0;
    if (useActivityCoeff && props.bp) {
      const delta_i = hildebrandSolParam(props.bp, mw, density, tempC);
      const Vm = mw / density;
      if (delta_i) gamma = activityCoefficient(delta_i, delta_mix, Vm, tempC);
      gamma = clamp(gamma, 0.5, 5.0); // sanity bounds
    }

    // Headspace concentration in ppb (modified Raoult's law with activity coefficient)
    const MW_REF = 150;
    const P_ATM = 760;
    const x_i = (mat.pct / 100) * (MW_REF / (mw || MW_REF));
    const C0 = x_i * gamma * vp / P_ATM * 1e9; // ppb — gamma=1 for ideal

    // Fix 3A: Two-stage evaporation (Teixeira model approximation)
    const PHASE1_END = 0.5;
    const BURST_FACTOR = 2.5;
    const k_total = k + k_abs;

    const concentrations = timePointsH.map(t => {
      if (t <= PHASE1_END) {
        const burstDecay = BURST_FACTOR * Math.exp(-(BURST_FACTOR * k_total) * t);
        const steadyDecay = Math.exp(-k_total * t);
        const blend = (1 - t / PHASE1_END);
        const factor = blend * burstDecay + (1 - blend) * steadyDecay;
        return roundN(C0 * Math.min(factor, BURST_FACTOR), 6);
      } else {
        const C_at_phase1_end = C0 * Math.exp(-k_total * PHASE1_END);
        return roundN(C_at_phase1_end * Math.exp(-k_total * (t - PHASE1_END)), 6);
      }
    });

    // Fix 3B: Skin retention curve
    const skinRetention = timePointsH.map(t => {
      if (!k_abs || k_abs <= 0) return 0;
      const absorbed = C0 * (k_abs / k_total) * (1 - Math.exp(-k_total * t));
      return roundN(absorbed, 6);
    });

    curves.push({
      cas: mat.cas,
      name: mat.name,
      note: mat.data?.note || '',
      vpResult,
      k_evap: roundN(k, 6),
      k_abs: roundN(k_abs, 8),
      gamma: roundN(gamma, 3),
      C0: roundN(C0, 4),
      concentrations,
      skinRetention,
    });
  }

  const totals = timePointsH.map((_, ti) =>
    roundN(curves.reduce((sum, c) => sum + c.concentrations[ti], 0), 4)
  );

  const skinTotals = timePointsH.map((_, ti) =>
    roundN(curves.reduce((sum, c) => sum + (c.skinRetention ? c.skinRetention[ti] : 0), 0), 4)
  );

  return { timePoints: timePointsH, curves, totals, skinTotals };
}

/**
 * Build vapor pressure table for all materials at a given temperature.
 * @param {Array} materials - [{cas, name, pct, data:{...}}]
 * @param {number} tempC
 * @returns {Array} [{cas, name, vp_mmHg, method, confidence, mw, logP, kp, k_evap}]
 */
function buildVPTable(materials, tempC) {
  return materials.map(mat => {
    const vpResult = getVaporPressure(mat.cas, tempC, mat.data);
    // A1: Use MATERIAL_PROPERTIES enrichment
    const mp = (typeof MATERIAL_PROPERTIES !== 'undefined') ? MATERIAL_PROPERTIES[mat.cas] : null;
    const mw = mat.data?.molecular_weight || (mp && mp.mw) || null;
    const logP = mat.data?.xlogp || mat.data?.logp || (mp && mp.logP) || null;
    const density = mat.data?.density || (mp && mp.density) || null;
    const kp = pottsGuyKp(logP, mw);
    const k_evap = vpResult.vp_mmHg ? evaporationRate(vpResult.vp_mmHg, mw || 150, density || 1.0) : null;

    return {
      cas: mat.cas,
      name: mat.name,
      vp_mmHg: vpResult.vp_mmHg ? roundN(vpResult.vp_mmHg, 6) : null,
      method: vpResult.method,
      confidence: vpResult.confidence,
      mw,
      logP,
      kp: kp ? roundN(kp, 10) : null,
      k_evap: k_evap ? roundN(k_evap, 6) : null,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// SYSTEM 2: Psychophysics & Odor Perception Engine
// ─────────────────────────────────────────────────────────────

/**
 * Get odor detection threshold for a material.
 * Uses hardcoded table first, then QSAR estimation fallback.
 * @param {string} cas
 * @param {Object} matData - may contain molecular_weight, xlogp, tpsa, hbond_donor, hbond_acceptor
 * @returns {Object} {ppb, method, confidence}
 */
function getODT(cas, matData) {
  // Strategy 1: hardcoded table
  const entry = ODOR_THRESHOLDS[cas];
  if (entry) {
    return { ppb: entry.ppb, method: 'literature', source: entry.src, confidence: 'high' };
  }

  // Strategy 2: QSAR estimation from molecular properties
  const mw  = matData?.molecular_weight || null;
  const logP = matData?.xlogp || matData?.logp || null;
  const tpsa = matData?.tpsa || null;
  const hbd = matData?.hbond_donor || 0;
  const hba = matData?.hbond_acceptor || 0;

  if (mw != null && logP != null) {
    const q = QSAR_ODT_COEFFICIENTS;
    const logODT = q.c0 + q.c1 * mw + q.c2 * logP + q.c3 * (tpsa || 30) + q.c4 * hbd + q.c5 * hba;
    return {
      ppb: roundN(Math.pow(10, logODT), 3),
      method: 'qsar',
      source: 'estimated',
      confidence: 'low',
    };
  }

  // Strategy 3: rough estimate from odor strength
  const strength = odorStrengthScale(matData?.odor_strength);
  if (strength != null) {
    // Map ordinal strength to approximate ODT: Very High(5)->1ppb, Low(1)->500ppb
    const approxPpb = Math.pow(10, 2.7 - strength * 0.54);
    return { ppb: roundN(approxPpb, 1), method: 'strength-estimate', source: 'inferred', confidence: 'very-low' };
  }

  return { ppb: null, method: 'none', source: null, confidence: 'none' };
}

/**
 * Calculate Odor Value (OV) for a material.
 * OV = headspace_concentration / ODT
 * @param {number} headspaceConc
 * @param {number} odt_ppb
 * @returns {number}
 */
function calcOdorValue(headspaceConc, odt_ppb) {
  if (!odt_ppb || odt_ppb <= 0 || headspaceConc == null) return 0;
  return headspaceConc / odt_ppb;
}

/**
 * Calculate perceived intensity using Hill equation.
 * PSI = PSI_max * OV^n / (K_half^n + OV^n)
 * @param {number} ov
 * @param {number} n - Stevens exponent
 * @returns {number} 0-100
 */
function hillPerceivedIntensity(ov, n) {
  if (ov <= 0) return 0;
  n = n || 0.5;
  const ovN = Math.pow(ov, n);
  const khN = Math.pow(HILL_K_HALF, n);
  return roundN(HILL_PSI_MAX * ovN / (khN + ovN), 2);
}

/**
 * Get Stevens exponent for a material based on its primary odor family.
 * @param {Object} matData
 * @returns {number} exponent n (default 0.5)
 */
function getStevensExponent(matData) {
  const families = getMaterialFamilies(matData);
  for (const f of families) {
    const fl = f.toLowerCase().trim();
    if (STEVENS_EXPONENTS[fl] != null) return STEVENS_EXPONENTS[fl];
  }
  return 0.50;
}

/**
 * Build full odor value table for all materials in a formulation.
 * Combines System 1 (headspace) with System 2 (perception).
 * @param {Array} materials
 * @param {number} tempC
 * @returns {Array} sorted by perceived intensity descending
 */
function buildOdorValueTable(materials, tempC) {
  const sim = simulateEvaporation(materials, tempC, [0]);

  return materials.map((mat, i) => {
    const curve = sim.curves[i];
    const headspaceConc = curve ? curve.C0 : 0;
    const odtResult = getODT(mat.cas, mat.data);
    const ov = calcOdorValue(headspaceConc, odtResult.ppb);
    const n = getStevensExponent(mat.data);
    let psi = hillPerceivedIntensity(ov, n);

    // Intensity floor for low-VP but high-potency materials:
    // Materials like Indole (VP≈0.004mmHg) and Vanillin (VP≈0.00004mmHg)
    // have very low headspace but are clearly perceived in a perfume.
    // Their contribution on skin comes from direct contact and slow
    // steady-state evaporation not captured by the simple VP model.
    // Use odor strength × percentage as a floor estimate.
    const strength = odorStrengthScale(mat.data?.odor_strength);
    if (strength != null && strength > 0 && mat.pct > 0) {
      // Floor formula: high-strength materials are perceptible even at low doses
      // Uses sqrt(pct) so 0.5% Indole (strength 5) still gets meaningful PSI
      // strength=5,pct=0.5 → 5/5 * sqrt(0.5) * 15 = 10.6
      // strength=3,pct=8   → 3/5 * sqrt(8) * 15  = 25.5
      // strength=1,pct=15  → 1/5 * sqrt(15) * 15 = 11.6
      const floorPsi = (strength / 5) * Math.sqrt(Math.min(mat.pct, 30)) * 15;
      if (floorPsi > psi) psi = roundN(floorPsi, 2);
    }

    return {
      cas: mat.cas,
      name: mat.name,
      note: mat.data?.note || '',
      odt_ppb: odtResult.ppb,
      odt_method: odtResult.method,
      odt_confidence: odtResult.confidence,
      headspaceConc: roundN(headspaceConc, 4),
      odorValue: roundN(ov, 2),
      perceivedIntensity: psi,
      stevensN: n,
    };
  }).sort((a, b) => b.perceivedIntensity - a.perceivedIntensity);
}

// 12-axis perfumery radar
const RADAR_AXES = [
  'citrus', 'green', 'floral', 'fruity', 'woody', 'amber',
  'musk', 'spicy', 'fresh', 'gourmand', 'powdery', 'animalic'
];

/**
 * Map material odor families to radar axis weights.
 * @param {Object} matData
 * @returns {Object} {axis: weight 0-1}
 */
// Family token → one or more of the 12 RADAR_AXES the material contributes to.
// Hoisted out of materialToRadarWeights so scoreFamilyMatch() (brief scoring)
// can reuse the same mapping for target-family lookup.
const FAMILY_TO_AXES = {
  // Legacy keys — materials in PERFUMERY_DATA still emit these tokens
  citrus: ['citrus', 'fresh'], green: ['green', 'fresh'],
  herbal: ['green', 'fresh'], aldehydic: ['fresh', 'floral'],
  aquatic: ['fresh'], ozonic: ['fresh'], fresh: ['fresh'],
  camphoraceous: ['fresh'], floral: ['floral'], fruity: ['fruity'],
  sweet: ['gourmand'], gourmand: ['gourmand'],
  lactonic: ['fruity', 'gourmand'], spicy: ['spicy'],
  powdery: ['powdery'], woody: ['woody'],
  balsamic: ['amber', 'woody'], resinous: ['amber', 'woody'],
  amber: ['amber'], animalic: ['animalic'], leather: ['animalic'],
  musk: ['musk'], smoky: ['woody', 'animalic'],
  vanilla: ['gourmand'], rose: ['floral'], jasmine: ['floral'],
  marine: ['fresh'], earthy: ['woody'],
  // Michael Edwards 2021 subfamily IDs → existing 12 radar axes
  aromatic_fougere: ['green', 'fresh'],
  water:            ['fresh'],
  soft_floral:      ['floral', 'powdery'],
  floral_amber:     ['floral', 'amber'],
  soft_amber:       ['gourmand', 'amber'],
  woody_amber:      ['amber', 'woody', 'animalic'],
  dry_woods:        ['woody', 'animalic'],
  mossy_woods:      ['woody'],
  woods:            ['woody'],
  // Secondary/descriptor tokens that appear in PERFUMERY_DATA odor.type
  // strings after whitespace-splitting (e.g. "Fruity Apple" → [fruity, apple]).
  // Route each to its closest radar axis so materials tagged with compound
  // descriptors don't collapse to zero-signal at the origin of the Odor Map.
  herbaceous:       ['green', 'fresh'],
  coniferous:       ['woody', 'fresh'],
  pine:             ['woody', 'fresh'],
  cedar:            ['woody'],
  sandalwood:       ['woody', 'amber'],
  oud:              ['woody', 'animalic'],
  vetiver:          ['woody'],
  mossy:            ['woody'],
  moss:             ['woody'],
  tobacco:          ['woody', 'animalic'],
  medicinal:        ['fresh'],
  minty:            ['fresh'],
  mint:             ['fresh'],
  clean:            ['fresh'],
  watery:           ['fresh'],
  green_tea:        ['green', 'fresh'],
  leafy:            ['green'],
  tea:              ['green'],
  violet:           ['floral', 'powdery'],
  muguet:           ['floral'],
  lily:             ['floral'],
  orange_blossom:   ['floral'],
  tuberose:         ['floral'],
  ylang:            ['floral'],
  iris:             ['powdery', 'floral'],
  orris:            ['powdery', 'floral'],
  aldehyde:         ['fresh', 'floral'],
  waxy:             ['powdery'],
  fatty:            ['powdery'],
  creamy:           ['gourmand'],
  milky:            ['gourmand'],
  coconut:          ['gourmand', 'fruity'],
  honey:            ['gourmand'],
  caramel:          ['gourmand'],
  chocolate:        ['gourmand'],
  cocoa:            ['gourmand'],
  coffee:           ['gourmand'],
  almond:           ['gourmand'],
  anise:            ['spicy'],
  cinnamon:         ['spicy'],
  clove:            ['spicy'],
  pepper:           ['spicy'],
  warm:             ['amber', 'spicy'],
  tropical:         ['fruity'],
  apple:            ['fruity'],
  pear:             ['fruity'],
  banana:           ['fruity'],
  berry:            ['fruity'],
  peach:            ['fruity'],
  melon:            ['fruity'],
  strawberry:       ['fruity'],
  pineapple:        ['fruity'],
  citrusy:          ['citrus'],
  lemon:            ['citrus', 'fresh'],
  orange:           ['citrus'],
  bergamot:         ['citrus'],
  grapefruit:       ['citrus'],
  lime:             ['citrus'],
  musky:            ['musk'],
  animal:           ['animalic'],
  civet:            ['animalic'],
  ambergris:        ['amber', 'musk'],
  mineral:          ['fresh'],
  chypre:           ['woody', 'green'],
  fougere:          ['green', 'fresh'],
};

function materialToRadarWeights(matData) {
  const weights = {};
  RADAR_AXES.forEach(a => weights[a] = 0);

  const families = getMaterialFamilies(matData);
  if (!families.length) return weights;

  for (const fam of families) {
    const axes = FAMILY_TO_AXES[fam.toLowerCase()] || [];
    for (const ax of axes) {
      if (weights[ax] !== undefined) weights[ax] = Math.min(weights[ax] + 0.5, 1.0);
    }
  }
  return weights;
}

/**
 * Score how well a material (given its radar-axis weights) matches a target
 * family or subfamily. Brief-targets are often subfamily IDs that aren't
 * themselves radar axes (e.g. floral_amber, woody_amber, soft_floral);
 * translate via FAMILY_TO_AXES and take the max weight across the mapped
 * axes. For transitional subfamilies, also grant half-credit to materials
 * that strongly match either adjacent main family — so picking "Floral
 * Amber" still surfaces good Floral or Amber candidates rather than nothing
 * when the material lacks both tags.
 *
 * @param {string} target — target family or subfamily id (lower-case)
 * @param {Object} radarWeights — material's 12-axis weights
 * @returns {number} 0–1
 */
function scoreFamilyMatch(target, radarWeights) {
  if (!target) return 0;
  const lookup = (fam) => {
    // Prefer subfamily → axes mapping. Fall back to treating target as a
    // radar axis if it is one (citrus, floral, …).
    const axes = FAMILY_TO_AXES[fam] || (radarWeights[fam] != null ? [fam] : []);
    let best = 0;
    for (const ax of axes) best = Math.max(best, radarWeights[ax] || 0);
    return best;
  };

  const selfScore = lookup(target);
  const transitional = (typeof FRAGRANCE_WHEEL !== 'undefined'
    && FRAGRANCE_WHEEL.transitional) ? FRAGRANCE_WHEEL.transitional[target] : null;
  if (transitional) {
    const [left, right] = transitional;
    return Math.max(selfScore, 0.5 * lookup(left), 0.5 * lookup(right));
  }
  return selfScore;
}

/**
 * Build radar chart data at multiple time points.
 * @param {Array} materials
 * @param {number} tempC
 * @param {Array<number>} timePointsH
 * @param {string} mixtureModel - 'sum' (default), 'strongest', 'hypo' (Fix 3C)
 * @returns {Object} {axes, datasets:[{label, timeH, data:[12 values]}]}
 */
function buildRadarData(materials, tempC, timePointsH, mixtureModel) {
  timePointsH = timePointsH || [0, 1, 4, 12];
  mixtureModel = mixtureModel || 'sum';
  const sim = simulateEvaporation(materials, tempC, timePointsH);

  const matInfo = materials.map((mat, i) => ({
    radarWeights: materialToRadarWeights(mat.data),
    odt: getODT(mat.cas, mat.data),
    stevensN: getStevensExponent(mat.data),
    curve: sim.curves[i],
  }));

  const datasets = timePointsH.map((t, ti) => {
    const axisValues = RADAR_AXES.map(axis => {
      const contributions = [];
      for (let mi = 0; mi < materials.length; mi++) {
        const info = matInfo[mi];
        const weight = info.radarWeights[axis] || 0;
        if (weight <= 0) continue;
        const conc = info.curve.concentrations[ti] || 0;
        const ov = calcOdorValue(conc, info.odt.ppb);
        const psi = hillPerceivedIntensity(ov, info.stevensN);
        contributions.push(psi * weight);
      }
      if (!contributions.length) return 0;

      let total;
      if (mixtureModel === 'strongest') {
        // Strongest Component Model (Teixeira et al. AIChE 2010)
        total = Math.max(...contributions);
      } else if (mixtureModel === 'hypo') {
        // Hypo-additive: sum with diminishing returns
        contributions.sort((a, b) => b - a);
        total = contributions[0] || 0;
        for (let k = 1; k < contributions.length; k++) {
          total += contributions[k] * Math.pow(0.7, k);
        }
      } else {
        total = contributions.reduce((a, b) => a + b, 0);
      }
      return roundN(total, 2);
    });
    return { label: t === 0 ? 'Initial' : t + 'h', timeH: t, data: axisValues };
  });

  return { axes: RADAR_AXES, datasets };
}

/**
 * Estimate longevity phases (top/heart/base) duration.
 * @param {Array} materials
 * @param {number} tempC
 * @returns {Object} {topPhase, heartPhase, basePhase, totalHours}
 */
function estimateLongevity(materials, tempC) {
  const times = [0, 0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 36, 48];
  const sim = simulateEvaporation(materials, tempC, times);

  // Materials with multi-tier notes ("Top / Middle", "Middle / Base") are
  // added to every tier they span so longevity estimates reflect their full
  // contribution rather than only the first-listed tier.
  const tierConc = { top: [], middle: [], base: [] };
  for (const curve of sim.curves) {
    const tiers = classifyNoteTier(curve.note);
    for (const t of tiers) {
      if (tierConc[t] !== undefined) tierConc[t].push(curve.concentrations);
    }
  }

  function tierTotals(concArrays) {
    return times.map((_, ti) => concArrays.reduce((sum, c) => sum + (c[ti] || 0), 0));
  }

  function findFadeTime(totals) {
    if (!totals[0] || totals[0] <= 0) return 0;
    const threshold = totals[0] * 0.10;
    for (let i = 1; i < times.length; i++) {
      if (totals[i] < threshold) return times[i];
    }
    return times[times.length - 1];
  }

  const topFade = findFadeTime(tierTotals(tierConc.top));
  const midFade = findFadeTime(tierTotals(tierConc.middle));
  const baseFade = findFadeTime(tierTotals(tierConc.base));

  return {
    topPhase:   { start: 0, end: roundN(topFade, 1), label: 'Top notes' },
    heartPhase: { start: roundN(topFade * 0.5, 1), end: roundN(midFade, 1), label: 'Heart notes' },
    basePhase:  { start: roundN(midFade * 0.5, 1), end: roundN(baseFade, 1), label: 'Base notes' },
    totalHours: roundN(baseFade, 1),
  };
}

// ─────────────────────────────────────────────────────────────
// SYSTEM 4: Chemical Dynamics & Maturation Engine
// ─────────────────────────────────────────────────────────────

/**
 * Get SMILES for a material — from enriched data or fallback table.
 * @param {string} cas
 * @param {Object} matData - may contain smiles from PubChem enrichment
 * @returns {string|null}
 */
function getSmiles(cas, matData) {
  if (matData?.smiles) return matData.smiles;
  const fb = SMILES_FALLBACK[cas];
  return fb ? fb.smiles : null;
}

/**
 * Detect functional groups in a SMILES string.
 * @param {string} smiles
 * @returns {Array} [{group, label}]
 */
function detectFunctionalGroups(smiles) {
  if (!smiles) return [];
  const found = [];
  for (const [group, pattern] of Object.entries(FUNCTIONAL_GROUP_PATTERNS)) {
    if (pattern.test(smiles)) {
      found.push({ group, label: pattern.label });
    }
  }
  return found;
}

/**
 * Build functional group matrix for all materials.
 * @param {Array} materials - [{cas, name, data:{smiles?, ...}}]
 * @returns {Array} [{cas, name, smiles, smilesSource, groups:[{group, label}]}]
 */
function buildFunctionalGroupMatrix(materials) {
  return materials.map(mat => {
    const smiles = getSmiles(mat.cas, mat.data);
    let smilesSource = 'none';
    if (mat.data?.smiles) smilesSource = 'pubchem';
    else if (SMILES_FALLBACK[mat.cas]) smilesSource = 'fallback';

    const groups = detectFunctionalGroups(smiles);

    return {
      cas: mat.cas,
      name: mat.name,
      smiles,
      smilesSource,
      groups,
    };
  });
}

/**
 * Detect reactive pairs in the formulation.
 * Checks all material pairs for known problematic reactions.
 * @param {Array} groupMatrix - output of buildFunctionalGroupMatrix()
 * @returns {Array} [{matA, matB, reaction, effect, severity, timeframe, mitigation, colorChange}]
 */
function detectReactivePairs(groupMatrix) {
  const warnings = [];

  for (let i = 0; i < groupMatrix.length; i++) {
    for (let j = i + 1; j < groupMatrix.length; j++) {
      const a = groupMatrix[i];
      const b = groupMatrix[j];
      if (!a.groups.length || !b.groups.length) continue;

      const groupsA = new Set(a.groups.map(g => g.group));
      const groupsB = new Set(b.groups.map(g => g.group));

      for (const rule of REACTIVE_PAIRS) {
        const matchForward = groupsA.has(rule.group_a) && groupsB.has(rule.group_b);
        const matchReverse = groupsA.has(rule.group_b) && groupsB.has(rule.group_a);

        if (matchForward || matchReverse) {
          warnings.push({
            matA: { cas: a.cas, name: a.name, group: matchForward ? rule.group_a : rule.group_b },
            matB: { cas: b.cas, name: b.name, group: matchForward ? rule.group_b : rule.group_a },
            reaction: rule.reaction,
            effect: rule.effect,
            severity: rule.severity,
            timeframe: rule.timeframe,
            mitigation: rule.mitigation,
            colorChange: rule.colorChange,
          });
        }
      }
    }
  }

  // Sort by severity: high > medium > low
  const sevOrder = { high: 0, medium: 1, low: 2 };
  warnings.sort((a, b) => (sevOrder[a.severity] || 2) - (sevOrder[b.severity] || 2));

  return warnings;
}


/**
 * Get stability summary for the formulation.
 * @param {Array} reactiveWarnings - output of detectReactivePairs()
 * @param {Array} groupMatrix - output of buildFunctionalGroupMatrix()
 * @returns {Object} {overallRisk, highCount, mediumCount, lowCount, materialsWithoutSmiles, totalGroups}
 */
function getStabilitySummary(reactiveWarnings, groupMatrix) {
  let highCount = 0, mediumCount = 0, lowCount = 0;
  for (const w of reactiveWarnings) {
    if (w.severity === 'high') highCount++;
    else if (w.severity === 'medium') mediumCount++;
    else lowCount++;
  }

  const materialsWithoutSmiles = groupMatrix.filter(m => !m.smiles).length;
  const totalGroups = groupMatrix.reduce((sum, m) => sum + m.groups.length, 0);

  let overallRisk = 'low';
  if (highCount > 0) overallRisk = 'high';
  else if (mediumCount > 0) overallRisk = 'medium';

  return { overallRisk, highCount, mediumCount, lowCount, materialsWithoutSmiles, totalGroups };
}

// ─────────────────────────────────────────────────────────────
// SYSTEM 6: Aromachology & Mood Engine
// ─────────────────────────────────────────────────────────────

/**
 * Get mood scores for a material.
 * Uses hardcoded table first, then family-level defaults.
 * @param {string} cas
 * @param {Object} matData
 * @returns {Object} {scores: [8 values], method}
 *   Dimensions: [relaxing, energizing, focusing, uplifting, sensual, calming, grounding, refreshing]
 */
function getMoodScores(cas, matData) {
  // Strategy 1: hardcoded material-level scores
  if (AROMACHOLOGY_SCORES[cas]) {
    return { scores: AROMACHOLOGY_SCORES[cas], method: 'literature' };
  }

  // Strategy 2: family-level defaults
  const families = getMaterialFamilies(matData);
  for (const f of families) {
    const fl = f.toLowerCase().trim();
    if (FAMILY_MOOD_DEFAULTS[fl]) {
      return { scores: FAMILY_MOOD_DEFAULTS[fl], method: 'family-default' };
    }
  }

  // Strategy 3: neutral default
  return { scores: [2, 2, 2, 2, 2, 2, 2, 2], method: 'neutral' };
}

/**
 * Compute aggregate mood profile for the entire formulation.
 * Weighted by material percentage (or perceived intensity if available).
 * @param {Array} materials - [{cas, name, pct, data:{...}}]
 * @param {Array|null} ovTable - output of buildOdorValueTable() for intensity weighting
 * @returns {Object} {profile: [8 values], dimensions: string[], perMaterial: [...]}
 */
function computeMoodProfile(materials, ovTable) {
  const profile = new Array(MOOD_DIMENSIONS.length).fill(0);
  let totalWeight = 0;

  const perMaterial = materials.map(mat => {
    const moodResult = getMoodScores(mat.cas, mat.data);

    // Weight: use perceived intensity if available, else fall back to pct
    let weight = mat.pct;
    if (ovTable) {
      const ovEntry = ovTable.find(o => o.cas === mat.cas);
      if (ovEntry && ovEntry.perceivedIntensity > 0) {
        weight = ovEntry.perceivedIntensity;
      }
    }

    totalWeight += weight;
    moodResult.scores.forEach((s, i) => {
      profile[i] += s * weight;
    });

    return {
      cas: mat.cas,
      name: mat.name,
      scores: moodResult.scores,
      method: moodResult.method,
      weight: roundN(weight, 2),
    };
  });

  // Normalize
  if (totalWeight > 0) {
    profile.forEach((_, i) => {
      profile[i] = roundN(profile[i] / totalWeight, 2);
    });
  }

  return { profile, dimensions: [...MOOD_DIMENSIONS], perMaterial };
}

/**
 * Suggest materials to enhance a target mood.
 * @param {Array<string>} targetDimensions - e.g. ['relaxing', 'calming']
 * @param {Array} currentMaterials - current formulation materials
 * @param {Map} graph - compatibility graph
 * @param {Object} db - perfumery DB
 * @param {number} maxResults
 * @returns {Array} [{cas, name, relevance, compatibility, combined, odorType, note, moodScores}]
 */
function suggestByMood(targetDimensions, currentMaterials, graph, db, maxResults) {
  maxResults = maxResults || 10;
  const currentCASes = new Set(currentMaterials.map(m => m.cas));
  const selectedCASes = [...currentCASes];

  const candidates = [];

  for (const [cas, entry] of Object.entries(db)) {
    if (currentCASes.has(cas)) continue;

    const moodResult = getMoodScores(cas, {
      odor_type: entry.odor ? entry.odor.type : null,
      primaryFamilies: [],
    });

    // Relevance: sum of scores in target dimensions
    let relevance = 0;
    for (const dim of targetDimensions) {
      const dimIdx = MOOD_DIMENSIONS.indexOf(dim);
      if (dimIdx >= 0) relevance += moodResult.scores[dimIdx];
    }
    if (relevance <= 0) continue;

    // Compatibility: how many current materials does this blend with?
    let compatibility = 0;
    if (graph) {
      const neighbors = graph.get(cas);
      if (neighbors) {
        for (const s of selectedCASes) {
          if (neighbors.has(s)) compatibility++;
        }
      }
    }

    candidates.push({
      cas,
      name: entry.name,
      relevance,
      compatibility,
      combined: roundN(relevance * 0.7 + compatibility * 0.3, 2),
      odorType: entry.odor ? entry.odor.type : null,
      note: entry.note,
      moodScores: moodResult.scores,
    });
  }

  return candidates
    .sort((a, b) => b.combined - a.combined)
    .slice(0, maxResults);
}

/**
 * Get dominant mood description for the formulation.
 * @param {Array<number>} profile - 8-dim mood profile
 * @returns {Object} {primary, secondary, description}
 */
function describeMood(profile) {
  if (!profile || profile.length === 0) return { primary: null, secondary: null, description: 'No mood data' };

  // Find top 2 dimensions
  const indexed = profile.map((v, i) => ({ dim: MOOD_DIMENSIONS[i], val: v }));
  indexed.sort((a, b) => b.val - a.val);

  const primary = indexed[0];
  const secondary = indexed[1];

  // Mood descriptions
  const descriptions = {
    relaxing:   'Creates a calming, stress-relieving atmosphere',
    energizing: 'Invigorates and boosts energy levels',
    focusing:   'Enhances mental clarity and concentration',
    uplifting:  'Elevates mood and promotes positivity',
    sensual:    'Creates an intimate, warm ambiance',
    calming:    'Soothes anxiety and promotes tranquility',
    grounding:  'Provides stability and connection to nature',
    refreshing: 'Revitalizes and cleanses the senses',
  };

  let description = descriptions[primary.dim] || '';
  if (secondary.val > 2.5) {
    description += ', with ' + secondary.dim + ' undertones';
  }

  return {
    primary: { dimension: primary.dim, score: primary.val },
    secondary: { dimension: secondary.dim, score: secondary.val },
    description,
  };
}

// ─────────────────────────────────────────────────────────────
// A3: Consumer Brief → Formula Generator
// ─────────────────────────────────────────────────────────────

/**
 * Generate a starting formula from a creative brief.
 * @param {Object} brief - { family, moods[], notePct:{top,mid,base}, longevityH, maxIngredients, exclude[] }
 * @param {Object} db - material database (CAS → entry)
 * @param {Map} graph - compatibility graph
 * @returns {Array} [{cas, name, suggestedPct, scores:{family, mood, compat}}]
 */
function generateFromBrief(brief, db, graph) {
  const {
    family = 'floral',
    moods = [],
    notePct = { top: 20, mid: 45, base: 35 },
    longevityH = 8,
    maxIngredients = 10,
    exclude = [],
  } = brief;

  const excludeSet = new Set(exclude);
  const familyLower = family.toLowerCase();

  // Score every material
  const scored = [];
  for (const [cas, entry] of Object.entries(db)) {
    if (excludeSet.has(cas)) continue;
    if (!entry.note) continue; // skip materials without note classification

    // Family score: how well does this material match the target family?
    // scoreFamilyMatch handles subfamily targets (e.g. floral_amber) that
    // aren't radar axes, and gives partial credit to adjacent mains when the
    // target is a transitional subfamily.
    const radarWeights = materialToRadarWeights({
      odor_type: entry.odor?.type,
      primaryFamilies: [], secondaryFamilies: [], facets: [],
    });
    const familyScore = scoreFamilyMatch(familyLower, radarWeights);

    // Mood score: overlap with target moods
    let moodScore = 0;
    if (moods.length && typeof AROMACHOLOGY_SCORES !== 'undefined') {
      const matMoods = AROMACHOLOGY_SCORES[cas];
      if (matMoods) {
        for (const dim of moods) {
          moodScore += (matMoods[dim] || 0) / 5;
        }
        moodScore /= moods.length;
      }
    }

    // Note tier
    const noteTier = primaryNoteTier(entry.note);

    // Longevity alignment: top notes for short, base for long
    let longevityScore = 0;
    if (longevityH <= 3 && noteTier === 'top') longevityScore = 1;
    else if (longevityH <= 8 && noteTier === 'middle') longevityScore = 1;
    else if (longevityH > 8 && noteTier === 'base') longevityScore = 1;
    else longevityScore = 0.4;

    const totalScore = familyScore * 3 + moodScore * 2 + longevityScore;
    if (totalScore > 0) {
      scored.push({ cas, name: entry.name, note: entry.note, noteTier, totalScore, familyScore, moodScore });
    }
  }

  // Sort by score
  scored.sort((a, b) => b.totalScore - a.totalScore);

  // Greedy selection by tier
  const selected = [];
  const tierTargets = {
    base: Math.max(1, Math.round(maxIngredients * notePct.base / 100)),
    middle: Math.max(1, Math.round(maxIngredients * notePct.mid / 100)),
    top: Math.max(1, Math.round(maxIngredients * notePct.top / 100)),
  };
  const tierCounts = { top: 0, middle: 0, base: 0 };
  const selectedCAS = new Set();

  // Fitness-guided greedy selection. Each round re-ranks remaining
  // candidates by (briefScore + fitness_delta) against the partial formula.
  // Hard constraint: skip candidates that form a strong discord (severity >
  // 0.6) with any already-selected material.
  const selectedFamilies = [];
  const fitnessOpts = { catId: brief.catId || null, fragPct: brief.fragPct || 18, tempC: 25, graph: graph };

  const remaining = scored.slice();
  while (selected.length < maxIngredients && remaining.length) {
    let bestIdx = -1, bestScore = -Infinity, bestMat = null;
    const partialMats = selected.map(s => ({ cas: s.cas, name: s.name, pct: 100 / Math.max(1, selected.length), data: { note: s.note, odor_type: db[s.cas]?.odor?.type } }));
    const baseFitness = selected.length ? computeFormulaFitness(partialMats, fitnessOpts).score : 50;

    for (let k = 0; k < remaining.length; k++) {
      const mat = remaining[k];
      const tier = mat.noteTier || 'middle';
      if (tierCounts[tier] >= (tierTargets[tier] || 3)) continue;

      // Hard constraint: no strong discord with any selected material
      const matFams = getMaterialFamilies({ odor_type: db[mat.cas]?.odor?.type });
      let hardReject = false;
      for (const sf of selectedFamilies) {
        if (detectDiscord(matFams, sf) > 0.6) { hardReject = true; break; }
      }
      if (hardReject) continue;

      // Compatibility check (existing)
      if (graph && selectedCAS.size >= 2) {
        const neighbors = graph.get(mat.cas) || new Set();
        const compatCount = [...selectedCAS].filter(c => neighbors.has(c)).length;
        if (compatCount === 0) continue;
      }

      // Estimate fitness delta
      const trial = partialMats.concat([{ cas: mat.cas, name: mat.name, pct: 100 / (selected.length + 1), data: { note: mat.note, odor_type: db[mat.cas]?.odor?.type } }]);
      // Rebalance so pct sums to 100
      const trialN = trial.length;
      trial.forEach(t => t.pct = 100 / trialN);
      const trialFitness = computeFormulaFitness(trial, fitnessOpts).score;
      const fitnessDelta = trialFitness - baseFitness;

      const combined = 0.5 * mat.totalScore + 0.5 * (fitnessDelta / 2); // scale delta into similar range
      if (combined > bestScore) {
        bestScore = combined;
        bestIdx = k;
        bestMat = mat;
      }
    }

    if (bestIdx < 0) break;
    const tier = bestMat.noteTier || 'middle';
    selected.push(bestMat);
    selectedCAS.add(bestMat.cas);
    selectedFamilies.push(getMaterialFamilies({ odor_type: db[bestMat.cas]?.odor?.type }));
    tierCounts[tier]++;
    remaining.splice(bestIdx, 1);
  }

  if (!selected.length) return [];

  // Initial pct allocation via Dirichlet priors
  const matArrayForAlloc = selected.map(s => ({
    cas: s.cas, name: s.name,
    data: { note: s.note, odor_strength: 'Medium' },
  }));
  const allocation = suggestAllocation(matArrayForAlloc, brief.fragPct || 18);
  let pcts = allocation.map((a, i) => a?.suggestedPct || (100 / selected.length));

  // ─── Post-selection polish: hill-climb with full DB context ──────────
  // suggestAllocation already runs a 40-iter polish, but it lacks catId,
  // graph, and odor_type on each material. Re-run with brief's full
  // context (DB entry data, catId, graph) so harmony pairs + pyramid
  // use complete information.
  if (selected.length >= 2) {
    const fullMats = selected.map(s => {
      const entry = db[s.cas] || {};
      return {
        cas: s.cas, name: s.name, pct: 0,
        data: {
          note: s.note,
          odor_type: entry.odor?.type || null,
          odor_strength: entry.odor?.strength || null,
          usage_levels: entry.safety?.usage || null,
          ifra_guideline: entry.safety?.ifra || null,
          molecular_weight: entry.weight || null,
        },
      };
    });
    const fragPct = brief.fragPct || 18;
    const ifraMaxes = fullMats.map(m => {
      const ifra51 = parseIFRA51(m.data?.usage_levels);
      const range = parseUsageRange(m.data?.usage_levels);
      let mp = range.max != null ? range.max : 100;
      if (ifra51) for (const v of Object.values(ifra51)) if (v < mp) mp = v;
      return mp / (fragPct / 100);
    });
    const unlockedIdx = selected.map((_, i) => i);
    const result = _hillClimbFitness(pcts, fullMats, unlockedIdx, ifraMaxes,
      { catId: brief.catId || null, fragPct: fragPct, tempC: 25, graph: graph }, 60);
    pcts = result.pcts.map(p => roundN(p, 2));
    // Renormalize to 100
    const s2 = pcts.reduce((a, b) => a + b, 0);
    if (Math.abs(s2 - 100) > 0.005 && pcts.length) {
      let mi = 0, mv = 0;
      for (let i = 0; i < pcts.length; i++) if (pcts[i] > mv) { mv = pcts[i]; mi = i; }
      pcts[mi] = roundN(pcts[mi] + (100 - s2), 2);
    }
  }

  return selected.map((s, i) => ({
    cas: s.cas,
    name: s.name,
    note: s.note,
    suggestedPct: pcts[i] != null ? pcts[i] : roundN(100 / selected.length, 1),
    scores: { family: roundN(s.familyScore, 2), mood: roundN(s.moodScore, 2), total: roundN(s.totalScore, 2) },
  }));
}

// ─────────────────────────────────────────────────────────────
// C1: Odor Map — 2D projection of material space
// Uses PCA-like approach: project 12-axis radar onto 2 axes
// that capture the most variance (Fresh↔Amber, Floral↔Woody).
// Axis labels align with the Michael Edwards 2021 wheel quadrants.
// ─────────────────────────────────────────────────────────────

// djb2-style string hash — seeded so we can derive two independent pseudo-
// random values per CAS. Used by the Odor Map jitter to spread points whose
// hash inputs collide under naïve (length + charCodeAt(0-1)) mixing.
function _hashCas(s, seed) {
  let h = seed;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0; // h*33 + c
  }
  return h;
}

// Split material odor_type strings into family tokens. The DB uses "/" and
// "," as family separators but sometimes stacks multiple family words in one
// slash-segment (e.g. "Floral Green", "Woody Amber", "Fruity Apple"). Split
// on whitespace too — every recognised family key in familyToAxes /
// familyToSegment is a single word, so space-splitting only gains signal.
function _tokenizeOdorType(odorType) {
  if (!odorType) return [];
  return odorType.toLowerCase()
    .split(/\s*[\/,]\s*/)
    .flatMap(seg => seg.trim().split(/\s+/))
    .filter(Boolean);
}

/**
 * Compute 2D coordinates for all materials in the database.
 * Axis 1 (x): Fresh/Citrus/Green ← → Amber (gourmand/soft_amber/spicy)
 * Axis 2 (y): Floral/Fruity ← → Woody/Earthy/Musk
 * @param {Object} db - material database
 * @returns {Array} [{cas, name, x, y, note, family, inFormulation}]
 */
function buildOdorMap(db, formulationCAS) {
  formulationCAS = formulationCAS || new Set();
  const points = [];

  // Axis weights: each radar axis contributes to x and y. Water (aquatic)
  // sits on the Fresh axis in the Edwards wheel — keep y near 0 so it
  // doesn't drift into the Woody half.
  const xWeights = { citrus: -1, green: -0.8, fresh: -0.9, aquatic: -0.7, fruity: -0.3,
    floral: 0, spicy: 0.7, amber: 0.9, gourmand: 0.6, woody: 0.3, musk: 0.5, animalic: 0.8, powdery: 0.2 };
  const yWeights = { citrus: 0.3, green: 0.5, fresh: 0.2, aquatic: 0, fruity: 0.7,
    floral: 1, spicy: -0.3, amber: -0.5, gourmand: -0.6, woody: -0.9, musk: -0.7, animalic: -0.8, powdery: 0.4 };

  // Tokens that aren't olfactive families. If a row's odor_type consists
  // ONLY of these, or is empty while the note flags a non-aromatic role,
  // exclude the row from the map.
  const nonAromaticRe = /^(solvent|carrier|fixative|additive|preservative|emulsifier|solubilizer|humectant|antioxidant)$/i;

  for (const [cas, entry] of Object.entries(db)) {
    // A row is non-aromatic when either
    //   (a) its odor.type exists but every whitespace/comma/slash token is
    //       in the non-aromatic keyword set (e.g. "Solvent / Fixative" for
    //       Triacetin, Triethyl Citrate, Diethyl Phthalate), OR
    //   (b) its odor.type is empty and its note reads like a carrier tag
    //       ("N/A — carrier", "Preservative", …).
    const noteTxt = (entry.note || '').toString();
    const odorTxt = (entry.odor?.type || '').toString();
    const odorTokens = _tokenizeOdorType(odorTxt);
    const odorAllNonAromatic = odorTokens.length > 0 && odorTokens.every(t => nonAromaticRe.test(t));
    const noteLooksNonAromatic = !noteTxt || /^\s*N\/?A\b|solvent|carrier|fixative|additive|preservative|emulsifier|solubilizer/i.test(noteTxt);
    if (odorAllNonAromatic || (!odorTxt && noteLooksNonAromatic)) continue;
    // Expand the default family tokens with space-split tokens from
    // odor_type so compound descriptors like "Woody Amber" or "Floral Green"
    // contribute to the projection instead of collapsing to 0,0.
    const expandedTokens = _tokenizeOdorType(entry.odor?.type);
    const radar = materialToRadarWeights({
      odor_type: entry.odor?.type,
      primaryFamilies: expandedTokens,
      secondaryFamilies: [], facets: [],
    });
    let x = 0, y = 0;
    for (const axis of RADAR_AXES) {
      const w = radar[axis] || 0;
      x += w * (xWeights[axis] || 0);
      y += w * (yWeights[axis] || 0);
    }
    // Jitter with a proper string hash so distinct CAS rarely collide.
    // Two djb2 hashes with independent seeds produce a well-spread 2-D
    // offset. ±0.15 matches the legacy amplitude so mapped materials keep
    // roughly the same bounds.
    const hx = _hashCas(cas, 5381);
    const hy = _hashCas(cas, 52711);
    x += ((hx & 0xffff) / 0xffff - 0.5) * 0.30;
    y += ((hy & 0xffff) / 0xffff - 0.5) * 0.30;

    const families = getMaterialFamilies({ odor_type: entry.odor?.type, primaryFamilies: [], secondaryFamilies: [], facets: [] });
    const primaryFamily = families[0] || 'other';
    // Fallback id is 'woods' (plural) — the Edwards 2021 subfamily id for the
    // Woody quadrant. Using 'woody' silently misses `.segments.find()` and
    // every unclassified material rendered as the '#888' grey fallback.
    const segment = (typeof FRAGRANCE_WHEEL !== 'undefined' && FRAGRANCE_WHEEL.familyToSegment)
      ? FRAGRANCE_WHEEL.familyToSegment[primaryFamily.toLowerCase()] || 'woods' : 'woods';
    const segData = (typeof FRAGRANCE_WHEEL !== 'undefined')
      ? FRAGRANCE_WHEEL.segments.find(s => s.id === segment) : null;
    // Transitional segments expose `color: null` + a two-stop gradient. Fall
    // back to the gradient's first stop so map dots for fruity / floral_amber
    // / woody_amber materials don't render as `fill="null"` (= black/
    // invisible on dark theme).
    const color = segData
      ? (segData.color || (segData.gradient && segData.gradient[0]) || '#888')
      : '#888';

    points.push({
      cas, name: entry.name,
      x: roundN(x, 3), y: roundN(y, 3),
      note: entry.note || '',
      family: primaryFamily,
      color,
      inFormulation: formulationCAS.has(cas),
    });
  }

  return points;
}

// A5: Cost Calculation Engine
// ─────────────────────────────────────────────────────────────

const CARRIER_COSTS = {
  ethanol: 0.005, dpg: 0.010, ipm: 0.025, coconut_oil: 0.020
};

/**
 * Calculate formula cost breakdown.
 * @param {Array} materials - [{cas, name, pct, data}]
 * @param {number} batchSizeG - batch size in grams
 * @param {string} carrier - carrier type
 * @param {number} fragPct - fragrance concentration %
 * @returns {Object} cost breakdown
 */
/**
 * Calculate formula cost breakdown.
 * @param {Array} materials - fragrance materials [{cas, name, pct, data}]
 * @param {number} batchSizeG - batch size in grams
 * @param {string|Array} carrierArg - legacy carrier type string (e.g. "ethanol")
 *        OR the workspace carrierMaterials array [{cas, name, pct}]. When an
 *        array is passed each entry is priced individually from MATERIAL_COSTS
 *        (solvents, functional additives, everything) and shown in the cost
 *        breakdown table. The string form is kept as a fallback for older
 *        callers that only had a single carrier type.
 * @param {number} fragPct - fragrance concentration in finished product
 */
function calculateFormulaCost(materials, batchSizeG, carrierArg, fragPct) {
  let fragCost = 0;
  let pricedCount = 0;
  const unpricedMats = [];
  const perMaterial = [];

  const fragGrams = batchSizeG * (fragPct / 100);
  const carrierGramsFull = batchSizeG * (1 - fragPct / 100);

  for (const mat of materials) {
    const costEntry = (typeof MATERIAL_COSTS !== 'undefined') ? MATERIAL_COSTS[mat.cas] : null;
    const grams = (mat.pct / 100) * fragGrams;
    if (costEntry) {
      const cost = grams * costEntry.cost_g;
      fragCost += cost;
      pricedCount++;
      perMaterial.push({ cas: mat.cas, name: mat.name, grams: roundN(grams, 2), cost: roundN(cost, 3), tier: costEntry.tier, cost_g: costEntry.cost_g, isCarrier: false });
    } else {
      unpricedMats.push(mat.name);
      perMaterial.push({ cas: mat.cas, name: mat.name, grams: roundN(grams, 2), cost: null, tier: 'unknown', cost_g: null, isCarrier: false });
    }
  }

  // Carrier cost: either a dynamic list (preferred — every solvent/carrier/
  // other additive is priced from MATERIAL_COSTS using its own CAS) or the
  // legacy string form that assumed the carrier was 100 % of the non-fragrance
  // volume at a single per-gram rate.
  let carrierCost = 0;
  if (Array.isArray(carrierArg) && carrierArg.length) {
    for (const c of carrierArg) {
      const costEntry = (typeof MATERIAL_COSTS !== 'undefined') ? MATERIAL_COSTS[c.cas] : null;
      const grams = ((c.pct || 0) / 100) * carrierGramsFull;
      if (costEntry) {
        const cost = grams * costEntry.cost_g;
        carrierCost += cost;
        pricedCount++;
        perMaterial.push({ cas: c.cas, name: c.name, grams: roundN(grams, 2), cost: roundN(cost, 3), tier: costEntry.tier, cost_g: costEntry.cost_g, isCarrier: true });
      } else {
        unpricedMats.push(c.name);
        perMaterial.push({ cas: c.cas, name: c.name, grams: roundN(grams, 2), cost: null, tier: 'unknown', cost_g: null, isCarrier: true });
      }
    }
  } else {
    const carrierCostPerG = CARRIER_COSTS[carrierArg] || 0.005;
    carrierCost = carrierGramsFull * carrierCostPerG;
  }

  const totalCost = fragCost + carrierCost;
  const avgDensity = 0.9;

  return {
    totalCost: roundN(totalCost, 2),
    fragCost: roundN(fragCost, 2),
    carrierCost: roundN(carrierCost, 2),
    costPerMl: roundN(totalCost / (batchSizeG / avgDensity), 3),
    costPerKg: roundN(totalCost / (batchSizeG / 1000), 2),
    pricedCount,
    totalCount: materials.length + (Array.isArray(carrierArg) ? carrierArg.length : 0),
    unpricedMats,
    perMaterial,
    currency: 'USD',
  };
}

// ─────────────────────────────────────────────────────────────
// B2: Multi-Dimensional Substitution Engine
// ─────────────────────────────────────────────────────────────

/**
 * Build an 18-dimensional feature vector for a material.
 * 12 radar axes + 3 note one-hot + logVP + strength + cost tier
 */
function buildMaterialVector(cas, entry) {
  const radar = materialToRadarWeights({
    odor_type: entry.odor?.type || entry.odor_type,
    primaryFamilies: [], secondaryFamilies: [], facets: [],
  });
  const noteVec = noteOneHot(entry.note);
  const strength = odorStrengthScale(entry.odor?.strength || entry.odor_strength) || 3;
  const mp = (typeof MATERIAL_PROPERTIES !== 'undefined') ? MATERIAL_PROPERTIES[cas] : null;
  const bp = entry.boiling_point || (mp && mp.bp) || null;
  const logVP = bp ? Math.log10(Math.max(clausiusClapeyronVP(bp, 25)?.vp_mmHg || 0.001, 0.001)) : 0;
  const costEntry = (typeof MATERIAL_COSTS !== 'undefined') ? MATERIAL_COSTS[cas] : null;
  const costTier = costEntry ? { solvent: 0, commodity: 0.2, standard: 0.4, specialty: 0.6, precious: 1.0 }[costEntry.tier] || 0.4 : 0.4;

  return [
    ...RADAR_AXES.map(a => radar[a] || 0),  // 12 dims
    noteVec.is_top ? 1 : 0,                  // 3 dims
    noteVec.is_middle ? 1 : 0,
    noteVec.is_base ? 1 : 0,
    clamp(logVP / 3, -1, 1),                 // 1 dim (normalized)
    strength / 5,                             // 1 dim
    costTier,                                 // 1 dim
  ]; // total: 18
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return (magA && magB) ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

/**
 * Find multi-dimensional substitutes for a material.
 * @param {string} cas - CAS of material to substitute
 * @param {Object} db - material database
 * @param {Set} exclude - CAS numbers already in formulation
 * @param {number} maxResults
 * @returns {Array} [{cas, name, similarity, note, odorType, tier}]
 */
function suggestSubstitutionMulti(cas, db, exclude, maxResults) {
  maxResults = maxResults || 10;
  exclude = exclude || new Set();
  const entry = db[cas];
  if (!entry) return [];

  const targetVec = buildMaterialVector(cas, entry);
  const candidates = [];

  for (const [candCAS, candEntry] of Object.entries(db)) {
    if (candCAS === cas || exclude.has(candCAS)) continue;
    if (!candEntry.note) continue;
    const candVec = buildMaterialVector(candCAS, candEntry);
    const sim = cosineSimilarity(targetVec, candVec);
    if (sim > 0.3) {
      candidates.push({
        cas: candCAS,
        name: candEntry.name,
        similarity: roundN(sim, 3),
        note: candEntry.note,
        odorType: candEntry.odor?.type || null,
        tier: (typeof MATERIAL_COSTS !== 'undefined' && MATERIAL_COSTS[candCAS]) ? MATERIAL_COSTS[candCAS].tier : 'unknown',
      });
    }
  }

  return candidates.sort((a, b) => b.similarity - a.similarity).slice(0, maxResults);
}

// ─────────────────────────────────────────────────────────────
// B4: Formula Comparison
// ─────────────────────────────────────────────────────────────

/**
 * Compare two formulations — diff materials and percentages.
 * @param {Array} formulaA - [{cas, name, pct}]
 * @param {Array} formulaB - [{cas, name, pct}]
 * @returns {Array} [{cas, name, pctA, pctB, delta, status:'added'|'removed'|'changed'|'unchanged'}]
 */
function compareFormulations(formulaA, formulaB) {
  const allCAS = new Set([...formulaA.map(m => m.cas), ...formulaB.map(m => m.cas)]);
  const diffs = [];
  for (const cas of allCAS) {
    const a = formulaA.find(m => m.cas === cas);
    const b = formulaB.find(m => m.cas === cas);
    const pctA = a ? a.pct : 0;
    const pctB = b ? b.pct : 0;
    const delta = roundN(pctB - pctA, 1);
    let status = 'unchanged';
    if (!a) status = 'added';
    else if (!b) status = 'removed';
    else if (Math.abs(delta) > 0.05) status = 'changed';
    diffs.push({ cas, name: (a || b).name, pctA, pctB, delta, status });
  }
  return diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

// ─── Memoize heavy pure computations ───────────────────────────────────
// Wrap simulateEvaporation / buildVPTable / buildOdorValueTable via the
// _memoize helper defined at the top of this file. Multiple analysis
// tabs invoke these with the same (materials, tempC) pair in a single
// render cycle — the LRU cache trims ~50-80% off cold render time for
// formulations with 10+ materials.
(function _wrapHeavyFunctions() {
  if (typeof simulateEvaporation === 'function') {
    const _raw = simulateEvaporation;
    simulateEvaporation = _memoize(_raw,
      (materials, tempC, timePointsH, useActivityCoeff) =>
        _materialsKey(materials) + '|' + (tempC || 25) +
        '|' + (timePointsH ? timePointsH.join(',') : 'def') +
        '|' + (useActivityCoeff !== false),
      8);
  }
  if (typeof buildVPTable === 'function') {
    const _raw = buildVPTable;
    buildVPTable = _memoize(_raw,
      (materials, tempC) => _materialsKey(materials) + '|' + (tempC || 25),
      8);
  }
  if (typeof buildOdorValueTable === 'function') {
    const _raw = buildOdorValueTable;
    buildOdorValueTable = _memoize(_raw,
      (materials, tempC) => _materialsKey(materials) + '|' + (tempC || 25),
      8);
  }
  if (typeof analyzeNoteBalancePerception === 'function') {
    const _raw = analyzeNoteBalancePerception;
    analyzeNoteBalancePerception = _memoize(_raw,
      (materials, tempC) => _materialsKey(materials) + '|' + (tempC || 25),
      8);
  }
  // computeHarmonyScore: legacy path uses CAS-string array, new path uses
  // material objects. Build a key that handles both shapes + the optional
  // opts.fastMode flag (fast and full results differ, must cache separately).
  if (typeof computeHarmonyScore === 'function') {
    const _raw = computeHarmonyScore;
    computeHarmonyScore = _memoize(_raw,
      (moc, _graph, opts) => {
        const mode = opts && opts.fastMode ? 'f' : 'p';
        if (!moc || !moc.length) return mode + ':<empty>';
        if (typeof moc[0] === 'string') return mode + ':cas:' + moc.join(',');
        return mode + ':obj:' + _materialsKey(moc);
      },
      16);
  }
  if (typeof findCompatibleMaterials === 'function') {
    const _raw = findCompatibleMaterials;
    findCompatibleMaterials = _memoize(_raw,
      (selected, graph, db, maxResults) => (selected || []).join(',') + '|' + (maxResults || 10),
      6);
  }
  // Allocators — the Compat tab renders them purely for the 'Suggested %' and
  // 'Optimized %' columns, which don't change unless materials / fragPct /
  // category / lock state change. Caching here skips the expensive hill-climb
  // on every tab switch.
  if (typeof suggestAllocation === 'function') {
    const _raw = suggestAllocation;
    suggestAllocation = _memoize(_raw,
      (materials, fragPct, locked) =>
        _materialsKey(materials) + '|f' + (fragPct || 18) +
        '|l' + (locked ? [...locked].sort().join(',') : ''),
      6);
  }
  if (typeof optimizeAllocation === 'function') {
    const _raw = optimizeAllocation;
    optimizeAllocation = _memoize(_raw,
      (materials, graph, categoryId, fragPct, iterations, locked) =>
        _materialsKey(materials) + '|c' + (categoryId || '') + '|f' + (fragPct || 18) +
        '|i' + (iterations || 50) +
        '|l' + (locked ? [...locked].sort().join(',') : ''),
      6);
  }
})();
