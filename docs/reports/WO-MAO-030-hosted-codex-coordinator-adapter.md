# WO-MAO-030 Hosted Codex Coordinator Adapter

**Work Order:** `WO-MAO-030`

**Status:** `COMPLETE / CURRENT_SESSION_COORDINATOR_ADAPTER_PROVEN`

**Control-plane risk:** `R3`

**Supported task risk:** `R0`, `R1`

**Depends on:** `WO-MAO-024`, `WO-MAO-028`, `WO-MAO-029`

## Outcome

WilliamOS now has a bounded hosted Codex coordinator adapter for the current-session native team
surface. The adapter translates a validated hosted team plan into native role assignments,
secret-free messages, cancellation-ready records, and sanitized evidence hashes.

This is not a durable runtime, service worker, or provider-contract dispatch surface. It preserves the
WO-MAO-029 `SESSION_ONLY` boundary and requires host-issued opaque session proof for each selected
coordinator, builder, and reviewer role before an assignment can be emitted.

## Implemented contract

- module: `scripts/multi-agent-operator/codex-coordinator-adapter.mjs`
- CLI: `scripts/multi-agent-operator/codex-coordinator-adapter-cli.mjs`
- test: `tests/multi-agent-codex-coordinator-adapter.test.ts`
- registry: `components/operator/multi-agent-operator-registry.ts`
- capability record: `components/operator/multi-agent-capability-registry.ts`

The adapter:

- validates the WO-MAO-029 conformance artifact before evaluating any plan
- validates every input as a Work Order envelope v2 before converting it to hosted-team planning input
- uses the existing hosted-team planner for dependency and reservation compatibility
- requires selected-lane host-session proof for coordinator, builder, and reviewer
- rejects caller-supplied or missing session identities
- rejects role proof and cancellation records that are not bound to selected lanes
- supports cancellation records without dispatching or creating side effects
- emits deterministic result hashes for plan, assignments, messages, and sanitized evidence

## Explicit non-claims

```text
PROVIDER_CONTRACT_DISPATCH_ALLOWED: false
DISPATCH_PERFORMED: false
DURABLE_PERSISTENCE_CLAIMED: false
SERVICE_WORKER_CLAIMED: false
RUNTIME_ACTIVATION_ALLOWED: false
AUTHORITY_GRANTED: false
GITHUB_WRITE_PERFORMED: false
PRODUCTION_WRITE_PERFORMED: false
REJECTED_ISSUE_357_REUSED: false
OWNER_RELAY_REQUIRED: false
```

## Validation

- focused hosted-coordinator Vitest: `7 files / 77 tests`, PASS:
  - `tests/multi-agent-codex-coordinator-adapter.test.ts`
  - `tests/multi-agent-codex-provider-conformance.test.ts`
  - `tests/multi-agent-hosted-team-plan.test.ts`
  - `tests/multi-agent-operator-registry.test.ts`
  - `tests/multi-agent-capability-registry.test.ts`
  - `tests/portfolio-operator.test.ts`
  - `tests/portfolio-operator-surface.test.ts`
- focused durable storage Vitest: `6 files / 210 tests`, PASS
- `git diff --check`, PASS
- `npm run lint`, PASS
- `npm test -- --run`: `169 files / 1260 tests`, PASS
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`, PASS

## Next transition

`WO-MAO-030` is complete. The next dependency-cleared Work Order is:

`WO-MAO-031 - Codex builder, assurance, and remediation adapters`.

`WO-MAO-033` remains `DEFERRED / PROVIDER_UNAVAILABLE` and resumable.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
