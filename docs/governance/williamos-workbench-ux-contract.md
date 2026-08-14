# WilliamOS Workbench UX Contract

**Document:** `WILLIAMOS-WORKBENCH-UX-CONTRACT-001`

**Status:** `ACTIVE / CONTROLLING`

**Origin:** authored 2026-08-14 at the owner's direction after the installed
thin Cockpit failed product acceptance. This records the owner's controlling
interaction model; it does not mint implementation or execution authority.

**Parent outcome:** GitHub issue #762, `WILLIAMOS_USABLE_COCKPIT_V1`

**Scope:** product language, spatial model, interaction behavior, UX acceptance,
and shell-selection gate.

**Risk:** documentation and planning only; this document does not authorize UI,
runtime, authentication, schema, deployment, or shell changes.

## Authority and supersession

WilliamOS is a persistent owner workbench, not an administrative dashboard that
reports on an operating system.

This contract supersedes the product-interaction and navigation portions of:

- `williamos-unified-system-architecture.md` that describe permanent top-level
  subsystem areas;
- `williamos-navigation-information-architecture.md` that describe a set of
  destination pages or rooms;
- issue #762's literal interpretation of `HOME / PROJECTS / ACTIVITY / SYSTEM`
  as four separate mini-sites; and
- any assumption that the current thin Tauri WebView is accepted product UX.

The Project model, Activity read-model, System truth model, universal-intent
router, device authentication, HERMES hosting, HTTPS boundary, and native-shell
security work remain valuable foundations. They are not by themselves UX
acceptance.

Where this document conflicts with earlier WilliamOS product-interaction,
navigation, desktop-shell, or visual-composition guidance, this document
governs. It does not weaken the Owner boundary, safety rules, authority gates,
truth semantics, or evidence requirements.

Until this contract is accepted, **further frontend composition and desktop-shell
selection are frozen**. Defect fixes that preserve existing behavior are allowed;
new page architecture, navigation expansion, and visual polish are not.

## North Star

> WilliamOS is a persistent owner workbench where William states intent, watches
> meaningful work unfold, changes direction when useful, and inspects proof when
> desired. Projects provide context; threads contain work; artifacts contain
> results; decisions appear only when ownership is genuinely required. Execution,
> governance, agents, memory, evidence, and infrastructure remain available
> without becoming the owner's operating model.

The experiential standard is: **a serious workbench whose central surface is an
intelligent operating partner, not a website describing an AI system.**

## User language

The normal interface exposes four nouns:

- **Project** — durable context that may span repositories, folders, worktrees,
  systems, resources, and sessions.
- **Thread** — a conversation, outcome, or workstream within a Project.
- **Artifact** — something produced or inspected: code, diff, document,
  recommendation, evidence, or visualization.
- **Decision** — a genuine owner-authority boundary.

The normal interface exposes five verbs:

- **Ask** — explain, research, or reason.
- **Do** — accomplish an outcome.
- **Inspect** — show detail, proof, changes, or rationale.
- **Steer** — change direction while work is active.
- **Stop** — pause or cancel work.

Goal, Work Order, Council, Forge, Hermes, Evidence, Authority, Trace, execution
attempt, fencing token, and provider are implementation vocabulary. They may
appear in progressively disclosed technical detail, not as prerequisites for
normal use.

## One application surface

WilliamOS is one Workbench. `HOME`, `PROJECTS`, `ACTIVITY`, and `SYSTEM` remain
the four left-edge view modes for issue #762. They are modes of one persistent
surface, not unrelated sites or four permanent page compositions.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ WilliamOS   Project / Thread                          Ctrl+K  Ask or do... │
├────┬──────────────────┬───────────────────────────────┬────────────────────┤
│    │ Project context  │                               │ Inspector          │
│ ◉  │ and threads      │ Current work thread           │ Context            │
│ ◫  │                  │                               │ Changes            │
│ ◎  │                  │ Conversation + work timeline  │ Proof              │
│ ⚙  │                  │                               │ Decision           │
├────┴──────────────────┴───────────────────────────────┴────────────────────┤
│ EXECUTION ▴   agents · tests · terminal · logs · background work          │
├────────────────────────────────────────────────────────────────────────────┤
│ HERMES ●   AEGIS ●   ATLAS ●       agents working       Needs you: 0      │
└────────────────────────────────────────────────────────────────────────────┘
```

Spatial meaning is stable:

- left edge changes view;
- left sidebar changes Project or Thread context;
- center contains the current work Thread and is the product's primary surface;
- right inspector explains the selected work without taking ownership of it;
- bottom panel exposes execution machinery on demand;
- status bar provides ambient, evidence-backed system truth; and
- `Ctrl+K` provides universal intent and commands.

The layout must collapse deliberately on smaller screens without converting
these areas into independent products.

## The Thread is the product

A Thread combines conversation and execution into one durable timeline. It may
contain owner intent, WilliamOS responses, delegated work, validation, review,
remediation, artifacts, decisions, and delivery receipts.

Thread is a projection and interaction aggregate over existing durable outcome,
goal, Work Order, conversation, execution, evidence, and artifact records. This
contract does not authorize a parallel task authority model or new schema.

Selecting a timeline item may reveal its detail in the Inspector. It must not
navigate the owner away from the Thread merely because a tool produced output.

An active Thread always exposes the meaningful state and the owner verbs that
apply, including `Steer`, `Pause`, or `Stop` when work is interruptible.

## Views

### Home

Home is the useful empty/default Workbench state, not a dashboard. Within three
seconds it answers:

- Is anything wrong?
- Does anything need me?
- Is anything working?

It may show recent outcomes, active Threads, and one universal composer. It does
not foreground event counts, resource chips, truth-state footers, infrastructure
provenance, or equal-weight status cards.

### Projects

Projects is an Explorer. Selecting a Project changes Thread history, universal
intent context, search, memory, decisions, resources, and Activity together.
Project is never reduced to repository identity.

### Activity

Activity is a compact chronological view backed by the truthful Activity
read-model. Selecting an item opens or focuses the owning Thread. Activity does
not own a separate detail experience.

### System

Normal System presence is the status bar: HERMES, AEGIS, ATLAS, active agents,
and genuine owner attention. A degraded item can open contextual Inspector
detail. A full System view remains available for troubleshooting, but
infrastructure is not the daily workflow.

## Inspector

Evidence, Authority, Trace, and Council are lenses on the selected work, not
separate products. The Inspector uses these human-facing views:

- **Overview** — result and current context;
- **Changes** — artifacts and diffs;
- **Proof** — tests, evidence, sources, and review results;
- **Decision** — genuine owner authority, recommendation, dissent, and unknowns;
- **Technical** — Work Order, execution attempt, trace, checkpoints, and other
  machinery.

Council intelligence appears where a decision is being considered. The owner
must not navigate to a Council module to benefit from it.

## Execution panel

Execution is collapsed by default and opens into contextual views such as
`Terminal`, `Tests`, `Logs`, and `Agents`. Raw streams and placement machinery
belong here, not on Home.

The panel exposes execution truth without turning William into an operator or
diagnostic courier.

## Universal intent

`Ctrl+K` and the visible composer both use one action registry. Keyboard,
palette, contextual buttons, and conversational input may provide different
affordances, but must invoke the same action and state transition.

Universal intent covers asking, doing, inspecting, switching context, locating
artifacts or decisions, steering, stopping, and opening System detail. The owner
does not select an internal subsystem before stating intent.

## Focus and continuity invariants

- Background completion may update a badge, timeline, cache, or notification.
  It must not switch Project, replace the foreground Thread, open a pane, or
  steal focus.
- Tool results do not automatically open the Inspector or Execution panel.
- Project, Thread, Inspector tab, panel visibility, pane sizes, and collapsed
  tree state survive appropriate context switches and Cockpit restart.
- Restored spatial state is scoped to the authenticated user and device. It
  excludes credentials, session material, private keys, and governed content
  that the authoritative backend requires the client to fetch again.
- Expensive stateful panes remain mounted when hidden where losing their state
  would break continuity.
- Direct manipulation provides immediate visible feedback; persistence failures
  reconcile visibly and never silently discard owner intent.

## Human state semantics

Normal copy uses these states consistently:

- **Empty** — nothing exists yet.
- **Idle** — nothing is currently executing.
- **Working** — work is active.
- **Waiting** — progress depends on an external condition.
- **Needs you** — a genuine owner decision is required.
- **Stale** — the latest trustworthy observation is old.
- **Degraded** — capability is impaired but partly usable.
- **Offline** — the authoritative backend is unreachable.

`Ready` is not a substitute for evidence. Technical truth states such as
`live`, `persisted`, `inferred`, and `unknown` remain available in Inspector or
Technical detail, while normal copy stays human.

Healthy or working status in the compact status bar requires fresh live
evidence. Persisted, configured, inferred, stale, or unknown signals cannot be
rendered as healthy-live merely to simplify the display.

## Visual and interaction rules

- Flat, not boxed. Group with whitespace, indentation, typography, selection
  backgrounds, and sparing hairlines.
- No default cards and no card-in-card composition. A box must represent an
  artifact or object that genuinely needs physical separation.
- No pill infestation, decorative gradients, glow, faux science-fiction chrome,
  gigantic headings, or prose that explains how to use the page.
- Density resembles a serious tool: readable 14–15px body text, compact
  secondary metadata, and monospace only for technical identifiers.
- One primitive per concern, tokens rather than call-site literals, and one
  action implementation regardless of entry point.
- Motion is functional, brief, reduced-motion aware, and never disguises
  latency or moves layout without cause.
- Keyboard access, visible focus, screen-reader updates, and responsive behavior
  are acceptance requirements.

## Objective UX acceptance

### Three-second test

On opening WilliamOS, the owner can tell whether anything is wrong, needs them,
or is working.

### Ten-second test

The owner can switch between TerraFusion and WilliamOS and identify what each
is doing.

### Thirty-second test

The owner can start a meaningful outcome and know WilliamOS accepted and owns
it.

### One-minute trust test

From active work, the owner can answer what is happening, who is doing it, what
changed, whether validation passed, and why WilliamOS is doing it.

### Interruption test

The owner can steer, pause, or stop active work without creating a new
administrative workflow.

`Pause` and `Stop` appear only where an already-authorized, proven interrupt
protocol exists. Otherwise WilliamOS truthfully reports that interruption is
unavailable and does not ask the owner to operate infrastructure.

### Recovery test

When an agent, network, or node fails, WilliamOS shows recovery progress and
does not instruct the owner to become the technician.

### Zero-module test

A first-time owner does not need to understand Goal, Work Order, Council, Forge,
Hermes, Evidence, Authority, or Trace.

### No-navigation test

Anything important can be found or invoked through universal intent.

### Focus test

No background event navigates, switches Project, opens a pane, or steals input
focus.

### State-restoration test

After Cockpit restart, the owner returns to the same useful working context.

## Automatic rejection rules

A WilliamOS UI change fails design review if it introduces:

- a top-level navigation destination without overwhelming workflow evidence;
- a grid of equal-weight status cards;
- an internal subsystem as a required user-facing noun;
- static or inferred infrastructure status presented as current;
- a background event that moves foreground context;
- separate action logic for a second affordance;
- a bespoke visual primitive where the system primitive fits;
- a technical identifier where a human label is sufficient;
- a permanent non-actionable status chip;
- explanatory prose compensating for poor information architecture; or
- a feature that requires understanding WilliamOS internals.

## Shell selection gate

Tauri, a Hermes Desktop fork, a Hermes Desktop plugin/integration, and a thin
custom shell remain candidates. No shell is selected by this contract.

After this interaction contract is accepted, one bounded feasibility spike may
compare the candidates using the same evidence:

- remote HERMES attachment and WilliamOS authority ownership;
- device authentication and browser recovery;
- Project switching and Thread continuity;
- central Thread, Inspector, Execution panel, and status bar composition;
- native notifications and no-focus-steal behavior;
- Windows installation, restart restoration, update model, and performance;
- capability isolation and prevention of local shell/filesystem authority
  expansion.

The current Tauri 0.1.7 build proves HTTPS, native WebView, exact-origin policy,
device bridge availability, packaging, and installation feasibility. It does
**not** pass this Workbench UX contract and must not be called the accepted
Cockpit product.

## Reference patterns

These sources inform the contract; they do not transfer product authority to an
external project:

- [VS Code UX architecture](https://code.visualstudio.com/api/ux-guidelines/overview)
  for Activity Bar, sidebars, editor, panel, status bar, and command surfaces.
- [Hermes Desktop design contract](https://github.com/nousresearch/hermes-agent/blob/main/apps/desktop/DESIGN.md)
  for flat composition, contextual panes, one action/one home, continuity, and
  no focus theft.
- [Hermes Desktop architecture rules](https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/AGENTS.md)
  for authoritative backend state and renderer presentation boundaries.
- [Codex app](https://openai.com/index/introducing-the-codex-app/) for
  project/thread/worktree-centered agent supervision.
- [Claude Code autonomy](https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously)
  for checkpoints, background work, subagents, and reversibility.

## Contract acceptance

This documentation phase is complete only when:

- this contract is independently reviewed;
- issue #762 explicitly adopts it and records the UI freeze;
- older navigation doctrine is marked superseded where it conflicts;
- the installed thin Cockpit is recorded as a feasibility artifact rather than
terminal UX acceptance; and
- no frontend or shell implementation is bundled into the contract change.

## Current implementation disposition

Preserve these foundations without preserving their current composition:

- `getOperatorState()` and its authenticated tenant boundary;
- durable Project and resource bindings, never repository inference;
- the Activity projection and distinct latest-event/read observation clocks;
- the System truth projector and live/persisted/inferred/unknown semantics;
- authenticated, deterministic, fail-closed intent routing;
- owner-decision exact-boundary behavior;
- device authentication, HERMES hosting, HTTPS/origin controls, browser
  recovery, and the constrained Tauri feasibility bridge; and
- existing deep routes and history for compatibility and contextual detail.

The implementation phase explicitly replaces:

- the split compact-Home/full-sidebar shells with one Workbench;
- Home's dashboard/card/glow composition while preserving its useful
  information priorities;
- the Projects card grid with the Project/Thread Explorer;
- Activity detail ownership with Activity-to-Thread focus;
- the default System panel dump with evidence-backed ambient status and
  contextual troubleshooting;
- classify-then-open intent handoff with direct safe transitions from one action
  registry;
- the current intent taxonomy where it lacks Inspect, Steer, Stop, context
  switching, and artifact or decision lookup;
- repository-derived Project identity and proof links that incorrectly treat
  Runtime as Evidence; and
- source-grep/layout-string tests with rendered interaction, focus, responsive,
  restoration, and real-projection acceptance tests.

Deep capability is retained. Hiding or deleting capability is not a valid way
to pass the zero-module or four-view tests.
