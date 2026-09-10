# 14 — Distributed Inference Maturity Ladder

## Purpose

Prevent WilliamOS from over-engineering token-level distributed inference across ordinary LAN links when stage-level distribution yields better reliability and efficiency.

## Level 0 — Single-node execution

Run the complete inference on one qualified node. Preferred when it satisfies capability, context, latency, privacy and cost requirements.

## Level 1 — Stage-level fabric distribution

Keep model execution whole where possible while placing retrieval, reranking, preprocessing, reasoning, repository execution, validation, review and persistence on the nodes best suited to each stage.

This is the primary distributed-intelligence strategy for V1.

## Level 2 — External/shared cache

Permit prefix/KV/semantic/cache sharing only when:

- canonical Thread continuity does not depend on the cache;
- runtime support is proven;
- link bandwidth/latency makes the transfer beneficial;
- classification policy permits transfer;
- cache provenance/staleness is explicit.

## Level 3 — Prefill/decode disaggregation

Admit only when exact runtime/version/hardware/link capability is MEASURED/PROVEN. Do not assume support from documentation alone. Ordinary LAN latency/bandwidth may make this worse than single-node serving.

## Level 4 — Tensor/pipeline/expert distribution

Admit only with independently proven runtime and interconnect characteristics. A theoretical multi-node feature does not establish useful production capability.

## Hard rule

Ethernet reachability is not high-speed accelerator interconnect capability.

Do not represent two GPUs on different WilliamOS nodes as one physical VRAM pool unless the exact runtime/interconnect proves jointly addressable memory semantics.

## Evaluation

Every advancement above Level 1 must beat the lower level on the intended workload after including transfer, synchronization, startup, failure and recovery costs.
