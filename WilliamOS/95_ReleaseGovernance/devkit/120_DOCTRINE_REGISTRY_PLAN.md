---
type: devkit-plan
feature: doctrine-registry
status: phase5h-seed-registry-implemented
generated: 2026-06-26
phase_6_status: blocked
tags:
  - devkit
  - governance
  - doctrine
---

# Phase 5H Doctrine Registry Plan

## Purpose

Make WilliamOS operating rules machine-readable, visible, searchable, and
available as agent context.

Doctrine is not memory and not a decision record. Doctrine is an authoritative
operating rule that defines what is allowed, forbidden, or approval-gated.

## Current Implementation

`WO-WILLIAMOS-PHASE5H-DOCTRINE-REGISTRY-001` implements a read-only seed
registry:

- Structured doctrine records in `control-center/backend/doctrine_registry.py`
- `/api/doctrine`
- `/api/doctrine/{rule_id}`
- `/api/doctrine/check`
- Operator Home "Doctrine" panel
- Backend tests for required seed doctrine, search, detail, and read-only query

The doctrine check endpoint returns advisory context only. It does not execute
commands, bypass `safety.check_command`, mutate worker authority, or grant
approval.

## Seed Doctrine

The initial registry includes:

- No Phase 6 without explicit authorization.
- No silent model fallback.
- Workers propose; WilliamOS governs.
- Claude Code may not push by default.
- Codex is audit/evidence scout by default.
- Research intake is non-canon until reviewed.
- No generated artifact commit without classification.

## Explicit Non-Goals

This first slice does not authorize:

- Phase 6 proactive behavior.
- Automatic doctrine creation.
- Automatic command enforcement or blocking.
- External worker write, push, tag, release, or promotion authority.
- Cloud/runtime fallback.
- Provider switching.
- Weakening `safety.check_command` or `command_runner`.
- Mutation of official doctrine notes.

## Future Work

Potential follow-on work orders:

- Persist doctrine in a local registry file or table.
- Link doctrine to official governance notes.
- Add supersession workflow.
- Inject active doctrine into agent context packets.
- Add controlled enforcement hooks after explicit approval.
- Add UI detail views with evidence links and review dates.

All future enforcement work must remain local-first, approval-gated, and
auditable. Unknown actions must remain blocked or review-required until
classified by operator authority.
