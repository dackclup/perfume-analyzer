"""
app.py  v5.2 — Clean UI layout
    streamlit run app.py
"""

import re
import streamlit as st
from scraper import scrape_material, make_session
from exporter import generate_human_report, generate_ai_report

st.set_page_config(page_title="Perfume Raw Materials Analyzer", page_icon="🧪",
                   layout="wide", initial_sidebar_state="expanded")

st.markdown("""
<style>
.note-badge{display:inline-block;padding:4px 14px;border-radius:20px;
            font-weight:600;font-size:.85em;margin:2px 4px}
.note-top{background:#fef3c7;color:#92400e}
.note-mid{background:#dbeafe;color:#1e40af}
.note-base{background:#e0e7ff;color:#3730a3}
div[data-testid="stExpander"]{border:1px solid #e0e3e8;border-radius:8px}
.clear-btn{color:white;cursor:pointer;font-size:0.85em;opacity:0.7}
.clear-btn:hover{opacity:1}
</style>
""", unsafe_allow_html=True)

if "inputs" not in st.session_state:
    st.session_state.inputs = [""]
if "results" not in st.session_state:
    st.session_state.results = []
if "done" not in st.session_state:
    st.session_state.done = False

with st.sidebar:
    st.title("🧪 About")
    st.markdown(
        "Extracts **ALL available data** from PubChem compound records "
        "and overlays perfumery data (CAS-validated).\n\n"
        "**PubChem sections extracted:**\n"
        "- Names & Identifiers\n"
        "- Chemical & Physical Properties\n"
        "- Safety & Hazards (GHS)\n"
        "- Pharmacology & Biochemistry\n"
        "- Use & Manufacturing\n"
        "- Toxicity\n"
        "- And more…"
    )
    st.divider()
    st.markdown("**Export:**")
    st.markdown("📄 PDF — ปริ้นกระดาษ A4 | 🤖 JSON — AI อ่าน")
    st.divider()
    st.caption("v5.2 · Full PubChem extraction")

st.title("🧪 Perfume Raw Materials Analyzer")
st.markdown("Extracts **complete PubChem compound data** + perfumery knowledge.")
st.divider()

# ── Header ──
st.subheader("📝 Materials to Analyze")

# ── Input fields ──
new_inputs = []
for i in range(len(st.session_state.inputs)):
    if i == 0:
        # Material 1 — no remove
        v = st.text_input(
            f"Material {i+1}",
            value=st.session_state.inputs[i],
            key=f"inp_{i}",
            placeholder="e.g. Linalool, Iso E Super, Hedione …",
        )
    else:
        # Material 2+ — label with − remove
        lc, rc = st.columns([6, 1])
        with lc:
            v = st.text_input(
                f"Material {i+1}",
                value=st.session_state.inputs[i],
                key=f"inp_{i}",
                placeholder="e.g. Linalool, Iso E Super, Hedione …",
            )
        with rc:
            st.markdown("")  # spacer to align with input
            if st.button("−", key=f"rm_{i}", help=f"Remove Material {i+1}"):
                st.session_state.inputs.pop(i)
                st.rerun()
    new_inputs.append(v)

st.session_state.inputs = new_inputs

# ── Search button ──
names = [n.strip() for n in st.session_state.inputs if n.strip()]
search_clicked = st.button(
    "🔍 Search & Analyze",
    type="primary",
    disabled=len(names) == 0,
    use_container_width=True,
)

# ── Add Material + Clear all (same row) ──
ac1, ac2, _ = st.columns([1, 1, 2])
with ac1:
    if st.button("＋ Add Material"):
        st.session_state.inputs.append("")
        st.rerun()
with ac2:
    if st.button("Clear all", type="tertiary"):
        st.session_state.inputs = [""]
        st.session_state.results = []
        st.session_state.done = False
        st.rerun()

st.divider()

# ── Search ──
if search_clicked and names:
    st.session_state.results = []
    st.session_state.done = False
    session = make_session()
    bar = st.progress(0, text="Starting …")
    for idx, nm in enumerate(names):
        bar.progress(idx / len(names), text=f"Searching **{nm}** ({idx+1}/{len(names)}) …")
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
        f"**{ok}** of **{tot}** materials found.")

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
                        st.image(mat.structure_image_url, caption="Structure (PubChem)",
                                 use_container_width=True)
                    except Exception:
                        pass
            with tc:
                st.markdown(f"#### {mat.name}")
                if mat.page_url:
                    st.markdown(f"[🔗 PubChem]({mat.page_url})")
                for lab, val in [("CAS", mat.cas_number), ("FEMA", mat.fema_number),
                    ("IUPAC", mat.iupac_name), ("Formula", mat.molecular_formula),
                    ("MW", mat.molecular_weight), ("SMILES", mat.smiles)]:
                    if val:
                        st.markdown(f"**{lab}:** `{val}`")
                if mat.synonyms:
                    st.markdown("**Synonyms:** " + ", ".join(mat.synonyms[:8]))

            st.markdown("---")

            a, b, c = st.columns(3)
            with a:
                st.markdown("##### 👃 Odor Profile")
                for l, v in [("Description", mat.odor_description),
                             ("Type", mat.odor_type), ("Strength", mat.odor_strength)]:
                    if v:
                        st.markdown(f"**{l}:** {v}")
                if not any([mat.odor_description, mat.odor_type, mat.odor_strength]):
                    st.caption("Not in perfumery DB.")
            with b:
                st.markdown("##### 🎵 Note")
                if mat.note_classification:
                    nl = mat.note_classification.lower()
                    if "top" in nl:
                        st.markdown('<span class="note-badge note-top">🔝 Top</span>', unsafe_allow_html=True)
                    if "middle" in nl or "heart" in nl:
                        st.markdown('<span class="note-badge note-mid">💜 Middle/Heart</span>', unsafe_allow_html=True)
                    if "base" in nl:
                        st.markdown('<span class="note-badge note-base">🪨 Base</span>', unsafe_allow_html=True)
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

            if any([mat.ifra_guidelines, mat.usage_levels, mat.blends_well_with]):
                st.markdown("---")
                s1, s2 = st.columns(2)
                with s1:
                    st.markdown("##### 🛡️ Safety")
                    if mat.ifra_guidelines:
                        st.markdown(f"**IFRA:** {mat.ifra_guidelines}")
                    if mat.usage_levels:
                        st.markdown(f"**Usage:** {mat.usage_levels}")
                with s2:
                    st.markdown("##### 🌿 Blending")
                    if mat.blends_well_with:
                        for item in mat.blends_well_with[:10]:
                            st.markdown(f"- {item}")

            if mat.pubchem_sections:
                st.markdown("---")
                st.markdown("##### 📚 Complete PubChem Data")

                grouped = {}
                for heading, items in mat.pubchem_sections.items():
                    top = heading.split(" > ")[0] if " > " in heading else heading
                    if top not in grouped:
                        grouped[top] = []
                    grouped[top].append((heading, items))

                for top_heading, sub_list in grouped.items():
                    with st.expander(f"📋 {top_heading}", expanded=False):
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
                        st.markdown("")

if st.session_state.results and st.session_state.done:
    st.divider()
    st.subheader("📥 Download Report")
    dl1, dl2 = st.columns(2)
    with dl1:
        pdf_bytes = generate_human_report(st.session_state.results)
        st.download_button("📄 สำหรับคนอ่าน (.pdf)", data=pdf_bytes,
            file_name="perfume_report.pdf", mime="application/pdf",
            use_container_width=True)
        st.caption("**PDF** — จัดหน้าสวย ปริ้น A4 ได้เลย")
    with dl2:
        ai_json = generate_ai_report(st.session_state.results)
        st.download_button("🤖 สำหรับ AI อ่าน (.json)", data=ai_json,
            file_name="perfume_report_ai.json", mime="application/json",
            use_container_width=True)
        st.caption("**JSON** — ข้อมูลครบทุก section + perfumery DB")
