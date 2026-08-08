# OMEN cross-node sync receipt design

Status: approved for implementation on 2026-08-08

Work Order: `WO-OMEN-COCKPIT-SYNC-RECEIPT-001`

## Objective and boundary

Stage 1 remains complete and frozen. This follow-up adds one observability contract: the existing
Hermes scheduled cross-node backup sync will publish a durable success receipt only after both
transfer directions pass post-transfer SHA-256 verification. OMEN will validate that receipt and
report one of four stable states:

- `SYNC_OK`
- `SYNC_FAILED`
- `SYNC_STALE`
- `SYNC_NEVER_VERIFIED`

The daily 04:00 schedule, source and destination roots, archive selection, 14-day retention policy,
SSH identity, Docker topology, databases, backup creation, and storage architecture do not change.
Generated receipts remain outside Git. No credentials, command output, environment dump, or absolute
private-key path may enter a receipt.

## Source-control and deployment boundary

The authoritative producer is the tracked, clean script
`C:\HermesLab\hermes\crossnode-sync.ps1` in the local `C:\HermesLab` Git repository. That repository
has no remote, so the producer change receives a local commit and its hash is recorded as deployment
evidence. Unrelated untracked Atlas inventory scripts remain untouched.

The OMEN consumer, focused tests, runbook, and follow-up report remain on PR `#529` in
`bsvalues/terragroq`. The generated receipts are written only to:

- Hermes: `D:\CrossNodeBackups\crossnode-sync-receipt.json`
- Atlas: `/home/bs/from-hermes/crossnode-sync-receipt.json`

## Receipt contract

The producer emits UTF-8 JSON with this schema:

```json
{
  "schema_version": 1,
  "task_name": "HermesCrossNodeBackupSync",
  "run_id": "20260808T110000Z-<random-suffix>",
  "started_at": "2026-08-08T11:00:00.0000000Z",
  "completed_at": "2026-08-08T11:00:25.0000000Z",
  "result": "SUCCESS",
  "verification": "SHA256_PASS",
  "directions": [
    {
      "direction": "ATLAS_TO_HERMES",
      "source": "atlas",
      "destination": "hermes",
      "file_count": 3,
      "manifest_sha256": "<sha256-of-canonical-verified-file-manifest>"
    },
    {
      "direction": "HERMES_TO_ATLAS",
      "source": "hermes",
      "destination": "atlas",
      "file_count": 5,
      "manifest_sha256": "<sha256-of-canonical-verified-file-manifest>"
    }
  ]
}
```

Each canonical manifest contains the expected source archive names, byte sizes, and SHA-256 values in
ordinal path order. The destination manifest must contain every expected filename with the same size
and SHA-256. Extra older destination archives do not invalidate the current transfer because the
existing roots intentionally retain history. Empty source sets are failures; a run cannot publish a
zero-file success receipt.

Only the allowlisted host names, direction names, result, verification value, counts, timestamps, and
manifest summaries are stored. Per-file absolute paths and raw stderr are excluded.

## Producer flow and failure semantics

The existing transfer directions remain in their current order. Every native `ssh` and `scp` call is
wrapped so a nonzero exit is terminal and produces a sanitized error on the task stream. After both
copies, the producer builds source and destination manifests and compares each expected file by name,
size, and SHA-256.

A success receipt is constructed only when:

1. both transfer directions completed with exit `0`;
2. both source sets contain at least one archive;
3. every expected destination file exists;
4. every expected byte size and SHA-256 matches; and
5. both receipt copies can be persisted and verified.

The producer writes same-directory temporary files and promotes them with atomic rename. It verifies
the Atlas receipt copy hash before promoting the Hermes receipt. Any transfer, manifest, verification,
receipt-copy, or atomic-promotion error exits nonzero and does not replace the prior valid success
receipt. The scheduled task's `LastTaskResult` therefore records failure while the older success
receipt remains available for diagnosis. The existing archive retention commands remain bounded to
`*.tar.gz`; JSON receipts are never retention targets.

There is no cross-node transaction. A failure between the two final renames can leave one new receipt
copy and one old copy, but the nonzero scheduled-task result forces `SYNC_FAILED`; OMEN never treats
either copy alone as success for that attempt.

## OMEN consumer and state model

The Hermes probe reads the fixed receipt path read-only with a strict size cap and transports it as a
single base64 value alongside the scheduled task's last-run time and result. Atlas supplies its fixed
receipt hash as corroboration when reachable. Generated JSON is never evaluated as code.

The local PowerShell classifier validates schema, task binding, timestamps, result, verification,
both required directions, positive file counts, SHA-256 formatting, and matching Hermes/Atlas receipt
hashes. It uses an exact allowlist rather than accepting any nonempty string.

Precedence is fail closed:

1. Current scheduled task result nonzero, malformed receipt, future timestamp, task/receipt binding
   mismatch, missing direction, invalid count/hash, or receipt-copy hash mismatch: `SYNC_FAILED`.
2. No valid success receipt has ever been observed: `SYNC_NEVER_VERIFIED`.
3. Latest valid success receipt is more than 30 hours old: `SYNC_STALE`.
4. Current task result is zero, the receipt is bound to that run, both copies match, and completion is
   at most 30 hours old: `SYNC_OK`.

`SYNC_OK` is the only cross-node state accepted by `lab-status` for exit `0`. The other three states
produce `REQUIRED_EVIDENCE_INCOMPLETE` and exit `2`. `lab-backups` uses the same classifier so its
continuity result cannot disagree with `lab-status`.

## Test-driven implementation

The OMEN focused suite first gains failing behavioral tests for:

- fresh, valid, task-bound, mirrored receipt -> `SYNC_OK`, overall exit `0`;
- nonzero latest task result despite an older valid receipt -> `SYNC_FAILED`, exit `2`;
- valid receipt older than 30 hours -> `SYNC_STALE`, exit `2`;
- no receipt -> `SYNC_NEVER_VERIFIED`, exit `2`;
- malformed base64/JSON/schema/timestamp/direction/count/hash or mirror mismatch -> `SYNC_FAILED`;
- future-dated or task-mismatched receipt -> `SYNC_FAILED`;
- production-faithful Atlas fallback cannot false-green an arbitrary string;
- Hermes remote receipt reads are bounded and contain no write command; and
- `lab-status` and `lab-backups` share the same state classification.

Producer tests use isolated temporary source/destination fixtures and fake checked native-call seams.
They prove that matched two-direction manifests create the exact schema atomically, while simulated
copy, SSH, missing-file, size, hash, empty-set, or receipt-mirror failures return nonzero and never
replace the last success receipt. No production backup is used for unit tests.

## Live verification and delivery

After both repositories pass focused tests and direct review, deploy the committed producer script to
its already-authoritative path and run the existing scheduled task once through Task Scheduler. The
live proof must show:

- task result `0`;
- two matching receipt copies with the approved schema;
- positive file counts for both directions;
- `verification=SHA256_PASS` and `result=SUCCESS`;
- independently recomputed source/destination manifest equality;
- `lab-status` reports `SYNC_OK`, `operator blocker: NONE`, and exit `0`; and
- a controlled fixture, not a production transfer, proves failed and stale receipts remain non-green.

The final PR `#529` comment records the Hermes local producer commit, OMEN consumer commit, focused
test output, live receipt hashes, task result, `lab-status` output, and zero owner-touch counters. PR
`#529` remains draft until this evidence is attached; only then may it be marked ready for review.
