"""
exporter.py  v3.1
=================
Two export formats:
  1. Human-readable Markdown — clean, visual, formatted
  2. AI-readable JSON — structured, machine-parseable, with metadata + instructions
"""

import json
from datetime import datetime
from scraper import MaterialData


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  1) Human-readable Markdown
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _row(label, value):
    return f"- **{label}:** {value}\n" if value else ""


def _list_items(label, items):
    if not items:
        return ""
    lines = f"- **{label}:**\n"
    for i in items:
        lines += f"  - {i}\n"
    return lines


def _material_md(mat):
    if not mat.found:
        return f"\n## {mat.name}\n\n> ⚠️ **Not Found:** {mat.error}\n\n---\n"

    md = f"\n## {mat.name}\n"
    if mat.page_url:
        md += f"\n🔗 [View on PubChem]({mat.page_url})\n"
    if mat.match_info:
        md += f"\n> {mat.match_info}\n"

    block = (
        _row("CAS Number", mat.cas_number)
        + _row("FEMA Number", mat.fema_number)
        + _row("IUPAC Name", mat.iupac_name)
        + _list_items("Synonyms", mat.synonyms)
    )
    if block.strip():
        md += "\n### Identifiers\n" + block

    block = (
        _row("SMILES", f"`{mat.smiles}`" if mat.smiles else "")
        + _row("Molecular Formula", mat.molecular_formula)
        + _row("Molecular Weight", mat.molecular_weight)
    )
    if mat.structure_image_url:
        block += f"- **Structure:** ![structure]({mat.structure_image_url})\n"
    if block.strip():
        md += "\n### Molecular Information\n" + block

    block = (
        _row("Odor Description", mat.odor_description)
        + _row("Odor Type", mat.odor_type)
        + _row("Odor Strength", mat.odor_strength)
    )
    if block.strip():
        md += "\n### Odor Profile\n" + block

    if mat.note_classification:
        md += "\n### Note Classification\n"
        md += f"- **Perfume Note:** {mat.note_classification}\n"

    block = _row("Tenacity", mat.tenacity) + _row("Duration", mat.tenacity_hours)
    if block.strip():
        md += "\n### Performance\n" + block

    block = (
        _row("Appearance", mat.appearance)
        + _row("Boiling Point", mat.boiling_point)
        + _row("Flash Point", mat.flash_point)
        + _row("Vapor Pressure", mat.vapor_pressure)
        + _row("Solubility", mat.solubility)
        + _row("Density", mat.density)
        + _row("Refractive Index", mat.refractive_index)
        + _row("LogP", mat.logp)
    )
    if block.strip():
        md += "\n### Physical & Chemical Properties\n" + block

    block = _row("IFRA Guidelines", mat.ifra_guidelines) + _row("Usage Levels", mat.usage_levels)
    if block.strip():
        md += "\n### Safety & Formulation\n" + block

    if mat.blends_well_with:
        md += "\n### Blending Suggestions\n"
        md += _list_items("Blends Well With", mat.blends_well_with)

    md += "\n---\n"
    return md


def generate_human_report(materials):
    """Generate clean Markdown for human readers."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    header = (
        "# 🧪 Perfume Raw Materials Analysis Report\n\n"
        f"**Generated:** {ts}  \n"
        f"**Materials analyzed:** {len(materials)}  \n"
        f"**Data source:** PubChem (NIH) + built-in perfumery DB  \n"
        "\n---\n"
    )
    toc = "\n## Table of Contents\n\n"
    for i, m in enumerate(materials, 1):
        icon = "✅" if m.found else "❌"
        toc += f"{i}. {icon} {m.name}\n"
    toc += "\n---\n"

    body = ""
    for m in materials:
        body += _material_md(m)

    footer = (
        "\n---\n*Report by Perfume Raw Materials Analyzer v3.1  \n"
        "Molecular data: PubChem (NIH) · "
        "Perfumery data: built-in DB (CAS-validated)*\n"
    )
    return header + toc + body + footer


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  2) AI-readable JSON
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _material_to_dict(mat):
    """Convert MaterialData → dict, skip empty fields."""
    if not mat.found:
        return {"name": mat.name, "found": False, "error": mat.error}

    d = {
        "name": mat.name,
        "found": True,
        "source_url": mat.page_url,
        "data_validation": {
            "perfumery_data_matched": mat.perfumery_matched,
            "match_method": mat.match_info,
        },
    }

    # Identifiers
    ids = {}
    if mat.cas_number:     ids["cas_number"] = mat.cas_number
    if mat.fema_number:    ids["fema_number"] = mat.fema_number
    if mat.iupac_name:     ids["iupac_name"] = mat.iupac_name
    if mat.synonyms:       ids["synonyms"] = mat.synonyms
    if ids: d["identifiers"] = ids

    # Molecular
    mol = {}
    if mat.smiles:              mol["smiles"] = mat.smiles
    if mat.molecular_formula:   mol["molecular_formula"] = mat.molecular_formula
    if mat.molecular_weight:    mol["molecular_weight"] = mat.molecular_weight
    if mat.inchi:               mol["inchi"] = mat.inchi
    if mat.structure_image_url: mol["structure_image_url"] = mat.structure_image_url
    if mol: d["molecular"] = mol

    # Odor
    odor = {}
    if mat.odor_description: odor["description"] = mat.odor_description
    if mat.odor_type:        odor["type"] = mat.odor_type
    if mat.odor_strength:    odor["strength"] = mat.odor_strength
    if odor: d["odor_profile"] = odor

    # Perfumery
    if mat.note_classification:
        d["perfumery"] = {"note_classification": mat.note_classification}

    # Performance
    perf = {}
    if mat.tenacity:       perf["tenacity"] = mat.tenacity
    if mat.tenacity_hours: perf["duration"] = mat.tenacity_hours
    if perf: d["performance"] = perf

    # Physical / chemical
    phys = {}
    for key, val in [
        ("appearance", mat.appearance),
        ("boiling_point", mat.boiling_point),
        ("flash_point", mat.flash_point),
        ("vapor_pressure", mat.vapor_pressure),
        ("solubility", mat.solubility),
        ("density", mat.density),
        ("refractive_index", mat.refractive_index),
        ("logp", mat.logp),
    ]:
        if val: phys[key] = val
    if phys: d["physical_chemical"] = phys

    # Safety
    safe = {}
    if mat.ifra_guidelines: safe["ifra_guidelines"] = mat.ifra_guidelines
    if mat.usage_levels:    safe["usage_levels"] = mat.usage_levels
    if safe: d["safety"] = safe

    # Blending
    if mat.blends_well_with:
        d["blending"] = {"blends_well_with": mat.blends_well_with}

    return d


def generate_ai_report(materials):
    """
    Generate structured JSON optimized for AI/LLM consumption.

    Features:
      - Schema version for future compatibility
      - Explicit data-source metadata per material
      - Instructions telling the AI how to interpret the data
      - No empty fields (saves tokens)
      - Clean snake_case keys
    """
    report = {
        "_meta": {
            "schema_version": "3.1",
            "format": "perfume_materials_analysis",
            "generated_at": datetime.now().isoformat(),
            "total_materials": len(materials),
            "found_count": sum(1 for m in materials if m.found),
            "data_sources": [
                {
                    "name": "PubChem",
                    "provides": "molecular structure, physical/chemical properties, identifiers",
                    "url": "https://pubchem.ncbi.nlm.nih.gov/",
                    "reliability": "high — NIH government database",
                },
                {
                    "name": "Built-in Perfumery DB",
                    "provides": "odor profile, note classification, tenacity, IFRA, blending",
                    "reliability": "curated — applied ONLY when CAS number is verified",
                },
            ],
            "instructions_for_ai": (
                "IMPORTANT RULES FOR INTERPRETING THIS DATA:\n"
                "1. Check 'data_validation.perfumery_data_matched' for each material.\n"
                "2. If TRUE: odor, notes, blending, and safety data are CAS-verified and reliable.\n"
                "3. If FALSE: ONLY molecular/physical data from PubChem is present. "
                "Do NOT invent or assume any odor, note, or blending properties.\n"
                "4. All physical/chemical data comes from PubChem and is factual.\n"
                "5. Perfumery data applies ONLY to the specific CAS number shown.\n"
                "6. When comparing materials, clearly state which properties are verified "
                "vs which materials lack perfumery data."
            ),
        },
        "materials": [_material_to_dict(m) for m in materials],
    }

    return json.dumps(report, indent=2, ensure_ascii=False)
