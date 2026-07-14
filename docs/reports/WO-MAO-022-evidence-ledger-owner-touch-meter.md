# WO-MAO-022 — Evidence ledger and owner-touch meter

**Status:** COMPLETE

**Scope:** local machine contract only

**Authority effect:** none (`authorityGranted=false`)

## Outcome

WilliamOS now has a true append-only evidence ledger. A ledger is an immutable manifest plus one
atomically materialized file per event. Existing event files are never rewritten. Every event has a
caller-stable UUID, writer and active lane-lease attribution, exact Work Order/lane scope, a canonical
request digest, a previous-event hash, and its own SHA-256 content hash.

The contract covers all thirteen required evidence classes: authority, worker, provider, reservation,
lifecycle transition, test, commit, PR, review, merge, cleanup, failure, and owner contact. Each class
has an exact bounded schema; the ledger accepts hashes and structured projections rather than raw
provider output, logs, test output, diffs, credentials, or authority artifacts.

Delivered files:

- `scripts/multi-agent-operator/evidence-ledger.mjs`
- `scripts/multi-agent-operator/evidence-ledger-cli.mjs`
- `tests/multi-agent-evidence-ledger.test.ts`
- `docs/reports/WO-MAO-022-evidence-ledger-owner-touch-meter.md`

## Integrity and concurrency

A bounded cross-process directory lock serializes appenders. A live same-host holder is never broken;
an abandoned lock may be recovered only after its stale interval, exact owner schema and hostname
validate, and its valid PID is confirmed dead. Malformed, foreign-host, or unverifiable owners fail
closed. The quarantined stale directory is removed before lock acquisition continues. The manifest and every
event are written to a same-filesystem mode-`0600` temporary file, file-synced, materialized with an
atomic no-clobber link, and followed by directory syncs. Two real child processes can append
concurrently without loss or overwrite.

Every append first verifies the complete committed chain. Verification rejects manifest mutation,
unknown or missing fields, malformed JSON, unexpected filenames, sequence gaps, duplicate or renamed
event IDs, link mismatch, request-digest mismatch, owner-counter forgery, payload/writer mutation, and
event-hash mismatch. There is no repair, truncate, delete, or overwrite API.

Hash chaining alone cannot prove that a final suffix was not deleted. Every append therefore returns
an exact external head anchor. Independent verification may require that anchor and fails with
`EVIDENCE_LEDGER_ANCHOR_WALL` if the current count or head differs. Unanchored verification remains
explicitly `independentlyAnchored=false` and `certified=false`.

## WO-MAO-021 binding

Before a new event is committed, the ledger reads the WO-MAO-021 lane store and requires an active,
unexpired lease whose store, Work Order, lane, worker, fence, checkpoint sequence, and checkpoint
evidence hash exactly match the event. Raw holder material is neither accepted nor persisted.

The integration proof appends an event, persists its four-field evidence anchor through a durable
WO-MAO-021 checkpoint, then appends the next event against the new checkpoint sequence and evidence
hash. Lease inspection is read-only and occurs without taking the lease writer lock, so the evidence
lock never creates a cross-ledger lock cycle.

## Sanitization and owner meter

Input must assert sanitized structured evidence and explicitly deny raw authentication material and
raw provider output. Exact schemas and recursive checks reject sensitive key aliases, bearer/basic
material, private-key blocks, common provider-token shapes, JWTs, credential assignments, control
characters, traversal paths, excessive depth/items, and secret-shaped identifiers. Typed wall results
never echo the rejected value or attacker-controlled key name; unknown keys are represented only by a
stable digest. After lease inspection, every string key and value that would be persisted—including
the manifest, event and canonical lowercase event filename—is SHA-256 compared in constant time with
every persisted lease-holder digest. A match fails before persistence.

Owner counters are not accepted from callers. `OWNER_CONTACT` events distinguish a complete genuine
WO-MAO-020 authority gap from prohibited routine contact. Genuine authority decisions contribute
zero. Prohibited contact derives the applicable operation, credential, diagnostic, routine-decision,
and routine-contact deltas; routine contact is added mechanically. The meter re-verifies the chain,
recomputes every delta, sums the five canonical uppercase counters, and uses the existing authority
evaluator. Any nonzero counter produces `FAILED_OWNER_BABYSITTING / FAIL_OWNER_BABYSITTING`; a zero
result remains `UNVERIFIED_ZERO_OWNER_OPERATIONS` and cannot certify itself.

## Boundary retained

This Work Order performs no provider dispatch, network request, GitHub action, reservation mutation,
lease mutation, lifecycle transition, runtime activation, authority grant, evidence certification, or
owner contact. Recorded projections do not make their source claims true; later schedulers must supply
the validated source result and preserve the returned head anchor in durable checkpoints.

## Validation

- focused Vitest: `1` file and `19` tests passed;
- complete multi-agent contract suite: `14` files and `228` tests passed;
- real two-process append race: passed with two committed consecutive events;
- Node syntax checks: passed for both executable modules;
- adversarial coverage: all event types, exact schemas, ID reuse, head CAS, live/stale locks, chain
  tamper, gaps, filename mutation, suffix truncation, external anchors, lease mismatch/expiry, nested
  secret values, path traversal, all five owner counters, genuine authority distinction, WO-MAO-021
  checkpoint integration, and CLI exits;
- scoped executable-module lint, Node syntax checks, and `git diff --check`: passed.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
