---
type: devkit-plan
phase: 5M
lane: Repo State Dashboard
status: implemented-local
generated: 2026-06-27
---

# Phase 5M Repo State Dashboard Plan

## Objective

Add a read-only Control Center dashboard that summarizes the current repository
posture without granting execution, mutation, push, PR, merge, release, MCP,
autonomy, scheduler, or production write authority.

## Scope

- Backend `GET /api/repo-state` endpoint.
- Read-only repo state composition from the Phase 5L Evidence Pack snapshot.
- GUI preview showing baseline, branch, worktree state, recent commits,
  validation reports, active gates, and next valid action.
- Focused backend tests proving preview-only behavior.

## Safety Contract

The Repo State Dashboard:

- does not write files;
- does not run validators;
- does not run package managers;
- does not execute arbitrary commands;
- does not activate MCP;
- does not enable autonomy or scheduler behavior;
- does not push, create PRs, merge, tag, or release;
- does not perform production or data writes.

## API Contract

```text
GET /api/repo-state
```

The response includes:

- repo, branch, HEAD, baseline, and worktree state;
- recent commits;
- validation report history and declared validators;
- active gates and next valid action;
- safety flags and preserved non-authorizations.

No POST, PUT, PATCH, DELETE, run, execute, activate, schedule, or mutate endpoint
is part of this phase.

## Validation

Required local validation:

```text
python -m pytest control-center/backend/tests/test_repo_state_dashboard.py -q
python -m pytest control-center/backend/tests -q
cd control-center/frontend && npm run build
```

If tracked frontend `dist/` changes, include it only after owner authorization
for the complete matching build output.
