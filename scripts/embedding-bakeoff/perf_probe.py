#!/usr/bin/env python3
"""Perf probe for an OpenAI-compatible /v1/embeddings backend: single-text latency (p50/p95/mean)
and batched throughput (texts/sec) over the bake-off corpus. Quality is measured elsewhere; this is
the hardware axis. Stdlib only.
  BASE_URL=http://127.0.0.1:11500/v1 MODEL=bge-m3 python3 perf_probe.py
"""
import json
import os
import time
import urllib.request

BASE = os.environ["BASE_URL"].rstrip("/")
MODEL = os.environ["MODEL"]
KEY = os.environ.get("EMBED_API_KEY", "x")


def embed(texts):
    body = json.dumps({"model": MODEL, "input": texts}).encode("utf-8")
    req = urllib.request.Request(
        BASE + "/embeddings", data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + KEY},
    )
    t = time.perf_counter()
    with urllib.request.urlopen(req, timeout=600) as r:
        d = json.load(r)
    return d, time.perf_counter() - t


docs = [json.loads(l)["text"] for l in open("corpus/documents.jsonl", encoding="utf-8")]

embed(["warmup"])  # warm (model already resident; excludes cold load)

lat = []
for i in range(30):
    _, dt = embed([docs[i % len(docs)]])
    lat.append(dt * 1000.0)
lat.sort()


def pct(p):
    k = (len(lat) - 1) * p / 100.0
    f = int(k); c = min(f + 1, len(lat) - 1)
    return lat[f] + (lat[c] - lat[f]) * (k - f)


# throughput: full corpus in batches of 16, summed wall time
total = 0.0
dim = None
for j in range(0, len(docs), 16):
    d, dt = embed(docs[j:j + 16])
    total += dt
    if dim is None:
        dim = len(d["data"][0]["embedding"])

print(json.dumps({
    "model": MODEL, "dim": dim,
    "single_lat_ms_p50": round(pct(50), 1),
    "single_lat_ms_p95": round(pct(95), 1),
    "single_lat_ms_mean": round(sum(lat) / len(lat), 1),
    "batch_docs": len(docs),
    "batch_total_s": round(total, 3),
    "texts_per_s": round(len(docs) / total, 1),
}))
