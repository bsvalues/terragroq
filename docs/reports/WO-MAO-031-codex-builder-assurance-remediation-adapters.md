# WO-MAO-031 Codex Builder, Assurance, and Remediation Adapters

**Work Order:** `WO-MAO-031`

**Status:** `COMPLETE / CURRENT_SESSION_ROLE_LIFECYCLE_PROVEN`

**Control-plane risk:** `R3`

**Supported task risk:** `R0`, `R1`

**Depends on:** `WO-MAO-026`, `WO-MAO-029`, `WO-MAO-030`

## Outcome

WilliamOS now has a bounded hosted Codex role lifecycle adapter for the current-session native team
surface. The adapter proves builder, independent assurance, original-builder remediation, and bounded
re-review records using the common provider response contract.

This is not a durable provider dispatch implementation, GitHub review automation, service worker, or
runtime activation. It preserves the WO-MAO-029 `SESSION_ONLY` boundary and requires host-issued
opaque session proof for the builder and reviewer identities. Remediation is treated as the original
builder continuing after requested changes, not as a new independent writer.

## Implemented contract

- module: `scripts/multi-agent-operator/codex-role-adapters.mjs`
- CLI: `scripts/multi-agent-operator/codex-role-adapters-cli.mjs`
- test: `tests/multi-agent-codex-role-adapters.test.ts`
- registry: `components/operator/multi-agent-operator-registry.ts`
- capability record: `components/operator/multi-agent-capability-registry.ts`

The adapter:

- validates WO-MAO-029 conformance before evaluating a role lifecycle
- validates the Work Order envelope v2 record before accepting a stage chain
- requires the WO-MAO-030 coordinator adapter result to be assignment-ready and non-dispatching
- requires host-issued session proof for builder, reviewer, and remediator role records
- binds remediation to the original builder identity
- requires independent assurance to request changes before remediation
- requires final re-review approval with zero unresolved threads
- enforces the envelope remediation budget
- validates every stage through the common provider response contract
- rejects unsanitized, failed, authority-minting, runtime, or dispatch-claiming records

## Explicit non-claims

```text
PROVIDER_CONTRACT_DISPATCH_ALLOWED: false
DISPATCH_PERFORMED: false
DURABLE_PERSISTENCE_CLAIMED: false
SERVICE_WORKER_CLAIMED: false
RUNTIME_ACTIVATION_ALLOWED: false
AUTHORITY_GRANTED: false
GITHUB_REVIEW_AUTOMATION_ADDED: false
PRODUCTION_WRITE_PERFORMED: false
REJECTED_ISSUE_357_REUSED: false
OWNER_RELAY_REQUIRED: false
```

## Validation

- focused role-adapter Vitest: `1 file / 8 tests`, PASS:
  - `tests/multi-agent-codex-role-adapters.test.ts`
- focused adapter/registry Vitest: `7 files / 76 tests`, PASS
- `git diff --check`, PASS
- `npm run lint`, PASS
- `npm test -- --run`: `170 files / 1268 tests`, PASS
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`, PASS

## Next transition

`WO-MAO-031` is complete. `WO-MAO-033` remains `DEFERRED / PROVIDER_UNAVAILABLE`, so
`WO-MAO-034` is not dependency-cleared through the ordinary completion-only resolver yet.

The next safe continuation is the provider-unavailable settlement/routing lane that can decide whether
the deferred Claude dependency can be treated under the existing explicit provider-unavailable policy,
without asking William to repair or operate Claude.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
