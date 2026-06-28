---
type: devkit-plan
phase: 6A-preview
lane: Goal Command Preview Hardening
status: implemented-local
generated: 2026-06-27
---

# Phase 6A Goal Command Preview Hardening Plan

## Purpose

Prepare `/goal` preview behavior so goal requests are classified and shown as
allowed or blocked without execution.

## Safety Boundary

The preview does not create goals, persist goals, mutate queues, schedule work,
enable autonomy, activate MCP, or write production data.

## API

`GET /api/goal-command-preview?request=...`
