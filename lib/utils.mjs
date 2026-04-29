// Pure utility helpers extracted from index.html so they can be unit-
// tested in isolation. The bundled site still inlines its own copies
// (no build step), but the algorithms must stay byte-equivalent —
// tests pin those algorithms here so future tweaks land identically
// in both places.

// CSV escape — matches RFC 4180 quoting: any field containing a
// comma / newline / double-quote is wrapped in double-quotes with
// internal quotes doubled.
export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Donut-segment SVG path — angles in degrees, 0° at 12 o'clock,
// increasing clockwise. Used by the Edwards Fragrance Wheel renderer.
// Returns a path string of the form "M x1 y1 A r r 0 f 1 x2 y2 L x3 y3
// A r r 0 f 0 x4 y4 Z".
export function arcPath(cx, cy, rIn, rOut, startDeg, endDeg) {
  const toRad = d => (d - 90) * Math.PI / 180;
  const sa = toRad(startDeg);
  const ea = toRad(endDeg);
  const x1 = cx + rOut * Math.cos(sa);
  const y1 = cy + rOut * Math.sin(sa);
  const x2 = cx + rOut * Math.cos(ea);
  const y2 = cy + rOut * Math.sin(ea);
  const x3 = cx + rIn * Math.cos(ea);
  const y3 = cy + rIn * Math.sin(ea);
  const x4 = cx + rIn * Math.cos(sa);
  const y4 = cy + rIn * Math.sin(sa);
  const largeArc = (endDeg - startDeg) > 180 ? 1 : 0;
  return (
    'M ' + x1 + ' ' + y1 +
    ' A ' + rOut + ' ' + rOut + ' 0 ' + largeArc + ' 1 ' + x2 + ' ' + y2 +
    ' L ' + x3 + ' ' + y3 +
    ' A ' + rIn + ' ' + rIn + ' 0 ' + largeArc + ' 0 ' + x4 + ' ' + y4 +
    ' Z'
  );
}

// IFRA 51 stereoisomer / enantiomer alias map. Variant CAS → canonical
// (parent) CAS that carries the regulated cap. Mirrored from
// formulation_data.js IFRA_51_CAS_ALIAS so this table can be tested
// without loading the formulation engine.
export const STEREO_ALIAS = {
  '126-91-0': '78-70-6',     // (R)-(−)-Linalool   → racemic Linalool
  '126-90-9': '78-70-6',     // (S)-(+)-Linalool   → racemic Linalool
  '7705-14-8': '5989-27-5',  // (±)-Limonene       → d-Limonene cap
  '5989-54-8': '5989-27-5',  // (S)-(−)-Limonene   → d-Limonene cap
  '7540-51-4': '106-22-9',   // (R)-(+)-Citronellol→ racemic
  '1117-61-9': '106-22-9',   // (S)-(−)-Citronellol→ racemic
  '464-49-3':  '76-22-2',    // (+)-Camphor        → racemic
  '464-48-2':  '76-22-2'     // (−)-Camphor        → racemic
};

// Build the inverse index — every CAS maps to the Set of CAS that
// share its IFRA cap (parent + every variant). Returned object keys
// from variant + parent CAS.
export function buildStereoGroups(aliasMap = STEREO_ALIAS) {
  const groups = {};
  for (const [variant, parent] of Object.entries(aliasMap)) {
    if (!groups[parent]) groups[parent] = new Set([parent]);
    groups[parent].add(variant);
  }
  const memberIdx = {};
  for (const set of Object.values(groups)) {
    for (const cas of set) memberIdx[cas] = set;
  }
  return memberIdx;
}

// Resolve any CAS to its IFRA-cap parent. Returns the input unchanged
// when no alias is registered.
export function resolveIFRAParent(cas, aliasMap = STEREO_ALIAS) {
  return aliasMap[cas] || cas;
}

// Strip Function-axis trailing words from an odor description so the
// Function chip and the Odor row don't repeat themselves on materials
// like Benzyl Benzoate ("...— mainly fixative/solvent"). Mirror of
// _cleanOdorDescription in index.html, kept regex-equivalent.
const _FUNCTION_WORD = '(?:fixative|solvent|carrier|diluent|denaturant|plasticizer|emollient|preservative)';
const _ODOR_TAIL_RE = new RegExp(
  '\\s*[—\\-–]\\s*(?:mainly\\s+|mostly\\s+|primarily\\s+|also\\s+|used\\s+as\\s+|acts\\s+as\\s+)*' +
  '(?:a\\s+|an\\s+)?' + _FUNCTION_WORD +
  '(?:\\s*(?:[\\/&,]|and)\\s*' + _FUNCTION_WORD + ')*\\s*$',
  'i'
);
export function cleanOdorDescription(s) {
  if (!s) return s;
  return s.replace(_ODOR_TAIL_RE, '').trim();
}

// Resolve a regulatory token to its canonical lowercase key. Folds
// hand-typed legacy variants (e.g. 'IFRA Limited' → 'regulated') so
// downstream filter matchers work off a single vocabulary.
export const REGULATORY_LEGACY_ALIASES = {
  'ifra_limited':  'regulated',
  'ifra limited':  'regulated',
  'ifra-limited':  'regulated',
  'IFRA Limited':  'regulated',
  'IFRA_LIMITED':  'regulated',
  'IFRA limited':  'regulated',
  'Ifra Limited':  'regulated'
};
export function normalizeRegulatoryToken(token) {
  if (!token) return token;
  if (REGULATORY_LEGACY_ALIASES[token]) return REGULATORY_LEGACY_ALIASES[token];
  return String(token).toLowerCase().trim();
}
