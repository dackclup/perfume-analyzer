import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

TOOL = Path(os.environ.get("PULL_DOCS", Path(__file__).resolve().parent / "pull_docs.py"))
DOC = "วิจัยน้ำหอมดีไซน์เนอร์/1-x.md"


def entry(ts, data):
    return json.dumps({"timestamp": ts, "message": {"content": [{"type": "tool_result", "content": json.dumps(data, ensure_ascii=False)}]}},
                      ensure_ascii=False)


def read(ts, text, path=DOC):
    return entry(ts, {"method": "project_read", "path": path, "content": text})


def read_saved(ts, local, path=DOC):  # large docs: the result names a saved file instead of carrying the text
    return entry(ts, {"method": "project_read", "path": path, "local_file": str(local)})


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

    # round 31 (F7): any entry of a doc without a usable time -> refuse that doc instead of guessing either way
    def test_read_without_timestamp_is_refused(self):
        code, text, s = run([read("2026-10-15T01:00:00Z", "v1\n"), read("", "v2\n")])
        self.assertEqual(code, 1); self.assertIsNone(text); self.assertIn("without a time", s)

    def test_untimed_write_message_says_check_by_hand(self):
        code, _, s = run([write(""), read("2026-10-15T03:00:00Z", "v2\n")])
        self.assertEqual(code, 1); self.assertIn("check by hand", s)

    # round 32 (F4): a saved copy must be the text as read
    def _saved(self, d, text, ts):
        f = Path(d) / "saved.txt"; f.write_text(text, encoding="utf-8")
        t = __import__("datetime").datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        os.utime(f, (t, t)); return f

    def test_saved_copy_as_read_is_used(self):
        with tempfile.TemporaryDirectory() as d:
            f = self._saved(d, "big v1\n", "2026-10-15T01:00:00Z")
            code, text, _ = run([read_saved("2026-10-15T01:00:00.500Z", f)])
            self.assertEqual((code, text), (0, "big v1\n"))

    def test_saved_copy_changed_after_the_read_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            f = self._saved(d, "big v1\n", "2026-10-15T01:00:00Z")
            f.write_text("edited by hand\n", encoding="utf-8")   # mtime is now, long after the read
            code, text, s = run([read_saved("2026-10-15T01:00:00.500Z", f)])
            self.assertEqual(code, 1); self.assertIsNone(text); self.assertIn("saved copy", s)

    def test_missing_saved_copy_does_not_fall_back_to_an_older_read(self):
        code, text, s = run([read("2026-10-15T01:00:00Z", "v1\n"), read_saved("2026-10-15T02:00:00Z", "/nonexistent/saved.txt")])
        self.assertEqual(code, 1); self.assertIsNone(text); self.assertIn("saved copy", s)


if __name__ == "__main__":
    unittest.main()
