---
type: governance
status: active
area: control-center
tags:
  - governance
  - control-center
---

# WilliamOS Control Center

Local web cockpit for WilliamOS. One command to launch. One URL to open. One page to know what to do.

## Daily Start

```
william control-center
```

Opens http://localhost:8420 with dashboard, inbox capture, review queues, operator agent, search, and safety status.

## Architecture

- **Backend**: Python FastAPI on port 8420. Serves API and built React frontend.
- **Frontend**: React + TypeScript. Pre-built into `control-center/frontend/dist/`.
- **Agent**: Deterministic, rule-based, local-only. No external LLM. Read-only.
- **One process**: Backend serves everything. No separate frontend server needed.

## Screens

| Tab | Purpose |
|-----|---------|
| Home | Today, inbox, review queue, safety, backup, git, next action |
| Capture | Drop thoughts into inbox (Ctrl+Enter) |
| Review | Draft counts across doctrine, decisions, concepts, projects, work orders |
| Agent | 5 interactive questions: next action, summarize today, explain queues, explain health, what to ignore |
| Search | Semantic search across the vault |
| Safety | System health, non-negotiable rules, production readiness check |

## CLI Commands

| Command | What it does |
|---------|-------------|
| `william control-center` | Start server, open browser |
| `william control-center --no-open` | Start without opening browser |
| `william control-center-stop` | Stop the server |
| `william control-center-status` | Check if running |
| `william control-center-build` | Rebuild the frontend |
| `william control-center-smoke` | Run 22-point smoke test |

## Safety

Every CLI command goes through `control-center/backend/safety.py`:
- **SAFE_COMMANDS**: Run freely (all status commands)
- **SAFE_WITH_ARGS**: Run with validated arguments (inbox, today, search)
- **CONFIRM_REQUIRED**: User must confirm (snapshot, backup, accept-draft)
- **FORBIDDEN**: Blocked entirely (semantic-clear, git-init, remote-strategy)

## Docs

- [LAUNCH_GUIDE.md](LAUNCH_GUIDE.md) — How to start, stop, troubleshoot
- [LOCAL_RUNTIME.md](LOCAL_RUNTIME.md) — Architecture, dev mode, safety rules
- [SMOKE_TESTS.md](SMOKE_TESTS.md) — What the 22-point smoke test checks
- [AGENT_POLICY.md](AGENT_POLICY.md) — What the agent can and cannot do
- [SAFETY_ALLOWLIST.md](SAFETY_ALLOWLIST.md) — Full command allowlist
- [CONTROL_CENTER_POLICY.md](CONTROL_CENTER_POLICY.md) — Boundaries and rules
