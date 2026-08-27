# 11 — IF-02 Whole-Fabric Discovery Acceptance Addendum

IF-02 is interpreted as whole-resident-fabric discovery, not HERMES-only discovery.

## Required nodes

Reconcile current truth for HERMES, AEGIS, ATLAS and OMEN. Additional nodes may be discovered but must not be inferred from historical notes.

## Required observations

Per node, where applicable:

- role/dependency class;
- CPU topology/capacity;
- system RAM capacity and measured bandwidth when material;
- accelerator identity, VRAM, health, driver/runtime compatibility;
- PCIe negotiated generation/width and measured host-to-device bandwidth when material;
- storage/model-load characteristics;
- active runtimes and freshness;
- current reservations/load;
- trust/classification constraints.

Per material pair/link:

- transport;
- measured bandwidth;
- p50/p95 latency;
- reliability/freshness;
- policy/trust boundary.

## Mandatory proofs

1. OMEN is classified opportunistic and can disappear without resident-system failure.
2. HERMES remains resident supervisor; discovery does not redefine node roles.
3. AEGIS repository/build/test execution remains governed through the existing execution backend.
4. ATLAS remains durable state/evidence/RAG authority and supports data-local processing candidates without bulk-copy assumptions.
5. Stale node/link observations never become AVAILABLE placement capacity.
6. No new raw SSH/topology registry is introduced.
7. Discovery results are sufficient to estimate model/context transfer cost for later shadow placement.
8. Exact unknowns are preserved as UNKNOWN rather than guessed.

## Output

Produce:

- `FabricTopologySnapshot` or current-main-equivalent projection;
- per-node bottleneck baseline;
- material FabricLink measurements;
- exact evidence refs;
- recommended IF-05 benchmark matrix;
- no hardware-purchase recommendation until measurement is complete.
