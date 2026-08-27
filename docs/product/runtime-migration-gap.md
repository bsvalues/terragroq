# The /runtime gap — what the strangulation has NOT taken yet

Status: **OPEN, TYPED, ENFORCED.** Recorded by the frontend takeover lane at the landing of the
primary experience replacement (PR #927 lineage). Enforced by `tests/runtime-migration-gap.test.ts`.

## Why this file exists

The commit that migrated the governed queue said it plainly: *"This surface exists because a FIX
created a gap."* Correcting the activity surface to its real reader (`getActivity`) was right — it had
been showing the outcome queue and calling itself activity — but it left the queue with nowhere to
appear at all, and **nothing failed**, because nothing asserted the queue was reachable.

That gap is closed: the queue is a surface, wired end to end. The lesson is not.

Six legacy routes were deleted in this change. `/runtime` was **not**, and the reason is recorded
here rather than in a commit message, because a commit message is not something the next lane reads
before deciding a page looks safe to delete. `/runtime` is not one capability. It is a composite of
about ten reads, and only two of them have moved.

## The ledger

| Read | Owner | Status |
| --- | --- | --- |
| Runtime executions | `getRuntimeExecutions` | **MIGRATED** — the `runtime-trace` surface |
| Governed outcome queue | `getOutcomeQueueSurface` | **MIGRATED** — the `queue` surface |
| Recent evidence (global) | `getRecentEvidence` | NOT MIGRATED |
| Outcome completion timeline | `getRecentOutcomeCompletionTimeline` | NOT MIGRATED |
| Continuous campaign status | `projectContinuousCampaignStatus` | NOT MIGRATED |
| Runtime probe (live read) | `RuntimeProbe` | NOT MIGRATED |
| Auth / system readiness | `getAuthReadiness` | NOT MIGRATED |
| Readiness native area | `ReadinessNativeAreaPanel` | NOT MIGRATED |
| Local runtime live status | `LocalRuntimeLiveStatusPanel` | NOT MIGRATED |
| Device enrollment | `DeviceEnrollmentPanel` | NOT MIGRATED |
| Inference runtime status | `buildRuntimeStatus` | NOT MIGRATED |
| System truth | `projectSystemTruth` | Shared with `/system` — belongs with THAT migration, not duplicated here |

Global recent evidence is **not** the same read as the environment's `evidence` surface, which is
scoped to the bound work order. Migrating one does not migrate the other, and treating them as the
same read is how eight reads would get dropped while a suite stayed green.

## The rule this places on the next lane

`/runtime` stays reachable until its reads exist as surfaces. There are no writes on the route — the
probe is a live read — so nothing needs retiring first; the only thing standing between here and
deletion is that deleting it now drops nine reads on the floor, which is the exact failure the whole
exercise exists to prevent.

`tests/runtime-migration-gap.test.ts` fails the build if `/runtime` is deleted while this ledger
still lists an unmigrated read, and fails if the ledger drifts from what the page actually imports.
Update the ledger by migrating a read, not by editing the row.

## What made this gap invisible the first time

A surface has to be checked for what it **stopped** showing, not only for what it shows. A green suite
is not evidence that nothing was lost — it is evidence that nothing anyone thought to assert was lost.
