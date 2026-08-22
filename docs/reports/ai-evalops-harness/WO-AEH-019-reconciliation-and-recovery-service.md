# WO-AEH-019 — Reconciliation and recovery service

Status: `BUILDER_REMEDIATED / INDEPENDENT_REVIEW_PENDING / DISPOSABLE_POSTGRESQL_ONLY`.

Migration `0006_reconciliation_recovery` adds an immutable, replay-safe recovery receipt and one atomic reconciliation transaction. It authenticates the historical WO-018 descriptor without requiring an unexpired lease, rechecks current authority and capability, binds a typed recovery observation by ID and digest, locks the matching `RECONCILING` projection at the expected version, appends a digest-chained event, and records the receipt in the same transaction.

Outcome transitions are explicit: `NOT_EXECUTED` clears the attempt and returns to `ADMITTED`; `AMBIGUOUS` stays `RECONCILING`; `EXECUTED`, `EXPIRED`, and `FENCED` become typed terminal states. `EXPIRED` and `FENCED` require database-ground state. Terminal outcomes require terminal-receipt ID and digest; `EXECUTED` additionally requires the matching WO-017 delivered outbox/effect receipt. Changed operation replay, evidence mismatch, identity mismatch, stale version, and unjustified expiry/fence fail closed.

Focused cached-PostgreSQL tests exercise all five outcome transitions, restart reconstruction, exact replay/conflict, ambiguous blocking, retry-safe transition, unjustified-expiry rejection, database-ground expiry/fence terminalization, delivered-outbox consistency, observation and terminal digest conflicts, authority/capability rejection, stale CAS, event append, and cleanup. Delivery records are synthetic fixtures; no network, pull, live database, adapter, or external effect occurred.

Both focused runs passed 2/2. The serialized WO-009/015/016/017/018/019 integration suite passed 31/31, and the manifest checker passed through `0006`.

Rollback removes only the new function and receipt table and is safe only before durable use or in a disposable database. After writes, use forward repair or restore.
