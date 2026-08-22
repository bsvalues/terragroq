# WO-AEH-013 - Receipt-Driven Retention Contract and Tests

Result: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS`

Scope: synthetic, deterministic retention-policy contract and tests only. No live
backup, backup mount, retention job, service, network, or pruning operation was
accessed or changed.

## Outcome

The policy protects the union of:

- the newest generation with a successful backup receipt;
- the newest generation with a successful backup receipt, a restore-verified
  receipt, and complete protected-source verification; and
- every generation identified as an active recovery point.

The policy emits only a dry-run plan. Invalid or ambiguous receipt metadata emits
`NO_PRUNE_PLAN` with no protected or candidate IDs, so invalid input cannot become
permission to prune.

## Exact reservations and checkout truth

HermesLab base and head: `0481061acf1f683688a00b09795647d0288c7232`.

terragroq base and head: `13709f5789c25dea408283730a6bd35e8fd894ab`.

Owned files:

- `HermesLab:aegis/retention-policy-v1.json`
- `HermesLab:aegis/tests/retention-policy-v1.test.mjs`
- `terragroq:docs/reports/ai-evalops-harness/WO-AEH-013-receipt-driven-retention-contract-and-tests.md`

`HermesLab:aegis/backup-v1.sh` and all pre-existing modified or untracked files
were preserved and were not edited by this lane.

## Immutable digests

- `retention-policy-v1.json`: `46c2c1f6b9caca5d5e9b3fe08b12a4fe1f583d4eef21bae9a39d6664dbeb048e`
- `retention-policy-v1.test.mjs`: `d7a0e11da4ffd037497ea293bfff4dadc883c785fd413ad5a71bc5a351be222c`

## Validation

```text
node --test C:\HermesLab\aegis\tests\retention-policy-v1.test.mjs
tests: 16
pass: 16
fail: 0

JSON parse: PASS
git diff --check on reserved HermesLab files: PASS
live backup access: NOT PERFORMED
live pruning: NOT PERFORMED
network access: NOT PERFORMED
```

Covered negatives include duplicate or whitespace generation IDs, timezone-free
timestamps, impossible calendar dates, invalid month/hour/offset fields, unknown
receipt status, malformed receipt digests, restore verification paired with a
failed backup, and restore verification lacking complete protected-source
verification. All return `NO_PRUNE_PLAN` with zero candidates.

Rollback is deletion of the two new HermesLab artifacts and this report before
merge. No backup generation or historical evidence is changed by rollback.

## Maturity and owner boundary

Maturity before: `MODEL_VERIFIED planning / no receipt-driven retention contract`.

Maturity after: `CONTRACT_VERIFIED`.

Independent reviewer `/root/packet_matrix` reran all 16 tests, parsed the policy,
matched both SHA-256 digests, inspected strict RFC3339 and protection-union
semantics, confirmed direct whitespace coverage for untracked files, and returned
`PASS` with no blockers.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```

This evidence does not prove live retention, safe pruning of any real generation,
backup correctness, restore correctness, off-site recovery, or production
authorization. WO-AEH-014 and WO-AEH-043 remain separately authority-gated.
