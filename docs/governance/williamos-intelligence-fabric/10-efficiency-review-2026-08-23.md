# 10 — Efficiency / Enhancement Review — 2026-08-23

## Review purpose

Validate #964/#965 against the real four-node WilliamOS architecture and identify missing efficiency primitives before implementation.

## Findings adopted

1. Local intelligence means the whole resident fabric, not HERMES-only.
2. Compute placement must include measured fabric links and transfer cost.
3. Node roles matter: HERMES supervisor/inference, AEGIS heavy execution, ATLAS durable state/data-local services, OMEN opportunistic acceleration.
4. Data locality should minimize bytes moved across nodes.
5. One owner outcome may require stage-level placement rather than one node/model assignment.
6. Derived caches are disposable accelerators; canonical Thread/Context continuity must survive cache loss.
7. Intra-node topology matters for MoE/offload runtimes: DRAM bandwidth, PCIe width/generation, H2D bandwidth, NUMA, model-load storage.
8. Distributed inference must follow a maturity ladder and cannot assume LAN equals NVLink/RDMA.
9. Hardware recommendations must be derived from measured bottleneck/ROI, not GPU-first intuition.
10. OMEN compute must be explicitly opportunistic/nonessential.

## Required package changes

- Add `FabricLink` and node dependency-class semantics.
- Add `PipelinePlan` as a placement description, explicitly not a new scheduler.
- Expand IF-02 from HERMES/local discovery to whole-fabric topology/capacity/link discovery.
- Expand IF-05 performance evaluation to include node/link bottleneck profiles and transfer/startup costs.
- Require removal of OMEN during active opportunistic work as an acceptance scenario.
- Require ATLAS data-local retrieval and AEGIS local execution proofs.
- Require Inspect/Technical provenance for cross-node stage placement.
- Require hardware ROI report before purchase recommendations driven by the Fabric program.

## Design consequence

The target is distributed intelligence execution, not indiscriminate distributed token inference.

Preferred progression:

`single-node execution -> stage-level fabric placement -> cache sharing when measured -> advanced disaggregation only when runtime/interconnect capability is proven`

This preserves simplicity, authority boundaries and reliability while still allowing WilliamOS to exploit heterogeneous hardware.
