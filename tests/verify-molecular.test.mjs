import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Round 3 P1.5 — verify-molecular + molecular-coverage-report.

import { checkMaterial, verify, matchesAllowlist } from '../tools/verify-molecular.mjs';
import { buildCoverage } from '../tools/molecular-coverage-report.mjs';
import { cacheWrite } from '../tools/lib/pubchem.mjs';

// ── Fixture helpers ─────────────────────────────────────────────────
function clean() {
  return {
    cas: '78-70-6',
    name: 'Linalool',
    pubchem_cid: '6549',
    mol_molecular_weight: 154.25,
    mol_xlogp3: 2.7,
    mol_inchi_key: 'CDOSHBSSFJOMGT-UHFFFAOYSA-N',
    data_provenance: {
      computed_source: 'PubChem PUG-REST',
      last_fetched: '2026-05-02',
      manual_overrides: [],
    },
  };
}

// ── verify-molecular: per-material checks ────────────────────────────
describe('verify-molecular — checkMaterial', () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-mol-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('clean fixture → 0 findings', () => {
    expect(checkMaterial(clean(), tmp)).toEqual([]);
  });

  it('skips materials with no mol_* fields entirely', () => {
    const m = { cas: 'x', name: 'legacy-only', smiles: 'CCO', xlogp: '2.7' };
    expect(checkMaterial(m, tmp)).toEqual([]);
  });

  it('mol_molecular_weight missing → flagged', () => {
    const m = { ...clean() };
    delete m.mol_molecular_weight;
    const findings = checkMaterial(m, tmp);
    expect(findings.map(f => f.check)).toContain('mol_molecular_weight_missing');
  });

  it('mol_molecular_weight = 49 (below range) → flagged', () => {
    const m = { ...clean(), mol_molecular_weight: 49 };
    const findings = checkMaterial(m, tmp);
    expect(findings).toContainEqual(
      expect.objectContaining({
        check: 'mol_molecular_weight_range',
        value: 49,
      })
    );
  });

  it('mol_molecular_weight = 1001 (above range) → flagged', () => {
    const m = { ...clean(), mol_molecular_weight: 1001 };
    const findings = checkMaterial(m, tmp);
    expect(findings.map(f => f.check)).toContain('mol_molecular_weight_range');
  });

  it('mol_xlogp3 = -6 → flagged', () => {
    const m = { ...clean(), mol_xlogp3: -6 };
    const findings = checkMaterial(m, tmp);
    expect(findings.map(f => f.check)).toContain('mol_xlogp3_range');
  });

  it('mol_xlogp3 = 11 → flagged', () => {
    const m = { ...clean(), mol_xlogp3: 11 };
    const findings = checkMaterial(m, tmp);
    expect(findings.map(f => f.check)).toContain('mol_xlogp3_range');
  });

  it('mol_xlogp3 absent (allowed — non-organics) → no flag for xlogp', () => {
    const m = { ...clean() };
    delete m.mol_xlogp3;
    const findings = checkMaterial(m, tmp);
    expect(findings.map(f => f.check)).not.toContain('mol_xlogp3_range');
  });

  it('data_provenance entirely missing → flagged', () => {
    const m = { ...clean() };
    delete m.data_provenance;
    const findings = checkMaterial(m, tmp);
    expect(findings.map(f => f.check)).toContain('provenance_last_fetched_missing');
  });

  it('data_provenance.last_fetched missing → flagged', () => {
    const m = { ...clean() };
    delete m.data_provenance.last_fetched;
    const findings = checkMaterial(m, tmp);
    expect(findings.map(f => f.check)).toContain('provenance_last_fetched_missing');
  });

  it('data_provenance.last_fetched non-ISO format → flagged', () => {
    const m = {
      ...clean(),
      data_provenance: { ...clean().data_provenance, last_fetched: '02/05/2026' },
    };
    const findings = checkMaterial(m, tmp);
    expect(findings.map(f => f.check)).toContain('provenance_last_fetched_bad_format');
  });

  it('chem_vapor_pressure_mmhg_25c <= 0 → flagged', () => {
    const m = { ...clean(), chem_vapor_pressure_mmhg_25c: 0 };
    const findings = checkMaterial(m, tmp);
    expect(findings.map(f => f.check)).toContain('vapor_pressure_nonpositive');
  });

  it('chem_vapor_pressure_mmhg_25c > 0 → clean', () => {
    const m = { ...clean(), chem_vapor_pressure_mmhg_25c: 0.16 };
    expect(checkMaterial(m, tmp).map(f => f.check)).not.toContain('vapor_pressure_nonpositive');
  });

  it('cache InChIKey matches mol_inchi_key → clean', () => {
    cacheWrite('6549', 'first-layer', { CID: 6549, InChIKey: 'CDOSHBSSFJOMGT-UHFFFAOYSA-N' }, tmp);
    expect(checkMaterial(clean(), tmp)).toEqual([]);
  });

  it('cache InChIKey differs from mol_inchi_key → flagged', () => {
    cacheWrite('6549', 'first-layer', { CID: 6549, InChIKey: 'WRONG-MOLECULE-XYZ' }, tmp);
    const findings = checkMaterial(clean(), tmp);
    expect(findings.map(f => f.check)).toContain('cache_inchi_key_mismatch');
    const f = findings.find(x => x.check === 'cache_inchi_key_mismatch');
    expect(f.cached).toBe('WRONG-MOLECULE-XYZ');
    expect(f.stored).toBe('CDOSHBSSFJOMGT-UHFFFAOYSA-N');
  });

  it('cache miss → silently skipped (no anomaly emitted)', () => {
    // tmp is empty → no cache file → checkMaterial must not flag.
    expect(checkMaterial(clean(), tmp)).toEqual([]);
  });
});

describe('verify-molecular — verify(db, cacheDir)', () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-mol-batch-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('counts checked / with_mol / errors correctly (no allowlist)', () => {
    const db = [
      clean(), // ok
      { cas: 'x', name: 'legacy-only' }, // no mol_*
      { ...clean(), cas: 'y', name: 'OOR', mol_xlogp3: 99 }, // anomaly
    ];
    const result = verify(db, tmp);
    expect(result.stats).toEqual({
      checked: 3,
      with_mol: 2,
      errors: 1,
      allowlisted: 0,
      stale: 0,
      cache_skipped: 2, // clean() and OOR both have pubchem_cid + mol_inchi_key (inherited), no cache files in tmp
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].cas).toBe('y');
  });

  it('clean DB → 0 errors, exit-equivalent ok', () => {
    const db = [clean()];
    const result = verify(db, tmp);
    expect(result.stats.errors).toBe(0);
    expect(result.errors).toEqual([]);
  });

  // P1.7 — CI-friendly cache-skip telemetry.
  it('counts cache_skipped when pubchem_cid + mol_inchi_key set but cache absent', () => {
    // tmp is empty → cache miss for every row that has both pubchem_cid + mol_inchi_key.
    const db = [
      clean(), // has both → counts as cache_skipped
      { ...clean(), cas: 'no-key', mol_inchi_key: undefined }, // missing inchi_key → not skipped (not checkable)
      { ...clean(), cas: 'no-cid', pubchem_cid: undefined }, // missing cid → not skipped (not checkable)
      { cas: 'legacy', name: 'no-mol', smiles: 'CCO' }, // no mol_* at all → not even with_mol
    ];
    const result = verify(db, tmp);
    expect(result.stats.checked).toBe(4);
    expect(result.stats.with_mol).toBe(3);
    // Only the first row had both pubchem_cid + mol_inchi_key with no cache file.
    expect(result.stats.cache_skipped).toBe(1);
    // Cache-skip must NOT produce errors (silent skip preserved from P1.5).
    expect(result.stats.errors).toBe(0);
  });
});

// ── P1.6: allowlist matching ─────────────────────────────────────────
describe('verify-molecular — matchesAllowlist', () => {
  const entry = {
    cas: '122-32-7',
    name: 'Glyceryl Trioleate',
    field: 'mol_xlogp3',
    value: 22.4,
    reason: 'triglyceride',
  };

  it('matches when cas + field-prefix + value within ±5%', () => {
    expect(
      matchesAllowlist({ cas: '122-32-7', check: 'mol_xlogp3_range', value: 22.4 }, entry)
    ).toBe(true);
    // Within tolerance
    expect(
      matchesAllowlist({ cas: '122-32-7', check: 'mol_xlogp3_range', value: 23.0 }, entry)
    ).toBe(true);
  });

  it('rejects when cas differs', () => {
    expect(matchesAllowlist({ cas: 'other', check: 'mol_xlogp3_range', value: 22.4 }, entry)).toBe(
      false
    );
  });

  it('rejects when finding.check does NOT start with entry.field', () => {
    expect(
      matchesAllowlist({ cas: '122-32-7', check: 'mol_other_range', value: 22.4 }, entry)
    ).toBe(false);
  });

  it('rejects when value drifts beyond ±5% tolerance', () => {
    expect(matchesAllowlist({ cas: '122-32-7', check: 'mol_xlogp3_range', value: 30 }, entry)).toBe(
      false
    );
  });

  it('matches when entry has no value (any value passes)', () => {
    const noValEntry = { cas: '122-32-7', field: 'mol_xlogp3' };
    expect(
      matchesAllowlist({ cas: '122-32-7', check: 'mol_xlogp3_range', value: 999 }, noValEntry)
    ).toBe(true);
  });
});

describe('verify-molecular — verify() with allowlist', () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-mol-allow-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('anomaly in allowlist → goes to allowlisted, not errors; exit-equivalent 0', () => {
    const db = [{ ...clean(), cas: '122-32-7', name: 'Glyceryl Trioleate', mol_xlogp3: 22.4 }];
    const allowlist = {
      allowlist: [
        {
          cas: '122-32-7',
          field: 'mol_xlogp3',
          value: 22.4,
          reason: 'triglyceride; high logP correct',
        },
      ],
    };
    const result = verify(db, tmp, allowlist);
    expect(result.stats.errors).toBe(0);
    expect(result.stats.allowlisted).toBe(1);
    expect(result.allowlisted[0].allowlist_reason).toMatch(/triglyceride/);
    expect(result.errors).toEqual([]);
  });

  it('anomaly NOT in allowlist → goes to errors; exit-equivalent 1', () => {
    const db = [{ ...clean(), cas: 'z', name: 'unknown-OOR', mol_xlogp3: 50 }];
    const allowlist = {
      allowlist: [{ cas: '122-32-7', field: 'mol_xlogp3', value: 22.4, reason: 'unrelated' }],
    };
    const result = verify(db, tmp, allowlist);
    expect(result.stats.errors).toBe(1);
    expect(result.stats.allowlisted).toBe(0);
    expect(result.errors[0].cas).toBe('z');
  });

  it('allowlist entry with no matching finding → reported as stale (info, not error)', () => {
    const db = [clean()]; // no anomalies
    const allowlist = {
      allowlist: [
        {
          cas: '122-32-7',
          field: 'mol_xlogp3',
          value: 22.4,
          reason: 'tri (orphan in this run)',
        },
      ],
    };
    const result = verify(db, tmp, allowlist);
    expect(result.stats.errors).toBe(0);
    expect(result.stats.stale).toBe(1);
    expect(result.stale[0].status).toBe('stale');
    expect(result.stale[0].cas).toBe('122-32-7');
  });
});

// ── molecular-coverage-report ────────────────────────────────────────
describe('molecular-coverage-report — buildCoverage', () => {
  function fixture(opts = {}) {
    const materials = opts.materials || [
      // patched
      {
        cas: '78-70-6',
        name: 'Linalool',
        mol_xlogp3: 2.7,
        classification: { primaryFamilies: ['herbal'] },
      },
      {
        cas: '142-19-8',
        name: 'Allyl Heptanoate',
        mol_xlogp3: 4,
        classification: { primaryFamilies: ['fruity'] },
      },
      // mixture
      { cas: '8008-79-5', name: 'Spearmint Oil', classification: { primaryFamilies: ['herbal'] } },
      // unenriched
      { cas: 'x', name: 'Stub', classification: { primaryFamilies: ['woody'] } },
    ];
    return {
      meta: { version: '2026-04-29-v305', row_count: materials.length },
      perfumery_db: materials,
      trade_names: {},
      mixture_cas: opts.mixture_cas || ['8008-79-5'],
    };
  }

  it('counts total / mixtures / patched correctly', () => {
    const { summary } = buildCoverage(fixture(), null);
    expect(summary.total).toBe(4);
    expect(summary.mixtures).toBe(1);
    expect(summary.patched).toBe(2);
    expect(summary.flagged).toBe(0);
  });

  it('rates: raw, eligible, ship', () => {
    const flagged = { flagged: [{ cas: 'x' }] };
    const { summary } = buildCoverage(fixture(), flagged);
    // total=4, mixtures=1, patched=2, flagged=1
    // raw       = 2/4 = 50
    // eligible  = patched / (patched + flagged) = 2/3 ≈ 66.67
    // ship      = 2/2 = 100
    expect(summary.rates.raw).toBe(50);
    expect(summary.rates.eligible).toBeCloseTo(66.67, 1);
    expect(summary.rates.ship).toBe(100);
  });

  it('per-family breakdown counts flag + mixture per family', () => {
    const flagged = { flagged: [{ cas: 'x' }] };
    const { families } = buildCoverage(fixture(), flagged);
    expect(families.herbal).toEqual({ total: 2, mixtures: 1, patched: 1, flagged: 0 });
    expect(families.fruity).toEqual({ total: 1, mixtures: 0, patched: 1, flagged: 0 });
    expect(families.woody).toEqual({ total: 1, mixtures: 0, patched: 0, flagged: 1 });
  });

  it('handles missing flagged file (flagged=0; rates still meaningful)', () => {
    const { summary } = buildCoverage(fixture(), null);
    expect(summary.flagged).toBe(0);
    expect(summary.rates.raw).toBe(50);
    expect(summary.rates.eligible).toBe(100); // 2/(2+0) = 100
    expect(summary.rates.ship).toBe(100);
  });

  it('handles empty DB (no division-by-zero)', () => {
    const data = { perfumery_db: [], trade_names: {}, mixture_cas: [] };
    const { summary } = buildCoverage(data, null);
    expect(summary.total).toBe(0);
    expect(summary.rates.raw).toBe(0);
    expect(summary.rates.eligible).toBe(0);
    expect(summary.rates.ship).toBe(0);
  });

  it('classifies materials with no primaryFamilies as (unclassified)', () => {
    const data = {
      perfumery_db: [{ cas: 'x', name: 'orphan', mol_xlogp3: 1 }],
      mixture_cas: [],
    };
    const { families } = buildCoverage(data, null);
    expect(families['(unclassified)']).toEqual({ total: 1, mixtures: 0, patched: 1, flagged: 0 });
  });
});
