import { describe, it, expect } from 'vitest';
import {
  csvEscape,
  arcPath,
  STEREO_ALIAS,
  buildStereoGroups,
  resolveIFRAParent,
  cleanOdorDescription,
  normalizeRegulatoryToken,
  REGULATORY_LEGACY_ALIASES
} from '../lib/utils.mjs';

describe('csvEscape', () => {
  it('passes plain strings through unchanged', () => {
    expect(csvEscape('linalool')).toBe('linalool');
    expect(csvEscape('Aroma Chemical')).toBe('Aroma Chemical');
  });

  it('quotes fields containing a comma', () => {
    expect(csvEscape('Top, Middle, Base')).toBe('"Top, Middle, Base"');
  });

  it('doubles internal quotes when wrapping', () => {
    expect(csvEscape('"sweet" floral')).toBe('"""sweet"" floral"');
  });

  it('quotes fields with newlines and carriage returns', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('a\rb')).toBe('"a\rb"');
  });

  it('coerces null and undefined to empty string', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('coerces non-strings via String()', () => {
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape(true)).toBe('true');
  });
});

describe('arcPath', () => {
  it('produces a closed donut segment with two arcs and a Z', () => {
    const path = arcPath(100, 100, 50, 100, 0, 90);
    expect(path).toMatch(/^M /);
    expect(path).toMatch(/ Z$/);
    // Two arc commands — outer (clockwise) + inner (counter-clockwise).
    const arcCount = (path.match(/ A /g) || []).length;
    expect(arcCount).toBe(2);
    // Sweep flags: outer 1 (clockwise), inner 0 (counter-clockwise).
    expect(path).toMatch(/0 0 1 /);
    expect(path).toMatch(/0 0 0 /);
  });

  it('encodes large-arc flag for sweeps over 180 degrees', () => {
    const big = arcPath(0, 0, 10, 50, 0, 270);
    expect(big).toMatch(/0 1 1 /); // largeArc=1, sweep=1 on outer
    expect(big).toMatch(/0 1 0 /); // largeArc=1, sweep=0 on inner
  });

  it('treats 0 degrees as 12 o\'clock, increasing clockwise', () => {
    // At 0°, x = cx, y = cy - rOut.
    const path = arcPath(50, 50, 10, 30, 0, 90);
    // First M token x1 should equal cx (50), y1 should equal cy - rOut (50 - 30 = 20).
    const m = path.match(/^M (\S+) (\S+)/);
    expect(Number(m[1])).toBeCloseTo(50, 5);
    expect(Number(m[2])).toBeCloseTo(20, 5);
  });
});

describe('STEREO_ALIAS / buildStereoGroups / resolveIFRAParent', () => {
  it('every variant resolves to a parent', () => {
    for (const [variant, parent] of Object.entries(STEREO_ALIAS)) {
      expect(resolveIFRAParent(variant)).toBe(parent);
    }
  });

  it('parent CAS resolves to itself', () => {
    expect(resolveIFRAParent('78-70-6')).toBe('78-70-6');
    expect(resolveIFRAParent('5989-27-5')).toBe('5989-27-5');
  });

  it('unknown CAS passes through unchanged', () => {
    expect(resolveIFRAParent('999-99-9')).toBe('999-99-9');
  });

  it('group index links every variant to its peers (including parent)', () => {
    const groups = buildStereoGroups();
    const linaloolGroup = groups['126-91-0'];
    expect(linaloolGroup).toBeInstanceOf(Set);
    expect(linaloolGroup.has('78-70-6')).toBe(true);
    expect(linaloolGroup.has('126-90-9')).toBe(true);
    expect(linaloolGroup.has('126-91-0')).toBe(true);
  });

  it('parent CAS shares the same group set as its variants', () => {
    const groups = buildStereoGroups();
    expect(groups['78-70-6']).toBe(groups['126-91-0']);
  });

  it('unrelated CAS has no entry in the group index', () => {
    const groups = buildStereoGroups();
    expect(groups['999-99-9']).toBeUndefined();
  });
});

describe('cleanOdorDescription', () => {
  it('strips a trailing function-word suffix', () => {
    expect(cleanOdorDescription('Sweet, balsamic — mainly fixative')).toBe('Sweet, balsamic');
  });

  it('handles slash and ampersand separators', () => {
    expect(cleanOdorDescription('Mild — solvent/fixative')).toBe('Mild');
    expect(cleanOdorDescription('Fresh — fixative & solvent')).toBe('Fresh');
  });

  it('handles "used as" and "acts as" prefixes', () => {
    expect(cleanOdorDescription('Sweet — used as solvent')).toBe('Sweet');
    expect(cleanOdorDescription('Floral — acts as fixative')).toBe('Floral');
  });

  it('leaves descriptions without a trailing function word alone', () => {
    expect(cleanOdorDescription('Top citrus, fresh')).toBe('Top citrus, fresh');
  });

  it('returns falsy input unchanged', () => {
    expect(cleanOdorDescription('')).toBe('');
    expect(cleanOdorDescription(null)).toBe(null);
    expect(cleanOdorDescription(undefined)).toBe(undefined);
  });
});

describe('normalizeRegulatoryToken', () => {
  it('returns the canonical key for legacy aliases', () => {
    for (const [legacy, canon] of Object.entries(REGULATORY_LEGACY_ALIASES)) {
      expect(normalizeRegulatoryToken(legacy)).toBe(canon);
    }
  });

  it('lowercases and trims unknown tokens', () => {
    expect(normalizeRegulatoryToken(' BANNED ')).toBe('banned');
    expect(normalizeRegulatoryToken('Restricted')).toBe('restricted');
  });

  it('passes already-canonical tokens through', () => {
    expect(normalizeRegulatoryToken('banned')).toBe('banned');
    expect(normalizeRegulatoryToken('regulated')).toBe('regulated');
  });

  it('returns falsy input unchanged', () => {
    expect(normalizeRegulatoryToken('')).toBe('');
    expect(normalizeRegulatoryToken(null)).toBe(null);
  });
});
