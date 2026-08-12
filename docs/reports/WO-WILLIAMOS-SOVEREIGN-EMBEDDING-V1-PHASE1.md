# WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1 — Phase 1: current-model discovery + Phase 2 spec

Method: a current-August-2026 web survey (training cutoff is January 2026, so the landscape was
re-checked live). Selection is **not** by public-benchmark rank alone; MTEB v2 (2026) is not
comparable to v1 and ranks vary across English v2 / MMTEB. Candidates were **not** limited to models
already in Ollama, and span materially different classes. **No model or dimension is frozen here** —
Phase 1 outputs a shortlist + the Phase 2 harness spec.

## 1. Broad candidate inventory (by class)

- **Dense general / instruction-aware:** Qwen3-Embedding (0.6B / 4B / 8B), gte-Qwen2, e5-mistral-7b-instruct, stella-1.5B.
- **Multilingual / multi-functional workhorse:** BGE-M3, Snowflake Arctic Embed L v2.0, Granite Embedding Multilingual R2 (IBM), Jina v5-text-small.
- **Small / efficient (on-device, CPU/weak-GPU):** EmbeddingGemma-300M (Google), Nomic Embed Text v2 (MoE), Granite-small, arctic-embed-m.
- **Code-specialized:** Jina Code Embeddings (0.5B / 1.5B), CodeXEmbed / SFR (400M–7B), Qwen3-Embedding (code-capable).
- **Multimodal (visual docs/tables/charts):** Jina Embeddings v4 (Qwen2.5-VL-3B based).
- **Late-interaction / rerank-adjacent (Phase-2 second stage, not embedding-contract candidates):** BGE-M3 multi-vector (ColBERT-style, same forward pass), jina-colbert-v2; rerankers BGE-reranker-v2-m3, Qwen3-Reranker, jina-reranker-v3 (0.6B, BEIR 61.94 nDCG@10).

## 2. Shortlist (~8 serious candidates, across distinct classes)

Attributes per candidate: license · dims · max ctx · size · runtime · CPU/CUDA · node fit. (Where a
value is marked *verify*, Phase 2 confirms it from the model card before any freeze.)

1. **Qwen3-Embedding-4B** — Apache-2.0 · MRL dims {32…2560} · 32K ctx · ~2.5–4 GB (Q4/Q8) · 100+ langs incl code · instruction-aware · runtimes: Transformers/vLLM/llama.cpp/Ollama · CUDA yes; CPU slow-but-viable · **fit:** HERMES/OMEN GPU, ATLAS/AEGIS CPU. *Flagship dense/instruction.*
2. **Qwen3-Embedding-0.6B** — Apache-2.0 · MRL {32…1024} · 32K ctx · ~1.2 GB · same family, efficiency anchor · Ollama/llama.cpp/Transformers · CPU-viable · **fit:** every node incl K2200/CPU. *Head-to-head vs 4B on quality/dimension.*
3. **BGE-M3** — MIT · 1024 · 8192 ctx · ~2.2 GB (568M) · 100+ langs · dense **+ sparse + ColBERT multi-vector in one pass** (lets us test late-interaction cheaply) · Transformers/FlagEmbedding/Ollama · CPU-viable · **fit:** all incl K2200/CPU. *Production multilingual workhorse + BGE-reranker-v2.*
4. **Snowflake Arctic Embed L v2.0** — Apache-2.0 · 1024 · ~568M · multilingual · strong domain nDCG (legal CUAD, medical) relevant to appraisal/records docs · Transformers/Ollama · CPU-viable · **fit:** all. *Domain-retrieval strength.*
5. **EmbeddingGemma-300M** — **Gemma license (usage terms — licensing caveat for full sovereignty)** · 768 (MRL 512/256/128) · 2048 ctx · <200 MB RAM quantized · 100+ langs · Ollama/llama.cpp/Transformers/ONNX · **best CPU/K2200 on-device** · **fit:** every node incl CPU. *Small/efficient champion.*
6. **Nomic Embed Text v2 (MoE)** — Apache-2.0 · 768 (v1.5 lineage; MRL) · 8192 ctx (v1.5) · **305M active params (MoE)** · strong quality/compute when GPU-limited · Transformers/Ollama/llama.cpp · CPU-viable · **fit:** all. *Distinct MoE architecture.*
7. **Jina Code Embeddings 1.5B** (or 0.5B) — **license *verify* (Jina weights are sometimes CC-BY-NC — a commercial/county risk)** · dims *verify* · code-specialized: text↔code, code↔code, 15+ langs; 0.5B scores 78.4% / 1.5B 79.0% across 25 code benchmarks (0.5B beats Qwen3-0.6B by ~5 pts on code) · Transformers/llama.cpp · CPU-viable (0.5B) · **fit:** all (0.5B), HERMES/OMEN (1.5B). *Code/config retrieval class.*
8. **Granite Embedding Multilingual R2 (IBM)** — Apache-2.0 · 384/768 · multilingual · small, enterprise-clean license · Transformers/Ollama · CPU-viable · **fit:** all incl CPU. *Clean-license efficient multilingual alternative.*

Optional top-quality/size contender to include **iff its license confirms Apache/permissive**:
**Jina v5-text-small** (677M, reported MTEB v2 71.7).

## 3. Elimination rationale (notable models not shortlisted)

- **Qwen3-Embedding-8B** — best raw quality (~70.58 MTEB, Q4 ~5 GB) but Q4 only comfortably fits **OMEN 8 GB** — the node we are explicitly *offloading*. Kept as an **upper-bound reference** to run on OMEN if desired, not a primary sovereign-host candidate.
- **Jina Embeddings v4 (multimodal, 3B VL)** — heavy + likely CC-BY-NC; multimodal not required for text/code retrieval yet. Reconsider only if visual-document retrieval becomes a requirement.
- **CodeXEmbed / SFR** — top code benchmark (CoIR) but Salesforce SFR weights are typically **non-commercial** — a real risk for a county/production system. Excluded pending license; jina-code covers the class if its license clears.
- **e5-mistral-7b-instruct / gte-Qwen2-7B / stella-1.5B** — strong but a prior generation, superseded by Qwen3-Embedding on quality with a cleaner (Apache) license; excluded to avoid near-clones.
- **OpenAI / Cohere / Voyage (API)** — not sovereign; excluded by definition (this WO exists to leave them).

## 4. Licensing gate (sovereignty)

- **Clean (Apache-2.0 / MIT) — preferred:** Qwen3-Embedding (all), BGE-M3, Arctic v2, Nomic v2, Granite R2, (Jina v5-text-small if Apache).
- **Caveat (permissive-with-terms):** EmbeddingGemma (Gemma license — local weights but Google usage terms).
- **Risk (non-commercial):** some Jina model weights, SFR/CodeXEmbed — **must confirm before shortlisting for anything county/production-facing.**

## 5. Phase 2 — bake-off harness specification

`scripts/embedding-bakeoff/` (author under this WO; runs on AEGIS-orchestrated, embeds via the
per-host service):
- **runner** — for (model × host × runtime): load corpus, embed all chunks + queries, compute
  similarities, produce ranked results per query; record all Phase-2 measurements.
- **quality** — score gold-labeled queries (§7 metrics); emit a per-model report.
- **perf** — embeddings/sec (single + batch 32/64), p50/p95 latency, RAM/VRAM peak, CPU%, warm vs
  cold load, practicality note.
- **manifest** — record model version + weight hash + runtime + host + chunker version for every run
  (feeds the Phase-3 contract). No secrets in artifacts.

## 6. Known-answer WilliamOS/TerraFusion retrieval corpus

- **Sources (no protected/county/PACS data):** WilliamOS governance docs (playbook, WOs, ledgers),
  synthetic/public appraisal-domain docs, repo code/config (`schema.ts`, scripts, TS/mjs),
  long-form markdown, and a few multilingual snippets.
- **Chunking:** one versioned chunker (record the version); fixed for the bake-off so model is the
  only variable.
- **Gold queries (~50–100)** with known correct chunk(s): factual, code ("where is the CAPG
  `pre_tool_call` hook?"), config ("what port does `williamos-postgres` bind?"), long-document
  (answer buried deep), **near-duplicate** (two similar chunks, one correct), a few multilingual,
  and **false-positive traps** (queries with no correct answer → should retrieve nothing
  high-confidence).

## 7. Metrics (quality dominates speed)

Recall@5, Recall@10, MRR, nDCG@10, false-positive rate, near-duplicate discrimination,
code/config-retrieval accuracy (subset), long-document retrieval (subset). Quality ranking selects
the model; performance is a feasibility filter / tie-breaker, never the driver.

## 8. Hardware / runtime measurement plan

Nodes: OMEN RTX 5060 8 GB · HERMES RTX 3050 6 GB · ATLAS K2200 4 GB + CPU · AEGIS K2200 4 GB + CPU.
Topology to measure (do **not** assume K2200 acceleration helps — Maxwell CC 5.0, no flash-attn;
CPU may win for small models):
```
A. embeddings on ATLAS (co-located with DB/retrieval)   B. on HERMES
C. on OMEN (upper-bound / offload-conflict noted)        D. CPU-only service
```
AEGIS orchestrates; each host runs the embedding service for its runs. OMEN runs are owner-driven /
via an OMEN-hosted harness (not reachable from the current controller).

## 9. No freeze

Phase 1 delivers this shortlist + Phase-2 spec only. Model/version/hash, dimension N, normalization,
and metric are frozen **in Phase 3**, after the measured bake-off, then the Neon manifest gate, then
schema mutation.

## Sources
- BentoML — Open-source embedding models 2026: https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models
- Milvus — Best embedding model for RAG 2026: https://milvus.io/blog/choose-embedding-model-rag-2026.md
- Qwen3-Embedding-8B (HF): https://huggingface.co/Qwen/Qwen3-Embedding-8B ; series: https://github.com/QwenLM/Qwen3-Embedding
- EmbeddingGemma model card: https://ai.google.dev/gemma/docs/embeddinggemma/model_card ; HF: https://huggingface.co/google/embeddinggemma-300m
- Snowflake Arctic Embed v2 / Nomic v2 / Jina v4 (Mixpeek 2026): https://mixpeek.com/curated-lists/best-embedding-models
- Jina Code Embeddings: https://jina.ai/news/jina-code-embeddings-sota-code-retrieval-at-0-5b-and-1-5b/ ; HF: https://huggingface.co/jinaai/jina-code-embeddings-1.5b
- CodeXEmbed (arXiv): https://arxiv.org/pdf/2411.12644
- jina-reranker-v3 / late interaction: https://jina.ai/models/jina-reranker-v3/
- Morph — Ollama embedding models 2026 (VRAM/dims): https://www.morphllm.com/ollama-embedding-models
