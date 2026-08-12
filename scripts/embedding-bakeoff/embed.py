"""Embedding backends for the bake-off. Stdlib only.

Two backends:
  - endpoint: OpenAI-compatible POST {base_url}/embeddings (Ollama, vLLM, llama.cpp server, ...).
              The application/harness knows only the OpenAI wire format — no provider hard-coded.
  - lexical:  deterministic char/word hashing baseline (no model). A floor any neural model must
              beat, and the offline self-test embedder (proves the pipeline without pulling weights).

All vectors are L2-normalized, so cosine similarity is a dot product.
"""
import hashlib
import json
import math
import re
import urllib.request


def l2_normalize(vec):
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def cosine(a, b):
    return sum(x * y for x, y in zip(a, b))


def _stable_bucket(token, dim):
    return int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16) % dim


def lexical_embed(text, dim=2048):
    """Deterministic hashed bag of words + char trigrams. Not semantic — a lexical floor."""
    vec = [0.0] * dim
    tokens = re.findall(r"[\w]+", text.lower(), flags=re.UNICODE)
    for tok in tokens:
        vec[_stable_bucket("w:" + tok, dim)] += 1.0
        for i in range(len(tok) - 2):
            vec[_stable_bucket("g:" + tok[i:i + 3], dim)] += 0.5
    return l2_normalize(vec)


def _endpoint_batch(base_url, model, texts, api_key, timeout):
    payload = json.dumps({"model": model, "input": texts}).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + "/embeddings",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    rows = sorted(data["data"], key=lambda d: d.get("index", 0))
    return [l2_normalize(r["embedding"]) for r in rows]


def embed_texts(texts, backend="lexical", base_url=None, model=None, api_key="local",
                batch_size=32, timeout=180, dim=2048):
    if backend == "lexical":
        return [lexical_embed(t, dim=dim) for t in texts]
    if backend == "endpoint":
        if not base_url or not model:
            raise ValueError("endpoint backend requires base_url and model")
        out = []
        for i in range(0, len(texts), batch_size):
            out.extend(_endpoint_batch(base_url, model, texts[i:i + batch_size], api_key, timeout))
        return out
    raise ValueError("unknown backend: " + backend)
