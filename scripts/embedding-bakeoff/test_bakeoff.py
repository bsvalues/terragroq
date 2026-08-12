"""Offline self-test for the embedding bake-off. No model or endpoint required:
verifies metric correctness on known inputs and runs the full pipeline end-to-end with the
deterministic lexical backend (which also serves as the quality floor)."""
import math
import os
import unittest

import metrics as M
from bakeoff import run

HERE = os.path.dirname(os.path.abspath(__file__))


class TestMetrics(unittest.TestCase):
    def test_recall_at_k(self):
        self.assertEqual(M.recall_at_k(["a", "b", "c"], ["b"], 5), 1.0)
        self.assertEqual(M.recall_at_k(["a", "b", "c"], ["z"], 2), 0.0)
        self.assertEqual(M.recall_at_k(["a", "b", "c"], ["a", "c"], 2), 0.5)
        self.assertIsNone(M.recall_at_k(["a"], [], 5))

    def test_mrr(self):
        self.assertEqual(M.mrr(["a", "b", "c"], ["b"]), 0.5)
        self.assertEqual(M.mrr(["a", "b"], ["z"]), 0.0)
        self.assertIsNone(M.mrr(["a"], []))

    def test_ndcg(self):
        self.assertAlmostEqual(M.ndcg_at_k(["a", "b"], ["a"], 2), 1.0)
        expected = (1 / math.log2(3)) / (1 / math.log2(2))
        self.assertAlmostEqual(M.ndcg_at_k(["a", "b"], ["b"], 2), expected)

    def test_near_dup(self):
        self.assertEqual(M.near_dup_ok(["gold", "dist"], ["gold"], "dist"), 1.0)
        self.assertEqual(M.near_dup_ok(["dist", "gold"], ["gold"], "dist"), 0.0)
        self.assertIsNone(M.near_dup_ok(["a"], ["a"], None))

    def test_false_positive_rate(self):
        self.assertEqual(M.false_positive_rate([0.9, 0.1], 0.5), 0.5)
        self.assertEqual(M.false_positive_rate([0.1, 0.2], 0.5), 0.0)


class TestPipeline(unittest.TestCase):
    def test_lexical_end_to_end(self):
        corpus = os.path.join(HERE, "corpus")
        result = run(corpus, "lexical", None, None, "x", 10, 2048)
        s = result["summary"]
        for key in ("recall@5", "recall@10", "mrr", "ndcg@10",
                    "false_positive_rate", "near_dup_discrimination"):
            self.assertIn(key, s)
            self.assertIsNotNone(s[key])
        self.assertEqual(s["queries"], 52)
        self.assertEqual(s["documents"], 34)
        self.assertTrue(0.0 <= s["recall@5"] <= 1.0)
        # lexical floor must still retrieve obvious lexically-overlapping matches
        self.assertGreater(s["recall@10"], 0.3)
        # every query type is exercised
        cats = set(r["type"] for r in result["per_query"])
        for expected in ("factual", "code", "config", "near-dup", "long-doc",
                         "multilingual", "false-positive"):
            self.assertIn(expected, cats)
        # manifest records the fingerprint + dimension
        self.assertEqual(len(result["manifest"]["corpus_fingerprint"]), 64)
        self.assertEqual(result["manifest"]["embedding_dim"], 2048)


if __name__ == "__main__":
    unittest.main(verbosity=2)
