# 19 — Owner Experience / Infrastructure Invisibility Contract

## Purpose

Prevent IF-12 from exposing Intelligence Fabric internals as the primary product. The backend may become dramatically more sophisticated while the owner interaction surface becomes simpler.

This contract is a product boundary, not styling guidance.

## Controlling owner model

Normal operation remains:

`William -> WilliamOS`

The owner should not be required to choose or understand:

- model names or revisions;
- runtime engines;
- GPU/node identities;
- cloud providers;
- quantization;
- KV/expert cache strategy;
- worker lanes;
- queue/lease/fence vocabulary;
- fallback chains;
- placement topology.

Those details are inspectable evidence, not operating prerequisites.

## Primary nouns and verbs

Preserve the existing Workbench/Environment owner vocabulary:

- Project
- Thread
- Artifact
- Decision

and ordinary verbs such as:

- Ask
- Do
- Inspect
- Steer
- Stop

Do not create a required `Models`, `GPUs`, `Providers`, `Clusters`, or `Cloud` workflow to accomplish ordinary work.

## Progressive disclosure

### Layer 0 — normal conversation/work

Show only what helps the owner understand the outcome and whether WilliamOS owns the work.

Examples:

- `Working on it.`
- `Implementation is underway.`
- `Review found two issues; remediation is running.`
- `Completed and verified.`
- `I need your decision on X.`

Do not surface routine reroutes, model loads, cache misses, temporary provider exhaustion, GPU reservations or node changes as owner tasks.

### Layer 1 — ambient status

The Environment may quietly show evidence-backed high-level state such as:

- working / waiting / needs decision / degraded;
- local/private/remote execution class where materially relevant;
- broad cost state if non-zero spend is occurring;
- broad privacy state if useful (`LOCAL`, `PRIVATE REMOTE`, etc.);
- HERMES/AEGIS/ATLAS health only when fresh and useful.

Ambient status must not become a wall of telemetry.

### Layer 2 — Inspect / Proof

Show human-meaningful execution provenance:

- what changed;
- validation/review result;
- why a meaningful route/fallback occurred;
- whether external/private remote compute was used;
- actual cost;
- relevant evidence references.

### Layer 3 — Technical

Expose full engineering detail on demand:

- ContextPackage digest/provenance;
- model artifact/revision;
- runtime/configuration;
- compute resource/node;
- accelerator reservation;
- placement candidates/score/hard gates;
- fallback/reroute history;
- performance/cache/headroom metrics;
- cloud resource lifecycle/teardown proof;
- raw typed failure/recovery state.

This is where owner-engineer controls belong, not in the main conversation path.

## Model choice

A model picker may exist as a technical override/debugging affordance, but it must not be required for normal operation and must not become the primary interaction metaphor.

Preferred normal mode is `AUTO / Let HERMES choose` governed by policy and evidence.

Manual override must be explicit and scoped. It may not silently weaken privacy, authority, budget or capability gates.

## Infrastructure transitions

Automatic transitions are successful only if they preserve:

- the same Thread;
- owner message/history continuity;
- current Project/artifact context;
- work authority;
- execution progress/evidence;
- foreground focus;
- ability to inspect what happened afterward.

A transition fails the UX contract if the owner is asked to:

- copy context between chats;
- open a model manager;
- restart the job;
- launch a cloud instance;
- free VRAM manually;
- reconnect a provider for a routine recoverable condition;
- select another node/runtime;
- carry logs/commands between machines.

## Cost interaction

Standing budgets/policies should make ordinary small bursts invisible where already authorized. A genuinely new spend authority boundary should surface one plain owner decision about the real consequence, not provider SKU/configuration trivia.

Afterward, actual cost belongs in Inspect/Proof and Technical detail.

## Privacy interaction

Policy should prevent disallowed placement automatically. Do not repeatedly ask the owner whether protected content may leave premises when standing policy already says no.

A new privacy exception is a genuine Decision and should explain exactly what data would leave, where, why and for what bounded duration.

## Failure interaction

Routine failure should appear as recovery, not as a technical support ticket.

Good:

`The first execution path became unavailable; WilliamOS rerouted and is continuing.`

Bad:

`CUDA OOM on GPU1. Please unload qwen and select cloud H100.`

Technical detail remains available under Inspect.

## No-focus rule

Background model/provider/node changes must not:

- navigate the Environment;
- change Project/Thread;
- open a modal/pane;
- steal keyboard focus;
- replace the foreground artifact;
- force the owner into System/Technical views.

## Engineering controls

Because the owner is also the system engineer, Technical/System should still provide deliberate controls for:

- install/evaluate/admit/retire model;
- force local-only/private-remote/economy/deep modes;
- inspect compute topology;
- pin a model/runtime/resource for a bounded test;
- inspect benchmarks;
- set spend ceilings;
- pause/disable a runtime/provider;
- view/update model policy where authorized.

These controls must be clearly distinct from ordinary outcome execution.

## Anti-dashboard test

A page that primarily displays cards for models, GPUs, nodes, agents, provider status and metrics may be a useful System/Technical surface but **cannot** be accepted as the Intelligence Fabric owner experience.

The primary acceptance starts with an ordinary owner outcome in an existing Thread and finishes in that same useful working context.

## Terminal UX acceptance

One meaningful job must demonstrate at least one model/runtime/resource transition while:

- no model/provider/node choice is required;
- no context is manually transferred;
- no infrastructure page is required;
- no focus/navigation is stolen;
- normal progress remains understandable;
- one genuine owner boundary, if induced, is phrased in owner language;
- full technical provenance is inspectable afterward;
- closing/reopening the client restores the same Thread/work state;
- OMEN loss does not stop authorized resident work.

If the backend passes but the owner must operate the infrastructure, Intelligence Fabric V1 has failed.
