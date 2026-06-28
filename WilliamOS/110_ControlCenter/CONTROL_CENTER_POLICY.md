---
type: governance
status: active
area: control-center
tags:
  - governance
  - control-center
  - policy
---

# Control Center Policy

## Purpose

The Control Center is a local-only web cockpit. It makes the WilliamOS CLI accessible through a browser so William can see status, capture thoughts, review drafts, and run safe commands without memorizing 86+ CLI commands.

## Boundaries

1. The Control Center **reads** vault state directly (JSON files, folder counts, git info).
2. The Control Center **runs CLI commands** only through the safety gate (`safety.py`).
3. The Control Center **never modifies files directly** — all writes go through `william.py`.
4. The operator agent is **deterministic and local** — no external LLM, no network calls.
5. The frontend is **local-only** — no remote hosting, no cloud, no auth.

## What the Control Center May Not Do

- Push to any remote
- Delete any note
- Modify official folders directly
- Run forbidden commands
- Accept drafts without explicit user confirmation
- Create background daemons
- Store secrets, tokens, or credentials
- Make network requests to external services
