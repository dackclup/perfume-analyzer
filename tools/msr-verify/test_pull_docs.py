import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

TOOL = Path(os.environ.get("PULL_DOCS", Path(__file__).resolve().parent / "pull_docs.py"))
DOC = "วิจัยน้ำหอมดีไซน์เนอร์/1-x.md"


def entry(ts, data):
    return json.dumps({"timestamp": ts, "message": {"content": [{"type": "tool_result", "content": json.dumps(data, ensure_ascii=False)}]}},
                      ensure_ascii=False)


def read(ts, text, path=DOC):
    return entry(ts, {"method": "project_read", "path": path, "content": text})


def write(ts, path=DOC):
    return entry(ts, {"method": "project_write", "path": path, "doc_uuid": "u", "replaced": True})


def run(lines):
    with tempfile.TemporaryDirectory() as d:
        d = Path(d); t = d / "s.jsonl"; t.write_text("\n".join(lines) + "\n", encoding="utf-8")
        r = subprocess.run([sys.executable, "-I", str(TOOL), "--transcript", str(t), "--out", str(d / "o")], capture_output=True, text=True)
        f = d / "o" / DOC
        return r.returncode, (f.read_text(encoding="utf-8") if f.exists() else None), r.stdout + r.stderr


class T(unittest.TestCase):
    def test_newest_read_wins(self):
        code, text, _ = run([read("2026-10-15T01:00:00Z", "v1\n"), read("2026-10-15T02:00:00Z", "v2\n")])
        self.assertEqual((code, text), (0, "v2\n"))

    # round 29 (F4b): a read older than this session's own later write is stale — using it would revert the upload
    def test_read_older_than_a_write_is_refused(self):
        code, text, s = run([read("2026-10-15T01:00:00Z", "v1\n"), write("2026-10-15T02:00:00Z")])
        self.assertEqual(code, 1); self.assertIsNone(text); self.assertIn("written after", s)

    def test_read_after_the_write_is_used(self):
        code, text, _ = run([read("2026-10-15T01:00:00Z", "v1\n"), write("2026-10-15T02:00:00Z"), read("2026-10-15T03:00:00Z", "v2\n")])
        self.assertEqual((code, text), (0, "v2\n"))

    # round 30: timestamps are compared as times, not strings; a write with no timestamp counts as newest
    def test_mixed_timestamp_precision(self):
        code, text, _ = run([write("2026-10-15T02:00:00Z"), read("2026-10-15T02:00:00.500Z", "v2\n")])
        self.assertEqual((code, text), (0, "v2\n"))

    def test_write_without_timestamp_is_treated_as_newest(self):
        code, text, s = run([read("2026-10-15T01:00:00Z", "v1\n"), write("")])
        self.assertEqual(code, 1); self.assertIsNone(text)


if __name__ == "__main__":
    unittest.main()
