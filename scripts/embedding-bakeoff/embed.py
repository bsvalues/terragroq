"""Embedding backends for the bake-off. Stdlib only.

Two backends:
  - endpoint: OpenAI-compatible POST {base_url}/embeddings (Ollama, vLLM, llama.cpp server, ...).
              The application/harness knows only the OpenAI wire format — no provider hard-coded.
  - lexical:  deterministic char/word hashing baseline (no model). A floor any neural model must
              beat, and the offline self-test embedder (proves the pipeline without pulling weights).

All vectors are L2-normalized, so cosine similarity is a dot product.
"""
import hashlib
import ipaddress
import json
import math
import re
import urllib.parse
import urllib.request


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError(f"embedding endpoint redirects are forbidden: HTTP {code}")


def l2_normalize(vec):
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def cosine(a, b):
    if not a or not b:
        raise ValueError("cosine requires non-empty vectors")
    if len(a) != len(b):
        raise ValueError(f"vector dimension mismatch: {len(a)} != {len(b)}")
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


def validate_sovereign_base_url(base_url):
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("endpoint base_url must be an absolute http(s) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("endpoint base_url must not contain credentials, query parameters, or fragments")
    hostname = parsed.hostname.lower()
    if hostname == "localhost" or "." not in hostname:
        return
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError as exc:
        raise ValueError("endpoint hostname must be localhost, a single-label fabric host, or a private IP") from exc
    if not (address.is_private or address.is_loopback):
        raise ValueError("external embedding endpoints are forbidden")


def _validate_embedding(value, row_index):
    if not isinstance(value, list) or not value:
        raise ValueError(f"endpoint row {row_index} has no embedding vector")
    for item in value:
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item):
            raise ValueError(f"endpoint row {row_index} contains a non-finite or non-numeric value")
    return [float(item) for item in value]


def _endpoint_batch(base_url, model, texts, api_key, timeout):
    validate_sovereign_base_url(base_url)
    payload = json.dumps({"model": model, "input": texts}).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    req = urllib.request.Request(
        base_url.rstrip("/") + "/embeddings",
        data=payload,
        headers=headers,
        method="POST",
    )
    opener = urllib.request.build_opener(NoRedirectHandler())
    with opener.open(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not isinstance(data, dict) or data.get("model") != model:
        raise ValueError("endpoint response model does not match the requested model")
    rows = data.get("data")
    if not isinstance(rows, list) or len(rows) != len(texts):
        raise ValueError(f"endpoint returned {len(rows) if isinstance(rows, list) else 0} rows for {len(texts)} inputs")
    indexes = [row.get("index") if isinstance(row, dict) else None for row in rows]
    if any(isinstance(index, bool) or not isinstance(index, int) for index in indexes):
        raise ValueError("endpoint indexes must be integers")
    if sorted(indexes) != list(range(len(texts))):
        raise ValueError("endpoint indexes must be unique and cover every input exactly once")
    ordered = sorted(rows, key=lambda row: row["index"])
    vectors = [_validate_embedding(row.get("embedding"), row["index"]) for row in ordered]
    dimensions = {len(vector) for vector in vectors}
    if len(dimensions) != 1:
        raise ValueError("endpoint returned mixed embedding dimensions")
    return [l2_normalize(vector) for vector in vectors]


def embed_texts(texts, backend="lexical", base_url=None, model=None, api_key=None,
                batch_size=32, timeout=180, dim=2048):
    if backend == "lexical":
        return [lexical_embed(t, dim=dim) for t in texts]
    if backend == "endpoint":
        if not base_url or not model:
            raise ValueError("endpoint backend requires base_url and model")
        out = []
        expected_dim = None
        for i in range(0, len(texts), batch_size):
            batch = _endpoint_batch(base_url, model, texts[i:i + batch_size], api_key, timeout)
            batch_dim = len(batch[0]) if batch else None
            if expected_dim is None:
                expected_dim = batch_dim
            elif batch_dim != expected_dim:
                raise ValueError(f"endpoint dimension changed across batches: {expected_dim} != {batch_dim}")
            out.extend(batch)
        if len(out) != len(texts):
            raise ValueError(f"embedding count mismatch: {len(out)} != {len(texts)}")
        return out
    raise ValueError("unknown backend: " + backend)
