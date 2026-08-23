# 15 — Package Delta: Whole-Fabric Correction

This file records the normative delta created by the 2026-08-23 whole-fabric review.

## Added primitives

- node dependency class;
- `FabricLink`;
- intra-node topology evidence;
- memory-hierarchy profiling;
- transfer-cost-aware placement;
- `PipelinePlan` for stage placement;
- disposable cache hierarchy;
- distributed-inference maturity ladder;
- hardware ROI contract.

## Delivery interpretation changes

- IF-02 means whole-fabric discovery for HERMES, AEGIS, ATLAS and opportunistic OMEN, including material links.
- IF-05 benchmarks node + runtime + model + memory hierarchy + material links, not model/GPU alone.
- IF-06 placement includes data locality, transfer/startup cost and node dependency class.
- IF-08 reservations remain resource-specific; cross-node stages do not imply shared physical VRAM.
- IF-12 Environment detail can expose stage placement in Technical view, but normal work remains topology-invisible.
- IF-13 chaos includes opportunistic OMEN disappearance, link degradation and derived-cache loss.

## Non-change

HERMES remains resident supervisor. AEGIS remains governed heavy execution. ATLAS remains durable WilliamOS state/RAG/evidence authority. OMEN remains nonessential cockpit/opportunistic acceleration. No new scheduler or workflow engine is authorized.
