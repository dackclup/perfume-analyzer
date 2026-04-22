// Perfumery database — CLEARED for ground-up rebuild.
//
// The previous 490-material corpus is preserved in
// perfumery_data.backup.js. Materials will be re-added one facet
// group at a time using only Tier 0 free authoritative sources:
//   - PubChem (identifiers + structure + properties)
//   - IFRA 51st Amendment PDF (safety caps)
//   - CosIng (EU INCI)
//   - EUR-Lex (EU Cosmetic Regulation Annex II/III + 2023/1545)
//   - The Good Scents Company (odor descriptions + thresholds)
//   - Arctander 1969 (odor descriptions — public-domain references)
//   - Tisserand & Young 2014 (essential oil composition)
//   - ISO standards (when freely accessible)
//
// Target: EN canonical naming + Thai naturals (Thai essential oils
// sourced from Thai Herbal Pharmacopoeia + TISTR research reports).
//
// Structure (unchanged, three top-level keys consumed by index.html):
//   perfumery_db  : array of material entries
//   trade_names   : { "trade lowercase": "canonical lowercase", ... }
//   mixture_cas   : [ CAS strings of natural mixtures (EOs / absolutes) ]
const PERFUMERY_DATA = {
  "perfumery_db": [],
  "trade_names": {},
  "mixture_cas": []
};
