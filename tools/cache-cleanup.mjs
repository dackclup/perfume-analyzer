#!/usr/bin/env node
// tools/cache-cleanup.mjs — manual hygiene for audit/cache/.
//
// Round 3 P1.3 (amendment #3). Optional sidekick to enrich-molecular.
// NOT wired into CI — a CI prune would silently re-fetch and break
// the determinism that the cache provides.
//
// Usage:
//   node tools/cache-cleanup.mjs --report
//   node tools/cache-cleanup.mjs --prune-older-than 180

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CACHE_DIR } from './lib/pubchem.mjs';

const __filename = fileURLToPath(import.meta.url);

const args = process.argv.slice(2);
const has = name => args.includes(name);
const value = name => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  return args[i + 1] || null;
};

const SIZE_WARN_BYTES = 100 * 1024 * 1024; // 100 MB

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (ent.isFile() && ent.name.endsWith('.json')) out.push(full);
  }
  return out;
}

function summarize(files) {
  let bytes = 0;
  let oldest = Infinity;
  let newest = 0;
  for (const f of files) {
    const st = fs.statSync(f);
    bytes += st.size;
    if (st.mtimeMs < oldest) oldest = st.mtimeMs;
    if (st.mtimeMs > newest) newest = st.mtimeMs;
  }
  return { count: files.length, bytes, oldest, newest };
}

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function fmtAge(ms) {
  if (!isFinite(ms) || !ms) return 'n/a';
  const days = (Date.now() - ms) / 86400000;
  return days.toFixed(1) + ' days ago';
}

function report(cacheDir) {
  console.log(`audit/cache/ at ${cacheDir}`);
  for (const layer of ['first-layer', 'experimental']) {
    const dir = path.join(cacheDir, `pubchem-${layer}`);
    const files = walk(dir);
    const s = summarize(files);
    console.log(
      `  ${layer.padEnd(13)}  ${String(s.count).padStart(5)} files  ${fmtBytes(s.bytes).padStart(8)}` +
        `  oldest ${fmtAge(s.oldest)}  newest ${fmtAge(s.newest)}`
    );
  }
  const total = walk(cacheDir);
  const ts = summarize(total);
  console.log(
    `  TOTAL          ${String(ts.count).padStart(5)} files  ${fmtBytes(ts.bytes).padStart(8)}`
  );
  if (ts.bytes > SIZE_WARN_BYTES) {
    console.warn(
      `\n⚠ cache exceeds ${fmtBytes(SIZE_WARN_BYTES)} — consider --prune-older-than 180`
    );
  }
  return ts;
}

function pruneOlderThan(cacheDir, days) {
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  let bytes = 0;
  for (const f of walk(cacheDir)) {
    const st = fs.statSync(f);
    if (st.mtimeMs < cutoff) {
      bytes += st.size;
      fs.unlinkSync(f);
      removed++;
    }
  }
  console.log(`pruned ${removed} files (${fmtBytes(bytes)}) older than ${days} days`);
  return { removed, bytes };
}

const isMain = process.argv[1] && __filename === path.resolve(process.argv[1]);
if (isMain) {
  const cacheDir = DEFAULT_CACHE_DIR;
  if (has('--prune-older-than')) {
    const d = parseInt(value('--prune-older-than'), 10);
    if (!Number.isInteger(d) || d <= 0) {
      console.error('--prune-older-than requires a positive integer (days)');
      process.exit(2);
    }
    pruneOlderThan(cacheDir, d);
  } else {
    report(cacheDir);
  }
}

export { report, pruneOlderThan, summarize, walk, SIZE_WARN_BYTES };
