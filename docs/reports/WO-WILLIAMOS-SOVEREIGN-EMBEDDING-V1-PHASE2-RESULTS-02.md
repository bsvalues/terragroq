# WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1 — Phase 2 Results 02 (expanded candidates, hardened corpus)

**Status:** quality ranking only. Hardware/throughput deliberately excluded (measured next).
**No model or dimension is frozen by this document.**

## Setup

- **Corpus:** hardened set, 49 documents / 80 queries (adversarial old-vs-current, near-duplicate
  authority configs, statutory ad-valorem / IAAO-COD / TAV terminology, OCR-noise, code-symbol,
  EN/ES/FR cross-lingual, "not-this-but-that", and keyword-sharing false-positive traps). No
  protected / county / PACS data. On this corpus the lexical (bag-of-words) floor is
  Recall@5 0.878, MRR 0.823, near-dup discrimination 0.70, false-positive rate 0.20 — i.e. the
  corpus now punishes keyword matching, giving neural models room to separate.
- **Protocol:** OpenAI-compatible `/v1/embeddings`, cosine on L2-normalized vectors,
  Recall@5/10, MRR, nDCG@10, near-dup discrimination, false-positive rate, 1000-sample percentile
  bootstrap 95% CIs on MRR and nDCG@10.
- **Execution:** isolated AEGIS CPU only (bench Ollama on :11500 in its own volume; HF-only models
  via a sentence-transformers `/v1` server on :11600). Production Ollama :11434 untouched.
  **This run is hardware-independent (CPU) — it is the quality ranking, not a speed ranking.**

## Results (sorted by MRR)

| Model | ~params | dim | R@5 | R@10 | MRR | MRR CI95 | nDCG@10 | nDCG CI95 | near-dup | FP |
|---|---|---|---|---|---|---|---|---|---|---|
| **bge-m3** | 568M | 1024 | 0.993 | 0.993 | **0.977** | [0.947, 1.000] | 0.976 | [0.952, 0.995] | 0.9 | 0.0 |
| embeddinggemma † | 308M | 768 | 0.987 | 1.000 | 0.960 | [0.921, 0.991] | 0.966 | [0.938, 0.990] | 0.9 | 0.0 |
| qwen3-embedding:8b | 8B | 4096 | 1.000 | 1.000 | 0.944 | [0.904, 0.978] | 0.956 | [0.926, 0.981] | 0.8 | 0.0 |
| snowflake-arctic-embed2 | 568M | 1024 | 0.973 | 1.000 | 0.939 | [0.888, 0.982] | 0.951 | [0.912, 0.984] | 0.8 | 0.0 |
| **granite-embedding-311m-multilingual-r2** | 311M | 768 | 0.980 | 0.987 | 0.934 | [0.888, 0.973] | 0.944 | [0.905, 0.977] | 0.8 | 0.0 |
| **granite-embedding-97m-multilingual-r2** | 97M | 384 | 0.980 | 1.000 | 0.933 | [0.888, 0.973] | 0.945 | [0.910, 0.977] | 0.7 | 0.0 |
| qwen3-embedding:4b | 4B | 2560 | 0.993 | 1.000 | 0.922 | [0.880, 0.962] | 0.937 | [0.905, 0.966] | 0.8 | 0.0 |
| qwen3-embedding:0.6b | 0.6B | 1024 | 1.000 | 1.000 | 0.889 | [0.836, 0.936] | 0.915 | [0.874, 0.950] | 0.7 | 0.0 |

† embeddinggemma retained **in evidence only** — Gemma license must be cleared separately before it
is eligible; it is not a selectable finalist until then.

## Reading the numbers honestly

1. **Recall is saturated; it is no longer the discriminator.** Even on the hardened corpus every
   neural model lands R@5 0.97–1.00. The signal that still separates them is **MRR (is the #1 hit
   correct)** and **near-dup discrimination**. Rank on MRR, not recall.

2. **bge-m3 is the only CI-robust leader.** Its MRR CI lower bound (0.947) sits at or above every
   other model's *point* estimate. No other pair is separable — granite-311m / granite-97m /
   snowflake / qwen3-4b have fully overlapping CIs and are statistically a tie.

3. **Granite R2 thesis — CONFIRMED.** granite-97m-r2 (97M params, **384-dim**) and granite-311m-r2
   (311M, 768-dim) essentially tie each other (MRR 0.933 / 0.934), match snowflake (0.939), and beat
   *both* larger Qwen3 4B and 0.6B. A 97M / 384-dim encoder matching 568M–8B models is exactly the
   "near the top, cheap enough to run anywhere" result you predicted. Storage upside is real: 384-dim
   is ~2.7× smaller than 1024-dim and ~10× smaller than qwen3:8b's 4096-dim in the pgvector index.

4. **Scale did not buy quality here.** qwen3 0.6b < 4b < 8b in MRR (as expected within a family), but
   even qwen3:8b (4096-dim) lost to bge-m3 (1024-dim) and did not beat embeddinggemma. The
   dimension/footprint cost of Qwen3 4B/8B is **not** justified by quality on this corpus.

5. **Every neural model beat the false-positive trap** (FP 0.0 vs lexical 0.20). The remaining
   weakness is near-dup authority discrimination (0.7–0.9) — bge-m3 and embeddinggemma best it (0.9).

## Caveats (why nothing freezes yet)

- This is a **synthetic** corpus. It is now hard for lexical, but strong encoders still saturate
  recall — the real WilliamOS memory corpus is the corpus that should decide the freeze.
- **Quality only.** Throughput, latency, cold/warm load, and RAM/VRAM across topology A (ATLAS
  K2200/CPU), B (HERMES 3050), C (OMEN 5060) are **not** measured here and may re-rank on the
  "cheap enough to run anywhere" axis (favoring granite-97m / 384-dim).
- CIs are wide (n=80). Treat the middle of the table as one indistinguishable band.

## Provisional shortlist to carry into the perf/topology round (non-binding)

- **bge-m3** (1024-dim) — quality leader, CI-robust.
- **granite-embedding-97m-multilingual-r2** (384-dim) — near-equal quality at ~6× smaller footprint;
  the storage + ubiquity play. **granite-embedding-311m-multilingual-r2** (768-dim) as the middle option.
- **qwen3-embedding:0.6b** — keep only as a fast efficiency baseline.
- **Drop for cause:** qwen3:4b / qwen3:8b (no quality justification for their 2560/4096-dim footprint).
- **Held:** embeddinggemma (Gemma license clearance required before eligibility).

**Next:** perf/topology runs (embeddings/sec, latency, RAM/VRAM; cold vs warm) for the shortlist on
B=HERMES and A=ATLAS(K2200 vs CPU), OMEN owner-coordinated — then the vector-contract freeze decides
model + dimension against the real memory corpus. **No freeze in this document.**
