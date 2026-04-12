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
function generateINCILabel(materials, allergenResult) {
  // Main ingredients sorted by descending %
  const sorted = [...materials].sort((a, b) => b.pct - a.pct);
  const inciParts = [];

  for (const mat of sorted) {
    const inci = INCI_NAMES[mat.cas];
    if (inci) {
      inciParts.push(inci);
    } else {
      // Fallback: use material name in uppercase
      inciParts.push(mat.name.toUpperCase());
    }
  }

  // Append declared allergens (exceeding threshold, not already listed)
  if (allergenResult && allergenResult.allergens) {
    const mainCASSet = new Set(materials.map(m => m.cas));
    const declaredAllergens = allergenResult.allergens
      .filter(a => a.exceedsThreshold && !mainCASSet.has(a.cas))
      .map(a => a.inci);

    if (declaredAllergens.length) {
      inciParts.push(...declaredAllergens);
    }
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

  for (const mat of materials) {
    const note = mat.data?.note || '';
    const classified = classifyNoteTier(note);
    for (const t of classified) {
      tiers[t] += mat.pct;
    }
    // If material spans two tiers, split was already counted for both
  }

  const total = tiers.top + tiers.middle + tiers.base;
  const missing = [];
  if (tiers.top === 0) missing.push('top');
  if (tiers.middle === 0) missing.push('middle');
  if (tiers.base === 0) missing.push('base');

  return {
    top:    roundN(tiers.top, 1),
    middle: roundN(tiers.middle, 1),
    base:   roundN(tiers.base, 1),
    total:  roundN(total, 1),
    missing,
    balanced: missing.length === 0,
    // Ideal ranges (guidelines, not strict rules)
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
 * @returns {Array} [{cas, name, optimizedPct}]
 */
function optimizeAllocation(materials, graph, categoryId, fragPct, iterations) {
  iterations = iterations || 50;
  if (materials.length < 2) {
    return materials.map(m => ({ cas: m.cas, name: m.name, optimizedPct: m.pct }));
  }

  // Start from current allocation
  let pcts = materials.map(m => m.pct);
  const n = pcts.length;

  // Get IFRA max limits per material
  const ifraMaxes = materials.map(mat => {
    const ifra51 = parseIFRA51(mat.data?.usage_levels);
    const cat = IFRA_CATEGORIES[categoryId];
    if (ifra51 && cat && cat.key && ifra51[cat.key] != null) {
      // Convert from % in product to % in concentrate
      return ifra51[cat.key] / (fragPct / 100);
    }
    const range = parseUsageRange(mat.data?.usage_levels);
    return range.max || 100;
  });

  // Iterative projected gradient
  const lr = 0.5;
  for (let iter = 0; iter < iterations; iter++) {
    // Compute gradient: push toward better note balance
    const grad = new Array(n).fill(0);

    // Note balance gradient
    const tiers = { top: 0, middle: 0, base: 0 };
    const tierIdx = { top: [], middle: [], base: [] };
    for (let i = 0; i < n; i++) {
      const note = (materials[i].data?.note || '').toLowerCase();
      if (note.includes('top'))    { tiers.top += pcts[i]; tierIdx.top.push(i); }
      if (note.includes('middle') || note.includes('mid')) { tiers.middle += pcts[i]; tierIdx.middle.push(i); }
      if (note.includes('base'))   { tiers.base += pcts[i]; tierIdx.base.push(i); }
    }

    const total = pcts.reduce((a, b) => a + b, 0) || 1;
    const targetTop = total * 0.22;
    const targetMid = total * 0.40;
    const targetBase = total * 0.30;

    // Push tier members toward target
    for (const i of tierIdx.top)    grad[i] += (targetTop - tiers.top) / (tierIdx.top.length || 1) * 0.01;
    for (const i of tierIdx.middle) grad[i] += (targetMid - tiers.middle) / (tierIdx.middle.length || 1) * 0.01;
    for (const i of tierIdx.base)   grad[i] += (targetBase - tiers.base) / (tierIdx.base.length || 1) * 0.01;

    // Apply gradient
    for (let i = 0; i < n; i++) {
      pcts[i] = pcts[i] + lr * grad[i];
    }

    // Project: clamp to [0.1, ifraMax], then re-normalize to sum=100
    for (let i = 0; i < n; i++) {
      pcts[i] = clamp(pcts[i], 0.1, ifraMaxes[i]);
    }
    const pctSum = pcts.reduce((a, b) => a + b, 0);
    if (pctSum > 0) {
      for (let i = 0; i < n; i++) pcts[i] = pcts[i] / pctSum * 100;
    }
  }

  return materials.map((m, i) => ({
    cas: m.cas,
    name: m.name,
    optimizedPct: roundN(pcts[i], 1),
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
function simulateEvaporation(materials, tempC, timePointsH) {
  timePointsH = timePointsH || [0, 0.25, 0.5, 1, 2, 4, 8, 12, 24];

  const curves = [];

  for (const mat of materials) {
    const vpResult = getVaporPressure(mat.cas, tempC, mat.data);
    const vp = vpResult.vp_mmHg || 0;
    const mw = mat.data?.molecular_weight || 150; // default MW
    const density = mat.data?.density || 1.0;

    // Evaporation rate constant (normalized)
    const k = evaporationRate(vp, mw, density) * 0.01; // scale factor

    // Initial headspace concentration proportional to initial VP contribution
    const C0 = mat.pct * vp;

    const concentrations = timePointsH.map(t => {
      return roundN(C0 * Math.exp(-k * t), 6);
    });

    curves.push({
      cas: mat.cas,
      name: mat.name,
      note: mat.data?.note || '',
      vpResult,
      k_evap: roundN(k, 6),
      C0: roundN(C0, 4),
      concentrations,
    });
  }

  // Totals per time point
  const totals = timePointsH.map((_, ti) =>
    roundN(curves.reduce((sum, c) => sum + c.concentrations[ti], 0), 4)
  );

  return { timePoints: timePointsH, curves, totals };
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
    const mw = mat.data?.molecular_weight || null;
    const logP = mat.data?.xlogp || mat.data?.logp || null;
    const density = mat.data?.density || null;
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
    const psi = hillPerceivedIntensity(ov, n);

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
 * @returns {Object} {axes, datasets:[{label, timeH, data:[12 values]}]}
 */
function buildRadarData(materials, tempC, timePointsH) {
  timePointsH = timePointsH || [0, 1, 4, 12];
  const sim = simulateEvaporation(materials, tempC, timePointsH);

  const matInfo = materials.map((mat, i) => ({
    radarWeights: materialToRadarWeights(mat.data),
    odt: getODT(mat.cas, mat.data),
    stevensN: getStevensExponent(mat.data),
    curve: sim.curves[i],
  }));

  const datasets = timePointsH.map((t, ti) => {
    const axisValues = RADAR_AXES.map(axis => {
      let total = 0;
      for (let mi = 0; mi < materials.length; mi++) {
        const info = matInfo[mi];
        const weight = info.radarWeights[axis] || 0;
        if (weight <= 0) continue;
        const conc = info.curve.concentrations[ti] || 0;
        const ov = calcOdorValue(conc, info.odt.ppb);
        const psi = hillPerceivedIntensity(ov, info.stevensN);
        total += psi * weight;
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
