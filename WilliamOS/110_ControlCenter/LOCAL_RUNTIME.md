---
type: governance
status: active
area: control-center
tags:
  - governance
  - control-center
  - runtime
---

# Control Center Local Runtime

## Architecture

One process serves everything:

```
python scripts/william.py control-center
         │
         ├── FastAPI backend (port 8420)
         │     ├── /api/* endpoints
         │     └── serves built React frontend from dist/
         │
         └── Browser opens to http://localhost:8420
```

## Mode: built-static

The frontend is pre-built with `npm run build` into `control-center/frontend/dist/`. The FastAPI backend serves these static files alongside the API. No Node.js process runs at runtime.

## Process Tracking

When launched, the system writes runtime state to:
```
WilliamOS/110_ControlCenter/generated/runtime/control-center.json
```

This file contains the backend PID, URL, start time, and mode. It is git-ignored and used only for `control-center-stop` and `control-center-status`.

## Dev Mode (for development only)

For frontend development with hot reload:
```
# Terminal 1: backend
python control-center/backend/app.py

# Terminal 2: frontend dev server
cd control-center/frontend && npm run dev
```

Vite proxies `/api` to localhost:8420. UI is on localhost:5173.

This is not needed for daily use — `william control-center` serves the built frontend.

## Safety Rules

The Control Center enforces the same non-negotiable rules as the CLI:

- No push, no remote, no cloud sync
- No background daemon unless explicitly launched
- No deleting notes or rewriting official notes
- No automatic or batch acceptance
- No secrets, .env, tokens
- Every command goes through the safety gate before execution

## What the Agent Can Do

- Read vault state (inbox count, review queues, backup info, git status)
- Recommend what to do next
- Summarize today
- Explain review queues
- Explain system health
- Tell you what you can ignore

## What the Agent Cannot Do

- Execute any command on its own
- Modify any file
- Make network calls
- Use an external LLM
- Run in the background
