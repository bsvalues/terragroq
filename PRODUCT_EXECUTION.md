# WilliamOS Product Execution Contract

**Status:** CONTROLLING FOR PRODUCT EXECUTION

**Owner direction:** WilliamOS is a usable human-facing product first. Infrastructure, governance, orchestration, evidence, queues, agents, and runtime machinery exist only to support that product. They are not the product and they are not the default organizing principle for new work.

This contract supersedes earlier repository doctrine wherever that doctrine would cause product work to be organized around the legacy orchestration/control-plane experiment rather than around a fixed user-visible outcome. Safety, security, legal constraints, and explicit owner decisions still govern.

## 1. Fixed objective beats expanding architecture

Every product lane starts with a concrete user-visible acceptance target. That target stays fixed until the owner changes it.

A newly discovered defect does **not** automatically become part of the current lane. A defect may be real, important, and worth recording while still being the wrong thing to work on now.

Before interrupting the active product lane with backend/infrastructure work, answer both questions:

1. Does this defect directly prevent the current user journey from continuing right now?
2. Can the blocked capability be truthfully stubbed, fixtured, mocked, adapted, or deferred without lying about what is real?

If the answer to #1 is **no**, record/backlog it and continue product work.
If #1 is **yes** and #2 is **yes**, use the truthful bounded substitute and continue product work.
Only when #1 is **yes** and #2 is **no** may the lane be interrupted, and then only for the smallest blocking slice required to resume the user journey.

**A dependency chain is not permission to follow the chain indefinitely.**

## 2. Definition of done

Tests, CI, receipts, architecture, schemas, Work Orders, documentation, agent reports, and backend proofs are supporting evidence. None of them makes a user-facing feature done.

A user-facing feature is done only when its agreed user journey works in the real UI and the experience is usable.

For UI/UX work, acceptance must include direct browser/product use. If the interface is technically correct but confusing, brittle, ugly, misleading, or requires explanation to operate, it is not done.

Do not move the finish line because implementation exposed deeper infrastructure. Either bound the infrastructure or explicitly ask the owner to change the product scope.

## 3. Current W1 product lane

Until the owner changes lanes, the priority is the WilliamOS W1 UI/UX experience:

`Open TerraFusion Space -> real repo/file tree -> open actual file -> edit it -> save actual workspace file -> undo/redo -> open second file -> split/place it beside first -> running TerraFusion stays interactive beside it -> close/reopen WilliamOS -> same Space + files + layout return.`

The purpose is a WilliamOS interface the owner can actually use.

For this lane:

### Allowed/default work
- React/UI components and interaction
- layout, windows, panes, navigation, Spaces
- editor/file experience
- persistence and restore behavior
- loading, empty, error, and degraded states
- keyboard/accessibility/responsiveness
- visual hierarchy and product polish
- direct browser acceptance and iteration
- thin adapters or truthful fixtures required to exercise the UI

### Does not get to hijack this lane
- TerraFusion backend/product development
- new orchestration architecture
- database architecture or schema programs
- authority-model expansion
- HERMES/runtime-control programs
- governance programs
- CI/CD redesign
- agent-framework redesign
- infrastructure cleanup unrelated to the immediate browser journey

TerraFusion is a **workload used to exercise WilliamOS**, not the W1 product-development lane. If a real TerraFusion runtime dependency is unavailable, the UI may use a clearly identified truthful W1 fixture/degraded surface while UI/UX work continues. Do not silently pretend the fixture is production truth.

## 4. Quarantine of the orchestration experiment

The existing multi-agent/orchestration/control-plane stack is preserved as historical evidence and a source of selectively reusable components.

It is **NOT the canonical WilliamOS product architecture**.

Do not, by default:
- extend it because it already exists;
- route new product features through it;
- imitate its abstractions;
- treat its schemas, queues, Work Orders, grants, receipts, runtime loops, or governance state machines as requirements for new UI/product work;
- infer that documents marked `ACTIVE`, `CONTROLLING`, `TARGET OPERATING MODEL`, or similar inside the quarantined corpus define current product direction.

Reuse is allowed only when a concrete current product need is better served by an existing component than by a simpler path. Reuse must be justified by the product outcome, not by architectural consistency with the experiment.

See `docs/governance/QUARANTINED-ORCHESTRATION.md`.

## 5. Product-first architecture rule

Design outward from the experience:

`user journey -> smallest product surface -> smallest supporting adapter -> only then infrastructure`

Do not design inward from the infrastructure:

`existing control plane -> existing abstractions -> force product through them`

Simple is preferred over complete. Existing is not automatically canonical. More governance is not automatically safer. More indirection is not automatically architecture.

## 6. Execution in 2026

Use coding agents as execution capacity, not as paperwork generators.

For substantial product work:
- keep one coordinator responsible for the fixed acceptance target;
- fan out independent UI/product tasks to bounded coding agents when they do not overlap;
- use separate review/test contexts where useful;
- let agents implement, test, inspect, and iterate directly;
- use browser/runtime evidence as soon as a surface is runnable;
- keep healthy independent lanes moving when another lane is blocked;
- do not turn the owner into a command runner, prompt courier, log courier, Git operator, or routine approver.

The coordinator's job is to **protect completion**. When an agent discovers an adjacent architecture problem, the coordinator decides whether it blocks the current acceptance target. Agents do not expand the mission by following dependency chains on their own.

## 7. No archaeology loop

Previously verified facts remain valid until concrete new evidence contradicts them.

Do not restart broad repository archaeology, architecture discovery, governance reconstruction, or monthly re-derivation merely because a new agent/context started. Resume from the last verified state.

Investigate only the uncertainty that blocks the current acceptance target.

## 8. Priority order

When multiple useful tasks are available, prefer in this order:

1. user-visible product completion;
2. defects directly blocking that completion;
3. product reliability/polish proven by real use;
4. supporting infrastructure required by an already-working product surface;
5. governance/control-plane improvement.

A lower-priority item may not displace a higher-priority item merely because it is architecturally interesting.

## 9. Stop conditions for lane drift

For the W1 frontend lane, touching any of the following is a mandatory drift check:

- `scripts/hermes-bridge/**`
- orchestration/queue/authority/governance schemas
- TerraFusion backend/runtime implementation
- deployment infrastructure
- broad CI/CD changes

Before doing so, state internally which exact W1 browser step is impossible without the change and why a truthful fixture/adapter cannot unblock it. If that cannot be demonstrated, do not perform the change in this lane.

## 10. Reporting

Report progress in terms of the fixed product outcome:
- what the user can now do;
- what remains visibly broken or awkward;
- the smallest blocker to the next user-visible step.

Do not present large amounts of infrastructure work as a substitute for the requested product result.

If the requested experience is unfinished, say **unfinished**.

## 11. Core rule

> **Never let the control system become the product.**

WilliamOS is judged first by whether the owner can use it to get real work done.
