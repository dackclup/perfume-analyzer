import os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

TOOL = Path(os.environ.get("SAFE_MERGE", Path(__file__).resolve().parent / "safe_merge.py"))
BASE = "a\nb\nc\nd\ne\nf\n"


def run(base, mine, theirs, extra=(), out_files=None, env=None, theirs_dir=None):
    """base/mine/theirs: dict name -> text (a plain str means {'0-x.md': text}; None = folder empty)."""
    def norm(x):
        return {} if x is None else ({"0-x.md": x} if isinstance(x, str) else x)
    with tempfile.TemporaryDirectory() as d:
        d = Path(d); dirs = {k: d / k for k in ("b", "m", "t", "o")}
        for k, content in zip("bmt", (norm(base), norm(mine), norm(theirs))):
            dirs[k].mkdir()
            for name, txt in content.items():
                (dirs[k] / name).write_text(txt, encoding="utf-8")
        if out_files:
            dirs["o"].mkdir()
            for name, txt in out_files.items():
                (dirs["o"] / name).write_text(txt, encoding="utf-8")
        t = d / theirs_dir if theirs_dir else dirs["t"]
        r = subprocess.run([sys.executable, "-I", str(TOOL), "--base", str(dirs["b"]), "--mine", str(dirs["m"]),
                            "--theirs", str(t), "--out", str(dirs["o"]), *extra], capture_output=True, text=True, env=env)
        out = {p.name: p.read_text(encoding="utf-8") for p in dirs["o"].iterdir()} if dirs["o"].exists() else {}
        return r.returncode, out, r.stdout + r.stderr


class T(unittest.TestCase):
    def test_keeps_both_sides(self):  # the 14-15 Oct failure: a whole-file upload dropped the other chat's line
        mine = BASE.replace("b\n", "b mine\n"); theirs = BASE.replace("e\n", "e theirs\n")
        code, out, _ = run(BASE, mine, theirs)
        self.assertEqual(code, 0); self.assertIn("b mine", out["0-x.md"]); self.assertIn("e theirs", out["0-x.md"])
        self.assertNotIn("e theirs", mine)  # what a naive upload of `mine` would have lost

    def test_conflict_stops(self):
        code, out, s = run(BASE, BASE.replace("c\n", "c1\n"), BASE.replace("c\n", "c2\n"))
        self.assertEqual(code, 1); self.assertEqual(out, {}); self.assertIn("CONFLICT", s)

    def test_only_mine_changed(self):
        code, out, _ = run(BASE, BASE + "g\n", BASE); self.assertEqual((code, out), (0, {"0-x.md": BASE + "g\n"}))

    def test_only_theirs_changed(self):  # local copy is stale: keep the Project version
        code, out, _ = run(BASE, BASE, BASE + "h\n"); self.assertEqual((code, out), (0, {"0-x.md": BASE + "h\n"}))

    def test_no_base_both_differ_stops(self):
        code, out, _ = run(None, "x\n", "y\n"); self.assertEqual(code, 1); self.assertEqual(out, {})

    # --- round 26 (F2): the tool must fail closed ---
    def test_wrong_theirs_folder_refused(self):  # e.g. passing pull_docs' --out DIR instead of DIR/<folder>
        code, out, s = run(BASE, BASE + "g\n", BASE.replace("e\n", "e theirs\n"), theirs_dir="t-typo")
        self.assertEqual(code, 2); self.assertEqual(out, {}); self.assertIn("wrong folder", s)

    def test_doc_missing_from_fresh_read_stops(self):  # deleted/renamed in the Project, or never read
        code, out, s = run({"0-x.md": BASE, "10-old.md": "old\n"}, {"0-x.md": BASE, "10-old.md": "old\n"},
                           {"0-x.md": BASE, "10-new.md": "new\n"})
        self.assertEqual(code, 1); self.assertEqual(out, {}); self.assertIn("deleted or renamed", s)
        code, out, s = run({"0-x.md": BASE}, {"0-x.md": BASE, "7-x.csv": "csv\n"}, {"0-x.md": BASE})
        self.assertEqual(code, 1); self.assertEqual(out, {}); self.assertIn("not in the fresh read", s)

    def test_new_doc_needs_flag(self):
        code, out, _ = run({"0-x.md": BASE}, {"0-x.md": BASE, "12-x.md": "n\n"}, {"0-x.md": BASE}, extra=("--new", "12-x.md"))
        self.assertEqual(code, 0); self.assertEqual(out["12-x.md"], "n\n")

    def test_docs_only_in_project_are_listed(self):
        code, out, s = run({"0-x.md": BASE}, {"0-x.md": BASE + "g\n"}, {"0-x.md": BASE, "11-x.md": "p\n"})
        self.assertEqual(code, 0); self.assertIn("only in the Project", s); self.assertIn("11-x.md", s)
        self.assertNotIn("11-x.md", out)

    def test_all_or_nothing(self):  # one doc merges, another conflicts -> nothing may be written
        code, out, _ = run({"0-x.md": BASE, "1-x.md": BASE}, {"0-x.md": BASE + "g\n", "1-x.md": BASE.replace("c\n", "c1\n")},
                           {"0-x.md": BASE, "1-x.md": BASE.replace("c\n", "c2\n")})
        self.assertEqual(code, 1); self.assertEqual(out, {})

    def test_non_empty_out_refused(self):  # a stale file from an earlier run must not get uploaded
        code, out, s = run(BASE, BASE + "g\n", BASE, out_files={"0-x.md": "stale\n"})
        self.assertEqual(code, 2); self.assertEqual(out, {"0-x.md": "stale\n"}); self.assertIn("not empty", s)

    def test_missing_git_refused_before_writing(self):
        bin_dir = tempfile.mkdtemp()
        os.symlink(sys.executable, os.path.join(bin_dir, "python3"))
        try:
            code, out, s = run(BASE, BASE + "g\n", BASE.replace("e\n", "e theirs\n"), env={"PATH": bin_dir})
        finally:
            shutil.rmtree(bin_dir)
        self.assertEqual(code, 2); self.assertEqual(out, {}); self.assertIn("git", s)


if __name__ == "__main__":
    unittest.main()
