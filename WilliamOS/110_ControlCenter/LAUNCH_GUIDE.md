---
type: governance
status: active
area: control-center
tags:
  - governance
  - control-center
  - launch
---

# WilliamOS Control Center — Launch Guide

## Daily Start

```
william control-center
```

That's it. One command:
- Builds the frontend if no build exists
- Starts the backend server
- Serves the UI on http://localhost:8420
- Opens your browser
- Prints the next recommended action
- Waits for Ctrl+C to stop

## Options

| Command | What it does |
|---------|-------------|
| `william control-center` | Start everything, open browser |
| `william control-center --no-open` | Start without opening browser |
| `william control-center-stop` | Stop the server |
| `william control-center-status` | Check if running |
| `william control-center-build` | Rebuild the frontend |
| `william control-center-smoke` | Run 22-point health check |

## How It Works

The backend (FastAPI on port 8420) serves both the API and the built React frontend. There is no separate frontend process needed. One server, one port, one URL.

## Stopping

Press Ctrl+C in the terminal where you started it, or:

```
william control-center-stop
```

## Ports

| Port | Service |
|------|---------|
| 8420 | Control Center (API + UI) |

If port 8420 is already in use by a previous session, the launcher detects it and reuses it (if healthy).

## Troubleshooting

**"Port 8420 in use but not healthy"**
Kill the stale process:
```powershell
Get-NetTCPConnection -LocalPort 8420 | Select OwningProcess
Stop-Process -Id <PID>
```

**Frontend shows blank page**
Rebuild:
```
william control-center-build
```

**Smoke test fails**
```
william control-center-smoke
```
Read the output — it tests 22 specific checks and tells you which failed.
