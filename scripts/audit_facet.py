#!/usr/bin/env python3
"""Reusable facet deep-audit tool — 4 probe categories, ~40 probes per facet.

Usage:
    python3 scripts/audit_facet.py <facet>           # human-readable
    python3 scripts/audit_facet.py <facet> --json    # machine-readable
    python3 scripts/audit_facet.py --all             # every configured facet
    python3 scripts/audit_facet.py --list            # list configured facets

Exit codes:
    0 — no CRITICAL findings
    1 — one or more CRITICAL findings
    2 — facet not configured, or DB / HTML parse failure
"""

import argparse
import json
import os
import re
import sys
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH     = os.path.join(REPO, "perfumery_data.js")
HTML_PATH   = os.path.join(REPO, "index.html")
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "facet_audit_config.json")

ATOMIC_WEIGHT = {"C": 12.011, "H": 1.008, "O": 15.999, "N": 14.007, "S": 32.06}
INCHIKEY_RE = re.compile(r"^[A-Z]{14}-[A-Z]{10}-[A-Z]$")
GHS_RE = re.compile(r"^GHS0\d$")
CAS_RE = re.compile(r"^\d{2,7}-\d{2}-\d$")
VALID_STRENGTHS = {
    "Low", "Medium", "High", "Very High",
    "Low to Medium", "Medium to High", "High to Very High",
}
NOTE_BUCKETS = {"Top", "Middle", "Base"}
HARD_TOX_RE = re.compile(
    r"\b(?:convulsant|GABA-?A\s*antagonist|fatal\s+if\s+(?:swallowed|ingested)|CMR\s*1[AB]?)\b",
    re.I,
)


# ─────────── loaders ───────────


def load_db():
    with open(DB_PATH) as f:
        txt = f.read()
    m = re.search(r"const PERFUMERY_DATA\s*=\s*(\{.*\});\s*$", txt, re.DOTALL)
    if not m:
        sys.stderr.write(f"FATAL: could not parse {DB_PATH}\n")
        sys.exit(2)
    return json.loads(m.group(1))


def load_html_vocab():
    with open(HTML_PATH) as f:
        html = f.read()

    def set_from(name):
        m = re.search(rf"{name}\s*=\s*new\s*Set\(\[(.*?)\]\)", html, re.DOTALL)
        if not m:
            return set()
        return set(re.findall(r"'([^']+)'", m.group(1)))

    m_ft = re.search(r"const FACET_TAGS\s*=\s*\{(.*?)\};", html, re.DOTALL)
    facet_tags = set()
    if m_ft:
        facet_tags = set(re.findall(r"(\w+)\s*:\s*'", m_ft.group(1)))

    m_pfl = re.search(r"const PRIMARY_FAMILY_LABELS\s*=\s*\{(.*?)\};", html, re.DOTALL)
    primary_families = set()
    if m_pfl:
        primary_families = set(re.findall(r"(\w+)\s*:\s*'", m_pfl.group(1)))

    m_fg = re.search(r"const FACET_GROUPS\s*=\s*\[(.*?)\];", html, re.DOTALL)
    grouped_facets = set()
    if m_fg:
        for m in re.finditer(r"facets\s*:\s*\[(.*?)\]", m_fg.group(1), re.DOTALL):
            grouped_facets.update(re.findall(r"'([^']+)'", m.group(1)))

    return {
        "facet_tags":        facet_tags,
        "primary_families":  primary_families,
        "grouped_facets":    grouped_facets,
        "pc_excluded":       set_from("PERSONAL_CARE_EXCLUDED_CAS"),
        "flavor_excluded":   set_from("FLAVOR_EXCLUDED_CAS"),
    }


def load_config():
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    cfg.pop("_comment", None)
    return cfg


# ─────────── helpers ───────────


def parse_formula(formula):
    atoms = {}
    for el, count in re.findall(r"([A-Z][a-z]?)(\d*)", formula or ""):
        if not el:
            continue
        atoms[el] = atoms.get(el, 0) + (int(count) if count else 1)
    return atoms


def calc_mw(formula):
    return sum(ATOMIC_WEIGHT.get(el, 0.0) * n for el, n in parse_formula(formula).items())


def parse_ifra_caps(text):
    caps = {}
    for m in re.finditer(r"Cat\.(\w+)\s*=\s*([\d.]+)\s*%", text or ""):
        try:
            caps[m.group(1)] = float(m.group(2))
        except ValueError:
            pass
    return caps


def collect_findings():
    return {"CRITICAL": [], "WARN": [], "INFO": []}


def mk(sev, probe_id, category, message, material=None):
    return {
        "severity": sev,
        "probe_id": probe_id,
        "category": category,
        "material": material,
        "message": message,
    }


# ─────────── probe categories ───────────


def probe_data_integrity(db, facet_cfg, facet_entries):
    out = []
    db_all = db["perfumery_db"]
    cas_name = {}
    for e in db_all:
        cas_name.setdefault(e["cas"], []).append(e["name"])

    oil_cas = set(facet_cfg.get("oil_cas", []))
    mix_cas = set(db.get("mixture_cas", []))

    for e in facet_entries:
        name, cas = e["name"], e["cas"]

        # P-cas-unique — global uniqueness
        dup = cas_name.get(cas, [])
        if len(dup) > 1:
            out.append(mk("CRITICAL", "P-cas-unique", "data_integrity",
                          f"CAS {cas} shared with: {[n for n in dup if n != name]}", name))

        # P-cas-format
        if not CAS_RE.match(cas):
            out.append(mk("CRITICAL", "P-cas-format", "data_integrity",
                          f"malformed CAS: {cas!r}", name))

        # P-fema-range
        fema = e.get("fema", "")
        if fema:
            try:
                n = int(fema)
                if not (2001 <= n <= 5999):
                    out.append(mk("CRITICAL", "P-fema-range", "data_integrity",
                                  f"FEMA {fema} outside 2001-5999", name))
            except ValueError:
                out.append(mk("CRITICAL", "P-fema-range", "data_integrity",
                              f"FEMA non-numeric: {fema!r}", name))

        # P-name-nonempty
        if not name or not name.strip():
            out.append(mk("CRITICAL", "P-name-nonempty", "data_integrity",
                          "entry has empty name", name))

        # P-synonyms-count
        syns = e.get("synonyms", [])
        if not syns or len(syns) < 2:
            out.append(mk("WARN", "P-synonyms-count", "data_integrity",
                          f"synonyms count={len(syns)} (<2)", name))

        is_oil = (cas in oil_cas) or (cas in mix_cas)

        if is_oil:
            # P-oil-no-structural-ids
            leaked = [k for k in ("smiles", "inchi", "pubchem_cid") if e.get(k)]
            if leaked:
                out.append(mk("WARN", "P-oil-no-structural-ids", "data_integrity",
                              f"oil has structural identifier fields: {leaked}", name))
            if cas not in mix_cas:
                out.append(mk("WARN", "P-oil-in-mixture-cas", "data_integrity",
                              f"oil CAS {cas} missing from mixture_cas", name))
        else:
            # P-pubchem-cid-format
            cid = e.get("pubchem_cid", "")
            if not cid or not cid.isdigit():
                out.append(mk("CRITICAL", "P-pubchem-cid-format", "data_integrity",
                              f"CID invalid or empty: {cid!r}", name))
            # P-pubchem-url-match
            url = e.get("pubchem_url", "")
            if cid and url and f"/compound/{cid}" not in url:
                out.append(mk("WARN", "P-pubchem-url-match", "data_integrity",
                              f"pubchem_url does not reference CID {cid}: {url}", name))
            # P-inchikey-format
            ik = e.get("inchi_key", "")
            if ik and not INCHIKEY_RE.match(ik):
                out.append(mk("WARN", "P-inchikey-format", "data_integrity",
                              f"InChIKey malformed: {ik}", name))
            # P-heavy-atoms-consistency
            heavy = e.get("heavy_atoms", "")
            if heavy and e.get("formula"):
                atoms = parse_formula(e["formula"])
                expected = sum(n for el, n in atoms.items() if el != "H")
                try:
                    given = int(heavy)
                    if given != expected:
                        out.append(mk("WARN", "P-heavy-atoms-consistency", "data_integrity",
                                      f"heavy_atoms={given}, formula→{expected}", name))
                except ValueError:
                    out.append(mk("WARN", "P-heavy-atoms-consistency", "data_integrity",
                                  f"heavy_atoms not integer: {heavy!r}", name))

        # P-ghs-format
        for code in e.get("ghs_codes", []):
            if not GHS_RE.match(code):
                out.append(mk("WARN", "P-ghs-format", "data_integrity",
                              f"malformed GHS code: {code!r}", name))

    return out


def probe_classification(db, html_vocab, facet_name, facet_cfg, facet_entries):
    out = []
    facet_tags = html_vocab["facet_tags"]
    primary_families = html_vocab["primary_families"]
    grouped_facets = html_vocab["grouped_facets"]

    # P-facet-in-group — verify the target facet token is rendered by the UI
    if facet_tags and facet_name not in facet_tags:
        out.append(mk("CRITICAL", "P-facet-in-vocab", "classification",
                      f"facet '{facet_name}' not in FACET_TAGS vocabulary"))
    if grouped_facets and facet_name not in grouped_facets:
        out.append(mk("WARN", "P-facet-in-group", "classification",
                      f"facet '{facet_name}' not listed in any FACET_GROUPS entry"))

    for e in facet_entries:
        name = e["name"]
        cls = e.get("classification", {}) or {}
        facets = cls.get("facets", []) or []
        primary = cls.get("primaryFamilies", []) or []
        secondary = cls.get("secondaryFamilies", []) or []

        # P-facet-included
        if facet_name not in facets:
            out.append(mk("CRITICAL", "P-facet-included", "classification",
                          f"classification.facets missing '{facet_name}': {facets}", name))

        # P-facets-nonempty
        if not facets:
            out.append(mk("CRITICAL", "P-facets-nonempty", "classification",
                          "classification.facets empty", name))

        # P-facet-vocab
        for f in facets:
            if facet_tags and f not in facet_tags:
                out.append(mk("WARN", "P-facet-vocab", "classification",
                              f"facet '{f}' not in FACET_TAGS vocabulary", name))

        # P-primary-nonempty
        if not primary:
            out.append(mk("CRITICAL", "P-primary-nonempty", "classification",
                          "primaryFamilies empty", name))

        # P-primary-families
        for p in primary:
            if primary_families and p not in primary_families:
                out.append(mk("WARN", "P-primary-families", "classification",
                              f"primaryFamilies token '{p}' not in PRIMARY_FAMILY_LABELS", name))

        # P-secondary-families
        for s in secondary:
            if primary_families and s not in primary_families:
                out.append(mk("WARN", "P-secondary-families", "classification",
                              f"secondaryFamilies token '{s}' not in PRIMARY_FAMILY_LABELS", name))

        # P-note-vocab  (accepts compound like "Top / Middle")
        note = (e.get("note") or "").strip()
        if note:
            tokens = {t.strip() for t in re.split(r"[\s/]+", note) if t.strip()}
            bad = tokens - NOTE_BUCKETS
            if bad:
                out.append(mk("WARN", "P-note-vocab", "classification",
                              f"note='{note}' contains non-canonical tokens {bad}", name))

        # P-odor-strength-vocab
        strength = (e.get("odor", {}) or {}).get("strength", "")
        if strength and strength not in VALID_STRENGTHS:
            out.append(mk("WARN", "P-odor-strength-vocab", "classification",
                          f"odor.strength '{strength}' not in {sorted(VALID_STRENGTHS)}", name))

    # P-facet-entry-count (advisory — tells when DB drifted from config)
    expected = facet_cfg.get("expected_entry_count")
    if expected is not None and len(facet_entries) != expected:
        out.append(mk("INFO", "P-facet-entry-count", "classification",
                      f"facet has {len(facet_entries)} entries, config expects {expected}"))

    return out


def probe_chemistry(db, facet_cfg, facet_entries):
    out = []
    oil_cas = set(facet_cfg.get("oil_cas", []))
    mix_cas = set(db.get("mixture_cas", []))
    isolates_cfg = facet_cfg.get("isolates", {})
    iupac_expect = facet_cfg.get("iupac_expectations", {})

    idx = {e["cas"]: e for e in facet_entries}
    iso_entries = [e for e in facet_entries if e["cas"] not in (oil_cas | mix_cas)]

    # P-iso-id-complete
    required = ("iupac", "formula", "weight", "smiles", "inchi", "inchi_key",
                "pubchem_cid", "pubchem_url")
    for e in iso_entries:
        missing = [k for k in required if not e.get(k)]
        if missing:
            out.append(mk("CRITICAL", "P-iso-id-complete", "chemistry",
                          f"isolate missing fields: {missing}", e["name"]))

    # P-inchi-prefix
    for e in iso_entries:
        inchi = e.get("inchi", "")
        if inchi and not inchi.startswith("InChI=1S/"):
            out.append(mk("WARN", "P-inchi-prefix", "chemistry",
                          f"InChI missing 'InChI=1S/' prefix: {inchi[:30]}…", e["name"]))

    # P-formula-mw-match (tolerance 0.5)
    for e in iso_entries:
        f, w = e.get("formula", ""), e.get("weight", "")
        if not (f and w):
            continue
        try:
            given = float(w)
        except ValueError:
            out.append(mk("WARN", "P-formula-mw-match", "chemistry",
                          f"weight not numeric: {w!r}", e["name"]))
            continue
        calc = calc_mw(f)
        if abs(calc - given) > 0.5:
            out.append(mk("WARN", "P-formula-mw-match", "chemistry",
                          f"formula {f} ⇒ {calc:.2f}, stated {given}", e["name"]))

    # P-formula-vs-expected / P-mw-vs-expected / P-cid-vs-expected
    for cas, spec in isolates_cfg.items():
        e = idx.get(cas)
        if not e:
            out.append(mk("CRITICAL", "P-iso-present", "chemistry",
                          f"configured isolate CAS {cas} ({spec.get('name','?')}) not found in facet"))
            continue
        if spec.get("formula") and e.get("formula") != spec["formula"]:
            out.append(mk("CRITICAL", "P-formula-vs-expected", "chemistry",
                          f"formula={e.get('formula')!r}, expected {spec['formula']!r}", e["name"]))
        if spec.get("mw"):
            try:
                given = float(e.get("weight", ""))
                if abs(given - float(spec["mw"])) > 0.1:
                    out.append(mk("WARN", "P-mw-vs-expected", "chemistry",
                                  f"mw={given}, expected {spec['mw']}", e["name"]))
            except ValueError:
                pass
        if spec.get("cid") and e.get("pubchem_cid") != spec["cid"]:
            out.append(mk("WARN", "P-cid-vs-expected", "chemistry",
                          f"CID={e.get('pubchem_cid')!r}, expected {spec['cid']!r}", e["name"]))

    # P-iupac-vs-expected
    for cas, want in iupac_expect.items():
        e = idx.get(cas)
        if e and want.lower() not in (e.get("iupac", "") or "").lower():
            out.append(mk("CRITICAL", "P-iupac-vs-expected", "chemistry",
                          f"iupac={e.get('iupac')!r} does not contain expected {want!r}", e["name"]))

    # P-biosynthetic-chain
    for chain in facet_cfg.get("biosynthetic_chains", []):
        pre = idx.get(chain["precursor"])
        prod = idx.get(chain["product"])
        if not pre or not prod:
            out.append(mk("INFO", "P-biosynthetic-chain", "chemistry",
                          f"chain {chain['precursor']}→{chain['product']} — endpoint missing"))
            continue
        pre_f = pre.get("formula", "")
        prod_f = prod.get("formula", "")
        if pre_f and prod_f and pre_f == prod_f:
            out.append(mk("INFO", "P-biosynthetic-chain", "chemistry",
                          f"{pre['name']} and {prod['name']} share formula {pre_f} (expected transformation: {chain.get('reaction','?')})"))

    # P-smiles-inchikey-consistency / P-smiles-formula-consistency
    # (requires RDKit; silently skipped if unavailable)
    try:
        from rdkit import Chem
        from rdkit.Chem import inchi as rdi, rdMolDescriptors
        for e in iso_entries:
            smi = e.get("smiles", "")
            stored_ik = e.get("inchi_key", "")
            stored_formula = e.get("formula", "")
            if not smi:
                continue
            mol = Chem.MolFromSmiles(smi)
            if mol is None:
                # WARN — pre-existing legacy data may have broken SMILES;
                # surface for cleanup without breaking audit baseline.
                # Upgrade to CRITICAL once legacy SMILES are cleaned up.
                out.append(mk("WARN", "P-smiles-parse", "chemistry",
                              f"SMILES does not parse: {smi!r}", e["name"]))
                continue
            # Formula consistency (WARN — many legacy entries inconsistent;
            # surface for incremental cleanup without breaking audit baseline)
            actual_formula = rdMolDescriptors.CalcMolFormula(mol)
            if stored_formula and actual_formula != stored_formula:
                out.append(mk("WARN", "P-smiles-formula-consistency", "chemistry",
                              f"SMILES gives formula {actual_formula}, stored {stored_formula!r}",
                              e["name"]))
            # InChIKey consistency (WARN — same reasoning as formula)
            if stored_ik:
                actual_ik = rdi.MolToInchiKey(mol)
                if actual_ik != stored_ik:
                    out.append(mk("WARN", "P-smiles-inchikey-consistency", "chemistry",
                                  f"SMILES gives InChIKey {actual_ik}, stored {stored_ik}",
                                  e["name"]))
    except ImportError:
        pass  # RDKit not installed — skip structural consistency checks

    # P-isomer-distinct / P-isomer-iupac-distinct
    by_formula = {}
    for e in iso_entries:
        f = e.get("formula", "")
        if f:
            by_formula.setdefault(f, []).append(e)
    for f, group in by_formula.items():
        if len(group) < 2:
            continue
        keys = [g.get("inchi_key", "") for g in group]
        iupacs = [g.get("iupac", "") for g in group]
        dup_keys = [k for k, c in Counter(keys).items() if k and c > 1]
        if dup_keys:
            out.append(mk("CRITICAL", "P-isomer-distinct", "chemistry",
                          f"formula {f} has duplicate InChIKey(s): {dup_keys} across {[g['name'] for g in group]}"))
        dup_iupac = [u for u, c in Counter(iupacs).items() if u and c > 1]
        if dup_iupac:
            out.append(mk("CRITICAL", "P-isomer-iupac-distinct", "chemistry",
                          f"formula {f} has duplicate IUPAC(s) across {[g['name'] for g in group]}: {dup_iupac}"))

    # P-exact-mass-format / P-numeric-fields
    numeric_fields = ("xlogp", "tpsa", "hbond_donor", "hbond_acceptor",
                      "rotatable_bonds", "heavy_atoms", "exact_mass")
    for e in iso_entries:
        for k in numeric_fields:
            v = e.get(k, "")
            if not v:
                continue
            try:
                float(v)
            except ValueError:
                out.append(mk("WARN", "P-numeric-fields", "chemistry",
                              f"field {k}={v!r} not numeric", e["name"]))

    return out


def probe_safety(db, html_vocab, facet_cfg, facet_entries):
    out = []
    pc_excluded = html_vocab["pc_excluded"]
    flavor_excluded = html_vocab["flavor_excluded"]
    oil_cas = set(facet_cfg.get("oil_cas", []))
    mix_cas = set(db.get("mixture_cas", []))
    isolates_cfg = facet_cfg.get("isolates", {})
    peroxide_required = set(facet_cfg.get("peroxide_required_cas", []))
    sensitizer_required = set(facet_cfg.get("sensitizer_required_cas", []))
    phototoxic_required = set(facet_cfg.get("phototoxic_required_cas", []))
    is_phenolic_facet = bool(facet_cfg.get("ifra_phenolic"))

    excl_expect = facet_cfg.get("excluded_cas_expected", {})
    pc_expected_in = set(excl_expect.get("personal_care", []))
    fl_expected_in = set(excl_expect.get("flavor", []))

    idx = {e["cas"]: e for e in facet_entries}

    for e in facet_entries:
        name, cas = e["name"], e["cas"]
        safety = e.get("safety", {}) or {}
        ifra = safety.get("ifra", "") or ""
        usage = safety.get("usage", "") or ""
        safety_text = f"{ifra}\n{usage}"

        # P-ifra-present
        if not ifra:
            out.append(mk("CRITICAL", "P-ifra-present", "safety",
                          "safety.ifra empty", name))

        # P-ifra51-mentioned
        if ifra and "IFRA 51" not in ifra:
            out.append(mk("INFO", "P-ifra51-mentioned", "safety",
                          "safety.ifra does not reference 'IFRA 51' amendment", name))

        # P-ifra-cap-format — "Cat.N = X%" consistent notation
        if ifra and "Cat." in ifra:
            bad = re.findall(r"Cat\.\s*\w+\s+\d", ifra)
            if bad:
                out.append(mk("WARN", "P-ifra-cap-format", "safety",
                              f"Cat.N format missing '=': {bad[:3]}", name))

        # P-pc-excluded-consistency
        if cas in pc_excluded and cas not in pc_expected_in:
            out.append(mk("CRITICAL", "P-pc-excluded-consistency", "safety",
                          f"CAS {cas} on PERSONAL_CARE_EXCLUDED_CAS but facet config does not expect it", name))

        # P-flavor-excluded-consistency
        if cas in flavor_excluded and cas not in fl_expected_in:
            out.append(mk("CRITICAL", "P-flavor-excluded-consistency", "safety",
                          f"CAS {cas} on FLAVOR_EXCLUDED_CAS but facet config does not expect it", name))

        # P-hard-toxicity — text-signal defense-in-depth coverage. WARN
        # (not CRITICAL) because the classifier already blocks flavor via
        # HARD_TOXICITY_RE at runtime; gap is only in PC exclusion list.
        if cas not in pc_expected_in and cas not in fl_expected_in:
            if HARD_TOX_RE.search(safety_text):
                out.append(mk("WARN", "P-hard-toxicity", "safety",
                              "safety text matches HARD_TOXICITY_RE but CAS not on PERSONAL_CARE/FLAVOR excluded list", name))

        # P-peroxide-caveat
        if cas in peroxide_required:
            if "peroxide" not in safety_text.lower():
                out.append(mk("WARN", "P-peroxide-caveat", "safety",
                              "hydrocarbon/peroxide-prone isolate lacks 'peroxide' caveat in safety text", name))

        # P-sensitizer-disclose
        if cas in sensitizer_required:
            low = safety_text.lower()
            if "sensiti" not in low and "h317" not in low:
                out.append(mk("WARN", "P-sensitizer-disclose", "safety",
                              "sensitizer-required isolate lacks 'sensiti…' or H317 disclosure", name))

        # P-phototoxic-disclose — furanocoumarin-bearing oils + photosensitizer
        # isolates must reference phototoxicity / furanocoumarin / bergapten /
        # psoralen in their safety text so the downstream UV-exposure warning
        # surfaces to the formulator.
        if cas in phototoxic_required:
            low = safety_text.lower()
            if not any(kw in low for kw in ("phototox", "furanocoumarin", "bergapten", "psoralen")):
                out.append(mk("WARN", "P-phototoxic-disclose", "safety",
                              "phototoxic-required material lacks phototox/furanocoumarin/psoralen disclosure", name))

        # P-fema-text-consistency
        if re.search(r"\bFEMA\s*\d", usage + ifra) and not e.get("fema"):
            out.append(mk("CRITICAL", "P-fema-text-consistency", "safety",
                          "safety text cites FEMA# but fema field is empty", name))

    # P-ghs-majority-match
    for cas, spec in isolates_cfg.items():
        e = idx.get(cas)
        if not e:
            continue
        want = set(spec.get("ghs", []))
        got = set(e.get("ghs_codes", []))
        if want and got != want:
            missing = want - got
            extra = got - want
            if missing:
                out.append(mk("WARN", "P-ghs-majority-match", "safety",
                              f"GHS missing vs config: {sorted(missing)} (got {sorted(got)})", e["name"]))
            if extra:
                out.append(mk("INFO", "P-ghs-majority-extra", "safety",
                              f"GHS extra vs config: {sorted(extra)}", e["name"]))

    # P-ifra-cap-order-phenolic  (QRA2: Cat.5D ≤ Cat.5B ≤ Cat.5A for sensitizers)
    # P-ifra-cap-order-cat4     (Cat.4 leave-on most permissive ≥ Cat.5A)
    cap_targets = (isolates_cfg.keys() if is_phenolic_facet
                   else facet_cfg.get("oil_cas", []))
    for cas in cap_targets:
        e = idx.get(cas)
        if not e:
            continue
        caps = parse_ifra_caps(e.get("safety", {}).get("ifra", ""))
        if not caps:
            continue
        c5a, c5b, c5d = caps.get("5A"), caps.get("5B"), caps.get("5D")
        c4 = caps.get("4")
        if is_phenolic_facet:
            if c5d is not None and c5b is not None and c5d > c5b:
                out.append(mk("WARN", "P-ifra-cap-order-phenolic", "safety",
                              f"Cat.5D={c5d}% > Cat.5B={c5b}% (QRA2 baby-category should be strictest)", e["name"]))
            if c5b is not None and c5a is not None and c5b > c5a:
                out.append(mk("WARN", "P-ifra-cap-order-phenolic", "safety",
                              f"Cat.5B={c5b}% > Cat.5A={c5a}% (face-cream dose-area higher than body)", e["name"]))
        if c4 is not None and c5a is not None and c4 < c5a:
            out.append(mk("WARN", "P-ifra-cap-order-cat4", "safety",
                          f"Cat.4={c4}% < Cat.5A={c5a}% (EDP leave-on should be most permissive)", e["name"]))

    # P-oil-in-mixture-cas (supplements data-integrity check, safety-relevant)
    for cas in oil_cas:
        if cas not in mix_cas:
            out.append(mk("WARN", "P-oil-in-mixture-cas", "safety",
                          f"oil CAS {cas} missing from mixture_cas (affects classifier gating)"))

    return out


# ─────────── orchestration ───────────


CATEGORY_LABELS = [
    ("data_integrity", "Data Integrity"),
    ("classification", "Classification"),
    ("chemistry",      "Chemistry"),
    ("safety",         "Safety"),
]


def audit_one(facet_name, db, html_vocab, config):
    facet_cfg = config.get(facet_name)
    if facet_cfg is None:
        return None, f"facet '{facet_name}' not in config"
    facet_entries = [e for e in db["perfumery_db"]
                     if facet_name in (e.get("classification", {}) or {}).get("facets", []) or []]

    findings = []
    findings += probe_data_integrity(db, facet_cfg, facet_entries)
    findings += probe_classification(db, html_vocab, facet_name, facet_cfg, facet_entries)
    findings += probe_chemistry(db, facet_cfg, facet_entries)
    findings += probe_safety(db, html_vocab, facet_cfg, facet_entries)

    stats = Counter(f["severity"] for f in findings)
    result = {
        "facet": facet_name,
        "entries": len(facet_entries),
        "stats": {
            "CRITICAL": stats.get("CRITICAL", 0),
            "WARN":     stats.get("WARN", 0),
            "INFO":     stats.get("INFO", 0),
        },
        "findings": findings,
    }
    return result, None


def render_human(result):
    lines = []
    facet = result["facet"]
    n = result["entries"]
    stats = result["stats"]
    lines.append("═" * 66)
    lines.append(f"  Facet audit: {facet}  ({n} entries)")
    lines.append("═" * 66)

    by_cat = {cat: [] for cat, _ in CATEGORY_LABELS}
    for f in result["findings"]:
        by_cat.setdefault(f["category"], []).append(f)

    for cat, label in CATEGORY_LABELS:
        entries = by_cat.get(cat, [])
        c = Counter(f["severity"] for f in entries)
        parts = []
        if c["CRITICAL"]: parts.append(f"{c['CRITICAL']} CRITICAL")
        if c["WARN"]:     parts.append(f"{c['WARN']} WARN")
        if c["INFO"]:     parts.append(f"{c['INFO']} INFO")
        summary = ", ".join(parts) if parts else "all pass"
        lines.append(f"  {label:<16}  {summary}")
    lines.append("")

    for sev in ("CRITICAL", "WARN", "INFO"):
        items = [f for f in result["findings"] if f["severity"] == sev]
        if not items:
            continue
        icon = {"CRITICAL": "🔴", "WARN": "🟡", "INFO": "ℹ️"}[sev]
        lines.append(f"{icon} {sev} — {len(items)} finding(s)")
        for f in items:
            mat = f" {f['material']}:" if f.get("material") else ""
            lines.append(f"  • [{f['probe_id']}]{mat} {f['message']}")
        lines.append("")

    lines.append("─" * 66)
    lines.append(
        f"  Totals:  🔴 {stats['CRITICAL']}   🟡 {stats['WARN']}   ℹ️ {stats['INFO']}"
    )
    exit_code = 1 if stats["CRITICAL"] > 0 else 0
    lines.append(f"  Exit code: {exit_code} "
                 f"({'CRITICAL findings present' if exit_code else 'no CRITICAL'})")
    return "\n".join(lines)


def do_list(config, db):
    print(f"{'facet':<16}{'entries':>9}  configured")
    print("-" * 40)
    for facet in sorted(config.keys()):
        n = sum(1 for e in db["perfumery_db"]
                if facet in (e.get("classification", {}) or {}).get("facets", []) or [])
        print(f"{facet:<16}{n:>9}  yes")


def main():
    ap = argparse.ArgumentParser(
        description="Deep-audit one or all facets in perfumery_data.js.")
    ap.add_argument("facet", nargs="?",
                    help="facet token (e.g. lavender, thyme) or omit with --all / --list")
    ap.add_argument("--json", action="store_true",
                    help="emit machine-readable JSON")
    ap.add_argument("--all", action="store_true",
                    help="audit every facet configured in facet_audit_config.json")
    ap.add_argument("--list", action="store_true",
                    help="list configured facets and their current entry counts")
    args = ap.parse_args()

    db = load_db()
    html_vocab = load_html_vocab()
    config = load_config()

    if args.list:
        do_list(config, db)
        return 0

    if args.all:
        results = []
        worst = 0
        for facet in sorted(config.keys()):
            result, err = audit_one(facet, db, html_vocab, config)
            if err:
                sys.stderr.write(f"skip {facet}: {err}\n")
                continue
            results.append(result)
            if result["stats"]["CRITICAL"] > 0:
                worst = 1
        if args.json:
            print(json.dumps(results, ensure_ascii=False, indent=2))
        else:
            for r in results:
                print(render_human(r))
                print()
        return worst

    if not args.facet:
        ap.print_usage(sys.stderr)
        return 2

    result, err = audit_one(args.facet, db, html_vocab, config)
    if err:
        sys.stderr.write(f"error: {err}\n")
        sys.stderr.write(f"configured facets: {sorted(config.keys())}\n")
        return 2
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(render_human(result))
    return 1 if result["stats"]["CRITICAL"] > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
