#!/usr/bin/env python3
"""Fixed resident-HERMES evaluator for the R1B embedding bake-off.

The Fabric runner supplies a previously validated, secret-free execution envelope on
stdin. This module owns the transport: the endpoint, route, timeout, batch size, and
output channel cannot be selected by the caller.
"""
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request

import bakeoff
from bakeoff import reject_secret_fields
from embed import validate_endpoint_payload


ENDPOINT = "http://127.0.0.1:11435/api/embed"
BASE_URL = "http://127.0.0.1:11435/v1"
BATCH_SIZE = 8
TIMEOUT_SECONDS = 180
MAX_REQUEST_BYTES = 512 * 1024
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_INPUTS = 256
CORPUS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "corpus")


def _exact_object(value, fields, label):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ValueError(f"{label} fields do not match the fixed evaluator contract")
    return value


def validate_envelope(value):
    """Validate the closed input shape before any loopback request is attempted."""
    _exact_object(value, ("schema_version", "model", "model_manifest", "runtime_manifest",
                          "host_manifest", "execution_limits"), "execution envelope")
    reject_secret_fields(value, "execution envelope")
    if value["schema_version"] != "1.0-r1b-fabric-measurement-envelope":
        raise ValueError("execution envelope schema is unsupported")
    model = value["model"]
    if not isinstance(model, str) or not model or model != model.strip():
        raise ValueError("execution envelope model must be an exact non-empty identity")

    model_manifest = _exact_object(value["model_manifest"], (
        "schema_version", "model_id", "revision", "weights_sha256", "license", "source",
        "dimension",
    ), "model manifest")
    runtime_manifest = _exact_object(value["runtime_manifest"], (
        "schema_version", "runtime_id", "version", "executable_sha256", "endpoint_contract",
    ), "runtime manifest")
    host_manifest = _exact_object(value["host_manifest"], (
        "schema_version", "node_id", "machine_id_sha256", "inventory_snapshot_sha256",
        "topology_id", "endpoint_hosts",
    ), "host manifest")
    execution_limits = _exact_object(value["execution_limits"], (
        "max_cpu_threads", "gpu_execution",
    ), "execution limits")
    if model_manifest["model_id"] != model:
        raise ValueError("execution envelope model identity does not match its manifest")
    if runtime_manifest["endpoint_contract"] != "ollama-embed-v1":
        raise ValueError("runtime manifest does not bind the fixed Ollama embedding contract")
    if host_manifest["node_id"] != "hermes-node" or host_manifest["endpoint_hosts"] != ["127.0.0.1"]:
        raise ValueError("host manifest does not bind resident HERMES loopback execution")
    dimension = model_manifest["dimension"]
    if isinstance(dimension, bool) or not isinstance(dimension, int) or dimension <= 0:
        raise ValueError("model manifest dimension must be a positive integer")
    max_cpu_threads = execution_limits["max_cpu_threads"]
    if (isinstance(max_cpu_threads, bool) or not isinstance(max_cpu_threads, int)
            or max_cpu_threads <= 0):
        raise ValueError("execution limits max_cpu_threads must be a positive integer")
    if execution_limits["gpu_execution"] != "CPU_ONLY":
        raise ValueError("execution limits must require CPU_ONLY execution")
    for manifest in (model_manifest, runtime_manifest, host_manifest):
        reject_secret_fields(manifest, "execution manifest")
    return value


def _read_bounded_response(response):
    declared = response.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > MAX_RESPONSE_BYTES:
                raise ValueError("loopback embedding response exceeds the byte ceiling")
        except ValueError as error:
            if "exceeds" in str(error):
                raise
            raise ValueError("loopback embedding response has an invalid content length") from error
    payload = response.read(MAX_RESPONSE_BYTES + 1)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise ValueError("loopback embedding response exceeds the byte ceiling")
    return payload


def invoke_fixed_loopback(model, texts, max_cpu_threads, opener=urllib.request.urlopen):
    """Call only the resident Ollama loopback embedding route."""
    if not isinstance(texts, list) or not texts or len(texts) > MAX_TOTAL_INPUTS:
        raise ValueError("embedding input count is outside the fixed evaluator envelope")
    vectors = []
    expected_dimension = None
    for offset in range(0, len(texts), BATCH_SIZE):
        batch = texts[offset:offset + BATCH_SIZE]
        if any(not isinstance(text, str) or not text for text in batch):
            raise ValueError("embedding inputs must be non-empty text")
        body = json.dumps({
            "model": model,
            "input": batch,
            "options": {"num_gpu": 0, "num_thread": max_cpu_threads},
        }, ensure_ascii=False,
                          separators=(",", ":")).encode("utf-8")
        if len(body) > MAX_REQUEST_BYTES:
            raise ValueError("loopback embedding request exceeds the byte ceiling")
        request = urllib.request.Request(
            ENDPOINT,
            data=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with opener(request, timeout=TIMEOUT_SECONDS) as response:
                if getattr(response, "status", 200) != 200:
                    raise ValueError(f"loopback embedding endpoint returned HTTP {response.status}")
                raw = _read_bounded_response(response)
        except (urllib.error.URLError, TimeoutError) as error:
            raise ValueError("resident HERMES loopback embedding request failed") from error
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("loopback embedding response is not valid UTF-8 JSON") from error
        ollama_vectors = parsed.get("embeddings") if isinstance(parsed, dict) else None
        openai_shape = {
            "model": parsed.get("model") if isinstance(parsed, dict) else None,
            "data": [
                {"index": index, "embedding": vector}
                for index, vector in enumerate(ollama_vectors or [])
            ],
        }
        validated = validate_endpoint_payload(openai_shape, model, len(batch))
        dimension = len(validated[0])
        if expected_dimension is None:
            expected_dimension = dimension
        elif expected_dimension != dimension:
            raise ValueError("embedding dimension changed across loopback batches")
        vectors.extend(validated)
    if len(vectors) != len(texts):
        raise ValueError("loopback embedding response is incomplete")
    return vectors


def measure(envelope, opener=urllib.request.urlopen):
    validated = validate_envelope(envelope)
    original = bakeoff.embed_texts

    def fixed_embed(texts, backend="endpoint", base_url=None, model=None, api_key=None,
                    batch_size=None, timeout=None, dim=None):
        del backend, base_url, api_key, batch_size, timeout, dim
        if model != validated["model"]:
            raise ValueError("bake-off requested a model outside the admitted envelope")
        return invoke_fixed_loopback(
            model,
            texts,
            validated["execution_limits"]["max_cpu_threads"],
            opener=opener,
        )

    with tempfile.TemporaryDirectory(prefix="williamos-r1b-measure-") as root:
        paths = {}
        for name in ("model", "runtime", "host"):
            path = os.path.join(root, f"{name}.json")
            with open(path, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(validated[f"{name}_manifest"], handle, ensure_ascii=False,
                          sort_keys=True, separators=(",", ":"))
                handle.write("\n")
            paths[name] = path
        try:
            bakeoff.embed_texts = fixed_embed
            return bakeoff.run(
                CORPUS_DIR, "endpoint", BASE_URL, validated["model"], None, 10,
                validated["model_manifest"]["dimension"],
                model_manifest_path=paths["model"],
                runtime_manifest_path=paths["runtime"],
                host_manifest_path=paths["host"],
            )
        finally:
            bakeoff.embed_texts = original


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            raise ValueError("execution envelope exceeds the byte ceiling")
        envelope = json.loads(raw.decode("utf-8"))
        result = measure(envelope)
        sys.stdout.write(json.dumps(result, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":")) + "\n")
        return 0
    except Exception as error:
        sys.stderr.write(json.dumps({
            "schema_version": "1.0-r1b-fabric-measurement-error",
            "status": "FAILED_CLOSED",
            "detail": str(error),
            "external_provider_used": False,
            "fallback_used": False,
            "scheduler_activated": False,
            "autonomous_dispatch": False,
        }, sort_keys=True, separators=(",", ":")) + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
