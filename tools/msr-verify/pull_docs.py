#!/usr/bin/env python3
"""Copy the Project docs a Claude Code session has read into project-docs/, byte for byte.

The Project docs live on claude.ai, not in git. A session reads them with the Projects tool
(project_read); the exact text lands in the session transcript. This script takes the newest
project_read result per doc path from the transcript (and its subagents) and writes it under
project-docs/<path>, so `git diff` shows what changed and CI can check it.

    python3 tools/msr-verify/pull_docs.py                 # newest transcript of this repo's sessions
    python3 tools/msr-verify/pull_docs.py --transcript ~/.claude/projects/<dir>/<session>.jsonl
"""
from __future__ import annotations

import argparse
import json
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


def results(path: Path):
    for line in path.open(encoding="utf-8"):
        if "project_read" not in line:
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
    a = ap.parse_args()
    main_file = a.transcript or newest_transcript()
    files = [main_file] + sorted(main_file.with_suffix("").glob("subagents/*.jsonl"))
    newest: dict[str, tuple[str, str]] = {}
    for f in files:
        for ts, doc, text in results(f):
            if doc not in newest or ts >= newest[doc][0]:
                newest[doc] = (ts, text)
    if not newest:
        raise SystemExit("this session has not read any Project doc yet (use project_read first)")
    for doc, (ts, text) in sorted(newest.items()):
        target = (OUT / doc).resolve()
        if OUT.resolve() not in target.parents:
            raise SystemExit(f"refusing to write outside project-docs/: {doc}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        print(f"{ts}  {doc}  {len(text):,} chars")


if __name__ == "__main__":
    main()
