# 20 — WilliamOS Experience V2: Personal Operating Environment

## Purpose

Freeze the experience consequences of the owner review before additional frontend implementation. This document deliberately records product requirements, not private biography. Sensitive personal source material does not belong in the repository.

## Product thesis

WilliamOS is not a SaaS AI application, a chatbot with dashboards, a server console, or a collection of mini-apps.

**WilliamOS is the persistent intelligent operating environment in which the owner's digital work, systems, projects, resources and ongoing thought exist.**

Conversation is a universal operating language, not the universal interface.

The owner must be able to see, navigate, inspect and directly operate real objects while WilliamOS/HERMES absorbs recoverable implementation mechanics.

## Controlling experience laws

1. **Preserve place.** Returning to useful context is more important than presenting a blank starting state.
2. **Recognition beats recall.** Stable objects, spatial relationships, human labels and current truth replace memorized commands/IDs/history reconstruction.
3. **Settled truth remains settled.** A new agent/model may challenge a settled premise only with explicit new evidence; it may not casually rediscover architecture.
4. **Exploration is cheap; commitment is deliberate.** Ideas, hypotheses, reviews, decisions, authorization and execution are distinct states.
5. **Attention is a scarce resource.** Recoverable internal events remain background/ambient; interruption is reserved for genuine owner or safety boundaries.
6. **Dense information is allowed when hierarchy is strong.** Do not confuse accessibility with hiding useful complexity.
7. **Objects are real and operable.** Machines, GPUs, disks, links, services, workloads, models, Projects, Threads and Artifacts are selectable objects with contextual actions.
8. **Conversation follows context.** Natural-language referents inherit the currently selected world/object when safe and unambiguous.
9. **Direct manipulation remains first class.** Buttons, menus, keyboard commands, drag/reassign where safe, and inspectors coexist with natural language.
10. **Responsibility stays with the system.** Routine provider/model/node/runtime failures do not hand coordination back to the owner.
11. **System truth is visible; implementation mechanics may disappear.** The owner can understand and control the machine room without babysitting inference topology.
12. **Personalization reduces cognitive friction; it does not decorate it.** Theme/skin changes are secondary to continuity, hierarchy, vocabulary, re-entry and interruption policy.
13. **Ambiguity may be legitimate.** THINK/EXPLORE contexts must not be coerced into tasks or premature decisions.
14. **One person, bounded worlds.** Personal, family, public/professional, founder/commercial and system contexts require strong information/authority boundaries without pretending they are separate identities.
15. **The environment feels alive because real state changes are visible, not because the UI performs decorative animation.**

## Cognitive interaction contracts

WilliamOS must distinguish at least these intent contracts:

- `EXECUTE` — desired outcome is sufficiently known; drive toward completion and own continuation.
- `EXPLORE` — expand possibilities/implications without creating obligations.
- `THINK_WITH_ME` — preserve nuance and continuity; understanding is the outcome and action may be inappropriate.
- `DECIDE` — compress alternatives/evidence into a genuine decision boundary.
- `REVIEW` — attack an existing conclusion before implementation; search for gaps, collisions and counterevidence.

Transition to `EXECUTE` must not occur merely because an exploratory sentence resembles an instruction. Conversely, once architecture is deliberately committed, routine execution must not repeatedly reopen it without new evidence.

## Epistemic states

Important propositions should support explicit state rather than relying on conversational frequency:

- `QUESTION`
- `HYPOTHESIS`
- `OBSERVED`
- `LIKELY`
- `DECIDED`
- `SETTLED`
- `PROVEN`
- `SUPERSEDED`
- `DISPROVEN`

Settled/proven truth requires provenance and supersession semantics. Retrieval relevance alone cannot override it.

## Work/idea lifecycle

Do not render every unfinished thought as debt. Support at minimum:

- `IDEA`
- `EXPLORING`
- `CANDIDATE`
- `DECIDED`
- `AUTHORIZED`
- `ACTIVE`
- `WAITING`
- `INCUBATING`
- `PARKED`
- `SUPERSEDED`
- `INTENTIONALLY_ABANDONED`
- `DONE`

Home/status surfaces must not reduce these to a giant overdue/open-task count.

## Attention contract

System events must carry an owner-attention class such as:

- `BACKGROUND`
- `AMBIENT`
- `NOTICE`
- `INTERRUPT`
- `OWNER_DECISION`
- `CRITICAL`

Examples:

- model reroute, cache eviction, successful remote teardown: BACKGROUND/AMBIENT;
- ordinary worker completion: AMBIENT;
- recoverable test failure with active remediation: BACKGROUND/AMBIENT;
- degrading durable storage: NOTICE/INTERRUPT according to risk;
- new privacy/spend/authority exception: OWNER_DECISION;
- credible threat to durable state: CRITICAL.

Background events may not navigate, steal focus, replace the foreground artifact, or demand acknowledgement.

## Re-entry contract

Home is primarily a re-entry surface, not discovery marketing.

It must answer quickly:

1. Where was I?
2. What changed while I was away?
3. What genuinely needs me?
4. What is alive now?
5. What open loops remain meaningful?

`RETURN` is a first-class action. `NEW CHAT` is not the dominant operating metaphor.

Closing/reopening a client must restore useful world/Project/Thread/object context without persisting secrets.

## Spatial / semantic zoom

The environment should support movement through levels of meaning rather than page taxonomy.

Example system path:

`WORLD -> SYSTEM -> HERMES -> COMPUTE -> P40 -> ACTIVE WORKLOAD`

Example product path:

`WORLD -> TERRAFUSION -> SEARCH EXPERIENCE -> ARTIFACT -> CHANGE`

The same Inspector/action grammar follows the selected object. Conversation inherits the selected context when unambiguous.

## Worlds and boundaries

WilliamOS may present domain worlds such as:

- founder/product/project work;
- public/professional work;
- private WilliamOS/system work;
- personal/family/private reflection.

These are not SaaS accounts or cosmetic workspaces. They are contextual worlds with different objects, vocabulary, data policies and authority.

Private/personal context must not leak into professional, repository-agent or technical execution context merely because semantic retrieval finds it relevant. Context Fabric must support explicit compartment/policy boundaries.

## System world

SYSTEM is a first-class operating environment, not a settings page.

At minimum it must support meaningful views over:

- Fabric/topology;
- machines/nodes;
- CPU/GPU/RAM;
- storage/volumes/disks;
- network/links/routes;
- services/containers/runtimes;
- workloads/queues/reservations;
- Intelligence models/runtimes/caches;
- security/authority/evidence;
- temporal history and causality.

HERMES, AEGIS, ATLAS and OMEN must remain recognizable stable objects with owner-directed roles. Machine identity must not collapse to opaque IDs in normal presentation.

## Accessibility / cognitive-load design

Do not create an 'ADHD mode' or reduce the interface to low information density.

Prefer:

- strong visual hierarchy;
- stable spatial positions;
- recognizable object shapes/glyphs;
- human labels before hashes/UUIDs;
- generous spacing and readable line lengths for prose;
- high contrast and restrained translucency;
- redundant status cues (shape/icon/text, not color alone);
- progressive technical detail;
- explicit cause/meaning beside raw metrics;
- re-entry summaries instead of transcript rereading;
- semantic maps of what a long Thread became.

Technical IDs remain inspectable/copyable but should not be primary nouns.

## Semantic Thread map

A long Thread must be able to project a living semantic map of concepts, decisions, artifacts, open questions, superseded branches and implementation state. Chronology remains available but is not the only representation of thought.

The map must distinguish what was merely discussed from what became decided/settled/authorized.

## Interface densities

The same truth/object model should project into:

1. **Ambient** — quiet status/presence with no interruption.
2. **Overlay/HUD** — fast system/work state, command, voice/text and safe quick actions without leaving foreground work.
3. **Full Environment** — deep spatial operation of work and system worlds.
4. **Inspector/Technical** — progressive provenance, raw metrics, identities and engineering controls.

Do not build separate AI Console / Server Manager / Model Manager products.

## Global interaction grammar

WilliamOS should support:

- `SEE` — select/inspect;
- `ACT` — deterministic controls/direct manipulation;
- `COMMAND` — global Spotlight-like object/action search;
- `ASK` — natural-language question in current context;
- `DELEGATE` — give an outcome to WilliamOS/HERMES;
- `AUTOMATE` — establish a standing governed policy/profile.

Do not route a deterministic system query through expensive model inference when canonical system state can answer it directly.

## System voice

The default system voice is:

- concise by default, deep on demand;
- low-flattery and evidence-specific;
- willing to disagree after establishing context;
- calm during failure without patronizing language;
- precise about uncertainty;
- able to change abstraction level quickly;
- focused on what changed, why it matters and what happens next.

Routine completion may be as short as `Done`, provided the relevant state/evidence is available for inspection.

## Personalization layers

Personalization should be explicit/inspectable and separated into:

1. identity/vocabulary/worlds;
2. interaction density/accessibility/input preferences;
3. operational policy (locality, spend, interruption, recovery, profiles);
4. learned workflow/re-entry patterns.

Learned behavior must be reviewable and reversible. Do not create opaque psychological labels or expose private reflections to unrelated agents.

## Failure tests

Experience V2 fails if any of these are required for ordinary operation:

- blank-slate reorientation after every restart;
- rereading a long chat to recover settled architecture;
- remembering which machine/provider/model owns a capability;
- copying context between models/agents;
- selecting a provider/model/node to recover a routine failure;
- treating every explored idea as backlog debt;
- flattening personal reflection into tasks;
- hiding useful system truth in the name of simplicity;
- using dense equally weighted card grids as the primary world representation;
- requiring infrastructure-specific navigation for ordinary outcomes;
- allowing private/personal context to leak into unrelated professional/technical execution;
- forcing long opaque IDs into normal reading;
- stealing focus for background state changes;
- presenting backend success as product success while the owner still coordinates the system.

## Acceptance journeys

### A — Re-entry

Leave during meaningful work, allow authorized work to continue, reopen from another client, and restore the same useful world/Thread/object with a concise `what changed / needs you / alive now` projection.

### B — Exploration to commitment

Explore several alternatives without creating work; request REVIEW; make a decision; explicitly authorize execution; prove only the authorized branch enters work state and settled decisions are not casually reopened.

### C — System operator

Enter SYSTEM, understand HERMES/AEGIS/ATLAS/OMEN health quickly, select HERMES/P40, understand utilization/temperature/memory/current consumers, ask a contextual question, execute one safe governed adjustment, observe the resulting state and inspect evidence without SSH/PowerShell/provider consoles.

### D — Seamless recovery

During foreground work, force a model/runtime/node/provider failure. Preserve place, context, focus and responsibility while HERMES recovers/reroutes. Technical provenance remains inspectable afterward.

### E — Attention protection

Generate multiple background completions, a recoverable failure, a meaningful notice and a genuine owner decision. Only the owner decision/appropriate risk may interrupt foreground work.

### F — Context boundary

Prove personal/private material cannot enter a professional/repository/model context without explicit permitted policy, even when semantic retrieval would rank it highly.

### G — Semantic re-entry

Take a long exploratory Thread containing hypotheses, rejected ideas, decisions and implementation. Re-enter through the semantic map and correctly distinguish current truth, superseded branches, open questions and active work without transcript archaeology.

## Terminal product test

The experience succeeds when the owner can truthfully say:

- I know where I am.
- The system knows where I was.
- What I see is real and operable.
- Work continues when I leave.
- Things already decided stay decided unless evidence changes.
- I can explore without accidentally creating obligations.
- I can go deep without losing the larger system.
- I do not have to explain myself again every time I change rooms.

This contract supplements the existing Workbench/Environment and Intelligence Fabric contracts. Any conflict must be reconciled explicitly before frontend implementation; do not silently layer a third interaction model.
