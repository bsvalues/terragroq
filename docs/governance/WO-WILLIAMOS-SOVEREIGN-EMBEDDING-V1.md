# WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1 — sovereign embedding contract (R1B / #638 gate)

## Outcome

Select and **prove** the sovereign embedding stack for WilliamOS retrieval/memory **before any
canonical data enters ATLAS**. This is the last active architecture-drift gate on #638: embeddings
still route through the OpenAI/Vercel gateway (`openai/text-embedding-3-small`, 1536-dim). #638 can
close truthfully only after this WO closes.

**Hard rule:** no placeholder/TBD embedding model, no premature dimension freeze, no mixed vector
spaces. The empty ATLAS sovereign DB is the luxury that lets us choose the vector space correctly
before canonical data enters it — use it.

## Phase 1 — current model discovery (August 2026)

A **current** open/local embedding review — do **not** anchor to last-generation assumptions
(mxbai/nomic) or constrain candidates to "already pulled in Ollama." Survey current strong
open/self-hostable embedding models and record, per candidate:

- retrieval quality (the dominant criterion)
- semantic similarity behavior
- code/config/document retrieval (relevant to TerraFusion/WilliamOS)
- long-input support (context length)
- multilingual usefulness
- output dimensions
- model size (params, on-disk)
- quantization support
- license (must permit sovereign self-host)
- runtime compatibility (Ollama / llama.cpp / vLLM / sentence-transformers / ONNX / CPU)

Output: a shortlist of candidates that clear licensing + runtime + quality-plausibility, with the
evidence recorded. Candidates are **not** pre-filtered by Ollama availability alone.

## Phase 2 — hardware bake-off (quality dominates speed)

### Retrieval-quality harness (the deciding factor)
Build a small, known-answer **WilliamOS/TerraFusion retrieval corpus**: documents + questions whose
correct source chunks are known in advance. Score each candidate:

- Recall@5, Recall@10
- MRR, nDCG
- false-positive retrieval rate
- near-duplicate discrimination
- code/config retrieval accuracy
- long-document chunk retrieval

Quality ranking decides the model. Speed is a tie-breaker / feasibility filter, never the driver.

### Performance + topology
Nodes and their compute:
```
OMEN    RTX 5060 8GB
HERMES  RTX 3050 6GB
ATLAS   K2200 4GB + CPU
AEGIS   K2200 4GB + CPU
```
Measure per candidate × host: embeddings/sec, single + batch latency, RAM, VRAM, CPU utilization,
warm vs cold load, power/runtime practicality.

Topology choices to test (do **not** assume K2200 acceleration helps — measure it; CPU may win):
```
A. embeddings hosted on ATLAS (co-located with the DB/retrieval)
B. embeddings hosted on HERMES
C. embeddings hosted on OMEN
D. CPU-only embedding service
```

## Phase 3 — vector contract freeze (the part that matters most)

Record the sovereign embedding contract exactly:
```
model            : exact model / version / weight hash
dimensions       : N
normalization    : explicit (e.g. L2-normalized on write and query, or none)
distance metric  : cosine / inner product / L2 — explicit and matched to the model
chunking         : versioned separately from the model (chunker version recorded)
provenance       : model source + license + runtime + host recorded
mixed spaces     : FORBIDDEN — every stored vector shares one model + dimension + metric
runtime location : the chosen host/service (per Phase 2)
```

## Neon manifest gate (before any schema mutation)

Classify Neon's `document_chunk` / `memory_fact` using the existing read-only tooling
(`scripts/db/neon-state-probe.mjs` + `db-state-manifest.mjs`, owner runs locally with the secret):
```
if empty / provably non-canonical:
    NO_CANONICAL_STATE  → no re-index needed
if canonical:
    preserve SOURCE text + metadata
    DO NOT preserve the old OpenAI (1536-dim) vectors as canonical
    regenerate vectors in the chosen sovereign space
```

## Schema mutation (only after Phase 3 + Neon gate)

```
lib/db/schema.ts              document_chunk.embedding / memory_fact.embedding → vector(N)
drizzle/0000_williamos_init   #650 bootstrap DDL → vector(N)
ATLAS sovereign DB            reinitialize cleanly at the new dimension (empty → trivial)
lib/ai/embeddings.ts          embed via the sovereign seam (WILLIAMOS_AI_BASE_URL / chosen runtime)
lib/ai/config.ts              EMBEDDING_MODEL / EMBEDDING_DIMENSIONS → the frozen contract
```
Then re-embed canonical source (if any) and re-verify with the #655 harness.

## Closes the gate

Only after the model is chosen + frozen (Phase 3), Neon is classified, embeddings are moved off the
gateway and (re-)embedded in the sovereign space, and tests/build are clean can **#638 close
truthfully**.

## Constraints

- No canonical embedding-backed data written until the contract is frozen.
- No mixed vector spaces, ever.
- Sovereign/self-hostable license only; no new external embedding dependency.
- Preserve the AEGIS offload (heavy work on AEGIS, not OMEN).
