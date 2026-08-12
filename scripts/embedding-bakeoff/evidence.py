#!/usr/bin/env python3
"""Build deterministic R1B artifacts for independent standing HASH_VERIFY."""
import argparse
import hashlib
import json
import os
import tempfile

from bakeoff import (canonical_json_bytes, corpus_fingerprint, load_jsonl,
                     reject_secret_fields, validate_corpus)


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


def write_canonical(path, value):
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    payload = canonical_json_bytes(value) + b"\n"
    fd, temporary = tempfile.mkstemp(prefix=".r1b-evidence-", suffix=".json", dir=parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return sha256_bytes(payload)


def build(corpus_dir, model_manifest_path, runtime_manifest_path, host_manifest_path,
          result_path, out_dir):
    docs_path = os.path.join(corpus_dir, "documents.jsonl")
    queries_path = os.path.join(corpus_dir, "queries.jsonl")
    docs = load_jsonl(docs_path)
    queries = load_jsonl(queries_path)
    validate_corpus(docs, queries)
    model = load_json(model_manifest_path)
    runtime = load_json(runtime_manifest_path)
    host = load_json(host_manifest_path)
    result = load_json(result_path)
    for name, value in (("model", model), ("runtime", runtime), ("host", host), ("result", result)):
        reject_secret_fields(value, name)

    os.makedirs(out_dir, exist_ok=True)
    corpus_artifact = {
        "schema_version": "1.0-r1b-corpus-artifact",
        "corpus_fingerprint": corpus_fingerprint(docs, queries),
        "documents_sha256": sha256_file(docs_path),
        "queries_sha256": sha256_file(queries_path),
        "documents": len(docs),
        "queries": len(queries),
    }
    corpus_path = os.path.join(out_dir, "corpus-artifact.json")
    corpus_sha = write_canonical(corpus_path, corpus_artifact)

    model_runtime = {
        "schema_version": "1.0-r1b-model-runtime-manifest",
        "model": model,
        "model_manifest_sha256": sha256_file(model_manifest_path),
        "runtime": runtime,
        "runtime_manifest_sha256": sha256_file(runtime_manifest_path),
    }
    model_runtime_path = os.path.join(out_dir, "model-runtime-manifest.json")
    model_runtime_sha = write_canonical(model_runtime_path, model_runtime)

    result_bundle_path = os.path.join(out_dir, "result-bundle.json")
    result_bundle_sha = write_canonical(result_bundle_path, result)

    result_corpus = result.get("manifest", {}).get("corpus_fingerprint")
    if result_corpus != corpus_artifact["corpus_fingerprint"]:
        raise ValueError("result bundle corpus fingerprint does not match the frozen corpus")
    if result.get("manifest", {}).get("backend") == "endpoint":
        provenance = result["manifest"].get("provenance", {})
        expected = {
            "model_manifest_sha256": sha256_file(model_manifest_path),
            "runtime_manifest_sha256": sha256_file(runtime_manifest_path),
            "host_manifest_sha256": sha256_file(host_manifest_path),
        }
        for field, digest in expected.items():
            if provenance.get(field) != digest:
                raise ValueError(f"result bundle {field} does not match the supplied manifest")
    evidence_package = {
        "schema_version": "1.0-r1b-evidence-package",
        "work_order_id": "WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1",
        "artifacts": {
            "corpus_artifact_sha256": corpus_sha,
            "model_runtime_manifest_sha256": model_runtime_sha,
            "result_bundle_sha256": result_bundle_sha,
            "host_manifest_sha256": sha256_file(host_manifest_path),
        },
        "host": host,
        "safety": {
            "canonical_vectors_written": False,
            "database_mutated": False,
            "vector_contract_frozen": False,
            "external_provider_used": False,
        },
    }
    evidence_path = os.path.join(out_dir, "evidence-package.json")
    evidence_sha = write_canonical(evidence_path, evidence_package)

    targets = {
        "schema_version": "1.0-r1b-standing-hash-targets",
        "work_order_id": "WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1",
        "targets": [
            {"artifact": "benchmark_corpus", "path": "corpus-artifact.json", "sha256": corpus_sha},
            {"artifact": "model_runtime_manifest", "path": "model-runtime-manifest.json", "sha256": model_runtime_sha},
            {"artifact": "result_bundle", "path": "result-bundle.json", "sha256": result_bundle_sha},
            {"artifact": "evidence_package", "path": "evidence-package.json", "sha256": evidence_sha},
        ],
        "standing_capability": "HASH_VERIFY",
        "dispatch_requested": False,
    }
    write_canonical(os.path.join(out_dir, "standing-hash-targets.json"), targets)
    return targets


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--model-manifest", required=True)
    parser.add_argument("--runtime-manifest", required=True)
    parser.add_argument("--host-manifest", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args(argv)
    targets = build(args.corpus, args.model_manifest, args.runtime_manifest,
                    args.host_manifest, args.result, args.out_dir)
    print(json.dumps(targets, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
