# OMEN cross-node sync receipt design

Status: implemented and live-verified on 2026-08-08

Work Order: `WO-OMEN-COCKPIT-SYNC-RECEIPT-001`

## Objective and boundary

Stage 1 remains complete and frozen. This bounded observability follow-up makes the existing Hermes
scheduled cross-node backup sync machine-verifiable without changing its daily 04:00 schedule,
source and destination roots, archive selection, 14-day retention policy, SSH identity, Docker
topology, databases, backup creation, or storage architecture.

The authority model is deliberately asymmetric:

- Hermes executes the two transfer directions, verifies the data, and records task evidence.
- Atlas is the sole canonical durable receipt authority.
- OMEN reads both evidence surfaces and classifies them locally without inferring success from file
  existence or a scheduled-task result alone.

The four public states are `SYNC_OK`, `SYNC_STALE`, `SYNC_FAILED`, and `SYNC_UNKNOWN`.

## Source-control and deployment boundary

The producer is tracked in the local `C:\HermesLab` Git repository. That repository has no remote,
so the exact local commit is deployment evidence. Its reserved files are:

- `hermes/crossnode-sync.ps1`
- `hermes/crossnode-sync-lib.ps1`
- `hermes/test-crossnode-sync-receipt.ps1`

The OMEN consumer, focused tests, runbook, and this follow-up report remain on PR `#529` in
`bsvalues/terragroq`. Generated evidence stays outside Git at:

- Atlas canonical receipt: `/home/bs/from-hermes/crossnode-sync-receipt.json`
- Hermes task evidence: `D:\CrossNodeBackups\crossnode-sync-task-evidence.json`

No Hermes receipt is canonical or required. There is no dual publication contract and no attempt to
simulate a distributed transaction.

## Immutable run binding

Each complete sync attempt creates one UUID `run_id`. The same immutable value is required in:

- the Atlas-to-Hermes direction record;
- the Hermes-to-Atlas direction record;
- the Atlas canonical receipt; and
- the Hermes completed-task evidence.

The receipt's `started_at` and `completed_at` must exactly match the corresponding
`started_at` and `receipt_completed_at` fields in Hermes task evidence. The task evidence completion
must follow receipt completion. Evidence from different runs is never combined.

The Atlas receipt is strict UTF-8 JSON with exactly these top-level fields:

```json
{
  "schema_version": 1,
  "task_name": "HermesCrossNodeBackupSync",
  "run_id": "11111111-2222-3333-4444-555555555555",
  "started_at": "2026-08-08T11:00:00.0000000Z",
  "completed_at": "2026-08-08T11:00:25.0000000Z",
  "result": "SUCCESS",
  "verification": "SHA256_PASS",
  "directions": [
    {
      "run_id": "11111111-2222-3333-4444-555555555555",
      "direction": "ATLAS_TO_HERMES",
      "source": "atlas",
      "destination": "hermes",
      "file_count": 3,
      "manifest_sha256": "<64 lowercase hex characters>",
      "verification": "SHA256_PASS"
    },
    {
      "run_id": "11111111-2222-3333-4444-555555555555",
      "direction": "HERMES_TO_ATLAS",
      "source": "hermes",
      "destination": "atlas",
      "file_count": 5,
      "manifest_sha256": "<64 lowercase hex characters>",
      "verification": "SHA256_PASS"
    }
  ]
}
```

Hermes task evidence contains exactly:

```json
{
  "schema_version": 1,
  "task_name": "HermesCrossNodeBackupSync",
  "run_id": "11111111-2222-3333-4444-555555555555",
  "started_at": "2026-08-08T11:00:00.0000000Z",
  "receipt_completed_at": "2026-08-08T11:00:25.0000000Z",
  "completed_at": "2026-08-08T11:00:26.0000000Z",
  "state": "COMPLETED",
  "result": "SUCCESS",
  "verification": "SHA256_PASS",
  "atlas_receipt_sha256": "<sha256 of the exact canonical Atlas receipt bytes>"
}
```

Each canonical directional manifest consists of expected archive names, byte sizes, and SHA-256
values in ordinal name order. The destination must contain every expected filename with the same size
and hash. Extra retained destination archives do not invalidate the current transfer. Empty source
sets, unsafe names, duplicate names, or nonpositive counts cannot produce success.

Only allowlisted hosts, direction names, result values, verification values, counts, timestamps, and
manifest summaries are persisted. Per-file absolute paths, credentials, private-key paths, raw
stderr, commands, and environment dumps are excluded.

## Producer and publication semantics

Every native `ssh` and `scp` call is checked; a nonzero exit is terminal. POSIX remote command
payloads are base64-transported to avoid Windows OpenSSH command-line re-parsing. Native stderr is
captured and sanitized without allowing PowerShell's native-error wrapping to terminate before the
exit code can be classified.

Success requires both transfers to complete, positive source sets, destination existence, exact
byte-size equality, and SHA-256 equality. Hermes then:

1. creates the Atlas receipt for that `run_id`;
2. writes a same-directory temporary receipt on Atlas;
3. closes and atomically renames it into the canonical Atlas path;
4. reads and hashes the published Atlas bytes; and
5. writes completed Hermes task evidence atomically only after the Atlas hash is confirmed.

Any transfer, manifest, verification, receipt publication, or task-evidence failure exits nonzero.
A failed or incomplete run never overwrites Hermes completed-task evidence with a success record.
An older valid Atlas receipt can remain for diagnosis, but it cannot false-green a later failed task.
If Hermes dies after Atlas publication but before completed task evidence, OMEN reports
`SYNC_FAILED` because the canonical receipt alone is insufficient.

## OMEN consumer and state model

The Hermes probe reads the scheduled task's state, result, and observed timestamp plus the fixed
task-evidence file. The Atlas probe reads the fixed canonical receipt. Both JSON reads are capped at
65,536 bytes, transported as base64, and accompanied by SHA-256. OMEN rejects malformed base64,
oversized or changing files, hash mismatches, duplicate JSON property names, extra/missing fields,
wrong case, and values outside exact allowlists. Generated JSON is never evaluated as code.

Windows Task Scheduler's observed `LastRunTime` is not treated as the script's exact start time. Live
proof showed `17:59:59Z` while the bound script interval was
`17:59:22.0111389Z` through `17:59:35.1650529Z`. The truthful binding window therefore requires the
scheduler observation to be:

```text
>= receipt.started_at - 5 minutes
<= task_evidence.completed_at + 5 minutes
```

The narrower receipt and task-evidence timestamps still require exact cross-document equality and
strict monotonic ordering. All timestamps must also be no more than five minutes in the future.

State precedence is fail closed:

1. `SYNC_FAILED`: explicit nonzero task result; task not `Ready`; incomplete evidence after a receipt
   is present; invalid schema, encoding, hash, direction, count, timestamp, or `run_id`; mismatched
   Atlas receipt hash; failed verification; or inconsistent task observation.
2. `SYNC_UNKNOWN`: no trustworthy canonical receipt/evidence exists from which to determine state.
3. `SYNC_STALE`: the evidence is otherwise a complete valid success, but Hermes completed-task
   evidence is more than 30 hours old.
4. `SYNC_OK`: Atlas receipt and Hermes completed-task evidence are valid, share the same `run_id`,
   bind both verified directions and exact timestamps, task state is `Ready`, task result is `0`, the
   scheduler observation is inside its bounded window, and evidence age is at most 30 hours.

`SYNC_OK` is the only cross-node state accepted by `lab-status` for overall exit `0`. The other states
produce `REQUIRED_EVIDENCE_INCOMPLETE` and exit `2`. `lab-backups` uses the same classifier.

## Verification and delivery

The producer suite proves matched manifests and safe atomic publication plus transfer, SSH, missing
file, size, hash, empty-set, unsafe-name, duplicate-name, and persistence failures. The OMEN focused
suite proves fresh, stale, explicit failure, missing evidence, one-direction-only, bad hashes,
mismatched or duplicate `run_id`, out-of-order timestamps, scheduler-window boundaries, receipt-only,
Hermes-death, and read-only bounded transport behavior.

The live run proved task result `0`, one Atlas canonical receipt, matching completed Hermes task
evidence, two positive verified direction counts, independent filename/size/SHA-256 equality, and
installed `lab-status`/`lab-backups` success. PR `#529` remains draft until that evidence is attached;
it may then be marked ready for review but must not be merged by this work order.
