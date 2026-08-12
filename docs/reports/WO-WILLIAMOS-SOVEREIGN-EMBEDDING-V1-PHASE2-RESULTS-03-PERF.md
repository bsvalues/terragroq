# WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1 — Phase 2 Results 03 (perf, topology-D / CPU)

**Axis:** hardware/throughput, kept separate from quality (Results 02). **No freeze.**

## Why CPU-only

AEGIS capability probe (2026-08-12): **no NVIDIA driver** (`nvidia-smi` absent), **no container GPU
runtime** (docker default `runc`, no `nvidia-ctk`), and the installed torch wheel targets **sm_75+**
while the lab K2200s are Maxwell **sm_50** (dropped by modern wheels regardless). So AEGIS can only
measure **topology-D (CPU)** today. A real GPU/topology comparison (topology A=ATLAS K2200,
B=HERMES 3050, C=OMEN 5060) requires either an owner-authorized driver+toolkit install on AEGIS or
running on the GPU'd nodes — **owner decision, and those are production inference nodes.**

## CPU results (isolated AEGIS, warm; 30 single-text reqs + 49-doc batch)

| Model | dim | serving | single p50 (ms) | single p95 (ms) | throughput (texts/s) | proc RSS |
|---|---|---|---|---|---|---|
| **granite-97m-r2** | 384 | sentence-transformers | **53** | 68 | **12.8** | ~1.2 GB |
| granite-311m-r2 | 768 | sentence-transformers | 105 | 136 | 4.6 | ~1.45 GB |
| qwen3-embedding:0.6b | 1024 | Ollama | 534 | 607 | 5.1 | n/a* |
| bge-m3 | 1024 | Ollama | 652 | 751 | 6.6 | n/a* |
| snowflake-arctic-embed2 | 1024 | Ollama | 731 | 804 | 6.3 | n/a* |

\* Ollama container `docker stats` reported 42–54 MiB — that is the API process, **not** the model
runner (a 568M model cannot fit in 42 MiB); Ollama's real footprint was not captured this run. Do
not read those as model memory.

## Honest caveats (this is not a clean cross-model compute comparison)

1. **Cross-backend, not apples-to-apples.** granite runs in an in-process sentence-transformers/torch
   server; the others run through Ollama's HTTP + llama.cpp scheduler. The large single-text latency
   gap (53 ms vs ~650 ms) is dominated by Ollama's per-request server overhead, **not** proof that
   granite's compute is ~12× cheaper. Treat within-backend comparisons as sound
   (granite-97m vs 311m; the three Ollama models vs each other) and cross-backend as directional.
2. **Cold load excluded** (warm measurement). Cold start / VRAM residency is a separate GPU-round metric.
3. **Ollama memory not captured** (see \*). Redo with runner-process RSS or `ollama ps` if footprint matters.

## What survives the caveats

- **granite-97m-r2 is the efficiency winner on every axis measured:** lowest latency, highest
  throughput, **smallest vectors (384-dim)**, and it already had near-top retrieval quality
  (Results 02, MRR 0.933 ≈ the 568M–8B field). The "near the top, cheap enough to run anywhere"
  thesis holds on **both** quality and CPU-perf.
- granite-311m-r2 (768-dim) is the middle option: ~2.8× the batch cost of 97m (tracks its ~3.2× params).
- Among the Ollama 1024-dim models, throughput is close (bge-m3 6.6 ≥ snowflake 6.3 ≥ qwen3-0.6b 5.1);
  bge-m3 remains the quality leader, so it is the natural 1024-dim reference.

## Standing recommendation (unchanged, non-binding, no freeze)

Carry **bge-m3** (1024-dim quality leader) and **granite-97m-r2** (384-dim efficiency+near-top-quality)
as the two live finalists, with **granite-311m-r2** (768-dim) as the middle option, into a **GPU
round** once the owner decides where it runs. The freeze still waits on the GPU round **and** the real
WilliamOS memory corpus.
