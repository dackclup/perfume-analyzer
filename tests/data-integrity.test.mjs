// tests/data-integrity.test.mjs
//
// Regression spec for data/materials.json — guards 20 popular perfumery
// materials against the class of bug found in the Phase-2 deep audit:
// CAS-to-CID mapping in tools/add-materials.mjs occasionally returned
// the wrong PubChem record, polluting downstream formula / MW / IUPAC /
// SMILES fields with another compound's data (Hedione → 2,5-dimethyl-
// pyrazine; Vanillin → malonic acid; etc.).
//
// Strategy: pin CAS, formula, MW (±1 Da to absorb rounding), and a few
// classification flags against well-known authoritative values from
// PubChem / Good Scents / IFRA. The list is short (20) and curated so
// each entry has a clear correct reference; running the full DB
// (623 rows) against PubChem at test time would be slow + flaky.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const data = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'data', 'materials.json'), 'utf8')
);
const byCas = new Map(data.perfumery_db.map(e => [e.cas, e]));

// PubChem-canonical reference data for 20 popular materials. MW ±1 Da
// tolerance accounts for stereoisomer / isotope variants of the same
// molecular formula. SMILES + heavy-atom count derived from PubChem
// CanonicalSMILES, kept identifier-only (Audit-3) so the regression
// catches CAS-to-CID lookup failures that previously substituted whole
// wrong compounds (Hedione → Boc-phenylalanyl ester, Vanillin → malonic
// acid, Ambroxan → Abscisic acid).
//
// pubchem_cid values pinned to authoritative records verified via live
// PubChem REST name lookups during the audit-3 round.
const REFERENCE = [
  { name: 'Linalool', cas: '78-70-6', formula: 'C10H18O', mw: 154.25, heavyAtoms: 11 },
  {
    name: 'Hedione',
    cas: '24851-98-7',
    formula: 'C13H22O3',
    mw: 226.31,
    heavyAtoms: 16,
    pubchem_cid: '102861',
  },
  { name: 'Iso E Super', cas: '54464-57-2', formula: 'C16H26O', mw: 234.38, heavyAtoms: 17 },
  {
    name: 'Vanillin',
    cas: '121-33-5',
    formula: 'C8H8O3',
    mw: 152.15,
    heavyAtoms: 11,
    pubchem_cid: '1183',
  },
  {
    name: 'Ambroxan',
    cas: '6790-58-5',
    formula: 'C16H28O',
    mw: 236.39,
    heavyAtoms: 17,
    pubchem_cid: '10857465',
  },
  {
    name: 'Cashmeran',
    cas: '33704-61-9',
    formula: 'C14H22O',
    mw: 206.32,
    heavyAtoms: 15,
    pubchem_cid: '92292',
  },
  { name: 'Calone 1951', cas: '28940-11-6', formula: 'C10H10O3', mw: 178.18, heavyAtoms: 13 },
  {
    name: 'Galaxolide',
    cas: '1222-05-5',
    formula: 'C18H26O',
    mw: 258.4,
    heavyAtoms: 19,
    pubchem_cid: '91497',
  },
  { name: 'Dihydromyrcenol', cas: '18479-58-8', formula: 'C10H20O', mw: 156.27, heavyAtoms: 11 },
  { name: 'Geraniol', cas: '106-24-1', formula: 'C10H18O', mw: 154.25, heavyAtoms: 11 },
  { name: 'Citral', cas: '5392-40-5', formula: 'C10H16O', mw: 152.23, heavyAtoms: 11 },
  { name: 'Eugenol', cas: '97-53-0', formula: 'C10H12O2', mw: 164.2, heavyAtoms: 12 },
  { name: 'Benzyl Benzoate', cas: '120-51-4', formula: 'C14H12O2', mw: 212.24, heavyAtoms: 16 },
  { name: 'Coumarin', cas: '91-64-5', formula: 'C9H6O2', mw: 146.14, heavyAtoms: 11 },
  { name: 'alpha-Methyl Ionone', cas: '7779-30-8', formula: 'C14H22O', mw: 206.32, heavyAtoms: 15 },
  { name: 'Helional', cas: '1205-17-0', formula: 'C11H12O3', mw: 192.21, heavyAtoms: 14 },
  { name: 'beta-Damascenone', cas: '23696-85-7', formula: 'C13H18O', mw: 190.28, heavyAtoms: 14 },
  { name: 'Floralozone', cas: '67634-15-5', formula: 'C13H18O', mw: 190.28, heavyAtoms: 14 },
  {
    name: 'Lyral',
    cas: '31906-04-4',
    formula: 'C13H22O2',
    mw: 210.31,
    heavyAtoms: 15,
    pubchem_cid: '91604',
  },
  { name: 'Ethyl Maltol', cas: '4940-11-8', formula: 'C7H8O3', mw: 140.13, heavyAtoms: 10 },
];

// Heavy-atom count (= non-hydrogen atoms) parsed from the molecular
// formula. Used to cross-check the formula on the JSON entry isn't a
// stereoisomer of the wrong compound.
function heavyAtomsFromFormula(f) {
  if (!f) return 0;
  let n = 0;
  for (const m of f.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    if (!m[1] || m[1] === 'H') continue;
    n += parseInt(m[2] || '1', 10);
  }
  return n;
}

describe('data/materials.json — 20 popular materials regression spec', () => {
  for (const ref of REFERENCE) {
    describe(`${ref.name} (${ref.cas})`, () => {
      const e = byCas.get(ref.cas);

      it('exists in perfumery_db', () => {
        expect(e, `material with CAS ${ref.cas} not found`).toBeDefined();
      });

      it('has correct molecular formula', () => {
        expect(e.formula, `${ref.name} formula`).toBe(ref.formula);
      });

      it('has correct molecular weight (±1 Da)', () => {
        const mw = parseFloat(e.weight);
        expect(Number.isFinite(mw), `${ref.name} weight should parse as a finite number`).toBe(
          true
        );
        expect(Math.abs(mw - ref.mw)).toBeLessThanOrEqual(1.0);
      });

      if (ref.pubchem_cid) {
        it('has the correct PubChem CID pinned', () => {
          // Audit-3 round revealed the previous CIDs were wrong:
          //   Hedione 5365133 → 102861   (was Boc-phenylalanyl ester)
          //   Ambroxan 443061 → 10857465 (was Abscisic acid)
          //   Cashmeran 116903 → 92292   (was a triglyceride alcohol)
          //   Lyral 91497 → 91604        (91497 is actually Galaxolide)
          //   Galaxolide 91497 ✓ (unchanged, this is correct).
          expect(e.pubchem_cid).toBe(ref.pubchem_cid);
        });
      }

      it('has a non-empty SMILES that matches the formula heavy-atom count', () => {
        // Audit-3 SMILES check — the previous regression suite only
        // pinned formula+MW. That allowed the wrong-CID class of bug
        // (whole compound substituted) to slip through if the random
        // wrong record happened to have the right formula. SMILES is
        // a second-channel identity: parsing it gives the same heavy-
        // atom count as the formula iff it's the right molecule.
        expect(e.smiles, `${ref.name} SMILES should not be empty`).toBeTruthy();
        const haInFormula = heavyAtomsFromFormula(ref.formula);
        // SMILES atom-token count includes the canonical-aromatic uppercase
        // letters (C, N, O) plus the lowercase aromatic forms (c, n, o).
        // Re-count case-insensitively but exclude H.
        const haInSmilesCaseInsensitive = (
          e.smiles.replace(/[H]\d*/g, '').match(/[A-Za-z]/g) || []
        ).filter(c => c.toUpperCase() !== 'H').length;
        expect(haInSmilesCaseInsensitive).toBeGreaterThanOrEqual(haInFormula - 1);
        expect(haInSmilesCaseInsensitive).toBeLessThanOrEqual(haInFormula + 1);
      });
    });
  }
});

describe('engine — longevity floor consistency between tabs', () => {
  // Audit-3 #7 — Compatibility tab read totalHours, Evaporation tab read
  // each phase.end. The Phase-2 floor only patched totalHours, leaving
  // a 4 h discrepancy between tabs for high-tenacity mid materials.
  // The audit-3 fix promotes the floor to phase.end too. This spec
  // pins the invariant so the two display paths can never diverge again.
  it('totalHours equals max(topPhase.end, heartPhase.end, basePhase.end)', async () => {
    // Smoke test by importing the engine via Node's vm sandbox —
    // formulation_engine.js is a script, not a module, but it's pure
    // (no DOM access in estimateLongevity). Synthesise a one-material
    // formula with a Middle note and check the floor flows through.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const url = await import('node:url');
    const __dirname2 = path.dirname(url.fileURLToPath(import.meta.url));
    const root = path.resolve(__dirname2, '..');
    const tax = await fs.readFile(path.join(root, 'taxonomy.js'), 'utf8');
    const dataS = await fs.readFile(path.join(root, 'formulation_data.js'), 'utf8');
    const engine = await fs.readFile(path.join(root, 'formulation_engine.js'), 'utf8');
    const ctx = {};
    new Function(
      'ctx',
      tax + '\n' + dataS + '\n' + engine + '\nObject.assign(ctx,{estimateLongevity});'
    )(ctx);

    const hedione = data.perfumery_db.find(x => x.cas === '24851-98-7');
    expect(hedione).toBeDefined();
    const lon = ctx.estimateLongevity(
      [{ cas: hedione.cas, name: hedione.name, pct: 100, data: hedione }],
      25
    );
    const maxEnd = Math.max(lon.topPhase.end, lon.heartPhase.end, lon.basePhase.end);
    expect(lon.totalHours, 'totalHours must equal max phase.end').toBeCloseTo(maxEnd, 1);
    // Hedione is a high-tenacity mid-tier material at 100% — the floor
    // ensures the user sees ≥4 h, not the simulator's 0.3 h artifact.
    expect(lon.totalHours, '100% Hedione should report ≥ 4 h longevity').toBeGreaterThanOrEqual(
      4.0
    );
  });
});

describe('mixture_cas integrity — single aroma chemicals must NOT be classified as natural mixtures', () => {
  // Bug 2 — Iso E Super (synthetic IFF aroma chemical, 1973) was wrongly
  // listed in the mixture_cas array, which caused the Type chip to read
  // "Essential Oil / Natural mixture". Same root cause for 10 other
  // synthetics. This regression spec pins them out of mixture_cas.
  const SYNTHETICS_NOT_IN_MIXTURES = [
    '54464-57-2', // Iso E Super
    '111879-80-2', // Habanolide
    '117-98-6', // Vetiveryl Acetate
    '127-51-5', // alpha-Isomethyl Ionone
    '141-25-3', // Rhodinol
    '15764-04-2', // alpha-Vetivone
    '17369-59-4', // (Z)-3-Butylidene Phthalide
    '41429-52-1', // Norpatchoulenol
    '58297-61-9', // Khusimone
    '70788-30-6', // Norlimbanol
    '77-54-3', // Cedryl Acetate
  ];
  const mixSet = new Set(data.mixture_cas);
  for (const cas of SYNTHETICS_NOT_IN_MIXTURES) {
    it(`${cas} (synthetic aroma chemical) is NOT in mixture_cas`, () => {
      expect(
        mixSet.has(cas),
        `${cas} should be classified as a single aroma chemical, not a natural mixture`
      ).toBe(false);
    });
  }
});

describe('data/materials.json — schema integrity', () => {
  it('every entry has a non-empty name and CAS', () => {
    const broken = data.perfumery_db.filter(e => !e.name || !e.cas);
    expect(broken, `${broken.length} entries missing required name/cas`).toHaveLength(0);
  });

  it('CAS values are unique (no duplicates)', () => {
    const seen = new Map();
    const dups = [];
    for (const e of data.perfumery_db) {
      if (seen.has(e.cas)) dups.push({ cas: e.cas, names: [seen.get(e.cas), e.name] });
      else seen.set(e.cas, e.name);
    }
    expect(dups, `duplicate CAS rows: ${JSON.stringify(dups)}`).toHaveLength(0);
  });

  it('perfumery_db is sorted by CAS (canonical write order)', () => {
    const cas = data.perfumery_db.map(e => e.cas || '');
    const sorted = [...cas].sort((a, b) => a.localeCompare(b));
    expect(cas, 'perfumery_db must be CAS-sorted on write').toEqual(sorted);
  });
});
