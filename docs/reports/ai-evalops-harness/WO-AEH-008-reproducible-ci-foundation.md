# WO-AEH-008 — Reproducible CI foundation

## Outcome

Result: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS`.

A repository-only GitHub Actions foundation now declares a frozen pnpm install, lint, TypeScript, repository tests, build, focused execution-fabric/API/database/secret contract gates, Python syntax checking, and artifact upload. No workflow was executed on GitHub, no dependency was installed locally, and no repository or branch setting was changed.

This is foundation evidence, not CI-green, deployment, runtime, or production proof.

## Files

- `.github/workflows/ai-evalops-harness-ci.yml`
- `scripts/ai-evalops-harness/ci-contract-check.mjs`
- `tests/ai-evalops-harness-ci-contract.test.mjs`
- `docs/reports/ai-evalops-harness/WO-AEH-008-reproducible-ci-foundation.md`
- `docs/reports/ai-evalops-harness/evidence/WO-AEH-008-ci-foundation-run1.json`
- `docs/reports/ai-evalops-harness/evidence/WO-AEH-008-ci-foundation-run2.json`

These six files are the complete WO-AEH-008 owned scope. `package.json`, `pnpm-lock.yaml`, the three Python requirement inputs, and `requirements-constraints.txt` are read-only contract inputs owned by concurrent WO-AEH-010 work; WO-AEH-008 did not modify or claim them. No live service or GitHub setting was modified.

Read-only input bindings recorded in both evidence runs:

| Input | SHA-256 |
|---|---|
| `package.json` | `75ded7922c9c9370a5d83baa8c7a04274aea7daafa8ff22320da778031f3f75a` |
| `pnpm-lock.yaml` | `70ae45a62924ace42e7edfdaddf5a59b75be3a33ad6a439492993ca43ab6823e` |
| `requirements.txt` | `ad3c79d87bdcee6624bb37ba74adb4a40fe3a14c83de46df56990baf8d3853ea` |
| `requirements-search.txt` | `840d51e3a14ce44f3db159c4bee95576fc99068dacb4198f54d70b6c0eb09c33` |
| `requirements-execution-fabric.txt` | `37b7fe92dced33caead3578e0d253055a01c076cccd918fa0681e2342bd72383` |
| `requirements-constraints.txt` | `3a31b009b649957e34890e9ab7f402dc811e210ac914e3252e78b1fadfef8464` |

## Gate classification

| Gate | Classification | Repository evidence / limitation |
|---|---|---|
| TypeScript/Node | `READY_FROZEN_INSTALL` | `pnpm-lock.yaml`; workflow uses the exact `packageManager` version `pnpm@10.17.1` and `pnpm install --frozen-lockfile`, then ESLint, TypeScript, tests, and build. The checker rejects version drift. |
| Python | `PARTIAL_EXACT_DIRECT_CONSTRAINTS_NO_HASH_LOCK` | Constraint directives are parsed as directives, not packages. All observed direct requirements resolve to one of ten exact constraints, but no transitive hash lock exists. CI performs syntax compilation only and asserts this partial classification; it does not install dependencies. |
| Execution fabric | `READY` | 26 matching test files are selected by the focused Vitest gate. |
| API | `PARTIAL_TS_GATE_PYTHON_NOT_HASH_LOCKED` | Seven API-related tests are inventoried. The focused TypeScript status-API test is gated; Python API execution remains excluded until a transitive hash lock exists. |
| Database | `PARTIAL_UNIT_ONLY_MISSING_DISPOSABLE_DB` | Two unit contract files are gated; no disposable database integration proof exists. |
| Component | `MISSING` | No `.test.tsx` suite was observed. |
| Playwright | `MISSING` | No Playwright config or dependency was observed. |
| Secret | `PARTIAL_PATTERN_TESTS_ONLY` | Two existing secret-related contract tests are gated; this is not full repository/history secret scanning. |
| Artifact | `PARTIAL_BUILD_UPLOAD_NO_PROVENANCE` | `.next` and the CI contract JSON are uploaded, but signed provenance and integrity policy are deferred. |

## Validation

- `node --check scripts/ai-evalops-harness/ci-contract-check.mjs` — pass.
- `node --test tests/ai-evalops-harness-ci-contract.test.mjs` — 12/12 pass. Structural negatives reject commented, mis-jobbed, conditional, or out-of-order gates; job- and step-level `if` bypasses; write permissions; disabled triggers; missing `--frozen-lockfile`; mismatched pnpm; missing constraints directives; and unconstrained Python requirements. Required jobs and their steps must be unconditionally active.
- Two fixed-time repository observations produced byte-identical JSON.
- Workflow SHA-256: `c858b41c8b7ea2a32de7d5a96dafd12ccdf4f45181ad7f4f42fa678634c72bc3`.
- Checker SHA-256: `725f57d39dbd43282e775bcd92d8166a536ac6672de54156d4987671302b2dc0`.
- Test SHA-256: `feebb65da2d626eb31f2913c7b3bbc25d8f8ff542bd80f63d341301507029602`.
- Each evidence file SHA-256: `564596ca03b697f07470b71d0f743a77368379615bf5398b22a237cab9df9f17`.

The full workflow was deliberately not run locally because pnpm is unavailable and this work order forbids dependency installation/network access. A later authorized GitHub run is required to establish actual gate results.

Independent reviewer `/root/packet_assurance` reran all 12 tests twice, verified
conditional bypass rejection, active ordering, permissions/triggers, every
artifact/input hash and rollback boundary, and returned `PASS` with no blockers.

## Rollback

Rollback is deletion of only the six WO-AEH-008-owned paths listed above. The package, lock, requirements, and constraints inputs must not be reverted by this work order. No external rollback is necessary because no live or GitHub state was changed.

## Transition

- On independent review pass: preserve the explicit gaps and allow WO-AEH-010 to address dependency/provenance reproducibility; later WOs may add component, Playwright, disposable-database, and full secret-scan gates.
- On review block: retain the work order in builder/reviewer-blocked state, correct only the repository CI foundation, regenerate both deterministic evidence files, and repeat independent review.
