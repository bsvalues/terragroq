# 16 — Observability, Headroom, and Live-Telemetry Reconciliation

## Purpose

Prevent IF-02/IF-05/IF-08/IF-11 from creating a second node-health or telemetry stack when the Execution Fabric already has canonical Windows/Linux probes, node identity walls, freshness semantics, runtime inventory, GPU observations, disk/network inventory, and capability-health projection.

## Current-main evidence

The existing Execution Fabric already owns live node observation through:

- `scripts/execution-fabric/probe-windows.ps1` for OMEN/HERMES;
- `scripts/execution-fabric/probe-linux.sh` for ATLAS/AEGIS;
- `config/execution-fabric/registry.seed.json` for canonical node roles, authority, availability classes, constraints, evidence freshness and capability-health projection.

The Windows probe already observes canonical machine identity, CPU, DIMM inventory, GPU UUID/model/PCI bus/VRAM/driver/temperature/utilization, disk inventory/health, NIC state/speed/addressing, Docker/WSL/SSH state and Ollama model inventory. The Linux probe similarly observes canonical machine identity, CPU/DIMM/NUMA-adjacent inventory, NVIDIA GPU identity/VRAM/temperature/utilization, disks/SMART/filesystems, NIC speed/duplex/routes and relevant runtimes/services.

The registry deliberately separates declared topology/authority from live capability evidence and gives stale declared hardware zero schedulable confidence.

## Controlling rule

Intelligence Fabric does not get a parallel hardware monitor.

IF-02 should extend the existing probe/evidence path with intelligence-specific measurements and project them through the existing Execution Fabric freshness/capability machinery.

Prefer:

`canonical node probe -> immutable/fresh evidence -> Execution Fabric registry/capability health -> intelligence-specific derived metrics -> placement/residency/cost decisions`

## Existing fields to reuse

Where current-main remains authoritative, reuse:

- canonical node and machine identity;
- GPU UUID / PCI bus identity;
- total VRAM;
- GPU temperature and utilization;
- DIMM capacity/type/speed;
- NIC speed/state/addresses/default route;
- runtime presence/health;
- disk and filesystem topology;
- evidence observed-at / probe / confidence / TTL;
- node authority and availability class;
- capability-health `UNKNOWN/PENDING/...` semantics.

Do not duplicate these into a separate Intelligence Fabric inventory database merely for convenience.

## Genuinely missing or insufficient measurements

Current probes are inventory-oriented and do not yet prove enough for model placement. IF-02/IF-05 should add bounded measurements or derived observations for:

- GPU memory **used/free/reserved**, not only total VRAM;
- GPU power draw, power limit and thermal-throttling state where supported;
- CPU load and available memory at decision time;
- measured host-memory bandwidth;
- measured host<->GPU transfer bandwidth per accelerator/path;
- PCIe generation and negotiated lane width;
- NUMA locality where relevant;
- model/runtime load time and unload time;
- model weights, KV/cache and runtime-overhead memory footprint;
- LAN link latency and measured throughput between admitted node pairs;
- queue pressure / current governed reservations;
- storage throughput only where it materially affects model cold-start or artifact movement;
- runtime-specific metrics such as KV usage, expert-cache hit rate or CPU-expert fraction when available.

## Evidence classes

Do not mix static identity/inventory with rapidly changing headroom.

Recommended classes:

1. `IDENTITY` — machine/GPU identity; long-lived, revalidate on hardware/driver change.
2. `TOPOLOGY` — PCIe/NUMA/NIC/storage relationships; revalidate on boot/configuration change.
3. `HEALTH` — temperature, utilization, runtime state; short TTL.
4. `HEADROOM` — free VRAM/RAM, queue/reservations; very short TTL.
5. `BENCHMARK` — bandwidth/load-time/model memory; versioned by hardware/runtime/config and invalidated by relevant changes.
6. `ECONOMICS` — local power/cost assumptions and external price observations; independently timestamped.

Placement must fail closed when the class required for a decision is stale or unknown.

## Thermal and power doctrine

Temperature is not merely dashboard telemetry. Sustained inference can alter throughput and hardware safety margins. Intelligence placement should support a governed thermal/power headroom gate without turning WilliamOS into a fan-control system.

V1 should observe and avoid clearly unhealthy/throttled resources. It should not autonomously overclock, alter BIOS settings, change GPU power limits, or take hardware-control authority without a separate owner-approved contract.

## Cost doctrine

IF-11 must not invent false precision. Local electricity cost may be estimated only from explicit owner/default tariff assumptions plus measured/estimated device power. Cloud/API prices require timestamped provider evidence. Queue delay and transfer/load cost remain distinct from dollar cost.

A placement decision may report `ECONOMIC_COST_UNKNOWN` and still choose among policy-eligible local resources using latency/quality/locality; unknown monetary cost must not be coerced to zero.

## Hardware-ROI output

The whole-fabric benchmark should eventually be able to attribute the dominant bottleneck for a workload class across:

- RAM capacity;
- RAM bandwidth;
- CPU throughput;
- PCIe/host-to-device transfer;
- accelerator compute;
- accelerator VRAM;
- storage/model-load path;
- LAN transfer;
- queue/concurrency;
- runtime configuration.

Hardware recommendations must cite measured bottleneck evidence and compare the expected gain of configuration/runtime changes before recommending a purchase.

## Acceptance

This reconciliation passes only when:

- IF-02 explicitly extends the canonical probes/registry path rather than creating a competing inventory service;
- every dynamic metric has a freshness class/TTL and provenance;
- total capacity is never confused with free/reservable capacity;
- thermal/power observations cannot mint hardware-control authority;
- stale or partial headroom fails closed for consequential placement;
- OMEN can disappear without corrupting resident capacity truth;
- ATLAS state-protection constraints remain hard placement gates;
- hardware ROI uses measured whole-fabric evidence, not advertised specs alone.
