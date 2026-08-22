# WO-AEH-017 — Transactional outbox and effect idempotency

Status: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS / DISPOSABLE_POSTGRESQL_ONLY`.

State transition and outbox intent are one transaction. Immutable operation receipts bind enqueue, dispatch claim, and outcome requests. Enqueue and every initial/replayed dispatch require a found, current lease/fence/authority/capability proof. Dispatch uses a candidate-then-effect-domain-lock-then-row-lock protocol and permits stale in-flight redelivery for at-least-once operation. The shared effect-domain transaction lock serializes dispatch mutation with WO-AEH-019 reconciliation. The effect-domain/idempotency key receipt rejects payload or fence drift. `DELIVERED` requires a digest-matched `TERMINAL_RECEIPT`; `AMBIGUOUS` requires a digest-matched `RECOVERY_OBSERVATION` and is never represented as delivered or successful. A terminal claim replay exposes only terminal status, outbox ID, and fence—not delivery payload.

Cached PostgreSQL tests prove atomic enqueue, exact/conflicting enqueue replay, wrong-fence rejection, stale redelivery, two-way concurrent dispatch with exactly one winner, claim replay, evidence-kind/digest enforcement, exact/conflicting outcome replay, durable delivered outcome, ambiguous no-false-success, and terminal non-delivery replay. Static checks prove bounded typed APIs and no HTTP/shell adapter. No external effect, network, image pull, dependency install, or live database was used.

Rollback is pre-use/disposable only: functions and WO017 ledgers are dropped, then additive outbox columns. After use, use reviewed forward recovery.

Non-proof: fixtures do not prove a real adapter, production crash/failover, throughput, or exactly-once external effects.

On pass, release only dependency-authorized successors. On block, retain reviewer-blocked state and remediate WO017.

## Independent review closure

- Reviewer: `/root/packet_assurance` (independent of the builder lane)
- Verdict: `PASS`; zero unresolved blocking findings
- Revalidation: focused WO017 suite `2/2 PASS`; combined execution-control suite `29/29 PASS`
- Integrity: all five recorded artifact hashes matched the reviewed engine, migration, rollback, manifest, and test files
- Correctness: current-fence validation fails closed; stale dispatch is redelivered; concurrent dispatch has one winner; outcome evidence is kind- and digest-bound; terminal replay withholds delivery payload; exact replays are idempotent and changed payload, fence, or outcome conflicts
- Cleanup: all disposable PostgreSQL fixtures were removed; scoped diff validation passed
- Evidence limit: this proves the disposable transactional contract only. It does not prove an external adapter, live effects, production failover, or exactly-once delivery outside the governed outbox boundary.
