// ─────────────────────────────────────────────────────────────
// taxonomy.js — Edwards 2021 Fragrance Wheel taxonomy
//
// Single source of truth for the 4-main × 14-sub family taxonomy
// shared between the Analyzer (index.html) and the Formulator
// (formulation.html / formulation_data.js / formulation_engine.js).
// Loaded by both pages BEFORE perfumery_data.js / formulation_data.js
// so subsequent inline scripts can reference these globals directly.
//
// Until v207 the same data lived in two places:
//   • index.html — MAIN_FAMILY_TO_SUBS (4 → set of 14 subs)
//   • formulation_data.js — FRAGRANCE_WHEEL.mainOf (14 → main, inverse)
// They were kept in sync by manual mirroring (see the "Identical
// layout" comment that used to live above MAIN_FAMILY_TO_SUBS) — a
// drift hazard whenever the wheel taxonomy changes. This module
// removes the mirror.
// ─────────────────────────────────────────────────────────────

// ── Edwards 2021 Main Family axis (4 buckets) ──
const MAIN_FAMILIES = ['fresh', 'floral', 'amber', 'woody'];

const MAIN_FAMILY_LABELS = {
  fresh:  'Fresh',
  floral: 'Floral',
  amber:  'Amber',
  woody:  'Woody',
};

// ── Main → set of sub-family ids ──
// Each main bucket owns 3-4 sub-families. The Edwards 2021 wheel
// places three transitional slices (Aromatic Fougère, Fruity, Woody
// Amber) on cardinal boundaries — they live inside their anchor band
// but render with a blended colour gradient. Order within each main
// follows the wheel's clockwise sweep starting from 12 o'clock.
const MAIN_FAMILY_TO_SUBS = {
  fresh:  new Set(['aromatic_fougere', 'citrus', 'water', 'green']),
  floral: new Set(['fruity', 'floral', 'soft_floral', 'floral_amber']),
  amber:  new Set(['soft_amber', 'amber', 'woody_amber']),
  woody:  new Set(['woods', 'mossy_woods', 'dry_woods']),
};

// ── Sub-family → its parent main (derived) ──
const SUB_FAMILY_TO_MAIN = (() => {
  const m = {};
  for (const [main, subs] of Object.entries(MAIN_FAMILY_TO_SUBS)) {
    for (const s of subs) m[s] = main;
  }
  return m;
})();
