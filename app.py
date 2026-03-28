"""
app.py  v6.0 — Modern Minimal UI
    streamlit run app.py
"""

import re
import streamlit as st
from scraper import scrape_material, make_session
from exporter import generate_human_report, generate_ai_report

st.set_page_config(
    page_title="Perfume Analyzer",
    page_icon="◈",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Modern Minimal CSS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&family=JetBrains+Mono:wght@400&display=swap');

/* ── Global ── */
html, body, [class*="css"] {
    font-family: 'DM Sans', sans-serif;
}
code, [data-testid="stCode"] {
    font-family: 'JetBrains Mono', monospace !important;
    font-size: 0.82em;
}

/* ── Header area ── */
.hero-title {
    font-size: 2.4em;
    font-weight: 600;
    letter-spacing: -0.03em;
    margin-bottom: 0;
    line-height: 1.1;
}
.hero-sub {
    font-size: 1em;
    opacity: 0.5;
    font-weight: 300;
    margin-top: 4px;
    letter-spacing: 0.02em;
}
.hero-line {
    height: 2px;
    background: linear-gradient(90deg, rgba(99,102,241,0.6) 0%, transparent 100%);
    border: none;
    margin: 1.5rem 0 2rem 0;
}

/* ── Input section ── */
.section-label {
    font-size: 0.72em;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.4;
    font-weight: 500;
    margin-bottom: 0.8rem;
}
.action-row {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    margin-top: 0.5rem;
}
.action-link {
    font-size: 0.82em;
    opacity: 0.45;
    cursor: pointer;
    font-weight: 400;
    transition: opacity 0.2s;
}
.action-link:hover { opacity: 0.9; }

/* ── Remove ✕ button ── */
button[kind="secondary"] {
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
    min-height: 0 !important;
    padding: 0.2rem 0.5rem !important;
}
button[kind="secondary"] p {
    color: rgba(255,255,255,0.25) !important;
    font-size: 1.1em !important;
    transition: color 0.2s;
}
button[kind="secondary"]:hover p {
    color: #ef4444 !important;
}

/* ── Search button ── */
button[kind="primary"] {
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%) !important;
    border: none !important;
    border-radius: 10px !important;
    font-weight: 500 !important;
    letter-spacing: 0.02em !important;
    padding: 0.65rem 1.5rem !important;
    transition: all 0.3s ease !important;
    box-shadow: 0 4px 20px rgba(99,102,241,0.25) !important;
}
button[kind="primary"]:hover {
    box-shadow: 0 6px 30px rgba(99,102,241,0.4) !important;
    transform: translateY(-1px);
}
button[kind="primary"] p {
    font-weight: 500 !important;
}

/* ── Expanders ── */
div[data-testid="stExpander"] {
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    background: rgba(255,255,255,0.02);
    transition: border-color 0.3s;
}
div[data-testid="stExpander"]:hover {
    border-color: rgba(99,102,241,0.2);
}

/* ── Note badges ── */
.note-badge {
    display: inline-block;
    padding: 5px 16px;
    border-radius: 100px;
    font-weight: 500;
    font-size: 0.78em;
    letter-spacing: 0.03em;
    margin: 2px 4px;
}
.note-top  { background: rgba(250,204,21,0.12); color: #fbbf24; border: 1px solid rgba(250,204,21,0.2); }
.note-mid  { background: rgba(96,165,250,0.12); color: #60a5fa; border: 1px solid rgba(96,165,250,0.2); }
.note-base { background: rgba(167,139,250,0.12); color: #a78bfa; border: 1px solid rgba(167,139,250,0.2); }

/* ── Data cards ── */
.data-label {
    font-size: 0.7em;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    opacity: 0.35;
    font-weight: 500;
    margin-bottom: 2px;
}
.data-value {
    font-size: 0.92em;
    font-weight: 400;
    line-height: 1.5;
}

/* ── Download buttons ── */
button[data-testid="stDownloadButton"] > div {
    border-radius: 10px !important;
}

/* ── Progress bar ── */
div[data-testid="stProgress"] > div > div {
    background: linear-gradient(90deg, #6366f1, #a78bfa) !important;
    border-radius: 100px;
}

/* ── Dividers ── */
hr {
    border-color: rgba(255,255,255,0.05) !important;
}

/* ── Scrollbar (webkit) ── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 100px; }

/* ── Text inputs ── */
input[type="text"] {
    border-radius: 8px !important;
    border-color: rgba(255,255,255,0.08) !important;
    font-family: 'DM Sans', sans-serif !important;
    transition: border-color 0.3s !important;
}
input[type="text"]:focus {
    border-color: rgba(99,102,241,0.5) !important;
    box-shadow: 0 0 0 1px rgba(99,102,241,0.2) !important;
}

/* ── Sidebar ── */
section[data-testid="stSidebar"] {
    background: rgba(0,0,0,0.3);
    backdrop-filter: blur(20px);
}
</style>
""", unsafe_allow_html=True)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Session state
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if "inputs" not in st.session_state:
    st.session_state.inputs = [""]
if "results" not in st.session_state:
    st.session_state.results = []
if "done" not in st.session_state:
    st.session_state.done = False

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Sidebar
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
with st.sidebar:
    st.markdown("#### ◈ Perfume Analyzer")
    st.caption("v6.0")
    st.markdown("---")
    st.markdown(
        "Extracts complete compound data from **PubChem** (NIH) "
        "and overlays curated **perfumery knowledge** with CAS validation."
    )
    st.markdown("---")
    st.markdown(
        "**Data coverage**\n\n"
        "Names · Structure · Properties · GHS Safety\n"
        "Pharmacology · Toxicity · Manufacturing\n"
        "Odor Profile · Notes · Blending · IFRA"
    )
    st.markdown("---")
    st.markdown("**Export**")
    st.markdown("PDF for print · JSON for AI")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Hero
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
st.markdown('<p class="hero-title">◈ Perfume Raw Materials</p>', unsafe_allow_html=True)
st.markdown('<p class="hero-sub">Molecular analysis · Olfactory data · Safety profiles</p>', unsafe_allow_html=True)
st.markdown('<div class="hero-line"></div>', unsafe_allow_html=True)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Input
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
st.markdown('<p class="section-label">Materials to analyze</p>', unsafe_allow_html=True)

new_inputs = []
for i in range(len(st.session_state.inputs)):
    lc, rc = st.columns([12, 1])
    with lc:
        v = st.text_input(
            f"Material {i+1}",
            value=st.session_state.inputs[i],
            key=f"inp_{i}",
            placeholder=f"Material {i+1}",
            label_visibility="collapsed",
        )
    with rc:
        if st.button("✕", key=f"rm_{i}"):
            if len(st.session_state.inputs) > 1:
                st.session_state.inputs.pop(i)
            else:
                st.session_state.inputs = [""]
            st.rerun()
    new_inputs.append(v)

st.session_state.inputs = new_inputs

# Action row
names = [n.strip() for n in st.session_state.inputs if n.strip()]

col_search, col_add, col_clear = st.columns([3, 1, 1])
with col_search:
    search_clicked = st.button(
        "Search & Analyze",
        type="primary",
        disabled=len(names) == 0,
        use_container_width=True,
    )
with col_add:
    if st.button("＋ Add", use_container_width=True):
        st.session_state.inputs.append("")
        st.rerun()
with col_clear:
    if st.button("Clear", type="tertiary", use_container_width=True):
        st.session_state.inputs = [""]
        st.session_state.results = []
        st.session_state.done = False
        st.rerun()

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Search
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if search_clicked and names:
    st.session_state.results = []
    st.session_state.done = False
    session = make_session()
    bar = st.progress(0, text="Analyzing…")
    for idx, nm in enumerate(names):
        bar.progress(idx / len(names), text=f"**{nm}** — {idx+1}/{len(names)}")
        st.session_state.results.append(scrape_material(nm, session))
    bar.progress(1.0, text="Done")
    st.session_state.done = True

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Results
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if st.session_state.results:
    st.markdown('<div class="hero-line"></div>', unsafe_allow_html=True)
    st.markdown('<p class="section-label">Results</p>', unsafe_allow_html=True)

    ok = sum(1 for r in st.session_state.results if r.found)
    tot = len(st.session_state.results)
    st.caption(f"{ok} of {tot} found")

    for mat in st.session_state.results:
        if not mat.found:
            with st.expander(f"✗  {mat.name}", expanded=False):
                st.error(mat.error)
            continue

        with st.expander(f"◈  {mat.name}", expanded=True):

            # ── Status ──
            if mat.match_info:
                if mat.perfumery_matched:
                    st.caption(f"✓ {mat.match_info}")
                elif "mismatch" in mat.match_info.lower():
                    st.warning(mat.match_info)
                else:
                    st.caption(mat.match_info)

            # ── Structure + Identity ──
            ic, tc = st.columns([1, 2])
            with ic:
                if mat.structure_image_url:
                    try:
                        st.image(mat.structure_image_url, use_container_width=True)
                    except Exception:
                        pass

            with tc:
                st.markdown(f"### {mat.name}")
                if mat.page_url:
                    st.markdown(f"[↗ PubChem]({mat.page_url})")

                id_items = [
                    ("CAS", mat.cas_number), ("FEMA", mat.fema_number),
                    ("IUPAC", mat.iupac_name), ("Formula", mat.molecular_formula),
                    ("MW", mat.molecular_weight), ("SMILES", mat.smiles),
                ]
                for lab, val in id_items:
                    if val:
                        st.markdown(f'<span class="data-label">{lab}</span><br>'
                                    f'<span class="data-value"><code>{val}</code></span>',
                                    unsafe_allow_html=True)

                if mat.synonyms:
                    st.markdown(f'<span class="data-label">SYNONYMS</span><br>'
                                f'<span class="data-value">{" · ".join(mat.synonyms[:6])}</span>',
                                unsafe_allow_html=True)

            st.markdown("---")

            # ── Odor · Note · Performance ──
            a, b, c = st.columns(3)

            with a:
                st.markdown('<p class="data-label">ODOR PROFILE</p>', unsafe_allow_html=True)
                if mat.odor_description:
                    st.markdown(f"_{mat.odor_description}_")
                if mat.odor_type:
                    st.markdown(f"**Type** — {mat.odor_type}")
                if mat.odor_strength:
                    st.markdown(f"**Strength** — {mat.odor_strength}")
                if not any([mat.odor_description, mat.odor_type, mat.odor_strength]):
                    st.caption("—")

            with b:
                st.markdown('<p class="data-label">NOTE</p>', unsafe_allow_html=True)
                if mat.note_classification:
                    nl = mat.note_classification.lower()
                    if "top" in nl:
                        st.markdown('<span class="note-badge note-top">Top</span>', unsafe_allow_html=True)
                    if "middle" in nl or "heart" in nl:
                        st.markdown('<span class="note-badge note-mid">Heart</span>', unsafe_allow_html=True)
                    if "base" in nl:
                        st.markdown('<span class="note-badge note-base">Base</span>', unsafe_allow_html=True)
                else:
                    st.caption("—")

            with c:
                st.markdown('<p class="data-label">PERFORMANCE</p>', unsafe_allow_html=True)
                if mat.tenacity:
                    st.markdown(f"**Tenacity** — {mat.tenacity}")
                if mat.tenacity_hours:
                    st.markdown(f"**Duration** — {mat.tenacity_hours}")
                if not mat.tenacity:
                    st.caption("—")

            # ── Safety + Blending ──
            if any([mat.ifra_guidelines, mat.usage_levels, mat.blends_well_with]):
                st.markdown("---")
                s1, s2 = st.columns(2)
                with s1:
                    st.markdown('<p class="data-label">SAFETY & FORMULATION</p>', unsafe_allow_html=True)
                    if mat.ifra_guidelines:
                        st.markdown(f"**IFRA** — {mat.ifra_guidelines}")
                    if mat.usage_levels:
                        st.markdown(f"**Usage** — {mat.usage_levels}")
                with s2:
                    st.markdown('<p class="data-label">BLENDS WITH</p>', unsafe_allow_html=True)
                    if mat.blends_well_with:
                        st.markdown(" · ".join(mat.blends_well_with[:10]))
                    else:
                        st.caption("—")

            # ── Full PubChem data ──
            if mat.pubchem_sections:
                st.markdown("---")
                st.markdown('<p class="data-label">COMPLETE PUBCHEM DATA</p>', unsafe_allow_html=True)

                grouped = {}
                for heading, items in mat.pubchem_sections.items():
                    top = heading.split(" > ")[0] if " > " in heading else heading
                    if top not in grouped:
                        grouped[top] = []
                    grouped[top].append((heading, items))

                for top_heading, sub_list in grouped.items():
                    with st.expander(top_heading, expanded=False):
                        for heading, items in sub_list:
                            display = heading.split(" > ")[-1] if " > " in heading else heading
                            if display != top_heading:
                                st.markdown(f"**{display}**")

                            for item in items:
                                if item.startswith("http"):
                                    continue
                                clean = re.sub(r'https?://\S+', '', item).strip()
                                if not clean or len(clean) < 3:
                                    continue
                                if len(clean) > 500:
                                    clean = clean[:500] + "…"
                                st.markdown(f"- {clean}")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Export
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if st.session_state.results and st.session_state.done:
    st.markdown('<div class="hero-line"></div>', unsafe_allow_html=True)
    st.markdown('<p class="section-label">Export</p>', unsafe_allow_html=True)

    dl1, dl2 = st.columns(2)
    with dl1:
        pdf_bytes = generate_human_report(st.session_state.results)
        st.download_button(
            "↓  PDF Report",
            data=pdf_bytes,
            file_name="perfume_report.pdf",
            mime="application/pdf",
            use_container_width=True,
        )
        st.caption("Print-ready A4")
    with dl2:
        ai_json = generate_ai_report(st.session_state.results)
        st.download_button(
            "↓  JSON (AI)",
            data=ai_json,
            file_name="perfume_report_ai.json",
            mime="application/json",
            use_container_width=True,
        )
        st.caption("Structured data for LLMs")
