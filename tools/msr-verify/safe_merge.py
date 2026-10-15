#!/usr/bin/env python3
"""Merge local doc edits onto the latest Project docs before writing them back (3-way, per file).

Why: this chat overwrote another chat's Project edits three times by uploading whole files from an
older local copy. A whole-file upload keeps only one side; a 3-way merge keeps both.

    base   = the Project docs as they were when this chat started editing (snapshot taken after the last read/write)
    mine   = only the docs this chat wants to write back
    theirs = the Project docs read just now — the doc folder itself, e.g. DIR/วิจัยน้ำหอมดีไซน์เนอร์
             after `pull_docs.py --out DIR` (pull_docs writes one sub-folder per Project folder)

For each doc in mine:  theirs == base -> mine · mine == base -> theirs · both changed -> `git merge-file`.
Stops (exit 1) and writes NOTHING at all when any doc conflicts, when a doc is missing from the fresh read
(deleted or renamed in the Project, or simply not read — read it first, or pass --new NAME for a doc that is
really new), or when both sides changed and there is no base. Exit 2 = wrong usage: --theirs holds none of
mine's docs (wrong folder?), --out is not empty, or git is not installed. Docs only in the Project are listed.

    python3 tools/msr-verify/safe_merge.py --base B --mine M --theirs T/วิจัยน้ำหอมดีไซน์เนอร์ --out O [--new 12-x.md]
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def files(d: Path) -> dict[str, Path]:
    return {p.name: p for p in d.iterdir() if p.is_file()} if d.is_dir() else {}


def merge_one(b: bytes | None, m: bytes, t: bytes) -> tuple[str, bytes | None]:
    if m == t:
        return "same", m
    if b is None:
        return "CONFLICT: no base snapshot and both sides differ", None
    if t == b:
        return "mine", m
    if m == b:
        return "theirs", t
    with tempfile.TemporaryDirectory() as d:
        dm, db, dt = (Path(d) / x for x in ("mine", "base", "theirs"))
        dm.write_bytes(m); db.write_bytes(b); dt.write_bytes(t)
        r = subprocess.run(["git", "merge-file", "-p", "-L", "mine", "-L", "base", "-L", "theirs",
                            str(dm), str(db), str(dt)], capture_output=True)
        if r.returncode != 0:  # >0: number of conflicting hunks · <0 (255): git error
            return f"CONFLICT: git merge-file exit {r.returncode}", None
        return "merged both", r.stdout


def plan(base: Path, mine: Path, theirs: Path, new: set[str]) -> tuple[list[tuple[str, str, bytes | None]], list[str]]:
    B, M, T = files(base), files(mine), files(theirs)
    rows, notes = [], []
    for name in sorted(M):
        m = M[name].read_bytes()
        if name not in T:
            if name in new and name not in B:
                rows.append(("new (passed --new)", name, m))
            elif name in B:
                rows.append(("CONFLICT: in base but not in the fresh read (deleted or renamed in the Project?)", name, None))
            else:
                rows.append(("CONFLICT: not in the fresh read (read it first, or pass --new if it is a new doc)", name, None))
            continue
        status, data = merge_one(B[name].read_bytes() if name in B else None, m, T[name].read_bytes())
        rows.append((status, name, data))
    notes += [f"only in the Project, left untouched: {n}" for n in sorted(set(T) - set(M))]
    return rows, notes


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    for k in ("base", "mine", "theirs", "out"):
        ap.add_argument(f"--{k}", required=True)
    ap.add_argument("--new", action="append", default=[], help="file name of a doc that is new in mine (repeatable)")
    a = ap.parse_args(argv)
    base, mine, theirs, out = (Path(getattr(a, k)) for k in ("base", "mine", "theirs", "out"))
    if shutil.which("git") is None:
        print("error: git is not installed (needed for git merge-file)"); return 2
    if not files(mine):
        print(f"error: --mine {mine} has no files"); return 2
    if not set(files(mine)) & set(files(theirs)):
        print(f"error: --theirs {theirs} holds none of mine's docs — wrong folder? "
              "pull_docs.py --out DIR writes DIR/<Project folder>/"); return 2
    if out.exists() and any(out.iterdir()):
        print(f"error: --out {out} is not empty; use a new folder so no stale file gets uploaded"); return 2
    rows, notes = plan(base, mine, theirs, set(a.new))
    for status, name, _ in rows:
        print(f"{status:<34} {name}")
    for n in notes:
        print(n)
    if any(data is None for _, _, data in rows):
        print("stopped: nothing written"); return 1
    out.mkdir(parents=True, exist_ok=True)
    for _, name, data in rows:
        (out / name).write_bytes(data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
