# WO-WOS-V1.2-006 - WilliamOS Primary Home

## Controlling authority

- GitHub Issue: `#499`
- Branch: `codex/issue-499-primary-home`
- Base: `origin/main` at `f1d007277e0657339e657dd1a0e1b6ba1f27f9b2`
- Delivery posture: working preview only; founder approval is required before merge

## Product outcome

The authenticated root route now presents one founder workflow backed by live WilliamOS records:

1. Primary briefing: current outcome, proven project identity, proven worker, health, and next automatic step.
2. Needs William: at most one current `ACTIONABLE` authority request with exact choices and consequences.
3. Next without William: the canonical outcome-queue continuation, activation, recovery, or truthful no-work state.
4. Recently completed: bounded completed-outcome history with evidence navigation.
5. Project horizon: repository identities proven by persisted Work Order evidence only.
6. Technical details: queue, Goal, Work Order, timeline, and generated-at mechanics behind deliberate disclosure.

The prior dashboard composition, static TerraFusion project claim, proposed-decision count, runtime configuration panel, and competing command-center cards no longer appear on the Primary Home path.

## Truth boundaries

- Outcome and successor truth comes from `getOutcomeQueueSurface()`.
- Current execution truth comes from the persisted Goal timeline.
- A worker is named only when the timeline is current and its lease is active.
- Only a current `ACTIONABLE` authority request can enter `Needs William`.
- Project identity comes only from persisted `evidence_record.repo` values linked to the relevant Work Order.
- Missing or conflicting truth is labeled unavailable; it is not inferred from product context.
- The existing exact-bound authority-decision action remains the only mutation path.

## Validation

- Focused model and product-contract tests: `14 passed`.
- Full lint: passed with zero warnings or errors.
- Production build with `NEXT_PRIVATE_BUILD_WORKER=0` and telemetry disabled: passed.
- Full Vitest run: `2,325 passed`, `2 skipped`, `1 pre-existing Windows CRLF-sensitive source assertion failed` in `tests/outcome-queue-operator-panel.test.ts`; the failing file and asserted component were untouched by this Work Order.
- `git diff --check`: passed.

## Safety posture

- No schema or database change.
- No Hermes, queue, lease, authority, or runtime semantic change.
- No auth architecture or policy change.
- No production deployment or merge.
- No TerraFusion, Property Workbench, TerraPilot, county, PACS, or protected-data touch.
- No secrets inspected or committed.
- `.obsidian/` remains outside this branch and untouched.

## Preview gate

The branch must remain unmerged until the Primary Operator reviews an authenticated live preview at the required laptop viewports. The browser proof must cover normal, blocked, genuine-decision, empty-queue, and multi-project model states without changing production records for demonstration.
