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
