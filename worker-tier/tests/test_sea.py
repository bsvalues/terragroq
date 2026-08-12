"""Offline unit tests for the SEA tier. No live model — MockModelClient scripts every response.

Run:  python -m unittest discover -s tests -v      (from the project root)
or:   python -m pytest tests -q
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sea import MockModelClient, Verifier, Workspace, parse_edits, parse_verdict  # noqa: E402
from sea.roles import remediate, review, worker  # noqa: E402
from sea.workspace import WorkspaceError  # noqa: E402

MATH_BUG = "def average(nums):\n    return sum(nums) / len(nums)\n"
MATH_TEST = (
    "from mathutil import average\n"
    "assert average([2, 4]) == 3\n"
    "assert average([]) == 0.0\n"
    "print('ok')\n"
)
DISC_BUG = "def apply_discount(price, pct):\n    return price * pct / 100\n"


def edit_json(file, old, new):
    return json.dumps({"edits": [{"file": file, "operation": "replace", "old_text": old, "new_text": new}]})


class TmpRepo:
    def __init__(self, files):
        self.dir = tempfile.mkdtemp(prefix="sea_test_")
        for name, content in files.items():
            with open(os.path.join(self.dir, name), "w") as fh:
                fh.write(content)

    def read(self, name):
        with open(os.path.join(self.dir, name)) as fh:
            return fh.read()


def compile_only(root):
    return lambda files: Verifier(root, files, compile_py=True)


def compile_and_test(root, cmd):
    return lambda files: Verifier(root, files, test_cmd=cmd, compile_py=True)


class SchemaTests(unittest.TestCase):
    def test_good_edits_object(self):
        edits, err = parse_edits(edit_json("a.py", "x", "y"))
        self.assertIsNone(err)
        self.assertEqual(len(edits), 1)
        self.assertEqual(edits[0].operation, "replace")

    def test_bare_object_and_list_accepted(self):
        e1, _ = parse_edits(json.dumps({"file": "a.py", "operation": "replace", "old_text": "x", "new_text": "y"}))
        e2, _ = parse_edits(json.dumps([{"file": "a.py", "operation": "rewrite", "content": "z"}]))
        self.assertEqual(len(e1), 1)
        self.assertEqual(e2[0].operation, "rewrite")

    def test_malformed_rejected(self):
        for bad in ["not json", "{}", json.dumps({"edits": []}),
                    json.dumps({"edits": [{"file": "a", "operation": "nuke"}]}),
                    json.dumps({"edits": [{"file": "", "operation": "replace", "old_text": "x", "new_text": "y"}]}),
                    json.dumps({"edits": [{"file": "a", "operation": "replace", "new_text": "y"}]})]:
            edits, err = parse_edits(bad)
            self.assertIsNone(edits, bad)
            self.assertIsNotNone(err, bad)

    def test_verdict_parsing(self):
        v, _ = parse_verdict(json.dumps({"verdict": "FAIL", "reason": "bug", "suggested_fix": "x"}))
        self.assertEqual(v.verdict, "FAIL")
        v2, _ = parse_verdict("PASS")
        self.assertEqual(v2.verdict, "PASS")
        v3, _ = parse_verdict("FAIL: returns discount amount")
        self.assertEqual(v3.verdict, "FAIL")
        self.assertIn("discount", v3.reason)
        v4, err = parse_verdict("maybe?")
        self.assertIsNone(v4)
        self.assertIsNotNone(err)


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.repo = TmpRepo({"a.py": "hello world\n"})
        self.ws = Workspace(self.repo.dir)

    def test_path_escape_rejected(self):
        with self.assertRaises(WorkspaceError):
            self.ws.read("../../etc/passwd")
        self.assertFalse(self.ws.exists("../a.py"))

    def test_replace_unique(self):
        edits, _ = parse_edits(edit_json("a.py", "hello", "goodbye"))
        ok, msgs = self.ws.apply_edits(edits)
        self.assertTrue(ok, msgs)
        self.assertEqual(self.repo.read("a.py"), "goodbye world\n")

    def test_replace_ambiguous_rejected_and_rolled_back(self):
        self.ws._resolve("a.py").write_text("dup dup\n")
        edits, _ = parse_edits(edit_json("a.py", "dup", "x"))
        ok, msgs = self.ws.apply_edits(edits)
        self.assertFalse(ok)
        self.assertIn("ambiguous", msgs[-1])
        self.assertEqual(self.repo.read("a.py"), "dup dup\n")  # unchanged

    def test_missing_old_text_rejected(self):
        edits, _ = parse_edits(edit_json("a.py", "nonexistent", "x"))
        ok, msgs = self.ws.apply_edits(edits)
        self.assertFalse(ok)
        self.assertIn("not found", msgs[-1])

    def test_snapshot_restore(self):
        snap = self.ws.snapshot(["a.py", "new.py"])
        self.ws._resolve("a.py").write_text("changed\n")
        self.ws._resolve("new.py").write_text("created\n")
        self.ws.restore(snap)
        self.assertEqual(self.repo.read("a.py"), "hello world\n")
        self.assertFalse(self.ws.exists("new.py"))  # created file removed on restore


class WorkerTests(unittest.TestCase):
    def test_success_first_try_with_tests(self):
        repo = TmpRepo({"mathutil.py": MATH_BUG, "test_mathutil.py": MATH_TEST})
        ws = Workspace(repo.dir)
        good = edit_json("mathutil.py", "return sum(nums) / len(nums)",
                         "return sum(nums) / len(nums) if nums else 0.0")
        model = MockModelClient([good])
        res = worker("fix empty-input", ["mathutil.py"], ws, model,
                     compile_and_test(repo.dir, f'"{sys.executable}" test_mathutil.py'))
        self.assertTrue(res.success, res.detail)
        self.assertEqual(res.attempts, 1)
        self.assertIn("if nums else 0.0", repo.read("mathutil.py"))

    def test_repair_loop_recovers(self):
        repo = TmpRepo({"mathutil.py": MATH_BUG})
        ws = Workspace(repo.dir)
        good = edit_json("mathutil.py", "return sum(nums) / len(nums)",
                         "return sum(nums) / len(nums) if nums else 0.0")
        # attempt 1: malformed JSON; attempt 2: out-of-scope file; attempt 3: good
        model = MockModelClient([
            "this is not json",
            edit_json("secrets.py", "x", "y"),
            good,
        ])
        res = worker("fix", ["mathutil.py"], ws, model, compile_only(repo.dir))
        self.assertTrue(res.success, res.detail)
        self.assertEqual(res.attempts, 3)
        # receipt recorded a reject for the out-of-scope attempt
        events = [e["event"] for e in res.receipt["events"]]
        self.assertIn("rejected", events)

    def test_fail_closed_restores_workspace(self):
        repo = TmpRepo({"mathutil.py": MATH_BUG})
        ws = Workspace(repo.dir)
        # every attempt is unappliable garbage -> must fail and leave the file pristine
        model = MockModelClient(lambda *a: "not json at all")
        res = worker("fix", ["mathutil.py"], ws, model, compile_only(repo.dir), max_attempts=3)
        self.assertFalse(res.success)
        self.assertEqual(res.attempts, 3)
        self.assertEqual(repo.read("mathutil.py"), MATH_BUG)  # pristine

    def test_verification_failure_rolls_back_then_no_silent_write(self):
        repo = TmpRepo({"mathutil.py": MATH_BUG})
        ws = Workspace(repo.dir)
        # applies cleanly but produces a syntax error -> compile fails -> rolled back -> overall FAIL
        breaks = edit_json("mathutil.py", "return sum(nums) / len(nums)", "return sum(nums) / len(nums")
        model = MockModelClient([breaks, breaks])
        res = worker("fix", ["mathutil.py"], ws, model, compile_only(repo.dir), max_attempts=2)
        self.assertFalse(res.success)
        self.assertEqual(repo.read("mathutil.py"), MATH_BUG)  # no broken code left behind


class ReviewRemediateTests(unittest.TestCase):
    def test_review_flags_bug(self):
        repo = TmpRepo({"discount.py": DISC_BUG})
        ws = Workspace(repo.dir)
        model = MockModelClient([json.dumps(
            {"verdict": "FAIL", "reason": "returns discount amount not final price",
             "suggested_fix": "price - price*pct/100"})])
        res = review("discount.py", "apply_discount(100,20) must equal 80", ws, model)
        self.assertTrue(res.success)
        self.assertEqual(res.verdict.verdict, "FAIL")

    def test_remediate_fixes(self):
        repo = TmpRepo({"discount.py": DISC_BUG})
        ws = Workspace(repo.dir)
        fix = edit_json("discount.py", "return price * pct / 100", "return price - price * pct / 100")
        model = MockModelClient([fix])
        from sea import Verdict
        res = remediate("discount.py", Verdict("FAIL", "wrong return", "price - price*pct/100"),
                        ws, model, compile_only(repo.dir))
        self.assertTrue(res.success, res.detail)
        self.assertEqual(res.role, "remediate")
        self.assertIn("price - price * pct / 100", repo.read("discount.py"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
