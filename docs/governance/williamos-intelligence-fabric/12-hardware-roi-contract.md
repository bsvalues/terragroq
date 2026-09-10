# 12 — Hardware ROI Contract

## Purpose

WilliamOS must not convert every observed AI bottleneck into a GPU purchase recommendation. Hardware guidance from the Intelligence Fabric program is evidence-driven across the whole fabric.

## Required inputs

For the workload class being optimized, collect where material:

- current end-to-end completion time;
- queue delay;
- model cold-load time;
- prefill and decode time;
- accelerator utilization and VRAM pressure;
- KV/cache pressure;
- host RAM capacity and bandwidth;
- CPU saturation and memory throughput;
- PCIe host-to-device throughput;
- storage/model-load throughput;
- fabric-link bandwidth/latency;
- transfer volume between stages;
- cloud/API alternative cost/performance;
- reliability/failure rate.

## Candidate upgrade classes

Compare at least:

- additional host RAM capacity;
- faster/higher-bandwidth host memory platform;
- CPU/platform upgrade;
- PCIe topology/platform upgrade;
- accelerator VRAM/compute upgrade;
- second accelerator where runtime/topology supports it;
- storage upgrade;
- LAN upgrade;
- workload/data relocation without purchase;
- runtime/model/quantization change without purchase;
- elastic remote compute instead of purchase.

## Recommendation record

A hardware recommendation must state:

- measured bottleneck;
- workload(s) affected;
- proposed change;
- estimated improvement range;
- confidence and evidence refs;
- purchase cost;
- alternative no-purchase options;
- expected utilization frequency;
- whether the upgrade creates a new dependency or only optional capacity.

No recommendation may claim an exact performance gain when current measurements are too variable to support one.

## Efficiency rule

Prefer configuration/routing/data-locality improvements before hardware when they satisfy the same outcome at materially lower cost and complexity.

## Acceptance

The first hardware-ROI proof should answer: `Which next bounded upgrade or configuration change yields the highest measured owner-relevant improvement per dollar for the current WilliamOS fabric?`

The answer may validly be `no purchase yet`.
