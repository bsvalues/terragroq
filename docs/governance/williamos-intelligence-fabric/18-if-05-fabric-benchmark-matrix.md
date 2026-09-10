# 18 — IF-05 Fabric Benchmark Matrix

## Per-node baseline

For each participating node, measure the subset relevant to its role:

- CPU throughput;
- host RAM capacity/bandwidth;
- accelerator compute/VRAM;
- PCIe negotiated topology and host-to-device throughput;
- storage/model-load throughput;
- runtime cold/warm behavior;
- thermal/sustained stability;
- representative task performance.

## Per-link baseline

For material node pairs:

- p50/p95 latency;
- sustained throughput for small/medium/large transfers;
- concurrent transfer behavior if relevant;
- reliability/variance;
- classification/trust policy.

## End-to-end workload classes

Benchmark at least:

1. ATLAS-local retrieval -> ContextPackage -> HERMES reasoning.
2. HERMES reasoning -> AEGIS bounded implementation -> validation -> evidence.
3. HERMES local model execution under warm/cold/cache-loss states.
4. OMEN opportunistic inference/vision candidate with disconnect recovery.
5. FreeToken candidate on exact supported HERMES hardware if IF-05F admits evaluation.
6. Frontier-provider alternative where current authority allows measurement.

## Required derived metrics

- bytes moved per delivered outcome;
- time spent transferring versus computing;
- cold-start percentage;
- owner-visible latency;
- throughput under concurrent work;
- failure/recovery cost;
- cost per accepted outcome where monetary cost exists.

## Principle

A benchmark that measures isolated tokens/sec but ignores context movement, model load, queue, validation and recovery is insufficient for WilliamOS placement policy.
