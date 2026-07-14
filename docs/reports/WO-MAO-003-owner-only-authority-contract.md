# WO-MAO-003 Owner-Only Authority Contract

## Result

`BLOCKED_TRUSTED_SOURCE_INTEGRATION / ARTIFACT_VALIDATOR_IMPLEMENTED / NO_AUTHORITY_ISSUED`

## Delivered

- Verifier-only immutable owner-grant validation with exact subject and scope matching.
- Ed25519 issuer verification and canonical SHA-256 content hashing.
- Separate append-only, hash-chained, owner-signed status and revocation verification.
- Direct terminal-revocation verification for executable records that predate immutable grants.
- Fail-closed expiry, trust, chain, scope, and current-revocation assertions.
- Supervisor-consumable CLI with typed authority walls and exit code 2.
- Four-counter zero-owner-operation schema with proposed context and evidence-head fields.
- Canonical `FAILED_OWNER_BABYSITTING` lifecycle state and `FAIL_OWNER_BABYSITTING` reason-code split.
- Work Order template authority references and owner-touch evidence fields.
- Shared read-only owner-operation model across goals, loops, Work Orders, stop packets, completion
  reports, Evidence, Authority, and visible UI surfaces.
- `NO_OWNER_OPERATION_EVIDENCE` and `not recorded` counters on unbound surfaces.
- `UNVERIFIED_ZERO_OWNER_OPERATIONS` for record-bound caller-supplied zeros; no certification path from
  untrusted counters.
- Purpose-restricted assurance recorder and checkpoint-key trust records inside the owner-signed bundle.
- Signed terminal evidence with exact run/context, observation bounds, policy hash, and counters.
- Complete hash-chained assurance checkpoints with create-once run commitments and a separately pinned
  current head.
- A validator-only CLI that checks proposed evidence/checkpoint artifacts while always returning
  `certified: false` and `authorityGranted: false`.

## Boundary Evidence

- No signing or issuance API was added.
- No owner-signed grant or event was created or represented as created.
- No provider dispatch, GitHub write, runtime activation, credential handling, or production mutation
  was added.
- The coordinator remains unable to mint, mutate, extend, revoke, or reactivate authority through this
  implementation.

## Remaining acceptance gate

WO-MAO-003 is not complete. The standalone validator receives every path and pin from its caller, so it
cannot establish independent sourcing. It also validates a recorder's completeness assertion without
yet verifying the source event chain through an independently anchored authoritative run boundary. A
trusted host must source the run registry, owner trust pins, assurance checkpoint head, and source-log
head from their separate protected stores and perform that source-chain verification before any
`CERTIFIED_ZERO_OWNER_OPERATIONS` result exists. No live evidence, key, pin, anchor, or authority
artifact has been issued. Before WO-MAO-005 may activate the successor, the Owner must independently
provision the owner trust anchor and issue the scoped program-activation artifact.

## Integration

`authority-event-cli.mjs validate-artifacts` performs integrity and scope validation only. Its
`OWNER_AUTHORITY_ARTIFACT_VALIDATION` output does not authorize an action. The future coordinator must
source the key fingerprint and current trust-bundle hash from an independent monotonic owner anchor
before producing a transient action assertion. That integration remains incomplete. The legacy adapter separately invokes
`assert-legacy-revocations`; its pass can only confirm terminal revocation and never permit dispatch.
The proposed post-run artifact protocol is documented in
`docs/governance/owner-operation-evidence-verifier.md`; the current CLI validates but does not certify.

## Validation

Focused tests cover valid authority, mutation, untrusted issuer, scope mismatch, expiry, revocation,
event-chain tampering, owner-touch disqualification, and typed CLI failure. Full validation results are
reported with the commit evidence. Test signatures use ephemeral fixture-only keys and identities; they
are not owner artifacts and confer no authority.
