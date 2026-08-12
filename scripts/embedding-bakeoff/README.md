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
BASE_URL=http://127.0.0.1:11434/v1 MODEL=<exact-model-id> python3 bakeoff.py \
  --backend endpoint \
  --model-manifest manifests/model.json \
  --runtime-manifest manifests/runtime.json \
  --host-manifest manifests/host.json \
  --out results/model.json
```

The app/harness knows only the OpenAI wire format — no provider is hard-coded. Point `BASE_URL` at
an admitted private/loopback Fabric endpoint. External endpoint hostnames fail closed. Node placement
must come from the current execution-fabric inventory; do not infer GPU hardware from stale docs.

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

- `documents.jsonl` — `{id, source, kind, text}`. 49 chunks: WilliamOS governance, repo code, deploy
  config, synthetic **public** appraisal-domain concepts, two long documents with a buried answer, a
  near-duplicate pair (sovereign `williamos-postgres` :15432 vs TerraFusion `tf-postgres` :5432), and
  Spanish twins. **No protected / county / PACS data.**
- `queries.jsonl` — `{id, type, query, gold:[doc_ids], distractor?}`. 80 queries across
  factual, code, config, near-dup, long-doc, multilingual, and false-positive (no-gold trap) types.

The fingerprint is order-independent and binds every evaluation-relevant field, including labels,
types, distractors, and the fixed calibration split. Keep the corpus frozen within one bake-off.

## What this measures per node (Phase 2 hardware plan)

For each `model × host × runtime`, retain exact model, runtime, and host manifests plus measured
throughput/timing. Resource telemetry and warm/cold measurements belong in the admitted node lane;
the harness does not invent them. OMEN is an upper-bound measurement lane, HERMES is the existing
local-AI node, AEGIS is CPU/verification, and ATLAS remains authoritative state. No GPU is assumed.

## Outputs

`bakeoff.py --out results/<model>.json` writes `{summary, manifest, per_query}`. Compare `summary`
across candidates; the winner feeds the **Phase 3 vector-contract freeze** (model + version + hash +
dimension + normalization + metric), which is gated separately. No canonical vectors are written by
this harness.

## Integrity evidence

After a valid admitted run, build the deterministic evidence package:

```bash
python3 evidence.py --corpus corpus \
  --model-manifest manifests/model.json \
  --runtime-manifest manifests/runtime.json \
  --host-manifest manifests/host.json \
  --result results/model.json \
  --out-dir results/model-evidence
```

Each run is written as one immutable `generations/<evidence-package-sha256>/` directory only after
the complete result and provenance chain validates. `standing-hash-targets.json` exposes four exact
artifacts for the already-proven AEGIS
`HASH_VERIFY` capability: benchmark corpus, model/runtime manifest, result bundle, and evidence
package. Building this file does not dispatch work or expand AEGIS authority.
