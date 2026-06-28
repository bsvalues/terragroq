---
type: governance
status: active
area: commands
created: 2026-06-16
tags:
  - commands
  - governance
---

# 104_CommandRegistry

Command registry and discoverability layer for the WilliamOS CLI.

## Purpose

Catalogs all CLI commands with their purpose, safety classification, and output. Reconciles command count across documentation. Never modifies source notes.

## Commands

```bash
python scripts/william.py command-status     # registry summary
python scripts/william.py command-report     # generate full command report
python scripts/william.py command-report --dry-run  # preview without writing
python scripts/william.py help-all           # print all commands grouped
```

## Files

- `README.md` — this file
- `COMMAND_REGISTRY_POLICY.md` — rules for command registration

## Engine

- `scripts/williamos_commands.py` — command registry and report generator
