#!/usr/bin/env python3
"""Copy the Project docs a Claude Code session has read into project-docs/, byte for byte.

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
        raise SystemExit(f"no session transcript under {base}")
    return files[-1]


def when(ts: str) -> datetime | None:
    """Transcript timestamps as times (not strings: "…:00Z" vs "…:00.500Z"); None when missing or unreadable."""
    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        return None


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
                    local = next((v for v in data.values() if isinstance(v, str) and v.startswith("/") and os.path.exists(v)), None)
                    if local:
                        yield entry.get("timestamp", ""), data["path"], Path(local).read_text(encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--transcript", type=Path)
    ap.add_argument("--out", type=Path, default=OUT, help="folder to write into (default: project-docs/)")
    a = ap.parse_args()
    out = a.out.resolve()
    main_file = a.transcript or newest_transcript()
    files = [main_file] + sorted(main_file.with_suffix("").glob("subagents/*.jsonl"))
    newest: dict[str, tuple[datetime, str, str]] = {}
    wrote: dict[str, tuple[datetime, str]] = {}
    untimed: set[str] = set()   # any read or write of the doc without a usable time: its order is unknown
    for f in files:
        for ts, doc, text in results(f):
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
        target.write_text(text, encoding="utf-8")
        print(f"{ts}  {doc}  {len(text):,} chars")
    if stale or untimed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
