"""Offline self-test for the embedding bake-off. No model or endpoint required:
verifies metric correctness on known inputs and runs the full pipeline end-to-end with the
deterministic lexical backend (which also serves as the quality floor)."""
import base64
import hashlib
import io
import json
import math
import os
import shutil
import sys
import tempfile
import unittest
from types import SimpleNamespace

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import metrics as M
import fabric_measure as F
from bakeoff import (corpus_fingerprint, load_jsonl, main, reject_secret_fields, run,
                     validate_corpus_manifest)
from embed import (cosine, embed_texts, lexical_embed, validate_endpoint_payload,
                   validate_sovereign_base_url)
from evidence import build as build_evidence, canonical_payload

def sha256_path(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


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


class TestEndpointBoundary(unittest.TestCase):
    def test_cosine_rejects_mixed_dimensions(self):
        with self.assertRaisesRegex(ValueError, "dimension mismatch"):
            cosine([1.0, 0.0], [1.0])

    def test_normalization_is_stable_for_large_values_and_rejects_zero(self):
        self.assertEqual(validate_endpoint_payload({
            "model": "model", "data": [{"index": 0, "embedding": [1e308]}],
        }, "model", 1), [[1.0]])
        with self.assertRaisesRegex(ValueError, "zero-norm"):
            validate_endpoint_payload({
                "model": "model", "data": [{"index": 0, "embedding": [0.0]}],
            }, "model", 1)

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

    def test_special_use_endpoint_addresses_are_rejected(self):
        rejected = (
            "169.254.169.254", "0.0.0.0", "192.0.2.1", "224.0.0.1",
            "fe80::1", "::", "::ffff:127.0.0.1",
        )
        for address in rejected:
            with self.subTest(address=address):
                with self.assertRaises(ValueError):
                    validate_sovereign_base_url(f"http://[{address}]:11434/v1"
                                                if ":" in address else f"http://{address}:11434/v1")
        validate_sovereign_base_url("http://[::1]:11434/v1")
        validate_sovereign_base_url("http://[fd00::158]:11434/v1")

    def test_endpoint_url_rejects_embedded_credentials(self):
        with self.assertRaisesRegex(ValueError, "must not contain credentials"):
            validate_sovereign_base_url("http://user:secret@aegis:11434/v1")

    def test_response_is_reordered_by_complete_unique_indexes(self):
        response = {"model": "model", "data": [
            {"index": 1, "embedding": [0.0, 2.0]},
            {"index": 0, "embedding": [3.0, 0.0]},
        ]}
        vectors = validate_endpoint_payload(response, "model", 2)
        self.assertEqual(vectors, [[1.0, 0.0], [0.0, 1.0]])

    def test_response_rejects_missing_duplicate_mixed_and_nonfinite_rows(self):
        failures = [
            {"model": "model", "data": [{"index": 0, "embedding": [1.0]}]},
            {"model": "model", "data": [{"index": 0, "embedding": [1.0]}, {"index": 0, "embedding": [2.0]}]},
            {"model": "model", "data": [{"index": 0, "embedding": [1.0]}, {"index": 1, "embedding": [1.0, 2.0]}]},
            {"model": "model", "data": [{"index": 0, "embedding": [1.0]}, {"index": 1, "embedding": [float("nan")]}]},
            {"model": "model", "data": [{"index": 0, "embedding": [1.0]}, {"index": 1, "embedding": [0.0]}]},
        ]
        for response in failures:
            with self.subTest(response=response):
                with self.assertRaises(ValueError):
                    validate_endpoint_payload(response, "model", 2)

    def test_response_rejects_model_drift(self):
        response = {"model": "other", "data": [{"index": 0, "embedding": [1.0]}]}
        with self.assertRaisesRegex(ValueError, "model does not match"):
            validate_endpoint_payload(response, "model", 1)

    def test_response_requires_model_identity(self):
        response = {"data": [{"index": 0, "embedding": [1.0]}]}
        with self.assertRaisesRegex(ValueError, "model does not match"):
            validate_endpoint_payload(response, "model", 1)

    def test_endpoint_execution_is_disabled_without_trusted_adapter(self):
        with self.assertRaisesRegex(ValueError, "trusted Fabric adapter"):
            embed_texts(["a"], backend="endpoint", base_url="http://10.0.0.158:11434/v1",
                        model="model")

    def test_missing_endpoint_url_is_rejected_cleanly(self):
        with self.assertRaisesRegex(ValueError, "non-empty string"):
            validate_sovereign_base_url(None)

    def test_malformed_endpoint_ports_are_rejected(self):
        for url in ("http://127.0.0.1:notaport/v1", "http://127.0.0.1:65536/v1"):
            with self.subTest(url=url):
                with self.assertRaisesRegex(ValueError, "invalid port"):
                    validate_sovereign_base_url(url)


class TestFabricMeasurementAdapter(unittest.TestCase):
    class FakeResponse:
        def __init__(self, payload, status=200, headers=None):
            self.payload = json.dumps(payload).encode("utf-8")
            self.status = status
            self.headers = headers or {}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, limit):
            return self.payload[:limit]

    def make_envelope(self):
        return {
            "schema_version": "1.0-r1b-fabric-measurement-envelope",
            "model": "test-model",
            "model_manifest": {
                "schema_version": "1", "model_id": "test-model", "revision": "exact",
                "weights_sha256": "1" * 64, "license": "Apache-2.0", "source": "fixture",
                "dimension": 2,
            },
            "runtime_manifest": {
                "schema_version": "1", "runtime_id": "ollama", "version": "1",
                "executable_sha256": "2" * 64, "endpoint_contract": "ollama-embed-v1",
            },
            "host_manifest": {
                "schema_version": "1", "node_id": "hermes-node",
                "machine_id_sha256": "3" * 64,
                "inventory_snapshot_sha256": "4" * 64, "topology_id": "resident",
                "endpoint_hosts": ["127.0.0.1"],
            },
        }

    def test_fabric_measurement_envelope_requires_exact_validated_shape(self):
        envelope = self.make_envelope()
        self.assertIs(F.validate_envelope(envelope), envelope)
        mutations = (
            lambda value: value.update({"extra": True}),
            lambda value: value["model_manifest"].pop("revision"),
            lambda value: value["runtime_manifest"].update({"api_token": "secret"}),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                candidate = json.loads(json.dumps(envelope))
                mutate(candidate)
                with self.assertRaises(ValueError):
                    F.validate_envelope(candidate)

    def test_fabric_measurement_stdin_rejects_non_envelope_fail_closed(self):
        original_stdin, original_stdout, original_stderr = F.sys.stdin, F.sys.stdout, F.sys.stderr
        stdout, stderr = io.StringIO(), io.StringIO()
        try:
            F.sys.stdin = SimpleNamespace(buffer=io.BytesIO(b'{}'))
            F.sys.stdout, F.sys.stderr = stdout, stderr
            self.assertEqual(F.main(), 2)
        finally:
            F.sys.stdin, F.sys.stdout, F.sys.stderr = original_stdin, original_stdout, original_stderr
        self.assertEqual(stdout.getvalue(), "")
        error = json.loads(stderr.getvalue())
        self.assertEqual(error["status"], "FAILED_CLOSED")
        self.assertFalse(error["external_provider_used"])
        self.assertFalse(error["fallback_used"])
        self.assertFalse(error["scheduler_activated"])
        self.assertFalse(error["autonomous_dispatch"])

    def test_fabric_measurement_uses_only_fixed_loopback_route(self):
        captured = []

        def opener(request, timeout):
            captured.append((request, timeout))
            return self.FakeResponse({"model": "test-model", "embeddings": [[3.0, 4.0]]})

        self.assertEqual(F.invoke_fixed_loopback("test-model", ["hello"], opener=opener),
                         [[0.6, 0.8]])
        request, timeout = captured[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:11434/api/embed")
        self.assertEqual(timeout, F.TIMEOUT_SECONDS)
        self.assertEqual(json.loads(request.data), {"model": "test-model", "input": ["hello"]})
        self.assertEqual(request.get_method(), "POST")

    def test_fabric_measurement_converts_ollama_payload_before_validation(self):
        payload = {"model": "test-model", "embeddings": [[2.0, 0.0], [0.0, 5.0]]}
        opener = lambda _request, timeout: self.FakeResponse(payload)
        self.assertEqual(F.invoke_fixed_loopback("test-model", ["a", "b"], opener=opener),
                         [[1.0, 0.0], [0.0, 1.0]])

    def test_fabric_measurement_rejects_embedding_count_drift(self):
        payload = {"model": "test-model", "embeddings": [[1.0, 0.0]]}
        opener = lambda _request, timeout: self.FakeResponse(payload)
        with self.assertRaisesRegex(ValueError, "1 rows for 2 inputs"):
            F.invoke_fixed_loopback("test-model", ["a", "b"], opener=opener)

    def test_fabric_measurement_rejects_dimension_drift_across_batches(self):
        responses = iter((
            {"model": "test-model", "embeddings": [[1.0, 0.0]] * F.BATCH_SIZE},
            {"model": "test-model", "embeddings": [[1.0, 0.0, 0.0]]},
        ))
        opener = lambda _request, timeout: self.FakeResponse(next(responses))
        with self.assertRaisesRegex(ValueError, "dimension changed"):
            F.invoke_fixed_loopback("test-model", ["text"] * (F.BATCH_SIZE + 1), opener=opener)

    def test_fabric_measurement_rejects_model_drift(self):
        payload = {"model": "other-model", "embeddings": [[1.0, 0.0]]}
        opener = lambda _request, timeout: self.FakeResponse(payload)
        with self.assertRaisesRegex(ValueError, "model does not match"):
            F.invoke_fixed_loopback("test-model", ["a"], opener=opener)


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
        result = run(corpus, "lexical", None, "test-model", None, 10, 128)
        result["manifest"].update({
            "backend": "endpoint",
            "base_url": "http://10.0.0.158:11434/v1",
            "provenance": {
                "model": values["model"],
                "model_manifest_sha256": sha256_path(paths["model"]),
                "runtime": values["runtime"],
                "runtime_manifest_sha256": sha256_path(paths["runtime"]),
                "host": values["host"],
                "host_manifest_sha256": sha256_path(paths["host"]),
            },
        })
        with open(paths["result"], "w", encoding="utf-8") as fh:
            json.dump(result, fh)
        return corpus, paths, result

    def make_attestation(self, root, corpus, paths, result):
        with open(paths["model"], encoding="utf-8") as fh:
            model = json.load(fh)
        with open(paths["runtime"], encoding="utf-8") as fh:
            runtime = json.load(fh)
        with open(paths["host"], encoding="utf-8") as fh:
            host = json.load(fh)
        identity = {
            "host": {
                "node_id": host["node_id"],
                "machine_id_sha256": host["machine_id_sha256"],
                "inventory_snapshot_sha256": host["inventory_snapshot_sha256"],
                "topology_id": host["topology_id"],
            },
            "model": {
                "model_id": model["model_id"],
                "revision": model["revision"],
                "weights_sha256": model["weights_sha256"],
            },
            "runtime": {
                "runtime_id": runtime["runtime_id"],
                "version": runtime["version"],
                "executable_sha256": runtime["executable_sha256"],
            },
        }
        attestation = {
            "schema_version": "1.0-r1b-software-execution-attestation",
            "attestation_type": "SOFTWARE_ROOTED_EXECUTION_ATTESTATION",
            "work_order_id": "WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1",
            "artifact_bindings": {
                "corpus_manifest": result["manifest"]["corpus_manifest"],
                "corpus_fingerprint": result["manifest"]["corpus_fingerprint"],
                "corpus_files": result["manifest"]["corpus_files"],
                "result_bundle_sha256": hashlib.sha256(canonical_payload(result)).hexdigest(),
                "model_manifest_sha256": sha256_path(paths["model"]),
                "runtime_manifest_sha256": sha256_path(paths["runtime"]),
                "host_manifest_sha256": sha256_path(paths["host"]),
            },
            "admission": {
                "status": "ADMITTED",
                "authority_id": "authority-704",
                "scope_id": "scope-embedding-bakeoff",
                "placement_id": "placement-aegis",
                "request_id": "request-704-001",
                "claim_id": "claim-704-001",
                "lease_id": "lease-704-001",
            },
            "execution": {
                "root_of_trust": "SOFTWARE",
                "provider": "LOCAL_SOFTWARE_ROOTED",
                "external_provider_used": False,
                "fallback_used": False,
                "scheduler_state": "disabled",
                "pre_execution": identity,
                "post_execution": json.loads(json.dumps(identity)),
            },
            "chronology": {
                "authority_issued_at": "2026-08-12T18:00:00Z",
                "request_admitted_at": "2026-08-12T18:01:00Z",
                "lease_acquired_at": "2026-08-12T18:02:00Z",
                "execution_started_at": "2026-08-12T18:03:00Z",
                "execution_completed_at": "2026-08-12T18:04:00Z",
                "attested_at": "2026-08-12T18:05:00Z",
                "authority_expires_at": "2026-08-12T19:00:00Z",
            },
        }
        path = os.path.join(root, "execution-attestation.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(attestation, fh)
        return path, attestation

    def write_attestation(self, path, value):
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(value, fh)

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

    def test_valid_execution_attestation_promotes_truthful_package_flags(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, result = self.make_valid_run(root)
            attestation_path, attestation = self.make_attestation(root, corpus, paths, result)
            targets = build_evidence(
                corpus, paths["model"], paths["runtime"], paths["host"], paths["result"],
                os.path.join(root, "evidence"), attestation_path,
            )
            with open(os.path.join(targets["generation_path"], "evidence-package.json"),
                      encoding="utf-8") as fh:
                package = json.load(fh)
            embedded = package["execution_attestation"]
            canonical = canonical_payload(attestation)
            self.assertEqual(base64.b64decode(embedded["canonical_bytes_base64"]), canonical)
            self.assertEqual(embedded["sha256"], hashlib.sha256(canonical).hexdigest())
            self.assertEqual(package["evidence_class"],
                             "SOFTWARE_ROOTED_EXECUTION_ATTESTATION")
            self.assertTrue(package["attestation"]["execution_attested"])
            self.assertTrue(package["attestation"]["host_identity_attested"])
            self.assertTrue(package["attestation"]["model_weights_attested"])
            self.assertTrue(package["attestation"]["runtime_attested"])
            self.assertFalse(package["attestation"]["declared_manifests_only"])
            self.assertEqual(targets["execution_provenance_status"],
                             "SOFTWARE_ROOTED_ATTESTED")

    def test_attestation_rejects_result_and_manifest_mismatch(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, result = self.make_valid_run(root)
            attestation_path, original = self.make_attestation(root, corpus, paths, result)
            mutations = (
                ("result bundle", lambda value: value["artifact_bindings"].update({
                    "result_bundle_sha256": "0" * 64,
                })),
                ("manifest", lambda value: value["artifact_bindings"].update({
                    "model_manifest_sha256": "0" * 64,
                })),
            )
            for label, mutate in mutations:
                with self.subTest(label=label):
                    candidate = json.loads(json.dumps(original))
                    mutate(candidate)
                    self.write_attestation(attestation_path, candidate)
                    with self.assertRaisesRegex(ValueError, "artifact bindings do not match"):
                        build_evidence(corpus, paths["model"], paths["runtime"], paths["host"],
                                       paths["result"], os.path.join(root, "evidence"),
                                       attestation_path)

    def test_attestation_rejects_missing_fields(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, result = self.make_valid_run(root)
            attestation_path, attestation = self.make_attestation(root, corpus, paths, result)
            del attestation["admission"]["lease_id"]
            self.write_attestation(attestation_path, attestation)
            with self.assertRaisesRegex(ValueError, "admission must contain exactly"):
                build_evidence(corpus, paths["model"], paths["runtime"], paths["host"],
                               paths["result"], os.path.join(root, "evidence"), attestation_path)

    def test_attestation_rejects_secret_fields(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, result = self.make_valid_run(root)
            attestation_path, attestation = self.make_attestation(root, corpus, paths, result)
            attestation["admission"]["api_token"] = "must-not-be-retained"
            self.write_attestation(attestation_path, attestation)
            with self.assertRaisesRegex(ValueError, "secret-like field"):
                build_evidence(corpus, paths["model"], paths["runtime"], paths["host"],
                               paths["result"], os.path.join(root, "evidence"), attestation_path)

    def test_attestation_rejects_external_provider_and_fallback(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, result = self.make_valid_run(root)
            attestation_path, original = self.make_attestation(root, corpus, paths, result)
            mutations = (
                ("external", lambda value: value["execution"].update({
                    "external_provider_used": True,
                })),
                ("fallback", lambda value: value["execution"].update({"fallback_used": True})),
            )
            for label, mutate in mutations:
                with self.subTest(label=label):
                    candidate = json.loads(json.dumps(original))
                    mutate(candidate)
                    self.write_attestation(attestation_path, candidate)
                    with self.assertRaisesRegex(ValueError, "forbids"):
                        build_evidence(corpus, paths["model"], paths["runtime"], paths["host"],
                                       paths["result"], os.path.join(root, "evidence"),
                                       attestation_path)

    def test_attestation_rejects_scheduler(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, result = self.make_valid_run(root)
            attestation_path, attestation = self.make_attestation(root, corpus, paths, result)
            attestation["execution"]["scheduler_state"] = "enabled"
            self.write_attestation(attestation_path, attestation)
            with self.assertRaisesRegex(ValueError, "scheduler_state disabled"):
                build_evidence(corpus, paths["model"], paths["runtime"], paths["host"],
                               paths["result"], os.path.join(root, "evidence"), attestation_path)

    def test_attestation_rejects_identity_drift(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, result = self.make_valid_run(root)
            attestation_path, attestation = self.make_attestation(root, corpus, paths, result)
            attestation["execution"]["post_execution"]["model"]["model_id"] = "drifted"
            self.write_attestation(attestation_path, attestation)
            with self.assertRaisesRegex(ValueError, "pre/post identity"):
                build_evidence(corpus, paths["model"], paths["runtime"], paths["host"],
                               paths["result"], os.path.join(root, "evidence"), attestation_path)

    def test_attestation_rejects_stale_or_invalid_chronology(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, result = self.make_valid_run(root)
            attestation_path, original = self.make_attestation(root, corpus, paths, result)
            mutations = (
                ("out-of-order", lambda value: value["chronology"].update({
                    "execution_started_at": "2026-08-12T18:04:30Z",
                })),
                ("expired", lambda value: value["chronology"].update({
                    "authority_expires_at": "2026-08-12T18:03:30Z",
                })),
            )
            for label, mutate in mutations:
                with self.subTest(label=label):
                    candidate = json.loads(json.dumps(original))
                    mutate(candidate)
                    self.write_attestation(attestation_path, candidate)
                    with self.assertRaisesRegex(ValueError, "stale or out of order"):
                        build_evidence(corpus, paths["model"], paths["runtime"], paths["host"],
                                       paths["result"], os.path.join(root, "evidence"),
                                       attestation_path)

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
                lambda value: value["manifest"]["corpus_files"].update({
                    "documents_sha256": "0" * 64,
                }),
            ]
            for mutate in mutations:
                candidate = json.loads(json.dumps(result))
                mutate(candidate)
                with open(paths["result"], "w", encoding="utf-8") as fh:
                    json.dump(candidate, fh)
                with self.assertRaises(ValueError):
                    build_evidence(corpus, paths["model"], paths["runtime"],
                                   paths["host"], paths["result"], out)

    def test_incomplete_runtime_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            corpus, paths, result = self.make_valid_run(root)
            with open(paths["runtime"], "w", encoding="utf-8") as fh:
                json.dump({}, fh)
            result["manifest"]["provenance"]["runtime"] = {}
            result["manifest"]["provenance"]["runtime_manifest_sha256"] = sha256_path(paths["runtime"])
            with open(paths["result"], "w", encoding="utf-8") as fh:
                json.dump(result, fh)
            with self.assertRaisesRegex(ValueError, "runtime manifest missing required fields"):
                build_evidence(corpus, paths["model"], paths["runtime"], paths["host"],
                               paths["result"], os.path.join(root, "evidence"))

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
