# Round 2 Audit — Coherence + Performance + A11y + Domain + Security + Code Quality

**Branch**: `claude/audit-r2-2026-05-02`  
**Base**: main @ `e324ecf` (post-Round-1)  
**Date**: 2026-05-02  
**Mode**: Read-only audit followed by tiered implementation; no push until confirmed.

## Finding format

Each finding follows:

```
### [Phase][Sequence] — Short title
**Tier**: -1 | 0 | 1 | 2 | 3 | 4 | 5
**Auto-fixable**: yes | no | partial
**Severity**: critical | high | medium | low | info
**Locus**: file:line(s)
**Evidence**: verbatim quote from code or output
**Why it matters**: ...
**Fix(point)**: minimal local change
**Fix(systemic)**: root-cause-level change preventing recurrence
```

Tier semantics:
- **-1** Round-1 regression (highest priority — fix first)
- **0** Quick win (data fix, doc update)
- **1** Single-source-of-truth addition
- **2** Code structure / lib extraction
- **3** Automation
- **4** Domain-expert review needed (DO NOT fix; flag only)
- **5** Long-term refactor


---

## Phase A — Round 1 Regression Check

Verifies Round-1 deliverables (v294 → v296) actually function as documented in CHANGELOG.md.

### [A1] — CHANGELOG breaking changes verified working

**Tier**: info
**Auto-fixable**: n/a
**Severity**: low
**Locus**: spot-checked all "Breaking" bullets against current state.
**Evidence**:
- `lint:data` shows `material.secondaryFamilies → taxonomy 0 / 187` (the 16 reclassified rows pass).
- `data/materials.json` `meta.version` = `2026-04-29-v296`, `row_count` = 624.
- 135/135 tests pass.
- `lib/dom-utils.mjs`, `lib/material-shape.mjs`, `lib/storage.mjs` all present + delegated from inline scripts.

**Verdict**: CHANGELOG is accurate. No reality drift.

### [A2] — `format:check` fails on Round-1 outputs ⚠ regression

**Tier**: -1
**Auto-fixable**: yes (single `prettier --write`)
**Severity**: medium (CI gate)
**Locus**: `lib/dom-utils.mjs`, `lib/material-shape.mjs`, `lib/storage.mjs`, `tests/dom-utils.test.mjs`, `CHANGELOG.md`, `CONTRIBUTING.md`.
**Evidence**:
```
$ npx prettier --check lib/dom-utils.mjs lib/material-shape.mjs lib/storage.mjs tests/dom-utils.test.mjs CHANGELOG.md CONTRIBUTING.md
[warn] lib/dom-utils.mjs
[warn] lib/material-shape.mjs
[warn] lib/storage.mjs
[warn] tests/dom-utils.test.mjs
[warn] CHANGELOG.md
[warn] CONTRIBUTING.md
[warn] Code style issues found in 6 files. Run Prettier with --write to fix.
```

**Why it matters**: CI workflow `.github/workflows/ci.yml` (added Round 1) runs `npm run format:check`. Either CI was failing silently, or the WebFetched success report was inaccurate. Either way, the next push that pre-commit-checks files runs format:check and fails.

**Fix(point)**: `npx prettier --write` on the 6 files (and any pre-existing dirty ones).
**Fix(systemic)**: Add `format:check` to `scripts/pre-commit.sh` so future drift is caught before push, not after CI fails.

### [A3] — `.prettierignore` still references deleted `perfumery_data.backup.js`

**Tier**: 0
**Auto-fixable**: yes
**Severity**: low (cosmetic)
**Locus**: `.prettierignore:4`
**Evidence**:
```
$ ls perfumery_data.backup.js
ls: cannot access 'perfumery_data.backup.js': No such file or directory

$ git log --all --oneline -- perfumery_data.backup.js
73a20c6 audit-fixes Tier 0 — 8 quick wins      ← deletion
b03fcb8 Clear perfumery_data.js for ground-up rebuild (backup to .backup.js)

$ grep -n perfumery_data.backup .prettierignore
4:perfumery_data.backup.js
```

**Why it matters**: stale ignore rule with no matching file. Misleading reference; repo housekeeping.
**Fix(point)**: remove line 4 from `.prettierignore`.
**Fix(systemic)**: covered by Tier-3 dead-reference scanner (Phase F candidate).

### [A4] — `npm run release` real-world bump+revert works

**Tier**: info
**Auto-fixable**: n/a
**Severity**: low
**Evidence**: snapshotted `version.json` + 5 edited files, ran `npm run release` (v296 → v297, hash `909924ba` → `3347f7d2`); diff showed exactly 5 cache-bust strings updated in `index.html`, 7 in `formulation.html`, plus `version.json`, `sw.js`, `data/materials.json`. Restored snapshots; `npm run release -- --check` returned green at v296.

**Verdict**: scripts/release.mjs round-trips cleanly with no orphan writes.

### [A5] — `lib/storage.mjs` graceful degradation verified

**Tier**: info
**Auto-fixable**: n/a
**Severity**: low
**Evidence**: imported `lib/storage.mjs` into Node with a polyfilled `localStorage`, ran 6 cases (corrupt JSON, validator rejection, missing key, round-trip, missing-key remove, throwing localStorage from private-mode simulation). All returned the documented default.

**Verdict**: localStorage migration is robust. Live-site behaviour cannot be confirmed from CLI but the module-level invariants hold.

### [A6] — Pre-commit hook blocks broken data ✓

**Tier**: info
**Auto-fixable**: n/a
**Severity**: low
**Evidence**: injected an invalid row `{cas:'999-99-9', name:'EVIL_TEST', classification:{primaryFamilies:['__not_a_real_family__']}}` into `data/materials.json`, attempted `git commit`. The hook ran `npm test`, the data-integrity spec failed (`Tests 1 failed | 134 passed`), and the commit did NOT land (working tree was restored). Working as designed.

### [A7] — `npm audit` reports 5 moderate vulnerabilities (devDeps only)

**Tier**: 3
**Auto-fixable**: partial (vitest 2.x → 3.x is breaking)
**Severity**: low (dev-only, no production deps)
**Evidence**:
```
$ npm audit
… 5 moderate severity vulnerabilities (vitest / vite / vite-node) …
To address all issues (including breaking changes), run:
  npm audit fix --force
```

**Why it matters**: this project ships static HTML. devDeps don't reach end users. Still, vitest is the test runner — a vulnerable test runner is a low-risk supply-chain problem.
**Fix(point)**: defer to a vitest 3 upgrade as a separate dedicated PR.
**Fix(systemic)**: Dependabot config + monthly bump cadence (see Phase E systemic candidates).

### [A8] — `node_modules` version mismatch warning at install

**Tier**: 0
**Auto-fixable**: partial
**Severity**: low
**Evidence**: `npm install` ends with "Run `npm audit fix --force`" — see A7. No actual install error.

### Systemic fix candidates (A)

- **Tier -1**: run `npx prettier --write` on the 6 files; commit as the very first Tier-(-1) commit.
- **Tier 0**: drop dead line from `.prettierignore`.
- **Tier 0**: add `npm run format:check` to `scripts/pre-commit.sh` so future drift is caught locally.
- **Tier 3**: Dependabot config (see Phase E).

