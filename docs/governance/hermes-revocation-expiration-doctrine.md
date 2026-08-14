# Hermes Revocation and Expiration Doctrine

> **Supersession note.** "Hermes" in this document is the governed in-app *sidecar / worker-boundary
> concept* and its state model. The physical **HERMES coordinator node** and the resident
> **Hermes→AEGIS ExecutionBackend (PR #754)** are OPERATING, governed by
> [`sovereign-runtime-and-review-supersession.md`](sovereign-runtime-and-review-supersession.md).
> Read "disabled by default / not active / future worker" below as the safety posture of this bounded
> lane — not as the status of the operating runtime.


Any future Hermes authorization must be bounded, expiring, and revocable.

## Rules

- Authorizations are bounded by Work Order.
- Authorizations expire.
- The Owner can revoke authorization at any time.
- Failed validation revokes or blocks.
- Scope drift revokes or blocks.
- Secret exposure risk revokes or blocks.
- Production incident risk revokes or blocks.
- Missing evidence blocks continuation.
- Revoked Hermes cannot continue.
- Revoked Hermes must return evidence and stop.

## Required Future Packet Fields

- Expiration condition
- Revocation trigger
- Stop conditions
- Evidence return requirement
- Rollback or disable plan
- Owner decision record

This lane adds no runtime revocation, scheduler, persistent authorization store, background worker, or activation mechanism.

