# WO-MAO-021 — Per-lane leases and checkpoints

**Work Order:** `WO-MAO-021`

**Program:** `PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001`

**Status:** `COMPLETE / LOCAL CONTRACT PROVEN / NON-DISPATCHING`

**Risk class:** `R3`

**Dependencies represented:** `WO-MAO-017` through `WO-MAO-020`

## Outcome

The serial/global checkpoint assumption has been replaced by a local atomic store keyed by the exact
`(workOrderId, laneId)` pair. Independent lanes can hold independent leases. Each lease records a
non-secret `workerId`, a SHA-256 holder-token digest, a monotonically increasing fencing token, an
expiry, renewal and heartbeat timestamps, and a durable lifecycle checkpoint.

This implementation is a control-plane contract only. It does not invoke a provider, dispatch work,
call a network, operate GitHub, start a runtime, or grant authority.

## Artifacts

- `scripts/multi-agent-operator/lane-lease-checkpoint.mjs`
- `scripts/multi-agent-operator/lane-lease-checkpoint-cli.mjs`
- `tests/multi-agent-lane-lease-checkpoint.test.ts`
- `docs/reports/WO-MAO-021-per-lane-leases-checkpoints.md`

The module exports:

- `acquireLaneLease`
- `reclaimLaneLease`
- `renewLaneLease`
- `heartbeatLaneLease`
- `checkpointLaneLease`
- `releaseLaneLease`
- `expireLaneLease`
- `inspectLaneLeaseStore`
- `LaneLeaseCheckpointError`

The CLI exposes the corresponding `acquire`, `reclaim`, `renew`, `heartbeat`, `checkpoint`,
`release`, `expire`, and `inspect` local-file operations.

## Mechanical contract

The strict v1 store contains only:

```text
schemaVersion, artifactType, storeId, version, nextFencingToken, updatedAt,
lanes, operations, localContractOnly=true, authorityGranted=false
```

Every lane contains an exact work-order ID, lane ID, worker ID, generation, status, holder digest,
fencing token, lease timestamps, and checkpoint. Lease status is exactly `ACTIVE`, `RELEASED`, or
`EXPIRED`. Every checkpoint contains exactly a compare-and-swap sequence, canonical lifecycle state,
recorded timestamp, and sanitized JSON evidence.

Every mutation requires a unique idempotency key and is journaled with its operation type, canonical
request digest, writer `workerId`, work-order/lane scope, committed store version, fencing token,
result status, timestamp, resulting checkpoint lifecycle state, checkpoint timestamp, and checkpoint evidence hash.
Checkpoint operations additionally journal the exact validated lifecycle transition. Repeating the
exact request is an idempotent success; reusing its key for different input walls with
`IDEMPOTENCY_KEY_REUSE_WALL`.

## Safety and recovery properties

- Store changes occur under an atomic lock directory. A lock owned by a live local process is never
  stolen. An old lock from a confirmed-dead local process or malformed abandoned lock is renamed and
  removed before recovery.
- Writes use a mode-0600 exclusive temporary file, file `fsync`, atomic rename, and directory
  `fsync`. A store ID is validated before any directory or file is created, and every complete
  candidate store is revalidated before the temporary file is renamed. Readers validate the exact
  durable schema before use.
- Mutation clocks must be finite safe integers, inside the supported ISO range, and not earlier than
  the store's last committed operation. Durable operation times are nondecreasing; the last operation
  timestamp must equal `updatedAt`, and lane timestamps cannot be ahead of the store.
- `expectedVersion`, expected expiry, expected heartbeat, expected checkpoint sequence, holder
  digest, worker ID, and fencing token provide compare-and-swap boundaries appropriate to each
  operation.
- Renewal and heartbeat fail after expiry. A renewal must strictly extend the previously committed
  expiry. Reclaim is legal only from `EXPIRED` after a matching expiry journal event was durably
  committed; an elapsed `ACTIVE` lease cannot be reclaimed directly. Reclaim requires the prior
  fence and issues a strictly higher fence, so a stale holder cannot mutate the new generation.
- Reclaim preserves the prior durable lifecycle checkpoint; it does not erase progress or silently
  restart the Work Order. A terminal checkpoint cannot be reclaimed or changed.
- Checkpoint writes call the WO-MAO-020 lifecycle validator. Illegal jumps, stale state/sequence,
  and transitions out of terminal states are typed walls.
- Evidence accepts bounded plain JSON, including an evidence-ledger anchor such as
  `{evidenceLedgerId,eventCount,headEventHash,manifestHash}`. If any anchor field appears, all four
  fields and no others are required; the count is positive and both hashes are exact lowercase
  SHA-256 values. Secret-shaped keys and values, API/access/signing/encryption keys, bearer/basic/JWT
  material, private keys, residual assignments under otherwise-safe keys (including short forms such
  as `password=abc` and `token=x`), NULs, excessive depth, oversized payloads, and the exact current
  holder token even when embedded in another string are rejected before durable persistence. Holder
  and lease-holder key aliases are sensitive. During reclaim, every evidence string is also hashed
  and compared in constant time with all currently persisted lane holder digests, including the prior
  holder; equality is rejected before the recovery event can be written.
- Raw holder tokens are never written. Inspection returns only non-secret worker attribution,
  holder digest, fence, lease timing, state, sequence, and sanitized evidence.
- The append-only operation journal is structurally tied to the store: `operations.length` equals
  `version`, versions are contiguous, operation/status pairs are exact, fence issuance is contiguous,
  and replay must reproduce each lane's worker, generation, status, fence, timestamps, and checkpoint
  sequence, lifecycle state, and evidence hash. An acquisition must begin at `LEASED`; every
  checkpoint transition is revalidated during replay. The initial checkpoint timestamp must equal the
  acquisition event timestamp, a changed checkpoint timestamp must equal its checkpoint event, and
  all other operations must preserve it. Contradictory durable state is rejected before use or write.
- Reclaim preserves the lane's prior lifecycle checkpoint and also writes the sanitized recovery
  evidence plus its canonical SHA-256 hash to the reclaim operation. Inspection exposes these
  non-secret recovery events, and validation independently recomputes the recovery-evidence hash.

## Validation evidence

The focused suite mechanically covers:

- independent per-lane acquisition and monotonically increasing fences;
- raw-holder-token non-persistence;
- acquire and mutation idempotency plus key-reuse rejection;
- version, expiry, heartbeat, holder, worker, fence, and checkpoint compare-and-swap walls;
- renewal, heartbeat, explicit release, expiry, reclaim, and stale-holder rejection;
- fake-clock expiry boundaries;
- invalid, nonfinite, and backward clock walls plus non-monotonic durable timestamp rejection;
- direct reclaim refusal until a matching durable expiry event exists;
- strict renewal-extension enforcement;
- canonical lifecycle binding and terminal immutability;
- exact evidence-anchor validation, current-holder-token leak rejection, hardened secret sanitizer,
  residual-assignment rejection under safe keys, and corrupt-store walls;
- operation-count gaps, noncontiguous versions, wrong status/worker/generation, and timestamp
  contradiction walls;
- lifecycle/evidence journal binding, including rejection when both an acquisition operation and its
  lane are tampered from `LEASED` to `MERGE_ELIGIBLE`;
- reclaim recovery-evidence persistence, inspection, exact hash verification, and tamper rejection;
- prior-holder-token rejection under a safe recovery-evidence key by digest comparison;
- acquisition and later-checkpoint timestamp binding, including exact `1000 -> 500` and
  `1050 -> 1025` durable-tamper reproductions;
- abandoned-lock recovery and live-lock refusal;
- eight concurrent OS processes racing for one lane, with exactly one acquisition committed;
- deterministic local-only CLI success and typed failure behavior;
- all five owner-operation counters remaining zero on both success and failure results.

Validation commands:

```text
vitest run tests/multi-agent-lane-lease-checkpoint.test.ts
vitest run tests/multi-agent-*.test.ts
eslint scripts/multi-agent-operator/lane-lease-checkpoint.mjs scripts/multi-agent-operator/lane-lease-checkpoint-cli.mjs tests/multi-agent-lane-lease-checkpoint.test.ts
node --check scripts/multi-agent-operator/lane-lease-checkpoint.mjs
node --check scripts/multi-agent-operator/lane-lease-checkpoint-cli.mjs
git diff --check
```

## Owner boundary and non-claims

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
PROVIDER_DISPATCH_PERFORMED=false
NETWORK_CALL_PERFORMED=false
AUTHORITY_GRANTED=false
RAW_AUTH_OR_HOLDER_TOKEN_PERSISTED=false
```

WO-MAO-021 proves the local lease/checkpoint primitive. It does not claim that the Phase 2 evidence
ledger, scheduler, workspace manager, provider execution, GitHub delivery, or unattended
certification already exists.
