"""
app.py  v12.1 — Real-time pills from 1st char (st_keyup, no fragment)
    streamlit run app.py
"""

import re
import streamlit as st
from st_keyup import st_keyup
from scraper import scrape_material, make_session, TRADE_NAMES, _NAME_TO_CAS
from exporter import generate_human_report, generate_ai_report

st.set_page_config(page_title="Perfume Analyzer", page_icon="⬡", layout="wide",
                   initial_sidebar_state="collapsed")

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
iframe[title="st_keyup.st_keyup"] { height: 45px !important; }
button[kind="secondary"] {
    border: none !important; background: none !important;
    box-shadow: none !important; min-height: 0 !important;
    padding: 0.6rem 0.4rem !important;
}
button[kind="secondary"] p {
    color: #ffffff !important; font-size: 1.1em !important;
    opacity: 0.6; transition: opacity 0.2s;
}
button[kind="secondary"]:hover p { opacity: 1; }
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
button[data-testid="stDownloadButton"] button,
div[data-testid="stDownloadButton"] button {
    background: #3D5A80 !important; border-color: #3D5A80 !important;
    border-radius: 6px !important; color: #FFFFFF !important; padding: 0.5rem 1rem !important;
}
button[data-testid="stDownloadButton"] button p,
div[data-testid="stDownloadButton"] button p { color: #FFFFFF !important; font-weight: 600 !important; }
button[data-testid="stDownloadButton"] button:hover,
div[data-testid="stDownloadButton"] button:hover {
    background: #2C4A6E !important; border-color: #2C4A6E !important;
}
button[data-testid="stDownloadButton"] button:hover p,
div[data-testid="stDownloadButton"] button:hover p { color: #FFFFFF !important; }
section[data-testid="stSidebar"] { border-right: 1px solid #C9CCD5; }
div[data-testid="stPills"] { margin-top: -0.5rem; }
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
    hr { border-color: #2a3a50 !important; }
    div[data-testid="stProgress"] > div > div { background: #7E8EA6 !important; }
    .n-top  { background: #422006; color: #fbbf24; }
    .n-mid  { background: #172554; color: #60a5fa; }
    .n-base { background: #2e1065; color: #c4b5fd; }
    button[data-testid="stDownloadButton"] button,
    div[data-testid="stDownloadButton"] button {
        background: #4A6FA5 !important; border-color: #4A6FA5 !important;
    }
    button[data-testid="stDownloadButton"] button p,
    div[data-testid="stDownloadButton"] button p { color: #FFFFFF !important; }
    button[data-testid="stDownloadButton"] button:hover,
    div[data-testid="stDownloadButton"] button:hover {
        background: #6B8FC5 !important; border-color: #6B8FC5 !important;
    }
    button[data-testid="stDownloadButton"] button:hover p,
    div[data-testid="stDownloadButton"] button:hover p { color: #FFFFFF !important; }
    section[data-testid="stSidebar"] { border-right-color: #3D5A80; }
    div[data-testid="stPills"] button {
        border-color: #3D5A80 !important; background: #1a2332 !important;
    }
    div[data-testid="stPills"] button p { color: #C9CCD5 !important; }
    div[data-testid="stPills"] button:hover,
    div[data-testid="stPills"] button[aria-checked="true"] { background: #3D5A80 !important; }
    div[data-testid="stPills"] button:hover p,
    div[data-testid="stPills"] button[aria-checked="true"] p { color: #F0F0F5 !important; }
}
</style>
""", unsafe_allow_html=True)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Autocomplete — prefix index (O(1) lookup)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ALL_NAMES = sorted(set(
    list(TRADE_NAMES.keys()) + list(_NAME_TO_CAS.keys())
), key=len)

_PREFIX_INDEX = {}
for _name in _ALL_NAMES:
    _cas = TRADE_NAMES.get(_name, "")
    for _plen in range(1, min(len(_name) + 1, 12)):
        _prefix = _name[:_plen]
        if _prefix not in _PREFIX_INDEX:
            _PREFIX_INDEX[_prefix] = []
        _PREFIX_INDEX[_prefix].append((_name, _cas))

_suggestion_cache = {}

def _get_suggestions(typed):
    # Normalize whitespace but KEEP trailing space (user typed space to narrow)
    ql = re.sub(r'\s+', ' ', typed.lower()).lstrip()  # lstrip only, keep trailing space
    ql_stripped = ql.strip()
    if len(ql_stripped) < 1:
        return []
    if ql in _suggestion_cache:
        return _suggestion_cache[ql]
    seen_cas = set()
    results = []

    # 1. Exact prefix match WITH trailing space (e.g. "iso " → "iso e super")
    candidates = sorted(_PREFIX_INDEX.get(ql, []), key=lambda x: -len(x[0]))
    for name, cas in candidates:
        if cas and cas in seen_cas:
            continue
        results.append(name.title())
        if cas: seen_cas.add(cas)
        if len(results) >= 10:
            break

    # 2. If trailing space gave no results → try without space
    if not results and ql != ql_stripped:
        candidates = sorted(_PREFIX_INDEX.get(ql_stripped, []), key=lambda x: -len(x[0]))
        for name, cas in candidates:
            if cas and cas in seen_cas:
                continue
            results.append(name.title())
            if cas: seen_cas.add(cas)
            if len(results) >= 10:
                break

    # 3. Space fallback — try prefix before last space
    if not results and ' ' in ql_stripped:
        shorter = ql_stripped.rsplit(' ', 1)[0]
        for name, cas in sorted(_PREFIX_INDEX.get(shorter, []), key=lambda x: -len(x[0])):
            if name.startswith(ql_stripped) or ql_stripped in name:
                if cas and cas in seen_cas:
                    continue
                results.append(name.title())
                if cas: seen_cas.add(cas)
                if len(results) >= 10:
                    break

    # 4. Substring fallback
    if len(results) < 10 and len(ql_stripped) >= 2:
        for name, cas in _PREFIX_INDEX.get(ql_stripped[:2], []):
            if ql_stripped in name and name.title() not in results:
                if cas and cas in seen_cas:
                    continue
                results.append(name.title())
                if cas: seen_cas.add(cas)
                if len(results) >= 10:
                    break

    _suggestion_cache[ql] = results[:10]
    return results[:10]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  State
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if "results" not in st.session_state:
    st.session_state.results = []
if "searched" not in st.session_state:
    st.session_state.searched = set()
if "done" not in st.session_state:
    st.session_state.done = bool(st.session_state.results)
if "pv" not in st.session_state:
    st.session_state.pv = 0
if "kv" not in st.session_state:
    st.session_state.kv = 0

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Sidebar
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
with st.sidebar:
    st.markdown("**Perfume Analyzer**")
    st.caption("v12.1")
    st.markdown("---")
    st.markdown("Data from **PubChem** (NIH)  \nPerfumery DB (CAS-validated)")
    st.markdown("---")
    st.markdown("Export: PDF · JSON")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Title + Search
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
st.markdown("## Perfume Raw Materials Analyzer")
st.caption("PubChem compound data + perfumery knowledge")
st.markdown("---")

# st_keyup — sends value on every keystroke (debounced), no fragment needed
typed = st_keyup("Search", placeholder="e.g. linalool, hedione, iso e super",
                 label_visibility="collapsed", debounce=300,
                 key=f"keyup_{st.session_state.kv}") or ""

# Pills — update in real-time as user types (from 1st character)
pill_search = None
if len(typed.strip()) >= 1:
    suggestions = _get_suggestions(typed)
    suggestions = [s for s in suggestions if s.lower() != typed.strip().lower()]
    if suggestions:
        sel = st.pills("suggestions", suggestions, label_visibility="collapsed",
                       key=f"pills_{st.session_state.pv}", default=None)
        if sel:
            pill_search = sel
            st.session_state.pv += 1

# Search button
search_clicked = st.button("Search", type="primary",
                           disabled=len(typed.strip()) == 0,
                           use_container_width=True)
st.markdown("---")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Search execution — pill click OR Search button (same page cycle)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
search_term = pill_search or (typed.strip() if search_clicked else None)

if search_term:
    names = [n.strip() for n in search_term.split(",") if n.strip()]
    existing_names = {r.name.lower() for r in st.session_state.results}
    seen_in_batch = set()
    new_names = []
    for n in names:
        nl = n.lower()
        if nl not in existing_names and nl not in seen_in_batch:
            new_names.append(n)
            seen_in_batch.add(nl)

    if new_names:
        session = make_session()
        bar = st.progress(0)
        for idx, nm in enumerate(new_names):
            bar.progress(idx / len(new_names), text=nm)
            st.session_state.searched.add(nm.lower())
            result = scrape_material(nm, session)
            st.session_state.results.append(result)
        bar.progress(1.0, text="Done")
        # Deduplicate by CAS — O(n)
        seen_cas = {}
        for i, r in enumerate(st.session_state.results):
            if r.cas_number:
                seen_cas.setdefault(r.cas_number, []).append(i)
        remove = set()
        for cas, indices in seen_cas.items():
            if len(indices) > 1:
                remove.update(indices[:-1])
        if remove:
            st.session_state.results = [r for i, r in enumerate(st.session_state.results) if i not in remove]
        st.session_state.searched = {r.name.lower() for r in st.session_state.results}
    st.session_state.done = True
    st.session_state.kv += 1  # reset keyup with empty value
    st.rerun()

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Results
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if st.session_state.results:
    rc1, rc2 = st.columns([6, 1])
    with rc1:
        ok = sum(1 for r in st.session_state.results if r.found)
        tot = len(st.session_state.results)
        st.caption(f"{ok}/{tot} found")
    with rc2:
        if st.button("Clear all", key="clear_all"):
            st.session_state.results = []
            st.session_state.searched = set()
            st.session_state.done = bool(st.session_state.results)
            st.session_state.pop("export_cache_key", None)
            st.rerun()

    last_idx = len(st.session_state.results) - 1
    for idx, mat in enumerate(st.session_state.results):
        if not mat.found:
            ex_col, btn_col = st.columns([20, 1], gap="small")
            with ex_col:
                with st.expander(f"✗  {mat.name}", expanded=False):
                    st.error(mat.error)
            with btn_col:
                if st.button("✕", key=f"del_{idx}"):
                    st.session_state.results.pop(idx)
                    st.session_state.pop("export_cache_key", None)
                    st.session_state.done = bool(st.session_state.results)
                    st.session_state.searched = {r.name.lower() for r in st.session_state.results}
                    st.rerun()
            continue

        ex_col, btn_col = st.columns([20, 1], gap="small")
        with btn_col:
            if st.button("✕", key=f"del_{idx}"):
                st.session_state.results.pop(idx)
                st.session_state.pop("export_cache_key", None)
                st.session_state.done = bool(st.session_state.results)
                st.session_state.searched = {r.name.lower() for r in st.session_state.results}
                st.rerun()
        with ex_col:
            is_expanded = (idx == last_idx)
            with st.expander(mat.name, expanded=is_expanded):
                if mat.match_info:
                    st.caption(mat.match_info)

                ic, tc = st.columns([1, 3])
                with ic:
                    if mat.structure_image_url:
                        try: st.image(mat.structure_image_url, use_container_width=True)
                        except Exception: pass
                with tc:
                    id_parts = [f"**{mat.name}**"]
                    if mat.page_url:
                        id_parts.append(f"[PubChem ↗]({mat.page_url})")
                    st.markdown("  \n".join(id_parts))
                    id_labels = []
                    for lab, val in [("CAS", mat.cas_number), ("FEMA", mat.fema_number),
                        ("IUPAC", mat.iupac_name), ("Formula", mat.molecular_formula),
                        ("MW", mat.molecular_weight), ("SMILES", mat.smiles)]:
                        if val:
                            id_labels.append(f"`{lab}` {val}")
                    if id_labels:
                        st.markdown("  \n".join(id_labels))
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
                        badges = []
                        if "top" in nl: badges.append('<span class="n-badge n-top">Top</span>')
                        if "middle" in nl or "heart" in nl: badges.append('<span class="n-badge n-mid">Heart</span>')
                        if "base" in nl: badges.append('<span class="n-badge n-base">Base</span>')
                        st.markdown(" ".join(badges), unsafe_allow_html=True)
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
                    with st.expander("📋 Complete PubChem Data", expanded=False):
                        grouped = {}
                        for heading, items in mat.pubchem_sections.items():
                            top = heading.split(" > ")[0] if " > " in heading else heading
                            if top not in grouped: grouped[top] = []
                            grouped[top].append((heading, items))
                        for top_heading, sub_list in grouped.items():
                            st.markdown(f"**{top_heading}**")
                            for heading, items in sub_list:
                                display = heading.split(" > ")[-1] if " > " in heading else heading
                                if display != top_heading:
                                    st.markdown(f"*{display}*")
                                lines = []
                                for item in items[:30]:
                                    if item.startswith("http"): continue
                                    clean = re.sub(r'https?://\S+', '', item).strip()
                                    if not clean or len(clean) < 3: continue
                                    if len(clean) > 300: clean = clean[:300] + "…"
                                    lines.append(f"- {clean}")
                                if lines:
                                    st.markdown("\n".join(lines))

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Export (cached)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if st.session_state.results and st.session_state.done:
    st.markdown("---")
    cache_key = tuple((r.name, r.cas_number) for r in st.session_state.results)
    if "export_cache_key" not in st.session_state or st.session_state.export_cache_key != cache_key:
        st.session_state.export_pdf = generate_human_report(st.session_state.results)
        st.session_state.export_json = generate_ai_report(st.session_state.results)
        st.session_state.export_cache_key = cache_key

    d1, d2 = st.columns(2)
    with d1:
        st.download_button("Download.PDF", data=st.session_state.export_pdf,
            file_name="perfume_report.pdf", mime="application/pdf", use_container_width=True)
    with d2:
        st.download_button("Download.JSON", data=st.session_state.export_json,
            file_name="perfume_report_ai.json", mime="application/json", use_container_width=True)
