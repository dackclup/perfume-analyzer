#!/usr/bin/env python3
"""Re-verify the perfume research notes against MySkinRecipes and the cited web pages.

Personal research helper. Standard library only. The notes are read from the mirror of the Project docs
in project-docs/ (see docs_check.py), so every run checks the latest pushed text.

What it does (each step is polite and stops at the first refusal):
  1. robots.txt   - read the shop's robots.txt; every request below is checked against it.
  2. sitemap      - re-read the shop's public sitemaps; look up every product ID cited in the notes,
                    diff the perfumery list against file 7 (the catalog appendix), and run the failing
                    doc checks in docs_check.py. Writes sitemap_products.csv.gz for offline re-checks.
  3. expert       - for cited IDs missing from the sitemap (plus a few controls), open the shop's
                    "MY Expert" product page to see whether the product still has a live page.
  4. shop probe   - fetch a few product pages with a plain HTTP client (no browser) and record the
                    status and whether the HTML carries a price. If the HTML has prices, read prices
                    for the IDs listed in price_ids.json. If the shop answers 403/429, stop at once
                    and do not retry or work around it.
  5. links        - fetch every external link cited in the notes once; record status, page title and
                    short text excerpts around IFRA / usage numbers for manual fact-checking.

Output goes to OUT_DIR (default out/): CSV/JSON files plus summary.md and run_log.txt.
Exit code 1 when a doc check fails or the sitemap could not be read (an unchecked run is not a pass).
"""
from __future__ import annotations

import csv
import gzip
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.robotparser
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import docs_check  # noqa: E402

HERE = Path(__file__).resolve().parent
BASE = "https://www.myskinrecipes.com"
SITEMAP_INDEX = f"{BASE}/shop/sitemap.xml"
UA = (
    "Mozilla/5.0 (compatible; perfume-analyzer-verify/1.0; "
    "+https://github.com/dackclup/perfume-analyzer) personal shopping-list check"
)
OUT = Path(os.environ.get("OUT_DIR", "out"))
SHOP_DELAY = float(os.environ.get("SHOP_DELAY", "1.5"))
LINK_DELAY = float(os.environ.get("LINK_DELAY", "2.0"))
MAX_BYTES = 1_500_000

LOG: list[str] = []


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] {msg}"
    LOG.append(line)
    print(line, flush=True)


# --------------------------------------------------------------------------- parsing helpers

PRODUCT_PATH = re.compile(r"^/shop/(en|th)/([^/]+)/(\d+)-([^/]*)\.html$")
LOC_RE = re.compile(r"<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*</loc>")
URL_BLOCK_RE = re.compile(r"<url>(.*?)</url>", re.S)
IMG_TITLE_RE = re.compile(r"<image:title>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</image:title>", re.S)

PERFUMERY_CATEGORY = [
    r"aroma-chemicals", r"fragranc", r"^benchmark-", r"essential-oil", r"^bergamot-orange-lemon$",
    r"^herbs-lavender", r"^sweets-ylang", r"^woods-cedar", r"^spices-clove", r"^rose-geranium",
    r"^coniferan-balsam", r"^absolute-solvent-extract$", r"^floral-and-scent-extracts$",
    r"^lily-of-the-valley", r"^mimi-sar$", r"^solvents-polyols$",
]
REAGENT_CATEGORY = [
    r"reagent", r"standards?$", r"^analytical-", r"^certified-reference", r"^ungroupable$",
    r"derivatives?$", r"intermediates?$", r"building-blocks?$", r"linkers?$", r"dyes?$", r"labeled",
]


def unescape_twice(s: str) -> str:
    """Sitemap captions are sometimes double-encoded ("&amp;#039;")."""
    return html.unescape(html.unescape(s))


def parse_product_url(loc: str):
    parts = urlsplit(loc)
    m = PRODUCT_PATH.match(parts.path)
    if not m:
        return None
    return {"lang": m.group(1), "category": unquote(m.group(2)), "id": int(m.group(3)), "slug": unquote(m.group(4))}


def parse_sitemap_index(xml: str) -> list[str]:
    return LOC_RE.findall(xml)


def parse_sitemap_urls(xml: str):
    for block in URL_BLOCK_RE.findall(xml):
        loc = LOC_RE.search(block)
        if not loc:
            continue
        title = IMG_TITLE_RE.search(block)
        yield loc.group(1).strip(), unescape_twice(title.group(1).strip()) if title else ""


def is_perfumery(category: str, name: str) -> bool:
    if any(re.search(p, category) for p in REAGENT_CATEGORY):
        return False
    if any(re.search(p, category) for p in PERFUMERY_CATEGORY):
        return True
    return bool(re.search(r"compare to|benchmark|essential oil|fragrance oil|perfume|น้ำหอม", name, re.I))


def strip_tags(s: str) -> str:
    s = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def page_title(doc: str) -> str:
    for pat in (r'(?is)<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)',
                r"(?is)<h1[^>]*>(.*?)</h1>", r"(?is)<title[^>]*>(.*?)</title>"):
        m = re.search(pat, doc)
        if m:
            t = strip_tags(m.group(1))
            if t:
                return t[:200]
    return ""


PRICE_RE = re.compile(r"(?:฿|THB)\s*([0-9][0-9,]*(?:\.[0-9]+)?)|([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:฿|บาท|THB)", re.I)


def find_prices(doc: str) -> dict:
    """Price signals present in raw HTML (no JavaScript executed)."""
    out: dict = {}
    for blk in re.findall(r'(?is)<script[^>]+application/ld\+json[^>]*>(.*?)</script>', doc):
        try:
            data = json.loads(blk)
        except Exception:
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        for it in items:
            if isinstance(it, dict) and "Product" in str(it.get("@type")):
                offers = it.get("offers")
                offers = offers[0] if isinstance(offers, list) and offers else offers
                if isinstance(offers, dict):
                    out["ld_price"] = offers.get("price") or offers.get("lowPrice")
                    out["ld_currency"] = offers.get("priceCurrency")
                    out["ld_availability"] = str(offers.get("availability", "")).rsplit("/", 1)[-1]
    m = re.search(r'(?is)<meta[^>]+(?:property|itemprop)=["\'](?:product:price:amount|price)["\'][^>]+content=["\']([^"\']+)', doc)
    if m:
        out["meta_price"] = m.group(1)
    text = strip_tags(doc)
    hits = [h.group(0) for h in PRICE_RE.finditer(text)][:6]
    if hits:
        out["text_prices"] = hits
    per_gram = re.findall(r"฿\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*/\s*(?:gram|g|กรัม)", text, re.I)[:3]
    if per_gram:
        out["per_gram"] = per_gram
    stock = re.findall(r"(?i)(out of stock|in stock|pre-?order|discontinued|no longer available|สินค้าหมด|หมดสต็อก|พร้อมส่ง)", text)[:4]
    if stock:
        out["stock_words"] = stock
    for marker in ("__NEXT_DATA__", "__NUXT__", "__INITIAL_STATE__", "window.__APOLLO"):
        if marker in doc:
            out.setdefault("app_state", []).append(marker)
    return out


def excerpts(text: str, patterns: list[str], width: int = 160, limit: int = 8) -> list[str]:
    found = []
    for pat in patterns:
        for m in re.finditer(pat, text, re.I):
            a, b = max(0, m.start() - width), min(len(text), m.end() + width)
            snip = text[a:b].strip()
            if snip not in found:
                found.append(snip)
            if len(found) >= limit:
                return found
    return found


# --------------------------------------------------------------------------- HTTP with guard rails


@dataclass
class Resp:
    url: str
    status: int
    final_url: str = ""
    ctype: str = ""
    body: str = ""
    error: str = ""


@dataclass
class Area:
    """A group of requests that stops for good after the first refusal."""

    name: str
    delay: float
    stopped: str = ""
    last: float = 0.0
    count: int = 0
    codes: Counter = field(default_factory=Counter)


ROBOTS: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def robots_for(url: str):
    host = urlsplit(url).scheme + "://" + urlsplit(url).netloc
    if host not in ROBOTS:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(host + "/robots.txt")
        try:
            req = urllib.request.Request(host + "/robots.txt", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read(300_000).decode("utf-8", "replace")
            rp.parse(raw.splitlines())
            if "myskinrecipes.com" in host:
                (OUT / f"robots_{urlsplit(url).netloc}.txt").write_text(raw, encoding="utf-8")
        except urllib.error.HTTPError as e:
            # 404 -> everything allowed; 401/403 -> treat as disallow-all (robots convention)
            rp.parse([] if e.code == 404 else ["User-agent: *", "Disallow: /"])
            if "myskinrecipes.com" in host:
                (OUT / f"robots_{urlsplit(url).netloc}.txt").write_text(f"HTTP {e.code}\n", encoding="utf-8")
        except Exception as e:  # network trouble: be conservative for the shop, permissive elsewhere
            rp.parse(["User-agent: *", "Disallow: /"] if "myskinrecipes.com" in host else [])
            log(f"robots.txt unreachable for {host}: {e}")
        ROBOTS[host] = rp
    return ROBOTS[host]


SHOP_REFUSED = ""  # set on the first 403/429 from any myskinrecipes.com page; every later shop request is skipped


def is_shop(url: str) -> bool:
    return urlsplit(url).netloc.endswith("myskinrecipes.com")


def get(url: str, area: Area, max_bytes: int = MAX_BYTES) -> Resp:
    global SHOP_REFUSED
    if area.stopped:
        return Resp(url, 0, error=f"skipped: {area.name} stopped ({area.stopped})")
    if SHOP_REFUSED and is_shop(url):
        return Resp(url, 0, error=f"skipped: the shop refused earlier ({SHOP_REFUSED})")
    if not robots_for(url).can_fetch(UA, url):
        return Resp(url, 0, error="skipped: disallowed by robots.txt")
    wait = area.delay - (time.monotonic() - area.last)
    if wait > 0:
        time.sleep(wait)
    area.last = time.monotonic()
    area.count += 1
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en,th;q=0.8",
        "Accept-Encoding": "gzip",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read(max_bytes)
            if r.headers.get("Content-Encoding") == "gzip":
                try:
                    raw = gzip.decompress(raw)
                except Exception:
                    pass
            resp = Resp(url, r.status, r.geturl(), r.headers.get("Content-Type", ""), raw.decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        resp = Resp(url, e.code, getattr(e, "url", url) or url, e.headers.get("Content-Type", "") if e.headers else "",
                    error=f"HTTP {e.code}")
    except Exception as e:
        resp = Resp(url, 0, error=f"{type(e).__name__}: {e}"[:200])
    area.codes[resp.status] += 1
    if resp.status in (403, 429) and is_shop(url):
        SHOP_REFUSED = area.stopped = f"HTTP {resp.status} on {url}"
        log(f"{area.name}: the shop refused (HTTP {resp.status}); no more requests to the shop in this run")
    return resp


def write_csv(path: Path, rows: list[dict], cols: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: (json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v) for k, v in r.items()})


# --------------------------------------------------------------------------- steps


MIN_PRODUCTS = 200_000  # 301,300 products on 2026-10-14; far fewer means a partial read, not a smaller shop


def step_sitemap(area: Area) -> tuple[dict[int, dict], str]:
    """All English product URLs, plus a reason when the read is incomplete ("" when complete)."""
    r = get(SITEMAP_INDEX, area)
    if r.status != 200:
        log(f"sitemap index failed: {r.status} {r.error}")
        return {}, f"sitemap index: {r.status} {r.error}".strip()
    children = [u for u in parse_sitemap_index(r.body) if re.search(r"_en_\d+_sitemap\.xml$", u)]
    log(f"sitemap index: {len(children)} English sitemaps")
    if not children:
        return {}, "no English sitemaps in the index"
    by_id: dict[int, dict] = {}
    failed = []
    for child in children:
        cr = get(child, area, max_bytes=80_000_000)
        if cr.status != 200:
            log(f"  {child}: {cr.status} {cr.error}")
            failed.append(child)
            continue
        n = 0
        for loc, title in parse_sitemap_urls(cr.body):
            p = parse_product_url(loc)
            if not p or p["lang"] != "en":
                continue
            n += 1
            by_id.setdefault(p["id"], {"id": p["id"], "category": p["category"],
                                       "name": title or p["slug"].replace("-", " "), "url": loc})
        log(f"  {child.rsplit('/', 1)[-1]}: {n} product URLs")
    log(f"products in sitemaps: {len(by_id)}")
    if failed:
        return by_id, f"{len(failed)} of {len(children)} sitemaps could not be read"
    if len(by_id) < MIN_PRODUCTS:
        return by_id, f"only {len(by_id):,} products (expected at least {MIN_PRODUCTS:,})"
    return by_id, ""


def step_expert(ids: list[int], area: Area) -> list[dict]:
    rows = []
    for i in ids:
        url = f"{BASE}/expert/product/{i}?lang=en"
        r = get(url, area)
        row = {"id": i, "status": r.status, "error": r.error, "final_url": r.final_url}
        if r.status == 200:
            row["title"] = page_title(r.body)
            shop = sorted(set(re.findall(r'https?://(?:www\.)?myskinrecipes\.com/shop/(?:en|th)/[^"\'<>\s]+?/%d-[^"\'<>\s]*?\.html' % i, r.body)))
            row["shop_links"] = shop[:3]
            m = re.search(r"Product ID:\s*#?(\d+)", strip_tags(r.body))
            row["page_product_id"] = m.group(1) if m else ""
            row["has_product"] = bool(shop) or bool(m)
        rows.append(row)
        if area.stopped:
            break
    return rows


def step_shop_probe(urls: list[str], area: Area) -> tuple[list[dict], bool]:
    rows, any_price = [], False
    for u in urls:
        r = get(u, area)
        info = find_prices(r.body) if r.body else {}
        any_price |= bool(info.get("ld_price") or info.get("meta_price") or info.get("per_gram"))
        rows.append({"url": u, "status": r.status, "error": r.error, "final_url": r.final_url,
                     "bytes": len(r.body), "title": page_title(r.body) if r.body else "",
                     "signals": info, "head": r.body[:600]})
        if area.stopped:
            break
    return rows, any_price


IFRA_PATTERNS = [r"IFRA", r"Cat(?:egory)?\.?\s*4", r"average use", r"% in (?:a )?(?:perfume|fragrance) compound",
                 r"typical usage", r"\b\d+(?:\.\d+)?\s*%"]


def step_links(links: dict[str, dict], areas: dict[str, Area], shop_ok: bool = True) -> list[dict]:
    rows = []
    for url, meta in links.items():
        host = urlsplit(url).netloc
        shop = "myskinrecipes.com" in host
        if shop and not shop_ok:
            rows.append({"url": url, "docs": meta["docs"], "status": 0, "error": "skipped: sitemap step incomplete"})
            continue
        area = areas.setdefault(host, Area(f"shop-links:{host}" if shop else f"link:{host}", SHOP_DELAY if shop else LINK_DELAY))
        r = get(url, area)
        text = strip_tags(r.body) if r.body and "html" in (r.ctype or "html") else ""
        row = {"url": url, "docs": meta["docs"], "doc_text": meta["texts"][0] if meta["texts"] else "",
               "status": r.status, "final_url": r.final_url, "ctype": r.ctype.split(";")[0], "error": r.error,
               "title": page_title(r.body) if r.body else "", "chars": len(text)}
        if text:
            row["excerpts"] = excerpts(text, IFRA_PATTERNS if any(k in host for k in ("fraterworks", "scentspiracy", "myskinrecipes", "pellwall", "thegoodscents", "scentree")) else [r"IFRA", r"\b\d+(?:\.\d+)?\s*%"], limit=10)
        rows.append(row)
    return rows


# --------------------------------------------------------------------------- main


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    docs_dir = Path(os.environ.get("DOCS_DIR", str(docs_check.DOCS_DIR)))
    lines = docs_check.read_docs(docs_dir)
    doc_links = docs_check.external_links(lines)
    snapshot = {int(r["id"]): r for r in docs_check.read_catalog(docs_dir)}
    log(f"docs: {len(lines)} lines · {len(doc_links)} links · file 7 rows {len(snapshot)}")
    price_ids_file = HERE / "price_ids.json"
    price_ids = json.loads(price_ids_file.read_text()) if price_ids_file.exists() else []

    shop_area = Area("shop-sitemap", 0.5)
    sitemap, sitemap_problem = step_sitemap(shop_area)
    summary: dict = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "sitemap_products": len(sitemap)}
    if sitemap_problem:  # a partial table would turn every unread product into a false "missing" and be reused later
        log(f"sitemap incomplete ({sitemap_problem}): ID, link and 'ร้านไม่มี' checks skipped, table not written")
        summary["sitemap_problem"] = sitemap_problem
        sitemap = {}
    doc_ids = docs_check.cited_ids(lines, set(sitemap) or None)

    # 2. cited IDs vs fresh sitemap
    cited_rows = []
    for k, meta in sorted(doc_ids.items(), key=lambda kv: int(kv[0])):
        i = int(k)
        s = sitemap.get(i)
        snap = snapshot.get(i)
        cited_rows.append({
            "id": i, "in_sitemap": bool(s), "in_snapshot": bool(snap),
            "sitemap_name": s["name"] if s else "", "sitemap_category": s["category"] if s else "",
            "sitemap_url": s["url"] if s else "", "doc_names": meta.get("names", []), "doc_urls": meta.get("urls", []),
            "doc_url_matches": (not meta.get("urls")) or (bool(s) and unquote(s["url"]) in {unquote(u) for u in meta["urls"]}),
            "docs": meta.get("docs", []), "marked_x": meta.get("marked", False),
        })
    write_csv(OUT / "cited_ids.csv", cited_rows, ["id", "in_sitemap", "marked_x", "in_snapshot", "doc_url_matches", "sitemap_name",
                                                 "sitemap_category", "sitemap_url", "doc_names", "doc_urls", "docs"])
    missing = [r["id"] for r in cited_rows if not r["in_sitemap"]]
    summary["cited_ids"] = len(cited_rows)
    summary["cited_missing_from_sitemap"] = missing
    summary["cited_url_mismatch"] = [r["id"] for r in cited_rows if r["in_sitemap"] and not r["doc_url_matches"]]

    # doc checks (fail the run) + the sitemap table for offline re-checks
    if sitemap:
        with gzip.open(OUT / "sitemap_products.csv.gz", "wt", encoding="utf-8", newline="", compresslevel=9) as f:
            w = csv.writer(f)
            w.writerow(["id", "category", "name", "url"])
            for i in sorted(sitemap):
                r = sitemap[i]
                w.writerow([i, r["category"], r["name"], r["url"]])
    products = {i: docs_check.Product(i, r["category"], r["name"], r["url"]) for i, r in sitemap.items()}
    failing, allowed, stats = docs_check.run(docs_dir, products or None, docs_check.load_allow())
    docs_check.write_outputs(OUT, failing, allowed, stats)
    summary["doc_check_failing"] = len(failing)
    summary["doc_check_allowed"] = len(allowed)
    summary["doc_check_by_kind"] = dict(Counter(p.check for p in failing))

    # snapshot diff (file 7 vs now)
    if sitemap:
        gone = [{"id": i, "name": r["name"], "category": r["category"], "url": r["url"]}
                for i, r in sorted(snapshot.items()) if i not in sitemap]
        renamed = [{"id": i, "old_name": r["name"], "new_name": sitemap[i]["name"], "url": sitemap[i]["url"]}
                   for i, r in sorted(snapshot.items()) if i in sitemap and sitemap[i]["name"].strip() != r["name"].strip()]
        fresh_perf = {i: r for i, r in sitemap.items() if is_perfumery(r["category"], r["name"])}
        added = [r for i, r in sorted(fresh_perf.items()) if i not in snapshot]
        write_csv(OUT / "snapshot_gone.csv", gone, ["id", "name", "category", "url"])
        write_csv(OUT / "snapshot_renamed.csv", renamed, ["id", "old_name", "new_name", "url"])
        write_csv(OUT / "perfumery_added.csv", added, ["id", "category", "name", "url"])  # candidates for file 7
        summary.update(snapshot_rows=len(snapshot), snapshot_gone=len(gone), snapshot_renamed=len(renamed),
                       perfumery_added=len(added))
        cats = Counter(r["category"] for r in sitemap.values())
        write_csv(OUT / "category_counts.csv", [{"category": c, "products": n} for c, n in cats.most_common()],
                  ["category", "products"])

    # 3. expert pages for missing IDs (+ 5 controls that are in the sitemap); skipped without a full sitemap,
    #    because then "missing" would mean "not in file 7" and the shop would get dozens of needless requests
    missing = missing[:150] if sitemap else []
    controls = [i for i in (2845, 2810, 2665, 7789, 3222) if i in sitemap]
    expert_area = Area("shop-expert", SHOP_DELAY)
    expert = step_expert(missing + controls, expert_area)
    for row in expert:
        row["control"] = row["id"] in controls
    write_csv(OUT / "expert_pages.csv", expert, ["id", "control", "status", "has_product", "page_product_id",
                                                 "title", "shop_links", "final_url", "error"])
    summary["expert_checked"] = len(expert)
    summary["expert_codes"] = dict(expert_area.codes)
    summary["expert_stopped"] = expert_area.stopped

    # 4. shop probe: 3 live product pages + 1 cited ID missing from the sitemap + 1 made-up ID
    probe_area = Area("shop-pages", SHOP_DELAY)
    probe_urls = [sitemap[i]["url"] for i in (2845, 2810, 7789) if i in sitemap]
    if missing:
        u = next((x for r in cited_rows if r["id"] == missing[0] for x in r["doc_urls"]), None)
        if u:
            probe_urls.append(u)
    probe_urls.append(f"{BASE}/shop/en/wood-aroma-chemicals/99999999-does-not-exist.html")
    probe, has_price = step_shop_probe(probe_urls if sitemap else [], probe_area)
    write_csv(OUT / "shop_probe.csv", probe, ["url", "status", "bytes", "title", "signals", "final_url", "error", "head"])
    summary["shop_probe_codes"] = dict(probe_area.codes)
    summary["shop_probe_has_price_in_html"] = has_price
    summary["shop_probe_stopped"] = probe_area.stopped

    if has_price and price_ids and not probe_area.stopped:
        price_rows = []
        for i in price_ids:
            if i not in sitemap:
                continue
            r = get(sitemap[i]["url"], probe_area)
            price_rows.append({"id": i, "name": sitemap[i]["name"], "status": r.status,
                               "signals": find_prices(r.body) if r.body else {}, "url": sitemap[i]["url"]})
            if probe_area.stopped:
                break
        write_csv(OUT / "prices.csv", price_rows, ["id", "name", "status", "signals", "url"])
        summary["prices_read"] = len(price_rows)

    # 5. external links
    link_areas: dict[str, Area] = {}
    links = step_links(doc_links, link_areas, shop_ok=bool(sitemap))
    write_csv(OUT / "links.csv", links, ["url", "status", "final_url", "ctype", "title", "chars", "error", "docs",
                                         "doc_text", "excerpts"])
    summary["links_checked"] = len(links)
    summary["link_codes"] = dict(Counter(r["status"] for r in links))

    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    md = ["# MSR verify run", "", f"- generated: {summary['generated']}",
          f"- products in sitemap: {summary['sitemap_products']}",
          (f"- cited IDs: {summary['cited_ids']} · missing from sitemap: {len(summary['cited_missing_from_sitemap'])}" if sitemap
           else f"- cited IDs: {summary['cited_ids']} · sitemap incomplete: {summary.get('sitemap_problem', 'not read')}"),
          f"- expert pages checked: {summary['expert_checked']} · codes {summary['expert_codes']} · stopped: {summary['expert_stopped'] or 'no'}",
          f"- shop probe codes {summary['shop_probe_codes']} · price in raw HTML: {has_price} · stopped: {summary['shop_probe_stopped'] or 'no'}",
          f"- links checked: {summary['links_checked']} · codes {summary['link_codes']}"]
    if sitemap:
        md.append(f"- file 7 rows gone: {summary['snapshot_gone']} · renamed: {summary['snapshot_renamed']} · new perfumery rows not in file 7: {summary['perfumery_added']}")
    md.append(f"- **doc checks failing: {len(failing)}** {summary['doc_check_by_kind']} · allowed: {len(allowed)} (details in doc_check.md)")
    if not sitemap:
        md.append("- **sitemap unavailable: ID, link and 'ร้านไม่มี' checks did not run**")
    (OUT / "summary.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    (OUT / "run_log.txt").write_text("\n".join(LOG) + "\n", encoding="utf-8")
    print("\n".join(md))
    print((OUT / "doc_check.md").read_text(encoding="utf-8"))
    return 1 if failing or not sitemap else 0


if __name__ == "__main__":
    sys.exit(main())
