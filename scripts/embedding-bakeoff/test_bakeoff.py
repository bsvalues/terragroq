"""Offline self-test for the embedding bake-off. No model or endpoint required:
verifies metric correctness on known inputs and runs the full pipeline end-to-end with the
deterministic lexical backend (which also serves as the quality floor)."""
import hashlib
import json
import math
import os
import shutil
import tempfile
import unittest
from unittest import mock

import metrics as M
from bakeoff import (corpus_fingerprint, load_jsonl, main, reject_secret_fields, run,
                     validate_corpus_manifest)
from embed import (NoRedirectHandler, _endpoint_batch, cosine, embed_texts,
                   lexical_embed, validate_sovereign_base_url)
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
        self.assertEqual(result["manifest"]["corpus_manifest"]["corpus_id"],
                         "williamos-r1b-adversarial-v1")
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

    def test_corpus_manifest_fails_closed_on_drift(self):
        source = os.path.join(HERE, "corpus")
        with tempfile.TemporaryDirectory() as root:
            corpus = os.path.join(root, "corpus")
            shutil.copytree(source, corpus)
            manifest_path = os.path.join(corpus, "manifest.json")
            with open(manifest_path, encoding="utf-8") as fh:
                manifest = json.load(fh)
            manifest["queries"] += 1
            with open(manifest_path, "w", encoding="utf-8") as fh:
                json.dump(manifest, fh)
            docs = load_jsonl(os.path.join(corpus, "documents.jsonl"))
            queries = load_jsonl(os.path.join(corpus, "queries.jsonl"))
            with self.assertRaisesRegex(ValueError, "manifest does not match"):
                validate_corpus_manifest(corpus, docs, queries)

    def test_k_controls_top_k_and_metrics(self):
        corpus = os.path.join(HERE, "corpus")
        result = run(corpus, "lexical", None, None, None, 3, 128)
        self.assertEqual(result["manifest"]["top_k"], 3)
        self.assertTrue(all(len(row["top_k"]) == 3 for row in result["per_query"]))
        self.assertIn("recall@k", result["summary"])
        self.assertTrue(all(len(row["ranking"]) == 49 for row in result["per_query"]))

    def test_output_parent_is_created_before_execution(self):
        with tempfile.TemporaryDirectory() as root:
            output = os.path.join(root, "nested", "lexical.json")
            self.assertEqual(main(["--backend", "lexical", "--dim", "128", "--out", output]), 0)
            self.assertTrue(os.path.isfile(output))

    def test_retained_manifests_reject_secret_fields(self):
        for field in ("api_token", "token", "session_token", "refreshToken", "authorization",
                      "github_token", "service_token", "deploymentToken"):
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, "secret-like field"):
                    reject_secret_fields({"nested": {field: "must-not-be-retained"}})
        reject_secret_fields({"tokenizer_sha256": "safe-model-provenance"})


class FakeResponse:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.value).encode("utf-8")


class FakeOpener:
    def __init__(self, responses):
        self.responses = list(responses)

    def open(self, _request, timeout=None):
        del timeout
        return self.responses.pop(0)


class TestEndpointBoundary(unittest.TestCase):
    def test_cosine_rejects_mixed_dimensions(self):
        with self.assertRaisesRegex(ValueError, "dimension mismatch"):
            cosine([1.0, 0.0], [1.0])

    def test_external_endpoint_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "literal private/loopback IP"):
            validate_sovereign_base_url("https://api.example.com/v1")

    def test_single_label_endpoint_is_rejected_and_private_literal_is_allowed(self):
        with self.assertRaisesRegex(ValueError, "literal private/loopback IP"):
            validate_sovereign_base_url("http://aegis:11434/v1")
        with self.assertRaisesRegex(ValueError, "literal private/loopback IP"):
            validate_sovereign_base_url("http://localhost:11434/v1")
        validate_sovereign_base_url("http://127.0.0.1:11434/v1")
        validate_sovereign_base_url("http://10.0.0.158:11434/v1")

    def test_endpoint_url_rejects_embedded_credentials(self):
        with self.assertRaisesRegex(ValueError, "must not contain credentials"):
            validate_sovereign_base_url("http://user:secret@aegis:11434/v1")

    def test_response_is_reordered_by_complete_unique_indexes(self):
        response = {"model": "model", "data": [
            {"index": 1, "embedding": [0.0, 2.0]},
            {"index": 0, "embedding": [3.0, 0.0]},
        ]}
        with mock.patch("urllib.request.build_opener", return_value=FakeOpener([FakeResponse(response)])):
            vectors = _endpoint_batch("http://127.0.0.1:11434/v1", "model", ["a", "b"], None, 1)
        self.assertEqual(vectors, [[1.0, 0.0], [0.0, 1.0]])

    def test_response_rejects_missing_duplicate_mixed_and_nonfinite_rows(self):
        failures = [
            {"model": "model", "data": [{"index": 0, "embedding": [1.0]}]},
            {"model": "model", "data": [{"index": 0, "embedding": [1.0]}, {"index": 0, "embedding": [2.0]}]},
            {"model": "model", "data": [{"index": 0, "embedding": [1.0]}, {"index": 1, "embedding": [1.0, 2.0]}]},
            {"model": "model", "data": [{"index": 0, "embedding": [1.0]}, {"index": 1, "embedding": [float("nan")]}]},
        ]
        for response in failures:
            with self.subTest(response=response):
                with mock.patch("urllib.request.build_opener", return_value=FakeOpener([FakeResponse(response)])):
                    with self.assertRaises(ValueError):
                        _endpoint_batch("http://10.0.0.158:11434/v1", "model", ["a", "b"], None, 1)

    def test_response_rejects_model_drift(self):
        response = {"model": "other", "data": [{"index": 0, "embedding": [1.0]}]}
        with mock.patch("urllib.request.build_opener", return_value=FakeOpener([FakeResponse(response)])):
            with self.assertRaisesRegex(ValueError, "model does not match"):
                _endpoint_batch("http://10.0.0.158:11434/v1", "model", ["a"], None, 1)

    def test_response_requires_model_identity(self):
        response = {"data": [{"index": 0, "embedding": [1.0]}]}
        with mock.patch("urllib.request.build_opener", return_value=FakeOpener([FakeResponse(response)])):
            with self.assertRaisesRegex(ValueError, "model does not match"):
                _endpoint_batch("http://10.0.0.158:11434/v1", "model", ["a"], None, 1)

    def test_redirect_handler_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "redirects are forbidden"):
            NoRedirectHandler().redirect_request(None, None, 302, "Found", {}, "https://example.com")

    def test_dimension_change_across_batches_is_rejected(self):
        responses = [
            FakeResponse({"model": "model", "data": [{"index": 0, "embedding": [1.0, 0.0]}]}),
            FakeResponse({"model": "model", "data": [{"index": 0, "embedding": [1.0, 0.0, 0.0]}]}),
        ]
        with mock.patch("urllib.request.build_opener", return_value=FakeOpener(responses)):
            with self.assertRaisesRegex(ValueError, "dimension changed"):
                embed_texts(["a", "b"], backend="endpoint", base_url="http://10.0.0.158:11434/v1",
                            model="model", batch_size=1)


class TestEvidencePackage(unittest.TestCase):
    def make_valid_run(self, root):
        corpus = os.path.join(HERE, "corpus")
        paths = {name: os.path.join(root, name + ".json")
                 for name in ("result", "model", "runtime", "host")}
        values = {
            "model": {
                "schema_version": "1", "model_id": "test-model", "revision": "exact",
                "weights_sha256": "1" * 64, "license": "Apache-2.0", "source": "fixture",
                "dimension": 128,
            },
            "runtime": {
                "schema_version": "1", "runtime_id": "fixture", "version": "1",
                "executable_sha256": "2" * 64, "endpoint_contract": "openai-embeddings-v1",
            },
            "host": {
                "schema_version": "1", "node_id": "aegis", "machine_id_sha256": "3" * 64,
                "inventory_snapshot_sha256": "4" * 64, "topology_id": "cpu-only",
                "endpoint_hosts": ["10.0.0.158"],
            },
        }
        for name in ("model", "runtime", "host"):
            with open(paths[name], "w", encoding="utf-8") as fh:
                json.dump(values[name], fh)
        with mock.patch("bakeoff.embed_texts",
                        side_effect=lambda texts, **_kwargs: [lexical_embed(text, 128) for text in texts]):
            result = run(corpus, "endpoint", "http://10.0.0.158:11434/v1", "test-model", None, 10, 128,
                         paths["model"], paths["runtime"], paths["host"])
        with open(paths["result"], "w", encoding="utf-8") as fh:
            json.dump(result, fh)
        return corpus, paths, result

    def test_builds_four_standing_hash_targets(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, _result = self.make_valid_run(root)
            out = os.path.join(root, "evidence")
            targets = build_evidence(corpus, paths["model"], paths["runtime"], paths["host"], paths["result"], out)
            self.assertEqual([target["artifact"] for target in targets["targets"]], [
                "benchmark_corpus", "model_runtime_manifest", "result_bundle", "evidence_package",
            ])
            for target in targets["targets"]:
                path = os.path.join(targets["generation_path"], target["path"])
                with open(path, "rb") as fh:
                    self.assertEqual(hashlib.sha256(fh.read()).hexdigest(), target["sha256"])
            package_path = os.path.join(targets["generation_path"], "evidence-package.json")
            with open(package_path, encoding="utf-8") as fh:
                package = json.load(fh)
            self.assertEqual(package["evidence_class"],
                             "INTEGRITY_ONLY_NOT_EXECUTION_ATTESTATION")
            self.assertFalse(package["attestation"]["execution_attested"])
            self.assertEqual(package["attestation"]["external_provider_status"],
                             "NOT_INDEPENDENTLY_ATTESTED")
            self.assertNotIn("external_provider_used", package["safety"])
            self.assertEqual(targets["verification_scope"], "BYTE_INTEGRITY_ONLY")
            self.assertEqual(targets["execution_provenance_status"], "NOT_ATTESTED")

    def test_fabricated_result_is_rejected_without_partial_generation(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, result = self.make_valid_run(root)
            out = os.path.join(root, "evidence")
            first = build_evidence(corpus, paths["model"], paths["runtime"], paths["host"], paths["result"], out)
            result["summary"]["mrr"] = 0.0
            with open(paths["result"], "w", encoding="utf-8") as fh:
                json.dump(result, fh)
            with self.assertRaisesRegex(ValueError, "does not match per-query evidence"):
                build_evidence(corpus, paths["model"], paths["runtime"], paths["host"], paths["result"], out)
            generations = os.listdir(os.path.join(out, "generations"))
            self.assertEqual(generations, [first["generation"]])

    def test_external_endpoint_and_false_ranking_or_calibration_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, result = self.make_valid_run(root)
            out = os.path.join(root, "evidence")
            mutations = [
                lambda value: value["manifest"].update({"base_url": "https://api.example.com/v1"}),
                lambda value: value["per_query"][0]["ranking"].__setitem__(0, {
                    **value["per_query"][0]["ranking"][0], "similarity": -1.0,
                }),
                lambda value: value["summary"].update({"fp_calibration": {
                    "gold_queries": 999, "no_gold_queries": 999,
                }}),
                lambda value: value["summary"].update({"fp_threshold_policy": "caller-controlled"}),
            ]
            for mutate in mutations:
                candidate = json.loads(json.dumps(result))
                mutate(candidate)
                with open(paths["result"], "w", encoding="utf-8") as fh:
                    json.dump(candidate, fh)
                with self.assertRaises(ValueError):
                    build_evidence(corpus, paths["model"], paths["runtime"],
                                   paths["host"], paths["result"], out)

    def test_external_endpoint_is_rejected_even_when_caller_manifest_matches(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, result = self.make_valid_run(root)
            with open(paths["host"], encoding="utf-8") as fh:
                host = json.load(fh)
            host["endpoint_hosts"] = ["api.example.com"]
            with open(paths["host"], "w", encoding="utf-8") as fh:
                json.dump(host, fh)
            with open(paths["host"], "rb") as fh:
                host_sha = hashlib.sha256(fh.read()).hexdigest()
            result["manifest"]["base_url"] = "https://api.example.com/v1"
            result["manifest"]["provenance"]["host"] = host
            result["manifest"]["provenance"]["host_manifest_sha256"] = host_sha
            with open(paths["result"], "w", encoding="utf-8") as fh:
                json.dump(result, fh)
            with self.assertRaisesRegex(ValueError, "literal private/loopback IP"):
                build_evidence(corpus, paths["model"], paths["runtime"],
                               paths["host"], paths["result"], os.path.join(root, "evidence"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
