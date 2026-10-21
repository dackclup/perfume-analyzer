"""Build per-material note data (layer, facets, roles, strength, use class, blends-with) for the app.

Design: project file 12 (ระบบเลือกกลิ่นทีละชั้น) sections 3–4. Every value carries its source and a label
  ok  = ยืนยันแล้ว (a source states it)
  inf = อนุมาน   (our rule applied to a stated fact)
  gs  = เดา      (family default only)

Layer evidence, highest level wins (level 1, the user's own blotter results, arrives in phase 4):
  2  file 5 tenacity table · ScenTree "volatility"                           -> ok
  2b Fraterworks blotter hours -> layer by calibrated cut-offs (hours_layer)  -> inf
     (Fraterworks' own "note" is a tenacity class, so it is not used as a separate opinion)
  3  Arctander tenacity wording (via refs.json)                              -> inf
  4  material-type rules for naturals · rules + molecular weight for chemicals -> inf
  5  app family default                                                       -> gs
When level-2 sources disagree the range widens to cover all of them and the row is flagged for review.
Fraterworks hours that fall one layer beyond a level-2 range widen it by that layer (hw); two layers away is
flagged (cf) without widening.

usage: python3 -I tools/notes/build_notes.py [--check]
  reads app/index.html and notes/sources/*, writes notes/notes.json and notes/coverage.md
  --check: rebuild in memory and exit 1 if the files on disk differ (for CI)
"""
import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'notes', 'sources')
OUT_JSON = os.path.join(ROOT, 'notes', 'notes.json')
OUT_MD = os.path.join(ROOT, 'notes', 'coverage.md')
L = ['top', 'mid', 'base']
TH = {'top': 'หัว', 'mid': 'กลาง', 'base': 'ฐาน'}


# ---------- small parsers ----------

def span(layers):
    """Contiguous [lo, hi] covering every layer named."""
    idx = sorted(L.index(x) for x in layers)
    return [L[idx[0]], L[idx[-1]]]


def primary(layers, prefer=(), hint=None):
    """Main step: the layer named most often. A tie goes, in order, to the project's own file-5 class when it is
    among the tied layers (`prefer`), to the blotter-hours layer when that is among them (`hint`), to 'mid'
    (the bridge layer), otherwise to the first tied layer (top→base)."""
    c = collections.Counter(layers)
    best = max(c.values())
    tied = [l for l in L if c[l] == best]
    if len(tied) == 1:
        return tied[0]
    pref = [l for l in tied if l in prefer]
    if pref:
        tied = pref
        if len(tied) == 1:
            return tied[0]
    if hint in tied:
        return hint
    return 'mid' if 'mid' in tied else tied[0]


def map_volatility(text):
    """ScenTree 'Head/Heart/Base' or Fraterworks 'Top/Heart/Middle/Base Note' -> list of layers."""
    if not text:
        return []
    t = text.lower()
    out = []
    if re.search(r'\b(head|top)\b', t):
        out.append('top')
    if re.search(r'\b(heart|middle|mid)\b', t):
        out.append('mid')
    if re.search(r'\bbase\b|\bbottom\b', t):
        out.append('base')
    return out


def parse_hours(text):
    """'Lasts > 172 hours on a smelling strip' -> 172 · '> 1 month' -> 720 · '2 weeks' -> 336. None if unknown."""
    if not text:
        return None
    t = text.lower().replace(',', '')
    m = re.search(r'(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?\s*(hour|hr|h\b|day|week|month|ชม|สัปดาห์|เดือน|วัน)', t)
    if not m:
        m2 = re.match(r'^[~>≈ ]*(\d+(?:\.\d+)?)\s*(?:[–-]\s*\d+)?\s*$', t.strip())
        return float(m2.group(1)) if m2 else None
    v = float(m.group(1))
    u = m.group(3)
    mult = {'hour': 1, 'hr': 1, 'h': 1, 'ชม': 1, 'day': 24, 'วัน': 24, 'week': 168, 'สัปดาห์': 168,
            'month': 720, 'เดือน': 720}[u]
    return v * mult


FW_DILUTED = re.compile(r'(\d+(?:\.\d+)?)\s*%?\s*(?:in\s+)?(?:IPM|DPG|TEC|DEP)\b', re.I)


def fw_dilution(name):
    """The % of material in a Fraterworks product sold only as a dilution, from its name ("Cocoa Absolute 5% IPM" -> 5,
    "Sandela® 85 IPM" -> 85), else None. Its average use is then for the dilution, not the pure material (review round 48)."""
    m = FW_DILUTED.search(name or '')
    return float(m.group(1)) if m and 0 < float(m.group(1)) < 100 else None


def parse_pct(text):
    """Typical use as one number. '3.1% in a perfume compound' -> 3.1 · '2–10%' / '2% to 10%' -> 6 · 'ราว 0.2%' ·
    '≤0.5%' -> 0.5 · '0.15/1.0 in a perfume compound' -> 0.15 · 'ppm' -> 0.001 · a text that only states a maximum
    ('… maximum', not an average) -> None."""
    if not text:
        return None
    t = text.lower().replace(',', '.')
    if 'ppm' in t:
        return 0.001
    if re.search(r'\bmax', t) and 'average' not in t and 'compound' not in t.split('max')[0]:
        return None
    m = re.search(r'(\d+(?:\.\d+)?)\s*%?\s*(?:–|-|to)\s*(\d+(?:\.\d+)?)\s*%', t)
    if m:
        return (float(m.group(1)) + float(m.group(2))) / 2
    m = re.search(r'(\d+(?:\.\d+)?)\s*%', t)
    if m:
        return float(m.group(1))
    m = re.search(r'(\d+(?:\.\d+)?)(?:/[\d.]+)?\s*in a perfume compound', t)
    return float(m.group(1)) if m else None


def use_class(p):
    if p is None:
        return None
    if p >= 5:
        return 'bulk'
    if p >= 1:
        return 'normal'
    if p >= 0.1:
        return 'accent'
    return 'trace'


# ---------- level-4 rules ----------

NAT_RULES = [  # (regex on the shop name, layers) — first match wins; specific names come before general ones
    (r'\b\d+\s*(x|fold)\b', ['top', 'mid']),          # folded citrus oils last longer than the plain oil
    (r'\belemi (gum|resin)', ['mid', 'base']),
    (r'\b(orange blossom|orange flower|ginger lily|white orchid)\b', ['mid']),
    (r'\b(neroli|petitgrain|melissa|lemon balm|rosewood|bois de rose)\b', ['top', 'mid']),
    (r'\b(bergamot|lemon|lime|orange|grapefruit|mandarin|tangerine|yuzu|citron|litsea|lemongrass|citronella)\b', ['top']),
    (r'\b(lavender|lavandin|rosemary|sage|clary|mint|peppermint|spearmint|basil|eucalyptus|tea tree|thyme|juniper|'
     r'cypress|pine|fir|spruce|bay|myrtle|niaouli|cajeput|camphor|artemisia|davana|tarragon|fennel|anise|coriander|'
     r'cardamom|ginger|pepper|pink pepper|elemi|caraway|dill)\b', ['top', 'mid']),
    (r'\b(nutmeg|mace|clove|cinnamon|cassia|pimento|allspice)\b', ['mid']),
    (r'\b(rose|jasmine|jasmin|ylang|geranium|tuberose|chamomile|osmanthus|mimosa|champaca|frangipani|violet|'
     r'magnolia|lotus|carnation|honeysuckle|gardenia|orris|iris|immortelle|helichrysum|tulip|broom)\b', ['mid']),
    (r'\b(cedar|cedarwood|sandal|sandalwood|vetiver|patchouli|guaiac|guaiacwood|oud|agarwood|cypriol|nagarmotha|amyris|'
     r'labdanum|cistus|benzoin|olibanum|frankincense|myrrh|opoponax|tolu|peru|styrax|oakmoss|moss|'
     r'tonka|vanilla|cocoa|coffee|tobacco|hay|ambrette|costus|valerian|spikenard|angelica root|orris root|'
     r'cade|birch tar|balsam|resin|resinoid)\b', ['base']),
]
CRYSTAL_BASE = re.compile(r'\b(vanillin|ethyl vanillin|coumarin|maltol|ethyl maltol|heliotropin|piperonal|'
                          r'raspberry ketone|benzophenone|musk|sclareol|indole|skatole)\b', re.I)
CHEM_FAMILY_FIXED = {'musk': ['base'], 'amber': ['base']}
FAM_DEFAULT = {'citrus': ['top'], 'green': ['top', 'mid'], 'fruit': ['top', 'mid'], 'spice': ['top', 'mid'],
               'floral': ['mid'], 'food': ['mid'], 'other': ['mid'], 'sweet': ['base'], 'wood': ['base'],
               'amber': ['base'], 'musk': ['base'], 'base': ['base'], 'solvent': ['mid']}


def rule_layer(x, mw):
    """Level-4 inference. Returns (layers, why) or (None, None); the first layer listed is the main step."""
    n = x['n'].lower()
    if x['t'] == 2:
        blend = re.search(r'fragrance oil|synthetic|natural-like', n)
        for rx, lay in NAT_RULES:
            if re.search(rx, n):
                kw = re.search(rx, n).group(0)
                if blend:
                    return lay, f'ชื่อบอกว่าเป็นน้ำมันผสม/สังเคราะห์ ({blend.group(0)}) แนว {kw}'
                return lay, 'ชนิดน้ำมันธรรมชาติ (' + kw + ')'
        return None, None
    if CRYSTAL_BASE.search(n):
        return ['base'], 'สารกลุ่มผลึก/มัสก์ (' + CRYSTAL_BASE.search(n).group(0) + ')'
    if x['f'] in CHEM_FAMILY_FIXED:
        return CHEM_FAMILY_FIXED[x['f']], 'ตระกูล ' + x['f']
    if re.search(r'aldehyde c-?(7|8|9|10|11|12)\b|\b(octanal|nonanal|decanal|undecanal|dodecanal|heptanal)\b', n):
        return ['top'], 'aldehyde C7–C12'
    # families where the molecular-weight cut-offs misfit (independent review, 18 Oct 2026)
    if re.search(r'lactone', n):
        return ['mid', 'base'], 'กลุ่ม lactone (มักกลาง–ฐาน)'
    if re.search(r'cinnam', n):
        return ['mid', 'base'], 'กลุ่ม cinnamic (มักกลาง–ฐาน)'
    if re.search(r'\b(geranyl|neryl|citronellyl|terpinyl)\b', n):
        return ['mid'], 'ester ของ terpene alcohol (geranyl/neryl/citronellyl)'
    if mw is not None:
        if mw < 150:
            return ['top'], f'น้ำหนักโมเลกุล {mw:g} (<150)'
        if mw <= 200:
            return ['mid'], f'น้ำหนักโมเลกุล {mw:g} (150–200)'
        return ['base'], f'น้ำหนักโมเลกุล {mw:g} (>200)'
    return None, None


# Hours -> layer. Calibrated 18 Oct 2026 so that every row of the file-5 table agrees; agreement with ScenTree is
# measured on each build in coverage.md.
H_TOP, H_BASE = 12, 150


def hours_layer(h):
    return 'top' if h < H_TOP else ('mid' if h < H_BASE else 'base')


def arct_layer(g):
    if g is None:
        return None
    if g <= 1:
        return ['top']
    if g <= 1.5:
        return ['top', 'mid']
    if g <= 2:
        return ['mid']
    if g <= 3:
        return ['mid', 'base']
    return ['base']


# ---------- facets ----------

FACETS = [  # (facet key, Thai label, regex on source words)
    ('citrus', 'ส้ม', r'citrus|lemon|orange|bergamot|grapefruit|mandarin|\blime\b|zest|\bpeel'),
    ('aldehydic', 'aldehyde', r'aldehyd|soapy|waxy'),
    ('green', 'เขียว', r'green|leaf|leafy|grass|stem|cucumber|vegetal'),
    ('herbal', 'สมุนไพร', r'herb|aromatic|lavender|sage|rosemary|basil|thyme|camphor|minty|mint'),
    ('fresh', 'สดชื่น', r'fresh|clean|airy|ozon|aquatic|marine|watery|transparent'),
    ('floral', 'ดอกไม้', r'floral|flower|jasmin|\brose\b|\brosy|\brosa\b|muguet|lily|lilac|neroli|ylang|tuberose|white flowers'),
    ('powdery', 'แป้ง', r'powder|iris|orris|violet|ionone'),
    ('fruity', 'ผลไม้', r'fruit|apple|pear|peach|berry|plum|pineapple|melon|tropical|banana|cherry|apricot'),
    ('spicy', 'เครื่องเทศ', r'spic|pepper|clove|cinnamon|nutmeg|cardamom|ginger|anis'),
    ('sweet', 'หวาน', r'sweet|honey|caramel|sugar|candy|gourmand|praline|maltol'),
    ('vanilla', 'วานิลลา', r'vanill|tonka|coumarin|\bhay\b|almond|benzoin'),
    ('balsamic', 'บัลซามิก', r'balsam|resin|incense|olibanum|labdanum|myrrh|opoponax|styrax'),
    ('amber', 'อำพัน', r'ambergris|ambery|ambra|amber'),
    ('woody', 'ไม้', r'wood|cedar|sandal|vetiver|patchouli|guaiac|\boud\b|\bpine\b|\bpiney'),
    ('earthy', 'ดิน', r'earth|root|mossy|moss|humus|mushroom|patchouli|vetiver'),
    ('musk', 'มัสก์', r'musk'),
    ('animalic', 'สัตว์·หนัง', r'animal|leather|indol|fecal|civet|castoreum|smoky|\btar\b|\btarry|phenolic'),
    ('fatty', 'มัน·ขี้ผึ้ง', r'fatty|oily|wax|creamy|milky|lactonic|coconut'),
]


def facets_of(words):
    blob = ' '.join(w.lower() for w in words if w)
    out = []
    for key, _, rx in FACETS:
        if re.search(rx, blob):
            out.append(key)
    return out


# ---------- name index for blends-with ----------

def norm(s):
    s = s.lower().replace('®', '').replace('™', '')
    s = re.sub(r'\b(oil|essential|absolute|eo|natural|coeur|extra|pure)\b', '', s)
    return re.sub(r'[^a-z0-9]', '', s)


def name_index(items):
    idx = collections.defaultdict(set)
    for x in items:
        names = [x['n']] + re.split(r'[,()/]', x['n'])
        if x.get('a') and x['a'].get('nm'):
            names.append(x['a']['nm'])
        for nm in names:
            k = norm(nm)
            if len(k) >= 5:
                idx[k].add(x['i'])
    return idx


# ---------- main build ----------

def load(name, default):
    p = os.path.join(SRC, name)
    if not os.path.exists(p):
        return default
    if name.endswith('.jsonl'):
        return [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
    return json.load(open(p, encoding='utf-8'))


def build():
    html = open(os.path.join(ROOT, 'app', 'index.html'), encoding='utf-8').read()
    cat = json.loads(re.search(r'id="catalog-data">(.*?)</script>', html, re.S).group(1))
    items = [x for x in cat['items'] if x['t'] in (1, 2)]
    refs = load('refs.json', {'items': {}})['items']
    f5 = load('file5_tenacity.json', {'rows': []})['rows']
    roles = load('project_roles.json', {})
    sup = {r['i']: r for r in load('supplier.jsonl', [])}
    over = {int(k): v for k, v in load('overrides.json', {}).get('items', {}).items()}
    f5_by = {c: r for r in f5 for c in r['codes']}
    role_codes = {k: set(v['codes']) for k, v in roles.items() if isinstance(v, dict) and 'codes' in v}
    idx = name_index(items)

    out = {}
    for x in items:
        i = x['i']
        rf = refs.get(str(i), {})
        sp = sup.get(i, {})
        st, fw = sp.get('scentree') or {}, sp.get('fraterworks') or {}
        rec = {}
        # --- layer ---
        ops2 = []  # (layers, tag)
        if i in f5_by:
            ops2.append((f5_by[i]['layer'], 'f5'))
        if map_volatility(st.get('volatility')):
            ops2.append((map_volatility(st.get('volatility')), 'st'))
        # Fraterworks "note" is their tenacity class (<5 h top · 5–48 h heart · ≥50 h base, see coverage.md),
        # so it is not a separate level-2 opinion; its hours feed hours_layer() below instead.
        fw_h = parse_hours(fw.get('tenacity'))
        mw = rf.get('mw')
        if mw is None and st.get('mw'):
            m = re.search(r'(\d+(?:[.,]\d+)?)', str(st['mw']))
            mw = float(m.group(1).replace(',', '.')) if m else None
        why = None
        if ops2:
            allv = [l for lay, _ in ops2 for l in lay]
            rec.update(l=primary(allv, f5_by[i]['layer'] if i in f5_by else (),
                                 hours_layer(fw_h) if fw_h is not None else None), r=span(allv), lb='ok',
                       src=[t for _, t in ops2])
            if len({tuple(span(lay)) for lay, _ in ops2}) > 1:
                rec['cf'] = ' · '.join(f'{t}:{"–".join(span(lay))}' for lay, t in ops2)
            if fw_h is not None:
                hl, lo, hi = hours_layer(fw_h), L.index(rec['r'][0]), L.index(rec['r'][1])
                if L.index(hl) == lo - 1 or L.index(hl) == hi + 1:
                    rec['r'] = span(rec['r'] + [hl])   # persistence on the strip reaches the next layer
                    rec['hw'] = 1
                elif not lo <= L.index(hl) <= hi:     # two layers apart (e.g. aldehydes: top role, long on the strip)
                    rec['cf'] = (rec.get('cf', '') + ' · ' if rec.get('cf') else '') + f'fwh:{hl} ({fw_h:g} ชม.)'
        elif fw_h is not None:
            hl = hours_layer(fw_h)
            rec.update(l=hl, r=[hl, hl], lb='inf', src=['fwh'])
            why = f'ติดทนบนแถบ {fw_h:g} ชม. (Fraterworks) · เกณฑ์ <{H_TOP} หัว · <{H_BASE} กลาง · ≥{H_BASE} ฐาน'
        else:
            al = arct_layer(rf.get('arct_g'))
            if al:
                rec.update(l=al[0], r=span(al), lb='inf', src=['ar'])
                why = f'Arctander ระดับติดทน {rf["arct_g"]:g}/5'
            else:
                rl, why = rule_layer(x, mw)
                if rl:
                    rec.update(l=rl[0], r=span(rl), lb='inf', src=['rule'])
                else:
                    fl = FAM_DEFAULT.get(x['f'], ['mid'])
                    rec.update(l=fl[0], r=span(fl), lb='gs', src=['fam'])
                    why = 'ค่าตั้งต้นของตระกูล ' + x['f']
        if why:
            rec['why'] = why
        # --- hours & early ---
        h = parse_hours(fw.get('tenacity'))
        if i in f5_by:
            h = f5_by[i]['h']
        if h is not None:
            rec['h'] = h
        if i in role_codes.get('early', set()):
            rec['e'] = 1
        # --- facets ---
        words = list(fw.get('odour_words') or []) + re.split(r'[>/,]', st.get('family') or '') + list(rf.get('leff') or [])
        fx = facets_of(words)
        if fx:
            rec['fx'] = fx[:6]
        # --- roles ---
        ro = []
        if i in role_codes.get('signature', set()):
            ro.append('signature')
        if i in role_codes.get('blender', set()):
            ro.append('blender')
        if re.search(r'fixat', (st.get('uses') or '') + ' ' + ' '.join(fw.get('odour_words') or []), re.I) or rf.get('arct_fix'):
            ro.append('fixative')
        if ro:
            rec['ro'] = ro
        # --- strength & use class ---
        if i in role_codes.get('dilute_01', set()) or (x.get('use') or '').find('ppm') >= 0:
            rec['sg'], rec['sgs'] = 5, 'f5'
        elif i in role_codes.get('dilute_1', set()):
            rec['sg'], rec['sgs'] = 4, 'f5'
        p = parse_pct(fw.get('avg_use'))
        psrc = 'fw'
        d = fw_dilution(fw.get('name'))
        if p is not None and d:   # the product is a dilution: its average as pure material
            p = p * d / 100
            rec['upd'] = d
        if p is None:
            p, psrc = parse_pct(x.get('use')), 'app'
        if p is not None:
            rec['up'], rec['ups'] = p, psrc
            rec['uc'] = use_class(p)
            if 'sg' not in rec:
                rec['sg'] = 5 if p < 0.1 else 4 if p < 1 else 3 if p < 5 else 2 if p < 15 else 1
                rec['sgs'] = 'use'
        # --- blends with (supplier pages) ---
        bw = set()
        for nm in list(st.get('blends_with') or []) + list(fw.get('blends_with') or []):
            hits = idx.get(norm(nm), set())
            if len(hits) > 4:   # a generic name ("Patchouli") would pull in every origin and grade
                continue
            for c in hits:
                if c != i:
                    bw.add(c)
        if bw:
            rec['bw'] = sorted(bw)
        refl = {}
        if st.get('url'):
            refl['st'] = st['url']
        if fw.get('url'):
            refl['fw'] = fw['url']
        if refl:
            rec['ref'] = refl
        if i in over:
            rec.update(over[i])
            rec['src'] = rec.get('src', []) + ['review']
        out[str(i)] = rec
    return items, out, f5_by, sup, refs


def coverage(items, out, f5_by, sup, refs):
    rated = {x['i'] for x in items if x.get('s')}
    lines = ['# ความครอบคลุมข้อมูลชั้นโน้ต', '',
             f'สร้างโดย `tools/notes/build_notes.py` จากแคตตาล็อกใน `app/index.html` ({len(items)} รายการที่เลือกได้)', '']

    def tally(sel):
        c = collections.Counter(out[str(x['i'])]['lb'] for x in items if x['i'] in sel)
        return c['ok'], c['inf'], c['gs']
    allc, ratc = tally({x['i'] for x in items}), tally(rated)
    lines += ['| กลุ่ม | ยืนยันแล้ว | อนุมาน | เดา |', '|---|---|---|---|',
              f'| ทั้งหมด ({len(items)}) | {allc[0]} | {allc[1]} | {allc[2]} |',
              f'| จัดระดับแล้ว ★●○ ({len(rated)}) | {ratc[0]} | {ratc[1]} | {ratc[2]} |', '']
    src = collections.Counter(t for v in out.values() for t in v.get('src', []))
    lines += ['**แหล่งชั้น:** ' + ' · '.join(f'{k} {v}' for k, v in sorted(src.items())), '']
    # agreement checks
    def agree(a, b):
        return bool(set(L[L.index(a[0]):L.index(a[1]) + 1]) & set(L[L.index(b[0]):L.index(b[1]) + 1]))
    pairs = collections.Counter()
    for x in items:
        i = x['i']
        s = sup.get(i, {})
        stv = map_volatility((s.get('scentree') or {}).get('volatility'))
        fwv = map_volatility((s.get('fraterworks') or {}).get('note'))
        f5v = f5_by[i]['layer'] if i in f5_by else None
        rf = refs.get(str(i), {})
        rl, _ = rule_layer(x, rf.get('mw'))
        fwh = parse_hours((s.get('fraterworks') or {}).get('tenacity'))
        hv = [hours_layer(fwh)] if fwh is not None else None
        if fwv and fwh is not None:
            pairs[('Fraterworks note ตรงกับชั่วโมงตามเกณฑ์ <5 · <50 · ≥50 ชม.', 'n')] += 1
            own = 'top' if fwh < 5 else ('mid' if fwh < 50 else 'base')
            pairs[('Fraterworks note ตรงกับชั่วโมงตามเกณฑ์ <5 · <50 · ≥50 ชม.', 'ok')] += fwv == [own]
            pairs[('Fraterworks note ตรงกับชั่วโมงตามเกณฑ์ <5 · <50 · ≥50 ชม.', 'ov')] += own in fwv
        for name, a, b in [('ScenTree กับ Fraterworks note', stv, fwv), ('ตารางไฟล์ 5 กับ ScenTree', f5v, stv),
                           (f'เกณฑ์ชั่วโมง <{H_TOP} · <{H_BASE} · ≥{H_BASE} กับ ScenTree', hv, stv)]:
            if a and b:
                pairs[(name, 'n')] += 1
                pairs[(name, 'ok')] += span(a) == span(b)
                pairs[(name, 'ov')] += agree(span(a), span(b))
        l2 = [v for v in (f5v, stv) if v]
        if l2 and rl:
            u = span([q for v in l2 for q in v])
            pairs[('กฎระดับ 4 กับแหล่งระดับ 2', 'n')] += 1
            pairs[('กฎระดับ 4 กับแหล่งระดับ 2', 'ok')] += span(rl) == u
            pairs[('กฎระดับ 4 กับแหล่งระดับ 2', 'ov')] += agree(span(rl), u)
        al = arct_layer(rf.get('arct_g'))
        if l2 and al:
            u = span([q for v in l2 for q in v])
            pairs[('Arctander กับแหล่งระดับ 2', 'n')] += 1
            pairs[('Arctander กับแหล่งระดับ 2', 'ok')] += span(al) == u
            pairs[('Arctander กับแหล่งระดับ 2', 'ov')] += agree(span(al), u)
    names = []
    for (n, k) in pairs:
        if n not in names:
            names.append(n)
    lines += ['## แหล่งตรงกันแค่ไหน', '', '| เทียบ | คู่ที่มีทั้งสองแหล่ง | ตรงกันทั้งช่วง | ช่วงซ้อนกัน |', '|---|---|---|---|']
    for n in names:
        lines.append(f'| {n} | {pairs[(n, "n")]} | {pairs[(n, "ok")]} | {pairs[(n, "ov")]} |')
    cf = [(x['i'], x['n'], out[str(x['i'])]['cf']) for x in items if 'cf' in out[str(x['i'])]]
    hw = sum(1 for v in out.values() if v.get('hw'))
    lines += ['', f'**ช่วงขยายตามชั่วโมงติดทน:** {hw} รายการ (ชั่วโมงของ Fraterworks เลยช่วงระดับ 2 ไปหนึ่งชั้น)', '',
              f'## แหล่งขัดกัน ({len(cf)} รายการ)', '',
              'ไฟล์ 5 กับ ScenTree ขัดกัน → ช่วงชั้นขยายให้ครอบทั้งสอง · ชั่วโมงติดทนห่างจากช่วงสองชั้น (fwh) → ติดธงไว้ ไม่ขยาย', '']
    lines += [f'- ({i}) {n} — {c}' for i, n, c in cf]
    other = collections.Counter()
    for x in items:
        v = out[str(x['i'])]
        for k in ('fx', 'ro', 'sg', 'uc', 'bw', 'h'):
            if k in v:
                other[(k, x['i'] in rated)] += 1
    lines += ['', '## ข้อมูลอื่น', '', '| ช่อง | ทั้งหมด | จัดระดับแล้ว |', '|---|---|---|']
    for k, th in [('fx', 'แง่กลิ่น'), ('ro', 'บทบาท'), ('sg', 'ความแรง'), ('uc', 'ระดับใช้'), ('bw', 'คู่จากหน้าซัพพลายเออร์'), ('h', 'ชั่วโมงติดทน')]:
        lines.append(f'| {th} | {other[(k, True)] + other[(k, False)]} | {other[(k, True)]} |')
    return '\n'.join(lines) + '\n'


def main(argv):
    items, out, f5_by, sup, refs = build()
    js = json.dumps({'about': 'Per-material note data for the step-by-step picker (file 12). Keys: l layer · r range · '
                              'lb ok/inf/gs · src sources (f5 file 5, st ScenTree, fw Fraterworks, ar Arctander, rule, fam, review) · '
                              'why reason for inferred rows · cf level-2 conflict · hw range widened by one layer from blotter hours · '
                              'h blotter hours · e strong from the opening · '
                              'fx facets · ro roles · sg strength 1–5 (sgs source) · up typical use % (ups source; upd = the Fraterworks product is an upd% dilution, up converted to pure) · uc use class · '
                              'bw blends-with codes from supplier pages · ref source URLs.',
                     'items': out}, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    md = coverage(items, out, f5_by, sup, refs)
    if '--check' in argv:
        same = (os.path.exists(OUT_JSON) and open(OUT_JSON, encoding='utf-8').read() == js + '\n'
                and os.path.exists(OUT_MD) and open(OUT_MD, encoding='utf-8').read() == md)
        print('notes.json and coverage.md are up to date' if same else 'OUT OF DATE: run tools/notes/build_notes.py')
        return 0 if same else 1
    open(OUT_JSON, 'w', encoding='utf-8').write(js + '\n')
    open(OUT_MD, 'w', encoding='utf-8').write(md)
    print(md)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
