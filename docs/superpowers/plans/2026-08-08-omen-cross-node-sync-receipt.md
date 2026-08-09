# OMEN Cross-Node Sync Receipt Implementation Plan

Status: implementation and live proof complete; PR evidence handoff pending

Work Order: `WO-OMEN-COCKPIT-SYNC-RECEIPT-001`

**Goal:** Make OMEN report `SYNC_OK`, `SYNC_STALE`, `SYNC_FAILED`, or `SYNC_UNKNOWN` from one Atlas
canonical receipt and bound Hermes task evidence.

**Architecture:** Hermes executes and verifies both transfer directions. Atlas atomically publishes
the sole canonical durable receipt only after both directions pass. Hermes records completed-task
evidence containing the same immutable `run_id` and the exact Atlas receipt hash. OMEN reads both
surfaces, the Windows scheduled-task result, and a bounded task observation timestamp before it
classifies the run.

**Tech stack:** Windows PowerShell 5.1 on Hermes, OpenSSH `ssh`/`scp`, POSIX shell and `sha256sum` on
Atlas, PowerShell 7 on OMEN, TypeScript/Vitest contract tests, Git/GitHub PR `#529`.

## Global constraints

- Stage 1 remains complete and frozen.
- Keep the 04:00 schedule, roots, archive selection, retention, SSH identity, Docker topology,
  databases, backup creation, and storage architecture unchanged.
- Atlas is the only canonical receipt authority at
  `/home/bs/from-hermes/crossnode-sync-receipt.json`.
- Hermes task evidence is `D:\CrossNodeBackups\crossnode-sync-task-evidence.json`; there is no
  canonical Hermes receipt.
- One UUID `run_id` binds the Atlas receipt, both direction records, Hermes task evidence, and the
  timestamp relationship used by OMEN.
- Publish success only after both directions pass destination existence, byte-size, and SHA-256
  checks. Any failed or incomplete operation exits nonzero and cannot publish completed success
  evidence.
- Freshness is 30 hours. `SYNC_OK` alone permits overall exit `0`.
- Generated evidence contains no secrets, commands, environment dumps, raw stderr, private-key paths,
  or absolute archive paths.
- Preserve unrelated Hermes/Atlas work and unrelated OMEN changes.
- PR `#529` remains draft until completion evidence is attached; this work order does not merge it.

## Task 1 — Hermes producer

- [x] Add isolated producer tests before implementation and capture RED.
- [x] Implement checked native command execution and safe POSIX command transport.
- [x] Build ordinal filename/size/SHA-256 manifests for both directions.
- [x] Reject empty sets, unsafe names, duplicate names, missing files, size/hash mismatches, and
  nonzero native operations.
- [x] Generate one immutable UUID `run_id` for each complete attempt and place it in both direction
  records and the Atlas receipt.
- [x] Atomically publish the single Atlas canonical receipt after both verified directions.
- [x] Verify the exact Atlas receipt hash, then atomically record Hermes completed-task evidence with
  that same `run_id` and receipt hash.
- [x] Preserve task failure as nonzero and never create completed success evidence for an incomplete
  run.
- [x] Validate on PowerShell 5.1 and PowerShell 7.
- [x] Commit only the three reserved Hermes producer files.

Producer commit chain:

```text
78af5d5757feb634da33a3452ba9d6d0474d2a5f initial verified producer
bef4adcaca95b5b635b58f9a307faf9e48477061 Atlas-only canonical authority
d948bffe2bf1cbebf33788b1a9041a43a3faae94 checked failure classification
253eb1a1319be7d335baf7f79f92964378deeff3 Windows OpenSSH and stderr hardening
```

## Task 2 — OMEN consumer

- [x] Add deterministic receipt/task-evidence fixtures and capture RED.
- [x] Read the Atlas canonical receipt and Hermes task evidence read-only with 65,536-byte caps,
  base64 transport, and SHA-256.
- [x] Reject malformed JSON, duplicate property names, wrong schema/case, extra or missing fields,
  unsafe values, bad hashes, missing directions, and nonpositive counts.
- [x] Require the exact same `run_id` in the receipt, both directions, and task evidence.
- [x] Require exact receipt/task-evidence timestamp binding and monotonic completion ordering.
- [x] Calibrate the Windows Task Scheduler observation to the proven interval
  `started_at - 5 minutes` through `task_evidence.completed_at + 5 minutes`; reject either boundary
  violation.
- [x] Implement the exact public states `SYNC_OK`, `SYNC_STALE`, `SYNC_FAILED`, and `SYNC_UNKNOWN`.
- [x] Share one classifier between `lab-status` and `lab-backups`.
- [x] Require `SYNC_OK` for overall exit `0`; every other state exits `2` with
  `REQUIRED_EVIDENCE_INCOMPLETE`.
- [x] Reinstall the managed OMEN commands and verify installed/source module identity.
- [x] Pass all 45 focused tests.

Consumer final commit:

```text
a3137ee450b55c7790154628bc6e7134f3fb4c7f
```

## Task 3 — Live proof

- [x] Run the existing `HermesCrossNodeBackupSync` task once and wait for `Ready`.
- [x] Require `LastTaskResult=0`.
- [x] Validate the Atlas receipt and Hermes task evidence hashes.
- [x] Require one shared `run_id` across receipt, both directions, and task evidence.
- [x] Independently compare filenames, sizes, and SHA-256 in both directions.
- [x] Prove 6 of 6 Atlas-to-Hermes files and 15 of 15 Hermes-to-Atlas files match.
- [x] Prove installed `lab-status` reports `SYNC_OK`, blocker `NONE`, exit `0`.
- [x] Prove installed `lab-backups` reports `SYNC_OK`, exit `0`.
- [x] Verify the source and installed module SHA-256 are identical.

Live evidence identifiers:

```text
run_id=a14a4724-6fbe-4f5e-b91b-aef6dde55847
atlas_receipt_sha256=08c6dddc8a567f6af99beb1999bed9b2935fde5ec491712013750dc0a619806d
hermes_task_evidence_sha256=a49f3fabdd6700cb153375f7f962c83099ea4f07d5204754c16a13792dc91148
task_result=0
verification=SHA256_PASS
```

## Task 4 — Documentation, assurance, and PR handoff

- [x] Correct design and plan documents to the Atlas-only canonical model.
- [x] Update the operator runbook without editing the frozen Stage-1 report.
- [x] Add a separate completed follow-up report.
- [ ] Run final independent assurance across producer, consumer, tests, documentation, and live
  evidence.
- [ ] Push the OMEN branch and attach exact completion evidence to draft PR `#529`.
- [ ] Verify the PR head and evidence comment, then mark PR `#529` ready for review.
- [ ] Do not merge.

The coordinator owns the remaining unchecked PR lifecycle steps. Any assurance finding returns to the
original reserved builder; documentation findings may return to this documentation lane.
