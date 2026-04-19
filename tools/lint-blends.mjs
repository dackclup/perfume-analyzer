#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// tools/lint-blends.mjs — Blends-with audit / linter
//
// Usage:
//   node tools/lint-blends.mjs            # text report to stdout
//   node tools/lint-blends.mjs --json     # structured JSON
//   node tools/lint-blends.mjs --fix-dry  # preview suggested auto-fixes
//
// Checks against perfumery_data.js:
//   (a) Self-reference    — material listed in its own blends_with
//   (b) Unresolved labels — not canonical / synonym / trade / shorthand
//                           / group-known; needs curation or shorthand
//   (c) Broken reciprocity — A → B (resolvable) but B lacks A
//   (d) Group shorthand drift — label that resolves to a DB row whose
//       canonical name differs, e.g. "rose" → "Rose Oil"; a specific
//       canonical would round-trip cleanly on Obsidian / CSV exports.
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "..", "perfumery_data.js");

// ── Resolution tables (mirror of the ones inlined in index.html)
// Keep in sync with BLEND_SHORTHAND_TO_CAS / BLEND_GROUP_TO_FILTER.
const BLEND_SHORTHAND_TO_CAS = {
  "lavender":"8000-28-0","lavender absolute":"97722-12-8","lavandin":"91722-69-9",
  "lavandin grosso":"91722-69-9","clary sage":"8016-63-5","rose":"8007-01-0",
  "jasmine":"8022-96-6","ylang":"8006-81-3","ylang ylang":"8006-81-3","bergamot":"8007-75-8",
  "patchouli":"8014-09-3","vetiver":"8016-96-4","sandalwood":"8006-87-9","cedarwood":"8000-27-9",
  "cedar":"8000-27-9","neroli":"8016-38-4","frankincense":"8016-36-2","myrrh":"8016-37-3",
  "clove":"8000-34-8","cinnamon":"8015-91-6","rosemary":"8000-25-7","peppermint":"8006-90-4",
  "eucalyptus":"8000-48-4","geranium":"8000-46-2","lemon":"8008-56-8","orange":"8008-57-9",
  "grapefruit":"8016-20-4","lime":"8008-26-2","chamomile":"8015-92-7","tea tree":"68647-73-4",
  "oakmoss":"9000-50-4","labdanum":"8016-26-0","benzoin":"9000-72-0","peru balsam":"8007-00-9",
  "tolu balsam":"9000-64-0","rosewood":"78-70-6","tonka":"91-64-5","tonka bean":"91-64-5",
  "musk":"541-91-3","vanilla":"121-33-5",
};
const BLEND_GROUP_TOKENS = new Set([
  "citrus oils","citrus","green notes","green","florals","floral notes",
  "musks","woods","aldehydes","aldehydic","amber",
]);

// ── Load DB
const raw = fs.readFileSync(DB_PATH, "utf8");
const data = JSON.parse(raw.replace(/^const PERFUMERY_DATA\s*=\s*/, "").replace(/;\s*$/, ""));
const db = data.perfumery_db;
const trades = data.trade_names || {};

// Indexes
const DB = {}; for (const e of db) DB[e.cas] = e;
const NAME_TO_CAS = {};
for (const e of db) for (const s of e.synonyms || []) NAME_TO_CAS[String(s).toLowerCase()] = e.cas;

function resolve(raw) {
  // Accept enhanced schema {label, cas?, strength?, source?} per
  // Improvement #6, plus legacy plain string.
  let label = "";
  let explicitCas = null;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    label = String(raw.label == null ? "" : raw.label).trim();
    if (raw.cas) explicitCas = String(raw.cas);
  } else {
    label = String(raw == null ? "" : raw).trim();
  }
  if (!label) return { kind: "empty" };
  if (explicitCas && DB[explicitCas]) return { kind: "material", cas: explicitCas, name: DB[explicitCas].name, via: "explicit_cas" };
  const lk = label.toLowerCase();
  for (const e of db) if (e.name.toLowerCase() === lk) return { kind: "material", cas: e.cas, name: e.name, via: "canonical" };
  if (NAME_TO_CAS[lk]) return { kind: "material", cas: NAME_TO_CAS[lk], name: DB[NAME_TO_CAS[lk]].name, via: "synonym" };
  if (trades[lk] && DB[trades[lk]]) return { kind: "material", cas: trades[lk], name: DB[trades[lk]].name, via: "trade" };
  if (BLEND_SHORTHAND_TO_CAS[lk] && DB[BLEND_SHORTHAND_TO_CAS[lk]]) {
    return { kind: "material", cas: BLEND_SHORTHAND_TO_CAS[lk], name: DB[BLEND_SHORTHAND_TO_CAS[lk]].name, via: "shorthand" };
  }
  if (BLEND_GROUP_TOKENS.has(lk)) return { kind: "group", label };
  return { kind: "unresolved", label };
}

// ── Partner-quality helpers (match the runtime sanitiser at
//    index.html:_isPartnerProhibited / _isPartnerPerfumery /
//    _partnerIncompatibility).
const RE_ODORLESS = /\b(odor(less)?|odourless|no\s+odor|no\s+odour|without\s+odor)\b/i;
function hasRealOdor(entry) {
  const desc = entry?.odor?.description || '';
  return !!(desc && !RE_ODORLESS.test(desc));
}
function isProhibited(entry) {
  const ifra = (entry?.safety?.ifra || '').toLowerCase();
  const clean = ifra.replace(/\bno\s+prohibit\w*/g, '').replace(/\bnot\s+prohibit\w*/g, '');
  if (/\bprohibit(ed|ion)?\b/.test(clean)) return true;
  if (/\bmust\s+not\s+be\s+used\b/.test(clean)) return true;
  return false;
}

// Chemical incompatibility table — keep in sync with
// index.html:MATERIAL_GROUPS + INCOMPATIBLE_PAIRS_HIGH.
const MATERIAL_GROUPS = new Map([
  ["134-20-3", new Set(["primary_amine"])],
  ["87-25-2",  new Set(["primary_amine"])],
  ["85-91-6",  new Set(["secondary_amine"])],
  ["120-72-9", new Set(["secondary_amine"])],
  ["83-34-1",  new Set(["secondary_amine"])],
  ["5392-40-5", new Set(["aldehyde"])],
  ["106-23-0",  new Set(["aldehyde"])],
  ["100-52-7",  new Set(["aldehyde"])],
  ["104-55-2",  new Set(["aldehyde"])],
  ["101-86-0",  new Set(["aldehyde"])],
  ["122-40-7",  new Set(["aldehyde"])],
  ["120-57-0",  new Set(["aldehyde"])],
  ["121-33-5",  new Set(["aldehyde","phenol"])],
  ["121-32-4",  new Set(["aldehyde","phenol"])],
  ["107-75-5",  new Set(["aldehyde","alcohol"])],
  ["124-13-0",  new Set(["aldehyde"])],
  ["112-31-2",  new Set(["aldehyde"])],
  ["112-54-9",  new Set(["aldehyde"])],
  ["124-19-6",  new Set(["aldehyde"])],
  ["112-44-7",  new Set(["aldehyde"])],
  ["31906-04-4",new Set(["aldehyde","alcohol"])],
  ["1205-17-0", new Set(["aldehyde"])],
  ["103-95-7",  new Set(["aldehyde"])],
  ["123-11-5",  new Set(["aldehyde","phenol"])],
  ["122-78-1",  new Set(["aldehyde"])],
  ["104-53-0",  new Set(["aldehyde"])],
  ["141-27-5",  new Set(["aldehyde"])],
  ["432-25-7",  new Set(["aldehyde"])],
  ["126-15-8",  new Set(["aldehyde"])],
]);
function detectGroupsByName(name) {
  const out = new Set();
  if (!name) return out;
  const n = name.toLowerCase();
  if (/\bdimethyl[- ]?anthranilate\b|n-methyl[- ]?anthranilate/.test(n)) out.add("secondary_amine");
  else if (/\banthranilate\b/.test(n)) out.add("primary_amine");
  if (/\b(indole|skatole|quinoline)\b/.test(n)) out.add("secondary_amine");
  if (/\b(mercapto|thiol|mercaptan|thio[- ]?acetate|sulfanyl)\b/.test(n)) out.add("thiol");
  if (/(aldehyde|cinnamaldehyde|citral|citronellal|heliotropin|vanillin|helional|hexenal|nonanal|octanal|decanal|undecanal|dodecanal|tridecanal|lauric\s+aldehyde)/i.test(n)) out.add("aldehyde");
  if (/\b(eugenol|isoeugenol|thymol|guaiacol|carvacrol|chavicol|cresol|vanillin|methyl\s+salicylate|eugen|phenol)\b/.test(n)) out.add("phenol");
  return out;
}
function materialGroups(cas) {
  return MATERIAL_GROUPS.get(cas) || detectGroupsByName(DB[cas]?.name || "");
}
const INCOMPATIBLE_PAIRS_HIGH = [
  ["aldehyde", "primary_amine", "Schiff base"],
  ["aldehyde", "thiol",         "Hemithioacetal"],
];
function partnerIncompatibility(sourceCas, partnerCas) {
  const a = materialGroups(sourceCas);
  const b = materialGroups(partnerCas);
  if (!a.size || !b.size) return null;
  for (const [gA, gB, reaction] of INCOMPATIBLE_PAIRS_HIGH) {
    if ((a.has(gA) && b.has(gB)) || (a.has(gB) && b.has(gA))) return { pair: gA + "+" + gB, reaction };
  }
  return null;
}

// ── Checks
const findings = {
  selfref:         [],
  unresolved:      [],
  reciprocity:     [],
  shorthandDrift:  [],
  duplicateCas:    [],   // same partner CAS appears twice in one list
  prohibitedPartner: [], // partner is IFRA-prohibited
  incompatiblePair: [],  // HIGH-severity reactive pair (Schiff base etc.)
  nonPerfumery:    [],   // partner is a solvent / carrier / vehicle
  inconsistentCas: [],   // enhanced {cas} disagrees with label's resolved CAS
};

for (const e of db) {
  const from = e.name;
  const blends = Array.isArray(e.blends_with) ? e.blends_with : [];
  const seenCasLocal = new Set();
  for (const raw of blends) {
    const r = resolve(raw);
    if (r.kind === "empty") continue;
    const rawLabel = (raw && typeof raw === "object") ? String(raw.label || "") : String(raw);
    // Enhanced-schema sanity
    if (raw && typeof raw === "object" && raw.cas && r.kind === "material" && r.cas !== raw.cas) {
      findings.inconsistentCas.push({ cas: e.cas, name: from, label: rawLabel, declared: raw.cas, resolved: r.cas });
    }
    if (r.kind === "material" && r.cas === e.cas) {
      findings.selfref.push({ cas: e.cas, name: from, label: rawLabel });
      continue;
    }
    if (r.kind === "unresolved") {
      findings.unresolved.push({ cas: e.cas, name: from, label: r.label });
      continue;
    }
    if (r.kind === "material" && r.via === "shorthand" && rawLabel.trim().toLowerCase() !== r.name.toLowerCase()) {
      findings.shorthandDrift.push({ cas: e.cas, name: from, label: rawLabel, canonical: r.name, targetCas: r.cas });
    }
    if (r.kind === "material") {
      if (seenCasLocal.has(r.cas)) {
        findings.duplicateCas.push({ cas: e.cas, name: from, label: rawLabel, targetCas: r.cas, targetName: r.name });
        continue;
      }
      seenCasLocal.add(r.cas);
      const partnerEntry = DB[r.cas];
      if (partnerEntry && isProhibited(partnerEntry)) {
        findings.prohibitedPartner.push({ cas: e.cas, name: from, label: rawLabel, targetCas: r.cas, targetName: r.name });
      }
      const incompat = partnerIncompatibility(e.cas, r.cas);
      if (incompat) {
        findings.incompatiblePair.push({ cas: e.cas, name: from, label: rawLabel, targetCas: r.cas, targetName: r.name, reaction: incompat.reaction });
      }
      if (partnerEntry && !hasRealOdor(partnerEntry)) {
        findings.nonPerfumery.push({ cas: e.cas, name: from, label: rawLabel, targetCas: r.cas, targetName: r.name });
      }
    }
    if (r.kind === "material") {
      const partner = DB[r.cas];
      const partnerBlends = (partner.blends_with || []).map(x => (x && typeof x === "object") ? String(x.label || "").toLowerCase() : String(x).toLowerCase());
      const fromLC = from.toLowerCase();
      const hit = partnerBlends.some(l => {
        if (l === fromLC) return true;
        const rr = resolve(l);
        return rr.kind === "material" && rr.cas === e.cas;
      });
      if (!hit) findings.reciprocity.push({ from, fromCas: e.cas, to: r.name, toCas: r.cas, via: r.via });
    }
  }
}

// ── Aggregate stats
const totalLinks = db.reduce((n, e) => n + (Array.isArray(e.blends_with) ? e.blends_with.length : 0), 0);
const resolved = { material: 0, group: 0, unresolved: 0, empty: 0 };
const byVia = { canonical: 0, synonym: 0, trade: 0, shorthand: 0 };
for (const e of db) for (const raw of e.blends_with || []) {
  const r = resolve(raw);
  resolved[r.kind]++;
  if (r.kind === "material") byVia[r.via]++;
}

// ── Unresolved label frequency
const unresolvedFreq = new Map();
for (const u of findings.unresolved) unresolvedFreq.set(u.label.toLowerCase(), (unresolvedFreq.get(u.label.toLowerCase()) || 0) + 1);
const topUnresolved = [...unresolvedFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);

// ── Output
const args = process.argv.slice(2);
if (args.includes("--json")) {
  console.log(JSON.stringify({ totalLinks, resolved, byVia, findings, topUnresolved }, null, 2));
  process.exit(0);
}

function hr(char = "─", n = 68) { return char.repeat(n); }
console.log(hr("═"));
console.log(" Blends-with lint report — " + db.length + " materials, " + totalLinks + " link slots");
console.log(hr("═"));

console.log("\nResolution:");
console.log("  material:   " + resolved.material + "  (canonical " + byVia.canonical + ", synonym " + byVia.synonym + ", trade " + byVia.trade + ", shorthand " + byVia.shorthand + ")");
console.log("  group:      " + resolved.group);
console.log("  unresolved: " + resolved.unresolved);

console.log("\n" + hr());
console.log(" (a) Self-reference:  " + findings.selfref.length);
console.log(hr());
if (findings.selfref.length) {
  for (const s of findings.selfref.slice(0, 10)) console.log("  " + s.cas.padEnd(12) + s.name + "  ← lists itself as \"" + s.label + "\"");
  if (findings.selfref.length > 10) console.log("  … +" + (findings.selfref.length - 10) + " more");
}

console.log("\n" + hr());
console.log(" (b) Unresolved labels: " + findings.unresolved.length + " (" + topUnresolved.length + " distinct)");
console.log(hr());
if (topUnresolved.length) {
  console.log("  Top 25 most-frequent unresolved labels (suggest curating):");
  for (const [lbl, n] of topUnresolved) console.log("    " + String(n).padStart(4) + "  " + lbl);
}

console.log("\n" + hr());
console.log(" (c) Broken reciprocity: " + findings.reciprocity.length);
console.log(hr());
if (findings.reciprocity.length) {
  console.log("  (these surface automatically via REVERSE_BLENDS_INDEX at runtime,");
  console.log("   but curating both sides keeps CSV/JSON/Obsidian exports complete)");
  const sample = findings.reciprocity.slice(0, 15);
  for (const r of sample) console.log("    " + r.from + "  →  " + r.to + "    (" + r.to + " missing " + r.from + ")");
  if (findings.reciprocity.length > 15) console.log("    … +" + (findings.reciprocity.length - 15) + " more");
}

console.log("\n" + hr());
console.log(" (d) Shorthand that should be canonical: " + findings.shorthandDrift.length);
console.log(hr());
if (findings.shorthandDrift.length) {
  console.log("  Consider replacing shorthand labels with canonical names for");
  console.log("  clean Obsidian wiki-links and CSV reporting:");
  const sample = findings.shorthandDrift.slice(0, 15);
  for (const r of sample) console.log("    " + r.name + ":  \"" + r.label + "\"  →  \"" + r.canonical + "\"  (" + r.targetCas + ")");
  if (findings.shorthandDrift.length > 15) console.log("    … +" + (findings.shorthandDrift.length - 15) + " more");
}

console.log("\n" + hr());
console.log(" (e) Duplicate CAS in same list: " + findings.duplicateCas.length);
console.log(hr());
if (findings.duplicateCas.length) {
  console.log("  Both labels resolve to the same partner CAS — keep one:");
  const sample = findings.duplicateCas.slice(0, 10);
  for (const r of sample) console.log("    " + r.name + ":  \"" + r.label + "\"  duplicates  \"" + r.targetName + "\"  (" + r.targetCas + ")");
  if (findings.duplicateCas.length > 10) console.log("    … +" + (findings.duplicateCas.length - 10) + " more");
}

console.log("\n" + hr());
console.log(" (f) Prohibited partner listed: " + findings.prohibitedPartner.length);
console.log(hr());
if (findings.prohibitedPartner.length) {
  console.log("  Partner is IFRA-prohibited — drop from blends_with:");
  const sample = findings.prohibitedPartner.slice(0, 10);
  for (const r of sample) console.log("    " + r.name + "  →  " + r.targetName + "  (" + r.targetCas + ")");
  if (findings.prohibitedPartner.length > 10) console.log("    … +" + (findings.prohibitedPartner.length - 10) + " more");
}

console.log("\n" + hr());
console.log(" (i) Chemically-incompatible partner (HIGH reactive): " + findings.incompatiblePair.length);
console.log(hr());
if (findings.incompatiblePair.length) {
  console.log("  Source + partner form a HIGH-severity reactive pair.");
  console.log("  Drop from blends_with; the sanitiser filters them at runtime:");
  const sample = findings.incompatiblePair.slice(0, 10);
  for (const r of sample) console.log("    " + r.name + "  →  " + r.targetName + "   (" + r.reaction + ")");
  if (findings.incompatiblePair.length > 10) console.log("    … +" + (findings.incompatiblePair.length - 10) + " more");
}

console.log("\n" + hr());
console.log(" (g) Non-perfumery partner (solvent / carrier): " + findings.nonPerfumery.length);
console.log(hr());
if (findings.nonPerfumery.length) {
  console.log("  Partner has no olfactive description — likely a solvent");
  console.log("  or vehicle, not a meaningful blend partner:");
  const sample = findings.nonPerfumery.slice(0, 10);
  for (const r of sample) console.log("    " + r.name + "  →  " + r.targetName + "  (" + r.targetCas + ")");
  if (findings.nonPerfumery.length > 10) console.log("    … +" + (findings.nonPerfumery.length - 10) + " more");
}

console.log("\n" + hr());
console.log(" (h) Inconsistent declared CAS: " + findings.inconsistentCas.length);
console.log(hr());
if (findings.inconsistentCas.length) {
  console.log("  Enhanced entry's {cas} doesn't match the label's resolved CAS:");
  const sample = findings.inconsistentCas.slice(0, 10);
  for (const r of sample) console.log("    " + r.name + ":  \"" + r.label + "\"  declared " + r.declared + " vs resolved " + r.resolved);
  if (findings.inconsistentCas.length > 10) console.log("    … +" + (findings.inconsistentCas.length - 10) + " more");
}

console.log("\n" + hr("═"));
console.log(" Summary:");
console.log("   selfref=" + findings.selfref.length +
            "  unresolved=" + findings.unresolved.length +
            "  reciprocity=" + findings.reciprocity.length +
            "  shorthandDrift=" + findings.shorthandDrift.length);
console.log("   duplicateCas=" + findings.duplicateCas.length +
            "  prohibitedPartner=" + findings.prohibitedPartner.length +
            "  incompatiblePair=" + findings.incompatiblePair.length +
            "  nonPerfumery=" + findings.nonPerfumery.length +
            "  inconsistentCas=" + findings.inconsistentCas.length);
console.log(hr("═"));

// Exit non-zero on structural errors: self-ref, prohibited partners
// (data-safety regression), incompatible HIGH-reactive partners
// (formulation-safety regression), inconsistent declared CAS
// (curation bug). Curation gaps (unresolved / reciprocity /
// shorthandDrift / non-perfumery) are informational only.
const hardErrors = findings.selfref.length
                 + findings.prohibitedPartner.length
                 + findings.incompatiblePair.length
                 + findings.inconsistentCas.length;
process.exit(hardErrors ? 1 : 0);
