# 27 — System Object Graph and Direct Operation Contract

## Finding

Current WilliamOS already has valuable truth and control primitives:

- Fabric node registry and brokered node probes;
- explicit unreachable/error reasons rather than silently dropping failed nodes;
- live-on-request probing for node status;
- System truth classes and configured-role versus live evidence distinction;
- reservations/fencing and bounded execution;
- Project/resource bindings, Work, Evidence and Authority.

However, current Fabric node APIs remain summary-shaped. GPU, memory, disk and service state is often emitted as strings attached to a node. That is sufficient for a status page but not for an operating environment where resources are selectable/operable first-class objects.

## Principle

Do not build a UI-only object database.

Create a canonical **SystemObject projection** over existing registries, probes, topology, reservations, runtime state, work/evidence and authority. A SystemObject is a projection/reference identity, not a new ownership authority.

## Minimum object kinds

V1 should be capable of projecting at least:

- `NODE` — HERMES, AEGIS, ATLAS, OMEN;
- `CPU` / CPU pool;
- `MEMORY_POOL` / meaningful DIMM/NUMA topology where available;
- `ACCELERATOR` — P40, RTX devices, future Gaudi/other accelerators;
- `DISK` / `VOLUME` / `DATASET`;
- `NETWORK_INTERFACE`;
- `FABRIC_LINK`;
- `SERVICE`;
- `CONTAINER` / isolated runtime where appropriate;
- `WORKLOAD` / execution;
- `MODEL_ARTIFACT`;
- `MODEL_RESIDENCY`;
- `RUNTIME`;
- `RESERVATION`;
- `PROJECT_RESOURCE`;
- `ELASTIC_WORKER` when present.

## Identity

Each object needs a stable canonical identity sourced from current truth where possible.

Human labels (`HERMES`, `P40`) are presentation aliases, not the sole identity. Hardware identity should prefer durable attributes such as GPU UUID/PCI location/serial where available, disk identifiers/UUIDs, interface identity, canonical node identity, etc.

Replacement hardware must not silently inherit historical identity merely because it occupies the same slot or receives the same friendly name.

## Projection contract

A SystemObject projection should expose, where applicable:

- canonical ID;
- human label;
- kind;
- parent/contains relationships;
- connected-to/topology relationships;
- owner-directed role;
- current truth state (`live/persisted/inferred/unknown/stale` as applicable);
- observed-at/freshness;
- health/headroom;
- current consumers/work;
- reservations;
- available deterministic actions;
- required authority for each action;
- evidence/history references;
- technical identity details under progressive disclosure.

## Action contract

Actions are canonical capabilities, not button implementations.

Examples:

- inspect;
- benchmark;
- drain workload placement;
- reserve/release;
- evict an admitted model residency;
- start/stop/restart an approved service;
- mount/unmount where already governed;
- run health/SMART/probe;
- open contextual terminal/execution surface;
- change a governed operating profile.

Every mutation action must resolve through existing authority/execution/fencing mechanisms. The object graph may advertise that an action exists; it does not grant the action.

## Deterministic-first behavior

Questions such as:

- `what is using P40 memory?`
- `how hot is HERMES?`
- `which service owns this port?`
- `what is filling this volume?`

should be answered from canonical/live system projections when sufficient. Use an LLM only when interpretation/synthesis is actually needed.

## Temporal/cause model

Objects should support:

- NOW;
- TREND;
- HISTORY;
- CAUSE / correlated changes.

Do not infer causality merely from temporal coincidence. Present correlation as correlation unless evidence/provenance supports stronger language.

## Semantic zoom

Navigation should follow object relationships rather than requiring page taxonomy.

Example:

`SYSTEM -> HERMES -> ACCELERATORS -> P40 -> MODEL RESIDENCIES -> Qwen`

or

`SYSTEM -> ATLAS -> STORAGE -> FORGE -> CONSUMERS`

The same selected object can project into full Environment, Inspector, HUD, command search, phone and voice.

## Digital-twin direction

Physical topology may eventually be rendered spatially, but the renderer must consume the canonical object/topology projection. Do not encode actual hardware truth in an SVG/component tree.

A machine representation can show real slots, accelerators, memory, storage, cooling zones or network links only where discovered/declared truth supports them. Unknown topology must remain unknown.

## Existing Fabric API disposition

`/api/fabric/nodes` is valuable live-probe evidence and should be adapted/generalized rather than replaced casually. Its current string summaries must not become the long-term canonical subresource model.

Probe collection should move toward structured typed observations while retaining fail-closed brokered execution and reason-preserving unreachable state.

## Acceptance

- Select HERMES and discover actual child resources without parsing presentation strings in the client.
- Select the P40 via stable canonical identity and see fresh metrics, consumers, reservation/residency state and history.
- The same P40 identity is returned by command search, System topology, Inspector and HUD.
- Ask `what is using P40 memory?` and answer from deterministic current state when possible.
- Execute one safe governed action from the object's action registry; authority/fencing remains canonical and verified post-state is attached.
- Replace or simulate replacement of a physical device and prove historical identity is not silently transferred.
- Offline/unreachable objects remain present with truthful stale/unknown state and reason.
- No UI component becomes an independent source of hardware/work/authority truth.
