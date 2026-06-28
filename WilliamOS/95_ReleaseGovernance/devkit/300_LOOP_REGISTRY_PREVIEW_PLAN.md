---
type: devkit-plan
phase: 5Y
lane: Loop Registry Preview
status: implemented-local
generated: 2026-06-27
---

# Phase 5Y Loop Registry Preview Plan

## Purpose

Add a metadata-only Loop Registry Preview that defines loop plans, loop steps,
stop conditions, denied actions, evidence expectations, and human approval gates.

## Safety Boundary

The registry does not start loops, schedule loops, execute loops, write loop
state, enable autonomy, activate MCP, or write production data.

## API

`GET /api/loop-registry`

Returns static governed loop metadata and safety flags.
