# WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1 — Round (a): HERMES RTX 3050 GPU perf

**Isolated bench on the real HERMES node. Production Ollama `:11434` (llama3.2:3b) asserted healthy
before and after and never referenced. No freeze.**

## Setup

- **Node:** HERMES, NVIDIA RTX 3050 6 GB (driver 560.94), ~785 MiB resident by production llama3.2:3b.
- **Isolation:** bench containers only (`bench-ollama-hermes` / `bench-gr97`), ports 11500/11601,
  separate volumes; production container, model, config untouched. Integrity verified: production
  `:11434` still serving llama3.2:3b at the end.
- **Serving paths (as they would actually be deployed):** snowflake / bge-m3 via an isolated
  **Ollama-GPU** container; granite-97m via **sentence-transformers on CUDA** (Granite R2 multilingual
  is not an Ollama model). Client = 30 single-text requests (p50/p95) + 52-doc batch throughput.

## Results

| Model | dim | serving | single p50/p95 (ms) | batch (texts/s) | marginal VRAM | sustained |
|---|---|---|---|---|---|---|
| **snowflake-arctic-embed2** | 1024 | Ollama-GPU | 404 / 486 | 19.6 | **779 MiB** | 480 s, 934 req, 22% util |
| bge-m3 | 1024 | Ollama-GPU | 334 / 418 | 21.8 | 747 MiB | — |
| **granite-97m-r2** | 384 | ST-CUDA | **30 / 52** | **221** | **~65 MiB** | 180 s, 970 req, 29% util |

Cold model load: snowflake 4.1 s, bge-m3 3.7 s (Ollama). Granite cold-load not cleanly isolated
(dominated by container/pip warmup; model load is a few seconds once the HF cache is warm).

## Caveats (do not over-read the gap)

1. **Cross-backend — NOT apples-to-apples.** snowflake/bge run through Ollama's HTTP + llama.cpp
   scheduler (per-request overhead); granite runs in-process via sentence-transformers with efficient
   batching. The ~10× latency/VRAM/throughput gap is **inflated by backend**, not pure model compute.
   Both are, however, *realistic* serving configurations. Treat within-backend numbers as sound and
   cross-backend as directional.
2. **Numerical-equivalence note (for the freeze proof):** GPU and CPU embeddings are not guaranteed
   bit-identical; the freeze proof must test equivalence **within tolerance**, not byte identity.
3. Granite GPU perf used sentence-transformers 3.3.1 (the model card targets 5.1.1) — a **perf**
   measurement only; the retrieval-quality numbers came from the AEGIS run with a newer stack.

## What this answers — the deployment question

- **The quality winner runs comfortably and cheaply on HERMES.** snowflake-arctic-embed2 uses
  **779 MiB** marginal VRAM (total ~1.6 GB of 6 GB with production resident), only **22% GPU util**
  under an 8-minute sustained load, ~400 ms single / ~20 texts/s batch. It fits alongside the
  production model with room to spare. So *"is the real-corpus quality leader too expensive for
  HERMES?"* → **No.**
- **Granite-97m is dramatically cheaper still** (~65 MiB VRAM, ~30 ms latency, ~220 texts/s), but that
  advantage is only *decisive* where snowflake would **not** fit: the 4 GB K2200 nodes, CPU-only
  workers, high-concurrency bulk re-embedding, or 384-dim storage savings at large scale.

## Recommendation (non-binding; no freeze until Neon classification)

- **Primary sovereign embedding model: snowflake-arctic-embed2 (Apache-2.0, 1024-dim)** — it is the
  real-corpus quality leader (perfect current-truth discrimination) **and** it is cheap on the intended
  serving node. There is no operational pressure forcing a compact model, so its quality lead is
  affordable.
- **Retain granite-embedding-97m-multilingual-r2 (Apache-2.0, 384-dim) as the sanctioned efficiency /
  edge / bulk model** — for CPU/K2200 nodes and high-throughput or storage-constrained contexts, where
  it delivers near-top recall at a fraction of the cost (accepting its lower current-truth accuracy).

**Last gate before the Phase 3 vector-contract freeze: classify the Neon manifest (canonical vs
NO_CANONICAL_STATE).** Model + dimension are decided against evidence, not frozen here.
