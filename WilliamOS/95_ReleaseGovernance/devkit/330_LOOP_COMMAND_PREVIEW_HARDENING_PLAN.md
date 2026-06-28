---
type: devkit-plan
phase: 6B-preview
lane: Loop Command Preview Hardening
status: implemented-local
generated: 2026-06-27
---

# Phase 6B Loop Command Preview Hardening Plan

## Purpose

Prepare `/loop` preview behavior so loop requests are classified and shown as
allowed or blocked without execution.

## Safety Boundary

The preview does not start loops, schedule loops, execute loops, continue
autonomously, activate MCP, or write production data.

## API

`GET /api/loop-command-preview?request=...`
