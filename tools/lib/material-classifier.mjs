// ─────────────────────────────────────────────────────────────
// tools/lib/material-classifier.mjs — shared classifier for stubs
//
// Single source of truth for the keyword → primaryFamily / facets /
// odor.type / odor.strength / note rules used by:
//   • tools/add-materials.mjs   (apply inline to fresh PubChem fetches)
//   • tools/curate-stubs.mjs    (apply over the whole DB after the fact)
//
// Why both: add-materials runs once per new material with rich PubChem
// data in hand and writes a fully-populated entry; curate-stubs sweeps
// the existing DB and fills in older entries that landed before the
// classifier existed. Sharing the rules keeps the two scripts in lockstep.
//
// Family tokens MUST come from the existing primaryFamilies vocabulary
// so the analyzer's chip strip lights up correctly. See data/materials.json
// for the live token set: herbal, floral, woody, spicy, citrus,
// camphoraceous, green, gourmand, fruity, balsamic, musk, amber,
// aldehydic, floral_amber, aquatic, animalic, lactonic, leather,
// mossy, resinous, smoky, sweet.
// ─────────────────────────────────────────────────────────────

// Order matters: first match wins. Keep the most-specific rules first so a
// generic "aldehyde" pattern doesn't clobber a specific "cinnamaldehyde".
export const RULES = [
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
  { re: /[a-z]+\s*-?\s*\d?\s*,?\s*\d?\s*-?\s*dienal\b/i,
    families: ['aldehydic','green'], facets: ['aldehydic','green','fatty'], type: 'Aldehydic / Green', strength: 'Very High', note: 'Top' },
  { re: /\b\w+[\s-]?\d*[\s-]?enal\b|\b(dec|oct|non|undec|dodec|hexa|hepta|pent|tetradec|hexadec)[\s-]?\d*[\s-]?enal\b|\b4[\s-]?dodecen[\s-]?1[\s-]?al\b|\b\d+\w*[\s-]?\d*[\s-]?en[\s-]?1[\s-]?al\b/i,
    families: ['aldehydic'], facets: ['aldehydic','fatty'], type: 'Aldehydic / Fatty', strength: 'High', note: 'Top' },
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

  // ── Aliphatic alcohols
  { re: /\b(\d[\s-]?(hexan|heptan|octan|nonan|decan|undecan|dodecan|tridecan)ol|hexan[-\s]?1[-\s]?ol|octen[-\s]?3[-\s]?ol)\b/i,
    families: ['green'], facets: ['fatty','soapy','green'], type: 'Fatty / Soapy', strength: 'Medium', note: 'Top / Middle' },
  { re: /\b(octanol|decanol|dodecanol|heptanol|hexanol|undecanol|nonanol|isoamyl[\s-]?alcohol|methylbutanol|methylpropanol)\b/i,
    families: ['green'], facets: ['fatty','soapy','green'], type: 'Fatty / Soapy', strength: 'Medium', note: 'Top / Middle' },

  // ── Aliphatic acids
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

// Default IFRA caution string for stubs that have no curated safety data.
// Engine's banStatus detection at formulation_engine.js:393 picks up the
// 'restricted' keyword and flags the row in the analyzer + IFRA panel,
// so a chemist sees the "needs verification" warning before formulating.
// Safer than leaving the field empty (which the engine treats as "no
// restriction" — a dangerous default for a chemical the user hasn't
// validated against IFRA 51 yet).
export const DEFAULT_IFRA_CAUTION =
  'Awaiting curation — treat as restricted. Consult IFRA 51 + CosIng directly before use. (Auto-generated stub from PubChem.)';
export const DEFAULT_USAGE_CAUTION =
  'No curated usage range — start <0.1% in product and review against IFRA 51 / RIFM safety files before scaling.';

// ── Boiling-point fallback from MW ─────────────────────────────────
// Linear approximation for organic compounds: BP_estimated ≈ 50 + MW × 0.9.
// Calibrated against a quick sample of curated entries (Linalool MW=154 →
// BP=199, Vanillin MW=152 → BP=285, Geraniol MW=154 → BP=229) — the
// regression is noisy but useful: gives the thermo engine a starting
// point so vapor-pressure curves don't flatline at null. Marked as
// estimated so curation passes can override with measured values.
export function estimateBPFromMW(weightStr) {
  const mw = parseFloat(weightStr);
  if (!isFinite(mw) || mw <= 0) return null;
  // Very rough linear regression — over-estimates floral terpenes,
  // under-estimates polar phenolics. A perfumer should override when
  // a measured BP is available.
  return Math.round(50 + mw * 0.9);
}

// MW-based note fallback when keyword didn't match.
export function noteFromMw(weightStr) {
  const mw = parseFloat(weightStr);
  if (!isFinite(mw) || mw <= 0) return '';
  if (mw < 130) return 'Top';
  if (mw < 220) return 'Middle';
  return 'Base';
}

// Build a search haystack (lowercase) from an entry's identifiable fields.
// Includes name + iupac + synonyms so the rule regexes catch tokens
// regardless of which field PubChem put the perfumery name in.
export function searchString(entry) {
  const parts = [
    entry.name || '',
    entry.iupac || '',
    ...(entry.synonyms || []),
  ];
  return parts.join(' | ').toLowerCase();
}

// Run the rule list against an entry; return the first matching rule's
// output, or null. Pure function — does not mutate the entry.
export function classifyEntry(entry) {
  const haystack = searchString(entry);
  for (const rule of RULES) {
    if (rule.re.test(haystack)) {
      return {
        rule: rule.re.source.slice(0, 60),
        families: [...rule.families],
        facets: [...rule.facets],
        type: rule.type,
        strength: rule.strength,
        note: rule.note,
      };
    }
  }
  return null;
}

// Apply a classifier match to an entry — only fills empty fields, never
// overwrites curated data. Mutates `entry` in place.
export function applyClassification(entry, match) {
  if (!entry.classification) entry.classification = { primaryFamilies: [], secondaryFamilies: [], facets: [] };
  if (!entry.classification.primaryFamilies?.length) entry.classification.primaryFamilies = [...match.families];
  if (!entry.classification.facets?.length)          entry.classification.facets          = [...match.facets];
  if (!entry.odor) entry.odor = { description: '', type: '', strength: '' };
  if (!entry.odor.type)     entry.odor.type     = match.type;
  if (!entry.odor.strength) entry.odor.strength = match.strength;
  if (!entry.note)          entry.note          = match.note;
}

// Apply safety + thermo defaults to an entry that PubChem returned with
// no olfactive metadata. Idempotent — only fills empty fields.
export function applyDefaults(entry) {
  if (!entry.safety) entry.safety = { ifra: '', usage: '' };
  if (!entry.safety.ifra)  entry.safety.ifra  = DEFAULT_IFRA_CAUTION;
  if (!entry.safety.usage) entry.safety.usage = DEFAULT_USAGE_CAUTION;
  if (!entry.note) {
    const mwNote = noteFromMw(entry.weight);
    if (mwNote) entry.note = mwNote;
  }
  if (entry.boiling_point == null) {
    const bp = estimateBPFromMW(entry.weight);
    if (bp) entry.boiling_point = bp;
  }
}

// One-shot wrapper: run the classifier, apply the match if any, then
// fill schema gaps with safe defaults. Returns { matched: boolean, rule? }.
export function classifyAndFill(entry) {
  const m = classifyEntry(entry);
  if (m) applyClassification(entry, m);
  applyDefaults(entry);
  return { matched: !!m, rule: m?.rule || null };
}
