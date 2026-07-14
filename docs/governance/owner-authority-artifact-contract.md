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

## Immutable Grant

An `OWNER_AUTHORITY_GRANT` is canonical JSON with:

- `schemaVersion: 1`, `artifactType`, immutable `grantId`, and `authorityDecisionId`;
- `grantKind`, exactly `ACTION_AUTHORITY` or `PROGRAM_ACTIVATION`;
- owner `issuer` containing `role: OWNER` and `ownerId`;
- one `subject` (`type` and `id`);
- explicit `scope` arrays for program IDs, repositories, risk classes, actions, and merge modes;
- RFC 3339 `issuedAt` and `expiresAt` instants;
- SHA-256 `contentHash` of canonical JSON excluding `contentHash` and `signature`;
- an Ed25519 `signature` containing `algorithm`, trusted `keyId`, and base64 `value`.

Any field change invalidates the hash or signature. Expiry is exclusive. Wildcards have no special
meaning: scope matching is exact and fail closed. `ACTIVATE_PROGRAM` requires a distinct
`PROGRAM_ACTIVATION` grant, and that grant cannot authorize non-activation actions.

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

## Assertion Gate

`authority-event-cli.mjs assert` verifies issuer trust, subject, exact scope, issue/expiry time, grant
hash/signature, every status-event hash/signature/link, current revocation state, and owner-operation
counters. A pass emits one sanitized `OWNER_AUTHORITY_ASSERTION=<json>` line. Every failure emits only
a typed `*_WALL` code on stderr and exits 2, suitable for a Windows supervisor owner-authority stop.

Example shape, using paths to externally issued artifacts:

```powershell
node scripts/multi-agent-operator/authority-event-cli.mjs assert `
  --grant C:\owner-store\grant.json `
  --events C:\owner-store\grant-events.json `
  --trusted-owners C:\owner-store\trusted-owner-keys.json `
  --owner-counters C:\runtime-evidence\owner-counters.json `
  --subject-type PROGRAM --subject-id PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001 `
  --program PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001 `
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
```

Certification requires all four to be zero. `FAILED_OWNER_BABYSITTING` is the lifecycle state recorded
for a disqualified run. `FAIL_OWNER_BABYSITTING` is its stable reason code; reason codes are not
lifecycle states. The verifier surfaces a nonzero counter as `OWNER_BABYSITTING_WALL` and never treats
an owner operation as successful evidence.

## Integration Contract

Before lease, provider dispatch, GitHub write, merge, dependent release, or program activation, the
supervisor must invoke the assertion with the exact contemplated subject and scope. It must treat exit
2 or missing/malformed pass output as terminal authority denial. Callers must never cache a pass beyond
the action boundary because expiry or a newly appended revocation can change current authority.

This slice does not wire a supervisor, dispatch a provider, activate a program, or create an owner
artifact.
