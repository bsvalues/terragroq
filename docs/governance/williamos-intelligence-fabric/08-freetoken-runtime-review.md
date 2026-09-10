# 08 — FreeToken Runtime Candidate Review

**Status:** EXTERNAL-CANDIDATE REVIEW / NOT ADMITTED

**Paper:** arXiv:2608.16157, submitted 2026-08-17

**Upstream:** `FlashML-org/FreeToken`

## Decision

FreeToken is a high-value candidate runtime for WilliamOS Intelligence Fabric, especially for large Mixture-of-Experts models whose full expert pool exceeds GPU VRAM. It is **not** admitted capability by this document. All claims remain candidate evidence until measured on HERMES under IF-05.

The important architectural result is positive: FreeToken fits the already-frozen separation of `ModelArtifact × Runtime × RuntimeConfiguration × ComputeResource × CapabilityEvidence`. No redesign of #964 is required.

## Why it matters

FreeToken treats GPU, CPU, host DRAM and PCIe as one adaptive local inference platform. Its runtime can keep the full routed-expert pool in host memory, cache hot experts in VRAM, and dynamically choose between PCIe transfer + GPU execution and CPU-side expert execution. It also reallocates VRAM between expert cache and KV cache and provides semantic-aware recurrent-state/KV caching for agentic workloads.

For WilliamOS this creates a new local placement class between ordinary GPU inference and cloud bursting:

`normal local GPU -> heterogeneous local MoE -> elastic remote GPU -> provider-managed frontier API`

That can reduce dependence on rented GPU capacity without pretending host RAM or remote GPU memory is ordinary contiguous VRAM.

## External evidence reviewed

The paper reports support for more than 20 MoE models across hardware from an 8 GB RTX 4060 laptop to an RTX PRO 6000 96 GB workstation, including a 753B GLM-5.2 demonstration. It measures actual PCIe expert-transfer bandwidth and effective CPU expert-processing bandwidth on the deployed tensor shapes rather than relying on nominal specifications.

The public repository currently advertises native NVIDIA RTX 30/40/50 support, OpenAI/Anthropic-compatible APIs, Windows/Linux desktop distribution, semantic-aware caching, elastic expert/KV memory management, and multiple MoE quantization formats.

The first week of community activity also exposes material gaps that WilliamOS must treat as evaluation gates:

- older GPU support is incomplete; upstream requests/patches exist for Turing and Pascal;
- dual-GPU support is an open request rather than a proven baseline capability;
- mixed GPU architectures/FP8 conventions have an open issue;
- Windows/WSL2 pinned-memory quota pressure has already required proposed partial-pinning work;
- Windows installer scripts have triggered antivirus blocking for at least one user;
- Docker support is still an open request;
- Apple Silicon is currently unsupported;
- the project is changing rapidly, with many fixes/PRs arriving within days of release.

Therefore upstream `supports FreeToken` must never be represented as a single boolean.

## Benchmark caution

WilliamOS must not copy headline comparisons into CapabilityEvidence.

At minimum, IF-05F must normalize:

- identical model revision;
- identical quantization/precision;
- same prompt/context and sampling settings;
- same CPU thread budget;
- NUMA affinity;
- actual host DRAM bandwidth;
- actual PCIe width/generation and measured transfer bandwidth;
- same agent workload;
- cold versus warm model state;
- prefill and decode separately;
- TTFT and tail TTFT, not only average tokens/sec;
- model loading/conversion time;
- semantic-cache hit/miss state.

Published comparisons that mix BF16 and NVFP4, or compare normalized agent rates with pure decode rates, are not like-for-like production evidence.

## HERMES-specific unknowns

These are mandatory current-machine measurements, not assumptions:

1. **P40 / Pascal compatibility.** Upstream currently advertises RTX 30/40/50; a Pascal-support patch/request exists. P40 is `UNKNOWN` until exact current FreeToken commit proves otherwise.
2. **RTX 3050 compatibility.** Architecture is Ampere, but HERMES has limited VRAM; prove supported kernels/quantizations and minimum practical cache budget.
3. **Mixed P40 + RTX 3050 behavior.** Do not assume dual-GPU or mixed-architecture execution. Treat each device independently unless exact runtime evidence proves otherwise.
4. **Windows-native versus WSL2.** Measure both only if supported and useful; pinned-memory/DMA behavior may differ materially.
5. **Host DRAM capacity.** Large MoE expert banks can shift the limiting resource from VRAM to system RAM.
6. **Host DRAM bandwidth.** The i7-5960X/X99 platform may become the dominant bottleneck even if capacity is adequate.
7. **PCIe topology.** Measure negotiated generation/width per GPU under actual slot population, not motherboard marketing specs.
8. **CPU expert throughput.** Measure effective FreeToken expert-kernel bandwidth on this CPU.
9. **Storage/load path.** FTW conversion, model load time, local SSD capacity and repeated cold-start behavior must be included in placement economics.
10. **64K+ agent workload.** Prove KV/expert-cache competition under WilliamOS long-context tasks.
11. **Tool/schema behavior.** OpenAI compatibility is transport compatibility, not proof of agent capability.
12. **Runtime stability.** Long-lived serving, repeated unload/reload, cancellation and failure cleanup require measurement.

## Intelligence Fabric enhancements discovered

### 1. Add `MemoryHierarchyProfile`

`ComputeResource` should be capable of recording measured rather than nominal:

- GPU VRAM capacity/bandwidth;
- host DRAM capacity/effective bandwidth;
- H2D/D2H PCIe bandwidth;
- NUMA affinity/topology;
- pinned-memory availability/quota;
- storage read bandwidth where model loading depends on it.

Placement for heterogeneous runtimes requires these values.

### 2. Add runtime dynamic-memory evidence

`RuntimeCapability` should admit features such as:

- `EXPERT_CPU_GPU_COEXECUTION`;
- `DYNAMIC_EXPERT_KV_REALLOCATION`;
- `SEMANTIC_KV_ANCHOR_REUSE`;
- `PARTIAL_PINNING`;
- `MULTI_GPU`;
- `MIXED_GPU_ARCHITECTURE`.

Each remains hardware/version scoped.

### 3. Add cache-state observability

`InferenceExecution.metrics` should be able to record, when supplied by the runtime:

- expert-cache size;
- expert-cache hit rate;
- CPU-executed expert fraction;
- PCIe-filled expert fraction;
- KV allocation;
- semantic-anchor reuse/hit rate;
- prefill bytes/seconds;
- decode bytes/seconds.

These metrics can explain why the same model behaves differently across tasks.

### 4. Add conversion/artifact lifecycle

Some runtimes require derived weight formats. A derived FTW/model artifact must bind back to source model identity and conversion tool/version/digest. Conversion cannot become an untracked local copy that loses provenance.

### 5. Add runtime maturity / volatility signal

A new runtime can be capable but operationally volatile. Placement policy should be able to distinguish `CANDIDATE`, `PILOT`, and `PRODUCTION` runtime admission independently of raw performance.

### 6. Make benchmark contention-aware

Upstream discussion already questions decisions based on isolated bandwidth when PCIe and CPU branches contend concurrently. WilliamOS evaluation should measure the **actual concurrent execution pair**, repeat measurements, capture variance and withhold a hard routing verdict when the result straddles the policy threshold.

### 7. Hardware purchases must follow measured bottlenecks

Do not infer that more VRAM is always the best next purchase. For FreeToken-class execution, system RAM capacity, DRAM bandwidth, CPU memory performance, PCIe generation/width and storage may yield more capability per dollar than another GPU. IF-05F must output a measured bottleneck report before any FreeToken-driven hardware recommendation.

## IF-05F acceptance track

FreeToken evaluation is a child of IF-05 and cannot block the core Fabric architecture if upstream support is unsuitable for HERMES.

Required measurements:

- exact FreeToken commit/version/build identity;
- installation path and supply-chain digest;
- OS/runtime mode;
- exact GPU compatibility verdict for each HERMES GPU;
- exact multi-GPU/mixed-architecture verdict;
- host RAM requirement and peak use;
- measured DRAM and PCIe bandwidth;
- pinned-memory availability/quota;
- model conversion size/time;
- cold load and warm restart time;
- TTFT p50/p95/max;
- prefill throughput;
- decode throughput;
- 64K+ context behavior;
- expert-cache/KV split behavior;
- semantic-cache reuse on a multi-turn tool workflow;
- structured output/tool accuracy;
- authority/scope compliance;
- cancellation/failure cleanup;
- sustained-run stability;
- comparison against currently approved Ollama/llama.cpp/vLLM path where equivalent model support exists.

No capability promotion from the executing FreeToken process itself.

## Admission outcomes

Return one exact result:

- `FREETOKEN_HERMES_PROVEN` — at least one exact model/runtime/compute profile is production-eligible after independent evidence/review;
- `FREETOKEN_HERMES_PILOT` — useful but restricted by maturity, hardware, stability or incomplete evidence;
- `FREETOKEN_HERMES_UNSUITABLE` — current HERMES hardware/runtime does not justify admission;
- `FREETOKEN_HERMES_BLOCKED_UPSTREAM` — exact upstream limitation blocks a meaningful test.

Any result is acceptable to #964. Fabric correctness means FreeToken can be evaluated honestly without becoming an architectural dependency.