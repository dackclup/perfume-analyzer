"""
app.py  v9.0 — Simple input + autocomplete pills
    streamlit run app.py
"""

import re
import streamlit as st
import requests as req
from scraper import scrape_material, make_session, TRADE_NAMES, _NAME_TO_CAS
from exporter import generate_human_report, generate_ai_report

st.set_page_config(page_title="Perfume Analyzer", page_icon="⬡", layout="wide",
                   initial_sidebar_state="collapsed")

# Palette: Navy #3D5A80 · Off-white #F0F0F5 · Light gray #C9CCD5 · Blue-gray #7E8EA6
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400&display=swap');

*, html, body, [class*="css"] { font-family: 'IBM Plex Sans', sans-serif; color: #1a1a2e; }
code { font-family: 'IBM Plex Mono', monospace !important; font-size: 0.85em; color: #2C4A6E !important; }
h1,h2,h3,h4,h5 { font-weight: 600 !important; color: #2C3E5A !important; }
p, li, span, div { color: #1a1a2e; }
.block-container { padding-top: 2rem; }

input[type="text"] {
    border-radius: 4px !important; border-color: #C9CCD5 !important;
    background: #F0F0F5 !important; color: #1a1a2e !important;
}
input[type="text"]:focus { border-color: #3D5A80 !important; box-shadow: none !important; }
input[type="text"]::placeholder { color: #8893A6 !important; }

button[kind="primary"] {
    background: #3D5A80 !important; border: none !important;
    border-radius: 4px !important; box-shadow: none !important;
}
button[kind="primary"] p { color: #F0F0F5 !important; font-weight: 500 !important; }
button[kind="primary"]:hover { background: #2C4A6E !important; }

div[data-testid="stExpander"] { border: 1px solid #e5e5e5; border-radius: 4px; }
div[data-testid="stExpander"]:hover { border-color: #7E8EA6; }

.n-badge { display:inline-block; padding:3px 12px; border-radius:3px;
           font-size:0.8em; font-weight:500; margin:2px 4px; }
.n-top  { background:#fef9c3; color:#854d0e; }
.n-mid  { background:#dbeafe; color:#1e40af; }
.n-base { background:#ede9fe; color:#5b21b6; }

.sm { font-size:0.7em; text-transform:uppercase; letter-spacing:0.08em;
      color:#4A5E78; font-weight:600; margin-bottom:2px; }

hr { border-color: #C9CCD5 !important; }
div[data-testid="stProgress"] > div > div { background: #3D5A80 !important; border-radius: 2px; }
[data-testid="stCaptionContainer"] p { color: #5A6B82 !important; }

button[data-testid="stDownloadButton"] button {
    border-color: #3D5A80 !important; border-radius: 4px !important;
}
button[data-testid="stDownloadButton"] button p { color: #2C3E5A !important; }
button[data-testid="stDownloadButton"] button:hover {
    background: #3D5A80 !important; border-color: #3D5A80 !important;
}
button[data-testid="stDownloadButton"] button:hover p { color: #F0F0F5 !important; }

section[data-testid="stSidebar"] { border-right: 1px solid #C9CCD5; }

/* suggestion pills */
div[data-testid="stPills"] button {
    border: 1px solid #C9CCD5 !important; border-radius: 3px !important;
    background: #F0F0F5 !important; font-size: 0.82em !important;
}
div[data-testid="stPills"] button p { color: #3D5A80 !important; }
div[data-testid="stPills"] button:hover,
div[data-testid="stPills"] button[aria-checked="true"] {
    background: #3D5A80 !important; border-color: #3D5A80 !important;
}
div[data-testid="stPills"] button:hover p,
div[data-testid="stPills"] button[aria-checked="true"] p { color: #fff !important; }

/* ── Dark mode ── */
@media (prefers-color-scheme: dark) {
    *, p, li, span, div { color: #E8ECF0; }
    h1,h2,h3,h4,h5 { color: #E8ECF0 !important; }
    code { color: #C9CCD5 !important; }
    input[type="text"] {
        background: #1a2332 !important; border-color: #3D5A80 !important; color: #E8ECF0 !important;
    }
    input[type="text"]:focus { border-color: #7E8EA6 !important; }
    input[type="text"]::placeholder { color: #7E8EA6 !important; }
    button[kind="primary"] { background: #7E8EA6 !important; }
    button[kind="primary"] p { color: #111 !important; }
    button[kind="primary"]:hover { background: #C9CCD5 !important; }
    .sm { color: #9AACBF !important; }
    [data-testid="stCaptionContainer"] p { color: #8899AA !important; }
    div[data-testid="stExpander"] { border-color: #3D5A80; }
    div[data-testid="stExpander"]:hover { border-color: #7E8EA6; }
    hr { border-color: #2a3a50 !important; }
    div[data-testid="stProgress"] > div > div { background: #7E8EA6 !important; }
    .n-top  { background: #422006; color: #fbbf24; }
    .n-mid  { background: #172554; color: #60a5fa; }
    .n-base { background: #2e1065; color: #c4b5fd; }
    button[data-testid="stDownloadButton"] button { border-color: #3D5A80 !important; }
    button[data-testid="stDownloadButton"] button p { color: #C9CCD5 !important; }
    button[data-testid="stDownloadButton"] button:hover {
        background: #3D5A80 !important; border-color: #3D5A80 !important;
    }
    button[data-testid="stDownloadButton"] button:hover p { color: #F0F0F5 !important; }
    section[data-testid="stSidebar"] { border-right-color: #3D5A80; }
    div[data-testid="stPills"] button {
        border-color: #3D5A80 !important; background: #1a2332 !important;
    }
    div[data-testid="stPills"] button p { color: #C9CCD5 !important; }
    div[data-testid="stPills"] button:hover,
    div[data-testid="stPills"] button[aria-checked="true"] {
        background: #3D5A80 !important;
    }
    div[data-testid="stPills"] button:hover p,
    div[data-testid="stPills"] button[aria-checked="true"] p { color: #F0F0F5 !important; }
}
</style>
""", unsafe_allow_html=True)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Autocomplete
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_ALL_NAMES = sorted(set(
    list(TRADE_NAMES.keys()) + list(_NAME_TO_CAS.keys())
), key=len)


@st.cache_data(ttl=600)
def _pubchem_autocomplete(query):
    try:
        url = f"https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound/{req.utils.quote(query)}/JSON?limit=5"
        r = req.get(url, timeout=4)
        if r.status_code == 200:
            return r.json().get("dictionary_terms", {}).get("compound", [])
    except Exception:
        pass
    return []


def _get_suggestions(typed):
    typed = typed.lower().strip()
    starts, contains, seen = [], [], set()
    for name in _ALL_NAMES:
        if name.startswith(typed) and name not in seen:
            starts.append(name.title()); seen.add(name)
        elif typed in name and name not in seen:
            contains.append(name.title()); seen.add(name)
    results = starts + contains
    if len(results) < 3 and len(typed) >= 3:
        for s in _pubchem_autocomplete(typed):
            if s.lower() not in seen:
                results.append(s); seen.add(s.lower())
    return results[:6]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  State
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if "query" not in st.session_state:
    st.session_state.query = ""
if "results" not in st.session_state:
    st.session_state.results = []
if "searched" not in st.session_state:
    st.session_state.searched = set()
if "done" not in st.session_state:
    st.session_state.done = False

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Sidebar
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
with st.sidebar:
    st.markdown("**Perfume Analyzer**")
    st.caption("v9.0")
    st.markdown("---")
    st.markdown("Data from **PubChem** (NIH)  \nPerfumery DB (CAS-validated)")
    st.markdown("---")
    st.markdown("Export: PDF · JSON")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Title
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
st.markdown("## Perfume Raw Materials Analyzer")
st.caption("PubChem compound data + perfumery knowledge")
st.markdown("---")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Search input
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
query = st.text_input(
    "Search",
    value=st.session_state.query,
    placeholder="Type material name — e.g. Linalool, Iso E Super, 78-70-6 …",
    label_visibility="collapsed",
)

# Update state
st.session_state.query = query

# Suggestions (show while typing, before search)
typed = query.strip()
if len(typed) >= 2:
    suggestions = _get_suggestions(typed)
    # Don't show if exact match
    if suggestions and typed.lower() not in [s.lower() for s in suggestions[:1]]:
        sel = st.pills("suggestions", suggestions, label_visibility="collapsed")
        if sel:
            st.session_state.query = sel
            st.rerun()

# Search button
search_clicked = st.button("Search", type="primary",
                           disabled=len(typed) == 0,
                           use_container_width=True)

st.markdown("---")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Search
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if search_clicked and typed:
    # Split by comma for multiple materials
    names = [n.strip() for n in typed.split(",") if n.strip()]
    new_names = [n for n in names if n.lower() not in st.session_state.searched]

    if new_names:
        session = make_session()
        bar = st.progress(0)
        for idx, nm in enumerate(new_names):
            bar.progress(idx / len(new_names), text=nm)
            st.session_state.results.append(scrape_material(nm, session))
            st.session_state.searched.add(nm.lower())
        bar.progress(1.0, text="Done")
    st.session_state.done = True

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Results
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if st.session_state.results:
    ok = sum(1 for r in st.session_state.results if r.found)
    tot = len(st.session_state.results)
    st.caption(f"{ok}/{tot} found")

    for mat in st.session_state.results:
        if not mat.found:
            with st.expander(f"✗  {mat.name}", expanded=False):
                st.error(mat.error)
            continue

        with st.expander(mat.name, expanded=True):
            if mat.match_info:
                st.caption(mat.match_info)

            ic, tc = st.columns([1, 3])
            with ic:
                if mat.structure_image_url:
                    try: st.image(mat.structure_image_url, use_container_width=True)
                    except: pass
            with tc:
                st.markdown(f"**{mat.name}**")
                if mat.page_url:
                    st.caption(f"[PubChem ↗]({mat.page_url})")
                for lab, val in [("CAS", mat.cas_number), ("FEMA", mat.fema_number),
                    ("IUPAC", mat.iupac_name), ("Formula", mat.molecular_formula),
                    ("MW", mat.molecular_weight), ("SMILES", mat.smiles)]:
                    if val:
                        st.markdown(f"`{lab}` {val}")
                if mat.synonyms:
                    st.caption(", ".join(mat.synonyms[:6]))

            st.markdown("---")

            a, b, c = st.columns(3)
            with a:
                st.markdown('<p class="sm">Odor</p>', unsafe_allow_html=True)
                if mat.odor_description: st.markdown(f"_{mat.odor_description}_")
                if mat.odor_type: st.markdown(mat.odor_type)
                if mat.odor_strength: st.caption(mat.odor_strength)
                if not any([mat.odor_description, mat.odor_type]): st.caption("—")
            with b:
                st.markdown('<p class="sm">Note</p>', unsafe_allow_html=True)
                if mat.note_classification:
                    nl = mat.note_classification.lower()
                    if "top" in nl: st.markdown('<span class="n-badge n-top">Top</span>', unsafe_allow_html=True)
                    if "middle" in nl or "heart" in nl: st.markdown('<span class="n-badge n-mid">Heart</span>', unsafe_allow_html=True)
                    if "base" in nl: st.markdown('<span class="n-badge n-base">Base</span>', unsafe_allow_html=True)
                else: st.caption("—")
            with c:
                st.markdown('<p class="sm">Performance</p>', unsafe_allow_html=True)
                if mat.tenacity: st.markdown(mat.tenacity)
                if mat.tenacity_hours: st.caption(mat.tenacity_hours)
                if not mat.tenacity: st.caption("—")

            if any([mat.ifra_guidelines, mat.usage_levels, mat.blends_well_with]):
                st.markdown("---")
                s1, s2 = st.columns(2)
                with s1:
                    st.markdown('<p class="sm">Safety</p>', unsafe_allow_html=True)
                    if mat.ifra_guidelines: st.markdown(mat.ifra_guidelines)
                    if mat.usage_levels: st.caption(mat.usage_levels)
                with s2:
                    st.markdown('<p class="sm">Blends with</p>', unsafe_allow_html=True)
                    if mat.blends_well_with:
                        st.markdown(", ".join(mat.blends_well_with[:10]))

            if mat.pubchem_sections:
                st.markdown("---")
                st.markdown('<p class="sm">PubChem data</p>', unsafe_allow_html=True)
                grouped = {}
                for heading, items in mat.pubchem_sections.items():
                    top = heading.split(" > ")[0] if " > " in heading else heading
                    if top not in grouped: grouped[top] = []
                    grouped[top].append((heading, items))
                for top_heading, sub_list in grouped.items():
                    with st.expander(top_heading, expanded=False):
                        for heading, items in sub_list:
                            display = heading.split(" > ")[-1] if " > " in heading else heading
                            if display != top_heading: st.markdown(f"**{display}**")
                            for item in items:
                                if item.startswith("http"): continue
                                clean = re.sub(r'https?://\S+', '', item).strip()
                                if not clean or len(clean) < 3: continue
                                if len(clean) > 500: clean = clean[:500] + "…"
                                st.markdown(f"- {clean}")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Export
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if st.session_state.results and st.session_state.done:
    st.markdown("---")
    d1, d2 = st.columns(2)
    with d1:
        st.download_button("↓ PDF", data=generate_human_report(st.session_state.results),
            file_name="perfume_report.pdf", mime="application/pdf", use_container_width=True)
    with d2:
        st.download_button("↓ JSON", data=generate_ai_report(st.session_state.results),
            file_name="perfume_report_ai.json", mime="application/json", use_container_width=True)
