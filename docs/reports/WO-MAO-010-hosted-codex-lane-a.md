# WO-MAO-008/009/010 — Hosted Codex Lane A Evidence

Status: `P1_REMEDIATED / FINAL_INDEPENDENT_RE-REVIEW_REQUESTED`

## Execution identity

- Provider surface: native hosted Codex subagent
- Team role: `BUILDER_A`
- Branch: `codex/mao-hosted-lane-a`
- Base commit: `7713d3b80b421fd4ae76c2b9a2c31b9e59c7e828`
- Started at (UTC): `2026-07-14T15:41:32Z`
- Initial implementation completed at (UTC): `2026-07-14T15:47:02Z`
- Assurance remediation completed at (UTC): `2026-07-14T15:56:39Z`
- Post-merge P1 remediation started at (UTC): `2026-07-14T16:14:31Z`
- Post-merge P1 remediation completed at (UTC): `2026-07-14T16:15:22Z`
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
runtime, GitHub, production, or owner operation. Every successful result states
`validationOnly=true` and `authorityGranted=false`; a valid packet cannot be represented as an
authority grant.

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
- Owner contact and privileged credential, runtime activation, production-write, branch-protection
  bypass, and destructive-Git actions cannot appear in allowed actions while
  `ownerOperationsAllowed=false`.
- Merge-mode/action pairs fail closed: `NO_MERGE` has no PR-lifecycle action,
  `DRAFT_PR_ONLY` requires draft creation and forbids merge, and `ASSURANCE_GATED` requires the
  eligible-merge action.
- Retry, backoff, and remediation budgets have strict finite upper bounds.
- Independent review, at least one approval, and zero unresolved threads are mandatory.
- Canonical normalization gives semantically equivalent packets the same SHA-256 content hash.

## Validation

- Focused test after initial implementation: `27 passed / 27 total`
- Focused test after assurance remediation: `33 passed / 33 total`
- Focused test after post-merge P1 remediation: `38 passed / 38 total`
- Focused lint: `PASS` (React package-detection warning only; no lint findings)
- `git diff --check`: `PASS`
- Secret or raw provider-output inspection: `NOT PERFORMED`

## Independent assurance remediation

Independent assurance returned `REQUEST_CHANGES` on four fail-open edges. The builder remediated all
four within the original reservation:

1. Owner-contact actions now raise `DISPATCH_ENVELOPE_OWNER_OPERATION_WALL`.
2. Every merge mode now has an explicit compatible action set.
3. Reservation paths reject Unicode control and format characters, including NUL and newline.
4. Direct and CLI success results now carry `validationOnly=true` and `authorityGranted=false`.

Exact regression tests cover each assurance finding. Independent re-review is requested against the
second scoped commit; this builder does not self-approve the remediation.

## Post-merge P1 remediation

PR `#365` assurance identified that five privileged actions not prefixed with `OWNER_` could still
enter `allowedActions` in a zero-owner envelope. The validator now uses one explicit protected-action
set for `OWNER_CONTACT`, `CREDENTIAL_ACCESS`, `RUNTIME_ACTIVATION`, `PRODUCTION_WRITE`,
`BRANCH_PROTECTION_BYPASS`, and `DESTRUCTIVE_GIT`, while retaining prefix denial for future
`OWNER_*` actions. A table-driven regression executes every protected action independently and
expects `DISPATCH_ENVELOPE_OWNER_OPERATION_WALL`.

Final independent re-review is requested against the P1 remediation commit. This builder records the
remediation and does not self-assert the final assurance verdict.

## Owner-operation counters

- `OWNER_OPERATION_TOUCH_COUNT=0`
- `OWNER_CREDENTIAL_TOUCH_COUNT=0`
- `OWNER_DIAGNOSTIC_TOUCH_COUNT=0`
- `OWNER_ROUTINE_DECISION_COUNT=0`
- `OWNER_ROUTINE_CONTACT_COUNT=0`
