# WilliamOS Workbench UX Contract

Status: controlling product contract for the WilliamOS operator interface.

This contract supersedes the navigation and dashboard composition in `williamos-navigation-information-architecture.md`. It does not retire the routes or capabilities described there. It changes how those capabilities are reached and composed.

## Product model

WilliamOS is an owner workbench, not an administration dashboard. The installed cockpit and the browser recovery surface render the same workbench against the HERMES control plane and ATLAS state.

The operator model has four nouns:

- **Project** — durable context and resource boundary.
- **Thread** — the continuous human/agent work conversation. Existing work orders and outcomes are projected as threads until a dedicated thread record exists.
- **Artifact** — a produced or inspected object: change, document, evidence record, delivery, or decision.
- **Decision** — an explicit owner choice with authority consequences.

The operator has five verbs: **Ask, Do, Inspect, Steer, Stop**.

## Persistent spatial contract

Every authenticated route lives inside one shell:

1. Activity rail — changes the explorer lens; it is not a destination menu.
2. Project/thread explorer — durable context and thread selection.
3. Center work surface — the current thread or a contextual capability surface.
4. Inspector — Overview, Changes, Proof, Decision, and Technical views of the selected context.
5. Execution panel — Execution, Tests, Logs, and Agents without leaving the thread.
6. Status bar — compact HERMES, AEGIS, ATLAS, queue, and owner-attention truth.
7. Universal intent — Ctrl+K from anywhere.

Selected project, selected thread, inspector view, explorer state, and execution-panel state persist on the cockpit device. Background updates may update unread state but must not navigate, select a different thread, or steal focus.

## Capability translation

No capability is removed merely because it is no longer a permanent top-level room.

| Existing capability | Workbench expression | Recovery route |
| --- | --- | --- |
| Chat | Ask in the current thread | `/chat` |
| Goal Console | Create or steer an outcome from the thread | `/goal-console` |
| Work Orders | Do/Stop controls and execution detail | `/work-orders` |
| Evidence + Trace | Proof and Technical inspector views | `/audit`, `/trace` |
| Brain Council | Contextual Council action on a thread | `/brain-council` |
| Memory + Corpus | Knowledge inspector/tools | `/memory`, `/corpus` |
| Decisions + Doctrine + Governance | Decision inspector and authority tools | `/decisions`, `/doctrine`, `/governance` |
| Hermes + Runtime + Agent Forge | Status bar, execution panel, system tools | `/hermes`, `/runtime`, `/agent-forge` |
| Academy | Contextual reference tool | `/academy` |

These routes remain reachable from the workbench tool index and universal intent. They are contextual views, not competing primary products.

## Truth and interaction rules

- Do not invent project membership. Unbound work appears under **Unassigned work**.
- Distinguish empty, working, waiting, stale, degraded, and completed states.
- Infrastructure detail is quiet by default and explicit in Technical/System views.
- Primary surfaces are flat regions separated by rules. Cards are reserved for discrete artifacts, not page layout.
- Home is the default workbench state. It is never a KPI briefing or grid of module launchers.
- An execution can be inspected and its governed Stop/Steer control reached without losing the selected thread.
- A background event never changes the selected project, selected thread, inspector tab, or focused input.

## Acceptance tests

1. Selecting a thread updates the center and inspector without navigating to a module page.
2. Reload restores the last project, thread, inspector tab, and execution-panel state.
3. Every legacy capability route remains reachable from the workbench.
4. Ctrl+K opens universal intent from every authenticated route.
5. Home contains no dashboard KPI grid or module-card launcher.
6. Work with no proven project binding is visibly unassigned.
7. HERMES, AEGIS, and ATLAS truth is visible in the status bar without a health-chip banner.
8. The installed cockpit and recovery browser use the same authenticated shell.

## Rejection rules

Reject a change if it:

- creates a special Home shell while retaining a different shell elsewhere;
- hides a capability without a contextual workbench expression and recovery route;
- turns Projects, Activity, Council, Evidence, or System into a separate primary product;
- uses cards as the page grid;
- claims inferred infrastructure state as a live probe;
- changes user focus or selection because background work completed;
- treats a cosmetic wrapper around the old dashboard as the workbench.
