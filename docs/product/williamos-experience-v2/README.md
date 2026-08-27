# WilliamOS Experience V2 — Codex Build Package

Status: **CONTROLLING FOR THIS UI/UX IMPLEMENTATION PASS**

This package exists so Codex cannot reinterpret the latest WilliamOS direction as another generic IDE, dashboard, chatbot, or orchestration console.

The controlling product rule remains `PRODUCT_EXECUTION.md`. This package narrows that rule into a concrete UI target.

## What WilliamOS is

WilliamOS is the **living operating environment** the owner inhabits while building TerraFusion and doing other serious work.

It is not:

- a TerraFusion business/operator UI;
- a card-grid dashboard;
- a ChatGPT clone with an editor attached;
- a VS Code clone with extra AI buttons;
- an orchestration/control-plane status page;
- a permanent Brain Council dashboard;
- a collection of tiny toy windows;
- a static mockup that only looks powerful.

It is:

- an environment with durable **Spaces**;
- a real spatial window manager with independent persistent work surfaces;
- real source, preview, terminal, diff, test, evidence, agent, and document surfaces;
- a transient universal **Line** for command, ask, delegate, and act;
- a contextual **Inspector** that follows selected objects without becoming a permanent panel requirement;
- durable provider-neutral agent sessions that keep working whether their conversation is visible or not;
- a persistent William intelligence presence that follows the owner through Spaces;
- Mission Control showing actual live Spaces/windows, not fake dashboard cards;
- Brain Council as summonable advisory intelligence, not the default UI.

## The living quality / William's ego

WilliamOS must feel inhabited by a coherent intelligence called **William**.

William is not a cartoon avatar and is not whichever provider/model happens to execute a task.

William should feel:

- calm;
- confident;
- opinionated;
- proactive;
- context-aware;
- protective of the owner's attention;
- willing to say a design is weak;
- willing to suggest or spin up better alternatives;
- aware of active agents, current work, evidence, and unresolved risk;
- capable of asking for a decision only when a real decision is needed.

Examples of acceptable William presence:

> This interaction is weak. I spun up two alternatives.

> Codex is implementing option B. Claude is reviewing it. HERMES is running the tests.

> The preview is stale. I would not merge this yet.

> I think option B is better. Ask Council if you want the dissenting view.

William must never become decorative AI prose. Every visible judgment should connect to something the user can inspect or act on.

## AI power must be directly usable

The user must be able to select a real object and immediately do AI work with it.

Selected file:

`Ask · Change · Delegate · Review`

Selected preview/runtime:

`Inspect · Debug · Explain · Delegate`

Selected diff:

`Review · Improve · Challenge · Merge`

Selected agent:

`Talk · Redirect · Pause · Fork · Review work`

Selected Space:

`Summarize · Continue · Delegate · Council`

The Line must understand the current Space, selected object, open surfaces, active agents, and current work so the owner does not repeatedly restate context.

Examples:

- `Codex, fix this interaction. Claude, review him when he is done.`
- `Give this Space to three agents: builder, reviewer, and bug hunter.`
- `Council this before we merge.`
- `HERMES, run this locally.`
- `William, finish this.`

## Agents

Agents are durable sessions, not chat panes.

The normal UI should make active sessions visible without forcing an Agents dashboard.

Examples:

- `Codex · Builder · implementing · 6 files changed`
- `Claude · Reviewer · 2 findings`
- `HERMES · Local execution · tests running`
- `Researcher · investigating · 4 sources`

Provider is secondary metadata. The durable session/role is the product object.

## Brain Council

Brain Council stays.

It is advisory and summonable. It should expose:

- the question under consideration;
- members/roles;
- live perspectives;
- consensus;
- dissent;
- blind spots;
- recommendation;
- evidence;
- actions: `Request changes`, `Reject`, `Approve`, `Ask for dissent`, `Run simulation`, etc.

Council advice does not silently become execution authority.

## Spaces and windowing

Do **not** flatten WilliamOS into fixed IDE columns.

A Space is a durable working context containing real independent work surfaces. Windows must be movable, resizable, minimizable, persistent, and z-ordered where appropriate.

The visual design must avoid the old toy-mini-desktop look by using restrained chrome, strong hierarchy, useful snapping/layout, and large serious work surfaces.

Mission Control shows actual live Spaces and their current windows. It is re-entry, not a dashboard home page.

## Visual design

Target feeling:

- premium professional desktop environment;
- dark, restrained materials;
- matte charcoal / deep olive / soft sage / limited semantic accent;
- subtle depth;
- crisp typography;
- dense when useful, never noisy by default;
- minimal gratuitous borders;
- no gradient/glow AI slop as a design language;
- no gaming HUD;
- no giant chatbot composer;
- no status-card wall.

Subtle living signals are welcome: agent activity, progress, pulse, stale/live state, small waveform/orb for William, but they must communicate real state.

## Reference HTML

The HTML files in `prototypes/` are **interaction and visual targets**, not production implementation.

- `workspace.html` — TerraFusion Space with real work surfaces, William presence, agents, Line, and object actions.
- `brain-council.html` — summonable Brain Council strategic review.
- `mission-control.html` — live Spaces overview and re-entry.

Codex should open these in a browser before implementation and use them as a visual acceptance reference.

## Work order sequence

1. `WO-UI-001-SPATIAL-WORKSPACE.md`
2. `WO-UI-002-WILLIAM-AND-AGENTS.md`
3. `WO-UI-003-BRAIN-COUNCIL.md`
4. `WO-UI-004-MISSION-CONTROL.md`
5. `WO-UI-005-OWNER-ACCEPTANCE.md`

The sequence does **not** authorize infrastructure work. If a backend capability is unavailable, use truthful UI fixtures/adapters and keep the UI lane moving unless the exact browser journey is impossible without the backend change.

## Non-negotiable acceptance

The implementation is unfinished until the owner can open WilliamOS and immediately recognize:

1. **This is WilliamOS**, not generic generated software.
2. **AI power is everywhere I need it**, not hidden behind a chat tab.
3. **My agents are here and working with me.**
4. **William is present and has judgment.**
5. **Brain Council exists when I want deeper thinking.**
6. **Spaces feel durable and alive.**
7. **The real work surfaces still work.**

If an agent has to explain where the AI power is, the UI failed.