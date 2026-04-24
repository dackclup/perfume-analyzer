# `audit_facet.py` — reusable facet deep-audit CLI

A single Python script that runs ~40 structural + safety probes against any
configured facet in `perfumery_data.js`. Reads expected values from
`facet_audit_config.json` so new facets can be onboarded with a JSON edit,
no Python changes.

## Usage

```bash
python3 scripts/audit_facet.py lavender          # human-readable, one facet
python3 scripts/audit_facet.py lavender --json   # machine-readable JSON
python3 scripts/audit_facet.py --all             # every configured facet
python3 scripts/audit_facet.py --all --json
python3 scripts/audit_facet.py --list            # facets + entry counts
```

### Exit codes
| code | meaning |
|------|---------|
|  0   | no CRITICAL findings (WARN / INFO may still be present) |
|  1   | at least one CRITICAL finding |
|  2   | facet not found in config, or DB / HTML parse failure |

## Probe categories

Each facet is checked across four categories (~40 probes total):

1. **Data Integrity** — CAS uniqueness, FEMA range, PubChem CID format,
   InChIKey format, heavy-atom / formula consistency, GHS code format,
   oils (mixtures) must not carry structural identifiers, oils must
   appear in `mixture_cas`.
2. **Classification** — facet token present, facets in `FACET_TAGS`
   vocabulary, `primaryFamilies` non-empty and in
   `PRIMARY_FAMILY_LABELS`, note in `{Top, Middle, Base}`,
   odor.strength in `{Low, Medium, High, Very High}`, entry-count drift
   vs config.
3. **Chemistry** — isolate ID completeness, InChI `InChI=1S/` prefix,
   formula ⇒ MW (tolerance 0.5), formula / MW / CID match per-config
   expectations, IUPAC match for position-isomer pairs, isomer
   distinctness (same formula ⇒ distinct InChIKey and IUPAC),
   biosynthetic chains (precursor/product formulas differ sensibly),
   numeric property fields parse as numbers.
4. **Safety** — IFRA non-empty, IFRA 51 referenced, `Cat.N = X%`
   notation, QRA2 cap ordering (Cat.5D ≤ Cat.5B ≤ Cat.5A for phenolic
   sensitizers; Cat.4 ≥ Cat.5A for leave-on), GHS codes match config
   majority, peroxide caveat on terpene hydrocarbons, H317 / sensitizer
   disclosure on configured sensitizers, defense-in-depth check for
   hard-toxicity text vs PC / flavor exclusion lists, FEMA text claim
   vs field presence.

## Configuration — `facet_audit_config.json`

Each facet is one top-level key. Minimum required fields:

```json
"lavender": {
  "description":            "human-readable context",
  "expected_entry_count":   14,
  "oil_cas":                ["8000-28-0", "..."],
  "isolates": {
    "78-70-6": { "name": "Linalool", "cid": "6549",
                 "formula": "C10H18O", "mw": 154.25, "ghs": ["GHS07"] }
  },
  "ifra_phenolic":          false,
  "peroxide_required_cas":  ["78-70-6"],
  "sensitizer_required_cas":[],
  "biosynthetic_chains":    []
}
```

Optional fields:

- `iupac_expectations` — `{ CAS: "substring that must appear in iupac" }`,
  catches isomer IUPAC swaps (e.g. Thymol vs Carvacrol).
- `excluded_cas_expected` — `{ "personal_care": [...], "flavor": [...] }`
  whitelists CAS that are intentionally on the `PERSONAL_CARE_EXCLUDED_CAS`
  or `FLAVOR_EXCLUDED_CAS` sets in `index.html`. Without the whitelist,
  a CAS on an exclusion list raises a CRITICAL in `P-pc-excluded-consistency`.
- `trade_name_expectations` — `{ alias: CAS }` for round-trip checks
  against `trade_names` in `perfumery_data.js` (not enforced today;
  reserved for a future probe).

## Adding a new facet

1. Add the facet's entries to `perfumery_data.js` with full structure
   (CAS, PubChem IDs, GHS codes, IFRA caps, classification.facets).
2. Add a block to `scripts/facet_audit_config.json` — oil CAS list,
   isolates dict with expected formula / MW / CID / GHS, plus the three
   safety flags.
3. Run `python3 scripts/audit_facet.py <new-facet>` and fix any
   CRITICAL findings.

No Python code changes required.

## Probe ID reference

Probe IDs are stable strings (`P-<kebab>`) and appear in both
human-readable and JSON output. Machine consumers should filter on
these rather than on message text.

| ID | severity (default) | category |
|----|--------------------|----------|
| P-cas-unique                 | CRITICAL | data_integrity |
| P-cas-format                 | CRITICAL | data_integrity |
| P-fema-range                 | CRITICAL | data_integrity |
| P-name-nonempty              | CRITICAL | data_integrity |
| P-synonyms-count             | WARN     | data_integrity |
| P-oil-no-structural-ids      | WARN     | data_integrity |
| P-oil-in-mixture-cas         | WARN     | data_integrity / safety |
| P-pubchem-cid-format         | CRITICAL | data_integrity |
| P-pubchem-url-match          | WARN     | data_integrity |
| P-inchikey-format            | WARN     | data_integrity |
| P-heavy-atoms-consistency    | WARN     | data_integrity |
| P-ghs-format                 | WARN     | data_integrity |
| P-facet-in-vocab             | CRITICAL | classification |
| P-facet-in-group             | WARN     | classification |
| P-facet-included             | CRITICAL | classification |
| P-facets-nonempty            | CRITICAL | classification |
| P-facet-vocab                | WARN     | classification |
| P-primary-nonempty           | CRITICAL | classification |
| P-primary-families           | WARN     | classification |
| P-secondary-families         | WARN     | classification |
| P-note-vocab                 | WARN     | classification |
| P-odor-strength-vocab        | WARN     | classification |
| P-facet-entry-count          | INFO     | classification |
| P-iso-id-complete            | CRITICAL | chemistry |
| P-iso-present                | CRITICAL | chemistry |
| P-inchi-prefix               | WARN     | chemistry |
| P-formula-mw-match           | WARN     | chemistry |
| P-formula-vs-expected        | CRITICAL | chemistry |
| P-mw-vs-expected             | WARN     | chemistry |
| P-cid-vs-expected            | WARN     | chemistry |
| P-iupac-vs-expected          | CRITICAL | chemistry |
| P-biosynthetic-chain         | INFO     | chemistry |
| P-isomer-distinct            | CRITICAL | chemistry |
| P-isomer-iupac-distinct      | CRITICAL | chemistry |
| P-numeric-fields             | WARN     | chemistry |
| P-ifra-present               | CRITICAL | safety |
| P-ifra51-mentioned           | INFO     | safety |
| P-ifra-cap-format            | WARN     | safety |
| P-ifra-cap-order-phenolic    | WARN     | safety |
| P-ifra-cap-order-cat4        | WARN     | safety |
| P-ghs-majority-match         | WARN     | safety |
| P-ghs-majority-extra         | INFO     | safety |
| P-peroxide-caveat            | WARN     | safety |
| P-sensitizer-disclose        | WARN     | safety |
| P-pc-excluded-consistency    | CRITICAL | safety |
| P-flavor-excluded-consistency| CRITICAL | safety |
| P-hard-toxicity              | WARN     | safety |
| P-fema-text-consistency      | CRITICAL | safety |

## Scope

- In-repo: no network calls. All expected values live in
  `facet_audit_config.json`.
- Facet-scoped: global / runtime / search-coverage audits are out of
  scope; per-facet data correctness is the focus.
- Reports only. Nothing is modified.

## v32 baseline findings

At the time of this tool's introduction all six configured facets
(basil, lavandin, lavender, rosemary, sage, thyme) show **0 CRITICAL**.
Remaining WARN findings are legitimate data observations worth
addressing incrementally:

- `lavender` — `heavy_atoms` mismatch on Ethyl Linalool; non-canonical
  `odor.strength` phrasings; missing `peroxide` caveat on the two
  linalool enantiomers.
- `lavandin`, `sage` — non-canonical `odor.strength` phrasings
  (`Medium to High`, `Low to Medium`).
- `sage` — β-thujone and Cedarleaf Oil carry convulsant / GABA-A
  antagonist text but only α-thujone is listed in
  `PERSONAL_CARE_EXCLUDED_CAS` in `index.html`. Either extend the
  exclusion list or whitelist these CAS via
  `excluded_cas_expected.personal_care` in the config.
