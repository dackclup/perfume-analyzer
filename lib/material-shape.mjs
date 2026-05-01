// lib/material-shape.mjs — canonical "enriched" material shape used by
// the formulation engine. Single source of truth shared by every code
// path that calls formulation.addMaterial(cas, name, pct, enriched).
//
// Audit-coherence Tier 2 R3 fix. Before this module, the same 19-field
// object was rebuilt inline at four sites in formulation.html
// (addFromDB, addRecommendation, applyBriefFormula, the renderMapTab
// fallback). Two of those sites were missing the classification five
// (primaryFamilies/secondaryFamilies/facets/functions/regulatory) for
// months, which made `materialToRadarWeights` behave differently
// depending on which path the user took to add a material — Audit
// finding C3.2/C3.3.
//
// Centralising here makes the shape diff visible in code review.
// Adding a field to enriched is now a one-place edit.

// ── buildEnriched ─────────────────────────────────────────────────────
// Build the canonical enriched shape from a DB row.
//
//   entry  — the DB[cas] row (must have .cas and .name)
//   mp     — optional MATERIAL_PROPERTIES[cas] fallback for engineering
//            properties (mw / density / logP / bp / smiles). Pass {}
//            or omit when the table isn't available (index.html).
//
// note: returned as entry.note || ''. If the caller needs a different
// default ('Middle' for the inspector fallback, r.note for brief
// import), spread + override:
//   { ...buildEnriched(entry, mp), note: entry.note || r.note || '' }
export function buildEnriched(entry, mp = {}) {
  return {
    cas:   entry.cas,
    name:  entry.name,
    note:  entry.note || '',
    odor_type:        entry.odor?.type        || null,
    odor_strength:    entry.odor?.strength    || null,
    odor_description: entry.odor?.description || null,
    tenacity:         entry.performance?.tenacity || null,
    tenacity_hours:   entry.performance?.duration || null,
    blends_with:      entry.blends_with || [],
    ifra_guideline:   entry.safety?.ifra  || null,
    usage_levels:     entry.safety?.usage || null,
    molecular_weight: parseFloat(entry.weight) || mp.mw     || null,
    density:          entry.density != null ? entry.density : (mp.density || null),
    xlogp:            parseFloat(entry.xlogp)  || mp.logP   || null,
    boiling_point:    entry.boiling_point != null ? entry.boiling_point : (mp.bp || null),
    smiles:           entry.smiles || mp.smiles || null,
    // Audit-coherence C3.2/C3.3 — preserve curated classification so
    // every add-path produces the same shape.
    primaryFamilies:   entry.classification?.primaryFamilies   || [],
    secondaryFamilies: entry.classification?.secondaryFamilies || [],
    facets:            entry.classification?.facets            || [],
    functions:         entry.classification?.functions         || [],
    regulatory:        entry.classification?.regulatory        || [],
  };
}

// ── buildFamilyAxes ───────────────────────────────────────────────────
// Minimal projection used by getMaterialFamilies / segIdsForFamilies —
// the family-classification matchers don't need the full enriched
// shape, just the four axis fields. Keeps callers from typing the
// `cls.X || []` rows by hand at every map-tab rebuild.
export function buildFamilyAxes(entry) {
  const cls = entry?.classification || {};
  return {
    odor_type:         entry?.odor?.type     || null,
    primaryFamilies:   cls.primaryFamilies   || [],
    secondaryFamilies: cls.secondaryFamilies || [],
    facets:            cls.facets            || [],
  };
}

// Expose to inline classic scripts via window.appUtils — same pattern
// as lib/dom-utils.mjs. The inert <script id="app-init"> blocks read
// these from window.appUtils because they aren't ES modules.
if (typeof window !== 'undefined') {
  window.appUtils = window.appUtils || {};
  window.appUtils.buildEnriched   = buildEnriched;
  window.appUtils.buildFamilyAxes = buildFamilyAxes;
}
