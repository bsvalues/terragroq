# WO-AEH-018 — Restart-safe settlement descriptor

Status: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS / DISPOSABLE_POSTGRESQL_ONLY`.

Migration `0005_restart_safe_settlement` adds an immutable authenticated descriptor binding job, attempt, run, claim, lease, effect domain, fence, holder, instance, boot, authority, capability, input, and database expiry. The descriptor is reconstructed from PostgreSQL by ID and digest, eliminating process-local or `WeakMap`-only settlement state without changing existing activation APIs.

Issuance derives all security-sensitive values from the durable job, attempt, lease, worker, authority-status, and capability-status rows. Reconstruction rechecks digest, lease currency, expiry, authority revocation/validity, and capability freshness. Settlement is operation-idempotent through an immutable receipt, requires typed terminal evidence, and atomically advances the matching current attempt projection to one typed terminal outcome. Changed replay arguments fail closed.

Validation used only the cached local `postgres:16` image. Three native tests applied migrations `0000` through `0005` to a uniquely named disposable database, reconstructed the descriptor through a fresh query path, settled and replayed it, and rejected digest tampering, wrong holder, authority revocation, stale capability, expiry, and changed settlement replay. The exact container was removed and verified absent. Static manifest validation and `git diff --check` passed.

Rollback drops only the three new functions and two new tables in dependency order. It is safe only before durable use or in a disposable environment; after settlement writes, use reviewed forward repair or restore.

No image pull, network call, live database, adapter, external effect, worker, or production state was accessed. This does not prove end-to-end crash recovery or exactly-once external effects.

Independent reviewer `/root/packet_matrix` reran 13 tests and the migration
checker, verified every descriptor binding, trusted digest, current-state
reconstruction, typed receipt, terminal CAS, replay/conflict, rollback, hashes
and cleanup, and returned `PASS` with no blockers.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```
