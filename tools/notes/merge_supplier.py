"""Merge supplier-fact batches (JSON lines written by the fetch runs) into notes/sources/supplier.jsonl.

Keeps one line per shop code (a later batch line for the same code replaces an earlier one), keeps only
the fields the build uses, drops anything that is not from scentree.co / fraterworks.com, and refuses
regulatory numbers (IFRA limits from vendor pages are not recorded — project rule 3). Codes listed in
supplier_rejected.json (next to OUT) are dropped with the reason recorded there.

usage: python3 -I tools/notes/merge_supplier.py OUT.jsonl BATCH.jsonl [BATCH.jsonl ...]
"""
import json
import os
import re
import sys

# ScenTree pages have no blends-with section; names the fetch runs found there came from other sections
# (e.g. natural sources of the molecule), so they are not kept.
ST_KEYS = ('url', 'name', 'cas', 'family', 'volatility', 'uses', 'mw')
FW_KEYS = ('url', 'name', 'cas', 'odour_words', 'note', 'tenacity', 'avg_use', 'blends_with')
BAD = re.compile(r'ifra|finished product|cat\.?\s*4|max(imum)? use', re.I)


def clean(side, keys, host):
    if not side or not isinstance(side, dict):
        return None
    if not re.match(rf'https://(www\.)?{host}/', side.get('url') or ''):
        return None
    out = {}
    for k in keys:
        v = side.get(k)
        if v in (None, '', []):
            continue
        if isinstance(v, str):
            v = v.strip()
            if k not in ('url', 'name') and BAD.search(v):
                continue
        if isinstance(v, list):
            v = [s.strip() for s in v if isinstance(s, str) and s.strip() and not BAD.search(s)]
            if not v:
                continue
        out[k] = v
    return out if len(out) > 1 else None


def main(out, batches):
    rej_path = os.path.join(os.path.dirname(os.path.abspath(out)), 'supplier_rejected.json')
    rejected = json.load(open(rej_path, encoding='utf-8'))['items'] if os.path.exists(rej_path) else {}
    rows = {}
    for b in batches:
        for line in open(b, encoding='utf-8'):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if str(r['i']) in rejected:
                continue
            st = clean(r.get('scentree'), ST_KEYS, r'scentree\.co')
            fw = clean(r.get('fraterworks'), FW_KEYS, r'fraterworks\.com')
            note = (r.get('match_note') or '').strip()
            if not (st or fw) and 'not searched' in note.lower() and r['i'] in rows:
                continue  # never replace real data with an unsearched placeholder
            rows[r['i']] = {'i': r['i'], 'name': r.get('name'), 'scentree': st, 'fraterworks': fw,
                            'cas_check': r.get('cas_check'), 'match_note': note[:300], 'fetched': r.get('fetched')}
    with open(out, 'w', encoding='utf-8') as f:
        for i in sorted(rows):
            f.write(json.dumps(rows[i], ensure_ascii=False, sort_keys=True) + '\n')
    n_st = sum(1 for r in rows.values() if r['scentree'])
    n_fw = sum(1 for r in rows.values() if r['fraterworks'])
    print(f'{len(rows)} codes · ScenTree {n_st} · Fraterworks {n_fw} -> {out}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
