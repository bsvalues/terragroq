---
type: devkit-plan
feature: agent-skills-registry
status: phase5k-metadata-only-registry-implemented
generated: 2026-06-27
phase_6_status: blocked
tags:
  - devkit
  - governance
  - agent-skills
---

# Phase 5K Agent Skills Registry Plan

## Purpose

Define inspectable agent capability cards without granting execution authority.

The registry describes what a governed agent skill may inspect, what it must not
do, what validators apply, and what evidence should be produced. It is a
metadata surface only.

## Current Implementation

`WO-WILLIAMOS-P5K-AGENT-SKILLS-REGISTRY` implements:

- Static skill records in `control-center/backend/agent_skills_registry.py`
- `GET /api/agent-skills`
- `GET /api/agent-skills/{skill_id}`
- Control Center "Agent Skills" preview surface
- Backend tests for catalog shape, details, denied actions, validators, and
  non-autonomous safety flags

## Initial Skills

- `repo_auditor`
- `commit_classifier`
- `work_order_builder`
- `validation_runner`
- `release_gate_reviewer`
- `frontend_smoke_agent`
- `docs_devkit_maintainer`
- `secret_residue_scanner`

## Safety Contract

Every skill record proves:

```text
would_execute: false
read_only: true
autonomy_enabled: false
mcp_activation: false
production_write: false
```

## Explicit Non-Goals

Phase 5K does not authorize:

- Command execution by skills.
- Autonomous loops or schedulers.
- MCP activation.
- External worker execution.
- Repo mutation by agents.
- Production or data writes.
- Secret creation or credential storage.
- Push, PR, merge, tag, or release.

## Future Work

Future work may add owner-approved skill review workflows, evidence attachment,
or per-skill readiness checks. Those must remain separately authorized and must
not infer execution authority from skill metadata.
