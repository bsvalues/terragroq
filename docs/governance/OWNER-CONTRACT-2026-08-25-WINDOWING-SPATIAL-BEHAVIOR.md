# OWNER CONTRACT — 2026-08-25 — EXPERIENCE V2 WINDOWING AND SPATIAL BEHAVIOR (binding)

This is the geometry contract that was missing ("we kept giving Claude a look; it needs a
windowing and spatial behavior model"). It supersedes the Aug-14 workbench geometry
(sidebar+center+inspector) and every screen-composition reading of Experience V2. A docs lane
must land this verbatim in `docs/governance/` through the governed process; until then this copy
binds every frontend lane. Screens are rejected on sight; the unit of design is BEHAVIOR.

## The distinction

"Operating system" ≠ "an application whose content is arranged like an operating system."
We have repeatedly designed screens. The owner has been asking for a place.

## The behavior contract (verbatim owner language)

- There is no canonical full-screen page composition.
- The viewport is an environment owned by a window manager.
- Windows are independent persistent surfaces, not sections of a page. They overlap, move,
  resize, minimize, have z-order. Apps/workers have presence independent of their windows.
- Spaces are durable working contexts, not navigation destinations. Switching Spaces changes the
  whole working context — it does not load a page.
- Selecting an object changes context; it does not navigate to an object-detail page.
- The Inspector is summoned/contextual, not permanently allocated layout.
- Agents exist independently of conversation panes — processes with durable context (running /
  waiting / reviewing / blocked / completed / spawned parallel / attached to project+worktree /
  producing diffs / interruptible / resumable). Some workers need no window until inspected.
- The Line is transient global command infrastructure: summoned over the current place, acts
  against current context/selection, disappears, leaves the WORLD changed. It is never the main
  screen.
- Mission-Control overview shows the ACTUAL currently-existing Spaces/windows — never rendered
  summary cards or project-selector thumbnails.
- There is no Home dashboard. No System dashboard. No WilliamOS dashboard.
- **There is no Space called "WilliamOS."** WilliamOS is the environment that contains the
  Spaces. (macOS does not give you a desktop called macOS beside Safari.)
- **Objects are not windows/tiles.** Everything important has identity, but existence in the data
  model earns NO rectangle. The P40 is normally visible only as part of HERMES; select it →
  Inspector; open it → a dedicated window; ask → the Line operates on it; drag work onto it →
  potentially a governed action. GPU/SERVICE/STORAGE/WORKLOAD must never become four rectangles
  because the schema has four kinds.

## The hierarchy

    WILLIAMOS (the environment itself — not a space, not an app)
    ├── GLOBAL SHELL: menu/command invocation · spaces · window manager · dock/active presence ·
    │                 notifications/attention · universal intelligence
    ├── SPACE: TERRAFUSION — source window · running-app window · data window · Codex session ·
    │                        Claude review session · artifacts/decisions/threads
    ├── SPACE: SYSTEM — HERMES (window/object: P40, Ollama, storage, workloads) · ATLAS · AEGIS · OMEN
    └── SPACE: (other work)

## The four references contribute MODELS, not looks

macOS → the world: desktop, independent windows, Spaces, Dock, menu bar, Mission Control,
persistent place. VS Code → what a serious WORK WINDOW can become inside a Space (explorer,
splits, terminal, diffs — inside a window; VS Code is not the shell). Codex Desktop → the agent
operating model (projects, parallel long-running threads, worktrees, inline diffs). Claude Code →
delegation semantics (sessions, subagents, checkpoints, background, interruptibility).

## Rejected on sight (from the current mocks)

Permanent app-page canvas rectangle · website-header menu imitation · a "WilliamOS" Space ·
static thumbnails cosplaying Mission Control · dock as a rounded rectangle of status text ·
centered modal as the primary command experience · windows composed as a screenshot · persistent
labels explaining the environment · tiny pseudo-terminal typography everywhere · decorative dot
grids · OS-ish visual chrome compensating for missing OS behavior. Keep the real information,
not the composition.

## The acceptance proof is BEHAVIORAL — eight interactions, all operable

1. WilliamOS opens directly into the exact TerraFusion Space that was left running.
2. ≥2 genuinely independent movable/resizable windows (TerraFusion running app + work/editor).
3. A Codex worker continues in the background with NO chat window open.
4. ⌘K/Line appears transiently over the current Space, understands current selection, disappears.
5. Invoking System Space changes the whole working context — not a page load.
6. Open HERMES as a window/object, then P40; Inspector follows selection.
7. Mission-Control overview shows the actual windows/Spaces currently alive.
8. Return to TerraFusion: every window, selection, pane and agent exactly where it was.

"If that interaction does not work, I do not care how attractive the screenshot is.
It is not WilliamOS."

---

# PART II — THE SPACE/WORKSPACE IS THE PRODUCT (owner correction, 2026-08-25, supersedes
# "The Thread is the product")

The fork where the program went wrong: the older Workbench contract's "The Thread is the product"
kept producing thread/conversation/inspector/status compositions — every mockup a different
dashboard. Yesterday's design record already said otherwise and the implementation followed the
wrong concept. The correction, explicit and binding:

**THE SPACE/WORKSPACE IS THE PRODUCT.** Threads, conversations, agents, files, editors, previews,
terminals, artifacts, systems and inspectors are objects/surfaces WITHIN it.

**WilliamOS must provide the ACTUAL work surfaces. It must never substitute representations of
work for the work itself.** The workspace contains the real things: conversations, editors,
repositories, browser previews, terminals, diffs, diagrams, documents, datasets, agents, test
runs, research, generated applications, decisions, history, files. Not renderings of them.

The four references are capability layers to UNIFY, not influences to summarize:
macOS = environment semantics (spaces, windows, persistence, spatial memory, direct manipulation,
things remain where you put them). VS Code = powerful work surface (real editor, files, diff,
terminal, panes, keyboard power, progressive complexity). Codex Desktop = parallel intelligent
work (agents against actual repositories/worktrees with durable threads, diffs, artifacts).
Claude Code Desktop = fluid collaboration with an agent while the actual work remains available.

## THE ACCEPTANCE TEST (before telemetry, before Inspector, before anything)

Open a TerraFusion Space. Can you:
 1. Edit `search-ranking.ts` RIGHT THERE?
 2. Run and interact with TerraFusion RIGHT THERE?
 3. Open the database result right there?
 4. Open Codex's change beside your source?
 5. Ask Claude to review the selected diff?
 6. Tell Claude "no, compare that with this file" without reconstructing context?
 7. Open its terminal to see what it did?
 8. Take the keyboard and continue the work yourself?
 9. Have Codex keep going while you work on something else?
10. Open a research page or document beside it?
11. Switch to another Space and come back with everything exactly where you left it?

If the answer is no, the frontend fails. No frontend PR in this program may claim a gate without
stating which of these eleven it makes operable, proven by driving the deployed product.

## Personalization is behavior, not metadata

The system knows the owner through how it behaves: context persists across fast switches between
kinds of work; things have place; deep branches stay open without chaos; multiple intelligences
coexist around the work; complexity unfolds on demand; the environment remembers so context is
never reconstructed; source/app/diff/evidence/machine are directly accessible; infrastructure
recedes until relevant. Felt in thirty seconds of use — never explained in a paragraph.

## Consequence for artifacts produced so far

The design canvas and the behavioral prototype are REFERENCE MATERIAL for interaction shape only.
Neither is a deliverable. No further mockups will be produced in this program; all frontend effort
lands in the deployed product and is proven by real work happening in it.

---

# PART III — VALIDITY RULE AND OPERATIONAL ACCEPTANCE CHAINS (owner, 2026-08-25)

## The rule that supersedes "mockups are dead" (necessary but not sufficient)

**A frontend deliverable is INVALID unless the owner can perform materially useful work in it.**
"Materially useful work" = changing a real artifact, interacting with a real running product, or
collaborating with a real agent against real work. Deployed billboards are as invalid as mockups.

## #1011 is NOT the workspace

#1011 is cutover/cleanup substrate (its own receipt says remaining acceptance = Gates 3/5/7).
Nobody presents it to the owner as "look, progress." The next milestone shown to the owner is an
ACTUAL EDITABLE WORKSPACE DEPLOYED ON HERMES. No billboard in between.

## W1 acceptance — fails unless, in the DEPLOYED product, this chain is performable:

    Open TerraFusion Space → real repo/file tree → open actual file → edit it → save actual
    workspace file → undo/redo → open second file → split/place it beside first → running
    TerraFusion stays interactive beside it → close/reopen WilliamOS → same Space + files +
    layout return.

No screenshots. No artifact cards. No summaries. Anti-trap: one giant Monaco textarea + a fake
three-file tree + an iframe + a Save button + a "Codex working" badge + whitespace does NOT pass;
the chain above is executed end-to-end by a human hand, and stays CLEAN while doing it — windows,
tabs, splits, drawers, selection, focus and context organize the capability; nothing is deleted to
achieve cleanliness.

## W2 acceptance — fails unless this chain is performable:

    Select real code → start Codex on that context → Codex works in a real worktree → open its
    actual diff beside source → ask Claude to review that diff → Claude sees the same
    source/diff/context → steer either agent → inspect terminal/tests if wanted → take over the
    file yourself.

## PART IV — PARALLEL PATHS AND THE PROVIDER-AGNOSTIC AGENT ABSTRACTION (owner, 2026-08-25)

Two paths run CONCURRENTLY; neither blocks the other. They converge only at the agent/runtime
boundary:

    Frontend/product path:        W1 (#1015) → W2 (#1016) → #1012 full-day acceptance
    Intelligence-routing path:    hermes-local qualification → hybrid decomposition/routing

W1's minimum job (workspace shell · file tree/editor · governed file read/write · interactive
TerraFusion preview · persistence/re-entry) requires NOTHING from the local-lane qualification.
W2 begins on the existing cloud-backed Codex/Claude lanes; its acceptance is about working with
real agents in context, not about which provider serves them. Frontend work does not wait.

**BINDING CONSTRAINT on W1 and W2: do not hard-code "Codex" or "Claude" as the UI architecture.**
The workspace exposes an AGENT/SESSION ABSTRACTION — a session has identity, attached
workspace/worktree, state (running/waiting/reviewing/blocked/done), context, diffs, streams,
steering and takeover — and a provider/lane is an ATTRIBUTE of a session, never a component type,
route, or layout branch. Naming two vendors in component names, props, routes, state shape or
conditional layout is a defect. When hermes-local (or any future lane) qualifies, it must appear
as another capable worker in the same surfaces WITHOUT a frontend redesign. Adversarial review
attacks this alongside representation-instead-of-real-surface.

## Believability test (owner-stated)

Course correction is believed when a branch/packet exists whose changed files are conceptually:
workspace-shell · window-manager · editor · workspace-files · terminal · preview ·
space-persistence · agent-session · diff/worktree — and its acceptance is BY OPERATING those
things, not snapshot tests saying they render.
