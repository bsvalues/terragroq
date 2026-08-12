# WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1 — Phase 2 results run 01 (reachable nodes, CPU)

First measured bake-off run. 7 candidates pulled into an **isolated** Ollama on AEGIS (docker, CPU,
port 11500, own volume — the production :11434 was never touched) and scored on the 52-query
known-answer corpus. Embedding quality is model-dependent, not hardware-dependent, so this CPU run
is the decisive **quality** ranking; it is also the topology-D (CPU-only) data point. **No model or
dimension is frozen** — that is Phase 3, after corpus hardening, the GPU/perf runs, the larger
candidates, and the Neon classification.

## Overall

| model | Recall@5 | Recall@10 | MRR | nDCG@10 | near-dup | false-pos | license |
|---|---|---|---|---|---|---|---|
| bge-m3 | 0.990 | 0.990 | **0.979** | **0.977** | 1.00 | 0.00 | MIT |
| snowflake-arctic-embed2 | 0.979 | 1.000 | 0.966 | 0.974 | 1.00 | 0.00 | Apache-2.0 |
| embeddinggemma | 1.000 | 1.000 | 0.963 | 0.972 | 1.00 | 0.00 | Gemma (caveat) |
| qwen3-embedding:0.6b | 1.000 | 1.000 | 0.922 | 0.940 | 1.00 | 0.00 | Apache-2.0 |
| mxbai-embed-large | 1.000 | 1.000 | 0.940 | 0.950 | 1.00 | 0.00 | Apache-2.0 |
| nomic-embed-text | 0.969 | 0.979 | 0.935 | 0.940 | 1.00 | 0.00 | Apache-2.0 |
| granite-embedding | 0.969 | 1.000 | 0.947 | 0.954 | 1.00 | 0.00 | Apache-2.0 |
| _(lexical floor)_ | 0.906 | 0.938 | 0.844 | 0.858 | 1.00 | 0.00 | — |

## Per-category Recall@5 (the discriminator)

| model | factual | code | config | near-dup | long-doc | semantic | **cross-lingual** |
|---|---|---|---|---|---|---|---|
| bge-m3 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.944 | **1.00** |
| snowflake-arctic-embed2 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.889 | **1.00** |
| embeddinggemma | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.000 | **1.00** |
| qwen3-embedding:0.6b | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.000 | **1.00** |
| mxbai-embed-large | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.000 | **1.00** |
| nomic-embed-text | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.000 | **0.50** |
| granite-embedding | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.944 | **0.67** |

## Reading (preliminary, not a decision)

- The easy buckets (factual/code/config/near-dup/long-doc) saturate at 1.00 for every neural model
  — they do not separate the field. Signal lives in **cross-lingual**, **semantic**, and the
  ranking metrics (**MRR/nDCG**).
- **Cross-lingual is the clearest separator:** `nomic-embed-text` (0.50) and the default
  `granite-embedding` tag (0.67) are weak; the rest handle EN↔ES. For a multilingual/county context,
  that deprioritizes nomic and this granite tag (the Granite R2 *multilingual* variant should be
  tested before ruling the family out).
- **Best combined (ranking precision + multilingual + clean license):** `bge-m3` (MIT) and
  `snowflake-arctic-embed2` (Apache) lead. `embeddinggemma` matches on quality but carries the Gemma
  license caveat. `qwen3-embedding:0.6b` has perfect recall but ranks the correct chunk lower
  (MRR 0.922).

## Why this is not yet a freeze

- The corpus (52 queries) is small and still saturates the neural field on the easy buckets; it must
  grow toward 100+ and get harder (more adversarial semantic + cross-lingual + near-dup + noisy
  distractors) so neural-vs-neural separation is statistically meaningful.
- Larger candidates not yet run: `qwen3-embedding:4b` (and 8B as an OMEN-only upper bound), the
  Granite R2 *multilingual* tag, jina-code (license permitting) for the code bucket.
- Hardware/perf runs (embeddings/sec, latency, RAM/VRAM, warm/cold) per topology B (HERMES 3050) and
  A (ATLAS K2200 vs CPU) remain — quality decides, but feasibility on the chosen host matters.
- The Neon manifest classification (canonical vs NO_CANONICAL_STATE) must be done before schema
  mutation.

## Reproduce

```bash
docker run -d --name bench-ollama -p 127.0.0.1:11500:11434 -v bench_ollama:/root/.ollama ollama/ollama
docker exec bench-ollama ollama pull bge-m3
cd scripts/embedding-bakeoff
BASE_URL=http://127.0.0.1:11500/v1 MODEL=bge-m3 python3 bakeoff.py --backend endpoint --out results/bge-m3.json
```
Isolated instance only; never the production :11434.
