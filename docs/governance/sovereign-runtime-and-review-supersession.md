# Sovereign Runtime and Review Supersession

**Document:** `WILLIAMOS-SOVEREIGN-RUNTIME-REVIEW-SUPERSESSION-001`

**Status:** `ACTIVE / CONTROLLING`

**Supersedes:** the "hosted-proof-first, local runtime disabled" assumptions in
[`multi-agent-operator-playbook.md`](multi-agent-operator-playbook.md) and
[`codex-operator-playbook.md`](codex-operator-playbook.md).

**Ratified:** 2026-08-13 by William (owner).

Where this document and any earlier governance document conflict on runtime status, review sourcing,
or provider dependence, this document governs. It changes stale *assumptions*; it does not weaken the
Owner-Only Constitution, which remains fully in force.

## 1. What changed

The bootstrap doctrine deliberately proved a hosted Codex team before committing to a durable local
runtime, and its audited baseline recorded Codex, Claude, and Hermes as disabled or proposal-only.
That was a correct bootstrap strategy for its moment. It is no longer the architecture, and a
June/July-era baseline must not keep controlling an August system where HERMES and AEGIS are actually
executing.

The Hermes-to-AEGIS execution backend is merged and operating (PR #754,
`scripts/hermes-bridge/execution-backend.mjs`): a clean `ExecutionBackend` boundary with `Local` and
`Aegis` implementations, through which the orchestrator delegates workspace, validation, git, and
Codex execution. The resident HERMES supervisor runs the cycle through it. The "future, independently
proven transport" the old doctrine waited for has arrived.

## 2. Architecture (current, controlling)

- **WilliamOS** — the operating system / coordinator.
- **HERMES** — resident control plane and local agent/runtime capability: coordination, placement,
  authority, lifecycle state, evidence.
- **AEGIS** — execution worker: Codex builder; build/test/lint/typecheck; the git lifecycle; and
  isolated independent-reviewer contexts.
- **ATLAS** — durable state, evidence, and knowledge.
- **OMEN** — cockpit / optional compute.

Cloud models and SaaS tools — CodeRabbit, Sourcery, hosted GitHub analysis, and any hosted LLM
including Claude — are optional capability extensions, never foundations.

## 3. Two central principles

**Sovereignty and availability.** WilliamOS must remain fully useful when every optional external AI,
reviewer, SaaS integration, and hosted provider is unavailable. External services may improve quality
or capability when policy allows, but loss, quota exhaustion, rate limiting, outage, billing state, or
authentication failure of an optional provider must never convert into owner babysitting or halt
ordinary sovereign work when an eligible local capability exists.

**Independent assurance is a role-separation requirement, not a vendor requirement.** The requirement
is that review is performed by a context separate from the builder — not that any particular third
party performs it.

## 4. Review hierarchy (canonical)

Review is satisfied by tiers. Higher tiers are required where noted; lower tiers are additive and
never required to proceed.

- **Tier 0 — deterministic (required):** tests, lint, typecheck, build, static policy, and
  diff/scope verification. These must pass.
- **Tier 1 — sovereign independent review (required for R0/R1 and above):** a reviewer role in a
  context separate from the builder, given the read-only diff, the requirements, and the tests. AEGIS
  can run multiple isolated agent contexts, so a sovereign reviewer is normally available for routine
  work.
- **Tier 2 — cross-model review (when available):** a different approved model — Nous Hermes Agent,
  another Codex context, Claude, or another approved local or hybrid model.
- **Tier 3 — external advisory (optional):** CodeRabbit, Sourcery, hosted analysis. Adds information;
  may never be required to proceed.

If an external advisory reviewer returns nothing because its quota, rate limit, authentication, or
billing is exhausted, the state is `EXTERNAL_REVIEW_UNAVAILABLE` — **not** `REVIEW_NOT_DONE`. These
are different states. Do not stall, do not drop quality below the sovereign tiers, and do not propose
paying for or upgrading a provider unless William explicitly asks to buy one.

## 5. Capability roles, not named providers

Runtimes request capability *roles*; WilliamOS resolves each to a currently available worker:

`IMPLEMENTATION_WORKER`, `INDEPENDENT_CODE_REVIEWER`, `SECURITY_REVIEWER`, `PRODUCT_REVIEWER`,
`TEST_RUNNER`, `RESEARCHER`.

Example resolution for `INDEPENDENT_CODE_REVIEWER`: local Codex subagent → else Hermes Agent → else
approved Claude → else external advisory (optional) → else typed `REVIEW_CAPABILITY_UNAVAILABLE`.
Routine R0/R1 work should normally have at least one sovereign reviewer available, because AEGIS can
run multiple isolated contexts. Name providers only inside capability resolution — never as the
requirement itself.

## 6. Preserved unchanged

Owner-Only Constitution; final-only communication; agents own the routine GitHub lifecycle;
independent review over builder self-certification; typed failures instead of asking William;
reservations, authority, evidence, and retry/recovery. This supersession changes only *where those
capabilities come from* — never that they are required.

## 7. Still rejected

The nested local `codex exec` adapter of issue #357 remains terminal and rejected. This supersession
does not reopen it. The accepted execution surface is the `ExecutionBackend` boundary (PR #754).
