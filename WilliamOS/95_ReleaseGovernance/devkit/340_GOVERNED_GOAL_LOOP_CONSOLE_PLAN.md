---
type: devkit-plan
phase: 6C-preview
lane: Governed Goal/Loop Console
status: implemented-local
generated: 2026-06-27
---

# Phase 6C Governed Goal/Loop Console Plan

## Purpose

Add a preview-only console that combines goal registry, loop registry, readiness
review, authority ledger, approval packet preview, action router, and next gate.

## Safety Boundary

The console does not approve, execute, schedule, write state, activate MCP,
enable autonomy, or write production data.

## API

`GET /api/governed-goal-loop-console`
