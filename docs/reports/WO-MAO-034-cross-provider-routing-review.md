# WO-MAO-034 Cross-Provider Routing and Review

**Work Order:** `WO-MAO-034`

**Status:** `COMPLETE / CROSS_PROVIDER_ROUTING_REVIEW_PROVEN`

**Control-plane risk:** `R3`

**Depends on:** `WO-MAO-024`, `WO-MAO-031`, `WO-MAO-033`

## Outcome

WilliamOS now has a static cross-provider routing and review model. It keeps unavailable providers out
of routing and review eligibility, preserves same-provider independent Codex review, and records that
Claude contributes no capability while its lane remains `DEFERRED / PROVIDER_UNAVAILABLE`.

This completes the provider-optional dependency path for the WO-MAO-034 slice without marking
WO-MAO-033 complete and without activating Claude.

## Implemented contract

- module: `scripts/multi-agent-operator/cross-provider-routing-review.mjs`
- CLI: `scripts/multi-agent-operator/cross-provider-routing-review-cli.mjs`
- test: `tests/multi-agent-cross-provider-routing-review.test.ts`
- registry: `components/operator/multi-agent-operator-registry.ts`
- capability record: `components/operator/multi-agent-capability-registry.ts`

The model:

- routes only active providers whose roles and repository scope match the Work Order
- excludes `UNAVAILABLE` providers with typed reason `PROVIDER_UNAVAILABLE`
- requires provider secret isolation and workspace isolation
- rejects raw credential access
- permits same-provider independent review when the reviewer role is available
- rejects cross-provider review through unavailable Claude
- keeps disabled providers out of route eligibility

## Explicit non-claims

```text
PROVIDER_CONTRACT_DISPATCH_ALLOWED: false
DISPATCH_PERFORMED: false
DURABLE_PERSISTENCE_CLAIMED: false
SERVICE_WORKER_CLAIMED: false
RUNTIME_ACTIVATION_ALLOWED: false
AUTHORITY_GRANTED: false
CLAUDE_ACTIVATED: false
GITHUB_REVIEW_AUTOMATION_ADDED: false
PRODUCTION_WRITE_PERFORMED: false
REJECTED_ISSUE_357_REUSED: false
OWNER_RELAY_REQUIRED: false
```

## Validation

- focused cross-provider routing Vitest: `1 file / 5 tests`, PASS:
  - `tests/multi-agent-cross-provider-routing-review.test.ts`
- focused routing/registry/portfolio Vitest: `5 files / 25 tests`, PASS
- `git diff --check`, PASS
- `npm run lint`, PASS
- `npm test -- --run`: `171 files / 1273 tests`, PASS
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`, PASS

## Next transition

`WO-MAO-034` is complete. `WO-MAO-033` remains `DEFERRED / PROVIDER_UNAVAILABLE` and resumable.

The next dependency-cleared Work Order is:

`WO-MAO-035 - Provider health, circuit breakers, and reroute`.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
