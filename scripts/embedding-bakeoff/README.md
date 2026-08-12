# WilliamOS sovereign-embedding bake-off (Phase 2 harness + corpus)

Stdlib-only Python harness for `WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1` Phase 2. It scores candidate
embedding models on a **known-answer** WilliamOS/TerraFusion retrieval corpus so that **quality
decides the model** (speed is a feasibility filter, never the driver). It does **not** freeze a
model or dimension — that is Phase 3.

## Run

```bash
# Deterministic lexical baseline (no model — the quality floor + self-test):
python3 bakeoff.py --backend lexical

# A real model via any OpenAI-compatible /v1/embeddings endpoint (Ollama, vLLM, llama.cpp, ...):
BASE_URL=http://127.0.0.1:11434/v1 MODEL=bge-m3 python3 bakeoff.py --backend endpoint --out results/bge-m3.json
```

The app/harness knows only the OpenAI wire format — no provider is hard-coded. Point `BASE_URL` at
whichever node hosts the model (topology A ATLAS / B HERMES / C OMEN / D CPU-only).

## Self-test (offline, no model)

```bash
python3 test_bakeoff.py
```
Verifies metric correctness and runs the full pipeline with the lexical backend.

## Metrics (quality dominates speed)

Recall@5, Recall@10, MRR, nDCG@10, false-positive rate (top-1 similarity on no-gold trap queries vs
an adaptive threshold), near-duplicate discrimination (does the correct chunk outrank its
near-duplicate distractor?), and per-category Recall@5 by query type.

## Corpus (`corpus/`)

- `documents.jsonl` — `{id, source, kind, text}`. 34 chunks: WilliamOS governance, repo code, deploy
  config, synthetic **public** appraisal-domain concepts, two long documents with a buried answer, a
  near-duplicate pair (sovereign `williamos-postgres` :15432 vs TerraFusion `tf-postgres` :5432), and
  Spanish twins. **No protected / county / PACS data.**
- `queries.jsonl` — `{id, type, query, gold:[doc_ids], distractor?}`. 40 gold queries across
  factual, code, config, near-dup, long-doc, multilingual, and false-positive (no-gold trap) types.

Extend by adding rows (the WO targets 50–100 queries). Keep the chunker/corpus fixed within a
bake-off so the model is the only variable; the manifest records a corpus fingerprint per run.

## What this measures per node (Phase 2 hardware plan)

For each `model × host × runtime`, also record embeddings/sec, single + batch latency, RAM/VRAM
peak, CPU%, warm vs cold load. Do **not** assume the K2200 helps — measure CPU-only vs K2200. The
run manifest records model + backend + host + dimension + corpus fingerprint (no secrets).

## Outputs

`bakeoff.py --out results/<model>.json` writes `{summary, manifest, per_query}`. Compare `summary`
across candidates; the winner feeds the **Phase 3 vector-contract freeze** (model + version + hash +
dimension + normalization + metric), which is gated separately. No canonical vectors are written by
this harness.
