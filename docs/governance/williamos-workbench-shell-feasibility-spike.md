# WilliamOS Workbench Shell Feasibility Spike

**Document:** `WILLIAMOS-WORKBENCH-SHELL-SPIKE-001`

**Status:** `DECISION EVIDENCE / RECOMMENDED`

**Issue:** #772

**Controlling contract:**
[`williamos-workbench-ux-contract.md`](williamos-workbench-ux-contract.md)

**Scope:** read-only architecture evidence. This document does not authorize a
production shell build, capability expansion, provider, deployment, or release.

## Decision

Select **Candidate D: a WilliamOS-specific persistent React/Next Workbench served
by HERMES and hosted by the narrowly privileged Tauri/WebView2 Cockpit** for the
Workbench v1 implementation path.

Confidence: **0.88**.

This does not accept the current page UI or the installed Tauri 0.1.7 experience.
The rejected experience treated the native window as the product and loaded the
old dashboard composition. Under Candidate D, the **Workbench client is the
product**; Tauri remains a constrained native container for device proof,
windowing, installation, and narrowly approved native affordances.

Candidate D wins because it preserves WilliamOS/HERMES authority, the current
truth and authentication foundations, and the smallest native capability
surface while allowing the center Thread, Project/Thread Explorer, Inspector,
Execution panel, status bar, and universal action registry to be composed as one
persistent client.

## Candidates

- **A — Native WilliamOS shell from scratch:** fresh Windows-native client,
  assumed WinUI 3/C# for this comparison.
- **B — Hermes Desktop fork:** maintain an independent WilliamOS fork of the
  Electron application and remove or replace conflicting authority.
- **C — Hermes Desktop plus WilliamOS plugin/backend integration:** retain
  upstream Hermes Desktop and contribute WilliamOS through its plugin SDK.
- **D — Thin custom shell over WilliamOS/HERMES:** HERMES-hosted persistent
  WilliamOS Workbench in the existing constrained native WebView container.

## Evidence matrix

| Criterion | A — native | B — Hermes fork | C — Hermes plugin | D — WilliamOS/HERMES |
| --- | --- | --- | --- | --- |
| Backend-authoritative remote HERMES | Gap: most current truth is server-side TypeScript/Next and needs new APIs | Partial: remote gateway exists, but its protocol and truth owner must be replaced | Conflict: Hermes gateway and WilliamOS become competing backends | Strong foundation: exact HTTPS remote HERMES load and colocated server truth already exist |
| Device auth and browser recovery | Partial reuse; new native cookie/session/key client required | Partial; upstream OAuth/token flow does not implement WilliamOS device sessions | Conflict: plugin cannot replace boot authentication cleanly | Proven foundation: enrollment, proof signing, session, browser recovery, and OS key storage exist |
| Project and durable Thread continuity | Project semantics reusable only through new APIs; Thread still missing | Upstream Project/session concepts are strong but require identity mapping | Duplicate Project/session truth | Project records reusable directly; durable Thread projection remains a required backend gap |
| Thread + Inspector + Execution + status composition | Feasible, full native rewrite | Strong layout primitives, high-cost fork conversion | Panes can be added, but central WilliamOS semantics cannot be safely replaced | Direct fit for one persistent React client; current shell must be replaced, not restyled |
| One universal action registry | Requires language-neutral registry API or duplicated C# policy | Contribution registry reusable after deep replacement | Adds a second registry beside built-ins | One typed TypeScript registry can serve composer, palette, buttons, shortcuts, and server validation |
| No background focus theft | Feasible but new reducer/tests | Strong upstream invariant, maintained by fork | Unenforceable against a full-authority plugin | Feasible through a single foreground-context reducer with deterministic tests |
| Native notifications | Strong Windows-native support | Strong existing Electron support | Available, subject to host authority | Feasible through one narrowly scoped notify capability; closed-process delivery remains unresolved |
| Windows lifecycle | New MSIX/signing/update/restoration pipeline | Existing NSIS/MSI/single-instance/update machinery, but fork owns release channel | Existing lifecycle, exposed to upstream compatibility drift | MSI/NSIS and single-instance proven; signing, supported MSVC build, updater, and Workbench restoration remain gaps |
| Performance and hidden mounted panes | Likely strong, but all rich widgets are new and unmeasured | Strong upstream keep-alive pane tree | Strong host behavior | WebView2 must be measured; React can keep one stable client island and mounted hidden panes |
| Constrained authority | Possible, but a new native trust boundary must be built and audited | Conflict is remediable only by deleting/replacing broad Electron/backend authority | **Reject:** plugins explicitly have full renderer authority and generic gateway access | Strongest current boundary: exact origin, denied navigation/new windows, four device invokes, no native session token, no generic fs/shell/http/DB/Git |
| Reuse and implementation cost | Very high; primarily reuses backend semantics | Very high; fork maintenance plus protocol/auth/authority replacement | Deceptively medium for demo, very high and unsafe for production | Medium; substantial Workbench/client-state work but broad foundation reuse |

## Candidate disposition

### A — reject for Workbench v1

A native client is technically feasible and may offer lower renderer overhead
and direct Windows lifecycle integration. It requires a new UI system, API
surface, authentication client, event client, action integration, rich
diff/Markdown/terminal components, packaging identity, update/signing channel,
accessibility suite, and a new native trust boundary.

Reconsider A only if a representative D prototype fails explicit measured
performance, accessibility, focus, or platform criteria after bounded
remediation. Native preference alone is not evidence.

### B — reject for Workbench v1

Hermes Desktop has excellent Workbench-aligned primitives: chat-centered work,
persistent panes, Project/session continuity, a palette, a status bar, native
notifications, remote mode, Windows packaging, single instance, and updates.

A fork could remove its conflicting local backend, filesystem, Git, terminal,
secret, and generic gateway authority. Doing so converts the apparent reuse into
a high-cost permanent fork with protocol, authentication, release, and upstream
merge obligations. It also duplicates most of the current WilliamOS React/Next
and device-auth foundation.

### C — reject on authority grounds

Hermes's own source states that desktop plugins are not a capability boundary:
they execute in the renderer with full app authority. The SDK exposes generic
gateway JSON-RPC, and plugin REST/socket namespaces are anchored to the Hermes
backend.

Candidate C therefore cannot preserve a narrow WilliamOS client boundary while
retaining upstream Hermes Desktop unchanged. It creates split identity,
session, action, Project, and execution truth. Its attractive panes, palette,
and status contributions do not compensate for that authority defect.

### D — select, with gates

D reuses:

- the Next/React application and existing UI/testing toolchain;
- authenticated server components and tenant-scoped read models;
- Project/resource persistence;
- Activity and System truth projection;
- intent and owner-decision foundations;
- HERMES hosting and exact HTTPS origin;
- device enrollment/session and browser recovery;
- constrained native device proof;
- installed Windows packaging and single-instance evidence; and
- compatibility routes and historical detail.

The current dashboard composition is explicitly not reused. Deep capabilities
are adapted into the Thread, Inspector, Execution panel, universal action
registry, or compatibility detail.

## Required D gates

1. **Thread identity and projection:** define a backend-owned durable Thread
   aggregate over existing outcome, goal, Work Order, conversation, execution,
   evidence, and artifact records without minting new authority.
2. **Event contract:** provide bounded authenticated background event delivery
   with ordering, freshness, reconnect, and stale semantics.
3. **Execution-panel contract:** define bounded authenticated projections for
   tests, logs, agents, execution state, and terminal-like output. A Terminal
   view does not authorize a generic native shell, filesystem bridge, or command
   channel. Any interrupt/control verb requires its own proven server authority
   and protocol.
4. **Action registry:** replace classify-then-open handoff with one typed
   registry shared by every affordance; server authority remains decisive.
5. **Foreground reducer:** only explicit owner actions may change Project,
   Thread, pane visibility, selection, or focus.
6. **Spatial restoration:** persist only non-secret, user/device-scoped layout
   and context; refetch governed content after restart.
7. **Performance prototype:** measure memory, typing latency, Project/Thread
   switching, long timelines, and mounted-hidden Inspector/Execution panes.
8. **Native notification boundary:** v1 notifications exist only while the
   Cockpit process is running. Add at most a typed notification capability with
   deduplication and explicit click/focus behavior; add no generic native API,
   always-on helper, push channel, background service, or closed-process claim.
9. **Windows release posture:** prove an officially supported MSVC build, code
   signing, signed updates, rollback, installer identity, and single-instance
   restoration.
10. **Real acceptance:** installed device-authenticated HERMES proof plus
   responsive, focus, recovery, interruption, restoration, and 3/10/30/60-second
   Workbench tests.

## Bounded implementation sequence

1. Land the backend-owned Thread projection and identity contract.
2. Build one persistent Workbench client root and adapt existing truthful read
   models into the Explorer, center Thread, Inspector, Execution panel, and
   status bar.
3. Land bounded backend-authoritative execution/test/log/agent projections;
   keep Terminal read-only unless a separate governed control protocol is
   proven.
4. Land the shared action registry and direct safe transitions.
5. Add ordered background events and the no-focus-steal reducer.
6. Add non-secret spatial restoration and run the representative performance
   prototype before expanding native capability.
7. Add the narrow in-process notification boundary only after click/focus behavior is
   proven.
8. Establish supported signed Windows build/update/rollback.
9. Run real authenticated installed acceptance and sovereign review.

Each step is a bounded delivery contract. None may reinterpret the old page
composition as the Workbench or hide capability to pass acceptance.

## Open unknowns and no-go boundaries

| Unknown | V1 posture | Closure gate |
| --- | --- | --- |
| Durable Thread identity across current records | No parallel task authority or speculative schema | Gate 1 |
| Ordered background work events and reconnect behavior | No polling result may move foreground context | Gate 2 and gate 5 |
| Execution-panel data and control semantics | Authenticated backend projections only; no generic native terminal, shell, filesystem, or command bridge | Gate 3 |
| Inspect/Steer/Stop action completeness | No visible control without a proven authorized server transition | Gate 3 and gate 4 |
| User/device spatial persistence | Non-secret layout/context only; governed content and credentials are refetched or retained by their authoritative stores | Gate 6 |
| WebView2 long-timeline, hidden-pane, typing, and memory performance | No acceptance by architectural preference; measure a representative Workbench | Gate 7 |
| Notification delivery when Cockpit is closed | Out of scope for v1; no always-on helper, push channel, or background service is authorized | Gate 8 |
| Installer signing, updater hosting, rollback, and supported Rust target | No trusted-distribution claim until the complete release posture is proven | Gate 9 |
| Real authenticated installed Workbench behavior | Build/install evidence remains feasibility only | Gate 10 |

These unknowns are bounded failure conditions, not permission to expand native
or backend authority. A future need for closed-process notifications, generic
terminal control, or a resident client helper requires a separate architecture
and authority decision.

## Evidence sources

WilliamOS repository evidence:

- `lib/operator/operator-state.ts`, `lib/projects/`,
  `lib/operator/activity.ts`, and `lib/system/system-truth.ts`;
- `lib/intent/router.ts` and `components/intent/`;
- `lib/device-auth/`, `app/api/device/`, and `app/device-bootstrap/`;
- `components/shell/app-shell-frame.tsx` as evidence of the shell that must be
  replaced; and
- `cockpit/` for the constrained native feasibility boundary.

External primary evidence:

- [Hermes Desktop architecture](https://github.com/NousResearch/hermes-agent/blob/c896c09c42910c584c4c7d2325b58c14713ea42c/apps/desktop/AGENTS.md)
  and [README](https://github.com/NousResearch/hermes-agent/blob/c896c09c42910c584c4c7d2325b58c14713ea42c/apps/desktop/README.md).
- [Hermes plugin runtime warning](https://github.com/NousResearch/hermes-agent/blob/c896c09c42910c584c4c7d2325b58c14713ea42c/apps/desktop/src/contrib/runtime-loader.ts#L18-L27)
  and [generic SDK gateway access](https://github.com/NousResearch/hermes-agent/blob/c896c09c42910c584c4c7d2325b58c14713ea42c/apps/desktop/src/sdk/index.ts#L153-L173).
- [Hermes persistent pane renderer](https://github.com/NousResearch/hermes-agent/blob/c896c09c42910c584c4c7d2325b58c14713ea42c/apps/desktop/src/components/pane-shell/tree/renderer/tree-group.tsx#L215-L239).
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/),
  [window state](https://v2.tauri.app/plugin/window-state/),
  [single instance](https://v2.tauri.app/plugin/single-instance/), and
  [signed updater](https://v2.tauri.app/plugin/updater/).
- [Windows app lifecycle instancing](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/applifecycle/applifecycle-instancing),
  [native notifications](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/),
  and [App Installer updates](https://learn.microsoft.com/en-us/windows/msix/app-installer/auto-update-and-repair--overview).

The Hermes evidence is pinned to upstream commit
`c896c09c42910c584c4c7d2325b58c14713ea42c` observed during the spike on
2026-08-14. Conclusions about upstream compatibility must be rechecked before
any future Hermes-based reconsideration.
