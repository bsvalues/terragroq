# WO-MAO-050 - Malicious/Defective Worker Drill

Result: `PASS`

## Scope

WO-MAO-050 proves a sealed, zero-input malicious/defective worker drill for the
multi-agent operator program.

The proof is static and deterministic. It does not add a runtime scheduler,
execute a provider, call GitHub, write production state, mutate durable state,
activate runtime, request secrets, perform unsafe cleanup, override policy, or
grant authority.

## Evidence

- Script: `scripts/multi-agent-operator/malicious-defective-worker-drill.mjs`
- CLI: `scripts/multi-agent-operator/malicious-defective-worker-drill-cli.mjs`
- Tests: `tests/multi-agent-malicious-defective-worker-drill.test.ts`
- Typed evidence: `components/operator/multi-agent-defective-worker-registry.ts`

Canonical plan hash:
`49d29bf5a5c03fb3172021ac61006e3b85aae963372eb08a8893181a8ac9ba17`

Canonical result hash:
`c1d2db0cb1e01be04cb815e06a57e89ce4b5d6fcd9d25d277866c864a095cf51`

Typed evidence hash:
`7d4074079923473efe6f89aab7c7ea76a09a0013c44c9652ee35e2dde521da75`

## Acceptance

- Verified dependency references: `WO-MAO-045`, `WO-MAO-046`, `WO-MAO-047`, `WO-MAO-048`, and `WO-MAO-049`.
- Defect cases: scope escape, fabricated evidence, secret request, policy override, prompt injection, unauthorized production intent, and unsafe cleanup.
- Every defect case is terminal and requires no owner operation.
- Defective workers are quarantined or stopped instead of trusted, retried, or promoted.
- Fabricated or mismatched evidence is rejected and blocks certification.
- Secret requests, authority override attempts, production intent, and unsafe cleanup are denied.
- Evidence requirements cover exact reservation match, tamper-evident hash chains, secret-boundary scan, policy-authority match, and static-scope production denial.
- Changed paths remain inside the five-file worker reservation.
- Foreign changes: `0`.
- Secret-like findings in the canonical plan: `0`.

## Safety

- Scheduler added: `false`.
- Provider execution performed: `false`.
- GitHub API called: `false`.
- Production write performed: `false`.
- Runtime activation allowed: `false`.
- Command runner added: `false`.
- Background worker added: `false`.
- State mutation performed: `false`.
- Secret material allowed: `false`.
- Unsafe cleanup allowed: `false`.
- Policy override allowed: `false`.
- Owner operation required: `false`.
- Authority granted: `false`.

## Worker Boundary

No runtime, provider, GitHub, production, cleanup, or authority behavior was
activated by this worker slice. Shared MAO registries are updated only with the
typed static evidence and next eligible Work Order release.
