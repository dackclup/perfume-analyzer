"""Offline tests for docs_check.py. Run: python3 -m unittest discover -s tools/msr-verify -p 'test_*.py'"""
import re
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
    9003: d.Product(9003, "research-peptides", "tyroserleutide ysl", f"{SHOP}/research-peptides/9003-tyroserleutide-ysl.html"),
    9004: d.Product(9004, "benchmark-lacoste", "Pour Homme (Benchmark - Lacoste)", f"{SHOP}/benchmark-lacoste/9004-pour-homme.html"),
    2665: d.Product(2665, "jasmine-aroma-chemicals", "Hedione", f"{SHOP}/jasmine-aroma-chemicals/2665-hedione.html"),
    1905: d.Product(1905, "beakers", "Glass beaker 50 ml", f"{SHOP}/beakers/1905-glass-beaker-50-ml.html"),
}


def run(docs: dict[str, str], sitemap=SITEMAP, allow=None):
    with tempfile.TemporaryDirectory() as tmp:
        for name, text in docs.items():
            Path(tmp, name).write_text(text, encoding="utf-8")
        if not any(n.startswith("4-") for n in docs):
            Path(tmp, "4-cat.md").write_text(SECTION_O, encoding="utf-8")
        failing, allowed, _ = d.run(Path(tmp), sitemap, allow or {})
    plain_key = lambda k: re.sub(r":[0-9a-f]{8}$", "", k)  # banned keys end with a hash of the row
    return sorted(plain_key(p.key) for p in failing), sorted(plain_key(p.key) for p in allowed)


class MissingIds(unittest.TestCase):
    def test_unmarked_missing_id_fails(self):
        self.assertEqual(run({"3-a.md": "- Amber Xtreme (2890)\n"})[0], ["missing_id:2890"])

    def test_marked_missing_ids_pass(self):
        docs = {"3-a.md": "- Amber Xtreme (2890 ⓧ) · (3290 ⓧ/3291 ⓧ)\n- **MSR:** ⓧ Acqua di Men (3140)\n"
                          "| ○ Globanone (2893 ⓧ) · Iso E Super (2845) | x |\n"}
        self.assertEqual(run(docs)[0], [])

    def test_a_phrase_on_the_line_is_not_a_mark(self):
        docs = {"3-a.md": "- Neroli (3235) ไม่อยู่ใน sitemap แล้ว ใช้ Ambroxan (2810) แทน\n- **รายการ ⓧ:** Triplal (2622) · Neroli (3235 ⓧ)\n"}
        self.assertEqual(run(docs)[0], ["missing_id:2622", "missing_id:3235"])

    def test_id_forms_in_brackets(self):
        docs = {"3-a.md": "- A (2890/2891) · B (2892 ชื่อในร้าน x) · C (2893 = D 50%) · E (#2894) · F (2895 ⛔)\n"
                          "- 6 ชิ้น (100 ml) · Jicky (1889) · ปี (1996, *J*) · บีกเกอร์ (1905) · CAS (121-33-5)\n"}
        self.assertEqual(run(docs)[0], ["missing_id:2890", "missing_id:2891", "missing_id:2892",
                                        "missing_id:2893", "missing_id:2894", "missing_id:2895"])

    def test_reagent_paragraph_skips_cas_numbers_and_prices(self):
        docs = {"4-a.md": SECTION_O + "\n## J. x\n\n**แบบรีเอเจนต์**:\nCoumarin 123412 (CAS 91-64-5, 24851-98-7) ราคา 12500 บาท\n"}
        self.assertEqual(run(docs)[0], ["missing_id:123412"])

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
    def test_link_text_id_must_match_the_url(self):
        docs = {"3-a.md": f"- [Methyl Cedryl Ketone (2843)]({SHOP}/wood-aroma-chemicals/2845-iso-e-super.html)\n"}
        self.assertEqual(run(docs)[0], ["link_label:2845", "missing_id:2843"])

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

    def test_other_phrasings(self):
        docs = {"3-a.md": "- ร้านไม่มี Hedione\n- Orbitone ไม่มีในร้าน\n- ไม่มีในร้าน: Eros — ทำเอง\n- Hedione ที่ร้านไม่มีสต็อก\n"}
        self.assertEqual(run(docs)[0], ["absent_but_sold:eros:9002", "absent_but_sold:hedione:2665", "absent_but_sold:orbitone:9001"])

    def test_benchmark_names_only_match_benchmarks(self):
        docs = {"4-a.md": SECTION_O + "\n## K. x\n\n| ไม่มีในร้าน | ใช้แทนด้วย |\n|---|---|\n| Benchmark: Eros, YSL | ทำเอง |\n"}
        self.assertEqual(run(docs)[0], ["absent_but_sold:eros:9002"])

    def test_generic_words_from_a_title_are_not_claims(self):
        docs = {"2-a.md": "**3. Prada L'Homme EDT (2016) — X**\n- **MSR:** ❌\n"}
        self.assertEqual(run(docs)[0], [])

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
                          "- Tuberose มี Methyl Eugenol\n- **ห้ามใช้:** Lyral · Lilial\n"
                          "## ⛔ ไม่ควรซื้อ\n- Lyral (2710)\n",
                "1-a.md": "| สาร | เพดานในน้ำหอมสำเร็จ |\n|---|---|\n| Lilial | 0% |\n"}
        self.assertEqual(run(docs)[0], [])

    def test_recommendations_that_look_like_exceptions_fail(self):
        docs = {"6-a.md": "| ชั้น | วัตถุดิบ | % |\n|---|---|---|\n| กลาง | Muguet Lyral | 5 |\n"
                          "- อยากได้ Muguet → ตัวแทน Lyral 2%\n- ร้านมี Lilial ใช้ 1% · Coumarin ไม่ควรเกิน 1.5%\n"
                          "| สาร | ในขวด | เพดาน |\n|---|---|---|\n| Acetaldehyde | 0.1% | — |\n"}
        self.assertEqual(run(docs)[0], ["banned_unmarked:6:acetaldehyde", "banned_unmarked:6:lilial",
                                        "banned_unmarked:6:lyral", "banned_unmarked:6:lyral"])

    def test_allow_entry_is_tied_to_the_row_text(self):
        row = "| Study (1996) | Lyral เป็น allergen | x |\n"
        key = "banned_unmarked:2:lyral:" + d.short_hash(row.strip())
        self.assertEqual(run({"2-a.md": row}, allow={key: "research table"}), ([], ["banned_unmarked:2:lyral"]))
        self.assertEqual(run({"2-a.md": row.replace("allergen", "allergen ใช้ 5%")}, allow={key: "research table"})[0],
                         ["banned_unmarked:2:lyral"])

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
