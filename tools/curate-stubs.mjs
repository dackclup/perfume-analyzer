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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(REPO_ROOT, 'data', 'materials.json');

// ─── Heuristic rules ─────────────────────────────────────────────────
//
// Order matters: first match wins. Each rule has a `re` (case-insensitive
// regex tested against name + synonyms + iupac), and an output bundle
// that overwrites the empty stub fields. `note` follows the analyzer's
// "Top / Middle / Base" notation (with " / " for spans).
//
// Family tokens MUST come from the existing primaryFamilies vocabulary
// so the analyzer's chip strip lights up correctly. Audit confirmed
// these tokens already exist in data: herbal, floral, woody, spicy,
// citrus, camphoraceous, green, gourmand, fruity, balsamic, musk,
// amber, aldehydic, floral_amber, aquatic.
const RULES = [
  // ── Macrocyclic musks (highest priority — must match before generic
  //    "lactone" rule below). Cyclopentadecane / hexadecanolide carbon
  //    rings + civetone / muscone / ambrettolide / exaltolide tokens.
  { re: /\b(macrocyclic|cyclopentadec|cyclohexadec|exaltolide|ambrettolide|civet[ot]ne?|muscone|musk\b|globalide|habanolide|romandolide|galaxolide|tonalide|cashmeran)/i,
    families: ['musk'], facets: ['musk'], type: 'Musk', strength: 'Medium', note: 'Base' },

  // ── Pyrazines (roasted, coffee, nutty)
  { re: /pyrazine\b/i,
    families: ['gourmand'], facets: ['roasted','nutty'], type: 'Roasted / Nutty', strength: 'High', note: 'Top / Middle' },

  // ── Furanones / maltol family (caramel, sweet, gourmand)
  { re: /\b(furaneol|maltol|cyclotene|sotolon|furan[-\s]?2\(?5h?\)?[-\s]?one)\b/i,
    families: ['gourmand'], facets: ['caramellic','sweet'], type: 'Caramellic / Sweet', strength: 'High', note: 'Middle / Base' },
  { re: /\bfuranone\b/i,
    families: ['gourmand'], facets: ['caramellic','sweet'], type: 'Caramellic / Sweet', strength: 'Medium', note: 'Middle / Base' },

  // ── Sulfur-containing (gourmand, savory, blackcurrant)
  { re: /\b(thiol|mercaptan|disulfide|sulfide|methional|methylthio|thi[oa]z[oi]le|thione|thioate)\b/i,
    families: ['gourmand'], facets: ['sulfurous','savory'], type: 'Sulfurous / Savory', strength: 'Very High', note: 'Top' },

  // ── Vanillin family (sweet, vanilla, balsamic) — includes acetovanillone,
  // acetoguaiacone, apocynin (all 4-hydroxy-3-methoxyphenyl variants).
  { re: /\b(vanill(in|yl|one)|piperonal|heliotropin|acetovanillone|acetoguaiacone|apocynin|hydroxy[\s-]?methoxy[\s-]?phenyl|4'?-?hydroxy-3'?-?methoxy)\b/i,
    families: ['gourmand'], facets: ['vanilla','sweet','powdery'], type: 'Vanilla / Sweet', strength: 'High', note: 'Base' },

  // ── Phenols (vinylphenol, hydroxybenzene variants, guaiacol-likes)
  { re: /\b(vinylphenol|hydroxyphenol|methylphenol|catechol|resorcinol|hydroquinone|hydroxyacetophenone|naphtho)\b/i,
    families: ['spicy','balsamic'], facets: ['phenolic','smoky','medicinal'], type: 'Phenolic / Smoky', strength: 'High', note: 'Middle / Base' },

  // ── Long-chain fatty alcohols (>= C13: tetradecanol, pentadecanol,
  // hexadecanol, octadecanol). Rich, waxy, soapy, near-musk threshold.
  { re: /\b(tetradecanol|pentadecanol|hexadecanol|heptadecanol|octadecanol|nonadecanol|cetyl[\s-]?alcohol|stearyl[\s-]?alcohol|cetearyl)\b/i,
    families: ['musk','green'], facets: ['waxy','fatty','soapy','musk'], type: 'Waxy / Fatty', strength: 'Low', note: 'Base' },

  // ── Coumarin family (hay, tonka, fougère core)
  { re: /\bcoumarin|dihydrocoumarin\b/i,
    families: ['gourmand','herbal'], facets: ['coumarinic','hay','tonka'], type: 'Coumarinic / Hay', strength: 'Medium', note: 'Middle / Base' },

  // ── Cinnamic / hexylcinnamic family (florals)
  { re: /\b(hexyl[\s-]?cinnamaldehyde|amyl[\s-]?cinnamaldehyde|cinnam(aldehyde|al))\b/i,
    families: ['floral','spicy'], facets: ['floral','jasmine','spicy'], type: 'Floral / Cinnamic', strength: 'Medium', note: 'Middle' },
  { re: /\bcinnam(yl|ate|ic)\b/i,
    families: ['spicy','balsamic'], facets: ['cinnamon','balsamic'], type: 'Spicy / Cinnamic', strength: 'Medium', note: 'Middle / Base' },

  // ── Damascones / Ionones / Iso E family (floral, woody-floral)
  { re: /\b(damascone|damascenone|ionone|methyl[\s-]?ionone)\b/i,
    families: ['floral'], facets: ['violet','rosy','floral'], type: 'Floral / Violet', strength: 'Very High', note: 'Middle' },
  { re: /\biso[\s-]?e[\s-]?super\b/i,
    families: ['woody'], facets: ['woody','ambery','smooth'], type: 'Woody / Ambery', strength: 'High', note: 'Middle / Base' },

  // ── Mint / camphoraceous (carvone, menthol, etc.)
  { re: /\b(carvone|menthol|menthone|pulegone|piperitone|verbenone|carveol|cineole|eucalyptol|borneol|camphor|isopulegol|terpinen-?4-ol|alpha[-\s]?terpineol)\b/i,
    families: ['camphoraceous','herbal'], facets: ['mint','camphor','herbal'], type: 'Mint / Camphoraceous', strength: 'High', note: 'Top / Middle' },

  // ── Phenolic / spicy (eugenol family)
  { re: /\b(eugenol|isoeugenol|methyl[\s-]?eugenol|guaiacol|carvacrol|chavicol|thymol)\b/i,
    families: ['spicy'], facets: ['clove','phenolic','spicy'], type: 'Spicy / Phenolic', strength: 'High', note: 'Middle / Base' },

  // ── Salicylates (balsamic, sun-tan)
  { re: /\bsalicylate\b/i,
    families: ['balsamic','floral'], facets: ['salicylate','balsamic','sun-tan'], type: 'Balsamic / Salicylate', strength: 'Medium', note: 'Middle / Base' },

  // ── Ambergris synthetics
  { re: /\b(ambroxide|ambroxan|cetalox|sclareolide|ambrocenide|norlimbanol|ambrofuran|ambermax)\b/i,
    families: ['amber','woody'], facets: ['ambergris','dry-amber','woody'], type: 'Ambery / Woody', strength: 'High', note: 'Base' },

  // ── Sandalwood synthetics
  { re: /\b(sandalore|javanol|polysantol|brahmanol|bacdanol|santal(ol|ene))\b/i,
    families: ['woody'], facets: ['sandalwood','creamy-wood'], type: 'Woody / Sandalwood', strength: 'Medium', note: 'Base' },

  // ── Patchouli / vetiver
  { re: /\bpatchouli|patchoulol\b/i,
    families: ['woody'], facets: ['patchouli','earthy','woody'], type: 'Woody / Earthy', strength: 'Very High', note: 'Base' },
  { re: /\bvetiv(er|one|ol|yl)\b/i,
    families: ['woody'], facets: ['vetiver','smoky','woody'], type: 'Woody / Smoky', strength: 'Very High', note: 'Base' },

  // ── Cedar / cedrol
  { re: /\b(cedrol|cedrene|cedryl)\b/i,
    families: ['woody'], facets: ['cedar','dry-wood'], type: 'Woody / Cedar', strength: 'Medium', note: 'Base' },

  // ── Rose oxides / muguet aldehydes
  { re: /\brose[\s-]?oxide\b/i,
    families: ['floral'], facets: ['rose','green-floral'], type: 'Floral / Rose', strength: 'Medium', note: 'Middle' },
  { re: /\b(bourgeonal|cyclamen[\s-]?aldehyde|hydroxycitronellal|lyral|lilial|florhydral|helional)\b/i,
    families: ['floral'], facets: ['muguet','lily-of-the-valley','floral'], type: 'Floral / Muguet', strength: 'Medium', note: 'Middle' },

  // ── Indolic / animalic
  { re: /\b(indole|skatole|civet|para[\s-]?cresyl|p[\s-]?cresol|methyl[\s-]?anthranilate|dimethyl[\s-]?anthranilate)\b/i,
    families: ['floral'], facets: ['indolic','animalic','narcotic'], type: 'Indolic / Animalic', strength: 'Very High', note: 'Middle / Base' },

  // ── Lactones (fruity, creamy, peach)
  { re: /\blactone|gamma[\s-]?(deca|nona|undeca|dodeca|hepta)lactone|delta[\s-]?(deca|undeca|dodeca)lactone/i,
    families: ['fruity','gourmand'], facets: ['lactonic','peach','creamy'], type: 'Lactonic / Fruity', strength: 'Medium', note: 'Middle / Base' },
  { re: /\bjasmon(e|ate|oid)|methyl\s+dihydrojasmonate|hedione/i,
    families: ['floral'], facets: ['jasmine','floral','fresh'], type: 'Floral / Jasmine', strength: 'Medium', note: 'Middle' },

  // ── Aldehydes (citrus / fatty / floral)
  { re: /\b(citral|citronellal|geranial|neral|cyclocitral)\b/i,
    families: ['citrus','aldehydic'], facets: ['citrus','lemon','aldehydic'], type: 'Aldehydic / Citrus', strength: 'Very High', note: 'Top' },
  { re: /\b(decanal|nonanal|octanal|undecanal|dodecanal|heptanal|hexanal|tridecanal|2[\s-]?methyl(undecanal|nonanal|decanal)|aldehyde\s+c-?\d+|\d+[\s-]?undecenal|undecylenic|10[\s-]?undecenal|tetradecanal)\b/i,
    families: ['aldehydic'], facets: ['aldehydic','fatty','soapy'], type: 'Aldehydic / Fatty', strength: 'Very High', note: 'Top' },
  { re: /\b(hexenal|hexen-1-al|2[\s-]?hexenal|3[\s-]?hexenal|pent[\s-]?2[\s-]?enal|hex[\s-]?2[\s-]?enal|oct[\s-]?2[\s-]?enal)\b/i,
    families: ['green','aldehydic'], facets: ['green','leafy','aldehydic'], type: 'Green / Leafy', strength: 'Very High', note: 'Top' },
  { re: /\b(anisaldehyde|cuminaldehyde|cuminyl[\s-]?acetaldehyde|safranal|veratraldehyde|methylcinnam(aldehyde|al))\b/i,
    families: ['aldehydic','spicy'], facets: ['aldehydic','spicy','anise'], type: 'Aldehydic / Spicy', strength: 'High', note: 'Middle' },
  // Catch-all for -dienal (deca-2,4-dienal, hexa-2,4-dienal etc.)
  { re: /[a-z]+\s*-?\s*\d?\s*,?\s*\d?\s*-?\s*dienal\b/i,
    families: ['aldehydic','green'], facets: ['aldehydic','green','fatty'], type: 'Aldehydic / Green', strength: 'Very High', note: 'Top' },
  // Catch-all for -enal (any en-al or en-1-al unsaturated aldehyde)
  { re: /\b\w+[\s-]?\d*[\s-]?enal\b|\b(dec|oct|non|undec|dodec|hexa|hepta|pent|tetradec|hexadec)[\s-]?\d*[\s-]?enal\b|\b4[\s-]?dodecen[\s-]?1[\s-]?al\b|\b\d+\w*[\s-]?\d*[\s-]?en[\s-]?1[\s-]?al\b/i,
    families: ['aldehydic'], facets: ['aldehydic','fatty'], type: 'Aldehydic / Fatty', strength: 'High', note: 'Top' },
  // Generic aldehyde / acetaldehyde / carbaldehyde catch-all (last resort
  // for -aldehyde tokens). Word-boundary OFF so "X-acetaldehyde" or
  // "X-aldehyde" inside a compound name still matches.
  { re: /(acet)?aldehyde|carbaldehyde/i,
    families: ['aldehydic'], facets: ['aldehydic'], type: 'Aldehydic', strength: 'High', note: 'Top' },

  // ── Linalool / floral terpenes
  { re: /\b(linalool|linaly|nerolidol|nerol|neryl|geraniol|geranyl|citronellol|citronellyl|terpineol|farnesol|tetrahydromyrcenol|dihydromyrcenol|rhodinol|peruviol)\b/i,
    families: ['floral','herbal'], facets: ['floral','terpenic','rosy'], type: 'Floral / Terpenic', strength: 'Medium', note: 'Top / Middle' },

  // ── Sesquiterpenes (cubebene, caryophyllene, humulene, bisabolene)
  { re: /\b(cubebene|caryophyllene|humulene|bisabolene|elemene|cadinene|guaiene)\b/i,
    families: ['woody','herbal'], facets: ['woody','spicy','green'], type: 'Woody / Sesquiterpene', strength: 'Medium', note: 'Middle / Base' },

  // ── Acetophenone family (aromatic ketones — sweet, hawthorn-like)
  { re: /\b(acetophenone|hydroxyacetophenone|acetylphenol|acetonaphthone|acetylnaphthalene|methoxynaphthalene|hydroxyphenyl[\s-]?ethanone|propiophenone)\b/i,
    families: ['floral'], facets: ['hawthorn','aromatic-ketone','sweet'], type: 'Aromatic / Ketone', strength: 'Medium', note: 'Middle' },

  // ── Citrus monoterpenes
  { re: /\b(limonene|pinene|myrcene|cymene|terpinene|sabinene|terpinolene|phellandrene|camphene|ocimene|carene)\b/i,
    families: ['citrus','herbal'], facets: ['citrus','terpenic','fresh'], type: 'Citrus / Terpenic', strength: 'High', note: 'Top' },

  // ── Phenyl ethyl / phenyl propyl florals
  { re: /\b(phen(yl)?eth(yl|anol|anal)|phenethyl|phenylacetaldehyde|hydroxyphenylbutanone|raspberry\s+ketone|frambinone|2[\s-]?phenoxyethanol)\b/i,
    families: ['floral'], facets: ['rosy','honey','floral'], type: 'Floral / Rosy', strength: 'Medium', note: 'Middle' },

  // ── Acetals / ortho esters (typically green / fresh)
  { re: /\b(dimethoxy|diethoxy|acetal|orthoester|orthoformate)\b/i,
    families: ['green','fruity'], facets: ['green','fresh','clean'], type: 'Green / Fresh', strength: 'Medium', note: 'Top / Middle' },

  // ── Esters (fruity / gourmand depending on backbone)
  { re: /\b(\w+yl\s+(acetate|butyrate|hexanoate|heptanoate|octanoate|nonanoate|decanoate|propionate|formate|caproate|laurate|isobutyrate|valerate|isovalerate)|\w+yl[\s-]?\w+oate)\b/i,
    families: ['fruity'], facets: ['fruity','ester'], type: 'Fruity / Ester', strength: 'Medium', note: 'Top / Middle' },

  // ── Aliphatic alcohols (fatty, soapy, green at low MW). Two patterns:
  // numeric "1-octanol" form, then plain "hexanol"/"isoamyl alcohol".
  { re: /\b(\d[\s-]?(hexan|heptan|octan|nonan|decan|undecan|dodecan|tridecan)ol|hexan[-\s]?1[-\s]?ol|octen[-\s]?3[-\s]?ol)\b/i,
    families: ['green'], facets: ['fatty','soapy','green'], type: 'Fatty / Soapy', strength: 'Medium', note: 'Top / Middle' },
  { re: /\b(octanol|decanol|dodecanol|heptanol|hexanol|undecanol|nonanol|isoamyl[\s-]?alcohol|methylbutanol|methylpropanol)\b/i,
    families: ['green'], facets: ['fatty','soapy','green'], type: 'Fatty / Soapy', strength: 'Medium', note: 'Top / Middle' },

  // ── Aliphatic acids (fatty, sour, cheesy)
  { re: /\b(hexanoic|octanoic|decanoic|propanoic|butanoic|valeric|isovaleric|caproic|caprylic|capric|undecanoic|dodecanoic|lauric|palmitic|stearic|abietic)\s*acid|\bacetic\s+acid\b/i,
    families: ['gourmand'], facets: ['fatty','sour','cheesy'], type: 'Fatty / Sour', strength: 'High', note: 'Middle' },

  // ── Earthy / mossy
  { re: /\b(geosmin|2[\s-]?methylisoborneol|octen[\s-]?3[\s-]?one|naphthol)\b/i,
    families: ['herbal'], facets: ['earthy','soil','mossy'], type: 'Earthy / Mossy', strength: 'Very High', note: 'Middle / Base' },

  // ── Diketones (buttery, cheesy, popcorn)
  { re: /\b(diacetyl|acetoin|2[\s-]?butanone|butanedione)\b/i,
    families: ['gourmand'], facets: ['buttery','dairy','popcorn'], type: 'Buttery / Dairy', strength: 'Very High', note: 'Top' },

  // ── Misc aromatics (anisole, veratrole) — ether-aromatic notes
  { re: /\b(anisole|methoxybenzene|veratrole|dimethoxybenzene)\b/i,
    families: ['herbal'], facets: ['anise','sweet-aromatic'], type: 'Anisic / Aromatic', strength: 'Medium', note: 'Middle' },

  // ── Trimethylamine / nitrogen-bases (fishy / animalic — niche)
  { re: /\btrimethylamine|methylamine|ethylamine\b/i,
    families: ['gourmand'], facets: ['amine','fishy','animalic'], type: 'Amine / Animalic', strength: 'Very High', note: 'Top' },
];

// ─── Driver ─────────────────────────────────────────────────────────
function isStub(entry) {
  return !entry.classification?.primaryFamilies?.length
      && !entry.odor?.type
      && !entry.note;
}

function searchString(entry) {
  const parts = [
    entry.name || '',
    entry.iupac || '',
    ...(entry.synonyms || []),
  ];
  return parts.join(' | ').toLowerCase();
}

// MW-based note fallback when keyword didn't match
function noteFromMw(weightStr) {
  const mw = parseFloat(weightStr);
  if (!isFinite(mw) || mw <= 0) return '';
  if (mw < 130) return 'Top';
  if (mw < 220) return 'Middle';
  return 'Base';
}

function classify(entry) {
  const haystack = searchString(entry);
  for (const rule of RULES) {
    if (rule.re.test(haystack)) {
      return {
        rule: rule.re.source.slice(0, 60),
        families: rule.families,
        facets: rule.facets,
        type: rule.type,
        strength: rule.strength,
        note: rule.note,
      };
    }
  }
  return null;
}

function applyMatch(entry, match) {
  // Only fill empty fields — never overwrite curated data
  if (!entry.classification) entry.classification = { primaryFamilies: [], secondaryFamilies: [], facets: [] };
  if (!entry.classification.primaryFamilies?.length) entry.classification.primaryFamilies = [...match.families];
  if (!entry.classification.facets?.length)          entry.classification.facets          = [...match.facets];
  if (!entry.odor) entry.odor = { description: '', type: '', strength: '' };
  if (!entry.odor.type)     entry.odor.type     = match.type;
  if (!entry.odor.strength) entry.odor.strength = match.strength;
  if (!entry.note)          entry.note          = match.note;
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
    const m = classify(entry);
    if (m) {
      applyMatch(entry, m);
      matched.push({ cas: entry.cas, name: entry.name, families: m.families, type: m.type, note: m.note });
    } else {
      // Fall back to MW-derived note even when family stays empty —
      // gives the analyzer enough metadata to keep these out of the
      // "no note" bucket without committing to a misclassification.
      const mwNote = noteFromMw(entry.weight);
      if (mwNote && !entry.note) entry.note = mwNote;
      missed.push({ cas: entry.cas, name: entry.name, weight: entry.weight, note: entry.note || '' });
    }
  }

  process.stderr.write(`Stubs scanned: ${stubs.length}\n`);
  process.stderr.write(`Matched (classified): ${matched.length}\n`);
  process.stderr.write(`Missed (note-only fallback): ${missed.length}\n`);

  if (report) {
    process.stdout.write('\n=== MATCHED ===\n');
    for (const m of matched) process.stdout.write(`  ${m.cas.padEnd(12)} ${m.name.padEnd(40)} → ${m.families.join(',')} | ${m.type} | ${m.note}\n`);
    process.stdout.write('\n=== MISSED (still need curation) ===\n');
    for (const m of missed) process.stdout.write(`  ${m.cas.padEnd(12)} ${m.name.padEnd(40)} (MW=${m.weight}, note=${m.note})\n`);
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

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
