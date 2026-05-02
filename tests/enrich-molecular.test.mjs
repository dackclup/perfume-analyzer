import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Round 3 P1.3: comprehensive coverage of tools/enrich-molecular.mjs.
// Per amendment #5 acceptance criteria:
//   - line coverage >= 95%, branch coverage >= 85%
//   - every --flag combination has a dedicated test
//   - network mock tests cover: success, 503-retry, 404, malformed JSON

import {
  parseArgs,
  pickMaterials,
  resolveCid,
  pugRestToMolPatch,
  pugViewToChemPatch,
  buildPatch,
  applyPatches,
  main,
  HELP_TEXT,
  FIRST_LAYER_PROPERTIES,
} from '../tools/enrich-molecular.mjs';

// ── Fixtures ──────────────────────────────────────────────────────────
function fakeResponse({ status = 200, json = {}, throwOnJson = false }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => (throwOnJson ? Promise.reject(new Error('malformed JSON')) : Promise.resolve(json)),
  };
}

function makePugRestProperty(cid, overrides = {}) {
  return {
    CID: cid,
    MolecularFormula: 'C10H18O',
    MolecularWeight: '154.25',
    XLogP: 2.97,
    Complexity: 109,
    HBondDonorCount: 1,
    HBondAcceptorCount: 1,
    RotatableBondCount: 4,
    HeavyAtomCount: 11,
    IUPACName: '3,7-dimethylocta-1,6-dien-3-ol',
    CanonicalSMILES: 'CC(C)=CCCC(C)(O)C=C',
    IsomericSMILES: 'CC(C)=CCCC(C)(O)C=C',
    InChI: 'InChI=1S/C10H18O/c1-5-10(4,11)8-6-7-9(2)3/h5,7,11H,1,6,8H2,2-4H3',
    InChIKey: 'CDOSHBSSFJOMGT-UHFFFAOYSA-N',
    ExactMass: '154.135765193',
    ...overrides,
  };
}

function makeBatchResponse(properties) {
  return { PropertyTable: { Properties: properties } };
}

function makePugViewExperimental(values) {
  // Build a minimal PUG-View record with one Experimental Properties section.
  const sub = (heading, str) => ({
    TOCHeading: heading,
    Information: [{ Value: { StringWithMarkup: [{ String: str }] } }],
  });
  const subs = [];
  if (values.bp) subs.push(sub('Boiling Point', `${values.bp} °C`));
  if (values.mp) subs.push(sub('Melting Point', `${values.mp} °C`));
  if (values.fp) subs.push(sub('Flash Point', `${values.fp} °C`));
  if (values.density) subs.push(sub('Density', `${values.density} g/mL`));
  if (values.vp) subs.push(sub('Vapor Pressure', `${values.vp} mmHg at 25 °C`));
  return {
    Record: {
      Section: [{ TOCHeading: 'Experimental Properties', Section: subs }],
    },
  };
}

function makeFixtureDb(materials) {
  return {
    meta: { version: '2026-04-29-v304', row_count: materials.length },
    perfumery_db: materials,
    trade_names: {},
    mixture_cas: [],
  };
}

function writeFixture(tmp, db) {
  const dataPath = path.join(tmp, 'materials.json');
  fs.writeFileSync(dataPath, JSON.stringify(db, null, 2));
  return dataPath;
}

const FAST_OPTS = { retries: 1, errorBackoffMs: 1, rateLimitBackoffBaseMs: 1 };

// ── parseArgs ────────────────────────────────────────────────────────
describe('parseArgs', () => {
  const wrap = arr => parseArgs(['node', 'enrich-molecular.mjs', ...arr]);

  it('defaults: nothing set, dry-run is implicit (apply=false)', () => {
    const o = wrap([]);
    expect(o.firstLayerOnly).toBe(false);
    expect(o.experimental).toBe(false);
    expect(o.apply).toBe(false);
    expect(o.cid).toBeNull();
    expect(o.missingOnly).toBe(false);
    expect(o.help).toBe(false);
  });

  it('--first-layer-only sets the flag', () => {
    expect(wrap(['--first-layer-only']).firstLayerOnly).toBe(true);
  });

  it('--experimental sets the flag', () => {
    expect(wrap(['--experimental']).experimental).toBe(true);
  });

  it('--apply sets apply=true', () => {
    expect(wrap(['--apply']).apply).toBe(true);
  });

  it('--cid <numeric> sets cid', () => {
    expect(wrap(['--cid', '6549']).cid).toBe('6549');
  });

  it('--cid <non-numeric> returns _usageError', () => {
    const o = wrap(['--cid', 'banana']);
    expect(o._usageError).toMatch(/positive integer/);
  });

  it('--missing-only sets the flag', () => {
    expect(wrap(['--missing-only']).missingOnly).toBe(true);
  });

  it('--help / -h set help', () => {
    expect(wrap(['--help']).help).toBe(true);
    expect(wrap(['-h']).help).toBe(true);
  });
});

// ── pickMaterials ────────────────────────────────────────────────────
describe('pickMaterials', () => {
  const db = [
    { cas: '78-70-6', name: 'Linalool', pubchem_cid: '6549' },
    { cas: '142-19-8', name: 'Allyl Heptanoate', pubchem_cid: '8878' },
    { cas: '142-62-1', name: 'Hexanoic Acid', pubchem_cid: '8892', mol_xlogp3: 1.92 },
    { name: 'Stub-no-cas' }, // missing cas → filtered
  ];

  it('default selection drops materials without cas', () => {
    expect(pickMaterials(db, {}).map(m => m.cas)).toEqual(['78-70-6', '142-19-8', '142-62-1']);
  });

  it('--cid picks the single material with matching pubchem_cid', () => {
    expect(pickMaterials(db, { cid: '8892' })).toEqual([db[2]]);
  });

  it('--cid throws when not in DB', () => {
    expect(() => pickMaterials(db, { cid: '99999999' })).toThrow(/not found/);
  });

  it('--missing-only excludes materials that already have mol_xlogp3', () => {
    const picked = pickMaterials(db, { missingOnly: true });
    expect(picked.map(m => m.cas)).toEqual(['78-70-6', '142-19-8']);
  });

  it('--missing-only treats mol_xlogp3=0 as present (not missing)', () => {
    const dbZero = [{ cas: 'x', name: 'y', mol_xlogp3: 0 }];
    expect(pickMaterials(dbZero, { missingOnly: true })).toEqual([]);
  });
});

// ── resolveCid ───────────────────────────────────────────────────────
describe('resolveCid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns DB pubchem_cid when present (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await resolveCid({ cas: 'x', pubchem_cid: '6549' });
    expect(r).toEqual({ cid: '6549', source: 'db' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to CAS lookup when no pubchem_cid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ json: { IdentifierList: { CID: [12345] } } }))
    );
    const r = await resolveCid({ cas: '78-70-6' }, FAST_OPTS);
    expect(r).toEqual({ cid: '12345', source: 'pubchem-resolved' });
  });

  it('returns null source=pubchem-no-cid when CAS not in PubChem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ status: 404 }))
    );
    const r = await resolveCid({ cas: '999-99-9' }, FAST_OPTS);
    expect(r).toEqual({ cid: null, source: 'pubchem-no-cid' });
  });

  it('returns null source=no-cas-or-cid when material has neither', async () => {
    const r = await resolveCid({ name: 'orphan' });
    expect(r).toEqual({ cid: null, source: 'no-cas-or-cid' });
  });
});

// ── pugRestToMolPatch ────────────────────────────────────────────────
describe('pugRestToMolPatch', () => {
  it('maps every supported property to the mol_* key', () => {
    const patch = pugRestToMolPatch(makePugRestProperty(6549));
    expect(patch.mol_formula).toBe('C10H18O');
    expect(patch.mol_molecular_weight).toBe(154.25);
    expect(patch.mol_xlogp3).toBe(2.97);
    expect(patch.mol_complexity).toBe(109);
    expect(patch.mol_h_bond_donor_count).toBe(1);
    expect(patch.mol_heavy_atom_count).toBe(11);
    expect(patch.mol_iupac_name).toContain('octa-1,6-dien-3-ol');
    expect(patch.mol_inchi_key).toBe('CDOSHBSSFJOMGT-UHFFFAOYSA-N');
    expect(patch.mol_exact_mass).toBeCloseTo(154.135, 2);
  });

  it('skips fields that are null / empty string', () => {
    const patch = pugRestToMolPatch({
      CID: 1,
      MolecularFormula: '',
      MolecularWeight: null,
      XLogP: 1.2,
    });
    expect(patch.mol_formula).toBeUndefined();
    expect(patch.mol_molecular_weight).toBeUndefined();
    expect(patch.mol_xlogp3).toBe(1.2);
  });

  it('coerces stringified numbers', () => {
    const patch = pugRestToMolPatch({
      MolecularWeight: '78.11',
      XLogP: '1.5',
      HBondDonorCount: '0',
    });
    expect(patch.mol_molecular_weight).toBe(78.11);
    expect(patch.mol_xlogp3).toBe(1.5);
    expect(patch.mol_h_bond_donor_count).toBe(0);
  });

  it('discards non-finite numeric coercions', () => {
    const patch = pugRestToMolPatch({ MolecularWeight: 'oops', HeavyAtomCount: 'NaN' });
    expect(patch.mol_molecular_weight).toBeUndefined();
    expect(patch.mol_heavy_atom_count).toBeUndefined();
  });

  it('TPSA is intentionally NOT mapped (legacy flat field already populated)', () => {
    const tpsaPair = FIRST_LAYER_PROPERTIES.find(([n]) => n === 'TPSA');
    expect(tpsaPair[1]).toBeNull();
    const patch = pugRestToMolPatch({ TPSA: 20.23 });
    expect(patch.mol_tpsa).toBeUndefined();
  });
});

// ── pugViewToChemPatch ───────────────────────────────────────────────
describe('pugViewToChemPatch', () => {
  it('extracts numeric tokens from each known TOC heading', () => {
    const view = makePugViewExperimental({ bp: 198, mp: -20, density: 0.86, vp: 0.16 });
    const patch = pugViewToChemPatch(view);
    expect(patch.chem_boiling_point_c).toBe(198);
    expect(patch.chem_melting_point_c).toBe(-20);
    expect(patch.chem_density_g_ml).toBe(0.86);
    expect(patch.chem_vapor_pressure_mmhg_25c).toBe(0.16);
  });

  it('returns {} when no Record / no Experimental Properties section', () => {
    expect(pugViewToChemPatch({})).toEqual({});
    expect(pugViewToChemPatch({ Record: {} })).toEqual({});
    expect(pugViewToChemPatch({ Record: { Section: [{ TOCHeading: 'Other' }] } })).toEqual({});
  });

  it('skips sub-headings whose value is non-numeric / missing', () => {
    const sub = (h, s) => ({
      TOCHeading: h,
      Information: [{ Value: { StringWithMarkup: [{ String: s }] } }],
    });
    const view = {
      Record: {
        Section: [
          {
            TOCHeading: 'Experimental Properties',
            Section: [sub('Boiling Point', 'no number here'), sub('Density', '')],
          },
        ],
      },
    };
    expect(pugViewToChemPatch(view)).toEqual({});
  });
});

// ── buildPatch ───────────────────────────────────────────────────────
describe('buildPatch', () => {
  const opts = { experimental: false };
  const expOpts = { experimental: true };
  const runtime = { now: () => '2026-05-02' };

  it('returns null when no first-layer data for the cid', () => {
    expect(buildPatch({ cas: 'x' }, '1', {}, {}, opts, runtime)).toBeNull();
  });

  it('produces mol_* + data_provenance from first-layer data', () => {
    const fl = { 6549: makePugRestProperty(6549) };
    const p = buildPatch({ cas: 'x' }, '6549', fl, {}, opts, runtime);
    expect(p.mol_xlogp3).toBe(2.97);
    expect(p.data_provenance).toEqual({
      computed_source: 'PubChem PUG-REST',
      last_fetched: '2026-05-02',
      manual_overrides: [],
    });
    expect(p.data_provenance.experimental_source).toBeUndefined();
  });

  it('with --experimental, merges chem_* + sets experimental_source', () => {
    const fl = { 6549: makePugRestProperty(6549) };
    const exp = { 6549: makePugViewExperimental({ bp: 198, density: 0.86 }) };
    const p = buildPatch({ cas: 'x' }, '6549', fl, exp, expOpts, runtime);
    expect(p.chem_boiling_point_c).toBe(198);
    expect(p.chem_density_g_ml).toBe(0.86);
    expect(p.data_provenance.experimental_source).toBe('PubChem PUG-View');
  });

  it('uses runtime.now() for last_fetched (deterministic in tests)', () => {
    const fl = { 6549: makePugRestProperty(6549) };
    const p = buildPatch({ cas: 'x' }, '6549', fl, {}, opts, { now: () => '2099-01-01' });
    expect(p.data_provenance.last_fetched).toBe('2099-01-01');
  });
});

// ── applyPatches ─────────────────────────────────────────────────────
describe('applyPatches', () => {
  it('writes mol_* / chem_* / data_provenance, never touches legacy fields', () => {
    const db = [
      {
        cas: '78-70-6',
        name: 'Linalool',
        smiles: 'LEGACY-SMILES',
        xlogp: 'LEGACY-XLOGP',
        weight: 'LEGACY-WEIGHT',
      },
    ];
    const patches = {
      '78-70-6': {
        mol_xlogp3: 2.97,
        mol_molecular_weight: 154.25,
        chem_boiling_point_c: 198,
        data_provenance: {
          computed_source: 'PubChem PUG-REST',
          last_fetched: '2026-05-02',
          manual_overrides: [],
        },
        // a poison key — should be ignored, not written:
        legacy_xlogp_overwrite: 'NOT_ALLOWED',
      },
    };
    const result = applyPatches(db, patches);
    const m = result[0];
    expect(m.smiles).toBe('LEGACY-SMILES');
    expect(m.xlogp).toBe('LEGACY-XLOGP');
    expect(m.weight).toBe('LEGACY-WEIGHT');
    expect(m.mol_xlogp3).toBe(2.97);
    expect(m.mol_molecular_weight).toBe(154.25);
    expect(m.chem_boiling_point_c).toBe(198);
    expect(m.data_provenance.last_fetched).toBe('2026-05-02');
    expect(m.legacy_xlogp_overwrite).toBeUndefined();
  });

  it('passes through unpatched materials unchanged (returns new array)', () => {
    const db = [{ cas: 'a' }, { cas: 'b' }];
    const result = applyPatches(db, { a: { mol_xlogp3: 1 } });
    expect(result[0].mol_xlogp3).toBe(1);
    expect(result[1]).toEqual({ cas: 'b' });
    // does not mutate input
    expect(db[0].mol_xlogp3).toBeUndefined();
  });
});

// ── main() integration with mocked fetch ─────────────────────────────
describe('main() — integration', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-mol-'));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function runtime(extras = {}) {
    // IMPORTANT: only write the default fixture if the test didn't provide
    // its own dataPath. Otherwise the default `writeFixture` would run after
    // the test's writeFixture (object-literal evaluation order) and silently
    // overwrite the intended materials.json.
    const dataPath =
      extras.dataPath ||
      writeFixture(
        tmp,
        makeFixtureDb([
          { cas: '78-70-6', name: 'Linalool', pubchem_cid: '6549' },
          { cas: '142-19-8', name: 'Allyl Heptanoate', pubchem_cid: '8878' },
        ])
      );
    return {
      dataPath,
      cacheDir: path.join(tmp, 'cache'),
      patchPath: path.join(tmp, 'molecular-patches.json'),
      now: () => '2026-05-02',
      fetchOpts: FAST_OPTS,
      ...extras,
    };
  }

  it('--help returns exitCode 0 with HELP_TEXT', async () => {
    const r = await main({ help: true });
    expect(r.exitCode).toBe(0);
    expect(r.helpText).toBe(HELP_TEXT);
  });

  it('--cid <bad> returns exitCode 2 with _usageError', async () => {
    const opts = parseArgs(['node', 'x', '--cid', 'banana']);
    const r = await main(opts);
    expect(r.exitCode).toBe(2);
    expect(r.error).toMatch(/positive integer/);
  });

  it('--cid <not in DB> returns exitCode 1', async () => {
    const rt = runtime();
    const r = await main({ cid: '99999999' }, rt);
    expect(r.exitCode).toBe(1);
    expect(r.error).toMatch(/not found/);
  });

  it('--first-layer-only --dry-run: writes patches file, leaves data unchanged', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({
        json: makeBatchResponse([makePugRestProperty(6549), makePugRestProperty(8878)]),
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const rt = runtime();
    const dataBefore = fs.readFileSync(rt.dataPath, 'utf8');
    const r = await main({ firstLayerOnly: true, apply: false }, rt);
    expect(r.exitCode).toBe(0);
    expect(r.summary.patched).toBe(2);
    expect(r.summary.network_calls).toBe(1); // single batch
    expect(fs.existsSync(rt.patchPath)).toBe(true);
    expect(fs.readFileSync(rt.dataPath, 'utf8')).toBe(dataBefore);
  });

  it('--first-layer-only --apply: writes patches file AND merges into data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          json: makeBatchResponse([makePugRestProperty(6549), makePugRestProperty(8878)]),
        })
      )
    );
    const rt = runtime();
    const r = await main({ firstLayerOnly: true, apply: true }, rt);
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(fs.readFileSync(rt.dataPath, 'utf8'));
    expect(data.perfumery_db[0].mol_xlogp3).toBe(2.97);
    expect(data.perfumery_db[0].mol_formula).toBe('C10H18O');
    expect(data.perfumery_db[0].data_provenance.last_fetched).toBe('2026-05-02');
  });

  it('--cid <known> single-material run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ json: makeBatchResponse([makePugRestProperty(6549)]) }))
    );
    const rt = runtime();
    const r = await main({ firstLayerOnly: true, cid: '6549' }, rt);
    expect(r.exitCode).toBe(0);
    expect(r.summary.total_materials).toBe(1);
    expect(r.summary.patched).toBe(1);
  });

  it('--missing-only filters to materials without mol_xlogp3', async () => {
    const rt = runtime({
      dataPath: writeFixture(
        tmp,
        makeFixtureDb([
          { cas: 'a', name: 'A', pubchem_cid: '1', mol_xlogp3: 5 }, // skipped
          { cas: 'b', name: 'B', pubchem_cid: '2' }, // included
        ])
      ),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ json: makeBatchResponse([makePugRestProperty(2)]) }))
    );
    const r = await main({ firstLayerOnly: true, missingOnly: true }, rt);
    expect(r.exitCode).toBe(0);
    expect(r.summary.total_materials).toBe(1);
    expect(Object.keys(r.patches)).toEqual(['b']);
  });

  it('--experimental on rerun: PUG-View cache hits, zero new network', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async url => {
      calls++;
      if (url.includes('/property/')) {
        return fakeResponse({
          json: makeBatchResponse([makePugRestProperty(6549), makePugRestProperty(8878)]),
        });
      }
      return fakeResponse({ json: makePugViewExperimental({ bp: 198 }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const rt = runtime();
    await main({ experimental: true }, rt);
    const callsAfterFirst = calls;
    expect(callsAfterFirst).toBeGreaterThan(0);
    const second = await main({ experimental: true }, rt);
    expect(calls).toBe(callsAfterFirst); // zero new fetches
    // first-layer cache (2) + experimental cache (2) all hit
    expect(second.summary.cache_hits).toBe(4);
    expect(second.summary.network_calls).toBe(0);
  });

  it('--experimental adds chem_* via PUG-View per CID', async () => {
    // First fetch = batch (PUG-REST), then per-CID PUG-View.
    let call = 0;
    const fetchMock = vi.fn(async url => {
      call++;
      if (url.includes('/property/')) {
        return fakeResponse({
          json: makeBatchResponse([makePugRestProperty(6549), makePugRestProperty(8878)]),
        });
      }
      // PUG-View
      return fakeResponse({ json: makePugViewExperimental({ bp: 198, density: 0.86 }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const rt = runtime();
    const r = await main({ experimental: true, apply: true }, rt);
    expect(r.exitCode).toBe(0);
    expect(call).toBeGreaterThanOrEqual(3); // 1 batch + 2 PUG-View
    const data = JSON.parse(fs.readFileSync(rt.dataPath, 'utf8'));
    expect(data.perfumery_db[0].chem_boiling_point_c).toBe(198);
    expect(data.perfumery_db[0].chem_density_g_ml).toBe(0.86);
    expect(data.perfumery_db[0].data_provenance.experimental_source).toBe('PubChem PUG-View');
  });

  it('CAS-fallback when material has no pubchem_cid', async () => {
    let call = 0;
    const fetchMock = vi.fn(async url => {
      call++;
      if (url.includes('/name/')) {
        return fakeResponse({ json: { IdentifierList: { CID: [9999] } } });
      }
      return fakeResponse({ json: makeBatchResponse([makePugRestProperty(9999)]) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const rt = runtime({
      dataPath: writeFixture(tmp, makeFixtureDb([{ cas: 'x-no-cid', name: 'Stub' }])),
    });
    const r = await main({ firstLayerOnly: true, apply: true }, rt);
    expect(r.exitCode).toBe(0);
    expect(r.summary.resolved).toBe(1);
    expect(call).toBe(2);
  });

  it('skips materials whose CAS is unknown to PubChem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ status: 404 }))
    );
    const rt = runtime({
      dataPath: writeFixture(tmp, makeFixtureDb([{ cas: 'unknown', name: 'X' }])),
    });
    const r = await main({ firstLayerOnly: true }, rt);
    expect(r.exitCode).toBe(0);
    expect(r.summary.skipped).toBe(1);
    expect(r.skipped[0].reason).toBe('pubchem-no-cid');
  });

  it('idempotency: re-run with cache populated → identical patches, zero network', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return fakeResponse({
          json: makeBatchResponse([makePugRestProperty(6549), makePugRestProperty(8878)]),
        });
      })
    );
    const rt = runtime();
    const first = await main({ firstLayerOnly: true }, rt);
    const callsAfterFirst = calls;
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(first.summary.cache_hits).toBe(0);
    const firstPatches = JSON.parse(fs.readFileSync(rt.patchPath, 'utf8')).patches;

    const second = await main({ firstLayerOnly: true }, rt);
    expect(calls).toBe(callsAfterFirst); // zero new fetches
    expect(second.summary.cache_hits).toBe(2);
    expect(second.summary.network_calls).toBe(0);
    // Patches block must be byte-identical (summary differs by design:
    // cache_hits / network_calls counts move).
    const secondPatches = JSON.parse(fs.readFileSync(rt.patchPath, 'utf8')).patches;
    expect(secondPatches).toEqual(firstPatches);
  });
});

// ── Network mock variants (per amendment #5) ─────────────────────────
describe('network behaviour through main()', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-net-'));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function runtime() {
    return {
      dataPath: writeFixture(
        tmp,
        makeFixtureDb([{ cas: '78-70-6', name: 'Linalool', pubchem_cid: '6549' }])
      ),
      cacheDir: path.join(tmp, 'cache'),
      patchPath: path.join(tmp, 'patches.json'),
      now: () => '2026-05-02',
      fetchOpts: FAST_OPTS,
    };
  }

  it('success: 200 OK → patched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ json: makeBatchResponse([makePugRestProperty(6549)]) }))
    );
    const r = await main({ firstLayerOnly: true }, runtime());
    expect(r.summary.patched).toBe(1);
  });

  it('503 retry → recovers on second call', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ status: 503 }))
      .mockResolvedValueOnce(
        fakeResponse({ json: makeBatchResponse([makePugRestProperty(6549)]) })
      );
    vi.stubGlobal('fetch', fetchMock);
    const r = await main(
      { firstLayerOnly: true },
      { ...runtime(), fetchOpts: { retries: 3, errorBackoffMs: 1, rateLimitBackoffBaseMs: 1 } }
    );
    expect(r.summary.patched).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('404 on batch → empty patches, no crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ status: 404 }))
    );
    const r = await main({ firstLayerOnly: true }, runtime());
    expect(r.exitCode).toBe(0);
    expect(r.summary.patched).toBe(0);
  });

  it('malformed JSON → throw caught by CLI wrapper, surfaced as error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ throwOnJson: true }))
    );
    await expect(
      main({ firstLayerOnly: true }, { ...runtime(), fetchOpts: { retries: 1, errorBackoffMs: 1 } })
    ).rejects.toThrow(/malformed JSON/);
  });
});
