import { describe, it, expect } from 'vitest';
import { buildEnriched, buildFamilyAxes } from '../lib/material-shape.mjs';

// Audit-r2 Tier 3 (F2): unit-cover the canonical material-shape
// builder so any future change to the 19-field enriched object is
// visible in test diff. Round 1 added this module but only
// dom-utils had test coverage.

describe('buildEnriched', () => {
  it('returns a 21-key object with the canonical field set', () => {
    const entry = { cas: '78-70-6', name: 'Linalool' };
    const enriched = buildEnriched(entry);
    expect(Object.keys(enriched).sort()).toEqual(
      [
        'blends_with',
        'boiling_point',
        'cas',
        'density',
        'facets',
        'functions',
        'ifra_guideline',
        'molecular_weight',
        'name',
        'note',
        'odor_description',
        'odor_strength',
        'odor_type',
        'primaryFamilies',
        'regulatory',
        'secondaryFamilies',
        'smiles',
        'tenacity',
        'tenacity_hours',
        'usage_levels',
        'xlogp',
      ].sort()
    );
  });

  it('falls back to MATERIAL_PROPERTIES (mp arg) when DB row lacks a field', () => {
    const entry = { cas: '78-70-6', name: 'Linalool' };
    const mp = { mw: 154.25, density: 0.86, logP: 2.97, bp: 198, smiles: 'CC(C)=CCCC(C)(O)C=C' };
    const enriched = buildEnriched(entry, mp);
    expect(enriched.molecular_weight).toBe(154.25);
    expect(enriched.density).toBe(0.86);
    expect(enriched.xlogp).toBe(2.97);
    expect(enriched.boiling_point).toBe(198);
    expect(enriched.smiles).toBe('CC(C)=CCCC(C)(O)C=C');
  });

  it('prefers entry fields over the mp fallback', () => {
    const entry = {
      cas: '78-70-6',
      name: 'Linalool',
      weight: '154.25',
      density: 0.85,
      xlogp: '2.97',
      boiling_point: 198,
      smiles: 'CC(C)=CCCC(C)(O)C=C',
    };
    const mp = { mw: 999, density: 999, logP: 999, bp: 999, smiles: 'WRONG' };
    const enriched = buildEnriched(entry, mp);
    expect(enriched.molecular_weight).toBe(154.25);
    expect(enriched.density).toBe(0.85);
    expect(enriched.xlogp).toBe(2.97);
    expect(enriched.boiling_point).toBe(198);
    expect(enriched.smiles).toBe('CC(C)=CCCC(C)(O)C=C');
  });

  it('preserves classification arrays (the C3.2/C3.3 audit-1 fix)', () => {
    const entry = {
      cas: '78-70-6',
      name: 'Linalool',
      classification: {
        primaryFamilies: ['floral'],
        secondaryFamilies: ['herbal'],
        facets: ['fresh', 'lily'],
        functions: ['top'],
        regulatory: ['allergen'],
      },
    };
    const enriched = buildEnriched(entry);
    expect(enriched.primaryFamilies).toEqual(['floral']);
    expect(enriched.secondaryFamilies).toEqual(['herbal']);
    expect(enriched.facets).toEqual(['fresh', 'lily']);
    expect(enriched.functions).toEqual(['top']);
    expect(enriched.regulatory).toEqual(['allergen']);
  });

  it('defaults missing classification to empty arrays', () => {
    const entry = { cas: '78-70-6', name: 'Linalool' };
    const enriched = buildEnriched(entry);
    expect(enriched.primaryFamilies).toEqual([]);
    expect(enriched.secondaryFamilies).toEqual([]);
    expect(enriched.facets).toEqual([]);
    expect(enriched.functions).toEqual([]);
    expect(enriched.regulatory).toEqual([]);
  });

  it("note defaults to '' when entry.note is null/undefined", () => {
    expect(buildEnriched({ cas: 'x', name: 'y' }).note).toBe('');
    expect(buildEnriched({ cas: 'x', name: 'y', note: null }).note).toBe('');
    expect(buildEnriched({ cas: 'x', name: 'y', note: 'Top' }).note).toBe('Top');
  });

  it('flattens nested odor / performance / safety into top-level fields', () => {
    const entry = {
      cas: 'x',
      name: 'y',
      odor: { type: 'fresh', strength: 'medium', description: 'green floral' },
      performance: { tenacity: 'short', duration: '2-4 h' },
      safety: { ifra: 'restricted Cat.5', usage: '0.1%' },
    };
    const enriched = buildEnriched(entry);
    expect(enriched.odor_type).toBe('fresh');
    expect(enriched.odor_strength).toBe('medium');
    expect(enriched.odor_description).toBe('green floral');
    expect(enriched.tenacity).toBe('short');
    expect(enriched.tenacity_hours).toBe('2-4 h');
    expect(enriched.ifra_guideline).toBe('restricted Cat.5');
    expect(enriched.usage_levels).toBe('0.1%');
  });

  it('handles density: 0 correctly (entry.density != null check)', () => {
    // density of exactly 0 would fall to mp.density under a `||` check.
    // The implementation uses `!= null` so explicit zero is preserved.
    const entry = { cas: 'x', name: 'y', density: 0 };
    const mp = { density: 999 };
    expect(buildEnriched(entry, mp).density).toBe(0);
  });
});

describe('buildFamilyAxes', () => {
  it('projects only the four axis fields', () => {
    const entry = {
      cas: 'x',
      name: 'y',
      odor: { type: 'fresh' },
      classification: {
        primaryFamilies: ['floral'],
        secondaryFamilies: ['herbal'],
        facets: ['fresh'],
        // functions / regulatory excluded by design
        functions: ['top'],
      },
    };
    const axes = buildFamilyAxes(entry);
    expect(Object.keys(axes).sort()).toEqual([
      'facets',
      'odor_type',
      'primaryFamilies',
      'secondaryFamilies',
    ]);
  });

  it('handles a null entry without throwing', () => {
    const axes = buildFamilyAxes(null);
    expect(axes).toEqual({
      odor_type: null,
      primaryFamilies: [],
      secondaryFamilies: [],
      facets: [],
    });
  });

  it('handles missing classification', () => {
    const axes = buildFamilyAxes({ cas: 'x', name: 'y' });
    expect(axes.primaryFamilies).toEqual([]);
    expect(axes.secondaryFamilies).toEqual([]);
    expect(axes.facets).toEqual([]);
  });
});
