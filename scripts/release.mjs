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
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const bumpShell = args.includes('--shell');
const bumpData = !args.includes('--no-data');
const setData = args.find(a => a.startsWith('--data='))?.split('=')[1];
const setShell = args.find(a => a.startsWith('--shell='))?.split('=')[1];

// ── Load version.json ─────────────────────────────────────────────────
const VERSION_FILE = path.join(REPO, 'version.json');
const version = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
const oldData = version.data;
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

let newData = oldData,
  newShell = oldShell;
if (!checkOnly) {
  if (setData) newData = setData;
  else if (bumpData) newData = bumpDataString(oldData);
  if (setShell) newShell = setShell;
  else if (bumpShell) newShell = bumpShellString(oldShell);
}

if (!checkOnly) {
  console.error(`[release] data:  ${oldData} → ${newData}`);
  console.error(
    `[release] shell: ${oldShell} → ${newShell}` + (oldShell === newShell ? ' (unchanged)' : '')
  );
}

// ── Surface inventory: every file/pattern that holds a version string ──
const HTML_FILES = ['index.html', 'formulation.html'];
const DATA_FILE = 'data/materials.json';
const SW_FILE = 'sw.js';
// SW shell assets — every routable, same-origin file the page needs to
// render or boot offline. release.mjs (a) hashes these into
// CACHE_VERSION so any content change rotates the cache, and
// (b) writes them into sw.js between the SHELL_ASSETS_BEGIN/END
// markers so the precache list can never drift from the hash.
//
// Audit-r2 Tier -1 fix (B2.1) — Round 1 left taxonomy.js,
// formulation_data.js, formulation_engine.js and the new lib/*.mjs
// modules off the precache list, breaking first-time offline boot on
// the formulator.
const SHELL_FILES = [
  'index.html',
  'formulation.html',
  'manifest.webmanifest',
  'data/materials.json',
  'taxonomy.js',
  'formulation_data.js',
  'formulation_engine.js',
  'lib/dom-utils.mjs',
  'lib/material-shape.mjs',
  'lib/storage.mjs',
];
// Precache URL forms (what cache.addAll() receives in sw.js). The
// leading './' alias for the root URL is added so a request for `/`
// hits the cache; otherwise identical to SHELL_FILES.
const SHELL_PRECACHE_URLS = ['./', ...SHELL_FILES.map(f => './' + f)];

function shellContentHash() {
  // Tier 3 fix — derive an 8-hex-char content hash so any shell content
  // change forces a SW cache miss without a manual shell bump. The
  // version.json `shell` field stays as the manual major (e.g. 'v3'),
  // and the full CACHE_VERSION becomes `perfume-shell-${shell}-${hash}`.
  // Concatenate file contents in a stable order so the hash is
  // deterministic across CI runs.
  const h = crypto.createHash('sha256');
  for (const rel of SHELL_FILES) {
    const abs = path.join(REPO, rel);
    h.update(rel + '\n');
    h.update(fs.readFileSync(abs));
    h.update('\n');
  }
  return h.digest('hex').slice(0, 8);
}

function rewriteSwShellAssets(swSrc) {
  // Replace the marker-bracketed array literal in sw.js. Indentation
  // matches the surrounding two-space style. Preserves the leading
  // comment block (above the BEGIN marker) and the closing END marker.
  const arrayLiteral =
    'const SHELL_ASSETS = [\n' + SHELL_PRECACHE_URLS.map(u => `  '${u}',`).join('\n') + '\n];';
  return swSrc.replace(
    /\/\/ >>> SHELL_ASSETS_BEGIN[\s\S]*?\/\/ <<< SHELL_ASSETS_END/,
    `// >>> SHELL_ASSETS_BEGIN\n${arrayLiteral}\n// <<< SHELL_ASSETS_END`
  );
}

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

// SW CACHE_VERSION = `perfume-shell-${shell}-${contentHash}`. Plus the
// SHELL_ASSETS array literal in sw.js is regenerated from SHELL_FILES
// above, so the precache list can never drift from the content hash.
// The shell part is the manual major from version.json; the contentHash
// is auto-derived so a shell-asset change rebusts the cache without a
// manual bump. Compute the hash AFTER any HTML / materials.json writes.
let newShellHash = null;
if (!checkOnly) {
  newShellHash = shellContentHash();
  const swAbs = path.join(REPO, SW_FILE);
  let swSrc = fs.readFileSync(swAbs, 'utf8');
  swSrc = swSrc.replace(
    /const\s+CACHE_VERSION\s*=\s*'perfume-shell-[^']+';/,
    `const CACHE_VERSION = 'perfume-shell-${newShell}-${newShellHash}';`
  );
  swSrc = rewriteSwShellAssets(swSrc);
  fs.writeFileSync(swAbs, swSrc);
}

if (!checkOnly && (newData !== oldData || newShell !== oldShell)) {
  fs.writeFileSync(
    VERSION_FILE,
    JSON.stringify({ data: newData, shell: newShell }, null, 2) + '\n'
  );
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
  // CACHE_VERSION format: 'perfume-shell-${shell}-${hash}' or legacy
  // 'perfume-shell-${shell}'. Tolerate both so a release that hasn't
  // hashed yet still verifies clean.
  const src = fs.readFileSync(path.join(REPO, SW_FILE), 'utf8');
  const m = src.match(/CACHE_VERSION\s*=\s*'perfume-shell-(v\d+)(?:-[a-f0-9]+)?'/);
  return m ? m[1] : null;
}
function shellHashInSwFile() {
  const src = fs.readFileSync(path.join(REPO, SW_FILE), 'utf8');
  const m = src.match(/CACHE_VERSION\s*=\s*'perfume-shell-v\d+-([a-f0-9]+)'/);
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
// On --check, verify the recorded hash still matches current shell content.
// In a write run, newShellHash was just written in lockstep so the check is tautological.
if (checkOnly) {
  const recordedHash = shellHashInSwFile();
  if (recordedHash) {
    const liveHash = shellContentHash();
    if (recordedHash !== liveHash) {
      errors.push(
        `sw.js CACHE_VERSION shell hash is ${recordedHash}, but current shell content hashes to ${liveHash} (run npm run release).`
      );
    }
  }
  // Also verify the SHELL_ASSETS array in sw.js matches SHELL_PRECACHE_URLS.
  // Round-1 had a list-only-in-sw.js that drifted; release.mjs now owns it,
  // and --check enforces the round-trip.
  const swSrcCheck = fs.readFileSync(path.join(REPO, SW_FILE), 'utf8');
  const m = swSrcCheck.match(
    /\/\/ >>> SHELL_ASSETS_BEGIN[\s\S]*?const\s+SHELL_ASSETS\s*=\s*\[([\s\S]*?)\];[\s\S]*?\/\/ <<< SHELL_ASSETS_END/
  );
  if (!m) {
    errors.push(
      'sw.js: SHELL_ASSETS_BEGIN/END markers missing — release.mjs cannot regenerate the list.'
    );
  } else {
    const listed = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
    const expectedUrls = SHELL_PRECACHE_URLS;
    if (listed.length !== expectedUrls.length || listed.some((u, i) => u !== expectedUrls[i])) {
      errors.push(
        `sw.js SHELL_ASSETS drift: listed=${JSON.stringify(listed)} expected=${JSON.stringify(expectedUrls)} (run npm run release).`
      );
    }
  }
}
if (metaVer != null && metaVer !== expected) {
  errors.push(`data/materials.json meta.version is ${metaVer}, expected ${expected}`);
}

if (errors.length) {
  console.error('[release] verification FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

const hashTag = newShellHash
  ? ` shell-hash ${newShellHash}`
  : (() => {
      const h = shellHashInSwFile();
      return h ? ` shell-hash ${h}` : '';
    })();
console.error('[release] OK — single version ' + expected + ', shell ' + expectedShell + hashTag);
