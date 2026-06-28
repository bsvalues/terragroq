---
type: devkit-plan
phase: 5P
lane: Commit Readiness Reviewer
status: implemented-local
generated: 2026-06-27
---

# Phase 5P Commit Readiness Reviewer Plan

## Objective

Add a preview-only reviewer that inspects current repository state and reports
whether the dirty worktree forms a local commit candidate.

## Scope

- `GET /api/commit-readiness` read-only decision-support endpoint.
- Candidate file classification from current git status.
- Dist triplet status review.
- Required validation runbook recommendations.
- Control Center GUI preview.
- Focused backend tests and validation evidence.

## Safety Contract

The reviewer:

- does not run validators;
- does not stage files;
- does not commit;
- does not push, PR, merge, tag, or release;
- does not schedule work;
- does not activate MCP;
- does not enable autonomy;
- does not perform production/data writes.

## Decision Outputs

- `SAFE_TO_COMMIT_CANDIDATE`
- `NOT_SAFE_TO_COMMIT`

These are decision-support labels only. A real commit still requires explicit
owner action outside the reviewer endpoint.

## Validation

```text
python -m pytest control-center/backend/tests/test_commit_readiness_reviewer.py -q
python -m pytest control-center/backend/tests -q
cd control-center/frontend && npm run build
```
