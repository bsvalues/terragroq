"""Offline self-test for the embedding bake-off. No model or endpoint required:
verifies metric correctness on known inputs and runs the full pipeline end-to-end with the
deterministic lexical backend (which also serves as the quality floor)."""
import hashlib
import json
import math
import os
import tempfile
import unittest
from unittest import mock

import metrics as M
from bakeoff import corpus_fingerprint, main, reject_secret_fields, run
from embed import _endpoint_batch, cosine, embed_texts, validate_sovereign_base_url
from evidence import build as build_evidence

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
        self.assertEqual(s["queries"], 80)
        self.assertEqual(s["documents"], 49)
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
        ci = s["mrr_ci95"]
        self.assertEqual(len(ci), 2)
        self.assertLessEqual(ci[0], ci[1])
        self.assertEqual(s["calibration_queries"], 14)
        self.assertEqual(s["evaluation_queries"], 66)

    def test_corpus_fingerprint_is_order_independent_and_label_bound(self):
        docs = [{"id": "b", "text": "B"}, {"id": "a", "text": "A"}]
        queries = [{"id": "q01", "type": "factual", "query": "A?", "gold": ["a"]}]
        expected = corpus_fingerprint(docs, queries)
        self.assertEqual(expected, corpus_fingerprint(list(reversed(docs)), queries))
        self.assertNotEqual(expected, corpus_fingerprint(docs, [{**queries[0], "gold": ["b"]}]))

    def test_k_controls_top_k_and_metrics(self):
        corpus = os.path.join(HERE, "corpus")
        result = run(corpus, "lexical", None, None, None, 3, 128)
        self.assertEqual(result["manifest"]["top_k"], 3)
        self.assertTrue(all(len(row["top_k"]) == 3 for row in result["per_query"]))
        self.assertIn("recall@k", result["summary"])

    def test_output_parent_is_created_before_execution(self):
        with tempfile.TemporaryDirectory() as root:
            output = os.path.join(root, "nested", "lexical.json")
            self.assertEqual(main(["--backend", "lexical", "--dim", "128", "--out", output]), 0)
            self.assertTrue(os.path.isfile(output))

    def test_retained_manifests_reject_secret_fields(self):
        with self.assertRaisesRegex(ValueError, "secret-like field"):
            reject_secret_fields({"nested": {"api_token": "must-not-be-retained"}})


class FakeResponse:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.value).encode("utf-8")


class TestEndpointBoundary(unittest.TestCase):
    def test_cosine_rejects_mixed_dimensions(self):
        with self.assertRaisesRegex(ValueError, "dimension mismatch"):
            cosine([1.0, 0.0], [1.0])

    def test_external_endpoint_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "localhost, a single-label fabric host, or a private IP"):
            validate_sovereign_base_url("https://api.example.com/v1")

    def test_endpoint_url_rejects_embedded_credentials(self):
        with self.assertRaisesRegex(ValueError, "must not contain credentials"):
            validate_sovereign_base_url("http://user:secret@aegis:11434/v1")

    def test_response_is_reordered_by_complete_unique_indexes(self):
        response = {"data": [
            {"index": 1, "embedding": [0.0, 2.0]},
            {"index": 0, "embedding": [3.0, 0.0]},
        ]}
        with mock.patch("urllib.request.urlopen", return_value=FakeResponse(response)):
            vectors = _endpoint_batch("http://127.0.0.1:11434/v1", "model", ["a", "b"], None, 1)
        self.assertEqual(vectors, [[1.0, 0.0], [0.0, 1.0]])

    def test_response_rejects_missing_duplicate_mixed_and_nonfinite_rows(self):
        failures = [
            {"data": [{"index": 0, "embedding": [1.0]}]},
            {"data": [{"index": 0, "embedding": [1.0]}, {"index": 0, "embedding": [2.0]}]},
            {"data": [{"index": 0, "embedding": [1.0]}, {"index": 1, "embedding": [1.0, 2.0]}]},
            {"data": [{"index": 0, "embedding": [1.0]}, {"index": 1, "embedding": [float("nan")]}]},
        ]
        for response in failures:
            with self.subTest(response=response):
                with mock.patch("urllib.request.urlopen", return_value=FakeResponse(response)):
                    with self.assertRaises(ValueError):
                        _endpoint_batch("http://aegis:11434/v1", "model", ["a", "b"], None, 1)

    def test_response_rejects_model_drift(self):
        response = {"model": "other", "data": [{"index": 0, "embedding": [1.0]}]}
        with mock.patch("urllib.request.urlopen", return_value=FakeResponse(response)):
            with self.assertRaisesRegex(ValueError, "model does not match"):
                _endpoint_batch("http://aegis:11434/v1", "model", ["a"], None, 1)

    def test_dimension_change_across_batches_is_rejected(self):
        responses = [
            FakeResponse({"data": [{"index": 0, "embedding": [1.0, 0.0]}]}),
            FakeResponse({"data": [{"index": 0, "embedding": [1.0, 0.0, 0.0]}]}),
        ]
        with mock.patch("urllib.request.urlopen", side_effect=responses):
            with self.assertRaisesRegex(ValueError, "dimension changed"):
                embed_texts(["a", "b"], backend="endpoint", base_url="http://aegis:11434/v1",
                            model="model", batch_size=1)


class TestEvidencePackage(unittest.TestCase):
    def test_builds_four_standing_hash_targets(self):
        corpus = os.path.join(HERE, "corpus")
        result = run(corpus, "lexical", None, None, None, 10, 128)
        with tempfile.TemporaryDirectory() as root:
            paths = {name: os.path.join(root, name + ".json")
                     for name in ("result", "model", "runtime", "host")}
            values = {
                "result": result,
                "model": {"model_id": "lexical-floor", "revision": "test"},
                "runtime": {"runtime_id": "python", "version": "test"},
                "host": {"node_id": "test-host", "machine_id_sha256": "0" * 64},
            }
            for name, path in paths.items():
                with open(path, "w", encoding="utf-8") as fh:
                    json.dump(values[name], fh)
            out = os.path.join(root, "evidence")
            targets = build_evidence(corpus, paths["model"], paths["runtime"],
                                     paths["host"], paths["result"], out)
            self.assertEqual([target["artifact"] for target in targets["targets"]], [
                "benchmark_corpus", "model_runtime_manifest", "result_bundle", "evidence_package",
            ])
            for target in targets["targets"]:
                path = os.path.join(out, target["path"])
                with open(path, "rb") as fh:
                    self.assertEqual(hashlib.sha256(fh.read()).hexdigest(), target["sha256"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
