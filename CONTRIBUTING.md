# Contributing — Perfume Analyzer

Quick orientation for anyone (human or LLM) editing this repo.

## Repo shape

```
.
├── index.html              # Analyzer SPA (search, filters, cards). Inline CSS+JS.
├── formulation.html        # Formulator SPA (carriers, allocation, IFRA). Inline CSS+JS.
├── perfumery_data.js       # 417-material DB + trade_names index. Single JSON.
├── formulation_data.js     # IFRA caps, fragrance wheel, blend partners.
├── formulation_engine.js   # 6 formulator subsystems (compliance, evaporation, …).
├── lib/utils.mjs           # Pure helpers shared with tests.
├── sw.js                   # Service worker (PWA shell cache).
├── tools/
│   ├── codemap.mjs         # Generates .codemap.md (run after edits).
│   └── lint-blends.mjs     # blends_with audit / linter.
├── tests/                  # Vitest unit tests for lib/.
├── .codemap.md             # Auto-generated — line index for every section.
└── package.json            # npm scripts: test, lint, format, codemap.
```

## Working with the big HTML files

`index.html` is ~7.8k lines, `formulation.html` is ~4.2k. Each is a
single inline-script SPA (no build step, no bundler). To stay fast:

1. **Start at `.codemap.md`** — it lists every section banner and
   top-level function/const with line numbers. One Read of that file
   tells you exactly where to jump.
2. **Use `Read` with `offset` + `limit`**, not full-file reads. The
   code map gives you the line.
3. **`grep -n` with anchored prefixes** like `^function ` or
   `^const ` is cheaper than wide regex — most module-scope
   declarations sit at column 0.
4. **Use the section banners** — every major area starts with one of
   `// ===== Title =====`, `/* ===== Title ===== */`, or
   `// ── Title ──`. The codemap walks these. Add a banner when
   you create a new logical block so the next reader can find it.

## Order matters — TDZ caveat

Cache-bust v184/v187/v188/v189/v192 all fixed the same family of
bug: a `let`/`const` declared in a downstream feature block but read
by code that runs at the inline-script's first paint (init at line
~4300 of `index.html`). When you add a new top-level binding that
init code might touch:

- **Hoist it to the top-of-script comment block** (look for the
  "Sort state" / "Compare-cart state" / "Render virtualization
  state" comments near line 1180). They live there for a reason.
- Init reads `_renderCancel`, `_resultSeq`, `_sortOrder`,
  `_compareCart`, `_RESULTS_LS_KEY`, `_RENDER_CHUNK_*`,
  `CAS_RE_SEARCH`, ... If you add a similar `let`/`const`, check
  whether init touches it. If yes, hoist.

## Cache-busting

The PWA service worker uses **network-first for HTML** and
**cache-first for `perfumery_data.js?v=...`**. The query-string is
the cache key, so:

- Bump `index.html`'s `v=2026-04-25-rebuild-vNNN` on every change.
  `index.html`'s `DATA_VERSION` const must match (also `vNNN`).
- Bump `formulation.html`'s `?v=2026-04-29-...` on every change.
- The HTML auto-refreshes; the `.js` files do too once the new HTML
  references a new `?v=` string.

There's a single grep-replace pattern: search for the current
version string and bump it everywhere it appears.

## Conventions

- **String escapes** — DOM-bound user input goes through `esc()`
  (defined inline in each HTML). When you build a new template
  literal, escape every `${user-controlled}` substitution.
- **Defensive init** — every init call (renderResults,
  _updateCompareCta, _restoreUrlState, _restoreResults) is wrapped
  in `try/catch` so a single throw can't poison the rest of the
  script. Preserve this — see v189 commit.
- **Animation — first mount only** — cards animate via
  `style="--anim-delay:Xms"`; re-renders of the same CAS get
  `style="animation:none"` so nothing flickers. Look for
  `_renderedCas` set; preserve when touching the render path.
- **Wheel single-select** — clicking a slice/band clears every
  other slice/chip in that axis and lights only the latest pick.
  The chip drawer stays multi-select for power users.

## Tests

```sh
npm install
npm test           # vitest run
npm run test:watch # vitest watch
npm run lint       # eslint
npm run format     # prettier write
npm run codemap    # regenerate .codemap.md
```

Tests live under `tests/` and exercise `lib/utils.mjs`. The HTML
inline scripts are not test-targeted — they depend on a live DOM
and the data layer. When you add a new pure helper that's worth
testing, put it in `lib/utils.mjs` and the analyzer can copy the
algorithm inline.

## Workflow tips for LLM editors

- **Bump the cache-buster** in the same commit that ships a behaviour
  change. Otherwise a returning PWA user will see a stale shell.
- **Run `node tools/codemap.mjs`** after structural edits. The
  diff to `.codemap.md` is reviewable and tells future readers
  what moved.
- **Use try/catch around every new init call.** A bare throw at
  the top level halts the rest of the inline script — see the TDZ
  series of fixes (v184/v187/v188/v189/v192).
- **Match the existing comment density** — long-running logic
  blocks have a multi-line preamble explaining _why_; short
  helpers have a one-line header explaining _what_.
- **Don't introduce a build step** without an explicit ask. The
  whole site runs from raw files, which keeps Claude Code's
  feedback loop tight.

## Where things live (cheat sheet)

| You want to … | Look in |
|---|---|
| Change the search algorithm | `index.html` Search Matchers section |
| Tweak a filter axis | `index.html` `_filterAxes` + `_AXIS_CHECKERS` |
| Edit the fragrance wheel SVG | `index.html` `_buildWheelSvg` |
| Change card render | `index.html` `_renderResultsCore` (fn `renderResults` wraps it) |
| Add a regulatory token | `index.html` `REGULATORY_VALUES` + `REGULATORY_LABELS` |
| Add a captive supplier | `index.html` `SUPPLIER_BRANDS` |
| Edit IFRA caps | `formulation_data.js` `IFRA_51_LIMITS` |
| Patch material data | `perfumery_data.js` (single JSON line — use a Node script) |
| Audit DB mismatches | Run `tools/lint-blends.mjs` or write an ad-hoc node script |

When in doubt: `grep -n "thingyou'relookingfor"` or open
`.codemap.md` and Ctrl-F.
