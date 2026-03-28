"""
app.py  v4.0
============
Perfume Raw Materials Analyzer — Streamlit UI
Export: PDF (human) + JSON (AI)

    streamlit run app.py
"""

import streamlit as st
from scraper import scrape_material, make_session
from exporter import generate_human_report, generate_ai_report

# ── Page config ──
st.set_page_config(
    page_title="Perfume Raw Materials Analyzer",
    page_icon="🧪",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── CSS ──
st.markdown("""
<style>
.note-badge{display:inline-block;padding:4px 14px;border-radius:20px;
            font-weight:600;font-size:.85em;margin:2px 4px}
.note-top{background:#fef3c7;color:#92400e}
.note-mid{background:#dbeafe;color:#1e40af}
.note-base{background:#e0e7ff;color:#3730a3}
div[data-testid="stExpander"]{border:1px solid #e0e3e8;border-radius:8px}
</style>
""", unsafe_allow_html=True)

# ── Session state ──
if "inputs" not in st.session_state:
    st.session_state.inputs = [""]
if "results" not in st.session_state:
    st.session_state.results = []
if "done" not in st.session_state:
    st.session_state.done = False

# ── Sidebar ──
with st.sidebar:
    st.title("🧪 About")
    st.markdown(
        "Fetches molecular data from **PubChem** (NIH) and combines "
        "with a curated **perfumery knowledge base**.\n\n"
        "Perfumery data is applied **only when CAS numbers match**.\n\n"
        "**Steps:**\n"
        "1. Add material names\n"
        "2. Click **Search & Analyze**\n"
        "3. Review results\n"
        "4. Download report"
    )
    st.divider()
    st.markdown("**Export formats:**")
    st.markdown("- 📄 **PDF** — สำหรับคนอ่าน / ปริ้น")
    st.markdown("- 🤖 **JSON** — สำหรับ AI อ่าน")
    st.divider()
    st.caption("v4.0 · CAS-validated · PDF + JSON")

# ── Header ──
st.title("🧪 Perfume Raw Materials Analyzer")
st.markdown(
    "Enter aroma chemicals — the app fetches **verified** molecular data "
    "from PubChem and overlays perfumery data only when CAS numbers match."
)
st.divider()

# ── Dynamic inputs ──
st.subheader("📝 Materials to Analyze")

new_inputs = []
for i in range(len(st.session_state.inputs)):
    cols = st.columns([10, 1])
    with cols[0]:
        v = st.text_input(
            f"Material {i+1}",
            value=st.session_state.inputs[i],
            key=f"inp_{i}",
            placeholder="e.g. Linalool, Iso E Super, Hedione …",
            label_visibility="collapsed" if i > 0 else "visible",
        )
        new_inputs.append(v)
    with cols[1]:
        if i > 0 and st.button("✕", key=f"rm_{i}"):
            st.session_state.inputs.pop(i)
            st.rerun()

st.session_state.inputs = new_inputs

c1, c2, _ = st.columns([1, 1, 4])
with c1:
    if st.button("➕ Add Material", use_container_width=True):
        st.session_state.inputs.append("")
        st.rerun()
with c2:
    if st.button("🗑️ Clear All", use_container_width=True):
        st.session_state.inputs = [""]
        st.session_state.results = []
        st.session_state.done = False
        st.rerun()

st.divider()

# ── Search ──
names = [n.strip() for n in st.session_state.inputs if n.strip()]

if st.button("🔍 Search & Analyze", type="primary",
             disabled=len(names) == 0, use_container_width=True) and names:
    st.session_state.results = []
    st.session_state.done = False
    session = make_session()
    bar = st.progress(0, text="Starting …")

    for idx, nm in enumerate(names):
        bar.progress(idx / len(names),
                     text=f"Searching **{nm}** ({idx+1}/{len(names)}) …")
        st.session_state.results.append(scrape_material(nm, session))

    bar.progress(1.0, text="✅ Search complete!")
    st.session_state.done = True

# ── Results ──
if st.session_state.results:
    st.divider()
    st.subheader("📊 Results")

    ok = sum(1 for r in st.session_state.results if r.found)
    tot = len(st.session_state.results)
    (st.success if ok == tot else st.warning if ok else st.error)(
        f"**{ok}** of **{tot}** materials found."
    )

    for mat in st.session_state.results:
        if not mat.found:
            with st.expander(f"❌  {mat.name}", expanded=False):
                st.error(mat.error)
            continue

        with st.expander(f"✅  {mat.name}", expanded=True):

            if mat.match_info:
                if mat.perfumery_matched:
                    st.success(f"**Data source:** {mat.match_info}")
                elif "mismatch" in mat.match_info.lower():
                    st.warning(f"**Data source:** {mat.match_info}")
                else:
                    st.info(f"**Data source:** {mat.match_info}")

            ic, tc = st.columns([1, 2])
            with ic:
                if mat.structure_image_url:
                    try:
                        st.image(mat.structure_image_url,
                                 caption="Structure (PubChem)",
                                 use_container_width=True)
                    except Exception:
                        st.caption("Image unavailable.")
            with tc:
                st.markdown(f"#### {mat.name}")
                if mat.page_url:
                    st.markdown(f"[🔗 PubChem]({mat.page_url})")
                for lab, val in [
                    ("CAS", mat.cas_number),
                    ("FEMA", mat.fema_number),
                    ("IUPAC", mat.iupac_name),
                    ("Formula", mat.molecular_formula),
                    ("MW", mat.molecular_weight),
                    ("SMILES", mat.smiles),
                ]:
                    if val:
                        st.markdown(f"**{lab}:** `{val}`")
                if mat.synonyms:
                    st.markdown("**Synonyms:** " + ", ".join(mat.synonyms[:8]))

            st.markdown("---")

            a, b, c = st.columns(3)
            with a:
                st.markdown("##### 👃 Odor Profile")
                if mat.odor_description:
                    st.markdown(f"**Description:** {mat.odor_description}")
                if mat.odor_type:
                    st.markdown(f"**Type:** {mat.odor_type}")
                if mat.odor_strength:
                    st.markdown(f"**Strength:** {mat.odor_strength}")
                if not any([mat.odor_description, mat.odor_type, mat.odor_strength]):
                    st.caption("Not in perfumery DB — PubChem data only.")

            with b:
                st.markdown("##### 🎵 Note")
                if mat.note_classification:
                    nl = mat.note_classification.lower()
                    if "top" in nl:
                        st.markdown(
                            '<span class="note-badge note-top">🔝 Top</span>',
                            unsafe_allow_html=True)
                    if "middle" in nl or "heart" in nl:
                        st.markdown(
                            '<span class="note-badge note-mid">💜 Middle / Heart</span>',
                            unsafe_allow_html=True)
                    if "base" in nl:
                        st.markdown(
                            '<span class="note-badge note-base">🪨 Base</span>',
                            unsafe_allow_html=True)
                else:
                    st.caption("No classification.")

            with c:
                st.markdown("##### ⏱️ Performance")
                if mat.tenacity:
                    st.markdown(f"**Tenacity:** {mat.tenacity}")
                if mat.tenacity_hours:
                    st.markdown(f"**Duration:** {mat.tenacity_hours}")
                if not mat.tenacity:
                    st.caption("No tenacity data.")

            st.markdown("---")

            st.markdown("##### ⚗️ Physical & Chemical Properties")
            filled = {k: v for k, v in {
                "Appearance": mat.appearance,
                "Boiling Point": mat.boiling_point,
                "Flash Point": mat.flash_point,
                "Vapor Pressure": mat.vapor_pressure,
                "Solubility": mat.solubility,
                "Density": mat.density,
                "Refractive Index": mat.refractive_index,
                "LogP": mat.logp,
            }.items() if v}

            if filled:
                items = list(filled.items())
                mid = (len(items) + 1) // 2
                p1, p2 = st.columns(2)
                with p1:
                    for k, v in items[:mid]:
                        st.markdown(f"**{k}:** {v}")
                with p2:
                    for k, v in items[mid:]:
                        st.markdown(f"**{k}:** {v}")
            else:
                st.caption("No physical data found.")

            st.markdown("---")

            s1, s2 = st.columns(2)
            with s1:
                st.markdown("##### 🛡️ Safety & Formulation")
                if mat.ifra_guidelines:
                    st.markdown(f"**IFRA:** {mat.ifra_guidelines}")
                if mat.usage_levels:
                    st.markdown(f"**Usage:** {mat.usage_levels}")
                if not mat.ifra_guidelines and not mat.usage_levels:
                    st.caption("No safety data.")
            with s2:
                st.markdown("##### 🌿 Blending")
                if mat.blends_well_with:
                    for item in mat.blends_well_with[:12]:
                        st.markdown(f"- {item}")
                else:
                    st.caption("No blending data.")

# ── Export ──
if st.session_state.results and st.session_state.done:
    st.divider()
    st.subheader("📥 Download Report")

    dl1, dl2 = st.columns(2)

    with dl1:
        pdf_bytes = generate_human_report(st.session_state.results)
        st.download_button(
            "📄 สำหรับคนอ่าน (.pdf)",
            data=pdf_bytes,
            file_name="perfume_report.pdf",
            mime="application/pdf",
            use_container_width=True,
        )
        st.caption("**PDF** — จัดหน้าสวย พร้อมปริ้นลงกระดาษ A4")

    with dl2:
        ai_json = generate_ai_report(st.session_state.results)
        st.download_button(
            "🤖 สำหรับ AI อ่าน (.json)",
            data=ai_json,
            file_name="perfume_report_ai.json",
            mime="application/json",
            use_container_width=True,
        )
        st.caption("**JSON** — โครงสร้างชัด มี metadata สำหรับ AI/LLM")
