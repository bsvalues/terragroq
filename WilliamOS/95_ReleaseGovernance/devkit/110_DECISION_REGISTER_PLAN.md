---
type: devkit-plan
feature: decision-register
status: phase5g-seed-register-implemented
generated: 2026-06-26
phase_6_status: blocked
tags:
  - devkit
  - governance
  - decisions
---

# Phase 5G Decision Register Plan

## Purpose

Turn important WilliamOS operating decisions into structured, searchable records.

The decision register is not a replacement for `WilliamOS/02_Decisions` official
notes. It is the machine-readable governance layer that lets the Control Center
surface active decisions consistently.

## Current Implementation

`WO-WILLIAMOS-PHASE5G-DECISION-REGISTER-001` implements a read-only seed
register:

- Structured decision records in `control-center/backend/decision_register.py`
- `/api/decisions`
- `/api/decisions/{decision_id}`
- Operator Home "Decisions" panel
- Backend tests for required seed decisions and search

## Seed Decisions

The initial register includes:

- Phase 6 remains an intentionally blocked expansion gate.
- Research Drop Zone is intake-only and non-canon until reviewed.
- External workers are proposal-only.
- 14B is production default; 7B is env override only.
- Cloud/model fallback is disabled unless explicitly approved.
- `v1.3.0` is the stable baseline.
- `v1.3.1` is the runtime hardening baseline.

## Explicit Non-Goals

This first slice does not authorize:

- Phase 6 proactive behavior.
- Automatic decision creation.
- Automatic enforcement or command blocking.
- Automatic canon promotion.
- Worker write or commit authority.
- Cloud/runtime fallback.
- Mutation of official `02_Decisions` notes.

## Future Work

Potential follow-on work orders:

- Store decisions in a persisted local registry file or table.
- Link decisions to official `02_Decisions` notes.
- Add supersession workflow.
- Add review date/stale decision surfaces.
- Inject active decisions into agent context.
- Add queryable decision enforcement hooks for controlled actions.

All future work must preserve local-first authority and require operator approval
before decision creation, supersession, or enforcement changes.
