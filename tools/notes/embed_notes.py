"""Embed the note-layer data (notes/notes.json) and the style templates (notes/sources/styles.json) into the app
as <script type="application/json" id="notes-data">, compact, for the step-by-step picker (file 12, phase 2).

usage: python3 -I tools/notes/embed_notes.py            # write app/index.html
       python3 -I tools/notes/embed_notes.py --check    # exit 1 if the app's copy is out of date

Per code (catalog types 1 and 2 only): [layer, range low, range high, label, facets, roles, strength, early, blends-with, sources]
· layer 0 top · 1 mid · 2 base · label 0 confirmed · 1 inferred · 2 guessed · facets/roles/sources = indexes into the lists
at the top · blends-with = shop codes from Fraterworks pages. Every style code must be a selectable catalog item.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.path.join(ROOT, 'app', 'index.html')
NOTES = os.path.join(ROOT, 'notes', 'notes.json')
STYLES = os.path.join(ROOT, 'notes', 'sources', 'styles.json')
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
                    [src.index(s) for s in v['src']]]
    missing = sel - {int(k) for k in items}
    if missing:
        raise SystemExit(f'{len(missing)} selectable items have no note data, e.g. {sorted(missing)[:5]}')
    ids = set()
    for s in styles:
        if s['id'] in ids:
            raise SystemExit('duplicate style ' + s['id'])
        ids.add(s['id'])
        bad = [c for c in s['notes'] + s['sets'] + s['sig'] if c not in sel]
        if bad:
            raise SystemExit(f"style {s['id']}: codes not in the catalog {bad}")
        if not set(s['sig']) <= set(s['notes']):
            raise SystemExit(f"style {s['id']}: every signature must also be a note")
        if set(s['notes']) & set(s['sets']):
            raise SystemExit(f"style {s['id']}: a code is in both notes and sets")
        if s['prof'] not in ('fresh', 'fougere', 'sweet'):
            raise SystemExit(f"style {s['id']}: unknown profile {s['prof']}")
    out = {'fx': fx, 'ro': ro, 'src': src, 'items': items,
           'styles': [{k: s[k] for k in ('id', 'n', 'refs', 'prof', 'sig', 'notes', 'sets')} for s in styles]}
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
