"""
scraper.py — Fetch chemical data via PubChem REST API + built-in perfumery database.

PubChem provides reliable molecular/physical data through its free REST API.
Perfumery-specific data (odor profile, notes, blending) comes from a curated
built-in database of common aroma chemicals.
"""

import re
import logging
from typing import Optional
from dataclasses import dataclass, field

import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
REQUEST_TIMEOUT = 20

# ─────────────────────────────────────────────────
# Built-in perfumery knowledge base
# ─────────────────────────────────────────────────
PERFUMERY_DB = {
    "linalool": {
        "odor_description": "Fresh, floral, woody with light citrus and lavender nuances",
        "odor_type": "Floral",
        "odor_strength": "Medium",
        "note_classification": "Top",
        "tenacity": "Low — volatile top note, fades within 1-2 hours on strip",
        "tenacity_hours": "~2 hours",
        "ifra_guidelines": "Restricted — concentration limits apply per IFRA 51st Amendment; oxidized linalool is a known sensitizer",
        "usage_levels": "1-20% in fragrance concentrate",
        "blends_well_with": ["Lavender", "Bergamot", "Rosewood", "Geraniol", "Citronellol", "Coumarin", "Ylang Ylang", "Rose Oxide", "Hedione", "Linalyl Acetate"],
        "fema_number": "2635",
        "appearance": "Colorless liquid",
    },
    "iso e super": {
        "odor_description": "Smooth, dry, ambery-woody cedar with velvety ambergris and patchouli effects; subtle phenolic nuance",
        "odor_type": "Woody / Amber",
        "odor_strength": "Low to Medium — diffusive but subtle",
        "note_classification": "Base",
        "tenacity": "Very high — long-lasting woody amber on strip",
        "tenacity_hours": "~400 hours",
        "ifra_guidelines": "IFRA regulated — safe use levels published; classified as skin sensitizer (H317) per CLP",
        "usage_levels": "5-50% in fragrance concentrate; commonly used in overdose",
        "blends_well_with": ["Ambroxan", "Vetiver", "Patchouli", "Cedarwood", "Hedione", "Cashmeran", "Galaxolide", "Ebanol", "Javanol", "Benzyl Benzoate"],
        "fema_number": "",
        "appearance": "Clear to pale yellow liquid",
    },
    "hedione": {
        "odor_description": "Fresh, jasmine-like, transparent floral with green and citrus facets",
        "odor_type": "Floral / Jasmine",
        "odor_strength": "Low — very diffusive and radiant",
        "note_classification": "Middle/Heart",
        "tenacity": "Moderate — 24-48 hours on strip",
        "tenacity_hours": "~48 hours",
        "ifra_guidelines": "No IFRA restriction — safe for all product categories",
        "usage_levels": "5-40% in fragrance concentrate; often used at high levels",
        "blends_well_with": ["Iso E Super", "Galaxolide", "Linalool", "Citral", "Rose Oxide", "Ambroxan", "Musk Ketone", "Benzyl Salicylate", "Coumarin", "Vanillin"],
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
        "ifra_guidelines": "IFRA restricted — use limits depend on product category",
        "usage_levels": "5-15% in fragrance concentrate",
        "blends_well_with": ["Iso E Super", "Hedione", "Ambroxan", "Cashmeran", "Ethylene Brassylate", "Coumarin", "Vanillin", "Benzyl Benzoate", "Tonalide"],
        "fema_number": "",
        "appearance": "Colorless to slightly yellow viscous liquid",
    },
    "coumarin": {
        "odor_description": "Sweet, warm, hay-like with tonka bean and vanilla nuances",
        "odor_type": "Sweet / Balsamic",
        "odor_strength": "High",
        "note_classification": "Middle/Heart to Base",
        "tenacity": "High — 200+ hours on strip",
        "tenacity_hours": "~200 hours",
        "ifra_guidelines": "IFRA restricted — maximum use levels apply per product category",
        "usage_levels": "2-10% in fragrance concentrate",
        "blends_well_with": ["Lavender", "Vanillin", "Tonalide", "Oakmoss", "Linalool", "Bergamot", "Rose", "Geranium", "Cinnamic Alcohol"],
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
        "ifra_guidelines": "No IFRA restriction for synthetic vanillin",
        "usage_levels": "1-10% in fragrance concentrate",
        "blends_well_with": ["Coumarin", "Benzoin", "Ethyl Vanillin", "Musk", "Sandalwood", "Patchouli", "Tonka Bean", "Heliotropin", "Labdanum"],
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
        "ifra_guidelines": "No IFRA restriction",
        "usage_levels": "1-20% in fragrance concentrate",
        "blends_well_with": ["Iso E Super", "Hedione", "Cetalox", "Cashmeran", "Santal", "Vetiver", "Patchouli", "Galaxolide", "Benzyl Benzoate"],
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
        "ifra_guidelines": "IFRA restricted — limits apply",
        "usage_levels": "2-15% in fragrance concentrate",
        "blends_well_with": ["Iso E Super", "Ambroxan", "Galaxolide", "Hedione", "Patchouli", "Vetiver", "Cedarwood", "Benzyl Salicylate"],
        "fema_number": "",
        "appearance": "Colorless to pale yellow liquid",
    },
    "ethyl vanillin": {
        "odor_description": "Intense, sweet, creamy vanilla — 3-4x stronger than vanillin",
        "odor_type": "Sweet / Vanilla",
        "odor_strength": "Very High",
        "note_classification": "Base",
        "tenacity": "Very high",
        "tenacity_hours": "~400 hours",
        "ifra_guidelines": "No IFRA restriction",
        "usage_levels": "0.5-5% in fragrance concentrate",
        "blends_well_with": ["Vanillin", "Coumarin", "Heliotropin", "Benzoin", "Musk", "Tonka Bean", "Labdanum"],
        "fema_number": "2464",
        "appearance": "White to slightly yellow crystalline powder",
    },
    "musk ketone": {
        "odor_description": "Sweet, powdery, clean musk with slight fruity and floral nuances",
        "odor_type": "Musk",
        "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "Very high",
        "tenacity_hours": "~500 hours",
        "ifra_guidelines": "IFRA restricted — nitro musks have usage limits",
        "usage_levels": "1-5% in fragrance concentrate",
        "blends_well_with": ["Galaxolide", "Ambroxan", "Hedione", "Coumarin", "Vanillin", "Rose", "Jasmine"],
        "fema_number": "",
        "appearance": "Yellow crystalline powder",
    },
    "citronellol": {
        "odor_description": "Fresh, sweet, rosy with green and citrus nuances",
        "odor_type": "Floral / Rose",
        "odor_strength": "Medium",
        "note_classification": "Middle/Heart",
        "tenacity": "Moderate",
        "tenacity_hours": "~24 hours",
        "ifra_guidelines": "IFRA restricted — allergen; must be declared on labels above threshold in EU",
        "usage_levels": "1-15% in fragrance concentrate",
        "blends_well_with": ["Geraniol", "Linalool", "Phenylethyl Alcohol", "Citral", "Rose Oxide", "Eugenol", "Geranium Oil"],
        "fema_number": "2309",
        "appearance": "Colorless oily liquid",
    },
    "geraniol": {
        "odor_description": "Sweet, floral, rose-like with fruity and citrus nuances",
        "odor_type": "Floral / Rose",
        "odor_strength": "Medium to High",
        "note_classification": "Middle/Heart",
        "tenacity": "Moderate — 24-48 hours",
        "tenacity_hours": "~30 hours",
        "ifra_guidelines": "IFRA restricted — classified allergen; labeling required in EU above threshold",
        "usage_levels": "1-10% in fragrance concentrate",
        "blends_well_with": ["Citronellol", "Linalool", "Phenylethyl Alcohol", "Rose Oxide", "Eugenol", "Ylang Ylang", "Palmarosa"],
        "fema_number": "2507",
        "appearance": "Colorless to pale yellow oily liquid",
    },
    "eugenol": {
        "odor_description": "Warm, spicy, clove-like with slightly sweet and woody undertones",
        "odor_type": "Spicy",
        "odor_strength": "High",
        "note_classification": "Middle/Heart to Base",
        "tenacity": "Moderate to High",
        "tenacity_hours": "~48 hours",
        "ifra_guidelines": "IFRA restricted — known allergen; labeling required above threshold",
        "usage_levels": "0.5-5% in fragrance concentrate",
        "blends_well_with": ["Cinnamic Aldehyde", "Vanillin", "Coumarin", "Rose", "Ylang Ylang", "Patchouli", "Clove Oil"],
        "fema_number": "2467",
        "appearance": "Colorless to pale yellow liquid",
    },
    "benzyl benzoate": {
        "odor_description": "Very faint, slightly sweet, balsamic — mainly used as fixative/solvent",
        "odor_type": "Balsamic",
        "odor_strength": "Very Low",
        "note_classification": "Base",
        "tenacity": "Fixative — extends longevity of other materials",
        "tenacity_hours": "N/A (fixative)",
        "ifra_guidelines": "IFRA restricted — allergen per EU regulation",
        "usage_levels": "5-30% as solvent/fixative in fragrance concentrate",
        "blends_well_with": ["Used with virtually all materials as fixative/solvent"],
        "fema_number": "2138",
        "appearance": "Colorless to pale yellow oily liquid",
    },
    "limonene": {
        "odor_description": "Fresh, bright, sweet citrus-orange peel with light green nuance",
        "odor_type": "Citrus",
        "odor_strength": "Medium to High",
        "note_classification": "Top",
        "tenacity": "Low — very volatile",
        "tenacity_hours": "~1 hour",
        "ifra_guidelines": "IFRA restricted — oxidized limonene is a sensitizer; must be declared on EU labels",
        "usage_levels": "1-15% in fragrance concentrate",
        "blends_well_with": ["Linalool", "Bergamot", "Citral", "Orange Oil", "Lemon Oil", "Neroli", "Petitgrain"],
        "fema_number": "2633",
        "appearance": "Colorless liquid",
    },
    "muscone": {
        "odor_description": "Rich, warm, animalic musk with powdery and skin-like facets",
        "odor_type": "Musk / Animalic",
        "odor_strength": "High",
        "note_classification": "Base",
        "tenacity": "Extremely high — lasts very long on strip",
        "tenacity_hours": "~600 hours",
        "ifra_guidelines": "No IFRA restriction for synthetic muscone",
        "usage_levels": "0.1-2% in fragrance concentrate (very potent)",
        "blends_well_with": ["Civetone", "Ambroxan", "Galaxolide", "Sandalwood", "Vanillin", "Rose Absolute", "Iso E Super"],
        "fema_number": "",
        "appearance": "Slightly yellowish oily liquid",
    },
    "calone": {
        "odor_description": "Fresh, ozonic, marine, watermelon-like with green and metallic nuances",
        "odor_type": "Marine / Ozonic",
        "odor_strength": "Very High — extremely powerful, use in trace amounts",
        "note_classification": "Top to Middle/Heart",
        "tenacity": "Moderate",
        "tenacity_hours": "~48 hours",
        "ifra_guidelines": "No IFRA restriction — but extremely potent",
        "usage_levels": "0.01-0.5% in fragrance concentrate (very strong)",
        "blends_well_with": ["Hedione", "Dihydromyrcenol", "Linalool", "Melon notes", "Violet Leaf", "Cyclamen Aldehyde"],
        "fema_number": "",
        "appearance": "White crystalline solid",
    },
    "dihydromyrcenol": {
        "odor_description": "Fresh, clean, citrus-metallic, ozonic with green lime facets",
        "odor_type": "Citrus / Fresh",
        "odor_strength": "High",
        "note_classification": "Top",
        "tenacity": "Low to Moderate",
        "tenacity_hours": "~8 hours",
        "ifra_guidelines": "No IFRA restriction",
        "usage_levels": "5-30% in fragrance concentrate",
        "blends_well_with": ["Hedione", "Linalool", "Iso E Super", "Ambroxan", "Galaxolide", "Citral", "Bergamot"],
        "fema_number": "",
        "appearance": "Colorless liquid",
    },
    "ethylene brassylate": {
        "odor_description": "Sweet, powdery, clean musk with slightly metallic and floral facets",
        "odor_type": "Musk",
        "odor_strength": "Medium",
        "note_classification": "Base",
        "tenacity": "Very high — excellent fixative musk",
        "tenacity_hours": "~500 hours",
        "ifra_guidelines": "No IFRA restriction",
        "usage_levels": "3-20% in fragrance concentrate",
        "blends_well_with": ["Galaxolide", "Ambroxan", "Hedione", "Iso E Super", "Cashmeran", "Coumarin", "Vanillin"],
        "fema_number": "",
        "appearance": "Colorless to pale yellow liquid",
    },
    "benzyl salicylate": {
        "odor_description": "Very faint, sweet, balsamic-floral with green nuances — mainly a fixative",
        "odor_type": "Balsamic / Floral",
        "odor_strength": "Very Low",
        "note_classification": "Base",
        "tenacity": "Fixative — extends longevity of floral accords",
        "tenacity_hours": "N/A (fixative)",
        "ifra_guidelines": "IFRA restricted — classified allergen; labeling required in EU",
        "usage_levels": "5-20% as fixative in fragrance concentrate",
        "blends_well_with": ["Hedione", "Galaxolide", "Rose", "Jasmine", "Ylang Ylang", "Linalool", "Coumarin"],
        "fema_number": "",
        "appearance": "Colorless to pale yellow oily liquid",
    },
}


@dataclass
class MaterialData:
    """Container for all extracted data about a perfume raw material."""
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

    # Odor profile
    odor_description: str = ""
    odor_type: str = ""
    odor_strength: str = ""

    # Perfumery classification
    note_classification: str = ""

    # Performance
    tenacity: str = ""
    tenacity_hours: str = ""

    # Physical & chemical properties
    appearance: str = ""
    boiling_point: str = ""
    flash_point: str = ""
    vapor_pressure: str = ""
    solubility: str = ""
    specific_gravity: str = ""
    refractive_index: str = ""
    logp: str = ""

    # Safety & formulation
    ifra_guidelines: str = ""
    usage_levels: str = ""

    # Blending
    blends_well_with: list = field(default_factory=list)


def _get_session() -> requests.Session:
    """Create a configured requests session."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": "PerfumeAnalyzer/1.0",
        "Accept": "application/json",
    })
    return session


def _pubchem_get_cid(session: requests.Session, name: str) -> Optional[int]:
    """Search PubChem for a compound by name and return its CID."""
    url = f"{PUBCHEM_BASE}/compound/name/{requests.utils.quote(name)}/cids/JSON"
    try:
        resp = session.get(url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            cids = data.get("IdentifierList", {}).get("CID", [])
            if cids:
                return cids[0]
    except Exception as e:
        logger.warning(f"PubChem CID lookup failed for '{name}': {e}")
    return None


def _pubchem_get_properties(session: requests.Session, cid: int) -> dict:
    """Fetch molecular properties from PubChem."""
    props = (
        "MolecularFormula,MolecularWeight,CanonicalSMILES,"
        "IUPACName,XLogP,ExactMass,InChI"
    )
    url = f"{PUBCHEM_BASE}/compound/cid/{cid}/property/{props}/JSON"
    try:
        resp = session.get(url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            results = data.get("PropertyTable", {}).get("Properties", [])
            if results:
                return results[0]
    except Exception as e:
        logger.warning(f"PubChem properties failed for CID {cid}: {e}")
    return {}


def _pubchem_get_synonyms(session: requests.Session, cid: int, max_items: int = 10) -> list:
    """Fetch common synonyms from PubChem."""
    url = f"{PUBCHEM_BASE}/compound/cid/{cid}/synonyms/JSON"
    try:
        resp = session.get(url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            info_list = data.get("InformationList", {}).get("Information", [])
            if info_list:
                syns = info_list[0].get("Synonym", [])
                return syns[:max_items]
    except Exception as e:
        logger.warning(f"PubChem synonyms failed for CID {cid}: {e}")
    return []


def _pubchem_get_cas(synonyms: list) -> str:
    """Extract CAS number from synonyms list."""
    cas_pattern = re.compile(r"^\d{2,7}-\d{2}-\d$")
    for syn in synonyms:
        if cas_pattern.match(syn.strip()):
            return syn.strip()
    return ""


def _pubchem_get_description(session: requests.Session, cid: int) -> dict:
    """Fetch extended description data from PubChem."""
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/{cid}/JSON"
    results = {
        "boiling_point": "",
        "flash_point": "",
        "vapor_pressure": "",
        "solubility": "",
        "density": "",
        "appearance": "",
        "refractive_index": "",
    }

    try:
        resp = session.get(url, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            return results

        data = resp.json()

        def _search_sections(sections, target_headings):
            """Recursively search PubChem JSON for specific data sections."""
            found = {}
            if not sections:
                return found
            for section in sections:
                heading = section.get("TOCHeading", "").lower()

                for target in target_headings:
                    if target.lower() in heading:
                        # Try to get string value
                        infos = section.get("Information", [])
                        for info in infos:
                            val = info.get("Value", {})
                            str_val = val.get("StringWithMarkup", [])
                            if str_val:
                                text = str_val[0].get("String", "")
                                if text and target not in found:
                                    found[target] = text
                                    break
                            num_val = val.get("Number", [])
                            if num_val:
                                unit = val.get("Unit", "")
                                text = f"{num_val[0]} {unit}".strip()
                                if text and target not in found:
                                    found[target] = text
                                    break

                # Recurse into subsections
                subsections = section.get("Section", [])
                if subsections:
                    sub_found = _search_sections(subsections, target_headings)
                    for k, v in sub_found.items():
                        if k not in found:
                            found[k] = v

            return found

        top_sections = data.get("Record", {}).get("Section", [])
        targets = [
            "Boiling Point", "Flash Point", "Vapor Pressure",
            "Solubility", "Density", "Physical Description",
            "Refractive Index", "Color"
        ]
        found = _search_sections(top_sections, targets)

        results["boiling_point"] = found.get("Boiling Point", "")
        results["flash_point"] = found.get("Flash Point", "")
        results["vapor_pressure"] = found.get("Vapor Pressure", "")
        results["solubility"] = found.get("Solubility", "")
        results["density"] = found.get("Density", "")
        results["refractive_index"] = found.get("Refractive Index", "")
        results["appearance"] = found.get("Physical Description", "") or found.get("Color", "")

    except Exception as e:
        logger.warning(f"PubChem description failed for CID {cid}: {e}")

    return results


def _lookup_perfumery_data(name: str) -> dict:
    """Look up perfumery-specific data from the built-in database."""
    key = name.lower().strip()

    # Try exact match first
    if key in PERFUMERY_DB:
        return PERFUMERY_DB[key]

    # Try partial match
    for db_key, db_val in PERFUMERY_DB.items():
        if db_key in key or key in db_key:
            return db_val

    return {}


def scrape_material(material_name: str, session: Optional[requests.Session] = None) -> MaterialData:
    """
    Main entry point: search PubChem for a material and merge with perfumery data.

    Parameters
    ----------
    material_name : str
        Common name of the aroma chemical (e.g., "Linalool", "Iso E Super").
    session : requests.Session, optional
        Reusable session for connection pooling.

    Returns
    -------
    MaterialData
        Dataclass containing all extracted fields.
    """
    data = MaterialData(name=material_name)

    if session is None:
        session = _get_session()

    # --- Step 1: Search PubChem ---
    logger.info(f"Searching PubChem for: {material_name}")
    cid = _pubchem_get_cid(session, material_name)

    if cid is None:
        data.error = f"Could not find '{material_name}' in PubChem. Check spelling or try an alternate name."
        logger.warning(data.error)
        return data

    data.found = True
    data.page_url = f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}"

    # --- Step 2: Fetch molecular properties ---
    props = _pubchem_get_properties(session, cid)
    data.smiles = props.get("CanonicalSMILES", "")
    data.molecular_formula = props.get("MolecularFormula", "")
    data.molecular_weight = str(props.get("MolecularWeight", ""))
    data.iupac_name = props.get("IUPACName", "")
    data.logp = str(props.get("XLogP", "")) if props.get("XLogP") is not None else ""
    data.inchi = props.get("InChI", "")

    # Structure image from PubChem
    data.structure_image_url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/PNG?image_size=300x200"

    # --- Step 3: Fetch synonyms & CAS ---
    synonyms = _pubchem_get_synonyms(session, cid, max_items=15)
    data.cas_number = _pubchem_get_cas(synonyms)
    data.synonyms = [s for s in synonyms if not re.match(r"^\d+-\d+-\d$", s)][:10]

    # --- Step 4: Fetch physical/chemical properties ---
    desc = _pubchem_get_description(session, cid)
    data.boiling_point = desc.get("boiling_point", "")
    data.flash_point = desc.get("flash_point", "")
    data.vapor_pressure = desc.get("vapor_pressure", "")
    data.solubility = desc.get("solubility", "")
    data.specific_gravity = desc.get("density", "")
    data.refractive_index = desc.get("refractive_index", "")
    if not data.appearance:
        data.appearance = desc.get("appearance", "")

    # --- Step 5: Merge perfumery-specific data ---
    perfumery = _lookup_perfumery_data(material_name)
    if perfumery:
        data.odor_description = perfumery.get("odor_description", "")
        data.odor_type = perfumery.get("odor_type", "")
        data.odor_strength = perfumery.get("odor_strength", "")
        data.note_classification = perfumery.get("note_classification", "")
        data.tenacity = perfumery.get("tenacity", "")
        data.tenacity_hours = perfumery.get("tenacity_hours", "")
        data.ifra_guidelines = perfumery.get("ifra_guidelines", "")
        data.usage_levels = perfumery.get("usage_levels", "")
        data.blends_well_with = perfumery.get("blends_well_with", [])
        if perfumery.get("fema_number"):
            data.fema_number = perfumery["fema_number"]
        if perfumery.get("appearance") and not data.appearance:
            data.appearance = perfumery["appearance"]

    logger.info(f"Successfully extracted data for: {material_name} (CID: {cid})")
    return data
