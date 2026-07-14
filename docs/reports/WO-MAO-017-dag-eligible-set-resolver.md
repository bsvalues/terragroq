# WO-MAO-017 - DAG and Eligible-Set Resolver

## Verdict

`COMPLETE / DETERMINISTIC_DAG_ELIGIBLE_SET_PROVEN`

The resolver evaluates the complete provider-neutral Work Order set rather than selecting one numeric
successor. It validates every envelope, requires exactly one explicit state per Work Order, verifies
that every dependency exists, rejects duplicates, detects cycles deterministically, and returns every
currently dependency-cleared `PLANNED` Work Order in stable identifier order.

## Delivered artifacts

- `scripts/multi-agent-operator/dag-eligible-resolver.mjs`
- `scripts/multi-agent-operator/dag-eligible-resolver-cli.mjs`
- `tests/multi-agent-dag-eligible-resolver.test.ts`

`ALL` requires every declared dependency to be `COMPLETE`. `ANY` requires at least one completed
dependency and is invalid when the dependency list is empty. Explicit `DEFERRED` and `BLOCKED` states
remain out of the eligible set and preserve their typed reason codes; they are never silently promoted.
Incomplete results distinguish pending, deferred, and blocked dependencies.

Structural faults have typed walls, including:

- `DAG_ELIGIBILITY_MISSING_DEPENDENCY_WALL`
- `DAG_ELIGIBILITY_CYCLE_WALL`
- `DAG_ELIGIBILITY_DUPLICATE_WALL`
- `DAG_ELIGIBILITY_STATE_WALL`
- `DAG_ELIGIBILITY_ENVELOPE_WALL`

The output is planning-only and explicitly records `dispatchPerformed=false` and
`authorityGranted=false`. It does not inspect providers, reserve resources, lease workers, or mutate
the queue.

## Validation

- focused Vitest: `2` files and `32` tests passed across WO-MAO-016/017;
- scoped ESLint: passed for all four implementation files and both test files;
- Node syntax checks: passed for all four executable modules;
- `git diff --check`: passed.

## Owner evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
