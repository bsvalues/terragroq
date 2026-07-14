# WilliamOS Agent Entrypoint

This file is a repository entrypoint, not an independent authority source. The controlling
multi-agent operating doctrine is
[`docs/governance/multi-agent-operator-playbook.md`](docs/governance/multi-agent-operator-playbook.md).
Follow that playbook and the active, authority-matched Work Order. If this file and the playbook
conflict, stop the conflicting action and follow the playbook.

## Owner boundary

William is the owner only. William is not an agent, operator, dispatcher, test runner, Git or
GitHub operator, credential courier, diagnostic courier, or routine approver.

Agents own routine execution inside recorded authority: investigation, implementation, tests,
branches, commits, pushes, pull requests, review remediation, CI monitoring, authorized merges,
cleanup, recovery, evidence, and dependent release. Ask William only for a genuinely new authority
decision identified by the playbook. Do not ask him to run commands, relay output, restart software,
repair provider access, or make an implementation choice already covered by the active authority.

Continue through routine problems and report a final verified outcome. Do not turn ordinary status,
recoverable failures, agent coordination, or already-decided doctrine into back-and-forth with the
owner.

## Multi-agent execution

For substantial work, Codex must use bounded native subagent fan-out when independent lanes exist:

1. A coordinator decomposes work by dependency and reservation.
2. Builders receive separate non-overlapping file, contract, and environment reservations.
3. An independent assurance agent reviews evidence and changes without taking a builder reservation.
4. The coordinator integrates results, owns the GitHub lifecycle, and continues until the authorized
   outcome or a typed terminal state.

Do not serialize dependency-cleared, non-overlapping work merely because Work Order numbers are
sequential. Never assign two builders the same reservation. A subagent may not expand scope or mint
authority.

Claude Code may run only as a separate provider lane through an already authenticated, supported
surface. Give it a separate repository or isolated suite reservation, branch/worktree, validation,
evidence, and reviewer. If Claude is unavailable, classify that lane as provider-unavailable and let
healthy Codex lanes continue; do not ask William to launch, authenticate, or repair Claude.

## Rejected runtime

The nested local Codex adapter evidenced by issue #357 is terminal and rejected. Do not retry,
reactivate, wrap, rename, or reuse it. Issue #358 remains dependency-blocked. The local WilliamOS
runtime and supervisor remain disabled unless a future, independently proven transport and explicit
authority establish a different adapter.

## Instruction narrowing

Directory-local `AGENTS.md` files may narrow implementation details for their subtree. They may not
redefine the owner boundary, enable the rejected runtime, weaken reservation isolation, suppress
native fan-out, or create authority beyond the active Work Order and recorded authority evidence.
