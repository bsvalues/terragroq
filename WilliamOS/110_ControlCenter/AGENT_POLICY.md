---
type: governance
status: active
area: control-center
tags:
  - governance
  - control-center
  - agent
  - policy
---

# Operator Agent Policy

## Design

The operator agent is a deterministic, rule-based recommendation engine. It reads vault state and suggests what to do next. It never takes action on its own.

## Rules

1. **Read-only**: The agent only reads state through `state_reader.py`. It never calls `command_runner.py`.
2. **Deterministic**: Same state produces same recommendations. No randomness, no LLM.
3. **Local-only**: No network calls. No external APIs. No cloud services.
4. **Transparent**: Every response includes `commands_used` and `safety` fields showing what was read.
5. **Priority-based**: Recommendations are sorted by priority (1 = urgent, 5 = routine).

## Priority Logic

| Priority | Trigger | Example |
|----------|---------|---------|
| 1 | Critical smoke failure | "Investigate smoke failures" |
| 1 | No daily note | "Create today's daily note" |
| 2 | Review queue has items | "Review projects drafts (4 pending)" |
| 3 | Inbox > 5 notes | "Process inbox (8 notes)" |
| 5 | Everything healthy | "System is healthy. Capture a thought." |

## What the Agent May Not Do

- Execute any command
- Modify any file
- Make recommendations that bypass the safety gate
- Use external data sources
- Run in the background without explicit user launch
