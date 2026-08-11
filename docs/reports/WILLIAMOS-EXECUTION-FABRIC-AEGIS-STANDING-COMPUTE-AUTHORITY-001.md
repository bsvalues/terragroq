# WilliamOS Execution Fabric AEGIS Standing Compute Authority 001

Issue: `#586`

Status: `AUTHORITY_GRANTED / EXECUTION_INTEGRATION_PENDING / FAIL_CLOSED`

Program: `PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Authority category: `AEGIS_BOUNDED_COMPUTE`

Authority gate: `AEGIS_BOUNDED_COMPUTE_GATE`

## Owner grant

The owner explicitly grants standing WilliamOS-native R0/R1 AEGIS compute
authority for exactly these workload classes:

```text
CI_BUILD_TEST
HASH_VERIFY
COMPRESSION
```

The grant permits an exact approved job to use bounded AEGIS compute without a
new owner decision when every admission binding below is current and valid. It
does not authorize WilliamOS to infer, widen, or manufacture a job, adapter,
lease, evidence record, claim, or authority record.

## Fixed ceilings

```text
CONCURRENCY: 1
CPU THREADS: <= 12
MEMORY: <= 8 GiB
RUNTIME: <= 30 minutes
OUTPUT: <= 512 MiB
SCRATCH WRITES: <= 5 GiB
SCRATCH FREE RESERVE: >= 100 GiB
NETWORK: none
EXECUTION IDENTITY: non-root / no sudo
```

Scratch is job-scoped only. The grant creates no durable workload storage,
NAS, backup, archive-retention, authoritative-state, or cross-job workspace
authority.

## Per-job admission

Each job must bind all of the following exact records:

1. approved owner outcome;
2. approved Work Order;
3. reviewed source;
4. approved template;
5. approved operation profile;
6. separately reviewed active adapter for the workload class;
7. complete evidence chain;
8. exclusive lease;
9. current fence; and
10. single-use claim.

The request cannot assert its own approval. Admission requires a separate,
short-lived control-plane binding from the trusted WilliamOS authority source.
That binding names the exact job, outcome, risk, Work Order, source commit, and
workload adapter tuple. The single-use claim carries the canonical digest of
that binding. Missing bindings, caller-only approval claims, digest drift, and
reused admission identifiers reject before execution.

Admission fails closed when any binding is absent, stale, expired, consumed,
conflicting, digest-mismatched, broader than the approved outcome or Work Order,
or not independently reviewable. The standing grant does not replace the exact
single-use job claim or lease/fence controls.

## Adapter posture

```text
CI_BUILD_TEST: BLOCKED_NO_SEPARATELY_REVIEWED_ACTIVE_ADAPTER
HASH_VERIFY: BLOCKED_STANDING_INTEGRATION_NOT_ACTIVE
COMPRESSION: BLOCKED_NO_SEPARATELY_REVIEWED_ACTIVE_ADAPTER
```

Only a separately reviewed adapter integrated with a durable standing-admission
path may execute. Contract or profile presence is not adapter activation. The
completed bounded `HASH_VERIFY` proof remains immutable historical evidence; its
old one-use authority cannot be repurposed. No adapter currently consumes this
standing grant, so this change authorizes the bounded class without falsely
claiming an executable standing path.

## Vocabulary mapping

The dedicated authority artifact names the post-write reserve as
`minimum_free_bytes_after_requested_writes`; the Fabric registry projects the
same value as `minimum_free_bytes_after_job`, and the read model exposes it as
`minimumScratchReserveBytes`. All three are fixed at 100 GiB.

The authority artifact records the historical HASH adapter as
`REVIEWED_NOT_STANDING_INTEGRATED`; the read model presents the same condition
as `BLOCKED_STANDING_INTEGRATION_NOT_ACTIVE`. Neither value activates execution.

## Unchanged broad blocks

```text
AUTONOMY: NOT_GRANTED
WORKER_ACTIVATION_GATE: BLOCKED
COMMAND_RUNNER_GATE: BLOCKED
SCHEDULER_GATE: BLOCKED
GLOBAL_SCHEDULER: OFF
LOCAL_RUNTIME_CONTROL_GATE: BLOCKED
SERVICE_REGISTRATION_GATE: BLOCKED
TOOL_CALL_GATE: BLOCKED
AUTONOMOUS_LOOP_GATE: BLOCKED
GENERIC STORAGE/NAS/BACKUP AUTHORITY: NOT_GRANTED
NETWORK AUTHORITY: NOT_GRANTED
REMOTE-SYSTEM AUTHORITY: NOT_GRANTED
ROOT/SUDO AUTHORITY: NOT_GRANTED
```

This record does not activate Hermes, MCP, a generic worker, a background loop,
a command runner, a WilliamOS runtime or supervisor, a service, or a scheduler.
It grants no production, database, cloud, credential, external-system,
TerraFusion, PACS, county-data, or GitHub operator-host authority.

## Registry evidence

The static Authority Registry records the grant as
`authority-aegis-bounded-compute-standing`. The dedicated category and gate
prevent this narrow compute authority from being represented as generic
`AUTONOMY` or as an opening of the existing worker, command-runner, scheduler,
runtime, storage, or remote-system gates.

## Validation

- Focused Authority Registry suite: `16/16 PASS`.
- Standing authority eligibility suite: `4/4 PASS`.
- Canonical Fabric registry suite: `113/113 PASS`.
- Eligibility evaluation remains non-authorizing: `execution_authorized=false`
  and `dispatch_allowed=false` until durable trusted-main integration exists.
- Broad worker, command-runner, scheduler, runtime, persistence, tool-call,
  autonomous-loop, and operator-host blocks: `UNCHANGED / BLOCKED`.
- Completed Issue #538 single-use proof artifacts changed: `0`.
