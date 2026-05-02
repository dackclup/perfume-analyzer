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
// Round 3 P1.6 — allowlist:
//   audit/molecular-verify-baseline.json holds domain-legitimate
//   anomalies (e.g. Glyceryl Trioleate XLogP=22.4, Ethanol MW=46.07).
//   Findings matching an entry by (cas, field-prefix) within ±5%
//   value tolerance are partitioned out as `allowlisted` (info, not
//   error). Allowlist entries with no matching finding are reported
//   as `stale` (info). Only un-allowlisted findings drive exit 1.
//
// Output:
//   - human-readable summary on stdout
//   - audit/molecular-verify.json (full report incl. errors,
//     allowlisted, and stale entries; gitignored).
//
// Exit codes:
//   0 — clean (no errors; allowlisted + stale OK)
//   1 — at least one un-allowlisted anomaly

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

// P1.6 — allowlist matcher.
// An allowlist entry { cas, field, value } matches a finding when:
//   - finding.cas === entry.cas
//   - finding.check starts with entry.field (e.g. entry.field='mol_xlogp3'
//     matches check='mol_xlogp3_range' AND check='mol_xlogp3_missing')
//   - if entry.value is set AND finding.value is set: |fv - ev| / |ev|
//     <= 5% (or absolute 0.05 when entry.value is 0).
export function matchesAllowlist(finding, entry) {
  if (!entry || finding.cas !== entry.cas) return false;
  if (typeof entry.field !== 'string' || !finding.check) return false;
  if (!finding.check.startsWith(entry.field)) return false;
  if (entry.value != null && finding.value != null) {
    const fv = Number(finding.value);
    const ev = Number(entry.value);
    if (!Number.isFinite(fv) || !Number.isFinite(ev)) return false;
    const tol = Math.max(Math.abs(ev * 0.05), 0.05);
    if (Math.abs(fv - ev) > tol) return false;
  }
  return true;
}

export function verify(db, cacheDir, allowlistPayload) {
  const allowlist = (allowlistPayload && allowlistPayload.allowlist) || [];
  const stats = {
    checked: 0,
    with_mol: 0,
    errors: 0,
    allowlisted: 0,
    stale: 0,
  };
  const errors = [];
  const allowlisted = [];
  const matchedIndexes = new Set();
  for (const m of db) {
    stats.checked++;
    if (!hasMolFields(m)) continue;
    stats.with_mol++;
    const fs = checkMaterial(m, cacheDir);
    for (const f of fs) {
      let allowIdx = -1;
      for (let i = 0; i < allowlist.length; i++) {
        if (matchesAllowlist(f, allowlist[i])) {
          allowIdx = i;
          break;
        }
      }
      if (allowIdx >= 0) {
        matchedIndexes.add(allowIdx);
        allowlisted.push({ ...f, allowlist_reason: allowlist[allowIdx].reason });
      } else {
        errors.push(f);
      }
    }
  }
  const stale = allowlist
    .map((entry, i) => (matchedIndexes.has(i) ? null : { ...entry, status: 'stale' }))
    .filter(Boolean);
  stats.errors = errors.length;
  stats.allowlisted = allowlisted.length;
  stats.stale = stale.length;
  return { stats, errors, allowlisted, stale };
}

// ── CLI entry ─────────────────────────────────────────────────────────
/* c8 ignore start */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const dataPath = path.join(REPO, 'data', 'materials.json');
  const allowlistPath = path.join(REPO, 'audit', 'molecular-verify-baseline.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const allowlistPayload = fs.existsSync(allowlistPath)
    ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
    : null;
  const result = verify(data.perfumery_db, DEFAULT_CACHE_DIR, allowlistPayload);

  console.log('═══ Molecular verification (offline; cache-only) ═══');
  console.log(`  materials in DB:       ${result.stats.checked}`);
  console.log(`  with mol_* fields:     ${result.stats.with_mol}`);
  console.log(`  errors:                ${result.stats.errors}`);
  console.log(`  allowlisted:           ${result.stats.allowlisted}`);
  console.log(`  stale baseline:        ${result.stats.stale}`);

  if (result.errors.length > 0) {
    const byCheck = {};
    for (const f of result.errors) {
      (byCheck[f.check] = byCheck[f.check] || []).push(f);
    }
    console.log('\n  Errors by check:');
    for (const [check, list] of Object.entries(byCheck)) {
      console.log(`    ${check.padEnd(40)} ${list.length}`);
    }
    console.log('\n  First 20 errors:');
    for (const f of result.errors.slice(0, 20)) {
      const detail =
        f.value !== undefined
          ? `value=${JSON.stringify(f.value)} expected=${f.expected || ''}`
          : f.message || '';
      console.log(`    [${f.check}] ${f.cas} ${f.name}: ${detail}`);
    }
    if (result.errors.length > 20) {
      console.log(`    … +${result.errors.length - 20} more`);
    }
  }

  if (result.allowlisted.length > 0) {
    console.log('\n  Allowlisted (domain-legitimate, NOT errors):');
    for (const f of result.allowlisted) {
      console.log(`    [${f.check}] ${f.cas} ${f.name}: ${f.allowlist_reason}`);
    }
  }

  if (result.stale.length > 0) {
    console.log('\n  Stale baseline entries (allowlist row no longer triggers):');
    for (const e of result.stale) {
      console.log(`    ${e.cas} ${e.name} ${e.field}=${e.value}`);
    }
  }

  const outPath = path.join(REPO, 'audit', 'molecular-verify.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`\n  full report → ${path.relative(REPO, outPath)}`);

  process.exit(result.errors.length > 0 ? 1 : 0);
}
/* c8 ignore stop */
