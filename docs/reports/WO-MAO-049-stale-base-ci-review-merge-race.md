# WO-MAO-049 - Stale-base, CI, Review, and Merge-race Drill

Result: `PASS`

## Scope

WO-MAO-049 proves a sealed, zero-input stale-base, CI, review, and merge-race
drill for the multi-agent operator program.

The proof is static and deterministic. It does not add a runtime scheduler,
execute a provider, call GitHub, rebase a branch, rerun CI, resolve review
threads, merge a PR, write production state, mutate durable state, activate
runtime, or grant authority.

## Evidence

- Script: `scripts/multi-agent-operator/stale-base-ci-review-merge-race.mjs`
- CLI: `scripts/multi-agent-operator/stale-base-ci-review-merge-race-cli.mjs`
- Tests: `tests/multi-agent-stale-base-ci-review-merge-race.test.ts`
- Typed evidence: `components/operator/multi-agent-merge-race-registry.ts`

Canonical plan hash:
`c4fac68042a360532806aeb94248e52a58fa10c76d388fe217c15827b4c294bf`

Canonical result hash:
`1ca6498b80222b9134a2e3fb70be03d01fa0f0c38a816fa3c6daedb59843d838`

Typed evidence hash:
`bd60b180b454fef0288e61e9452a81bcc63dbda0c5e826c30162adad8e672671`

## Acceptance

- Verified dependency references: `WO-MAO-039`, `WO-MAO-040`, `WO-MAO-041`, and `WO-MAO-046`.
- Stale-base controls: base ref moved, merge head mismatch, and branch protection changed.
- Rebase/revalidation policy: refresh and fully revalidate where allowed; stop stale candidates otherwise.
- Deterministic CI/review failures return to the original builder for repair and re-review.
- Flaky infrastructure retry budget: exactly `1` classified rerun.
- Merge-race guards: expected head SHA, required checks after refresh, zero unresolved review threads, and idempotency merge fence.
- Stale or concurrently changed candidates are denied instead of merged.
- Changed paths remain inside the five-file worker reservation.
- Foreign changes: `0`.
- Secret-like findings in the canonical plan: `0`.

## Safety

- Scheduler added: `false`.
- Provider execution performed: `false`.
- GitHub API called: `false`.
- Rebase performed: `false`.
- CI rerun performed: `false`.
- Review thread resolved: `false`.
- Merge performed: `false`.
- Production write performed: `false`.
- Runtime activation allowed: `false`.
- Command runner added: `false`.
- Background worker added: `false`.
- State mutation performed: `false`.
- Secret material allowed: `false`.
- Owner operation required: `false`.
- Authority granted: `false`.

## Worker Boundary

No shared resolver, capability, active queue, goal registry, rollup file, or
shared integration registry was modified by this worker slice. Integration into
shared MAO registries remains a coordinator task.
