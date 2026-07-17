# WO-MAO-034 Cross-Provider Routing and Review

**Work Order:** `WO-MAO-034`

**Status:** `HISTORICAL_EVIDENCE_INVALIDATED / PENDING_ORDERED_REPROOF`

**Control-plane risk:** `R3`

**Depends on:** `WO-MAO-024`, `WO-MAO-031`, `WO-MAO-033`

> Post-merge assurance invalidated this completion evidence after WO-MAO-031 was invalidated. The
> implementation and report are retained as historical inputs only; WO-MAO-034 must be re-reviewed
> and re-proved after the redesigned WO-MAO-031 completes.

## Current assurance outcome

`INVALIDATED / REPROOF_REQUIRED`. The original merged report recorded a static cross-provider routing
and review model that excluded unavailable providers and preserved same-provider independent review.
Those proof and completion claims are superseded because WO-MAO-031, a declared dependency, is no
longer complete.

The historical model remains non-executing and did not activate Claude, but it cannot complete the
provider-optional path until the redesigned WO-MAO-031 is independently re-proved and WO-MAO-034 is
then re-reviewed against the hardened chain.

## Historical original contract (superseded)

- module: `scripts/multi-agent-operator/cross-provider-routing-review.mjs`
- CLI: `scripts/multi-agent-operator/cross-provider-routing-review-cli.mjs`
- test: `tests/multi-agent-cross-provider-routing-review.test.ts`
- registry: `components/operator/multi-agent-operator-registry.ts`
- capability record: `components/operator/multi-agent-capability-registry.ts`

The following list preserves what the original implementation attempted to enforce. It is historical
design evidence only and does not certify the current WO-MAO-034 Work Order as complete:

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

## Historical original validation (superseded)

These runs described the invalidated implementation. They are retained as historical facts and are
not current completion evidence:

- focused cross-provider routing Vitest: `1 file / 5 tests`, PASS:
  - `tests/multi-agent-cross-provider-routing-review.test.ts`
- focused routing/registry/portfolio Vitest: `5 files / 25 tests`, PASS
- `git diff --check`, PASS
- `npm run lint`, PASS
- `npm test -- --run`: `171 files / 1273 tests`, PASS
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`, PASS

## Next transition

`WO-MAO-034` is `PENDING / REPROOF_REQUIRED`. The current sequence is WO-MAO-031 redesign and
independent re-proof, followed by WO-MAO-034 re-review and re-proof, then WO-MAO-035. WO-MAO-033
remains `DEFERRED / PROVIDER_UNAVAILABLE` and resumable.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
