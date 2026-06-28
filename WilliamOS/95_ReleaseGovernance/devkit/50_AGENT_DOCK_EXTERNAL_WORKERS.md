---
type: feature-guide
feature: agent-dock
phase: 5D
generated: 2026-06-24
tags:
  - devkit
  - workers
  - delegation
---

# Agent Dock / External Workers Guide — Phase 5D

> **Governing rule:**
> External workers may propose. They may not directly write, commit, promote, delete,
> or mutate canon. Any actual change requires a separate WilliamOS-reviewed action.
>
> WilliamOS is the control plane. Workers are proposal engines.

---

## Control Model

```
Bill → WilliamOS (asks)
WilliamOS → classifies task, identifies eligible workers
WilliamOS → proposes delegation to Bill
Bill → approves delegation
WilliamOS → runs availability check on worker
Worker → executes proposal (read-only access, captures evidence)
Worker → returns output + evidence
WilliamOS → displays diff/output for review
Bill → approves or denies any write/commit/promote step
WilliamOS → records evidence regardless of approval outcome
```

At no point does a worker execute without Bill's approval. At no point does a
worker commit, write to disk, or promote canon on its own authority.

---

## Worker Registry

The worker registry lives at:
```
control-center/backend/worker_registry.json
```

### Registered Workers

| Worker | Kind | Status | Delegatable |
|--------|------|--------|-------------|
| Claude Code | external_code_worker | Disabled (available when `claude` CLI installed) | No (until enabled) |
| Codex | external_code_worker | Disabled (available when `codex` CLI installed) | No (until enabled) |
| Hermes | external_agent_worker | Disabled (available when `hermes` CLI installed) | No (until enabled) |
| Ollama | local_model_runtime | Enabled | Not delegatable (runtime only) |
| WilliamOS | control_plane | Enabled | Governor — not a delegated worker |

### Worker States

| State | Meaning |
|-------|---------|
| `enabled: false` | Worker will not be selected for delegation even if available |
| `enabled: true` + available | Worker appears in delegation candidates |
| Unavailable | Availability check failed (CLI not found, service unreachable) |
| `kind: local_model_runtime` | Not a delegatable worker — Ollama is a runtime resource |
| `kind: control_plane` | WilliamOS itself — the governor, not a worker |

**All external workers are disabled by default.** Enabling a worker requires
explicit operator action in the registry file and explicit proposal execution
configuration (CLI invocation setup).

---

## Availability Checks

Each worker has an availability check that runs when the Workers panel loads:

```json
"availability": {
  "command": "claude",
  "args": ["--version"],
  "timeout_seconds": 8,
  "expected_contains": "Claude Code"
}
```

- If the command times out or is not found: status = `unavailable`
- If the output does not contain `expected_contains`: status = `unavailable`
- If the check passes: status = `available`

Disabled workers still run availability checks — they show as `available (disabled)`
so the operator can see which workers could be used without enabling them.

---

## Delegation Request Flow

**Step 1 — Operator initiates:**
Bill asks WilliamOS (via chat) to delegate a task to a worker.

**Step 2 — WilliamOS classifies:**
The agent loop identifies the task type and checks the registry for eligible workers
(enabled + available + task in `allowed_tasks`).

**Step 3 — Delegation review event:**
WilliamOS creates a delegation review event containing:
- Worker ID and label
- Task description and scope
- Authority boundaries (read-only, no write, no commit, no promote)
- Approve and Deny buttons

**Step 4 — Bill approves or denies:**
- **Deny:** No delegation. Evidence records `denied_no_delegation`. No worker runs.
- **Approve:** Intent is recorded as `approved_intent_recorded`. No worker runs yet.

**Step 5 — Proposal execution (separate action):**
After approval, a **Run Proposal** button appears. Bill clicks it to run the worker.
Approval does not automatically execute.

**Step 6 — Worker runs:**
The worker executes its proposal with read-only access. Evidence is captured.

**Step 7 — Evidence review:**
WilliamOS displays the worker's output, diff, and git status. Bill reviews.

**Step 8 — Apply or reject:**
Any write, commit, or promotion step requires a separate explicit approval.
The worker cannot apply its own output.

---

## Delegation Approval Event Shape

```json
{
  "worker_id": "claude-code",
  "task": "Review test_tools.py and propose missing test cases",
  "scope": "control-center/backend/tests/test_tools.py",
  "authority": "proposal_only",
  "may_write": false,
  "may_commit": false,
  "may_promote": false,
  "reason": "Operator requested code review",
  "approve_label": "Approve Delegation",
  "deny_label": "Deny",
  "execution_state": "pending_approval",
  "created": "2026-06-24T15:00:00"
}
```

---

## Required Evidence Fields

Every completed worker proposal must capture:

| Field | Description |
|-------|-------------|
| `command_preview` | Exact command that would run (shown before execution) |
| `stdout` | Full standard output from the worker |
| `stderr` | Full standard error output |
| `return_code` | Exit code from the worker process |
| `timeout` | Whether the worker timed out |
| `summary` | Worker's plain-English summary of its proposal |
| `files_touched` | Files the worker read (read-only; writes are not permitted) |
| `patch_or_diff` | Unified diff of any proposed changes (not applied) |
| `test_results` | Test output if the worker ran tests |
| `logs` | Additional worker logs |
| `git_status_before` | Output of `git status --short` before execution |
| `git_status_after` | Output of `git status --short` after execution |

If `git_status_after` differs from `git_status_before`, the event is flagged as
`proposal_boundary_violation_git_changed` and the worker output is quarantined.
No worker is permitted to mutate the repo during a proposal run.

---

## Worker Task Categories

| Category | Description | Permitted Workers |
|----------|-------------|-------------------|
| `code_review` | Review code and propose improvements | Claude Code, Codex |
| `implementation_plan` | Propose an implementation approach | Claude Code, Codex, Hermes |
| `patch_proposal` | Propose a code patch (unified diff) | Claude Code, Codex |
| `test_failure_analysis` | Analyze failing tests and propose fixes | Claude Code, Codex, Hermes |
| `local_agent_review` | General local agent analysis | Hermes |
| `local_reasoning` | LLM reasoning (not delegatable task) | Ollama (runtime) |
| `tool_routing` | Command routing (not delegatable task) | Ollama (runtime) |
| `vault_rag` | RAG retrieval (not delegatable task) | Ollama (runtime) |
| `governed_command_execution` | WilliamOS command execution | WilliamOS (control plane) |

---

## Blocked Paths (All Workers)

No external worker may access these paths:
```
.env
.env.*
secrets
credentials
*.key
*.pem
copilot.db
```

These are enforced in the `scope_policy.blocked_paths` for every external worker
entry in the registry. Attempts to access blocked paths are rejected before execution.

---

## Enabling an External Worker

To enable Claude Code as a proposal-only worker:

1. Ensure the `claude` CLI is installed:
   ```bash
   claude --version
   ```
2. Edit `control-center/backend/worker_registry.json`:
   - Set `"enabled": true` for the claude-code worker
   - Configure `proposal_execution.enabled: true`
   - Set the exact CLI invocation in `proposal_execution`
3. Restart the Control Center.
4. Verify the worker shows as `available (enabled)` in the Workers panel.

**Warning:** Enabling a worker does not grant it write authority. The delegation
policy (`may_write: false`, `may_commit: false`, `may_promote: false`) is enforced
regardless of the `enabled` flag.

---

## Workers Panel (UI)

The Workers panel on Operator Home shows:
- Each worker's name, kind, and current status
- Allowed task categories
- Delegation policy (confirm-required, proposal-only)
- Latest run result (if any)
- Git-unchanged proof from the latest run

For approved-but-not-run proposals:
- Command preview
- Run button
- Cancel button

For completed proposals:
- Output summary
- Git status (before and after)
- Link to full evidence in History

---

## Phase 5D Acceptance Tests

The following scenarios are covered by unit tests in
`control-center/backend/tests/`:

- Disabled worker returns `delegation_not_allowed`
- Unavailable worker cannot be selected for delegation
- Approved delegation records `approved_intent_recorded` without executing
- Denied delegation records `denied_no_delegation`
- Proposal execution captures all required evidence fields
- Git repo mutation during proposal is flagged as boundary violation
- Cancel clears approved-but-not-run proposal state
- Timeout/failure paths record evidence cleanly
