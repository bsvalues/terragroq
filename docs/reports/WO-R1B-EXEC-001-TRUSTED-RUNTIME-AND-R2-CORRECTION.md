# WO-R1B-EXEC-001 Trusted Runtime and Granite R2 Correction

**Issue:** `#704`

**Status:** implementation package in progress; live execution not yet admitted

## Owner decision

The owner approved one machine-owned Python runtime on HERMES and bounded local acquisition of
Qwen3 Embedding 4B plus the exact Granite R2 multilingual candidate. This supersedes the stale
pre-admission reference to `granite-embedding:278m`.

The Granite candidate is:

```text
repository: ibm-granite/granite-embedding-311m-multilingual-r2
revision: 44399559930365213510b1ee2eb15ded83374f0e
runtime: official quantized AVX2 ONNX artifact
dimension: 768
pooling: CLS followed by L2 normalization
```

The older `granite-embedding:278m` artifact is outside the recorded authority and may not be
substituted.

## Pinned acquisition boundary

The reviewed provisioning package pins:

- CPython `3.13.14` Windows x64 installer by URL, byte length, SHA-256, and Python Software
  Foundation Authenticode identity;
- a six-wheel offline runtime closure for ONNX Runtime, NumPy, Tokenizers, Protobuf, Packaging, and
  FlatBuffers;
- all nine required Granite repository artifacts at the exact immutable revision;
- `qwen3-embedding:4b` by the pre-pull registry manifest body and post-pull local manifest, config,
  and model-layer digests.

The Tokenizers package is installed with `--no-deps` and used only through local
`Tokenizer.from_file()`. Hugging Face Hub and network-client packages are deliberately absent from
the trusted execution closure. The Granite tokenizer is derived from the Gemma 3 tokenizer and its
tokenizer terms remain part of the artifact record; Apache-2.0 is not represented as the complete
tokenizer licensing statement.

## Execution separation

Qwen continues through the reviewed isolated Ollama loopback adapter. Granite R2 uses a distinct,
fixed local ONNX adapter because the selected ModernBERT R2 artifact is not an Ollama runtime
candidate. The Granite execution path has no network endpoint and cannot fall back to Ollama, an
external provider, or another local model.

Both paths remain bound to fresh trusted host evidence, one single-use admission, one exclusive
lease and fencing token, retained result evidence, identical-admission replay rejection, and release
cleanup. Live authority entries are created only after the implementation package is merged and the
machine-owned runtime and model bytes have been independently attested.

## Unchanged boundaries

```text
scheduler: OFF
autonomous selection: OFF
canonical vectors: forbidden
database writes/schema mutation: forbidden
external inference/provider fallback: forbidden
broader HERMES or AEGIS authority: forbidden
county/PACS: forbidden
destructive operations: forbidden
```

This package does not select a canonical embedding model or vector dimension. It only makes the two
authorized R1B candidates executable under bounded, separately reviewed evidence contracts.
