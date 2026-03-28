"""
exporter.py  v5.0 — PDF (human) + JSON (AI) with ALL PubChem sections
"""

import io
import json
from datetime import datetime
from collections import OrderedDict
from scraper import MaterialData

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable,
)

PRIMARY   = HexColor("#1e3a5f")
ACCENT    = HexColor("#2c7be5")
LIGHT_BG  = HexColor("#f0f4f8")
BORDER    = HexColor("#d1d9e6")
TEXT_DARK = HexColor("#1a1a2e")
TEXT_MID  = HexColor("#4a5568")
NOTE_TOP  = HexColor("#fef3c7")
NOTE_MID  = HexColor("#dbeafe")
NOTE_BASE = HexColor("#e0e7ff")


def _build_styles():
    ss = getSampleStyleSheet()
    adds = [
        ("RTitle", "Title", 22, PRIMARY, 4, "Helvetica-Bold"),
        ("RSub",   "Normal", 10, TEXT_MID, 6, "Helvetica"),
        ("MName",  "Heading1", 16, PRIMARY, 3, "Helvetica-Bold"),
        ("SecH",   "Heading2", 11, ACCENT, 2, "Helvetica-Bold"),
        ("SubSecH","Normal", 10, HexColor("#3b82f6"), 2, "Helvetica-Bold"),
        ("Body9",  "Normal", 9, TEXT_DARK, 0, "Helvetica"),
        ("Small",  "Normal", 8, TEXT_MID, 0, "Helvetica"),
        ("PLabel", "Normal", 9, TEXT_MID, 0, "Helvetica-Bold"),
        ("PValue", "Normal", 9, TEXT_DARK, 0, "Helvetica"),
        ("TOC",    "Normal", 10, TEXT_DARK, 1, "Helvetica"),
    ]
    for name, parent, size, color, after, font in adds:
        ss.add(ParagraphStyle(name, parent=ss[parent], fontSize=size,
               textColor=color, spaceAfter=after*mm, fontName=font))
    ss.add(ParagraphStyle("NBadge", parent=ss["Normal"], fontSize=9,
           fontName="Helvetica-Bold", alignment=TA_CENTER))
    ss.add(ParagraphStyle("Foot", parent=ss["Normal"], fontSize=7,
           textColor=TEXT_MID, alignment=TA_CENTER))
    return ss

_S = _build_styles()


def _hr():
    return HRFlowable(width="100%", thickness=0.5, color=BORDER,
                      spaceBefore=3*mm, spaceAfter=3*mm)

def _prop_table(pairs, cw=None):
    filtered = [(l, v) for l, v in pairs if v]
    if not filtered:
        return None
    if cw is None:
        cw = [45*mm, 110*mm]
    data = [[Paragraph(f"<b>{l}</b>", _S["PLabel"]),
             Paragraph(str(v), _S["PValue"])] for l, v in filtered]
    t = Table(data, colWidths=cw, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("TOPPADDING", (0,0), (-1,-1), 2),
        ("BOTTOMPADDING", (0,0), (-1,-1), 2),
        ("LEFTPADDING", (0,0), (0,-1), 0),
        ("LINEBELOW", (0,0), (-1,-2), 0.3, BORDER),
    ]))
    return t

def _note_badges(note_str):
    nl = note_str.lower()
    badges = []
    if "top" in nl:    badges.append(("Top Note", NOTE_TOP, "#92400e"))
    if "middle" in nl or "heart" in nl: badges.append(("Middle/Heart", NOTE_MID, "#1e40af"))
    if "base" in nl:   badges.append(("Base Note", NOTE_BASE, "#3730a3"))
    if not badges:
        return Paragraph(note_str, _S["Body9"])
    cells = [Paragraph(f'<font color="{c}">{t}</font>', _S["NBadge"])
             for t, _, c in badges]
    tab = Table([cells], colWidths=[35*mm]*len(cells), hAlign="LEFT")
    cmds = [("VALIGN",(0,0),(-1,-1),"MIDDLE"),
            ("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3)]
    for i,(_, bg, _) in enumerate(badges):
        cmds.append(("BACKGROUND",(i,0),(i,0), bg))
    tab.setStyle(TableStyle(cmds))
    return tab

def _page_tmpl(c, doc):
    c.saveState()
    w, h = A4
    c.setFillColor(PRIMARY)
    c.rect(0, h-8*mm, w, 8*mm, fill=1, stroke=0)
    c.setStrokeColor(BORDER); c.setLineWidth(0.5)
    c.line(15*mm, 12*mm, w-15*mm, 12*mm)
    c.setFont("Helvetica", 7); c.setFillColor(TEXT_MID)
    c.drawCentredString(w/2, 7*mm, f"Perfume Raw Materials Analyzer v5.0  |  Page {doc.page}")
    c.drawRightString(w-15*mm, 7*mm, datetime.now().strftime("%Y-%m-%d"))
    c.restoreState()


def _build_material(mat):
    els = []
    if not mat.found:
        els.append(Paragraph(mat.name, _S["MName"]))
        els.append(Paragraph(f'<font color="#e74c3c">Not Found: {mat.error}</font>', _S["Body9"]))
        return els

    els.append(Paragraph(mat.name, _S["MName"]))
    if mat.match_info:
        els.append(Paragraph(mat.match_info, _S["Small"]))
        els.append(Spacer(1, 2*mm))

    # Identifiers
    t = _prop_table([("CAS Number", mat.cas_number), ("FEMA Number", mat.fema_number),
        ("IUPAC Name", mat.iupac_name), ("Molecular Formula", mat.molecular_formula),
        ("Molecular Weight", mat.molecular_weight), ("SMILES", mat.smiles)])
    if t:
        els.append(Paragraph("Identifiers & Molecular Data", _S["SecH"]))
        els.append(t)
    if mat.synonyms:
        els.append(Paragraph(f'<b>Synonyms:</b> {", ".join(mat.synonyms[:8])}', _S["Body9"]))

    # Odor
    if any([mat.odor_description, mat.odor_type, mat.odor_strength]):
        els.append(Paragraph("Odor Profile", _S["SecH"]))
        t = _prop_table([("Description", mat.odor_description),
            ("Type", mat.odor_type), ("Strength", mat.odor_strength)])
        if t: els.append(t)

    # Note
    if mat.note_classification:
        els.append(Paragraph("Note Classification", _S["SecH"]))
        els.append(_note_badges(mat.note_classification))

    # Performance
    if mat.tenacity or mat.tenacity_hours:
        els.append(Paragraph("Performance", _S["SecH"]))
        t = _prop_table([("Tenacity", mat.tenacity), ("Duration", mat.tenacity_hours)])
        if t: els.append(t)

    # Safety
    if mat.ifra_guidelines or mat.usage_levels:
        els.append(Paragraph("Safety & Formulation", _S["SecH"]))
        t = _prop_table([("IFRA Guidelines", mat.ifra_guidelines),
                         ("Usage Levels", mat.usage_levels)])
        if t: els.append(t)

    # Blending
    if mat.blends_well_with:
        els.append(Paragraph("Blending Suggestions", _S["SecH"]))
        els.append(Paragraph(f'<b>Blends well with:</b> {", ".join(mat.blends_well_with)}', _S["Body9"]))

    els.append(_hr())

    # ── ALL PubChem sections ──
    if mat.pubchem_sections:
        els.append(Paragraph("Complete PubChem Data", _S["SecH"]))
        els.append(Spacer(1, 2*mm))

        for heading, items in mat.pubchem_sections.items():
            # Use subsection style for nested headings
            display_heading = heading.split(" > ")[-1] if " > " in heading else heading
            parent = heading.split(" > ")[0] if " > " in heading else ""

            if parent:
                els.append(Paragraph(f"{parent} &gt; {display_heading}", _S["SubSecH"]))
            else:
                els.append(Paragraph(display_heading, _S["SubSecH"]))

            for item in items:
                # Truncate very long items for PDF
                text = item if len(item) <= 400 else item[:400] + "…"
                els.append(Paragraph(text, _S["Body9"]))
            els.append(Spacer(1, 2*mm))

    # Source
    if mat.page_url:
        els.append(Spacer(1, 2*mm))
        hex_accent = ACCENT.hexval()[2:]
        els.append(Paragraph(
            f'<font color="#{hex_accent}">Source: {mat.page_url}</font>', _S["Small"]))

    return els


def generate_human_report(materials):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
        topMargin=18*mm, bottomMargin=18*mm, leftMargin=18*mm, rightMargin=18*mm,
        title="Perfume Raw Materials Analysis", author="Perfume Analyzer")

    story = []
    ts = datetime.now().strftime("%d %B %Y, %H:%M")
    found_count = sum(1 for m in materials if m.found)

    story.append(Spacer(1, 10*mm))
    story.append(Paragraph("Perfume Raw Materials", _S["RTitle"]))
    story.append(Paragraph("Analysis Report", _S["RTitle"]))
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph(
        f"Generated: {ts} &bull; Materials: {len(materials)} &bull; Found: {found_count}",
        _S["RSub"]))
    story.append(Paragraph(
        "Data: PubChem (NIH) — full compound record + perfumery DB (CAS-validated)",
        _S["RSub"]))
    story.append(_hr())

    story.append(Paragraph("Table of Contents", _S["SecH"]))
    for i, m in enumerate(materials, 1):
        icon = "[OK]" if m.found else "[--]"
        story.append(Paragraph(f"{i}. {icon}  {m.name}", _S["TOC"]))
    story.append(_hr())

    for mat in materials:
        story.append(PageBreak())
        story.extend(_build_material(mat))

    story.append(Spacer(1, 6*mm))
    story.append(Paragraph(
        "Report by Perfume Raw Materials Analyzer v5.0<br/>"
        "Full PubChem compound record + CAS-validated perfumery database",
        _S["Foot"]))

    doc.build(story, onFirstPage=_page_tmpl, onLaterPages=_page_tmpl)
    return buf.getvalue()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  JSON for AI
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _material_to_dict(mat):
    if not mat.found:
        return {"name": mat.name, "found": False, "error": mat.error}

    d = {"name": mat.name, "found": True, "source_url": mat.page_url,
         "data_validation": {"perfumery_matched": mat.perfumery_matched,
                             "method": mat.match_info}}

    ids = {}
    if mat.cas_number:  ids["cas_number"] = mat.cas_number
    if mat.fema_number: ids["fema_number"] = mat.fema_number
    if mat.iupac_name:  ids["iupac_name"] = mat.iupac_name
    if mat.synonyms:    ids["synonyms"] = mat.synonyms
    if ids: d["identifiers"] = ids

    mol = {}
    if mat.smiles:            mol["smiles"] = mat.smiles
    if mat.molecular_formula: mol["formula"] = mat.molecular_formula
    if mat.molecular_weight:  mol["weight"] = mat.molecular_weight
    if mat.inchi:             mol["inchi"] = mat.inchi
    if mol: d["molecular"] = mol

    odor = {}
    if mat.odor_description: odor["description"] = mat.odor_description
    if mat.odor_type:        odor["type"] = mat.odor_type
    if mat.odor_strength:    odor["strength"] = mat.odor_strength
    if odor: d["odor_profile"] = odor

    if mat.note_classification:
        d["perfumery"] = {"note": mat.note_classification}
    perf = {}
    if mat.tenacity:       perf["tenacity"] = mat.tenacity
    if mat.tenacity_hours: perf["duration"] = mat.tenacity_hours
    if perf: d["performance"] = perf

    safe = {}
    if mat.ifra_guidelines: safe["ifra"] = mat.ifra_guidelines
    if mat.usage_levels:    safe["usage"] = mat.usage_levels
    if safe: d["safety"] = safe
    if mat.blends_well_with:
        d["blending"] = mat.blends_well_with

    # ALL PubChem sections
    if mat.pubchem_sections:
        d["pubchem_full_data"] = dict(mat.pubchem_sections)

    return d


def generate_ai_report(materials):
    report = {
        "_meta": {
            "schema": "5.0",
            "generated": datetime.now().isoformat(),
            "total": len(materials),
            "found": sum(1 for m in materials if m.found),
            "sources": ["PubChem (NIH) — full compound record", "Perfumery DB (CAS-validated)"],
            "ai_instructions": (
                "1) Check data_validation.perfumery_matched per material. "
                "2) If true: odor/notes/blending are CAS-verified. "
                "3) If false: only PubChem data — do NOT hallucinate perfumery data. "
                "4) pubchem_full_data contains ALL sections from PubChem PUG View."
            ),
        },
        "materials": [_material_to_dict(m) for m in materials],
    }
    return json.dumps(report, indent=2, ensure_ascii=False)
