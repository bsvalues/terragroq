# Owner Authority Artifact Contract

**Work Order:** `WO-MAO-003`

**Status:** verifier implemented; no owner grant or status event issued

## Boundary

Only the Owner may issue an authority grant or append a status event. The coordinator, builder,
reviewer, provider adapter, supervisor, and repository code may verify and reference authority but may
not mint, sign, rewrite, extend, reactivate, or revoke it. Repository merge and program completion do
not imply activation.

The verifier is intentionally read-only. It has no signing, issuance, append, dispatch, or activation
API. Production owner artifacts belong in an owner-controlled store outside provider worktrees. The
trusted-owner public-key registry may be readable by the supervisor; private signing keys may not be
stored in the repository or exposed to a coordinator or provider.

The public key is not trusted merely because it appears in a caller-supplied bundle. Every assertion
also requires an independently pinned SHA-256 fingerprint of the owner's DER-encoded SPKI public key.
The entire `OWNER_TRUST_BUNDLE`, including active keys and all current stream heads, is content-hashed
and signed by that pinned key. Every governed caller must also supply the exact current bundle hash
from an independently monotonic owner-controlled anchor; this rejects replay of an older validly signed
bundle. The legacy quarantine reads both pins from its reviewed registry record; they remain null and
therefore fail-closed until the Owner provisions a real key and authorizes the anchors.

## Immutable Grant

An `OWNER_AUTHORITY_GRANT` is canonical JSON with:

- `schemaVersion: 1`, `artifactType`, immutable `grantId`, and `authorityDecisionId`;
- `grantKind`, exactly `ACTION_AUTHORITY` or `PROGRAM_ACTIVATION`;
- owner `issuer` containing `role: OWNER` and `ownerId`;
- one `subject` (`type` and `id`);
- explicit `scope` arrays for program, goal, loop, Work Order, and decision IDs, plus repositories,
  risk classes, actions, and merge modes;
- RFC 3339 `issuedAt` and `expiresAt` instants;
- SHA-256 `contentHash` of canonical JSON excluding `contentHash` and `signature`;
- an Ed25519 `signature` containing `algorithm`, trusted `keyId`, and base64 `value`.

Any field change invalidates the hash or signature. Expiry is exclusive. Wildcards have no special
meaning: scope matching is exact and fail closed. `ACTIVATE_PROGRAM` requires a distinct
`PROGRAM_ACTIVATION` grant, and that grant cannot authorize non-activation actions.

`WILLIAMOS-CANONICAL-JSON-V1` recursively emits JSON primitives without whitespace, preserves array
order, sorts object keys by JavaScript string code-unit order, rejects undefined/non-finite/unsupported
values, and requires timestamps in exact UTC millisecond `YYYY-MM-DDTHH:mm:ss.sssZ` form. The fixed
cross-implementation vector `{"a":"x","b":1}` hashes to
`cdab067e9f3beb32d1252cfd63e492592fecbf591b0d08cadb24bb17f3864246`.

## Append-Only Status Stream

Authority status is a separate array of `OWNER_AUTHORITY_STATUS_EVENT` records. Every event is owner
signed and includes immutable `eventId`, `grantId`, one-based `sequence`, `status`, `issuedAt`,
`previousEventHash`, `contentHash`, and `signature`.

The first event must be `ACTIVE`, sequence 1, with a null previous hash. `ACTIVE` means the grant is
currently valid for assertion; it does not activate a runtime. Each later event links to the
preceding event's content hash. `REVOKED` is terminal; no later event or reactivation is accepted.
Missing, reordered, duplicated, untrusted, mutated, or broken-chain events fail closed. Storage must
enforce append-only owner writes. The owner-controlled trust bundle must also publish the current
`statusHeads` entry (`grantId`, `eventCount`, and `latestEventHash`) atomically with every append. The
verifier compares the supplied stream with that anchor, rejecting stale truncation or rollback as
`AUTHORITY_EVENT_HEAD_WALL`. Events from a different owner, before the grant, out of time order, or
after the assertion instant are rejected.

## Legacy Authority Revocation Stream

Legacy executable registry records that predate immutable grants are terminalized with a separate
`OWNER_LEGACY_AUTHORITY_REVOCATION_EVENT` stream. Each event names exactly one legacy authority record,
the rejected adapter, terminal issue and reason, sequence, previous-event hash, issue time, owner
issuer, content hash, and Ed25519 signature. The externally stored trust bundle anchors the current
stream head in `legacyRevocationHeads`. The verifier requires the exact registry record set and rejects
missing, duplicate, reordered, changed, future-dated, or stale events. A verified legacy revocation can
only corroborate terminal quarantine; it cannot grant or reactivate authority.

## Assertion Gate

`authority-event-cli.mjs validate-artifacts` verifies internal artifact integrity against caller-supplied
anchors and exact scope. A pass emits `OWNER_AUTHORITY_ARTIFACT_VALIDATION=<json>`; it is not an
authority assertion and no governed action may consume it as permission. A future coordinator must
obtain both anchors from the independent owner-controlled monotonic source before converting validation
into an action-specific assertion. Every failure emits only a typed `*_WALL` code on stderr and exits 2.

Example shape, using paths to externally issued artifacts:

```powershell
node scripts/multi-agent-operator/authority-event-cli.mjs validate-artifacts `
  --grant C:\owner-store\grant.json `
  --events C:\owner-store\grant-events.json `
  --trusted-owners C:\owner-store\trusted-owner-keys.json `
  --owner-key-fingerprint <pinned-sha256-spki-fingerprint> `
  --owner-bundle-hash <pinned-current-trust-bundle-content-hash> `
  --owner-counters C:\runtime-evidence\owner-counters.json `
  --subject-type PROGRAM --subject-id PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001 `
  --program PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001 `
  --goal GOAL-WILLIAMOS-MULTI-AGENT-OPERATOR-001 `
  --loop LOOP-WILLIAMOS-MULTI-AGENT-OPERATOR-001 `
  --work-order WO-MAO-003 --decision OWNER-DECISION-MAO-003 `
  --repository bsvalues/terragroq --risk R0 --action VERIFY --merge-mode NONE
```

This example is invocation documentation, not an issued or signed authority artifact.

## Zero-Owner-Operation Certification

Every run must supply exactly these non-negative integer counters:

```text
OWNER_OPERATION_TOUCH_COUNT
OWNER_CREDENTIAL_TOUCH_COUNT
OWNER_DIAGNOSTIC_TOUCH_COUNT
OWNER_ROUTINE_DECISION_COUNT
OWNER_ROUTINE_CONTACT_COUNT
```

No selected record is `NO_OWNER_OPERATION_EVIDENCE`; its counters display as `not recorded`, not zero.
Caller-supplied zero counters are `UNVERIFIED_ZERO_OWNER_OPERATIONS` and never certification. A future
trusted-host verification of an
`OWNER_OPERATION_EVIDENCE` artifact binds the preregistered run and manifest, program, goal, loop, Work
Order, decision when applicable, exact action, complete observation bounds, policy hash, and identical
counter set. Its assurance signature and create-once run commitment must validate through the separately
anchored checkpoint and source-log chains described in `owner-operation-evidence-verifier.md` before
`CERTIFIED_ZERO_OWNER_OPERATIONS` can be emitted.
`FAILED_OWNER_BABYSITTING` is the lifecycle state for any nonzero routine touch, with stable reason
`FAIL_OWNER_BABYSITTING`. `OWNER_ROUTINE_CONTACT_COUNT` includes every status prompt, progress-update
request, confirmation request, or other non-authority contact that interrupts the Owner before the
final outcome. Genuine owner authority decisions are outside routine-operation counts; using the Owner
as courier, diagnostician, credential operator, routine decision-maker, or routine correspondent is not.

The current CLI argument is deliberately named `--owner-counters`: it validates an untrusted counter
record only. It must not be renamed or represented as `--owner-operation-evidence` until an independent,
context-bound evidence verifier is invoked. The separate `owner-operation-evidence-cli.mjs` implements
artifact validation only and returns `certified: false` and `authorityGranted: false`; the trusted source
integration required for certification is not implemented in this phase.

## Integration Contract

This cryptographic contract applies when a Work Order or policy explicitly requires independently
anchored owner artifacts, including final zero-touch certification and future protected actions. For
those actions, the coordinator must obtain current anchors, validate exact subject and scope, create
only a transient assertion, treat exit 2 or malformed output as denial, and never cache validation
across action boundaries.

The active multi-agent program's already-recorded owner decision separately covers bounded R0/R1
repository implementation and normal GitHub lifecycle work. Persisting that decision does not require
William to issue a new signature, pin, key, or activation artifact. This contract cannot retroactively
turn authorized routine work into an owner ceremony; it remains available as defense-in-depth and as a
mandatory verifier only where an active packet explicitly names it.

This slice does not wire a supervisor, dispatch a provider, or create an owner artifact.
