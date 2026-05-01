#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// tools/add-materials.mjs — incremental updater for data/materials.json
//
// Why
//   data/materials.json is the canonical source of truth for the materials
//   database. Adding a new material by hand means looking up CAS, IUPAC,
//   formula, MW, SMILES, InChI, PubChem CID, and synonyms — tedious and
//   error-prone. This tool drives the lookup off PubChem's PUG REST API
//   for any input list (CAS numbers and/or names), merges results into
//   the existing JSON, and writes back a sorted pretty-printed file so
//   the diff cleanly shows the inserted rows.
//
// Usage
//   node tools/add-materials.mjs 100-52-7 78-70-6 5989-27-5
//   node tools/add-materials.mjs --file new-materials.txt
//   node tools/add-materials.mjs --dry-run 100-52-7
//
//   Input forms accepted:
//     • CAS number (e.g. 100-52-7)
//     • Material name (e.g. "linalool" or "lavender oil")
//
// Behavior
//   • Existing CAS in materials.json → only auto-derivable fields are
//     overwritten (formula, weight, smiles, inchi, iupac, pubchem_url,
//     synonyms). Human-curated fields (odor, note, classification,
//     blends_with, safety, performance, ghs_codes) are preserved.
//   • New CAS → full skeleton inserted with PubChem-derived fields and
//     empty placeholders for the curated fields, ready for human review.
//   • Sorted by CAS on write, same as the migration export.
//   • Rate-limited to 3 requests/sec per PubChem's published guidance.
//
// Exit codes
//   0  success
//   1  partial failure (some lookups failed); JSON still written for the
//      successful ones unless --strict is passed.
//   2  fatal error (file I/O, no PubChem at all, malformed JSON).
//
// Standalone script. No build step. Only depends on Node's standard
// library (fs/promises, fetch built-in since Node 18).
// ─────────────────────────────────────────────────────────────

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(REPO_ROOT, 'data', 'materials.json');

const PUBCHEM_REST   = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const PUBCHEM_PUGVIEW = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view';

// PubChem published guidance: <= 5 requests/sec per IP. We pace at one
// request per 350ms (~2.85 rps) to leave headroom for retries and the
// occasional slow response. See https://pubchem.ncbi.nlm.nih.gov/docs/programmatic-access
const RATE_LIMIT_MS = 350;
const HTTP_TIMEOUT_MS = 15000;
const HTTP_MAX_RETRIES = 3;

const CAS_RE = /^\d{1,7}-\d{2}-\d$/;

// ─── CLI parsing ─────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { dryRun: false, strict: false, file: null, inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run')      opts.dryRun = true;
    else if (a === '--strict')  opts.strict = true;
    else if (a === '--file')    opts.file = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else opts.inputs.push(a);
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node tools/add-materials.mjs [options] <input...>

Inputs may be CAS numbers (e.g. 100-52-7) or material names (e.g. linalool).

Options:
  --file <path>   Read inputs (one per line) from a file
  --dry-run       Do not write data/materials.json — print the merged result
  --strict        Exit non-zero if any single input fails to resolve
  --help, -h      Show this message`);
}

// ─── HTTP with retry + timeout ───────────────────────────────────────
async function fetchJSON(url) {
  let lastErr;
  for (let attempt = 0; attempt < HTTP_MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.status === 404) return { __notfound: true };
      if (res.status === 429 || res.status >= 500) {
        // PubChem throttles or transient — back off and retry
        const backoff = 1000 * Math.pow(2, attempt);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
      return await res.json();
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      // Network / abort — short backoff
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr || new Error('fetch failed: ' + url);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── PubChem helpers ─────────────────────────────────────────────────
async function findCid(input) {
  // Two paths: CAS-style identifier → xref/RN; otherwise → name lookup.
  // The `rn` (Registry Number) endpoint matches CAS exactly; the name
  // endpoint matches IUPAC, common name, and synonyms.
  if (CAS_RE.test(input)) {
    const url = `${PUBCHEM_REST}/compound/xref/RN/${encodeURIComponent(input)}/cids/JSON`;
    const r = await fetchJSON(url);
    if (r.__notfound) return null;
    return r?.InformationList?.Information?.[0]?.CID?.[0] || null;
  }
  const url = `${PUBCHEM_REST}/compound/name/${encodeURIComponent(input)}/cids/JSON`;
  const r = await fetchJSON(url);
  if (r.__notfound) return null;
  return r?.IdentifierList?.CID?.[0] || null;
}

async function fetchProperties(cid) {
  const props = 'IUPACName,MolecularFormula,MolecularWeight,CanonicalSMILES,InChI';
  const url = `${PUBCHEM_REST}/compound/cid/${cid}/property/${props}/JSON`;
  const r = await fetchJSON(url);
  return r?.PropertyTable?.Properties?.[0] || null;
}

async function fetchSynonyms(cid) {
  const url = `${PUBCHEM_REST}/compound/cid/${cid}/synonyms/JSON`;
  const r = await fetchJSON(url);
  const list = r?.InformationList?.Information?.[0]?.Synonym || [];
  // PubChem synonym arrays are noisy: trade names, registry codes, and
  // duplicates with capitalisation differences. Keep the first 8 unique
  // lowercase strings — enough for the analyzer's reverse-lookup needs
  // without bloating the JSON. CAS-shaped tokens (e.g. "100-52-7") drop
  // out so a single canonical CAS lives in the entry's `cas` field.
  const seen = new Set();
  const cleaned = [];
  for (const s of list) {
    const lower = String(s).trim().toLowerCase();
    if (!lower) continue;
    if (CAS_RE.test(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    cleaned.push(lower);
    if (cleaned.length >= 8) break;
  }
  return cleaned;
}

async function fetchCAS(cid) {
  // Pull the CAS-XR section from PUG-View; this is the most reliable
  // way to get a CAS from a CID since PUG-REST's xref RN is one-way.
  const url = `${PUBCHEM_PUGVIEW}/data/compound/${cid}/JSON?heading=CAS`;
  const r = await fetchJSON(url);
  if (r.__notfound) return null;
  // Walk the PUG-View tree for any string that looks like a CAS.
  const found = new Set();
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.String === 'string' && CAS_RE.test(node.String.trim())) {
      found.add(node.String.trim());
    }
    for (const v of Object.values(node)) walk(v);
  }
  walk(r);
  if (!found.size) return null;
  // Prefer the lowest-numbered CAS — usually the canonical entry; many
  // compounds carry secondary registry numbers from re-classifications.
  const sorted = [...found].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  return sorted[0];
}

// ─── Merge logic ─────────────────────────────────────────────────────
//
// AUTO_FIELDS are derivable from PubChem; CURATED_FIELDS reflect human
// judgement and must never be clobbered by a re-fetch. New entries get
// empty placeholders for curated fields so the diff makes it obvious
// which rows still need a perfumer's review.
const AUTO_FIELDS    = new Set(['iupac', 'formula', 'weight', 'smiles', 'inchi', 'pubchem_url', 'synonyms']);
const SKELETON = () => ({
  name: '',
  cas: '',
  fema: '',
  iupac: '',
  formula: '',
  weight: '',
  smiles: '',
  inchi: '',
  synonyms: [],
  pubchem_url: '',
  odor: { description: '', type: '', strength: '' },
  note: '',
  performance: { tenacity: '', duration: '' },
  safety: { ifra: '', usage: '' },
  blends_with: [],
  classification: { primaryFamilies: [], secondaryFamilies: [], facets: [] },
  ghs_codes: [],
});

function mergeEntry(existing, fetched) {
  if (!existing) {
    const e = SKELETON();
    Object.assign(e, fetched);
    return e;
  }
  const merged = JSON.parse(JSON.stringify(existing));
  for (const k of Object.keys(fetched)) {
    if (AUTO_FIELDS.has(k)) merged[k] = fetched[k];
    // name + cas are keys; only fill if missing on existing
    else if ((k === 'name' || k === 'cas') && !merged[k]) merged[k] = fetched[k];
  }
  return merged;
}

// ─── Driver ─────────────────────────────────────────────────────────
async function lookupOne(input) {
  const cid = await findCid(input);
  if (!cid) throw new Error('not found on PubChem: ' + input);
  await sleep(RATE_LIMIT_MS);
  const props = await fetchProperties(cid);
  if (!props) throw new Error('no properties for CID ' + cid);
  await sleep(RATE_LIMIT_MS);
  const synonyms = await fetchSynonyms(cid);
  // Prefer the CAS the caller passed if it was a CAS; otherwise pull
  // from PubChem (extra request, but only needed for name lookups).
  let cas;
  if (CAS_RE.test(input)) {
    cas = input;
  } else {
    await sleep(RATE_LIMIT_MS);
    cas = await fetchCAS(cid);
    if (!cas) throw new Error('PubChem returned no CAS for CID ' + cid + ' (' + input + ')');
  }
  // Canonical name is the first synonym capitalized — PubChem's order is
  // usually a sensible primary first. Falls back to IUPAC if the synonym
  // list is empty (rare).
  const name = (synonyms[0] || props.IUPACName || input).replace(/\b\w/g, c => c.toUpperCase());
  return {
    name,
    cas,
    iupac: props.IUPACName || '',
    formula: props.MolecularFormula || '',
    weight: props.MolecularWeight ? String(props.MolecularWeight) : '',
    smiles: props.CanonicalSMILES || '',
    inchi: props.InChI || '',
    synonyms,
    pubchem_url: 'https://pubchem.ncbi.nlm.nih.gov/compound/' + cid,
  };
}

async function readInputsFromFile(filepath) {
  const text = await fs.readFile(filepath, 'utf8');
  return text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
}

function sortDataset(data) {
  data.perfumery_db.sort((a, b) => {
    const ka = a.cas || '￿';
    const kb = b.cas || '￿';
    return ka.localeCompare(kb);
  });
  const sortedTrades = {};
  for (const k of Object.keys(data.trade_names || {}).sort()) {
    sortedTrades[k] = data.trade_names[k];
  }
  data.trade_names = sortedTrades;
  if (Array.isArray(data.mixture_cas)) data.mixture_cas.sort();
  return data;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let inputs = opts.inputs;
  if (opts.file) {
    const fileInputs = await readInputsFromFile(opts.file);
    inputs = inputs.concat(fileInputs);
  }
  if (!inputs.length) {
    console.error('No inputs given. Pass CAS numbers / names as args, or --file <path>.');
    printHelp();
    process.exit(2);
  }

  // Load existing database
  let dataset;
  try {
    dataset = JSON.parse(await fs.readFile(JSON_PATH, 'utf8'));
  } catch (err) {
    console.error('Failed to read', JSON_PATH, '—', err.message);
    process.exit(2);
  }
  const byCas = new Map(dataset.perfumery_db.map(e => [e.cas, e]));

  // Resolve each input. Failures are collected; the final write still
  // includes whatever succeeded unless --strict was passed.
  let added = 0, updated = 0, failed = 0;
  const failures = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    process.stderr.write(`[${i + 1}/${inputs.length}] ${input} … `);
    try {
      const fetched = await lookupOne(input);
      const existing = byCas.get(fetched.cas);
      const merged = mergeEntry(existing, fetched);
      if (existing) {
        const idx = dataset.perfumery_db.indexOf(existing);
        dataset.perfumery_db[idx] = merged;
        updated++;
        process.stderr.write('updated (' + merged.cas + ')\n');
      } else {
        dataset.perfumery_db.push(merged);
        byCas.set(merged.cas, merged);
        added++;
        process.stderr.write('added (' + merged.cas + ')\n');
      }
    } catch (err) {
      failed++;
      failures.push({ input, error: err.message });
      process.stderr.write('FAILED — ' + err.message + '\n');
    }
    // Pace between inputs even on failure to be polite to the API
    if (i < inputs.length - 1) await sleep(RATE_LIMIT_MS);
  }

  sortDataset(dataset);

  if (opts.dryRun) {
    process.stdout.write(JSON.stringify(dataset, null, 2) + '\n');
    process.stderr.write(`\nDry run: ${added} added, ${updated} updated, ${failed} failed.\n`);
  } else {
    await fs.writeFile(JSON_PATH, JSON.stringify(dataset, null, 2) + '\n');
    process.stderr.write(`\nWrote ${JSON_PATH}: ${added} added, ${updated} updated, ${failed} failed.\n`);
  }

  if (failures.length) {
    process.stderr.write('Failures:\n');
    for (const f of failures) process.stderr.write('  • ' + f.input + ' — ' + f.error + '\n');
  }
  if (opts.strict && failed > 0) process.exit(1);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
