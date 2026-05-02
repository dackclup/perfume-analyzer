#!/usr/bin/env node
// tools/check-pubchem.mjs — CAS-CID cross-validation against PubChem REST.
//
// Audit-r2 Tier 3 (D5 systemic). Phase D found 2 of 10 sampled rows
// had wrong pubchem_cid (Triplal, Ethylene Brassylate). This CLI runs
// the same check on demand so future audits don't have to redo it by
// hand.
//
// Usage:
//   node tools/check-pubchem.mjs                  # 20 random rows, throttled 5/s
//   node tools/check-pubchem.mjs --sample 50      # bigger sweep
//   node tools/check-pubchem.mjs --cas 78-70-6    # one row only
//   node tools/check-pubchem.mjs --all            # every row (slow! ~20 min)
//   node tools/check-pubchem.mjs --json           # machine-readable
//
// NOT in CI by default — PubChem rate-limits at 5 req/s and a full
// sweep of 624 rows takes ~2 minutes plus retry budget. Run before
// each release as a periodic verification.
//
// Output:
//   ✓ <CAS>  <DB-name>  cid=<value> matches PubChem
//   ✗ <CAS>  <DB-name>  cid=<DB> ≠ <PubChem-resolved CIDs>
//
// Exit codes:
//   0 — all checked rows match
//   1 — at least one mismatch (CI gate when wired)
//   2 — usage error
//   3 — every PubChem call failed (network down → don't fail the gate)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep, pubchemCidsForCas, RATE_LIMIT_MS } from './lib/pubchem.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  return args[i + 1] || null;
};
const has = name => args.includes(name);

const SAMPLE_N = parseInt(flag('--sample') || '20', 10);
const SINGLE_CAS = flag('--cas');
const ALL = has('--all');
const JSON_OUT = has('--json');

const data = JSON.parse(fs.readFileSync(path.join(REPO, 'data/materials.json'), 'utf8'));
const db = data.perfumery_db;

// ── Pick rows ────────────────────────────────────────────────────────
function pickRows() {
  if (SINGLE_CAS) {
    const r = db.find(x => x.cas === SINGLE_CAS);
    if (!r) {
      console.error(`[check-pubchem] CAS ${SINGLE_CAS} not in DB`);
      process.exit(2);
    }
    return [r];
  }
  // Skip mixtures and rows without a pubchem_cid — this CLI checks
  // single-molecule entries only. The mixture_cas list is in the JSON
  // top-level for exactly that filter.
  const mixtures = new Set(data.mixture_cas || []);
  const eligible = db.filter(r => r.cas && r.pubchem_cid && !mixtures.has(r.cas));
  if (ALL) return eligible;
  // Deterministic sample: hash cas → keep N smallest.
  const sorted = [...eligible].sort((a, b) => hashCas(a.cas).localeCompare(hashCas(b.cas)));
  return sorted.slice(0, SAMPLE_N);
}
function hashCas(cas) {
  // Cheap deterministic shuffle so successive runs sweep different rows.
  // Seed with the file's mtime-day so day-over-day samples differ.
  const day = Math.floor(Date.now() / 86_400_000).toString();
  let h = 0;
  for (const ch of day + cas) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

// ── PubChem fetch with throttle + retry ───────────────────────────────
// Round 3 P1.2: extracted to tools/lib/pubchem.mjs so enrich-molecular
// + future tooling reuse the same throttler / retry / parser. This
// CLI keeps its same behaviour: RATE_LIMIT_MS spacing between calls,
// 3 attempts, 2s exponential backoff on 429, 1s backoff on transient
// errors, 404 → empty array.

// ── Run ──────────────────────────────────────────────────────────────
const rows = pickRows();
if (!JSON_OUT) {
  console.error(
    `[check-pubchem] checking ${rows.length} row(s) (sample=${SAMPLE_N}${ALL ? ', all' : ''})`
  );
}

const results = [];
let netFailures = 0;
for (const [i, r] of rows.entries()) {
  if (i > 0) await sleep(RATE_LIMIT_MS);
  const expected = String(r.pubchem_cid);
  let resolved = null;
  let netFail = false;
  try {
    resolved = await pubchemCidsForCas(r.cas);
  } catch (e) {
    netFail = true;
    netFailures++;
    if (!JSON_OUT) console.error(`! ${r.cas}  ${r.name}  network-error: ${e.message}`);
  }
  const match = resolved && resolved.map(String).includes(expected);
  const out = {
    cas: r.cas,
    name: r.name,
    db_cid: expected,
    pubchem_cids: resolved,
    match,
    netFail,
  };
  results.push(out);
  if (!JSON_OUT && !netFail) {
    if (match) console.log(`✓ ${r.cas}  ${r.name}  cid=${expected}`);
    else console.log(`✗ ${r.cas}  ${r.name}  cid=${expected} ≠ ${JSON.stringify(resolved)}`);
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ checked: rows.length, results }, null, 2));
} else {
  const mismatches = results.filter(r => !r.match && !r.netFail);
  console.log('');
  console.log(
    `Summary: ${results.length - mismatches.length - netFailures} match, ${mismatches.length} mismatch, ${netFailures} network error`
  );
  for (const m of mismatches) {
    console.log(
      `  ${m.cas} ${m.name} — DB ${m.db_cid} vs PubChem ${JSON.stringify(m.pubchem_cids)}`
    );
  }
}

if (netFailures === results.length && netFailures > 0) {
  // Total network failure — don't fail the gate for offline runs.
  process.exit(3);
}
const mismatchCount = results.filter(r => !r.match && !r.netFail).length;
process.exit(mismatchCount > 0 ? 1 : 0);
