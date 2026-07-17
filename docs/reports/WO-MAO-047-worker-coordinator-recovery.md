# WO-MAO-047 — Worker and Coordinator Recovery

Result: `PASS`

## Scope

WO-MAO-047 proves a sealed, zero-input worker/coordinator recovery control-plane model for the
multi-agent operator program. It models recovery from worker or coordinator death before write,
during edit, after commit, after push, and with a PR open.

The proof is static and deterministic. It does not add a runtime scheduler, execute a provider, call
GitHub, write production state, mutate durable state, control processes, activate runtime, allow
concurrent writers, or grant authority.

## Evidence

- Script: `scripts/multi-agent-operator/worker-coordinator-recovery.mjs`
- CLI: `scripts/multi-agent-operator/worker-coordinator-recovery-cli.mjs`
- Tests: `tests/multi-agent-worker-coordinator-recovery.test.ts`
- Typed evidence: `components/operator/multi-agent-worker-recovery-registry.ts`

Canonical plan hash:
`d74b5b5702d86333a9e4a535c1780453e02122a58d998f1bc1b86e57cbc1efd6`

Canonical result hash:
`677aa418c40a7a5429a1d703b460a01599aef9fbbd135e54eb521f2a1d7ac8cd`

Typed evidence hash:
`a3196e4a46dfe4fd64e45ab316bb1216ea37b022d0b999ec18842a0ca7683667`

## Acceptance

- Verified dependency references: `WO-MAO-021`, `WO-MAO-025`, `WO-MAO-030`, `WO-MAO-031`, and `WO-MAO-046`.
- Durable sources: lease ledger, checkpoint ledger, isolated workspace record, repository ref state, and PR linkage record.
- Recovery points: death before write, during edit, after commit, after push, and with PR open.
- Resume source: durable state only.
- Single-writer requirement: enforced by lease, checkpoint, workspace, commit, remote ref, and PR linkage fences.
- Missing or ambiguous durable state produces a typed blocked/terminal recovery decision instead of concurrent writers.
- Changed paths remain inside the five-file worker reservation.
- Foreign changes: `0`.
- Secret-like findings in the canonical plan: `0`.

## Safety

- Scheduler added: `false`.
- Provider execution performed: `false`.
- GitHub API called: `false`.
- GitHub write performed: `false`.
- Production write performed: `false`.
- Runtime activation allowed: `false`.
- Process control performed: `false`.
- Command runner added: `false`.
- Background worker added: `false`.
- State mutation performed: `false`.
- Secret material allowed: `false`.
- Concurrent writers allowed: `false`.
- Owner operation required: `false`.
- Authority granted: `false`.

## Worker Boundary

No shared resolver, capability, active queue, goal registry, rollup file, or integration file was
modified by this worker slice. Integration into shared MAO registries remains a coordinator task.
