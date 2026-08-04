# WO-WOS-V1.2-006 - WilliamOS Primary Home

## Controlling authority

- GitHub Issue: `#499`
- Branch: `codex/issue-499-primary-home`
- Base: `origin/main` at `bcee6d8067228a79c2ade852fc21d938a7e43f5c`
- Delivery posture: working preview only; founder approval is required before merge

## Product outcome

The authenticated root route now presents an artifact-first operating field backed by live WilliamOS records:

1. Current outcome: one dominant focal point that identifies whether work is active, ready, recovering, held, complete, or unavailable.
2. Work artifact: the actual active Work Order, delivery phase, proven worker, and validation checkpoints when those records exist.
3. Needs William: at most one current `ACTIONABLE` authority request with the exact decision, recommendation, consequences, and concrete choices together.
4. Next without William: canonical outcome-queue continuation, activation, recovery, or truthful no-work state.
5. Recent continuity and project horizon: bounded completion history and evidence-backed project identities below the operating field.
6. Technical details: queue keys, Goal identifiers, Work Order identifiers, lifecycle state, authority state, and timestamps behind a deliberate drawer.

Home alone receives compact route-aware shell chrome so the current operating artifact owns the viewport. Existing navigation and health surfaces remain unchanged on every non-Home route.

The prior dashboard composition, static TerraFusion project claim, proposed-decision count, runtime configuration panel, and competing command-center cards no longer appear on the Primary Home path.

## Truth boundaries

- Outcome and successor truth comes from `getOutcomeQueueSurface()`.
- Current execution truth comes from the persisted Goal timeline.
- A queued or blocked outcome is never presented as active execution.
- A worker is named only when the timeline is current and its lease is active.
- Only a current `ACTIONABLE` authority request can enter `Needs William`.
- Project identity comes only from persisted `evidence_record.repo` values linked to the relevant Work Order.
- Missing or conflicting truth is labeled unavailable; it is not inferred from product context.
- The existing exact-bound authority-decision action remains the only mutation path.
- Home read actions remain read-only and are sequenced to avoid duplicate authenticated database bursts during shell resolution.

## Validation

- Focused model and product-contract tests: `19 passed`.
- Scoped lint for all changed Home, shell, and test files: passed with zero warnings or errors.
- Repository-wide lint remains blocked by unrelated legacy test violations outside this Work Order.
- Production build with `NEXT_PRIVATE_BUILD_WORKER=0` and telemetry disabled: passed.
- Full Vitest run: `2,329 passed`, `2 skipped`; the pre-existing Windows CRLF-sensitive source assertion failed in untouched `tests/outcome-queue-operator-panel.test.ts`, and one scheduler heartbeat timing test missed its generation threshold while the full suite and production build ran concurrently. The scheduler file passed independently with `110 passed` immediately afterward.
- `git diff --check`: passed.
- Authenticated browser proof: passed at `1280x720`, `1440x900`, and `390x844`; no horizontal overflow was observed, and repeated authenticated refreshes returned the governed Home state without the prior database-connection termination.
- Technical-detail drawer browser proof: passed for modal dialog semantics, initial focus, background inertness, close, and trigger-focus restoration.

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
