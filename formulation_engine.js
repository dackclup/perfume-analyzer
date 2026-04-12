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
