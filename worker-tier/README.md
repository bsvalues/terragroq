# WilliamOS Worker Tier — SEA + CAPG

Bounded, deterministic developer tooling for small / local coding workers. Two stdlib-only,
model- and runtime-agnostic Python packages that make a weak local model dependable by moving
reliability and command-safety into deterministic code *around* the model.

> **Not a runtime.** These are libraries + CLIs with no daemon, supervisor, or persistent
> adapter. They do **not** reactivate, wrap, or rename the disabled local WilliamOS runtime /
> nested local Codex adapter (issues #357 / #358, terminal and rejected). They are ordinary
> bounded tools a controller (Codex / Hermes) calls over its own authenticated surface.

## `sea` — Structured-Edit Adapter
The model emits only validated structured JSON edits; a deterministic adapter validates
(path-safe, `old_text` unique), applies **atomically** (snapshot / rollback), and **verifies**
(compile + tests). Malformed / unverifiable output is rejected and repaired within a bounded
retry budget; if nothing verifies, the workspace is **restored (fail-closed)** — never a silent
partial write. Roles: `worker`, `review`, `remediate`.

## `capg` — Command Approval Policy Gate
Deterministic DENY / ASK / ALLOW classifier for shell commands, **fail-closed by default**
(anything unrecognized → ASK, never ALLOW). Catches destructive ops, exfiltration, lateral
movement, remote-code-exec, privilege escalation, and system mutation. Ships a `pre_tool_call`
hook shape so a controller can gate every command **before** it runs.
CLI: `python3 -m capg "<cmd>"` exits `0` / `2` / `3` = ALLOW / ASK / DENY.

## Layered control (design intent)
```
controller model -> CAPG policy gate -> SEA edit/apply/verify -> runtime containment -> host backstop
```
No layer trusts the one above it.

## Tests (stdlib only; no build, no dependencies)
```
python3 -m unittest discover -s tests   # 38 tests
```

## Provenance
Derived from the Pilot-0 caged-Hermes evaluation: SEA drove a local 8B model through a full
edit / review / remediate lifecycle with every change deterministically verified; CAPG blocked
live exfiltration and lateral-SSH attempts that the model's own approval classifier had allowed.
