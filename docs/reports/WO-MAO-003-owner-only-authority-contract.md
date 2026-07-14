# WO-MAO-003 Owner-Only Authority Contract

## Result

`COMPLETE / OWNER_ONLY_CONSTITUTION_RATIFIED / FINAL_CERTIFICATION_PENDING`

## Delivered

- Verifier-only immutable owner-grant validation with exact subject and scope matching.
- Ed25519 issuer verification and canonical SHA-256 content hashing.
- Separate append-only, hash-chained, owner-signed status and revocation verification.
- Direct terminal-revocation verification for executable records that predate immutable grants.
- Fail-closed expiry, trust, chain, scope, and current-revocation assertions.
- Supervisor-consumable CLI with typed authority walls and exit code 2.
- Five-counter zero-owner-operation/contact schema with proposed context and evidence-head fields.
- `OWNER_ROUTINE_CONTACT_COUNT` requirement and final-only communication contract.
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

## Certification boundary

WO-MAO-003 ratifies the operating contract and records the owner's already-issued program decision.
It does not claim the independent evidence-chain proof required by WO-MAO-060 and WO-MAO-061.
Cryptographic pins, signed events, and trusted-store integration remain defense-in-depth for final
certification; they are not a new signing chore or a prerequisite for authorized R0/R1 repository work.

## Integration

`authority-event-cli.mjs validate-artifacts` performs integrity and scope validation only. Its
`OWNER_AUTHORITY_ARTIFACT_VALIDATION` output does not create or expand authority. The future
certification coordinator must source independent evidence anchors before claiming
`CERTIFIED_ZERO_OWNER_OPERATIONS`. The legacy adapter separately invokes
`assert-legacy-revocations`; its pass can only confirm terminal revocation and never permit dispatch.
The proposed post-run artifact protocol is documented in
`docs/governance/owner-operation-evidence-verifier.md`; the current CLI validates but does not certify.

## Validation

Focused tests cover valid authority, mutation, untrusted issuer, scope mismatch, expiry, revocation,
event-chain tampering, owner-touch disqualification, and typed CLI failure. Full validation results are
reported with the commit evidence. Test signatures use ephemeral fixture-only keys and identities; they
are not owner artifacts and confer no authority.

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
