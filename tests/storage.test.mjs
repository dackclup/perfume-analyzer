import { describe, it, expect, beforeEach } from 'vitest';

// Audit-r2 Tier 3 (F2): unit-cover the storage helpers so the
// "graceful in 6 cases" property the audit confirmed during Phase A
// (the smoke test) is locked in by automated regression.

// In-memory localStorage polyfill installed before each test. The
// helpers in lib/storage.mjs are written against the standard
// localStorage shape, so a faithful polyfill is enough.
function installLocalStorage(impl) {
  globalThis.localStorage = impl;
}
function makeWorkingLs() {
  const store = {};
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: k => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    _store: store, // exposed for assertions
  };
}
function makeThrowingLs(errMsg = 'private mode') {
  return {
    getItem: () => {
      throw new Error(errMsg);
    },
    setItem: () => {
      throw new Error(errMsg);
    },
    removeItem: () => {
      throw new Error(errMsg);
    },
    clear: () => {
      throw new Error(errMsg);
    },
  };
}

// Module imports happen ONCE, but the helpers read globalThis.localStorage
// at CALL time, so swapping the polyfill between tests is enough to drive
// each scenario without re-importing the module.
globalThis.window = { appUtils: {} };
const { lsRead, lsWrite, lsRemove, lsGetString, lsSetString } = await import('../lib/storage.mjs');

beforeEach(() => {
  installLocalStorage(makeWorkingLs());
});

describe('lsRead', () => {
  it('returns the parsed JSON when the key is present and valid', () => {
    localStorage.setItem('k', JSON.stringify({ a: 1 }));
    expect(lsRead('k')).toEqual({ a: 1 });
  });

  it('returns the default when the key is missing', () => {
    expect(lsRead('missing', 'default-value')).toBe('default-value');
    expect(lsRead('missing', [])).toEqual([]);
    expect(lsRead('missing')).toBe(null);
  });

  it('returns the default when the payload is corrupt JSON', () => {
    localStorage.setItem('k', '{not-json');
    expect(lsRead('k', { fallback: true })).toEqual({ fallback: true });
  });

  it('returns the default when the validator rejects the shape', () => {
    localStorage.setItem('k', JSON.stringify({ wrong: 'shape' }));
    expect(lsRead('k', [], Array.isArray)).toEqual([]);
  });

  it('returns the parsed value when the validator accepts it', () => {
    localStorage.setItem('k', JSON.stringify(['a', 'b']));
    expect(lsRead('k', [], Array.isArray)).toEqual(['a', 'b']);
  });

  it('returns the default when localStorage.getItem throws (private-mode)', () => {
    installLocalStorage(makeThrowingLs());
    expect(lsRead('any', 'graceful')).toBe('graceful');
  });
});

describe('lsWrite', () => {
  it('persists JSON-encoded payloads', () => {
    expect(lsWrite('k', [1, 2, 3])).toBe(true);
    expect(localStorage.getItem('k')).toBe('[1,2,3]');
  });

  it('returns false (no throw) when localStorage rejects (quota)', () => {
    installLocalStorage(makeThrowingLs('QuotaExceededError'));
    expect(lsWrite('k', { x: 1 })).toBe(false);
  });

  it('returns false on serialization cycle without throwing', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    expect(lsWrite('k', cyclic)).toBe(false);
  });
});

describe('lsRemove', () => {
  it('returns true after removing an existing key', () => {
    localStorage.setItem('k', '"x"');
    expect(lsRemove('k')).toBe(true);
    expect(localStorage.getItem('k')).toBe(null);
  });

  it('returns true even when the key is absent', () => {
    expect(lsRemove('never-existed')).toBe(true);
  });

  it('returns false when localStorage throws', () => {
    installLocalStorage(makeThrowingLs());
    expect(lsRemove('k')).toBe(false);
  });
});

describe('lsGetString / lsSetString', () => {
  it('round-trips a plain string without JSON encoding', () => {
    expect(lsSetString('k', 'plain')).toBe(true);
    expect(localStorage.getItem('k')).toBe('plain');
    expect(lsGetString('k')).toBe('plain');
  });

  it('lsGetString returns the default when the key is absent', () => {
    expect(lsGetString('missing', 'fallback')).toBe('fallback');
    expect(lsGetString('missing')).toBe(null);
  });

  it('lsGetString returns the default when localStorage throws', () => {
    installLocalStorage(makeThrowingLs());
    expect(lsGetString('any', 'fallback')).toBe('fallback');
  });

  it('lsSetString returns false when localStorage throws', () => {
    installLocalStorage(makeThrowingLs());
    expect(lsSetString('k', 'v')).toBe(false);
  });
});
