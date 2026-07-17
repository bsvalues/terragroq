# WO-MAO-031 Codex Builder, Assurance, and Remediation Adapters

**Work Order:** `WO-MAO-031`

**Status:** `PASS / REPROVED`

**Control-plane risk:** `R3`

**Supported task risk:** `R0`, `R1`

**Depends on:** `WO-MAO-026`, `WO-MAO-029`, `WO-MAO-030`

## Current assurance outcome

`WO-MAO-031` has been redesigned and re-proved against the hardened WO-MAO-030 hosted Codex
coordinator adapter contract. The role lifecycle no longer accepts caller-supplied role proofs,
provider responses, or stage observations as completion evidence.

The adapter now consumes a compiled `HOSTED_CODEX_COORDINATOR_PLAN` with opaque native assignment
handles produced by WO-MAO-030. Each role stage is executed through host-bound operations:

- `getHostedCodexNativeAssignmentHandle`
- `startHostedCodexNativeAssignment`
- `createHostedCodexNativeMessage`
- `captureHostedCodexNativeEvidence`

The captured evidence wrapper must be independently captured, sanitized, bound to the expected Work
Order, lane, and assignment, and free of raw provider output, durable persistence claims, runtime
activation claims, and authority grants.

## Re-proved lifecycle

- Builder, assurance, remediator, and final reviewer roles are derived from the compiled coordinator
  plan, not caller-provided role records.
- Assurance remains independent and cannot remediate its own requested changes.
- Remediation remains bound to the original builder identity and the Work Order remediation budget.
- The final re-review must approve the remediation with zero unresolved review threads.
- Replay conflicts, terminal sealed assignments, and absent opaque host bindings fail closed.
- The standalone CLI remains fail-closed without an opaque hosted coordinator plan.

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

- focused role-adapter Vitest: `tests/multi-agent-codex-role-adapters.test.ts`, PASS:
  - proves role lifecycle through opaque WO-MAO-030 native assignment handles
  - rejects plain JSON plan substitution
  - rejects replay conflicts
  - rejects broken final review lifecycle
  - proves standalone CLI fail-closed behavior without opaque host plan handles

## Next transition

`WO-MAO-031` is `COMPLETE / REPROVED`.

That completion is necessary but not sufficient to release WO-MAO-034. WO-MAO-034 may become ready
only when WO-MAO-032 remains independently complete, WO-MAO-033 remains exactly
`DEFERRED / PROVIDER_UNAVAILABLE`, and the consumer-specific `WO-MAO-034<-WO-MAO-033` settlement is
independently verified by a separately authenticated provider-assessment trust record or equivalent
immutable evidence-ledger anchor. The embedded production pin registry currently contains no active
provider-assessment trust root, so WO-MAO-034 remains fail-closed until that separate gate is
satisfied.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
