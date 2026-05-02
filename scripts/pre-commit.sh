#!/usr/bin/env bash
# scripts/pre-commit.sh — git pre-commit gate.
#
# Audit-coherence Tier 3 R4 fix. Replaces the manual CONTRIBUTING.md
# checklist that everyone forgot ("did you bump cache-bust?", "did you
# regenerate codemap?") with a hook that runs the same checks CI does,
# locally, before the commit lands.
#
# Installed by `node scripts/install-hooks.mjs` (which `npm install`
# also runs as the `prepare` lifecycle script). Skip with `git commit
# --no-verify` ONLY when you know what you're doing — every check here
# is also a CI gate, so skipping just defers the same failure.

set -e

# Use the local node_modules' bins so we don't depend on global installs.
export PATH="$(pwd)/node_modules/.bin:$PATH"

echo "[pre-commit] lint…"
npm run --silent lint

echo "[pre-commit] format:check…"
npm run --silent format:check

echo "[pre-commit] test…"
npm run --silent test

echo "[pre-commit] lint:data…"
npm run --silent lint:data

echo "[pre-commit] lint:version…"
npm run --silent lint:version

echo "[pre-commit] codemap:check…"
npm run --silent codemap:check

echo "[pre-commit] OK"
