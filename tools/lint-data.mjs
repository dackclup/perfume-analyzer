#!/usr/bin/env node
// tools/lint-data.mjs — single CI gate for data integrity.
//
// Replaces tools/lint-blends.mjs as the canonical data-integrity check.
// Audit-coherence Tier 1 systemic fix — promotes the audit's
// check-cross-refs.mjs logic into the main toolchain.
//
// Three pass groups:
//
//  A. JSON Schema     — schema/materials.schema.json against
//                       data/materials.json. Catches structural issues
//                       (trade_names target shape, missing required
//                       fields, malformed CAS).
//
//  B. Cross-reference — every internal pointer:
//                         material.classification.* ↔ taxonomy enums
//                         material.blends_with → resolvable + bidirectional
//                         IFRA_51_LIMITS keys → material exists
//                         trade_names value → material exists
//                         mixture_cas → material exists (no single-molecule formula)
//                         duplicate CAS / invalid check-digit
//                         NATURAL_ALLERGEN_COMPOSITION constituents → EU list
//                         ESTER_HYDROLYSIS pair integrity
//                         AROMACHOLOGY_SCORES → material exists
//
//  C. Ratchet         — compares broken-count against a baseline at
//                       audit/lint-data-baseline.json. Fails if any
//                       category's broken count INCREASES.
//
// Usage:
//   node tools/lint-data.mjs              # pretty report + baseline check
//   node tools/lint-data.mjs --json       # JSON to stdout
//   node tools/lint-data.mjs --strict     # fail on ANY broken (no baseline)
//   node tools/lint-data.mjs --update-baseline   # writes current counts as new baseline

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const STRICT = args.includes('--strict');
const UPDATE = args.includes('--update-baseline');

// ── Load DB + taxonomy ────────────────────────────────────────────────
const data = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'materials.json'), 'utf8'));
const db = data.perfumery_db;
const trades = data.trade_names || {};
const mixtureCas = new Set(data.mixture_cas || []);

const taxSrc = fs.readFileSync(path.join(REPO, 'taxonomy.js'), 'utf8');
const dataSrc = fs.readFileSync(path.join(REPO, 'formulation_data.js'), 'utf8');
const exposeNames = [
  'MAIN_FAMILIES',
  'MAIN_FAMILY_TO_SUBS',
  'SUB_FAMILY_TO_MAIN',
  'IFRA_51_LIMITS',
  'IFRA_51_CAS_ALIAS',
  'EU_ALLERGENS_CURRENT',
  'NATURAL_ALLERGEN_COMPOSITION',
  'ESTER_HYDROLYSIS',
  'AROMACHOLOGY_SCORES',
];
const tail = `\n;Object.assign(ctx, { ${exposeNames.map(n => n + ': (typeof ' + n + " !== 'undefined') ? " + n + ' : null').join(', ')} });`;
const sandbox = {};
new Function('ctx', taxSrc + '\n' + dataSrc + tail)(sandbox);
const {
  MAIN_FAMILIES,
  IFRA_51_LIMITS,
  IFRA_51_CAS_ALIAS,
  EU_ALLERGENS_CURRENT,
  NATURAL_ALLERGEN_COMPOSITION,
  ESTER_HYDROLYSIS,
  AROMACHOLOGY_SCORES,
} = sandbox;

const indexHtml = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
function pluck(name, pattern) {
  const re = new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`);
  const m = indexHtml.match(re);
  if (!m) return [];
  return [...m[1].matchAll(pattern)].map(x => x[1]);
}
const TYPE_VALUES = pluck('TYPE_VALUES', /'([^']+)'/g);
const FUNCTION_VALUES = pluck('FUNCTION_VALUES', /'([^']+)'/g);
const USE_VALUES = pluck('USE_VALUES', /'([^']+)'/g);
const REGULATORY_VALUES = pluck('REGULATORY_VALUES', /'([^']+)'/g);
const SOURCE_VALUES = pluck('SOURCE_VALUES', /'([^']+)'/g);
const SUB_FAMILY_IDS = new Set(pluck('SUB_FAMILIES', /'([^']+)'/g));
const FACET_IDS = (() => {
  const m = indexHtml.match(/const FACET_GROUPS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return new Set();
  const ids = new Set();
  for (const g of m[1].matchAll(/facets:\s*\[([^\]]*)\]/g)) {
    for (const f of g[1].matchAll(/'([^']+)'/g)) ids.add(f[1]);
  }
  return ids;
})();

// CAS check-digit
function casCheckOk(cas) {
  if (!/^\d{2,7}-\d{2}-\d$/.test(cas)) return null;
  const parts = cas.split('-');
  const digits = (parts[0] + parts[1]).split('').map(Number);
  const expected = parseInt(parts[2], 10);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += digits[digits.length - 1 - i] * (i + 1);
  return sum % 10 === expected;
}

// ── Pass A: JSON Schema ──────────────────────────────────────────────
const schema = JSON.parse(
  fs.readFileSync(path.join(REPO, 'schema', 'materials.schema.json'), 'utf8')
);
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const schemaOk = validate(data);
const schemaErrors = schemaOk
  ? []
  : (validate.errors || []).map(e => ({
      path: e.instancePath || '/',
      message: e.message,
      params: e.params,
    }));

// ── Pass B: Cross-reference ──────────────────────────────────────────
const dbByCas = new Map();
for (const e of db) if (e.cas) dbByCas.set(e.cas, e);

const findings = {};
function add(bucket, item) {
  (findings[bucket] = findings[bucket] || []).push(item);
}

const HEURISTIC_FAMILY_TOKENS = new Set([
  'herbal',
  'floral',
  'woody',
  'spicy',
  'citrus',
  'camphoraceous',
  'green',
  'gourmand',
  'fruity',
  'balsamic',
  'musk',
  'amber',
  'aldehydic',
  'floral_amber',
  'aquatic',
  'animalic',
  'lactonic',
  'leather',
  'mossy',
  'resinous',
  'smoky',
  'sweet',
]);
const allowedFamily = new Set([...MAIN_FAMILIES, ...SUB_FAMILY_IDS, ...HEURISTIC_FAMILY_TOKENS]);

for (const e of db) {
  const c = e.classification || {};
  for (const tok of c.primaryFamilies || []) {
    if (!allowedFamily.has(tok))
      add('material_primaryFamilies_unknown', { cas: e.cas, name: e.name, token: tok });
  }
  for (const tok of c.secondaryFamilies || []) {
    if (!allowedFamily.has(tok))
      add('material_secondaryFamilies_unknown', { cas: e.cas, name: e.name, token: tok });
  }
  if (c.material_type && !TYPE_VALUES.includes(c.material_type))
    add('material_type_unknown', { cas: e.cas, value: c.material_type });
  if (c.source && !SOURCE_VALUES.includes(c.source))
    add('material_source_unknown', { cas: e.cas, value: c.source });
  for (const r of c.regulatory || [])
    if (!REGULATORY_VALUES.includes(r))
      add('material_regulatory_unknown', { cas: e.cas, value: r });
  for (const fn of c.functions || [])
    if (!FUNCTION_VALUES.includes(fn)) add('material_function_unknown', { cas: e.cas, value: fn });
  for (const u of c.uses || [])
    if (!USE_VALUES.includes(u)) add('material_use_unknown', { cas: e.cas, value: u });
}

// SUB_FAMILY orphans — counts BOTH primary + secondary claims. A
// subfamily that's only claimed as secondary is not an orphan; the
// taxonomy node still has a real-world anchor in the DB. Audit-
// coherence Tier 4 fix.
const primCounts = new Map();
for (const e of db) {
  for (const t of e.classification?.primaryFamilies || [])
    primCounts.set(t, (primCounts.get(t) || 0) + 1);
  for (const t of e.classification?.secondaryFamilies || [])
    primCounts.set(t, (primCounts.get(t) || 0) + 1);
}
for (const sf of SUB_FAMILY_IDS)
  if (!primCounts.has(sf)) add('taxonomy_subfamily_orphan', { value: sf });
for (const f of FACET_IDS) {
  if (!db.some(e => (e.classification?.facets || []).includes(f)))
    add('taxonomy_facet_orphan', { value: f });
}

// IFRA_51_LIMITS orphans
for (const cas of Object.keys(IFRA_51_LIMITS || {})) {
  if (!dbByCas.has(cas)) {
    const aliasTarget = (IFRA_51_CAS_ALIAS && IFRA_51_CAS_ALIAS[cas]) || null;
    if (aliasTarget && dbByCas.has(aliasTarget)) continue;
    add('ifra_cap_orphan', { cas, hasAlias: !!aliasTarget });
  }
}

// blends_with resolvability + bidirectionality
let blendsTotal = 0,
  blendsResolved = 0;
const blendBroken = [],
  blendNonBidir = [];
function resolveBlend(label) {
  if (!label) return null;
  if (typeof label === 'object') label = label.label || '';
  const lk = String(label).toLowerCase().trim();
  for (const e of db) if (e.name && e.name.toLowerCase() === lk) return e;
  for (const e of db) if ((e.synonyms || []).some(s => String(s).toLowerCase() === lk)) return e;
  if (trades[lk] && dbByCas.has(trades[lk])) return dbByCas.get(trades[lk]);
  return null;
}
for (const e of db) {
  for (const raw of e.blends_with || []) {
    blendsTotal++;
    const partner = resolveBlend(raw);
    if (!partner) {
      blendBroken.push({
        src: e.name,
        srcCas: e.cas,
        label: typeof raw === 'object' ? raw.label : raw,
      });
      continue;
    }
    blendsResolved++;
    const reverseList = (partner.blends_with || []).map(x =>
      typeof x === 'object' ? x.label || '' : x
    );
    const reverseSelf = reverseList.some(l => {
      const lk = String(l).toLowerCase().trim();
      if (!lk) return false;
      if (lk === (e.name || '').toLowerCase()) return true;
      return (e.synonyms || []).some(s => String(s).toLowerCase() === lk);
    });
    if (!reverseSelf) blendNonBidir.push({ from: e.name, to: partner.name });
  }
}

// trade_names
const tradeBroken = [];
for (const [tn, casTarget] of Object.entries(trades)) {
  if (!dbByCas.has(casTarget)) tradeBroken.push({ tradeName: tn, target: casTarget });
}

// mixture_cas
const mixOrphans = [],
  mixBogusFormula = [];
for (const cas of mixtureCas) {
  if (!dbByCas.has(cas)) {
    mixOrphans.push({ cas });
    continue;
  }
  const e = dbByCas.get(cas);
  if (e.formula && /^C\d/.test(e.formula))
    mixBogusFormula.push({ cas, name: e.name, formula: e.formula });
}

// duplicate CAS / bad checksum
const seen = new Map();
const dupCas = [],
  badChecksum = [];
for (const e of db) {
  if (!e.cas) continue;
  if (seen.has(e.cas)) dupCas.push({ cas: e.cas, names: [seen.get(e.cas), e.name] });
  else seen.set(e.cas, e.name);
  const ok = casCheckOk(e.cas);
  if (ok === false) badChecksum.push({ cas: e.cas, name: e.name });
}

// NATURAL_ALLERGEN_COMPOSITION + ESTER_HYDROLYSIS + AROMACHOLOGY_SCORES
const ncOrphans = [],
  ncTargetMissing = [];
for (const cas of Object.keys(NATURAL_ALLERGEN_COMPOSITION || {})) {
  if (!dbByCas.has(cas)) ncOrphans.push({ cas, role: 'source' });
  for (const targetCas of Object.keys(NATURAL_ALLERGEN_COMPOSITION[cas])) {
    if (!EU_ALLERGENS_CURRENT[targetCas])
      ncTargetMissing.push({ source: cas, allergenCas: targetCas });
  }
}
const ehMissing = [];
for (const cas of Object.keys(ESTER_HYDROLYSIS || {})) {
  const ester = ESTER_HYDROLYSIS[cas];
  if (!dbByCas.has(cas)) ehMissing.push({ cas, role: 'ester' });
  if (!EU_ALLERGENS_CURRENT[ester.allergenCAS])
    ehMissing.push({ cas, role: 'allergen-target', target: ester.allergenCAS });
}
const aromOrphans = [];
for (const cas of Object.keys(AROMACHOLOGY_SCORES || {}))
  if (!dbByCas.has(cas)) aromOrphans.push({ cas });

// Provenance rule (Round 3 P1.1): any material that carries a
// mol_*/chem_* field (Round-3 enrichment namespace) MUST also carry
// data_provenance.last_fetched. Legacy flat fields (smiles, xlogp,
// weight, pubchem_cid, etc.) are grandfathered — not affected.
let molChemTotal = 0;
const provenanceMissing = [];
for (const e of db) {
  const hasMolChem = Object.keys(e).some(k => k.startsWith('mol_') || k.startsWith('chem_'));
  if (!hasMolChem) continue;
  molChemTotal++;
  if (!e.data_provenance || !e.data_provenance.last_fetched) {
    provenanceMissing.push({ cas: e.cas, name: e.name });
  }
}

// Summary table
const summary = [
  [
    'material.primaryFamilies → taxonomy',
    db.reduce((n, e) => n + (e.classification?.primaryFamilies?.length || 0), 0),
    (findings.material_primaryFamilies_unknown || []).length,
  ],
  [
    'material.secondaryFamilies → taxonomy',
    db.reduce((n, e) => n + (e.classification?.secondaryFamilies?.length || 0), 0),
    (findings.material_secondaryFamilies_unknown || []).length,
  ],
  [
    'material.material_type → TYPE_VALUES',
    db.filter(e => e.classification?.material_type).length,
    (findings.material_type_unknown || []).length,
  ],
  [
    'material.source → SOURCE_VALUES',
    db.filter(e => e.classification?.source).length,
    (findings.material_source_unknown || []).length,
  ],
  [
    'material.regulatory → REGULATORY_VALUES',
    db.reduce((n, e) => n + (e.classification?.regulatory?.length || 0), 0),
    (findings.material_regulatory_unknown || []).length,
  ],
  [
    'material.functions → FUNCTION_VALUES',
    db.reduce((n, e) => n + (e.classification?.functions?.length || 0), 0),
    (findings.material_function_unknown || []).length,
  ],
  [
    'material.uses → USE_VALUES',
    db.reduce((n, e) => n + (e.classification?.uses?.length || 0), 0),
    (findings.material_use_unknown || []).length,
  ],
  [
    'taxonomy.subfamily orphans (no material)',
    SUB_FAMILY_IDS.size,
    (findings.taxonomy_subfamily_orphan || []).length,
  ],
  [
    'taxonomy.facet orphans (no material)',
    FACET_IDS.size,
    (findings.taxonomy_facet_orphan || []).length,
  ],
  [
    'IFRA_51_LIMITS cas → material',
    Object.keys(IFRA_51_LIMITS || {}).length,
    (findings.ifra_cap_orphan || []).length,
  ],
  ['material.blends_with → material', blendsTotal, blendBroken.length],
  ['material.blends_with bidirectional', blendsResolved, blendNonBidir.length],
  ['trade_names → material exists by CAS', Object.keys(trades).length, tradeBroken.length],
  ['mixture_cas → material exists', mixtureCas.size, mixOrphans.length],
  ['mixture_cas with single-molecule formula', mixtureCas.size, mixBogusFormula.length],
  ['duplicate CAS in DB', db.length, dupCas.length],
  ['CAS check-digit invalid', db.length, badChecksum.length],
  [
    'NATURAL_ALLERGEN_COMPOSITION constituent → EU list',
    Object.keys(NATURAL_ALLERGEN_COMPOSITION || {}).length,
    ncTargetMissing.length,
  ],
  ['ESTER_HYDROLYSIS pair integrity', Object.keys(ESTER_HYDROLYSIS || {}).length, ehMissing.length],
  ['AROMACHOLOGY_SCORES → DB', Object.keys(AROMACHOLOGY_SCORES || {}).length, aromOrphans.length],
  ['molecular fields require provenance', molChemTotal, provenanceMissing.length],
];

// ── Pass C: Ratchet baseline ──────────────────────────────────────────
const BASELINE_PATH = path.join(REPO, 'audit', 'lint-data-baseline.json');
let baseline = null;
if (fs.existsSync(BASELINE_PATH)) baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

let regressions = [];
if (baseline && !STRICT) {
  for (const [label, _, broken] of summary) {
    const prev = baseline[label];
    if (prev != null && broken > prev)
      regressions.push({ label, baseline: prev, current: broken, delta: broken - prev });
  }
}

// ── Output ────────────────────────────────────────────────────────────
const result = {
  schema: { ok: schemaOk, errors: schemaErrors },
  crossRef: { summary, findings },
  ratchet: { regressions, baselineLoaded: !!baseline, strict: STRICT },
};

if (JSON_OUT) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  console.log('═'.repeat(70));
  console.log(' lint-data — data integrity report');
  console.log('═'.repeat(70));
  console.log('');
  console.log('A. Schema validation:', schemaOk ? '✓ pass' : `✗ ${schemaErrors.length} error(s)`);
  for (const e of schemaErrors.slice(0, 10)) {
    console.log('   ' + e.path + ' — ' + e.message + ' ' + JSON.stringify(e.params));
  }
  if (schemaErrors.length > 10) console.log('   … +' + (schemaErrors.length - 10) + ' more');
  console.log('');
  console.log('B. Cross-reference:');
  for (const [label, total, broken] of summary) {
    const mark = broken === 0 ? '✓' : '✗';
    console.log(`   ${mark} ${label.padEnd(50)} ${String(broken).padStart(5)} / ${total}`);
  }
  console.log('');
  console.log('C. Ratchet:');
  if (STRICT) console.log('   --strict mode: any broken count != 0 will fail');
  else if (!baseline)
    console.log('   ⚠ no baseline (audit/lint-data-baseline.json) — ratchet skipped');
  else if (regressions.length === 0) console.log('   ✓ no regression vs baseline');
  else {
    console.log('   ✗ ' + regressions.length + ' category regressed:');
    for (const r of regressions)
      console.log(`     • ${r.label}: ${r.baseline} → ${r.current} (+${r.delta})`);
  }
  console.log('');
}

// ── Update baseline if requested ──────────────────────────────────────
if (UPDATE) {
  const newBaseline = {};
  for (const [label, _, broken] of summary) newBaseline[label] = broken;
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2) + '\n');
  console.log('Wrote new baseline → ' + path.relative(REPO, BASELINE_PATH));
}

const fatal =
  !schemaOk || (STRICT && summary.some(([_, _t, b]) => b > 0)) || regressions.length > 0;

process.exit(fatal ? 1 : 0);
