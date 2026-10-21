"""Embed the note-layer data (notes/notes.json) and the style templates (notes/sources/styles.json) into the app
as <script type="application/json" id="notes-data">, compact, for the step-by-step picker (file 12, phase 2).

usage: python3 -I tools/notes/embed_notes.py            # write app/index.html
       python3 -I tools/notes/embed_notes.py --check    # exit 1 if the app's copy is out of date

Per code (catalog types 1 and 2 only): [layer, range low, range high, label, facets, roles, strength, early, blends-with, sources,
Fraterworks average use % (as pure material) or 0, the % of the Fraterworks product when it is sold as a dilution or 0] · layer 0 top · 1 mid · 2 base · label 0 confirmed · 1 inferred · 2 guessed · facets/roles/sources
= indexes into the lists at the top · blends-with = shop codes from Fraterworks pages. Every style code must be a selectable
catalog item. dil = file 5's dilution ladder ({'10': codes, '1': codes, '0.1': codes}, from notes/sources/project_roles.json).
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.path.join(ROOT, 'app', 'index.html')
NOTES = os.path.join(ROOT, 'notes', 'notes.json')
STYLES = os.path.join(ROOT, 'notes', 'sources', 'styles.json')
ROLES = os.path.join(ROOT, 'notes', 'sources', 'project_roles.json')
L = ['top', 'mid', 'base']
LB = ['ok', 'inf', 'gs']
TAG = re.compile(r'<script type="application/json" id="notes-data">.*?</script>\n', re.S)
AFTER = re.compile(r'(<script type="application/json" id="accord-data">.*?</script>\n)', re.S)


def catalog(html):
    return json.loads(re.search(r'id="catalog-data">(.*?)</script>', html, re.S).group(1))


def build(html):
    cat = catalog(html)
    sel = {x['i'] for x in cat['items'] if x['t'] in (1, 2)}
    notes = json.load(open(NOTES, encoding='utf-8'))['items']
    styles = json.load(open(STYLES, encoding='utf-8'))['styles']
    fx = sorted({f for v in notes.values() for f in v.get('fx', [])})
    ro = sorted({r for v in notes.values() for r in v.get('ro', [])})
    src = sorted({s for v in notes.values() for s in v['src']})
    items = {}
    for k in sorted(notes, key=int):
        v = notes[k]
        if int(k) not in sel:
            raise SystemExit(f'notes.json has {k}, which is not a selectable catalog item')
        items[k] = [L.index(v['l']), L.index(v['r'][0]), L.index(v['r'][1]), LB.index(v['lb']),
                    [fx.index(f) for f in v.get('fx', [])], [ro.index(r) for r in v.get('ro', [])],
                    v.get('sg') or 0, 1 if v.get('e') else 0, [c for c in v.get('bw', []) if c in sel],
                    [src.index(s) for s in v['src']], v['up'] if v.get('ups') == 'fw' else 0, v.get('upd') or 0]
    missing = sel - {int(k) for k in items}
    if missing:
        raise SystemExit(f'{len(missing)} selectable items have no note data, e.g. {sorted(missing)[:5]}')
    ids = set()
    for s in styles:
        if s['id'] in ids:
            raise SystemExit('duplicate style ' + s['id'])
        ids.add(s['id'])
        notes, exp, sig = ({int(c): r for c, r in s[k].items()} for k in ('notes', 'expected', 'sig'))
        for c, per in notes.items():   # {perfume: null (the named material itself) | "note as written" (a stand-in)}
            if not isinstance(per, dict) or not all(v is None or (isinstance(v, str) and v.strip()) for v in per.values()):
                raise SystemExit(f"style {s['id']}: note {c} must map each perfume to null or the note it stands in for")
        notes = {c: list(per) for c, per in notes.items()}
        bad = [c for c in list(notes) + list(exp) + list(sig) + s['sets'] if c not in sel]
        if bad:
            raise SystemExit(f"style {s['id']}: codes not in the selectable catalog {bad}")
        if set(notes) & set(exp) or (set(notes) | set(exp)) & set(s['sets']) or len(set(s['sets'])) != len(s['sets']):
            raise SystemExit(f"style {s['id']}: a code is listed twice (notes, expected, sets)")
        if not set(sig) <= set(notes) | set(exp):
            raise SystemExit(f"style {s['id']}: every signature must also be a note or an expected material")
        for c, refs in list(notes.items()) + list(exp.items()) + list(sig.items()):
            if not refs or not set(refs) <= set(s['refs']):
                raise SystemExit(f"style {s['id']}: code {c} names a perfume that is not one of the style's references {refs}")
        if s['prof'] not in ('fresh', 'fougere', 'sweet') or not s.get('set_row'):
            raise SystemExit(f"style {s['id']}: unknown profile or no file 3 row name")
    roles = json.load(open(ROLES, encoding='utf-8'))
    dil = {k: roles[r]['codes'] for k, r in (('10', 'dilute_10'), ('1', 'dilute_1'), ('0.1', 'dilute_01'))}
    seen = [c for codes in dil.values() for c in codes]
    if [c for c in seen if c not in sel] or len(seen) != len(set(seen)):
        raise SystemExit('project_roles.json: a dilution code is not selectable or sits in two dilution lists')
    out = {'fx': fx, 'ro': ro, 'src': src, 'items': items, 'dil': dil,
           'styles': [{k: s[k] for k in ('id', 'n', 'refs', 'prof', 'set_row', 'sig', 'notes', 'expected', 'sets')} for s in styles]}
    return json.dumps(out, ensure_ascii=False, separators=(',', ':'))


def embed(html, data):
    tag = '<script type="application/json" id="notes-data">' + data.replace('</', '<\\/') + '</script>\n'
    if TAG.search(html):
        return TAG.sub(lambda m: tag, html, count=1)
    if not AFTER.search(html):
        raise SystemExit('accord-data block not found in the app')
    return AFTER.sub(lambda m: m.group(1) + tag, html, count=1)


def main(argv):
    html = open(APP, encoding='utf-8').read()
    new = embed(html, build(html))
    if '--check' in argv:
        if new != html:
            print('app/index.html notes-data is out of date: run python3 -I tools/notes/embed_notes.py')
            return 1
        print('app/index.html notes-data is up to date')
        return 0
    if new != html:
        open(APP, 'w', encoding='utf-8').write(new)
    print(f'notes-data: {len(new) - len(html):+d} bytes')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
