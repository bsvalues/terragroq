# WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1 — Phase 2B Results (REAL WilliamOS/TerraFusion corpus)

**Scratch-only quality round. No canonical vectors, no production DB writes, no freeze.**
**Headline metric: CURRENT_TRUTH_DISCRIMINATION** — can the retriever choose the current
authoritative record over a semantically near-identical *superseded* one.

## Setup

- **Corpus (`corpus_real/`, committed as evidence):** 52 docs / 47 queries grounded in the actual
  repo — 7 current-vs-superseded architecture pairs (inference seam, DB authority, Vercel, auth-origin,
  worker kernel, embedding freeze, dev offload), one-clause authority/CAPG contracts, Work Orders +
  successors, PR outcome records with real merge commits (63b2787 / 2929a69 / 005f9c9 / 5cb2dba /
  8e728e8), hardware topology, runtime config, code-vs-prose, TerraFusion + statutory terminology
  (generic — NO protected/county/PACS data), multilingual variants. **14 current-truth queries** (both
  directions: pick-current and pick-superseded).
- CPU (hardware-independent quality). Isolated AEGIS; production :11434 untouched. Qwen3-8B run twice
  (with/without task instruction) to test instruction-aware retrieval.

## Results (sorted by current-truth discrimination, then MRR)

| Model | dim | R@5 | MRR | MRR CI95 | near-dup | **current-truth** |
|---|---|---|---|---|---|---|
| **snowflake-arctic-embed2** | 1024 | 1.00 | **0.942** | [0.891, 0.986] | **0.96** | **1.00** |
| qwen3:8b (no instr) | 4096 | 1.00 | 0.920 | [0.862, 0.967] | 0.88 | 0.929 |
| bge-m3 | 1024 | 0.935 | 0.876 | [0.794, 0.947] | 0.84 | 0.929 |
| granite-311m-r2 | 768 | 0.978 | 0.870 | [0.794, 0.939] | 0.84 | 0.857 |
| granite-97m-r2 | 384 | 1.00 | 0.875 | [0.802, 0.939] | 0.76 | 0.786 |
| qwen3:8b **+instr** | 4096 | 0.935 | 0.717 | [0.622, 0.818] | 0.76 | 0.786 |

## What changed vs the synthetic corpus (this is the point)

1. **The ranking flipped. snowflake-arctic-embed2 is the real-corpus leader** on every meaningful
   axis — best MRR, best near-dup (0.96), and **perfect current-truth discrimination (14/14)**.
   **bge-m3, the synthetic leader, dropped to mid-pack** (MRR 0.876; missed a config query, per-cat
   config 0.5; current-truth 13/14). Real WilliamOS material rewarded a different model. Your call to
   let the real corpus decide was correct.

2. **The compact Granite trade-off is now precise.** granite-97m-r2 (384-dim) keeps perfect
   Recall@5 and MRR on par with bge-m3, but its weakness is exactly the WilliamOS-critical axis:
   **current-truth discrimination 0.786 (11/14)** and near-dup 0.76 — i.e. on ~3 of 14 it let a
   *superseded* record outrank the current one. granite-311m-r2 sits between (0.857). So the compact
   model is superb for general recall/efficiency but measurably weaker at "current beats superseded."

3. **The Qwen task instruction HURT — measured, not assumed.** qwen3:8b MRR fell 0.920 → 0.717 and
   current-truth 0.929 → 0.786 with the instruction prepended. Prepending an instruction to the query
   side only (as served via Ollama) shifted query vectors away from the plain-text docs. Whatever the
   cause, on our material naive instruction-prefixing is a net negative — so we do **not** adopt it.
   (qwen3:8b without instruction is strong, but its 4096-dim footprint isn't justified when a
   1024-dim model beats it.)

## Honest caveats (do not over-read)

- **false_positive_rate is unreliable this run — ignore it.** The corpus has only ONE no-gold query
  and the threshold is the median of gold top-1 cosines; on a small tight corpus every neural top-1
  clears that threshold, so FP reads 1.0 as an artifact, not a real failure. Fixing it needs several
  no-gold traps and a margin-based (top1−top2) or absolute-floor threshold. Deferred.
- **Small corpus (n=47, 14 current-truth) → wide CIs.** MRR CIs overlap across the top four; the
  decisive, non-overlapping signal is current-truth discrimination (snowflake 1.00 vs granite-97m 0.786).
- **Numerical note (for the freeze proof):** CPU/GPU/backend embeddings are model-dependent but NOT
  guaranteed bit-identical — different kernels/precision cause small numeric differences that should
  not change retrieval ordering materially. The eventual freeze proof must test equivalence **within
  tolerance**, not exact vector-byte identity.

## Narrowed field for the HERMES perf round (a)

The contest is no longer "all embeddings." It is:

- **snowflake-arctic-embed2** (Apache-2.0, 1024-dim) — **real-corpus quality leader**, and
- **granite-embedding-97m-multilingual-r2** (Apache-2.0, 384-dim) — extreme efficiency, near-top
  recall, but weaker on strict current-truth discrimination,

with **granite-311m-r2** (768-dim) and **qwen3:8b** (no instr) as controls. bge-m3 is demoted by the
real evidence but kept as a control. The GPU round answers the deployment question: does the quality
winner run cheaply enough on HERMES, or does Granite-97M give nearly the same real retrieval quality
at dramatically lower operational cost — knowing Granite-97M costs some current-truth accuracy?

**No freeze until the HERMES perf round and the Neon classification are both complete.**
