"""Offline tests for verify.py parsers. Run: python3 -m unittest tools/msr-verify/test_verify.py"""
import importlib.util
import sys
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("verify", Path(__file__).with_name("verify.py"))
v = importlib.util.module_from_spec(spec)
sys.modules["verify"] = v
spec.loader.exec_module(v)

SITEMAP_INDEX = """<?xml version="1.0"?><sitemapindex>
<sitemap><loc>https://www.myskinrecipes.com/shop/1_en_0_sitemap.xml</loc></sitemap>
<sitemap><loc><![CDATA[https://www.myskinrecipes.com/shop/1_th_0_sitemap.xml]]></loc></sitemap>
</sitemapindex>"""

SITEMAP = """<urlset>
<url><loc>https://www.myskinrecipes.com/shop/en/wood-aroma-chemicals/2845-iso-e-super.html</loc>
<image:image><image:loc>x.jpg</image:loc><image:title><![CDATA[Iso E Super, Anthamber]]></image:title></image:image></url>
<url><loc>https://www.myskinrecipes.com/shop/en/benchmark-dior/7789-sauvage-benchmark-dior.html</loc>
<image:image><image:title>Sauvage (Benchmark - Dior) &amp;#039;x&amp;#039;</image:title></image:image></url>
<url><loc>https://www.myskinrecipes.com/shop/en/2-home</loc></url>
</urlset>"""


class ParserTests(unittest.TestCase):
    def test_index(self):
        locs = v.parse_sitemap_index(SITEMAP_INDEX)
        self.assertEqual(len(locs), 2)
        self.assertTrue(locs[1].endswith("1_th_0_sitemap.xml"))

    def test_urls_and_titles(self):
        rows = list(v.parse_sitemap_urls(SITEMAP))
        self.assertEqual(rows[0][1], "Iso E Super, Anthamber")
        self.assertEqual(rows[1][1], "Sauvage (Benchmark - Dior) 'x'")
        self.assertIsNone(v.parse_product_url(rows[2][0]))
        p = v.parse_product_url(rows[0][0])
        self.assertEqual((p["id"], p["category"], p["lang"]), (2845, "wood-aroma-chemicals", "en"))

    def test_perfumery_filter(self):
        self.assertTrue(v.is_perfumery("musk-aroma-chemicals", "Galaxolide"))
        self.assertTrue(v.is_perfumery("benchmark-dior", "Sauvage"))
        self.assertFalse(v.is_perfumery("ungrouped-reagent", "Coumarin"))
        self.assertFalse(v.is_perfumery("moisturizers", "Shea butter"))

    def test_prices(self):
        html = """<html><head><meta property="og:title" content="Ambroxan">
        <script type="application/ld+json">{"@type":"Product","offers":{"price":"618.53","priceCurrency":"THB",
        "availability":"https://schema.org/InStock"}}</script></head>
        <body><h1>Ambroxan</h1><span class="price">฿618.53/gram</span> In stock</body></html>"""
        s = v.find_prices(html)
        self.assertEqual(s["ld_price"], "618.53")
        self.assertEqual(s["ld_availability"], "InStock")
        self.assertIn("฿618.53/gram", s["per_gram"][0].replace(" ", ""))
        self.assertIn("In stock", s["stock_words"])
        self.assertEqual(v.page_title(html), "Ambroxan")

    def test_empty_shell_has_no_price(self):
        shell = '<html><head><meta name="viewport" content="width=device-width"></head><body><div id="app"></div><script src="/app.js"></script></body></html>'
        self.assertEqual(v.find_prices(shell), {})

    def test_excerpts(self):
        text = "Average use 3.1% in a perfume compound. IFRA 51: 20% in finished product (Cat. 4)."
        ex = v.excerpts(text, [r"IFRA", r"average use"], width=20)
        self.assertTrue(any("IFRA 51" in e for e in ex))


if __name__ == "__main__":
    unittest.main()
