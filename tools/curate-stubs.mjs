#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// tools/curate-stubs.mjs — heuristic auto-classifier for PubChem stubs
//
// Why
//   tools/add-materials.mjs lands rich identifier data (CAS, IUPAC,
//   formula, MW, SMILES, synonyms) but PubChem doesn't carry olfactive
//   metadata. Result: pure stubs with empty `classification`,
//   `odor.type`, and `note` fields. The analyzer's family chips only
//   count classified rows, so "All 622" / "Aromatic Fougère 153 …"
//   summed to ~425 — confusing because the user expects the family
//   chips to partition the catalogue.
//
//   This script scans every entry that's both empty (no primaryFamilies
//   AND no odor.type AND no note) and runs a keyword pattern match
//   against the entry's name + synonyms + IUPAC. When a confident
//   match lands, we populate primaryFamilies + facets + odor.type
//   + note from a curated lookup table that mirrors the family tokens
//   already in the database.
//
//   Conservative by design: only confident matches are written. Anything
//   that doesn't fit a pattern stays a stub for a perfumer to curate.
//
// Usage
//   node tools/curate-stubs.mjs            # write back to data/materials.json
//   node tools/curate-stubs.mjs --dry-run  # preview matches, don't write
//   node tools/curate-stubs.mjs --report   # CSV of matches + misses
// ─────────────────────────────────────────────────────────────

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyEntry,
  applyClassification,
  applyDefaults,
  noteFromMw,
} from './lib/material-classifier.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(REPO_ROOT, 'data', 'materials.json');

// ─── Driver ─────────────────────────────────────────────────────────
//
// Heuristic rules + classifier helpers were extracted to
// tools/lib/material-classifier.mjs in the Phase 1 refactor so that
// add-materials.mjs can run the same classifier inline on each fresh
// PubChem fetch. This script drives the lib over the whole DB to catch
// entries that landed before the classifier existed (or that were added
// by a future updater path that bypassed the inline classifier).

function isStub(entry) {
  return !entry.classification?.primaryFamilies?.length && !entry.odor?.type && !entry.note;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const report = argv.includes('--report');

  const data = JSON.parse(await fs.readFile(JSON_PATH, 'utf8'));
  const stubs = data.perfumery_db.filter(isStub);
  const matched = [];
  const missed = [];

  for (const entry of stubs) {
    const m = classifyEntry(entry);
    if (m) {
      applyClassification(entry, m);
      // Phase 1: also fill IFRA / BP defaults so the engine doesn't
      // treat the row as unrestricted. applyDefaults is idempotent.
      applyDefaults(entry);
      matched.push({
        cas: entry.cas,
        name: entry.name,
        families: m.families,
        type: m.type,
        note: m.note,
      });
    } else {
      // Fall back to MW-derived note + safety defaults so even
      // unmatched rows get at least a tier classification + the
      // "treat as restricted" IFRA flag. Keeps the analyzer's chip
      // strip happy and prevents the engine from assuming "no
      // restriction" for anything PubChem-derived.
      applyDefaults(entry);
      const mwNote = noteFromMw(entry.weight);
      if (mwNote && !entry.note) entry.note = mwNote;
      missed.push({
        cas: entry.cas,
        name: entry.name,
        weight: entry.weight,
        note: entry.note || '',
      });
    }
  }

  // Phase 1 safety pass: walk every entry and apply defaults for
  // schema fields that pre-classifier curation left empty. Idempotent
  // — populated fields are never overwritten. Catches the 193 rows
  // that got odor.type/note from a previous classifier run but were
  // never given safety.ifra defaults; without a value the IFRA engine
  // assumes "no restriction" and the row passes compliance silently.
  let safetyBackfilled = 0;
  for (const entry of data.perfumery_db) {
    const before =
      (entry.safety?.ifra || '') +
      '|' +
      (entry.safety?.usage || '') +
      '|' +
      (entry.boiling_point ?? '');
    applyDefaults(entry);
    const after =
      (entry.safety?.ifra || '') +
      '|' +
      (entry.safety?.usage || '') +
      '|' +
      (entry.boiling_point ?? '');
    if (before !== after) safetyBackfilled++;
  }

  process.stderr.write(`Stubs scanned: ${stubs.length}\n`);
  process.stderr.write(`Matched (classified): ${matched.length}\n`);
  process.stderr.write(`Missed (note-only fallback): ${missed.length}\n`);
  process.stderr.write(`Safety/BP defaults backfilled on existing rows: ${safetyBackfilled}\n`);

  if (report) {
    process.stdout.write('\n=== MATCHED ===\n');
    for (const m of matched)
      process.stdout.write(
        `  ${m.cas.padEnd(12)} ${m.name.padEnd(40)} → ${m.families.join(',')} | ${m.type} | ${m.note}\n`
      );
    process.stdout.write('\n=== MISSED (still need curation) ===\n');
    for (const m of missed)
      process.stdout.write(
        `  ${m.cas.padEnd(12)} ${m.name.padEnd(40)} (MW=${m.weight}, note=${m.note})\n`
      );
  }

  if (!dryRun) {
    // Re-sort by CAS before writing to keep the diff aligned with
    // the canonical ordering established by the migration export.
    data.perfumery_db.sort((a, b) => (a.cas || '￿').localeCompare(b.cas || '￿'));
    await fs.writeFile(JSON_PATH, JSON.stringify(data, null, 2) + '\n');
    process.stderr.write(`Wrote ${JSON_PATH}\n`);
  } else {
    process.stderr.write('Dry run — no file written.\n');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
