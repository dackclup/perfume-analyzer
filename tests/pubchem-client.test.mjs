import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Round 3 P1.2: unit-cover the reusable PubChem client extracted into
// tools/lib/pubchem.mjs. The lib is the foundation for tools/enrich-
// molecular.mjs (P1.3); contracts must be locked before that script
// is built.

import {
  RATE_LIMIT_MS,
  sleep,
  pubchemFetchJson,
  pubchemCidsForCas,
  pubchemBatchProperty,
  pubchemExperimentalView,
  cachePath,
  cacheRead,
  cacheWrite,
  DEFAULT_CACHE_DIR,
} from '../tools/lib/pubchem.mjs';

// Helper: mint a fake fetch response.
function fakeResponse({ status = 200, json = {}, throwOnJson = false }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => (throwOnJson ? Promise.reject(new Error('malformed JSON')) : Promise.resolve(json)),
  };
}

describe('module constants', () => {
  it('exports RATE_LIMIT_MS = 220 (≤5 req/s with margin)', () => {
    expect(RATE_LIMIT_MS).toBe(220);
  });

  it('exports DEFAULT_CACHE_DIR pointing into the repo audit/cache tree', () => {
    expect(DEFAULT_CACHE_DIR.endsWith(path.join('audit', 'cache'))).toBe(true);
  });
});

describe('sleep', () => {
  it('resolves after at least the requested delay', async () => {
    const t0 = Date.now();
    await sleep(20);
    const dt = Date.now() - t0;
    // 5ms slack accommodates timer jitter on slow CI.
    expect(dt).toBeGreaterThanOrEqual(15);
  });
});

describe('pubchemFetchJson', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses well-formed 200 response', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ json: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await pubchemFetchJson('https://example/x');
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Accept: 'application/json' } });
  });

  it('returns null on 404 (PubChem "not found" sentinel)', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await pubchemFetchJson('https://example/missing');
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 (transient error path) and succeeds on second attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ status: 503 }))
      .mockResolvedValueOnce(fakeResponse({ json: { recovered: true } }));
    vi.stubGlobal('fetch', fetchMock);
    // Tighten error backoff so the test doesn't wait 1s.
    const result = await pubchemFetchJson('https://example/flaky', { errorBackoffMs: 5 });
    expect(result).toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 (rate-limit path) with backoff and recovers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ status: 429 }))
      .mockResolvedValueOnce(fakeResponse({ json: { ok: 1 } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await pubchemFetchJson('https://example/throttled', {
      rateLimitBackoffBaseMs: 5,
    });
    expect(result).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rethrows after exhausting retries on persistent error', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      pubchemFetchJson('https://example/down', { retries: 3, errorBackoffMs: 1 })
    ).rejects.toThrow('HTTP 500');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('handles malformed JSON by retrying then rethrowing', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ throwOnJson: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      pubchemFetchJson('https://example/bad-json', { retries: 2, errorBackoffMs: 1 })
    ).rejects.toThrow('malformed JSON');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when all attempts exit via 429 (soft give-up)', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await pubchemFetchJson('https://example/forever-429', {
      retries: 2,
      rateLimitBackoffBaseMs: 1,
    });
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('pubchemCidsForCas', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns CID list from a well-formed response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ json: { IdentifierList: { CID: [6549, 12] } } }))
    );
    const cids = await pubchemCidsForCas('78-70-6');
    expect(cids).toEqual([6549, 12]);
  });

  it('returns [] on 404 (CAS unknown to PubChem)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ status: 404 }))
    );
    expect(await pubchemCidsForCas('999-99-9')).toEqual([]);
  });

  it('URL-encodes CAS in the request URL', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ json: { IdentifierList: { CID: [1] } } }));
    vi.stubGlobal('fetch', fetchMock);
    await pubchemCidsForCas('78-70-6');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/78-70-6/cids/JSON'
    );
  });

  it('returns [] when the response has no IdentifierList', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ json: {} }))
    );
    expect(await pubchemCidsForCas('78-70-6')).toEqual([]);
  });
});

describe('pubchemBatchProperty', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses Properties array from a well-formed batch response', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({
        json: {
          PropertyTable: {
            Properties: [
              { CID: 6549, MolecularWeight: '154.25', XLogP: 2.97 },
              { CID: 12, MolecularWeight: '78.11', XLogP: 1.5 },
            ],
          },
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const props = await pubchemBatchProperty([6549, 12], ['MolecularWeight', 'XLogP']);
    expect(props).toHaveLength(2);
    expect(props[0]).toEqual({ CID: 6549, MolecularWeight: '154.25', XLogP: 2.97 });
    // URL contains both CIDs and both properties.
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('/cid/6549,12/');
    expect(url).toContain('/property/MolecularWeight,XLogP/');
  });

  it('returns [] for an empty cid array without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await pubchemBatchProperty([], ['MolecularWeight'])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when propertyList is empty (caller misuse)', async () => {
    await expect(pubchemBatchProperty([1], [])).rejects.toThrow(/propertyList required/);
  });

  it('returns [] on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ status: 404 }))
    );
    expect(await pubchemBatchProperty([1], ['MolecularWeight'])).toEqual([]);
  });
});

describe('pubchemExperimentalView', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the raw JSON payload', async () => {
    const payload = { Record: { RecordType: 'CID', RecordNumber: 6549 } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ json: payload }))
    );
    expect(await pubchemExperimentalView(6549)).toEqual(payload);
  });

  it('hits the PUG-View endpoint (not PUG-REST)', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ json: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await pubchemExperimentalView(6549);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/6549/JSON'
    );
  });

  it('returns null on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ status: 404 }))
    );
    expect(await pubchemExperimentalView(99999999)).toBeNull();
  });
});

describe('cache I/O (cachePath / cacheRead / cacheWrite)', () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pubchem-cache-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('cachePath layout: <baseDir>/pubchem-<layer>/<cid>.json', () => {
    const p = cachePath(6549, 'first-layer', tmp);
    expect(p).toBe(path.join(tmp, 'pubchem-first-layer', '6549.json'));
  });

  it('cacheRead returns null when the entry is missing', () => {
    expect(cacheRead(6549, 'first-layer', tmp)).toBeNull();
  });

  it('round-trips JSON via cacheWrite + cacheRead', () => {
    const payload = { CID: 6549, MolecularWeight: '154.25', XLogP: 2.97 };
    cacheWrite(6549, 'first-layer', payload, tmp);
    expect(cacheRead(6549, 'first-layer', tmp)).toEqual(payload);
  });

  it('cacheWrite creates the layer directory if absent', () => {
    cacheWrite(123, 'experimental', { Record: {} }, tmp);
    const exists = fs.existsSync(path.join(tmp, 'pubchem-experimental', '123.json'));
    expect(exists).toBe(true);
  });

  it('cacheRead returns null when the cached file is corrupt JSON', () => {
    const layerDir = path.join(tmp, 'pubchem-first-layer');
    fs.mkdirSync(layerDir, { recursive: true });
    fs.writeFileSync(path.join(layerDir, '999.json'), '{not-json');
    expect(cacheRead(999, 'first-layer', tmp)).toBeNull();
  });

  it('different layers do not collide for the same CID', () => {
    cacheWrite(6549, 'first-layer', { layer: 'A' }, tmp);
    cacheWrite(6549, 'experimental', { layer: 'B' }, tmp);
    expect(cacheRead(6549, 'first-layer', tmp)).toEqual({ layer: 'A' });
    expect(cacheRead(6549, 'experimental', tmp)).toEqual({ layer: 'B' });
  });
});
