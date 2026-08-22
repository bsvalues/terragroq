# WO-AEH-011 — PostgreSQL restore-verification code and fixtures

Result: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS / NOT_LIVE_PROVEN`

## Scope and authority

- HermesLab base: `0481061acf1f683688a00b09795647d0288c7232`
- Reservation: `aegis/backup-v1.sh` and new `aegis/tests/restore-verification-*`
- Authority: R2 repository operational code and disposable/static fixtures only
- Live backup roots, Docker, databases, networks, pruning, services, and hosts were not invoked or
  mutated.
- Pre-existing HermesLab dirty and untracked state was preserved.

## Implementation

The restore path now:

- invokes `psql` with `ON_ERROR_STOP=1` and `-X` for both restore and verification;
- relies on `pipefail` so a failing `zcat` or `psql` prevents verification;
- requires the expected `terrafusion` database and `public` schema;
- requires configurable minimum base-table and exact row counts, defaulting to one each;
- extracts each exact count from PostgreSQL `query_to_xml` using the correct
  `//row/c/text()` document path before summing across user tables;
- rejects invalid PostgreSQL identifiers and zero, negative, empty, or nonnumeric invariant floors;
- runs the configurable application query inside an explicit read-only transaction followed by
  `ROLLBACK`, restricts it to one single-statement `SELECT`, and requires it to return exactly `ok`;
- distinguishes restore-command failure as `RESTORE_FAILED` and invariant failure as
  `RESTORE_PARTIAL`;
- emits only bounded invariant summaries into the receipt detail.

The test-only entry point exits before the backup workflow and exercises the production invariant
function with a fake `docker` executable. Synthetic cases cover success, missing database, missing
schema, zero tables, zero rows, failed application query, nonzero `psql`, nonnumeric counts, invalid
identifiers and invalid floors. A separately exercised classifier proves that corrupt/nonzero restore
input is `RESTORE_FAILED`, an empty or otherwise invariant-free restore is `RESTORE_PARTIAL`, and only
successful restore plus successful invariants is `RESTORE_VERIFIED`.

A second fixture provisions two tables with two and three rows in a uniquely named disposable
PostgreSQL container, invokes the production verifier with floors of two tables and five rows, and
requires the exact total of five. It uses an already cached PostgreSQL image and never pulls.
`postgres:15` was absent, so the fixture selected cached `postgres:16`, passed against real
PostgreSQL, and removed its uniquely named disposable container through its cleanup trap.

## Validation

```text
bash -n aegis/backup-v1.sh                                      PASS
bash -n aegis/tests/restore-verification-fixtures.sh            PASS
bash aegis/tests/restore-verification-fixtures.sh               PASS
  restore verification synthetic fixtures: PASS
bash aegis/tests/restore-verification-postgres-fixture.sh x5    PASS exact_rows=5 tables=2
git diff --check -- aegis/backup-v1.sh aegis/tests/...          PASS
git diff --check --reverse -- aegis/backup-v1.sh                PASS
```

Static inspection also confirmed the application probe contains `BEGIN TRANSACTION READ ONLY` and
an explicit `ROLLBACK`. Reverse-application checking proves the tracked script change has a clean
repository rollback patch; the new fixture file is removed to reverse its creation. Neither check
performed the rollback.

Artifact SHA-256 values after validation:

- `aegis/backup-v1.sh`: `efd8a770ed52d5de367072be7216ffb48bcd6eb221182201586ce7fb4ace0025`
- `aegis/tests/restore-verification-fixtures.sh`:
  `d2ec1ffda11722474b1e7c738e8a48f52ec022baa1799316ecdad2d2b8c12e6a`
- `aegis/tests/restore-verification-postgres-fixture.sh`:
  `2549781aacfed6cef93f684e35e676674cf2f936032bd08eb819aec69fd143c4`

## Non-proof and transition

This evidence proves repository syntax, synthetic fail-closed behavior, and exact-row aggregation
in a disposable PostgreSQL 16 container. It does not prove a real dump restore, the Atlas
schema/table contents, backup readiness, retention,
secondary-copy equality, or live RPO/RTO. Those claims remain gated by later disposable/live proof
Work Orders. No authority, activation, maturity promotion, commit, push, or merge was created.

Independent reviewer `/root/packet_assurance` reran all syntax and synthetic
checks plus three immediate real-PostgreSQL fixture cycles, verified official
image readiness, exact-row semantics, cleanup, rollback applicability, hashes,
and non-proof boundaries, and returned `PASS` with zero unresolved findings.
The five counters are:

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```
