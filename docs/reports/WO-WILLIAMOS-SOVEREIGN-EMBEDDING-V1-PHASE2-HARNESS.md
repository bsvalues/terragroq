# R1B Sovereign Embedding Phase 2 Harness

**Work Order:** `WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1`

**Parent:** Issue `#638`

**Risk:** R1 repository-only harness and evidence contract

## Authority and reservation

The owner directed WilliamOS to continue R1B and use the proven AEGIS standing `HASH_VERIFY`
capability for real embedding-bakeoff integrity evidence. This phase reserves only:

```text
scripts/embedding-bakeoff/**
docs/reports/WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1-PHASE2-HARNESS.md
```

It does not grant an embedding-model execution adapter, model download, external provider, database
probe or mutation, re-index, vector-dimension change, canonical-vector write, or scheduler authority.

## Superseded evidence

PRs `#690`, `#694`, and `#697` are useful design inputs but are not executable or acceptance
evidence. In particular, the seven AEGIS measurements reported by `#697` are not credited because
they predate the frozen corpus, lack admitted workload authority and raw result manifests, and carry
incorrect topology assumptions. The later `#697` `corpus_real` addition is not silently substituted:
this successor selects and pins `williamos-r1b-adversarial-v1` (49 documents / 80 queries) as the
single Phase 2 corpus. Its manifest binds counts, calibration IDs, source hashes, and fingerprint.

## Fail-closed harness contract

The corrected evaluator:

- fingerprints canonical, order-independent corpus content including scoring labels, query types,
  distractors, and the calibration split;
- validates unique corpus identifiers and every gold/distractor reference;
- accepts only literal loopback/private-IP endpoints; all DNS names fail closed;
- requires exact model, runtime, and host manifests for endpoint runs;
- rejects missing, duplicate, incomplete, non-finite, misindexed, or mixed-dimension endpoint rows;
- separates fixed calibration queries from evaluation queries for false-positive measurement;
- creates the output directory before inference and writes results atomically;
- records exact corpus file hashes, caller-declared model/runtime/host manifests, dimensions, and
  timings without treating those declarations as independent attestation;
- writes no canonical vectors and performs no database operation.

## Standing HASH_VERIFY consumer

`evidence.py` creates deterministic artifacts for the existing AEGIS standing integrity lane:

1. `corpus-bundle.json`
2. `model-runtime-manifest.json`
3. `result-bundle.json`
4. `evidence-package.json`

`standing-hash-targets.json` binds the expected SHA-256 of all four. The complete package is
validated in memory, then published as one immutable content-addressed generation so a failed rebuild
cannot mix old targets with new results. It is an integrity request description, not autonomous
dispatch and not an AEGIS authority expansion. It is explicitly integrity-only: standing
`HASH_VERIFY` proves retained bytes, not host identity, model weights, runtime provenance, execution,
or absence of an external provider. Those facts require a separately admitted workload and trusted
collector before execution evidence can be claimed.

## Remaining gates

The next execution packet must derive current topology from the reviewed Fabric inventory and assign
each candidate to an already-authorized provider or a separately admitted bounded embedding-bakeoff
adapter. It must include Granite R2 multilingual and Qwen3 Embedding 4B. The owner has authorized an
OMEN 8B upper-bound comparison, but it requires a separate bounded execution packet that reconciles
the heavy-work offload policy; this repository harness does not execute it. AEGIS remains `HASH_VERIFY`-only until a real
workload justifies a separately reviewed execution capability.

No model or vector dimension is selected in this phase. Neon classification and any schema/re-index
work remain later, separately gated steps.
