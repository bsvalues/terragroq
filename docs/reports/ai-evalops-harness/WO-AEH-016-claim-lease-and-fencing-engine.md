# WO-AEH-016 — Claim, lease, and fencing engine

Status: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS / DISPOSABLE_POSTGRESQL_ONLY`.

## Outcome

The claim protocol is database-owned and bounded. `claim_job` locks both admitted job and projection rows, verifies an exact active worker/instance/boot identity, reads the next effect-domain fence, appends one attempt, inserts one database-time lease, and advances the projection with version CAS in the same PostgreSQL transaction. A competing claimant observes the committed projection and fails with `CLAIM_NOT_ELIGIBLE`; a failed or rolled-back claim leaves no attempt, lease, fence, or receipt residue.

Claim, renew, release, and expire operations persist immutable `(operation ID, kind, canonical request digest, response)` receipts. The trusted database boundary derives the digest from the actual typed semantic arguments; callers cannot supply or override it. Repeating the exact operation returns the original attempt, lease, full-width fence, expiry, renewal, or release result without another effect. Reusing an operation ID with changed semantic arguments fails with `OPERATION_IDEMPOTENCY_CONFLICT`, including under concurrent exact-replay/conflicting-request races.
Transaction-scoped advisory locks serialize only contenders for the same operation receipt ID; they are not job, lease, fence, or durable authority state. The immutable receipt remains the replay source of truth.

Renew and release require the exact lease, attempt, worker, instance, boot, fence, and renewal sequence. Renewals use `clock_timestamp()`, advance the sequence exactly once, and set a bounded noncumulative database-time expiry. A stale holder cannot normally release after expiry. `expire_lease` durably retires an expired holder and moves the projection to `RECONCILING`; it never re-admits the job. Only an explicit `reconcile_expiry(..., 'NOT_EXECUTED')` outcome proves retry safe and restores `ADMITTED`; ambiguous outcomes remain blocked. A replacement then receives a strictly higher fence. `validate_current_fence` is the pre-effect boundary: exact identity, unexpired/unreleased lease, current domain counter, an ACTIVE/unexpired/unrevoked authority registry row, and an exact FRESH/unexpired worker capability row must all match.

`pull_next_job` uses `FOR UPDATE SKIP LOCKED`; the TypeScript wrapper bounds retries to three and returns `AMBIGUOUS_RECONCILIATION_REQUIRED` instead of retrying indefinitely after uncertain transport outcomes. It accepts UUID identities and bounded TTL/release values only and provides no arbitrary SQL, command, shell, adapter, or issue `#357` path.

Pull locks and consults its immutable operation receipt before scanning eligibility. Its database-derived digest binds worker/instance/boot, claim and lease identities, TTL, and operation identity, while the committed response additionally binds the selected job. Exact replay therefore returns the original job even when it is no longer eligible; changed arguments conflict. The PostgreSQL fixture commits a pull, terminates the client connection before the following response-bearing session completes, then proves replay from the receipt.

Expiry reconciliation is likewise receipt-owned. It requires an operation ID, exact actor and current authority, a matching durable `RECOVERY_OBSERVATION` ID/digest, adapter result, expected projection version, and current attempt. Receipt plus `EXPIRY_RECONCILED` event are atomic. Only validated `NOT_EXECUTED` evidence re-admits; `EXECUTED` and `AMBIGUOUS` remain non-retry/reconciling outcomes. Exact replay is idempotent and changed semantics conflict.

## Validation

- `node --test --test-concurrency=1 tests/ai-evalops-harness-claim-lease-engine.test.mjs tests/ai-evalops-harness-durable-schema.test.mjs tests/ai-evalops-harness-schema-drift.test.mjs` — 24/24 pass. File-level test concurrency is intentionally one so the two disposable PostgreSQL fixtures do not contend for local Docker startup resources; claim contention remains two simultaneous sessions inside the WO-AEH-016 fixture.
- Two truly concurrent `docker exec` claim sessions against a uniquely named cached `postgres:16` disposable container produced exactly one success, one attempt, one lease, and next fence `2`; the loser returned `CLAIM_NOT_ELIGIBLE`.
- Real PostgreSQL evidence covers exact replay and changed-argument conflict for pull/claim/renew/release, a terminated client after committed pull, response loss after commit, transaction rollback before commit, same-domain multi-job exclusion, simultaneous different-domain leases, renew/release races, wrong holder/boot, authority revocation, stale capability, forged/current fence validation, evidence-bound expiry reconciliation/reclaim with higher fence, expired outbox rejection, and a fence of `9007199254740993` without JavaScript-number truncation. WO-AEH-015 relational negatives and all ten WO-AEH-009 migration regressions also remain green.
- Migration checker, Node syntax check, JSON parse, scoped diff check, and no-container-residue check pass.

No image pull, dependency install, network call, or live database was used. Fixture cleanup asserts successful container removal and an empty exact-name residue query.

## Scope and rollback

WO-AEH-016 owns the typed engine, `0003` additive migration and rollback, native test, report, and evidence. Manifest, migration phase regression, and WO-AEH-009/015 evidence hashes are narrow integration updates. Pre-use/disposable rollback removes all `0003` functions plus its receipt/authority/capability relations and manifest entry. After protocol use, recovery requires reviewed forward handling; rollback evidence does not authorize mutation.

## Non-proof

Synthetic jobs, workers, authority/capability status, attempts, atomic claim events, operation receipts, leases, renewals, releases, expiry/reconciliation/reclaim transitions, and fences existed only in removed disposable PostgreSQL containers. No Atlas/live state, resident worker, adapter, model, external effect, successful outbox delivery, terminal effect receipt, host crash, network partition, failover, soak, or production authority was exercised. Transaction rollback and response-loss replay are disposable protocol fixtures, not runtime recovery proof.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```

Independent reviewers `/root/packet_schema` and `/root/packet_assurance` reran the
full PostgreSQL and claim suites, verified request-bound replay, expiry
reconciliation, current authority/capability/fence checks, concurrency, bigint,
retry classification, hashes and asserted cleanup, and both returned `PASS` with
no blockers. Release only declared successors to fresh dependency and authority
evaluation.
