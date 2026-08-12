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
import sys
import time

import metrics as M
from embed import cosine, embed_texts


def load_jsonl(path):
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def rank(query_vec, doc_vecs, doc_ids):
    scored = [(doc_ids[i], cosine(query_vec, dv)) for i, dv in enumerate(doc_vecs)]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored


def corpus_fingerprint(docs, queries):
    h = hashlib.sha256()
    for d in docs:
        h.update((d["id"] + "\x1f" + d["text"]).encode("utf-8"))
    for q in queries:
        h.update((q["id"] + "\x1f" + q["query"]).encode("utf-8"))
    return h.hexdigest()


def run(corpus_dir, backend, base_url, model, api_key, k, dim):
    docs = load_jsonl(os.path.join(corpus_dir, "documents.jsonl"))
    queries = load_jsonl(os.path.join(corpus_dir, "queries.jsonl"))
    doc_ids = [d["id"] for d in docs]

    doc_vecs = embed_texts([d["text"] for d in docs], backend=backend, base_url=base_url,
                           model=model, api_key=api_key, dim=dim)
    q_vecs = embed_texts([q["query"] for q in queries], backend=backend, base_url=base_url,
                         model=model, api_key=api_key, dim=dim)

    per_query = []
    has_gold_top1, no_gold_top1 = [], []
    for q, qv in zip(queries, q_vecs):
        ranked = rank(qv, doc_vecs, doc_ids)
        ranked_ids = [rid for rid, _ in ranked]
        top1 = ranked[0][1] if ranked else 0.0
        gold = q.get("gold", [])
        row = {
            "id": q["id"], "type": q["type"], "gold": gold,
            "top5": ranked_ids[:5], "top1_sim": round(top1, 4),
            "recall@5": M.recall_at_k(ranked_ids, gold, 5),
            "recall@10": M.recall_at_k(ranked_ids, gold, 10),
            "mrr": M.mrr(ranked_ids, gold),
            "ndcg@10": M.ndcg_at_k(ranked_ids, gold, 10),
            "near_dup_ok": M.near_dup_ok(ranked_ids, gold, q.get("distractor")),
        }
        per_query.append(row)
        (has_gold_top1 if gold else no_gold_top1).append(top1)

    fp_threshold = M.median(has_gold_top1) or 0.0
    by_type = {}
    for row in per_query:
        by_type.setdefault(row["type"], []).append(row)

    summary = {
        "recall@5": M.mean([r["recall@5"] for r in per_query]),
        "recall@10": M.mean([r["recall@10"] for r in per_query]),
        "mrr": M.mean([r["mrr"] for r in per_query]),
        "ndcg@10": M.mean([r["ndcg@10"] for r in per_query]),
        "mrr_ci95": M.bootstrap_ci([r["mrr"] for r in per_query]),
        "ndcg@10_ci95": M.bootstrap_ci([r["ndcg@10"] for r in per_query]),
        "near_dup_discrimination": M.mean([r["near_dup_ok"] for r in per_query]),
        "false_positive_rate": M.false_positive_rate(no_gold_top1, fp_threshold),
        "fp_threshold": round(fp_threshold, 4),
        "per_category_recall@5": {
            t: M.mean([r["recall@5"] for r in rows]) for t, rows in sorted(by_type.items())
        },
        "queries": len(queries), "documents": len(docs),
    }
    manifest = {
        "backend": backend, "model": model, "base_url": base_url,
        "embedding_dim": len(doc_vecs[0]) if doc_vecs else None,
        "corpus_fingerprint": corpus_fingerprint(docs, queries),
        "host": os.uname().nodename if hasattr(os, "uname") else None,
        "ran_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "note": "Phase-2 measurement. No model/dimension frozen (Phase 3).",
    }
    return {"summary": summary, "manifest": manifest, "per_query": per_query}


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--corpus", default=os.path.join(os.path.dirname(__file__), "corpus"))
    p.add_argument("--backend", default=os.environ.get("BACKEND", "lexical"))
    p.add_argument("--base-url", default=os.environ.get("BASE_URL"))
    p.add_argument("--model", default=os.environ.get("MODEL"))
    p.add_argument("--api-key", default=os.environ.get("EMBED_API_KEY", "local"))
    p.add_argument("--k", type=int, default=10)
    p.add_argument("--dim", type=int, default=2048, help="lexical backend dimension")
    p.add_argument("--out", default=None)
    args = p.parse_args(argv)

    result = run(args.corpus, args.backend, args.base_url, args.model, args.api_key, args.k, args.dim)
    text = json.dumps(result, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    s = result["summary"]
    print(json.dumps({"model": args.model or args.backend, "summary": {
        k: s[k] for k in ("recall@5", "recall@10", "mrr", "ndcg@10",
                          "near_dup_discrimination", "false_positive_rate")}}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
