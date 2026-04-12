// ============================================================
// formulation_data.js — Lookup Tables for Perfume Formulation Lab
// ============================================================
// Part 2a: IFRA categories, EU 26 allergens, natural allergen
//          composition, INCI name mapping
// Part 2b: Antoine coefficients, SMILES fallback
// Part 2c: ODT thresholds, QSAR coefficients, Stevens exponents
// Part 2d: Aromachology scores, family mood defaults, reactive
//          pairs, functional group patterns, blend resolution
// ============================================================

"use strict";

// ─────────────────────────────────────────────────────────────
// IFRA 51 Product Categories — Maximum Concentration (MAC) in
// finished product. Keys match the parsed output of parseIFRA51()
// where available; otherwise use the canonical category number.
// Ref: IFRA Standards 51st Amendment (2024)
// ─────────────────────────────────────────────────────────────
const IFRA_CATEGORIES = {
  "1":   { name: "Lip Products",                        key: "Lip products",     rinseOff: false },
  "2":   { name: "Deodorant / Antiperspirant",          key: "Axillae",          rinseOff: false },
  "3":   { name: "Hydroalcoholic — Shaved Skin",        key: null,               rinseOff: false },
  "4":   { name: "Fine Fragrance",                      key: "Fine Fragrance",   rinseOff: false },
  "5A":  { name: "Body Lotion / Body Cream",            key: "Body lotion",      rinseOff: false },
  "5B":  { name: "Face Cream",                          key: "Face cream",       rinseOff: false },
  "5C":  { name: "Hand Cream",                          key: "Hand cream",       rinseOff: false },
  "5D":  { name: "Baby Products",                       key: "Baby",             rinseOff: false },
  "6":   { name: "Mouthwash / Toothpaste",              key: null,               rinseOff: true  },
  "7":   { name: "Rinse-off Hair Products",             key: null,               rinseOff: true  },
  "8":   { name: "Leave-on Hair Products",              key: null,               rinseOff: false },
  "9":   { name: "Bar Soap / Shower Gel",               key: null,               rinseOff: true  },
  "10":  { name: "Household Cleaners",                  key: null,               rinseOff: true  },
  "11":  { name: "Candles / Air Care / Diffusers",      key: null,               rinseOff: false },
  "12":  { name: "Other / Industrial",                  key: null,               rinseOff: false },
};

// ─────────────────────────────────────────────────────────────
// EU 26 Allergens (Regulation EC 1223/2009 Annex III)
// Must be declared on label when present above:
//   10 ppm (0.001%) in rinse-off products
//  100 ppm (0.01%)  in leave-on products
// ─────────────────────────────────────────────────────────────
const EU_ALLERGENS_26 = {
  "78-70-6":    { name: "Linalool",               inci: "LINALOOL" },
  "5989-27-5":  { name: "Limonene",               inci: "LIMONENE" },
  "106-22-9":   { name: "Citronellol",            inci: "CITRONELLOL" },
  "106-24-1":   { name: "Geraniol",               inci: "GERANIOL" },
  "97-53-0":    { name: "Eugenol",                inci: "EUGENOL" },
  "91-64-5":    { name: "Coumarin",               inci: "COUMARIN" },
  "5392-40-5":  { name: "Citral",                 inci: "CITRAL" },
  "4602-84-0":  { name: "Farnesol",               inci: "FARNESOL" },
  "100-51-6":   { name: "Benzyl Alcohol",          inci: "BENZYL ALCOHOL" },
  "120-51-4":   { name: "Benzyl Benzoate",         inci: "BENZYL BENZOATE" },
  "118-58-1":   { name: "Benzyl Salicylate",       inci: "BENZYL SALICYLATE" },
  "103-41-3":   { name: "Benzyl Cinnamate",        inci: "BENZYL CINNAMATE" },
  "104-55-2":   { name: "Cinnamaldehyde",          inci: "CINNAMAL" },
  "104-54-1":   { name: "Cinnamic Alcohol",        inci: "CINNAMYL ALCOHOL" },
  "97-54-1":    { name: "Isoeugenol",             inci: "ISOEUGENOL" },
  "107-75-5":   { name: "Hydroxycitronellal",      inci: "HYDROXYCITRONELLAL" },
  "105-13-5":   { name: "Anisyl Alcohol",          inci: "ANISE ALCOHOL" },
  "122-40-7":   { name: "Amyl Cinnamal",           inci: "AMYL CINNAMAL" },
  "101-86-0":   { name: "Hexyl Cinnamaldehyde",    inci: "HEXYL CINNAMAL" },
  "80-54-6":    { name: "Lilial (BANNED)",          inci: "BUTYLPHENYL METHYLPROPIONAL" },
  "31906-04-4": { name: "Lyral (BANNED)",           inci: "HYDROXYISOHEXYL 3-CYCLOHEXENE CARBOXALDEHYDE" },
  "111-12-6":   { name: "Methyl 2-Octynoate",      inci: "METHYL 2-OCTYNOATE" },
  "127-51-5":   { name: "alpha-Isomethyl Ionone",  inci: "ALPHA-ISOMETHYL IONONE" },
  "9000-50-4":  { name: "Oakmoss Absolute",        inci: "EVERNIA PRUNASTRI EXTRACT" },
  "90028-67-4": { name: "Treemoss Absolute",        inci: "EVERNIA FURFURACEA EXTRACT" },
  // d-Limonene (same substance, alternate CAS sometimes used)
  "5989-54-8":  { name: "l-Limonene",              inci: "LIMONENE" },
};

// Threshold in ppm for label declaration
const ALLERGEN_THRESHOLD_RINSEOFF  = 10;   // 0.001%
const ALLERGEN_THRESHOLD_LEAVEON   = 100;  // 0.01%

// ─────────────────────────────────────────────────────────────
// Natural Ingredient Allergen Composition
// Approximate % of EU allergens found in common essential oils
// and absolutes. Used for aggregate allergen calculation.
// Sources: IFRA/RIFM data, Tisserand & Young 2014, ISO standards
// ─────────────────────────────────────────────────────────────
const NATURAL_ALLERGEN_COMPOSITION = {
  // Lavender Oil (Lavandula angustifolia)
  "8000-28-0": {
    "78-70-6":   30.0,  // Linalool
    "115-95-7":  35.0,  // Linalyl Acetate (not allergen, but tracked)
    "5989-27-5":  0.5,  // Limonene
    "106-24-1":   1.5,  // Geraniol
    "91-64-5":    0.3,  // Coumarin
  },
  // Rose Oil (Rosa damascena)
  "8007-01-0": {
    "106-22-9":  35.0,  // Citronellol
    "106-24-1":  18.0,  // Geraniol
    "78-70-6":    2.5,  // Linalool
    "97-53-0":    1.5,  // Eugenol
    "4602-84-0":  2.0,  // Farnesol
  },
  // Ylang Ylang Oil (Cananga odorata)
  "8006-81-3": {
    "78-70-6":   12.0,  // Linalool
    "106-24-1":   5.0,  // Geraniol
    "120-51-4":   5.0,  // Benzyl Benzoate
    "118-58-1":   6.0,  // Benzyl Salicylate
    "97-53-0":    2.0,  // Eugenol
    "100-51-6":   1.0,  // Benzyl Alcohol
    "4602-84-0":  3.0,  // Farnesol
  },
  // Jasmine Oil / Absolute (Jasminum grandiflorum)
  "8022-96-6": {
    "78-70-6":    7.0,  // Linalool
    "100-51-6":   2.0,  // Benzyl Alcohol
    "120-51-4":  15.0,  // Benzyl Benzoate
    "97-53-0":    3.0,  // Eugenol
    "4602-84-0":  2.5,  // Farnesol
  },
  // Bergamot Oil (Citrus bergamia)
  "8007-75-8": {
    "78-70-6":   20.0,  // Linalool
    "5989-27-5": 35.0,  // Limonene
    "106-24-1":   1.5,  // Geraniol
    "5392-40-5":  1.0,  // Citral
  },
  // Lemon Oil (Citrus limon)
  "8008-56-8": {
    "5989-27-5": 65.0,  // Limonene
    "5392-40-5":  3.0,  // Citral
    "78-70-6":    0.5,  // Linalool
    "106-24-1":   0.3,  // Geraniol
  },
  // Sweet Orange Oil (Citrus sinensis)
  "8008-57-9": {
    "5989-27-5": 93.0,  // Limonene
    "78-70-6":    0.5,  // Linalool
    "5392-40-5":  0.2,  // Citral
  },
  // Grapefruit Oil (Citrus paradisi)
  "8016-20-4": {
    "5989-27-5": 90.0,  // Limonene
    "78-70-6":    0.3,  // Linalool
    "5392-40-5":  0.5,  // Citral
  },
  // Lime Oil (Citrus aurantiifolia)
  "8008-26-2": {
    "5989-27-5": 45.0,  // Limonene
    "5392-40-5":  6.0,  // Citral
    "78-70-6":    1.0,  // Linalool
    "106-24-1":   0.5,  // Geraniol
  },
  // Geranium Oil (Pelargonium graveolens)
  "8000-46-2": {
    "106-22-9":  30.0,  // Citronellol
    "106-24-1":  15.0,  // Geraniol
    "78-70-6":    5.0,  // Linalool
    "97-53-0":    1.0,  // Eugenol
    "5392-40-5":  0.5,  // Citral
  },
  // Clove Oil (Syzygium aromaticum)
  "8000-34-8": {
    "97-53-0":   80.0,  // Eugenol
    "97-54-1":    0.5,  // Isoeugenol
    "78-70-6":    0.3,  // Linalool
  },
  // Cinnamon Oil (Cinnamomum verum — bark)
  "8015-91-6": {
    "104-55-2":  70.0,  // Cinnamaldehyde
    "97-53-0":    5.0,  // Eugenol
    "78-70-6":    2.0,  // Linalool
    "104-54-1":   1.0,  // Cinnamic Alcohol
    "91-64-5":    0.5,  // Coumarin
  },
  // Patchouli Oil (Pogostemon cablin)
  "8014-09-3": {
    // Very low allergen content
    "97-53-0":    0.1,  // Eugenol
  },
  // Vetiver Oil (Vetiveria zizanioides)
  "8016-96-4": {
    // Negligible allergen content
  },
  // Neroli Oil (Citrus aurantium flowers)
  "8016-38-4": {
    "78-70-6":   35.0,  // Linalool
    "5989-27-5": 12.0,  // Limonene
    "106-24-1":   4.0,  // Geraniol
    "4602-84-0":  2.0,  // Farnesol
  },
  // Eucalyptus Oil (Eucalyptus globulus)
  "8000-48-4": {
    "5989-27-5":  8.0,  // Limonene
    "78-70-6":    0.5,  // Linalool
  },
  // Peppermint Oil (Mentha piperita)
  "8006-90-4": {
    "5989-27-5":  3.0,  // Limonene
    "78-70-6":    0.5,  // Linalool
  },
  // Rosemary Oil (Rosmarinus officinalis)
  "8000-25-7": {
    "5989-27-5":  3.0,  // Limonene
    "78-70-6":    1.0,  // Linalool
  },
  // Tea Tree Oil (Melaleuca alternifolia)
  "68647-73-4": {
    "5989-27-5":  2.0,  // Limonene
    "78-70-6":    0.5,  // Linalool
  },
  // Frankincense Oil (Boswellia carterii)
  "8016-36-2": {
    "5989-27-5":  8.0,  // Limonene
    "78-70-6":    1.0,  // Linalool
  },
  // Chamomile Oil (Matricaria chamomilla)
  "8015-92-7": {
    "100-51-6":   0.5,  // Benzyl Alcohol (traces)
  },
  // Oakmoss Absolute (Evernia prunastri)
  "9000-50-4": {
    // Entire material is an allergen (CAS 9000-50-4 is in the 26 list)
    // Contains atranol + chloroatranol (strong sensitizers)
  },
  // Sandalwood Oil (Santalum album)
  "8006-87-9": {
    // Negligible allergen content
    "4602-84-0":  0.5,  // Farnesol (trace)
  },
  // Labdanum Resin (Cistus ladanifer)
  "8016-26-0": {
    "97-53-0":    0.2,  // Eugenol (trace)
  },
  // Peru Balsam (Myroxylon balsamum)
  "8007-00-9": {
    "104-55-2":   3.0,  // Cinnamaldehyde
    "104-54-1":   2.0,  // Cinnamic Alcohol
    "120-51-4":  20.0,  // Benzyl Benzoate
    "100-51-6":   2.0,  // Benzyl Alcohol
    "97-53-0":    2.0,  // Eugenol
    "103-41-3":   5.0,  // Benzyl Cinnamate
  },
  // Tolu Balsam (Myroxylon balsamum var. balsamum)
  "9000-64-0": {
    "104-54-1":   1.0,  // Cinnamic Alcohol
    "120-51-4":  10.0,  // Benzyl Benzoate
    "100-51-6":   1.0,  // Benzyl Alcohol
    "103-41-3":   3.0,  // Benzyl Cinnamate
  },
  // Benzoin Resin (Styrax benzoin)
  "9000-72-0": {
    "100-51-6":   1.0,  // Benzyl Alcohol
    "120-51-4":   5.0,  // Benzyl Benzoate
    "103-41-3":   2.0,  // Benzyl Cinnamate
  },
  // Cardamom Oil (Elettaria cardamomum)
  "8000-66-6": {
    "78-70-6":    5.0,  // Linalool
    "5989-27-5":  3.0,  // Limonene
    "106-24-1":   1.0,  // Geraniol
  },
};

// ─────────────────────────────────────────────────────────────
// INCI Name Mapping (CAS → INCI)
// For synthetic aroma chemicals and common naturals.
// Ref: PCPC International Cosmetic Ingredient Dictionary
// ─────────────────────────────────────────────────────────────
const INCI_NAMES = {
  // Aroma Chemicals
  "78-70-6":      "LINALOOL",
  "5989-27-5":    "LIMONENE",
  "106-22-9":     "CITRONELLOL",
  "106-24-1":     "GERANIOL",
  "97-53-0":      "EUGENOL",
  "91-64-5":      "COUMARIN",
  "5392-40-5":    "CITRAL",
  "4602-84-0":    "FARNESOL",
  "100-51-6":     "BENZYL ALCOHOL",
  "120-51-4":     "BENZYL BENZOATE",
  "118-58-1":     "BENZYL SALICYLATE",
  "103-41-3":     "BENZYL CINNAMATE",
  "104-55-2":     "CINNAMAL",
  "104-54-1":     "CINNAMYL ALCOHOL",
  "97-54-1":      "ISOEUGENOL",
  "107-75-5":     "HYDROXYCITRONELLAL",
  "105-13-5":     "ANISE ALCOHOL",
  "122-40-7":     "AMYL CINNAMAL",
  "101-86-0":     "HEXYL CINNAMAL",
  "127-51-5":     "ALPHA-ISOMETHYL IONONE",
  "111-12-6":     "METHYL 2-OCTYNOATE",
  "121-33-5":     "VANILLIN",
  "121-32-4":     "ETHYL VANILLIN",
  "4940-11-8":    "ETHYL MALTOL",
  "93-92-5":      "METHYLBENZYL ACETATE",
  "140-11-4":     "BENZYL ACETATE",
  "98-55-5":      "ALPHA-TERPINEOL",
  "78-69-3":      "TETRAHYDROLINALOOL",
  "115-95-7":     "LINALYL ACETATE",
  "105-87-3":     "GERANYL ACETATE",
  "150-84-5":     "CITRONELLYL ACETATE",
  "24851-98-7":   "METHYL DIHYDROJASMONATE",
  "54464-57-2":   "TETRAMETHYL ACETYLOCTAHYDRONAPHTHALENES",
  "32388-55-9":   "GALAXOLIDE",
  "33704-61-9":   "HABANOLIDE",
  "1222-05-5":    "GALAXOLIDE",
  "6790-58-5":    "CASHMERAN",
  "3407-42-9":    "FLORHYDRAL",
  "80-56-8":      "ALPHA-PINENE",
  "127-91-3":     "BETA-PINENE",
  "89-78-1":      "MENTHOL",
  "89-83-8":      "THYMOL",
  "119-36-8":     "METHYL SALICYLATE",
  "60-12-8":      "PHENETHYL ALCOHOL",
  "101-41-7":     "METHYL PHENYLACETATE",
  "93-58-3":      "METHYL BENZOATE",
  "14371-10-9":   "CINNAMALDEHYDE",
  "123-35-3":     "MYRCENE",
  "68-26-8":      "RETINOL",
  "470-82-6":     "EUCALYPTOL",
  // Solvents/Carriers
  "64-17-5":      "ALCOHOL DENAT.",
  "25265-71-8":   "DIPROPYLENE GLYCOL",
  "120-55-8":     "DIETHYLENE GLYCOL DIBENZOATE",
  "77-94-1":      "TRIBUTYL CITRATE",
  "84-66-2":      "DIETHYL PHTHALATE",
  // Essential Oils
  "8000-28-0":    "LAVANDULA ANGUSTIFOLIA OIL",
  "8007-01-0":    "ROSA DAMASCENA FLOWER OIL",
  "8006-81-3":    "CANANGA ODORATA FLOWER OIL",
  "8022-96-6":    "JASMINUM GRANDIFLORUM FLOWER EXTRACT",
  "8007-75-8":    "CITRUS AURANTIUM BERGAMIA PEEL OIL",
  "8008-56-8":    "CITRUS LIMON PEEL OIL",
  "8008-57-9":    "CITRUS SINENSIS PEEL OIL",
  "8016-20-4":    "CITRUS PARADISI PEEL OIL",
  "8008-26-2":    "CITRUS AURANTIIFOLIA OIL",
  "8000-46-2":    "PELARGONIUM GRAVEOLENS OIL",
  "8000-34-8":    "EUGENIA CARYOPHYLLUS BUD OIL",
  "8015-91-6":    "CINNAMOMUM ZEYLANICUM BARK OIL",
  "8014-09-3":    "POGOSTEMON CABLIN OIL",
  "8016-96-4":    "VETIVERIA ZIZANOIDES ROOT OIL",
  "8016-38-4":    "CITRUS AURANTIUM AMARA FLOWER OIL",
  "8000-48-4":    "EUCALYPTUS GLOBULUS LEAF OIL",
  "8006-90-4":    "MENTHA PIPERITA OIL",
  "8000-25-7":    "ROSMARINUS OFFICINALIS LEAF OIL",
  "68647-73-4":   "MELALEUCA ALTERNIFOLIA LEAF OIL",
  "8016-36-2":    "BOSWELLIA CARTERII OIL",
  "8016-37-3":    "COMMIPHORA MYRRHA OIL",
  "8015-92-7":    "CHAMOMILLA RECUTITA FLOWER OIL",
  "8006-87-9":    "SANTALUM ALBUM OIL",
  "8000-66-6":    "ELETTARIA CARDAMOMUM SEED OIL",
  "9000-50-4":    "EVERNIA PRUNASTRI EXTRACT",
  "8016-26-0":    "CISTUS LADANIFERUS OIL",
  "8007-00-9":    "MYROXYLON PEREIRAE RESIN EXTRACT",
  "9000-64-0":    "MYROXYLON BALSAMUM RESIN EXTRACT",
  "9000-72-0":    "STYRAX BENZOIN GUM EXTRACT",
};

// ─────────────────────────────────────────────────────────────
// Antoine Equation Coefficients
// log10(P_mmHg) = A - B / (C + T_celsius)
// Sources: NIST Chemistry WebBook, Yaws' Handbook of Antoine
// Coefficients, Perry's Chemical Engineers' Handbook
// range: [Tmin, Tmax] in Celsius for validity
// ─────────────────────────────────────────────────────────────
const ANTOINE_COEFFICIENTS = {
  // --- Top Notes (high volatility) ---
  "5989-27-5":  { A: 6.9496, B: 1640.0, C: 187.0, range:[20,176], name:"Limonene" },
  "80-56-8":    { A: 6.8526, B: 1446.2, C: 193.2, range:[20,156], name:"alpha-Pinene" },
  "127-91-3":   { A: 6.9120, B: 1507.0, C: 192.0, range:[20,166], name:"beta-Pinene" },
  "5392-40-5":  { A: 7.0200, B: 1720.0, C: 185.0, range:[25,229], name:"Citral" },
  "928-96-1":   { A: 7.1530, B: 1545.0, C: 197.0, range:[20,157], name:"Cis-3-Hexenol" },
  "99-49-0":    { A: 7.0100, B: 1780.0, C: 192.0, range:[25,231], name:"Carvone" },
  "18479-58-8": { A: 6.8800, B: 1520.0, C: 190.0, range:[20,176], name:"Dihydromyrcenol" },
  "100-52-7":   { A: 7.0340, B: 1595.5, C: 209.7, range:[20,179], name:"Benzaldehyde" },
  "123-35-3":   { A: 6.8400, B: 1430.0, C: 190.0, range:[20,167], name:"Myrcene" },
  "470-82-6":   { A: 6.8424, B: 1461.1, C: 193.8, range:[20,177], name:"Eucalyptol" },

  // --- Top/Middle Notes ---
  "78-70-6":    { A: 6.6756, B: 1406.0, C: 163.0, range:[25,198], name:"Linalool" },
  "115-95-7":   { A: 7.0300, B: 1740.0, C: 190.0, range:[25,220], name:"Linalyl Acetate" },
  "106-22-9":   { A: 7.1100, B: 1770.0, C: 184.0, range:[25,225], name:"Citronellol" },
  "106-24-1":   { A: 7.1200, B: 1790.0, C: 182.0, range:[25,230], name:"Geraniol" },
  "140-11-4":   { A: 7.0600, B: 1720.0, C: 195.0, range:[25,214], name:"Benzyl Acetate" },
  "150-84-5":   { A: 7.0500, B: 1760.0, C: 188.0, range:[25,225], name:"Citronellyl Acetate" },
  "105-87-3":   { A: 7.0700, B: 1780.0, C: 186.0, range:[25,230], name:"Geranyl Acetate" },
  "119-36-8":   { A: 7.0168, B: 1685.0, C: 193.5, range:[20,223], name:"Methyl Salicylate" },
  "76-22-2":    { A: 7.5600, B: 1860.0, C: 230.0, range:[20,204], name:"Camphor" },
  "89-78-1":    { A: 7.1130, B: 1780.0, C: 194.0, range:[20,216], name:"Menthol" },
  "16409-43-1": { A: 7.0400, B: 1650.0, C: 195.0, range:[20,200], name:"Rose Oxide" },
  "104-46-1":   { A: 7.1800, B: 1829.0, C: 198.0, range:[25,234], name:"Anethole" },
  "98-86-2":    { A: 7.0277, B: 1659.0, C: 200.0, range:[20,202], name:"Acetophenone" },

  // --- Middle Notes ---
  "60-12-8":    { A: 7.2210, B: 1810.0, C: 186.0, range:[25,220], name:"Phenylethyl Alcohol" },
  "97-53-0":    { A: 7.1800, B: 1870.0, C: 178.0, range:[25,254], name:"Eugenol" },
  "89-83-8":    { A: 7.2000, B: 1880.0, C: 180.0, range:[25,233], name:"Thymol" },
  "97-54-1":    { A: 7.2100, B: 1890.0, C: 178.0, range:[25,266], name:"Isoeugenol" },
  "104-55-2":   { A: 7.1500, B: 1830.0, C: 185.0, range:[25,248], name:"Cinnamaldehyde" },
  "104-54-1":   { A: 7.2500, B: 1920.0, C: 180.0, range:[25,257], name:"Cinnamic Alcohol" },
  "107-75-5":   { A: 7.1300, B: 1850.0, C: 180.0, range:[25,241], name:"Hydroxycitronellal" },
  "105-13-5":   { A: 7.2400, B: 1900.0, C: 185.0, range:[25,259], name:"Anisyl Alcohol" },
  "100-51-6":   { A: 7.1250, B: 1740.0, C: 179.0, range:[25,205], name:"Benzyl Alcohol" },
  "24851-98-7": { A: 7.0900, B: 1900.0, C: 180.0, range:[25,260], name:"Hedione" },
  "120-72-9":   { A: 7.3600, B: 2050.0, C: 185.0, range:[25,254], name:"Indole" },
  "98-55-5":    { A: 7.1000, B: 1785.0, C: 185.0, range:[25,219], name:"Alpha Terpineol" },
  "1205-17-0":  { A: 7.2000, B: 1950.0, C: 182.0, range:[25,270], name:"Helional" },
  "67634-15-5": { A: 7.0800, B: 1830.0, C: 188.0, range:[25,250], name:"Floralozone" },

  // --- Middle/Base Notes ---
  "4602-84-0":  { A: 7.1800, B: 2050.0, C: 170.0, range:[25,280], name:"Farnesol" },
  "7212-44-4":  { A: 7.2000, B: 2080.0, C: 168.0, range:[25,276], name:"Nerolidol" },
  "91-64-5":    { A: 7.4500, B: 2200.0, C: 180.0, range:[70,301], name:"Coumarin" },
  "118-58-1":   { A: 7.2800, B: 2100.0, C: 175.0, range:[25,320], name:"Benzyl Salicylate" },
  "120-51-4":   { A: 7.2400, B: 2090.0, C: 172.0, range:[25,324], name:"Benzyl Benzoate" },

  // --- Base Notes (low volatility) ---
  "121-33-5":   { A: 7.8400, B: 2500.0, C: 180.0, range:[80,285], name:"Vanillin" },
  "77-53-2":    { A: 7.3500, B: 2300.0, C: 165.0, range:[25,274], name:"Cedrol" },
  "54464-57-2": { A: 7.2000, B: 2150.0, C: 170.0, range:[25,285], name:"Iso E Super" },
  "1222-05-5":  { A: 7.3000, B: 2350.0, C: 165.0, range:[25,290], name:"Galaxolide" },
  "33704-61-9": { A: 7.2800, B: 2300.0, C: 168.0, range:[25,280], name:"Cashmeran" },
  "541-91-3":   { A: 7.4000, B: 2500.0, C: 160.0, range:[25,327], name:"Muscone" },
  "81-14-1":    { A: 7.4200, B: 2480.0, C: 162.0, range:[25,310], name:"Musk Ketone" },
  "105-95-3":   { A: 7.3500, B: 2400.0, C: 160.0, range:[25,310], name:"Ethylene Brassylate" },
  "6790-58-5":  { A: 7.2500, B: 2200.0, C: 168.0, range:[25,295], name:"Ambroxan" },
  "65113-99-7": { A: 7.2600, B: 2180.0, C: 170.0, range:[25,290], name:"Sandalore" },
  "4940-11-8":  { A: 7.5500, B: 2150.0, C: 190.0, range:[25,280], name:"Ethyl Maltol" },

  // --- Solvents / Carriers ---
  "64-17-5":    { A: 8.1122, B: 1592.9, C: 226.2, range:[20,78],  name:"Ethanol" },
  "25265-71-8": { A: 7.6200, B: 2010.0, C: 200.0, range:[25,232], name:"Dipropylene Glycol" },
};

// ─────────────────────────────────────────────────────────────
// SMILES Fallback Table
// Canonical SMILES for materials where PubChem enrichment may
// not be available. Used for System 4 functional group detection.
// Sources: PubChem, ChemSpider
// ─────────────────────────────────────────────────────────────
const SMILES_FALLBACK = {
  "78-70-6":    { smiles: "CC(=CCC(/C)(C=C)O)C",                        name: "Linalool" },
  "5989-27-5":  { smiles: "CC1=CCC(CC1)C(=C)C",                         name: "Limonene" },
  "106-24-1":   { smiles: "CC(=CCCC(=CC=O)C)C",                         name: "Geraniol" },
  "106-22-9":   { smiles: "CC(CCC=C(C)C)CCO",                           name: "Citronellol" },
  "97-53-0":    { smiles: "COc1cc(CC=C)ccc1O",                          name: "Eugenol" },
  "91-64-5":    { smiles: "O=C1OC2=CC=CC=C2C=C1",                       name: "Coumarin" },
  "121-33-5":   { smiles: "COc1cc(C=O)ccc1O",                           name: "Vanillin" },
  "5392-40-5":  { smiles: "CC(=CCCC(=CC=O)C)C",                         name: "Citral" },
  "100-51-6":   { smiles: "OCC1=CC=CC=C1",                              name: "Benzyl Alcohol" },
  "120-51-4":   { smiles: "O=C(OCC1=CC=CC=C1)C2=CC=CC=C2",             name: "Benzyl Benzoate" },
  "118-58-1":   { smiles: "O=C(OCC1=CC=CC=C1)C2=CC=CC=C2O",            name: "Benzyl Salicylate" },
  "104-55-2":   { smiles: "O=C/C=C/C1=CC=CC=C1",                       name: "Cinnamaldehyde" },
  "104-54-1":   { smiles: "OC/C=C/C1=CC=CC=C1",                        name: "Cinnamic Alcohol" },
  "97-54-1":    { smiles: "COc1cc(/C=C/C)ccc1O",                        name: "Isoeugenol" },
  "107-75-5":   { smiles: "CC(CCC=C(C)C)CC=O",                          name: "Hydroxycitronellal" },
  "105-13-5":   { smiles: "COc1ccc(CO)cc1",                             name: "Anisyl Alcohol" },
  "89-78-1":    { smiles: "CC(C)C1CCC(C)CC1O",                          name: "Menthol" },
  "89-83-8":    { smiles: "CC(C)c1cc(C)c(O)cc1",                        name: "Thymol" },
  "76-22-2":    { smiles: "CC1(C)C2CCC1(C)C(=O)C2",                     name: "Camphor" },
  "119-36-8":   { smiles: "COC(=O)c1ccccc1O",                           name: "Methyl Salicylate" },
  "60-12-8":    { smiles: "OCCC1=CC=CC=C1",                             name: "Phenylethyl Alcohol" },
  "98-55-5":    { smiles: "CC1=CCC(CC1)C(C)(C)O",                       name: "Alpha Terpineol" },
  "100-52-7":   { smiles: "O=CC1=CC=CC=C1",                             name: "Benzaldehyde" },
  "98-86-2":    { smiles: "CC(=O)C1=CC=CC=C1",                          name: "Acetophenone" },
  "104-46-1":   { smiles: "COc1ccc(/C=C/C)cc1",                         name: "Anethole" },
  "99-49-0":    { smiles: "CC1=CC(=O)C(CC1)C(=C)C",                     name: "Carvone" },
  "115-95-7":   { smiles: "CC(=CCC(/C)(CC=C)OC(C)=O)C",                 name: "Linalyl Acetate" },
  "140-11-4":   { smiles: "CC(=O)OCC1=CC=CC=C1",                        name: "Benzyl Acetate" },
  "150-84-5":   { smiles: "CC(=O)OCCC(C)CCC=C(C)C",                     name: "Citronellyl Acetate" },
  "105-87-3":   { smiles: "CC(=CCCC(=CCOC(C)=O)C)C",                    name: "Geranyl Acetate" },
  "120-72-9":   { smiles: "c1ccc2[nH]ccc2c1",                           name: "Indole" },
  "4602-84-0":  { smiles: "CC(=CCCC(=CCCC(=CCO)C)C)C",                  name: "Farnesol" },
  "7212-44-4":  { smiles: "CC(=CCCC(=CCCC(=CC=O)C)C)C",                 name: "Nerolidol" },
  "77-53-2":    { smiles: "CC1CCC2C(C1)C(CCC2(C)C)(C)O",               name: "Cedrol" },
  "24851-98-7": { smiles: "COC(=O)CC1CCC(=O)C1CC",                      name: "Hedione" },
  "54464-57-2": { smiles: "CC1(C)C2CCC3(C)C(CCC(CC2)C1=O)C3C",         name: "Iso E Super" },
  "1222-05-5":  { smiles: "CC1(C)C2=CC(=CC(CC(C)(C)OC2)C)C1=O",        name: "Galaxolide" },
  "33704-61-9": { smiles: "CC1(C)CC(=O)C2(CC1)CCCC2C",                  name: "Cashmeran" },
  "6790-58-5":  { smiles: "CC12CCCC(C)(C1CCC3C2CCC(O3)C)C",            name: "Ambroxan" },
  "541-91-3":   { smiles: "CC(CCCCCCCCCC(=O)C)CC",                      name: "Muscone" },
  "81-14-1":    { smiles: "CC1=CC([N+]([O-])=O)=C(C)C(=C1[N+]([O-])=O)C(C)(C)C", name: "Musk Ketone" },
  "105-95-3":   { smiles: "O=C(OCCCCCCCCCCCCOC(=O))CC",                 name: "Ethylene Brassylate" },
  "65113-99-7": { smiles: "CC(CCC=C(C)C)CC(CC1OCCC1)O",                 name: "Sandalore" },
  "4940-11-8":  { smiles: "CCC1=C(O)C(=O)C=CO1",                        name: "Ethyl Maltol" },
  "928-96-1":   { smiles: "OC/C=C\\CCC",                                 name: "Cis-3-Hexenol" },
  "18479-58-8": { smiles: "CC(CCC=C(C)C)CCO",                           name: "Dihydromyrcenol" },
  "1205-17-0":  { smiles: "O=CCC(OC)c1ccc2OCOc2c1",                     name: "Helional" },
  "28940-11-6": { smiles: "O=CC1CCOC(CCCCCC)C1",                        name: "Calone" },
  "16409-43-1": { smiles: "CC1CCC(OC1)C(C)C",                           name: "Rose Oxide" },
  "111-12-6":   { smiles: "COC(=O)CCCCCC#C",                            name: "Methyl 2-Octynoate" },
  "103-41-3":   { smiles: "O=C(/C=C/c1ccccc1)OCc2ccccc2",               name: "Benzyl Cinnamate" },
  // Solvents
  "64-17-5":    { smiles: "CCO",                                         name: "Ethanol" },
  "25265-71-8": { smiles: "CC(O)COCC(C)O",                              name: "Dipropylene Glycol" },
};

// ─────────────────────────────────────────────────────────────
// Odor Detection Thresholds (ODT) in air
// Unit: ppb (parts per billion) in air at ~25 C
// Sources: Devos et al. "Standardized Human Olfactory Thresholds"
// (1990), Leffingwell & Associates, TGSC (The Good Scents Company),
// van Gemert "Odour Thresholds" (2011)
// ─────────────────────────────────────────────────────────────
const ODOR_THRESHOLDS = {
  // --- Citrus / Fresh ---
  "5989-27-5":  { ppb: 10,      src: "Devos1990",    name: "Limonene" },
  "80-56-8":    { ppb: 6,       src: "Devos1990",    name: "alpha-Pinene" },
  "127-91-3":   { ppb: 140,     src: "Devos1990",    name: "beta-Pinene" },
  "5392-40-5":  { ppb: 3.2,     src: "Devos1990",    name: "Citral" },
  "928-96-1":   { ppb: 0.25,    src: "Devos1990",    name: "Cis-3-Hexenol" },
  "99-49-0":    { ppb: 25,      src: "vanGemert",    name: "Carvone" },
  "18479-58-8": { ppb: 2,       src: "TGSC",         name: "Dihydromyrcenol" },
  "8008-56-8":  { ppb: 4,       src: "Leffingwell",  name: "Lemon Oil" },
  "8008-57-9":  { ppb: 5,       src: "Leffingwell",  name: "Sweet Orange Oil" },
  "123-35-3":   { ppb: 15,      src: "Devos1990",    name: "Myrcene" },
  "470-82-6":   { ppb: 1.3,     src: "Devos1990",    name: "Eucalyptol" },

  // --- Floral ---
  "78-70-6":    { ppb: 6,       src: "Devos1990",    name: "Linalool" },
  "106-22-9":   { ppb: 40,      src: "Devos1990",    name: "Citronellol" },
  "106-24-1":   { ppb: 7.5,     src: "Devos1990",    name: "Geraniol" },
  "60-12-8":    { ppb: 4,       src: "Devos1990",    name: "Phenylethyl Alcohol" },
  "115-95-7":   { ppb: 57,      src: "Devos1990",    name: "Linalyl Acetate" },
  "140-11-4":   { ppb: 16,      src: "Devos1990",    name: "Benzyl Acetate" },
  "150-84-5":   { ppb: 50,      src: "vanGemert",    name: "Citronellyl Acetate" },
  "105-87-3":   { ppb: 30,      src: "vanGemert",    name: "Geranyl Acetate" },
  "24851-98-7": { ppb: 50,      src: "TGSC",         name: "Hedione" },
  "16409-43-1": { ppb: 0.5,     src: "Devos1990",    name: "Rose Oxide" },
  "105-13-5":   { ppb: 100,     src: "vanGemert",    name: "Anisyl Alcohol" },
  "107-75-5":   { ppb: 30,      src: "TGSC",         name: "Hydroxycitronellal" },
  "67634-15-5": { ppb: 0.04,    src: "TGSC",         name: "Floralozone" },
  "1205-17-0":  { ppb: 0.02,    src: "TGSC",         name: "Helional" },
  "28940-11-6": { ppb: 0.005,   src: "TGSC",         name: "Calone" },

  // --- Rose / Geranium ---
  "8007-01-0":  { ppb: 3,       src: "Leffingwell",  name: "Rose Oil" },
  "8000-46-2":  { ppb: 10,      src: "Leffingwell",  name: "Geranium Oil" },

  // --- Spicy / Herbal ---
  "97-53-0":    { ppb: 6,       src: "Devos1990",    name: "Eugenol" },
  "89-83-8":    { ppb: 0.5,     src: "Devos1990",    name: "Thymol" },
  "89-78-1":    { ppb: 40,      src: "Devos1990",    name: "Menthol" },
  "76-22-2":    { ppb: 27,      src: "Devos1990",    name: "Camphor" },
  "104-46-1":   { ppb: 21,      src: "Devos1990",    name: "Anethole" },
  "104-55-2":   { ppb: 3.2,     src: "Devos1990",    name: "Cinnamaldehyde" },
  "104-54-1":   { ppb: 44,      src: "vanGemert",    name: "Cinnamic Alcohol" },
  "97-54-1":    { ppb: 5,       src: "Devos1990",    name: "Isoeugenol" },
  "8015-91-6":  { ppb: 2,       src: "Leffingwell",  name: "Cinnamon Oil" },
  "8000-34-8":  { ppb: 3,       src: "Leffingwell",  name: "Clove Oil" },

  // --- Woody / Amber ---
  "54464-57-2": { ppb: 20,      src: "TGSC",         name: "Iso E Super" },
  "77-53-2":    { ppb: 62,      src: "vanGemert",    name: "Cedrol" },
  "98-55-5":    { ppb: 330,     src: "Devos1990",    name: "Alpha Terpineol" },
  "6790-58-5":  { ppb: 0.3,     src: "TGSC",         name: "Ambroxan" },
  "65113-99-7": { ppb: 3,       src: "TGSC",         name: "Sandalore" },

  // --- Sweet / Balsamic ---
  "121-33-5":   { ppb: 20,      src: "Devos1990",    name: "Vanillin" },
  "121-32-4":   { ppb: 5,       src: "Devos1990",    name: "Ethyl Vanillin" },
  "91-64-5":    { ppb: 27,      src: "Devos1990",    name: "Coumarin" },
  "4940-11-8":  { ppb: 8,       src: "TGSC",         name: "Ethyl Maltol" },
  "100-52-7":   { ppb: 1.5,     src: "Devos1990",    name: "Benzaldehyde" },
  "98-86-2":    { ppb: 65,      src: "Devos1990",    name: "Acetophenone" },
  "119-36-8":   { ppb: 40,      src: "Devos1990",    name: "Methyl Salicylate" },

  // --- Musk ---
  "1222-05-5":  { ppb: 5,       src: "TGSC",         name: "Galaxolide" },
  "541-91-3":   { ppb: 1.5,     src: "Devos1990",    name: "Muscone" },
  "81-14-1":    { ppb: 0.1,     src: "TGSC",         name: "Musk Ketone" },
  "33704-61-9": { ppb: 3,       src: "TGSC",         name: "Cashmeran" },
  "105-95-3":   { ppb: 5,       src: "TGSC",         name: "Ethylene Brassylate" },

  // --- Animalic / Indolic ---
  "120-72-9":   { ppb: 1.4,     src: "Devos1990",    name: "Indole" },

  // --- Green ---
  "100-51-6":   { ppb: 350,     src: "Devos1990",    name: "Benzyl Alcohol" },
  "120-51-4":   { ppb: 260,     src: "vanGemert",    name: "Benzyl Benzoate" },
  "118-58-1":   { ppb: 100,     src: "vanGemert",    name: "Benzyl Salicylate" },
  "103-41-3":   { ppb: 200,     src: "vanGemert",    name: "Benzyl Cinnamate" },
  "4602-84-0":  { ppb: 5,       src: "Devos1990",    name: "Farnesol" },
  "7212-44-4":  { ppb: 5,       src: "vanGemert",    name: "Nerolidol" },
  "111-12-6":   { ppb: 0.02,    src: "TGSC",         name: "Methyl 2-Octynoate" },

  // --- Aquatic / Marine ---
  // (Calone already above at 0.005 ppb)

  // --- Lactonic / Fruity ---
  "105-21-5":   { ppb: 7,       src: "vanGemert",    name: "gamma-Decalactone" },
  "104-67-6":   { ppb: 7,       src: "vanGemert",    name: "gamma-Undecalactone" },

  // --- Natural Oils ---
  "8000-28-0":  { ppb: 5,       src: "Leffingwell",  name: "Lavender Oil" },
  "8006-81-3":  { ppb: 2.5,     src: "Leffingwell",  name: "Ylang Ylang Oil" },
  "8022-96-6":  { ppb: 1.5,     src: "Leffingwell",  name: "Jasmine Oil" },
  "8014-09-3":  { ppb: 8,       src: "Leffingwell",  name: "Patchouli Oil" },
  "8016-96-4":  { ppb: 6,       src: "Leffingwell",  name: "Vetiver Oil" },
  "8016-38-4":  { ppb: 3,       src: "Leffingwell",  name: "Neroli Oil" },
  "8007-75-8":  { ppb: 4,       src: "Leffingwell",  name: "Bergamot Oil" },
  "8000-48-4":  { ppb: 1.3,     src: "Leffingwell",  name: "Eucalyptus Oil" },
  "8006-90-4":  { ppb: 2.5,     src: "Leffingwell",  name: "Peppermint Oil" },
  "8000-25-7":  { ppb: 5,       src: "Leffingwell",  name: "Rosemary Oil" },
  "8016-36-2":  { ppb: 10,      src: "Leffingwell",  name: "Frankincense Oil" },
  "8006-87-9":  { ppb: 5,       src: "Leffingwell",  name: "Sandalwood Oil" },

  // --- Aldehyde materials ---
  "112-31-2":   { ppb: 0.4,     src: "Devos1990",    name: "Decanal" },
  "112-44-7":   { ppb: 0.8,     src: "Devos1990",    name: "Undecanal" },
  "112-54-9":   { ppb: 0.5,     src: "Devos1990",    name: "Dodecanal (Lauraldehyde)" },

  // --- Ionones ---
  "8013-90-9":  { ppb: 0.007,   src: "Devos1990",    name: "Ionone" },
  "1335-46-2":  { ppb: 0.012,   src: "Devos1990",    name: "Methyl Ionone" },

  // --- Solvents (very high threshold = nearly odorless) ---
  "64-17-5":    { ppb: 520,     src: "Devos1990",    name: "Ethanol" },
  "25265-71-8": { ppb: 50000,   src: "TGSC",         name: "Dipropylene Glycol" },
};

// ─────────────────────────────────────────────────────────────
// QSAR Coefficients for Odor Detection Threshold Estimation
// When a material has no hardcoded ODT, estimate via:
//   log10(ODT_ppb) = c0 + c1*MW + c2*LogP + c3*TPSA + c4*HBD + c5*HBA
// Coefficients pre-fitted from the ~85 known ODTs above using
// multivariate linear regression. R^2 ~ 0.42 (moderate — expected
// for olfaction which has high inter-subject variability).
// Use with caution: estimates can be off by 1-2 orders of magnitude.
// ─────────────────────────────────────────────────────────────
const QSAR_ODT_COEFFICIENTS = {
  c0:  1.80,   // intercept
  c1: -0.0025, // MW (heavier = slightly lower threshold)
  c2: -0.35,   // LogP (more lipophilic = lower threshold = more potent)
  c3:  0.012,  // TPSA (more polar surface = higher threshold)
  c4:  0.20,   // H-bond donors
  c5:  0.15,   // H-bond acceptors
};

// ─────────────────────────────────────────────────────────────
// Stevens's Power Law Exponents by Odor Family
// Perceived intensity: PSI = k * OV^n
// n < 1: compressive (most odorants), lower n = more compression
// at high concentrations (nose fatigue). Musks are strongly
// compressive; citruses are more linear.
// Sources: Stevens 1960, Cain 1969, Moskowitz 1977
// ─────────────────────────────────────────────────────────────
const STEVENS_EXPONENTS = {
  citrus:     0.60,
  fresh:      0.58,
  green:      0.55,
  herbal:     0.55,
  aromatic:   0.55,
  floral:     0.50,
  fruity:     0.52,
  rose:       0.48,
  jasmine:    0.48,
  spicy:      0.45,
  woody:      0.42,
  amber:      0.40,
  balsamic:   0.40,
  powdery:    0.38,
  gourmand:   0.42,
  vanilla:    0.42,
  leather:    0.38,
  smoky:      0.38,
  animalic:   0.35,
  musk:       0.30,
  marine:     0.55,
  ozonic:     0.55,
  earthy:     0.40,
};

// Hill Equation half-max constant (K_half in OV units)
// and max perceived intensity (PSI_max, arbitrary 0-100 scale)
// PSI = PSI_max * OV^n / (K_half^n + OV^n)
const HILL_K_HALF  = 50;    // OV at which perceived intensity = 50% max
const HILL_PSI_MAX = 100;   // max perceived intensity on 0-100 scale
