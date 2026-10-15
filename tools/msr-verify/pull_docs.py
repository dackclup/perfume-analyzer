#!/usr/bin/env python3
"""Copy the Project docs a Claude Code session has read into project-docs/, byte for byte.

Large docs come back as a saved file rather than inline text; such a doc is refused (exit 1) when the newest read's
saved file is gone, or its modification time is more than 5 s after or before that read (edited later, or not
refreshed). --since TIME refuses docs not read again after TIME; --only PREFIX limits it all to the docs being
edited (e.g. --only วิจัยน้ำหอมดีไซน์เนอร์/). Exit 2 = usage (e.g. no transcript found).

The Project docs live on claude.ai, not in git. A session reads them with the Projects tool
(project_read); the exact text lands in the session transcript. This script takes the newest
project_read result per doc path from the transcript (and its subagents) and writes it under
project-docs/<path>, so `git diff` shows what changed and CI can check it. A doc this session wrote
(project_write) after its newest read is skipped with exit 1: that read is older than the Project's text,
and merging from it would undo the upload — read the doc again first. A doc with any transcript entry that has
no usable time is skipped too (exit 1), since its order cannot be known.

    python3 tools/msr-verify/pull_docs.py                 # newest transcript of this repo's sessions
    python3 tools/msr-verify/pull_docs.py --transcript ~/.claude/projects/<dir>/<session>.jsonl
    python3 tools/msr-verify/pull_docs.py --out /tmp/fresh     # e.g. to diff a fresh read against your edits
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
import os
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
OUT = REPO / "project-docs"


def newest_transcript() -> Path:
    base = Path.home() / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(REPO))
    files = sorted(base.glob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    if not files:
        print(f"error: no session transcript under {base} — pass --transcript ~/.claude/projects/<session dir>/<session>.jsonl")
        sys.exit(2)
    return files[-1]


def when(ts: str) -> datetime | None:
    """Transcript timestamps as times (not strings: "…:00Z" vs "…:00.500Z"); None when missing or unreadable."""
    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        return None


class Unusable(str):
    """A read whose text cannot be trusted (its saved copy is gone or was changed after the read)."""


SLACK = 5  # seconds allowed between the tool saving a large read and its transcript entry (observed: ~0.02 s)


def saved_copy(local: Path, ts: str) -> str:
    if not local.exists():
        return Unusable("saved copy is gone")
    t = when(ts)
    if t is not None:
        gap = local.stat().st_mtime - t.timestamp()
        if gap > SLACK:
            return Unusable("saved copy changed after the read")   # e.g. edited in place, or overwritten by a later read
        if gap < -SLACK:
            return Unusable("saved copy is older than the read (not refreshed by it)")
    return local.read_bytes().decode("utf-8")   # bytes: keep CRLF exactly as saved


def results(path: Path):
    """Yield (timestamp, path, text) per project_read, and (timestamp, path, None) per successful project_write."""
    for line in path.open(encoding="utf-8"):
        if "project_read" not in line and "project_write" not in line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        content = entry.get("message", {}).get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "tool_result":
                continue
            body = part.get("content")
            texts = [body] if isinstance(body, str) else [x.get("text", "") for x in body or [] if isinstance(x, dict)]
            for text in texts:
                try:
                    data = json.loads(text)
                except ValueError:
                    continue
                if data.get("method") == "project_write" and "path" in data and "error" not in data:
                    yield entry.get("timestamp", ""), data["path"], None
                    continue
                if data.get("method") != "project_read" or "path" not in data:
                    continue
                if "content" in data:
                    yield entry.get("timestamp", ""), data["path"], data["content"]
                else:  # large docs are saved to a local file; the result names it
                    local = next((v for v in data.values() if isinstance(v, str) and v.startswith("/")), None)
                    if local:
                        yield entry.get("timestamp", ""), data["path"], saved_copy(Path(local), entry.get("timestamp", ""))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--transcript", type=Path)
    ap.add_argument("--out", type=Path, default=OUT, help="folder to write into (default: project-docs/)")
    ap.add_argument("--since", help="ISO time (e.g. when the base was taken): refuse docs whose newest read is not later")
    ap.add_argument("--only", action="append", default=[], help="only docs whose path starts with this (repeatable)")
    a = ap.parse_args()
    out = a.out.resolve()
    since = when(a.since) if a.since else None
    if a.since and since is None:
        print(f"error: --since {a.since} is not an ISO time"); sys.exit(2)
    main_file = a.transcript or newest_transcript()
    if not main_file.exists():
        print(f"error: transcript {main_file} not found — pass --transcript ~/.claude/projects/<session dir>/<session>.jsonl"); sys.exit(2)
    files = [main_file] + sorted(main_file.with_suffix("").glob("subagents/*.jsonl"))
    newest: dict[str, tuple[datetime, str, str]] = {}
    wrote: dict[str, tuple[datetime, str]] = {}
    untimed: set[str] = set()   # any read or write of the doc without a usable time: its order is unknown
    for f in files:
        for ts, doc, text in results(f):
            if a.only and not any(doc.startswith(p) for p in a.only):
                continue
            t = when(ts)
            if t is None:
                untimed.add(doc)
            elif text is None:
                if doc not in wrote or t > wrote[doc][0]:
                    wrote[doc] = (t, ts)
            elif doc not in newest or t >= newest[doc][0]:
                newest[doc] = (t, ts, text)
    if not newest and not untimed:
        raise SystemExit("this session has not read any Project doc yet (use project_read first)")
    stale = sorted(d for d in newest if d in wrote and wrote[d][0] > newest[d][0])
    old = sorted(d for d in newest if since is not None and newest[d][0] <= since)
    for doc in old:
        print(f"NOT READ AGAIN, not written: {doc} — newest read {newest[doc][1]} is not after --since {a.since}; read it again")
        del newest[doc]
    bad = sorted(d for d in newest if isinstance(newest[d][2], Unusable))
    for doc in bad:
        print(f"SAVED COPY PROBLEM, not written: {doc} — {newest[doc][2]} ({newest[doc][1]}); read it again")
        del newest[doc]
    for doc in sorted(untimed):
        print(f"UNKNOWN ORDER, not written: {doc} — a transcript entry without a time; check by hand which text is newest")
        newest.pop(doc, None)
    for doc in stale:
        if doc in newest:
            print(f"STALE, not written: {doc} — written after the last read ({wrote[doc][1]} > {newest[doc][1]}); read it again")
            del newest[doc]
    for doc, (_, ts, text) in sorted(newest.items()):
        target = (out / doc).resolve()
        if out not in target.parents:
            raise SystemExit(f"refusing to write outside {out}: {doc}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(text.encode("utf-8"))
        print(f"{ts}  {doc}  {len(text):,} chars")
    if stale or untimed or bad or old:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
