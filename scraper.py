"""
scraper.py
==========
Fetches chemical data from PubChem (NIH) REST API and merges it with
a built-in perfumery knowledge base for aroma-chemical analysis.

Author : Perfume Raw Materials Analyzer
Version: 2.0
"""

import re
import logging
from typing import Optional
from dataclasses import dataclass, field

import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PUBCHEM_REST = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
PUBCHEM_VIEW = "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound"
TIMEOUT = 25


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Data container
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@dataclass
class MaterialData:
    """Holds every piece of information about one aroma chemical."""

    name: str
    found: bool = False
    error: str = ""
    page_url: str = ""

    # Identifiers
    cas_number: str = ""
    fema_number: str = ""
    iupac_name: str = ""
    synonyms: list = field(default_factory=list)

    # Molecular
    smiles: str = ""
    molecular_formula: str = ""
    molecular_weight: str = ""
    structure_image_url: str = ""
    inchi: str = ""

    # Odor
    odor_description: str = ""
    odor_type: str = ""
    odor_strength: str = ""

    # Perfumery
    note_classification: str = ""

    # Performance
    tenacity: str = ""
    tenacity_hours: str = ""

    # Physical / chemical
    appearance: str = ""
    boiling_point: str = ""
    flash_point: str = ""
    vapor_pressure: str = ""
    solubility: str = ""
    density: str = ""
    refractive_index: str = ""
    logp: str = ""

    # Safety
    ifra_guidelines: str = ""
    usage_levels: str = ""

    # Blending
    blends_well_with: list = field(default_factory=list)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Built-in perfumery knowledge (20+ materials)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PERFUMERY_DB = {
    "linalool": {
        "odor_description": "Fresh, floral, woody with light citrus and lavender nuances",
        "odor_type": "Floral",
        "odor_strength": "Medium",
        "note_classification": "Top",
        "tenacity": "Low — volatile top note",
        "tenacity_hours": "~2 hours",
        "ifra_guidelines": "Restricted — concentration limits per IFRA 51st Amendment; oxidized linalool is a sensitizer",
        "usage_levels": "1–20 % in fragrance concentrate",
        "blends_well_with": ["Lavender", "Bergamot", "Rosewood", "Geraniol", "Citronellol",
                             "Coumarin", "Ylang Ylang", "Rose Oxide", "Hedione", "Linalyl Acetate"],
        "fema_number": "2635",
        "appearance": "Colorless liquid",
    },
    "iso e super": {
        "odor_description": "Smooth, dry, ambery-woody cedar with velvety ambergris and patchouli effects",
        "odor_type": "Woody / Amber",
        "odor_strength": "Low to Medium — diffusive but subtle",
        "note_classification": "Base",
        "tenacity": "Very high — long-lasting woody amber",
        "tenacity_hours": "~400 hours",
        "ifra_guidelines": "Regulated — safe use levels published; classified skin sensitizer (H317)",
        "usage_levels": "5–50 % in fragrance concentrate; commonly used in overdose",
        "blends_well_with": ["Ambroxan", "Vetiver", "Patchouli", "Cedarwood", "Hedione",
                             "Cashmeran", "Galaxolide", "Ebanol", "Javanol", "Benzyl Benzoate"],
        "fema_number": "",
        "appearance": "Clear to pale yellow liquid",
    },
    "hedione": {
        "odor_description": "Fresh, jasmine-like, transparent floral with green and citrus facets",
        "odor_type": "Floral / Jasmine",
        "odor_strength": "Low — very diffusive and radiant",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate — 24–48 hours on strip",
        "tenacity_hours": "~48 hours",
        "ifra_guidelines": "No restriction — safe for all categories",
        "usage_levels": "5–40 % in fragrance concentrate",
        "blends_well_with": ["Iso E Super", "Galaxolide", "Linalool", "Citral", "Rose Oxide",
                             "Ambroxan", "Musk Ketone", "Benzyl Salicylate", "Coumarin", "Vanillin"],
        "fema_number": "",
        "appearance": "Colorless to pale yellow liquid",
    },
    "galaxolide": {
        "odor_description": "Sweet, clean, powdery musk with woody and floral undertones",
        "odor_type": "Musk",
        "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "Very high — excellent fixative",
        "tenacity_hours": "~500 hours",
        "ifra_guidelines": "Restricted — limits depend on product category",
        "usage_levels": "5–15 % in fragrance concentrate",
        "blends_well_with": ["Iso E Super", "Hedione", "Ambroxan", "Cashmeran",
                             "Ethylene Brassylate", "Coumarin", "Vanillin", "Tonalide"],
        "fema_number": "",
        "appearance": "Colorless to slightly yellow viscous liquid",
    },
    "coumarin": {
        "odor_description": "Sweet, warm, hay-like with tonka bean and vanilla nuances",
        "odor_type": "Sweet / Balsamic",
        "odor_strength": "High",
        "note_classification": "Middle / Heart to Base",
        "tenacity": "High — 200+ hours on strip",
        "tenacity_hours": "~200 hours",
        "ifra_guidelines": "Restricted — maximum use levels per category",
        "usage_levels": "2–10 % in fragrance concentrate",
        "blends_well_with": ["Lavender", "Vanillin", "Tonalide", "Oakmoss", "Linalool",
                             "Bergamot", "Rose", "Geranium", "Cinnamic Alcohol"],
        "fema_number": "2381",
        "appearance": "White crystalline powder",
    },
    "vanillin": {
        "odor_description": "Sweet, creamy, warm vanilla with balsamic and slightly powdery facets",
        "odor_type": "Sweet / Vanilla",
        "odor_strength": "High",
        "note_classification": "Base",
        "tenacity": "Very high — long-lasting sweetness",
        "tenacity_hours": "~400 hours",
        "ifra_guidelines": "No restriction for synthetic vanillin",
        "usage_levels": "1–10 % in fragrance concentrate",
        "blends_well_with": ["Coumarin", "Benzoin", "Ethyl Vanillin", "Musk", "Sandalwood",
                             "Patchouli", "Tonka Bean", "Heliotropin", "Labdanum"],
        "fema_number": "3107",
        "appearance": "White to slightly yellow crystalline powder",
    },
    "ambroxan": {
        "odor_description": "Warm, amber, woody with musky, mineral and skin-like nuances",
        "odor_type": "Amber / Woody",
        "odor_strength": "Medium to High — very diffusive",
        "note_classification": "Base",
        "tenacity": "Extremely high — lasts weeks on strip",
        "tenacity_hours": "~700 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "1–20 % in fragrance concentrate",
        "blends_well_with": ["Iso E Super", "Hedione", "Cetalox", "Cashmeran", "Santal",
                             "Vetiver", "Patchouli", "Galaxolide", "Benzyl Benzoate"],
        "fema_number": "",
        "appearance": "White crystalline solid",
    },
    "cashmeran": {
        "odor_description": "Warm, musky, spicy-woody with fruity and velvet-like nuances",
        "odor_type": "Musky / Woody",
        "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "High — long-lasting warm character",
        "tenacity_hours": "~300 hours",
        "ifra_guidelines": "Restricted — limits apply",
        "usage_levels": "2–15 % in fragrance concentrate",
        "blends_well_with": ["Iso E Super", "Ambroxan", "Galaxolide", "Hedione",
                             "Patchouli", "Vetiver", "Cedarwood", "Benzyl Salicylate"],
        "fema_number": "",
        "appearance": "Colorless to pale yellow liquid",
    },
    "ethyl vanillin": {
        "odor_description": "Intense, sweet, creamy vanilla — 3–4× stronger than vanillin",
        "odor_type": "Sweet / Vanilla",
        "odor_strength": "Very High",
        "note_classification": "Base",
        "tenacity": "Very high",
        "tenacity_hours": "~400 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "0.5–5 % in fragrance concentrate",
        "blends_well_with": ["Vanillin", "Coumarin", "Heliotropin", "Benzoin",
                             "Musk", "Tonka Bean", "Labdanum"],
        "fema_number": "2464",
        "appearance": "White to slightly yellow crystalline powder",
    },
    "citronellol": {
        "odor_description": "Fresh, sweet, rosy with green and citrus nuances",
        "odor_type": "Floral / Rose",
        "odor_strength": "Medium",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate",
        "tenacity_hours": "~24 hours",
        "ifra_guidelines": "Restricted — allergen; must be declared above threshold (EU)",
        "usage_levels": "1–15 % in fragrance concentrate",
        "blends_well_with": ["Geraniol", "Linalool", "Phenylethyl Alcohol", "Citral",
                             "Rose Oxide", "Eugenol", "Geranium Oil"],
        "fema_number": "2309",
        "appearance": "Colorless oily liquid",
    },
    "geraniol": {
        "odor_description": "Sweet, floral, rose-like with fruity and citrus nuances",
        "odor_type": "Floral / Rose",
        "odor_strength": "Medium to High",
        "note_classification": "Middle / Heart",
        "tenacity": "Moderate — 24–48 hours",
        "tenacity_hours": "~30 hours",
        "ifra_guidelines": "Restricted — classified allergen; labeling required (EU)",
        "usage_levels": "1–10 % in fragrance concentrate",
        "blends_well_with": ["Citronellol", "Linalool", "Phenylethyl Alcohol",
                             "Rose Oxide", "Eugenol", "Ylang Ylang", "Palmarosa"],
        "fema_number": "2507",
        "appearance": "Colorless to pale yellow oily liquid",
    },
    "eugenol": {
        "odor_description": "Warm, spicy, clove-like with slightly sweet and woody undertones",
        "odor_type": "Spicy",
        "odor_strength": "High",
        "note_classification": "Middle / Heart to Base",
        "tenacity": "Moderate to High",
        "tenacity_hours": "~48 hours",
        "ifra_guidelines": "Restricted — known allergen; labeling required above threshold",
        "usage_levels": "0.5–5 % in fragrance concentrate",
        "blends_well_with": ["Cinnamic Aldehyde", "Vanillin", "Coumarin", "Rose",
                             "Ylang Ylang", "Patchouli", "Clove Oil"],
        "fema_number": "2467",
        "appearance": "Colorless to pale yellow liquid",
    },
    "limonene": {
        "odor_description": "Fresh, bright, sweet citrus-orange peel with light green nuance",
        "odor_type": "Citrus",
        "odor_strength": "Medium to High",
        "note_classification": "Top",
        "tenacity": "Low — very volatile",
        "tenacity_hours": "~1 hour",
        "ifra_guidelines": "Restricted — oxidized limonene is a sensitizer; must be declared (EU)",
        "usage_levels": "1–15 % in fragrance concentrate",
        "blends_well_with": ["Linalool", "Bergamot", "Citral", "Orange Oil",
                             "Lemon Oil", "Neroli", "Petitgrain"],
        "fema_number": "2633",
        "appearance": "Colorless liquid",
    },
    "dihydromyrcenol": {
        "odor_description": "Fresh, clean, citrus-metallic, ozonic with green lime facets",
        "odor_type": "Citrus / Fresh",
        "odor_strength": "High",
        "note_classification": "Top",
        "tenacity": "Low to Moderate",
        "tenacity_hours": "~8 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "5–30 % in fragrance concentrate",
        "blends_well_with": ["Hedione", "Linalool", "Iso E Super", "Ambroxan",
                             "Galaxolide", "Citral", "Bergamot"],
        "fema_number": "",
        "appearance": "Colorless liquid",
    },
    "calone": {
        "odor_description": "Fresh, ozonic, marine, watermelon-like with green and metallic nuances",
        "odor_type": "Marine / Ozonic",
        "odor_strength": "Very High — use in trace amounts",
        "note_classification": "Top to Middle / Heart",
        "tenacity": "Moderate",
        "tenacity_hours": "~48 hours",
        "ifra_guidelines": "No restriction — but extremely potent",
        "usage_levels": "0.01–0.5 % in fragrance concentrate",
        "blends_well_with": ["Hedione", "Dihydromyrcenol", "Linalool", "Melon notes",
                             "Violet Leaf", "Cyclamen Aldehyde"],
        "fema_number": "",
        "appearance": "White crystalline solid",
    },
    "ethylene brassylate": {
        "odor_description": "Sweet, powdery, clean musk with slightly metallic and floral facets",
        "odor_type": "Musk",
        "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "Very high — excellent fixative musk",
        "tenacity_hours": "~500 hours",
        "ifra_guidelines": "No restriction",
        "usage_levels": "3–20 % in fragrance concentrate",
        "blends_well_with": ["Galaxolide", "Ambroxan", "Hedione", "Iso E Super",
                             "Cashmeran", "Coumarin", "Vanillin"],
        "fema_number": "",
        "appearance": "Colorless to pale yellow liquid",
    },
    "benzyl benzoate": {
        "odor_description": "Very faint, slightly sweet, balsamic — mainly fixative/solvent",
        "odor_type": "Balsamic",
        "odor_strength": "Very Low",
        "note_classification": "Base",
        "tenacity": "Fixative — extends longevity of other materials",
        "tenacity_hours": "N/A (fixative)",
        "ifra_guidelines": "Restricted — allergen per EU regulation",
        "usage_levels": "5–30 % as solvent/fixative",
        "blends_well_with": ["Used with virtually all materials as fixative/solvent"],
        "fema_number": "2138",
        "appearance": "Colorless to pale yellow oily liquid",
    },
    "benzyl salicylate": {
        "odor_description": "Very faint, sweet, balsamic-floral with green nuances — mainly a fixative",
        "odor_type": "Balsamic / Floral",
        "odor_strength": "Very Low",
        "note_classification": "Base",
        "tenacity": "Fixative — extends longevity of floral accords",
        "tenacity_hours": "N/A (fixative)",
        "ifra_guidelines": "Restricted — classified allergen; labeling required (EU)",
        "usage_levels": "5–20 % as fixative",
        "blends_well_with": ["Hedione", "Galaxolide", "Rose", "Jasmine",
                             "Ylang Ylang", "Linalool", "Coumarin"],
        "fema_number": "",
        "appearance": "Colorless to pale yellow oily liquid",
    },
    "muscone": {
        "odor_description": "Rich, warm, animalic musk with powdery and skin-like facets",
        "odor_type": "Musk / Animalic",
        "odor_strength": "High",
        "note_classification": "Base",
        "tenacity": "Extremely high",
        "tenacity_hours": "~600 hours",
        "ifra_guidelines": "No restriction for synthetic muscone",
        "usage_levels": "0.1–2 % in fragrance concentrate (very potent)",
        "blends_well_with": ["Civetone", "Ambroxan", "Galaxolide", "Sandalwood",
                             "Vanillin", "Rose Absolute", "Iso E Super"],
        "fema_number": "",
        "appearance": "Slightly yellowish oily liquid",
    },
    "musk ketone": {
        "odor_description": "Sweet, powdery, clean musk with slight fruity and floral nuances",
        "odor_type": "Musk",
        "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "Very high",
        "tenacity_hours": "~500 hours",
        "ifra_guidelines": "Restricted — nitro musks have usage limits",
        "usage_levels": "1–5 % in fragrance concentrate",
        "blends_well_with": ["Galaxolide", "Ambroxan", "Hedione", "Coumarin",
                             "Vanillin", "Rose", "Jasmine"],
        "fema_number": "",
        "appearance": "Yellow crystalline powder",
    },
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  HTTP helpers
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def make_session() -> requests.Session:
    """Return a configured requests session."""
    s = requests.Session()
    s.headers.update({"User-Agent": "PerfumeAnalyzer/2.0", "Accept": "application/json"})
    return s


def _safe_get(session, url):
    """GET with timeout; returns None on failure."""
    try:
        r = session.get(url, timeout=TIMEOUT)
        if r.status_code == 200:
            return r.json()
    except Exception as exc:
        logger.warning("GET %s → %s", url, exc)
    return None


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  PubChem helpers
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _get_cid(session, name):
    """Resolve compound name → PubChem CID."""
    url = f"{PUBCHEM_REST}/compound/name/{requests.utils.quote(name)}/cids/JSON"
    data = _safe_get(session, url)
    if data:
        cids = data.get("IdentifierList", {}).get("CID", [])
        return cids[0] if cids else None
    return None


def _get_properties(session, cid):
    """Fetch key molecular properties."""
    fields = "MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName,XLogP,InChI"
    url = f"{PUBCHEM_REST}/compound/cid/{cid}/property/{fields}/JSON"
    data = _safe_get(session, url)
    if data:
        rows = data.get("PropertyTable", {}).get("Properties", [])
        return rows[0] if rows else {}
    return {}


def _get_synonyms(session, cid, limit=12):
    """Fetch synonyms list."""
    url = f"{PUBCHEM_REST}/compound/cid/{cid}/synonyms/JSON"
    data = _safe_get(session, url)
    if data:
        info = data.get("InformationList", {}).get("Information", [])
        if info:
            return info[0].get("Synonym", [])[:limit]
    return []


def _extract_cas(synonyms):
    """Pull CAS number from synonym list."""
    pat = re.compile(r"^\d{2,7}-\d{2}-\d$")
    for s in synonyms:
        if pat.match(s.strip()):
            return s.strip()
    return ""


def _get_physical_data(session, cid):
    """Fetch physical/chemical properties from PubChem PUG View."""
    url = f"{PUBCHEM_VIEW}/{cid}/JSON"
    out = {}

    try:
        r = session.get(url, timeout=TIMEOUT)
        if r.status_code != 200:
            return out
        blob = r.json()
    except Exception as exc:
        logger.warning("PUG View %s → %s", cid, exc)
        return out

    targets = {
        "boiling point": "boiling_point",
        "flash point": "flash_point",
        "vapor pressure": "vapor_pressure",
        "solubility": "solubility",
        "density": "density",
        "physical description": "appearance",
        "color": "color",
        "refractive index": "refractive_index",
    }

    def _walk(sections):
        for sec in (sections or []):
            heading = sec.get("TOCHeading", "").lower()
            for target_key, out_key in targets.items():
                if target_key in heading and out_key not in out:
                    for info in sec.get("Information", []):
                        val = info.get("Value", {})
                        strs = val.get("StringWithMarkup", [])
                        if strs:
                            out[out_key] = strs[0].get("String", "")
                            break
                        nums = val.get("Number", [])
                        if nums:
                            unit = val.get("Unit", "")
                            out[out_key] = f"{nums[0]} {unit}".strip()
                            break
            _walk(sec.get("Section", []))

    _walk(blob.get("Record", {}).get("Section", []))
    return out


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Perfumery DB lookup
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _lookup_perfumery(name):
    """Match name against the built-in perfumery DB."""
    key = name.lower().strip()
    if key in PERFUMERY_DB:
        return PERFUMERY_DB[key]
    for db_key, db_val in PERFUMERY_DB.items():
        if db_key in key or key in db_key:
            return db_val
    return {}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Main public function
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def scrape_material(name: str, session=None) -> MaterialData:
    """
    Search PubChem for *name*, pull molecular + physical data,
    and merge with perfumery knowledge.
    """
    mat = MaterialData(name=name)
    if session is None:
        session = make_session()

    # 1) Resolve CID
    logger.info("Searching PubChem for: %s", name)
    cid = _get_cid(session, name)
    if cid is None:
        mat.error = f"'{name}' not found on PubChem. Check spelling or try an alternate name."
        return mat

    mat.found = True
    mat.page_url = f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}"
    mat.structure_image_url = (
        f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/PNG"
        f"?image_size=300x200"
    )

    # 2) Molecular properties
    props = _get_properties(session, cid)
    mat.smiles = props.get("CanonicalSMILES", "")
    mat.molecular_formula = props.get("MolecularFormula", "")
    mat.molecular_weight = str(props.get("MolecularWeight", ""))
    mat.iupac_name = props.get("IUPACName", "")
    mat.inchi = props.get("InChI", "")
    xlogp = props.get("XLogP")
    mat.logp = str(xlogp) if xlogp is not None else ""

    # 3) Synonyms & CAS
    syns = _get_synonyms(session, cid)
    mat.cas_number = _extract_cas(syns)
    mat.synonyms = [s for s in syns if not re.match(r"^\d+-\d+-\d$", s)][:10]

    # 4) Physical data
    phys = _get_physical_data(session, cid)
    mat.boiling_point = phys.get("boiling_point", "")
    mat.flash_point = phys.get("flash_point", "")
    mat.vapor_pressure = phys.get("vapor_pressure", "")
    mat.solubility = phys.get("solubility", "")
    mat.density = phys.get("density", "")
    mat.refractive_index = phys.get("refractive_index", "")
    mat.appearance = phys.get("appearance", "") or phys.get("color", "")

    # 5) Perfumery overlay
    pdb = _lookup_perfumery(name)
    if pdb:
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
        if pdb.get("appearance") and not mat.appearance:
            mat.appearance = pdb["appearance"]

    logger.info("OK — %s (CID %s)", name, cid)
    return mat
