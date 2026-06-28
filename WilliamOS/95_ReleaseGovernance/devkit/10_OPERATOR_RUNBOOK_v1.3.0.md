---
type: operator-runbook
version: v1.3.0
generated: 2026-06-24
tags:
  - devkit
  - runbook
  - operations
---

# WilliamOS Operator Runbook — v1.3.0

This runbook covers daily operation of the WilliamOS Control Center.
All commands run from the repo root unless noted.

---

## Start the Control Center

```bash
# Standard launch — opens browser automatically
python scripts/william.py control-center

# Launch without opening browser (useful for headless or restart flows)
python scripts/william.py control-center --no-open
```

The Control Center will be available at `http://localhost:8420`.

On a healthy start you will see:
- Status strip: model online/offline, backend health
- Briefing card with today's summary
- Command panel (empty until you submit a command)
- Research Drop Zone (file intake panel)
- Workers panel (Agent Dock, all workers shown as available or disabled)
- Evidence rail and History (empty until commands run)

If port 8420 is already in use by a healthy WilliamOS process, the launcher adopts
it rather than starting a duplicate. If port 8420 is in use by an unknown process,
the launcher reports a conflict and does not kill the unknown process automatically.

---

## Stop the Control Center

```bash
python scripts/william.py control-center-stop
```

This reads the runtime state file at
`WilliamOS/110_ControlCenter/generated/runtime/control-center.json`
and sends SIGTERM to the recorded PID. If the process is already gone, it reports
stale state and clears the file.

---

## Restart the Control Center

```bash
# Restart without opening browser
python scripts/william.py control-center-restart --no-open

# Restart and open browser
python scripts/william.py control-center-restart
```

Restart = stop (if running) + start. The frontend is served from the pre-built
`dist/` directory; no build step runs during a normal restart.

---

## Check Status

```bash
python scripts/william.py control-center-status
```

Output includes:
- Backend running (yes/no), PID, URL
- Frontend static files present (yes/no)
- Build directory state
- Runtime mode (built-static or dev)
- Start time
- Local model online/offline
- Ollama model inventory

---

## Open the Browser Shell Manually

```
http://localhost:8420
```

The frontend is a built React SPA served by FastAPI. There is no separate dev server
in production mode. If the page is blank, check that the Control Center is running
and that `control-center/frontend/dist/` is present and non-empty.

---

## Understand Model Online / Model Offline State

The status strip in the top-right shows model state:

| State | Meaning |
|-------|---------|
| Model online | Ollama is reachable at `http://127.0.0.1:11434` and the primary model is loaded |
| Model offline | Ollama is not reachable or primary model is not present |

**Model offline does not stop WilliamOS core from running.** Commands, briefing,
vault reads, and governance checks continue to work. Only model-backed chat, RAG
responses, and semantic search are degraded.

To check model state manually:
```bash
curl http://127.0.0.1:11434/api/tags
ollama list
```

---

## Use the Command Panel

1. Type a plain-English command in the Command input box.
2. Submit (Enter or Send button).
3. WilliamOS routes it through the agent loop → safety gate.
4. If the command requires approval (write/commit/snapshot/promotion), a
   **Review Required** card appears.
5. Inspect the evidence — tool name, arguments, preview.
6. Click **Approve** to run or **Deny** to cancel.
7. The result streams into the Evidence rail and History.

Commands that are read-only (status checks, searches, briefings) may run without
a Review Required pause depending on their safety tier.

---

## Use the Review Required Panel

When a Review Required card appears:
- It shows the proposed command name and arguments.
- It shows a plain-English summary of what will happen.
- It does **not** execute until you click Approve.

If you close the browser or the session ends before approving, the pending command
is abandoned. WilliamOS does not queue approvals between sessions.

---

## Use the Research Drop Zone

1. On the Operator Home, find the **Drop Research** panel.
2. Drag and drop a file onto the drop zone, or click to browse.
3. Supported: PDF, text (.txt), Markdown (.md), CSV, HTML, common image files.
4. Unsupported file types fail with a clear operator message and are not copied.
5. After intake, check:
   - Evidence rail: new entry with file metadata
   - History: intake event
   - `WilliamOS/07_Learning/Research Intake/`: generated note
   - `WilliamOS/110_ControlCenter/research_intake/`: original file + metadata JSON

For details, see `40_RESEARCH_DROP_ZONE.md`.

---

## Use the Evidence Rail

The Evidence rail on the right side of the Operator Home shows:
- Each command that ran (tool name, args, result summary)
- Each research intake event
- Each delegation proposal event

Evidence entries are not clickable for editing. They are read-only audit records.
The full evidence detail is in History.

---

## Use History

The History panel shows a time-ordered list of sessions and events. Clicking a
session shows the full conversation, commands run, evidence captured, and tool results.

History is stored in `copilot.db` (SQLite, local only). It is never pushed remotely.

---

## Use the Workers Panel

The Workers panel (Agent Dock) shows:
- Worker name, kind, and status (available / unavailable / disabled)
- Allowed task categories
- Delegation policy (confirm-required, proposal-only)
- Last run result (if any)

Currently, all external workers (Claude Code, Codex, Hermes) are **disabled by default**.
WilliamOS shows their availability but will not delegate to them without operator action.

For details on enabling and using workers, see `50_AGENT_DOCK_EXTERNAL_WORKERS.md`.

---

## Recover from localhost:8420 Problems

**Problem: browser shows "Connection refused"**
```bash
python scripts/william.py control-center-status
# If not running:
python scripts/william.py control-center --no-open
```

**Problem: "Address already in use" on launch**
```bash
python scripts/william.py control-center-status
# If a WilliamOS process owns port 8420, it will be shown.
# If an unknown process owns it:
lsof -i :8420       # macOS/Linux
netstat -ano | findstr :8420  # Windows
# Kill the unknown process manually, then relaunch.
```

**Problem: page is blank or static files are missing**
```bash
cd control-center/frontend && npm run build
# Then relaunch:
python scripts/william.py control-center-restart --no-open
```

**Problem: 500 errors from the API**
```bash
# Check backend logs in the terminal where control-center is running.
# Run the smoke test to isolate the failure:
python scripts/william.py control-center-smoke
```

---

## Recover from Ollama / Model Problems

**Problem: model offline, chat returns no response**
```bash
# Check Ollama service
curl http://127.0.0.1:11434/api/tags
ollama list

# If Ollama is not running, start it:
ollama serve   # or use the Ollama desktop app

# If the primary model is missing:
ollama pull qwen2.5:14b-instruct-q4_K_M

# If the embed model is missing:
ollama pull nomic-embed-text
```

**Problem: Ollama is running but chat times out**

LLM timeout is set to 300 seconds in `control-center/backend/copilot/llm.py`.
If the 14B model is too slow for your hardware, consider:
- Closing other GPU/memory-heavy processes
- Using a smaller model (see `60_MODEL_RUNTIME_ADAPTER_PLAN.md`)

**Problem: RAG cites no sources**
```bash
# Rebuild the semantic index
python scripts/william.py semantic-index
python scripts/william.py semantic-status
```

---

## Key Validation Commands (Quick Reference)

```bash
# Read-only health checks
python scripts/william.py control-center-status
python scripts/william.py control-center-smoke
python scripts/william.py runtime-smoke
python scripts/william.py production-readiness

# Full test suite
python -m pytest control-center/backend/tests -q

# Rebuild frontend
cd control-center/frontend && npm run build
```
