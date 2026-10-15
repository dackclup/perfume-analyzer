import os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

TOOL = Path(os.environ.get("SAFE_MERGE", Path(__file__).resolve().parent / "safe_merge.py"))
BASE = "a\nb\nc\nd\ne\nf\n"


def run(base, mine, theirs, extra=(), out_files=None, env=None, theirs_dir=None, base_is=None, mine_is=None, mine_extra=None, out_is_file=False):
    """base/mine/theirs: dict name -> text (a plain str means {'0-x.md': text}; None = folder empty)."""
    def norm(x):
        return {} if x is None else ({"0-x.md": x} if isinstance(x, str) else x)
    with tempfile.TemporaryDirectory() as d:
        d = Path(d); dirs = {k: d / k for k in ("b", "m", "t", "o")}
        for k, content in zip("bmt", (norm(base), norm(mine), norm(theirs))):
            dirs[k].mkdir()
            for name, txt in content.items():
                (dirs[k] / name).write_text(txt, encoding="utf-8")
        if mine_extra:
            mine_extra(dirs["m"])
        if out_is_file:
            dirs["o"].write_text("x", encoding="utf-8")
        if out_files:
            dirs["o"].mkdir()
            for name, txt in out_files.items():
                (dirs["o"] / name).write_text(txt, encoding="utf-8")
        t = d / theirs_dir if theirs_dir else dirs["t"]
        pick = {"t": t, "m": dirs["m"], None: None}
        b = pick[base_is] or dirs["b"]; m = pick[mine_is] or dirs["m"]   # base_is / mine_is: pass the same folder twice
        r = subprocess.run([sys.executable, "-I", str(TOOL), "--base", str(b), "--mine", str(m),
                            "--theirs", str(t), "--out", str(dirs["o"]), *extra], capture_output=True, text=True, env=env)
        out = {p.name: p.read_text(encoding="utf-8") for p in dirs["o"].iterdir()} if dirs["o"].is_dir() else {}
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

    def test_only_theirs_changed(self):  # local copy is stale: the Project already has the right text, nothing to upload
        code, out, s = run(BASE, BASE, BASE + "h\n"); self.assertEqual((code, out), (0, {})); self.assertIn("no upload", s)

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


    # --- round 27 (F5): remaining silent paths ---
    def test_pull_docs_layout_refused(self):  # --theirs = the DIR given to pull_docs --out, docs one level down
        with tempfile.TemporaryDirectory() as d:
            d = Path(d); sub = d / "theirs" / "วิจัยน้ำหอมดีไซน์เนอร์"; sub.mkdir(parents=True)
            (sub / "0-x.md").write_text(BASE.replace("e\n", "e theirs\n"), encoding="utf-8")
            (d / "b").mkdir(); (d / "b" / "0-x.md").write_text(BASE, encoding="utf-8")
            (d / "m").mkdir(); (d / "m" / "0-x.md").write_text(BASE + "g\n", encoding="utf-8")
            r = subprocess.run([sys.executable, "-I", str(TOOL), "--base", str(d / "b"), "--mine", str(d / "m"),
                                "--theirs", str(d / "theirs"), "--out", str(d / "o")], capture_output=True, text=True)
            self.assertEqual(r.returncode, 2); self.assertFalse((d / "o").exists()); self.assertIn("wrong folder", r.stdout)
            r = subprocess.run([sys.executable, "-I", str(TOOL), "--base", str(d / "b"), "--mine", str(d / "m"),
                                "--theirs", str(sub), "--out", str(d / "o")], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0); self.assertIn("e theirs", (d / "o" / "0-x.md").read_text(encoding="utf-8"))

    def test_base_same_as_theirs_refused(self):  # a base taken from the same fresh read hides the other side
        code, out, s = run(BASE, BASE + "g\n", BASE.replace("e\n", "e theirs\n"), base_is="t")
        self.assertEqual(code, 2); self.assertEqual(out, {}); self.assertIn("same folder", s)

    def test_subfolder_or_link_in_mine_refused(self):
        code, out, s = run(BASE, BASE + "g\n", BASE, mine_extra=lambda m: (m / "sub").mkdir())
        self.assertEqual(code, 2); self.assertEqual(out, {}); self.assertIn("sub", s)
        code, out, s = run(BASE, BASE + "g\n", BASE, mine_extra=lambda m: os.symlink(m / "nowhere.md", m / "8-x.md"))
        self.assertEqual(code, 2); self.assertEqual(out, {}); self.assertIn("8-x.md", s)

    def test_out_is_a_file_refused(self):
        code, out, s = run(BASE, BASE + "g\n", BASE, out_is_file=True)
        self.assertEqual(code, 2); self.assertIn("not a folder", s)


    # --- round 28 (F3) ---
    def test_base_same_as_mine_refused(self):  # snapshot edited in place: every doc looks unchanged, edits silently dropped
        code, out, s = run(BASE, BASE + "g\n", BASE.replace("e\n", "e theirs\n"), base_is="m")
        self.assertEqual(code, 2); self.assertEqual(out, {}); self.assertIn("same folder", s)

    def test_mine_same_as_theirs_refused(self):
        code, out, s = run(BASE, BASE + "g\n", BASE, mine_is="t")
        self.assertEqual(code, 2); self.assertEqual(out, {}); self.assertIn("same folder", s)

    def test_unchanged_docs_not_written(self):  # a truncated fresh read must not be uploaded back
        bad = BASE[:3]
        code, out, s = run({"0-x.md": BASE, "1-x.md": BASE}, {"0-x.md": BASE, "1-x.md": BASE + "g\n"}, {"0-x.md": bad, "1-x.md": BASE})
        self.assertEqual(code, 0); self.assertEqual(out, {"1-x.md": BASE + "g\n"}); self.assertIn("0-x.md", s)
        code, out, _ = run(BASE, BASE + "g\n", BASE + "g\n"); self.assertEqual((code, out), (0, {}))   # same: already in the Project


if __name__ == "__main__":
    unittest.main()
