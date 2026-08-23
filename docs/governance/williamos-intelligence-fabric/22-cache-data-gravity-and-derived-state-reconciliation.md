# 22 — Cache, Data Gravity + Derived State Reconciliation

## Purpose

Define how WilliamOS uses caches and data-local execution across HERMES/ATLAS/AEGIS/OMEN without allowing derived acceleration state to become canonical truth or causing unnecessary data movement.

## Core rule

**Canonical state is durable and reconstructible; caches are disposable accelerators.**

Losing every cache may make WilliamOS slower, but may not make WilliamOS forget settled truth, lose a Thread, lose an Artifact, or misstate authority.

## Cache classes

At minimum model separately:

- embedding cache;
- retrieval/rerank cache;
- prefix cache;
- KV cache;
- semantic/anchor cache;
- model weight cache;
- runtime/compiled-engine cache;
- FreeToken expert cache;
- document/chunk/index cache;
- transformed/derived model artifact cache.

Each cache record should identify source identity/digest, owning runtime/node, sensitivity/compartment, validity conditions, created/observed time, invalidation source, approximate size and reconstructibility.

## Data gravity

Placement should minimize unnecessary byte movement and protect authoritative stores.

Prefer stage-level execution near data when the result can be safely reduced to a smaller governed artifact/context package.

Example:

`ATLAS corpus -> local retrieve/rerank -> compact ContextPackage -> HERMES reason`

rather than moving a full corpus to HERMES.

Likewise, repository/build/test work should remain close to the governed AEGIS execution environment when that reduces transfer and preserves execution authority.

## Movement cost

Placement cost must be able to include:

- source bytes transferred;
- expected transfer time;
- model/artifact load transfer;
- cache warmup/rebuild cost;
- link contention;
- storage I/O pressure;
- security/trust transition cost;
- effect on ATLAS durable-state latency;
- OMEN availability/preemptibility.

Fast compute on the wrong side of an expensive transfer may lose to slower local compute.

## Cache authority

Caches do not mint authority. A cached ContextPackage, semantic summary, KV state or embedding is never stronger than its canonical sources.

Cache provenance must permit validation against current source revisions/policy before reuse in consequential work.

## Context and privacy

Caches inherit the sensitivity/egress constraints of their source context unless an explicit reviewed transformation changes that classification.

In particular:

- KV/prefix/semantic caches may contain sensitive prompt/context information;
- embeddings are not presumed non-sensitive;
- remote/cloud caches require explicit lifecycle/wipe policy;
- OMEN opportunistic caches must be safely disposable when OMEN disappears;
- personal/private caches may not be reused in professional/project contexts without policy permission.

## Distributed cache maturity ladder

Adopt progressively:

1. local runtime caches;
2. node-local persistent reusable caches where safe;
3. stage-local caches close to authoritative data;
4. cross-node cache transfer only when measured beneficial;
5. remote/disaggregated KV or prefill/decode only after link/runtime capability is proven;
6. token-level/expert/tensor distribution only on measured interconnects appropriate to that runtime.

Ordinary LAN is not assumed equivalent to PCIe/NVLink/RDMA.

## ATLAS doctrine

ATLAS is durable-state/data-gravity infrastructure. Retrieval/indexing near ATLAS may be beneficial, but noisy cache construction or batch inference may not impair authoritative-state latency without explicit placement headroom evidence.

## OMEN doctrine

OMEN is opportunistic. Cache placement on OMEN must never become required for resident continuation. Its disappearance invalidates/removes a candidate optimization and triggers bounded reconstruction/replacement if necessary.

## Restart/recovery

After node/runtime restart, cache/residency state is UNKNOWN until reconstructed from trusted observation or invalidated. Do not trust stale persisted cache metadata merely because a file/key exists.

## Hardware-efficiency consequence

IF-05/IF-02 should measure when the dominant bottleneck is:

- compute;
- VRAM capacity;
- KV capacity;
- host RAM capacity/bandwidth;
- PCIe bandwidth;
- storage/model load;
- LAN transfer;
- authoritative-data I/O contention;
- cache miss/rebuild rate.

Hardware ROI recommendations should be based on the dominant measured bottleneck, not model parameter count alone.

## Acceptance

PASS requires:

1. canonical/derived/cache state are explicitly separated;
2. cache loss cannot lose canonical work/context/authority;
3. source revision/policy changes invalidate affected caches;
4. privacy/compartment constraints follow cached derivatives;
5. placement accounts for byte movement and rebuild cost;
6. ATLAS data locality is exploited without violating state-protection headroom;
7. OMEN cache loss is non-fatal;
8. cross-node KV/cache reuse remains gated by measured capability;
9. cloud cache teardown/wipe evidence integrates with elastic lifecycle;
10. one chaos test destroys all noncanonical caches and proves WilliamOS reconstructs and continues correctly.

Failure code: `FAILED_CACHE_DERIVED_STATE_BOUNDARY`.