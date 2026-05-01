#!/usr/bin/env node
// scripts/release.mjs — single source of truth for version bumps.
//
// Audit-coherence Tier 1 R1. Replaces the manual "sed -i 's/v292/v293/g'"
// pattern that touched 7-9 files per release with a single command:
//
//   npm run release            # bump data version (vNNN → vNNN+1)
//   npm run release -- --shell # also bump SW shell hash (rare)
//   npm run release -- --check # just verify no drift, no write
//
// Reads version.json as authoritative, then propagates to:
//   • index.html       (3 ?v=… on script-src + 2 DATA_VERSION consts)
//   • formulation.html (3 ?v=… + 1 DATA_VERSION const)
//   • sw.js            (CACHE_VERSION shell key)
//   • data/materials.json (top-level data.meta.version field)
//
// After write, asserts:
//   1. exactly one distinct '2026-04-29-vNNN' string repo-wide (HTML)
//   2. SW CACHE_VERSION matches version.json's shell field
//   3. materials.json data.meta.version === version.json data
//
// Any mismatch → exit 1 (CI fails).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const bumpShell = args.includes('--shell');
const bumpData  = !args.includes('--no-data');
const setData   = args.find(a => a.startsWith('--data='))?.split('=')[1];
const setShell  = args.find(a => a.startsWith('--shell='))?.split('=')[1];

// ── Load version.json ─────────────────────────────────────────────────
const VERSION_FILE = path.join(REPO, 'version.json');
const version = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
const oldData  = version.data;
const oldShell = version.shell;

function bumpDataString(v) {
  // "2026-04-29-vNNN" → vNNN+1, preserve the date prefix
  const m = v.match(/^(.+-v)(\d+)$/);
  if (!m) throw new Error('version.json data string does not match expected pattern: ' + v);
  return m[1] + (parseInt(m[2], 10) + 1);
}
function bumpShellString(v) {
  const m = v.match(/^v(\d+)$/);
  if (!m) throw new Error('version.json shell string does not match expected pattern: ' + v);
  return 'v' + (parseInt(m[1], 10) + 1);
}

let newData = oldData, newShell = oldShell;
if (!checkOnly) {
  if (setData)        newData = setData;
  else if (bumpData)  newData = bumpDataString(oldData);
  if (setShell)        newShell = setShell;
  else if (bumpShell)  newShell = bumpShellString(oldShell);
}

if (!checkOnly) {
  console.error(`[release] data:  ${oldData} → ${newData}`);
  console.error(`[release] shell: ${oldShell} → ${newShell}` + (oldShell === newShell ? ' (unchanged)' : ''));
}

// ── Surface inventory: every file/pattern that holds a version string ──
const HTML_FILES = ['index.html', 'formulation.html'];
const DATA_FILE  = 'data/materials.json';
const SW_FILE    = 'sw.js';

function applyReplaces(filePath, pairs) {
  if (checkOnly) return;
  const abs = path.join(REPO, filePath);
  let src = fs.readFileSync(abs, 'utf8');
  for (const [pattern, replacement] of pairs) {
    src = src.replace(pattern, replacement);
  }
  fs.writeFileSync(abs, src);
}

function literalReplace(needle, repl) {
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  return [re, repl];
}

if (!checkOnly && newData !== oldData) {
  for (const f of HTML_FILES) {
    applyReplaces(f, [literalReplace(oldData, newData)]);
  }
  // data/materials.json — set data.meta.version (creates meta if absent)
  const dataAbs = path.join(REPO, DATA_FILE);
  const data = JSON.parse(fs.readFileSync(dataAbs, 'utf8'));
  data.meta = data.meta || {};
  data.meta.version = newData;
  data.meta.row_count = (data.perfumery_db || []).length;
  fs.writeFileSync(dataAbs, JSON.stringify(data, null, 2) + '\n');
}

if (!checkOnly && newShell !== oldShell) {
  applyReplaces(SW_FILE, [literalReplace(oldShell, newShell)]);
}

if (!checkOnly && (newData !== oldData || newShell !== oldShell)) {
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ data: newData, shell: newShell }, null, 2) + '\n');
}

// ── Verification pass ─────────────────────────────────────────────────
function uniqDataVersionsInHtml() {
  const seen = new Set();
  for (const f of HTML_FILES) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    for (const m of src.matchAll(/2026-04-\d+-v\d+/g)) seen.add(m[0]);
  }
  return [...seen];
}
function shellInSwFile() {
  const src = fs.readFileSync(path.join(REPO, SW_FILE), 'utf8');
  const m = src.match(/CACHE_VERSION\s*=\s*'perfume-shell-(v\d+)'/);
  return m ? m[1] : null;
}
function dataMetaInMaterials() {
  const data = JSON.parse(fs.readFileSync(path.join(REPO, DATA_FILE), 'utf8'));
  return data.meta?.version || null;
}

const expected = checkOnly ? oldData : newData;
const expectedShell = checkOnly ? oldShell : newShell;
const htmlVersions = uniqDataVersionsInHtml();
const swShell = shellInSwFile();
const metaVer = dataMetaInMaterials();

const errors = [];
if (htmlVersions.length === 0) {
  errors.push('No version string found in HTML files.');
} else if (htmlVersions.length > 1) {
  errors.push('HTML version strings disagree: ' + JSON.stringify(htmlVersions));
} else if (htmlVersions[0] !== expected) {
  errors.push(`HTML reports ${htmlVersions[0]}, expected ${expected}`);
}
if (swShell && swShell !== expectedShell) {
  errors.push(`sw.js CACHE_VERSION shell is ${swShell}, expected ${expectedShell}`);
}
if (metaVer != null && metaVer !== expected) {
  errors.push(`data/materials.json meta.version is ${metaVer}, expected ${expected}`);
}

if (errors.length) {
  console.error('[release] verification FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.error('[release] OK — single version ' + expected + ', shell ' + expectedShell);
