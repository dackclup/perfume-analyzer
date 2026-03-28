"""
app.py — Perfume Raw Materials Analyzer

A Streamlit web application that fetches chemical data from PubChem
and merges it with a curated perfumery knowledge base.

Run with:
    streamlit run app.py
"""

import streamlit as st
from scraper import scrape_material, MaterialData, _get_session
from exporter import generate_full_report


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
    st.session_state.material_inputs = [""]
if "results" not in st.session_state:
    st.session_state.results = []
if "search_complete" not in st.session_state:
    st.session_state.search_complete = False


# ─────────────────────────────────────────────────
# Sidebar
# ─────────────────────────────────────────────────
with st.sidebar:
    st.title("🧪 About")
    st.markdown(
        "This tool fetches molecular data from **PubChem** (NIH) and combines it "
        "with a curated **perfumery knowledge base** for aroma chemical analysis.\n\n"
        "**How to use:**\n"
        "1. Add material names\n"
        "2. Click **Search & Analyze**\n"
        "3. Review extracted data\n"
        "4. Download Markdown report\n"
    )
    st.divider()
    st.markdown("**Data sources:**")
    st.markdown("- [PubChem](https://pubchem.ncbi.nlm.nih.gov/) — molecular & physical data")
    st.markdown("- Built-in perfumery database — odor, notes, blending")
    st.divider()
    st.caption("Built with Streamlit + PubChem API")


# ─────────────────────────────────────────────────
# Header
# ─────────────────────────────────────────────────
st.title("🧪 Perfume Raw Materials Analyzer")
st.markdown(
    "Enter aroma chemicals below. The app will fetch molecular data from "
    "**PubChem** and merge it with perfumery-specific knowledge."
)
st.divider()


# ─────────────────────────────────────────────────
# Dynamic input fields
# ─────────────────────────────────────────────────
st.subheader("📝 Materials to Analyze")

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
        if i > 0:
            if st.button("✕", key=f"remove_{i}", help="Remove this field"):
                st.session_state.material_inputs.pop(i)
                st.rerun()

st.session_state.material_inputs = updated_inputs

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
names_to_search = [n.strip() for n in st.session_state.material_inputs if n.strip()]

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
            idx / len(names_to_search),
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

    found_count = sum(1 for r in st.session_state.results if r.found)
    total = len(st.session_state.results)

    if found_count == total:
        st.success(f"**{found_count}** of **{total}** materials found successfully.")
    elif found_count > 0:
        st.warning(f"**{found_count}** of **{total}** materials found.")
    else:
        st.error(f"**0** of **{total}** materials found.")

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
                if mat.structure_image_url:
                    try:
                        st.image(
                            mat.structure_image_url,
                            caption="Molecular structure (PubChem)",
                            use_container_width=True,
                        )
                    except Exception:
                        st.caption("Could not load structure image.")
                else:
                    st.caption("No structure image available.")

            with info_col:
                st.markdown(f"#### {mat.name}")
                if mat.page_url:
                    st.markdown(f"[🔗 View on PubChem]({mat.page_url})")

                id_data = {
                    "CAS Number": mat.cas_number,
                    "FEMA Number": mat.fema_number,
                    "IUPAC Name": mat.iupac_name,
                    "Molecular Formula": mat.molecular_formula,
                    "Molecular Weight": mat.molecular_weight,
                    "SMILES": mat.smiles,
                }
                for label, value in id_data.items():
                    if value:
                        st.markdown(f"**{label}:** `{value}`")

                if mat.synonyms:
                    st.markdown("**Synonyms:** " + ", ".join(mat.synonyms[:8]))

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
                    st.caption("No odor data in database — contribute to expand coverage!")

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
                    st.caption("No note classification in database.")

            with col_c:
                st.markdown("##### ⏱️ Performance")
                if mat.tenacity:
                    st.markdown(f"**Tenacity:** {mat.tenacity}")
                if mat.tenacity_hours:
                    st.markdown(f"**Duration:** {mat.tenacity_hours}")
                if not mat.tenacity and not mat.tenacity_hours:
                    st.caption("No tenacity data in database.")

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

            # ── Safety & Blending ──
            safe_col, blend_col = st.columns(2)

            with safe_col:
                st.markdown("##### 🛡️ Safety & Formulation")
                if mat.ifra_guidelines:
                    st.markdown(f"**IFRA Guidelines:** {mat.ifra_guidelines}")
                if mat.usage_levels:
                    st.markdown(f"**Usage Levels:** {mat.usage_levels}")
                if not mat.ifra_guidelines and not mat.usage_levels:
                    st.caption("No safety/formulation data in database.")

            with blend_col:
                st.markdown("##### 🌿 Blending Suggestions")
                if mat.blends_well_with:
                    for item in mat.blends_well_with[:12]:
                        st.markdown(f"- {item}")
                else:
                    st.caption("No blending data in database.")


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
