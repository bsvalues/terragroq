# WO-HERMES-5-001 Home Operational Radar

## Goal

Make WilliamOS Home answer three owner questions in one scan: what is moving now, what is held, and what recently landed.

## Design

The page keeps its existing command-center visual language and adds one compact operational radar directly below the primary briefing. Its three responsive lanes are named **Now**, **Held**, and **Landed**, because those labels encode Work Order lifecycle truth rather than decorative sequence.

- **Now** shows up to three `approved`, `active`, or `review` Work Orders, ordered with active work first and newest updates first.
- **Held** shows up to three `blocked` Work Orders, newest updates first.
- **Landed** shows the three newest `closed` or `aborted` outcomes using `completedAt`, `closedAt`, then `updatedAt` as the recorded completion signal.

Every record identifies its Work Order reference, title, lifecycle status, and the relevant result or update date. Every lane has a useful empty state and links to the existing read-only Work Orders surface. The Home page loads Work Orders through the already-established `getWorkOrders()` server action; this Work Order does not change database, action, runtime, authority, or mutation behavior.

The signature element is the **Now / Held / Landed** triage rail: an operational vocabulary specific to WilliamOS, supported by the existing foreground, primary, warning, success, card, and muted theme tokens. Existing sans typography carries narrative text, while the established mono utility face carries references, statuses, and dates.

## Considered approaches

1. **Operational radar (selected):** item-level truth in three bounded lanes. It is immediately useful and remains compact.
2. **Expanded count cards:** lowest change risk, but counts alone do not reveal which work or outcomes matter.
3. **Full activity timeline:** richer history, but duplicates the Work Orders page and weakens immediate triage.

## Implementation plan

1. Extend `tests/home-command-center.test.ts` with Work Order fixtures that prove lifecycle separation, newest-first outcome ordering, a three-item bound, and independent empty states. Run the focused test and confirm it fails because `workRadar` is absent.
2. Extend `components/dashboard/home-command-center.ts` so `getHomeCommandCenter(stats, orders)` derives the read-only radar while preserving all existing safety fields and aggregate briefing behavior. Run the focused test to green.
3. Update `app/(shell)/page.tsx` to load dashboard data and Work Orders concurrently, pass both into the read model, and render the responsive triage rail before generic status cards. Run focused tests again and build-check the server component.
4. Run `npm run lint`, `npm test -- --run`, and the production build with `NEXT_PRIVATE_BUILD_WORKER=0` and telemetry disabled.
5. Obtain independent native-subagent review, remediate findings, commit only the four owned paths, then complete the SHA-bound GitHub review and CI lifecycle.

## Self-review

- No placeholders or unbound implementation choices remain.
- The model, page, test, and report all use the same `workRadar`, `active`, `blockers`, and `recentOutcomes` vocabulary.
- Scope is limited to Home presentation and existing Work Order read data.
- Empty, active, blocked, closed, and aborted states are explicit.
- No command runner, runtime path, production mutation, authority grant, or new dependency is introduced.
