# WO-HERMES-5-001 Home Operational Radar

## Goal

Make WilliamOS Home answer three owner questions in one scan: what is moving now, what is held, and what recently landed.

## Design

The page keeps its existing command-center visual language and adds one compact operational radar directly below the primary briefing. Its three responsive lanes are named **Now**, **Held**, and **Landed**, because those labels encode Work Order lifecycle truth rather than decorative sequence.

- **Now** shows up to three `approved`, `active`, or `review` Work Orders, ordered with active work first and newest updates first.
- **Held** shows up to three `blocked` Work Orders, newest updates first.
- **Landed** shows the three newest `closed` or `aborted` outcomes using `completedAt`, `closedAt`, then `updatedAt` as the recorded completion signal.

Every record identifies its Work Order reference, title, lifecycle status, and the relevant result or update date. Every lane has a useful empty state and links to the existing read-only Work Orders surface. Home uses a dedicated read-only radar query: each lane selects only the fields it renders, limits item rows to three, and obtains its full total through a separate count. Historical Work Orders and their evidence or criteria arrays are therefore not materialized on every Home render. This Work Order does not change database schema, runtime, authority, or mutation behavior.

The signature element is the **Now / Held / Landed** triage rail: an operational vocabulary specific to WilliamOS, supported by the existing foreground, primary, warning, success, card, and muted theme tokens. Existing sans typography carries narrative text, while the established mono utility face carries references, statuses, and dates.

## Considered approaches

1. **Operational radar (selected):** item-level truth in three bounded lanes. It is immediately useful and remains compact.
2. **Expanded count cards:** lowest change risk, but counts alone do not reveal which work or outcomes matter.
3. **Full activity timeline:** richer history, but duplicates the Work Orders page and weakens immediate triage.

## Implementation plan

1. Extend `tests/home-command-center.test.ts` with narrow radar fixtures that prove complete counts remain distinct from the three projected items, preserve lifecycle presentation, and retain independent empty states.
2. Extend `components/dashboard/home-command-center.ts` so `getHomeCommandCenter(stats, radarSource)` derives the read-only radar while preserving all existing safety fields and aggregate briefing behavior.
3. Add `app/(shell)/home-work-radar-query.ts` with lane-specific projections, counts, ordering, and three-row limits. Update `app/(shell)/page.tsx` to load that bounded source with dashboard data, pass both into the read model, and render the responsive triage rail before generic status cards. Run focused tests again and build-check the server component.
4. Run `npm run lint`, `npm test -- --run`, and the production build with `NEXT_PRIVATE_BUILD_WORKER=0` and telemetry disabled.
5. Obtain independent review, remediate findings within the reserved Home, component, test, and report paths, then complete the SHA-bound GitHub review and CI lifecycle.

## Review remediation

Independent review found that Home materialized every Work Order through `getWorkOrders()` even though each radar lane renders at most three items. The page now reads `getHomeWorkRadarSource()`, whose lane-specific item queries use narrow projections and `limit(3)` while independent count queries preserve complete lane totals. The read model and focused fixtures consume that bounded source directly.

## Self-review

- No placeholders or unbound implementation choices remain.
- The model, page, test, and report all use the same `workRadar`, `active`, `blockers`, and `recentOutcomes` vocabulary.
- Scope is limited to Home presentation and existing Work Order read data.
- Home item materialization is bounded at three projected rows per lane; aggregate counts preserve totals without fetching full Work Order records, evidence arrays, or acceptance criteria.
- Empty, active, blocked, closed, and aborted states are explicit.
- No command runner, runtime path, production mutation, authority grant, or new dependency is introduced.
