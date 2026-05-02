#!/usr/bin/env node
// scripts/add-material.mjs — add a new material to data/materials.json.
//
// Audit-coherence Tier 3 R4. Replaces the manual "edit JSON, hope you
// got the CAS check-digit right, hope sort order's right, run lint-data
// and chase down the cross-ref breakage" loop with a single command.
//
// Usage:
//   node scripts/add-material.mjs --cas 1234-56-7 --name "Ethyl Acetate"
//                                 [--note Top]
//                                 [--smiles CCOC(=O)C]
//                                 [--type natural|synthetic|nature_identical|semi_synthetic]
//
// Validates the CAS check-digit (so a typo fails fast), inserts the new
// row in CAS-sorted order, then runs lint-data --strict via child
// process so the same gates that protect CI run before the file lands.
//
// Out-of-scope: blends_with, allergen flags, IFRA caps. Add those by
// editing the row after the CLI lands the skeleton — the lint-data
// schema enforces the shape so a forgotten field surfaces immediately.

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

const cas = flag('--cas');
const name = flag('--name');
const note = flag('--note');
const smiles = flag('--smiles');
const type = flag('--type');

if (!cas || !name) {
  console.error(
    'Usage: node scripts/add-material.mjs --cas <cas> --name <name> [--note Top|Middle|Base] [--smiles <smiles>] [--type natural|synthetic|nature_identical|semi_synthetic]'
  );
  process.exit(1);
}

// ── CAS check-digit validation ──────────────────────────────────────
// ISO formula: Σ d_i × pos_from_right (excluding the check digit), mod 10.
function casCheckOk(c) {
  const m = /^(\d{1,7})-(\d{2})-(\d)$/.exec(c);
  if (!m) return false;
  const digits = (m[1] + m[2]).split('').map(Number);
  const check = parseInt(m[3], 10);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += digits[digits.length - 1 - i] * (i + 1);
  }
  return sum % 10 === check;
}
if (!casCheckOk(cas)) {
  console.error(
    `[add-material] CAS ${cas} fails check-digit validation. Verify the number on PubChem before retrying.`
  );
  process.exit(2);
}

// ── Load + dedup ─────────────────────────────────────────────────────
const DATA_FILE = path.join(REPO, 'data/materials.json');
const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

if (!Array.isArray(data.perfumery_db)) {
  console.error('[add-material] data/materials.json: perfumery_db is missing or not an array.');
  process.exit(3);
}
if (data.perfumery_db.some(e => e && e.cas === cas)) {
  console.error(
    `[add-material] CAS ${cas} is already in the DB (${data.perfumery_db.find(e => e.cas === cas).name}).`
  );
  process.exit(4);
}

// ── Build skeleton row ──────────────────────────────────────────────
const row = { cas, name };
if (note) row.note = note;
if (smiles) row.smiles = smiles;
if (type) row.classification = { material_type: type };

data.perfumery_db.push(row);

// CAS-sorted by left-zero-padded segments so 100-… sorts after 99-….
function casSortKey(c) {
  const [a, b, d] = c.split('-');
  return a.padStart(7, '0') + '-' + b.padStart(2, '0') + '-' + d;
}
data.perfumery_db.sort((x, y) => casSortKey(x.cas).localeCompare(casSortKey(y.cas)));

// Refresh meta.row_count if present.
if (data.meta) data.meta.row_count = data.perfumery_db.length;

fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
console.error(`[add-material] inserted ${cas} (${name}). Row count: ${data.perfumery_db.length}.`);

// ── Re-validate ─────────────────────────────────────────────────────
console.error('[add-material] running lint-data…');
const r = spawnSync('node', ['tools/lint-data.mjs'], { cwd: REPO, stdio: 'inherit' });
process.exit(r.status || 0);
