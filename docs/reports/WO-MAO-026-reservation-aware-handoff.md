# WO-MAO-026 Reservation-Aware Handoff

**Work Order:** `WO-MAO-026`

**Status:** `COMPLETE / DURABLE_ONE_WRITER_HANDOFF_PROVEN`

**Risk:** `R3`

**Depends on:** `WO-MAO-018`, `WO-MAO-024`, and `WO-MAO-025`

## Outcome

WilliamOS now has a deterministic, durable, fail-closed handoff contract for transferring work
between builder, reviewer, remediator, and verifier roles. The contract binds every transition to
the exact repository, branch, isolated workspace, active reservation, active lease, checkpoint head,
role assignment, evidence identity, sequence number, and idempotency key.

The reservation and lease remain held by the original builder throughout the handoff chain. Reviewer
and verifier custody is read-only. A remediation transition returns write custody only to that same
builder, so the contract cannot create a second writer or silently release an unsafe reservation.

## Handoff boundary

Allowed transitions are builder to reviewer or verifier, reviewer to the original builder acting as
remediator, remediator back to reviewer, and reviewer to verifier. Distinct reviewer and verifier
assignments are required. Foreign reservation holders, foreign lease workers, dirty workspaces,
checkpoint drift, invalid role transitions, released fences, malformed state, stale sequences,
duplicate identities, and authority-shaped input fail closed.

Apply requires an exact host-injected binding verifier. The concrete host verifier reads the existing
WO-MAO-018 reservation ledger and WO-MAO-021 lease/checkpoint store, checks lease expiry, inspects the
live clean Git workspace, branch, commit, and GitHub repository, and confines the canonical handoff
store to its approved state root. Accepted transitions are persisted with a compare-and-swap sequence,
fsynced replacement, strict history validation, and idempotent replay result. The CLI can plan or
inspect directly, but it cannot apply a handoff without the trusted host verifier.

## Execution and authority boundary

The contract does not:

- release a reservation or lease;
- create a second writer or move remediation to another worker;
- mutate Git, a workspace, a provider, GitHub, production, or protected data;
- dispatch a worker, activate a runtime, retry the rejected local adapter, or start a background service;
- grant, mint, expand, or infer authority;
- inspect, store, or transmit credentials or secrets.

Every result keeps `reservationReleased=false`, `leaseReleased=false`,
`secondWriterEnabled=false`, `authorityGranted=false`, and `ownerOperationsRequired=false`.

## Mechanical proof

Focused tests cover deterministic planning, the complete builder/reviewer/remediator/reviewer/verifier
chain with a monotonic remediation checkpoint, idempotent replay, stale compare-and-swap rejection,
concrete live reservation/lease/Git/state-root integration, reservation and lease fences, dirty and
drifted workspace rejection, second-writer prevention, invalid transitions, persisted one-writer state,
strict schemas, corrupted or authority-shaped durable state, and typed CLI behavior.

The executable registry edits in the feature branch are the proposed post-merge projection. They do
not change `main` or release WO-MAO-027 until this reviewed commit is merged.

## Next transition

`WO-MAO-001` through `WO-MAO-026`, `WO-MAO-029`, and `WO-MAO-032` are complete.
`WO-MAO-033` remains `DEFERRED / PROVIDER_UNAVAILABLE`. The only newly dependency-cleared Work Order
is `WO-MAO-027 - Concurrency budgets, priority, and fairness`.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
