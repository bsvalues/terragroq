# WILLIAMOS_EXPERIENCE_V2_IMPLEMENTATION_CHARTER

Document: `WILLIAMOS-EXPERIENCE-V2-IMPLEMENTATION-CHARTER-001`

Status: `CANONICAL` — this is the single persisted implementation charter for WilliamOS Experience V2.

Recorded by: owner direction, 2026-08-24, against `origin/main = 9dd61c67`.

## Authority position

This charter is controlling **product and architecture** intent for Experience V2. It is **not** an
authority source and it does not establish a competing process hierarchy.

Process authority order:

1. [`AGENTS.md`](../../AGENTS.md) — repository entrypoint.
2. [`docs/governance/multi-agent-operator-playbook.md`](multi-agent-operator-playbook.md) — controlling
   multi-agent operating doctrine.
3. [`docs/governance/sovereign-runtime-and-review-supersession.md`](sovereign-runtime-and-review-supersession.md)
   — controlling supersession on runtime status, review sourcing, and provider dependence.
4. This charter — Experience V2 product/architecture intent and sequencing only.

Where this charter and AGENTS.md differ on repository process, agent workflow, Work Order mechanics,
branch/PR/merge authority, hooks, or execution governance: **AGENTS.md wins.**

## Canonicity rule

There is exactly one persisted charter: this file.

Later PRs, resumed sessions, independent reviews, and HERMES continuation must cite this repository
artifact. A pasted session prompt, terminal scrollback, or remembered prompt text is not an authority
and must not be allowed to evolve into a competing charter. If this file and a pasted prompt differ,
this file is amended through the normal governed process or the pasted prompt is discarded — never
both held simultaneously.

## Controlling specification documents

The Experience V2 / Intelligence Fabric governance package is **not on `origin/main`**. It exists on:

```
origin/feat/williamos-intelligence-fabric-package
```

Verified 2026-08-24: that branch adds 41 documents under
`docs/governance/williamos-intelligence-fabric/` (5508 lines), none of which exist on `main`.

Use that branch's documents as **specification**. Use current `origin/main` as **implementation
truth**. Neither branch is runtime truth without inspection.

Primary experience contract:

```
docs/governance/williamos-intelligence-fabric/experience-v2/20-williamos-experience-v2-personal-operating-environment.md
```

Build sequence (`#987`):

```
docs/governance/williamos-intelligence-fabric/experience-v2/29-command-causality-personalization-and-build-sequence.md
```

Supporting controlling records, by issue:

| Issue | Record |
| --- | --- |
| #978 | `docs/governance/williamos-intelligence-fabric/experience-v2/20-williamos-experience-v2-personal-operating-environment.md` |
| #979 | `docs/governance/williamos-intelligence-fabric/experience-v2/21-context-compartment-and-settled-truth-reconciliation.md` |
| #980 | `docs/governance/williamos-intelligence-fabric/experience-v2/22-cache-data-gravity-and-derived-state-reconciliation.md` |
| #981 | `docs/governance/williamos-intelligence-fabric/experience-v2/23-attention-reentry-semantic-thread-reconciliation.md` |
| #982 | `docs/governance/williamos-intelligence-fabric/experience-v2/24-experience-v2-current-frontend-cutover-map.md` |
| #983 | `docs/governance/williamos-intelligence-fabric/experience-v2/25-native-overlay-and-shell-boundary.md` |
| #984 | `docs/governance/williamos-intelligence-fabric/experience-v2/26-experience-v2-visual-material-cross-device-contract.md` |
| #985 | `docs/governance/williamos-intelligence-fabric/experience-v2/27-system-object-graph-and-direct-operation.md` |
| #986 | `docs/governance/williamos-intelligence-fabric/experience-v2/28-operating-modes-and-policy-bundles.md` |
| #987 | `docs/governance/williamos-intelligence-fabric/experience-v2/29-command-causality-personalization-and-build-sequence.md` |

Hard pre-execution guard for every child of this charter:

```
docs/governance/williamos-intelligence-fabric/07-do-not-rebuild-register.md
```

Also reconcile against: #762 and the current Workbench/Environment contracts, #921 (Environment
replacement decision and implementation lineage), #977 (owner-experience doctrine), #964 (Intelligence
Fabric), #965 (development package), #968–#976 (topology, execution-fabric placement, evaluation
substrate, context/inference seam, model/runtime registry, accelerator residency, observability
headroom, elastic-compute security boundary, model supply-chain boundary).

Do not rely on issue titles. Read the records, the code, and the issue bodies.

## Mission

Implement WilliamOS Experience V2 as a **personal intelligent operating environment**.

WilliamOS is **not**: an AI SaaS application; a ChatGPT/Claude clone; a chatbot with dashboards; a
server-management website; a Proxmox clone; an IDE clone; a collection of mini-apps; a model/provider
picker; a card-grid control panel; a gaming utility.

WilliamOS **is**: a persistent intelligent operating environment in which the owner's projects, work,
systems, machines, resources, data, decisions, artifacts, ongoing thought, and intelligence exist as
real navigable and operable objects.

Conversation is a universal operating **language**. Conversation is **not** the universal
**interface**.

The owner must be able to `SEE`, `ACT`, `COMMAND`, `ASK`, `DELEGATE` and `AUTOMATE` through one
coherent environment.

The experience must preserve place, continuity, settled truth, direct agency, context boundaries, and
owner attention while HERMES absorbs recoverable implementation mechanics.

## Non-negotiable product laws

1. Preserve place.
2. Recognition beats recall.
3. Settled truth stays settled unless new evidence changes it.
4. Exploration is cheap; commitment is deliberate.
5. Attention is a scarce resource.
6. Dense information is allowed when hierarchy is strong.
7. Objects are real and operable.
8. Conversation follows selected context when safe and unambiguous.
9. Direct manipulation remains first class.
10. Responsibility stays with WilliamOS/HERMES through routine recoverable failures.
11. System truth is visible.
12. Implementation mechanics can disappear when WilliamOS safely owns them.
13. Personalization reduces cognitive friction; it does not merely decorate the UI.
14. Ambiguity may be legitimate.
15. One person can inhabit multiple bounded worlds without becoming multiple SaaS accounts.
16. Real work/state creates the feeling of a living environment; decorative animation does not.

## Cognitive contracts

The system must eventually distinguish `EXECUTE`, `EXPLORE`, `THINK_WITH_ME`, `DECIDE`, `REVIEW`.

These are interaction/context contracts. **Do not create five workflow engines.** Reuse the canonical
existing objects — Thread, Decision, Work Order, memory/canon, evidence, authority — where those
already represent actual state transitions.

Exploratory language must not accidentally mint work. A committed architecture must not be reopened by
every new agent without new evidence.

## Epistemic / settled truth

Reuse and extend existing memory/Decision/Doctrine authority semantics. **Do not build a second memory
database.**

The experience must distinguish `QUESTION`, `HYPOTHESIS`, `OBSERVED`, `LIKELY`, `DECIDED`, `SETTLED`,
`PROVEN`, `SUPERSEDED`, `DISPROVEN`.

A model-generated interpretation may **never** silently promote something into `DECIDED`, `SETTLED`, or
`PROVEN`. Those states require canonical source, authority, and evidence.

Generated semantic maps and summaries are **projections**. They are rebuildable. They are not sources
of authority.

## Context / privacy boundary

WilliamOS will contain deeply personal context. **Semantic relevance is never permission to cross a
context boundary.**

Private, personal, or family context must not enter TerraFusion repository agent prompts, county or
professional contexts, system execution, external inference, or unrelated project contexts merely
because embeddings rank it highly.

Context Fabric must support explicit compartment/policy boundaries. At minimum reason about
`PERSONAL_PRIVATE`, `FAMILY`, `PROFESSIONAL/PUBLIC`, `TERRAFUSION/FOUNDER`, `WILLIAMOS_SYSTEM`,
`GENERAL`.

Do not encode sensitive psychological labels into a personalization record. Do not create a personal
CRM.

## The experience model

The target is a semantic/spatial operating environment supporting semantic zoom:

```
WORLD -> SYSTEM -> HERMES -> COMPUTE -> P40 -> ACTIVE WORKLOAD
WORLD -> TERRAFUSION -> SEARCH EXPERIENCE -> ARTIFACT -> CHANGE
```

The selected object drives: Inspector; contextual deterministic actions; conversation referents;
command ranking; history; evidence; related resources.

The owner should not repeatedly need to explain "the P40 in HERMES" when P40 is the selected object.

## SYSTEM is a first-class world

SYSTEM is not Settings. SYSTEM is the operating environment over the physical and logical WilliamOS
fabric.

The current known fabric includes owner-recognizable machine identities: `HERMES`, `AEGIS`, `ATLAS`,
`OMEN`. Do not reduce these to opaque host IDs in the normal interface.

System object classes should eventually include, as canonical projections where supported: `NODE`,
`CPU`, `MEMORY_POOL`, `ACCELERATOR`, `DISK`, `VOLUME`, `NETWORK_INTERFACE`, `FABRIC_LINK`, `SERVICE`,
`CONTAINER`, `WORKLOAD`, `MODEL_ARTIFACT`, `MODEL_RESIDENCY`, `RUNTIME`, `RESERVATION`,
`PROJECT_RESOURCE`, `ELASTIC_WORKER`.

**Do not create a UI-only object database.** Derive these from canonical runtime truth: node registry,
probes, reservations, work, model/runtime state, Evidence, Authority, Execution Fabric.

Human names are aliases over durable identity. Physical replacement hardware must not inherit
historical identity simply because it uses the same slot or friendly name.

## System object first proof

The first serious System proof is `SYSTEM -> HERMES -> P40`.

The P40 must become a stable real object. It should be possible to inspect, as evidence allows: `NOW`,
`TREND`, `HISTORY`, `CAUSE`; and relevant state — utilization, temperature, VRAM capacity, VRAM
usage/headroom, current consumers, current workload, model residency, reservations, topology,
evidence/provenance.

The same exact P40 object must be reachable from System, Inspector, global command/search, and HUD.

Clients must not parse human presentation strings to discover resource identities. Offline or
unreachable objects remain visible and truthful. Stale state must not masquerade as live state.

### Hardware truth is discovered, never declared

Recorded owner direction, 2026-08-24. This governs every hardware object, not only the P40.

The owner must never have to tell WilliamOS what hardware exists. "I installed a P40; update your
database" is a defect in WilliamOS, not an input to it. A changed machine is reconciled into the
System Object Graph through the canonical probe path with no hand-maintained configuration:

```
node boots -> canonical probe path runs -> hardware inventory observed
  -> a new accelerator identity appears (UUID / PCI bus / model / VRAM bound)
  -> compared with previous hardware truth -> "New accelerator discovered on <node>" recorded
  -> capability remains UNKNOWN until measured -> bench / evaluation -> capability evidence
  -> admission
```

Three epistemic facts, never conflated:

1. **EXISTS** — established by observation alone, at boot.
2. **HEALTHY** — established by health measurement.
3. **capability** — driver-generation support, model X at context Y, current VRAM headroom —
   established only by bench or evaluation evidence.

A projection that reports a capability state better than `UNKNOWN` before bench evidence exists is a
failure, not a success. Correspondingly, a canonical record that does **not** attest hardware nobody
has observed is correct behaviour and must not be reported as a WilliamOS defect.

### Hardware-dependent work is typed, and does not park the queue

Where the only missing prerequisite for a gate is live evidence from an unavailable node, that half of
the gate is typed:

```
WAITING_EXTERNAL_ENVIRONMENT
  condition              = <NODE>_REACHABLE
  continuation           = automatic
  ownerDecisionRequired  = false
```

The releasable half — schema, parser, projection, deterministic tests — proceeds on its own evidence
and claims no runtime proof. The runtime half remains mandatory before the **next** gate's terminal
acceptance. One unavailable dependency must never park unrelated eligible work, and node
availability is never an owner task.

## Direct operation

Real objects should expose deterministic actions where canonical action owners exist — for example
inspect, benchmark, reserve, release, drain, evict inactive model, restart service, open terminal, view
evidence, view topology.

But the UI/object projection **never** grants authority. All mutation must reuse existing authority,
policy, execution, reservation, fencing, receipts, and post-state verification. No direct UI hardware
mutation. No bypass around existing governance.

The first implementation journey needs only **one** safe governed mutation. Choose the safest existing
canonical action that satisfies the acceptance contract. If a bounded, recorded search proves none
qualifies, implement the smallest new canonical action by extending the existing Object+Action Registry
and routing it through the existing authority, execution/fencing, evidence, and verified post-state
paths. Do not generalize an unsuitable legacy action merely to preserve its ID, and do not create a
parallel action, authority, or execution mechanism. Do not invent an unsafe action to satisfy the demo.

## Global object + action registry

`lib/intent/workbench-action-registry.ts` is the predecessor. **Generalize it. Do not create a second
command registry.**

The future registry should resolve canonical objects, safe deterministic actions, navigation, modes,
and interaction contracts — for example `p40`, `hermes`, `terra search`, `return`, `show atlas
storage`, `drain hermes`, `review this`, `quiet mode`.

Context may change ranking. Context may **not** silently retarget an ambiguous mutation. If `restart
it` has multiple plausible destructive targets, require disambiguation.

Do not use an LLM for deterministic lookup or actions when canonical state already answers the request.

## Re-entry

Home must become primarily re-entry. It should answer: Where was I? What changed while I was away? What
actually needs me? What is alive now? Which open loops still matter?

`RETURN` is first class. `NEW CHAT` is not the primary metaphor.

Persist useful world/selection location without persisting secrets. Fetch canonical backend truth when
restoring. A stale browser snapshot does not outrank current system truth.

## Semantic Thread map

Do not replace durable chronological Thread conversation. Add a rebuildable semantic projection over
canonical truth containing references such as question, hypothesis, observation, decision,
settled/proven truth, superseded/rejected branch, artifact, open loop, active work, waiting condition.

Every important semantic node must resolve to source records. Destroying every semantic summary or map
must not lose canonical Thread/work state. A long Thread must be re-enterable without transcript
archaeology.

## Attention model

Reuse existing no-focus and Needs-you doctrines. Do not create a generic notification product.

Support an owner-attention policy equivalent to `BACKGROUND`, `AMBIENT`, `NOTICE`, `INTERRUPT`,
`OWNER_DECISION`, `CRITICAL`.

Routine things must not interrupt the owner: model reroute; cache eviction; normal worker completion;
recoverable test failure under active remediation; successful elastic teardown.

A real privacy, spend, or authority boundary may require owner decision. A credible threat to durable
state may be critical.

Background events must not navigate, steal focus, replace the foreground object/artifact, or demand
acknowledgement.

## Visual system

Do not begin with aesthetic experimentation.

Preserve useful existing visual primitives: restrained dark canvas/panel/raised hierarchy; clear
live/warning/fault semantics; good focus handling; reduced motion; serious-tool density.

Supersede generic Tailwind/shadcn card-wall identity; SaaS dashboard composition; AI chat homepage;
glow/gradient AI slop; gaming-dashboard look; Grafana clone; Proxmox clone.

Use four semantic visual/material layers:

1. `WORLD / CONTENT`
2. `SELECTED OBJECT / INSPECTOR`
3. `RECEDING OS CHROME / COMMAND / STATUS`
4. `TRANSIENT HUD / ATTENTION`

The world dominates. Chrome recedes. Depth and material communicate semantic layering. Do not use
translucency where it hurts legibility.

The owner has dyslexia/ADHD considerations, but **do not create an "ADHD mode."** Design instead for
strong hierarchy; stable positions; recognizable object identity; human labels before UUIDs/hashes;
high information density with structure; readable line lengths; strong contrast; redundant state cues
beyond color; technical detail through progressive disclosure; recognition over recall.

Do not dumb the system down.

## Cross-device

Desktop, tablet, phone and HUD are compositions of the **same** world/object/action model. Do not make
separate products.

- Desktop: full environment / world / inspector / command / system operation.
- Tablet: serious operating surface, not a stretched phone.
- Phone: re-entry, Needs You, alerts, voice/conversation, status, safe quick actions.

Do not merely stack desktop cards vertically.

## Native HUD

The Cockpit/Tauri native shell is a projection boundary. It holds **no** governing authority. Preserve
exact-origin/device security.

Native code **may**: show trusted projections; invoke/focus WilliamOS; capture approved gestures;
request governed canonical actions.

Native code **may not** own: placement; authority; hardware mutation; provider/cloud decisions;
secrets; scheduling; HERMES continuation.

Initial HUD proof is read-only: invoke outside main window; show fresh HERMES/P40 state; show current
WilliamOS world; answer deterministic "what is using P40 memory?" where canonical state suffices; open
the exact P40 object in Environment; return to prior foreground work; close HUD; prove resident work
continues.

Do not implement the HUD before the canonical object/action seams exist.

## Temporal model

**Do not create a new generic event authority.** Reuse existing governance events, event log, Evidence,
Decisions, Work Orders, runtime events, queue receipts, Goal timelines, audit records, and
telemetry/history.

Project them into `NOW`, `TREND`, `HISTORY`, `CAUSE`.

Temporal adjacency is not proof of causality. If evidence only supports correlation, label it
correlation. If cause is unknown, say unknown.

## Personalization

A canonical Experience V2 preference system appears genuinely missing. Keep it intentionally small.

Separate: (1) explicit owner preferences; (2) operational policy; (3) learned-confirmed interaction
preferences; (4) private memory/context. Do not mix these.

Learned behavior begins as a suggestion. It may not silently become operational policy.

Preferences must be inspectable, editable, reversible, and compartment-aware.

Do not store secrets, sensitive psychological labels, authority grants, private reflections copied from
memory, or hidden scoring dossiers.

Acceptable interaction preferences: technical density; prose density; overlay visibility; notification
threshold; preferred input modality; re-entry presentation.

Policy that belongs elsewhere: external inference prohibited; protected data locality; cloud spending;
release authority.

## Operating modes

Modes are governed policy bundles, not magic UI toggles. Candidates: `AUTO`, `DEVELOPMENT`,
`TERRAFUSION_SPRINT`, `DEEP_INTELLIGENCE`, `QUIET`, `MAINTENANCE`, `LOCAL_ONLY`.

Every mode must compile into an explicit inspectable policy diff using canonical policy owners.

A mode may influence only supported things: placement preferences; foreground/background priority;
thermal/noise preference; model residency preference; cloud eligibility; locality; spend eligibility;
opportunistic OMEN usage; elastic worker eligibility; attention thresholds; maintenance behavior.

A mode **never** grants cloud spending authority, protected-data egress, destructive maintenance
authority, release authority, or raw overclock authority. Unsupported controls remain `UNSUPPORTED`.

Temporary owner requests such as "Give TerraFusion everything we safely can for the next hour" must
become an explicit **expiring override**, not permanent configuration drift.

## Execution / Intelligence Fabric

**Do not build another scheduler.** The existing Execution Fabric remains the base placement/execution
substrate.

Intelligence Fabric extends it with model, runtime, runtime configuration, accelerator capacity,
context requirements, quality, latency, cost, data gravity, and fabric-link costs.

Automatic Intelligence Fabric placement is **last** in the build sequence. Do not let it block the
first Experience V2 journey.

## Required build order (#987)

Follow the gates in
`docs/governance/williamos-intelligence-fabric/experience-v2/29-command-causality-personalization-and-build-sequence.md`.
Do not skip ahead
because later work looks more visually satisfying.

| Phase | Gate | Content |
| --- | --- | --- |
| 0 | Gate 0 | Reconciliation freeze (#978/#982). Classify every relevant primitive. |
| 1 | Gate 1 | Canonical object projection (#985). |
| 2 | Gate 2 | Unified Object + Action Registry — generalize the existing registry. |
| 3 | Gate 3 | WorkingWorld adapter — bridge `WorkingWorldSnapshot` / Project / System objects. |
| 4 | Gate 4 | Re-entry + semantic projections (#981/#979). No second memory system. |
| 5 | Gate 5 | Experience V2 desktop composition — first terminal shell composition. |
| 6 | Gate 6 | Temporal `NOW`/`TREND`/`HISTORY`/`CAUSE`. |
| 7 | Gate 7 | Visual/material contract (#984). |
| 8 | Gate 8 | Native HUD (#983). |
| 9 | Gate 9 | Tablet/phone compositions. |
| 10 | Gate 10 | Canonical personalization. |
| 11 | Gate 11 | Operating modes (#986). |
| 12 | Gate 12 | Automatic Intelligence Fabric placement. |

## Charter vs Work Order

This charter is controlling architecture. It is **not** a substitute for bounded execution packets.

```
charter -> #987 sequence -> bounded canonical child issue / goal / Work Order
        -> implementation -> validation -> independent adversarial review
        -> evidence -> merge -> next permitted child
```

Each child carries only the controlling subset needed for its slice, plus explicit references back to
this charter. Do not make every implementation agent reconstruct the entire program from scratch.

## The first bounded product journey

Everything converges toward proving this:

1. Owner is working in TerraFusion.
2. WilliamOS preserves the meaningful work location.
3. Owner enters SYSTEM.
4. Owner selects HERMES.
5. Owner selects P40.
6. P40 is a canonical object with fresh state.
7. Owner can see what currently consumes it.
8. Owner can ask "Why is this loaded?"
9. WilliamOS answers deterministically when system truth suffices.
10. Owner performs one safe governed adjustment.
11. WilliamOS verifies actual post-state.
12. Evidence/receipt is inspectable.
13. Owner invokes `RETURN`.
14. Owner returns to the exact meaningful TerraFusion context.

With no SSH, no PowerShell, no NVIDIA control panel, no Ollama UI, no Docker Desktop, no provider
console, no manual context copying, no model selector, and no node selector to recover a routine AI
failure.

## Stop conditions

Stop implementation and reconcile before introducing any of these:

- a third shell;
- a second command registry;
- a UI-only object database;
- a generic new event authority;
- a second memory system;
- a second scheduler;
- a parallel placement engine;
- hidden learned policy;
- HUD authority;
- browser state treated as canonical truth;
- a card-grid dashboard as primary System/world representation;
- a provider/model picker as normal interaction;
- mobile as stacked desktop cards;
- direct Tauri mutation authority;
- private-context leakage;
- an opaque generated summary treated as truth;
- a deterministic system read routed through an unnecessary model;
- backend success that still requires owner infrastructure babysitting.

Also stop if a required canonical owner is genuinely missing and creating it would cross the currently
authorized scope. Record the typed blocker and the exact missing owner. Do not paper over it.

## Working discipline

Do not assume the architecture is wrong merely because current code differs. Do not assume current code
is right merely because it exists.

Read before changing. Prefer adaptation over replacement. Prefer deletion of duplication over addition.
Prefer canonical state over generated summaries. Prefer deterministic reads/actions over LLM calls.
Prefer measurements over assumptions. Prefer human-readable object aliases in UX with durable machine
identity underneath. Prefer bounded vertical proofs over broad mockups.

Keep existing tests passing. Add tests for every new invariant. Never weaken security, governance, or
evidence to make a demo work. Do not merge unrelated cleanup. Do not silently modify owner-directed
node roles. Do not use mock data as proof when real runtime data is available — synthetic fixtures are
acceptable for deterministic tests, not for final runtime claims.

## Repository-native execution

Follow terragroq's native operating doctrine. Where AGENTS.md and the playbook require `/goal`,
`/loop`, Work Orders, evidence, receipts, review lanes, or continuation mechanics for work of this
class, use them. **Do not create a parallel project-management mechanism because this charter describes
phases.** Map Experience V2 phases into the canonical WilliamOS work/execution system.

Agents own implementation mechanics allowed by repository doctrine, including branch/push/PR/merge
behavior where AGENTS.md grants that authority. Do not ask the owner to perform routine git/PR
coordination that repository doctrine assigns to the implementation agent.

## Phase reporting contract

At the end of every bounded phase, report:

```
PHASE
STATUS: PASS / BLOCKED / FAIL
CURRENT TRUTH DISCOVERED   — what existing implementation actually owns
REUSED                     — existing primitives retained
EXTENDED                   — existing primitives changed
SUPERSEDED                 — composition removed/replaced, and why
NEW                        — only genuinely missing primitives added
TESTS                      — exact commands + results
RUNTIME PROOF              — what was exercised against live state
KNOWN GAPS                 — specific and bounded
NEXT                       — the next permitted phase from #987
```

Do not report "complete" if only components and tests exist but the runtime journey has not been
exercised.

## PR / delivery discipline

No single giant Experience V2 PR. Use bounded PRs aligned to the build sequence. Each PR must have one
architectural owner, one bounded acceptance target, tests, runtime evidence where applicable, no
unrelated redesign, explicit predecessor/reuse notes, and explicit stop conditions.

Do not start a later-phase PR while its prerequisite ownership seam remains unresolved.

Independent review should attack: duplication; authority bypass; stale state masquerading as live;
context leakage; focus theft; SaaS/card-wall regression; semantic projection becoming authority;
unnecessary LLM dependency; broken restoration; accessibility regressions; cross-device identity
inconsistency.

The Phase 0 collision map itself receives independent review **before** Phase 1 proceeds far. A
misunderstood ownership seam at Phase 0 is inherited by every later phase; catch it there.

## Terminal experience test

Experience V2 succeeds when the owner can truthfully say:

> I know where I am. The system knows where I was. What I see is real and operable. Work continues when
> I leave. Things already decided stay decided unless evidence changes. I can explore without
> accidentally creating obligations. I can go deep without losing the larger system. I do not have to
> explain myself again every time I change rooms.

## Companion record

The Phase 0 reconciliation and collision map produced under this charter is
[`williamos-experience-v2-phase0-collision-map.md`](williamos-experience-v2-phase0-collision-map.md).

## Amendments

This charter is amended only through the governed process its canonicity rule requires: an explicit
recorded owner decision, applied to this file, with the replaced text and the triggering evidence
both named. One current disposition per artifact — an amended sentence is **replaced**, not annotated
in place and left to be read two ways.

### AMENDMENT-001 — the first-action rule

Section: **Direct operation**. Date: `2026-08-24`. Status: `ACTIVE`.

Approved by explicit owner decision, 2026-08-24, delivered to the coordinator lane and applied here
by the amendment-recorder lane. This record does not mint authority; it transcribes a decision that
was made elsewhere.

**What changed.** The sentence *"Choose the safest existing canonical action that proves the
architecture."* was replaced by the approved text now standing in **Direct operation**. The following
sentence, *"Do not invent an unsafe action to satisfy the demo."*, was **retained unchanged**: the
owner decision did not withdraw it, and since the amendment now permits building an action, that
prohibition binds harder than it did before, not less. Nothing else in the charter was edited.

**Triggering evidence.** The bounded first-action search run for Gate 2 and recorded in
`williamos-experience-v2-gate2-first-action-search-record.md`, delivered on PR #996. Against the
stated denominators, re-measured at `053a33bd`, no existing canonical action qualified. The strongest
candidate, `LOOM_OPERATIONS.service.restart`, was disqualified on two **intrinsic** grounds: it
cannot select a `SystemObject` target, and it cannot verify post-state. Bounded packet: #995.
Program and build sequence: #987, step 2.

**Owner-stated semantics, recorded beside the amendment.** These govern how the amended sentence is
read. They constrain it; they do not extend it.

- reuse remains mandatory-first, not optional;
- absence must be proven by a bounded recorded search;
- a new action is permitted only when that proof exists;
- "new action" means a new canonical verb/adapter in the existing machinery, not a new control plane;
- post-state verification is part of the action contract, not a later convenience;
- legacy primitives (e.g. `service.restart`) must not be distorted simply to claim reuse;
- this amendment grants NO new authority category by itself.

**What this clears, and what it does not.** It clears the typed state `CHARTER_AMENDMENT_REQUIRED`
that #996's search record raised against Gate 2 acceptance invariants 9, 12 and 13. It clears an
**authority block only**. It does not accept those invariants, does not build the action, and does
not grant any merge, execution, reservation, or authority mode. The action itself is typed as a
follow-on and is not this amendment's work.

**Citation drift — read this before trusting a `charter:<line>` citation.** This amendment replaces
two source lines with six. Every line citation into this file **below** the **Direct operation**
section therefore shifts by **+4**. Citations recorded before 2026-08-24 point at the pre-amendment
file:

| Cited as | Now at | Content |
| --- | --- | --- |
| `charter:273-274` | `charter:273-278` | the first-action rule (this amendment) |
| `charter:276-288` | `charter:280-292` | global object + action registry |
| `charter:285-287` | `charter:289-291` | context ranks, context never retargets |
| `charter:450` | `charter:454` | gate table, Gate 2 row |
| `charter:464-470` | `charter:468-474` | bounded child packet as required predecessor |
| `charter:488-489` | `charter:492-493` | the first journey's governed adjustment and post-state |

Companion record, carrying the typed continuations this amendment leaves:
[`williamos-experience-v2-first-action-amendment-record.md`](williamos-experience-v2-first-action-amendment-record.md).
