# WO-MAO-011 Hosted Codex Lane B Evidence

- Work orders: `WO-MAO-008`, `WO-MAO-009`, `WO-MAO-011`
- Worker role: hosted Codex builder, Lane B
- Branch: `codex/mao-hosted-lane-b`
- Started UTC: `2026-07-14T15:41:11Z`
- Completed UTC: `2026-07-14T15:44:18Z`
- Outcome: `PASS`

## Reservation

The lane held an exclusive reservation on exactly these repository paths:

- `scripts/multi-agent-operator/reservation-set.mjs`
- `scripts/multi-agent-operator/reservation-set-cli.mjs`
- `tests/multi-agent-reservation-set.test.ts`
- `docs/reports/WO-MAO-011-hosted-codex-lane-b.md`

No other tracked path was changed. The implementation is a deterministic pre-dispatch checker only. It does not acquire, persist, renew, release, or assert an atomic reservation claim.

## Delivered behavior

- Normalizes repository-relative paths to stable POSIX form and rejects absolute, escaping, empty, or NUL-bearing paths.
- Rejects incomplete schemas, empty identities, normalized duplicates, internal ancestor/descendant path overlaps, and same-set comparisons.
- Detects exact and ancestor/descendant path collisions.
- Detects equality collisions for contracts, environments, repositories, and protected resources.
- Emits stable, ordered conflict reason codes and a typed compatibility result.
- CLI accepts two JSON files, uses no provider or credential access, and exits `0` for compatible, `3` for conflict, and `2` for invalid input or schema.
- Every result explicitly records `effect=PRE_DISPATCH_CHECK_ONLY`, `ledgerClaimed=false`, and `authorityGranted=false`.

## Validation

- `vitest run --config /tmp/mao-lane-b-vitest.config.mjs`: PASS, 1 file and 14 tests.
- `node --check scripts/multi-agent-operator/reservation-set.mjs`: PASS.
- `node --check scripts/multi-agent-operator/reservation-set-cli.mjs`: PASS.
- `git diff --check`: PASS.
- Repository-wide lint was not run from the isolated worktree because dependencies are installed in the coordinating worktree; the focused test used that installed Vitest with a no-plugin temporary config.

## Owner-operation evidence

- `OWNER_OPERATION_TOUCH_COUNT=0`
- `OWNER_CREDENTIAL_TOUCH_COUNT=0`
- `OWNER_DIAGNOSTIC_TOUCH_COUNT=0`
- `OWNER_ROUTINE_DECISION_COUNT=0`
- `OWNER_ROUTINE_CONTACT_COUNT=0`

No runtime activation, provider authentication, credential inspection, owner contact, GitHub write, push, or merge occurred in this lane.

## PR #364 assurance remediation

- Remediation started UTC: `2026-07-14T16:14:36Z`
- Remediation completed UTC: `2026-07-14T16:15:23Z`
- Finding: repository-relative path strings were compared globally, which could falsely collide identical paths reserved in disjoint repositories.
- Resolution: exact and ancestor/descendant path identity is now scoped to overlapping repository context. Disjoint explicit repositories are compatible; shared repositories and conservative implicit dispatch-repository context preserve collision detection.
- Regression coverage: equal paths in disjoint repositories, ancestor-related paths in disjoint repositories, equal paths in a shared repository, and ancestor-related paths in a shared repository.
- Remediation validation: focused Vitest PASS, 1 file and 16 tests; both Node syntax checks PASS; `git diff --check` PASS.
- Reservation and all five zero owner-operation counters above remain unchanged.
