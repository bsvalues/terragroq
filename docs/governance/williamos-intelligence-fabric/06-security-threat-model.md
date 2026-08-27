# 06 — Intelligence Fabric Security / Threat Model

## Security objective

Expand intelligence capacity and provider flexibility without expanding model authority, leaking governed context, creating unmanaged compute, or allowing routing/telemetry to become an alternate authority path.

## Trust boundaries

1. Owner / authenticated WilliamOS client.
2. WilliamOS control plane and durable authority/evidence stores.
3. HERMES resident supervisor.
4. Context Fabric.
5. Worker lanes (Hermes Agent, Codex, Claude, future).
6. Runtime/model process.
7. Local fabric node/accelerator.
8. Provider control plane for remote compute.
9. Ephemeral remote worker.
10. External provider-managed model API.
11. Tool targets (repository, filesystem, GitHub, databases, network services).

Each crossing must have an explicit contract. Reachability is never authority.

## T1 — Prompt/context injection changes authority

Threat: untrusted repository/document/chat content tells a model to ignore Work Order, authority, privacy, or tool boundaries.

Controls:

- authority metadata and tool grants remain out-of-band from untrusted context text;
- bounded worker prompts preserve exact reservations;
- ContextPackage records source classes and cannot mint authority;
- injection-resistant evaluation corpus;
- model output is proposal/data until governed action layer validates it.

Acceptance: hostile context cannot expand paths, tools, egress, provider class, spend, or owner decision scope.

## T2 — Context cross-Thread / cross-Project bleed

Threat: context compiler includes state from the wrong user, Project, Thread, Work Order, or memory scope.

Controls:

- explicit durable source bindings;
- tenant/user scoping;
- deterministic package source list;
- no repository/name inference for Project membership;
- negative tests for ambiguous/missing bindings;
- provider-native session memory treated as subordinate execution state.

Acceptance: cross-scope retrieval returns refusal/absence, not best-effort inferred context.

## T3 — Raw credential exposure to model or remote worker

Threat: secrets enter prompt/context, model filesystem, telemetry, or ephemeral worker image.

Controls:

- credentials excluded from Context Fabric;
- existing broker/tool boundaries perform credentialed actions on behalf of bounded work;
- remote worker receives short-lived scoped identity only;
- master provider credential remains control-plane side;
- secret scanning/redaction on evidence/logs;
- no host credential mounts by default.

## T4 — Malicious/compromised model artifact

Threat: downloaded weights/config/templates/runtime code contain malicious behavior or unsafe license/provenance.

Controls:

- discovery != approval;
- quarantine;
- immutable digest/provenance where possible;
- source/license review;
- isolated benchmark before capability admission;
- model process receives only required network/files/tool surfaces;
- rollback/fallback to previously proven version.

Do not auto-activate arbitrary internet model names.

## T5 — Runtime supply-chain compromise

Threat: malicious/changed Ollama/llama.cpp/vLLM/Hermes Agent image or dependency alters behavior.

Controls:

- exact runtime version/build/image identity;
- artifact/image digests where managed locally;
- runtime capability evidence scoped to version/hardware;
- controlled update/canary/rollback;
- no capability inheritance across materially changed runtime without evidence policy.

## T6 — Capability self-promotion

Threat: model/lane edits or produces the evidence that makes itself eligible for broader work.

Controls:

- capability evidence written/approved by separate measurement/review authority;
- execution identity cannot promote itself;
- evidence binds exact subject identity;
- immutable evidence refs;
- independent review for production promotion.

## T7 — Fabricated/stale compute capacity

Threat: stale inventory says GPU is available; two jobs over-admit; runtime OOM or corrupts continuity.

Controls:

- freshness-aware compute observation;
- accelerator reservation + lease/fence;
- weight/KV/runtime-overhead accounting;
- atomic admission;
- crash/restart reconciliation;
- stale observations become UNKNOWN/STALE, never AVAILABLE.

## T8 — Cross-job accelerator interference

Threat: one model/job evicts or starves another unexpectedly.

Controls:

- priority/preemptibility;
- reservation ownership;
- model residency state machine;
- no eviction of non-preemptible active reservation;
- evidence for preemption/eviction reason.

## T9 — Remote data egress beyond policy

Threat: cloud worker/API receives prohibited prompt, document, embedding, KV, log, or telemetry data.

Controls:

- multi-dimensional EgressPolicy;
- hard placement gate before provisioning/invocation;
- private worker network egress restrictions;
- no assumption that private compute implies unrestricted internet;
- negative egress tests;
- evidence of policy digest used for placement.

## T10 — Confusing provider API with private compute

Threat: policy allows private remote GPU but router sends data to provider-managed model API.

Controls:

- separate execution classes `PRIVATE_REMOTE` and `EXTERNAL_MODEL_API`;
- explicit allowedExecutionClasses in requirement/policy;
- separate provider adapters and trust evidence.

## T11 — Paid resource orphan

Threat: HERMES crashes or destroy call fails and remote GPU continues billing.

Controls:

- TTL/max cost at provider when supported;
- durable ElasticWorker lifecycle;
- provider-side tags/work identity;
- restart reconciliation against provider truth;
- orphan sweeper;
- `ELASTIC_DESTROY_FAILED` persistent high-priority recovery;
- terminal success requires provider-side no-active-resource evidence.

## T12 — Remote worker persists governed data after job

Threat: disk/snapshot/cache retains context/artifacts.

Controls:

- ephemeral storage by default;
- encrypted transport/storage where available;
- bounded cache policy;
- wipe/cleanup action before destroy;
- no provider snapshot/image capture by default;
- destruction evidence;
- sensitive classifications may forbid remote compute entirely.

## T13 — Model output directly mutates privileged systems

Threat: inference result is treated as an authorized command.

Controls:

- existing Work Order/tool/ExecutionBackend boundaries remain authoritative;
- output validated as data/schema;
- action classifier/owner gate where applicable;
- no generic host shell added by Fabric;
- no model receives authority merely because placement selected it.

## T14 — Routing telemetry leaks content

Threat: observability stores raw prompts/results/secrets under guise of metrics.

Controls:

- metrics are structured/minimized;
- context/result referenced by governed evidence IDs where possible;
- redact/sanitize provider errors;
- no raw credential/tool secret in placement records;
- retention policy explicit.

## T15 — Router feedback poisoning

Threat: malicious work/model manipulates quality metrics so router favors it.

Controls:

- separate operational metrics from capability promotion;
- independent evaluation corpus;
- outlier/failure recording;
- router cannot self-modify hard gates;
- material policy changes require reviewed code/config/authority.

## T16 — Denial-of-service by model loading/context explosion

Threat: repeated loads or huge context monopolize memory/time.

Controls:

- minimum context requirement rather than always-max context;
- context package token estimate/bounds;
- reservation budget;
- model warm/evict policy;
- priority classes;
- maximum execution/time/cost limits;
- typed `CONTEXT_TOO_LARGE` / `KV_CAPACITY_EXHAUSTED` recovery.

## T17 — Unproven advanced runtime feature

Threat: architecture assumes tensor parallel, Gaudi feature, disaggregated prefill, or KV transfer that the deployed version/hardware has not proven.

Controls:

- RuntimeCapability scoped by runtime version + hardware platform;
- UNKNOWN is refused where feature is required;
- design may admit future feature but production route depends only on measured/proven feature.

## T18 — UI hides material remote/cost/privacy event

Threat: invisibility becomes deception; owner cannot inspect that cloud/API was used or spent money.

Controls:

- normal use does not require infrastructure operation;
- Inspect/Technical preserves full placement/provider/cost/provenance chain;
- genuine new owner authority/spend boundary remains `Needs you` before effect;
- after standing authority exists, routine execution may be invisible operationally but never unauditable.

## T19 — Failure fallback widens trust

Threat: local failure automatically falls back to a less-private API.

Controls:

- fallback chain contains only candidates that pass same hard gates;
- failure does not relax classification/egress/spend;
- no `best effort` unsafe fallback.

## Security terminal condition

No V1 PASS until independent review confirms that Intelligence Fabric added no path by which model/provider/compute reachability can become authority, no routine failure relaxes privacy/spend boundaries, and no paid/remote lifecycle can terminate locally while remaining active remotely.
