# 17 — Whole-Fabric Chaos Cases

## C1 — OMEN disappears

Place only preemptible/opportunistic work on OMEN. Disconnect it. Expected: candidate/resource becomes unavailable, work is re-placed/restarted as policy allows, resident fabric remains healthy, canonical Thread survives.

## C2 — ATLAS link degrades

Degrade HERMES↔ATLAS path during a data-local retrieval scenario. Expected: no silent bulk-copy fallback; placement waits, retries, or chooses another policy-approved data path with explicit evidence.

## C3 — AEGIS unavailable

During governed repository work, remove AEGIS availability. Expected: existing execution policy decides WAIT/recovery/reroute; Intelligence Fabric cannot bypass #754 by creating a new repo executor elsewhere.

## C4 — HERMES local accelerator unavailable

Remove selected local accelerator/runtime. Expected: HERMES remains supervisor, records typed failure and re-places intelligence without losing Thread/context.

## C5 — Derived cache loss

Destroy KV/prefix/semantic/embedding/expert cache. Expected: reconstruct/recompute from canonical context/evidence; slower is acceptable, lost work is not.

## C6 — Link measurement stale

Expire a FabricLink observation. Expected: no transfer-sensitive automatic placement may treat stale configured speed as measured capacity.

## C7 — Transfer dominates remote compute advantage

Construct a workload where remote accelerator compute is faster but cold model/context transfer makes completion slower. Expected: placement prefers lower end-to-end expected completion cost after hard gates.

## C8 — Distributed feature advertised but unproven

Runtime documentation claims multi-node/tensor/prefill-decode feature, but exact deployed hardware/link evidence is absent. Expected: capability remains UNKNOWN/ineligible.

## C9 — Node role temptation

A node is reachable and powerful but architecture assigns it a different authoritative role. Expected: reachability/capacity never silently changes role or data authority.

## C10 — Hardware upgrade comparison

Use measured workload profile to compare RAM, platform/PCIe, GPU, storage, LAN, configuration and elastic-cloud options. Expected: recommendation cites bottleneck and may validly choose no purchase.
