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
    "ambermax": "99610-64-3",
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
    "nirvanolide": "909478-55-1",
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
    "linalool oxide": "60047-17-8",
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
    "firsantol": "155077-70-2",
    "vertofix": "32388-55-9", "vertofix coeur": "32388-55-9",
    "vetiver acetate": "62563-80-8",
    "vetiveryl acetate": "62563-80-8",
    "georgywood": "155517-73-2",
    "clearwood": "28631-86-7", "patchoulol": "5986-55-0",
    "cedarwood": "8000-27-9",
    "cedrol": "77-53-2", "cedryl acetate": "77-54-3",
    "iso longifolanone": "23787-90-8",
    "guaiacol": "90-05-1",
    "guaiazulene": "489-84-9",
    "vetiverol": "89-88-3",
    "nootkatone": "4674-50-4",  # grapefruit woody
    "eudesmol": "473-15-4",
    "bisabolol": "515-69-5", "alpha bisabolol": "515-69-5",
    "cabreuva": "54344-82-2",
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
    "r-limonene": "5989-27-5", "l-limonene": "5989-54-0",
    "orange terpenes": "5989-27-5",
    "bergamotene": "17699-05-7",
    "bergaptene": "484-20-8",
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
    "benzoin": "579-44-2", "benzoin resin": "9000-72-2",
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
    "stemone": "62015-37-8",
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
    if len(n) >= 4:
        for trade_name, cas in TRADE_NAMES.items():
            if n in trade_name or trade_name in n:
                return cas

    # 4. Fuzzy: simple edit-distance-like matching for short names
    if len(n) >= 5:
        best_score = 0
        best_cas = None
        for trade_name, cas in TRADE_NAMES.items():
            # Count matching characters in order
            score = _similarity(n, trade_name)
            if score > best_score and score > 0.8:
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
        cid = _get_cid(session, trade_cas)
        if cid:
            return cid, trade_cas

    # ── Strategy 5: Exact name on PubChem ──
    logger.info("  → Trying exact name: %s", original)
    cid = _get_cid(session, original)
    if cid:
        return cid, original

    # ── Strategy 6: Try top 3 generated variants ──
    variants = _generate_variants(original)
    for variant in variants[1:4]:  # max 3 tries
        logger.info("  → Trying variant: %s", variant)
        cid = _get_cid(session, variant)
        if cid:
            return cid, variant

    # ── Strategy 7: PubChem autocomplete (first match only) ──
    logger.info("  → Trying PubChem autocomplete")
    auto_url = (f"https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound/{requests.utils.quote(n)}/JSON?limit=1")
    data = _safe_get(session, auto_url)
    if data:
        suggestions = data.get("dictionary_terms", {}).get("compound", [])
        if suggestions:
            cid = _get_cid(session, suggestions[0])
            if cid:
                logger.info("  → Autocomplete found: %s", suggestions[0])
                return cid, suggestions[0]

    # ── Strategy 8: Perfumery DB fuzzy ──
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
    url = f"{PUBCHEM_REST}/compound/name/{requests.utils.quote(name)}/cids/JSON"
    data = _safe_get(session, url)
    if data:
        cids = data.get("IdentifierList", {}).get("CID", [])
        return cids[0] if cids else None
    return None


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
    "nature journal references",
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
_MAX_ITEMS_PER_SECTION = 25
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
        # Strip URLs and clean up whitespace
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

    # Binary/external data and table references — skip
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

    # Molecular properties (extended list)
    props = _get_properties(session, cid)
    mat.smiles = props.get("CanonicalSMILES", "")
    mat.molecular_formula = props.get("MolecularFormula", "")
    mat.molecular_weight = str(props.get("MolecularWeight", ""))
    mat.iupac_name = props.get("IUPACName", "")
    mat.inchi = props.get("InChI", "")
    xlogp = props.get("XLogP")
    mat.logp = str(xlogp) if xlogp is not None else ""

    # Store all computed properties as a section
    computed = OrderedDict()
    prop_labels = {
        "MolecularFormula": "Molecular Formula",
        "MolecularWeight": "Molecular Weight",
        "ExactMass": "Exact Mass",
        "MonoisotopicMass": "Monoisotopic Mass",
        "CanonicalSMILES": "Canonical SMILES",
        "IsomericSMILES": "Isomeric SMILES",
        "InChI": "InChI",
        "InChIKey": "InChIKey",
        "XLogP": "XLogP",
        "TPSA": "Topological Polar Surface Area",
        "Complexity": "Complexity",
        "Charge": "Formal Charge",
        "HBondDonorCount": "Hydrogen Bond Donor Count",
        "HBondAcceptorCount": "Hydrogen Bond Acceptor Count",
        "RotatableBondCount": "Rotatable Bond Count",
        "HeavyAtomCount": "Heavy Atom Count",
        "IsotopeAtomCount": "Isotope Atom Count",
        "AtomStereoCount": "Atom Stereo Count",
        "DefinedAtomStereoCount": "Defined Atom Stereo Count",
        "UndefinedAtomStereoCount": "Undefined Atom Stereo Count",
        "BondStereoCount": "Bond Stereo Count",
        "DefinedBondStereoCount": "Defined Bond Stereo Count",
        "UndefinedBondStereoCount": "Undefined Bond Stereo Count",
        "CovalentUnitCount": "Covalent Unit Count",
    }
    comp_items = []
    for key, label in prop_labels.items():
        v = props.get(key)
        if v is not None and str(v):
            comp_items.append(f"{label}: {v}")
    if comp_items:
        computed["Computed Properties"] = comp_items

    # Synonyms & CAS
    syns = _get_synonyms(session, cid)
    mat.cas_number = _extract_cas(syns)
    mat.synonyms = [s for s in syns if not re.match(r"^\d+-\d+-\d$", s)][:20]

    # ALL PUG View sections
    pugview_sections, phys_known = _get_all_pugview(session, cid)

    # Use PUG View sections directly (computed props already included)
    mat.pubchem_sections = pugview_sections

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

    mat.match_info = info
    logger.info("Done: %s (CID %s) — %d sections [%s]",
                name, cid, len(mat.pubchem_sections), info)
    return mat
