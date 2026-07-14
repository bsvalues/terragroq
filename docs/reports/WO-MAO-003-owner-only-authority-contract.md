# WO-MAO-003 Owner-Only Authority Contract

## Result

`PASS_IMPLEMENTATION / NO_AUTHORITY_ISSUED / EXECUTION_DISABLED`

## Delivered

- Verifier-only immutable owner-grant validation with exact subject and scope matching.
- Ed25519 issuer verification and canonical SHA-256 content hashing.
- Separate append-only, hash-chained, owner-signed status and revocation verification.
- Fail-closed expiry, trust, chain, scope, and current-revocation assertions.
- Supervisor-consumable CLI with typed authority walls and exit code 2.
- Binding four-counter zero-owner-operation certification.
- Canonical `FAILED_OWNER_BABYSITTING` lifecycle state and `FAIL_OWNER_BABYSITTING` reason-code split.
- Work Order template authority references and owner-touch evidence fields.

## Boundary Evidence

- No signing or issuance API was added.
- No owner-signed grant or event was created or represented as created.
- No provider dispatch, GitHub write, runtime activation, credential handling, or production mutation
  was added.
- The coordinator remains unable to mint, mutate, extend, revoke, or reactivate authority through this
  implementation.

## Integration

The Windows supervisor may invoke `authority-event-cli.mjs assert` immediately before each governed
action. Only a well-formed `OWNER_AUTHORITY_ASSERTION` pass line permits the caller to continue. Exit 2,
missing output, malformed input, or any typed wall must stop the action. Supervisor wiring is outside
this Work Order's assigned file scope.

## Validation

Focused tests cover valid authority, mutation, untrusted issuer, scope mismatch, expiry, revocation,
event-chain tampering, owner-touch disqualification, and typed CLI failure. Full validation results are
reported with the commit evidence. Test signatures use ephemeral fixture-only keys and identities; they
are not owner artifacts and confer no authority.
