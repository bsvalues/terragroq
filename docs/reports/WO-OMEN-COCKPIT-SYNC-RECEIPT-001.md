OMEN_COCKPIT_STAGE_1: COMPLETE_FROZEN
OMEN_COCKPIT_SYNC_RECEIPT_FOLLOWUP: COMPLETE
SYNC_STATE: SYNC_OK
OWNER_ACTION_REQUIRED: false

# WO-OMEN-COCKPIT-SYNC-RECEIPT-001 — verified cross-node sync receipt

## Boundary and outcome

This bounded observability follow-up did not reopen or redesign Stage 1. It preserved the existing
04:00 schedule, transfer roots, archive selection, retention, SSH identity, backup behavior, Docker
architecture, databases, and storage responsibilities.

The implemented authority model is:

```text
Hermes executes and verifies.
Atlas stores the sole canonical durable receipt.
OMEN validates and reports read-only.
```

Atlas publishes the only canonical receipt at
`/home/bs/from-hermes/crossnode-sync-receipt.json`. Hermes records completed-task evidence at
`D:\CrossNodeBackups\crossnode-sync-task-evidence.json`. There is no dual-canonical publication.

## Immutable run binding and truth conditions

One immutable UUID `run_id` binds:

- the Atlas canonical receipt;
- the Atlas-to-Hermes directional manifest summary;
- the Hermes-to-Atlas directional manifest summary;
- the Hermes completed-task evidence; and
- the exact receipt/task-evidence timestamps consumed by OMEN.

`SYNC_OK` additionally requires both direction records to contain positive file counts and
`SHA256_PASS`, the exact Atlas receipt hash in Hermes evidence, Task Scheduler state `Ready`, task
result `0`, strict timestamp ordering, and evidence age at most 30 hours. A receipt alone cannot be
green.

Windows Task Scheduler's observed timestamp is accepted only when it is at or after
`started_at - 5 minutes` and at or before `task_evidence.completed_at + 5 minutes`. The live scheduler
reported `2026-08-08T17:59:59Z` for a bound script interval from
`2026-08-08T17:59:22.0111389Z` through `2026-08-08T17:59:35.1650529Z`, so exact equality would have
misrepresented real Windows behavior. The receipt and task-evidence timestamps remain exactly bound
across documents and monotonically ordered.

The public classifier states are exactly:

- `SYNC_OK`
- `SYNC_STALE`
- `SYNC_FAILED`
- `SYNC_UNKNOWN`

Only `SYNC_OK` permits overall exit `0`; every other state remains non-green and exits `2`.

## Exact implementation commits

```text
HERMES_PRODUCER_COMMIT=253eb1a1319be7d335baf7f79f92964378deeff3
OMEN_CONSUMER_COMMIT=a3137ee450b55c7790154628bc6e7134f3fb4c7f
```

The Hermes producer commit history leading to the deployed commit is:

```text
78af5d5757feb634da33a3452ba9d6d0474d2a5f
bef4adcaca95b5b635b58f9a307faf9e48477061
d948bffe2bf1cbebf33788b1a9041a43a3faae94
253eb1a1319be7d335baf7f79f92964378deeff3
```

The OMEN consumer final commit includes the Atlas-only model, duplicate-key rejection, exact
timestamp ordering, and bounded Windows scheduler-observation binding.

## Live verification evidence

```text
RUN_ID=a14a4724-6fbe-4f5e-b91b-aef6dde55847
ATLAS_RECEIPT_SHA256=08c6dddc8a567f6af99beb1999bed9b2935fde5ec491712013750dc0a619806d
HERMES_TASK_EVIDENCE_SHA256=a49f3fabdd6700cb153375f7f962c83099ea4f07d5204754c16a13792dc91148
TASK_STATE=Ready
TASK_RESULT=0
ATLAS_TO_HERMES=6/6 FILENAME_SIZE_SHA256_MATCH
HERMES_TO_ATLAS=15/15 FILENAME_SIZE_SHA256_MATCH
RECEIPT_RESULT=SUCCESS
RECEIPT_VERIFICATION=SHA256_PASS
TASK_EVIDENCE_STATE=COMPLETED
TASK_EVIDENCE_VERIFICATION=SHA256_PASS
```

Both directional comparisons were recomputed independently from the source and destination files;
the canonical receipt was not used as a substitute for that verification.

## Cockpit proof

The repository module and installed managed module are identical:

```text
SOURCE_MODULE_SHA256=0EA82568D4F02E8A459FF90A11964E488002397D54CC0E471223738B6D05E11D
INSTALLED_MODULE_SHA256=0EA82568D4F02E8A459FF90A11964E488002397D54CC0E471223738B6D05E11D
```

The installed operator commands report:

```text
lab-status: latest cross-node sync: SYNC_OK
lab-status: operator blocker: NONE
LAB_STATUS_EXIT=0

lab-backups: cross-node sync: SYNC_OK
LAB_BACKUPS_EXIT=0
```

## Focused validation

```text
pnpm exec vitest run tests/lab-control-cli.test.ts
Test Files  1 passed (1)
Tests       45 passed (45)
```

The focused suite includes failure coverage for one-direction-only evidence, hash mismatch,
mismatched and duplicate `run_id`, stale receipt, nonzero task result despite an Atlas receipt,
Hermes death after receipt publication, missing receipt, invalid schema/timestamps, task-evidence
ordering, and both sides of the scheduler-observation window. Bounded remote payload tests confirm
the evidence probes are read-only.

The Hermes producer tests passed under Windows PowerShell 5.1 and PowerShell 7, including checked
native failure and atomic-publication behavior.

## Files in this follow-up

- Hermes local repository:
  - `hermes/crossnode-sync.ps1`
  - `hermes/crossnode-sync-lib.ps1`
  - `hermes/test-crossnode-sync-receipt.ps1`
- OMEN PR `#529`:
  - `scripts/lab-control/LabControl.psm1`
  - `tests/lab-control-cli.test.ts`
  - `docs/superpowers/specs/2026-08-08-omen-cross-node-sync-receipt-design.md`
  - `docs/superpowers/plans/2026-08-08-omen-cross-node-sync-receipt.md`
  - `docs/runbooks/omen-lab-control.md`
  - `docs/reports/WO-OMEN-COCKPIT-SYNC-RECEIPT-001.md`

The frozen Stage-1 report was not modified.

## Remaining blocker and owner-touch counters

Exact remaining blocker: `NONE`.

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
SCOPE_VIOLATION_COUNT=0
```

PR `#529` may be marked ready for review only after the coordinator attaches the exact completion
evidence and verifies the PR head. This work order does not authorize merge.
