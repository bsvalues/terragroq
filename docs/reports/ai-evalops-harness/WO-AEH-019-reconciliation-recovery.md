# WO-AEH-019 — Reconciliation and recovery

Status: `COMPLETE / RECOVERY_CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS / DISPOSABLE_POSTGRESQL_ONLY`.

Historical settlement descriptors are reconstructed from PostgreSQL without requiring a current lease. Reconciliation is receipt-first and request-digested, locks the current `RECONCILING` projection, binds its attempt and expected version, then atomically writes a digest-chained evidence event, immutable receipt, and projection transition. `NOT_EXECUTED` alone returns `RETRY_SAFE` and re-admits; `AMBIGUOUS` remains reconciling and blocked; `EXECUTED`, `EXPIRED`, and `FENCED` become typed terminal states. Exact replay is durable and changed semantics conflict.

The concurrency order is effect-domain transaction advisory lock, capability row, authority row, projection row, lease/fence rows, and stable-order outbox/effect rows. WO-AEH-017 dispatch mutation and WO-AEH-021 enveloped actions share the effect-domain lock before projection or control-row mutation. Disposable two-session tests prove dispatch blocks `NOT_EXECUTED` until durable state is visible, authority/capability changes serialize, exact concurrent operations replay once, and conflicting semantics are rejected.

Recovery observations are required for retry-safe/ambiguous decisions; terminal classifications require terminal receipts. Native and cached PostgreSQL validation applies migrations 0000–0006. No process-local map, external effect, network, live database, adapter, worker, or #357 path was used. Crash/failover and production recovery remain non-proof.

Rollback is disposable/pre-use only; after durable receipts use reviewed forward repair or restore.

## Independent review closure

- Reviewer: `/root/packet_assurance` (independent of the final builder lane)
- Verdict: `PASS`; zero unresolved blocking findings
- Revalidation: focused suite `2/2 PASS`; serialized combined execution-control suite `31/31 PASS`
- Integrity: all seven recorded artifact hashes matched; scoped diff and disposable cleanup checks passed
- Concurrency: shared effect-domain serialization and deterministic row-lock ordering closed dispatch, authority-revocation, and capability-staleness races without an observed lock cycle
- Recovery: all five outcomes and replay, conflict, evidence-digest, stale-CAS, response-loss, cross-ledger, and atomicity cases were practically exercised
- Evidence limit: this verifies the disposable recovery contract only. It does not establish a live adapter, external effect, production outage recovery, or production authorization.
