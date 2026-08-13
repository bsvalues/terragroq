"""Fail-closed local ONNX backend for Granite Embedding R2 311M."""

from __future__ import annotations

import importlib
import json
import math
import os
from pathlib import Path
from typing import Any, Sequence


_DIMENSION = 768
_EXECUTION_SEQUENCE_LENGTH = 512
_MODEL_MAX_POSITION_EMBEDDINGS = 32768
_MAX_BATCH_SIZE = 8
_MAX_INPUTS = 256
_MAX_CPU_THREADS = 64
_EXPECTED_FILES = {
    "onnx/model_quint8_avx2.onnx": Path("onnx/model_quint8_avx2.onnx"),
    "tokenizer.json": Path("tokenizer.json"),
    "config.json": Path("config.json"),
    "1_Pooling/config.json": Path("1_Pooling/config.json"),
}
_POOLING_FLAGS = (
    "pooling_mode_cls_token",
    "pooling_mode_mean_tokens",
    "pooling_mode_max_tokens",
    "pooling_mode_mean_sqrt_len_tokens",
    "pooling_mode_weightedmean_tokens",
    "pooling_mode_lasttoken",
)

__all__ = ["embed_texts"]


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def _load_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle, object_pairs_hook=_reject_duplicate_keys)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid model configuration: {path}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"model configuration must be an object: {path}")
    return value


def _validate_root(model_root: os.PathLike[str] | str) -> dict[str, Path]:
    if not isinstance(model_root, (str, os.PathLike)):
        raise TypeError("model_root must be a path")
    root = Path(model_root)
    if not root.is_dir():
        raise ValueError("model_root must be an existing directory")
    paths = {name: root / relative for name, relative in _EXPECTED_FILES.items()}
    missing = [name for name, path in paths.items() if not path.is_file()]
    if missing:
        raise ValueError("missing required model files: " + ", ".join(missing))
    return paths


def _validate_inputs(texts: Sequence[str], max_cpu_threads: int) -> list[str]:
    if isinstance(texts, (str, bytes)) or not isinstance(texts, Sequence):
        raise TypeError("texts must be a sequence of strings")
    if not 1 <= len(texts) <= _MAX_INPUTS:
        raise ValueError(f"texts must contain between 1 and {_MAX_INPUTS} inputs")
    values = list(texts)
    for text in values:
        if not isinstance(text, str) or not text.strip():
            raise ValueError("every input text must be a non-empty string")
    if isinstance(max_cpu_threads, bool) or not isinstance(max_cpu_threads, int):
        raise TypeError("max_cpu_threads must be an integer")
    if not 1 <= max_cpu_threads <= _MAX_CPU_THREADS:
        raise ValueError(f"max_cpu_threads must be between 1 and {_MAX_CPU_THREADS}")
    return values


def _load_model_contract(paths: dict[str, Path]) -> tuple[int, int]:
    model_config = _load_json(paths["config.json"])
    pooling_config = _load_json(paths["1_Pooling/config.json"])

    hidden_size = model_config.get("hidden_size")
    model_max_length = model_config.get("max_position_embeddings")
    pad_token_id = model_config.get("pad_token_id")
    if isinstance(hidden_size, bool) or hidden_size != _DIMENSION:
        raise ValueError("config.json hidden_size must be 768")
    if isinstance(model_max_length, bool) or not isinstance(model_max_length, int):
        raise ValueError("config.json max_position_embeddings must be an integer")
    if model_max_length < _EXECUTION_SEQUENCE_LENGTH:
        raise ValueError("model position capacity is below the execution truncation length")
    if model_max_length != _MODEL_MAX_POSITION_EMBEDDINGS:
        raise ValueError("config.json max_position_embeddings must be 32768")
    if isinstance(pad_token_id, bool) or not isinstance(pad_token_id, int) or pad_token_id < 0:
        raise ValueError("config.json pad_token_id must be a non-negative integer")

    dimension = pooling_config.get("word_embedding_dimension")
    if isinstance(dimension, bool) or dimension != _DIMENSION:
        raise ValueError("pooling dimension must be 768")
    for flag in _POOLING_FLAGS:
        if type(pooling_config.get(flag)) is not bool:
            raise ValueError(f"pooling config requires boolean {flag}")
    if not pooling_config["pooling_mode_cls_token"]:
        raise ValueError("pooling config must enable CLS pooling")
    if any(pooling_config[flag] for flag in _POOLING_FLAGS[1:]):
        raise ValueError("pooling config must enable CLS pooling only")
    for key, value in pooling_config.items():
        if key.startswith("pooling_mode_") and key not in _POOLING_FLAGS and value is not False:
            raise ValueError(f"unsupported pooling mode: {key}")
    return _EXECUTION_SEQUENCE_LENGTH, pad_token_id


def _configure_tokenizer(tokenizers: Any, tokenizer_path: Path, max_length: int,
                         pad_token_id: int) -> Any:
    tokenizer_type = getattr(tokenizers, "Tokenizer", None)
    if tokenizer_type is None or not callable(getattr(tokenizer_type, "from_file", None)):
        raise RuntimeError("tokenizers.Tokenizer is unavailable")
    tokenizer = tokenizer_type.from_file(str(tokenizer_path))
    pad_token = tokenizer.id_to_token(pad_token_id)
    if not isinstance(pad_token, str) or not pad_token:
        raise ValueError("tokenizer does not define config.json pad_token_id")
    tokenizer.enable_truncation(
        max_length=max_length,
        direction="right",
        strategy="longest_first",
    )
    tokenizer.enable_padding(
        direction="right",
        pad_id=pad_token_id,
        pad_token=pad_token,
        length=max_length,
        pad_to_multiple_of=None,
    )
    return tokenizer


def _rank(value: Any) -> int | None:
    shape = getattr(value, "shape", None)
    return len(shape) if isinstance(shape, (list, tuple)) else None


def _create_session(ort: Any, model_path: Path, max_cpu_threads: int) -> tuple[Any, str]:
    options = ort.SessionOptions()
    options.intra_op_num_threads = max_cpu_threads
    options.inter_op_num_threads = 1
    if hasattr(ort, "ExecutionMode"):
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

    session = ort.InferenceSession(
        str(model_path),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )
    disable_fallback = getattr(session, "disable_fallback", None)
    if not callable(disable_fallback):
        raise RuntimeError("onnxruntime session cannot disable provider fallback")
    disable_fallback()
    if session.get_providers() != ["CPUExecutionProvider"]:
        raise RuntimeError("onnxruntime must activate CPUExecutionProvider only")

    inputs = session.get_inputs()
    if len(inputs) != 2 or {item.name for item in inputs} != {"input_ids", "attention_mask"}:
        raise ValueError("ONNX model inputs must be exactly input_ids and attention_mask")
    if any(getattr(item, "type", None) != "tensor(int64)" or _rank(item) != 2
           for item in inputs):
        raise ValueError("ONNX inputs must be rank-2 int64 tensors")

    outputs = session.get_outputs()
    if len(outputs) != 1 or _rank(outputs[0]) != 3:
        raise ValueError("ONNX model must expose exactly one rank-3 output")
    output_shape = outputs[0].shape
    if isinstance(output_shape[2], int) and output_shape[2] != _DIMENSION:
        raise ValueError("ONNX output dimension must be 768")
    if getattr(outputs[0], "type", None) not in ("tensor(float)", "tensor(double)"):
        raise ValueError("ONNX output must be a floating-point tensor")
    return session, outputs[0].name


def _encode_batch(tokenizer: Any, np: Any, texts: list[str], max_length: int) -> dict[str, Any]:
    encodings = tokenizer.encode_batch(texts, add_special_tokens=True)
    if len(encodings) != len(texts):
        raise ValueError("tokenizer returned an unexpected encoding count")
    input_ids: list[list[int]] = []
    attention_mask: list[list[int]] = []
    for encoding in encodings:
        ids = list(encoding.ids)
        mask = list(encoding.attention_mask)
        if len(ids) != max_length or len(mask) != max_length:
            raise ValueError("tokenizer did not apply fixed-length padding and truncation")
        if any(isinstance(item, bool) or not isinstance(item, int) or item < 0 for item in ids):
            raise ValueError("tokenizer produced invalid input_ids")
        if any(type(item) is not int or item not in (0, 1) for item in mask) or not any(mask):
            raise ValueError("tokenizer produced an invalid attention_mask")
        input_ids.append(ids)
        attention_mask.append(mask)
    return {
        "input_ids": np.asarray(input_ids, dtype=np.int64),
        "attention_mask": np.asarray(attention_mask, dtype=np.int64),
    }


def _pool_and_normalize(np: Any, output: Any, batch_size: int,
                        sequence_length: int) -> list[list[float]]:
    tensor = np.asarray(output)
    if tuple(tensor.shape) != (batch_size, sequence_length, _DIMENSION):
        raise ValueError("ONNX output shape does not match [batch, sequence, 768]")
    rows = tensor.tolist()
    result: list[list[float]] = []
    for row in rows:
        cls_vector = row[0]
        if len(cls_vector) != _DIMENSION:
            raise ValueError("CLS embedding dimension must be 768")
        values = [float(item) for item in cls_vector]
        if not all(math.isfinite(item) for item in values):
            raise ValueError("CLS embedding contains non-finite values")
        norm = math.sqrt(math.fsum(item * item for item in values))
        if not math.isfinite(norm) or norm <= 0.0:
            raise ValueError("CLS embedding has a zero or non-finite norm")
        normalized = [item / norm for item in values]
        if not all(math.isfinite(item) for item in normalized):
            raise ValueError("normalized embedding contains non-finite values")
        result.append(normalized)
    return result


def embed_texts(model_root: os.PathLike[str] | str, texts: Sequence[str],
                max_cpu_threads: int) -> list[list[float]]:
    """Embed non-empty texts with a strictly local Granite R2 ONNX model."""
    values = _validate_inputs(texts, max_cpu_threads)
    paths = _validate_root(model_root)
    max_length, pad_token_id = _load_model_contract(paths)

    try:
        tokenizers = importlib.import_module("tokenizers")
        ort = importlib.import_module("onnxruntime")
        np = importlib.import_module("numpy")
    except ImportError as exc:
        raise RuntimeError(f"required local embedding dependency is unavailable: {exc.name}") from exc

    tokenizer = _configure_tokenizer(
        tokenizers, paths["tokenizer.json"], max_length, pad_token_id,
    )
    session, output_name = _create_session(
        ort, paths["onnx/model_quint8_avx2.onnx"], max_cpu_threads,
    )

    embeddings: list[list[float]] = []
    for offset in range(0, len(values), _MAX_BATCH_SIZE):
        batch = values[offset:offset + _MAX_BATCH_SIZE]
        feeds = _encode_batch(tokenizer, np, batch, max_length)
        outputs = session.run([output_name], feeds)
        if not isinstance(outputs, (list, tuple)) or len(outputs) != 1:
            raise ValueError("onnxruntime returned an unexpected output count")
        embeddings.extend(_pool_and_normalize(np, outputs[0], len(batch), max_length))
    return embeddings
