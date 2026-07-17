# WO-MAO-031 Codex Builder, Assurance, and Remediation Adapters

**Work Order:** `WO-MAO-031`

**Status:** `HISTORICAL_EVIDENCE_INVALIDATED / READY_FOR_REDESIGN_AND_REPROOF`

**Control-plane risk:** `R3`

**Supported task risk:** `R0`, `R1`

**Depends on:** `WO-MAO-026`, `WO-MAO-029`, `WO-MAO-030`

> Post-merge assurance of WO-MAO-030 invalidated this completion evidence. The implementation and
> report are retained as historical inputs only; WO-MAO-031 must be redesigned against the hardened
> opaque-handle, host-bridge, transaction, replay, and evidence contracts and independently re-proved.

## Current assurance outcome

`INVALIDATED / REPROOF_REQUIRED`. The original merged report recorded a bounded hosted Codex role
lifecycle adapter and claimed builder, independent assurance, original-builder remediation, and
bounded re-review proof. Those claims are superseded because that adapter was not proven compatible
with the hardened canonical WO-MAO-030 contract.

The historical implementation remains non-durable and non-dispatching, but that boundary alone does
not restore proof. WO-MAO-031 must be redesigned to consume opaque assignment handles, exact native
bindings, bridge-backed operations, transaction quarantine, observation replay binding, and sealed
terminal evidence from the hardened WO-MAO-030 adapter.

## Historical original contract (superseded)

- module: `scripts/multi-agent-operator/codex-role-adapters.mjs`
- CLI: `scripts/multi-agent-operator/codex-role-adapters-cli.mjs`
- test: `tests/multi-agent-codex-role-adapters.test.ts`
- registry: `components/operator/multi-agent-operator-registry.ts`
- capability record: `components/operator/multi-agent-capability-registry.ts`

The following list preserves what the original implementation attempted to enforce. It is historical
design evidence only and does not certify the current WO-MAO-031 Work Order as complete:

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

## Historical original validation (superseded)

These runs described the invalidated implementation. They are retained as historical facts and are
not current completion evidence:

- focused role-adapter Vitest: `1 file / 8 tests`, PASS:
  - `tests/multi-agent-codex-role-adapters.test.ts`
- focused adapter/registry Vitest: `7 files / 76 tests`, PASS
- `git diff --check`, PASS
- `npm run lint`, PASS
- `npm test -- --run`: `170 files / 1268 tests`, PASS
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`, PASS

## Next transition

`WO-MAO-031` is `READY / REPROOF_REQUIRED` and is the sole dependency-cleared Work Order. After its
redesign receives independent approval, WO-MAO-034 may be re-reviewed and re-proved. WO-MAO-035
remains pending until that ordered chain completes. WO-MAO-033 remains
`DEFERRED / PROVIDER_UNAVAILABLE` and resumable; William is not asked to repair or operate Claude.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
