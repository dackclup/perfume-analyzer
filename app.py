"""
app.py — Perfume Raw Materials Analyzer

A Streamlit web application that searches The Good Scents Company database
for aroma chemicals and displays comprehensive chemical/perfumery data.

Run with:
    streamlit run app.py
"""

import streamlit as st
import requests

from scraper import scrape_material, MaterialData, _get_session
from exporter import generate_full_report
from molecule import smiles_to_image, RDKIT_AVAILABLE


# ─────────────────────────────────────────────────
# Page configuration
# ─────────────────────────────────────────────────
st.set_page_config(
    page_title="Perfume Raw Materials Analyzer",
    page_icon="🧪",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─────────────────────────────────────────────────
# Custom CSS
# ─────────────────────────────────────────────────
st.markdown("""
<style>
    /* Card-like containers */
    .material-card {
        background: linear-gradient(135deg, #f8f9fc 0%, #f0f2f6 100%);
        border: 1px solid #e0e3e8;
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 20px;
    }
    .property-grid {
        display: grid;
        grid-template-columns: 160px 1fr;
        gap: 6px 12px;
        font-size: 0.92em;
    }
    .prop-label {
        font-weight: 600;
        color: #444;
    }
    .prop-value {
        color: #222;
    }
    .note-badge {
        display: inline-block;
        padding: 4px 14px;
        border-radius: 20px;
        font-weight: 600;
        font-size: 0.85em;
        margin-right: 6px;
    }
    .note-top    { background: #fef3c7; color: #92400e; }
    .note-middle { background: #dbeafe; color: #1e40af; }
    .note-base   { background: #e0e7ff; color: #3730a3; }
    div[data-testid="stExpander"] { border: 1px solid #e0e3e8; border-radius: 8px; }
</style>
""", unsafe_allow_html=True)


# ─────────────────────────────────────────────────
# Session state initialization
# ─────────────────────────────────────────────────
if "material_inputs" not in st.session_state:
    st.session_state.material_inputs = [""]  # Start with one empty field
if "results" not in st.session_state:
    st.session_state.results = []
if "search_complete" not in st.session_state:
    st.session_state.search_complete = False


# ─────────────────────────────────────────────────
# Sidebar — About & instructions
# ─────────────────────────────────────────────────
with st.sidebar:
    st.image("https://img.icons8.com/color/96/test-tube.png", width=64)
    st.title("About")
    st.markdown(
        "This tool searches **The Good Scents Company** database and extracts "
        "comprehensive chemical and perfumery data for aroma raw materials.\n\n"
        "**How to use:**\n"
        "1. Add material names using the input fields\n"
        "2. Click **Search & Analyze**\n"
        "3. Review extracted data for each material\n"
        "4. Download a Markdown report\n"
    )
    st.divider()
    st.markdown("**Data source:**")
    st.markdown("[thegoodscentscompany.com](http://www.thegoodscentscompany.com/)")

    if RDKIT_AVAILABLE:
        st.success("✅ RDKit available — SMILES rendering enabled")
    else:
        st.warning("⚠️ RDKit not installed — using web images only")

    st.divider()
    st.caption("Built with Streamlit • BeautifulSoup4 • RDKit")


# ─────────────────────────────────────────────────
# Header
# ─────────────────────────────────────────────────
st.title("🧪 Perfume Raw Materials Analyzer")
st.markdown(
    "Enter one or more aroma chemicals below. The app will search "
    "[The Good Scents Company](http://www.thegoodscentscompany.com/) "
    "and extract molecular, olfactory, and safety data."
)
st.divider()


# ─────────────────────────────────────────────────
# Dynamic input fields
# ─────────────────────────────────────────────────
st.subheader("📝 Materials to Analyze")

# Render current input fields
updated_inputs = []
for i in range(len(st.session_state.material_inputs)):
    cols = st.columns([10, 1])
    with cols[0]:
        val = st.text_input(
            f"Material {i + 1}",
            value=st.session_state.material_inputs[i],
            key=f"mat_input_{i}",
            placeholder="e.g., Linalool, Iso E Super, Hedione…",
            label_visibility="collapsed" if i > 0 else "visible",
        )
        updated_inputs.append(val)
    with cols[1]:
        # Show remove button for all fields except the first
        if i > 0:
            if st.button("✕", key=f"remove_{i}", help="Remove this field"):
                st.session_state.material_inputs.pop(i)
                st.rerun()

st.session_state.material_inputs = updated_inputs

# Add / Clear buttons
btn_cols = st.columns([1, 1, 4])
with btn_cols[0]:
    if st.button("➕ Add Material", use_container_width=True):
        st.session_state.material_inputs.append("")
        st.rerun()
with btn_cols[1]:
    if st.button("🗑️ Clear All", use_container_width=True):
        st.session_state.material_inputs = [""]
        st.session_state.results = []
        st.session_state.search_complete = False
        st.rerun()

st.divider()


# ─────────────────────────────────────────────────
# Search action
# ─────────────────────────────────────────────────
# Collect non-empty inputs
names_to_search = [
    name.strip()
    for name in st.session_state.material_inputs
    if name.strip()
]

search_clicked = st.button(
    "🔍 Search & Analyze",
    type="primary",
    disabled=len(names_to_search) == 0,
    use_container_width=True,
)

if search_clicked and names_to_search:
    st.session_state.results = []
    st.session_state.search_complete = False

    session = _get_session()
    progress_bar = st.progress(0, text="Starting search…")

    for idx, name in enumerate(names_to_search):
        progress_bar.progress(
            (idx) / len(names_to_search),
            text=f"Searching for **{name}** ({idx + 1}/{len(names_to_search)})…",
        )
        result = scrape_material(name, session=session)
        st.session_state.results.append(result)

    progress_bar.progress(1.0, text="✅ Search complete!")
    st.session_state.search_complete = True


# ─────────────────────────────────────────────────
# Display results
# ─────────────────────────────────────────────────
if st.session_state.results:
    st.divider()
    st.subheader("📊 Results")

    # Summary bar
    found_count = sum(1 for r in st.session_state.results if r.found)
    total = len(st.session_state.results)
    st.info(f"**{found_count}** of **{total}** materials found successfully.")

    for mat in st.session_state.results:
        # ── Not-found materials ──
        if not mat.found:
            with st.expander(f"❌  {mat.name}", expanded=False):
                st.error(mat.error)
            continue

        # ── Found materials ──
        with st.expander(f"✅  {mat.name}", expanded=True):

            # ── Top row: image + identifiers ──
            img_col, info_col = st.columns([1, 2])

            with img_col:
                # Try RDKit rendering first, then fall back to web image
                rendered = False
                if mat.smiles and RDKIT_AVAILABLE:
                    img_bytes = smiles_to_image(mat.smiles)
                    if img_bytes:
                        st.image(img_bytes, caption="Molecular structure (RDKit)")
                        rendered = True

                if not rendered and mat.structure_image_url:
                    try:
                        st.image(
                            mat.structure_image_url,
                            caption="Molecular structure",
                            use_container_width=True,
                        )
                        rendered = True
                    except Exception:
                        pass

                if not rendered:
                    st.caption("No structure image available.")

            with info_col:
                st.markdown(f"#### {mat.name}")
                if mat.page_url:
                    st.markdown(f"[🔗 View source page]({mat.page_url})")

                id_data = {
                    "CAS Number": mat.cas_number,
                    "FEMA Number": mat.fema_number,
                    "Molecular Formula": mat.molecular_formula,
                    "Molecular Weight": mat.molecular_weight,
                    "SMILES": mat.smiles,
                }
                for label, value in id_data.items():
                    if value:
                        st.markdown(f"**{label}:** `{value}`")

                if mat.synonyms:
                    st.markdown(
                        "**Synonyms:** " + ", ".join(mat.synonyms[:8])
                    )
                    if len(mat.synonyms) > 8:
                        st.caption(f"…and {len(mat.synonyms) - 8} more")

            st.markdown("---")

            # ── Odor profile + Note + Performance ──
            col_a, col_b, col_c = st.columns(3)

            with col_a:
                st.markdown("##### 👃 Odor Profile")
                if mat.odor_description:
                    st.markdown(f"**Description:** {mat.odor_description}")
                if mat.odor_type:
                    st.markdown(f"**Type:** {mat.odor_type}")
                if mat.odor_strength:
                    st.markdown(f"**Strength:** {mat.odor_strength}")
                if not any([mat.odor_description, mat.odor_type, mat.odor_strength]):
                    st.caption("No odor data found.")

            with col_b:
                st.markdown("##### 🎵 Note Classification")
                if mat.note_classification:
                    note_lower = mat.note_classification.lower()
                    if "top" in note_lower:
                        st.markdown(
                            '<span class="note-badge note-top">🔝 Top Note</span>',
                            unsafe_allow_html=True,
                        )
                    if "middle" in note_lower or "heart" in note_lower:
                        st.markdown(
                            '<span class="note-badge note-middle">💜 Middle / Heart</span>',
                            unsafe_allow_html=True,
                        )
                    if "base" in note_lower:
                        st.markdown(
                            '<span class="note-badge note-base">🪨 Base Note</span>',
                            unsafe_allow_html=True,
                        )
                else:
                    st.caption("No note classification found.")

            with col_c:
                st.markdown("##### ⏱️ Performance")
                if mat.tenacity:
                    st.markdown(f"**Tenacity:** {mat.tenacity}")
                if mat.tenacity_hours:
                    st.markdown(f"**Duration:** {mat.tenacity_hours}")
                if not mat.tenacity and not mat.tenacity_hours:
                    st.caption("No tenacity data found.")

            st.markdown("---")

            # ── Physical / Chemical properties ──
            st.markdown("##### ⚗️ Physical & Chemical Properties")
            props = {
                "Appearance": mat.appearance,
                "Boiling Point": mat.boiling_point,
                "Flash Point": mat.flash_point,
                "Vapor Pressure": mat.vapor_pressure,
                "Solubility": mat.solubility,
                "Specific Gravity": mat.specific_gravity,
                "Refractive Index": mat.refractive_index,
                "LogP": mat.logp,
            }
            filled_props = {k: v for k, v in props.items() if v}
            if filled_props:
                prop_cols = st.columns(2)
                items = list(filled_props.items())
                mid = (len(items) + 1) // 2
                for col_idx, subset in enumerate([items[:mid], items[mid:]]):
                    with prop_cols[col_idx]:
                        for label, value in subset:
                            st.markdown(f"**{label}:** {value}")
            else:
                st.caption("No physical/chemical property data found.")

            st.markdown("---")

            # ── Safety & Formulation ──
            safe_col, blend_col = st.columns(2)

            with safe_col:
                st.markdown("##### 🛡️ Safety & Formulation")
                if mat.ifra_guidelines:
                    st.markdown(f"**IFRA Guidelines:** {mat.ifra_guidelines}")
                if mat.usage_levels:
                    st.markdown(f"**Usage Levels:** {mat.usage_levels}")
                if not mat.ifra_guidelines and not mat.usage_levels:
                    st.caption("No safety/formulation data found.")

            with blend_col:
                st.markdown("##### 🌿 Blending Suggestions")
                if mat.blends_well_with:
                    for item in mat.blends_well_with[:12]:
                        st.markdown(f"- {item}")
                    if len(mat.blends_well_with) > 12:
                        st.caption(f"…and {len(mat.blends_well_with) - 12} more")
                else:
                    st.caption("No blending data found.")


# ─────────────────────────────────────────────────
# Export
# ─────────────────────────────────────────────────
if st.session_state.results and st.session_state.search_complete:
    st.divider()
    report_md = generate_full_report(st.session_state.results)

    st.download_button(
        label="📥 Download Full Report as Markdown",
        data=report_md,
        file_name="perfume_materials_report.md",
        mime="text/markdown",
        use_container_width=True,
    )
