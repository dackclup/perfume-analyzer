#!/usr/bin/env python3
"""Merge local doc edits onto the latest Project docs before writing them back (3-way, per file).

Why: this chat overwrote another chat's Project edits three times by uploading whole files from an
older local copy. A whole-file upload keeps only one side; a 3-way merge keeps both.

    base   = the Project docs as they were when this chat started editing (snapshot taken after the last read/write)
    mine   = only the docs this chat wants to write back
    theirs = the Project docs read just now — the doc folder itself, e.g. DIR/วิจัยน้ำหอมดีไซน์เนอร์
             after `pull_docs.py --out DIR` (pull_docs writes one sub-folder per Project folder)

For each doc in mine:  theirs == base -> mine · mine == base -> theirs · both changed -> `git merge-file`.
Only docs that need uploading (mine, merged both, new) are written to --out; "same" and "theirs" docs are already
right in the Project and are only listed. A fresh read that is clearly shorter than base (a truncated read?) of a
doc that both sides changed is a conflict unless --allow-shrink NAME is passed. What no tool here can see: a fresh
read that is itself stale (pull_docs refuses docs written after their last read) or a base that is not the text
the edits started from — take the base right after each verified read or write.
Stops (exit 1) and writes NOTHING at all when any doc conflicts, when a doc is missing from the fresh read
(deleted or renamed in the Project, or simply not read — read it first, or pass --new NAME for a doc that is
really new), or when both sides changed and there is no base. Exit 2 = wrong usage, before anything is written:
--theirs holds none of mine's docs (wrong folder?), any two of --base, --mine, --theirs are the same folder, --mine holds
sub-folders or links, every doc in --mine equals --base (nothing edited — base taken after editing?), --out is not
an empty folder, or git is not installed. Exit 3 = writing --out failed (nothing is left in it). Docs only in the
Project are listed.

    python3 tools/msr-verify/safe_merge.py --base B --mine M --theirs T/วิจัยน้ำหอมดีไซน์เนอร์ --out O [--new 12-x.md] [--allow-shrink 4-x.md]
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def files(d: Path) -> dict[str, Path]:
    return {p.name: p for p in d.iterdir() if p.is_file()} if d.is_dir() else {}


def shrunk(b: bytes, t: bytes) -> bool:
    """theirs looks cut off: much shorter than base, or shorter and missing base's last line."""
    if len(t) >= len(b):
        return False
    last = b.rstrip().splitlines()[-1] if b.strip() else b""
    return len(t) < 0.9 * len(b) or last not in t


def merge_one(b: bytes | None, m: bytes, t: bytes, allow_shrink: bool = False) -> tuple[str, bytes | None]:
    if m == t:
        return "same", m
    if b is None:
        return "CONFLICT: no base snapshot and both sides differ", None
    if t == b:
        return "mine", m
    if m == b:
        return "theirs", t
    if shrunk(b, t) and not allow_shrink:
        return "CONFLICT: fresh read is shorter than base (truncated read?) — check it, or pass --allow-shrink", None
    with tempfile.TemporaryDirectory() as d:
        dm, db, dt = (Path(d) / x for x in ("mine", "base", "theirs"))
        dm.write_bytes(m); db.write_bytes(b); dt.write_bytes(t)
        r = subprocess.run(["git", "merge-file", "-p", "-L", "mine", "-L", "base", "-L", "theirs",
                            str(dm), str(db), str(dt)], capture_output=True)
        if r.returncode != 0:  # >0: number of conflicting hunks · <0 (255): git error
            return f"CONFLICT: git merge-file exit {r.returncode}", None
        return "merged both", r.stdout


def plan(base: Path, mine: Path, theirs: Path, new: set[str], shrink_ok: set[str] = frozenset()) -> tuple[list[tuple[str, str, bytes | None]], list[str]]:
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
        status, data = merge_one(B[name].read_bytes() if name in B else None, m, T[name].read_bytes(), name in shrink_ok)
        rows.append((status, name, data))
    notes += [f"only in the Project, left untouched: {n}" for n in sorted(set(T) - set(M))]
    return rows, notes


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    for k in ("base", "mine", "theirs", "out"):
        ap.add_argument(f"--{k}", required=True)
    ap.add_argument("--new", action="append", default=[], help="file name of a doc that is new in mine (repeatable)")
    ap.add_argument("--allow-shrink", action="append", default=[], help="file name of a doc the other side really shortened (repeatable)")
    a = ap.parse_args(argv)
    base, mine, theirs, out = (Path(getattr(a, k)) for k in ("base", "mine", "theirs", "out"))
    if shutil.which("git") is None:
        print("error: git is not installed (needed for git merge-file)"); return 2
    def same_dir(p: Path, q: Path) -> bool:
        try:
            return os.path.samefile(p, q)   # also catches bind mounts and case-insensitive names
        except OSError:
            return p.resolve() == q.resolve()
    named = (("base", base), ("mine", mine), ("theirs", theirs))
    same = [f"--{a} and --{b}" for i, (a, p) in enumerate(named) for b, q in named[i + 1:] if same_dir(p, q)]
    if same:
        print(f"error: {', '.join(same)} are the same folder; the base must be the snapshot taken before editing, "
              "mine the edited copies and theirs the fresh read, or the merge cannot see each side"); return 2
    odd = sorted(p.name for p in mine.iterdir() if p.is_symlink() or not p.is_file()) if mine.is_dir() else []
    if odd:
        print(f"error: --mine holds sub-folders, links or other non-files: {', '.join(odd)} — put only the docs to write there"); return 2
    if not files(mine):
        print(f"error: --mine {mine} has no files"); return 2
    B0 = files(base)
    if all(n in B0 and p.read_bytes() == B0[n].read_bytes() for n, p in files(mine).items()):
        print("error: nothing edited — every doc in --mine equals --base (was the base taken after editing?)"); return 2
    if out.exists() and not out.is_dir():
        print(f"error: --out {out} exists and is not a folder"); return 2
    if not set(files(mine)) & set(files(theirs)):
        print(f"error: --theirs {theirs} holds none of mine's docs — wrong folder? "
              "pull_docs.py --out DIR writes DIR/<Project folder>/"); return 2
    if out.exists() and any(out.iterdir()):
        print(f"error: --out {out} is not empty; use a new folder so no stale file gets uploaded"); return 2
    rows, notes = plan(base, mine, theirs, set(a.new), set(a.allow_shrink))
    for status, name, _ in rows:
        print(f"{status:<34} {name}")
    for n in notes:
        print(n)
    if any(data is None for _, _, data in rows):
        print("stopped: nothing written"); return 1
    upload = [(name, data) for status, name, data in rows if status not in ("same", "theirs")]
    written: list[Path] = []
    try:
        out.mkdir(parents=True, exist_ok=True)
        for name, data in upload:
            (out / name).write_bytes(data); written.append(out / name)
    except OSError as e:
        for p in written:
            p.unlink(missing_ok=True)
        print(f"error writing --out: {e} — nothing was left in {out}; fix it and run again"); return 3
    skipped = [name for status, name, _ in rows if status in ("same", "theirs")]
    if skipped:
        print(f"no upload needed (the Project already has this text): {', '.join(skipped)}")
    print(f"to upload: {', '.join(n for n, _ in upload) or 'nothing'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
