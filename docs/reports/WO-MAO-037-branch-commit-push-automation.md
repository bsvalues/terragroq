# WO-MAO-037 — Branch, Commit, and Push Automation

Result: `BRANCH_COMMIT_PUSH_AUTOMATION_PASS / WO-MAO-038_READY`

## Scope

WO-MAO-037 adds a governed branch/commit/push gate model for the multi-agent operator program. The
model proves the conditions required before a coordinator may create a branch, stage reserved files,
commit with attributable identity, and push a reviewed branch.

This Work Order does not create a background Git worker and does not grant durable runtime authority.
The actual publication of this branch still occurs through the active hosted Codex session and normal
reviewed PR lifecycle.

## Implemented Artifacts

- `scripts/multi-agent-operator/branch-commit-push-automation.mjs`
- `scripts/multi-agent-operator/branch-commit-push-automation-cli.mjs`
- `tests/multi-agent-branch-commit-push-automation.test.ts`
- `components/operator/multi-agent-capability-registry.ts`
- `components/operator/multi-agent-operator-registry.ts`

## Required Gates

The evaluator permits the governed publish plan only when all gates pass:

- active `PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001` authority grant
- preventive trust gate v2 passed
- attributed identity
- path confinement
- output redaction
- safe `codex/` branch
- base rollback ref preserved
- changed files are exactly within reserved paths
- no foreign changes
- secret scan passed
- secret scan covers exactly the changed files
- remote is `origin`

Any missing or weakened gate fails closed.

## Safety Properties

- `gitCommandPerformed`: `false`
- `pushPerformed`: `false`
- `prCreated`: `false`
- `runtimeActivationAllowed`: `false`
- `authorityGranted`: `false`
- `secretsExposed`: `false`
- `ownerRelayRequired`: `false`

The model rejects unreserved files, foreign changes, failed or incomplete secret scans, unsafe branch
names, inactive grants, failed trust gates, non-origin remotes, rollback mismatches, and unknown input
fields.

## Validation

- `npm test -- --run tests/multi-agent-branch-commit-push-automation.test.ts`: pass, 1 file / 4 tests
- `npm test -- --run tests/multi-agent-branch-commit-push-automation.test.ts tests/multi-agent-operator-registry.test.ts tests/multi-agent-capability-registry.test.ts tests/portfolio-operator.test.ts tests/portfolio-operator-surface.test.ts`: pass, 5 files / 24 tests
- `git diff --check`: pass
- `npm run lint`: pass
- `npm test -- --run`: pass, 174 files / 1286 tests
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`: pass

## Next Work Order

`WO-MAO-038 — PR creation and packet linkage` is dependency-cleared.
