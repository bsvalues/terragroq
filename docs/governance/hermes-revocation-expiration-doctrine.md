# Hermes Revocation and Expiration Doctrine

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

