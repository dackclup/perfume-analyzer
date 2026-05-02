#!/usr/bin/env node
// scripts/install-hooks.mjs — copy the vendored git hooks into .git/hooks.
//
// Audit-coherence Tier 3 R4. Run automatically by the `prepare` lifecycle
// (so `npm install` activates the hooks) and manually via `npm run setup`.
//
// Why not husky?
//   • One less runtime devDep for a static-site repo.
//   • The hook is just a shell script; husky's value-add (a hooks
//     directory git tracks via core.hooksPath) is overkill here.
//
// No-ops cleanly when:
//   • not inside a git checkout (e.g. a downloaded zip)
//   • running on a CI image with read-only .git (CI doesn't need hooks)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const GIT_DIR = path.join(REPO, '.git');
if (!fs.existsSync(GIT_DIR)) {
  console.error(
    '[install-hooks] no .git directory — skipping (probably a zip download or worktree)'
  );
  process.exit(0);
}

const HOOKS_DIR = path.join(GIT_DIR, 'hooks');
try {
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
} catch (_) {
  /* already exists */
}

const HOOKS = [{ src: 'scripts/pre-commit.sh', dest: 'pre-commit' }];

let copied = 0;
for (const { src, dest } of HOOKS) {
  const srcAbs = path.join(REPO, src);
  const destAbs = path.join(HOOKS_DIR, dest);
  if (!fs.existsSync(srcAbs)) {
    console.error(`[install-hooks] WARN missing source ${src}`);
    continue;
  }
  try {
    fs.copyFileSync(srcAbs, destAbs);
    fs.chmodSync(destAbs, 0o755);
    copied++;
  } catch (e) {
    console.error(`[install-hooks] WARN could not write ${dest}:`, e.message);
  }
}
console.error(`[install-hooks] OK — ${copied}/${HOOKS.length} hook(s) installed.`);
