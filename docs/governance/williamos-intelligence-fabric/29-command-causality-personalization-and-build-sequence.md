# 29 — Command, Causality, Personalization, and Experience V2 Build Sequence

## Purpose

Close the remaining Experience V2 architecture seams before frontend mutation begins.

## 1. Global command/search

Current WilliamOS already has a single action-registry principle, but it is presently navigation-shaped: fixed modes/capabilities with labels, hrefs, keywords and aliases.

Experience V2 must extend this into one canonical **Object + Action Registry**, not create another command palette beside it.

A command result may represent:

- an object (`HERMES`, `P40`, `TerraFusion Search`, a disk, a Thread, an artifact);
- an object-relative deterministic action (`inspect`, `open`, `return`, `benchmark`, `drain`, `evict` where supported);
- an interaction contract (`review this`, `think with me`, `decide`);
- an owner-defined mode/profile;
- a safe navigation/focus action.

Natural language may resolve intent, but deterministic exact matches should not require model inference.

Every mutation candidate must resolve through canonical authority/execution. Search/command discovery never grants authority.

The registry must be context-aware: selected world/object and recent meaningful place influence ranking, but never silently change the target of an ambiguous destructive action.

## 2. Temporal truth and causality

WilliamOS already has multiple durable temporal sources: governance events, event/audit logs, Decisions, Evidence, Work Orders, queue receipts, runtime events and specialized goal timelines. Do not replace these with a generic frontend event stream.

Experience V2 adds a **Temporal Projection** over canonical receipts/events with four owner-facing questions:

- `NOW` — what is true now?
- `TREND` — how has the relevant measurement/state changed?
- `HISTORY` — what happened in order?
- `CAUSE` — what evidence supports a causal explanation?

`CAUSE` must not be inferred merely from temporal adjacency. A causal claim requires one or more of:

- explicit parent/child/correlation IDs;
- before/after receipt binding;
- workload/resource ownership binding;
- deterministic configuration/change provenance;
- measured correlation clearly labelled as correlation rather than proof;
- model-generated hypothesis explicitly labelled as hypothesis.

Example: `P40 temperature rose after Qwen residency loaded` may be shown as correlated chronology unless runtime/residency/telemetry evidence supports stronger attribution.

Temporal projections are rebuildable. Canonical receipts/events remain authoritative.

## 3. Personalization store

A credible canonical Experience V2 owner-preference store was not found on current main. Treat this as genuinely missing, but keep it intentionally narrow.

Separate:

1. **Explicit owner preferences** — settings deliberately chosen by the owner.
2. **Operational defaults/policies** — governed locality, spend, recovery, attention and mode behavior.
3. **Learned interaction preferences** — suggestions inferred from usage, never silently promoted.
4. **Private memory/context facts** — remain in the existing memory/context system and are not duplicated into preferences.

The personalization store must support:

- stable schema/versioning;
- explicit source (`owner-set`, `suggested`, `learned-confirmed`);
- scope/world/compartment;
- created/updated timestamps;
- provenance/rationale for learned suggestions;
- review/revert/delete;
- export/inspection;
- no secrets;
- no sensitive psychological labels;
- no use as authority.

Browser localStorage may cache presentation preference for responsiveness, but backend canonical preferences own cross-device continuity. Local cache cannot silently override canonical policy.

Learned behavior begins as a suggestion. Example: `You usually prefer local execution unless it would materially delay work` must be reviewable before becoming operational policy.

## 4. Exact Experience V2 implementation order

Do not begin with Home, colors, cards or a broad shell rewrite.

### Gate 0 — Reconciliation freeze

Complete #978/#982 and classify exact current components/APIs as reuse/extend/supersede/adapt/remove/missing.

### Gate 1 — Canonical object projection

Implement/extend #985 so SYSTEM can address stable node/subresource/workload/model/reservation objects from existing Fabric/probe/runtime/work truth.

No new visual composition is terminal until objects exist.

### Gate 2 — Unified Object + Action Registry

Generalize current action registry to resolve canonical objects and deterministic actions. Keep authority outside the registry.

Prove `P40`, `return`, `TerraFusion Search`, and one safe object action.

### Gate 3 — Working World adapter

Preserve Environment `WorkingWorldSnapshot` meaning/chrome separation. Add adapters from canonical Project/Thread/System objects into meaningful worlds. Do not persist pixels/layout into canonical world meaning.

### Gate 4 — Re-entry + semantic projections

Implement #981/#979 boundaries: where-I-was, what-changed, needs-me, alive-now and semantic Thread map over canonical sources. Prove destroy/rebuild.

### Gate 5 — Experience V2 desktop composition

Only now implement the terminal desktop Environment composition:

- current world dominates;
- stable OS chrome recedes;
- selected-object Inspector;
- command/action surface;
- quiet persistent conversation;
- SYSTEM semantic zoom;
- direct actions.

First journey: TerraFusion -> SYSTEM -> HERMES -> P40 -> one safe governed change -> RETURN to exact TerraFusion place.

### Gate 6 — Temporal causality

Add NOW/TREND/HISTORY/CAUSE to objects using existing event/receipt sources. No new generic event authority.

### Gate 7 — Visual/material system

Apply #984 material hierarchy after interaction composition works with real data. Validate reduced-motion, larger text, stale/degraded states and high-density hierarchy.

### Gate 8 — Native HUD

Implement #983 as a projection of the same object/action model. Read-first proof before native mutation controls.

### Gate 9 — Cross-device composition

Tablet and phone consume the same world/object/action model. Phone prioritizes re-entry/needs-you/alerts/voice/safe quick actions; tablet remains a serious operating surface.

### Gate 10 — Personalization

Add explicit canonical preferences first. Learned suggestions remain opt-in and inspectable. Never block core operation on personalization.

### Gate 11 — Operating modes

Implement #986 only after underlying policy owners exist and policy diffs can be explained/reverted.

### Gate 12 — Intelligence Fabric automatic placement

Automatic intelligence placement consumes the now-visible object/resource/policy/context substrate; frontend does not special-case providers/models/nodes.

## 5. Stop conditions

Stop and reconcile before proceeding if implementation introduces:

- a third shell;
- a second action/command registry;
- a UI-only object database;
- a new generic event bus that replaces durable receipts;
- a second memory system for preferences;
- hidden learned policy;
- a model call for deterministic system reads;
- provider/model/node UI as required workflow;
- mobile as stacked desktop cards;
- native HUD authority.

## Terminal readiness rule

Experience V2 is implementation-ready when the first bounded slice can be built from canonical seams without inventing new truth/authority owners: stable object -> current world -> contextual action -> governed execution -> verified post-state -> preserved return location.