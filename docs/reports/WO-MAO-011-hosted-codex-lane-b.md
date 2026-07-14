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
- Interim resolution: exact and ancestor/descendant path identity was scoped using the `repositories` collection. PR #366 assurance later found that this overloaded whole-repository claims as path context; the redesign below supersedes it.
- Regression coverage: equal paths in disjoint repositories, ancestor-related paths in disjoint repositories, equal paths in a shared repository, and ancestor-related paths in a shared repository.
- Remediation validation: focused Vitest PASS, 1 file and 16 tests; both Node syntax checks PASS; `git diff --check` PASS.
- Reservation and all five zero owner-operation counters above remain unchanged.

## PR #366 assurance remediation

- Remediation started UTC: `2026-07-14T16:36:32Z`
- Remediation completed UTC: `2026-07-14T16:38:50Z`
- Finding: using `reservations.repositories` as path context made two disjoint paths in one repository incompatible because repository equality independently means a whole-repository reservation.
- Resolution: a path is now either a standalone string in implicit `@dispatch-repository` context or `{ repository, path }` with explicit per-path context. `reservations.repositories` exclusively represents whole-repository claims.
- Whole-repository semantics: repo/repo equality retains `REPOSITORY_COLLISION`; a whole-repository claim against a path in that repository emits `REPOSITORY_PATH_COLLISION`.
- Adversarial coverage: different repositories with the same path, same repository with disjoint paths, same repository with exact and ancestor overlaps, whole-repository versus path claims, and repository-scoped duplicate/self-overlap validation.
- Remediation validation: focused Vitest PASS, 1 file and 20 tests; both Node syntax checks PASS; `git diff --check` PASS.
- Reservation and all five zero owner-operation counters above remain unchanged.

## PR #366 mixed-context assurance follow-up

- Follow-up started UTC: `2026-07-14T16:42:01Z`
- Follow-up completed UTC: `2026-07-14T16:42:52Z`
- Finding: an explicit whole-repository claim compared with an accepted legacy string path had no resolvable common repository identity and returned compatible.
- Resolution: mixed whole-repository/implicit-path comparisons now fail closed symmetrically as typed `CONFLICT` with `REPOSITORY_PATH_CONTEXT_UNRESOLVED`. Structured path comparisons retain exact repository semantics, and implicit-path versus implicit-path legacy collision behavior is unchanged.
- Regression validation: focused Vitest PASS, 1 file and 21 tests; both Node syntax checks PASS; `git diff --check` PASS.
- Reservation and all five zero owner-operation counters above remain unchanged.
