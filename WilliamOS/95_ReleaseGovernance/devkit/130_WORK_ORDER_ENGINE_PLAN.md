---
type: devkit-plan
feature: work-order-engine
status: phase5i-seed-registry-implemented
generated: 2026-06-26
phase_6_status: blocked
tags:
  - devkit
  - governance
  - work-orders
---

# Phase 5I Work Order Engine Plan

## Purpose

Make `/goal` and `/loop` first-class structured Work Order objects.

The Work Order Engine is the governance layer that records active work, scope,
non-goals, validators, stop conditions, owner decisions, evidence, result,
commit, tag, and phase.

## Current Implementation

`WO-WILLIAMOS-PHASE5I-WORK-ORDER-ENGINE-001` implements a read-only seed
registry:

- Structured Work Order records in `control-center/backend/work_order_registry.py`
- `/api/work-orders`
- `/api/work-orders/active`
- `/api/work-orders/{wo_id}`
- Operator Home "Work Orders" panel
- Backend tests for required statuses, seed records, search, active WO, and API behavior

The first slice is visibility and structure only. It does not execute work,
mutate WO status, create WOs automatically, or grant commit/release authority.

## Required Statuses

- draft
- active
- blocked
- hold
- accepted
- closed
- superseded
- rejected

## Seed Work Orders

The initial registry includes:

- `WO-WILLIAMOS-PHASE5G-DECISION-REGISTER-001` as closed.
- `WO-WILLIAMOS-PHASE5H-DOCTRINE-REGISTRY-001` as closed.
- `WO-WILLIAMOS-PHASE5I-WORK-ORDER-ENGINE-001` as active.

## Explicit Non-Goals

This first slice does not authorize:

- Phase 6 proactive behavior.
- Autonomous WO execution.
- Automatic WO creation.
- Automatic WO closure/block/hold mutation.
- Worker write authority.
- Push, tag, release, or publication.
- Cloud/runtime fallback.
- Provider switching.
- Weakening `safety.check_command` or `command_runner`.

## Future Work

Potential follow-on work orders:

- Persist WOs in a local registry file or table.
- Create WOs from approved operator packets.
- Generate closure reports from WO records.
- Link commits, tags, validators, and evidence automatically after approval.
- Inject active WO scope into agent context.
- Add controlled status transitions with explicit operator approval.

All future execution or mutation work must remain local-first, approval-gated,
auditable, and scoped to the active WO.
