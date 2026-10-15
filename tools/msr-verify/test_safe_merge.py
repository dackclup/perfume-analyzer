import subprocess, sys, tempfile, unittest
from pathlib import Path
TOOL = Path(__file__).resolve().parent / "safe_merge.py"

def run(base, mine, theirs):
    with tempfile.TemporaryDirectory() as d:
        d = Path(d); dirs = {k: d / k for k in ("b", "m", "t", "o")}
        for k in "bmt": dirs[k].mkdir()
        for k, txt in zip("bmt", (base, mine, theirs)):
            if txt is not None: (dirs[k] / "0-x.md").write_text(txt, encoding="utf-8")
        r = subprocess.run([sys.executable, "-I", str(TOOL), "--base", str(dirs["b"]), "--mine", str(dirs["m"]),
                            "--theirs", str(dirs["t"]), "--out", str(dirs["o"])], capture_output=True, text=True)
        out = dirs["o"] / "0-x.md"
        return r.returncode, (out.read_text(encoding="utf-8") if out.exists() else None), r.stdout

BASE = "a\nb\nc\nd\ne\nf\n"
class T(unittest.TestCase):
    def test_keeps_both_sides(self):  # the 14-15 Oct failure: whole-file upload dropped the other chat's line
        mine = BASE.replace("b\n", "b mine\n"); theirs = BASE.replace("e\n", "e theirs\n")
        code, out, _ = run(BASE, mine, theirs)
        self.assertEqual(code, 0); self.assertIn("b mine", out); self.assertIn("e theirs", out)
        self.assertNotIn("e theirs", mine)  # what a naive upload of `mine` would have lost
    def test_conflict_stops(self):
        code, out, s = run(BASE, BASE.replace("c\n", "c1\n"), BASE.replace("c\n", "c2\n"))
        self.assertEqual(code, 1); self.assertIsNone(out); self.assertIn("CONFLICT", s)
    def test_only_mine_changed(self):
        code, out, _ = run(BASE, BASE + "g\n", BASE); self.assertEqual((code, out), (0, BASE + "g\n"))
    def test_only_theirs_changed(self):  # local copy is stale: keep the Project version
        code, out, _ = run(BASE, BASE, BASE + "h\n"); self.assertEqual((code, out), (0, BASE + "h\n"))
    def test_no_base_both_differ_stops(self):
        code, out, _ = run(None, "x\n", "y\n"); self.assertEqual(code, 1); self.assertIsNone(out)

if __name__ == "__main__":
    unittest.main()
