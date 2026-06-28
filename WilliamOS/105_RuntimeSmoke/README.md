---
type: governance
status: active
area: runtime
created: 2026-06-16
tags:
  - runtime
  - smoke
  - governance
---

# 105_RuntimeSmoke

End-to-end runtime smoke suite for WilliamOS.

## Purpose

One command proves the entire runtime works. Runs safe versions of all status and check commands. No destructive actions. Never modifies source notes.

## Commands

```bash
python scripts/william.py runtime-status          # smoke suite summary
python scripts/william.py runtime-smoke --dry-run  # preview which commands would run
python scripts/william.py runtime-smoke            # run full smoke suite
```

## Files

- `README.md` — this file
- `SMOKE_POLICY.md` — rules for runtime smoke testing

## Engine

- `scripts/williamos_smoke.py` — runtime smoke suite
