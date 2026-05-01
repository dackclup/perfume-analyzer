#!/usr/bin/env node
// scripts/rename-family.mjs — rename a family / facet token across data + taxonomy.
//
// Audit-coherence Tier 3 R4. The family taxonomy lives in three places:
//   • taxonomy.js — SUB_FAMILY_TO_MAIN keys + MAIN_FAMILY_TO_SUBS arrays
//   • data/materials.json — every material's classification.{primaryFamilies,
//     secondaryFamilies, facets} arrays
//   • formulation_data.js — FACET_TO_FAMILY (loose mapping)
//
// Renaming a token by hand previously meant touching all three and
// hoping no callsite drifted. This CLI does it atomically + reruns
// lint-data so any cross-ref break surfaces before the rename ships.
//
// Usage:
//   node scripts/rename-family.mjs --kind subfamily --from old_token --to new_token
//   node scripts/rename-family.mjs --kind facet     --from old_token --to new_token

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  return args[i + 1] || null;
}

const kind = flag('--kind');
const from = flag('--from');
const to   = flag('--to');

if (!kind || !from || !to) {
  console.error('Usage: node scripts/rename-family.mjs --kind subfamily|facet --from <old> --to <new>');
  process.exit(1);
}
if (!['subfamily', 'facet'].includes(kind)) {
  console.error('--kind must be one of: subfamily, facet');
  process.exit(1);
}
if (from === to) {
  console.error('--from and --to are the same; nothing to do.');
  process.exit(0);
}

// ── 1. data/materials.json ──────────────────────────────────────────
const DATA_FILE = path.join(REPO, 'data/materials.json');
const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

const ARRAY_KEYS = kind === 'subfamily'
  ? ['primaryFamilies', 'secondaryFamilies']
  : ['facets'];

let dataHits = 0;
for (const m of data.perfumery_db) {
  const cls = m.classification;
  if (!cls) continue;
  for (const k of ARRAY_KEYS) {
    if (!Array.isArray(cls[k])) continue;
    const idx = cls[k].indexOf(from);
    if (idx >= 0) {
      cls[k][idx] = to;
      dataHits++;
    }
  }
}
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n');

// ── 2. taxonomy.js (subfamily only) ─────────────────────────────────
let taxHits = 0;
if (kind === 'subfamily') {
  const TAX_FILE = path.join(REPO, 'taxonomy.js');
  let src = fs.readFileSync(TAX_FILE, 'utf8');
  // Replace bare 'old_token' string occurrences. Conservative — uses a
  // word-boundary-style pattern that won't touch substrings.
  const re = new RegExp("'" + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g');
  const before = src;
  src = src.replace(re, "'" + to + "'");
  if (src !== before) {
    taxHits = (before.match(re) || []).length;
    fs.writeFileSync(TAX_FILE, src);
  }
}

console.error(`[rename-family] kind=${kind} '${from}' → '${to}'`);
console.error(`  data/materials.json hits: ${dataHits}`);
if (kind === 'subfamily') console.error(`  taxonomy.js hits:        ${taxHits}`);

// ── 3. Re-validate ──────────────────────────────────────────────────
console.error('[rename-family] running lint-data…');
const r = spawnSync('node', ['tools/lint-data.mjs'], { cwd: REPO, stdio: 'inherit' });
process.exit(r.status || 0);
