# `audit/cache/` — PubChem fetch cache

**Gitignored.** Only `.gitkeep` and this README are tracked.

Layout:

```
audit/cache/
├── pubchem-first-layer/<CID>.json    # PUG-REST property batches
└── pubchem-experimental/<CID>.json   # PUG-View per-CID payloads
```

Populated by `tools/enrich-molecular.mjs` (Round 3 P1.3) and consumed by
`tools/verify-molecular.mjs` (P1.5). Re-runs of the enrichment script
hit cache and produce identical patches with zero network calls — the
cache is what makes the pipeline deterministic and offline-capable.

## Retention policy

- **TTL: 6 months.** Cached responses older than 180 days are treated
  as stale. Re-run `tools/enrich-molecular.mjs --first-layer-only`
  (no `--apply`) to refresh; or use `tools/cache-cleanup.mjs --prune-older-than 180`
  to delete only the stale entries.
- **Size warning at 100 MB.** `tools/cache-cleanup.mjs --report` prints
  total size + age summary; warn loudly above the threshold. Real-world
  size for the 624-material DB is well under that, but PUG-View payloads
  are unbounded so a misconfigured experimental sweep could grow.
- **Why gitignored:** (a) size — full coverage approaches tens of MB;
  (b) PubChem licence terms attribute data to the PubChem REST endpoint
  at fetch time; we re-fetch on schedule and surface the source URL in
  `data_provenance.computed_source` rather than re-distributing.

## Hygiene

```sh
node tools/cache-cleanup.mjs --report
node tools/cache-cleanup.mjs --prune-older-than 180
```

The cleanup tool is **manual-run only** — never wired into CI (a CI
prune would silently re-fetch, breaking determinism).

## Schema

Each cached file is the exact JSON returned by the PubChem REST or PUG-View
endpoint. Do not edit by hand — the parsers in `tools/enrich-molecular.mjs`
expect the original PubChem-shaped payload.
