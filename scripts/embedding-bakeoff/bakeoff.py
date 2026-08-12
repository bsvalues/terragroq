#!/usr/bin/env python3
"""WilliamOS sovereign-embedding bake-off runner (Phase 2).

Embeds a known-answer corpus + gold queries via a backend, ranks documents by cosine
similarity, scores retrieval quality, and writes a per-model report + run manifest.

  python bakeoff.py --backend lexical
  BASE_URL=http://127.0.0.1:11434/v1 MODEL=bge-m3 python bakeoff.py --backend endpoint

Quality dominates speed: this scores Recall@5/10, MRR, nDCG@10, false-positive rate,
near-duplicate discrimination, and per-category (factual/code/config/long-doc/multilingual)
recall. It does NOT freeze a model or dimension — that is Phase 3.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import time

import metrics as M
from embed import cosine, embed_texts


def load_jsonl(path):
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def canonical_json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def load_manifest(path, required_fields, kind):
    if not path:
        raise ValueError(f"endpoint backend requires --{kind}-manifest")
    with open(path, encoding="utf-8") as fh:
        value = json.load(fh)
    if not isinstance(value, dict):
        raise ValueError(f"{kind} manifest must be a JSON object")
    reject_secret_fields(value, kind)
    missing = [field for field in required_fields if not value.get(field)]
    if missing:
        raise ValueError(f"{kind} manifest missing required fields: {', '.join(missing)}")
    for field in ("weights_sha256", "executable_sha256", "machine_id_sha256", "inventory_snapshot_sha256"):
        if field in value and (not isinstance(value[field], str) or not re_full_sha256(value[field])):
            raise ValueError(f"{kind} manifest field {field} must be a SHA-256 digest")
    return value


SECRET_FIELD_COMPACT = (
    "apikey", "apitoken", "authorization", "bearertoken", "password", "passwd",
    "secret", "accesstoken", "authtoken", "sessiontoken", "refreshtoken", "idtoken",
    "cookie", "credential", "privatekey",
)


def is_secret_field(key):
    compact = re.sub(r"[^a-z0-9]", "", str(key).lower())
    return compact == "token" or any(marker in compact for marker in SECRET_FIELD_COMPACT)


def reject_secret_fields(value, path="manifest"):
    if isinstance(value, dict):
        for key, nested in value.items():
            if is_secret_field(key):
                raise ValueError(f"secret-like field is forbidden in retained evidence: {path}.{key}")
            reject_secret_fields(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            reject_secret_fields(nested, f"{path}[{index}]")


def re_full_sha256(value):
    return len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def validate_corpus(docs, queries):
    doc_ids = [doc.get("id") for doc in docs]
    query_ids = [query.get("id") for query in queries]
    if None in doc_ids or len(set(doc_ids)) != len(doc_ids):
        raise ValueError("document ids must be present and unique")
    if None in query_ids or len(set(query_ids)) != len(query_ids):
        raise ValueError("query ids must be present and unique")
    known = set(doc_ids)
    for query in queries:
        for field in ("type", "query", "gold"):
            if field not in query:
                raise ValueError(f"query {query['id']} missing {field}")
        if not isinstance(query["gold"], list) or any(doc_id not in known for doc_id in query["gold"]):
            raise ValueError(f"query {query['id']} has invalid gold labels")
        if query.get("distractor") is not None and query["distractor"] not in known:
            raise ValueError(f"query {query['id']} has an invalid distractor")


CALIBRATION_QUERY_IDS = frozenset(
    [f"q{number:02d}" for number in range(1, 13)] + ["q37", "q38"]
)


def rank(query_vec, doc_vecs, doc_ids):
    scored = [(doc_ids[i], cosine(query_vec, dv)) for i, dv in enumerate(doc_vecs)]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored


def corpus_fingerprint(docs, queries):
    payload = {
        "documents": sorted(docs, key=lambda item: item["id"]),
        "queries": sorted(queries, key=lambda item: item["id"]),
        "calibration_query_ids": sorted(CALIBRATION_QUERY_IDS),
    }
    return hashlib.sha256(canonical_json_bytes(payload)).hexdigest()


def run(corpus_dir, backend, base_url, model, api_key, k, dim,
        model_manifest_path=None, runtime_manifest_path=None, host_manifest_path=None):
    if k <= 0 or dim <= 0:
        raise ValueError("k and dim must be positive")
    docs = load_jsonl(os.path.join(corpus_dir, "documents.jsonl"))
    queries = load_jsonl(os.path.join(corpus_dir, "queries.jsonl"))
    validate_corpus(docs, queries)
    doc_ids = [d["id"] for d in docs]

    provenance = {}
    if backend == "endpoint":
        model_manifest = load_manifest(model_manifest_path,
            ("schema_version", "model_id", "revision", "weights_sha256", "license", "source"), "model")
        runtime_manifest = load_manifest(runtime_manifest_path,
            ("schema_version", "runtime_id", "version", "executable_sha256", "endpoint_contract"), "runtime")
        host_manifest = load_manifest(host_manifest_path,
            ("schema_version", "node_id", "machine_id_sha256", "inventory_snapshot_sha256", "topology_id", "endpoint_hosts"), "host")
        if model_manifest["model_id"] != model:
            raise ValueError("--model must match model manifest model_id")
        endpoint_host = urllib_hostname(base_url)
        endpoint_hosts = host_manifest["endpoint_hosts"]
        if (not isinstance(endpoint_hosts, list) or not endpoint_hosts or
                endpoint_host not in {str(value).lower() for value in endpoint_hosts}):
            raise ValueError("embedding endpoint host is not bound by the host manifest")
        provenance = {
            "model": model_manifest,
            "model_manifest_sha256": sha256_file(model_manifest_path),
            "runtime": runtime_manifest,
            "runtime_manifest_sha256": sha256_file(runtime_manifest_path),
            "host": host_manifest,
            "host_manifest_sha256": sha256_file(host_manifest_path),
        }

    started = time.perf_counter()
    doc_vecs = embed_texts([d["text"] for d in docs], backend=backend, base_url=base_url,
                           model=model, api_key=api_key, dim=dim)
    documents_elapsed = time.perf_counter() - started
    started = time.perf_counter()
    q_vecs = embed_texts([q["query"] for q in queries], backend=backend, base_url=base_url,
                         model=model, api_key=api_key, dim=dim)
    queries_elapsed = time.perf_counter() - started
    if len(doc_vecs) != len(docs) or len(q_vecs) != len(queries):
        raise ValueError("backend returned an incomplete embedding set")
    dimensions = {len(vector) for vector in doc_vecs + q_vecs}
    if len(dimensions) != 1:
        raise ValueError("mixed embedding dimensions are forbidden")
    embedding_dimension = next(iter(dimensions))
    expected_dimension = provenance.get("model", {}).get("dimension")
    if expected_dimension is not None and expected_dimension != embedding_dimension:
        raise ValueError(f"model manifest dimension mismatch: {expected_dimension} != {embedding_dimension}")

    per_query = []
    calibration_gold_top1, calibration_no_gold_top1, evaluation_no_gold_top1 = [], [], []
    for q, qv in zip(queries, q_vecs):
        ranked = rank(qv, doc_vecs, doc_ids)
        ranked_ids = [rid for rid, _ in ranked]
        gold = q.get("gold", [])
        split = "calibration" if q["id"] in CALIBRATION_QUERY_IDS else "evaluation"
        ranking_evidence = [{"id": doc_id, "similarity": round(similarity, 10)}
                            for doc_id, similarity in ranked]
        top1_evidence = round(ranking_evidence[0]["similarity"], 6) if ranking_evidence else 0.0
        row = {
            "id": q["id"], "type": q["type"], "gold": gold,
            "split": split,
            "ranking": ranking_evidence,
            "top_k": ranked_ids[:k], "top1_sim": top1_evidence,
            "recall@5": M.recall_at_k(ranked_ids, gold, 5),
            "recall@10": M.recall_at_k(ranked_ids, gold, 10),
            "recall@k": M.recall_at_k(ranked_ids, gold, k),
            "mrr": M.mrr(ranked_ids, gold),
            "ndcg@10": M.ndcg_at_k(ranked_ids, gold, 10),
            "ndcg@k": M.ndcg_at_k(ranked_ids, gold, k),
            "near_dup_ok": M.near_dup_ok(ranked_ids, gold, q.get("distractor")),
        }
        per_query.append(row)
        if split == "calibration" and gold:
            calibration_gold_top1.append(top1_evidence)
        elif split == "calibration":
            calibration_no_gold_top1.append(top1_evidence)
        elif split == "evaluation" and not gold:
            evaluation_no_gold_top1.append(top1_evidence)

    gold_midpoint = M.median(calibration_gold_top1) or 0.0
    no_gold_ceiling = max(calibration_no_gold_top1, default=0.0)
    fp_threshold = ((gold_midpoint + no_gold_ceiling) / 2.0
                    if gold_midpoint > no_gold_ceiling else gold_midpoint)
    evaluated = [row for row in per_query if row["split"] == "evaluation"]
    by_type = {}
    for row in evaluated:
        by_type.setdefault(row["type"], []).append(row)

    summary = {
        "recall@5": M.mean([r["recall@5"] for r in evaluated]),
        "recall@10": M.mean([r["recall@10"] for r in evaluated]),
        "recall@k": M.mean([r["recall@k"] for r in evaluated]),
        "mrr": M.mean([r["mrr"] for r in evaluated]),
        "ndcg@10": M.mean([r["ndcg@10"] for r in evaluated]),
        "ndcg@k": M.mean([r["ndcg@k"] for r in evaluated]),
        "mrr_ci95": M.bootstrap_ci([r["mrr"] for r in evaluated]),
        "ndcg@10_ci95": M.bootstrap_ci([r["ndcg@10"] for r in evaluated]),
        "near_dup_discrimination": M.mean([r["near_dup_ok"] for r in evaluated]),
        "false_positive_rate": M.false_positive_rate(evaluation_no_gold_top1, fp_threshold),
        "fp_threshold": round(fp_threshold, 6),
        "fp_threshold_policy": "midpoint of fixed-split median gold and max no-gold when separable; otherwise median gold",
        "fp_calibration": {
            "gold_queries": len(calibration_gold_top1),
            "no_gold_queries": len(calibration_no_gold_top1),
        },
        "per_category_recall@5": {
            t: M.mean([r["recall@5"] for r in rows]) for t, rows in sorted(by_type.items())
        },
        "queries": len(queries), "evaluation_queries": len(evaluated),
        "calibration_queries": len(queries) - len(evaluated), "documents": len(docs),
    }
    manifest = {
        "backend": backend, "model": model, "base_url": base_url,
        "embedding_dim": embedding_dimension,
        "corpus_fingerprint": corpus_fingerprint(docs, queries),
        "corpus_files": {
            "documents_sha256": sha256_file(os.path.join(corpus_dir, "documents.jsonl")),
            "queries_sha256": sha256_file(os.path.join(corpus_dir, "queries.jsonl")),
        },
        "provenance": provenance,
        "timing": {
            "documents_seconds": round(documents_elapsed, 6),
            "queries_seconds": round(queries_elapsed, 6),
            "documents_per_second": round(len(docs) / documents_elapsed, 3) if documents_elapsed else None,
            "queries_per_second": round(len(queries) / queries_elapsed, 3) if queries_elapsed else None,
        },
        "top_k": k,
        "vector_contract": {
            "input_preprocessing": "utf8-text-as-recorded-no-prefix-v1",
            "normalization": "l2",
            "metric": "cosine",
            "chunking": "frozen-corpus-chunks-v1",
        },
        "ran_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "note": "Phase-2 measurement. No model/dimension frozen (Phase 3).",
    }
    return {"summary": summary, "manifest": manifest, "per_query": per_query}


def urllib_hostname(base_url):
    from urllib.parse import urlparse
    return (urlparse(base_url).hostname or "").lower()


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--corpus", default=os.path.join(os.path.dirname(__file__), "corpus"))
    p.add_argument("--backend", default=os.environ.get("BACKEND", "lexical"))
    p.add_argument("--base-url", default=os.environ.get("BASE_URL"))
    p.add_argument("--model", default=os.environ.get("MODEL"))
    p.add_argument("--api-key", default=os.environ.get("EMBED_API_KEY"))
    p.add_argument("--k", type=int, default=10)
    p.add_argument("--dim", type=int, default=2048, help="lexical backend dimension")
    p.add_argument("--out", default=None)
    p.add_argument("--model-manifest")
    p.add_argument("--runtime-manifest")
    p.add_argument("--host-manifest")
    args = p.parse_args(argv)

    if args.out:
        output_parent = os.path.dirname(os.path.abspath(args.out))
        os.makedirs(output_parent, exist_ok=True)
        if not os.path.isdir(output_parent):
            raise ValueError("output parent is not a directory")
    result = run(args.corpus, args.backend, args.base_url, args.model, args.api_key, args.k, args.dim,
                 args.model_manifest, args.runtime_manifest, args.host_manifest)
    text = json.dumps(result, indent=2)
    if args.out:
        fd, temporary = tempfile.mkstemp(prefix=".embedding-result-", suffix=".json", dir=output_parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(text)
                fh.write("\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(temporary, args.out)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    s = result["summary"]
    print(json.dumps({"model": args.model or args.backend, "summary": {
        k: s[k] for k in ("recall@5", "recall@10", "mrr", "ndcg@10",
                          "near_dup_discrimination", "false_positive_rate")}}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
