#!/usr/bin/env node
// tools/enrich-molecular.mjs — PubChem molecular-property enrichment.
//
// Round 3 P1.3. Reads data/materials.json, resolves each material to a
// PubChem CID (using stored pubchem_cid first, then a CAS lookup), and
// fetches per-CID property data via the lib at tools/lib/pubchem.mjs.
// Results land in mol_*/chem_* fields with a data_provenance stamp.
//
// Layered fetch strategy:
//   First-layer  PUG-REST batch (≤50 CIDs/call)  — fast, mol_* fields.
//   Experimental PUG-View per-CID (slow, optional) — chem_* fields.
//
// Cache: audit/cache/pubchem-{first-layer,experimental}/<CID>.json.
// Re-runs hit cache and produce identical patches with zero network
// calls (verified by a dedicated test).
//
// The patch file at audit/molecular-patches.json is always written
// (both --dry-run and --apply use it as an audit trail). --apply
// additionally merges patches into data/materials.json — additively;
// the legacy flat fields (smiles, xlogp, weight, pubchem_cid, …) are
// never touched. Only mol_*/chem_*/data_provenance keys are written.
//
// Usage:
//   node tools/enrich-molecular.mjs --first-layer-only --dry-run
//   node tools/enrich-molecular.mjs --first-layer-only --apply
//   node tools/enrich-molecular.mjs --first-layer-only --cid 6549
//   node tools/enrich-molecular.mjs --first-layer-only --missing-only --apply
//   node tools/enrich-molecular.mjs --experimental --apply   (slow)
//
// Exit codes:
//   0 — success (dry-run or apply)
//   1 — fatal error (DB load, --cid not in DB, terminal fetch failure)
//   2 — usage error (--cid + non-numeric value, etc.)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RATE_LIMIT_MS,
  sleep,
  pubchemCidsForCas,
  pubchemBatchProperty,
  pubchemExperimentalView,
  cacheRead,
  cacheWrite,
  DEFAULT_CACHE_DIR,
} from './lib/pubchem.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

// ── Property maps ────────────────────────────────────────────────────
// PUG-REST property name → schema mol_* key. Order matters for URL
// construction (PubChem returns properties in the requested order).
//
// SMILES rename note (Round 3 P1.3.1, observed against the live API
// during P1.4b): PubChem deprecated "CanonicalSMILES" + "IsomericSMILES"
// in favour of "SMILES" + "ConnectivitySMILES". The schema-target keys
// are unchanged; only the upstream field names move. Semantically:
//   new "SMILES"             == old "IsomericSMILES" (carries stereo if defined)
//                                                    → mol_isomeric_smiles
//   new "ConnectivitySMILES" == old "CanonicalSMILES" (connectivity-only,
//                              stereo stripped)        → mol_canonical_smiles
// The previous parser asked for the old names and silently got 0/435
// populated SMILES across the dry-run; do not revert without checking
// a live PUG-REST response first.
export const FIRST_LAYER_PROPERTIES = [
  ['MolecularFormula', 'mol_formula'],
  ['MolecularWeight', 'mol_molecular_weight'],
  ['XLogP', 'mol_xlogp3'],
  ['TPSA', null], // legacy flat field already populated; skip mol_ duplicate
  ['Complexity', 'mol_complexity'],
  ['HBondDonorCount', 'mol_h_bond_donor_count'],
  ['HBondAcceptorCount', 'mol_h_bond_acceptor_count'],
  ['RotatableBondCount', 'mol_rotatable_bond_count'],
  ['HeavyAtomCount', 'mol_heavy_atom_count'],
  ['IUPACName', 'mol_iupac_name'],
  ['SMILES', 'mol_isomeric_smiles'],
  ['ConnectivitySMILES', 'mol_canonical_smiles'],
  ['InChI', 'mol_inchi'],
  ['InChIKey', 'mol_inchi_key'],
  ['ExactMass', 'mol_exact_mass'],
];

// Numeric (float) coercions
const NUMERIC_KEYS = new Set([
  'mol_xlogp3',
  'mol_complexity',
  'mol_exact_mass',
  'mol_molecular_weight',
]);

// Integer coercions
const INTEGER_KEYS = new Set([
  'mol_h_bond_donor_count',
  'mol_h_bond_acceptor_count',
  'mol_rotatable_bond_count',
  'mol_heavy_atom_count',
]);

// PUG-View experimental subsection heading → chem_* key.
const EXPERIMENTAL_TOC_MAP = [
  [/^Boiling Point$/i, 'chem_boiling_point_c'],
  [/^Melting Point$/i, 'chem_melting_point_c'],
  [/^Flash Point$/i, 'chem_flash_point_c'],
  [/^Density$/i, 'chem_density_g_ml'],
  [/^Vapor Pressure$/i, 'chem_vapor_pressure_mmhg_25c'],
  [/^Vapor Density$/i, 'chem_vapor_density_air'],
  [/^Refractive Index$/i, 'chem_refractive_index'],
  [/^Solubility$/i, 'chem_solubility_water_mg_l'],
  [/^LogP$/i, 'chem_log_kow'],
  [/^Henry'?s? Law Constant$/i, 'chem_henry_law_constant'],
];

const BATCH_SIZE = 50;

// ── CLI ───────────────────────────────────────────────────────────────
export const HELP_TEXT = `tools/enrich-molecular.mjs — PubChem molecular-property enrichment

Usage: node tools/enrich-molecular.mjs [flags]

Flags:
  --first-layer-only   Fetch PUG-REST batch properties only (default fast path).
  --experimental       Also fetch PUG-View per-CID (slow, optional).
  --apply              Write patches into data/materials.json
                       (default = dry-run; only audit/molecular-patches.json
                       is written).
  --cid <CID>          Operate on a single CID (debug).
  --missing-only       Skip materials that already have mol_xlogp3.
  --help, -h           This text.

Notes:
  - Rate-limited to <=5 req/s. Full sweep ~2 min for 624 materials.
  - Cache lives under audit/cache/pubchem-{first-layer,experimental}/.
  - Idempotent: re-runs hit cache, produce identical patches, zero network.
  - --apply is additive: legacy flat fields (smiles, xlogp, weight,
    pubchem_cid, ...) are never touched. Only mol_*/chem_* and
    data_provenance are written.
  - Mixtures (essential oils / absolutes / extracts listed in
    data.mixture_cas) are skipped — their CAS resolves to water or
    one constituent in PubChem and a single-molecule patch would
    corrupt the row. --cid bypasses this filter for debug.
  - CID-mismatch guard: rows where the legacy InChIKey differs from
    the PubChem-fetched mol_inchi_key are diverted to
    audit/molecular-patches-flagged.json (gitignored) for manual
    triage. --apply ignores them.
`;

export function parseArgs(argv) {
  const args = argv.slice(2);
  const has = name => args.includes(name);
  const value = name => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    return args[i + 1] || null;
  };
  const cid = value('--cid');
  if (cid != null && !/^\d+$/.test(cid)) {
    return { _usageError: `--cid value must be a positive integer (got "${cid}")` };
  }
  return {
    firstLayerOnly: has('--first-layer-only'),
    experimental: has('--experimental'),
    apply: has('--apply'),
    cid: cid,
    missingOnly: has('--missing-only'),
    help: has('--help') || has('-h'),
  };
}

// ── Material picking ──────────────────────────────────────────────────
// `mixtureCas` (Set<string>) excludes essential oils / absolutes / extracts —
// their CAS resolves to either water or one constituent in PubChem (e.g.
// Spearmint Oil 8008-79-5 → CID 962 = water), and a single-molecule
// patch would corrupt the row. The --cid debug path bypasses the
// mixture filter on purpose: an operator targeting a specific CID
// presumably knows what they're looking at.
export function pickMaterials(db, opts, mixtureCas = new Set()) {
  if (opts.cid != null) {
    const target = String(opts.cid);
    const m = db.find(x => x.pubchem_cid != null && String(x.pubchem_cid) === target);
    if (!m) throw new Error(`--cid ${opts.cid} not found in data/materials.json`);
    return [m];
  }
  let mats = db.filter(x => x && x.cas);
  mats = mats.filter(x => !mixtureCas.has(x.cas));
  if (opts.missingOnly) {
    mats = mats.filter(x => x.mol_xlogp3 == null);
  }
  return mats;
}

// ── Resolve material → CID (DB-first, CAS-lookup fallback) ────────────
export async function resolveCid(material, fetchOpts) {
  if (material.pubchem_cid != null && String(material.pubchem_cid) !== '') {
    return { cid: String(material.pubchem_cid), source: 'db' };
  }
  if (!material.cas) {
    return { cid: null, source: 'no-cas-or-cid' };
  }
  const cids = await pubchemCidsForCas(material.cas, fetchOpts);
  if (!cids || cids.length === 0) {
    return { cid: null, source: 'pubchem-no-cid' };
  }
  return { cid: String(cids[0]), source: 'pubchem-resolved' };
}

// ── Parsers (PubChem JSON → schema-shaped patches) ────────────────────
export function pugRestToMolPatch(pugProperty) {
  const patch = {};
  for (const [pugName, molKey] of FIRST_LAYER_PROPERTIES) {
    if (!molKey) continue;
    const v = pugProperty[pugName];
    if (v == null || v === '') continue;
    if (NUMERIC_KEYS.has(molKey)) {
      const n = typeof v === 'number' ? v : parseFloat(v);
      if (Number.isFinite(n)) patch[molKey] = n;
    } else if (INTEGER_KEYS.has(molKey)) {
      const n = typeof v === 'number' ? Math.trunc(v) : parseInt(v, 10);
      if (Number.isInteger(n)) patch[molKey] = n;
    } else {
      patch[molKey] = String(v);
    }
  }
  return patch;
}

// PUG-View payloads have a Record.Section[] tree with TOCHeading at
// every level. We only descend into "Experimental Properties" and pick
// the first numeric token from each known sub-heading. Records vary
// wildly in structure; this parser is intentionally tolerant.
function findSection(sections, headingMatch) {
  for (const s of sections || []) {
    if (s.TOCHeading && headingMatch.test(s.TOCHeading)) return s;
    const nested = findSection(s.Section, headingMatch);
    if (nested) return nested;
  }
  return null;
}

export function pugViewToChemPatch(pugViewJson) {
  const patch = {};
  const record = pugViewJson?.Record;
  if (!record || !record.Section) return patch;
  const expSection = findSection(record.Section, /^Experimental Properties$/i);
  if (!expSection) return patch;
  for (const [match, key] of EXPERIMENTAL_TOC_MAP) {
    const sub = findSection(expSection.Section || [], match);
    if (!sub) continue;
    const info = (sub.Information || [])[0];
    const str = info?.Value?.StringWithMarkup?.[0]?.String;
    if (typeof str !== 'string' || str === '') continue;
    const m = str.match(/-?\d+(?:\.\d+)?/);
    if (!m) continue;
    const n = parseFloat(m[0]);
    if (Number.isFinite(n)) patch[key] = n;
  }
  return patch;
}

export function buildPatch(material, cid, firstLayer, experimental, opts, runtime) {
  const cidStr = String(cid);
  const layerData = firstLayer[cidStr];
  if (!layerData) return null;
  const patch = pugRestToMolPatch(layerData);
  if (Object.keys(patch).length === 0 && !experimental[cidStr]) return null;

  if (opts.experimental && experimental[cidStr]) {
    Object.assign(patch, pugViewToChemPatch(experimental[cidStr]));
  }

  const now = (runtime && runtime.now) || (() => new Date().toISOString().slice(0, 10));
  patch.data_provenance = {
    computed_source: 'PubChem PUG-REST',
    last_fetched: now(),
    manual_overrides: [],
  };
  if (opts.experimental) {
    patch.data_provenance.experimental_source = 'PubChem PUG-View';
  }
  return patch;
}

// Round 3 P1.3.1 — CID-mismatch guard.
// When the legacy row carries an InChIKey AND the PubChem-fetched
// mol_inchi_key differs, the stored pubchem_cid points to a DIFFERENT
// molecule than the row's legacy fields describe. Applying the patch
// would silently overwrite the row with data for the wrong molecule.
// We separate those into a flagged file for manual triage in Round 4
// (cf. Round 2's tools/check-pubchem.mjs which flagged 2 rows in a
// 10-row sample; the full sweep surfaces ~111 such rows).
//
// Returns { clean, flagged }:
//   clean   — { [cas]: patch }  safe to --apply
//   flagged — array of triage-friendly entries with side-by-side
//             legacy vs fetched identifiers + the would-be patch
export function partitionPatches(db, patches) {
  const dbByCas = new Map(db.map(m => [m.cas, m]));
  const clean = {};
  const flagged = [];
  for (const [cas, patch] of Object.entries(patches)) {
    const m = dbByCas.get(cas);
    const legacyKey = m && m.inchi_key;
    const fetchedKey = patch.mol_inchi_key;
    const mismatch = legacyKey && fetchedKey && legacyKey !== fetchedKey;
    if (mismatch) {
      flagged.push({
        cas,
        name: m.name,
        pubchem_cid: m.pubchem_cid,
        legacy: {
          inchi_key: legacyKey,
          formula: m.formula,
          iupac_name: m.iupac,
        },
        fetched: {
          inchi_key: fetchedKey,
          formula: patch.mol_formula,
          iupac_name: patch.mol_iupac_name,
        },
        patch,
      });
    } else {
      clean[cas] = patch;
    }
  }
  return { clean, flagged };
}

// Additive merge: writes mol_*/chem_*/data_provenance. Never touches
// any other field. Returns a NEW db array; does not mutate input.
export function applyPatches(db, patches) {
  return db.map(material => {
    const p = patches[material.cas];
    if (!p) return material;
    const merged = { ...material };
    for (const [k, v] of Object.entries(p)) {
      if (k.startsWith('mol_') || k.startsWith('chem_') || k === 'data_provenance') {
        merged[k] = v;
      }
    }
    return merged;
  });
}

// ── Fetch orchestration with cache ────────────────────────────────────
async function fetchFirstLayerBatch(cids, cacheDir, fetchOpts, metrics) {
  const result = {};
  const needFetch = [];
  for (const cid of cids) {
    const c = cacheRead(cid, 'first-layer', cacheDir);
    if (c) {
      result[cid] = c;
      metrics.cacheHits++;
    } else {
      needFetch.push(cid);
    }
  }
  if (needFetch.length === 0) return result;
  const propNames = FIRST_LAYER_PROPERTIES.map(([n]) => n);
  for (let i = 0; i < needFetch.length; i += BATCH_SIZE) {
    if (metrics.networkCalls > 0) await sleep(RATE_LIMIT_MS);
    const chunk = needFetch.slice(i, i + BATCH_SIZE);
    const props = await pubchemBatchProperty(chunk, propNames, fetchOpts);
    metrics.networkCalls++;
    const byCid = new Map();
    for (const p of props) byCid.set(String(p.CID), p);
    for (const cid of chunk) {
      const p = byCid.get(String(cid));
      if (p) {
        cacheWrite(cid, 'first-layer', p, cacheDir);
        result[cid] = p;
      }
    }
  }
  return result;
}

async function fetchExperimentalAll(cids, cacheDir, fetchOpts, metrics) {
  const result = {};
  for (const cid of cids) {
    const cached = cacheRead(cid, 'experimental', cacheDir);
    if (cached) {
      result[cid] = cached;
      metrics.cacheHits++;
      continue;
    }
    if (metrics.networkCalls > 0) await sleep(RATE_LIMIT_MS);
    const exp = await pubchemExperimentalView(cid, fetchOpts);
    metrics.networkCalls++;
    if (exp) {
      cacheWrite(cid, 'experimental', exp, cacheDir);
      result[cid] = exp;
    }
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────
export async function main(opts, runtime = {}) {
  if (opts._usageError) {
    return { exitCode: 2, error: opts._usageError };
  }
  if (opts.help) {
    return { exitCode: 0, helpText: HELP_TEXT };
  }

  const dataPath = runtime.dataPath || path.join(REPO, 'data', 'materials.json');
  const cacheDir = runtime.cacheDir || DEFAULT_CACHE_DIR;
  const patchPath = runtime.patchPath || path.join(REPO, 'audit', 'molecular-patches.json');
  const flaggedPath =
    runtime.flaggedPath || path.join(REPO, 'audit', 'molecular-patches-flagged.json');
  const fetchOpts = runtime.fetchOpts;

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const db = data.perfumery_db;
  const mixtureCas = new Set(data.mixture_cas || []);

  let mats;
  let mixturesSkipped = 0;
  try {
    mats = pickMaterials(db, opts, mixtureCas);
    if (opts.cid == null) {
      // Count for the summary log; --cid mode bypasses the filter.
      mixturesSkipped = db.filter(m => m && m.cas && mixtureCas.has(m.cas)).length;
    }
  } catch (e) {
    return { exitCode: 1, error: e.message };
  }

  const metrics = { cacheHits: 0, networkCalls: 0 };

  // Resolve CIDs serially (CAS-lookup needs throttling; DB-hits are free).
  const resolved = [];
  const skipped = [];
  let firstCasLookup = true;
  for (const m of mats) {
    if (!m.pubchem_cid && m.cas) {
      if (!firstCasLookup) await sleep(RATE_LIMIT_MS);
      firstCasLookup = false;
      metrics.networkCalls++;
    }
    const r = await resolveCid(m, fetchOpts);
    if (r.cid) {
      resolved.push({ material: m, cid: r.cid });
    } else {
      skipped.push({ cas: m.cas, name: m.name, reason: r.source });
    }
  }

  const cids = resolved.map(r => r.cid);
  const firstLayer = await fetchFirstLayerBatch(cids, cacheDir, fetchOpts, metrics);
  const experimental = opts.experimental
    ? await fetchExperimentalAll(cids, cacheDir, fetchOpts, metrics)
    : {};

  const allPatches = {};
  for (const { material, cid } of resolved) {
    const p = buildPatch(material, cid, firstLayer, experimental, opts, runtime);
    if (p) allPatches[material.cas] = p;
  }

  // Round 3 P1.3.1: split clean vs flagged BEFORE writing or applying.
  // --apply consumes only the clean set; flagged rows go to a separate
  // gitignored file for Round 4 manual triage.
  const { clean: patches, flagged } = partitionPatches(db, allPatches);

  const summary = {
    total_materials: mats.length,
    mixtures_skipped: mixturesSkipped,
    resolved: resolved.length,
    patched: Object.keys(patches).length,
    flagged: flagged.length,
    skipped: skipped.length,
    cache_hits: metrics.cacheHits,
    network_calls: metrics.networkCalls,
  };

  fs.mkdirSync(path.dirname(patchPath), { recursive: true });
  fs.writeFileSync(patchPath, JSON.stringify({ summary, patches, skipped }, null, 2) + '\n');
  fs.writeFileSync(flaggedPath, JSON.stringify({ summary, flagged }, null, 2) + '\n');

  if (opts.apply) {
    const newDb = applyPatches(db, patches);
    const newData = { ...data, perfumery_db: newDb };
    fs.writeFileSync(dataPath, JSON.stringify(newData, null, 2) + '\n');
  }

  return { exitCode: 0, summary, patches, skipped, flagged, patchPath, flaggedPath };
}

// ── CLI entry ─────────────────────────────────────────────────────────
// The block below only runs when invoked as `node tools/enrich-molecular.mjs`.
// Tests cover the exported `main()` directly with dependency injection;
// the bare CLI shell (option parsing through console output) is exercised
// by the manual --cid / --help smoke runs in P1.3 verify, not vitest.
/* c8 ignore start */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const opts = parseArgs(process.argv);
  main(opts).then(
    r => {
      if (r.helpText) {
        console.log(r.helpText);
      } else if (r.error) {
        console.error('[enrich-molecular]', r.error);
      } else {
        const s = r.summary;
        console.log(
          `enrich-molecular: ${s.patched}/${s.total_materials} materials patched ` +
            `(${s.resolved} resolved, ${s.skipped} CAS-unknown, ` +
            `${s.flagged} CID-mismatch flagged, ${s.mixtures_skipped} mixtures skipped)`
        );
        console.log(`cache hits: ${s.cache_hits}; network calls: ${s.network_calls}`);
        console.log(`patches → ${path.relative(REPO, r.patchPath)}`);
        if (s.flagged > 0) {
          console.log(`flagged → ${path.relative(REPO, r.flaggedPath)}  (Round 4 manual triage)`);
        }
        if (opts.apply) {
          console.log(`✓ applied ${s.patched} clean patches to data/materials.json`);
          if (s.flagged > 0) {
            console.log(`  (${s.flagged} flagged patches NOT applied — see flagged file)`);
          }
        } else {
          console.log(`(dry-run — pass --apply to write to data/materials.json)`);
        }
      }
      process.exit(r.exitCode);
    },
    e => {
      console.error('[enrich-molecular] fatal:', e.message);
      process.exit(1);
    }
  );
}
/* c8 ignore stop */
