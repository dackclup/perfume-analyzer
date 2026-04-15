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
  "5989-27-5":  { A: 6.7320, B: 1448.0, C: 200.0, range:[20,176], name:"Limonene" },
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
  "106-24-1":   { A: 7.4190, B: 1838.0, C: 175.0, range:[25,230], name:"Geraniol" },
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
  // Legacy / perceptual keys (some materials still tag with these)
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
  // Michael Edwards 2021 subfamily IDs (not covered by legacy keys above)
  aromatic_fougere: 0.55,
  water:            0.55,
  soft_floral:      0.45,
  floral_amber:     0.45,
  soft_amber:       0.40,
  woody_amber:      0.38,
  dry_woods:        0.38,
  mossy_woods:      0.40,
  woods:            0.42,
};

// Hill Equation half-max constant (K_half in OV units)
// and max perceived intensity (PSI_max, arbitrary 0-100 scale)
// PSI = PSI_max * OV^n / (K_half^n + OV^n)
const HILL_K_HALF  = 50;    // OV at which perceived intensity = 50% max
const HILL_PSI_MAX = 100;   // max perceived intensity on 0-100 scale

// ─────────────────────────────────────────────────────────────
// Aromachology Mood Scores (0–5 per dimension)
// 8 dimensions: [relaxing, energizing, focusing, uplifting,
//                sensual, calming, grounding, refreshing]
// Sources: Hongratanaworakit 2004, Moss & Oliver 2012,
// Herz 2009, Tisserand & Young 2014, Haze et al. 2002
// ─────────────────────────────────────────────────────────────
const MOOD_DIMENSIONS = ['relaxing','energizing','focusing','uplifting','sensual','calming','grounding','refreshing'];

const AROMACHOLOGY_SCORES = {
  // --- Floral ---
  "78-70-6":    [4, 1, 2, 3, 2, 4, 1, 3],  // Linalool — anxiolytic, sedative (Linck 2010)
  "106-22-9":   [3, 1, 1, 2, 3, 3, 2, 2],  // Citronellol — calming floral
  "106-24-1":   [3, 1, 1, 3, 3, 3, 1, 2],  // Geraniol — rose-like, mood-lifting
  "60-12-8":    [4, 0, 1, 2, 4, 4, 2, 1],  // PEA — rose, deeply calming
  "115-95-7":   [4, 0, 2, 2, 2, 4, 1, 2],  // Linalyl Acetate — lavender sedative
  "24851-98-7": [2, 1, 1, 3, 3, 2, 1, 3],  // Hedione — jasmine radiance
  "16409-43-1": [2, 2, 1, 3, 3, 2, 1, 2],  // Rose Oxide — rosy fresh
  "107-75-5":   [3, 0, 1, 2, 3, 3, 2, 1],  // Hydroxycitronellal — lily calm
  "67634-15-5": [1, 2, 2, 3, 2, 1, 0, 4],  // Floralozone — fresh ozone-floral
  "1205-17-0":  [2, 1, 1, 3, 3, 2, 1, 3],  // Helional — clean fresh floral

  // --- Citrus ---
  "5989-27-5":  [1, 4, 3, 4, 0, 1, 0, 5],  // Limonene — energizing (Komiya 2006)
  "5392-40-5":  [1, 4, 3, 4, 0, 1, 0, 4],  // Citral — lemony alert
  "18479-58-8": [1, 3, 2, 4, 0, 1, 0, 5],  // Dihydromyrcenol — citrus fresh
  "8008-56-8":  [1, 4, 3, 4, 0, 1, 0, 5],  // Lemon Oil
  "8008-57-9":  [2, 3, 2, 4, 0, 2, 0, 4],  // Sweet Orange Oil
  "8007-75-8":  [2, 3, 3, 4, 1, 2, 0, 4],  // Bergamot — balanced uplift+calm
  "8016-20-4":  [1, 3, 2, 4, 0, 1, 0, 5],  // Grapefruit Oil
  "8008-26-2":  [1, 4, 3, 4, 0, 1, 0, 4],  // Lime Oil

  // --- Green / Herbal ---
  "928-96-1":   [1, 2, 3, 3, 0, 2, 1, 4],  // Cis-3-Hexenol — green leaf
  "80-56-8":    [1, 3, 4, 3, 0, 1, 1, 4],  // alpha-Pinene — forest air (Li 2016)
  "127-91-3":   [1, 3, 4, 3, 0, 1, 1, 3],  // beta-Pinene — forest
  "470-82-6":   [1, 3, 5, 3, 0, 1, 0, 4],  // Eucalyptol — mental clarity (Moss 2003)
  "89-78-1":    [1, 3, 4, 2, 0, 1, 0, 5],  // Menthol — cooling alert
  "76-22-2":    [1, 3, 4, 2, 0, 1, 0, 3],  // Camphor — stimulating
  "8000-48-4":  [1, 3, 5, 3, 0, 1, 0, 4],  // Eucalyptus Oil — clarity
  "8006-90-4":  [1, 4, 4, 3, 0, 1, 0, 5],  // Peppermint Oil — energizing focus
  "8000-25-7":  [1, 3, 5, 3, 0, 1, 1, 3],  // Rosemary Oil — memory (Moss & Oliver 2012)
  "68647-73-4": [1, 3, 3, 2, 0, 2, 1, 3],  // Tea Tree Oil — clean medicinal

  // --- Spicy ---
  "97-53-0":    [2, 2, 2, 2, 3, 2, 3, 1],  // Eugenol — warm comfort
  "89-83-8":    [1, 3, 3, 2, 1, 1, 2, 2],  // Thymol — herbal spice
  "104-55-2":   [1, 3, 2, 3, 3, 1, 2, 1],  // Cinnamaldehyde — warm stimulant
  "104-54-1":   [2, 2, 1, 2, 3, 2, 2, 1],  // Cinnamic Alcohol — balsamic warm
  "97-54-1":    [2, 1, 1, 2, 3, 2, 3, 1],  // Isoeugenol — spicy warm
  "104-46-1":   [3, 1, 1, 2, 2, 3, 2, 1],  // Anethole — anise comfort
  "8000-34-8":  [2, 2, 2, 2, 3, 2, 3, 1],  // Clove Oil
  "8015-91-6":  [1, 3, 2, 3, 3, 1, 2, 1],  // Cinnamon Oil
  "8000-66-6":  [2, 2, 2, 3, 2, 2, 2, 2],  // Cardamom Oil

  // --- Sweet / Balsamic / Gourmand ---
  "121-33-5":   [4, 0, 1, 2, 3, 4, 3, 0],  // Vanillin — comforting (Tubaldi 2022)
  "121-32-4":   [4, 0, 1, 2, 3, 4, 3, 0],  // Ethyl Vanillin
  "91-64-5":    [3, 1, 1, 2, 3, 3, 4, 0],  // Coumarin — warm hay comfort
  "4940-11-8":  [3, 0, 0, 2, 2, 3, 3, 0],  // Ethyl Maltol — sweet comfort
  "100-52-7":   [1, 2, 2, 3, 1, 1, 1, 2],  // Benzaldehyde — almond bright
  "119-36-8":   [1, 2, 3, 2, 0, 2, 1, 3],  // Methyl Salicylate — wintergreen

  // --- Woody ---
  "54464-57-2": [3, 0, 2, 1, 3, 3, 5, 0],  // Iso E Super — velvety enveloping
  "77-53-2":    [3, 0, 2, 1, 2, 3, 5, 0],  // Cedrol — sedative (Kagawa 2003)
  "98-55-5":    [2, 1, 2, 1, 1, 2, 3, 2],  // Alpha Terpineol — pine-like
  "6790-58-5":  [2, 0, 1, 1, 4, 2, 5, 0],  // Ambroxan — warm amber
  "65113-99-7": [2, 0, 2, 1, 3, 2, 4, 0],  // Sandalore — creamy sandalwood
  "8014-09-3":  [3, 0, 2, 1, 3, 3, 5, 0],  // Patchouli Oil — grounding (Haze 2002)
  "8016-96-4":  [3, 0, 2, 0, 3, 3, 5, 0],  // Vetiver Oil — deep earthy calm
  "8006-87-9":  [4, 0, 2, 1, 4, 4, 4, 0],  // Sandalwood Oil — meditative (Heuberger 2006)
  "8000-27-9":  [3, 0, 2, 1, 1, 3, 5, 0],  // Cedarwood Oil
  "8016-36-2":  [3, 0, 3, 1, 2, 3, 4, 0],  // Frankincense — contemplative

  // --- Musk ---
  "1222-05-5":  [3, 0, 0, 1, 4, 3, 3, 0],  // Galaxolide — clean musk
  "33704-61-9": [3, 0, 1, 1, 4, 3, 3, 0],  // Cashmeran — warm musk-woody
  "541-91-3":   [3, 0, 0, 1, 5, 3, 3, 0],  // Muscone — animalic musk
  "81-14-1":    [3, 0, 0, 1, 4, 3, 3, 0],  // Musk Ketone — powdery musk
  "105-95-3":   [3, 0, 0, 1, 4, 3, 3, 0],  // Ethylene Brassylate — clean musk

  // --- Animalic / Indolic ---
  "120-72-9":   [2, 0, 0, 1, 5, 1, 3, 0],  // Indole — animalic floral

  // --- Aquatic / Marine ---
  "28940-11-6": [1, 2, 2, 3, 1, 1, 0, 4],  // Calone — marine fresh

  // --- Fixatives / Functional (near-neutral mood) ---
  "120-51-4":   [1, 0, 0, 0, 1, 1, 2, 0],  // Benzyl Benzoate — fixative
  "118-58-1":   [2, 0, 0, 1, 2, 2, 2, 0],  // Benzyl Salicylate — soft balsamic
  "100-51-6":   [1, 0, 1, 0, 0, 1, 1, 0],  // Benzyl Alcohol — mild
  "4602-84-0":  [2, 0, 1, 1, 2, 2, 2, 1],  // Farnesol — soft floral

  // --- Natural Oils (not above) ---
  "8000-28-0":  [5, 0, 2, 2, 2, 5, 2, 2],  // Lavender Oil — top anxiolytic (Kasper 2010)
  "8006-81-3":  [3, 1, 0, 3, 5, 2, 2, 1],  // Ylang Ylang Oil — euphoric (Hongratanaworakit 2004)
  "8022-96-6":  [2, 1, 1, 3, 5, 2, 1, 1],  // Jasmine Oil — euphoric confident
  "8016-38-4":  [3, 1, 1, 3, 3, 3, 1, 2],  // Neroli Oil — calming anti-anxiety
  "8000-46-2":  [3, 1, 1, 3, 2, 3, 2, 2],  // Geranium Oil — balancing
  "8015-92-7":  [4, 0, 1, 1, 1, 5, 2, 1],  // Chamomile Oil — deeply calming
  "8016-37-3":  [3, 0, 2, 1, 2, 3, 4, 0],  // Myrrh Oil — meditative
};

// ─────────────────────────────────────────────────────────────
// Family-Level Mood Defaults
// Fallback when a material has no individual AROMACHOLOGY_SCORES
// entry. Indexed by PRIMARY_FAMILIES tokens (23 families).
// [relaxing, energizing, focusing, uplifting, sensual, calming, grounding, refreshing]
// ─────────────────────────────────────────────────────────────
const FAMILY_MOOD_DEFAULTS = {
  citrus:        [1, 4, 3, 4, 0, 1, 0, 5],
  green:         [1, 2, 3, 3, 0, 2, 1, 4],
  herbal:        [1, 3, 4, 2, 0, 2, 2, 3],
  aldehydic:     [1, 2, 2, 3, 1, 1, 0, 3],
  aquatic:       [1, 2, 2, 3, 1, 1, 0, 4],
  ozonic:        [1, 2, 2, 3, 0, 1, 0, 4],
  fresh:         [1, 3, 3, 3, 0, 1, 0, 5],
  camphoraceous: [1, 3, 4, 2, 0, 1, 1, 3],
  floral:        [3, 1, 1, 3, 3, 3, 1, 2],
  fruity:        [2, 2, 1, 4, 1, 2, 0, 3],
  sweet:         [3, 0, 1, 2, 3, 3, 3, 0],
  gourmand:      [3, 0, 1, 2, 2, 3, 3, 0],
  lactonic:      [2, 1, 1, 3, 2, 2, 1, 1],
  spicy:         [2, 2, 2, 2, 3, 1, 3, 1],
  powdery:       [3, 0, 1, 1, 3, 3, 3, 0],
  woody:         [3, 0, 2, 1, 2, 3, 5, 0],
  balsamic:      [3, 0, 1, 1, 3, 3, 4, 0],
  resinous:      [3, 0, 2, 1, 2, 3, 4, 0],
  amber:         [3, 0, 1, 1, 4, 3, 5, 0],
  animalic:      [2, 0, 0, 1, 5, 1, 3, 0],
  leather:       [2, 0, 1, 0, 4, 1, 4, 0],
  musk:          [3, 0, 0, 1, 4, 3, 3, 0],
  smoky:         [2, 0, 1, 0, 2, 1, 4, 0],
  // Michael Edwards 2021 subfamily IDs. Transitional values are element-wise
  // means of their two adjacent mains; the rest copy their closest neighbour.
  aromatic_fougere: [1, 3, 4, 2, 0, 2, 2, 3],
  water:            [1, 2, 2, 3, 1, 1, 0, 4],
  soft_floral:      [3, 1, 1, 2, 2, 3, 2, 1],
  floral_amber:     [3, 0, 1, 2, 3, 3, 3, 1],
  soft_amber:       [3, 0, 1, 2, 3, 3, 4, 0],
  woody_amber:      [3, 0, 1, 1, 4, 2, 5, 0],
  dry_woods:        [2, 0, 1, 0, 3, 1, 4, 0],
  mossy_woods:      [3, 0, 2, 1, 2, 2, 5, 0],
  woods:            [3, 0, 2, 1, 2, 3, 5, 0],
};

// ─────────────────────────────────────────────────────────────
// Blend Target Resolution Table
// Maps shorthand names found in blends_with arrays to CAS
// numbers. Covers common shorthand names that don't exactly
// match any entry in DB by canonical name or synonym.
// ─────────────────────────────────────────────────────────────
const BLEND_TARGET_RESOLUTION = {
  // Family / Group shorthands → representative material CAS
  "amber":         "6790-58-5",   // Ambroxan as representative amber
  "ambergris":     "6790-58-5",   // Ambroxan
  "aldehydes":     null,           // Group — no single CAS; match any aldehydic material
  "woods":         null,           // Group
  "florals":       null,           // Group
  "musks":         null,           // Group
  "citrus oils":   null,           // Group

  // Common shorthand → exact CAS
  "lavender":      "8000-28-0",   // Lavender Oil
  "rose":          "8007-01-0",   // Rose Oil
  "jasmine":       "8022-96-6",   // Jasmine Oil
  "ylang":         "8006-81-3",   // Ylang Ylang Oil
  "ylang ylang":   "8006-81-3",
  "bergamot":      "8007-75-8",   // Bergamot Oil
  "patchouli":     "8014-09-3",   // Patchouli Oil
  "vetiver":       "8016-96-4",   // Vetiver Oil
  "sandalwood":    "8006-87-9",   // Sandalwood Oil
  "cedarwood":     "8000-27-9",   // Cedarwood Oil
  "cedar":         "8000-27-9",
  "neroli":        "8016-38-4",   // Neroli Oil
  "frankincense":  "8016-36-2",   // Frankincense Oil
  "myrrh":         "8016-37-3",   // Myrrh Oil
  "clove":         "8000-34-8",   // Clove Oil
  "cinnamon":      "8015-91-6",   // Cinnamon Oil
  "rosemary":      "8000-25-7",   // Rosemary Oil
  "peppermint":    "8006-90-4",   // Peppermint Oil
  "eucalyptus":    "8000-48-4",   // Eucalyptus Oil
  "geranium":      "8000-46-2",   // Geranium Oil
  "lemon":         "8008-56-8",   // Lemon Oil
  "orange":        "8008-57-9",   // Sweet Orange Oil
  "grapefruit":    "8016-20-4",   // Grapefruit Oil
  "lime":          "8008-26-2",   // Lime Oil
  "chamomile":     "8015-92-7",   // Chamomile Oil
  "tea tree":      "68647-73-4",  // Tea Tree Oil
  "oakmoss":       "9000-50-4",   // Oakmoss Absolute
  "labdanum":      "8016-26-0",   // Labdanum Resin
  "benzoin":       "9000-72-0",   // Benzoin Resin
  "peru balsam":   "8007-00-9",   // Peru Balsam
  "tolu balsam":   "9000-64-0",   // Tolu Balsam
  "rosewood":      "78-70-6",     // Linalool (primary component)
  "tonka":         "91-64-5",     // Coumarin (primary odorant of tonka bean)
  "musk":          "541-91-3",    // Muscone as default musk
};

// ─────────────────────────────────────────────────────────────
// Functional Group SMILES Patterns (System 4)
// Regex patterns applied to canonical SMILES strings.
// NOTE: SMILES regex is approximate and may produce false positives.
// Results should be labeled "approximate" in the UI.
// ─────────────────────────────────────────────────────────────
const FUNCTIONAL_GROUP_PATTERNS = {
  aldehyde: {
    label: "Aldehyde (-CHO)",
    test(smiles) {
      // Aldehyde = terminal carbonyl on a carbon: C=O or O=C(H)
      // Exclude: ester C(=O)O, amide C(=O)N, ketone C(=O)C
      if (/C=O\)?$/.test(smiles)) return true;       // terminal C=O or C=O)
      if (/^O=C[^(O)]/.test(smiles)) return true;    // starts with O=C
      if (/\/C=O|\\C=O/.test(smiles)) return true;   // after stereo bond
      if (/\(C=O\)/.test(smiles)) return true;        // branch aldehyde (e.g. Vanillin)
      if (/\[CH\]=O/.test(smiles)) return true;       // explicit CHO
      if (/C\(=O\)\)?$/.test(smiles)) return true;    // terminal C(=O)
      // C(=O) NOT followed by O(ester) or N(amide) or C/c(ketone)
      if (/C\(=O\)[^ONCc)]/.test(smiles)) return true;
      return false;
    },
  },
  ketone: {
    label: "Ketone (C=O)",
    test(smiles) {
      // CC(=O)C pattern — carbonyl flanked by carbons
      return /[Cc]\(=O\)[Cc]/.test(smiles) || /[Cc]C\(=O\)[Cc]/.test(smiles);
    },
  },
  primary_amine: {
    label: "Primary Amine (-NH2)",
    test(smiles) {
      return /N(?![+=])(?!\()/.test(smiles) && /\[NH2\]|N[^(=+]/.test(smiles);
    },
  },
  secondary_amine: {
    label: "Secondary Amine (-NH-)",
    test(smiles) {
      return /\[nH\]|\[NH\]/.test(smiles);
    },
  },
  alcohol: {
    label: "Alcohol (-OH)",
    test(smiles) {
      // O not in ester C(=O)O, not in ring O (epoxide), not aromatic
      return /[^=]O[^=Cc(]|O$|[^(=]O[H]/.test(smiles) || /\)O$/.test(smiles) || /\(O\)/.test(smiles);
    },
  },
  phenol: {
    label: "Phenol (Ar-OH)",
    test(smiles) {
      return /cO[^C(=]|cO$|cO\)/.test(smiles) || /c1[^)]*O[Hh]?/.test(smiles);
    },
  },
  carboxylic_acid: {
    label: "Carboxylic Acid (-COOH)",
    test(smiles) {
      return /C\(=O\)O[^Cc]|C\(=O\)O$|C\(=O\)\[OH\]/.test(smiles);
    },
  },
  ester: {
    label: "Ester (-COOR)",
    test(smiles) {
      return /C\(=O\)O[Cc]|OC\(=O\)[Cc]/.test(smiles);
    },
  },
  thiol: {
    label: "Thiol (-SH)",
    test(smiles) {
      return /[^=]S[^=Oo(]|S$|\[SH\]/.test(smiles);
    },
  },
  alkene: {
    label: "Alkene (C=C)",
    test(smiles) {
      // Strip Kekulé aromatic rings (C1=CC=CC=C1) to avoid false positives
      let s = smiles.replace(/C\d=CC=CC=C\d/g, '');
      s = s.replace(/C=C\d/g, '').replace(/\dC=C/g, '');
      return /C=C|C\(=C[C)]/.test(s);
    },
  },
  epoxide: {
    label: "Epoxide",
    test(smiles) {
      return /C1OC1|C1CO1/.test(smiles);
    },
  },
  lactone: {
    label: "Lactone (cyclic ester)",
    test(smiles) {
      // Ring containing C(=O)O pattern
      return /C\(=O\)O.*\d|OC\(=O\).*\d/.test(smiles) && /\d/.test(smiles);
    },
  },
  nitrile: {
    label: "Nitrile (-CN)",
    test(smiles) {
      return /C#N/.test(smiles);
    },
  },
};

// ─────────────────────────────────────────────────────────────
// Reactive Pair Rules (System 4)
// Known problematic chemical interactions in perfumery.
// Sources: Calkin & Jellinek "Perfumery: Practice and Principles"
// (1994), Sell "Chemistry of Fragrances" (2006), Curtis & Williams
// "Introduction to Perfumery" (2001)
// ─────────────────────────────────────────────────────────────
const REACTIVE_PAIRS = [
  {
    group_a: "aldehyde",
    group_b: "primary_amine",
    reaction: "Schiff base formation",
    effect: "Color darkening (yellow to brown); loss of both aldehyde freshness and amine character; new imine note",
    severity: "high",
    timeframe: "Days to weeks",
    mitigation: "Replace primary amine (e.g. use Dimethyl Anthranilate instead of Methyl Anthranilate); add antioxidant (BHT 0.01%); separate application timing",
    colorChange: { from: "#f5f0e0", to: "#8B6914" },
  },
  {
    group_a: "aldehyde",
    group_b: "secondary_amine",
    reaction: "Enamine formation",
    effect: "Slower than Schiff base; moderate color change; altered note character",
    severity: "medium",
    timeframe: "Weeks to months",
    mitigation: "Monitor aging; consider substitution",
    colorChange: { from: "#f5f0e0", to: "#C4A44A" },
  },
  {
    group_a: "aldehyde",
    group_b: "alcohol",
    reaction: "Hemiacetal / acetal formation",
    effect: "Subtle note change; generally reversible equilibrium; minimal color change",
    severity: "low",
    timeframe: "Weeks (equilibrium)",
    mitigation: "Usually acceptable in finished product; monitor pH",
    colorChange: null,
  },
  {
    group_a: "phenol",
    group_b: "aldehyde",
    reaction: "Phenol-aldehyde condensation",
    effect: "Brownish discoloration; possible off-notes; resinification over time",
    severity: "medium",
    timeframe: "Weeks to months",
    mitigation: "Separate in formula; add antioxidant; avoid heat exposure",
    colorChange: { from: "#f5f0e0", to: "#A0522D" },
  },
  {
    group_a: "thiol",
    group_b: "alkene",
    reaction: "Thiol-ene reaction",
    effect: "Loss of thiol character; new sulfide notes; potential off-odor",
    severity: "medium",
    timeframe: "Days",
    mitigation: "Avoid combination; use radical inhibitor if needed",
    colorChange: null,
  },
  {
    group_a: "carboxylic_acid",
    group_b: "alcohol",
    reaction: "Fischer esterification (slow)",
    effect: "Very slow at room temperature without catalyst; fruity ester byproduct over months",
    severity: "low",
    timeframe: "Months to years at RT",
    mitigation: "Acceptable; monitor pH; avoid acid catalysts in formula",
    colorChange: null,
  },
  {
    group_a: "aldehyde",
    group_b: "thiol",
    reaction: "Hemithioacetal formation",
    effect: "Strong unpleasant sulfurous off-note; rapid reaction",
    severity: "high",
    timeframe: "Hours to days",
    mitigation: "Never combine; replace one component",
    colorChange: null,
  },
  {
    group_a: "ketone",
    group_b: "primary_amine",
    reaction: "Imine (ketimine) formation",
    effect: "Slower than aldehyde-amine; moderate impact on odor profile",
    severity: "low",
    timeframe: "Weeks to months",
    mitigation: "Monitor; generally less problematic than aldehyde-amine",
    colorChange: { from: "#f5f0e0", to: "#D4C78A" },
  },
  {
    group_a: "ester",
    group_b: "alcohol",
    reaction: "Transesterification",
    effect: "Exchange of alcohol groups; subtle odor shift; reversible equilibrium",
    severity: "low",
    timeframe: "Months",
    mitigation: "Acceptable; no significant quality impact",
    colorChange: null,
  },
  {
    group_a: "alkene",
    group_b: "alkene",
    reaction: "Oxidative polymerization",
    effect: "Terpene polymerization upon oxidation; viscosity increase; off-notes",
    severity: "medium",
    timeframe: "Weeks (accelerated by light/air)",
    mitigation: "Add antioxidant (BHT/BHA 0.01-0.05%); store in dark; nitrogen blanket",
    colorChange: { from: "#f5f0e0", to: "#E8D88E" },
  },
  {
    group_a: "phenol",
    group_b: "phenol",
    reaction: "Oxidative coupling / browning",
    effect: "Phenol oxidation causes progressive darkening; melanoidin-like polymers",
    severity: "medium",
    timeframe: "Weeks to months",
    mitigation: "Add antioxidant; minimize air contact; UV-protected packaging",
    colorChange: { from: "#f5f0e0", to: "#6B4226" },
  },
];

// ─────────────────────────────────────────────────────────────
// A1: Material Properties Enrichment Table
// MW (g/mol), density (g/mL @20°C), logP, BP (°C), canonical SMILES
// Sources: PubChem, RIFM, Sigma-Aldrich, Leffingwell
// ─────────────────────────────────────────────────────────────
const MATERIAL_PROPERTIES = {
  // ── Top notes: Citrus / Fresh ──
  "5989-27-5":  { mw: 136.23, density: 0.842, logP: 4.57, bp: 176, smiles: "CC1=CCC(CC1)C(=C)C" },
  "80-56-8":    { mw: 136.23, density: 0.858, logP: 4.44, bp: 155, smiles: "CC1=CCC2CC1C2(C)C" },
  "127-91-3":   { mw: 136.23, density: 0.872, logP: 4.16, bp: 166, smiles: "CC1=CCC2CC1C2(C)C" },
  "123-35-3":   { mw: 136.23, density: 0.794, logP: 4.17, bp: 167, smiles: "CC(=CCCC(=CC)C)C" },
  "79-92-5":    { mw: 136.23, density: 0.842, logP: 4.22, bp: 159, smiles: "CC1(C2CC1C(=C)C2)C" },
  "586-62-9":   { mw: 136.23, density: 0.863, logP: 4.47, bp: 185, smiles: "CC1=CCC(=CC1)C(C)C" },
  "99-83-2":    { mw: 136.23, density: 0.846, logP: 3.38, bp: 171, smiles: "CC1=CCC(=CC1)C(C)C" },
  "3387-41-5":  { mw: 136.23, density: 0.844, logP: 4.16, bp: 163, smiles: "CC1=CCC2(CC1)C(C2)C" },
  "13877-91-3": { mw: 136.23, density: 0.800, logP: 4.17, bp: 177, smiles: "CC(=CCC=C(C)C)C=C" },
  "470-82-6":   { mw: 154.25, density: 0.922, logP: 2.74, bp: 176, smiles: "CC1(C)OC2CC(CC1C2)C" },
  "124-13-0":   { mw: 128.21, density: 0.821, logP: 2.78, bp: 171, smiles: "CCCCCCCC=O" },
  "124-19-6":   { mw: 142.24, density: 0.827, logP: 3.27, bp: 191, smiles: "CCCCCCCCC=O" },
  "112-31-2":   { mw: 156.27, density: 0.830, logP: 3.76, bp: 208, smiles: "CCCCCCCCCC=O" },
  "112-44-7":   { mw: 170.29, density: 0.830, logP: 4.26, bp: 223, smiles: "CCCCCCCCCCC=O" },
  "112-54-9":   { mw: 184.32, density: 0.831, logP: 4.75, bp: 238, smiles: "CCCCCCCCCCCC=O" },
  "141-78-6":   { mw: 88.11, density: 0.902, logP: 0.73, bp: 77, smiles: "CCOC(C)=O" },
  "123-92-2":   { mw: 130.18, density: 0.876, logP: 2.25, bp: 142, smiles: "CC(C)CCOC(C)=O" },
  "628-63-7":   { mw: 130.18, density: 0.876, logP: 2.30, bp: 149, smiles: "CCCCCOC(C)=O" },
  "142-92-7":   { mw: 144.21, density: 0.878, logP: 2.83, bp: 171, smiles: "CCCCCCOC(C)=O" },
  "928-96-1":   { mw: 100.16, density: 0.847, logP: 1.61, bp: 157, smiles: "CC/C=C\\CCO" },
  "5392-40-5":  { mw: 152.23, density: 0.893, logP: 3.45, bp: 229, smiles: "CC(=CCCC(=CC=O)C)C" },
  "106-23-0":   { mw: 154.25, density: 0.855, logP: 3.53, bp: 207, smiles: "CC(CCCC(C)C=O)C" },
  // ── Top/Middle notes: Floral / Fresh ──
  "78-70-6":    { mw: 154.25, density: 0.870, logP: 2.97, bp: 198, smiles: "CC(=CCC(/C)(C=C)O)C" },
  "106-22-9":   { mw: 156.27, density: 0.855, logP: 3.91, bp: 225, smiles: "CC(CCCC(C)O)CC=C" },
  "106-24-1":   { mw: 154.25, density: 0.889, logP: 3.56, bp: 230, smiles: "CC(=CCCC(=CCO)C)C" },
  "106-25-2":   { mw: 154.25, density: 0.876, logP: 3.47, bp: 225, smiles: "CC(=CCCC(=C/CO)\\C)C" },
  "98-55-5":    { mw: 154.25, density: 0.935, logP: 2.98, bp: 219, smiles: "CC1=CCC(CC1)C(C)(C)O" },
  "562-74-3":   { mw: 154.25, density: 0.933, logP: 2.30, bp: 212, smiles: "CC1=CCC(CC1O)C(C)C" },
  "115-95-7":   { mw: 196.29, density: 0.895, logP: 3.56, bp: 220, smiles: "CC(=CCC(/C)(C=C)OC(C)=O)C" },
  "105-87-3":   { mw: 196.29, density: 0.907, logP: 4.04, bp: 242, smiles: "CC(=CCCC(=CCOC(C)=O)C)C" },
  "141-12-8":   { mw: 196.29, density: 0.911, logP: 3.56, bp: 240, smiles: "CC(=CCC/C(=C\\COC(C)=O)C)C" },
  "150-84-5":   { mw: 198.30, density: 0.890, logP: 4.04, bp: 244, smiles: "CC(CCCC(C)OC(C)=O)CC=C" },
  "140-11-4":   { mw: 150.17, density: 1.054, logP: 1.96, bp: 213, smiles: "CC(=O)OCc1ccccc1" },
  "103-45-7":   { mw: 164.20, density: 1.030, logP: 2.30, bp: 232, smiles: "CC(=O)OCCc1ccccc1" },
  "18479-58-8": { mw: 156.27, density: 0.830, logP: 3.47, bp: 192, smiles: "CC(CCCC(C)(C)O)C=C" },
  "16409-43-1": { mw: 154.25, density: 0.947, logP: 2.51, bp: 210, smiles: "CC1CCC(OC1)C(=C)C" },
  "107-75-5":   { mw: 172.27, density: 0.918, logP: 2.19, bp: 241, smiles: "CC(CCCC(C)(CC=O)O)CC" },
  "60-12-8":    { mw: 122.16, density: 1.020, logP: 1.36, bp: 219, smiles: "OCCc1ccccc1" },
  "122-78-1":   { mw: 120.15, density: 1.027, logP: 1.78, bp: 195, smiles: "O=CCc1ccccc1" },
  "134-20-3":   { mw: 151.16, density: 1.168, logP: 1.89, bp: 256, smiles: "COC(=O)c1ccccc1N" },
  "104-55-2":   { mw: 132.16, density: 1.050, logP: 1.98, bp: 248, smiles: "O=C/C=C/c1ccccc1" },
  "104-54-1":   { mw: 134.17, density: 1.044, logP: 1.95, bp: 257, smiles: "OC/C=C/c1ccccc1" },
  "89-78-1":    { mw: 156.27, density: 0.890, logP: 3.38, bp: 212, smiles: "CC1CCC(C(C1)O)C(C)C" },
  "89-80-5":    { mw: 154.25, density: 0.895, logP: 2.96, bp: 207, smiles: "CC1CCC(C(=O)C1)C(C)C" },
  "76-22-2":    { mw: 152.23, density: 0.992, logP: 2.38, bp: 204, smiles: "CC1(C)C2CCC1(C)C(=O)C2" },
  "507-70-0":   { mw: 154.25, density: 1.011, logP: 2.71, bp: 213, smiles: "CC1(C)C2CCC1(C)C(O)C2" },
  "76-49-3":    { mw: 196.29, density: 1.008, logP: 3.36, bp: 227, smiles: "CC1(C)C2CCC1(C)C(OC(C)=O)C2" },
  "1632-73-1":  { mw: 154.25, density: 0.940, logP: 2.12, bp: 201, smiles: "CC1(C)C2CC(O)C1(C)CC2" },
  "1195-79-5":  { mw: 152.23, density: 0.946, logP: 2.13, bp: 193, smiles: "CC1(C)C2CC(=O)C1(C)CC2" },
  "99-49-0":    { mw: 150.22, density: 0.960, logP: 2.74, bp: 231, smiles: "CC1=CC(=O)C(CC1)C(=C)C" },
  "89-83-8":    { mw: 150.22, density: 0.965, logP: 3.30, bp: 233, smiles: "Cc1ccc(C(C)C)c(O)c1" },
  "499-75-2":   { mw: 150.22, density: 0.976, logP: 3.49, bp: 237, smiles: "Cc1ccc(O)c(C(C)C)c1" },
  "104-46-1":   { mw: 148.20, density: 0.988, logP: 3.39, bp: 235, smiles: "COc1ccc(/C=C/C)cc1" },
  "140-67-0":   { mw: 148.20, density: 0.965, logP: 3.47, bp: 216, smiles: "COc1ccc(CC=C)cc1" },
  "119-36-8":   { mw: 152.15, density: 1.174, logP: 2.55, bp: 222, smiles: "COC(=O)c1ccccc1O" },
  "100-51-6":   { mw: 108.14, density: 1.045, logP: 1.10, bp: 205, smiles: "OCc1ccccc1" },
  "100-52-7":   { mw: 106.12, density: 1.044, logP: 1.48, bp: 178, smiles: "O=Cc1ccccc1" },
  "123-11-5":   { mw: 136.15, density: 1.119, logP: 1.76, bp: 248, smiles: "COc1ccc(C=O)cc1" },
  "105-13-5":   { mw: 138.16, density: 1.113, logP: 0.86, bp: 259, smiles: "COc1ccc(CO)cc1" },
  "93-58-3":    { mw: 136.15, density: 1.094, logP: 2.12, bp: 199, smiles: "COC(=O)c1ccccc1" },
  "90-05-1":    { mw: 124.14, density: 1.129, logP: 1.32, bp: 205, smiles: "COc1ccccc1O" },
  // ── Middle notes: Floral / Fruity ──
  "91-64-5":    { mw: 146.14, density: 0.935, logP: 1.39, bp: 301, smiles: "O=c1ccc2ccccc2o1" },
  "97-53-0":    { mw: 164.20, density: 1.067, logP: 2.27, bp: 254, smiles: "COc1cc(CC=C)ccc1O" },
  "97-54-1":    { mw: 164.20, density: 1.084, logP: 2.58, bp: 266, smiles: "COc1cc(/C=C/C)ccc1O" },
  "93-15-2":    { mw: 178.23, density: 1.036, logP: 2.72, bp: 255, smiles: "COc1cc(CC=C)cc(OC)c1O" },
  "120-57-0":   { mw: 150.13, density: 1.337, logP: 1.05, bp: 263, smiles: "O=Cc1ccc2OCOc2c1" },
  "127-41-3":   { mw: 192.30, density: 0.932, logP: 3.70, bp: 230, smiles: "CC1=CC(=O)CC(C1)C=CC(C)(C)C" },
  "14901-07-6": { mw: 192.30, density: 0.946, logP: 4.42, bp: 243, smiles: "CC1=CC(=O)C(C)(C)C=C1/C=C/C(C)C" },
  "127-42-4":   { mw: 206.32, density: 0.933, logP: 4.30, bp: 237, smiles: null },
  "127-51-5":   { mw: 206.32, density: 0.928, logP: 4.60, bp: 250, smiles: null },
  "103-26-4":   { mw: 162.19, density: 1.042, logP: 2.62, bp: 261, smiles: "COC(=O)/C=C/c1ccccc1" },
  "122-40-7":   { mw: 202.29, density: 0.963, logP: 4.24, bp: 290, smiles: "CCCCCC(C=O)=Cc1ccccc1" },
  "101-86-0":   { mw: 216.32, density: 0.954, logP: 4.82, bp: 305, smiles: "CCCCCCC(C=O)=Cc1ccccc1" },
  "103-95-7":   { mw: 184.28, density: 0.946, logP: 3.66, bp: 270, smiles: null },
  "18127-01-0": { mw: 204.31, density: 0.953, logP: 3.80, bp: 293, smiles: null },
  "1205-17-0":  { mw: 192.21, density: 1.180, logP: 1.80, bp: 290, smiles: "OCCC=Cc1ccc2OCOc2c1" },
  "24851-98-7": { mw: 226.31, density: 0.953, logP: 3.30, bp: 290, smiles: "COC(=O)CC1CCC(=O)C1CC" },
  "706-14-9":   { mw: 170.25, density: 0.950, logP: 2.61, bp: 281, smiles: "CCCCCC1OC(=O)CC1" },
  "104-67-6":   { mw: 184.28, density: 0.940, logP: 3.09, bp: 297, smiles: "CCCCCCC1OC(=O)CC1" },
  "705-86-2":   { mw: 170.25, density: 0.949, logP: 2.66, bp: 280, smiles: "CCCCCC1OC(=O)CCC1" },
  "104-61-0":   { mw: 156.22, density: 0.958, logP: 2.14, bp: 264, smiles: "CCCCC1OC(=O)CC1" },
  "118-71-8":   { mw: 126.11, density: 1.270, logP: -0.23, bp: 265, smiles: "CC1=C(O)C(=O)C=CO1" },
  "4940-11-8":  { mw: 140.14, density: 1.210, logP: 0.03, bp: 275, smiles: "CCC1=C(O)C(=O)C=CO1" },
  "103-82-2":   { mw: 136.15, density: 1.091, logP: 1.41, bp: 266, smiles: "OC(=O)Cc1ccccc1" },
  "111-12-6":   { mw: 154.21, density: 0.923, logP: 2.66, bp: 226, smiles: "CCCCCCC#CCOC(=O)C" },
  "6259-76-3":  { mw: 222.28, density: 1.036, logP: 5.07, bp: 300, smiles: "CCCCCCOC(=O)c1ccccc1O" },
  "120-51-4":   { mw: 212.24, density: 1.118, logP: 3.97, bp: 323, smiles: "O=C(OCc1ccccc1)c1ccccc1" },
  "118-58-1":   { mw: 228.24, density: 1.176, logP: 4.31, bp: 320, smiles: "O=C(OCc1ccccc1)c1ccccc1O" },
  "43052-87-5": { mw: 192.30, density: 0.928, logP: 3.90, bp: 253, smiles: null },
  "23726-91-2": { mw: 192.30, density: 0.934, logP: 4.20, bp: 260, smiles: null },
  "23696-85-7": { mw: 190.28, density: 0.952, logP: 3.60, bp: 274, smiles: null },
  "28940-11-6": { mw: 192.26, density: 1.030, logP: 2.22, bp: 261, smiles: null },
  "116-26-7":   { mw: 150.22, density: 0.973, logP: 2.60, bp: 253, smiles: "CC1=C(C=O)C(C)(C)CC1" },
  "4602-84-0":  { mw: 222.37, density: 0.887, logP: 5.77, bp: 283, smiles: "CC(=CCCC(=CCCC(=CCO)C)C)C" },
  "7212-44-4":  { mw: 222.37, density: 0.878, logP: 5.32, bp: 276, smiles: "CC(=CCCC(C)(C=C)CC=C(C)CCC=C(C)C)O" },
  "120-72-9":   { mw: 117.15, density: 1.220, logP: 2.14, bp: 254, smiles: "c1ccc2[nH]ccc2c1" },
  "83-34-1":    { mw: 131.17, density: 1.070, logP: 2.60, bp: 266, smiles: "Cc1c[nH]c2ccccc12" },
  "106-44-5":   { mw: 108.14, density: 1.034, logP: 1.94, bp: 202, smiles: "Cc1ccc(O)cc1" },
  // ── Base notes: Woody / Amber / Musk ──
  "121-33-5":   { mw: 152.15, density: 1.056, logP: 1.21, bp: 285, smiles: "COc1cc(C=O)ccc1O" },
  "121-32-4":   { mw: 166.17, density: 1.110, logP: 1.58, bp: 295, smiles: "CCOc1cc(C=O)ccc1O" },
  "54464-57-2": { mw: 234.38, density: 0.960, logP: 4.73, bp: 285, smiles: null },
  "1222-05-5":  { mw: 258.40, density: 1.040, logP: 5.90, bp: 285, smiles: null },
  "33704-61-9": { mw: 206.32, density: 0.980, logP: 3.44, bp: 265, smiles: null },
  "6790-58-5":  { mw: 236.40, density: 0.980, logP: 4.34, bp: 280, smiles: null },
  "3738-00-9":  { mw: 236.40, density: 1.000, logP: 4.50, bp: 290, smiles: null },
  "21145-77-7": { mw: 258.40, density: 1.063, logP: 5.70, bp: 300, smiles: null },
  "81-14-1":    { mw: 294.30, density: 1.160, logP: 3.87, bp: 350, smiles: null },
  "541-91-3":   { mw: 238.41, density: 0.920, logP: 5.50, bp: 327, smiles: null },
  "105-95-3":   { mw: 256.38, density: 0.969, logP: 4.95, bp: 332, smiles: null },
  "106-02-5":   { mw: 240.38, density: 0.946, logP: 5.67, bp: 318, smiles: null },
  "34902-57-3": { mw: 238.37, density: 0.945, logP: 5.23, bp: 315, smiles: null },
  "77-53-2":    { mw: 222.37, density: 1.008, logP: 4.53, bp: 291, smiles: null },
  "77-54-3":    { mw: 264.40, density: 1.009, logP: 5.00, bp: 285, smiles: null },
  "515-69-5":   { mw: 222.37, density: 0.929, logP: 5.07, bp: 315, smiles: null },
  "5986-55-0":  { mw: 222.37, density: 0.990, logP: 3.84, bp: 295, smiles: null },
  "65113-99-7": { mw: 210.36, density: 0.908, logP: 4.22, bp: 290, smiles: null },
  "198404-98-7":{ mw: 210.31, density: 0.978, logP: 3.40, bp: 285, smiles: null },
  "4674-50-4":  { mw: 218.33, density: 0.980, logP: 4.03, bp: 270, smiles: null },
  // ── Solvents & carriers ──
  "64-17-5":    { mw: 46.07,  density: 0.789, logP: -0.31, bp: 78, smiles: "CCO" },
  "57-55-6":    { mw: 76.09,  density: 1.036, logP: -0.92, bp: 188, smiles: "CC(O)CO" },
  "25265-71-8": { mw: 134.17, density: 1.023, logP: -0.64, bp: 232, smiles: "CC(O)COCC(C)O" },
  "110-27-0":   { mw: 270.45, density: 0.853, logP: 7.17, bp: 315, smiles: "CC(C)OC(=O)CCCCCCCCCCCCC" },
  "84-66-2":    { mw: 222.24, density: 1.118, logP: 2.42, bp: 298, smiles: "CCOC(=O)c1ccccc1C(=O)OCC" },
  "77-93-0":    { mw: 276.28, density: 1.135, logP: 0.33, bp: 294, smiles: "CCOC(=O)CC(CC(=O)OCC)(OC(=O)CC)O" },
  "102-76-1":   { mw: 218.21, density: 1.160, logP: -0.25, bp: 259, smiles: "CC(=O)OCC(COC(C)=O)OC(C)=O" },
  "111-01-3":   { mw: 422.81, density: 0.810, logP: 14.12, bp: 350, smiles: null },
  "128-37-0":   { mw: 220.35, density: 1.048, logP: 5.10, bp: 265, smiles: "Cc1cc(C(C)(C)C)c(O)c(C(C)(C)C)c1" },
};

// ─────────────────────────────────────────────────────────────
// A5: Material Cost Database
// ─────────────────────────────────────────────────────────────
// B3: Fragrance Wheel (Michael Edwards taxonomy)
// 4 quadrants × 3-4 subcategories = 14 segments
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// C4: Family-specific optimal note ratios
// Professional perfumers adjust pyramid balance by olfactive family.
// Sources: Perfumery techniques literature, Michael Edwards
// ─────────────────────────────────────────────────────────────
const FAMILY_NOTE_RATIOS = {
  // ── Legacy keys kept for backward-compat (some material odor_type tokens
  //    still hit these directly via getMaterialFamilies) ──────────────────
  'citrus':   { top: 0.35, mid: 0.35, base: 0.30 },
  'fresh':    { top: 0.35, mid: 0.35, base: 0.30 },
  'green':    { top: 0.30, mid: 0.40, base: 0.30 },
  'aquatic':  { top: 0.30, mid: 0.40, base: 0.30 },
  'fruity':   { top: 0.30, mid: 0.40, base: 0.30 },
  'floral':   { top: 0.20, mid: 0.50, base: 0.30 },
  'soft_floral':{ top: 0.15, mid: 0.50, base: 0.35 },
  'oriental': { top: 0.10, mid: 0.35, base: 0.55 },
  'spicy':    { top: 0.15, mid: 0.40, base: 0.45 },
  'gourmand': { top: 0.10, mid: 0.40, base: 0.50 },
  'woody':    { top: 0.15, mid: 0.35, base: 0.50 },
  'mossy':    { top: 0.15, mid: 0.35, base: 0.50 },
  'dry_woods':{ top: 0.10, mid: 0.35, base: 0.55 },
  'aromatic': { top: 0.25, mid: 0.40, base: 0.35 },
  'amber':    { top: 0.10, mid: 0.35, base: 0.55 },
  'musk':     { top: 0.15, mid: 0.40, base: 0.45 },
  'animalic': { top: 0.10, mid: 0.30, base: 0.60 },
  // ── Michael Edwards 2021–2026 wheel — 14 subfamilies ──────────────────
  //    Transitionals (fruity/floral_amber/woody_amber) are element-wise
  //    means of their two adjacent mains; aromatic_fougere uses the old
  //    'aromatic' anchor; soft_amber leans sweeter + base-heavy.
  'aromatic_fougere': { top: 0.25, mid: 0.40, base: 0.35 },
  'water':            { top: 0.30, mid: 0.40, base: 0.30 },
  // fruity already defined above (Fresh↔Floral transitional:
  // mean(citrus, floral) = { top 0.275, mid 0.425, base 0.30 } — legacy
  // entry above is close; keep legacy value for consistency.)
  'floral_amber':     { top: 0.15, mid: 0.425, base: 0.425 }, // mean(floral, amber)
  'soft_amber':       { top: 0.10, mid: 0.40, base: 0.50 },
  'woody_amber':      { top: 0.125, mid: 0.35, base: 0.525 }, // mean(amber, woods)
  'mossy_woods':      { top: 0.15, mid: 0.35, base: 0.50 },
  'woods':            { top: 0.15, mid: 0.35, base: 0.50 },
  'default':  { top: 0.20, mid: 0.45, base: 0.35 },
};

// ─── Michael Edwards 2021–2026 Fragrance Wheel ─────────────────────────
// 4 Main Families × 14 Subfamilies. Fruity, Floral Amber, and Woody Amber
// are transitional subfamilies that bridge two adjacent main families.
// "Oriental" was renamed to "Amber" in the 2021 revision.
// ───────────────────────────────────────────────────────────────────────
const WHEEL_VERSION = 'edwards-2021';

// Colour palette — one base hue per main family; transitionals expose a
// two-stop gradient so the SVG renderer can blend adjacent mains.
const _MAIN_COLORS = {
  fresh:  '#22c55e', // green
  floral: '#ec4899', // pink
  amber:  '#f59e0b', // gold
  woody:  '#78350f', // brown
};

const FRAGRANCE_WHEEL = {
  segments: [
    // Fresh quadrant (clockwise from top)
    { id: 'aromatic_fougere', quadrant: 'Fresh',  angle: 0,   color: '#14b8a6' },
    { id: 'citrus',           quadrant: 'Fresh',  angle: 26,  color: '#fbbf24' },
    { id: 'water',            quadrant: 'Fresh',  angle: 51,  color: '#22d3ee' },
    { id: 'green',            quadrant: 'Fresh',  angle: 77,  color: '#84cc16' },
    // Transitional Fresh → Floral
    { id: 'fruity',           quadrant: 'Fresh',  angle: 103, color: null,
      transitional: true, gradient: [_MAIN_COLORS.fresh, _MAIN_COLORS.floral] },
    // Floral quadrant
    { id: 'floral',           quadrant: 'Floral', angle: 129, color: '#ec4899' },
    { id: 'soft_floral',      quadrant: 'Floral', angle: 154, color: '#f9a8d4' },
    // Transitional Floral → Amber
    { id: 'floral_amber',     quadrant: 'Floral', angle: 180, color: null,
      transitional: true, gradient: [_MAIN_COLORS.floral, _MAIN_COLORS.amber] },
    // Amber quadrant
    { id: 'soft_amber',       quadrant: 'Amber',  angle: 206, color: '#fcd34d' },
    { id: 'amber',            quadrant: 'Amber',  angle: 231, color: '#f59e0b' },
    // Transitional Amber → Woody
    { id: 'woody_amber',      quadrant: 'Amber',  angle: 257, color: null,
      transitional: true, gradient: [_MAIN_COLORS.amber, _MAIN_COLORS.woody] },
    // Woody quadrant
    { id: 'dry_woods',        quadrant: 'Woody',  angle: 283, color: '#92400e' },
    { id: 'mossy_woods',      quadrant: 'Woody',  angle: 308, color: '#65a30d' },
    { id: 'woods',            quadrant: 'Woody',  angle: 334, color: '#78350f' },
  ],

  // Transitional subfamilies → [counter-clockwise neighbour, clockwise neighbour]
  // Used by generateFromBrief's family-match scoring and by the SVG renderer
  // to locate the correct gradient stops.
  transitional: {
    fruity:       ['citrus', 'floral'],
    floral_amber: ['floral', 'amber'],
    woody_amber:  ['amber',  'woods'],
  },

  // Every subfamily → its owning main family
  mainOf: {
    aromatic_fougere: 'fresh', citrus: 'fresh', water: 'fresh', green: 'fresh',
    fruity: 'fresh', // transitional — primary anchor is Fresh
    floral: 'floral', soft_floral: 'floral',
    floral_amber: 'floral',
    soft_amber: 'amber', amber: 'amber',
    woody_amber: 'amber',
    dry_woods: 'woody', mossy_woods: 'woody', woods: 'woody',
  },

  familyToSegment: {
    // Self-maps for every new subfamily id
    aromatic_fougere: 'aromatic_fougere',
    citrus: 'citrus',
    water:  'water',
    green:  'green',
    fruity: 'fruity',
    floral: 'floral',
    soft_floral: 'soft_floral',
    floral_amber: 'floral_amber',
    soft_amber: 'soft_amber',
    amber:  'amber',
    woody_amber: 'woody_amber',
    dry_woods: 'dry_woods',
    mossy_woods: 'mossy_woods',
    woods: 'woods',
    // ── Legacy aliases ────────────────────────────────────────────────
    // Fresh quadrant migrations
    fresh:        'citrus',
    aquatic:      'water',
    marine:       'water',
    ozonic:       'water',
    clean:        'water',
    aromatic:     'aromatic_fougere',
    herbal:       'aromatic_fougere',
    camphoraceous:'aromatic_fougere',
    lactonic:     'fruity',
    // Floral quadrant migrations
    rose:         'floral',
    jasmine:      'floral',
    aldehydic:    'soft_floral',
    powdery:      'soft_floral',
    muguet:       'soft_floral',
    floral_oriental: 'floral_amber',
    // Amber (was Oriental) quadrant migrations
    oriental:     'amber',
    balsamic:     'amber',
    resinous:     'amber',
    spicy:        'amber',
    gourmand:     'soft_amber',
    vanilla:      'soft_amber',
    sweet:        'soft_amber',
    musk:         'soft_amber',
    // Woody quadrant migrations
    woody:        'woods',
    mossy:        'mossy_woods',
    earthy:       'mossy_woods',
    animalic:     'woody_amber',
    leather:      'woody_amber',
    smoky:        'woody_amber',
    tobacco:      'woody_amber',
  },
};

// Approximate hobby/small-batch pricing in USD per gram.
// Sources: PerfumersWorld, Pell Wall, Creating Perfume, supplier catalogs.
// Tiers: solvent, commodity, standard, specialty, precious
// ─────────────────────────────────────────────────────────────
const MATERIAL_COSTS = {
  // Solvents & carriers
  "64-17-5":    { cost_g: 0.005, tier: "solvent" },      // Ethanol
  "57-55-6":    { cost_g: 0.008, tier: "solvent" },      // Propylene Glycol
  "25265-71-8": { cost_g: 0.010, tier: "solvent" },      // DPG
  "110-27-0":   { cost_g: 0.025, tier: "solvent" },      // IPM
  "84-66-2":    { cost_g: 0.012, tier: "solvent" },      // DEP
  "77-93-0":    { cost_g: 0.015, tier: "solvent" },      // Triethyl Citrate
  "102-76-1":   { cost_g: 0.010, tier: "solvent" },      // Triacetin
  "111-01-3":   { cost_g: 0.030, tier: "solvent" },      // Squalane
  // Commodity aroma chemicals
  "78-70-6":    { cost_g: 0.08, tier: "commodity" },     // Linalool
  "5989-27-5":  { cost_g: 0.05, tier: "commodity" },     // Limonene
  "106-22-9":   { cost_g: 0.10, tier: "commodity" },     // Citronellol
  "106-24-1":   { cost_g: 0.12, tier: "commodity" },     // Geraniol
  "97-53-0":    { cost_g: 0.08, tier: "commodity" },     // Eugenol
  "80-56-8":    { cost_g: 0.06, tier: "commodity" },     // Alpha Pinene
  "127-91-3":   { cost_g: 0.06, tier: "commodity" },     // Beta Pinene
  "470-82-6":   { cost_g: 0.07, tier: "commodity" },     // Eucalyptol
  "89-78-1":    { cost_g: 0.10, tier: "commodity" },     // Menthol
  "100-51-6":   { cost_g: 0.06, tier: "commodity" },     // Benzyl Alcohol
  "100-52-7":   { cost_g: 0.06, tier: "commodity" },     // Benzaldehyde
  "115-95-7":   { cost_g: 0.10, tier: "commodity" },     // Linalyl Acetate
  "140-11-4":   { cost_g: 0.08, tier: "commodity" },     // Benzyl Acetate
  "119-36-8":   { cost_g: 0.06, tier: "commodity" },     // Methyl Salicylate
  "123-35-3":   { cost_g: 0.05, tier: "commodity" },     // Myrcene
  "141-78-6":   { cost_g: 0.04, tier: "commodity" },     // Ethyl Acetate
  "79-92-5":    { cost_g: 0.06, tier: "commodity" },     // Camphene
  "76-22-2":    { cost_g: 0.06, tier: "commodity" },     // Camphor
  // Standard aroma chemicals
  "54464-57-2": { cost_g: 0.12, tier: "standard" },     // Iso E Super
  "24851-98-7": { cost_g: 0.15, tier: "standard" },     // Hedione
  "91-64-5":    { cost_g: 0.15, tier: "standard" },     // Coumarin
  "121-33-5":   { cost_g: 0.12, tier: "standard" },     // Vanillin
  "121-32-4":   { cost_g: 0.18, tier: "standard" },     // Ethyl Vanillin
  "18479-58-8": { cost_g: 0.10, tier: "standard" },     // Dihydromyrcenol
  "120-51-4":   { cost_g: 0.08, tier: "standard" },     // Benzyl Benzoate
  "118-58-1":   { cost_g: 0.12, tier: "standard" },     // Benzyl Salicylate
  "60-12-8":    { cost_g: 0.10, tier: "standard" },     // PEA
  "98-55-5":    { cost_g: 0.10, tier: "standard" },     // Alpha Terpineol
  "104-55-2":   { cost_g: 0.10, tier: "standard" },     // Cinnamaldehyde
  "107-75-5":   { cost_g: 0.15, tier: "standard" },     // Hydroxycitronellal
  "120-57-0":   { cost_g: 0.15, tier: "standard" },     // Heliotropin
  "104-54-1":   { cost_g: 0.12, tier: "standard" },     // Cinnamic Alcohol
  "105-87-3":   { cost_g: 0.12, tier: "standard" },     // Geranyl Acetate
  "103-45-7":   { cost_g: 0.12, tier: "standard" },     // Phenylethyl Acetate
  "106-23-0":   { cost_g: 0.10, tier: "standard" },     // Citronellal
  "106-25-2":   { cost_g: 0.15, tier: "standard" },     // Nerol
  "5392-40-5":  { cost_g: 0.12, tier: "standard" },     // Citral
  "150-84-5":   { cost_g: 0.12, tier: "standard" },     // Citronellyl Acetate
  "141-12-8":   { cost_g: 0.14, tier: "standard" },     // Neryl Acetate
  "142-92-7":   { cost_g: 0.08, tier: "standard" },     // Hexyl Acetate
  "628-63-7":   { cost_g: 0.08, tier: "standard" },     // Amyl Acetate
  "123-92-2":   { cost_g: 0.08, tier: "standard" },     // Isoamyl Acetate
  "89-83-8":    { cost_g: 0.10, tier: "standard" },     // Thymol
  "90-05-1":    { cost_g: 0.08, tier: "standard" },     // Guaiacol
  "93-58-3":    { cost_g: 0.08, tier: "standard" },     // Methyl Benzoate
  "104-46-1":   { cost_g: 0.10, tier: "standard" },     // Anethole
  "134-20-3":   { cost_g: 0.15, tier: "standard" },     // Methyl Anthranilate
  "103-82-2":   { cost_g: 0.10, tier: "standard" },     // Phenylacetic Acid
  "562-74-3":   { cost_g: 0.12, tier: "standard" },     // Terpinen-4-ol
  "99-49-0":    { cost_g: 0.10, tier: "standard" },     // Carvone
  "507-70-0":   { cost_g: 0.12, tier: "standard" },     // Borneol
  "76-49-3":    { cost_g: 0.10, tier: "standard" },     // Bornyl Acetate
  "89-80-5":    { cost_g: 0.10, tier: "standard" },     // Menthone
  "928-96-1":   { cost_g: 0.15, tier: "standard" },     // cis-3-Hexenol
  "118-71-8":   { cost_g: 0.20, tier: "standard" },     // Maltol
  "4940-11-8":  { cost_g: 0.25, tier: "standard" },     // Ethyl Maltol
  "103-26-4":   { cost_g: 0.12, tier: "standard" },     // Methyl Cinnamate
  "112-31-2":   { cost_g: 0.12, tier: "standard" },     // Decanal
  "112-44-7":   { cost_g: 0.15, tier: "standard" },     // Undecanal
  "112-54-9":   { cost_g: 0.15, tier: "standard" },     // Dodecanal
  "124-13-0":   { cost_g: 0.10, tier: "standard" },     // Octanal
  "124-19-6":   { cost_g: 0.10, tier: "standard" },     // Nonanal
  "122-78-1":   { cost_g: 0.12, tier: "standard" },     // Phenylacetaldehyde
  "122-40-7":   { cost_g: 0.15, tier: "standard" },     // Amyl Cinnamic Aldehyde
  "101-86-0":   { cost_g: 0.15, tier: "standard" },     // Hexyl Cinnamic Aldehyde
  "6259-76-3":  { cost_g: 0.15, tier: "standard" },     // Hexyl Salicylate
  "111-12-6":   { cost_g: 0.15, tier: "standard" },     // Methyl 2-Octynoate
  "123-11-5":   { cost_g: 0.10, tier: "standard" },     // Anisaldehyde
  "105-13-5":   { cost_g: 0.12, tier: "standard" },     // Anisyl Alcohol
  "140-67-0":   { cost_g: 0.10, tier: "standard" },     // Estragole
  "586-62-9":   { cost_g: 0.08, tier: "standard" },     // Terpinolene
  "106-44-5":   { cost_g: 0.10, tier: "standard" },     // Para-Cresol
  // Specialty aroma chemicals
  "1222-05-5":  { cost_g: 0.20, tier: "specialty" },    // Galaxolide
  "33704-61-9": { cost_g: 0.25, tier: "specialty" },    // Cashmeran
  "81-14-1":    { cost_g: 0.30, tier: "specialty" },    // Musk Ketone
  "16409-43-1": { cost_g: 0.25, tier: "specialty" },    // Rose Oxide
  "65113-99-7": { cost_g: 0.35, tier: "specialty" },    // Sandalore
  "127-41-3":   { cost_g: 0.30, tier: "specialty" },    // Alpha Ionone
  "14901-07-6": { cost_g: 0.25, tier: "specialty" },    // Beta Ionone
  "127-42-4":   { cost_g: 0.25, tier: "specialty" },    // Methyl Ionone Alpha
  "127-51-5":   { cost_g: 0.25, tier: "specialty" },    // Alpha Isomethyl Ionone
  "515-69-5":   { cost_g: 0.40, tier: "specialty" },    // Alpha Bisabolol
  "77-53-2":    { cost_g: 0.25, tier: "specialty" },    // Cedrol
  "77-54-3":    { cost_g: 0.20, tier: "specialty" },    // Cedryl Acetate
  "120-72-9":   { cost_g: 0.30, tier: "specialty" },    // Indole
  "83-34-1":    { cost_g: 0.35, tier: "specialty" },    // Skatole
  "103-95-7":   { cost_g: 0.20, tier: "specialty" },    // Cyclamal
  "18127-01-0": { cost_g: 0.25, tier: "specialty" },    // Bourgeonal
  "1205-17-0":  { cost_g: 0.30, tier: "specialty" },    // Helional
  "28940-11-6": { cost_g: 0.40, tier: "specialty" },    // Calone
  "21145-77-7": { cost_g: 0.25, tier: "specialty" },    // Tonalide
  "105-95-3":   { cost_g: 0.25, tier: "specialty" },    // Ethylene Brassylate
  "106-02-5":   { cost_g: 0.30, tier: "specialty" },    // Exaltolide
  "43052-87-5": { cost_g: 0.35, tier: "specialty" },    // Alpha Damascone
  "23726-91-2": { cost_g: 0.40, tier: "specialty" },    // Beta Damascone
  "23696-85-7": { cost_g: 0.50, tier: "specialty" },    // Damascenone
  "706-14-9":   { cost_g: 0.25, tier: "specialty" },    // Gamma Decalactone
  "104-67-6":   { cost_g: 0.25, tier: "specialty" },    // Gamma Undecalactone
  "705-86-2":   { cost_g: 0.30, tier: "specialty" },    // Delta Decalactone
  "104-61-0":   { cost_g: 0.25, tier: "specialty" },    // Gamma Nonalactone
  "116-26-7":   { cost_g: 0.45, tier: "specialty" },    // Safranal
  "4602-84-0":  { cost_g: 0.30, tier: "specialty" },    // Farnesol
  "7212-44-4":  { cost_g: 0.30, tier: "specialty" },    // Nerolidol
  "4674-50-4":  { cost_g: 0.50, tier: "specialty" },    // Nootkatone
  "97-54-1":    { cost_g: 0.15, tier: "specialty" },    // Isoeugenol
  // Precious / expensive
  "6790-58-5":  { cost_g: 0.80, tier: "precious" },     // Ambroxan
  "3738-00-9":  { cost_g: 0.70, tier: "precious" },     // Cetalox
  "541-91-3":   { cost_g: 3.00, tier: "precious" },     // Muscone
  "198404-98-7":{ cost_g: 0.90, tier: "precious" },     // Javanol
  "5986-55-0":  { cost_g: 0.50, tier: "precious" },     // Patchoulol
  "34902-57-3": { cost_g: 0.80, tier: "precious" },     // Habanolide
  // Essential oils & absolutes
  "8000-28-0":  { cost_g: 0.30, tier: "standard" },     // Lavender Oil
  "8007-01-0":  { cost_g: 8.50, tier: "precious" },     // Rose Oil
  "8014-09-3":  { cost_g: 0.60, tier: "specialty" },    // Patchouli Oil
  "8006-81-3":  { cost_g: 0.80, tier: "specialty" },    // Ylang Ylang Oil
  "8016-38-4":  { cost_g: 4.00, tier: "precious" },     // Neroli Oil
  "8016-96-4":  { cost_g: 0.70, tier: "specialty" },    // Vetiver Oil
  "8022-96-6":  { cost_g: 6.00, tier: "precious" },     // Jasmine Oil
  "8000-46-2":  { cost_g: 0.50, tier: "specialty" },    // Geranium Oil
  "8008-56-8":  { cost_g: 0.15, tier: "commodity" },    // Lemon Oil
  "8008-57-9":  { cost_g: 0.10, tier: "commodity" },    // Sweet Orange Oil
  "8016-20-4":  { cost_g: 0.20, tier: "standard" },     // Grapefruit Oil
  "8007-75-8":  { cost_g: 0.35, tier: "standard" },     // Bergamot Oil
  "8000-48-4":  { cost_g: 0.12, tier: "commodity" },    // Eucalyptus Oil
  "8000-25-7":  { cost_g: 0.15, tier: "commodity" },    // Rosemary Oil
  "8016-63-5":  { cost_g: 0.40, tier: "standard" },     // Clary Sage Oil
  "8000-34-8":  { cost_g: 0.20, tier: "standard" },     // Clove Oil
  "8015-91-6":  { cost_g: 0.25, tier: "standard" },     // Cinnamon Oil
  "8000-66-6":  { cost_g: 0.40, tier: "standard" },     // Cardamom Oil
  "8006-82-4":  { cost_g: 0.35, tier: "standard" },     // Black Pepper Oil
  "8007-02-1":  { cost_g: 0.12, tier: "commodity" },    // Lemongrass Oil
  "8014-19-5":  { cost_g: 0.15, tier: "commodity" },    // Palmarosa Oil
  "68647-73-4": { cost_g: 0.15, tier: "commodity" },    // Tea Tree Oil
  "8016-36-2":  { cost_g: 0.60, tier: "specialty" },    // Frankincense Oil
  "8016-37-3":  { cost_g: 0.80, tier: "specialty" },    // Myrrh Oil
  "8006-87-9":  { cost_g: 12.0, tier: "precious" },     // Sandalwood Oil
  "9000-50-4":  { cost_g: 3.00, tier: "precious" },     // Oakmoss Absolute
  "8024-55-3":  { cost_g: 8.00, tier: "precious" },     // Tuberose Absolute
  "8002-73-1":  { cost_g: 15.0, tier: "precious" },     // Orris Absolute
  "8046-22-8":  { cost_g: 2.50, tier: "precious" },     // Tonka Bean Absolute
  "93685-97-3": { cost_g: 4.00, tier: "precious" },     // Mimosa Absolute
  "8024-06-4":  { cost_g: 1.50, tier: "precious" },     // Vanilla CO2
  "8016-26-0":  { cost_g: 1.20, tier: "precious" },     // Labdanum
  "128-37-0":   { cost_g: 0.02, tier: "commodity" },    // BHT
};
