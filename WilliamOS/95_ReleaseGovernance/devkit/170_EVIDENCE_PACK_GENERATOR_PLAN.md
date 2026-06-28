---
type: devkit-plan
feature: evidence-pack-generator
status: phase5l-read-only-generator-implemented
generated: 2026-06-27
phase_6_status: blocked
tags:
  - devkit
  - governance
  - evidence
  - handoff
---

# Phase 5L Evidence Pack Generator Plan

## Purpose

Generate repeatable handoff/evidence packet previews from current repository
state without mutating the repo or running validators.

## Current Implementation

`PHASE_5L` implements:

- Read-only packet generator in `control-center/backend/evidence_pack_generator.py`
- `GET /api/evidence-pack`
- Control Center "Evidence Pack" preview surface
- Focused backend tests
- Devkit plan and validation evidence

## Packet Fields

The packet includes:

- repo path
- branch
- HEAD and short HEAD
- git status
- dirty file buckets
- diff stats
- staged stats
- recent commits
- validator expectations
- build/test result placeholders
- safety posture
- next valid gate

## Safety Contract

The generator proves:

```text
read_only_generator: true
would_execute_validators: false
would_write_files: false
autonomy_enabled: false
mcp_activation: false
production_write: false
push_pr_merge_release: false
```

## Explicit Non-Goals

Phase 5L does not authorize:

- Writing packet files.
- Running validators.
- Git add, commit, push, merge, tag, or release.
- MCP activation.
- Autonomous scheduling.
- Production or data writes.

Future work may add owner-approved packet export, but that must be a separate
write-authorized lane.
