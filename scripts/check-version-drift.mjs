#!/usr/bin/env node
// scripts/check-version-drift.mjs — fast assertion for CI / pre-commit.
// Just calls the verification pass of release.mjs without side effects.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync('node', [path.join(__dirname, 'release.mjs'), '--check'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
