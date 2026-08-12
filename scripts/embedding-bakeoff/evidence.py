#!/usr/bin/env python3
"""Build immutable R1B evidence generations for standing HASH_VERIFY."""
import argparse
import base64
import datetime
import hashlib
import json
import math
import os
import re
import shutil
import tempfile
import urllib.parse

import metrics as M
from bakeoff import (CALIBRATION_QUERY_IDS, canonical_json_bytes, corpus_fingerprint,
                     load_jsonl, load_manifest, reject_secret_fields, validate_corpus,
                     validate_corpus_manifest)
from embed import validate_sovereign_base_url


def canonical_payload(value):
    return canonical_json_bytes(value) + b"\n"


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def close_enough(left, right):
    if left is None or right is None:
        return left is right
    return math.isclose(left, right, rel_tol=1e-12, abs_tol=1e-12)


def require_exact_object(value, fields, label):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ValueError(f"execution attestation {label} must contain exactly: {', '.join(fields)}")
    return value


def require_identity(value, label):
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise ValueError(f"execution attestation {label} must be a non-empty identity")
    if any(ord(char) < 0x20 for char in value):
        raise ValueError(f"execution attestation {label} contains control characters")


def parse_utc_timestamp(value, label):
    pattern = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z"
    if not isinstance(value, str) or re.fullmatch(pattern, value) is None:
        raise ValueError(f"execution attestation {label} must be an ISO-8601 UTC timestamp")
    try:
        parsed = datetime.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as error:
        raise ValueError(
            f"execution attestation {label} must be an ISO-8601 UTC timestamp"
        ) from error
    if parsed.tzinfo != datetime.timezone.utc:
        raise ValueError(f"execution attestation {label} must be UTC")
    return parsed


def validate_execution_attestation(attestation, corpus_manifest, corpus_sha, result_sha,
                                   model, runtime, host, model_sha, runtime_sha, host_sha):
    """Validate the closed, secret-free software-rooted execution statement."""
    root_fields = (
        "schema_version", "attestation_type", "work_order_id", "artifact_bindings",
        "admission", "execution", "chronology",
    )
    require_exact_object(attestation, root_fields, "root")
    reject_secret_fields(attestation, "execution attestation")
    if attestation["schema_version"] != "1.0-r1b-software-execution-attestation":
        raise ValueError("execution attestation schema_version is unsupported")
    if attestation["attestation_type"] != "SOFTWARE_ROOTED_EXECUTION_ATTESTATION":
        raise ValueError("execution attestation type is unsupported")
    if attestation["work_order_id"] != "WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1":
        raise ValueError("execution attestation work order does not match")

    binding_fields = (
        "corpus_manifest", "corpus_fingerprint", "corpus_files",
        "result_bundle_sha256", "model_manifest_sha256",
        "runtime_manifest_sha256", "host_manifest_sha256",
    )
    bindings = require_exact_object(attestation["artifact_bindings"], binding_fields,
                                    "artifact_bindings")
    expected_bindings = {
        "corpus_manifest": corpus_manifest,
        "corpus_fingerprint": corpus_sha,
        "corpus_files": {
            "documents_sha256": corpus_manifest["documents_sha256"],
            "queries_sha256": corpus_manifest["queries_sha256"],
        },
        "result_bundle_sha256": result_sha,
        "model_manifest_sha256": model_sha,
        "runtime_manifest_sha256": runtime_sha,
        "host_manifest_sha256": host_sha,
    }
    if bindings != expected_bindings:
        raise ValueError("execution attestation artifact bindings do not match validated evidence")

    admission_fields = (
        "status", "authority_id", "scope_id", "placement_id", "request_id", "claim_id",
        "lease_id",
    )
    admission = require_exact_object(attestation["admission"], admission_fields, "admission")
    if admission["status"] != "ADMITTED":
        raise ValueError("execution attestation admission status must be ADMITTED")
    for field in admission_fields[1:]:
        require_identity(admission[field], f"admission.{field}")

    model_identity = {
        "model_id": model["model_id"],
        "revision": model["revision"],
        "weights_sha256": model["weights_sha256"],
    }
    runtime_identity = {
        "runtime_id": runtime["runtime_id"],
        "version": runtime["version"],
        "executable_sha256": runtime["executable_sha256"],
    }
    host_identity = {
        "node_id": host["node_id"],
        "machine_id_sha256": host["machine_id_sha256"],
        "inventory_snapshot_sha256": host["inventory_snapshot_sha256"],
        "topology_id": host["topology_id"],
    }
    execution_fields = (
        "root_of_trust", "provider", "external_provider_used", "fallback_used",
        "scheduler_state", "pre_execution", "post_execution",
    )
    execution = require_exact_object(attestation["execution"], execution_fields, "execution")
    if execution["root_of_trust"] != "SOFTWARE":
        raise ValueError("execution attestation root_of_trust must be SOFTWARE")
    if execution["provider"] != "LOCAL_SOFTWARE_ROOTED":
        raise ValueError("execution attestation provider must be LOCAL_SOFTWARE_ROOTED")
    if execution["external_provider_used"] is not False:
        raise ValueError("execution attestation forbids external providers")
    if execution["fallback_used"] is not False:
        raise ValueError("execution attestation forbids fallback execution")
    if execution["scheduler_state"] != "disabled":
        raise ValueError("execution attestation requires scheduler_state disabled")
    identity_fields = ("host", "model", "runtime")
    expected_identity = {
        "host": host_identity,
        "model": model_identity,
        "runtime": runtime_identity,
    }
    pre = require_exact_object(execution["pre_execution"], identity_fields,
                               "execution.pre_execution")
    post = require_exact_object(execution["post_execution"], identity_fields,
                                "execution.post_execution")
    if pre != expected_identity or post != expected_identity or pre != post:
        raise ValueError("execution attestation pre/post identity does not match supplied manifests")

    chronology_fields = (
        "authority_issued_at", "request_admitted_at", "lease_acquired_at",
        "execution_started_at", "execution_completed_at", "attested_at",
        "authority_expires_at",
    )
    chronology = require_exact_object(attestation["chronology"], chronology_fields, "chronology")
    ordered = [parse_utc_timestamp(chronology[field], f"chronology.{field}")
               for field in chronology_fields]
    if any(left > right for left, right in zip(ordered, ordered[1:])):
        raise ValueError("execution attestation chronology is stale or out of order")

    return canonical_payload(attestation)


def validate_result(result, docs, queries, corpus_manifest, model, runtime, host,
                    model_sha, runtime_sha, host_sha):
    if not isinstance(result, dict):
        raise ValueError("result bundle must be a JSON object")
    reject_secret_fields(result, "result")
    summary = result.get("summary")
    manifest = result.get("manifest")
    rows = result.get("per_query")
    if not isinstance(summary, dict) or not isinstance(manifest, dict) or not isinstance(rows, list):
        raise ValueError("result bundle requires summary, manifest, and per_query")
    if manifest.get("backend") != "endpoint":
        raise ValueError("standing evidence is only valid for an admitted endpoint model run")
    if manifest.get("model") != model.get("model_id"):
        raise ValueError("result model does not match the model manifest")
    base_url = manifest.get("base_url")
    validate_sovereign_base_url(base_url)
    endpoint_host = (urllib.parse.urlparse(base_url).hostname or "").lower() if isinstance(base_url, str) else ""
    if endpoint_host not in {str(value).lower() for value in host.get("endpoint_hosts", [])}:
        raise ValueError("result endpoint host is not bound by the host manifest")
    if manifest.get("corpus_fingerprint") != corpus_fingerprint(docs, queries):
        raise ValueError("result bundle corpus fingerprint does not match the frozen corpus")
    expected_corpus_files = {
        "documents_sha256": corpus_manifest["documents_sha256"],
        "queries_sha256": corpus_manifest["queries_sha256"],
    }
    if manifest.get("corpus_files") != expected_corpus_files:
        raise ValueError("result bundle corpus file hashes do not match the frozen corpus")
    if manifest.get("corpus_manifest") != corpus_manifest:
        raise ValueError("result bundle corpus manifest does not match the frozen corpus")
    expected_vector_contract = {
        "input_preprocessing": "utf8-text-as-recorded-no-prefix-v1",
        "normalization": "l2",
        "metric": "cosine",
        "chunking": "frozen-corpus-chunks-v1",
    }
    if manifest.get("vector_contract") != expected_vector_contract:
        raise ValueError("result vector contract is missing or changed")
    dimension = manifest.get("embedding_dim")
    if isinstance(dimension, bool) or not isinstance(dimension, int) or dimension <= 0:
        raise ValueError("result embedding dimension must be a positive integer")
    if model.get("dimension") is not None and model["dimension"] != dimension:
        raise ValueError("result embedding dimension does not match the model manifest")
    provenance = manifest.get("provenance", {})
    expected_provenance = {
        "model": model,
        "model_manifest_sha256": model_sha,
        "runtime": runtime,
        "runtime_manifest_sha256": runtime_sha,
        "host": host,
        "host_manifest_sha256": host_sha,
    }
    if provenance != expected_provenance:
        raise ValueError("result provenance does not exactly match supplied manifests")
    timing = manifest.get("timing", {})
    for field in ("documents_seconds", "queries_seconds", "documents_per_second", "queries_per_second"):
        value = timing.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            raise ValueError(f"result timing {field} is invalid")

    queries_by_id = {query["id"]: query for query in queries}
    docs_by_id = {doc["id"] for doc in docs}
    top_k_size = manifest.get("top_k")
    if isinstance(top_k_size, bool) or not isinstance(top_k_size, int) or not 0 < top_k_size <= len(docs):
        raise ValueError("result top_k is invalid")
    if len(rows) != len(queries) or {row.get("id") for row in rows} != set(queries_by_id):
        raise ValueError("result must contain exactly one row for every frozen query")
    for row in rows:
        query = queries_by_id[row["id"]]
        expected_split = "calibration" if row["id"] in CALIBRATION_QUERY_IDS else "evaluation"
        if row.get("type") != query["type"] or row.get("gold") != query["gold"] or row.get("split") != expected_split:
            raise ValueError(f"result row {row['id']} does not match frozen labels and split")
        ranking = row.get("ranking")
        if not isinstance(ranking, list) or len(ranking) != len(docs):
            raise ValueError(f"result row {row['id']} must retain the full ranking")
        ranked_ids = []
        for ranked in ranking:
            if not isinstance(ranked, dict) or set(ranked) != {"id", "similarity"}:
                raise ValueError(f"result row {row['id']} has malformed ranking evidence")
            similarity = ranked["similarity"]
            if (isinstance(similarity, bool) or not isinstance(similarity, (int, float)) or
                    not math.isfinite(similarity) or not -1.000001 <= similarity <= 1.000001):
                raise ValueError(f"result row {row['id']} has invalid similarity evidence")
            ranked_ids.append(ranked["id"])
        if len(set(ranked_ids)) != len(docs) or set(ranked_ids) != docs_by_id:
            raise ValueError(f"result row {row['id']} ranking is not a document permutation")
        similarities = [ranked["similarity"] for ranked in ranking]
        if any(left < right for left, right in zip(similarities, similarities[1:])):
            raise ValueError(f"result row {row['id']} ranking is not ordered by similarity")
        top_k = row.get("top_k")
        if top_k != ranked_ids[:top_k_size]:
            raise ValueError(f"result row {row['id']} has invalid top_k")
        expected_row = {
            "top1_sim": round(ranking[0]["similarity"], 6),
            "recall@5": M.recall_at_k(ranked_ids, query["gold"], 5),
            "recall@10": M.recall_at_k(ranked_ids, query["gold"], 10),
            "recall@k": M.recall_at_k(ranked_ids, query["gold"], top_k_size),
            "mrr": M.mrr(ranked_ids, query["gold"]),
            "ndcg@10": M.ndcg_at_k(ranked_ids, query["gold"], 10),
            "ndcg@k": M.ndcg_at_k(ranked_ids, query["gold"], top_k_size),
            "near_dup_ok": M.near_dup_ok(ranked_ids, query["gold"], query.get("distractor")),
        }
        for field, expected in expected_row.items():
            if not close_enough(row.get(field), expected):
                raise ValueError(f"result row {row['id']} {field} does not match ranking evidence")

    evaluated = [row for row in rows if row["split"] == "evaluation"]
    calibration_gold = [row["top1_sim"] for row in rows
                        if row["split"] == "calibration" and row["gold"]]
    calibration_no_gold = [row["top1_sim"] for row in rows
                           if row["split"] == "calibration" and not row["gold"]]
    evaluation_no_gold = [row["top1_sim"] for row in evaluated if not row["gold"]]
    gold_midpoint = M.median(calibration_gold) or 0.0
    no_gold_ceiling = max(calibration_no_gold, default=0.0)
    threshold = ((gold_midpoint + no_gold_ceiling) / 2.0
                 if gold_midpoint > no_gold_ceiling else gold_midpoint)
    by_type = {}
    for row in evaluated:
        by_type.setdefault(row["type"], []).append(row)
    recomputed = {
        "recall@5": M.mean([row["recall@5"] for row in evaluated]),
        "recall@10": M.mean([row["recall@10"] for row in evaluated]),
        "recall@k": M.mean([row["recall@k"] for row in evaluated]),
        "mrr": M.mean([row["mrr"] for row in evaluated]),
        "ndcg@10": M.mean([row["ndcg@10"] for row in evaluated]),
        "ndcg@k": M.mean([row["ndcg@k"] for row in evaluated]),
        "near_dup_discrimination": M.mean([row.get("near_dup_ok") for row in evaluated]),
        "false_positive_rate": M.false_positive_rate(evaluation_no_gold, threshold),
        "fp_threshold": round(threshold, 6),
        "mrr_ci95": M.bootstrap_ci([row["mrr"] for row in evaluated]),
        "ndcg@10_ci95": M.bootstrap_ci([row["ndcg@10"] for row in evaluated]),
        "per_category_recall@5": {
            query_type: M.mean([row["recall@5"] for row in typed_rows])
            for query_type, typed_rows in sorted(by_type.items())
        },
        "fp_calibration": {
            "gold_queries": len(calibration_gold),
            "no_gold_queries": len(calibration_no_gold),
        },
    }
    for field, expected in recomputed.items():
        actual = summary.get(field)
        if isinstance(expected, (dict, list)):
            matches = actual == expected
        else:
            matches = close_enough(actual, expected)
        if not matches:
            raise ValueError(f"result summary {field} does not match per-query evidence")
    if summary.get("fp_threshold_policy") != "midpoint of fixed-split median gold and max no-gold when separable; otherwise median gold":
        raise ValueError("result summary fp_threshold_policy does not match the frozen policy")
    if (summary.get("queries") != len(queries) or summary.get("documents") != len(docs) or
            summary.get("evaluation_queries") != len(evaluated) or
            summary.get("calibration_queries") != len(queries) - len(evaluated)):
        raise ValueError("result summary corpus counts do not match the frozen corpus")


def write_generation(out_dir, generation, artifacts):
    generations = os.path.join(out_dir, "generations")
    os.makedirs(generations, exist_ok=True)
    destination = os.path.join(generations, generation)
    if os.path.exists(destination):
        for name, payload in artifacts.items():
            with open(os.path.join(destination, name), "rb") as fh:
                if fh.read() != payload:
                    raise ValueError("existing immutable evidence generation does not match")
        return destination
    staging = tempfile.mkdtemp(prefix=".r1b-generation-", dir=generations)
    try:
        for name, payload in artifacts.items():
            path = os.path.join(staging, name)
            with open(path, "wb") as fh:
                fh.write(payload)
                fh.flush()
                os.fsync(fh.fileno())
        os.replace(staging, destination)
    finally:
        if os.path.exists(staging):
            shutil.rmtree(staging)
    return destination


def build(corpus_dir, model_manifest_path, runtime_manifest_path, host_manifest_path,
          result_path, out_dir, execution_attestation_path=None):
    docs_path = os.path.join(corpus_dir, "documents.jsonl")
    queries_path = os.path.join(corpus_dir, "queries.jsonl")
    docs = load_jsonl(docs_path)
    queries = load_jsonl(queries_path)
    validate_corpus(docs, queries)
    corpus_manifest = validate_corpus_manifest(corpus_dir, docs, queries)
    model = load_manifest(model_manifest_path,
        ("schema_version", "model_id", "revision", "weights_sha256", "license", "source"), "model")
    runtime = load_manifest(runtime_manifest_path,
        ("schema_version", "runtime_id", "version", "executable_sha256", "endpoint_contract"), "runtime")
    host = load_manifest(host_manifest_path,
        ("schema_version", "node_id", "machine_id_sha256", "inventory_snapshot_sha256", "topology_id", "endpoint_hosts"), "host")
    result = load_json(result_path)
    for name, value in (("model", model), ("runtime", runtime), ("host", host)):
        reject_secret_fields(value, name)

    model_sha = sha256_file(model_manifest_path)
    runtime_sha = sha256_file(runtime_manifest_path)
    host_sha = sha256_file(host_manifest_path)
    validate_result(result, docs, queries, corpus_manifest, model, runtime, host,
                    model_sha, runtime_sha, host_sha)

    corpus_bundle = {
        "schema_version": "1.0-r1b-corpus-bundle",
        "corpus_fingerprint": corpus_fingerprint(docs, queries),
        "corpus_manifest": corpus_manifest,
        "documents": docs,
        "queries": queries,
        "source_file_sha256": {
            "documents": sha256_file(docs_path),
            "queries": sha256_file(queries_path),
        },
    }
    model_runtime = {
        "schema_version": "1.0-r1b-model-runtime-manifest",
        "model": model,
        "model_manifest_sha256": model_sha,
        "runtime": runtime,
        "runtime_manifest_sha256": runtime_sha,
    }
    payloads = {
        "corpus-bundle.json": canonical_payload(corpus_bundle),
        "model-runtime-manifest.json": canonical_payload(model_runtime),
        "result-bundle.json": canonical_payload(result),
    }
    attestation_bytes = None
    if execution_attestation_path is not None:
        attestation_bytes = validate_execution_attestation(
            load_json(execution_attestation_path), corpus_manifest,
            corpus_bundle["corpus_fingerprint"], sha256_bytes(payloads["result-bundle.json"]),
            model, runtime, host, model_sha, runtime_sha, host_sha,
        )
    execution_attested = attestation_bytes is not None
    evidence_package = {
        "schema_version": ("1.2-r1b-attested-integrity-package" if execution_attested
                           else "1.1-r1b-integrity-package"),
        "evidence_class": ("SOFTWARE_ROOTED_EXECUTION_ATTESTATION" if execution_attested
                           else "INTEGRITY_ONLY_NOT_EXECUTION_ATTESTATION"),
        "work_order_id": "WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1",
        "artifacts": {name: sha256_bytes(payload) for name, payload in payloads.items()},
        "host": host,
        "host_manifest_sha256": host_sha,
        "attestation": {
            "execution_attested": execution_attested,
            "host_identity_attested": execution_attested,
            "model_weights_attested": execution_attested,
            "runtime_attested": execution_attested,
            "declared_manifests_only": not execution_attested,
            "external_provider_status": ("ATTESTED_NOT_USED" if execution_attested
                                         else "NOT_INDEPENDENTLY_ATTESTED"),
        },
        "safety": {
            "canonical_vectors_written": False,
            "database_mutated": False,
            "vector_contract_frozen": False,
        },
    }
    if execution_attested:
        evidence_package["execution_attestation"] = {
            "encoding": "base64-canonical-json-utf8",
            "canonical_bytes_base64": base64.b64encode(attestation_bytes).decode("ascii"),
            "sha256": sha256_bytes(attestation_bytes),
        }
        evidence_package["safety"].update({
            "external_provider_used": False,
            "fallback_used": False,
            "scheduler_state": "disabled",
        })
    payloads["evidence-package.json"] = canonical_payload(evidence_package)
    targets = {
        "schema_version": "1.0-r1b-standing-hash-targets",
        "work_order_id": "WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1",
        "targets": [
            {"artifact": "benchmark_corpus", "path": "corpus-bundle.json", "sha256": sha256_bytes(payloads["corpus-bundle.json"])},
            {"artifact": "model_runtime_manifest", "path": "model-runtime-manifest.json", "sha256": sha256_bytes(payloads["model-runtime-manifest.json"])},
            {"artifact": "result_bundle", "path": "result-bundle.json", "sha256": sha256_bytes(payloads["result-bundle.json"])},
            {"artifact": "evidence_package", "path": "evidence-package.json", "sha256": sha256_bytes(payloads["evidence-package.json"])},
        ],
        "standing_capability": "HASH_VERIFY",
        "verification_scope": ("BYTE_INTEGRITY_AND_SOFTWARE_ROOTED_EXECUTION_ATTESTATION"
                               if execution_attested else "BYTE_INTEGRITY_ONLY"),
        "execution_provenance_status": ("SOFTWARE_ROOTED_ATTESTED" if execution_attested
                                        else "NOT_ATTESTED"),
        "dispatch_requested": False,
    }
    payloads["standing-hash-targets.json"] = canonical_payload(targets)
    generation = sha256_bytes(payloads["evidence-package.json"])
    destination = write_generation(out_dir, generation, payloads)
    return {**targets, "generation": generation, "generation_path": destination}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--model-manifest", required=True)
    parser.add_argument("--runtime-manifest", required=True)
    parser.add_argument("--host-manifest", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--execution-attestation")
    args = parser.parse_args(argv)
    targets = build(args.corpus, args.model_manifest, args.runtime_manifest,
                    args.host_manifest, args.result, args.out_dir,
                    args.execution_attestation)
    print(json.dumps(targets, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
