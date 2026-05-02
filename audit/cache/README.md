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

## CI behaviour

`tools/verify-molecular.mjs` runs in CI (Round 3 P1.7). Because this
directory is gitignored, a fresh GitHub Actions clone has no cache
files. The verify tool handles that gracefully:

- The InChIKey **cache-integrity** check (compare stored
  `mol_inchi_key` against the cached PubChem response) is silently
  skipped per row when no cache file exists for that CID. CI runs
  see all 290 patched rows skipped and report
  `cache integrity: skipped 290 row(s)` in the log.
- The other four checks (`mol_molecular_weight` range,
  `mol_xlogp3` range, `data_provenance.last_fetched` ISO format,
  `chem_vapor_pressure_mmhg_25c` positivity) **always run** and
  drive exit 1 on any un-allowlisted anomaly.
- Local devs who have populated the cache (`npm run enrich-molecular
  -- --first-layer-only`) get the full integrity check too.

Result: CI catches schema / range / provenance bugs without needing
PubChem network access.
