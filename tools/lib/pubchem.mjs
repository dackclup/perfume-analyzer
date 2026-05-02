// tools/lib/pubchem.mjs — reusable PubChem REST client.
//
// Round 3 P1.2: extracted from tools/check-pubchem.mjs so the
// throttler, retry, and CAS→CID resolution are shared with the new
// tools/enrich-molecular.mjs (P1.3) and any future PubChem-aware
// tooling. The module also adds:
//   - pubchemBatchProperty(cids, propertyList)  — PUG-REST batch
//     compound-property lookup (used by enrich-molecular's first-layer
//     pass for up to 50 CIDs per call).
//   - pubchemExperimentalView(cid)              — PUG-View per-CID
//     "Experimental Properties" payload (slow, optional second pass).
//   - cacheRead / cacheWrite / cachePath        — disk cache I/O so
//     re-runs are deterministic and offline-friendly.
//
// PubChem rate-limit policy: max 5 req/s, 400/min. RATE_LIMIT_MS=220
// keeps us under both. Callers are responsible for spacing successive
// calls (await sleep(RATE_LIMIT_MS) between requests); this lib does
// not enforce throttling internally so a caller batching CIDs can
// throttle once per batch instead of once per CID.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

export const RATE_LIMIT_MS = 220;
export const DEFAULT_CACHE_DIR = path.join(REPO, 'audit', 'cache');

export const PUBCHEM_REST = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
export const PUBCHEM_VIEW = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view';

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Throttled-friendly JSON fetch with retry. Behaviour preserves the
// original tools/check-pubchem.mjs semantics:
//   - 404 → returns null (sentinel for "not in PubChem")
//   - 429 → backoff = rateLimitBackoffBaseMs * (attempt+1), retry
//   - other non-OK → throw 'HTTP <status>' → caught → errorBackoffMs,
//     retry up to `retries` total attempts (this includes 503 paths).
//   - JSON parse errors / network errors → caught → errorBackoffMs,
//     retry. Final attempt rethrows.
//   - Exhausted via 429 retries only → returns null (caller treats as
//     "no data this round" rather than throwing).
export async function pubchemFetchJson(url, opts = {}) {
  const { retries = 3, rateLimitBackoffBaseMs = 2000, errorBackoffMs = 1000 } = opts;
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (r.status === 404) return null;
      if (r.status === 429) {
        await sleep(rateLimitBackoffBaseMs * (attempt + 1));
        continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (attempt === retries - 1) throw e;
      await sleep(errorBackoffMs);
    }
  }
  // All attempts exited via the 429 path — treat as "give up softly".
  void lastErr;
  return null;
}

export async function pubchemCidsForCas(cas, opts) {
  const url = `${PUBCHEM_REST}/compound/name/${encodeURIComponent(cas)}/cids/JSON`;
  const j = await pubchemFetchJson(url, opts);
  if (!j) return [];
  return j?.IdentifierList?.CID || [];
}

// PUG-REST batch property fetch. The API accepts up to 100 CIDs per
// URL but the spec recommends ≤50 for stability. Caller is responsible
// for chunking. Returns the Properties[] array (one entry per CID) or
// [] on 404 / soft failure.
export async function pubchemBatchProperty(cids, propertyList, opts) {
  if (!cids || cids.length === 0) return [];
  if (!propertyList || propertyList.length === 0) {
    throw new Error('pubchemBatchProperty: propertyList required');
  }
  const cidStr = cids.join(',');
  const props = propertyList.join(',');
  const url = `${PUBCHEM_REST}/compound/cid/${cidStr}/property/${props}/JSON`;
  const j = await pubchemFetchJson(url, opts);
  if (!j) return [];
  return j?.PropertyTable?.Properties || [];
}

// PUG-View per-CID — returns the full record JSON, or null on 404 /
// soft failure. Callers parse out the "Experimental Properties"
// section themselves (the layout varies per record).
export async function pubchemExperimentalView(cid, opts) {
  const url = `${PUBCHEM_VIEW}/data/compound/${cid}/JSON`;
  return await pubchemFetchJson(url, opts);
}

// ── Disk cache ────────────────────────────────────────────────────────
// Layout: <baseDir>/pubchem-<layer>/<cid>.json. Layers are conventional
// ('first-layer' for PUG-REST property batches, 'experimental' for
// PUG-View) but any string is accepted — the lib only owns I/O.

export function cachePath(cid, layer, baseDir = DEFAULT_CACHE_DIR) {
  return path.join(baseDir, `pubchem-${layer}`, `${cid}.json`);
}

export function cacheRead(cid, layer, baseDir = DEFAULT_CACHE_DIR) {
  const p = cachePath(cid, layer, baseDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // Corrupt cache entry — treat as miss so the caller can re-fetch.
    return null;
  }
}

export function cacheWrite(cid, layer, json, baseDir = DEFAULT_CACHE_DIR) {
  const p = cachePath(cid, layer, baseDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(json, null, 2));
}
