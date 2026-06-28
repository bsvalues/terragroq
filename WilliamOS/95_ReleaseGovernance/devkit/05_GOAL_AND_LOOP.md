---
type: devkit-agent-prompt
version_target: v1.3.0
phase_6_status: blocked
generated: 2026-06-24
tags:
  - devkit
  - goal
  - loop
  - governance
---

# WilliamOS — /goal and /loop for Future Agents

> **READ THIS FIRST.** Any agent, subagent, or automated process working on WilliamOS
> must read this document before touching any file, running any command, or drafting
> any plan. This is the controlling execution document.

---

## /goal

### Mission

WilliamOS is a local-first governed operator system. The mission of every future
agent that modifies it is to preserve, harden, document, or extend the accepted
system without losing governance discipline.

This is not a feature-expansion mandate. Agents do not add intelligence. Agents
do not add autonomy. Agents do not add cloud capability. Agents document what
exists, harden what is fragile, and extend scope only when Bill explicitly authorizes it.

### North Star

```
WilliamOS is local-first.
WilliamOS is evidence-backed.
WilliamOS is approval-gated.
WilliamOS is recoverable.
WilliamOS is auditable.
WilliamOS is worker-aware.
WilliamOS has no hidden authority.
```

### Current Production Baseline

The accepted system includes:
- Phase 1: Brain + Chat
- Phase 2: Briefing + Watchdog
- Phase 3: Capture + Memory
- Phase 4: Vault RAG
- Phase 4.5: Response Streaming
- Phase 5A: No-Slop Operator Shell
- Phase 5B: Launcher Runtime
- Phase 5C: Research Drop Zone
- Phase 5D: Agent Dock / External Worker Registry

Governing line:
```
WilliamOS delegates.
Workers propose.
WilliamOS records evidence.
Bill approves writes/promotions/commits.
```

### Stop Conditions

Stop immediately and report to Bill if any of the following occur:

1. A task requires Phase 6 behavior (proactive intelligence, autonomous initiation).
2. A task requires external worker write authority.
3. A task requires automatic commit, promotion, or canon mutation.
4. A task requires cloud fallback by default.
5. A task requires provider relay switching without explicit approval.
6. A task touches unrelated dirty or untracked files.
7. A task tries to clean daily notes or personal vault state without explicit approval.
8. A task attempts to tag v1.3.0 from a dirty tree.
9. A task weakens `safety.check_command` or `command_runner` boundaries.
10. A task introduces broad phrase routing or a second hidden command system.

### Allowed Scope (default)

Without explicit amendment, agents may:
- Create or edit files under `WilliamOS/95_ReleaseGovernance/devkit/`
- Create or edit documentation files under `docs/`
- Read any file in the repo
- Run read-only validation commands
- Propose commits of documentation-only changes

### Forbidden Scope (default)

Without explicit amendment, agents must not:
- Modify `control-center/backend/` Python files
- Modify `control-center/frontend/` source files
- Modify `scripts/william.py` or any script
- Modify `control-center/backend/worker_registry.json`
- Stage or commit unrelated dirty files
- Create the `v1.3.0` tag
- Enable any external worker's `execution_enabled` flag
- Enable any cloud runtime fallback

---

## /loop

### Execution Mode

```
Read → Plan → Draft → Verify → Gate → Record → Stop or Continue
```

Each loop must be small enough to review. Do not bundle unrelated cleanup,
feature work, release tagging, and Dev Kit docs into one move.

### Loop Rules

**Step 1 — Check current state before every loop:**
```bash
git status --short
git log -1 --oneline
```

**Step 2 — Confirm Phase 6 is blocked:**
```
If Phase 6 appears enabled or in progress anywhere, stop and report to Bill.
```

**Step 3 — Verify scope:**
- Confirm the planned work falls within allowed scope.
- If it does not, stop and ask Bill for explicit authorization.

**Step 4 — Work in small increments:**
- One logical change or document per loop.
- Do not touch unrelated dirty or untracked files.
- Do not implement feature code unless the work order is explicitly amended.

**Step 5 — After each document set is drafted, check for whitespace errors:**
```bash
git diff --check
```

**Step 6 — Run validation (minimum):**
```bash
python scripts/william.py production-readiness
```

**Step 7 — Preferred full validation:**
```bash
python scripts/william.py runtime-smoke
python scripts/william.py production-readiness
```

**Step 8 — Before committing, prove scope:**
```bash
git status --short
git diff --stat
```

**Step 9 — Commit only the scoped files:**
- Stage only the files that belong to this work order.
- Never `git add .` unless explicitly authorized.
- Use a precise commit message following Conventional Commits.

**Step 10 — Stop after commit and report:**
```
- Files created or modified
- Validation output (pass/fail)
- Commit SHA
- Remaining blockers
- Whether Phase 6 remains blocked
```

### Validation Expectations

| Gate | Command | Minimum Threshold |
|------|---------|-------------------|
| Backend tests | `python -m pytest control-center/backend/tests -q` | All pass |
| Frontend build | `cd control-center/frontend && npm run build` | Build succeeds |
| Control-center smoke | `python scripts/william.py control-center-smoke` | 22/22 |
| Runtime smoke | `python scripts/william.py runtime-smoke` | 0 critical |
| Production readiness | `python scripts/william.py production-readiness` | 10/10 PASS |

### Commit Expectations

For Dev Kit documentation work:
```
docs(devkit): add WilliamOS v1.3.0 production playbook
```

For post-release hardening:
```
docs(devkit): <specific description of what changed>
```

For any feature increment:
```
feat(<scope>): <imperative description>
test(<scope>): <test description>
```

### Phase 6 Block

Phase 6 (Proactive Intelligence) is **BLOCKED** until Bill explicitly authorizes
the following sequence:

1. Bill states: "Begin Phase 6."
2. Agent reads current baseline and confirms scope.
3. Agent proposes SUCCESS CRITERIA and TEST PLAN before any implementation.
4. No Phase 6 code is written until Bill approves the test plan.

Phase 6 cannot be unlocked by:
- A work order that mentions Phase 6 incidentally
- An agent interpreting "push further" as authorization
- Any automated or scheduled process
- Any external worker

Phase 6 status is recorded in `devkit-manifest.json` under `"phase_6_status": "blocked"`.
This field must not be changed without Bill's explicit instruction.
