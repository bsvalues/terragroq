---
type: devkit-plan
phase: 5R
lane: Operator Review Inbox
status: implemented-local
generated: 2026-06-27
---

# Phase 5R Operator Review Inbox Plan

## Objective

Add a preview-only review inbox that aggregates generated handoff packets,
commit readiness reviews, validation summaries, and next-gate recommendations
into one operator-facing queue.

## Scope

- `GET /api/operator-review-inbox` preview endpoint.
- In-memory generated review items only.
- GUI review queue surface.
- Focused backend tests and validation evidence.

## Safety Contract

The review inbox:

- does not persist review items;
- does not approve work;
- does not execute validators or commands;
- does not stage or commit;
- does not push, PR, merge, tag, or release;
- does not schedule work;
- does not activate MCP;
- does not enable autonomy;
- does not perform production/data writes.

## API Contract

```text
GET /api/operator-review-inbox
```

The response includes generated preview items with allowed actions limited to
`inspect` and `copy`. No persistence, approval, execution, scheduling, or
mutation endpoint is part of Phase 5R.

## Validation

```text
python -m pytest control-center/backend/tests/test_operator_review_inbox.py -q
python -m pytest control-center/backend/tests -q
cd control-center/frontend && npm run build
```
