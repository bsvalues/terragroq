# WilliamOS Execution Fabric AEGIS Standing Compute Authority 001

Authority issue: `#586`

Standing HASH_VERIFY integration: `#590`

Status: `AUTHORITY_GRANTED / HASH_VERIFY_STANDING_ADAPTER_ACTIVE / FAIL_CLOSED`

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
7. exact expiring reviewed-main per-job admission;
8. complete evidence chain;
9. durable single-use claim;
10. exclusive lease;
11. current fence; and
12. immutable completion receipt.

The private request cannot assert its own approval. Admission requires a
separate, expiring control-plane artifact retained on reviewed `main`. That
artifact contains the complete canonical job scope and approval provenance,
including the exact outcome, cleared dependency state, risk, Work Order, source
commit, and adapter/integration digest tuple. The resident checkout must also
match a root-owned reviewed-release manifest. A root-owned bootstrap verifies a
content-addressed, root-owned, non-writable release directory and hashes the
complete executable module closure through no-follow descriptors before importing it. The single-use claim carries the
canonical digest of that binding. Missing bindings, caller-only approval claims,
digest drift, and reused admission identifiers reject before execution.

Admission fails closed when any binding is absent, stale, expired, consumed,
conflicting, digest-mismatched, broader than the approved outcome or Work Order,
or not independently reviewable. The standing grant does not replace the exact
single-use job claim or lease/fence controls.

## Adapter posture

```text
CI_BUILD_TEST: BLOCKED_NO_SEPARATELY_REVIEWED_ACTIVE_ADAPTER
HASH_VERIFY: ACTIVE_REVIEWED_STANDING_ADAPTER
HASH_VERIFY ADAPTER: resident-aegis-hash-verify-v1
COMPRESSION: BLOCKED_NO_SEPARATELY_REVIEWED_ACTIVE_ADAPTER
```

Only a separately reviewed active adapter may execute. Issue #590 supplies that
path for `HASH_VERIFY` only. Each invocation still requires an exact, expiring
admission retained on reviewed `main`, a durable single-use claim, an exclusive
lease with a current fence, and an immutable completion receipt. Contract,
template, profile, or standing-authority presence alone does not authorize a
job. A retained privileged journal epoch and claim prevent local claim deletion
from reopening an admission; missing journal history fails closed.

The boundary distinguishes prohibited workload/NAS/archive storage from required
control-plane evidence. Claim, lease, fence, recovery, result, release, and replay
records are durable audit evidence; they do not grant workload storage authority.

The Issue #538 one-shot proof and its consumed authority remain immutable
historical evidence. They are not standing admission, cannot be renewed or
repurposed, and are not modified by Issue #590.

## Vocabulary mapping

The dedicated authority artifact names the post-write reserve as
`minimum_free_bytes_after_requested_writes`; the Fabric registry projects the
same value as `minimum_free_bytes_after_job`, and the read model exposes it as
`minimumScratchReserveBytes`. All three are fixed at 100 GiB.

The authority artifact and read model identify
`resident-aegis-hash-verify-v1` as the active reviewed standing
`HASH_VERIFY` adapter. That adapter identity does not weaken any per-job gate or
activate `CI_BUILD_TEST` or `COMPRESSION`.

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

- Integrated Authority Registry, standing authority, admission issuer,
  historical adapter, standing HASH runtime, resident runner, remote-development
  trust, and network-boundary suites: `324 PASS / 27 deliberate skips`.
- Standing HASH_VERIFY and remote-development execution share one atomically
  created node-exclusive AEGIS lease and one node-wide mutation lock. Each
  runtime treats the other's live valid lease as occupied and cannot overwrite
  it.
- The standing coordinator may retire a proven-dead remote lease only after
  retaining exact, digest-bound recovery evidence; that recovery-only path
  creates no remote claim, execution authority, fence, result, or release.
- Claim-only and completion evidence digests are verified before first write;
  mutation-lock and lease release are atomic and cannot remove replacement
  state.
- Eligibility remains non-authorizing without an exact unexpired reviewed-main
  per-job admission and matching durable claim, lease/fence, and receipt chain.
- Broad worker, command-runner, scheduler, runtime, persistence, tool-call,
  autonomous-loop, and operator-host blocks: `UNCHANGED / BLOCKED`.
- Completed Issue #538 single-use proof artifacts changed: `0`.
