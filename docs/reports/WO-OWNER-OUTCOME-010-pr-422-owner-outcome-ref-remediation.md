# WO-OWNER-OUTCOME-010 — PR #422 Owner Outcome Reference Remediation

## Result

`IN_PROGRESS / ROUTINE_POST_MERGE_REMEDIATION`

## Finding

PR #422 merged the standing owner-outcome intake, but a post-merge P2 found that an eligible persisted outcome with `ref === null` could still select the program while losing its deterministic outcome reference. The portfolio surface would then be unable to re-identify the selected persisted record.

## Remediation

- Added one canonical fallback reference helper using `ref`, then persisted `id`, then the explicit `GOAL-UNRECORDED` sentinel.
- Made the resolver pin that fallback reference.
- Made the portfolio surface re-identify outcomes through the same reference function.
- Added focused coverage for a persisted outcome with `id = 77` and `ref = null`.

## Safety

No runtime activation, command runner, background worker, production mutation, secrets, paid overage, external project, county/PACS, TerraFusion, Property Workbench, TerraPilot, destructive action, or issue #357 retry.

## Owner Decision

`OWNER_DECISION_REQUIRED: false`
