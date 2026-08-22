# WO-AEH-020 - Coordinator Implementation and Packaging

Status: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS / VALIDATION_ONLY`.

Implemented a repository-only coordinator package with dedicated-session PostgreSQL advisory
leadership, WO-AEH-016 typed pull binding, freshness-bounded health/readiness state, fail-closed follower behavior,
safe replacement/drain checks obtained through an injected authoritative session inspector, and an inert hardened service template. Configuration names only
`AEH_ATLAS_DATABASE_URL`; it contains no value or credential.

Reconciliation is explicitly `WO-AEH-019_REQUIRED_NOT_IMPLEMENTED`. Ambiguous attempts prevent
replacement and this package does not claim, emulate, or bypass WO-AEH-019. Advisory leadership is
ephemeral election only; durable jobs, leases, fences, and receipts remain in Atlas PostgreSQL.

Transport/session uncertainty (SQLSTATE class `08`, administrator shutdown `57P01`, or a closed/lost
connection signal) immediately disables admission, clears the local leader claim, and enters
`FAILED`. Deterministic domain, idempotency, and validation rejections propagate without demoting a
valid leader; `CLAIM_NOT_ELIGIBLE` returns typed `NO_WORK`. Unlock must return exactly `true`; false is the typed fenced failure
`COORDINATOR_LEADERSHIP_ALREADY_LOST`. Database proof expires after one configured poll interval,
and startup/follower/no-proof states are neither healthy nor ready.

Validation: fifteen native tests (two consecutive passing runs) cover configuration negatives, leader/follower exclusion, proof freshness,
query/disconnect fencing, empty-queue and deterministic-error leadership preservation, repeatable drain and reconciliation fencing, confirmed session lock release,
unlock-false behavior, WO016 binding, and packaging. JSON parsing, TypeScript contract inspection,
secret scan, artifact hashes, and scoped `git diff --check` are recorded in unique evidence.

The repository declares TypeScript checking in CI, but local `pnpm` was unavailable; no dependency
or package-manager installation was attempted. This lane therefore does not claim a local full-tree
TypeScript pass.

No Atlas connection, database mutation, service installation/start/restart, host change, network
access, dependency installation, scheduler activation, worker execution, or issue #357 use occurred.
The service file is a placeholder template and proves neither systemd compatibility nor autorestart.

Rollback deletes only the new coordinator package, config/template, test, report, and evidence.

Independent reviewer `/root/packet_matrix` reran all 15 tests twice and verified
transport-only leadership demotion, typed no-work, deterministic-error handling,
freshness, draining, unlock fencing, WO-AEH-019 boundary, hashes and inert
packaging, returning `PASS` with no blockers.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```
