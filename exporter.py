"""
exporter.py  v3.0
=================
Markdown report generator with source tracking.
"""

from datetime import datetime
from scraper import MaterialData


def _row(label, value):
    return f"- **{label}:** {value}\n" if value else ""


def _list_items(label, items):
    if not items:
        return ""
    lines = f"- **{label}:**\n"
    for i in items:
        lines += f"  - {i}\n"
    return lines


def _material_section(mat):
    if not mat.found:
        return f"\n## {mat.name}\n\n> ⚠️ **Not Found:** {mat.error}\n\n---\n"

    md = f"\n## {mat.name}\n"
    if mat.page_url:
        md += f"\n🔗 [View on PubChem]({mat.page_url})\n"

    if mat.match_info:
        md += f"\n> {mat.match_info}\n"

    # Identifiers
    block = (
        _row("CAS Number", mat.cas_number)
        + _row("FEMA Number", mat.fema_number)
        + _row("IUPAC Name", mat.iupac_name)
        + _list_items("Synonyms", mat.synonyms)
    )
    if block.strip():
        md += "\n### Identifiers\n" + block

    # Molecular
    block = (
        _row("SMILES", f"`{mat.smiles}`" if mat.smiles else "")
        + _row("Molecular Formula", mat.molecular_formula)
        + _row("Molecular Weight", mat.molecular_weight)
    )
    if mat.structure_image_url:
        block += f"- **Structure:** ![structure]({mat.structure_image_url})\n"
    if block.strip():
        md += "\n### Molecular Information\n" + block

    # Odor (only if matched)
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

    # Physical
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


def generate_full_report(materials):
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
        body += _material_section(m)

    footer = (
        "\n---\n*Report by Perfume Raw Materials Analyzer v3.0  \n"
        "Molecular data: PubChem (NIH) · "
        "Perfumery data: built-in DB (CAS-validated)*\n"
    )
    return header + toc + body + footer
