---
type: devkit-plan
phase: 5N
lane: Work Order Composer
status: implemented-local
generated: 2026-06-27
---

# Phase 5N Work Order Composer Plan

## Objective

Add a governed Work Order Composer that turns operator-provided objective,
scope, denied actions, validators, evidence, and commit rules into a structured
preview packet.

## Scope

- Preview-only backend composer.
- `POST /api/work-order-composer/preview` for draft packet generation.
- Control Center GUI form and packet preview.
- Focused backend tests.
- Devkit plan and validation evidence.

## Safety Contract

The composer:

- does not execute Work Orders;
- does not persist Work Orders;
- does not mutate the seed registry;
- does not write files from the API;
- does not stage, commit, push, PR, merge, tag, or release;
- does not activate MCP;
- does not enable autonomy or scheduler behavior;
- does not perform production/data writes.

## API Contract

```text
POST /api/work-order-composer/preview
```

The endpoint returns a structured draft and markdown packet. The POST is a
calculation-only preview action, not a persistence or execution endpoint.

## Validation

```text
python -m pytest control-center/backend/tests/test_work_order_composer.py -q
python -m pytest control-center/backend/tests -q
cd control-center/frontend && npm run build
```
