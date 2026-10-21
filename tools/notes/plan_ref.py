"""Independent reference for the step-by-step summary (file 12 phase 3, sections 7–9).

Computes, from the rules written in file 12 and the data files (not from the app's code):
starting proportions per layer, the proportions after trial ratios, where the proportions sit among the
Jean Carles strips, the dilution and grams to weigh, and the imbalance warnings.
tests/app/plan.test.mjs runs the app's own function on many generated formulas and compares.

usage: python3 -I tools/notes/plan_ref.py < cases.json > results.json
case:  {"lines": [[pid, layer], ...], "prof": "fresh" | "fougere" | "sweet" | null, "jc": {"pid,pid": a}, "full": bool, "batch": g}
       layer 0 top · 1 mid · 2 base · a = the first number of a ratio a : (10 − a)

Rules (file 12 sections 7–9, as built in phase 3):
- layer budgets: fresh 25/25/50 · fougère/floral 15/35/50 · sweet·amber 10/30/60 (top/mid/base), no style 1/3 each;
  a layer with no material gets 0 and its share stays empty
- starting use of a material: file 3's range ("a–b%": middle, bounds a and b · "≤x%": x/2, bounds x/4 and x ·
  "ราว x%": x, bounds x/2 and 2x) on its own code, else on another code of the same material · else the Fraterworks
  average (bounds half and double) · else file 5's 1% list 0.1 / 0.1% list 0.01 (bounds half and double) · else 1
- bulk = start of 5 or more: in each layer the bulk ones are multiplied by one factor so the layer adds up to its budget,
  each kept inside its bounds; the others stay at their start
- parts are % of the formula: under 100 the rest stays empty; over 100 all are scaled down to add up to 100
- a layer is outside its profile range when its % rounded to one decimal is
- trial chain: base, mid, top, each in formula order; set k pairs the first k materials with material k+1; a trial ratio
  counts when every set before it has one; each material is at 10% in the trial (file 5's 1% / 0.1% ones at that);
  the materials covered get proportions from the trial blend and keep their total share
- strip position of set k: 10 × A / (A + B), A = sum over the first k of % ÷ trial dilution, B = the same for material k+1;
  nearest strip, a tie goes to the larger first number
- weigh: as pure as file 5 allows (10% list: at most 10% · 1% and 0.1% lists: 1%), more dilute while under 0.1 g
"""
import json
import math
import os
import re
import sys
from itertools import combinations

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROFILES = {'fresh': ([25, 25, 50], [(20, 30), (20, 30), (45, 55)]),
            'fougere': ([15, 35, 50], [(10, 20), (30, 40), (45, 60)]),
            'sweet': ([10, 30, 60], [(5, 15), (25, 35), (55, 65)])}
STEPS = {False: [9, 7, 5, 3, 1], True: [9, 8, 7, 6, 5, 4, 3, 2, 1]}
CORE = {'amber', 'wood', 'musk'}
ALDEHYDE = re.compile(r'aldehyde|anal\b|enal\b|citral|citronellal|helional|triplal|bourgeonal|florhydral|cyclamen|heliotropin|piperonal|furfural|vanillin', re.I)


def block(html, name):
    return json.loads(re.search(r'id="' + name + r'">(.*?)</script>', html, re.S).group(1))


class Data:
    def __init__(self):
        html = open(os.path.join(ROOT, 'app', 'index.html'), encoding='utf-8').read()
        self.cat = {x['i']: x for x in block(html, 'catalog-data')['items']}
        self.notes = json.load(open(os.path.join(ROOT, 'notes', 'notes.json'), encoding='utf-8'))['items']
        roles = json.load(open(os.path.join(ROOT, 'notes', 'sources', 'project_roles.json'), encoding='utf-8'))
        # one material = one group of codes in the published accords; its first catalog code stands for it
        self.rep, self.codes = {}, {}
        for acc in block(html, 'accord-data'):
            for grp in acc['g']:
                ids = [p for p in grp if p in self.cat]
                if not ids:
                    continue
                r = self.rep.get(ids[0], ids[0])
                self.codes.setdefault(r, [])
                for p in ids:
                    if p not in self.rep:
                        self.rep[p] = r
                        self.codes[r].append(p)
        self.dil5 = {}
        for pct, key in ((10, 'dilute_10'), (1, 'dilute_1'), (0.1, 'dilute_01')):
            for c in roles[key]['codes']:
                self.dil5[self.mat(c)] = pct

    def mat(self, p):
        return self.rep.get(p, p)

    def note(self, p):
        return self.notes[str(p)]


def parse_use(s):
    s = (s or '').strip()
    m = re.fullmatch(r'(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)%', s)
    if m:
        a, b = float(m.group(1)), float(m.group(2))
        return (a + b) / 2, a, b
    m = re.fullmatch(r'≤\s*(\d+(?:\.\d+)?)%', s)
    if m:
        x = float(m.group(1))
        return x / 2, x / 4, x
    m = re.fullmatch(r'ราว\s*(\d+(?:\.\d+)?)%', s)
    if m:
        x = float(m.group(1))
        return x, x / 2, 2 * x
    return None


def start_use(D, p):
    codes = [p] + [c for c in D.codes.get(D.mat(p), [p]) if c != p]
    for c in codes:
        v = parse_use(D.cat[c].get('use'))
        if v:
            return v + ('f3',)
    for c in codes:
        n = D.notes.get(str(c), {})
        if n.get('ups') == 'fw' and n.get('up'):
            u = n['up']
            return u, u / 2, 2 * u, 'fw'
    d = D.dil5.get(D.mat(p))
    if d == 0.1:
        return 0.01, 0.005, 0.02, 'f5'
    if d == 1:
        return 0.1, 0.05, 0.2, 'f5'
    return 1.0, 0.5, 2.0, 'none'


def fill_bulk(items, R):
    """items: [(u, lo, hi)] · the parts sum(clamp(k·u, lo, hi)) = R for the one k, solved piece by piece (exact)."""
    if R <= sum(lo for _, lo, _ in items):
        return [lo for _, lo, _ in items]
    if R >= sum(hi for _, _, hi in items):
        return [hi for _, _, hi in items]
    ks = sorted({0.0} | {lo / u for u, lo, _ in items} | {hi / u for u, _, hi in items})
    g = lambda k: sum(min(max(k * u, lo), hi) for u, lo, hi in items)
    for a, b in zip(ks, ks[1:]):
        if g(a) <= R <= g(b):
            mid = (a + b) / 2
            free = sum(u for u, lo, hi in items if lo < mid * u < hi)
            k = a if free == 0 else a + (R - g(a)) / free
            return [min(max(k * u, lo), hi) for u, lo, hi in items]
    raise AssertionError('no segment')


def trial_dil(D, p):
    d = D.dil5.get(D.mat(p))
    return d if d in (1, 0.1) else 10


def weigh_dil(D, p, pure):
    d5 = D.dil5.get(D.mat(p))
    allowed = [d for d in (100, 10, 1) if d <= (100 if d5 is None else 10 if d5 >= 10 else 1)]
    for d in allowed:
        if pure * 100 / d >= 0.1:
            return d
    return allowed[-1]


def plan(D, case):
    lines = [(p, L) for p, L in case['lines'] if L >= 0]
    prof = PROFILES.get(case.get('prof'))
    target = list(prof[0]) if prof else [100 / 3] * 3
    present = [any(L == k for _, L in lines) for k in range(3)]
    target = [t if present[k] else 0 for k, t in enumerate(target)]
    rows = []
    for p, L in lines:
        u, lo, hi, src = start_use(D, p)
        rows.append({'pid': p, 'L': L, 'u': u, 'lo': lo, 'hi': hi, 'src': src, 'part': u, 'bulk': u >= 5})
    for L in range(3):
        bulk = [r for r in rows if r['L'] == L and r['bulk']]
        if not bulk:
            continue
        R = target[L] - sum(r['u'] for r in rows if r['L'] == L and not r['bulk'])
        for r, v in zip(bulk, fill_bulk([(r['u'], r['lo'], r['hi']) for r in bulk], R)):
            r['part'] = v
    s = sum(r['part'] for r in rows)
    scale = 100 / s if s > 100 + 1e-9 else 1   # a layer filled exactly may add up to 100 plus rounding
    for r in rows:
        r['start'] = r['pct'] = r['part'] * scale
        r['td'] = trial_dil(D, r['pid'])
    chain = [r for L in (2, 1, 0) for r in rows if r['L'] == L]
    full = bool(case.get('full'))
    jc = case.get('jc') or {}
    chosen = []
    for k in range(1, len(chain)):
        a = jc.get(','.join(str(r['pid']) for r in chain[:k + 1]))
        chosen.append(a if a in STEPS[True] else None)
    upto = 0
    while upto < len(chosen) and chosen[upto] is not None:
        upto += 1
    if upto:
        # solution weights in the final trial blend: start with 1 g of the first, each set keeps a parts of the blend + (10 − a) of the next
        w = [1.0]
        for k in range(1, upto + 1):
            a = chosen[k - 1]
            blend = sum(w)
            w = [x * a / blend for x in w] + [10 - a]
        pure = [x * chain[i]['td'] for i, x in enumerate(w)]
        share = sum(chain[i]['start'] for i in range(upto + 1))
        for i in range(upto + 1):
            chain[i]['pct'] = pure[i] / sum(pure) * share
    steps = STEPS[full]
    sets = []
    for k in range(1, len(chain)):
        A = sum(r['pct'] / r['td'] for r in chain[:k])
        B = chain[k]['pct'] / chain[k]['td']
        at = 10 * A / (A + B)
        best = steps[0]
        for x in steps[1:]:   # largest first; a tie within rounding keeps the larger
            if abs(x - at) < abs(best - at) - 1e-9:
                best = x
        sets.append({'k': k, 'at': at, 'near': best, 'used': k <= upto, 'chosen': chosen[k - 1], 'out': at > 9.5 or at < 0.5})
    batch = case.get('batch') or 10
    for r in rows:
        r['pure'] = r['pct'] * batch / 100
        r['d'] = weigh_dil(D, r['pid'], r['pure'])
        r['weigh'] = r['pure'] * 100 / r['d']
    layers = [sum(r['pct'] for r in rows if r['L'] == L) for L in range(3)]
    return {'rows': [{k: r[k] for k in ('pid', 'L', 'src', 'u', 'lo', 'hi', 'bulk', 'part', 'td', 'start', 'pct', 'd', 'weigh')} for r in rows],
            'sets': sets, 'upto': upto, 'layers': layers, 'targets': target, 'down': s > 100 + 1e-9,
            'total': sum(r['pct'] for r in rows), 'weigh': sum(r['weigh'] for r in rows),
            'natural': sum(r['pct'] for r in rows if D.cat[r['pid']]['t'] == 2),
            'warn': sorted(warnings(D, rows, layers, prof))}


def warnings(D, rows, layers, prof):
    out = []
    fx = lambda r: set(D.note(r['pid']).get('fx', []))
    if not rows:
        return out
    for L in (2, 1, 0):
        rs = [r for r in rows if r['L'] == L]
        if not rs:
            out.append(('gap', L, 1))
        elif layers[L] < 5:
            out.append(('low', L, 1))
        shown = math.floor(layers[L] * 10 + 0.5) / 10   # judged as shown, to one decimal
        if prof and rs and not (prof[1][L][0] <= shown <= prof[1][L][1]):
            out.append(('range', L, 1))
        if sum(1 for r in rs if r['pct'] >= 5) > 4:   # more than 3–4 main materials
            out.append(('many', L, 1))
        fams = {}
        for r in rs:
            fams.setdefault(D.cat[r['pid']]['f'], []).append(r)
        for g in fams.values():   # three of one family, every pair sharing at least three quarters of their facets
            if any(all(jaccard(fx(x), fx(y)) >= 0.75 for x, y in combinations(trio, 2)) for trio in combinations(g, 3)):
                out.append(('dup', L, 1))
    for a, b in ((2, 1), (1, 0)):
        A = [r for r in rows if r['L'] == a and fx(r)]
        B = [r for r in rows if r['L'] == b and fx(r)]
        if not A or not B or not any(r['L'] == a for r in rows) or not any(r['L'] == b for r in rows):
            continue
        shared = any(fx(x) & fx(y) for x in A for y in B)
        blender = any('blender' in D.note(r['pid']).get('ro', []) for r in rows if r['L'] in (a, b))
        if not shared and not blender:
            out.append(('link', b, 1))
    base = [r for r in rows if r['L'] == 2]
    if prof and base and not any(D.cat[r['pid']]['f'] in CORE for r in base):
        out.append(('core', 2, 1))
    for r in rows:
        strong = (D.note(r['pid']).get('sg') or 0) >= 4
        if r['pct'] > r['hi'] + 1e-9:
            if r['src'] == 'f3':   # past file 3's range: a fact; "may cover the others" is inferred
                out.append(('over', (r['pid'],), 1 if strong else 0))
            elif strong:   # past a guessed bound
                out.append(('strong', (r['pid'],), 2))
    name = lambda r: D.cat[r['pid']]['n']
    ma = lambda r: re.match(r'methyl anthranilate', name(r), re.I) is not None
    ald = lambda r: ALDEHYDE.search(name(r)) is not None and not re.search('acetal', name(r), re.I)
    for i, x in enumerate(rows):
        for y in rows[i + 1:]:
            if (ma(x) and ald(y)) or (ma(y) and ald(x)):
                out.append(('color', (x['pid'], y['pid']), 0))
    for r in rows:
        if re.match(r'vanillin\b', name(r), re.I):
            out.append(('yellow', (r['pid'],), 0))
        if re.match(r'indole\b', name(r), re.I):
            out.append(('pink', (r['pid'],), 0))
        if D.note(r['pid']).get('e'):
            out.append(('early', (r['pid'],), 0))
    return [[k, list(v) if isinstance(v, tuple) else v, lb] for k, v, lb in out]


def jaccard(a, b):
    return len(a & b) / len(a | b) if a | b else 0


def main():
    D = Data()
    cases = json.load(sys.stdin)
    json.dump([plan(D, c) for c in cases], sys.stdout)


if __name__ == '__main__':
    main()
