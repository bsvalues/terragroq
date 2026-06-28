---
type: devkit-plan
phase: 5O
lane: Validation Runbook Registry
status: implemented-local
generated: 2026-06-27
---

# Phase 5O Validation Runbook Registry Plan

## Objective

Define approved validation recipes that Work Orders and the Work Order Composer
can reference without executing them automatically.

## Scope

- Metadata-only validation runbook registry.
- `GET /api/validation-runbooks` and `GET /api/validation-runbooks/{id}`.
- Composer preview support for selected runbook IDs.
- Control Center GUI preview for validation recipes.
- Focused backend tests and validation evidence.

## Safety Contract

The registry:

- does not execute validators;
- does not schedule validators;
- does not persist Work Orders;
- does not mutate repo state;
- does not activate MCP;
- does not enable autonomy or scheduler behavior;
- does not push, create PRs, merge, tag, or release;
- does not perform production/data writes.

## Initial Runbooks

- `backend-focused`
- `backend-full`
- `frontend-build`
- `scope-safety`
- `runtime-smoke`
- `production-readiness`

## API Contract

```text
GET /api/validation-runbooks
GET /api/validation-runbooks/{runbook_id}
```

Responses are metadata-only. No run, execute, schedule, activate, mutate, or
persist endpoint is part of Phase 5O.

## Validation

```text
python -m pytest control-center/backend/tests/test_validation_runbook_registry.py -q
python -m pytest control-center/backend/tests -q
cd control-center/frontend && npm run build
```
