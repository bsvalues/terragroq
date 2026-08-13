# WO-AEH-021 — Common worker protocol

Status: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS / DISPOSABLE_POSTGRESQL_ONLY`.

The protocol core executes a strict RFC 8785/JCS-compatible subset: recursively sorted object keys, UTF-8/NFC strings, safe integers only, closed envelope and binding field sets, and deterministic SHA-256 payload binding. Versioned envelopes use real Ed25519 signatures, bounded base64url signatures, message/operation IDs, nonce, issued/not-before/expiry instants, five-minute maximum lifetime, and thirty-second skew. The keyring rejects unknown, expired, and revoked keys, permits bounded verify-only overlap for retiring keys, prevents duplicate key IDs, and signing accepts only a matching active key.

Public SDK actions accept only the signed envelope, its exact payload bytes, and the configured keyring. They verify cryptography, time, closed schemas, payload digest, and canonical action payload before deriving every database argument and issuing exactly one action query; callers cannot supply a loose key ID or invented envelope digest.

Every envelope binds job, claim, attempt, lease, effect domain/idempotency key, worker/instance/boot, fence, renewal sequence, authority/capability, and input/base/policy/requested-output/config/image/model digests. Output validation binds bytes and digest and bounds byte, token, runtime, artifact-count, and explicit truncation metadata. Durable message receipts bind message, operation, kind, envelope digest, key, authority, and worker identity; exact replay is idempotent after restart and changed semantics conflict. PULL, HEARTBEAT, CANCEL, and CANCEL_ACK each use one database entrypoint that verifies the database-derived effect domain, consumes the signed envelope, and performs the action in the same transaction. Heartbeat takes the effect-domain lock, then locks and revalidates capability and authority during envelope consumption before current-fence proof and exact renewal advancement; rejection rolls back message consumption and lease mutation. It deliberately exposes no settlement method: WO-AEH-017 effect receipts, WO-AEH-018 descriptors, and WO-AEH-019 reconciliation remain the only terminal-truth path.

Migration 0007 adds immutable coordinator cancellation intents and worker acknowledgements. Requests are authority-, projection-version-, attempt-, fence-, reason-, TTL-, and operation-digest-bound. Acknowledgements require the current holder/instance/boot/fence/renewal sequence and a digest-matched `RECOVERY_OBSERVATION`; they release the lease, append evidence-chain events, and move the projection only to `RECONCILING`. They never classify terminal execution. Exact reconnect replay returns the same durable record and changed semantics fail closed.

Eight focused native/disposable tests pass twice and the grouped execution-control aggregate is 39/39 (8 WO021 plus 31 accepted control-plane tests). Every enveloped operation locks effect-domain advisory, then capability, then authority before projection or domain mutation. Tests execute all four enveloped entrypoints, reject mismatched signed domains before receipt or action, deny direct unprivileged execution of inner envelope/cancellation functions, exercise replay conflicts and heartbeat revocation zero-mutation races, prove response-loss one-renewal replay, and serialize cross-domain HEARTBEAT-versus-PULL plus CANCEL and reverse ACK paths with zero `40P01` deadlocks. No network, live database, worker, external effect, dependency install, service mutation, or issue #357 path was used. Cached PostgreSQL startup can transiently fail on the local Docker engine; passing runs used fresh disposable containers and cleanup was verified.

Rollback is pre-use/disposable only and removes 0007 functions and ledgers in reverse dependency order. After durable cancellation records exist, use reviewed forward repair or restore.

Non-proof: repository and disposable PostgreSQL tests do not prove production key custody, HSM operation, live worker transport, external cancellation, failover, or production concurrency.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```

## Independent review closure

- Reviewer: `/root/packet_assurance` (independent of the final builder lane)
- Verdict: `PASS`; zero unresolved semantic blockers
- Revalidation: focused protocol and lock/runtime fixtures passed; the affected cached-PostgreSQL fixture passed `6/6` when rerun independently after a known local Docker startup race
- Integrity: all eight recorded artifact hashes matched; scoped diff and disposable cleanup checks passed
- Concurrency and authority: domain → capability → authority → projection/control ordering, signed-domain equality, cross-domain serialization, reverse races, replay, and permission walls were independently verified
- Boundary: internal envelope/cancellation functions are not executable by `PUBLIC`; public wrappers use fixed safe search paths and mandatory verified signed inputs
- Evidence limit: this verifies repository/disposable protocol behavior only, not production key custody, live worker transport, external effects, or production authorization.
