# WilliamOS Runtime Operator Implementation Plan

> **For agentic workers:** Execute under `PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001`; stop at the owner credential gate.

**Goal:** Deploy a disabled-by-default, bounded GitHub Actions operator that can continuously execute owner-authored R0/R1 Work Orders after owner credential activation.

**Architecture:** GitHub Issues stores durable queue/checkpoint state. Codex receives no GitHub token and emits a schema-bound patch from a read-only sandbox. A separate publisher enforces policy, validates, attests, writes branches/PRs, and a serialized monitor handles remediation and eligible merge.

**Tech Stack:** GitHub Actions, GitHub REST/GraphQL APIs, Node.js ESM, Vitest, official `openai/codex-action`.

## Global Constraints

- Repository and actor allowlists are fixed to `bsvalues/terragroq` and `bsvalues`.
- Only R0/R1 exact-path Work Orders are eligible.
- The global kill switch defaults off.
- No secrets enter repository content or Codex output.
- No PACS, county, production mutation, destructive Git, or authority self-expansion.

## Tasks

- [x] Define typed queue, policy, lease, checkpoint, prompt, and result contracts.
- [x] Add adversarial unit tests before implementation.
- [x] Implement deterministic leasing and policy denial reason codes.
- [x] Implement read-only Codex and isolated publish workflow.
- [x] Implement check/review monitor, three-retry ceiling, and eligible merge.
- [x] Add attestation, kill switch, `/stop`, recovery, and audit runbook.
- [ ] Validate, review, merge, and deploy with the switch off.
- [ ] Stop for owner-only `OPENAI_API_KEY` creation.
- [ ] Enable the switch and complete the low-risk pilot.
