"""Offline tests for docs_check.py. Run: python3 -m unittest discover -s tools/msr-verify -p 'test_*.py'"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import docs_check as d  # noqa: E402

SHOP = "https://www.myskinrecipes.com/shop/en"

SECTION_O = """# 4 · แคตตาล็อก

## O. ⛔ ร้านมีขาย แต่ห้ามใช้

| วัตถุดิบ (รหัส) | เหตุผล |
|---|---|
| ⛔ Lyral / HICC — ชื่อในร้าน "Leerall" (2710) · Lilial (2709 ⓧ) | ห้ามใน EU |
| ⛔ Acetaldehyde (3874) | EU ห้าม |
| ⚠ Bergamot ธรรมดา (3168) | แพ้แสง |
"""

SITEMAP = {
    2845: d.Product(2845, "wood-aroma-chemicals", "Iso E Super", f"{SHOP}/wood-aroma-chemicals/2845-iso-e-super.html"),
    2810: d.Product(2810, "animal-aroma-chemicals", "Ambroxan", f"{SHOP}/animal-aroma-chemicals/2810-ambroxan.html"),
    2710: d.Product(2710, "lily-of-the-valley-aroma-chemicals", "Leerall", f"{SHOP}/x/2710-leerall.html"),
    3168: d.Product(3168, "bergamot-orange-lemon", "Bergamot Essential Oil (Italy)", f"{SHOP}/bergamot-orange-lemon/3168-bergamot-essential-oil-italy.html"),
    3874: d.Product(3874, "edible-aroma-chemicals", "Acetaldehyde", f"{SHOP}/edible-aroma-chemicals/3874-acetaldehyde.html"),
    9001: d.Product(9001, "wood-aroma-chemicals", "Orbitone (Woody Ketone)", f"{SHOP}/wood-aroma-chemicals/9001-orbitone.html"),
    9002: d.Product(9002, "benchmark-other", "Eros (Benchmark - Versace)", f"{SHOP}/benchmark-other/9002-eros-benchmark-versace.html"),
}


def run(docs: dict[str, str], sitemap=SITEMAP, allow=None):
    with tempfile.TemporaryDirectory() as tmp:
        for name, text in docs.items():
            Path(tmp, name).write_text(text, encoding="utf-8")
        if not any(n.startswith("4-") for n in docs):
            Path(tmp, "4-cat.md").write_text(SECTION_O, encoding="utf-8")
        failing, allowed, _ = d.run(Path(tmp), sitemap, allow or {})
    return sorted(p.key for p in failing), sorted(p.key for p in allowed)


class MissingIds(unittest.TestCase):
    def test_unmarked_missing_id_fails(self):
        self.assertEqual(run({"3-a.md": "- Amber Xtreme (2890)\n"})[0], ["missing_id:2890"])

    def test_marked_or_explained_missing_ids_pass(self):
        docs = {"3-a.md": "- Amber Xtreme (2890 ⓧ)\n- Neroli (3235) ไม่อยู่ใน sitemap แล้ว\n"
                          "| ○ Globanone (2893 ⓧ) · Iso E Super (2845) | x |\n"}
        self.assertEqual(run(docs)[0], [])

    def test_mark_on_a_neighbour_does_not_cover_another_id(self):
        docs = {"3-a.md": "| Cashmeran (2878) แบบ 10% (2879 ⓧ) | x |\n"}
        self.assertEqual(run(docs)[0], ["missing_id:2878"])

    def test_years_categories_and_sources_are_not_ids(self):
        docs = {"2-a.md": "| Contact allergy (1996) | x |\n"
                          f"- [หมวด Fragrance Fixative (328)]({SHOP}/328-fragrance-fixative)\n"
                          "## แหล่งอ้างอิง\n- Furfuryl alcohol (1468)\n"}
        self.assertEqual(run(docs)[0], [])

    def test_code_and_reagent_ids_are_cited(self):
        docs = {"4-a.md": SECTION_O + "\n## J. ตัวทำละลาย\n\n**Listing แบบรีเอเจนต์** (ไม่แนะนำ):\nCoumarin 123412 · DHM 56963 (1 kg ฿6,700)\n\n"
                          "- Tonka 10% ใน DPG รหัส 8017\n"}
        self.assertEqual(run(docs)[0], ["missing_id:123412", "missing_id:56963", "missing_id:8017"])

    def test_stale_mark_fails(self):
        self.assertEqual(run({"3-a.md": "- Iso E Super (2845 ⓧ)\n"})[0], ["stale_mark:2845"])


class Links(unittest.TestCase):
    def test_wrong_slug_fails_and_right_slug_passes(self):
        docs = {"3-a.md": f"- [Iso E Super (2845)]({SHOP}/wood-aroma-chemicals/2845-iso-e-super-old.html)\n"
                          f"- [Ambroxan (2810)]({SHOP}/animal-aroma-chemicals/2810-ambroxan.html)\n"}
        self.assertEqual(run(docs)[0], ["link_mismatch:2845"])

    def test_file7_rows_must_match_the_sitemap(self):
        csv = ("type,id,category,name,url,note\n"
               f"x,2845,wood-aroma-chemicals,Iso E Super,{SHOP}/wood-aroma-chemicals/2845-iso-e-super.html,\n"
               f"x,2890,musk-aroma-chemicals,Amber Xtreme,{SHOP}/musk-aroma-chemicals/2890-amber-xtreme.html,\n")
        self.assertEqual(run({"7-list.csv": csv})[0], ["missing_id:2890"])


class AbsenceClaims(unittest.TestCase):
    TABLE = "## K. ไม่มีในร้าน\n\n| ไม่มีในร้าน | ใช้แทนด้วย |\n|---|---|\n| Iso E Super Plus / Orbitone, Georgywood | Ambroxan (2810) |\n"

    def test_claim_contradicted_by_sitemap_fails(self):
        self.assertEqual(run({"3-a.md": self.TABLE})[0], ["absent_but_sold:orbitone:9001"])

    def test_product_cited_on_the_same_row_is_acknowledged(self):
        table = self.TABLE.replace("Ambroxan (2810)", "Orbitone แบบเจือ (9001)")
        self.assertEqual(run({"3-a.md": table})[0], [])

    def test_allow_list_suppresses_a_reviewed_match(self):
        failing, allowed = run({"3-a.md": self.TABLE}, allow={"absent_but_sold:orbitone:9001": "reviewed"})
        self.assertEqual((failing, allowed), ([], ["absent_but_sold:orbitone:9001"]))

    def test_perfume_entry_marked_not_at_shop(self):
        docs = {"2-a.md": "**6. Versace Eros EDT (2012) — Aurélien Guichard**\n- **โน้ต:** มินต์\n- **MSR:** ❌\n"}
        self.assertEqual(run(docs)[0], ["absent_but_sold:versace eros:9002"])

    def test_inline_list_and_free_text(self):
        docs = {"4-a.md": SECTION_O + "\n## I. Benchmark\n\n**ไม่มีในร้าน:** Eros, Good Girl — ทำเอง\n",
                "3-a.md": "- ใช้แทน Orbitone ที่ร้านไม่มี\n"}
        self.assertEqual(run(docs)[0], ["absent_but_sold:eros:9002", "absent_but_sold:orbitone:9001"])


class Banned(unittest.TestCase):
    def test_banned_material_recommended_without_warning_fails(self):
        docs = {"6-a.md": "| ชั้น | วัตถุดิบ | % |\n|---|---|---|\n| กลาง | Lyral | 5 |\n"}
        self.assertEqual(run(docs)[0], ["banned_unmarked:6:lyral"])

    def test_banned_id_without_warning_fails(self):
        self.assertEqual(run({"3-a.md": "- ลองใช้ Leerall Muguet (2710)\n"})[0],
                         ["banned_unmarked:3:2710", "banned_unmarked:3:leerall"])

    def test_warned_substituted_or_contained_mentions_pass(self):
        docs = {"3-a.md": "- ⛔ Lilial (2709 ⓧ) ห้าม\n- Hydroxycitronellal แทน Lilial\n"
                          "- Verdantiol ใช้ไม่ได้ เพราะมี Lilial\n- Cuminyl Acetaldehyde (2845)\n"
                          "| สาร | เพดานในน้ำหอมสำเร็จ |\n|---|---|\n| Lilial | 0% |\n"
                          "## ⛔ ไม่ควรซื้อ\n- Lyral (2710)\n"}
        self.assertEqual(run(docs)[0], [])

    def test_banned_list_comes_from_section_o(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "4-a.md").write_text(SECTION_O, encoding="utf-8")
            names, ids = d.banned_list(d.read_docs(Path(tmp)))
        self.assertEqual((names, sorted(ids)), (["Acetaldehyde", "HICC", "Leerall", "Lilial", "Lyral"], [2709, 2710, 3874]))


class Index(unittest.TestCase):
    def test_every_numbered_doc_needs_a_row_in_file_0(self):
        index = "| ไฟล์ | เนื้อหา |\n|---|---|\n| **3 · วัตถุดิบ** | x |\n"
        failing, _ = run({"0-index.md": index, "3-a.md": "x\n", "10-ai.md": "x\n"})
        self.assertEqual(failing, ["index_missing:10", "index_missing:4"])


class Names(unittest.TestCase):
    def test_names_in_splits_lists_and_keeps_chemical_commas(self):
        self.assertEqual(d.names_in("2,4-Decadienal (2433), Geranyl Nitrile · Norlimbanol / Timberol (ชื่อนี้) · แถบดมกลิ่น"),
                         [("2,4-Decadienal", True), ("Geranyl Nitrile", False), ("Norlimbanol", False), ("Timberol", False)])

    def test_tokens_fold_accents_and_apostrophes(self):
        self.assertEqual(d.tokens("Terre d'Hermès / Acqua di Giò"), ["terre", "d", "hermes", "acqua", "di", "gio"])


if __name__ == "__main__":
    unittest.main()
