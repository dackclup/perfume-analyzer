#!/usr/bin/env python3
"""Merge local doc edits onto the latest Project docs before writing them back (3-way, per file).

Why: this chat overwrote another chat's Project edits three times by uploading whole files from an
older local copy. A whole-file upload keeps only one side; a 3-way merge keeps both.

    base   = the Project docs as they were when this chat started editing (snapshot taken after the last read/write)
    mine   = this chat's edited docs
    theirs = the Project docs read just now (tools/msr-verify/pull_docs.py --out DIR)

For each doc:  theirs == base -> mine · mine == base -> theirs · both changed -> `git merge-file`.
Any conflict -> exit 1 and write nothing for that file (resolve by hand, never by picking a side).

    python3 tools/msr-verify/safe_merge.py --base B --mine M --theirs T --out O
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path


def merge_one(base: Path | None, mine: Path, theirs: Path | None) -> tuple[str, bytes | None]:
    m = mine.read_bytes()
    if theirs is None or not theirs.exists():
        return "mine (not in Project)", m
    t = theirs.read_bytes()
    b = base.read_bytes() if base and base.exists() else None
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
        if r.returncode != 0:
            return f"CONFLICT: {r.returncode} hunk(s)", None
        return "merged both", r.stdout


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    for k in ("base", "mine", "theirs", "out"):
        ap.add_argument(f"--{k}", required=True)
    a = ap.parse_args(argv)
    base, mine, theirs, out = (Path(getattr(a, k)) for k in ("base", "mine", "theirs", "out"))
    out.mkdir(parents=True, exist_ok=True)
    bad = 0
    for f in sorted(p for p in mine.iterdir() if p.is_file()):
        status, data = merge_one(base / f.name, f, theirs / f.name)
        print(f"{status:<32} {f.name}")
        if data is None:
            bad += 1
            continue
        (out / f.name).write_bytes(data)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
