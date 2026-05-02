#!/usr/bin/env node
// tools/verify-molecular.mjs — sanity checks on enriched data.
//
// Round 3 P1.5. Runs offline against data/materials.json + the local
// audit/cache/. NO network calls — CI-safe.
//
// Checks (per material that carries any mol_* field):
//   1. mol_molecular_weight present and 50..1000 g/mol
//   2. mol_xlogp3 (when present) within -5..10
//   3. data_provenance.last_fetched present + ISO date format
//   4. chem_vapor_pressure_mmhg_25c > 0 if present
//   5. cache integrity: cached PubChem response InChIKey matches the
//      stored mol_inchi_key. Cache miss → silently skipped (we never
//      hit the network from this script).
//
// Output:
//   - human-readable summary on stdout
//   - audit/molecular-verify.json (full anomaly list, gitignored
//     alongside the other audit/molecular-*.json artifacts).
//
// Exit codes:
//   0 — clean
//   1 — at least one anomaly

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheRead, DEFAULT_CACHE_DIR } from './lib/pubchem.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const RANGES = {
  mol_molecular_weight: [50, 1000],
  mol_xlogp3: [-5, 10],
};
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function hasMolFields(material) {
  return Object.keys(material).some(k => k.startsWith('mol_'));
}

export function checkMaterial(material, cacheDir) {
  const findings = [];
  if (!hasMolFields(material)) return findings;

  const ctx = { cas: material.cas, name: material.name };

  // 1. mol_molecular_weight required + range
  if (material.mol_molecular_weight == null) {
    findings.push({
      ...ctx,
      check: 'mol_molecular_weight_missing',
      message: 'mol_molecular_weight required when any mol_* field is present',
    });
  } else {
    const [lo, hi] = RANGES.mol_molecular_weight;
    const v = material.mol_molecular_weight;
    if (!Number.isFinite(v) || v < lo || v > hi) {
      findings.push({
        ...ctx,
        check: 'mol_molecular_weight_range',
        value: v,
        expected: `${lo}..${hi}`,
      });
    }
  }

  // 2. mol_xlogp3 range (when present)
  if (material.mol_xlogp3 != null) {
    const [lo, hi] = RANGES.mol_xlogp3;
    const v = material.mol_xlogp3;
    if (!Number.isFinite(v) || v < lo || v > hi) {
      findings.push({
        ...ctx,
        check: 'mol_xlogp3_range',
        value: v,
        expected: `${lo}..${hi}`,
      });
    }
  }

  // 3. data_provenance.last_fetched present + ISO format
  const prov = material.data_provenance;
  if (!prov || !prov.last_fetched) {
    findings.push({
      ...ctx,
      check: 'provenance_last_fetched_missing',
      message: 'data_provenance.last_fetched required when mol_* present',
    });
  } else if (!ISO_DATE_RE.test(prov.last_fetched)) {
    findings.push({
      ...ctx,
      check: 'provenance_last_fetched_bad_format',
      value: prov.last_fetched,
      expected: 'YYYY-MM-DD',
    });
  }

  // 4. chem_vapor_pressure_mmhg_25c positive (when present)
  if (material.chem_vapor_pressure_mmhg_25c != null) {
    const v = material.chem_vapor_pressure_mmhg_25c;
    if (!(Number.isFinite(v) && v > 0)) {
      findings.push({
        ...ctx,
        check: 'vapor_pressure_nonpositive',
        value: v,
        expected: '> 0',
      });
    }
  }

  // 5. Cache integrity: stored mol_inchi_key matches the InChIKey in
  //    the cached PubChem first-layer response for the stored CID.
  //    Silent skip on cache miss — we never network-fetch from here.
  if (material.pubchem_cid && material.mol_inchi_key) {
    const cached = cacheRead(material.pubchem_cid, 'first-layer', cacheDir);
    if (cached) {
      const cachedKey = cached.InChIKey || cached.inchi_key;
      if (cachedKey && cachedKey !== material.mol_inchi_key) {
        findings.push({
          ...ctx,
          check: 'cache_inchi_key_mismatch',
          cid: material.pubchem_cid,
          stored: material.mol_inchi_key,
          cached: cachedKey,
        });
      }
    }
  }

  return findings;
}

export function verify(db, cacheDir) {
  const stats = { checked: 0, with_mol: 0, anomalies: 0 };
  const findings = [];
  for (const m of db) {
    stats.checked++;
    if (!hasMolFields(m)) continue;
    stats.with_mol++;
    const fs = checkMaterial(m, cacheDir);
    if (fs.length > 0) {
      stats.anomalies += fs.length;
      findings.push(...fs);
    }
  }
  return { stats, findings };
}

// ── CLI entry ─────────────────────────────────────────────────────────
/* c8 ignore start */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const dataPath = path.join(REPO, 'data', 'materials.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const result = verify(data.perfumery_db, DEFAULT_CACHE_DIR);

  console.log('═══ Molecular verification (offline; cache-only) ═══');
  console.log(`  materials in DB:       ${result.stats.checked}`);
  console.log(`  with mol_* fields:     ${result.stats.with_mol}`);
  console.log(`  anomalies:             ${result.stats.anomalies}`);

  if (result.findings.length > 0) {
    // Group by check category for readability
    const byCheck = {};
    for (const f of result.findings) {
      (byCheck[f.check] = byCheck[f.check] || []).push(f);
    }
    console.log('\n  By check category:');
    for (const [check, list] of Object.entries(byCheck)) {
      console.log(`    ${check.padEnd(40)} ${list.length}`);
    }
    console.log('\n  First 20 anomalies:');
    for (const f of result.findings.slice(0, 20)) {
      const detail =
        f.value !== undefined
          ? `value=${JSON.stringify(f.value)} expected=${f.expected || ''}`
          : f.message || '';
      console.log(`    [${f.check}] ${f.cas} ${f.name}: ${detail}`);
    }
    if (result.findings.length > 20) {
      console.log(`    … +${result.findings.length - 20} more`);
    }
  }

  const outPath = path.join(REPO, 'audit', 'molecular-verify.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`\n  full report → ${path.relative(REPO, outPath)}`);

  process.exit(result.findings.length > 0 ? 1 : 0);
}
/* c8 ignore stop */
