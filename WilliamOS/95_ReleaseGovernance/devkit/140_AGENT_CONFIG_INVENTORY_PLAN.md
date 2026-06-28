---
type: devkit-plan
feature: agent-config-inventory
status: phase5j-read-only-inventory-implemented
generated: 2026-06-26
phase_6_status: blocked
tags:
  - devkit
  - governance
  - agent-configs
---

# Phase 5J Agent Config Inventory Plan

## Purpose

Discover external agent and tool configuration surfaces without changing them.

The inventory records known local surfaces, whether they are present, risk
classification, and review flags. It does not display secrets or mutate
configuration.

## Current Implementation

`WO-WILLIAMOS-PHASE5J-AGENT-CONFIG-INVENTORY-001` implements a read-only
inventory:

- Structured config surface records in `control-center/backend/agent_config_inventory.py`
- `/api/agent-configs`
- `/api/agent-configs/{surface_id}`
- Operator Home "Agent Configs" panel
- Backend tests for required surfaces, redaction, search, filtering, and API behavior

The first slice detects path presence only. It does not parse provider tokens,
display secret values, import deep links, switch providers, or enable workers.

## Surfaces

The initial inventory includes:

- Claude Code
- Codex
- Hermes
- OpenCode
- OpenClaw
- CC Switch
- MCP servers
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- Skills
- Provider configs
- Local model runtimes

## Explicit Non-Goals

This first slice does not authorize:

- Config mutation.
- Secret display.
- Provider switching.
- Cloud enablement.
- Deep-link import.
- Worker write authority.
- Phase 6 proactive behavior.
- Push, tag, release, or publication.
- Weakening `safety.check_command` or `command_runner`.

## Future Work

Potential follow-on work orders:

- Persist inventory snapshots for comparison.
- Add redacted config metadata parsing after explicit approval.
- Add review workflows for unknown or risky config surfaces.
- Link inventory risks into Doctrine and Work Order context.
- Add operator-approved provider configuration checks.

All future work must remain read-first, redacted by default, and approval-gated
before any config read beyond metadata or any config mutation.
