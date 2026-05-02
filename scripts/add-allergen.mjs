#!/usr/bin/env node
// scripts/add-allergen.mjs — add an EU allergen to the analyzer regex.
//
// Audit-coherence Tier 3 R4. The EU 1223/2009 allergen list (26 from
// 2003/15/EC + 24 from 2023/1545 = 50 total, current as of 2026) is
// embedded as a regex in index.html so the analyzer can highlight
// allergens in raw material text. When EU adds a new entry to Annex
// III, this CLI extends the regex without forcing the user to find
// the right line in 8000 lines of index.html.
//
// Usage:
//   node scripts/add-allergen.mjs --name "Pyrogallol" [--cas 87-66-1]
//
// Inserts the name (regex-escaped) into EU_ALLERGENS_CURRENT in
// alphabetical position so the regex stays sorted and diffs cleanly.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  return args[i + 1] || null;
}

const name = flag('--name');
if (!name) {
  console.error('Usage: node scripts/add-allergen.mjs --name "<allergen common name>"');
  process.exit(1);
}

const INDEX_FILE = path.join(REPO, 'index.html');
let src = fs.readFileSync(INDEX_FILE, 'utf8');

// Locate the EU_ALLERGENS_CURRENT regex literal. Format:
//   const EU_ALLERGENS_CURRENT = /\b(...names...)\b/i;
// Names inside the alternation are pipe-separated, regex-escaped.
const m = src.match(/const\s+EU_ALLERGENS_CURRENT\s*=\s*\/\\b\(([^)]+)\)\\b\/i;/);
if (!m) {
  console.error('[add-allergen] could not locate EU_ALLERGENS_CURRENT regex in index.html.');
  process.exit(2);
}

const names = m[1].split('|');
const lower = name.toLowerCase();
if (names.some(n => n.toLowerCase() === lower || n.toLowerCase().replace(/\\/g, '') === lower)) {
  console.error(`[add-allergen] "${name}" already present in EU_ALLERGENS_CURRENT.`);
  process.exit(0);
}

// Regex-escape spaces, dashes, parens etc. The existing entries use
// backslash-escapes for non-alphanumerics so we follow the same style.
function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

names.push(esc(name));
names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

const newAlt = names.join('|');
const replaced = src.replace(m[0], `const EU_ALLERGENS_CURRENT = /\\b(${newAlt})\\b/i;`);
if (replaced === src) {
  console.error('[add-allergen] regex rewrite failed (unexpected — bailing).');
  process.exit(3);
}
fs.writeFileSync(INDEX_FILE, replaced);

console.error(
  `[add-allergen] inserted "${name}" into EU_ALLERGENS_CURRENT (now ${names.length} entries).`
);
console.error(
  '[add-allergen] reminder — also extend NATURAL_ALLERGEN_COMPOSITION in formulation_data.js if this allergen appears in a natural mixture.'
);
