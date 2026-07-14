# WO-MAO-008/009/010 — Hosted Codex Lane A Evidence

Status: `COMPLETE_LOCAL / AWAITING_INDEPENDENT_ASSURANCE`

## Execution identity

- Provider surface: native hosted Codex subagent
- Team role: `BUILDER_A`
- Branch: `codex/mao-hosted-lane-a`
- Base commit: `7713d3b80b421fd4ae76c2b9a2c31b9e59c7e828`
- Started at (UTC): `2026-07-14T15:41:32Z`
- Completed at (UTC): `2026-07-14T15:47:02Z`
- Local runtime activation: `false`
- Provider credential access: `false`
- Push performed by builder: `false`

## Bounded proof portfolio

Lane A delivered a deterministic validator and normalizer for the mandatory hosted-team dispatch
envelope. The implementation validates exact program, goal, loop, Work Order, repository, base-ref,
dependency, risk, lane, team-role, provider, reservation, authority, action, validation, review,
retry, remediation, evidence, and owner-operation fields before a packet can be dispatched.

The CLI accepts exactly one local JSON file and emits canonical machine-readable JSON with either
`DISPATCH_ENVELOPE_VALID` or one typed wall code. It performs no network, provider, credential,
runtime, GitHub, production, or owner operation.

## Exclusive reservation

- `scripts/multi-agent-operator/dispatch-envelope.mjs`
- `scripts/multi-agent-operator/dispatch-envelope-cli.mjs`
- `tests/multi-agent-dispatch-envelope.test.ts`
- `docs/reports/WO-MAO-010-hosted-codex-lane-a.md`

No file outside this reservation was modified.

## Safety behavior proved

- Missing and unknown fields fail closed.
- `ownerOperationsAllowed` must be exactly `false`.
- Only risk classes `R0` through `R3` are accepted.
- Repository/base-ref sets must match exactly and base refs bind a full ref to a 40-character commit.
- Reservations reject absolute POSIX and Windows paths, backslashes, `.`/`..` traversal, wildcards,
  empty path segments, unknown repositories, and duplicates.
- Coordinator, builder, and reviewer identities must be distinct.
- Preferred and fallback provider sets cannot overlap.
- Allowed and forbidden actions cannot overlap; unsupported actions fail closed.
- Retry, backoff, and remediation budgets have strict finite upper bounds.
- Independent review, at least one approval, and zero unresolved threads are mandatory.
- Canonical normalization gives semantically equivalent packets the same SHA-256 content hash.

## Validation

- Focused test: `27 passed / 27 total`
- Focused lint: `PASS` (React package-detection warning only; no lint findings)
- `git diff --check`: `PASS`
- Secret or raw provider-output inspection: `NOT PERFORMED`

## Owner-operation counters

- `OWNER_OPERATION_TOUCH_COUNT=0`
- `OWNER_CREDENTIAL_TOUCH_COUNT=0`
- `OWNER_DIAGNOSTIC_TOUCH_COUNT=0`
- `OWNER_ROUTINE_DECISION_COUNT=0`
- `OWNER_ROUTINE_CONTACT_COUNT=0`
