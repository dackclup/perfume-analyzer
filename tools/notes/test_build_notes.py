"""Tests for tools/notes/build_notes.py — run: python3 -m unittest discover -s tools/notes -p 'test_*.py'"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_notes as B  # noqa: E402


class Parsers(unittest.TestCase):
    def test_hours(self):
        self.assertEqual(B.parse_hours('Lasts > 172 hours on a smelling strip.'), 172)
        self.assertEqual(B.parse_hours('> 1 month'), 720)
        self.assertEqual(B.parse_hours('about 2 weeks'), 336)
        self.assertEqual(B.parse_hours('3 days'), 72)
        self.assertIsNone(B.parse_hours(None))
        self.assertIsNone(B.parse_hours('long lasting'))

    def test_pct(self):
        self.assertAlmostEqual(B.parse_pct('3.1% in a perfume compound'), 3.1)
        self.assertEqual(B.parse_pct('2–10%'), 6)
        self.assertEqual(B.parse_pct('ราว 0.2%'), 0.2)
        self.assertEqual(B.parse_pct('≤0.5%'), 0.5)
        self.assertEqual(B.parse_pct('ระดับ ppm'), 0.001)
        self.assertIsNone(B.parse_pct('as needed'))
        # forms found by the independent review (18 Oct 2026)
        self.assertEqual(B.parse_pct('2% to 10% in a perfume compound'), 6)
        self.assertIsNone(B.parse_pct('0.02% to 1% maximum in fine fragrance'))
        self.assertEqual(B.parse_pct('0.15/1.0 in a perfume compound'), 0.15)

    def test_use_class(self):
        self.assertEqual([B.use_class(p) for p in (20, 3, 0.3, 0.01, None)], ['bulk', 'normal', 'accent', 'trace', None])

    def test_volatility(self):
        self.assertEqual(B.map_volatility('Head/Heart'), ['top', 'mid'])
        self.assertEqual(B.map_volatility('Base Note'), ['base'])
        self.assertEqual(B.map_volatility('Heart Note'), ['mid'])
        self.assertEqual(B.map_volatility('Top Note'), ['top'])
        self.assertEqual(B.map_volatility(None), [])

    def test_span_and_primary(self):
        self.assertEqual(B.span(['base', 'top']), ['top', 'base'])
        self.assertEqual(B.primary(['mid', 'base', 'base', 'base']), 'base')   # Iso E Super: file 5 mid–base, both sites Base
        self.assertEqual(B.primary(['mid', 'mid', 'base']), 'mid')            # Hedione: file 5 + ScenTree mid, Fraterworks Base
        self.assertEqual(B.primary(['top', 'mid']), 'mid')                    # tie with mid -> mid
        self.assertEqual(B.primary(['top', 'base']), 'top')
        self.assertEqual(B.primary(['base', 'mid'], ['base']), 'base')         # Coumarin: file 5 base vs ScenTree heart
        self.assertEqual(B.primary(['top', 'mid'], ['top']), 'top')           # Dihydromyrcenol: file 5 top vs ScenTree heart
        self.assertEqual(B.primary(['top', 'mid'], (), 'top'), 'top')          # Limonene: ScenTree Head/Heart, 4 h on the strip
        self.assertEqual(B.primary(['mid', 'base'], (), 'base'), 'base')       # Olibanum: ScenTree Heart/Base, 188 h


class Hours(unittest.TestCase):
    def test_hours_layer_matches_file5_table(self):
        rows = json.load(open(os.path.join(B.SRC, 'file5_tenacity.json'), encoding='utf-8'))['rows']
        for r in rows:
            self.assertIn(B.hours_layer(r['h']), r['layer'], r['name'])

    def test_cutoffs(self):
        self.assertEqual([B.hours_layer(h) for h in (4, 11.9, 12, 149, 150, 720)], ['top', 'top', 'mid', 'mid', 'base', 'base'])


class Rules(unittest.TestCase):
    def test_natural_rules(self):
        self.assertEqual(B.rule_layer({'n': 'Bergamot Essential Oil (Fruit, India)', 't': 2, 'f': 'citrus'}, None)[0], ['top'])
        self.assertEqual(B.rule_layer({'n': 'Black Pepper Oil (Seed)', 't': 2, 'f': 'spice'}, None)[0], ['top', 'mid'])
        self.assertEqual(B.rule_layer({'n': 'Labdanum Absolute', 't': 2, 'f': 'amber'}, None)[0], ['base'])
        self.assertEqual(B.rule_layer({'n': 'Rose Geranium Oil (Flower)', 't': 2, 'f': 'floral'}, None)[0], ['mid'])
        # specific names before general ones (found in review of the first build)
        self.assertEqual(B.rule_layer({'n': 'Orange Blossom Flower Absolute', 't': 2, 'f': 'floral'}, None)[0], ['mid'])
        self.assertEqual(B.rule_layer({'n': 'Ginger Lily Absolute', 't': 2, 'f': 'floral'}, None)[0], ['mid'])
        self.assertEqual(B.rule_layer({'n': 'Bois De Rose (Rosewood) Oil Brazil', 't': 2, 'f': 'floral'}, None)[0], ['top', 'mid'])
        self.assertEqual(B.rule_layer({'n': 'Melissa (Lemon Balm) Oil (Leaf)', 't': 2, 'f': 'citrus'}, None)[0], ['top', 'mid'])
        self.assertEqual(B.rule_layer({'n': 'Tulip Absolute', 't': 2, 'f': 'floral'}, None)[0], ['mid'])
        self.assertEqual(B.rule_layer({'n': 'Lemon Oil (Peel 5x, Italy)', 't': 2, 'f': 'citrus'}, None)[0], ['top', 'mid'])
        self.assertEqual(B.rule_layer({'n': 'Elemi Gum', 't': 2, 'f': 'spice'}, None)[0], ['mid', 'base'])
        why = B.rule_layer({'n': 'Sandalwood Fragrance Oil (Natural-Like)', 't': 2, 'f': 'wood'}, None)[1]
        self.assertIn('น้ำมันผสม', why)

    def test_chemical_rules(self):
        # crystals with low molecular weight stay in the base (the MW-only rule got these wrong)
        self.assertEqual(B.rule_layer({'n': 'Vanillin (FEMA-3107)', 't': 1, 'f': 'sweet'}, 152.1)[0], ['base'])
        self.assertEqual(B.rule_layer({'n': 'Ethyl Maltol (FEMA-3487)', 't': 1, 'f': 'sweet'}, 140.1)[0], ['base'])
        self.assertEqual(B.rule_layer({'n': 'Decanal, aldehyde C-10', 't': 1, 'f': 'citrus'}, 156.3)[0], ['top'])
        self.assertEqual(B.rule_layer({'n': 'Some Ester', 't': 1, 'f': 'fruit'}, 130)[0], ['top'])
        self.assertEqual(B.rule_layer({'n': 'Some Ketone', 't': 1, 'f': 'floral'}, 180)[0], ['mid'])
        self.assertEqual(B.rule_layer({'n': 'Some Heavy Ether', 't': 1, 'f': 'fruit'}, 240)[0], ['base'])
        self.assertEqual(B.rule_layer({'n': 'Unknown Thing', 't': 1, 'f': 'floral'}, None), (None, None))
        self.assertEqual(B.rule_layer({'n': 'Delta-dodecalactone', 't': 1, 'f': 'fruit'}, 198)[0], ['mid', 'base'])
        self.assertEqual(B.rule_layer({'n': 'Geranyl Isobutyrate', 't': 1, 'f': 'floral'}, 224)[0], ['mid'])
        self.assertEqual(B.rule_layer({'n': 'Alpha-methyl Cinnamaldehyde', 't': 1, 'f': 'spice'}, None)[0], ['mid', 'base'])

    def test_facets(self):
        self.assertEqual(B.facets_of(['dry', 'ambery', 'cedar-like', 'woody']), ['amber', 'woody'])
        self.assertIn('citrus', B.facets_of(['Floral', 'Light Flowers', 'lemon']))
        # word boundaries: pineapple is not pine, tart is not tar, rosemary is not rose
        self.assertNotIn('woody', B.facets_of(['pineapple']))
        self.assertNotIn('animalic', B.facets_of(['tart', 'fruity']))
        self.assertNotIn('floral', B.facets_of(['rosemary']))
        self.assertIn('woody', B.facets_of(['pine', 'resinous']))


class Built(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.items, cls.out, *_ = B.build()

    def test_every_selectable_item_has_layer_and_label(self):
        self.assertEqual(len(self.out), len(self.items))
        for k, v in self.out.items():
            self.assertIn(v['l'], B.L, k)
            self.assertEqual(len(v['r']), 2, k)
            lo, hi = B.L.index(v['r'][0]), B.L.index(v['r'][1])
            self.assertTrue(lo <= B.L.index(v['l']) <= hi, k)
            self.assertIn(v['lb'], ('ok', 'inf', 'gs'), k)

    def test_labels_match_sources(self):
        for k, v in self.out.items():
            if v['lb'] == 'ok':
                self.assertTrue(set(v['src']) & {'f5', 'st', 'review'}, k)
            else:
                self.assertTrue(v.get('why'), f'{k} inferred/guessed row needs a reason')

    def test_fraterworks_note_is_not_a_level2_opinion(self):
        for k, v in self.out.items():
            self.assertNotIn('fw', v['src'], k)
            if v['src'] == ['fwh']:
                self.assertEqual(v['lb'], 'inf', k)

    def test_hours_widen_one_layer_only(self):
        for k, v in self.out.items():
            if v.get('hw'):
                self.assertEqual(v['lb'], 'ok', k)
        if '2426' in self.out and 'fwh' in self.out['2426'].get('cf', ''):
            self.assertEqual(self.out['2426']['r'], ['top', 'top'])   # Nonanal: top role, 250 h on the strip -> flagged, not widened

    def test_file5_rows_are_confirmed(self):
        for c in (2845, 2665, 2810, 2819, 2557, 2821):
            self.assertEqual(self.out[str(c)]['lb'], 'ok', c)
        self.assertEqual(self.out['2819'].get('e'), 1)   # Ethyl Maltol: strong from the opening (file 5)

    def test_no_regulatory_numbers_from_supplier_pages(self):
        p = os.path.join(B.SRC, 'supplier.jsonl')
        if not os.path.exists(p):
            self.skipTest('no supplier data yet')
        for line in open(p, encoding='utf-8'):
            r = json.loads(line)
            for side in ('scentree', 'fraterworks'):
                for k, v in (r.get(side) or {}).items():
                    if k in ('url', 'name'):
                        continue
                    txt = json.dumps(v, ensure_ascii=False).lower()
                    for bad in ('ifra', 'max_use', 'finished product', 'cat. 4'):
                        self.assertNotIn(bad, txt, f"{r['i']} {side}.{k}")

    def test_outputs_up_to_date(self):
        self.assertEqual(B.main(['--check']), 0)


class Embedded(unittest.TestCase):
    """The app carries a compact copy of notes.json and styles.json (tools/notes/embed_notes.py, file 12 phase 2)."""

    def test_app_copy_up_to_date(self):
        import embed_notes as E
        self.assertEqual(E.main(['--check']), 0)

    def test_style_codes_are_selectable_and_signatures_are_notes(self):
        import embed_notes as E
        html = open(E.APP, encoding='utf-8').read()
        data = json.loads(E.build(html))
        self.assertEqual(len(data['styles']), 10)
        for s in data['styles']:
            for c in list(s['notes']) + list(s['expected']) + [str(c) for c in s['sets']]:
                self.assertIn(str(c), data['items'], (s['id'], c))
            self.assertTrue(set(s['sig']) <= set(s['notes']) | set(s['expected']), s['id'])
            self.assertFalse(set(s['notes']) & set(s['expected']), s['id'])
            for refs in [list(v) for v in s['notes'].values()] + list(s['expected'].values()) + list(s['sig'].values()):
                self.assertTrue(refs and set(refs) <= set(s['refs']), s['id'])
            for per in s['notes'].values():
                for v in per.values():
                    self.assertTrue(v is None or (isinstance(v, str) and v.strip()), s['id'])

    def test_fraterworks_average_of_a_diluted_product_is_converted_to_pure(self):   # review round 48: Cocoa 5% IPM read as 43% pure
        import build_notes as B
        notes = json.load(open(os.path.join(B.ROOT, 'notes', 'notes.json'), encoding='utf-8'))['items']
        seen = 0
        for line in open(os.path.join(B.ROOT, 'notes', 'sources', 'supplier.jsonl'), encoding='utf-8'):
            if not line.strip():
                continue
            r = json.loads(line)
            fw = r.get('fraterworks') or {}
            d, p = B.fw_dilution(fw.get('name')), B.parse_pct(fw.get('avg_use'))
            n = notes[str(r['i'])]
            if d and p is not None and n.get('ups') == 'fw':
                self.assertAlmostEqual(n['up'], p * d / 100, places=12, msg=r['i'])
                self.assertEqual(n.get('upd'), d, r['i'])
                seen += 1
            elif n.get('ups') == 'fw':
                self.assertNotIn('upd', n, r['i'])
        self.assertEqual(seen, 4)   # Cocoa 5% IPM · Popcorn Pyrazine 1% DPG · Benzoin 50% TEC · Sandela 85 IPM
        self.assertAlmostEqual(notes['3272']['up'], 2.15, places=12)
        self.assertEqual(B.fw_dilution('Galaxolide®'), None)
        self.assertEqual(B.fw_dilution('Sandela® 85 IPM'), 85)

    def test_usage_and_dilution_for_the_summary(self):   # phase 3: Fraterworks averages only, and file 5's three dilution lists
        import embed_notes as E
        html = open(E.APP, encoding='utf-8').read()
        data = json.loads(E.build(html))
        notes = json.load(open(E.NOTES, encoding='utf-8'))['items']
        for k, a in data['items'].items():
            n = notes[k]
            self.assertEqual(a[10], n['up'] if n.get('ups') == 'fw' else 0, k)
        roles = json.load(open(E.ROLES, encoding='utf-8'))
        self.assertEqual(data['dil'], {'10': roles['dilute_10']['codes'], '1': roles['dilute_1']['codes'], '0.1': roles['dilute_01']['codes']})
        self.assertIn(2810, data['dil']['10'])   # file 5: Ambroxan 10%
        self.assertIn(2557, data['dil']['1'])   # Calone 1%
        self.assertIn(2807, data['dil']['0.1'])   # Indole 0.1%

    def test_build_refuses_a_reason_naming_another_perfume(self):
        import embed_notes as E
        html = open(E.APP, encoding='utf-8').read()
        real = E.STYLES
        tmp = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_styles_test2.json')
        try:
            json.dump({'styles': [{'id': 'x', 'n': 'x', 'refs': ['Eros'], 'prof': 'fresh', 'set_row': 'x',
                                   'sig': {'2810': ['Le Male']}, 'notes': {'2810': {'Eros': None}}, 'expected': {}, 'sets': []}]}, open(tmp, 'w'))
            E.STYLES = tmp
            with self.assertRaises(SystemExit):
                E.build(html)
        finally:
            E.STYLES = real
            os.remove(tmp)

    def test_build_refuses_a_style_code_outside_the_catalog(self):
        import embed_notes as E
        html = open(E.APP, encoding='utf-8').read()
        real = E.STYLES
        tmp = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_styles_test.json')
        try:
            json.dump({'styles': [{'id': 'x', 'n': 'x', 'refs': ['X'], 'prof': 'fresh', 'set_row': 'x', 'sig': {}, 'notes': {'706': {'X': None}}, 'expected': {}, 'sets': []}]}, open(tmp, 'w'))
            E.STYLES = tmp   # 706 = perfumer's alcohol, a solvent: not a selectable material
            with self.assertRaises(SystemExit):
                E.build(html)
        finally:
            E.STYLES = real
            os.remove(tmp)


if __name__ == '__main__':
    unittest.main()
