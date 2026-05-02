import { describe, it, expect } from 'vitest';
import { escHtml, debounce, normaliseMaterialKey } from '../lib/dom-utils.mjs';

describe('escHtml (lib/dom-utils)', () => {
  it('returns empty string for null/undefined only', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });
  it('preserves 0/false/empty string as their string form', () => {
    expect(escHtml(0)).toBe('0');
    expect(escHtml(false)).toBe('false');
    expect(escHtml('')).toBe('');
  });
  it('escapes the apostrophe (defence-in-depth for single-quoted attrs)', () => {
    expect(escHtml("O'Reilly")).toBe('O&#39;Reilly');
  });
  it('escapes the standard four entities', () => {
    expect(escHtml('<a href="x">&y</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;y&lt;/a&gt;');
  });
});

describe('normaliseMaterialKey', () => {
  it('collapses Greek-letter prefixes to their Latin equivalents', () => {
    expect(normaliseMaterialKey('γ-Decalactone')).toBe(normaliseMaterialKey('gamma-Decalactone'));
    expect(normaliseMaterialKey('α-Pinene')).toBe(normaliseMaterialKey('alpha-Pinene'));
    expect(normaliseMaterialKey('β-Ionone')).toBe(normaliseMaterialKey('beta-Ionone'));
  });
  it('normalises smart quotes and em-dashes', () => {
    expect(normaliseMaterialKey('d–Limonene')).toBe(normaliseMaterialKey('d-Limonene'));
    expect(normaliseMaterialKey('O’Reilly')).toBe(normaliseMaterialKey("O'Reilly"));
  });
  it('lowercases and trims', () => {
    expect(normaliseMaterialKey('  HEDIONE  ')).toBe('hedione');
  });
  it('returns empty string for null/undefined', () => {
    expect(normaliseMaterialKey(null)).toBe('');
    expect(normaliseMaterialKey(undefined)).toBe('');
  });
});

describe('debounce', () => {
  it('exposes cancel and flush on the returned function', () => {
    const fn = debounce(() => {}, 50);
    expect(typeof fn.cancel).toBe('function');
    expect(typeof fn.flush).toBe('function');
  });
  it('coalesces multiple calls within the delay window', async () => {
    let calls = 0;
    const fn = debounce(() => {
      calls++;
    }, 30);
    fn();
    fn();
    fn();
    expect(calls).toBe(0);
    await new Promise(r => setTimeout(r, 60));
    expect(calls).toBe(1);
  });
});
