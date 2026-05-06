# skill.md — Perfume Raw Materials Analyzer

> Operations manual for any LLM (or human) working on this repo.
> Read this BEFORE touching code. Update this AFTER solving anything novel.
> Last verified against repo: 2026-05-06 (HEAD = post-r3.6 + skill.md v1, version `2026-04-29-v306`).

## 1. What this project is

Static PWA + companion formulator for perfumery raw materials.

- `index.html` — Analyzer SPA (search 624 materials, filter, classify, IFRA/allergen badges)
- `formulation.html` — Formulator SPA (carriers, allocation, IFRA compliance, evaporation curves)
- **No build step.** ES modules in `lib/` are imported directly by both HTMLs.
- Deployed via GitHub Pages on every push to `main`. PWA shell cached via `sw.js`.

Live: https://dackclup.github.io/perfume-analyzer/

This file (`skill.md`) is the **canonical operations manual** — mirror it as the
primary document in any LLM "Project Knowledge" / system-prompt context.

Companion docs at the repo root that this file does NOT replace:

- `CONTRIBUTING.md` — quick orientation, conventions for new contributors. Has its
  own (older) repo map; **`skill.md` is the canonical map** if the two diverge.
- `CHANGELOG.md` — round-by-round history; consult before claiming "this never worked".
- `.codemap.md` — auto-generated line index for big files; regenerate via
  `npm run codemap` after edits to `index.html` / `formulation.html` / etc.

## 2. Tech stack (frozen — do not introduce a build step)

- Vanilla HTML/CSS/JS, ES modules in `lib/`
- vitest (282 tests baseline) + eslint 10 + prettier + ajv + ajv-formats
- PubChem PUG-REST + PUG-View (via `tools/lib/pubchem.mjs`, throttled at 5 req/s, disk-cached)
- GitHub Actions: 2 workflows — `ci.yml` (11-step verification) + `static.yml` (Pages deploy)
- Dependabot weekly + local pre-commit hook (`scripts/install-hooks.mjs` → `scripts/pre-commit.sh`)

## 3. Repo map (canonical layout)

```
.
├── index.html                       # Analyzer SPA (~8.4k lines, inline)
├── formulation.html                 # Formulator SPA (~7k lines, inline)
├── data/materials.json              # 624 materials (schema-validated, has meta block)
├── formulation_data.js              # IFRA caps, EU allergens, hydrolysis pairs, etc.
├── formulation_engine.js            # 6 subsystems (compliance, evaporation, allocation, …)
├── taxonomy.js                      # Edwards 14-subfamily wheel + facets
├── sw.js                            # PWA shell — CACHE_VERSION = perfume-shell-${shell}-${contentHash}
├── manifest.webmanifest
├── version.json                     # SINGLE source of truth: { data, shell } (shell = manual major)
├── skill.md                         # ⭐ This file — LLM operations manual
├── .codemap.md                      # Auto-generated line index (run `npm run codemap` to refresh)
├── CHANGELOG.md                     # Round history (long; prefer named subsections — see §11 quirk)
├── CONTRIBUTING.md                  # Newcomer orientation (older partial repo map; skill.md wins)
├── lib/
│   ├── dom-utils.mjs                # escHtml, debounce, safeInit, normaliseMaterialKey
│   ├── material-shape.mjs           # buildEnriched, getMaterial, buildFamilyAxes
│   ├── storage.mjs                  # lsRead/lsWrite/lsRemove/lsGetString/lsSetString (versioned)
│   └── utils.mjs                    # csvEscape, arcPath, stereo grouping, allergen aliases
├── schema/materials.schema.json     # JSON Schema (draft-07) — CI-enforced
├── scripts/
│   ├── README.md                    # Docs for audit_facet.py (NOT for the other scripts)
│   ├── release.mjs                  # `npm run release` — single source of truth
│   ├── check-version-drift.mjs      # `npm run lint:version`
│   ├── add-material.mjs             # SINGULAR — interactive CAS-validated row insertion (1 material)
│   ├── rename-family.mjs            # Atomic taxonomy-token rename
│   ├── add-allergen.mjs             # Add EU allergen across all 5 surfaces
│   ├── install-hooks.mjs            # Wires .git/hooks/pre-commit → scripts/pre-commit.sh
│   ├── pre-commit.sh                # Runs lint:data + lint:version + codemap:check
│   ├── audit_facet.py               # Python facet deep-audit (~40 probes per facet); see §6.5
│   └── facet_audit_config.json      # Per-facet expectations consumed by audit_facet.py
├── tools/
│   ├── lint-data.mjs                # `npm run lint:data` — 21-category cross-ref ratchet (CI-gated)
│   ├── lint-blends.mjs              # `npm run lint:blends` — blends_with audit (NOT in CI; on-demand)
│   ├── verify-molecular.mjs         # `npm run lint:molecular` — range + provenance + cache integrity
│   ├── enrich-molecular.mjs         # `npm run enrich-molecular` — PubChem enrichment (mol_*/chem_*)
│   ├── molecular-coverage-report.mjs# `npm run report:molecular-coverage` — informational
│   ├── add-materials.mjs            # PLURAL — batch CAS/name updater driving PubChem PUG-REST
│   ├── check-pubchem.mjs            # CAS↔CID cross-validation; pre-release periodic check
│   ├── curate-stubs.mjs             # Heuristic auto-classifier for empty PubChem stubs
│   ├── codemap.mjs                  # Generates .codemap.md (file index)
│   ├── cache-cleanup.mjs            # Manage audit/cache/ size + age
│   └── lib/
│       ├── pubchem.mjs              # Reusable PUG-REST client (throttled 5 req/s, disk cache)
│       └── material-classifier.mjs  # Shared classifier (used by add-materials + curate-stubs)
├── tests/                           # vitest specs (282 tests across 8 files)
│   ├── data-integrity.test.mjs
│   ├── dom-utils.test.mjs
│   ├── enrich-molecular.test.mjs
│   ├── material-shape.test.mjs
│   ├── pubchem-client.test.mjs
│   ├── storage.test.mjs
│   ├── utils.test.mjs
│   └── verify-molecular.test.mjs
├── audit/                           # Per-round investigation reports + ratchet baselines
│   ├── lint-data-baseline.json      # Ratchet for `lint:data` (do NOT lower without rationale)
│   ├── molecular-verify-baseline.json # Allowlist for `lint:molecular` (real-chemistry outliers)
│   ├── coherence-2026-05-01.md      # Original 30-finding audit that drove R1–R3
│   ├── r2-report.md                 # Round 2 closing report
│   ├── r3-report.md                 # Round 3 closing report
│   ├── r3.5-investigation.md        # Active backlog → Round 3.7 + Round 4 scope
│   └── cache/                       # PubChem disk cache (gitignored; tens of MB)
└── .github/
    ├── dependabot.yml
    └── workflows/
        ├── ci.yml                   # 11-step verification (see §8)
        └── static.yml               # Pages deploy (republishes static files; SEPARATE from CI)
```

> ⚠️ Two pairs of similarly-named files exist — pick carefully:
>
> - `scripts/add-material.mjs` (singular, interactive) vs `tools/add-materials.mjs` (plural, batch)
> - `tools/lib/pubchem.mjs` (network client) vs `tools/lib/material-classifier.mjs` (rule engine)

## 4. Common commands (memorise these)

```bash
npm test                    # vitest, 282 tests baseline; coverage v8
npm run lint                # eslint --max-warnings=0 (HARD gate)
npm run lint:fix            # eslint --fix
npm run format:check        # prettier --check (root + tools/scripts/lib/tests)
npm run format              # prettier --write
npm run lint:data           # 21-category cross-ref ratchet — "no regression vs baseline"
npm run lint:blends         # On-demand blends_with audit (NOT in CI)
npm run lint:molecular      # mol_*/chem_* range + provenance + InChIKey cache integrity
npm run report:molecular-coverage  # Informational coverage % (CI continue-on-error)
npm run lint:version        # single version + shell hash assertion
npm run codemap             # Regenerate .codemap.md
npm run codemap:check       # Verify .codemap.md is fresh (CI gate)
npm run release             # Bump version.json + propagate to all 9 places
npm run release -- --check  # Dry-run version verify (used in pre-flight)
npm run enrich-molecular    # PubChem enrichment (writes audit/cache/, gitignored)
npm run setup               # Install local pre-commit hook
```

Out-of-band CLIs (no npm script wrapper):

```bash
node tools/check-pubchem.mjs --sample 50          # Pre-release CAS↔CID cross-check
node tools/check-pubchem.mjs --cas 78-70-6        # Spot-check one row
node tools/curate-stubs.mjs --dry-run             # Preview classifier matches
node tools/add-materials.mjs --file new-cas.txt   # Batch ingest by CAS list
node tools/cache-cleanup.mjs --report             # audit/cache/ size + age
python3 scripts/audit_facet.py lavender           # Facet deep-audit (~40 probes)
python3 scripts/audit_facet.py --all --json       # Every configured facet
```

## 5. Architecture invariants (NEVER violate)

1. **One source of truth for version.** `version.json` (fields: `data`, `shell`) →
   `npm run release` propagates `data` to `data/materials.json:meta.version`,
   computes a content hash, and writes `sw.js:CACHE_VERSION = perfume-shell-${shell}-${contentHash}`,
   plus updates both HTMLs (5 places + 4 places). `shell` field is the **manual major**;
   the trailing 8-char hex is the auto content hash. Bumping version means data churn;
   CI-infra rounds do NOT bump.
2. **Shared logic lives in `lib/`.** Both HTMLs import via `<script type="module">`.
   Never duplicate helpers. Note `tools/lib/` is a SEPARATE namespace for tooling-only
   helpers (pubchem client, material classifier) that the SPAs don't load.
3. **Schema validates `data/materials.json`.** Adding a new field requires updating
   `schema/materials.schema.json` + a test in `tests/material-shape.test.mjs` or
   `tests/data-integrity.test.mjs`.
4. **`tools/lint-data.mjs` ratchet is sacred.** A new violation must either be fixed
   in the same PR or added to `audit/lint-data-baseline.json` with rationale.
5. **`tools/verify-molecular.mjs` allowlist** (`audit/molecular-verify-baseline.json`)
   is for domain-legitimate exceptions only (e.g. Glyceryl Trioleate XLogP=22.4 is real;
   α-Tocopherol, Triglycerides, Ethanol all have intentional outliers).
6. **PubChem cache is gitignored** (`audit/cache/`). CI does NOT fetch PubChem;
   `lint:molecular` skips InChIKey integrity on cache miss, never errors.
7. **No `*.backup.*` files in main branch ever.** History lives in `git`.
8. **Material classifier rules live in `tools/lib/material-classifier.mjs`.**
   Both `tools/add-materials.mjs` (one-shot) and `tools/curate-stubs.mjs` (sweep)
   import the same `RULES` array — change rules in one place only.
9. **PRs may be merged via the GitHub UI, MCP `merge_pull_request`, or `gh pr merge`.**
   Do NOT assume your own merge path is the only one. Re-verify post-merge state via
   `mcp__github__list_branches` + `list_commits` rather than trusting your own
   tool-call return value.

## 6. Workflows (reusable templates)

### 6.1 Add a single-molecule material

| Step | Surface                                              | Auto?                                                     |
| ---- | ---------------------------------------------------- | --------------------------------------------------------- |
| 1    | `data/materials.json` `perfumery_db[]`               | `node scripts/add-material.mjs --cas <CAS>` (interactive) |
| 1b   | …or batch from a CAS list                            | `node tools/add-materials.mjs --file <txt>`               |
| 2    | `data/materials.json` `trade_names`                  | same script (interactive)                                 |
| 3    | `formulation_data.js` `IFRA_51_LIMITS`               | manual (only if regulated)                                |
| 4    | `formulation_data.js` `NATURAL_ALLERGEN_COMPOSITION` | manual (only if natural with allergen)                    |
| 5    | `formulation_data.js` `ESTER_HYDROLYSIS`             | manual (only if hydrolysable ester)                       |
| 6    | `audit/cache/pubchem-first-layer/<cid>.json`         | `node tools/enrich-molecular.mjs --cid <CID>`             |
| 7    | If material lands as a stub, fill classification     | `node tools/curate-stubs.mjs --dry-run` then live run     |
| 8    | Bump version (only if public-facing data churn)      | `npm run release`                                         |

After: `npm test && npm run lint:data && npm run lint:molecular && npm run codemap:check`.

### 6.2 Rename a taxonomy family token

`node scripts/rename-family.mjs --from <old> --to <new>` covers:

- `data/materials.json` (every `primaryFamilies` / `secondaryFamilies` containing old token)
- `taxonomy.js` (`MAIN_FAMILY_TO_SUBS` / `SUB_FAMILY_TO_MAIN`)
- `index.html` `SUB_FAMILY_TO_LEGACY`
- `formulation_engine.js` `FAMILY_TO_AXES`
- `formulation_data.js` `FAMILY_NOTE_RATIOS` / `FAMILY_MOOD_DEFAULTS`
- `tools/lib/material-classifier.mjs` rule outputs ⚠️ (path was wrong in skill.md v1)
- i18n labels (`MAIN_FAMILY_LABELS` / `SUB_FAMILY_LABELS`)

Then: `npm run lint:data && npm test`.

### 6.3 Add an EU allergen

`node scripts/add-allergen.mjs --cas <CAS> --name <name> --inci <inci> --threshold <ppm>` covers:

- `formulation_data.js` (`EU_ALLERGENS_2023_NEW` or new revision map)
- Re-derives the analyzer regex from `EU_ALLERGENS_CURRENT` (no hardcoded list — see C7.1)
- Adds `NATURAL_ALLERGEN_COMPOSITION` constituent if it appears in any natural

### 6.4 Modify `formulation_engine.js`

Six subsystems live in this file: compliance, evaporation, allocation, radar, perception, longevity.

- **Always pin behaviour with vitest spec** before refactoring (`tests/data-integrity.test.mjs`
  - cross-references in `tests/material-shape.test.mjs`).
- **Concentration math** uses `g` and `%` consistently. EDP = 20% target; 0.05 g floor for trace
  ingredients. `formulation.materials[].pct` is the canonical share.
- **Compliance** must re-run on every `loadSaved()`; do NOT cache verdict in localStorage row.
  IFRA caps live in `formulation_data.js:IFRA_51_LIMITS`.

### 6.5 Run a facet deep-audit

`scripts/audit_facet.py` runs ~40 probes across 4 categories (data integrity, classification,
chemistry, safety) for any facet listed in `scripts/facet_audit_config.json`.

```bash
python3 scripts/audit_facet.py lavender              # human-readable
python3 scripts/audit_facet.py lavender --json       # machine-readable
python3 scripts/audit_facet.py --all                 # every configured facet
python3 scripts/audit_facet.py --list                # list facets + entry counts
```

Exit codes: `0` = no CRITICAL, `1` = CRITICAL findings, `2` = facet not configured / parse fail.
Onboarding a new facet = JSON edit only (no Python changes). Full docs: `scripts/README.md`.

> Note: `audit_facet.py` reads `perfumery_data.js` paths from a legacy field name in its
> source — verify the script still resolves `data/materials.json` correctly before relying
> on it post-r4 (flagged for Round 4 review).

### 6.6 Periodic CAS↔CID re-verification (pre-release)

`tools/check-pubchem.mjs` is intentionally NOT in CI (rate-limited at 5 req/s; full sweep ~2 min).
Run it on a dev box before each release:

```bash
node tools/check-pubchem.mjs --sample 50    # 50-row spot-check (~10s)
node tools/check-pubchem.mjs --all          # full 624-row sweep (~2 min)
node tools/check-pubchem.mjs --cas 78-70-6  # one row
```

Round-2 audit found 2/10 sampled rows with wrong `pubchem_cid` (Triplal, Ethylene Brassylate);
this script makes that check repeatable. Exit codes: `0` match, `1` mismatch, `3` total network fail.

### 6.7 Refresh "Project Knowledge" (Claude.ai web/mobile)

When the repo state moves forward, re-upload these files into the project's
Knowledge panel so any chat session reads up-to-date context:

| File                          | Refresh trigger                           |
| ----------------------------- | ----------------------------------------- |
| `skill.md`                    | Any §11 quirk added or §13 state change   |
| `.codemap.md`                 | After structural edits to inline-JS HTMLs |
| `audit/r3.5-investigation.md` | At the close of every round               |
| `audit/r3-report.md`          | Once per major round (rare)               |

The fastest fetch is the GitHub raw URL:
`https://raw.githubusercontent.com/dackclup/perfume-analyzer/main/<path>`.

## 7. Testing rules

- **Baseline: 282 tests pass** across 8 spec files. A PR that drops the count needs explicit justification.
- **New behaviour requires a new spec.** Pattern: locate the right `tests/<area>.test.mjs`,
  add `it(...)` block. Don't create a new spec file unless adding a whole new module.
- **Mock `fetch`** with `vi.stubGlobal('fetch', …)` for any PubChem-touching test
  (see `tests/pubchem-client.test.mjs` for the canonical pattern).
- **Coverage gate:** `vitest run --coverage` produces v8 report. Don't drop coverage
  on `tools/` modules below ~95% lines.
- **Snapshot tests** are NOT used in this repo. Prefer explicit `expect(x).toBe(y)`.

Test file → primary surface mapping:

| Test file                   | Covers                                                |
| --------------------------- | ----------------------------------------------------- |
| `data-integrity.test.mjs`   | Schema + cross-references in `data/materials.json`    |
| `dom-utils.test.mjs`        | `lib/dom-utils.mjs`                                   |
| `enrich-molecular.test.mjs` | `tools/enrich-molecular.mjs` (largest spec, ~947 LoC) |
| `material-shape.test.mjs`   | `lib/material-shape.mjs`                              |
| `pubchem-client.test.mjs`   | `tools/lib/pubchem.mjs`                               |
| `storage.test.mjs`          | `lib/storage.mjs`                                     |
| `utils.test.mjs`            | `lib/utils.mjs`                                       |
| `verify-molecular.test.mjs` | `tools/verify-molecular.mjs`                          |

## 8. CI / pre-commit gates (must understand BEFORE blaming "CI is broken")

There are **two GitHub Actions workflows** — keep them straight:

- `.github/workflows/ci.yml` — verification gate (11 steps, runs on push to `main` + PRs).
- `.github/workflows/static.yml` — Pages deployment (runs on push to `main` only).

The CI workflow:

```
1.  Checkout                   (actions/checkout@v6, post-#466)
2.  Setup Node                 (actions/setup-node@v4 — STILL on Node 20, Round 3.7 backlog)
3.  Install                    (npm ci --ignore-scripts; needs package-lock.json, see r3.5 lesson)
4.  Lint (eslint)
5.  Format check (prettier)
6.  Tests (vitest)
7.  Lint data (ratchet)
8.  Lint molecular (range + provenance + cache integrity)
9.  Molecular coverage report  (informational, continue-on-error)
10. Lint version drift
11. Codemap freshness
```

Local pre-commit (after `node scripts/install-hooks.mjs` or `npm run setup`):

- `lint:data` + `lint:version` + `codemap:check` only (faster subset; full lint runs in CI).

**CRITICAL:** Verify CI by run ID + conclusion via the GitHub Actions page or the
`mcp__github__pull_request_read get_check_runs` MCP tool. **NEVER** read
"Deploy to Pages succeeded" (`static.yml`) as "CI green" (`ci.yml`) — Round 2 + Round 3
made that mistake because Pages-deploy is a separate workflow that only republishes
static files and does NO verification.

## 9. PR + versioning workflow

1. Create branch off `main`: `claude/<topic>-<date>` for me, conventional naming for others.
2. Pre-commit hook auto-runs lint:data + lint:version + codemap:check.
3. Push → PR via `mcp__github__create_pull_request` (or `gh pr create`).
4. CI must be green on PR head before merge (check `ci.yml`, NOT `static.yml`).
5. **Squash merge** is the project default.
6. Auto-delete fires on merge for both Dependabot and `claude/*` branches (verified).
7. Bump `version.json` ONLY when public-facing data or runtime behaviour changes.
   CI-infra rounds, doc-only PRs, audit preservation = no bump.

## 10. Round-based audit workflow

Every multi-step initiative follows this pattern:

```
Round N → Phase 1 (read-only investigation) → Phase 2 (implement) → Phase 3 (cleanup) →
          Phase 4 (audit/rN-report.md + CHANGELOG entry) → ship
```

Plan mode (Claude Code): Phase 1 Explore → Phase 2 Plan → write plan file → ExitPlanMode.
Each ACTION block has explicit STOP points; user approves each step.

Backlog hand-off: every closed round produces `audit/rN-report.md` (or
`audit/<topic>-investigation.md`) listing items deferred to the next round
with explicit rationale. Existing audit artefacts:

- `audit/coherence-2026-05-01.md` — the original 30-finding coherence audit
  that drove Rounds 1–3 (17 addressed, 4 ratcheted, 6 deferred, 3 historical)
- `audit/r2-report.md`, `audit/r3-report.md` — per-round closings
- `audit/r3.5-investigation.md` — active backlog (Round 3.7 + Round 4 scope)

## 11. Troubleshooting & Known Quirks

- **`npm ci` fails with "lockfile missing"** → `.gitignore` is blocking `package-lock.json`.
  This was the Round-3.5 root cause. `setup-node@v4 cache:"npm"` requires the lockfile.
- **PWA serves stale shell after release** → `sw.js:CACHE_VERSION` =
  `perfume-shell-${version.json:shell}-${contentHash}`; `npm run release` regenerates the hash.
  If users still see stale, hard-reload + DevTools → Application → Service Workers → Unregister.
- **`lint:molecular` reports `cache_skipped: 290`** → expected on a fresh CI checkout
  (cache is gitignored). On a local box, run `node tools/enrich-molecular.mjs --first-layer-only`
  to populate `audit/cache/`.
- **Dependabot PR shows "behind main"** → comment `@dependabot rebase` (it pre-builds
  rebase candidates in the background; your comment just promotes them).
- **`git push --delete origin <branch>` returns HTTP 403** in Claude Code sandbox.
  Fall back to GitHub UI delete (Settings → Branches → trash icon).
- **Same-file Dependabot PRs cascade-rebase each other** when one merges; different-file
  PRs don't (e.g. workflow YAMLs don't trigger rebase on package.json PRs).
- **Allowlist for `lint:molecular`** is `audit/molecular-verify-baseline.json`. Triglyceride,
  α-Tocopherol, Ethanol are intentional outliers (real chemistry).
- **`audit/cache/` size** is tens of MB. Run `node tools/cache-cleanup.mjs --report`
  to check; `--prune-older-than <days>` to clean stale entries.
- **CHANGELOG.md prettier mangling**: prose paragraphs with leading `+`/`-` get
  reinterpreted as bullets. Use named subsections instead ("Data:", "New tooling:" etc.).
- **Two `add-material(s)` scripts exist** — `scripts/add-material.mjs` is interactive
  for ONE row; `tools/add-materials.mjs` is the batch updater. Reaching for the wrong
  one wastes time on the wrong UX.
- **Material classifier path** is `tools/lib/material-classifier.mjs` (NOT `lib/`).
  skill.md v1 had this wrong; fixed in v2.
- **`audit_facet.py` legacy path** — script still references `perfumery_data.js` (legacy
  empty stub). Verify it resolves `data/materials.json` for current runs; flagged for R4.
- **Sandbox `/tmp/claude-0/` is shared across Claude Code sessions.** A task output file
  appearing under `/tmp/claude-0/-home-user-perfume-analyzer/<other-session-id>/tasks/`
  may be from a parallel session, not yours. Always confirm via `ps -ef | grep node`
  before claiming "I spawned that" or "it's still running."
- **PRs may be merged via the GitHub UI before your CI poll completes.** When you
  receive a webhook "PR merged" event before your sleep timer fires, re-fetch state
  via `mcp__github__list_branches` + `list_commits` rather than assuming the merge
  came through your own MCP path.
- **`claude/*` branch auto-delete works on PR merge** (verified PR #472, #473, #475 —
  same setting as Dependabot branches). Stale `claude/*` branches still in
  `list_branches` were created OUTSIDE the PR flow (experimental branches that never
  had a PR opened); auto-delete only fires on PR-merge, not on standalone push.

## 12. Manager-mode prompts (when asking an LLM to work on this repo)

### Bug fix

> Read `skill.md`. Bug: \<describe symptom + reproduction\>. Find root cause in
> the relevant subsystem, fix it, add a vitest spec covering the regression,
> run `npm test && npm run lint && npm run lint:data && npm run lint:molecular`,
> open a PR with a Conventional-Commits message. Cite file:line for every claim.

### Add feature

> Read `skill.md` §6 (workflows). I want to add \<feature\>. Identify which
> workflow template applies (6.1–6.6), list every file/section that must change,
> then implement. Run the full local gate suite. STOP at each phase boundary
> for my approval before pushing.

### Knowledge update (after solving something novel)

> Update `skill.md` §11 "Troubleshooting & Known Quirks" with the lesson
> from \<task you just finished\>. Keep it under 3 lines per quirk; cite the
> commit SHA or PR number where the fix landed. Do NOT touch any other section.

### CI failure triage

> Read `skill.md` §8. Here's the failed CI log: \<paste\>. Identify which of
> the 11 steps failed (in `ci.yml`, NOT `static.yml`), propose a fix, run the
> local equivalent, push to a new branch, open a PR. Do NOT push to main directly.

### Periodic verification (pre-release)

> Read `skill.md` §6.6. Run `node tools/check-pubchem.mjs --sample 50`. If any
> mismatch is reported, expand to `--all`, list every wrong CID with the
> resolved correct value, and open a fix PR. Do NOT bump version yet.

### Round close

> Round \<N\> work has shipped. Update `skill.md` §13 (Latest known state) and
> append a new section to `audit/r\<N\>-report.md` (or open one if missing).
> Mirror the §13 update into `audit/r3.5-investigation.md`'s footer if backlog
> items moved. Open a docs-only PR — no version bump.

## 13. Latest known state (update on every round close)

- Main HEAD: `51d2385` (2026-05-06, post-Round-3.6 + skill.md v1 via PR #475)
- Live data version: `2026-04-29-v306`
- `version.json`: `{ data: "2026-04-29-v306", shell: "v3" }`
- Live shell cache key: `perfume-shell-v3-67edc026` (manual major + content hash)
- Tests: 282 passing across 8 spec files
- Round 3.5 + 3.6 closed: 9 PRs merged (#471, #465, #467, #466, #470, #468,
  #472, #473, #475); 0 reverts; 0 source code modifications by the LLM
  (every code change came through Dependabot)
- Open backlog: `audit/r3.5-investigation.md`
  - Round 3.7: vitest 4.x + @vitest/coverage-v8 4.x (PRs #469 + co-bump auto-opened
    during Phase 4), `actions/setup-node@v4 → @v5` (no Dependabot PR yet)
  - Round 4: 6 novel findings from 2026-05-01 coherence audit (C3.5, C5.2-4, C7.1, C7.3),
    plus `audit_facet.py` legacy path verification
  - User-action: 7 stale `claude/*` branches need UI delete (sandbox 403)
