# WilliamOS Agent Entrypoint

This file is a repository entrypoint, not an independent authority source. The controlling
multi-agent operating doctrine is
[`docs/governance/multi-agent-operator-playbook.md`](docs/governance/multi-agent-operator-playbook.md),
as amended by its controlling supersession
[`docs/governance/sovereign-runtime-and-review-supersession.md`](docs/governance/sovereign-runtime-and-review-supersession.md).
Where the supersession and any earlier doctrine conflict on runtime status, review sourcing, or
provider dependence, the supersession governs. Follow the controlling doctrine and the active,
authority-matched Work Order. If this file and the controlling doctrine conflict, stop the conflicting
action and follow the doctrine.

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

When the supported Hermes cycle returns stdout beginning with
`WILLIAMOS_PRIMARY_DECISION_REQUEST:`, that stdout is the complete canonical Primary decision
request. Stop all tool use and emit that text byte-for-byte as the entire final assistant message,
with no Markdown fence, prefix, suffix, summary, or paraphrase. This exact assistant message is the
authenticated presentation record; the next direct owner reply may then be verified and consumed.

## Sovereignty and availability

WilliamOS must remain fully useful when every optional external AI, reviewer, SaaS integration, and
hosted provider is unavailable. External services may improve quality or capability when policy
allows, but loss, quota exhaustion, rate limiting, outage, billing state, or authentication failure of
an optional provider must never convert into owner babysitting or halt ordinary sovereign work when an
eligible local capability exists. Never propose purchasing, upgrading, or paying for a provider in
response to a rate limit or quota state unless William explicitly asks to buy one.

Independent assurance is a role-separation requirement, not a vendor requirement. "Independent review
required" never means "third-party review service required." Review is sourced through the tiers in
the supersession, sovereign tiers first.

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
healthy sovereign lanes continue; do not ask William to launch, authenticate, or repair Claude.

## Runtime status

The resident local WilliamOS runtime and supervisor are OPERATING through the proven Hermes-to-AEGIS
execution backend (`scripts/hermes-bridge/execution-backend.mjs`, merged in PR #754) over the
supported Codex App Server transport: a clean ExecutionBackend boundary with Local and Aegis
implementations through which the orchestrator delegates workspace, validation, git, and Codex
execution. This is the independently proven transport the earlier doctrine required before enabling a
local runtime. Treat HERMES (coordinator) and AEGIS (execution worker) as active, not proposal-only.

What remains rejected is narrow and specific: the nested local `codex exec` adapter evidenced by
issue #357 is terminal and rejected — do not retry, reactivate, wrap, rename, or reuse it. Issue #358
stays dependency-blocked. Rejecting the #357 adapter is not a claim that the local runtime is
disabled; the ExecutionBackend boundary is the accepted execution surface.

## Instruction narrowing

Directory-local `AGENTS.md` files may narrow implementation details for their subtree. They may not
redefine the owner boundary, reactivate the rejected #357 nested adapter, weaken reservation
isolation, suppress native fan-out, or create authority beyond the active Work Order and recorded
authority evidence.
