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
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', 'materials.json'), 'utf8'));
const byCas = new Map(data.perfumery_db.map(e => [e.cas, e]));

// PubChem-canonical reference data for 20 popular materials. MW ±1 Da
// tolerance accounts for stereoisomer / isotope variants of the same
// molecular formula (e.g. PubChem returns 234.39 for CID 519858 and
// 234.40 for CID 521185 — both Iso E Super).
const REFERENCE = [
  { name: 'Linalool',                  cas: '78-70-6',     formula: 'C10H18O',   mw: 154.25 },
  { name: 'Hedione',                   cas: '24851-98-7',  formula: 'C13H22O3',  mw: 226.31, pubchem_cid: '5365133' },
  { name: 'Iso E Super',               cas: '54464-57-2',  formula: 'C16H26O',   mw: 234.38 },
  { name: 'Vanillin',                  cas: '121-33-5',    formula: 'C8H8O3',    mw: 152.15 },
  { name: 'Ambroxan',                  cas: '6790-58-5',   formula: 'C16H28O',   mw: 236.39 },
  { name: 'Cashmeran',                 cas: '33704-61-9',  formula: 'C14H22O',   mw: 206.32 },
  { name: 'Calone 1951',               cas: '28940-11-6',  formula: 'C10H10O3',  mw: 178.18 },
  { name: 'Galaxolide',                cas: '1222-05-5',   formula: 'C18H26O',   mw: 258.40 },
  { name: 'Dihydromyrcenol',           cas: '18479-58-8',  formula: 'C10H20O',   mw: 156.27 },
  { name: 'Geraniol',                  cas: '106-24-1',    formula: 'C10H18O',   mw: 154.25 },
  { name: 'Citral',                    cas: '5392-40-5',   formula: 'C10H16O',   mw: 152.23 },
  { name: 'Eugenol',                   cas: '97-53-0',     formula: 'C10H12O2',  mw: 164.20 },
  { name: 'Benzyl Benzoate',           cas: '120-51-4',    formula: 'C14H12O2',  mw: 212.24 },
  { name: 'Coumarin',                  cas: '91-64-5',     formula: 'C9H6O2',    mw: 146.14 },
  { name: 'alpha-Methyl Ionone',       cas: '7779-30-8',   formula: 'C14H22O',   mw: 206.32 },
  { name: 'Helional',                  cas: '1205-17-0',   formula: 'C11H12O3',  mw: 192.21 },
  { name: 'beta-Damascenone',          cas: '23696-85-7',  formula: 'C13H18O',   mw: 190.28 },
  { name: 'Floralozone',               cas: '67634-15-5',  formula: 'C13H18O',   mw: 190.28 },
  { name: 'Lyral',                     cas: '31906-04-4',  formula: 'C13H22O2',  mw: 210.31 },
  { name: 'Ethyl Maltol',              cas: '4940-11-8',   formula: 'C7H8O3',    mw: 140.13 },
];

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
        expect(Number.isFinite(mw), `${ref.name} weight should parse as a finite number`).toBe(true);
        expect(Math.abs(mw - ref.mw)).toBeLessThanOrEqual(1.0);
      });

      if (ref.pubchem_cid) {
        it('has the correct PubChem CID pinned', () => {
          // Bug 1 — Hedione's CID was previously 102861 (or worse, the
          // wrong-compound 31252 from a broken xref/RN lookup). 5365133
          // is the user-specified canonical record for racemic methyl
          // dihydrojasmonate.
          expect(e.pubchem_cid).toBe(ref.pubchem_cid);
        });
      }
    });
  }
});

describe('mixture_cas integrity — single aroma chemicals must NOT be classified as natural mixtures', () => {
  // Bug 2 — Iso E Super (synthetic IFF aroma chemical, 1973) was wrongly
  // listed in the mixture_cas array, which caused the Type chip to read
  // "Essential Oil / Natural mixture". Same root cause for 10 other
  // synthetics. This regression spec pins them out of mixture_cas.
  const SYNTHETICS_NOT_IN_MIXTURES = [
    '54464-57-2',  // Iso E Super
    '111879-80-2', // Habanolide
    '117-98-6',    // Vetiveryl Acetate
    '127-51-5',    // alpha-Isomethyl Ionone
    '141-25-3',    // Rhodinol
    '15764-04-2',  // alpha-Vetivone
    '17369-59-4',  // (Z)-3-Butylidene Phthalide
    '41429-52-1',  // Norpatchoulenol
    '58297-61-9',  // Khusimone
    '70788-30-6',  // Norlimbanol
    '77-54-3',     // Cedryl Acetate
  ];
  const mixSet = new Set(data.mixture_cas);
  for (const cas of SYNTHETICS_NOT_IN_MIXTURES) {
    it(`${cas} (synthetic aroma chemical) is NOT in mixture_cas`, () => {
      expect(mixSet.has(cas), `${cas} should be classified as a single aroma chemical, not a natural mixture`).toBe(false);
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
