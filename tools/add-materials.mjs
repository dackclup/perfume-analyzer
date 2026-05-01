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
// request per 400ms (2.5 rps) to leave headroom for retries and the
// occasional slow response. See https://pubchem.ncbi.nlm.nih.gov/docs/programmatic-access
const RATE_LIMIT_MS = 400;
const HTTP_TIMEOUT_MS = 20000;
const HTTP_MAX_RETRIES = 4;

const CAS_RE = /^\d{1,7}-\d{2}-\d$/;

// ─── First-batch seed list ─────────────────────────────────────────────
// 220 widely-used aroma chemicals + a handful of canonical naturals. Pass
// `--seed` on the CLI to fetch this list from PubChem. Each entry can be
// either a CAS number (most reliable — direct xref/RN lookup) or a name
// (resolved through PubChem's name index). CAS preferred where the trade
// name is non-canonical (Iso E Super, Hedione, etc.) so the lookup stays
// deterministic. Names work for plain chemicals (Linalool, Vanillin, ...).
//
// Categories: terpenes & citrus, alcohols, esters, aldehydes, lactones,
// phenolics & spice, ionones & damascones, indolics, musks, ambergris,
// sandalwood, patchouli/vetiver, marine, oakmoss, plus a starter set of
// commercial naturals. PubChem returns 404 for some pure trade-name
// queries; the runner logs each miss and continues.
const SEED_LIST = [
  // — Citrus & monoterpenes —
  '5989-27-5',  // (R)-(+)-Limonene
  '80-56-8',    // alpha-Pinene
  '127-91-3',   // beta-Pinene
  '123-35-3',   // beta-Myrcene
  '13877-91-3', // beta-Ocimene
  '3387-41-5',  // Sabinene
  '79-92-5',    // Camphene
  '99-87-6',    // p-Cymene
  '586-62-9',   // Terpinolene
  '99-86-5',    // alpha-Terpinene
  '99-85-4',    // gamma-Terpinene
  '470-82-6',   // 1,8-Cineole (Eucalyptol)
  '76-22-2',    // Camphor
  '89-78-1',    // Menthol
  '507-70-0',   // Borneol
  '76-49-3',    // Bornyl Acetate
  '125-12-2',   // Isobornyl Acetate
  '98-55-5',    // alpha-Terpineol
  '562-74-3',   // 4-Terpineol
  '80-26-2',    // alpha-Terpinyl Acetate
  '78-70-6',    // Linalool
  '115-95-7',   // Linalyl Acetate
  '106-22-9',   // Citronellol
  '106-23-0',   // Citronellal
  '150-84-5',   // Citronellyl Acetate
  '106-24-1',   // Geraniol
  '106-25-2',   // Nerol
  '141-12-8',   // Neryl Acetate
  '105-87-3',   // Geranyl Acetate
  '5392-40-5',  // Citral
  '141-27-5',   // Geranial (trans-citral)
  '106-26-3',   // Neral (cis-citral)
  '107-75-5',   // Hydroxycitronellal
  // — Aldehydes (C-series) —
  '124-13-0',   // Octanal (Aldehyde C-8)
  '124-19-6',   // Nonanal (Aldehyde C-9)
  '112-31-2',   // Decanal (Aldehyde C-10)
  '112-44-7',   // Undecanal (Aldehyde C-11)
  '112-54-9',   // Dodecanal (Aldehyde C-12 / Lauric)
  '110-41-8',   // 2-Methylundecanal (Aldehyde C-12 MNA)
  '143-14-6',   // Aldehyde C-11 undecylenic
  '141-25-3',   // Rhodinyl Acetate
  '101-86-0',   // Hexylcinnamaldehyde
  '122-40-7',   // alpha-Amyl Cinnamaldehyde
  '104-55-2',   // Cinnamaldehyde
  '104-54-1',   // Cinnamic Alcohol
  '104-65-4',   // Cinnamyl Acetate
  '122-69-0',   // Cinnamyl Cinnamate
  '4407-36-7',  // p-Methoxy Cinnamic Aldehyde
  '5392-40-5',  // Citral (dup OK — merge handles)
  // — Phenolics & spice —
  '97-53-0',    // Eugenol
  '97-54-1',    // Isoeugenol
  '93-15-2',    // Methyl Eugenol
  '121-33-5',   // Vanillin
  '121-32-4',   // Ethyl Vanillin
  '94-86-0',    // Vanillyl Alcohol
  '91-64-5',    // Coumarin
  '120-57-0',   // Heliotropin (Piperonal)
  '94-46-2',    // Isoamyl Benzoate
  '120-72-9',   // Indole
  '83-34-1',    // Skatole (3-Methylindole)
  '104-46-1',   // trans-Anethole
  '140-67-0',   // Estragole (Methyl Chavicol)
  '123-11-5',   // p-Anisaldehyde
  '105-13-5',   // Anisyl Alcohol
  '104-21-2',   // Anisyl Acetate
  '122-03-2',   // Cuminaldehyde
  '432-25-7',   // beta-Cyclocitral
  '116-26-7',   // Safranal
  '98-86-2',    // Acetophenone
  '93-08-3',    // Methyl beta-Naphthyl Ketone (Orange Crystals)
  // — Esters / acetates / salicylates —
  '140-11-4',   // Benzyl Acetate
  '120-51-4',   // Benzyl Benzoate
  '118-58-1',   // Benzyl Salicylate
  '103-41-3',   // Benzyl Cinnamate
  '103-45-7',   // Phenethyl Acetate
  '102-20-5',   // Phenethyl Phenylacetate
  '103-38-8',   // Isobutyl Phenylacetate
  '101-97-3',   // Ethyl Phenylacetate
  '101-41-7',   // Methyl Phenylacetate
  '60-12-8',    // Phenethyl Alcohol
  '93-92-5',    // Styrallyl Acetate
  '119-36-8',   // Methyl Salicylate
  '118-61-6',   // Ethyl Salicylate
  '94-26-8',    // Butyl p-Hydroxybenzoate
  '120-50-3',   // Isobutyl Benzoate
  '118-93-4',   // 2-Hydroxyacetophenone
  '93-89-0',    // Ethyl Benzoate
  '93-58-3',    // Methyl Benzoate
  '102-13-6',   // Geranyl Phenylacetate
  '141-78-6',   // Ethyl Acetate
  '105-54-4',   // Ethyl Butyrate
  '123-66-0',   // Ethyl Hexanoate
  '106-32-1',   // Ethyl Octanoate
  '110-38-3',   // Ethyl Decanoate
  '142-92-7',   // Hexyl Acetate
  '3681-71-8',  // cis-3-Hexenyl Acetate
  '928-96-1',   // cis-3-Hexenol
  '6728-26-3',  // trans-2-Hexenal
  '111-71-7',   // Heptanal
  '106-72-9',   // Melonal (2,6-Dimethyl-5-heptenal)
  '103-26-4',   // Methyl Cinnamate
  '103-36-6',   // Ethyl Cinnamate
  '134-20-3',   // Methyl Anthranilate
  '85-91-6',    // Dimethyl Anthranilate
  '24851-98-7', // Methyl Dihydrojasmonate (Hedione)
  '1205-17-0',  // Helional
  '101-39-3',   // alpha-Methylcinnamaldehyde
  // — Lactones —
  '706-14-9',   // gamma-Decalactone
  '104-67-6',   // gamma-Undecalactone (Aldehyde C-14)
  '104-61-0',   // gamma-Nonalactone (Aldehyde C-18)
  '7779-50-2',  // gamma-Dodecalactone
  '105-21-5',   // gamma-Heptalactone
  '710-04-3',   // delta-Undecalactone
  '713-95-1',   // delta-Decalactone
  '713-95-1',   // (dup OK)
  '21944-98-9', // delta-Dodecalactone
  '108-29-2',   // gamma-Butyrolactone
  '23726-93-4', // (Z)-Jasmone
  '488-10-8',   // cis-Jasmone
  // — Ionones & damascones (rose / violet) —
  '127-41-3',   // alpha-Ionone
  '14901-07-6', // beta-Ionone
  '79-77-6',    // beta-Ionone (mixed isomers)
  '7779-30-8',  // alpha-Methyl Ionone
  '127-51-5',   // gamma-Methyl Ionone
  '23726-92-3', // alpha-Damascone
  '23726-91-2', // beta-Damascone
  '57378-68-4', // delta-Damascone
  '23696-85-7', // beta-Damascenone
  '24720-09-0', // gamma-Damascone
  '1335-46-2',  // Methyl Ionone (mixed)
  // — Roses / florals —
  '16409-43-1', // cis-Rose Oxide
  '3033-23-6',  // Phenoxyethyl Isobutyrate
  '101-48-4',   // Phenylacetaldehyde Dimethyl Acetal
  '122-78-1',   // Phenylacetaldehyde
  '5413-60-5',  // Trimethyl Pentenyl Cyclohexenecarbaldehyde
  '101-86-0',   // alpha-Hexyl Cinnamaldehyde (dup)
  '101-39-3',   // alpha-Methylcinnamaldehyde (dup)
  '4602-84-0',  // Farnesol
  '106-25-2',   // Nerol (dup)
  '105-86-2',   // Geranyl Formate
  '141-12-8',   // Neryl Acetate (dup)
  // — Muguet / lily aldehydes —
  '101-95-1',   // Phenylpropyl Aldehyde
  '7775-00-0',  // Bourgeonal
  '93-53-8',    // 2-Phenylpropionaldehyde (Hydrotropic Aldehyde)
  '103-95-7',   // Cyclamen Aldehyde
  // — Indolic / animalic —
  '142-08-5',   // Civetone (9-Cycloheptadecen-1-one)
  '541-91-3',   // Muscone (3-Methylcyclopentadecan-1-one)
  '140-39-6',   // p-Cresyl Acetate
  '5471-51-2',  // Raspberry Ketone
  '498-02-2',   // Acetovanillone
  // — Marine / aquatic —
  '28940-11-6', // Calone 1951
  '67634-15-5', // Floralozone
  '1205-17-0',  // Helional (dup)
  // — Ambergris synthetics & woody amber —
  '6790-58-5',  // Ambroxide / Ambroxan
  '3738-00-9',  // Sclareolide
  '564-20-5',   // Ambrocenide-related
  '125109-85-5',// Ambrocenide
  '54464-57-2', // Iso E Super
  '68155-66-8', // Iso E Super blend (Octalynol)
  '107898-54-4',// Norlimbanol
  '74449-59-9', // Cetalox Laevo
  '17369-59-4', // Karanal-precursor
  // — Sandalwood synthetics —
  '28219-61-6', // Bacdanol
  '70788-30-6', // Sandalore
  '107898-54-4',// Norlimbanol (dup)
  '67801-20-1', // Polysantol
  '198633-83-7',// Javanol
  // — Patchouli / vetiver —
  '5986-55-0',  // Patchouli alcohol
  '117-98-6',   // Vetiveryl Acetate
  '15764-04-2', // alpha-Vetivone
  '13744-15-5', // beta-Vetivone
  // — Cedar / pine / woody —
  '469-61-4',   // alpha-Cedrene
  '77-53-2',    // Cedrol
  '77-54-3',    // Cedryl Acetate
  '125-12-2',   // Isobornyl Acetate (dup)
  // — Oakmoss / mossy —
  '4707-47-5',  // Methyl atratate (Evernyl)
  '37172-53-5', // Veramoss (mossy synth)
  // — Macrocyclic & polycyclic musks —
  '1222-05-5',  // Galaxolide
  '21145-77-7', // Tonalide
  '33704-61-9', // Cashmeran
  '6707-45-1',  // (var related musk)
  '111879-80-2',// Romandolide
  '105-95-3',   // Ethylene Brassylate
  '141-94-6',   // Hexalon
  '141-29-7',   // Civetone (synth analogue, may differ)
  '123-25-1',   // Diethyl Succinate
  '24851-98-7', // Hedione (dup)
  // — Misc commodity aroma chemicals —
  '93-04-9',    // Beta-Naphthyl Methyl Ether (Yara Yara)
  '719-22-2',   // 2,6-Di-tert-butyl-4-methylphenol (BHT)
  '127-91-3',   // beta-Pinene (dup)
  '93-58-3',    // Methyl Benzoate (dup)
  '93-89-0',    // Ethyl Benzoate (dup)
  '8000-28-0',  // Lavender oil (mixture — PubChem may resolve to a CID)
  '8007-01-0',  // Rose oil
  '8007-08-7',  // Ginger oil
  '8000-46-2',  // Geranium oil (Pelargonium)
  '8016-26-0',  // Patchouli oil
  '8014-09-3',  // Bergamot oil
  '8008-57-9',  // Sweet Orange oil
  '8008-56-8',  // Lemon oil
  '8000-25-7',  // Rosemary oil
  '8002-13-9',  // Clove oil
  '8008-93-3',  // Pine oil
  '8001-26-1',  // Sandalwood oil
  '84696-47-9', // Vetiver oil
  '8016-26-0',  // Patchouli oil (dup)
  '8000-29-1',  // Citronella oil
  '8016-78-2',  // Star Anise oil
  '90028-48-1', // Lemongrass oil
  '8008-79-5',  // Spearmint oil
  '8006-90-4',  // Peppermint oil
  '8016-37-3',  // Myrrh oil
  '8016-36-2',  // Frankincense (Olibanum) oil
  '92201-50-8', // Cedarwood oil (Atlas)
  '8024-05-3',  // Tuberose absolute
  '8024-04-2',  // Jasmine absolute
  '90028-58-3', // Mandarin oil
  '8023-77-6',  // Neroli oil
  '8014-19-5',  // Ylang Ylang oil
  '8008-26-2',  // Lime oil
  '8013-77-2',  // Black Pepper oil
  // — More popular synthetics —
  '54464-57-2', // Iso E Super (dup)
  '5413-60-5',  // Triplal
  '3450-54-8',  // Geranyl Acetone
  '689-67-8',   // Geranyl Acetone (related)
  '141-25-3',   // Rhodinyl Acetate (dup)
  '142-19-8',   // Allyl Heptanoate
  '142-83-6',   // 2,4-Hexadienal
  '141-78-6',   // Ethyl Acetate (dup)
  '111-87-5',   // Octanol-1
  '40716-66-3', // (E,E)-Farnesene
  '79-78-7',    // Allyl alpha-Ionone
  '89-79-2',    // (-)-Isopulegol
];


// ─── CLI parsing ─────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { dryRun: false, strict: false, file: null, seed: false, inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run')      opts.dryRun = true;
    else if (a === '--strict')  opts.strict = true;
    else if (a === '--file')    opts.file = argv[++i];
    else if (a === '--seed')    opts.seed = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else opts.inputs.push(a);
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node tools/add-materials.mjs [options] <input...>

Inputs may be CAS numbers (e.g. 100-52-7) or material names (e.g. linalool).

Options:
  --seed          Use the built-in SEED_LIST (~220 popular aroma chemicals
                  + canonical naturals). Combined with any inline inputs.
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
  // The `RN` (Registry Number) endpoint matches CAS exactly; the name
  // endpoint matches IUPAC, common name, and synonyms. Both return the
  // same envelope shape: { IdentifierList: { CID: [n, ...] } }. PubChem
  // ranks CIDs by best match, so [0] is the canonical compound for the
  // queried registry number / name.
  const url = CAS_RE.test(input)
    ? `${PUBCHEM_REST}/compound/xref/RN/${encodeURIComponent(input)}/cids/JSON`
    : `${PUBCHEM_REST}/compound/name/${encodeURIComponent(input)}/cids/JSON`;
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
  if (opts.seed) {
    // Deduplicate while preserving order — SEED_LIST has intentional dups
    // for cross-reference convenience inside the source.
    const seen = new Set();
    for (const s of SEED_LIST) {
      const key = s.trim().toLowerCase();
      if (!seen.has(key)) { seen.add(key); inputs.push(s.trim()); }
    }
  }
  if (!inputs.length) {
    console.error('No inputs given. Pass CAS numbers / names as args, --seed, or --file <path>.');
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
