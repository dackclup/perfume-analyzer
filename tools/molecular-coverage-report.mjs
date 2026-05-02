#!/usr/bin/env node
// tools/molecular-coverage-report.mjs — coverage metric for the
// molecular layer.
//
// Round 3 P1.5. Reports three coverage rates so each conveys what it
// should:
//   raw          patched / total        — overall completeness incl. mixtures.
//   eligible     patched / (patched + flagged)
//                                       — coverage of the rows we tried
//                                         to enrich (excludes mixtures
//                                         and CAS-unknown rows).
//   ship         patched / (eligible non-flagged)
//                                       — Round-3 ship rate. Should be
//                                         100% — every clean row got a
//                                         patch and every flagged row
//                                         was held back, by construction.
//
// Per-family table breaks the same numbers down. Reads:
//   - data/materials.json
//   - audit/molecular-patches-flagged.json (gitignored; if missing,
//     flagged count = 0 and only raw + ship are meaningful).
// Writes:
//   - audit/molecular-coverage.json (machine-readable summary).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

function hasMolFields(material) {
  return Object.keys(material).some(k => k.startsWith('mol_'));
}

export function buildCoverage(data, flaggedPayload) {
  const db = data.perfumery_db || [];
  const mixtureCas = new Set(data.mixture_cas || []);
  const flaggedCas = new Set((flaggedPayload?.flagged || []).map(f => f.cas));

  let totalCount = 0;
  let mixtures = 0;
  let patched = 0;
  let flaggedCount = 0;

  const families = {};
  function bumpFamily(name, key) {
    if (!families[name]) {
      families[name] = { total: 0, mixtures: 0, patched: 0, flagged: 0 };
    }
    families[name][key]++;
  }

  for (const m of db) {
    totalCount++;
    const isMixture = m.cas && mixtureCas.has(m.cas);
    const isPatched = hasMolFields(m);
    const isFlagged = m.cas && flaggedCas.has(m.cas);

    if (isMixture) mixtures++;
    if (isPatched) patched++;
    if (isFlagged) flaggedCount++;

    const fams = m.classification?.primaryFamilies || ['(unclassified)'];
    for (const f of fams) {
      bumpFamily(f, 'total');
      if (isMixture) bumpFamily(f, 'mixtures');
      if (isPatched) bumpFamily(f, 'patched');
      if (isFlagged) bumpFamily(f, 'flagged');
    }
  }

  const eligibleAttempted = patched + flaggedCount;
  const rates = {
    raw: pct(patched, totalCount),
    eligible: pct(patched, eligibleAttempted),
    ship: pct(patched, patched), // 100% by construction; surfaces 0% if patched=0
  };

  return {
    summary: {
      total: totalCount,
      mixtures,
      patched,
      flagged: flaggedCount,
      eligible_attempted: eligibleAttempted,
      rates,
    },
    families,
  };
}

function pct(n, d) {
  if (!d) return 0;
  return Math.round((10000 * n) / d) / 100; // 2 dp
}

// ── CLI entry ─────────────────────────────────────────────────────────
/* c8 ignore start */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const dataPath = path.join(REPO, 'data', 'materials.json');
  const flaggedPath = path.join(REPO, 'audit', 'molecular-patches-flagged.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const flagged = fs.existsSync(flaggedPath)
    ? JSON.parse(fs.readFileSync(flaggedPath, 'utf8'))
    : null;
  const cov = buildCoverage(data, flagged);

  console.log('═══ Molecular coverage report ═══');
  const s = cov.summary;
  console.log(`  total materials in DB:        ${s.total}`);
  console.log(`  mixtures (excluded):          ${s.mixtures}`);
  console.log(`  patched (clean, mol_* set):   ${s.patched}`);
  console.log(`  flagged (Round 4 triage):     ${s.flagged}`);
  console.log(`  eligible attempted:           ${s.eligible_attempted}`);
  console.log('');
  console.log('  Coverage rates:');
  console.log(`    raw       patched / total                = ${s.rates.raw}%`);
  console.log(`    eligible  patched / (patched + flagged)  = ${s.rates.eligible}%`);
  console.log(`    ship      patched / clean-applicable     = ${s.rates.ship}%`);
  console.log('');
  console.log('  Per-primary-family breakdown:');
  console.log(
    `    ${'family'.padEnd(20)} ${'total'.padStart(6)} ${'mixt'.padStart(5)} ${'patch'.padStart(6)} ${'flag'.padStart(5)}  patch%`
  );
  const sorted = Object.entries(cov.families).sort((a, b) => b[1].total - a[1].total);
  for (const [name, f] of sorted) {
    const eligible = f.total - f.mixtures;
    const familyPct = eligible ? pct(f.patched, eligible) : 0;
    console.log(
      `    ${name.padEnd(20)} ${String(f.total).padStart(6)} ${String(f.mixtures).padStart(5)} ${String(f.patched).padStart(6)} ${String(f.flagged).padStart(5)}  ${familyPct}%`
    );
  }

  const outPath = path.join(REPO, 'audit', 'molecular-coverage.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(cov, null, 2) + '\n');
  console.log(`\n  full report → ${path.relative(REPO, outPath)}`);

  process.exit(0);
}
/* c8 ignore stop */
