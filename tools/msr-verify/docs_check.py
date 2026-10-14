#!/usr/bin/env python3
"""Check the project docs (the mirror in project-docs/) against the shop's public sitemap.

Each failing check matches a mistake the project already made once (doc 10, section 3.2):

  missing_id       row 2  A product ID cited in files 0-7 is not in the sitemap, and the text does not
                          mark it with ⓧ (or say "ไม่อยู่ใน sitemap" on that line).
  stale_mark       row 2  An ID written as "1234 ⓧ" is back in the sitemap, so the ⓧ is wrong now.
  link_mismatch    row 5  A product link's category or name part differs from the sitemap URL of that ID.
  absent_but_sold  row 1  The docs say the shop does not have X, but a product name in the sitemap
                          contains X and the same line does not cite that product.
  banned_unmarked  row 4  A banned material (file 4 section O, rows marked ⛔) is mentioned in files 0-6
                          without ⛔ or a warning word on the same item, row or paragraph.
  index_missing    row 7  A numbered doc has no row in file 0's table of contents (a session that wrote
                          file 0 from a stale copy drops rows other sessions added).

Known, reviewed exceptions live in allow.json (one key per exception, with the reason).

Offline and standard library only. The sitemap table comes from verify.py (sitemap_products.csv.gz on
the msr-verify-data branch, fetched automatically). Run locally:

    python3 tools/msr-verify/docs_check.py            # exit 1 when a check fails
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlsplit

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DOCS_DIR = REPO / "project-docs" / "วิจัยน้ำหอมดีไซน์เนอร์"
ALLOW_FILE = HERE / "allow.json"
SITEMAP_REF = "origin/msr-verify-data:sitemap_products.csv.gz"

THAI = r"\u0E00-\u0E7F"
SHOP_PRODUCT = re.compile(r"https?://(?:www\.)?myskinrecipes\.com/shop/(en|th)/([^/\s)]+)/(\d+)-([^/\s)]*?)\.html")
SHOP_CATEGORY = re.compile(r"https?://(?:www\.)?myskinrecipes\.com/shop/(?:en|th)/(\d+)-[^/\s).]+(?=[)\s]|$)")
EXPERT = re.compile(r"https?://(?:www\.)?myskinrecipes\.com/expert/product/(\d+)")
MD_LINK = re.compile(r"\[([^\]]*)\]\((https?://[^)\s]+)\)")
BARE_URL = re.compile(r"(?<![(\[])https?://[^\s)\]|>]+")
# "(2884)", "(2890 ⓧ)", "(2456, 2459, 2461)", "(3140, แนว ...", "(รหัส 8017)"
PAREN_IDS = re.compile(
    rf"\(\s*(?:รหัส\s*)?(\d{{3,6}}(?:\s*ⓧ)?(?:\s*[,·]\s*\d{{3,6}}(?:\s*ⓧ)?)*)\s*(?:\)|,\s*(?=[{THAI}]))"
)
CODE_IDS = re.compile(r"รหัส(?:เดิม)?\s*(\d{3,6}(?:\s*/\s*\d{3,6})*)")
# Reagent listings are cited as bare 5-6 digit numbers ("Coumarin 123412") in paragraphs that say รีเอเจนต์.
REAGENT_IDS = re.compile(r"(?<![\d,.฿])(\d{5,6})(?![\d,.%])")
NOT_IN_SITEMAP = re.compile(r"ไม่อยู่ใน sitemap|ไม่มีใน sitemap|หายจาก sitemap|รายการ ⓧ")
WARNING = re.compile(r"⛔|ห้าม|ใช้ไม่ได้|ไม่ควร|เลี่ยง|ไม่แนะนำ")
# Sections that discuss materials without recommending them (sources, studies, warning sections).
NO_RECOMMENDATION_SECTION = re.compile(r"แหล่งอ้างอิง|งานวิจัย|⛔|ห้าม|ไม่ควร")
SOURCES_SECTION = re.compile(r"แหล่งอ้างอิง")
SEPARATORS = re.compile(r"\s*(?:\||\s·\s)\s*")
NAME_SPLIT = re.compile(rf"\s*(?:·|/|—|;|\s+หรือ\s+|\s+และ\s+)\s*|,\s+|\s+,")
DROP_TOKENS = {"edt", "edp", "edc", "parfum", "extrait", "the"}


# --------------------------------------------------------------------------- small helpers


def tokens(s: str) -> list[str]:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"['’`]", " ", s)
    return re.findall(r"[a-z0-9]+", s)


def plain(s: str) -> str:
    """Markdown cell -> text: drop link targets and emphasis."""
    s = MD_LINK.sub(lambda m: m.group(1), s)
    return re.sub(r"[*`]", "", s).strip()


def names_in(text: str) -> list[tuple[str, bool]]:
    """Split a cell or list into material names. Returns (name, has_id) pairs; Thai-only names are dropped."""
    out = []
    groups = []

    def hold(m):  # keep parenthesised groups out of the split, remember whether they hold an ID
        groups.append(m.group(0))
        return f"\x00{len(groups) - 1}\x00"

    held = re.sub(r"\([^()]*\)", hold, plain(text))
    for part in NAME_SPLIT.split(held):
        has_id = any(re.search(r"\d{3,6}", groups[int(i)]) for i in re.findall(r"\x00(\d+)\x00", part))
        name = re.sub(r"\x00\d+\x00", " ", part)
        name = re.sub(rf"[{THAI}]+", " ", name)
        name = re.sub(r"^[\s:\"'“”❌✅⚠️⛔ⓧ●○⭐-]+|[\s:\"'“”-]+$", "", name)
        name = re.sub(r"\s+", " ", name).strip()
        if len(re.findall(r"[A-Za-z]", name)) >= 3:
            out.append((name, has_id))
    return out


def item_at(line: str, pos: int) -> str:
    """The '|' or ' · ' separated piece of a line that contains position pos."""
    start = 0
    for m in SEPARATORS.finditer(line):
        if m.start() >= pos:
            return line[start:m.start()]
        start = m.end()
    return line[start:]


def ids_in(s: str) -> list[int]:
    return [int(x) for x in re.findall(r"(?<!\d)\d{3,6}(?!\d)", s)]


# --------------------------------------------------------------------------- reading the docs


@dataclass
class Line:
    doc: str          # "0".."6"
    no: int           # 1-based line number
    text: str
    section: str      # nearest heading
    header: list[str] = field(default_factory=list)   # table header cells when this is a table row
    scope: str = ""   # text a warning may sit in: table row, bullet line, or whole paragraph


@dataclass
class Cite:
    id: int
    doc: str
    line: int
    text: str
    strict_x: bool    # written "1234 ⓧ"
    marked: bool      # ⓧ on a one-ID item, or the line says the IDs are not in the sitemap
    one_id_item_x: bool
    url: str = ""


def doc_key(path: Path) -> str:
    m = re.match(r"(\d+)-", path.name)
    return m.group(1) if m else ""


def read_docs(docs_dir: Path) -> list[Line]:
    lines: list[Line] = []
    for path in sorted(docs_dir.glob("*.md"), key=lambda p: int(doc_key(p) or 99)):
        key = doc_key(path)
        if key not in {"0", "1", "2", "3", "4", "5", "6"}:
            continue
        raw = path.read_text(encoding="utf-8").split("\n")
        section, header, para = "", [], []
        doc_lines = []
        for i, text in enumerate(raw):
            if text.startswith("#"):
                section = text.strip()
            is_row = text.lstrip().startswith("|")
            if is_row and i + 1 < len(raw) and re.match(r"^\s*\|[\s:|-]+\|\s*$", raw[i + 1]):
                header = [plain(c) for c in text.strip().strip("|").split("|")]
            elif not is_row:
                header = []
            doc_lines.append(Line(key, i + 1, text, section, header if is_row else []))
        # warning scope: a table row or bullet stands alone; plain text lines share their paragraph
        block: list[Line] = []
        for ln in doc_lines + [Line(key, 0, "", "")]:
            t = ln.text.strip()
            standalone = t.startswith("|") or re.match(r"^([-*+]|\d+\.)\s", t)
            if not t or standalone or t.startswith("#"):
                joined = "\n".join(b.text for b in block)
                for b in block:
                    b.scope = joined
                block = []
                ln.scope = ln.text
            else:
                block.append(ln)
        lines.extend(doc_lines)
    return lines


def citations(lines: list[Line]) -> list[Cite]:
    cites: list[Cite] = []
    for ln in lines:
        text = ln.text
        found: dict[int, dict] = {}
        category_ids = {int(m.group(1)) for m in SHOP_CATEGORY.finditer(text)}
        for m in SHOP_PRODUCT.finditer(text):
            found.setdefault(int(m.group(3)), {"pos": m.start(), "url": m.group(0)})
        for m in EXPERT.finditer(text):
            found.setdefault(int(m.group(1)), {"pos": m.start(), "url": ""})
        if not SOURCES_SECTION.search(ln.section):
            if "รีเอเจนต์" in ln.scope:
                for m in REAGENT_IDS.finditer(text):
                    found.setdefault(int(m.group(1)), {"pos": m.start(), "url": ""})
            for rx in (PAREN_IDS, CODE_IDS):
                for m in rx.finditer(text):
                    for x in ids_in(m.group(1)):
                        explicit = rx is CODE_IDS or re.search(rf"{x}\s*ⓧ", m.group(1))
                        if 1900 <= x <= 2035 and not explicit:
                            continue  # a year such as "(1996)", not a product
                        if x in category_ids:
                            continue  # "[หมวด Fragrance Fixative (328)](…/shop/en/328-fragrance-fixative)"
                        found.setdefault(x, {"pos": m.start(), "url": ""})
        for x, info in found.items():
            item = item_at(text, info["pos"])
            one_id = len(set(ids_in(re.sub(r"https?://\S+", "", item)))) <= 1
            strict = bool(re.search(rf"(?<!\d){x}\s*ⓧ", text))
            one_id_item_x = "ⓧ" in item and one_id
            cites.append(Cite(x, ln.doc, ln.no, text.strip(), strict,
                              strict or one_id_item_x or bool(NOT_IN_SITEMAP.search(text)), one_id_item_x, info["url"]))
    return cites


def external_links(lines: list[Line]) -> dict[str, dict]:
    """Every cited web page except shop product pages (those are checked against the sitemap)."""
    links: dict[str, dict] = {}
    for ln in lines:
        seen = [(m.group(2), m.group(1)) for m in MD_LINK.finditer(ln.text)]
        seen += [(u, "") for u in BARE_URL.findall(MD_LINK.sub("", ln.text))]
        for url, label in seen:
            url = url.rstrip(".,;")
            if SHOP_PRODUCT.match(url):
                continue
            meta = links.setdefault(url, {"docs": [], "texts": []})
            if ln.doc not in meta["docs"]:
                meta["docs"].append(ln.doc)
            if label and label not in meta["texts"]:
                meta["texts"].append(label)
    return links


def cited_ids(lines: list[Line]) -> dict[str, dict]:
    """verify.py's view of the citations: id -> docs, context snippets, product URLs."""
    out: dict[str, dict] = {}
    for c in citations(lines):
        meta = out.setdefault(str(c.id), {"docs": [], "names": [], "urls": [], "marked": False})
        if c.doc not in meta["docs"]:
            meta["docs"].append(c.doc)
        snippet = c.text[:120]
        if snippet not in meta["names"] and len(meta["names"]) < 3:
            meta["names"].append(snippet)
        if c.url and c.url not in meta["urls"]:
            meta["urls"].append(c.url)
        meta["marked"] |= c.marked
    return out


def read_catalog(docs_dir: Path) -> list[dict]:
    path = next(iter(sorted(docs_dir.glob("7-*.csv"))), None)
    if not path:
        return []
    return list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8"))))


# --------------------------------------------------------------------------- sitemap table


@dataclass
class Product:
    id: int
    category: str
    name: str
    url: str


def load_sitemap(path: str | None) -> dict[int, Product]:
    if path:
        raw = Path(path).read_bytes()
    else:
        # the clone may track main only, so fetch the results branch into its remote ref explicitly
        subprocess.run(["git", "fetch", "-q", "origin", "+refs/heads/msr-verify-data:refs/remotes/origin/msr-verify-data"],
                       cwd=REPO, capture_output=True)
        r = subprocess.run(["git", "show", SITEMAP_REF], cwd=REPO, capture_output=True)
        if r.returncode:
            sys.exit(f"no sitemap table on the msr-verify-data branch ({r.stderr.decode().strip()})")
        raw = r.stdout
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    rows = csv.DictReader(io.StringIO(raw.decode("utf-8")))
    return {int(r["id"]): Product(int(r["id"]), r["category"], r["name"], r["url"]) for r in rows}


class NameIndex:
    def __init__(self, products: dict[int, Product]):
        self.products = products
        self.by_token: dict[str, set[int]] = {}
        self.toks: dict[int, set[str]] = {}
        for p in products.values():
            t = set(tokens(p.name)) | set(tokens(p.url.rsplit("/", 1)[-1].replace(".html", "")))
            self.toks[p.id] = t
            for x in t:
                self.by_token.setdefault(x, set()).add(p.id)

    def find(self, name: str, benchmark_only: bool = False) -> list[Product]:
        want = [t for t in tokens(name) if t not in DROP_TOKENS]
        if not want:
            return []
        hits = set.intersection(*(self.by_token.get(t, set()) for t in want))
        out = [self.products[i] for i in sorted(hits)]
        if benchmark_only:
            out = [p for p in out if "benchmark" in p.category or "benchmark" in p.name.lower()]
        return out


# --------------------------------------------------------------------------- the checks


@dataclass
class Problem:
    check: str
    doc: str
    line: int
    key: str
    detail: str
    text: str = ""


def check_ids(lines: list[Line], sitemap: dict[int, Product]) -> list[Problem]:
    out = []
    for c in citations(lines):
        p = sitemap.get(c.id)
        if not p and not c.marked:
            out.append(Problem("missing_id", c.doc, c.line, f"missing_id:{c.id}",
                               f"รหัส {c.id} ไม่อยู่ใน sitemap แต่ไม่ได้ติด ⓧ", c.text))
        if p and (c.strict_x or c.one_id_item_x):
            out.append(Problem("stale_mark", c.doc, c.line, f"stale_mark:{c.id}",
                               f"รหัส {c.id} กลับมาอยู่ใน sitemap แล้ว ({p.name}) ลบ ⓧ ออก", c.text))
        if p and c.url:
            got = SHOP_PRODUCT.match(c.url)
            if got and got.group(1) == "en":
                want = SHOP_PRODUCT.match(p.url)
                if want and (unquote(got.group(2)), unquote(got.group(4)).lower()) != (unquote(want.group(2)), unquote(want.group(4)).lower()):
                    out.append(Problem("link_mismatch", c.doc, c.line, f"link_mismatch:{c.id}",
                                       f"ลิงก์รหัส {c.id} ไม่ตรงกับ sitemap → {p.url}", c.url))
    return out


def check_catalog(rows: list[dict], sitemap: dict[int, Product]) -> list[Problem]:
    out = []
    for i, r in enumerate(rows, start=2):
        x = int(r["id"])
        p = sitemap.get(x)
        if not p:
            out.append(Problem("missing_id", "7", i, f"missing_id:{x}",
                               f"ไฟล์ 7: รหัส {x} ไม่อยู่ใน sitemap แล้ว", r.get("name", "")))
        elif unquote(r["url"]) != unquote(p.url):
            out.append(Problem("link_mismatch", "7", i, f"link_mismatch:{x}",
                               f"ไฟล์ 7: ลิงก์รหัส {x} เปลี่ยนเป็น {p.url}", r["url"]))
    return out


@dataclass
class Claim:
    doc: str
    line: int
    name: str
    benchmark_only: bool
    context: str      # the row/line; products it cites count as acknowledged


def absence_claims(lines: list[Line]) -> list[Claim]:
    claims: list[Claim] = []
    title = ""
    for ln in lines:
        t = ln.text.strip()
        bold_title = re.match(r"^\*\*\d+\.\s+(.+?)\*\*$", t)
        if bold_title:
            title = bold_title.group(1)
        bench_section = "benchmark" in ln.section.lower()
        if ln.header and t.startswith("|") and not re.match(r"^\|[\s:|-]+\|$", t):
            cells = [c.strip() for c in t.strip("|").split("|")]
            if [plain(c) for c in cells] == ln.header:
                continue
            for i, h in enumerate(ln.header[: len(cells)]):
                if "ไม่มีในร้าน" in h:
                    bench = bench_section or "benchmark" in cells[i].lower()
                    claims += [Claim(ln.doc, ln.no, n, bench, t) for n, has_id in names_in(cells[i]) if not has_id]
                elif re.search(r"MSR|MySkinRecipes|ร้าน", h) and cells[i].startswith("❌"):
                    claims += [Claim(ln.doc, ln.no, n, False, t) for n, has_id in names_in(cells[0]) if not has_id]
        if re.match(r"^[-*]\s*\*\*MSR:\*\*\s*❌", t) and title:
            name = re.sub(r"\s*\(\d{4}\).*$|\s+—.*$", "", plain(title))
            words = tokens(name)
            variants = [name] + [" ".join(words[k:]) for k in (1, 2) if len(words) > k]  # full title first
            for v in variants:
                vt = [w for w in tokens(v) if w not in DROP_TOKENS]
                if vt and (len(vt) > 1 or len(vt[0]) >= 3):
                    claims.append(Claim(ln.doc, ln.no, v, True, t))
        m = re.search(r"\*\*ไม่มีในร้าน:\*\*(.*?)(?:\s—\s|$)", t)
        if m:
            claims += [Claim(ln.doc, ln.no, n, bench_section, t) for n, has_id in names_in(m.group(1)) if not has_id]
        for m in re.finditer(rf"([A-Za-z][A-Za-z0-9 /'\-]*?)\s*ที่(?:ร้านไม่มี|หาไม่ได้)", t):
            claims += [Claim(ln.doc, ln.no, n, False, t) for n, has_id in names_in(m.group(1)) if not has_id]
    return claims


def check_absence(lines: list[Line], index: NameIndex) -> list[Problem]:
    out, seen = [], set()
    for c in absence_claims(lines):
        acknowledged = set(ids_in(c.context))
        for p in index.find(c.name, c.benchmark_only):
            if p.id in acknowledged or (c.doc, c.line, p.id) in seen:
                continue
            seen.add((c.doc, c.line, p.id))
            key = f"absent_but_sold:{' '.join(t for t in tokens(c.name) if t not in DROP_TOKENS)}:{p.id}"
            out.append(Problem("absent_but_sold", c.doc, c.line, key,
                               f'เอกสารบอกว่าร้านไม่มี "{c.name}" แต่ sitemap มี {p.name} ({p.id}) {p.url}', c.context))
    return out


def banned_list(lines: list[Line]) -> tuple[list[str], set[int]]:
    names, ids = [], set()
    for ln in lines:
        if ln.doc == "4" and re.match(r"^#+\s*O\.", ln.section) and re.match(r"^\|\s*⛔", ln.text.strip()):
            first = ln.text.strip().strip("|").split("|")[0]
            ids |= {x for g in re.findall(r"\(([^()]*)\)", first) for x in ids_in(g)}
            names += [n for n, _ in names_in(first)]
    return sorted(set(names), key=str.lower), ids


def check_banned(lines: list[Line]) -> list[Problem]:
    names, ids = banned_list(lines)
    if not names:
        return [Problem("banned_unmarked", "4", 0, "banned_list_empty", "อ่านรายการห้ามใช้จากไฟล์ 4 ส่วน O ไม่ได้")]
    name_rx = re.compile(
        r"(?<![A-Za-z0-9-])(?<![A-Za-z] )(" + "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True)) + r")(?![A-Za-z0-9-])",
        re.I,
    )
    cite_ids = {(c.doc, c.line, c.id) for c in citations(lines)}
    out = []
    for ln in lines:
        if NO_RECOMMENDATION_SECTION.search(ln.section):
            continue
        if any("เพดาน" in h for h in ln.header):
            continue  # limits tables state caps, they do not recommend
        hits = [(m.start(), m.group(1)) for m in name_rx.finditer(ln.text)]
        hits += [(m.start(), str(x)) for x in ids if (ln.doc, ln.no, x) in cite_ids
                 for m in re.finditer(rf"(?<!\d){x}(?!\d)", ln.text)]
        for pos, what in hits:
            before = ln.text[max(0, pos - 6):pos]
            if re.search(r"(แทน|มี)\s*$", before):
                continue  # "แทน Lilial" (instead of), "มี Methyl eugenol" (contains)
            if "⛔" in item_at(ln.text, pos) or WARNING.search(ln.scope):
                continue
            out.append(Problem("banned_unmarked", ln.doc, ln.no, f"banned_unmarked:{ln.doc}:{what.lower()}",
                               f'"{what}" อยู่ในรายการห้ามใช้ (ไฟล์ 4 ส่วน O) แต่บรรทัดนี้ไม่มี ⛔ หรือคำเตือน', ln.text.strip()))
    return out


def check_index(docs_dir: Path) -> list[Problem]:
    numbered = sorted({int(doc_key(p)) for p in docs_dir.iterdir() if doc_key(p)} - {0})
    index = next(iter(sorted(docs_dir.glob("0-*.md"))), None)
    if not index:
        return []
    text = index.read_text(encoding="utf-8")
    return [Problem("index_missing", "0", 0, f"index_missing:{n}", f"สารบัญไฟล์ 0 ไม่มีแถวของไฟล์ {n}")
            for n in numbered if not re.search(rf"^\|\s*\*\*{n}\s*·", text, re.M)]


# --------------------------------------------------------------------------- run


def run(docs_dir: Path, sitemap: dict[int, Product] | None, allow: dict[str, str]) -> tuple[list[Problem], list[Problem], dict]:
    lines = read_docs(docs_dir)
    problems = check_banned(lines) + check_index(docs_dir)
    stats = {"lines": len(lines), "citations": len(citations(lines)), "claims": len(absence_claims(lines)),
             "banned_names": len(banned_list(lines)[0]), "banned_ids": len(banned_list(lines)[1])}
    if sitemap:
        problems += check_ids(lines, sitemap)
        problems += check_catalog(read_catalog(docs_dir), sitemap)
        problems += check_absence(lines, NameIndex(sitemap))
        stats["sitemap_products"] = len(sitemap)
    allowed = [p for p in problems if p.key in allow]
    failing = [p for p in problems if p.key not in allow]
    stats["unused_allow"] = sorted(set(allow) - {p.key for p in problems})
    return failing, allowed, stats


def report_md(failing: list[Problem], allowed: list[Problem], stats: dict) -> str:
    md = ["# ตรวจเอกสารกับ sitemap", "",
          f"- บรรทัดที่ตรวจ {stats['lines']} · การอ้างรหัส {stats['citations']} · ข้อความ \"ร้านไม่มี\" {stats['claims']} ชื่อ"
          f" · รายการห้ามใช้ {stats['banned_names']} ชื่อ {stats['banned_ids']} รหัส"
          + (f" · สินค้าใน sitemap {stats['sitemap_products']:,}" if "sitemap_products" in stats else " · **ไม่มี sitemap (ข้ามการตรวจรหัส/ลิงก์/ร้านไม่มี)**"),
          f"- **ไม่ผ่าน {len(failing)} จุด** · ยกเว้นตาม allow.json {len(allowed)} จุด", ""]
    for p in failing:
        md.append(f"- `{p.check}` ไฟล์ {p.doc} บรรทัด {p.line}: {p.detail}")
    if stats["unused_allow"]:
        md += ["", "ข้อยกเว้นใน allow.json ที่ไม่ได้ใช้แล้ว (ลบได้): " + ", ".join(stats["unused_allow"])]
    return "\n".join(md) + "\n"


def write_outputs(out_dir: Path, failing: list[Problem], allowed: list[Problem], stats: dict) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "doc_problems.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["status", "check", "doc", "line", "key", "detail", "text"])
        for status, group in (("fail", failing), ("allowed", allowed)):
            for p in group:
                w.writerow([status, p.check, p.doc, p.line, p.key, p.detail, p.text[:300]])
    (out_dir / "doc_check.md").write_text(report_md(failing, allowed, stats), encoding="utf-8")


def load_allow(path: Path = ALLOW_FILE) -> dict[str, str]:
    if not path.exists():
        return {}
    return {e["key"]: e["why"] for e in json.loads(path.read_text(encoding="utf-8"))}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--docs", default=str(DOCS_DIR))
    ap.add_argument("--sitemap", help="sitemap_products.csv(.gz); default: from the msr-verify-data branch")
    ap.add_argument("--no-sitemap", action="store_true", help="only run checks that need no sitemap")
    ap.add_argument("--out", help="also write doc_problems.csv and doc_check.md here")
    a = ap.parse_args(argv)
    sitemap = None if a.no_sitemap else load_sitemap(a.sitemap)
    failing, allowed, stats = run(Path(a.docs), sitemap, load_allow())
    if a.out:
        write_outputs(Path(a.out), failing, allowed, stats)
    print(report_md(failing, allowed, stats))
    return 1 if failing else 0


if __name__ == "__main__":
    sys.exit(main())
