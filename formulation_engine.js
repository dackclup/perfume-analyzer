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
