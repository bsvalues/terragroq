# WO-MAO-032 — Claude capability and transport proof

**Status:** `COMPLETE_PROVIDER_ASSESSMENT / PROVIDER_UNAVAILABLE`

**Lifecycle:** `DEFERRED` with `DEFER_AFFECTED_LANE_CONTINUE_HEALTHY_PROVIDERS`

**Owner decision required:** `false`

## Outcome

The deterministic repository assessment finds no independently evidenced, authenticated, supported
Claude Code transport or conformant service adapter. Claude therefore remains disabled,
`maxConcurrency=0`, and `serviceCompatible=false`. Its preventive trust gate is
`NOT_EVALUATED_NO_TRANSPORT`; absence of transport is not a passed or failed trust gate.

WO-MAO-032 is complete as an assessment only. It does not claim provider execution or transport
proof. WO-MAO-033 remains `DEFERRED / PROVIDER_UNAVAILABLE`, resumable if an independently supported
transport later exists, and is never represented as complete without execution. Healthy Codex lanes
remain `ELIGIBLE_UNAFFECTED`.

The exact machine projection is implemented by
`scripts/multi-agent-operator/claude-provider-assessment.mjs`. Its deterministic SHA-256 content hash
covers the static claims, including the complete-assessment status, unavailable disposition,
zero-capacity provider posture, lifecycle outcome, healthy-provider continuation, prohibited-action
assertions, and five zero owner-operation counters.

## Provider-optional dependency correction

WO-MAO-034 through WO-MAO-036 must not deadlock solely because an optional provider is unavailable,
but they also must not launder unexecuted WO-MAO-033 into `COMPLETE`. Envelope v2 therefore supports
one narrow per-edge policy: `COMPLETE_OR_PROVIDER_UNAVAILABLE_DEFERRED` on an `ALL` gate.

The resolver accepts the deferred alternative only with exact cross-binding among the consumer
policy, assessment envelope, subject envelope, subject state, assessment artifact, and independently
configured trust root. Raw assessment-writer keys or ledger anchors passed beside the assessment are
rejected. Before assessment evaluation, the caller may provide only a registry ID/version. The fixed
registry loader verifies the embedded canonical governance record hash and returns its immutable pin
record; there is no public root-registration or caller-supplied pin surface. That record pins the
root fingerprint, bundle content hash, and current hash-chained status head. The bundle must be
root-signed, fresh, unexpired, and non-revoked; it binds active writer key fingerprints and
ledger-anchor identities to provider, assessment WO, subject WO, artifact, assessment hash, and both
envelope hashes.

This mirrors the Phase 2 owner-authority trust pattern: canonical content hashing, Ed25519 root
signature, separately pinned root and bundle identity, and a pinned hash-chained status/revocation
head. The provider-assessment bundle cannot grant owner authority.

Every status event must advance sequence, version, fencing value, and timestamp strictly. Duplicate,
out-of-order, rollback, equal/backdated, or broken-link chains fail. Revocation is terminal for a
root, writer, or ledger anchor; no later or backdated `ACTIVE` event can restore it.

The assessment claims must have a computed content hash and either a verified Ed25519 signature from
a fresh, scoped writer in that configured bundle or an exact fresh immutable-ledger anchor in the
bundle. Raw caller trust, caller self-roots, root substitution, fabricated anchors, bad bundle
hashes/signatures, stale/expired/revoked roots or writers, random hashes, arbitrary complete WOs,
`BLOCKED`, unrelated defer reasons, `ANY`, duplicates, unknown fields, missing references, identity
or envelope-hash mismatches, and unreferenced artifacts fail closed.

The embedded production registry intentionally has zero active trust records. The executable path
therefore remains closed until a reviewed canonical registry change independently installs one. The
valid and adversarial registry fixtures exist only behind the test module mock; the production module
exports no install, register, replace, or mutable pin API.

Omitted new envelope, state, and resolver-input fields normalize to empty arrays or `null`; existing
envelope-v2 and COMPLETE-only DAG inputs remain valid. The default for every edge is still exact
`COMPLETE`.

## Boundary retained

This assessment used repository evidence only. It ran no Claude command or version probe, inspected
no authentication state, credentials, caches, tokens, or provider output, made no network or GitHub
request, ran no provider smoke, activated no runtime, contacted no owner, dispatched no provider,
and granted no authority.

## Validation

- focused envelope, DAG, static-assessment, and settlement tests;
- adversarial Ed25519, immutable-ledger, root-pinned signed-bundle, freshness, status-chain, and
  revocation verification;
- production-registry no-registration proof plus duplicate, sequence/version/fence/time rollback,
  status-head rollback, and terminal-revocation cases;
- backward-compatibility tests for omitted optional fields and COMPLETE-only DAG inputs;
- complete test suite, lint, Node syntax checks, and `git diff --check`.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
