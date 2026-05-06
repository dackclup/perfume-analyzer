# skill.md — Perfume Raw Materials Analyzer

> Operations manual for any LLM (or human) working on this repo.
> Read this BEFORE touching code. Update this AFTER solving anything novel.

## 1. What this project is

Static PWA + companion formulator for perfumery raw materials.

- `index.html` — Analyzer SPA (search 624 materials, filter, classify, IFRA/allergen badges)
- `formulation.html` — Formulator SPA (carriers, allocation, IFRA compliance, evaporation curves)
- **No build step.** ES modules in `lib/` are imported directly by both HTMLs.
- Deployed via GitHub Pages on every push to `main`. PWA shell cached via `sw.js`.

Live: https://dackclup.github.io/perfume-analyzer/

## 2. Tech stack (frozen — do not introduce a build step)

- Vanilla HTML/CSS/JS, ES modules in `lib/`
- vitest (282 tests baseline) + eslint 10 + prettier + ajv + ajv-formats
- PubChem PUG-REST + PUG-View (via `tools/lib/pubchem.mjs`, throttled at 5 req/s, disk-cached)
- GitHub Actions CI (11 sequential gates) + Dependabot (weekly)
- Local pre-commit hook (`scripts/install-hooks.mjs` → `scripts/pre-commit.sh`)

## 3. Repo map (canonical layout)

```
.
├── index.html                       # Analyzer SPA
├── formulation.html                 # Formulator SPA
├── data/materials.json              # 624 materials (schema-validated, has meta block)
├── formulation_data.js              # IFRA caps, EU allergens, hydrolysis pairs, etc.
├── formulation_engine.js            # 6 subsystems (compliance, evaporation, allocation, …)
├── taxonomy.js                      # Edwards 14-subfamily wheel + facets
├── sw.js                            # PWA shell — CACHE_VERSION auto-baked from content hash
├── manifest.webmanifest
├── version.json                     # SINGLE source of truth for data + shell version
├── lib/
│   ├── dom-utils.mjs                # escHtml, debounce, safeInit, normaliseMaterialKey
│   ├── material-shape.mjs           # buildEnriched, getMaterial
│   ├── storage.mjs                  # lsRead/lsWrite/lsGetString/lsSetString (versioned)
│   └── utils.mjs                    # csvEscape, arcPath, stereo grouping, allergen aliases
├── schema/materials.schema.json     # JSON Schema (draft-07) — CI-enforced
├── scripts/
│   ├── release.mjs                  # `npm run release` — single source of truth
│   ├── check-version-drift.mjs      # `npm run lint:version`
│   ├── add-material.mjs             # CAS-validated row insertion CLI
│   ├── rename-family.mjs            # Atomic taxonomy-token rename
│   ├── add-allergen.mjs             # Add EU allergen across all 5 surfaces
│   ├── install-hooks.mjs            # Wires .git/hooks/pre-commit → scripts/pre-commit.sh
│   └── pre-commit.sh                # Runs lint:data + lint:version + codemap:check
├── tools/
│   ├── lint-data.mjs                # 21-category cross-ref ratchet (CI-gated)
│   ├── lint-blends.mjs              # Older blends-specific linter (subsumed by lint-data)
│   ├── verify-molecular.mjs         # `npm run lint:molecular` — range + provenance + cache integrity
│   ├── enrich-molecular.mjs         # PubChem enrichment (mol_*/chem_*) — flagged Round 3
│   ├── molecular-coverage-report.mjs
│   ├── codemap.mjs                  # Generates .codemap.md (file index)
│   ├── cache-cleanup.mjs            # Manage audit/cache/ size + age
│   └── lib/pubchem.mjs              # Reusable PUG-REST client
├── tests/                           # vitest specs (282 tests)
├── audit/                           # Per-round investigation reports + ratchet baseline
└── .github/workflows/ci.yml         # 11-step pipeline
```

## 4. Common commands (memorise these)

```bash
npm test                  # vitest, 282 tests baseline; coverage v8
npm run lint              # eslint --max-warnings=0 (HARD gate)
npm run format:check      # prettier --check (root + tools/scripts/lib/tests)
npm run lint:data         # 21-category cross-ref ratchet — "no regression vs baseline"
npm run lint:molecular    # mol_*/chem_* range + provenance + InChIKey cache integrity
npm run lint:version      # single version + shell hash assertion
npm run codemap:check     # `.codemap.md` is fresh (regenerate with: node tools/codemap.mjs)
npm run release           # bump version.json + propagate; --check for read-only verify
npm run release -- --check  # dry-run version verify (used in pre-flight)
```

## 5. Architecture invariants (NEVER violate)

1. **One source of truth for version.** `version.json` → `npm run release` propagates to
   `data/materials.json:meta.version`, `sw.js:CACHE_VERSION`, both HTMLs (5 places + 4 places).
   Bumping version means data churn; CI-infra rounds do NOT bump.
2. **Shared logic lives in `lib/`.** Both HTMLs import via `<script type="module">`.
   Never duplicate helpers.
3. **Schema validates `data/materials.json`.** Adding a new field requires updating
   `schema/materials.schema.json` + a test in `tests/material-shape.test.mjs`.
4. **`tools/lint-data.mjs` ratchet is sacred.** A new violation must either be fixed
   in the same PR or added to `audit/lint-data-baseline.json` with rationale.
5. **`tools/verify-molecular.mjs` allowlist** (`audit/molecular-verify-baseline.json`)
   is for domain-legitimate exceptions only (e.g. Glyceryl Trioleate XLogP=22.4 is real).
6. **PubChem cache is gitignored** (`audit/cache/`). CI does NOT fetch PubChem;
   `lint:molecular` skips InChIKey integrity on cache miss, never errors.
7. **No `*.backup.*` files in main branch ever.** History lives in `git`.

## 6. Workflows (reusable templates)

### 6.1 Add a single-molecule material

| Step | Surface                                              | Auto?                                         |
| ---- | ---------------------------------------------------- | --------------------------------------------- |
| 1    | `data/materials.json` `perfumery_db[]`               | `scripts/add-material.mjs --cas <CAS>`        |
| 2    | `data/materials.json` `trade_names`                  | same script (interactive)                     |
| 3    | `formulation_data.js` `IFRA_51_LIMITS`               | manual (only if regulated)                    |
| 4    | `formulation_data.js` `NATURAL_ALLERGEN_COMPOSITION` | manual (only if natural with allergen)        |
| 5    | `formulation_data.js` `ESTER_HYDROLYSIS`             | manual (only if hydrolysable ester)           |
| 6    | `audit/cache/pubchem-first-layer/<cid>.json`         | `node tools/enrich-molecular.mjs --cid <CID>` |
| 7    | Bump version (only if public-facing data churn)      | `npm run release`                             |

After: `npm test && npm run lint:data && npm run lint:molecular && npm run codemap:check`.

### 6.2 Rename a taxonomy family token

`scripts/rename-family.mjs --from <old> --to <new>` covers:

- `data/materials.json` (every `primaryFamilies` / `secondaryFamilies` containing old token)
- `taxonomy.js` (`MAIN_FAMILY_TO_SUBS` / `SUB_FAMILY_TO_MAIN`)
- `index.html` `SUB_FAMILY_TO_LEGACY`
- `formulation_engine.js` `FAMILY_TO_AXES`
- `formulation_data.js` `FAMILY_NOTE_RATIOS` / `FAMILY_MOOD_DEFAULTS`
- `lib/material-classifier.mjs` rule outputs
- i18n labels (`MAIN_FAMILY_LABELS` / `SUB_FAMILY_LABELS`)

Then: `npm run lint:data && npm test`.

### 6.3 Add an EU allergen

`scripts/add-allergen.mjs --cas <CAS> --name <name> --inci <inci> --threshold <ppm>` covers:

- `formulation_data.js` (`EU_ALLERGENS_2023_NEW` or new revision map)
- Re-derives the analyzer regex from `EU_ALLERGENS_CURRENT` (no hardcoded list — see C7.1)
- Adds `NATURAL_ALLERGEN_COMPOSITION` constituent if it appears in any natural

### 6.4 Modify `formulation_engine.js`

Six subsystems live in this file: compliance, evaporation, allocation, radar, perception, longevity.

- **Always pin behaviour with vitest spec** before refactoring (`tests/formulation-engine-*.test.mjs`).
- **Concentration math** uses `g` and `%` consistently. EDP = 20% target; 0.05 g floor for trace
  ingredients. `formulation.materials[].pct` is the canonical share.
- **Compliance** must re-run on every `loadSaved()`; do NOT cache verdict in localStorage row.
  IFRA caps live in `formulation_data.js:IFRA_51_LIMITS`.

## 7. Testing rules

- **Baseline: 282 tests pass.** A PR that drops the count needs explicit justification.
- **New behaviour requires a new spec.** Pattern: locate the right `tests/<area>.test.mjs`,
  add `it(...)` block. Don't create a new spec file unless adding a whole new module.
- **Mock `fetch`** with `vi.stubGlobal('fetch', …)` for any PubChem-touching test
  (see `tests/pubchem-client.test.mjs`).
- **Coverage gate:** `vitest run --coverage` produces v8 report. Don't drop coverage
  on `tools/` modules below ~95% lines.
- **Snapshot tests** are NOT used in this repo. Prefer explicit `expect(x).toBe(y)`.

## 8. CI / pre-commit gates (must understand BEFORE blaming "CI is broken")

CI runs on every push to `main` AND every PR targeting `main`. 11 sequential steps:

```
1.  Checkout                   (actions/checkout@v6, post-#466)
2.  Setup Node                 (actions/setup-node@v4 — STILL on Node 20, Round 3.7 backlog)
3.  Install                    (npm ci — needs package-lock.json, see r3.5 lesson)
4.  Lint (eslint)
5.  Format check (prettier)
6.  Tests (vitest)
7.  Lint data (ratchet)
8.  Lint molecular (range + provenance + cache integrity)
9.  Molecular coverage report  (informational, never fails)
10. Lint version drift
11. Codemap freshness
```

Local pre-commit (after `node scripts/install-hooks.mjs`):

- `lint:data` + `lint:version` + `codemap:check` only (faster subset; full lint runs in CI).

**CRITICAL:** Verify CI by run ID + conclusion via the GitHub Actions page or the
`mcp__github__pull_request_read get_check_runs` MCP tool. **NEVER** read
"Deploy to Pages succeeded" as "CI green" — Round 2 + Round 3 made that mistake
because Pages-deploy is a separate workflow that only republishes static files.

## 9. PR + versioning workflow

1. Create branch off `main`: `claude/<topic>-<date>` for me, conventional naming for others.
2. Pre-commit hook auto-runs lint:data + lint:version + codemap:check.
3. Push → PR via `mcp__github__create_pull_request` (or `gh pr create`).
4. CI must be green on PR head before merge.
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
with explicit rationale.

## 11. Troubleshooting & Known Quirks

- **`npm ci` fails with "lockfile missing"** → `.gitignore` is blocking `package-lock.json`.
  This was the Round-3.5 root cause. `setup-node@v4 cache:"npm"` requires the lockfile.
- **PWA serves stale shell after release** → `sw.js:CACHE_VERSION` includes a content hash;
  `npm run release` regenerates it. If users still see stale, hard-reload + check
  DevTools → Application → Service Workers → Unregister.
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

## 12. Manager-mode prompts (when asking an LLM to work on this repo)

### Bug fix

> Read `skill.md`. Bug: \<describe symptom + reproduction\>. Find root cause in
> the relevant subsystem, fix it, add a vitest spec covering the regression,
> run `npm test && npm run lint && npm run lint:data && npm run lint:molecular`,
> open a PR with a Conventional-Commits message. Cite file:line for every claim.

### Add feature

> Read `skill.md` §6 (workflows). I want to add \<feature\>. Identify which
> workflow template applies, list every file/section that must change, then
> implement. Run the full local gate suite. STOP at each phase boundary
> for my approval before pushing.

### Knowledge update (after solving something novel)

> Update `skill.md` §11 "Troubleshooting & Known Quirks" with the lesson
> from \<task you just finished\>. Keep it under 3 lines per quirk; cite the
> commit SHA or PR number where the fix landed. Do NOT touch any other section.

### CI failure triage

> Read `skill.md` §8. Here's the failed CI log: \<paste\>. Identify which of
> the 11 steps failed, propose a fix, run the local equivalent, push to a
> new branch, open a PR. Do NOT push to main directly.

## 13. Latest known state (update on every round close)

- Main HEAD: `1550b4b` (Round 3.6 closing — 2026-05-03)
- Live version: `2026-04-29-v306`, shell hash `67edc026`
- Tests: 282 passing
- Open backlog: `audit/r3.5-investigation.md`
  - Round 3.7: vitest 4.x + @vitest/coverage-v8 4.x (PRs #469 + co-bump),
    `actions/setup-node@v4 → @v5`
  - Round 4: 6 novel findings from 2026-05-01 coherence audit (C3.5, C5.2-4, C7.1, C7.3)
  - User-action: 7 stale `claude/*` branches need UI delete (sandbox 403)
