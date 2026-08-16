# WO-EF-SHADOW-004 authority scope contract

Issue: `#538`

This packet defines—but does not activate—the replacement HERMES local-inference observation after
WO-EF-SHADOW-002 was quarantined for premature authority sequencing.

## Bound scope

- Work Order: `WO-EF-SHADOW-004`
- Scope ID: `issue-538-phase2-scope-004`
- Risk: `R0_LOCAL_PROOF`
- Provider: `resident-hermes`
- Producer identity: `resident-hermes@hermes-node`
- Canonical node: `hermes-node`
- Task template: `existing-loopback-llm-inference-v1`
- Workload: `gpu-local-inference`
- Model: `llama3.2:3b`
- Maximum calls: `1`
- Timeout: `60 seconds`
- Expected marker: `HERMES_SHADOW_004_OK`
- Fixed prompt SHA-256: `3c2f8c0b465b96600a46f27abfb9b112d5dd9142e8e529e50ced5770175a166f`

Agent Forge binds this as `LOCAL_PROOF_BY_OPERATOR / operator-only`; it does not activate a runtime,
skill, tool bridge, worker, scheduler, or autonomous loop. The bound permission source is
`components/agent-forge/agent-forge-surface.ts` at SHA-256
`c8059e2a5ff4412c611c0e6e20b3e4fd728268e036ee309bc43b0754f9e76fde`.

> Provenance note (2026-08-16): that digest was computed on a CRLF checkout of the source. The
> canonical (LF, `git show b1a275e:components/agent-forge/agent-forge-surface.ts`) digest of the same
> reviewed content is `38dbbbeb2fa9ab003e69e540ce346a4849d964d0d92e49944f1b85c5ff5a714f`. Both name the
> same bytes modulo line endings; the sealed contract is left as reviewed because this authority
> expired 2026-08-11 and its review commit is pinned by sealed shadow evidence. Verify with either.

## Activation boundary

This contract grants no execution authority. A later, separate PR must add a future-dated authority
registry entry whose `reviewed_commit` is the merged commit containing this exact scope packet. That
activation must merge before its effective time. Only then may a fresh placement receipt be retained
and the bounded operator-selected local proof execute.

Brain Council remains advisory only. Scheduler and autonomous dispatch remain off.
