"""
exporter.py  v4.0
=================
Two export formats:
  1. Human-readable PDF — professional layout, print-ready
  2. AI-readable JSON — structured, machine-parseable
"""

import io
import json
from datetime import datetime
from scraper import MaterialData

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether, Image,
)
from reportlab.pdfbase import pdfmetrics


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Color palette
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PRIMARY    = HexColor("#1e3a5f")   # Dark navy
ACCENT     = HexColor("#2c7be5")   # Bright blue
SUCCESS    = HexColor("#00a86b")   # Green
WARNING    = HexColor("#e67e22")   # Orange
LIGHT_BG   = HexColor("#f0f4f8")   # Light gray-blue
BORDER     = HexColor("#d1d9e6")   # Border gray
TEXT_DARK  = HexColor("#1a1a2e")   # Near black
TEXT_MID   = HexColor("#4a5568")   # Gray
NOTE_TOP   = HexColor("#fef3c7")   # Yellow
NOTE_MID   = HexColor("#dbeafe")   # Blue
NOTE_BASE  = HexColor("#e0e7ff")   # Indigo


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Custom styles
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _build_styles():
    ss = getSampleStyleSheet()

    ss.add(ParagraphStyle(
        "ReportTitle", parent=ss["Title"],
        fontSize=22, textColor=PRIMARY, spaceAfter=4*mm,
        fontName="Helvetica-Bold",
    ))
    ss.add(ParagraphStyle(
        "ReportSubtitle", parent=ss["Normal"],
        fontSize=10, textColor=TEXT_MID, spaceAfter=6*mm,
    ))
    ss.add(ParagraphStyle(
        "MatName", parent=ss["Heading1"],
        fontSize=16, textColor=PRIMARY, spaceBefore=6*mm, spaceAfter=3*mm,
        fontName="Helvetica-Bold",
    ))
    ss.add(ParagraphStyle(
        "SectionHead", parent=ss["Heading2"],
        fontSize=11, textColor=ACCENT, spaceBefore=5*mm, spaceAfter=2*mm,
        fontName="Helvetica-Bold",
    ))
    ss.add(ParagraphStyle(
        "Body9", parent=ss["Normal"],
        fontSize=9, textColor=TEXT_DARK, leading=13,
        fontName="Helvetica",
    ))
    ss.add(ParagraphStyle(
        "SmallGray", parent=ss["Normal"],
        fontSize=8, textColor=TEXT_MID, leading=11,
    ))
    ss.add(ParagraphStyle(
        "PropLabel", parent=ss["Normal"],
        fontSize=9, textColor=TEXT_MID, fontName="Helvetica-Bold",
    ))
    ss.add(ParagraphStyle(
        "PropValue", parent=ss["Normal"],
        fontSize=9, textColor=TEXT_DARK,
    ))
    ss.add(ParagraphStyle(
        "NoteBadge", parent=ss["Normal"],
        fontSize=9, fontName="Helvetica-Bold", alignment=TA_CENTER,
    ))
    ss.add(ParagraphStyle(
        "Footer", parent=ss["Normal"],
        fontSize=7, textColor=TEXT_MID, alignment=TA_CENTER,
    ))
    ss.add(ParagraphStyle(
        "TOCEntry", parent=ss["Normal"],
        fontSize=10, textColor=TEXT_DARK, spaceBefore=1*mm,
        leftIndent=5*mm,
    ))
    return ss


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Helper functions
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _prop_table(pairs, col_widths=None):
    """Build a two-column property table from (label, value) pairs."""
    filtered = [(l, v) for l, v in pairs if v]
    if not filtered:
        return None

    if col_widths is None:
        col_widths = [45*mm, 110*mm]

    data = []
    for label, value in filtered:
        data.append([
            Paragraph(f"<b>{label}</b>", _styles["PropLabel"]),
            Paragraph(str(value), _styles["PropValue"]),
        ])

    t = Table(data, colWidths=col_widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (0, -1), 0),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, BORDER),
    ]))
    return t


def _section(title, icon=""):
    """Section heading with optional icon."""
    text = f"{icon}  {title}" if icon else title
    return Paragraph(text, _styles["SectionHead"])


def _note_badge_table(note_str):
    """Render note classification as colored badge(s)."""
    nl = note_str.lower()
    badges = []
    if "top" in nl:
        badges.append(("Top Note", NOTE_TOP, HexColor("#92400e")))
    if "middle" in nl or "heart" in nl:
        badges.append(("Middle / Heart", NOTE_MID, HexColor("#1e40af")))
    if "base" in nl:
        badges.append(("Base Note", NOTE_BASE, HexColor("#3730a3")))

    if not badges:
        return Paragraph(note_str, _styles["Body9"])

    cells = []
    for text, bg, fg in badges:
        cells.append(Paragraph(
            f'<font color="#{fg.hexval()[2:]}">{text}</font>',
            _styles["NoteBadge"],
        ))

    t = Table([cells], colWidths=[35*mm]*len(cells), hAlign="LEFT")
    style_cmds = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    for i, (_, bg, _) in enumerate(badges):
        style_cmds.append(("BACKGROUND", (i, 0), (i, 0), bg))
        style_cmds.append(("ROUNDEDCORNERS", [4, 4, 4, 4]))

    t.setStyle(TableStyle(style_cmds))
    return t


def _hr():
    return HRFlowable(width="100%", thickness=0.5, color=BORDER,
                      spaceBefore=3*mm, spaceAfter=3*mm)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Page template with header/footer
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _page_template(canvas_obj, doc):
    """Draw header stripe and footer on every page."""
    canvas_obj.saveState()
    w, h = A4

    # Top accent stripe
    canvas_obj.setFillColor(PRIMARY)
    canvas_obj.rect(0, h - 8*mm, w, 8*mm, fill=1, stroke=0)

    # Footer line
    canvas_obj.setStrokeColor(BORDER)
    canvas_obj.setLineWidth(0.5)
    canvas_obj.line(15*mm, 12*mm, w - 15*mm, 12*mm)

    # Footer text
    canvas_obj.setFont("Helvetica", 7)
    canvas_obj.setFillColor(TEXT_MID)
    canvas_obj.drawCentredString(
        w / 2, 7*mm,
        f"Perfume Raw Materials Analyzer v4.0  |  Page {doc.page}"
    )
    canvas_obj.drawRightString(
        w - 15*mm, 7*mm,
        datetime.now().strftime("%Y-%m-%d")
    )

    canvas_obj.restoreState()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Build material section
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _build_material(mat):
    """Build flowable elements for one material."""
    elements = []

    if not mat.found:
        elements.append(Paragraph(f"{mat.name}", _styles["MatName"]))
        elements.append(Paragraph(
            f'<font color="#e74c3c">Not Found: {mat.error}</font>',
            _styles["Body9"],
        ))
        elements.append(_hr())
        return elements

    # ── Material name ──
    elements.append(Paragraph(mat.name, _styles["MatName"]))

    # ── Validation status ──
    if mat.match_info:
        elements.append(Paragraph(mat.match_info, _styles["SmallGray"]))
        elements.append(Spacer(1, 2*mm))

    # ── Identifiers ──
    id_pairs = [
        ("CAS Number", mat.cas_number),
        ("FEMA Number", mat.fema_number),
        ("IUPAC Name", mat.iupac_name),
        ("Molecular Formula", mat.molecular_formula),
        ("Molecular Weight", mat.molecular_weight),
        ("SMILES", mat.smiles),
    ]
    t = _prop_table(id_pairs)
    if t:
        elements.append(_section("Identifiers & Molecular Data"))
        elements.append(t)

    if mat.synonyms:
        elements.append(Spacer(1, 1*mm))
        syn_text = ", ".join(mat.synonyms[:8])
        elements.append(Paragraph(
            f'<b>Synonyms:</b> {syn_text}', _styles["Body9"]
        ))

    # ── Odor Profile ──
    if any([mat.odor_description, mat.odor_type, mat.odor_strength]):
        elements.append(_section("Odor Profile"))

        odor_pairs = [
            ("Description", mat.odor_description),
            ("Type", mat.odor_type),
            ("Strength", mat.odor_strength),
        ]
        t = _prop_table(odor_pairs)
        if t:
            elements.append(t)

    # ── Note Classification ──
    if mat.note_classification:
        elements.append(_section("Note Classification"))
        elements.append(_note_badge_table(mat.note_classification))

    # ── Performance ──
    if mat.tenacity or mat.tenacity_hours:
        elements.append(_section("Performance"))
        t = _prop_table([
            ("Tenacity", mat.tenacity),
            ("Duration", mat.tenacity_hours),
        ])
        if t:
            elements.append(t)

    # ── Physical & Chemical ──
    phys_pairs = [
        ("Appearance", mat.appearance),
        ("Boiling Point", mat.boiling_point),
        ("Flash Point", mat.flash_point),
        ("Vapor Pressure", mat.vapor_pressure),
        ("Solubility", mat.solubility),
        ("Density", mat.density),
        ("Refractive Index", mat.refractive_index),
        ("LogP", mat.logp),
    ]
    if any(v for _, v in phys_pairs):
        elements.append(_section("Physical & Chemical Properties"))
        t = _prop_table(phys_pairs)
        if t:
            elements.append(t)

    # ── Safety ──
    if mat.ifra_guidelines or mat.usage_levels:
        elements.append(_section("Safety & Formulation"))
        t = _prop_table([
            ("IFRA Guidelines", mat.ifra_guidelines),
            ("Usage Levels", mat.usage_levels),
        ])
        if t:
            elements.append(t)

    # ── Blending ──
    if mat.blends_well_with:
        elements.append(_section("Blending Suggestions"))
        blend_text = ", ".join(mat.blends_well_with)
        elements.append(Paragraph(
            f'<b>Blends well with:</b> {blend_text}',
            _styles["Body9"],
        ))

    # ── Source link ──
    if mat.page_url:
        elements.append(Spacer(1, 2*mm))
        elements.append(Paragraph(
            f'<font color="#{ACCENT.hexval()[2:]}">PubChem: {mat.page_url}</font>',
            _styles["SmallGray"],
        ))

    elements.append(_hr())
    return elements


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  1) PDF generation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_styles = _build_styles()


def generate_human_report(materials):
    """Generate a professional, print-ready PDF report."""
    buf = io.BytesIO()

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=18*mm,
        bottomMargin=18*mm,
        leftMargin=18*mm,
        rightMargin=18*mm,
        title="Perfume Raw Materials Analysis",
        author="Perfume Raw Materials Analyzer",
    )

    story = []
    ts = datetime.now().strftime("%d %B %Y, %H:%M")
    found_count = sum(1 for m in materials if m.found)

    # ── Cover / Title ──
    story.append(Spacer(1, 10*mm))
    story.append(Paragraph("Perfume Raw Materials", _styles["ReportTitle"]))
    story.append(Paragraph("Analysis Report", _styles["ReportTitle"]))
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph(
        f"Generated: {ts}  &bull;  "
        f"Materials: {len(materials)}  &bull;  "
        f"Found: {found_count}",
        _styles["ReportSubtitle"],
    ))
    story.append(Paragraph(
        "Data sources: PubChem (NIH) + Built-in Perfumery Database (CAS-validated)",
        _styles["ReportSubtitle"],
    ))
    story.append(_hr())

    # ── Table of Contents ──
    story.append(Paragraph("Table of Contents", _styles["SectionHead"]))
    story.append(Spacer(1, 2*mm))
    for i, m in enumerate(materials, 1):
        icon = "[OK]" if m.found else "[--]"
        story.append(Paragraph(
            f"{i}. {icon}  {m.name}",
            _styles["TOCEntry"],
        ))
    story.append(_hr())
    story.append(Spacer(1, 4*mm))

    # ── Material sections (each on its own page) ──
    for i, mat in enumerate(materials):
        if i > 0:
            story.append(PageBreak())
        elems = _build_material(mat)
        story.extend(elems)

    # ── Final footer ──
    story.append(Spacer(1, 6*mm))
    story.append(Paragraph(
        "Report generated by Perfume Raw Materials Analyzer v4.0<br/>"
        "Molecular data: PubChem (NIH) &bull; "
        "Perfumery data: built-in database (CAS-validated)",
        _styles["Footer"],
    ))

    doc.build(story, onFirstPage=_page_template, onLaterPages=_page_template)
    return buf.getvalue()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  2) AI-readable JSON
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _material_to_dict(mat):
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

    ids = {}
    if mat.cas_number:     ids["cas_number"] = mat.cas_number
    if mat.fema_number:    ids["fema_number"] = mat.fema_number
    if mat.iupac_name:     ids["iupac_name"] = mat.iupac_name
    if mat.synonyms:       ids["synonyms"] = mat.synonyms
    if ids: d["identifiers"] = ids

    mol = {}
    if mat.smiles:              mol["smiles"] = mat.smiles
    if mat.molecular_formula:   mol["molecular_formula"] = mat.molecular_formula
    if mat.molecular_weight:    mol["molecular_weight"] = mat.molecular_weight
    if mat.inchi:               mol["inchi"] = mat.inchi
    if mat.structure_image_url: mol["structure_image_url"] = mat.structure_image_url
    if mol: d["molecular"] = mol

    odor = {}
    if mat.odor_description: odor["description"] = mat.odor_description
    if mat.odor_type:        odor["type"] = mat.odor_type
    if mat.odor_strength:    odor["strength"] = mat.odor_strength
    if odor: d["odor_profile"] = odor

    if mat.note_classification:
        d["perfumery"] = {"note_classification": mat.note_classification}

    perf = {}
    if mat.tenacity:       perf["tenacity"] = mat.tenacity
    if mat.tenacity_hours: perf["duration"] = mat.tenacity_hours
    if perf: d["performance"] = perf

    phys = {}
    for key, val in [
        ("appearance", mat.appearance), ("boiling_point", mat.boiling_point),
        ("flash_point", mat.flash_point), ("vapor_pressure", mat.vapor_pressure),
        ("solubility", mat.solubility), ("density", mat.density),
        ("refractive_index", mat.refractive_index), ("logp", mat.logp),
    ]:
        if val: phys[key] = val
    if phys: d["physical_chemical"] = phys

    safe = {}
    if mat.ifra_guidelines: safe["ifra_guidelines"] = mat.ifra_guidelines
    if mat.usage_levels:    safe["usage_levels"] = mat.usage_levels
    if safe: d["safety"] = safe

    if mat.blends_well_with:
        d["blending"] = {"blends_well_with": mat.blends_well_with}

    return d


def generate_ai_report(materials):
    """Generate structured JSON for AI/LLM consumption."""
    report = {
        "_meta": {
            "schema_version": "4.0",
            "format": "perfume_materials_analysis",
            "generated_at": datetime.now().isoformat(),
            "total_materials": len(materials),
            "found_count": sum(1 for m in materials if m.found),
            "data_sources": [
                {
                    "name": "PubChem",
                    "provides": "molecular structure, physical/chemical properties, identifiers",
                    "url": "https://pubchem.ncbi.nlm.nih.gov/",
                    "reliability": "high",
                },
                {
                    "name": "Built-in Perfumery DB",
                    "provides": "odor profile, note classification, tenacity, IFRA, blending",
                    "reliability": "curated, CAS-validated before application",
                },
            ],
            "instructions_for_ai": (
                "RULES: "
                "1) Check data_validation.perfumery_data_matched per material. "
                "2) If TRUE: odor/notes/blending data is CAS-verified. "
                "3) If FALSE: only PubChem data present — do NOT hallucinate odor/perfumery. "
                "4) Physical data from PubChem is always factual. "
                "5) Perfumery data applies only to the specific CAS shown."
            ),
        },
        "materials": [_material_to_dict(m) for m in materials],
    }
    return json.dumps(report, indent=2, ensure_ascii=False)
