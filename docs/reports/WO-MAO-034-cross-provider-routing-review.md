# WO-MAO-034 Cross-Provider Routing and Review

**Work Order:** `WO-MAO-034`

**Status:** `BLOCKED / PROVIDER_ASSESSMENT_TRUST_PIN_REQUIRED`

**Control-plane risk:** `R3`

**Depends on:** `WO-MAO-024`, `WO-MAO-031`, `WO-MAO-033`

**Readiness gate:** WO-MAO-031 independently `COMPLETE`; WO-MAO-032 assessment `COMPLETE`;
WO-MAO-033 exactly `DEFERRED / PROVIDER_UNAVAILABLE`; consumer-specific verified settlement
`WO-MAO-034<-WO-MAO-033`.

## Current assurance outcome

`WO-MAO-031` has been re-proved, so the historical blanket invalidation wall has been narrowed to the
actual remaining gate. `WO-MAO-034` now validates routing inputs only after the consumer-specific
Claude unavailable-provider settlement is verified through the separately authenticated
provider-assessment trust registry.

The embedded production provider-assessment pin registry currently contains no active trust record.
As a result, the `WO-MAO-034<-WO-MAO-033` settlement cannot be authenticated and the Work Order fails
closed with `CROSS_PROVIDER_SETTLEMENT_WALL`.

This is the correct ordered stop. It does not complete WO-MAO-034, does not complete WO-MAO-033, does
not enable Claude, and does not release WO-MAO-035, WO-MAO-036, or WO-MAO-037.

## Re-proofed fail-closed behavior

- valid-looking routing fixtures must include the explicit `dependencySettlement` record;
- the settlement must bind `consumerWorkOrderId=WO-MAO-034`;
- the assessment must bind `assessmentWorkOrderId=WO-MAO-032`;
- the subject must bind `subjectWorkOrderId=WO-MAO-033`;
- the subject lifecycle must remain exactly `DEFERRED / PROVIDER_UNAVAILABLE`;
- callers may supply only a registry ID/version reference, not raw roots, writers, bundles, anchors,
  signatures, or trust material;
- missing or unauthenticated production pin records fail closed before routing can be certified.

## Explicit non-claims

```text
WO_MAO_034_COMPLETE: false
WO_MAO_033_COMPLETE: false
CLAUDE_PROVIDER_ENABLED: false
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

- focused cross-provider routing Vitest:
  `tests/multi-agent-cross-provider-routing-review.test.ts`, PASS when run with the focused MAO suite
  after narrowing the stale invalidation wall to the authenticated-settlement wall.

## Next transition

The next valid action is not WO-MAO-035, WO-MAO-036, or WO-MAO-037. The ordered MAO chain is blocked
at `WO-MAO-034` until a reviewed canonical provider-assessment trust pin or equivalent immutable
evidence-ledger anchor is authorized and integrated.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
