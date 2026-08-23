# 25 — Native Overlay / HUD and Shell Boundary

## Finding

The current installed Cockpit/Tauri implementation is intentionally narrow. Its active Rust surface provides:

- single-instance behavior;
- one main WebView window;
- exact-origin navigation policy;
- device key generation/binding/credential lookup/signing;
- denial of unapproved new-window navigation.

It does **not** currently implement the Experience V2 HUD/overlay, tray, global command invocation, native notifications, always-on-top status surface, or native system-control authority.

Historical Tauri planning discussed tray/notifications/file-drop/deep links, but that planning was explicitly superseded and cannot be treated as implemented or currently authorized.

## Controlling doctrine

The native shell is a **presentation/device-presence boundary**, never a second WilliamOS control plane.

Native affordances may:

- display trusted WilliamOS projections;
- request focus/show/hide/window behavior;
- capture a global invocation gesture when explicitly approved;
- present notifications/ambient HUD state;
- hand safe file references or device proofs into WilliamOS;
- request governed actions through canonical WilliamOS APIs.

Native affordances may not:

- make placement/policy/authority decisions;
- mutate system hardware directly because a widget was clicked;
- hold provider/model/cloud secrets;
- bypass WilliamOS action/authority/evidence pathways;
- become a local scheduler or supervisor for HERMES-owned work.

## Experience V2 projection model

The HUD/overlay is another projection of the same backend object/action model:

`canonical state -> object/attention projection -> HUD`

and actions follow:

`HUD intent/control -> canonical action registry -> authority/policy -> executor -> verified post-state -> evidence`

There must not be separate "overlay actions" whose semantics diverge from the full Environment.

## Desired interface densities

### Ambient presence

Optional minimal native/desktop presence such as:

`HERMES ●   P40 68% 67°C   AEGIS ●   ATLAS ●   Needs you 0`

This is evidence-backed and must degrade/stale honestly.

### HUD / quick overlay

A fast invokable surface showing current world, fabric status, active work, relevant resource state and a universal command/ask field. It may be pinned or transient according to user preference.

### Full Environment handoff

Selecting/expanding an object opens/focuses that exact object/world in the full Environment without losing foreground context.

## Native capability candidates requiring proof

Do not assume these are accepted because Tauri supports them technically. Evaluate individually:

- global keyboard shortcut;
- tray/menu-bar presence;
- secondary transparent/frameless window;
- always-on-top/pin behavior;
- click-through/non-activating display mode where useful;
- multi-monitor placement;
- native notifications;
- deep links into selected objects/worlds;
- voice push-to-talk / microphone presence signal;
- drag/drop into governed intake;
- startup/login behavior;
- accessibility/reduced-motion/high-contrast behavior.

Each must preserve exact-origin/device security and no-focus rules.

## Attention integration

Native notification/HUD behavior consumes the same attention classes as Experience V2:

- BACKGROUND -> no native interruption;
- AMBIENT -> optional quiet state update;
- NOTICE -> bounded visual notification according to preference;
- INTERRUPT -> attention request without taking destructive action;
- OWNER_DECISION -> focusable decision projection;
- CRITICAL -> explicit safety alert.

The native shell may not elevate event severity on its own.

## Gaming-overlay lessons without gaming-overlay mistakes

Adopt:

- fast invocation;
- pin-able telemetry;
- controls beside relevant measurements;
- minimal interruption;
- profiles/modes;
- expansion from HUD to deep control.

Reject:

- GPU-only worldview;
- raw tuning sliders as the normal interface;
- decorative gamer chrome;
- overlay-local settings that bypass system policy;
- loading expensive AI merely to answer deterministic telemetry questions.

## First native proof

Before building a broad HUD, prove one narrow installed path:

1. invoke the HUD from outside the main window;
2. display fresh HERMES/P40 state and current foreground WilliamOS world;
3. use one deterministic read action such as `what is using P40 memory?`;
4. focus the same P40 object in the full Environment;
5. return to the prior foreground work without lost state/focus surprise;
6. close the HUD and prove HERMES work is unaffected.

No mutation is required for the first native proof.

## Acceptance

- Tauri/native code remains authority-less.
- Device/signing boundary is preserved.
- HUD uses the same canonical objects/actions/attention state as the Environment.
- Closing/killing HUD cannot stop or corrupt work.
- Stale metrics are never rendered as live.
- No background event steals focus.
- Overlay may disappear completely without loss of canonical state.
- A native capability must earn admission by UX/security evidence, not by API availability.
