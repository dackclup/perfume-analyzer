"""
scraper.py  v5.0
================
Extracts ALL available data from PubChem PUG View API + perfumery DB.
Walks the entire JSON tree and organizes by section heading.
"""

import re
import logging
from typing import Optional
from dataclasses import dataclass, field
from collections import OrderedDict

import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PUBCHEM_REST = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
PUBCHEM_VIEW = "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound"
TIMEOUT = 12


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Data container
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@dataclass
class MaterialData:
    name: str
    found: bool = False
    error: str = ""
    page_url: str = ""

    cas_number: str = ""
    fema_number: str = ""
    iupac_name: str = ""
    synonyms: list = field(default_factory=list)

    smiles: str = ""
    molecular_formula: str = ""
    molecular_weight: str = ""
    structure_image_url: str = ""
    inchi: str = ""

    odor_description: str = ""
    odor_type: str = ""
    odor_strength: str = ""
    note_classification: str = ""

    tenacity: str = ""
    tenacity_hours: str = ""

    appearance: str = ""
    boiling_point: str = ""
    flash_point: str = ""
    melting_point: str = ""
    vapor_pressure: str = ""
    solubility: str = ""
    density: str = ""
    refractive_index: str = ""
    logp: str = ""

    ifra_guidelines: str = ""
    usage_levels: str = ""
    blends_well_with: list = field(default_factory=list)

    perfumery_matched: bool = False
    match_info: str = ""

    # ALL PubChem sections — OrderedDict of heading → list of strings
    pubchem_sections: OrderedDict = field(default_factory=OrderedDict)
    pubchem_sid: str = ""  # Substance ID (for mixtures/trade names)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Perfumery DB (keyed by CAS)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PERFUMERY_DB = {
    "78-70-6": {
        "names": ["linalool", "linalol", "beta-linalool"],
        "odor_description": "Fresh, floral, woody with light citrus and lavender nuances",
        "odor_type": "Floral", "odor_strength": "Medium",
        "note_classification": "Top",
        "tenacity": "Low — volatile top note", "tenacity_hours": "~2 hours",
        "ifra_guidelines": "Restricted — concentration limits per IFRA 51st Amendment; oxidized linalool is a sensitizer",
        "usage_levels": "1–20 % in fragrance concentrate",
        "blends_well_with": ["Lavender", "Bergamot", "Rosewood", "Geraniol", "Citronellol",
                             "Coumarin", "Ylang Ylang", "Rose Oxide", "Hedione", "Linalyl Acetate"],
        "fema_number": "2635",
    },
    "54464-57-2": {
        "names": ["iso e super", "isocyclemone e", "patchouli ethanone", "orbitone"],
        "odor_description": "Smooth, dry, ambery-woody cedar with velvety ambergris and patchouli effects",
        "odor_type": "Woody / Amber", "odor_strength": "Low to Medium — diffusive but subtle",
        "note_classification": "Base",
        "tenacity": "Very high — long-lasting woody amber", "tenacity_hours": "~400 hours",
        "ifra_guidelines": "Regulated — safe use levels published; classified skin sensitizer (H317)",
        "usage_levels": "5–50 % in fragrance concentrate; commonly used in overdose",
        "blends_well_with": ["Ambroxan", "Vetiver", "Patchouli", "Cedarwood", "Hedione",
                             "Cashmeran", "Galaxolide", "Ebanol", "Javanol", "Benzyl Benzoate"],
        "fema_number": "",
    },
    "24851-98-7": {
        "names": ["hedione", "methyl dihydrojasmonate"],
        "odor_description": "Fresh, jasmine-like, transparent floral with green and citrus facets",
        "odor_type": "Floral / Jasmine", "odor_strength": "Low — very diffusive and radiant",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate — 24–48 hours on strip", "tenacity_hours": "~48 hours",
        "ifra_guidelines": "No restriction — safe for all categories",
        "usage_levels": "5–40 % in fragrance concentrate",
        "blends_well_with": ["Iso E Super", "Galaxolide", "Linalool", "Citral", "Rose Oxide",
                             "Ambroxan", "Benzyl Salicylate", "Coumarin", "Vanillin"],
        "fema_number": "",
    },
    "1222-05-5": {
        "names": ["galaxolide", "abbalide"],
        "odor_description": "Sweet, clean, powdery musk with woody and floral undertones",
        "odor_type": "Musk", "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "Very high — excellent fixative", "tenacity_hours": "~500 hours",
        "ifra_guidelines": "Restricted — limits depend on product category",
        "usage_levels": "5–15 % in fragrance concentrate",
        "blends_well_with": ["Iso E Super", "Hedione", "Ambroxan", "Cashmeran",
                             "Ethylene Brassylate", "Coumarin", "Vanillin", "Tonalide"],
        "fema_number": "",
    },
    "91-64-5": {
        "names": ["coumarin", "cumarin"],
        "odor_description": "Sweet, warm, hay-like with tonka bean and vanilla nuances",
        "odor_type": "Sweet / Balsamic", "odor_strength": "High",
        "note_classification": "Middle / Heart to Base",
        "tenacity": "High — 200+ hours on strip", "tenacity_hours": "~200 hours",
        "ifra_guidelines": "Restricted — maximum use levels per category",
        "usage_levels": "2–10 % in fragrance concentrate",
        "blends_well_with": ["Lavender", "Vanillin", "Tonalide", "Oakmoss", "Linalool",
                             "Bergamot", "Rose", "Cinnamic Alcohol"],
        "fema_number": "2381",
    },
    "121-33-5": {
        "names": ["vanillin", "4-hydroxy-3-methoxybenzaldehyde"],
        "odor_description": "Sweet, creamy, warm vanilla with balsamic and slightly powdery facets",
        "odor_type": "Sweet / Vanilla", "odor_strength": "High",
        "note_classification": "Base",
        "tenacity": "Very high — long-lasting sweetness", "tenacity_hours": "~400 hours",
        "ifra_guidelines": "No restriction for synthetic vanillin",
        "usage_levels": "1–10 % in fragrance concentrate",
        "blends_well_with": ["Coumarin", "Benzoin", "Ethyl Vanillin", "Musk", "Sandalwood",
                             "Patchouli", "Tonka Bean", "Labdanum"],
        "fema_number": "3107",
    },
    "6790-58-5": {
        "names": ["ambroxan", "ambrox", "ambrox dl", "cetalox"],
        "odor_description": "Warm, amber, woody with musky, mineral and skin-like nuances",
        "odor_type": "Amber / Woody", "odor_strength": "Medium to High — very diffusive",
        "note_classification": "Base",
        "tenacity": "Extremely high — lasts weeks on strip", "tenacity_hours": "~700 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "1–20 % in fragrance concentrate",
        "blends_well_with": ["Iso E Super", "Hedione", "Cetalox", "Cashmeran",
                             "Santal", "Vetiver", "Patchouli", "Galaxolide"],
        "fema_number": "",
    },
    "33704-61-9": {
        "names": ["cashmeran", "dp-45"],
        "odor_description": "Warm, musky, spicy-woody with fruity and velvet-like nuances",
        "odor_type": "Musky / Woody", "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "High — long-lasting warm character", "tenacity_hours": "~300 hours",
        "ifra_guidelines": "Restricted — limits apply",
        "usage_levels": "2–15 % in fragrance concentrate",
        "blends_well_with": ["Iso E Super", "Ambroxan", "Galaxolide", "Hedione",
                             "Patchouli", "Vetiver", "Cedarwood"],
        "fema_number": "",
    },
    "121-32-4": {
        "names": ["ethyl vanillin", "ethylvanillin"],
        "odor_description": "Intense, sweet, creamy vanilla — 3–4× stronger than vanillin",
        "odor_type": "Sweet / Vanilla", "odor_strength": "Very High",
        "note_classification": "Base",
        "tenacity": "Very high", "tenacity_hours": "~400 hours",
        "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 % in fragrance concentrate",
        "blends_well_with": ["Vanillin", "Coumarin", "Heliotropin", "Benzoin", "Musk", "Tonka Bean"],
        "fema_number": "2464",
    },
    "106-22-9": {
        "names": ["citronellol", "beta-citronellol"],
        "odor_description": "Fresh, sweet, rosy with green and citrus nuances",
        "odor_type": "Floral / Rose", "odor_strength": "Medium",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate", "tenacity_hours": "~24 hours",
        "ifra_guidelines": "Restricted — allergen; must be declared above threshold (EU)",
        "usage_levels": "1–15 % in fragrance concentrate",
        "blends_well_with": ["Geraniol", "Linalool", "Phenylethyl Alcohol", "Citral", "Rose Oxide", "Eugenol"],
        "fema_number": "2309",
    },
    "106-24-1": {
        "names": ["geraniol", "trans-geraniol"],
        "odor_description": "Sweet, floral, rose-like with fruity and citrus nuances",
        "odor_type": "Floral / Rose", "odor_strength": "Medium to High",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate — 24–48 hours", "tenacity_hours": "~30 hours",
        "ifra_guidelines": "Restricted — classified allergen; labeling required (EU)",
        "usage_levels": "1–10 % in fragrance concentrate",
        "blends_well_with": ["Citronellol", "Linalool", "Phenylethyl Alcohol", "Rose Oxide", "Eugenol", "Ylang Ylang"],
        "fema_number": "2507",
    },
    "97-53-0": {
        "names": ["eugenol"],
        "odor_description": "Warm, spicy, clove-like with slightly sweet and woody undertones",
        "odor_type": "Spicy", "odor_strength": "High",
        "note_classification": "Middle / Heart to Base",
        "tenacity": "Moderate to High", "tenacity_hours": "~48 hours",
        "ifra_guidelines": "Restricted — known allergen; labeling required above threshold",
        "usage_levels": "0.5–5 % in fragrance concentrate",
        "blends_well_with": ["Cinnamic Aldehyde", "Vanillin", "Coumarin", "Rose", "Ylang Ylang", "Patchouli"],
        "fema_number": "2467",
    },
    "5989-27-5": {
        "names": ["limonene", "d-limonene", "(r)-limonene"],
        "odor_description": "Fresh, bright, sweet citrus-orange peel with light green nuance",
        "odor_type": "Citrus", "odor_strength": "Medium to High",
        "note_classification": "Top",
        "tenacity": "Low — very volatile", "tenacity_hours": "~1 hour",
        "ifra_guidelines": "Restricted — oxidized limonene is a sensitizer; must be declared (EU)",
        "usage_levels": "1–15 % in fragrance concentrate",
        "blends_well_with": ["Linalool", "Bergamot", "Citral", "Orange Oil", "Lemon Oil", "Neroli"],
        "fema_number": "2633",
    },
    "18479-58-8": {
        "names": ["dihydromyrcenol"],
        "odor_description": "Fresh, clean, citrus-metallic, ozonic with green lime facets",
        "odor_type": "Citrus / Fresh", "odor_strength": "High",
        "note_classification": "Top",
        "tenacity": "Low to Moderate", "tenacity_hours": "~8 hours",
        "ifra_guidelines": "No restriction", "usage_levels": "5–30 % in fragrance concentrate",
        "blends_well_with": ["Hedione", "Linalool", "Iso E Super", "Ambroxan", "Galaxolide", "Citral"],
        "fema_number": "",
    },
    "28940-11-6": {
        "names": ["calone", "watermelon ketone"],
        "odor_description": "Fresh, ozonic, marine, watermelon-like with green and metallic nuances",
        "odor_type": "Marine / Ozonic", "odor_strength": "Very High — use in trace amounts",
        "note_classification": "Top to Middle / Heart",
        "tenacity": "Moderate", "tenacity_hours": "~48 hours",
        "ifra_guidelines": "No restriction — but extremely potent",
        "usage_levels": "0.01–0.5 % in fragrance concentrate",
        "blends_well_with": ["Hedione", "Dihydromyrcenol", "Linalool", "Violet Leaf", "Cyclamen Aldehyde"],
        "fema_number": "",
    },
    "105-95-3": {
        "names": ["ethylene brassylate", "musk t"],
        "odor_description": "Sweet, powdery, clean musk with slightly metallic and floral facets",
        "odor_type": "Musk", "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "Very high — excellent fixative musk", "tenacity_hours": "~500 hours",
        "ifra_guidelines": "No restriction", "usage_levels": "3–20 % in fragrance concentrate",
        "blends_well_with": ["Galaxolide", "Ambroxan", "Hedione", "Iso E Super", "Cashmeran", "Coumarin"],
        "fema_number": "",
    },
    "120-51-4": {
        "names": ["benzyl benzoate"],
        "odor_description": "Very faint, slightly sweet, balsamic — mainly fixative/solvent",
        "odor_type": "Balsamic", "odor_strength": "Very Low",
        "note_classification": "Base",
        "tenacity": "Fixative", "tenacity_hours": "N/A (fixative)",
        "ifra_guidelines": "Restricted — allergen per EU regulation",
        "usage_levels": "5–30 % as solvent/fixative",
        "blends_well_with": ["All — universal fixative/solvent"],
        "fema_number": "2138",
    },
    "118-58-1": {
        "names": ["benzyl salicylate"],
        "odor_description": "Very faint, sweet, balsamic-floral — fixative",
        "odor_type": "Balsamic / Floral", "odor_strength": "Very Low",
        "note_classification": "Base",
        "tenacity": "Fixative", "tenacity_hours": "N/A (fixative)",
        "ifra_guidelines": "Restricted — classified allergen; labeling required (EU)",
        "usage_levels": "5–20 % as fixative",
        "blends_well_with": ["Hedione", "Galaxolide", "Rose", "Jasmine", "Ylang Ylang", "Linalool"],
        "fema_number": "",
    },
    "541-91-3": {
        "names": ["muscone"],
        "odor_description": "Rich, warm, animalic musk with powdery and skin-like facets",
        "odor_type": "Musk / Animalic", "odor_strength": "High",
        "note_classification": "Base",
        "tenacity": "Extremely high", "tenacity_hours": "~600 hours",
        "ifra_guidelines": "No restriction for synthetic muscone",
        "usage_levels": "0.1–2 % (very potent)",
        "blends_well_with": ["Civetone", "Ambroxan", "Galaxolide", "Sandalwood", "Vanillin", "Rose Absolute"],
        "fema_number": "",
    },
    "81-14-1": {
        "names": ["musk ketone"],
        "odor_description": "Sweet, powdery, clean musk with slight fruity and floral nuances",
        "odor_type": "Musk", "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "Very high", "tenacity_hours": "~500 hours",
        "ifra_guidelines": "Restricted — nitro musks have usage limits",
        "usage_levels": "1–5 % in fragrance concentrate",
        "blends_well_with": ["Galaxolide", "Ambroxan", "Hedione", "Coumarin", "Vanillin", "Rose"],
        "fema_number": "",
    },
    # ═══════ Additional Common Perfumery Materials ═══════
    "16409-43-1": {
        "names": ["rose oxide", "rosenoxide"],
        "odor_description": "Fresh, green-floral rose with metallic, geranium and lychee facets",
        "odor_type": "Floral / Green", "odor_strength": "High — very potent",
        "note_classification": "Top / Middle",
        "tenacity": "Moderate — 12–24 hours", "tenacity_hours": "~18 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "0.1–2 % (very potent)",
        "blends_well_with": ["Geraniol", "Citronellol", "Linalool", "Damascone", "Hedione", "Phenylethyl Alcohol"],
        "fema_number": "3236",
    },
    "104-55-2": {
        "names": ["cinnamaldehyde", "cinnamic aldehyde", "cinnamal"],
        "odor_description": "Warm, sweet, spicy cinnamon with balsamic and slightly pungent character",
        "odor_type": "Spicy / Sweet", "odor_strength": "High",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate", "tenacity_hours": "~24 hours",
        "ifra_guidelines": "Restricted — strong sensitizer; low use levels",
        "usage_levels": "0.1–1 % in fragrance concentrate",
        "blends_well_with": ["Clove", "Vanilla", "Benzoin", "Orange", "Frankincense"],
        "fema_number": "2286",
    },
    "80-56-8": {
        "names": ["alpha pinene", "pinene"],
        "odor_description": "Fresh, pine-needle, resinous with turpentine and slightly camphoraceous facets",
        "odor_type": "Woody / Fresh", "odor_strength": "Medium",
        "note_classification": "Top",
        "tenacity": "Low — volatile terpene", "tenacity_hours": "~2 hours",
        "ifra_guidelines": "Restricted — oxidized pinene is a sensitizer",
        "usage_levels": "1–10 % in fragrance concentrate",
        "blends_well_with": ["Cedarwood", "Eucalyptol", "Linalool", "Juniper", "Rosemary"],
        "fema_number": "2902",
    },
    "470-82-6": {
        "names": ["eucalyptol", "1,8-cineole", "cineole"],
        "odor_description": "Fresh, camphoraceous, cooling with minty-medicinal and slightly sweet facets",
        "odor_type": "Fresh / Camphoraceous", "odor_strength": "High",
        "note_classification": "Top",
        "tenacity": "Low to moderate", "tenacity_hours": "~4 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "1–10 % in fragrance concentrate",
        "blends_well_with": ["Lavender", "Rosemary", "Pine", "Peppermint", "Lemon", "Thyme"],
        "fema_number": "2465",
    },
    "120-72-9": {
        "names": ["indole"],
        "odor_description": "Intense floral-animalic with jasmine, mothball and fecal facets at high concentration",
        "odor_type": "Floral / Animalic", "odor_strength": "Very High",
        "note_classification": "Middle / Heart",
        "tenacity": "High", "tenacity_hours": "~48 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "0.01–0.5 % (extremely potent)",
        "blends_well_with": ["Jasmine", "Orange Blossom", "Tuberose", "Hedione", "Ylang Ylang"],
        "fema_number": "2593",
    },
    "89-78-1": {
        "names": ["menthol", "dl-menthol"],
        "odor_description": "Intensely cool, minty, fresh with clean and slightly sweet character",
        "odor_type": "Fresh / Mint", "odor_strength": "Very High",
        "note_classification": "Top",
        "tenacity": "Low — volatile", "tenacity_hours": "~2 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "0.5–5 % in fragrance concentrate",
        "blends_well_with": ["Eucalyptol", "Camphor", "Peppermint", "Lavender", "Citrus Oils"],
        "fema_number": "2665",
    },
    "98-55-5": {
        "names": ["alpha terpineol", "terpineol"],
        "odor_description": "Fresh, floral, lilac-like with sweet, pine and slightly anisic notes",
        "odor_type": "Floral / Fresh", "odor_strength": "Medium",
        "note_classification": "Top / Middle",
        "tenacity": "Moderate", "tenacity_hours": "~12 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "2–15 % in fragrance concentrate",
        "blends_well_with": ["Geraniol", "Linalool", "Lavender", "Pine", "Eucalyptol"],
        "fema_number": "3045",
    },
    "107-75-5": {
        "names": ["hydroxycitronellal", "muguet"],
        "odor_description": "Sweet, fresh, lily-of-the-valley floral with watery green and melon facets",
        "odor_type": "Floral / Muguet", "odor_strength": "Medium",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate", "tenacity_hours": "~24 hours",
        "ifra_guidelines": "Restricted — skin sensitizer; limited use levels",
        "usage_levels": "1–10 % in fragrance concentrate",
        "blends_well_with": ["Lilial", "Linalool", "Rose", "Cyclamen Aldehyde", "Hedione"],
        "fema_number": "2583",
    },
    "60-12-8": {
        "names": ["phenylethyl alcohol", "phenethyl alcohol", "pea", "2-phenylethanol"],
        "odor_description": "Sweet, floral, rose-like with honey and slightly green nuances",
        "odor_type": "Floral / Rose", "odor_strength": "Medium",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate", "tenacity_hours": "~24 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "5–30 % in fragrance concentrate",
        "blends_well_with": ["Rose Oxide", "Geraniol", "Citronellol", "Linalool", "Hedione"],
        "fema_number": "2858",
    },
    "120-57-0": {
        "names": ["heliotropin", "piperonal"],
        "odor_description": "Sweet, powdery, floral with cherry-almond and vanilla-like character",
        "odor_type": "Sweet / Powdery", "odor_strength": "Medium",
        "note_classification": "Middle / Base",
        "tenacity": "Moderate to high", "tenacity_hours": "~48 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "2–10 % in fragrance concentrate",
        "blends_well_with": ["Vanillin", "Coumarin", "Ionone", "Rose", "Ylang Ylang"],
        "fema_number": "2911",
    },
    "127-41-3": {
        "names": ["alpha ionone", "ionone alpha"],
        "odor_description": "Warm, floral, woody-violet with powdery and slightly fruity orris character",
        "odor_type": "Floral / Violet", "odor_strength": "Medium",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate", "tenacity_hours": "~24 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "1–10 % in fragrance concentrate",
        "blends_well_with": ["Beta Ionone", "Orris", "Rose", "Violet Leaf", "Sandalwood", "Cedarwood"],
        "fema_number": "2594",
    },
    "14901-07-6": {
        "names": ["beta ionone", "ionone beta"],
        "odor_description": "Warm, woody, violet with dry, cedarwood and seaweed-like facets",
        "odor_type": "Woody / Violet", "odor_strength": "Medium to High",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate to high", "tenacity_hours": "~36 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "1–8 % in fragrance concentrate",
        "blends_well_with": ["Alpha Ionone", "Cedarwood", "Vetiver", "Rose", "Orris"],
        "fema_number": "2595",
    },
    "65113-99-7": {
        "names": ["sandalore", "sandalwood"],
        "odor_description": "Powerful, creamy, sweet sandalwood with milky and slightly tropical facets",
        "odor_type": "Woody / Sandalwood", "odor_strength": "High",
        "note_classification": "Base",
        "tenacity": "Very high", "tenacity_hours": "~200 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "5–25 % in fragrance concentrate",
        "blends_well_with": ["Javanol", "Polysantol", "Bacdanol", "Ambroxan", "Iso E Super", "Rose"],
        "fema_number": "",
    },
    "116-26-7": {
        "names": ["safranal", "saffron"],
        "odor_description": "Warm, spicy, saffron-like with hay, tobacco and leathery nuances",
        "odor_type": "Spicy / Warm", "odor_strength": "High",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate to high", "tenacity_hours": "~36 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "0.1–2 % in fragrance concentrate",
        "blends_well_with": ["Rose", "Oud", "Sandalwood", "Amber", "Leather", "Incense"],
        "fema_number": "3389",
    },
    "515-69-5": {
        "names": ["alpha bisabolol", "bisabolol"],
        "odor_description": "Mild, sweet, floral with chamomile-like and slightly peppery facets",
        "odor_type": "Floral / Herbal", "odor_strength": "Low to Medium",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate", "tenacity_hours": "~24 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "1–10 % in fragrance concentrate",
        "blends_well_with": ["Chamomile", "Lavender", "Bergamot", "Rose", "Linalool"],
        "fema_number": "",
    },
    "77-53-2": {
        "names": ["cedrol", "cedryl alcohol"],
        "odor_description": "Soft, warm, woody-cedar with smooth, balsamic and slightly smoky character",
        "odor_type": "Woody / Cedar", "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "Very high", "tenacity_hours": "~200 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "5–20 % in fragrance concentrate",
        "blends_well_with": ["Cedarwood Oil", "Vetiver", "Sandalwood", "Patchouli", "Iso E Super"],
        "fema_number": "",
    },
    "83-34-1": {
        "names": ["skatole", "3-methylindole"],
        "odor_description": "Intense fecal-animalic at high conc; floral-jasmine at extreme dilution",
        "odor_type": "Animalic / Floral", "odor_strength": "Extremely High",
        "note_classification": "Base",
        "tenacity": "Very high", "tenacity_hours": "~200 hours",
        "ifra_guidelines": "Restricted — limited use levels",
        "usage_levels": "0.001–0.01 % (trace amounts only)",
        "blends_well_with": ["Indole", "Civet", "Jasmine", "Orange Blossom", "Tuberose"],
        "fema_number": "",
    },
    "5986-55-0": {
        "names": ["patchoulol", "patchouli alcohol", "patchouli"],
        "odor_description": "Rich, dark, earthy-woody with sweet, spicy and slightly camphoraceous facets",
        "odor_type": "Woody / Earthy", "odor_strength": "High",
        "note_classification": "Base",
        "tenacity": "Extremely high", "tenacity_hours": "~500 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "5–30 % in fragrance concentrate",
        "blends_well_with": ["Vetiver", "Sandalwood", "Coumarin", "Vanilla", "Labdanum", "Iso E Super"],
        "fema_number": "",
    },
    "31807-55-3": {
        "names": ["isododecane"],
        "odor_description": "Virtually odorless — used as solvent/carrier",
        "odor_type": "Solvent / Carrier", "odor_strength": "None",
        "note_classification": "N/A — carrier solvent",
        "tenacity": "N/A", "tenacity_hours": "N/A",
        "ifra_guidelines": "No restriction — cosmetic solvent",
        "usage_levels": "Used as solvent, not as fragrance ingredient",
        "blends_well_with": [],
        "fema_number": "",
    },
    # ═══════ Aldehydes ═══════
    "112-31-2": {"names": ["decanal", "aldehyde c-10"], "odor_description": "Waxy, orange peel, floral-aldehydic with soapy facets", "odor_type": "Aldehydic / Citrus", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low to moderate", "tenacity_hours": "~6 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Rose", "Ylang Ylang", "Jasmine", "Aldehydes C-11/C-12"], "fema_number": "2362"},
    "112-44-7": {"names": ["undecanal", "aldehyde c-11"], "odor_description": "Fresh, clean, waxy-aldehydic with soapy and floral character", "odor_type": "Aldehydic / Waxy", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low to moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Rose", "Aldehydes C-10/C-12", "Musk"], "fema_number": "3092"},
    "112-54-9": {"names": ["dodecanal", "aldehyde c-12", "lauric aldehyde"], "odor_description": "Waxy, soapy, clean with slight violet and metallic facets", "odor_type": "Aldehydic / Waxy", "odor_strength": "High", "note_classification": "Top", "tenacity": "Moderate", "tenacity_hours": "~12 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–3 %", "blends_well_with": ["Rose", "Aldehydes C-10/C-11", "Violet"], "fema_number": "2615"},
    "124-13-0": {"names": ["octanal", "aldehyde c-8"], "odor_description": "Fresh, citrus-orange peel with green, fatty-waxy facets", "odor_type": "Aldehydic / Citrus", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~3 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Citrus oils", "Neroli", "Petitgrain"], "fema_number": "2797"},
    "124-19-6": {"names": ["nonanal", "aldehyde c-9"], "odor_description": "Fresh, green-citrus, rose-like with waxy and slightly fatty character", "odor_type": "Aldehydic / Floral", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~4 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Rose", "Citrus", "Green notes"], "fema_number": "2782"},
    "122-78-1": {"names": ["phenylacetaldehyde", "hyacinth"], "odor_description": "Green, sweet, hyacinth-like with honey and chocolate facets", "odor_type": "Floral / Green", "odor_strength": "Very High", "note_classification": "Top / Middle", "tenacity": "Low to moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "Restricted — strong allergen", "usage_levels": "0.1–1 %", "blends_well_with": ["Hyacinth", "Narcissus", "Rose", "Lilac"], "fema_number": "2874"},
    "122-40-7": {"names": ["amyl cinnamic aldehyde", "aca"], "odor_description": "Warm, powdery, jasmine-like with fatty, floral-balsamic character", "odor_type": "Floral / Powdery", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "High", "tenacity_hours": "~100 hours", "ifra_guidelines": "Restricted — allergen", "usage_levels": "5–20 %", "blends_well_with": ["Jasmine", "Galaxolide", "Hedione"], "fema_number": "2061"},
    "101-86-0": {"names": ["hexyl cinnamic aldehyde", "hca"], "odor_description": "Soft, warm, jasmine-like with fatty and slightly spicy facets", "odor_type": "Floral / Fatty", "odor_strength": "Low to Medium", "note_classification": "Base", "tenacity": "Very high — excellent fixative", "tenacity_hours": "~200 hours", "ifra_guidelines": "Restricted — allergen", "usage_levels": "5–20 %", "blends_well_with": ["Jasmine", "Rose", "Galaxolide", "Ambroxan"], "fema_number": "2569"},
    "103-95-7": {"names": ["cyclamal", "cyclamen aldehyde"], "odor_description": "Fresh, green-floral with cyclamen, cucumber and powdery facets", "odor_type": "Floral / Green", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "Restricted — allergen", "usage_levels": "2–10 %", "blends_well_with": ["Lily", "Muguet", "Rose", "Hedione"], "fema_number": "2743"},
    "18127-01-0": {"names": ["bourgeonal"], "odor_description": "Fresh, watery, lily-of-the-valley with metallic aquatic facets", "odor_type": "Floral / Aquatic", "odor_strength": "High", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Hydroxycitronellal", "Lilial", "Hedione", "Calone"], "fema_number": ""},
    "1205-17-0": {"names": ["helional"], "odor_description": "Fresh, green, aquatic-floral with hay and new-mown grass facets", "odor_type": "Green / Fresh", "odor_strength": "Medium to High", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "Restricted", "usage_levels": "1–8 %", "blends_well_with": ["Calone", "Marine notes", "Green notes", "Hedione"], "fema_number": ""},
    "67634-15-5": {"names": ["floralozone", "ozone"], "odor_description": "Fresh, ozonic, marine with green-floral and melon-like character", "odor_type": "Fresh / Ozonic", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low to moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Calone", "Helional", "Hedione", "Marine accords"], "fema_number": ""},
    "68039-49-6": {"names": ["triplal"], "odor_description": "Fresh, green, powerful with watery, slightly floral character", "odor_type": "Green / Fresh", "odor_strength": "Very High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~4 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Green notes", "Citrus", "Calone"], "fema_number": ""},
    # ═══════ Musks ═══════
    "21145-77-7": {"names": ["tonalide", "ahtn", "fixolide"], "odor_description": "Sweet, clean, powdery musk with ambery and slightly woody character", "odor_type": "Musk", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~400 hours", "ifra_guidelines": "Restricted — polycyclic musk", "usage_levels": "5–15 %", "blends_well_with": ["Galaxolide", "Cashmeran", "Ambroxan"], "fema_number": ""},
    "34902-57-3": {"names": ["habanolide", "globalide"], "odor_description": "Clean, elegant, metallic musk with powdery, slightly fruity facets", "odor_type": "Musk", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Extremely high", "tenacity_hours": "~600 hours", "ifra_guidelines": "No restriction", "usage_levels": "3–15 %", "blends_well_with": ["Galaxolide", "Ambroxan", "Iso E Super"], "fema_number": ""},
    "106-02-5": {"names": ["exaltolide", "thibetolide"], "odor_description": "Sweet, warm, musky with powdery, lactonic and slightly animalic facets", "odor_type": "Musk / Lactonic", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Extremely high", "tenacity_hours": "~700 hours", "ifra_guidelines": "No restriction", "usage_levels": "3–15 %", "blends_well_with": ["Muscone", "Galaxolide", "Ambroxan"], "fema_number": ""},
    "141773-73-1": {"names": ["helvetolide"], "odor_description": "Clean, fruity, musky with pear and floral facets — radiant transparency", "odor_type": "Musk / Fruity", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~300 hours", "ifra_guidelines": "No restriction", "usage_levels": "3–15 %", "blends_well_with": ["Galaxolide", "Hedione", "Pear notes"], "fema_number": ""},
    "63314-79-4": {"names": ["muscenone"], "odor_description": "Clean, elegant, powdery musk with slight animalic warmth", "odor_type": "Musk", "odor_strength": "Medium to High", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~400 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Muscone", "Galaxolide", "Ambroxan", "Habanolide"], "fema_number": ""},
    # ═══════ Woody / Sandalwood ═══════
    "198404-98-7": {"names": ["javanol"], "odor_description": "Powerful, creamy sandalwood — closest synthetic to natural sandalwood oil", "odor_type": "Woody / Sandalwood", "odor_strength": "Very High", "note_classification": "Base", "tenacity": "Extremely high", "tenacity_hours": "~500 hours", "ifra_guidelines": "No restriction", "usage_levels": "3–15 %", "blends_well_with": ["Sandalore", "Polysantol", "Ambroxan", "Rose"], "fema_number": ""},
    "107898-54-4": {"names": ["polysantol"], "odor_description": "Soft, creamy, sweet sandalwood with milky and slightly aromatic character", "odor_type": "Woody / Sandalwood", "odor_strength": "High", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~300 hours", "ifra_guidelines": "Restricted — allergen", "usage_levels": "3–15 %", "blends_well_with": ["Javanol", "Sandalore", "Firsantol", "Ambroxan"], "fema_number": ""},
    "28219-61-6": {"names": ["bacdanol"], "odor_description": "Soft, creamy, mild sandalwood — excellent blender and extender", "odor_type": "Woody / Sandalwood", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "High", "tenacity_hours": "~150 hours", "ifra_guidelines": "No restriction", "usage_levels": "5–20 %", "blends_well_with": ["Javanol", "Polysantol", "Sandalore", "Ebanol"], "fema_number": ""},
    "104864-90-6": {"names": ["firsantol"], "odor_description": "Very powerful, natural sandalwood with exceptional radiance and diffusion", "odor_type": "Woody / Sandalwood", "odor_strength": "Very High", "note_classification": "Base", "tenacity": "Very high — exceptional radiance", "tenacity_hours": "~280 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Polysantol", "Javanol", "Bacdanol", "Ebanol"], "fema_number": ""},
    "67801-20-1": {"names": ["ebanol"], "odor_description": "Rich, powerful, musky sandalwood with tropical and slightly anisic character", "odor_type": "Woody / Sandalwood", "odor_strength": "High", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~250 hours", "ifra_guidelines": "Restricted — allergen", "usage_levels": "2–10 %", "blends_well_with": ["Bacdanol", "Javanol", "Polysantol"], "fema_number": ""},
    "155517-73-0": {"names": ["georgywood"], "odor_description": "Woody, ambery with vetiver and slight citrus facets", "odor_type": "Woody / Amber", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "High", "tenacity_hours": "~150 hours", "ifra_guidelines": "No restriction", "usage_levels": "5–20 %", "blends_well_with": ["Iso E Super", "Vetiver", "Patchouli", "Cedarwood"], "fema_number": ""},
    "32388-55-9": {"names": ["vertofix", "vertofix coeur"], "odor_description": "Powerful, dry, woody-amber with vetiver-like and slightly smoky facets", "odor_type": "Woody / Amber", "odor_strength": "High", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~400 hours", "ifra_guidelines": "No restriction", "usage_levels": "5–25 %", "blends_well_with": ["Cedarwood", "Vetiver", "Iso E Super", "Patchouli"], "fema_number": ""},
    "70788-30-6": {"names": ["norlimbanol", "timberol"], "odor_description": "Powerful, dry, woody-cedar with smoky and slightly camphoraceous facets", "odor_type": "Woody / Cedar", "odor_strength": "Very High", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~300 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Cedarwood", "Vetiver", "Iso E Super", "Patchouli"], "fema_number": ""},
    "28631-86-9": {"names": ["clearwood"], "odor_description": "Clean, modern patchouli — woody, earthy with reduced camphor facets", "odor_type": "Woody / Earthy", "odor_strength": "High", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~300 hours", "ifra_guidelines": "No restriction", "usage_levels": "5–25 %", "blends_well_with": ["Patchouli", "Vetiver", "Iso E Super", "Ambroxan"], "fema_number": ""},
    # ═══════ Amber / Ambergris ═══════
    "3738-00-9": {"names": ["cetalox", "cetalox laevo"], "odor_description": "Warm, dry, ambery-woody with ambergris-like musky drydown", "odor_type": "Amber / Ambergris", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Extremely high", "tenacity_hours": "~600 hours", "ifra_guidelines": "No restriction", "usage_levels": "3–15 %", "blends_well_with": ["Ambroxan", "Iso E Super", "Labdanum", "Sandalwood"], "fema_number": ""},
    "103694-68-4": {"names": ["karanal", "amber xtreme", "amber ketal"], "odor_description": "Powerful, clean, amber with dry, mineral and woody character", "odor_type": "Amber / Mineral", "odor_strength": "Very High", "note_classification": "Base", "tenacity": "Extremely high", "tenacity_hours": "~700 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Ambroxan", "Cetalox", "Iso E Super", "Sandalwood"], "fema_number": ""},
    # ═══════ Damascones / Ionones ═══════
    "43052-87-5": {"names": ["alpha damascone", "damascone alpha"], "odor_description": "Rich, fruity, rose with plum and slight woody character", "odor_type": "Floral / Fruity", "odor_strength": "Very High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "Restricted — allergen", "usage_levels": "0.1–2 %", "blends_well_with": ["Rose", "Geraniol", "Hedione", "Linalool"], "fema_number": ""},
    "23726-91-2": {"names": ["beta damascone", "damascone beta"], "odor_description": "Intense, fruity, rosy with plum, apple and rose-wine character", "odor_type": "Fruity / Floral", "odor_strength": "Extremely High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "Restricted — extremely potent", "usage_levels": "0.01–0.5 %", "blends_well_with": ["Rose", "Apple", "Plum", "Peach"], "fema_number": ""},
    "23696-85-7": {"names": ["damascenone", "beta damascenone"], "odor_description": "Extremely powerful, fruity, rosy-plum with applesauce and honey-like facets", "odor_type": "Fruity / Floral", "odor_strength": "Extremely High", "note_classification": "Top / Middle", "tenacity": "Moderate to high", "tenacity_hours": "~30 hours", "ifra_guidelines": "Restricted", "usage_levels": "0.001–0.1 %", "blends_well_with": ["Rose", "Fruit notes", "Apple", "Wine accords"], "fema_number": ""},
    # ═══════ Lactones ═══════
    "706-14-9": {"names": ["gamma decalactone"], "odor_description": "Creamy, peach with oily, apricot and coconut facets", "odor_type": "Fruity / Creamy", "odor_strength": "Medium to High", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Peach", "Coconut", "Vanilla", "Jasmine"], "fema_number": "2361"},
    "104-67-6": {"names": ["gamma undecalactone"], "odor_description": "Sweet, creamy, peach-skin with coconut and milky facets", "odor_type": "Fruity / Coconut", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Coconut", "Peach", "Vanilla", "Tonka"], "fema_number": "3091"},
    "705-86-2": {"names": ["delta decalactone"], "odor_description": "Rich, creamy, milky-buttery with coconut and slightly fruity character", "odor_type": "Creamy / Milky", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Coconut", "Vanilla", "Sandalwood"], "fema_number": "2361"},
    "104-61-0": {"names": ["gamma nonalactone"], "odor_description": "Sweet, coconut-like with creamy and slightly waxy character", "odor_type": "Coconut / Creamy", "odor_strength": "Medium to High", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Coconut", "Vanilla", "Tonka", "Sandalwood"], "fema_number": "2781"},
    # ═══════ Spicy / Herbal ═══════
    "97-54-1": {"names": ["isoeugenol"], "odor_description": "Warm, sweet, spicy-clove with mild, carnation-like floral character", "odor_type": "Spicy / Floral", "odor_strength": "Medium to High", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "Restricted — strong sensitizer", "usage_levels": "0.1–2 %", "blends_well_with": ["Eugenol", "Clove", "Rose", "Carnation", "Ylang Ylang"], "fema_number": "2468"},
    "104-46-1": {"names": ["anethole", "trans anethole"], "odor_description": "Sweet, warm, anise-like with herbal, slightly minty character", "odor_type": "Herbal / Anise", "odor_strength": "High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~12 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Fennel", "Lavender", "Star Anise", "Basil"], "fema_number": "2086"},
    "89-83-8": {"names": ["thymol"], "odor_description": "Sharp, herbaceous, medicinal with thyme-like and phenolic character", "odor_type": "Herbal / Medicinal", "odor_strength": "High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~12 hours", "ifra_guidelines": "Restricted", "usage_levels": "0.5–3 %", "blends_well_with": ["Thyme", "Oregano", "Lavender", "Eucalyptol"], "fema_number": "3066"},
    "499-75-2": {"names": ["carvacrol"], "odor_description": "Warm, herbal, oregano-like with phenolic, thyme-spicy character", "odor_type": "Herbal / Spicy", "odor_strength": "High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~12 hours", "ifra_guidelines": "Restricted", "usage_levels": "0.5–3 %", "blends_well_with": ["Thymol", "Oregano", "Lavender"], "fema_number": "2245"},
    "99-49-0": {"names": ["carvone"], "odor_description": "Sweet, minty, herbal with caraway/dill (l-form) or spearmint (d-form) character", "odor_type": "Herbal / Mint", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low to moderate", "tenacity_hours": "~6 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Mint", "Caraway", "Dill", "Lavender"], "fema_number": "2249"},
    "76-22-2": {"names": ["camphor"], "odor_description": "Fresh, penetrating, camphoraceous with medicinal and slightly woody facets", "odor_type": "Fresh / Camphoraceous", "odor_strength": "Very High", "note_classification": "Top", "tenacity": "Low to moderate", "tenacity_hours": "~6 hours", "ifra_guidelines": "Restricted in some categories", "usage_levels": "0.5–5 %", "blends_well_with": ["Eucalyptol", "Lavender", "Rosemary", "Pine"], "fema_number": "2230"},
    "507-70-0": {"names": ["borneol"], "odor_description": "Camphoraceous, woody-pine with earthy, slightly peppery character", "odor_type": "Woody / Camphoraceous", "odor_strength": "Medium to High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~12 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Camphor", "Pine", "Cedarwood", "Lavender"], "fema_number": "2157"},
    # ═══════ Citrus / Esters / Acetates ═══════
    "106-23-0": {"names": ["citronellal"], "odor_description": "Fresh, citrusy, rosy with green, slightly fruity character", "odor_type": "Citrus / Fresh", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~4 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–15 %", "blends_well_with": ["Citronellol", "Geraniol", "Rose", "Lemongrass"], "fema_number": "2307"},
    "106-25-2": {"names": ["nerol"], "odor_description": "Sweet, fresh, rose-like with wet, green and slightly citrus character", "odor_type": "Floral / Rose", "odor_strength": "Medium", "note_classification": "Top / Middle", "tenacity": "Low to moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Geraniol", "Citronellol", "Rose", "Linalool"], "fema_number": "2770"},
    "5392-40-5": {"names": ["citral"], "odor_description": "Strong, fresh, lemon-like with green, slightly sweet character", "odor_type": "Citrus / Lemon", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~3 hours", "ifra_guidelines": "Restricted — sensitizer", "usage_levels": "1–5 %", "blends_well_with": ["Lemon", "Lemongrass", "Geraniol", "Orange"], "fema_number": "2303"},
    "115-95-7": {"names": ["linalyl acetate"], "odor_description": "Fresh, sweet, floral-fruity with bergamot and lavender character", "odor_type": "Floral / Fresh", "odor_strength": "Medium", "note_classification": "Top", "tenacity": "Low to moderate", "tenacity_hours": "~6 hours", "ifra_guidelines": "No restriction", "usage_levels": "5–30 %", "blends_well_with": ["Linalool", "Lavender", "Bergamot", "Clary Sage"], "fema_number": "2636"},
    "105-87-3": {"names": ["geranyl acetate"], "odor_description": "Fresh, fruity, rose-like with sweet, slightly waxy character", "odor_type": "Floral / Fruity", "odor_strength": "Medium", "note_classification": "Top", "tenacity": "Low to moderate", "tenacity_hours": "~6 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Geraniol", "Rose", "Citronella", "Bergamot"], "fema_number": "2509"},
    "140-11-4": {"names": ["benzyl acetate"], "odor_description": "Sweet, fruity, jasmine-like with pear, banana and floral facets", "odor_type": "Fruity / Floral", "odor_strength": "Medium", "note_classification": "Top / Middle", "tenacity": "Low to moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "No restriction", "usage_levels": "5–20 %", "blends_well_with": ["Jasmine", "Ylang Ylang", "Hedione", "Linalool"], "fema_number": "2135"},
    "119-36-8": {"names": ["methyl salicylate"], "odor_description": "Sweet, medicinal, wintergreen with warm, balsamic character", "odor_type": "Medicinal / Sweet", "odor_strength": "High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~12 hours", "ifra_guidelines": "Restricted — allergen", "usage_levels": "1–5 %", "blends_well_with": ["Birch Tar", "Menthol", "Camphor", "Eucalyptol"], "fema_number": "2745"},
    # ═══════ Sweet / Balsamic ═══════
    "118-71-8": {"names": ["maltol"], "odor_description": "Sweet, caramel, cotton-candy with warm, fruity-baked character", "odor_type": "Sweet / Caramel", "odor_strength": "High", "note_classification": "Base", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Ethyl Maltol", "Vanilla", "Caramel", "Furaneol"], "fema_number": "2656"},
    "4940-11-8": {"names": ["ethyl maltol"], "odor_description": "Intensely sweet, caramel, cotton-candy — 4-6x stronger than maltol", "odor_type": "Sweet / Caramel", "odor_strength": "Very High", "note_classification": "Base", "tenacity": "High", "tenacity_hours": "~48 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.1–2 %", "blends_well_with": ["Maltol", "Vanilla", "Strawberry", "Caramel"], "fema_number": "3487"},
    "3658-77-3": {"names": ["furaneol"], "odor_description": "Sweet, caramel, strawberry with warm, fruity-jammy character", "odor_type": "Sweet / Fruity", "odor_strength": "High", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Strawberry", "Vanilla", "Maltol", "Caramel"], "fema_number": "3174"},
    "579-44-2": {"names": ["benzoin"], "odor_description": "Sweet, warm, balsamic-vanilla with almond and slightly smoky character", "odor_type": "Balsamic / Vanilla", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "High", "tenacity_hours": "~100 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Vanilla", "Styrax", "Coumarin", "Sandalwood", "Rose"], "fema_number": "2132"},
    # ═══════ Green / Watery ═══════
    "928-96-1": {"names": ["cis-3-hexenol", "leaf alcohol"], "odor_description": "Intensely green, fresh-cut grass with leaf-like and slightly fruity character", "odor_type": "Green / Leafy", "odor_strength": "Very High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~2 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.1–2 %", "blends_well_with": ["Galbanum", "Violet Leaf", "Basil", "Mint"], "fema_number": "2563"},
    # ═══════ Leather / Animalic ═══════
    "65442-31-1": {"names": ["isobutyl quinoline", "ibq"], "odor_description": "Dark, smoky, leathery with green, earthy and slightly animalic facets", "odor_type": "Leather / Smoky", "odor_strength": "High", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~200 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–3 %", "blends_well_with": ["Birch Tar", "Castoreum", "Labdanum", "Leather bases"], "fema_number": ""},
    # ═══════ Solvents / Carriers ═══════
    "25265-71-8": {"names": ["dipropylene glycol", "dpg"], "odor_description": "Virtually odorless — standard fragrance solvent/carrier", "odor_type": "Solvent / Carrier", "odor_strength": "None", "note_classification": "N/A — solvent", "tenacity": "N/A", "tenacity_hours": "N/A", "ifra_guidelines": "No restriction", "usage_levels": "Used as solvent at 10–50 %", "blends_well_with": [], "fema_number": ""},
    "134-20-3": {"names": ["methyl anthranilate"], "odor_description": "Sweet, fruity, grape-like with orange blossom and slightly narcotic floral character", "odor_type": "Fruity / Floral", "odor_strength": "High", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "Restricted — phototoxic", "usage_levels": "0.5–5 %", "blends_well_with": ["Neroli", "Orange Blossom", "Jasmine", "Ylang Ylang"], "fema_number": "2682"},
    "4602-84-0": {"names": ["farnesol"], "odor_description": "Delicate, sweet, floral with linden blossom and slight green character", "odor_type": "Floral / Sweet", "odor_strength": "Low to Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "Restricted — allergen", "usage_levels": "1–10 %", "blends_well_with": ["Linden", "Rose", "Cyclamen", "Linalool"], "fema_number": "2478"},
    "7212-44-4": {"names": ["nerolidol"], "odor_description": "Mild, delicate, woody-floral with green, slightly waxy and bark-like character", "odor_type": "Woody / Floral", "odor_strength": "Low to Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Rose", "Neroli", "Wood notes", "Linalool"], "fema_number": "2772"},
    "80-54-6": {"names": ["lilial", "butylphenyl methylpropional"], "odor_description": "Fresh, watery, lily-of-the-valley with cyclamen and powdery facets", "odor_type": "Floral / Fresh", "odor_strength": "Medium to High", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "BANNED in EU since 2022 — CMR substance", "usage_levels": "Prohibited in EU; 1–10 % elsewhere", "blends_well_with": ["Hydroxycitronellal", "Muguet notes", "Hedione"], "fema_number": ""},
    "31906-04-4": {"names": ["lyral", "hydroxyisohexyl 3-cyclohexene carboxaldehyde"], "odor_description": "Fresh, floral, lily-of-the-valley with watery-green and cyclamen character", "odor_type": "Floral / Muguet", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "BANNED in EU since 2022 — strong sensitizer", "usage_levels": "Prohibited in EU; limited elsewhere", "blends_well_with": ["Lilial", "Hydroxycitronellal", "Hedione"], "fema_number": ""},
    # ═══════ Remaining Perfumery Compounds (complete coverage) ═══════
    "100-51-6": {"names": ["benzyl alcohol"], "odor_description": "Faint, sweet, slightly floral with almond-like character — mostly a solvent", "odor_type": "Floral / Solvent", "odor_strength": "Low", "note_classification": "Middle", "tenacity": "Low", "tenacity_hours": "~4 hours", "ifra_guidelines": "Restricted — allergen", "usage_levels": "1–10 %", "blends_well_with": ["Jasmine", "Rose", "Ylang Ylang"], "fema_number": "2137"},
    "100-52-7": {"names": ["benzaldehyde"], "odor_description": "Strong, sweet, bitter almond with cherry and marzipan character", "odor_type": "Sweet / Nutty", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~3 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Cherry", "Almond", "Heliotropin", "Coumarin"], "fema_number": "2127"},
    "102-76-1": {"names": ["triacetin"], "odor_description": "Virtually odorless — used as fixative and solvent", "odor_type": "Solvent / Fixative", "odor_strength": "None", "note_classification": "N/A — fixative", "tenacity": "N/A", "tenacity_hours": "N/A", "ifra_guidelines": "No restriction", "usage_levels": "As solvent 5–30 %", "blends_well_with": [], "fema_number": "2007"},
    "103-26-4": {"names": ["methyl cinnamate"], "odor_description": "Sweet, fruity, balsamic with strawberry and cinnamon-like character", "odor_type": "Fruity / Balsamic", "odor_strength": "Medium", "note_classification": "Middle", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Cinnamon", "Strawberry", "Vanilla", "Ylang Ylang"], "fema_number": "2698"},
    "103-45-7": {"names": ["phenylethyl acetate", "acetaldehyde phenylethyl"], "odor_description": "Sweet, rosy, fruity with peach and honey-like character", "odor_type": "Floral / Fruity", "odor_strength": "Medium", "note_classification": "Top / Middle", "tenacity": "Low to moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–15 %", "blends_well_with": ["Rose", "Geraniol", "Peach", "Linalool"], "fema_number": "2857"},
    "103-82-2": {"names": ["phenyl acetic acid"], "odor_description": "Sweet, honey-like with waxy, slightly animalic and floral character", "odor_type": "Sweet / Honey", "odor_strength": "High", "note_classification": "Base", "tenacity": "High", "tenacity_hours": "~48 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Honey", "Rose", "Jasmine", "Narcissus"], "fema_number": "2878"},
    "104-54-1": {"names": ["cinnamic alcohol", "cinnamyl alcohol"], "odor_description": "Sweet, balsamic, hyacinth-like with powdery and slightly spicy character", "odor_type": "Floral / Balsamic", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "Restricted — allergen", "usage_levels": "1–5 %", "blends_well_with": ["Hyacinth", "Cinnamon", "Rose", "Lilac"], "fema_number": "2294"},
    "105-13-5": {"names": ["anisyl alcohol"], "odor_description": "Sweet, floral, balsamic with hawthorn and coumarin-like character", "odor_type": "Floral / Sweet", "odor_strength": "Medium", "note_classification": "Middle", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Hawthorn", "Vanilla", "Coumarin", "Heliotropin"], "fema_number": "2099"},
    "106-26-3": {"names": ["neral"], "odor_description": "Fresh, lemon-like with sweet, slightly less harsh than citral", "odor_type": "Citrus / Lemon", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~3 hours", "ifra_guidelines": "Restricted — sensitizer", "usage_levels": "1–5 %", "blends_well_with": ["Geranial", "Lemon", "Lemongrass", "Citrus"], "fema_number": "2303"},
    "106-44-5": {"names": ["para cresol", "p-cresol"], "odor_description": "Strong, phenolic, leathery with animalic, narcissus and tarry facets", "odor_type": "Animalic / Leather", "odor_strength": "Very High", "note_classification": "Base", "tenacity": "High", "tenacity_hours": "~72 hours", "ifra_guidelines": "Restricted", "usage_levels": "0.01–0.5 %", "blends_well_with": ["Leather", "Castoreum", "Narcissus", "Oud"], "fema_number": "2337"},
    "110-27-0": {"names": ["isopropyl myristate", "ipm"], "odor_description": "Virtually odorless — emollient and solvent", "odor_type": "Solvent / Carrier", "odor_strength": "None", "note_classification": "N/A — carrier", "tenacity": "N/A", "tenacity_hours": "N/A", "ifra_guidelines": "No restriction", "usage_levels": "As carrier 5–30 %", "blends_well_with": [], "fema_number": ""},
    "11031-45-1": {"names": ["santalol"], "odor_description": "Soft, warm, creamy sandalwood — mixture of alpha and beta santalol", "odor_type": "Woody / Sandalwood", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~400 hours", "ifra_guidelines": "No restriction", "usage_levels": "5–20 %", "blends_well_with": ["Rose", "Jasmine", "Vetiver", "Vanilla"], "fema_number": ""},
    "111-01-3": {"names": ["squalane"], "odor_description": "Odorless — emollient carrier oil", "odor_type": "Carrier", "odor_strength": "None", "note_classification": "N/A — carrier", "tenacity": "N/A", "tenacity_hours": "N/A", "ifra_guidelines": "No restriction", "usage_levels": "As carrier", "blends_well_with": [], "fema_number": ""},
    "111-12-6": {"names": ["methyl 2-octynoate"], "odor_description": "Intensely green, violet-leaf with metallic and slightly fruity character", "odor_type": "Green / Violet", "odor_strength": "Very High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~18 hours", "ifra_guidelines": "Restricted — sensitizer", "usage_levels": "0.1–2 %", "blends_well_with": ["Violet Leaf", "Galbanum", "Green notes"], "fema_number": "2729"},
    "112-45-8": {"names": ["undecylenic aldehyde", "aldehyde c-11 moa"], "odor_description": "Fresh, waxy, citrus-rose with slightly fatty metallic character", "odor_type": "Aldehydic / Waxy", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low to moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–3 %", "blends_well_with": ["Rose", "Aldehydes", "Musk"], "fema_number": "3094"},
    "115-71-9": {"names": ["alpha santalol"], "odor_description": "Soft, creamy, warm sandalwood — the main odorant of natural sandalwood oil", "odor_type": "Woody / Sandalwood", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Extremely high", "tenacity_hours": "~500 hours", "ifra_guidelines": "No restriction", "usage_levels": "5–20 %", "blends_well_with": ["Beta Santalol", "Rose", "Jasmine", "Vanilla"], "fema_number": ""},
    "1195-79-5": {"names": ["fenchone"], "odor_description": "Fresh, camphoraceous, earthy with mint and slightly bitter character", "odor_type": "Camphoraceous / Herbal", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~4 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–3 %", "blends_well_with": ["Fennel", "Camphor", "Lavender", "Rosemary"], "fema_number": "2479"},
    "1211-29-6": {"names": ["methyl jasmonate"], "odor_description": "Floral, jasmine-like with green, slightly fruity and waxy facets", "odor_type": "Floral / Green", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Jasmine", "Hedione", "Rose", "Indole"], "fema_number": ""},
    "123-11-5": {"names": ["anisaldehyde", "para anisaldehyde"], "odor_description": "Sweet, powdery, hawthorn-like with mimosa and vanilla facets", "odor_type": "Sweet / Floral", "odor_strength": "Medium to High", "note_classification": "Middle", "tenacity": "Moderate", "tenacity_hours": "~18 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Hawthorn", "Mimosa", "Vanilla", "Heliotropin"], "fema_number": "2670"},
    "123-35-3": {"names": ["myrcene", "beta myrcene"], "odor_description": "Fresh, herbal, green-peppery with balsamic and slightly metallic character", "odor_type": "Green / Herbal", "odor_strength": "Medium", "note_classification": "Top", "tenacity": "Low — volatile terpene", "tenacity_hours": "~2 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Hops", "Linalool", "Pine", "Juniper"], "fema_number": "2762"},
    "123-68-2": {"names": ["allyl caproate"], "odor_description": "Intense, fruity, pineapple with tropical and slightly green character", "odor_type": "Fruity / Tropical", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~4 hours", "ifra_guidelines": "Restricted", "usage_levels": "0.5–3 %", "blends_well_with": ["Pineapple", "Tropical fruits", "Coconut"], "fema_number": "2032"},
    "123-69-3": {"names": ["ambrettolide"], "odor_description": "Clean, sweet, musky with slightly fruity, ambrette seed character", "odor_type": "Musk / Fruity", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~400 hours", "ifra_guidelines": "No restriction", "usage_levels": "3–15 %", "blends_well_with": ["Musk", "Ambroxan", "Galaxolide", "Rose"], "fema_number": ""},
    "123-92-2": {"names": ["isoamyl acetate"], "odor_description": "Strong, fruity, banana-like with pear and solvent character", "odor_type": "Fruity / Banana", "odor_strength": "Very High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~2 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Banana", "Pear", "Tropical fruits"], "fema_number": "2055"},
    "124-76-5": {"names": ["isoborneol"], "odor_description": "Camphoraceous, earthy, musty-woody with slight peppery character", "odor_type": "Camphoraceous / Woody", "odor_strength": "Medium to High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Camphor", "Borneol", "Pine", "Cedar"], "fema_number": "2158"},
    "127-42-4": {"names": ["methyl ionone alpha"], "odor_description": "Warm, woody, orris-violet with powdery and slightly floral character", "odor_type": "Woody / Violet", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "Restricted — allergen", "usage_levels": "2–15 %", "blends_well_with": ["Orris", "Violet", "Ionone", "Cedarwood"], "fema_number": "2711"},
    "127-51-5": {"names": ["alpha isomethyl ionone"], "odor_description": "Dry, woody, violet with powdery, orris and slightly floral character", "odor_type": "Woody / Violet", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "Restricted — allergen", "usage_levels": "2–15 %", "blends_well_with": ["Ionone", "Orris", "Cedarwood", "Iso E Super"], "fema_number": "2714"},
    "127-91-3": {"names": ["beta pinene"], "odor_description": "Fresh, woody, pine-like with dry, turpentine and slightly resinous character", "odor_type": "Woody / Pine", "odor_strength": "Medium", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~2 hours", "ifra_guidelines": "Restricted — oxidizes to sensitizer", "usage_levels": "1–5 %", "blends_well_with": ["Alpha Pinene", "Pine", "Cedarwood", "Eucalyptol"], "fema_number": "2903"},
    "1335-46-2": {"names": ["methyl ionone", "orris"], "odor_description": "Warm, floral, woody-violet with powdery orris and sweet facets", "odor_type": "Floral / Woody", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "Restricted", "usage_levels": "2–15 %", "blends_well_with": ["Orris", "Violet", "Iris", "Cedarwood"], "fema_number": "2714"},
    "134-62-3": {"names": ["deet"], "odor_description": "Faint, slightly sweet, plasticky — primarily an insect repellent", "odor_type": "Functional / Repellent", "odor_strength": "Low", "note_classification": "N/A — functional", "tenacity": "Moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "Not used in fine fragrance", "usage_levels": "Functional use only", "blends_well_with": [], "fema_number": ""},
    "13877-91-3": {"names": ["ocimene"], "odor_description": "Warm, herbal, floral with sweet, tropical and slightly woody character", "odor_type": "Herbal / Floral", "odor_strength": "Medium", "note_classification": "Top", "tenacity": "Low — volatile terpene", "tenacity_hours": "~2 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Basil", "Lavender", "Linalool", "Hops"], "fema_number": ""},
    "140-67-0": {"names": ["methyl chavicol", "estragole"], "odor_description": "Sweet, herbal, anise-like with tarragon and basil character", "odor_type": "Herbal / Anise", "odor_strength": "High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~12 hours", "ifra_guidelines": "Restricted — possible carcinogen", "usage_levels": "0.5–3 %", "blends_well_with": ["Basil", "Tarragon", "Anise", "Fennel"], "fema_number": "2411"},
    "141-12-8": {"names": ["neryl acetate"], "odor_description": "Fresh, sweet, floral-fruity with rose and slightly green character", "odor_type": "Floral / Fresh", "odor_strength": "Medium", "note_classification": "Top", "tenacity": "Low to moderate", "tenacity_hours": "~6 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Nerol", "Geraniol", "Rose", "Bergamot"], "fema_number": "2773"},
    "141-27-5": {"names": ["geranial"], "odor_description": "Strong, lemon-like, fresh — more harsh and citrus than neral", "odor_type": "Citrus / Lemon", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~3 hours", "ifra_guidelines": "Restricted — sensitizer", "usage_levels": "1–5 %", "blends_well_with": ["Neral", "Lemon", "Lemongrass", "Citral"], "fema_number": "2303"},
    "141-78-6": {"names": ["ethyl acetate"], "odor_description": "Sharp, fruity, ethereal solvent with sweet pear-like character", "odor_type": "Fruity / Solvent", "odor_strength": "High", "note_classification": "Top", "tenacity": "Very low — extremely volatile", "tenacity_hours": "~1 hour", "ifra_guidelines": "No restriction", "usage_levels": "Solvent use", "blends_well_with": [], "fema_number": "2414"},
    "142-92-7": {"names": ["hexyl acetate"], "odor_description": "Fresh, green, fruity with pear, apple and slightly herbal character", "odor_type": "Fruity / Green", "odor_strength": "Medium to High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~4 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Apple", "Pear", "Green notes", "Citrus"], "fema_number": "2565"},
    "150-84-5": {"names": ["citronellyl acetate"], "odor_description": "Fresh, fruity, rose-like with green and slightly citrus character", "odor_type": "Floral / Fruity", "odor_strength": "Medium", "note_classification": "Top / Middle", "tenacity": "Low to moderate", "tenacity_hours": "~6 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Citronellol", "Geraniol", "Rose", "Bergamot"], "fema_number": "2311"},
    "15323-35-0": {"names": ["phantolide", "ahdi"], "odor_description": "Sweet, powdery, clean musk with slightly woody character", "odor_type": "Musk", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~300 hours", "ifra_guidelines": "Restricted — polycyclic musk", "usage_levels": "3–10 %", "blends_well_with": ["Galaxolide", "Tonalide", "Cashmeran"], "fema_number": ""},
    "1632-73-1": {"names": ["fenchol"], "odor_description": "Fresh, camphoraceous, borneol-like with earthy and slightly pine character", "odor_type": "Camphoraceous / Fresh", "odor_strength": "Medium to High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Camphor", "Pine", "Borneol", "Eucalyptol"], "fema_number": "2480"},
    "17283-81-7": {"names": ["dihydro beta ionone"], "odor_description": "Warm, woody, tobacco-like with slight orris and dry amber character", "odor_type": "Woody / Tobacco", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Tobacco", "Ionone", "Cedarwood", "Amber"], "fema_number": ""},
    "17587-33-6": {"names": ["2,6-nonadienal"], "odor_description": "Powerful, green, cucumber with violet-leaf and melon character", "odor_type": "Green / Cucumber", "odor_strength": "Very High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~2 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.01–0.5 %", "blends_well_with": ["Cucumber", "Violet Leaf", "Melon", "Green notes"], "fema_number": "3377"},
    "17699-05-7": {"names": ["bergamotene"], "odor_description": "Warm, woody, peppery with slight balsamic and tea-like character", "odor_type": "Woody / Spicy", "odor_strength": "Medium", "note_classification": "Middle", "tenacity": "Moderate", "tenacity_hours": "~18 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Bergamot", "Cedarwood", "Pepper", "Tea"], "fema_number": ""},
    "18679-18-0": {"names": ["jasmolactone"], "odor_description": "Fruity, jasmine-like with peach, coconut and creamy lactonic facets", "odor_type": "Floral / Fruity", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–8 %", "blends_well_with": ["Jasmine", "Peach", "Hedione", "Lactones"], "fema_number": ""},
    "19870-74-7": {"names": ["hinoki", "hinokitiol oil"], "odor_description": "Fresh, woody, cypress-like with slightly spicy and resinous character", "odor_type": "Woody / Fresh", "odor_strength": "Medium", "note_classification": "Middle / Base", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Cypress", "Cedarwood", "Hinokitiol", "Vetiver"], "fema_number": ""},
    "2216-51-5": {"names": ["l-menthol"], "odor_description": "Intensely cool, minty — the natural form of menthol, slightly sweeter", "odor_type": "Fresh / Mint", "odor_strength": "Very High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~2 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Eucalyptol", "Peppermint", "Camphor"], "fema_number": "2665"},
    "2244-16-8": {"names": ["d-carvone"], "odor_description": "Sweet, herbal, spearmint-like with caraway undertone", "odor_type": "Herbal / Mint", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~4 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Spearmint", "Caraway", "Dill"], "fema_number": "2249"},
    "236391-76-7": {"names": ["romandolide"], "odor_description": "Clean, fresh, fruity-musky with pear and slightly floral character", "odor_type": "Musk / Fruity", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~300 hours", "ifra_guidelines": "No restriction", "usage_levels": "3–15 %", "blends_well_with": ["Helvetolide", "Galaxolide", "Pear", "Hedione"], "fema_number": ""},
    "23787-90-8": {"names": ["iso longifolanone"], "odor_description": "Warm, woody, amber-like with slightly musky and resinous character", "odor_type": "Woody / Amber", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "High", "tenacity_hours": "~100 hours", "ifra_guidelines": "No restriction", "usage_levels": "5–20 %", "blends_well_with": ["Ambroxan", "Cedarwood", "Vetiver"], "fema_number": ""},
    "25524-95-2": {"names": ["jasmine lactone"], "odor_description": "Fruity, jasmine-like with peach, plum and creamy lactonic character", "odor_type": "Floral / Fruity", "odor_strength": "Medium to High", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–8 %", "blends_well_with": ["Jasmine", "Peach", "Hedione"], "fema_number": "3196"},
    "3338-55-4": {"names": ["beta ocimene"], "odor_description": "Fresh, herbal, warm with sweet, slightly woody and floral character", "odor_type": "Herbal / Floral", "odor_strength": "Medium", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~2 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Basil", "Lavender", "Ocimene"], "fema_number": ""},
    "3387-41-5": {"names": ["sabinene"], "odor_description": "Fresh, woody, peppery with slight citrus and turpentine character", "odor_type": "Woody / Spicy", "odor_strength": "Medium", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~2 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Juniper", "Black Pepper", "Pine"], "fema_number": ""},
    "3681-71-8": {"names": ["cis-3-hexenyl acetate"], "odor_description": "Intensely green, fresh-cut grass with fruity banana-leaf character", "odor_type": "Green / Leafy", "odor_strength": "Very High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~3 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["cis-3-Hexenol", "Galbanum", "Violet Leaf", "Basil"], "fema_number": "3171"},
    "4674-50-4": {"names": ["nootkatone"], "odor_description": "Powerful, grapefruit with woody, green and slightly sulfurous character", "odor_type": "Citrus / Woody", "odor_strength": "Very High", "note_classification": "Top / Middle", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.1–3 %", "blends_well_with": ["Grapefruit", "Vetiver", "Cedarwood", "Citrus"], "fema_number": "3166"},
    "473-15-4": {"names": ["eudesmol"], "odor_description": "Woody, slightly sweet with earthy, patchouli-like character", "odor_type": "Woody / Earthy", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "High", "tenacity_hours": "~100 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Patchouli", "Vetiver", "Cedarwood", "Guaiac"], "fema_number": ""},
    "484-20-8": {"names": ["bergaptene"], "odor_description": "Virtually odorless — a furanocoumarin, relevant for phototoxicity only", "odor_type": "N/A — phototoxic component", "odor_strength": "None", "note_classification": "N/A", "tenacity": "N/A", "tenacity_hours": "N/A", "ifra_guidelines": "Restricted — must be below 15 ppm in leave-on products", "usage_levels": "Must be removed (FCF bergamot)", "blends_well_with": [], "fema_number": ""},
    "489-84-9": {"names": ["guaiazulene"], "odor_description": "Very faint, slightly sweet — primarily a blue colorant from chamomile", "odor_type": "N/A — colorant", "odor_strength": "Very Low", "note_classification": "N/A", "tenacity": "N/A", "tenacity_hours": "N/A", "ifra_guidelines": "No restriction", "usage_levels": "Trace — colorant", "blends_well_with": ["Chamomile"], "fema_number": ""},
    "491-07-6": {"names": ["isomenthone"], "odor_description": "Minty, green, slightly woody with less sweet character than menthone", "odor_type": "Mint / Green", "odor_strength": "Medium to High", "note_classification": "Top", "tenacity": "Low to moderate", "tenacity_hours": "~6 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Menthol", "Menthone", "Peppermint"], "fema_number": "3460"},
    "499-44-5": {"names": ["hinokitiol"], "odor_description": "Fresh, woody, cypress with slightly spicy and antibacterial character", "odor_type": "Woody / Fresh", "odor_strength": "Medium", "note_classification": "Middle", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–3 %", "blends_well_with": ["Cypress", "Cedarwood", "Hinoki"], "fema_number": ""},
    "502-72-7": {"names": ["exaltone", "cyclopentadecanone"], "odor_description": "Clean, musky, slightly metallic with woody and subtle animalic facets", "odor_type": "Musk", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~400 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Muscone", "Galaxolide", "Ambroxan"], "fema_number": "3623"},
    "542-46-1": {"names": ["civetone", "cosmone"], "odor_description": "Powerful, animalic-musky with warm, sensual and slightly fecal character", "odor_type": "Musk / Animalic", "odor_strength": "Very High", "note_classification": "Base", "tenacity": "Extremely high", "tenacity_hours": "~700 hours", "ifra_guidelines": "No restriction for synthetic", "usage_levels": "0.05–1 %", "blends_well_with": ["Muscone", "Castoreum", "Ambroxan", "Civet"], "fema_number": ""},
    "54344-82-0": {"names": ["cabreuva"], "odor_description": "Soft, woody, slightly balsamic with faint floral and tea-like character", "odor_type": "Woody / Balsamic", "odor_strength": "Low to Medium", "note_classification": "Base", "tenacity": "High", "tenacity_hours": "~100 hours", "ifra_guidelines": "No restriction", "usage_levels": "5–20 %", "blends_well_with": ["Sandalwood", "Cedarwood", "Rose", "Vetiver"], "fema_number": ""},
    "54440-17-4": {"names": ["safraleine"], "odor_description": "Warm, spicy, saffron-like with leathery, woody and slightly sweet character", "odor_type": "Spicy / Leather", "odor_strength": "High", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Saffron", "Rose", "Oud", "Leather"], "fema_number": ""},
    "562-74-3": {"names": ["terpinen-4-ol", "terpinen 4 ol"], "odor_description": "Fresh, earthy, peppery with slight woody-herbaceous character", "odor_type": "Herbal / Earthy", "odor_strength": "Medium", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Tea Tree", "Lavender", "Eucalyptol", "Pine"], "fema_number": "2248"},
    "57-55-6": {"names": ["propylene glycol", "pg"], "odor_description": "Virtually odorless — standard fragrance solvent/humectant", "odor_type": "Solvent / Carrier", "odor_strength": "None", "note_classification": "N/A — solvent", "tenacity": "N/A", "tenacity_hours": "N/A", "ifra_guidelines": "No restriction", "usage_levels": "As solvent", "blends_well_with": [], "fema_number": ""},
    "57378-68-4": {"names": ["damascone delta"], "odor_description": "Fruity, plum-like with green, slightly woody character", "odor_type": "Fruity / Green", "odor_strength": "High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~18 hours", "ifra_guidelines": "Restricted", "usage_levels": "0.1–2 %", "blends_well_with": ["Damascone Alpha/Beta", "Rose", "Plum"], "fema_number": ""},
    "586-62-9": {"names": ["terpinolene"], "odor_description": "Fresh, pine-like, herbal with slightly sweet, citrus and floral character", "odor_type": "Fresh / Herbal", "odor_strength": "Medium", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~3 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Pine", "Citrus", "Lavender", "Tea Tree"], "fema_number": "3046"},
    "5989-54-8": {"names": ["l-limonene"], "odor_description": "Fresh, citrus, piney — slightly more turpentine-like than d-limonene", "odor_type": "Citrus / Pine", "odor_strength": "Medium to High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~3 hours", "ifra_guidelines": "Restricted — oxidized limonene is allergen", "usage_levels": "1–10 %", "blends_well_with": ["Pine", "Citrus", "Linalool", "Mint"], "fema_number": "2633"},
    "1365-19-1": {"names": ["linalool oxide"], "odor_description": "Fresh, sweet, floral with earthy, slightly woody and creamy facets", "odor_type": "Floral / Woody", "odor_strength": "Medium", "note_classification": "Top / Middle", "tenacity": "Low to moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Linalool", "Lavender", "Tea", "Rose"], "fema_number": ""},
    "62015-37-6": {"names": ["stemone"], "odor_description": "Green, watery, slightly floral with ozone-like freshness", "odor_type": "Green / Aquatic", "odor_strength": "Medium to High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~12 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Calone", "Floralozone", "Green notes"], "fema_number": ""},
    "62563-80-8": {"names": ["vetiver acetate", "vetiveryl acetate"], "odor_description": "Warm, woody, slightly smoky vetiver with smooth, rounded character", "odor_type": "Woody / Smoky", "odor_strength": "Medium to High", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~200 hours", "ifra_guidelines": "No restriction", "usage_levels": "5–20 %", "blends_well_with": ["Vetiver", "Patchouli", "Cedarwood", "Iso E Super"], "fema_number": ""},
    "6259-76-3": {"names": ["hexyl salicylate"], "odor_description": "Fresh, green, slightly floral with orchid-like and powdery character", "odor_type": "Green / Floral", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–15 %", "blends_well_with": ["Benzyl Salicylate", "Orchid", "Rose"], "fema_number": "3681"},
    "628-63-7": {"names": ["amyl acetate"], "odor_description": "Strong, sweet, fruity with banana and pear-like character", "odor_type": "Fruity / Banana", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~2 hours", "ifra_guidelines": "No restriction", "usage_levels": "0.5–5 %", "blends_well_with": ["Banana", "Pear", "Apple", "Tropical fruits"], "fema_number": "2055"},
    "63187-91-7": {"names": ["sylkolide", "velvione"], "odor_description": "Clean, velvety, powdery musk with slightly woody character", "odor_type": "Musk", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~350 hours", "ifra_guidelines": "No restriction", "usage_levels": "3–15 %", "blends_well_with": ["Galaxolide", "Muscenone", "Habanolide"], "fema_number": ""},
    "6485-40-1": {"names": ["l-carvone"], "odor_description": "Sweet, herbal, caraway-like with dill and slightly minty character", "odor_type": "Herbal / Spicy", "odor_strength": "High", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~4 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Caraway", "Dill", "Mint", "Fennel"], "fema_number": "2249"},
    "67634-20-2": {"names": ["suederal"], "odor_description": "Dry, leather, suede-like with clean, slightly woody character", "odor_type": "Leather / Suede", "odor_strength": "Medium to High", "note_classification": "Base", "tenacity": "High", "tenacity_hours": "~100 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Leather", "Birch Tar", "Labdanum", "Iso E Super"], "fema_number": ""},
    "6812-78-8": {"names": ["rhodinol"], "odor_description": "Sweet, fresh, rose-like with citronella and slightly green character", "odor_type": "Floral / Rose", "odor_strength": "Medium", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~12 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Rose", "Geraniol", "Citronellol", "Linalool"], "fema_number": "2980"},
    "68140-48-7": {"names": ["traseolide", "atii"], "odor_description": "Clean, powdery, sweet musk with floral and slightly fruity facets", "odor_type": "Musk", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~350 hours", "ifra_guidelines": "Restricted — polycyclic musk", "usage_levels": "3–10 %", "blends_well_with": ["Galaxolide", "Tonalide", "Phantolide"], "fema_number": ""},
    "68901-22-4": {"names": ["paradisone"], "odor_description": "Fresh, jasmine-like with green, slightly fruity and hedione-like character", "odor_type": "Floral / Green", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate to high", "tenacity_hours": "~36 hours", "ifra_guidelines": "No restriction", "usage_levels": "3–20 %", "blends_well_with": ["Hedione", "Jasmine", "Linalool", "Rose"], "fema_number": ""},
    "70-70-2": {"names": ["jasmonyl"], "odor_description": "Warm, jasmine-like with sweet, slightly fruity and musky character", "odor_type": "Floral / Sweet", "odor_strength": "Medium", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "No restriction", "usage_levels": "2–10 %", "blends_well_with": ["Jasmine", "Hedione", "Rose", "Musk"], "fema_number": ""},
    "73398-61-5": {"names": ["mct oil"], "odor_description": "Virtually odorless — medium-chain triglyceride carrier oil", "odor_type": "Carrier", "odor_strength": "None", "note_classification": "N/A — carrier", "tenacity": "N/A", "tenacity_hours": "N/A", "ifra_guidelines": "No restriction", "usage_levels": "As carrier", "blends_well_with": [], "fema_number": ""},
    "76-49-3": {"names": ["bornyl acetate"], "odor_description": "Fresh, pine-needle, camphoraceous with sweet, balsamic character", "odor_type": "Woody / Pine", "odor_strength": "Medium to High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~12 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Pine", "Fir", "Cedarwood", "Lavender"], "fema_number": "2159"},
    "77-42-9": {"names": ["beta santalol"], "odor_description": "Woody, slightly milky-animal with less creamy character than alpha", "odor_type": "Woody / Sandalwood", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~300 hours", "ifra_guidelines": "No restriction", "usage_levels": "3–15 %", "blends_well_with": ["Alpha Santalol", "Rose", "Jasmine"], "fema_number": ""},
    "77-54-3": {"names": ["cedryl acetate"], "odor_description": "Soft, warm, woody-cedar with slight fruity and green character", "odor_type": "Woody / Cedar", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~200 hours", "ifra_guidelines": "No restriction", "usage_levels": "5–20 %", "blends_well_with": ["Cedrol", "Cedarwood", "Vetiver", "Iso E Super"], "fema_number": ""},
    "77-93-0": {"names": ["triethyl citrate", "tec"], "odor_description": "Virtually odorless — plasticizer and fixative", "odor_type": "Solvent / Fixative", "odor_strength": "None", "note_classification": "N/A — fixative", "tenacity": "N/A", "tenacity_hours": "N/A", "ifra_guidelines": "No restriction", "usage_levels": "As fixative 5–20 %", "blends_well_with": [], "fema_number": "3083"},
    "79-92-5": {"names": ["camphene"], "odor_description": "Fresh, camphoraceous, woody with slight mothball and turpentine character", "odor_type": "Camphoraceous / Woody", "odor_strength": "Medium", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~3 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Camphor", "Pine", "Eucalyptol", "Cedarwood"], "fema_number": "2229"},
    "81-15-2": {"names": ["musk xylene", "mx"], "odor_description": "Sweet, powdery, slightly floral musk with dry, woody undertone", "odor_type": "Musk", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~400 hours", "ifra_guidelines": "RESTRICTED — nitro musk; banned in EU cosmetics", "usage_levels": "Prohibited in EU", "blends_well_with": ["Musk Ketone", "Galaxolide"], "fema_number": ""},
    "81782-77-6": {"names": ["undecavertol"], "odor_description": "Fresh, green, slightly floral with watery, cucumber-like character", "odor_type": "Green / Fresh", "odor_strength": "Medium to High", "note_classification": "Top / Middle", "tenacity": "Moderate", "tenacity_hours": "~12 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Green notes", "Violet Leaf", "Galbanum", "Cucumber"], "fema_number": ""},
    "83-66-9": {"names": ["musk ambrette"], "odor_description": "Sweet, warm, musky with powdery, slightly animalic character", "odor_type": "Musk", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~400 hours", "ifra_guidelines": "BANNED — phototoxic and neurotoxic", "usage_levels": "Prohibited worldwide", "blends_well_with": [], "fema_number": ""},
    "84-66-2": {"names": ["diethyl phthalate", "dep"], "odor_description": "Virtually odorless — denaturant and fixative", "odor_type": "Solvent / Fixative", "odor_strength": "None", "note_classification": "N/A — fixative", "tenacity": "N/A", "tenacity_hours": "N/A", "ifra_guidelines": "Restricted — being phased out due to endocrine concerns", "usage_levels": "As fixative", "blends_well_with": [], "fema_number": ""},
    "89-80-5": {"names": ["menthone", "methyl pamplemousse"], "odor_description": "Minty, green, slightly woody with dry, herbaceous character", "odor_type": "Mint / Green", "odor_strength": "Medium to High", "note_classification": "Top", "tenacity": "Low to moderate", "tenacity_hours": "~6 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Menthol", "Peppermint", "Lavender", "Rosemary"], "fema_number": "2667"},
    "89-88-3": {"names": ["vetiverol"], "odor_description": "Warm, earthy, woody with smoky, slightly sweet vetiver character", "odor_type": "Woody / Earthy", "odor_strength": "Medium to High", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~200 hours", "ifra_guidelines": "No restriction", "usage_levels": "3–15 %", "blends_well_with": ["Vetiver", "Patchouli", "Sandalwood", "Cedarwood"], "fema_number": ""},
    "90-05-1": {"names": ["guaiacol"], "odor_description": "Smoky, phenolic, woody with slightly sweet, medicinal character", "odor_type": "Smoky / Phenolic", "odor_strength": "High", "note_classification": "Middle / Base", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "Restricted", "usage_levels": "0.1–2 %", "blends_well_with": ["Smoke", "Leather", "Whisky", "Cade Oil"], "fema_number": "2532"},
    "909478-55-3": {"names": ["nirvanolide"], "odor_description": "Clean, creamy, musky with skin-like and slightly coconut facets", "odor_type": "Musk / Creamy", "odor_strength": "Medium", "note_classification": "Base", "tenacity": "Very high", "tenacity_hours": "~350 hours", "ifra_guidelines": "No restriction", "usage_levels": "3–15 %", "blends_well_with": ["Habanolide", "Helvetolide", "Galaxolide"], "fema_number": ""},
    "93-15-2": {"names": ["methyl eugenol"], "odor_description": "Warm, spicy, clove-like with sweet, carnation and slightly woody character", "odor_type": "Spicy / Warm", "odor_strength": "Medium to High", "note_classification": "Middle / Heart", "tenacity": "Moderate", "tenacity_hours": "~24 hours", "ifra_guidelines": "RESTRICTED — potential carcinogen; very low limits", "usage_levels": "< 0.01 %", "blends_well_with": ["Eugenol", "Clove", "Carnation"], "fema_number": "2475"},
    "93-58-3": {"names": ["methyl benzoate"], "odor_description": "Sweet, fruity, ylang-like with slightly floral and feijoa character", "odor_type": "Fruity / Floral", "odor_strength": "Medium", "note_classification": "Top / Middle", "tenacity": "Low to moderate", "tenacity_hours": "~8 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Ylang Ylang", "Feijoa", "Jasmine"], "fema_number": "2683"},
    "99-83-2": {"names": ["phellandrene", "alpha phellandrene"], "odor_description": "Fresh, citrus-peppery with slight mint and woody character", "odor_type": "Fresh / Spicy", "odor_strength": "Medium", "note_classification": "Top", "tenacity": "Low", "tenacity_hours": "~2 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–5 %", "blends_well_with": ["Pepper", "Eucalyptol", "Lemon", "Dill"], "fema_number": "2856"},
    "99610-64-7": {"names": ["ambermax"], "odor_description": "Warm, powerful, amber with dry, woody and slightly animalic character", "odor_type": "Amber / Woody", "odor_strength": "Very High", "note_classification": "Base", "tenacity": "Extremely high", "tenacity_hours": "~500 hours", "ifra_guidelines": "No restriction", "usage_levels": "1–10 %", "blends_well_with": ["Ambroxan", "Cetalox", "Karanal", "Labdanum"], "fema_number": ""},
    # ═══════ Natural Mixtures / Essential Oils ═══════
    "8001-88-5": {
        "names": ["birch tar", "birch tar oil"],
        "odor_description": "Smoky, leathery, tar-like with phenolic and woody-balsamic facets",
        "odor_type": "Leather / Smoky", "odor_strength": "High",
        "note_classification": "Base",
        "tenacity": "Very high — persistent smoky leather", "tenacity_hours": "~200 hours",
        "ifra_guidelines": "Restricted — contains PAHs; limited use in fine fragrance",
        "usage_levels": "0.1–2 % in fragrance concentrate",
        "blends_well_with": ["Castoreum", "Labdanum", "Cade Oil", "Vetiver", "Patchouli", "Birch Tar Rectified"],
        "fema_number": "",
    },
    "8000-27-9": {
        "names": ["cedarwood", "cedarwood oil", "cedar"],
        "odor_description": "Warm, dry, woody-balsamic with pencil-shaving and soft smoky facets",
        "odor_type": "Woody", "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "High — long-lasting dry wood", "tenacity_hours": "~100 hours",
        "ifra_guidelines": "No restriction for most types",
        "usage_levels": "5–30 % in fragrance concentrate",
        "blends_well_with": ["Vetiver", "Patchouli", "Sandalwood", "Iso E Super", "Bergamot", "Lavender"],
        "fema_number": "2041",
    },
    "8000-34-8": {
        "names": ["clove oil", "clove bud oil"],
        "odor_description": "Warm, spicy, sweet with eugenol-dominant character and slight fruity undertone",
        "odor_type": "Spicy", "odor_strength": "High",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate to high", "tenacity_hours": "~48 hours",
        "ifra_guidelines": "Restricted — eugenol content limited per IFRA",
        "usage_levels": "0.5–5 % in fragrance concentrate",
        "blends_well_with": ["Cinnamon", "Vanilla", "Orange", "Rose", "Ylang Ylang", "Nutmeg"],
        "fema_number": "2323",
    },
    "8015-91-6": {
        "names": ["cinnamon oil", "cinnamon bark oil"],
        "odor_description": "Warm, sweet, spicy with characteristic cinnamon-aldehyde note",
        "odor_type": "Spicy / Sweet", "odor_strength": "High",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate", "tenacity_hours": "~24 hours",
        "ifra_guidelines": "Restricted — cinnamaldehyde is a strong sensitizer",
        "usage_levels": "0.1–1 % in fragrance concentrate",
        "blends_well_with": ["Clove", "Orange", "Vanilla", "Frankincense", "Benzoin", "Cardamom"],
        "fema_number": "2291",
    },
    "8000-66-6": {
        "names": ["cardamom", "cardamom oil"],
        "odor_description": "Fresh, aromatic, spicy-sweet with eucalyptol and camphoraceous facets",
        "odor_type": "Spicy / Fresh", "odor_strength": "Medium to High",
        "note_classification": "Top / Middle",
        "tenacity": "Moderate", "tenacity_hours": "~12 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "1–5 % in fragrance concentrate",
        "blends_well_with": ["Bergamot", "Rose", "Frankincense", "Cinnamon", "Cedarwood", "Orange"],
        "fema_number": "2241",
    },
    "8007-75-8": {
        "names": ["bergamot", "bergamot oil"],
        "odor_description": "Fresh, citrus-fruity with sweet, slightly floral and tea-like nuances",
        "odor_type": "Citrus / Fresh", "odor_strength": "Medium",
        "note_classification": "Top",
        "tenacity": "Low to moderate", "tenacity_hours": "~4 hours",
        "ifra_guidelines": "Restricted — contains bergaptene (phototoxic); FCF grade recommended",
        "usage_levels": "5–20 % in fragrance concentrate",
        "blends_well_with": ["Lavender", "Neroli", "Jasmine", "Rose", "Vetiver", "Cedarwood", "Linalool"],
        "fema_number": "2153",
    },
    "8006-87-9": {
        "names": ["mysore sandalwood", "sandalwood oil", "east indian sandalwood"],
        "odor_description": "Creamy, soft, warm woody with milky, sweet and balsamic facets",
        "odor_type": "Woody / Creamy", "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "Extremely high", "tenacity_hours": "~500 hours",
        "ifra_guidelines": "No restriction — but supply is scarce (CITES regulated)",
        "usage_levels": "5–20 % in fragrance concentrate",
        "blends_well_with": ["Rose", "Jasmine", "Vetiver", "Vanilla", "Patchouli", "Ambroxan"],
        "fema_number": "",
    },
    "8016-26-0": {
        "names": ["labdanum", "labdanum resin", "cistus"],
        "odor_description": "Rich, warm, amber-resinous with leather, animalic and honeyed facets",
        "odor_type": "Amber / Resinous", "odor_strength": "High",
        "note_classification": "Base",
        "tenacity": "Very high", "tenacity_hours": "~300 hours",
        "ifra_guidelines": "No restriction for absolute; resinoid may have limits",
        "usage_levels": "1–10 % in fragrance concentrate",
        "blends_well_with": ["Ambroxan", "Castoreum", "Vanilla", "Patchouli", "Frankincense", "Oud"],
        "fema_number": "",
    },
    "8013-10-3": {
        "names": ["cade oil", "juniper tar oil"],
        "odor_description": "Smoky, tarry, leathery with medicinal and phenolic notes",
        "odor_type": "Smoky / Leather", "odor_strength": "High",
        "note_classification": "Base",
        "tenacity": "Very high", "tenacity_hours": "~200 hours",
        "ifra_guidelines": "Restricted — limited use; rectified grade preferred",
        "usage_levels": "0.1–1 % in fragrance concentrate",
        "blends_well_with": ["Birch Tar", "Vetiver", "Labdanum", "Castoreum", "Leather Bases"],
        "fema_number": "",
    },
    "8023-83-4": {
        "names": ["castoreum", "castor tincture"],
        "odor_description": "Warm, leathery, animalic with sweet, woody-balsamic and birch-like facets",
        "odor_type": "Animalic / Leather", "odor_strength": "High",
        "note_classification": "Base",
        "tenacity": "Extremely high", "tenacity_hours": "~500 hours",
        "ifra_guidelines": "No restriction for synthetic reconstructions",
        "usage_levels": "0.5–5 % in fragrance concentrate",
        "blends_well_with": ["Labdanum", "Oud", "Birch Tar", "Vanilla", "Ambroxan", "Civet"],
        "fema_number": "",
    },
    "8024-08-6": {
        "names": ["violet leaf", "violet leaf absolute"],
        "odor_description": "Intensely green, waxy, slightly floral with earthy cucumber-like facets",
        "odor_type": "Green / Leafy", "odor_strength": "High",
        "note_classification": "Top / Middle",
        "tenacity": "Moderate", "tenacity_hours": "~24 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "0.5–3 % in fragrance concentrate",
        "blends_well_with": ["Rose", "Iris", "Tarragon", "Galbanum", "Bergamot", "Clary Sage"],
        "fema_number": "",
    },
    "8024-01-9": {
        "names": ["styrax", "storax", "styrax resin"],
        "odor_description": "Sweet, balsamic, cinnamic with floral and slightly animalic character",
        "odor_type": "Balsamic / Sweet", "odor_strength": "Medium to High",
        "note_classification": "Base",
        "tenacity": "High", "tenacity_hours": "~150 hours",
        "ifra_guidelines": "Restricted — contains cinnamate esters",
        "usage_levels": "1–5 % in fragrance concentrate",
        "blends_well_with": ["Benzoin", "Peru Balsam", "Vanilla", "Labdanum", "Rose", "Frankincense"],
        "fema_number": "",
    },
    "8007-00-9": {
        "names": ["peru balsam", "balsam of peru"],
        "odor_description": "Rich, sweet, warm balsamic with vanilla, cinnamon and slightly smoky notes",
        "odor_type": "Balsamic / Vanilla", "odor_strength": "Medium to High",
        "note_classification": "Base",
        "tenacity": "Very high", "tenacity_hours": "~200 hours",
        "ifra_guidelines": "Restricted — known sensitizer; limited in fine fragrance",
        "usage_levels": "0.5–3 % in fragrance concentrate",
        "blends_well_with": ["Vanilla", "Benzoin", "Styrax", "Tolu Balsam", "Coumarin", "Patchouli"],
        "fema_number": "",
    },
    "9000-64-0": {
        "names": ["tolu balsam", "balsam tolu"],
        "odor_description": "Sweet, warm, balsamic-resinous with cinnamic and slightly vanilla character",
        "odor_type": "Balsamic / Sweet", "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "High", "tenacity_hours": "~150 hours",
        "ifra_guidelines": "Restricted — contains cinnamic acid derivatives",
        "usage_levels": "1–5 % in fragrance concentrate",
        "blends_well_with": ["Peru Balsam", "Benzoin", "Vanilla", "Styrax", "Labdanum", "Frankincense"],
        "fema_number": "",
    },
    "9000-72-0": {
        "names": ["benzoin resin", "gum benzoin"],
        "odor_description": "Sweet, warm, vanilla-balsamic with almond and slightly powdery notes",
        "odor_type": "Balsamic / Vanilla", "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "High", "tenacity_hours": "~100 hours",
        "ifra_guidelines": "No restriction for Siam benzoin; Sumatra may have limits",
        "usage_levels": "2–10 % in fragrance concentrate",
        "blends_well_with": ["Vanilla", "Styrax", "Peru Balsam", "Coumarin", "Sandalwood", "Rose"],
        "fema_number": "",
    },
    "68916-96-1": {
        "names": ["galbanum", "galbanum oil", "galbanum resin"],
        "odor_description": "Intensely green, sharp, leafy with earthy, balsamic and slightly musky facets",
        "odor_type": "Green / Herbal", "odor_strength": "High",
        "note_classification": "Top",
        "tenacity": "Moderate", "tenacity_hours": "~12 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "0.5–5 % in fragrance concentrate",
        "blends_well_with": ["Violet Leaf", "Hyacinth", "Rose", "Narcissus", "Frankincense", "Oakmoss"],
        "fema_number": "",
    },
}
_NAME_TO_CAS = {}
for _cas, _entry in PERFUMERY_DB.items():
    for _n in _entry["names"]:
        _NAME_TO_CAS[_n.lower().strip()] = _cas


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  HTTP
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def make_session():
    from requests.adapters import HTTPAdapter
    s = requests.Session()
    s.headers.update({
        "User-Agent": "PerfumeAnalyzer/8.0",
        "Accept": "application/json",
        "Connection": "keep-alive",
    })
    adapter = HTTPAdapter(pool_connections=5, pool_maxsize=10,
                          max_retries=1)
    s.mount("https://", adapter)
    return s


def _safe_get(session, url):
    try:
        r = session.get(url, timeout=TIMEOUT)
        if r.status_code == 200:
            return r.json()
    except Exception as exc:
        logger.warning("GET %s → %s", url, exc)
    return None


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Trade name → Chemical name mapping (perfumery industry)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TRADE_NAMES = {
    # ═══════ Iso E Super family ═══════
    "iso e super": "54464-57-2", "isoesuper": "54464-57-2",
    "iso-e-super": "54464-57-2", "molecule 01": "54464-57-2",
    "timbersilk": "54464-57-2", "isocyclemone e": "54464-57-2",
    "orbitone": "54464-57-2", "iso e": "54464-57-2",
    "boisvelone": "54464-57-2", "anthamber": "54464-57-2",
    "patchouli ethanone": "54464-57-2", "arborone": "54464-57-2",
    "ies": "54464-57-2",  # common abbreviation

    # ═══════ Hedione family ═══════
    "hedione": "24851-98-7", "methyl dihydrojasmonate": "24851-98-7",
    "hedione hc": "24851-98-7", "mdj": "24851-98-7",
    "kharismal": "24851-98-7", "jasmal": "24851-98-7",

    # ═══════ Galaxolide / Polycyclic musks ═══════
    "galaxolide": "1222-05-5", "abbalide": "1222-05-5",
    "musk 50": "1222-05-5", "galaxolide 50": "1222-05-5",
    "hhcb": "1222-05-5",  # abbreviation
    "tonalide": "21145-77-7", "ahtn": "21145-77-7",
    "fixolide": "21145-77-7",
    "phantolide": "15323-35-0", "ahdi": "15323-35-0",
    "traseolide": "68140-48-7", "atii": "68140-48-7",
    "cashmeran": "33704-61-9", "dp-45": "33704-61-9",
    "cashmere musk": "33704-61-9", "dpmi": "33704-61-9",

    # ═══════ Ambroxan / Amber ═══════
    "ambroxan": "6790-58-5", "ambrox": "6790-58-5",
    "ambrox dl": "6790-58-5", "ambrox super": "6790-58-5",
    "cetalox": "3738-00-9", "amberlyn": "6790-58-5",
    "ambrofix": "6790-58-5", "ambroxide": "6790-58-5",
    "ambergris": "6790-58-5",  # common search term
    "norlabdane oxide": "6790-58-5",
    "ambrinol": "6790-58-5",
    "cetalox laevo": "3738-00-9",
    "karanal": "103694-68-4", "amber xtreme": "103694-68-4",
    "amber ketal": "103694-68-4",
    "ambermax": "99610-64-7",
    "labdanum": "8016-26-0",  # natural resin

    # ═══════ Macrocyclic musks ═══════
    "muscone": "541-91-3", "l-muscone": "541-91-3",
    "musk ketone": "81-14-1", "mk": "81-14-1",
    "musk xylene": "81-15-2", "mx": "81-15-2",
    "musk ambrette": "83-66-9",
    "habanolide": "34902-57-3", "globalide": "34902-57-3",
    "exaltolide": "106-02-5", "thibetolide": "106-02-5",
    "ethylene brassylate": "105-95-3", "musk t": "105-95-3",
    "helvetolide": "141773-73-1",
    "romandolide": "236391-76-7",
    "cosmone": "542-46-1", "civetone": "542-46-1",
    "ambrettolide": "123-69-3",
    "nirvanolide": "909478-55-3",
    "sylkolide": "63187-91-7", "velvione": "63187-91-7",
    "muscenone": "63314-79-4",
    "exaltone": "502-72-7", "cyclopentadecanone": "502-72-7",

    # ═══════ Florals ═══════
    "paradisone": "68901-22-4",
    "phenylethyl alcohol": "60-12-8", "pea": "60-12-8",
    "phenethyl alcohol": "60-12-8", "2-phenylethanol": "60-12-8",
    "rose oxide": "16409-43-1", "rosenoxide": "16409-43-1",
    "damascone alpha": "43052-87-5", "alpha damascone": "43052-87-5",
    "damascone beta": "23726-91-2", "beta damascone": "23726-91-2",
    "damascone delta": "57378-68-4",
    "damascenone": "23696-85-7", "beta damascenone": "23696-85-7",
    "methyl ionone": "1335-46-2", "orris": "1335-46-2",
    "methyl ionone alpha": "127-42-4", "alpha isomethyl ionone": "127-51-5",
    "ionone alpha": "127-41-3", "alpha ionone": "127-41-3",
    "ionone beta": "14901-07-6", "beta ionone": "14901-07-6",
    "dihydro beta ionone": "17283-81-7",
    "floralozone": "67634-15-5", "ozone": "67634-15-5",
    "cyclamal": "103-95-7", "cyclamen aldehyde": "103-95-7",
    "lilial": "80-54-6", "butylphenyl methylpropional": "80-54-6",
    "lyral": "31906-04-4", "hydroxyisohexyl 3-cyclohexene carboxaldehyde": "31906-04-4",
    "hydroxycitronellal": "107-75-5", "muguet": "107-75-5",
    "bourgeonal": "18127-01-0",
    "helional": "1205-17-0",
    "heliotropin": "120-57-0", "piperonal": "120-57-0",
    "linalool oxide": "1365-19-1",
    "phenylacetaldehyde": "122-78-1", "hyacinth": "122-78-1",
    "indole": "120-72-9",  # jasmine note
    "methyl anthranilate": "134-20-3",  # orange blossom
    "nerolidol": "7212-44-4",
    "farnesol": "4602-84-0",
    "hexyl cinnamic aldehyde": "101-86-0", "hca": "101-86-0",
    "amyl cinnamic aldehyde": "122-40-7", "aca": "122-40-7",
    "jasmine lactone": "25524-95-2",
    "jasmonyl": "70-70-2",
    "methyl jasmonate": "1211-29-6",
    "jasmolactone": "18679-18-0",

    # ═══════ Woody ═══════
    "javanol": "198404-98-7", "ebanol": "67801-20-1",
    "santalol": "11031-45-1", "alpha santalol": "115-71-9",
    "beta santalol": "77-42-9",
    "sandalore": "65113-99-7", "sandalwood": "65113-99-7",
    "bacdanol": "28219-61-6", "polysantol": "107898-54-4",
    "hinoki": "19870-74-7", "hinokitiol": "499-44-5",
    "norlimbanol": "70788-30-6", "timberol": "70788-30-6",
    "firsantol": "104864-90-6",
    "vertofix": "32388-55-9", "vertofix coeur": "32388-55-9",
    "vetiver acetate": "62563-80-8",
    "vetiveryl acetate": "62563-80-8",
    "georgywood": "155517-73-0",
    "clearwood": "28631-86-9", "patchoulol": "5986-55-0",
    "patchouli": "5986-55-0",  # main component of patchouli oil
    "cedarwood": "8000-27-9",
    "cedrol": "77-53-2", "cedryl acetate": "77-54-3",
    "iso longifolanone": "23787-90-8",
    "guaiacol": "90-05-1",
    "guaiazulene": "489-84-9",
    "vetiverol": "89-88-3",
    "nootkatone": "4674-50-4",  # grapefruit woody
    "eudesmol": "473-15-4",
    "bisabolol": "515-69-5", "alpha bisabolol": "515-69-5",
    "cabreuva": "54344-82-0",
    "mysore sandalwood": "8006-87-9",

    # ═══════ Citrus / Fresh ═══════
    "dihydromyrcenol": "18479-58-8", "dhm": "18479-58-8",
    "calone": "28940-11-6", "watermelon ketone": "28940-11-6",
    "methyl pamplemousse": "89-80-5",
    "citral": "5392-40-5", "geranial": "141-27-5", "neral": "106-26-3",
    "citronellal": "106-23-0",
    "citronellol": "106-22-9", "rhodinol": "6812-78-8",
    "beta citronellol": "106-22-9",
    "linalool": "78-70-6", "linalol": "78-70-6",
    "beta linalool": "78-70-6", "beta-linalool": "78-70-6",
    "linalyl acetate": "115-95-7",
    "geraniol": "106-24-1", "trans-geraniol": "106-24-1",
    "geranyl acetate": "105-87-3",
    "nerol": "106-25-2",
    "neryl acetate": "141-12-8",
    "citronellyl acetate": "150-84-5",
    "limonene": "5989-27-5", "d-limonene": "5989-27-5",
    "r-limonene": "5989-27-5", "l-limonene": "5989-54-8",
    "orange terpenes": "5989-27-5",
    "bergamotene": "17699-05-7",
    "bergaptene": "484-20-8",
    "bergamot": "8007-75-8",  # bergamot essential oil
    "bergamot oil": "8007-75-8",
    "octanal": "124-13-0", "aldehyde c-8": "124-13-0",
    "nonanal": "124-19-6", "aldehyde c-9": "124-19-6",
    "decanal": "112-31-2", "aldehyde c-10": "112-31-2",
    "undecanal": "112-44-7", "aldehyde c-11": "112-44-7",
    "dodecanal": "112-54-9", "aldehyde c-12": "112-54-9",
    "undecylenic aldehyde": "112-45-8", "aldehyde c-11 moa": "112-45-8",
    "triplal": "68039-49-6",
    "undecavertol": "81782-77-6",
    "acetaldehyde phenylethyl": "103-45-7",

    # ═══════ Spicy ═══════
    "eugenol": "97-53-0", "isoeugenol": "97-54-1",
    "cinnamaldehyde": "104-55-2", "cinnamic aldehyde": "104-55-2",
    "cinnamon aldehyde": "104-55-2", "cinnamal": "104-55-2",
    "cinnamic alcohol": "104-54-1", "cinnamyl alcohol": "104-54-1",
    "methyl eugenol": "93-15-2",
    "safranal": "116-26-7", "saffron": "116-26-7",
    "methyl cinnamate": "103-26-4",
    "methyl chavicol": "140-67-0", "estragole": "140-67-0",
    "anisaldehyde": "123-11-5", "para anisaldehyde": "123-11-5",
    "anethole": "104-46-1", "trans anethole": "104-46-1",
    "clove oil": "8000-34-8",
    "cinnamon oil": "8015-91-6",
    "cardamom": "8000-66-6",

    # ═══════ Vanilla / Sweet / Balsamic ═══════
    "vanillin": "121-33-5", "vanilla": "121-33-5",
    "ethyl vanillin": "121-32-4", "ethylvanillin": "121-32-4",
    "coumarin": "91-64-5", "cumarin": "91-64-5",
    "tonka bean": "91-64-5",  # main component
    "benzoin": "579-44-2", "benzoin resin": "9000-72-0",
    "maltol": "118-71-8", "ethyl maltol": "4940-11-8",
    "furaneol": "3658-77-3",
    "benzyl alcohol": "100-51-6",
    "benzaldehyde": "100-52-7",  # almond note
    "anisyl alcohol": "105-13-5",
    "anisic aldehyde": "123-11-5",
    "methyl salicylate": "119-36-8",  # wintergreen
    "phenyl acetic acid": "103-82-2",
    "tolu balsam": "9000-64-0",
    "peru balsam": "8007-00-9",
    "styrax": "8024-01-9",

    # ═══════ Terpenes ═══════
    "terpineol": "98-55-5", "alpha terpineol": "98-55-5",
    "terpinolene": "586-62-9",
    "terpinen-4-ol": "562-74-3", "terpinen 4 ol": "562-74-3",
    "menthol": "89-78-1", "l-menthol": "2216-51-5",
    "menthone": "89-80-5", "isomenthone": "491-07-6",
    "camphor": "76-22-2", "borneol": "507-70-0",
    "isoborneol": "124-76-5", "bornyl acetate": "76-49-3",
    "carvone": "99-49-0", "l-carvone": "6485-40-1", "d-carvone": "2244-16-8",
    "thymol": "89-83-8", "carvacrol": "499-75-2",
    "pinene": "80-56-8", "alpha pinene": "80-56-8",
    "beta pinene": "127-91-3",
    "myrcene": "123-35-3", "beta myrcene": "123-35-3",
    "ocimene": "13877-91-3", "beta ocimene": "3338-55-4",
    "camphene": "79-92-5",
    "fenchol": "1632-73-1", "fenchone": "1195-79-5",
    "eucalyptol": "470-82-6", "1,8-cineole": "470-82-6", "cineole": "470-82-6",
    "sabinene": "3387-41-5",
    "phellandrene": "99-83-2", "alpha phellandrene": "99-83-2",

    # ═══════ Solvents / Fixatives / Carriers ═══════
    "benzyl benzoate": "120-51-4", "bb": "120-51-4",
    "benzyl salicylate": "118-58-1",
    "benzyl acetate": "140-11-4",
    "dipropylene glycol": "25265-71-8", "dpg": "25265-71-8",
    "isopropyl myristate": "110-27-0", "ipm": "110-27-0",
    "triethyl citrate": "77-93-0", "tec": "77-93-0",
    "deet": "134-62-3",
    "diethyl phthalate": "84-66-2", "dep": "84-66-2",
    "isododecane": "31807-55-3",
    "propylene glycol": "57-55-6", "pg": "57-55-6",
    "triacetin": "102-76-1",
    "mct oil": "73398-61-5",
    "squalane": "111-01-3",

    # ═══════ Green / Herbal ═══════
    "cis-3-hexenol": "928-96-1", "leaf alcohol": "928-96-1",
    "cis-3-hexenyl acetate": "3681-71-8",
    "galbanum": "68916-96-1",
    "stemone": "62015-37-6",
    "violet leaf": "8024-08-6",
    "2,6-nonadienal": "17587-33-6",  # cucumber
    "hexyl acetate": "142-92-7",

    # ═══════ Esters / Acetates ═══════
    "phenylethyl acetate": "103-45-7",
    "hexyl salicylate": "6259-76-3",
    "methyl benzoate": "93-58-3",
    "ethyl acetate": "141-78-6",
    "amyl acetate": "628-63-7",
    "isoamyl acetate": "123-92-2",  # banana
    "methyl 2-octynoate": "111-12-6",  # violet leaf
    "allyl caproate": "123-68-2",  # pineapple
    "gamma decalactone": "706-14-9",  # peach
    "gamma undecalactone": "104-67-6",  # peach/coconut
    "gamma nonalactone": "104-61-0",  # coconut
    "delta decalactone": "705-86-2",  # creamy
    "coumarin lactone": "91-64-5",

    # ═══════ Phenols / Leather ═══════
    "birch tar": "8001-88-5",
    "cade oil": "8013-10-3",
    "castoreum": "8023-83-4",
    "skatole": "83-34-1",
    "para cresol": "106-44-5", "p-cresol": "106-44-5",
    "isobutyl quinoline": "65442-31-1", "ibq": "65442-31-1",
    "suederal": "67634-20-2",
    "safraleine": "54440-17-4",
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Smart Search Engine
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _normalize(name):
    """Normalize input: lowercase, strip, remove noise, fix common patterns."""
    s = name.lower().strip()
    s = re.sub(r'[®™©\u200b\u00ad]', '', s)  # remove special chars
    s = re.sub(r'\s+', ' ', s)                 # collapse whitespace
    s = re.sub(r'[_]', ' ', s)                 # underscore → space
    # Greek letters
    s = s.replace('α', 'alpha').replace('β', 'beta')
    s = s.replace('γ', 'gamma').replace('δ', 'delta')
    return s.strip()


def _generate_variants(name):
    """Generate search variants — handles typos, spacing, prefixes, suffixes."""
    n = _normalize(name)
    variants = [n]

    # With/without hyphens and spaces
    variants.append(n.replace("-", " "))
    variants.append(n.replace(" ", "-"))
    variants.append(n.replace(" ", ""))

    # With/without common prefixes
    prefixes = ["dl-", "d-", "l-", "r-", "s-", "n-",
                "alpha-", "beta-", "gamma-", "delta-",
                "alpha ", "beta ", "gamma ", "delta ",
                "(+)-", "(-)-", "(r)-", "(s)-", "(±)-",
                "cis-", "trans-", "para-", "ortho-", "meta-",
                "iso", "nor"]
    for prefix in prefixes:
        if n.startswith(prefix):
            variants.append(n[len(prefix):].strip())
        elif len(prefix) <= 2 or prefix.endswith("-") or prefix.endswith(" "):
            variants.append(prefix + n)

    # Common suffixes: remove or add
    for suffix in [" oil", " absolute", " concrete", " extract",
                   " oxide", " acetate", " alcohol"]:
        if n.endswith(suffix):
            variants.append(n[:-len(suffix)].strip())
        else:
            variants.append(n + suffix)

    # Common perfumery misspellings
    typo_pairs = [
        ("oo", "o"), ("o", "oo"),
        ("ph", "f"), ("f", "ph"),
        ("y", "i"), ("i", "y"),
        ("ae", "e"), ("e", "ae"),
        ("ck", "k"), ("k", "ck"),
        ("cs", "x"), ("x", "cs"),
        ("ll", "l"), ("l", "ll"),
        ("nn", "n"), ("n", "nn"),
        ("ss", "s"), ("s", "ss"),
        ("th", "t"), ("t", "th"),
        ("yl", "il"), ("il", "yl"),
        ("ene", "ine"), ("ine", "ene"),
        ("ol", "ole"), ("ole", "ol"),
        ("al", "ale"), ("ale", "al"),
        ("one", "on"), ("on", "one"),
    ]
    for old, new in typo_pairs:
        if old in n:
            variants.append(n.replace(old, new, 1))

    # Remove parentheses: "linalool (natural)" → "linalool"
    stripped = re.sub(r'\s*\(.*?\)\s*', '', n).strip()
    if stripped and stripped != n:
        variants.append(stripped)

    # Remove brand names
    brands = ["iff", "firmenich", "givaudan", "symrise", "takasago",
              "kao", "mane", "robertet", "drt", "pcw",
              "ipc", "natural", "synthetic", "pure", "extra",
              "grade", "bp", "fcc", "usp", "kosher"]
    for brand in brands:
        cleaned = re.sub(rf'\b{brand}\b', '', n).strip()
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        if cleaned and cleaned != n:
            variants.append(cleaned)

    # Number cleanup: "c10" → "c-10", "c 10" → "c-10"
    variants.append(re.sub(r'(\D)(\d)', r'\1-\2', n))
    variants.append(re.sub(r'(\D)-(\d)', r'\1\2', n))

    # Deduplicate
    seen = set()
    unique = []
    for v in variants:
        v = v.strip()
        if v and v not in seen:
            seen.add(v)
            unique.append(v)
    return unique


def _fuzzy_match_tradenames(name):
    """
    Fuzzy match against TRADE_NAMES dict.
    Returns CAS if found, None otherwise.
    """
    n = _normalize(name)

    # 1. Exact match
    if n in TRADE_NAMES:
        return TRADE_NAMES[n]

    # 2. Try all variants
    for variant in _generate_variants(name):
        if variant in TRADE_NAMES:
            return TRADE_NAMES[variant]

    # 3. Substring match: "iso e" should find "iso e super"
    #    But "patchouli" should NOT match "patchouli ethanone" (= Iso E Super)
    #    Rule: query must match start of trade name, or be a distinct word prefix
    if len(n) >= 4:
        for trade_name, cas in TRADE_NAMES.items():
            # Query is start of trade name: "iso e" → "iso e super" ✅
            if trade_name.startswith(n + " ") or trade_name.startswith(n + "-"):
                return cas
            # Trade name is start of query: "cinnamon oil extra" → "cinnamon oil" ✅
            if n.startswith(trade_name + " ") or n.startswith(trade_name + "-"):
                return cas

    # 4. Fuzzy: similarity matching for typos
    if len(n) >= 5:
        best_score = 0
        best_cas = None
        for trade_name, cas in TRADE_NAMES.items():
            score = _similarity(n, trade_name)
            # Require high similarity AND similar length (prevent partial matches)
            len_ratio = min(len(n), len(trade_name)) / max(len(n), len(trade_name))
            if score > best_score and score > 0.85 and len_ratio > 0.7:
                best_score = score
                best_cas = cas
        if best_cas:
            return best_cas

    return None


def _similarity(a, b):
    """Simple similarity ratio (0-1) based on longest common subsequence."""
    if not a or not b:
        return 0
    m, n = len(a), len(b)
    if m > 50 or n > 50:  # skip very long strings
        return 0
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i-1] == b[j-1]:
                dp[i][j] = dp[i-1][j-1] + 1
            else:
                dp[i][j] = max(dp[i-1][j], dp[i][j-1])
    lcs = dp[m][n]
    return (2.0 * lcs) / (m + n)


def _is_cas(text):
    """Check if input looks like a CAS number."""
    return bool(re.match(r"^\d{2,7}-\d{2}-\d$", text.strip()))


def _is_smiles(text):
    """Check if input looks like a SMILES string."""
    t = text.strip()
    if len(t) < 3:
        return False
    smiles_chars = set("CNOSPFIBrcnos=()[]#+-/.@\\12345678%")
    return len(t) > 5 and sum(1 for c in t if c in smiles_chars) / len(t) > 0.7


def _is_inchi(text):
    """Check if input looks like an InChI string."""
    return text.strip().startswith("InChI=")


def _smart_search_cid(session, name):
    """
    Multi-strategy search pipeline (like Google):
    1. Detect CAS / SMILES / InChI → direct lookup
    2. Try exact name on PubChem
    3. Try trade name mapping → CAS → PubChem
    4. Try all generated variants on PubChem
    5. Try PubChem autocomplete API
    Returns (cid, resolved_name) or (None, None)
    """
    original = name.strip()
    n = _normalize(original)

    # ── Strategy 1: Direct CAS lookup ──
    if _is_cas(original):
        logger.info("  → CAS detected: %s", original)
        cid = _get_cid(session, original)
        if cid:
            return cid, original

    # ── Strategy 2: Direct SMILES lookup ──
    if _is_smiles(original):
        logger.info("  → SMILES detected")
        url = f"{PUBCHEM_REST}/compound/smiles/cids/JSON?smiles={requests.utils.quote(original)}"
        data = _safe_get(session, url)
        if data:
            cids = data.get("IdentifierList", {}).get("CID", [])
            if cids:
                return cids[0], original

    # ── Strategy 3: Direct InChI lookup ──
    if _is_inchi(original):
        logger.info("  → InChI detected")
        try:
            r = session.post(
                f"{PUBCHEM_REST}/compound/inchi/cids/JSON",
                data={"inchi": original}, timeout=TIMEOUT
            )
            if r.status_code == 200:
                data = r.json()
                cids = data.get("IdentifierList", {}).get("CID", [])
                if cids:
                    return cids[0], original
        except Exception:
            pass

    # ── Strategy 4: Trade name → CAS → PubChem (BEFORE PubChem name) ──
    trade_cas = _fuzzy_match_tradenames(original)
    if trade_cas:
        logger.info("  → Trade name match → CAS %s", trade_cas)
        is_mixture_cas = bool(re.match(r"^8\d{3}-\d{2}-\d$", trade_cas) or re.match(r"^9\d{3}-\d{2}-\d$", trade_cas))
        cid = _get_cid(session, trade_cas)
        if cid:
            return cid, trade_cas
        # Mixture CAS → go straight to MIXTURE marker (don't try SID→CID, it returns wrong compounds)
        if is_mixture_cas:
            logger.info("  → Mixture CAS %s → MIXTURE marker", trade_cas)
            return "MIXTURE", trade_cas
        # Non-mixture CAS: try SID→CID as fallback
        sid_cid, sid = _get_cid_via_substance(session, trade_cas)
        if sid_cid:
            logger.info("  → Trade CAS %s found via SID %s → CID %s", trade_cas, sid, sid_cid)
            return sid_cid, trade_cas
        # Still not found — continue to other strategies
        logger.info("  → CAS %s not found, trying other strategies", trade_cas)

    # ── Strategy 5: Exact name on PubChem Compound DB ──
    logger.info("  → Trying exact name (Compound DB): %s", original)
    cid = _get_cid(session, original)
    if cid:
        return cid, original

    # ── Strategy 6: PubChem Substance DB (SID → CID) ──
    # Substance DB has depositor-supplied trade names that Compound DB misses
    logger.info("  → Trying Substance DB (SID→CID): %s", original)
    sid_cid, sid = _get_cid_via_substance(session, original)
    if sid_cid:
        logger.info("  → Substance DB found: CID %s via SID %s", sid_cid, sid)
        return sid_cid, original

    # ── Strategy 7: Try top 3 generated variants ──
    variants = _generate_variants(original)
    for variant in variants[1:4]:  # max 3 tries
        logger.info("  → Trying variant: %s", variant)
        cid = _get_cid(session, variant)
        if cid:
            return cid, variant

    # ── Strategy 8: PubChem autocomplete + verify ──
    logger.info("  → Trying PubChem autocomplete")
    auto_url = (f"https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound/{requests.utils.quote(n)}/JSON?limit=3")
    data = _safe_get(session, auto_url)
    if data:
        suggestions = data.get("dictionary_terms", {}).get("compound", [])
        for suggestion in suggestions[:3]:
            cid = _get_cid(session, suggestion)
            if cid:
                # Verify the autocomplete suggestion actually matches
                if _verify_cid_matches(session, cid, original):
                    logger.info("  → Autocomplete verified: %s", suggestion)
                    return cid, suggestion
                else:
                    logger.info("  → Autocomplete '%s' didn't match '%s', skipping", suggestion, original)

    # ── Strategy 9: Perfumery DB fuzzy ──
    fuzzy_result = _fuzzy_lookup_perfumery(original)
    if fuzzy_result:
        cas, _ = fuzzy_result
        logger.info("  → Fuzzy perfumery DB match → CAS %s", cas)
        cid = _get_cid(session, cas)
        if cid:
            return cid, cas

    return None, None


def _suggest_similar(name):
    """Generate suggestions for failed searches."""
    n = _normalize(name)
    suggestions = []

    # Find close trade names
    for trade_name in TRADE_NAMES:
        score = _similarity(n, trade_name)
        if score > 0.5:
            suggestions.append((score, trade_name))

    # Find close perfumery DB names
    for cas, entry in PERFUMERY_DB.items():
        for db_name in entry["names"]:
            score = _similarity(n, db_name)
            if score > 0.5:
                suggestions.append((score, db_name))

    suggestions.sort(key=lambda x: x[0], reverse=True)
    return [s[1] for s in suggestions[:5]]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  PubChem API helpers
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _get_cid(session, name):
    """Strategy A: PubChem Compound DB — name → CID"""
    url = f"{PUBCHEM_REST}/compound/name/{requests.utils.quote(name)}/cids/JSON"
    data = _safe_get(session, url)
    if data:
        cids = data.get("IdentifierList", {}).get("CID", [])
        return cids[0] if cids else None
    return None


def _get_cid_via_substance(session, name):
    """Strategy B: PubChem Substance DB — name → SID → CID.
    Substance DB has depositor-supplied names (trade names, supplier codes)
    that Compound DB may not index. Returns (cid, sid) or (None, None)."""
    url = (f"{PUBCHEM_REST}/substance/name/{requests.utils.quote(name)}"
           f"/cids/JSON?cids_type=standardized")
    data = _safe_get(session, url)
    if data:
        info_list = data.get("InformationList", {}).get("Information", [])
        for info in info_list:
            cids = info.get("CID", [])
            sid = info.get("SID", None)
            if cids:
                return cids[0], sid
    return None, None


def _get_sids_by_cas(session, cas):
    """Get SIDs for a CAS number from PubChem Substance DB.
    Returns list of (sid, source_name) tuples."""
    url = (f"{PUBCHEM_REST}/substance/name/{requests.utils.quote(cas)}"
           f"/sids/JSON")
    data = _safe_get(session, url)
    if data:
        info_list = data.get("InformationList", {}).get("Information", [])
        sids = []
        for info in info_list:
            sid_list = info.get("SID", [])
            if isinstance(sid_list, list):
                sids.extend(sid_list)
            elif sid_list:
                sids.append(sid_list)
        return sids[:5]  # limit to first 5
    return []


def _get_substance_pugview(session, sid):
    """Fetch PUG View data for a substance (SID).
    Returns OrderedDict of section → items, similar to compound PUG View."""
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/substance/{sid}/JSON"
    sections_data = OrderedDict()
    try:
        r = session.get(url, timeout=TIMEOUT)
        if r.status_code != 200:
            return sections_data
        blob = r.json()
        top_sections = blob.get("Record", {}).get("Section", [])
        _walk_sections(top_sections, sections_data)
    except Exception as exc:
        logger.warning("PUG View SID %s → %s", sid, exc)
    return sections_data


def _verify_cid_matches(session, cid, search_name):
    """Verify that a CID actually corresponds to the search name.
    Checks synonyms for the CID — if search name appears, it's a match.
    Returns True if verified, False if suspicious mismatch."""
    if not cid or not search_name:
        return True  # can't verify, assume OK
    n = search_name.lower().strip()
    if len(n) < 3:
        return True
    # CAS numbers always match
    if re.match(r"^\d+-\d+-\d$", n):
        return True
    syns = _get_synonyms(session, cid, limit=50)
    for syn in syns:
        sl = syn.lower().strip()
        if n == sl or n in sl or sl in n:
            return True
    # Not found in synonyms — might be wrong compound
    logger.warning("CID %s synonyms don't contain '%s'", cid, search_name)
    return False


def _get_properties(session, cid):
    flds = ("MolecularFormula,MolecularWeight,CanonicalSMILES,IsomericSMILES,"
            "IUPACName,XLogP,InChI,InChIKey,ExactMass,MonoisotopicMass,"
            "TPSA,Complexity,Charge,HBondDonorCount,HBondAcceptorCount,"
            "RotatableBondCount,HeavyAtomCount,IsotopeAtomCount,"
            "AtomStereoCount,DefinedAtomStereoCount,UndefinedAtomStereoCount,"
            "BondStereoCount,DefinedBondStereoCount,UndefinedBondStereoCount,"
            "CovalentUnitCount")
    url = f"{PUBCHEM_REST}/compound/cid/{cid}/property/{flds}/JSON"
    data = _safe_get(session, url)
    if data:
        rows = data.get("PropertyTable", {}).get("Properties", [])
        return rows[0] if rows else {}
    return {}


def _get_synonyms(session, cid, limit=25):
    url = f"{PUBCHEM_REST}/compound/cid/{cid}/synonyms/JSON"
    data = _safe_get(session, url)
    if data:
        info = data.get("InformationList", {}).get("Information", [])
        if info:
            return info[0].get("Synonym", [])[:limit]
    return []


def _extract_cas(synonyms):
    pat = re.compile(r"^\d{2,7}-\d{2}-\d$")
    for s in synonyms:
        if pat.match(s.strip()):
            return s.strip()
    return ""


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  PUG View — extract ALL sections
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Sections to skip (noise, metadata, or non-useful)
_SKIP_HEADINGS = {
    "information sources",
    "removed synonyms",
    "structures",               # "2D Structure: Yes" — useless
    "chemical vendors",         # just "Yes"
    "depositor-supplied patent identifiers",
    "wipo patentscope",
    "chemical co-occurrences in patents",
    "chemical-disease co-occurrences in patents",
    "chemical-gene co-occurrences in patents",
    "chemical-organism co-occurrences in patents",
    "chemical co-occurrences in literature",
    "chemical-gene co-occurrences in literature",
    "chemical-disease co-occurrences in literature",
    "chemical-organism co-occurrences in literature",
    "related compounds",        # just counts
    "related substances",       # just counts
    "substances by category",   # just category names
    "entrez crosslinks",        # just counts
    "pubchem reference collection sid",
    "nlm curated pubmed citations",
    "ongoing test status",
    "depositor-supplied synonyms",  # already in synonyms field
}

# Content patterns to filter out (noise items)
_NOISE_PATTERNS = [
    r"^Yes$",                              # bare boolean
    r"^No$",
    r"^HID:\s*\d+$",                       # classification IDs
    r"^Co-Occurrence Panel:",              # metadata templates
    r"^Link to all",                        # action text
    r"^Follow these links",                 # instruction text
    r"^View in PubChem",                    # action text
    r"^Same \w+ Count:",                    # relation counts
    r"^All Count:",
    r"^Mixture Count:",
    r"^\d+$",                              # bare numbers (CIDs, counts)
    r"^Patents are available",             # placeholder text
    r"^This section is deprecated",
]
_NOISE_RE = [re.compile(p, re.IGNORECASE) for p in _NOISE_PATTERNS]

# Generous limits to capture everything
_MAX_ITEMS_PER_SECTION = 50   # was 25 — some safety/toxicity sections have 30+ items
_MAX_CHARS_PER_ITEM = 1500


def _is_noise(text):
    """Check if text is noise/junk that should be filtered out."""
    t = text.strip()
    if len(t) < 2:
        return True
    for pat in _NOISE_RE:
        if pat.search(t):
            return True
    return False


def _extract_string_value(info_block):
    """Pull text from a PUG View Information block — handle ALL value types.
    Strips any embedded URLs — we only want data content."""
    val = info_block.get("Value", {})

    # String values (may have multiple)
    strs = val.get("StringWithMarkup", [])
    if strs:
        parts = [s.get("String", "") for s in strs if s.get("String")]
        text = "; ".join(parts) if parts else ""
        text = re.sub(r'https?://\S+', '', text)
        text = re.sub(r'\s{2,}', ' ', text).strip()
        return text

    # Numeric values
    nums = val.get("Number", [])
    if nums:
        unit = val.get("Unit", "")
        return f"{nums[0]} {unit}".strip()

    # Boolean
    bval = val.get("Boolean", None)
    if bval is not None:
        return "Yes" if bval else "No"

    # Table values (used by some computed property sections)
    table = val.get("Table", {})
    if table:
        rows = table.get("Row", [])
        cols = table.get("Column", [])
        if rows and cols:
            parts = []
            col_names = [c.get("Name", "") for c in cols]
            for row in rows[:10]:  # limit table rows
                cells = row.get("Cell", [])
                row_parts = []
                for i, cell in enumerate(cells):
                    cv = cell.get("Value", "")
                    if isinstance(cv, dict):
                        sv = cv.get("StringWithMarkup", [])
                        if sv:
                            cv = sv[0].get("String", "")
                        else:
                            cv = str(cv.get("Number", [""])[0]) if cv.get("Number") else ""
                    if cv and str(cv).strip():
                        label = col_names[i] if i < len(col_names) else ""
                        if label:
                            row_parts.append(f"{label}: {cv}")
                        else:
                            row_parts.append(str(cv))
                if row_parts:
                    parts.append("; ".join(row_parts))
            return "\n".join(parts) if parts else ""

    # ExternalTableURL — reference link (skip)
    # Binary — images/3D (skip, not text-representable)
    return ""


def _walk_sections(sections, result, parent_path="", depth=0):
    """
    Recursively walk the ENTIRE PUG View section tree.
    Collects heading → list of text values into result (OrderedDict).
    No depth limit — walks everything.
    """
    if depth > 10 or not sections:
        return

    for sec in sections:
        heading = sec.get("TOCHeading", "")
        if not heading or heading.lower() in _SKIP_HEADINGS:
            continue

        # Build a display path like "Safety and Hazards > GHS Classification"
        full_path = f"{parent_path} > {heading}" if parent_path else heading

        # Extract information from this section
        infos = sec.get("Information", [])
        texts = []
        for info in infos:
            name = info.get("Name", "")
            text = _extract_string_value(info)
            if text and not _is_noise(text):
                if len(text) > _MAX_CHARS_PER_ITEM:
                    text = text[:_MAX_CHARS_PER_ITEM] + "…"
                if name and name != heading:
                    entry = f"{name}: {text}"
                else:
                    entry = text
                if not _is_noise(entry):
                    texts.append(entry)
            elif text and _is_noise(text):
                # Rescue bare numbers in identifier sections (FEMA, JECFA, etc.)
                hl = heading.lower()
                if re.match(r"^\d+$", text.strip()) and any(
                    kw in hl for kw in ["fema", "jecfa", "aids", "nsc", "number", "id"]
                ):
                    entry = f"{name}: {text}" if name and name != heading else text
                    texts.append(entry)

        if texts:
            # Deduplicate while preserving order
            seen = set()
            unique = []
            for t in texts:
                if t not in seen:
                    seen.add(t)
                    unique.append(t)
            result[full_path] = unique[:_MAX_ITEMS_PER_SECTION]

        # Recurse into subsections
        _walk_sections(sec.get("Section", []), result, full_path, depth + 1)


def _get_all_pugview(session, cid):
    """
    Fetch the FULL PUG View JSON and extract all sections.
    Returns OrderedDict of heading_path → list of string values,
    plus a flat dict of known property fields.
    """
    url = f"{PUBCHEM_VIEW}/{cid}/JSON"
    sections_data = OrderedDict()
    known = {}

    try:
        r = session.get(url, timeout=TIMEOUT)
        if r.status_code != 200:
            return sections_data, known
        blob = r.json()
    except Exception as exc:
        logger.warning("PUG View CID %s → %s", cid, exc)
        return sections_data, known

    top_sections = blob.get("Record", {}).get("Section", [])
    _walk_sections(top_sections, sections_data)

    # Also extract known fields from the structured data for backward compat
    _MAP = {
        "boiling point": "boiling_point",
        "flash point": "flash_point",
        "melting point": "melting_point",
        "vapor pressure": "vapor_pressure",
        "solubility": "solubility",
        "density": "density",
        "physical description": "appearance",
        "color/form": "appearance",
        "color": "color",
        "refractive index": "refractive_index",
    }

    def _scan(secs):
        for sec in (secs or []):
            h = sec.get("TOCHeading", "").lower()
            for pattern, key in _MAP.items():
                if pattern in h and key not in known:
                    for info in sec.get("Information", []):
                        text = _extract_string_value(info)
                        if text:
                            known[key] = text
                            break
            _scan(sec.get("Section", []))

    _scan(top_sections)
    return sections_data, known


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Perfumery lookup — strict CAS match
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _lookup_by_cas(cas):
    return PERFUMERY_DB.get(cas) if cas else None

def _lookup_by_name(name):
    key = name.lower().strip()
    if len(key) < 3:
        return None
    if key in _NAME_TO_CAS:
        cas = _NAME_TO_CAS[key]
        return cas, PERFUMERY_DB[cas]
    return None

def _fuzzy_lookup_perfumery(name):
    """Fuzzy match against perfumery DB names."""
    n = _normalize(name)
    if len(n) < 4:
        return None

    # Try variants
    for variant in _generate_variants(name):
        if variant in _NAME_TO_CAS:
            cas = _NAME_TO_CAS[variant]
            return cas, PERFUMERY_DB[cas]

    # Fuzzy similarity
    best_score = 0
    best_result = None
    for cas, entry in PERFUMERY_DB.items():
        for db_name in entry["names"]:
            score = _similarity(n, db_name)
            if score > best_score and score > 0.8:
                best_score = score
                best_result = (cas, entry)
    return best_result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Main function
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def scrape_material(name, session=None):
    mat = MaterialData(name=name)
    if session is None:
        session = make_session()

    known = _lookup_by_name(name)
    known_cas = known[0] if known else None

    # ── Smart Search ──
    logger.info("Searching: %s", name)
    cid = None
    resolved_name = None

    # First: known CAS from perfumery DB
    if known_cas:
        cid = _get_cid(session, known_cas)
        if cid:
            resolved_name = known_cas

    # Second: smart multi-strategy search
    if cid is None:
        cid, resolved_name = _smart_search_cid(session, name)

    if cid == "MIXTURE":
        # Known trade name with correct CAS, but PubChem has no compound (CID)
        # Try Substance DB (SID) — PubChem may have substance records for mixtures
        mat.found = True
        mat.cas_number = resolved_name  # resolved_name holds the CAS
        mat.match_info = f"ℹ️ Natural mixture (CAS {resolved_name}) — not a single compound in PubChem"

        # ── Try PubChem Substance DB for mixture data ──
        sids = _get_sids_by_cas(session, resolved_name)
        if sids:
            sid = sids[0]
            mat.pubchem_sid = str(sid)
            mat.page_url = f"https://pubchem.ncbi.nlm.nih.gov/substance/{sid}"
            # Fetch substance PUG View
            sid_sections = _get_substance_pugview(session, sid)
            if sid_sections:
                mat.pubchem_sections = sid_sections
                mat.match_info = f"ℹ️ Natural mixture (CAS {resolved_name}) — PubChem SID {sid}"
                # Extract synonyms from substance data
                for k, items in sid_sections.items():
                    if "synonym" in k.lower() and items:
                        mat.synonyms = [s for s in items if not re.match(r"^\d+-\d+-\d$", s)][:20]
                        break
                # Extract any description
                for k, items in sid_sections.items():
                    kl = k.lower()
                    if ("description" in kl or "record description" in kl) and items:
                        mat.iupac_name = items[0][:200]
                        break

        # Try perfumery overlay (our DB)
        pdb = _lookup_by_cas(resolved_name)
        if pdb:
            mat.perfumery_matched = True
            mat.match_info = f"✅ CAS match ({resolved_name}) — natural mixture" + (f" (SID {sids[0]})" if sids else "")
            if pdb.get("odor_description"): mat.odor_description = pdb["odor_description"]
            if pdb.get("odor_type"): mat.odor_type = pdb["odor_type"]
            if pdb.get("odor_strength"): mat.odor_strength = pdb["odor_strength"]
            if pdb.get("note_classification"): mat.note_classification = pdb["note_classification"]
            if pdb.get("tenacity"): mat.tenacity = pdb["tenacity"]
            if pdb.get("tenacity_hours"): mat.tenacity_hours = pdb["tenacity_hours"]
            if pdb.get("ifra_guidelines"): mat.ifra_guidelines = pdb["ifra_guidelines"]
            if pdb.get("usage_levels"): mat.usage_levels = pdb["usage_levels"]
            if pdb.get("blends_well_with"): mat.blends_well_with = pdb["blends_well_with"]
            if pdb.get("fema_number"): mat.fema_number = pdb["fema_number"]
        return mat

    if cid is None:
        suggestions = _suggest_similar(name)
        hint = ""
        if suggestions:
            hint = "\n\nDid you mean: " + ", ".join(suggestions) + "?"
        mat.error = f"'{name}' not found.{hint}"
        return mat

    mat.found = True
    mat.page_url = f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}"
    mat.structure_image_url = (
        f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/record/PNG"
        f"?image_size=300x300"
    )

    # ═══════════════════════════════════════════════════
    #  Single source: PUG View JSON ("display page data")
    #  — contains everything: identifiers, properties,
    #    physical data, safety, spectral, etc.
    # ═══════════════════════════════════════════════════
    pugview_sections, phys_known = _get_all_pugview(session, cid)
    mat.pubchem_sections = pugview_sections

    # ── Extract identifiers from PUG View sections ──
    def _find_first(sections, key_fragment, default=""):
        """Find first value from section key containing fragment."""
        kl = key_fragment.lower()
        for k, items in sections.items():
            if kl in k.lower() and items:
                return items[0].split(": ", 1)[-1] if ": " in items[0] else items[0]
        return default

    def _find_all(sections, key_fragment):
        """Find all values from section key containing fragment."""
        kl = key_fragment.lower()
        for k, items in sections.items():
            if kl in k.lower() and items:
                return items
        return []

    # SMILES
    mat.smiles = ""
    for k, items in pugview_sections.items():
        if "smiles" in k.lower() and "canonical" not in k.lower():
            # Prefer Computed Descriptors > SMILES
            pass
        if "computed descriptors" in k.lower() and "smiles" in k.lower():
            for item in items:
                s = item.strip()
                if len(s) > 2 and not s.startswith("http"):
                    mat.smiles = s
                    break
    if not mat.smiles:
        for k, items in pugview_sections.items():
            if "smiles" in k.lower():
                for item in items:
                    s = item.strip()
                    if len(s) > 2 and not s.startswith("http") and not s.startswith("Canonical"):
                        mat.smiles = s
                        break
                if mat.smiles:
                    break

    # IUPAC Name
    mat.iupac_name = ""
    for k, items in pugview_sections.items():
        if "iupac name" in k.lower() and items:
            mat.iupac_name = items[0].strip()
            break

    # InChI
    mat.inchi = ""
    for k, items in pugview_sections.items():
        if "inchi" in k.lower() and "inchikey" not in k.lower() and items:
            for item in items:
                if item.strip().startswith("InChI="):
                    mat.inchi = item.strip()
                    break
            if mat.inchi:
                break

    # Molecular Formula
    mat.molecular_formula = ""
    for k, items in pugview_sections.items():
        if "molecular formula" in k.lower() and items:
            mat.molecular_formula = items[0].strip()
            break

    # Molecular Weight
    mat.molecular_weight = ""
    for k, items in pugview_sections.items():
        if "molecular weight" in k.lower() and items:
            val = items[0].strip()
            # Remove "Molecular Weight: " prefix if present
            if ": " in val:
                val = val.split(": ", 1)[-1]
            mat.molecular_weight = val
            break

    # XLogP
    mat.logp = ""
    for k, items in pugview_sections.items():
        if "xlogp" in k.lower() and items:
            val = items[0].strip()
            if ":" in val:
                val = val.split(":")[-1].strip()
            mat.logp = val
            break

    # CAS & Synonyms — from PUG View + fallback to PUG REST
    mat.cas_number = ""
    for k, items in pugview_sections.items():
        if k.lower().endswith("> cas") or k.lower() == "cas":
            for item in items:
                s = item.strip()
                if re.match(r"^\d{2,7}-\d{2}-\d$", s):
                    mat.cas_number = s
                    break
            if mat.cas_number:
                break

    # Synonyms: try PUG REST (more complete) — single small API call
    syns = _get_synonyms(session, cid)
    if not mat.cas_number:
        mat.cas_number = _extract_cas(syns)
    mat.synonyms = [s for s in syns if not re.match(r"^\d+-\d+-\d$", s)][:20]

    # FEMA Number — from PUG View sections
    mat.fema_number = ""
    for k, items in pugview_sections.items():
        if "fema number" in k.lower() and items:
            for item in items:
                val = item.strip()
                if ": " in val:
                    val = val.split(": ", 1)[-1]
                digits = re.search(r"\d{3,5}", val)
                if digits:
                    mat.fema_number = digits.group()
                    break
            if mat.fema_number:
                break
    # Fallback: check synonyms for FEMA
    if not mat.fema_number:
        for s in syns:
            m = re.match(r"FEMA\s*(?:No\.?\s*)?(\d{3,5})", s, re.IGNORECASE)
            if m:
                mat.fema_number = m.group(1)
                break

    # Populate known fields
    mat.boiling_point = phys_known.get("boiling_point", "")
    mat.flash_point = phys_known.get("flash_point", "")
    mat.melting_point = phys_known.get("melting_point", "")
    mat.vapor_pressure = phys_known.get("vapor_pressure", "")
    mat.solubility = phys_known.get("solubility", "")
    mat.density = phys_known.get("density", "")
    mat.refractive_index = phys_known.get("refractive_index", "")
    mat.appearance = phys_known.get("appearance", "") or phys_known.get("color", "")

    # Perfumery overlay — CAS validated
    pdb = None
    info = ""
    if mat.cas_number:
        pdb = _lookup_by_cas(mat.cas_number)
        if pdb:
            info = f"✅ CAS match ({mat.cas_number})"
    if pdb is None and known:
        expected_cas, candidate = known
        if mat.cas_number == expected_cas:
            pdb = candidate
            info = f"✅ Name→CAS verified ({expected_cas})"
        elif mat.cas_number:
            info = f"⚠️ CAS mismatch (expected {expected_cas}, got {mat.cas_number})"

    if pdb:
        mat.perfumery_matched = True
        mat.odor_description = pdb.get("odor_description", "")
        mat.odor_type = pdb.get("odor_type", "")
        mat.odor_strength = pdb.get("odor_strength", "")
        mat.note_classification = pdb.get("note_classification", "")
        mat.tenacity = pdb.get("tenacity", "")
        mat.tenacity_hours = pdb.get("tenacity_hours", "")
        mat.ifra_guidelines = pdb.get("ifra_guidelines", "")
        mat.usage_levels = pdb.get("usage_levels", "")
        mat.blends_well_with = pdb.get("blends_well_with", [])
        if pdb.get("fema_number"):
            mat.fema_number = pdb["fema_number"]
    else:
        info = info or "ℹ️ Not in perfumery DB — showing PubChem data only"
        # ── Fallback: extract odor from PubChem sections ──
        for k, items in pugview_sections.items():
            kl = k.lower()
            if ("odor" in kl or "smell" in kl) and "threshold" not in kl and items:
                # Found odor data in PubChem
                odor_texts = [it for it in items if len(it) > 3 and "http" not in it]
                if odor_texts:
                    mat.odor_description = odor_texts[0][:500]
                    info = "ℹ️ Odor from PubChem — not in perfumery DB"
                    break
        # Also check Physical Description for odor mentions
        if not mat.odor_description:
            for k, items in pugview_sections.items():
                if "physical description" in k.lower() and items:
                    for it in items:
                        itl = it.lower()
                        if any(w in itl for w in ["odor", "smell", "scent", "aroma", "fragran"]):
                            mat.odor_description = it[:500]
                            info = "ℹ️ Odor from PubChem physical description"
                            break
                    if mat.odor_description:
                        break

    mat.match_info = info
    logger.info("Done: %s (CID %s) — %d sections [%s]",
                name, cid, len(mat.pubchem_sections), info)
    return mat
