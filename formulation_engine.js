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

// ─────────────────────────────────────────────────────────────
// SHARED UTILITIES
// Duplicated from index.html (lines 3589-3694) to keep the
// formulation page self-contained without refactoring the
// existing single-file app.
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

// Ordinal scale for odor strength text → 0-5 number
function odorStrengthScale(s) {
  if (!s) return null;
  const sl = s.toLowerCase();
  if (sl.includes('extremely high')) return 5;
  if (sl.includes('very high')) return 5;
  if (sl.includes('high'))        return 4;
  if (sl.includes('medium to high')) return 3.5;
  if (sl.includes('medium'))      return 3;
  if (sl.includes('low to medium')) return 2;
  if (sl.includes('low'))         return 1;
  if (sl.includes('none'))        return 0;
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

// Unit conversion: text → degrees Celsius
function parseTempCelsius(text) {
  if (!text) return null;
  const patterns = [
    { re: /([-\d.]+)\s*°?\s*C\b/i,  fn: v => v },
    { re: /([-\d.]+)\s*°?\s*F\b/i,  fn: v => (v - 32) * 5 / 9 },
    { re: /([-\d.]+)\s*K\b/i,       fn: v => v - 273.15 },
  ];
  for (const { re, fn } of patterns) {
    const m = text.match(re);
    if (m) return Math.round(fn(parseFloat(m[1])) * 100) / 100;
  }
  return null;
}

// Unit conversion: text → mmHg
function parsePressureMmHg(text) {
  if (!text) return null;
  const patterns = [
    { re: /([\d.eE+\-]+)\s*mm\s*Hg/i,    fn: v => v },
    { re: /([\d.eE+\-]+)\s*kPa/i,         fn: v => v * 7.50062 },
    { re: /([\d.eE+\-]+)\s*atm/i,         fn: v => v * 760 },
    { re: /([\d.eE+\-]+)\s*\[mmHg\]/i,    fn: v => v },
  ];
  for (const { re, fn } of patterns) {
    const m = text.match(re);
    if (m) return Math.round(fn(parseFloat(m[1])) * 1e6) / 1e6;
  }
  return null;
}

// Unit conversion: text → g/cm³
function parseDensity(text) {
  if (!text) return null;
  const m = text.match(/([\d.]+)\s*(g\s*\/?\s*(cu\s*)?cm|g\s*\/?\s*mL)?/i);
  return m ? parseFloat(m[1]) : null;
}

// Parse multiple values with a parser function, return array
function parseAllValues(items, parseFn) {
  if (!items) return [];
  const vals = [];
  for (const item of items) {
    const v = parseFn(item);
    if (v != null && isFinite(v)) vals.push(v);
  }
  return vals;
}

// Median of a numeric array
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2 * 100) / 100;
}

// Parse hours from text like "~2 hours", "~400 hours", "~48 hours"
function parseDurationHours(s) {
  if (!s) return null;
  const m = s.match(/([\d.]+)\s*hour/i);
  return m ? parseFloat(m[1]) : null;
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

    if (ifra51 && cat.key) {
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

    // Detect ban status from IFRA guideline text
    let banStatus = null;
    if (ifraText) {
      const ifraLower = ifraText.toLowerCase();
      if (ifraLower.includes('banned') || ifraLower.includes('prohibition')) {
        banStatus = 'banned';
      } else if (ifraLower.includes('restricted') || ifraLower.includes('regulated')) {
        banStatus = 'restricted';
      }
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
      status = compliant ? (margin < 20 ? 'warn' : 'ok') : 'danger';
    } else {
      // No specific IFRA limit found — check usage range
      if (usageRange.max !== null && pctInConcentrate > usageRange.max) {
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
function computeHarmonyScore(selectedCASes, graph) {
  if (selectedCASes.length < 2) return { score: 100, connectedPairs: 0, totalPairs: 0, pairs: [] };

  const pairs = [];
  let connectedPairs = 0;
  let totalPairs = 0;

  for (let i = 0; i < selectedCASes.length; i++) {
    for (let j = i + 1; j < selectedCASes.length; j++) {
      totalPairs++;
      const a = selectedCASes[i];
      const b = selectedCASes[j];
      const neighbors = graph.get(a);
      const connected = neighbors ? neighbors.has(b) : false;
      if (connected) connectedPairs++;
      pairs.push({ a, b, connected });
    }
  }

  const score = totalPairs > 0 ? Math.round(connectedPairs / totalPairs * 100) : 100;
  return { score, connectedPairs, totalPairs, pairs };
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

  return {
    top:    roundN(tiers.top, 1),
    middle: roundN(tiers.middle, 1),
    base:   roundN(tiers.base, 1),
    unclassified: roundN(unclassifiedPct, 1),
    unclassifiedMats,
    total:  roundN(total, 1),
    missing,
    balanced: missing.length === 0,
    ideal: { top: '15-30%', middle: '30-50%', base: '20-40%' },
  };
}

/**
 * Suggest initial percentage allocation using Dirichlet-inspired priors.
 * Stronger materials get lower %, base notes get more than top notes.
 * @param {Array} materials - [{cas, name, data:{note, odor_strength}}]
 * @returns {Array} [{cas, name, suggestedPct}]
 */
function suggestAllocation(materials) {
  if (!materials.length) return [];

  const alphas = materials.map(mat => {
    const note = (mat.data?.note || '').toLowerCase();
    const strength = odorStrengthScale(mat.data?.odor_strength) || 3;

    // Base alpha by note tier
    let baseAlpha;
    if (note.includes('base'))        baseAlpha = 5.0;
    else if (note.includes('middle')) baseAlpha = 3.5;
    else if (note.includes('top'))    baseAlpha = 2.0;
    else                              baseAlpha = 3.0; // functional/unknown

    // Inverse strength: stronger materials need less
    // strength 1 (Low) → multiply by 3, strength 5 (Very High) → multiply by 0.6
    const strengthFactor = 3 / clamp(strength, 0.5, 5);

    return baseAlpha * strengthFactor;
  });

  // Normalize to sum to 100%
  const sum = alphas.reduce((a, b) => a + b, 0);
  return materials.map((mat, i) => ({
    cas: mat.cas,
    name: mat.name,
    suggestedPct: roundN((alphas[i] / sum) * 100, 1),
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
    return range.max || 100;
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

    // Project: clamp unlocked, re-normalize unlocked to fill remaining budget
    const lockedSum = materials.reduce((s, m, i) => s + (locked.has(m.cas) ? pcts[i] : 0), 0);
    const targetUnlocked = Math.max(100 - lockedSum, 0);
    for (let i = 0; i < n; i++) {
      if (locked.has(materials[i].cas)) continue;
      pcts[i] = clamp(pcts[i], 0.1, ifraMaxes[i]);
    }
    const unlockedSum = pcts.reduce((s, v, i) => s + (locked.has(materials[i].cas) ? 0 : v), 0);
    if (unlockedSum > 0 && targetUnlocked > 0) {
      for (let i = 0; i < n; i++) {
        if (locked.has(materials[i].cas)) continue;
        pcts[i] = pcts[i] / unlockedSum * targetUnlocked;
      }
    }
  }

  return materials.map((m, i) => ({
    cas: m.cas,
    name: m.name,
    optimizedPct: roundN(pcts[i], 1),
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
 * Calculate modified Raoult's law partial pressure.
 * P_i = x_i * gamma_i * P_i_sat(T)
 * @param {number} moleFraction - x_i
 * @param {number} gamma - activity coefficient
 * @param {number} vpSat - saturated VP at temp (mmHg)
 * @returns {number} partial pressure in mmHg
 */
function raoultPartialPressure(moleFraction, gamma, vpSat) {
  return moleFraction * gamma * vpSat;
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
function materialToRadarWeights(matData) {
  const weights = {};
  RADAR_AXES.forEach(a => weights[a] = 0);

  const families = getMaterialFamilies(matData);
  if (!families.length) return weights;

  const familyToAxes = {
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
  };

  for (const fam of families) {
    const axes = familyToAxes[fam.toLowerCase()] || [];
    for (const ax of axes) {
      if (weights[ax] !== undefined) weights[ax] = Math.min(weights[ax] + 0.5, 1.0);
    }
  }
  return weights;
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

  const tierConc = { top: [], middle: [], base: [] };
  for (const curve of sim.curves) {
    const tier = primaryNoteTier(curve.note);
    if (tier && tierConc[tier] !== undefined) tierConc[tier].push(curve.concentrations);
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
 * Suggest substitution for a problematic material.
 * Finds materials in the same odor family that lack the reactive group.
 * @param {string} cas - CAS of material to replace
 * @param {string} avoidGroup - functional group to avoid
 * @param {Object} db - perfumery DB
 * @param {number} maxResults
 * @returns {Array} [{cas, name, odorType, note}]
 */
function suggestSubstitution(cas, avoidGroup, db, maxResults) {
  maxResults = maxResults || 5;
  const entry = db[cas];
  if (!entry) return [];

  const targetType = (entry.odor && entry.odor.type || '').toLowerCase();
  const targetNote = (entry.note || '').toLowerCase();

  const candidates = [];
  for (const [candCAS, candEntry] of Object.entries(db)) {
    if (candCAS === cas) continue;

    // Must have similar odor type
    const candType = (candEntry.odor && candEntry.odor.type || '').toLowerCase();
    if (!candType || !targetType) continue;
    const typeWords = targetType.split(/[\s\/,]+/);
    const candWords = candType.split(/[\s\/,]+/);
    const overlap = typeWords.filter(w => candWords.includes(w)).length;
    if (overlap === 0) continue;

    // Must not have the problematic functional group
    const smiles = getSmiles(candCAS, {});
    if (smiles) {
      const pattern = FUNCTIONAL_GROUP_PATTERNS[avoidGroup];
      if (pattern && pattern.test(smiles)) continue;
    }

    candidates.push({
      cas: candCAS,
      name: candEntry.name,
      odorType: candEntry.odor ? candEntry.odor.type : null,
      note: candEntry.note,
      similarity: overlap / typeWords.length,
    });
  }

  return candidates
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults)
    .map(({ similarity, ...rest }) => rest);
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
    const radarWeights = materialToRadarWeights({
      odor_type: entry.odor?.type,
      primaryFamilies: [], secondaryFamilies: [], facets: [],
    });
    const familyScore = radarWeights[familyLower] || 0;

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

  for (const mat of scored) {
    if (selected.length >= maxIngredients) break;
    const tier = mat.noteTier || 'middle';
    if (tierCounts[tier] >= (tierTargets[tier] || 3)) continue;

    // Check compatibility with already selected
    let compatOK = true;
    if (graph && selectedCAS.size > 0) {
      const neighbors = graph.get(mat.cas) || new Set();
      const compatCount = [...selectedCAS].filter(c => neighbors.has(c)).length;
      if (selectedCAS.size >= 2 && compatCount === 0) compatOK = false; // skip if no documented compat
    }
    if (!compatOK) continue;

    selected.push(mat);
    selectedCAS.add(mat.cas);
    tierCounts[tier]++;
  }

  if (!selected.length) return [];

  // Assign percentages using suggestAllocation logic
  const matArray = selected.map(s => ({
    cas: s.cas, name: s.name,
    data: { note: s.note, odor_strength: 'Medium' },
  }));
  const allocation = suggestAllocation(matArray);

  return selected.map((s, i) => ({
    cas: s.cas,
    name: s.name,
    note: s.note,
    suggestedPct: allocation[i]?.suggestedPct || roundN(100 / selected.length, 1),
    scores: { family: roundN(s.familyScore, 2), mood: roundN(s.moodScore, 2), total: roundN(s.totalScore, 2) },
  }));
}

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// C3: AI-Assisted Formula Suggestion (Philyra-lite)
// Given a target 12-axis radar profile + 8-axis mood profile,
// select materials that collectively approximate the target.
// ─────────────────────────────────────────────────────────────

/**
 * Suggest a formula that matches a target odor + mood profile.
 * Uses greedy residual-minimization: pick the material that most
 * reduces the distance between current blend and target.
 * @param {number[]} targetRadar - 12 values for RADAR_AXES (0-100 each)
 * @param {number[]} targetMood - 8 values for mood dims (0-5 each)
 * @param {Object} db - material database
 * @param {number} maxIngredients - max materials to select
 * @returns {Array} [{cas, name, suggestedPct, note}]
 */
function suggestFromProfile(targetRadar, targetMood, db, maxIngredients) {
  maxIngredients = maxIngredients || 10;
  if (!targetRadar || targetRadar.length !== 12) return [];

  const selected = [];
  const selectedSet = new Set();
  // Normalize target to unit vector
  const targetMag = Math.sqrt(targetRadar.reduce((s, v) => s + v * v, 0)) || 1;
  const tNorm = targetRadar.map(v => v / targetMag);

  // Current blend profile starts at zero
  let currentRadar = new Array(12).fill(0);

  for (let round = 0; round < maxIngredients; round++) {
    let bestCAS = null, bestScore = -Infinity, bestRadar = null;

    for (const [cas, entry] of Object.entries(db)) {
      if (selectedSet.has(cas) || !entry.note) continue;

      const matRadar = materialToRadarWeights({
        odor_type: entry.odor?.type, primaryFamilies: [], secondaryFamilies: [], facets: [],
      });
      const matVec = RADAR_AXES.map(a => (matRadar[a] || 0) * 50); // scale to ~0-50

      // Simulate adding this material (equal weight for scoring)
      const trial = currentRadar.map((v, j) => v + matVec[j]);
      const trialMag = Math.sqrt(trial.reduce((s, v) => s + v * v, 0)) || 1;
      const trialNorm = trial.map(v => v / trialMag);

      // Cosine similarity with target
      let sim = 0;
      for (let j = 0; j < 12; j++) sim += trialNorm[j] * tNorm[j];

      // Mood bonus
      if (targetMood && typeof AROMACHOLOGY_SCORES !== 'undefined') {
        const moods = AROMACHOLOGY_SCORES[cas];
        if (moods) {
          const MOOD_DIMS = ['relaxing','energizing','focusing','uplifting','sensual','calming','grounding','refreshing'];
          let moodSim = 0;
          for (let j = 0; j < MOOD_DIMS.length; j++) {
            moodSim += ((moods[MOOD_DIMS[j]] || 0) / 5) * ((targetMood[j] || 0) / 5);
          }
          sim += moodSim * 0.3; // mood is 30% of score
        }
      }

      if (sim > bestScore) { bestScore = sim; bestCAS = cas; bestRadar = matVec; }
    }

    if (!bestCAS) break;
    selected.push({ cas: bestCAS, name: db[bestCAS].name, note: db[bestCAS].note });
    selectedSet.add(bestCAS);
    currentRadar = currentRadar.map((v, j) => v + bestRadar[j]);
  }

  if (!selected.length) return [];

  // Assign percentages
  const matArray = selected.map(s => ({ cas: s.cas, name: s.name, data: { note: s.note, odor_strength: 'Medium' } }));
  const allocation = suggestAllocation(matArray);
  return selected.map((s, i) => ({
    cas: s.cas, name: s.name, note: s.note,
    suggestedPct: allocation[i]?.suggestedPct || roundN(100 / selected.length, 1),
  }));
}

// ─────────────────────────────────────────────────────────────
// C1: Odor Map — 2D projection of material space
// Uses PCA-like approach: project 12-axis radar onto 2 axes
// that capture the most variance (Fresh↔Oriental, Floral↔Woody)
// ─────────────────────────────────────────────────────────────

/**
 * Compute 2D coordinates for all materials in the database.
 * Axis 1 (x): Fresh/Citrus/Green ← → Oriental/Amber/Spicy
 * Axis 2 (y): Floral/Fruity ← → Woody/Earthy/Musk
 * @param {Object} db - material database
 * @returns {Array} [{cas, name, x, y, note, family, inFormulation}]
 */
function buildOdorMap(db, formulationCAS) {
  formulationCAS = formulationCAS || new Set();
  const points = [];

  // Axis weights: each radar axis contributes to x and y
  const xWeights = { citrus: -1, green: -0.8, fresh: -0.9, aquatic: -0.7, fruity: -0.3,
    floral: 0, spicy: 0.7, amber: 0.9, gourmand: 0.6, woody: 0.3, musk: 0.5, animalic: 0.8, powdery: 0.2 };
  const yWeights = { citrus: 0.3, green: 0.5, fresh: 0.2, aquatic: -0.2, fruity: 0.7,
    floral: 1, spicy: -0.3, amber: -0.5, gourmand: -0.6, woody: -0.9, musk: -0.7, animalic: -0.8, powdery: 0.4 };

  for (const [cas, entry] of Object.entries(db)) {
    const radar = materialToRadarWeights({
      odor_type: entry.odor?.type, primaryFamilies: [], secondaryFamilies: [], facets: [],
    });
    let x = 0, y = 0;
    for (const axis of RADAR_AXES) {
      const w = radar[axis] || 0;
      x += w * (xWeights[axis] || 0);
      y += w * (yWeights[axis] || 0);
    }
    // Add small jitter to prevent overlap
    x += (Math.sin(cas.length * 37 + cas.charCodeAt(0)) * 0.15);
    y += (Math.cos(cas.length * 53 + cas.charCodeAt(1 % cas.length)) * 0.15);

    const families = getMaterialFamilies({ odor_type: entry.odor?.type, primaryFamilies: [], secondaryFamilies: [], facets: [] });
    const primaryFamily = families[0] || 'other';
    const segment = (typeof FRAGRANCE_WHEEL !== 'undefined' && FRAGRANCE_WHEEL.familyToSegment)
      ? FRAGRANCE_WHEEL.familyToSegment[primaryFamily.toLowerCase()] || 'woody' : 'woody';
    const segData = (typeof FRAGRANCE_WHEEL !== 'undefined')
      ? FRAGRANCE_WHEEL.segments.find(s => s.id === segment) : null;

    points.push({
      cas, name: entry.name,
      x: roundN(x, 3), y: roundN(y, 3),
      note: entry.note || '',
      family: primaryFamily,
      color: segData ? segData.color : '#888',
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
function calculateFormulaCost(materials, batchSizeG, carrier, fragPct) {
  let fragCost = 0;
  let pricedCount = 0;
  const unpricedMats = [];
  const perMaterial = [];

  const fragGrams = batchSizeG * (fragPct / 100);

  for (const mat of materials) {
    const costEntry = (typeof MATERIAL_COSTS !== 'undefined') ? MATERIAL_COSTS[mat.cas] : null;
    const grams = (mat.pct / 100) * fragGrams;
    if (costEntry) {
      const cost = grams * costEntry.cost_g;
      fragCost += cost;
      pricedCount++;
      perMaterial.push({ cas: mat.cas, name: mat.name, grams: roundN(grams, 2), cost: roundN(cost, 3), tier: costEntry.tier, cost_g: costEntry.cost_g });
    } else {
      unpricedMats.push(mat.name);
      perMaterial.push({ cas: mat.cas, name: mat.name, grams: roundN(grams, 2), cost: null, tier: 'unknown', cost_g: null });
    }
  }

  const carrierGrams = batchSizeG * (1 - fragPct / 100);
  const carrierCostPerG = CARRIER_COSTS[carrier] || 0.005;
  const carrierCost = carrierGrams * carrierCostPerG;
  const totalCost = fragCost + carrierCost;
  const avgDensity = 0.9;

  return {
    totalCost: roundN(totalCost, 2),
    fragCost: roundN(fragCost, 2),
    carrierCost: roundN(carrierCost, 2),
    costPerMl: roundN(totalCost / (batchSizeG / avgDensity), 3),
    costPerKg: roundN(totalCost / (batchSizeG / 1000), 2),
    pricedCount,
    totalCount: materials.length,
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
