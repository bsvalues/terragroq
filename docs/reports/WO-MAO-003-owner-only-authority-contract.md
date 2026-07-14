# WO-MAO-003 Owner-Only Authority Contract

## Result

`BLOCKED_CROSS_SURFACE_BINDING / VERIFIER_IMPLEMENTED / NO_AUTHORITY_ISSUED`

## Delivered

- Verifier-only immutable owner-grant validation with exact subject and scope matching.
- Ed25519 issuer verification and canonical SHA-256 content hashing.
- Separate append-only, hash-chained, owner-signed status and revocation verification.
- Direct terminal-revocation verification for executable records that predate immutable grants.
- Fail-closed expiry, trust, chain, scope, and current-revocation assertions.
- Supervisor-consumable CLI with typed authority walls and exit code 2.
- Four-counter zero-owner-operation schema and fail-closed value validation.
- Canonical `FAILED_OWNER_BABYSITTING` lifecycle state and `FAIL_OWNER_BABYSITTING` reason-code split.
- Work Order template authority references and owner-touch evidence fields.

## Boundary Evidence

- No signing or issuance API was added.
- No owner-signed grant or event was created or represented as created.
- No provider dispatch, GitHub write, runtime activation, credential handling, or production mutation
  was added.
- The coordinator remains unable to mint, mutate, extend, revoke, or reactivate authority through this
  implementation.

## Remaining acceptance gate

WO-MAO-003 is not complete. Caller-supplied zero counters are structural inputs, not independent audit
evidence, and the new multi-agent coordinator does not yet exist to enforce assertions before every
lease, provider call, GitHub write, merge, release, or activation. The counters must be bound across
goals, loops, Work Orders, stop packets, UI, and the durable evidence chain before this WO may pass.

## Integration

`authority-event-cli.mjs validate-artifacts` performs integrity and scope validation only. Its
`OWNER_AUTHORITY_ARTIFACT_VALIDATION` output does not authorize an action. The future coordinator must
source the key fingerprint and current trust-bundle hash from an independent monotonic owner anchor
before producing a transient action assertion. That integration remains incomplete. The legacy adapter separately invokes
`assert-legacy-revocations`; its pass can only confirm terminal revocation and never permit dispatch.

## Validation

Focused tests cover valid authority, mutation, untrusted issuer, scope mismatch, expiry, revocation,
event-chain tampering, owner-touch disqualification, and typed CLI failure. Full validation results are
reported with the commit evidence. Test signatures use ephemeral fixture-only keys and identities; they
are not owner artifacts and confer no authority.
