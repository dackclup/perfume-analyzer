"""
scraper.py — Web scraper for The Good Scents Company database.

Navigates thegoodscentscompany.com, searches for aroma chemicals by name,
and extracts structured chemical/perfumery data from their detail pages.
"""

import re
import time
import logging
from typing import Optional
from dataclasses import dataclass, field

import requests
from bs4 import BeautifulSoup, Tag

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_URL = "http://www.thegoodscentscompany.com"
SEARCH_URL = f"{BASE_URL}/search3.php"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Referer": BASE_URL,
}

REQUEST_TIMEOUT = 30
DELAY_BETWEEN_REQUESTS = 2.0  # Be polite to the server


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
    synonyms: list = field(default_factory=list)

    # Molecular
    smiles: str = ""
    molecular_formula: str = ""
    molecular_weight: str = ""
    structure_image_url: str = ""

    # Odor profile
    odor_description: str = ""
    odor_type: str = ""
    odor_strength: str = ""

    # Perfumery classification
    note_classification: str = ""  # Top / Middle / Base

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
    session.headers.update(HEADERS)
    return session


def _clean_text(text: str) -> str:
    """Normalize whitespace in scraped text."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def _find_detail_url(session: requests.Session, material_name: str) -> Optional[str]:
    """
    Search thegoodscentscompany.com for a material and return the detail page URL.

    The site's search form posts to search3.php with the query in `qName`.
    Results are returned as a page of links; we pick the best match.
    """
    # Strategy 1: Direct search via the site's search endpoint
    try:
        params = {"qName": material_name}
        resp = session.get(SEARCH_URL, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")

        # Look for result links pointing to detail pages (pattern: /data/rw*.html)
        links = soup.find_all("a", href=re.compile(r"/data/rw\d+\.html"))
        if links:
            # Prefer exact name match, fall back to first result
            name_lower = material_name.lower()
            for link in links:
                link_text = _clean_text(link.get_text()).lower()
                if name_lower in link_text or link_text in name_lower:
                    return BASE_URL + link["href"]
            return BASE_URL + links[0]["href"]

        # Also check for links with pattern like /data/ that match differently
        all_data_links = soup.find_all("a", href=re.compile(r"/data/"))
        for link in all_data_links:
            href = link.get("href", "")
            if href.endswith(".html"):
                link_text = _clean_text(link.get_text()).lower()
                if name_lower in link_text:
                    if href.startswith("/"):
                        return BASE_URL + href
                    elif href.startswith("http"):
                        return href

    except requests.RequestException as e:
        logger.warning(f"Search request failed for '{material_name}': {e}")

    # Strategy 2: Try common URL patterns directly
    slug = material_name.lower().replace(" ", "-").replace("(", "").replace(")", "")
    guess_patterns = [
        f"{BASE_URL}/data/rw{slug}.html",
    ]
    for url in guess_patterns:
        try:
            resp = session.head(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            if resp.status_code == 200:
                return url
        except requests.RequestException:
            continue

    return None


def _extract_table_value(soup: BeautifulSoup, label_pattern: str) -> str:
    """
    Find a table cell whose text matches `label_pattern` (case-insensitive regex)
    and return the text of the next sibling cell.

    The Good Scents Company stores most data in two-column HTML tables:
        <tr><td>Label</td><td>Value</td></tr>
    """
    pattern = re.compile(label_pattern, re.IGNORECASE)

    for td in soup.find_all("td"):
        text = _clean_text(td.get_text())
        if pattern.search(text):
            # Get the next <td> sibling
            next_td = td.find_next_sibling("td")
            if next_td:
                return _clean_text(next_td.get_text())

            # Sometimes it's in the next <tr>
            parent_tr = td.find_parent("tr")
            if parent_tr:
                next_tr = parent_tr.find_next_sibling("tr")
                if next_tr:
                    tds = next_tr.find_all("td")
                    if tds:
                        return _clean_text(tds[-1].get_text())
    return ""


def _extract_list_after_label(soup: BeautifulSoup, label_pattern: str) -> list:
    """Extract a list of items from text following a label."""
    pattern = re.compile(label_pattern, re.IGNORECASE)

    for td in soup.find_all("td"):
        text = _clean_text(td.get_text())
        if pattern.search(text):
            next_td = td.find_next_sibling("td")
            if next_td:
                raw = _clean_text(next_td.get_text())
                # Split on common delimiters
                items = re.split(r"[,;]\s*", raw)
                return [item.strip() for item in items if item.strip()]
    return []


def _extract_structure_image_url(soup: BeautifulSoup) -> str:
    """Find the molecular structure image URL on the page."""
    # Look for images in /png/ directory or with 'structure' in alt/src
    for img in soup.find_all("img"):
        src = img.get("src", "")
        alt = img.get("alt", "").lower()

        if "/png/" in src or "structure" in alt or "molecule" in alt:
            if src.startswith("/"):
                return BASE_URL + src
            elif src.startswith("http"):
                return src
            else:
                return BASE_URL + "/" + src

    # Fallback: look for any .png in data-related directories
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if src.endswith(".png") and ("data" in src or "mol" in src.lower()):
            if src.startswith("/"):
                return BASE_URL + src
            elif src.startswith("http"):
                return src
    return ""


def _extract_odor_strength(soup: BeautifulSoup) -> str:
    """Extract odor strength, which is sometimes in a special format."""
    strength = _extract_table_value(soup, r"odor\s*strength")
    if strength:
        return strength

    # Sometimes shown as a descriptor like "medium" near odor section
    for td in soup.find_all("td"):
        text = _clean_text(td.get_text()).lower()
        if "strength" in text:
            # Check for strength descriptors
            for level in ["low", "medium", "high", "very high", "diffusive"]:
                if level in text:
                    return level.title()
    return ""


def _extract_note_classification(soup: BeautifulSoup) -> str:
    """Determine if the material is a top, middle/heart, or base note."""
    # Check direct label
    note = _extract_table_value(soup, r"note|classification")
    if note:
        return note

    # Search entire page text for note classification keywords
    page_text = soup.get_text().lower()

    classifications = []
    if re.search(r"\btop\s*note\b", page_text):
        classifications.append("Top")
    if re.search(r"\b(middle|heart)\s*note\b", page_text):
        classifications.append("Middle/Heart")
    if re.search(r"\bbase\s*note\b", page_text):
        classifications.append("Base")

    return " / ".join(classifications) if classifications else ""


def _extract_tenacity(soup: BeautifulSoup) -> tuple:
    """Extract tenacity description and hour duration."""
    tenacity_text = _extract_table_value(
        soup, r"tenacity|substantivity|lasting|duration"
    )

    hours = ""
    if tenacity_text:
        # Try to extract hour values like "400 hours" or "400 hr"
        match = re.search(r"(\d+[\.\d]*)\s*(hours?|hrs?|h\b)", tenacity_text, re.I)
        if match:
            hours = f"{match.group(1)} hours"

    return tenacity_text, hours


def _extract_blends_well_with(soup: BeautifulSoup) -> list:
    """Extract the 'blends well with' materials list."""
    items = _extract_list_after_label(soup, r"blends?\s*(well\s*)?with")
    if items:
        return items

    # Extended search: look for a section header then collect items
    page_text = soup.get_text()
    match = re.search(
        r"blends?\s*(?:well\s*)?with[:\s]*(.*?)(?:\n\n|\Z)",
        page_text, re.IGNORECASE | re.DOTALL
    )
    if match:
        raw = match.group(1)
        items = re.split(r"[,;\n]+", raw)
        return [item.strip() for item in items if item.strip() and len(item.strip()) > 2]

    return []


def _extract_synonyms(soup: BeautifulSoup) -> list:
    """Extract synonym and trade name lists."""
    synonyms = _extract_list_after_label(soup, r"synonym|other\s*name|trade\s*name")
    if not synonyms:
        synonyms = _extract_list_after_label(soup, r"alias|also\s*known")
    return synonyms


def _extract_usage_levels(soup: BeautifulSoup) -> str:
    """Extract recommended usage levels in fragrance."""
    usage = _extract_table_value(soup, r"usage|use\s*level|concentration|dosage")
    if not usage:
        usage = _extract_table_value(soup, r"recommended.*level")
    return usage


def _extract_ifra(soup: BeautifulSoup) -> str:
    """Extract IFRA restriction/guideline information."""
    ifra = _extract_table_value(soup, r"ifra|restriction|safety|regulation")
    if not ifra:
        # Look for IFRA mentions in the page
        page_text = soup.get_text()
        match = re.search(
            r"IFRA[:\s]*(.*?)(?:\n|\.(?:\s|$))",
            page_text, re.IGNORECASE
        )
        if match:
            ifra = _clean_text(match.group(1))
    return ifra


def scrape_material(material_name: str, session: Optional[requests.Session] = None) -> MaterialData:
    """
    Main entry point: search for a material and extract all available data.

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

    # --- Step 1: Find the detail page ---
    logger.info(f"Searching for: {material_name}")
    detail_url = _find_detail_url(session, material_name)

    if not detail_url:
        data.error = f"Could not find '{material_name}' in The Good Scents Company database."
        logger.warning(data.error)
        return data

    data.page_url = detail_url

    # --- Step 2: Fetch the detail page ---
    time.sleep(DELAY_BETWEEN_REQUESTS)
    try:
        resp = session.get(detail_url, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        data.error = f"Failed to load detail page for '{material_name}': {e}"
        logger.error(data.error)
        return data

    soup = BeautifulSoup(resp.text, "lxml")
    data.found = True

    # --- Step 3: Extract all fields ---

    # Identifiers
    data.cas_number = _extract_table_value(soup, r"cas\s*number|cas\s*#|cas\b")
    data.fema_number = _extract_table_value(soup, r"fema\s*(number|#|no)")
    data.synonyms = _extract_synonyms(soup)

    # Molecular information
    data.smiles = _extract_table_value(soup, r"smiles|canonical\s*smiles")
    data.molecular_formula = _extract_table_value(soup, r"molecular\s*formula|formula")
    data.molecular_weight = _extract_table_value(soup, r"molecular\s*weight|mol\.?\s*wt")
    data.structure_image_url = _extract_structure_image_url(soup)

    # Odor profile
    data.odor_description = _extract_table_value(soup, r"odor\s*(description|character)")
    if not data.odor_description:
        data.odor_description = _extract_table_value(soup, r"^odor$")
    data.odor_type = _extract_table_value(soup, r"odor\s*type")
    data.odor_strength = _extract_odor_strength(soup)

    # Note classification
    data.note_classification = _extract_note_classification(soup)

    # Performance
    data.tenacity, data.tenacity_hours = _extract_tenacity(soup)

    # Physical / chemical properties
    data.appearance = _extract_table_value(soup, r"appearance|physical\s*form|color")
    data.boiling_point = _extract_table_value(soup, r"boiling\s*point|bp\b")
    data.flash_point = _extract_table_value(soup, r"flash\s*point|fp\b")
    data.vapor_pressure = _extract_table_value(soup, r"vapor\s*pressure|vp\b")
    data.solubility = _extract_table_value(soup, r"solubility|soluble")
    data.specific_gravity = _extract_table_value(soup, r"specific\s*gravity|density|sg\b")
    data.refractive_index = _extract_table_value(soup, r"refractive\s*index|ri\b")
    data.logp = _extract_table_value(soup, r"log\s*p|logp|partition")

    # Safety & formulation
    data.ifra_guidelines = _extract_ifra(soup)
    data.usage_levels = _extract_usage_levels(soup)

    # Blending
    data.blends_well_with = _extract_blends_well_with(soup)

    logger.info(f"Successfully extracted data for: {material_name}")
    return data
