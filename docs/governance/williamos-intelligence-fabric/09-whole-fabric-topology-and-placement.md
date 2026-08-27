# 09 — Whole-Fabric Topology, Data Locality, and Stage Placement

## Purpose

WilliamOS Intelligence Fabric optimizes the entire resident fabric, not HERMES as a single computer.

The resident topology to reconcile from current truth is:

- HERMES — resident supervisor/control-plane host and primary local inference node;
- AEGIS — heavy development/data worker and repository/build/test execution target;
- ATLAS — durable WilliamOS state, RAG, evidence, database and data-local services;
- OMEN — owner cockpit/client and opportunistic accelerator only; never a required resident dependency;
- future elastic/private remote compute — ephemeral work-owned capacity.

These roles are owner-directed architectural intent, but exact hardware/runtime/link facts MUST be re-proven from current live evidence before placement.

## 1. Node dependency classes

Every fabric node/resource MUST declare a dependency class independent of capability:

- `RESIDENT_REQUIRED` — WilliamOS resident operation depends on the role.
- `RESIDENT_OPTIONAL` — normally resident but workload continuation can degrade/reroute without it.
- `OPPORTUNISTIC` — may accelerate work while available; disappearance cannot break canonical continuity.
- `EPHEMERAL` — provisioned for bounded work and destroyed after settlement.

OMEN MUST be treated as `OPPORTUNISTIC` for compute placement. Closing, sleeping, rebooting, disconnecting, or taking OMEN off-site removes a candidate; it does not create a resident-system failure.

## 2. FabricLink

Placement requires measured links as well as measured compute.

```ts
interface FabricLink {
  id: string
  fromNodeId: string
  toNodeId: string
  transportClass: string
  measuredBandwidthBytesPerSecond?: number
  latencyMsP50?: number
  latencyMsP95?: number
  reliability?: number
  trustClass: string
  observedAt?: string
  freshnessState: "LIVE" | "STALE" | "UNKNOWN" | "FAILED"
  evidenceRef?: string
}
```

A configured Ethernet speed is inventory, not measured usable throughput. Placement MUST use fresh measured link evidence when transfer cost is material.

## 3. Intra-node topology

A node is not a flat bucket of CPU/RAM/VRAM. Compute discovery should represent enough topology to explain material bottlenecks:

- CPU/socket and memory-channel topology where observable;
- NUMA domains where applicable;
- accelerator PCIe root/slot/generation/negotiated width;
- measured host-to-device bandwidth where relevant;
- accelerator peer-to-peer capability where present;
- storage device/path and measured read characteristics where model loading is material;
- runtime placement constraints.

Do not infer usable PCIe bandwidth from slot labeling alone.

## 4. Memory hierarchy

For inference-capable nodes, capacity/evidence should distinguish:

- accelerator weight/model memory;
- KV/cache memory;
- runtime overhead;
- host RAM capacity;
- host DRAM bandwidth;
- CPU expert/kernel throughput where applicable;
- host-to-device transfer bandwidth;
- storage/model-load bandwidth.

This is mandatory for runtimes such as FreeToken whose effective model envelope depends on VRAM + host RAM + CPU + PCIe behavior rather than VRAM alone.

## 5. Data-locality rule

The default optimization is **move the smallest governed representation necessary**, not move the largest dataset to the fastest processor.

Examples:

- ATLAS may perform data-local retrieval/filtering/reranking against durable corpora, then return a bounded ContextPackage to HERMES.
- AEGIS may perform repository/data inspection, builds, tests, transforms or compilation locally and return compact artifacts/evidence rather than moving entire workspaces.
- HERMES should retain latency-sensitive orchestration/reasoning when qualified, but must not require bulk canonical data replication merely for convenience.
- OMEN may receive bounded opportunistic work but must not become authoritative storage for Project, Thread, evidence, repository, queue, or protected corpora.

Every cross-node data movement remains subject to authority and classification policy even on the local LAN.

## 6. Transfer-cost-aware placement

For eligible candidates, placement cost SHOULD be able to include:

`expectedCompute + modelMovement + contextMovement + cacheMovement + startupLoad + queueDelay + monetaryCost + reliabilityPenalty`

Hard authority/privacy/capability/capacity gates still precede optimization.

A faster accelerator on another node may lose to a slower local accelerator if model/context transfer and cold-start costs dominate.

## 7. PipelinePlan

One owner outcome may contain multiple intelligence/execution stages with different optimal placements.

```ts
interface PipelinePlan {
  id: string
  workRef: string
  threadId?: string
  stages: Array<{
    id: string
    kind: string
    requirementId: string
    inputArtifactRefs: string[]
    outputContract: string
    placementDecisionId?: string
    dependencies: string[]
  }>
  evidenceRef?: string
}
```

Typical stages may include:

- retrieve;
- rerank;
- summarize/context-compile;
- reason;
- implement;
- validate;
- review;
- persist/index.

`PipelinePlan` is NOT a new scheduler, workflow engine, authority model, or Work Order lifecycle. HERMES and existing governed execution remain authoritative. It is a placement description/projection over existing work.

## 8. Stage placement examples

A valid outcome may place:

- retrieval on ATLAS;
- reranking on ATLAS or HERMES;
- reasoning on HERMES;
- repository implementation/validation on AEGIS;
- opportunistic vision/inference on OMEN while available;
- independent review on Codex/Claude/local reviewer;
- durable evidence/state on ATLAS.

The owner still experiences one WilliamOS Thread.

## 9. Cache hierarchy is disposable

KV cache, semantic cache, prefix cache, embedding cache, model cache and FreeToken expert cache are accelerators, not canonical memory.

Loss of any derived cache may reduce performance but MUST NOT destroy WilliamOS Thread/work continuity. Context Fabric and canonical durable state must be sufficient to reconstruct work.

Cache placement/transfer may be optimized only when runtime/link evidence shows value. Do not introduce LAN KV transfer merely because a runtime supports it.

## 10. Distributed inference maturity ladder

Prefer the cheapest robust architecture in this order:

1. whole execution on one qualified node;
2. stage-level distribution across fabric nodes;
3. external/shared cache where measured beneficial;
4. prefill/decode disaggregation when runtime + link capability is proven;
5. tensor/expert/pipeline distribution only with independently proven interconnect/runtime support.

Ordinary Ethernet MUST NOT be treated as NVLink/RDMA-class interconnect. Design may admit advanced distributed inference; production placement depends only on measured/proven support.

## 11. Hardware ROI evidence

IF-02/IF-05 should produce a bottleneck profile for material workload classes and important nodes/links. Recommendations for hardware upgrades MUST be evidence-based and compare marginal value of at least:

- host RAM capacity;
- host DRAM bandwidth / CPU platform;
- PCIe generation/lane topology;
- accelerator VRAM/compute;
- local storage/model-load performance;
- LAN bandwidth/latency;
- additional node capacity;
- elastic remote compute economics.

A recommended purchase should identify the measured bottleneck it removes and expected workload improvement. Do not default to "buy another GPU."

## 12. Whole-fabric acceptance

Before automatic placement is enabled, prove:

1. HERMES, AEGIS, ATLAS and OMEN identities/roles from canonical current truth;
2. fresh CPU/RAM/accelerator/runtime capacity per participating node;
3. measured links for material cross-node paths;
4. OMEN removal during active opportunistic work triggers typed re-placement without resident failure;
5. ATLAS data-local retrieval can return bounded context without bulk corpus transfer;
6. AEGIS execution remains local to its governed repository/work lifecycle;
7. caches can be deleted without canonical Thread loss;
8. placement evidence includes transfer/startup cost when material;
9. no stage placement creates a second scheduler/authority path;
10. Inspect/Technical can explain the cross-node path after completion without making topology part of normal owner operation.

## Controlling principle

> Do not build the biggest AI computer. Build a governed fabric that knows where each piece of intelligence should happen, keeps authoritative data where it belongs, and moves the minimum necessary bytes while preserving one continuous WilliamOS experience.
