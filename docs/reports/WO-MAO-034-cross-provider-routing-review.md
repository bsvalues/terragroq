# WO-MAO-034 Cross-Provider Routing and Review

**Work Order:** `WO-MAO-034`

**Status:** `PASS / REPROVED`

**Control-plane risk:** `R3`

**Depends on:** `WO-MAO-024`, `WO-MAO-031`, `WO-MAO-033`

**Readiness gate:** WO-MAO-031 independently `COMPLETE`; WO-MAO-032 assessment `COMPLETE`;
WO-MAO-033 exactly `DEFERRED / PROVIDER_UNAVAILABLE`; consumer-specific verified settlement
`WO-MAO-034<-WO-MAO-033`.

## Current assurance outcome

`WO-MAO-034` is re-proved. The cross-provider routing and review model now validates the
consumer-specific Claude unavailable-provider settlement through the canonical
provider-assessment trust registry before it certifies routing.

The embedded production provider-assessment pin registry contains one immutable active record for the
WO-MAO-032 Claude provider assessment. The record contains public Ed25519 verification keys,
fingerprints, hashes, status-chain events, a ledger-anchor binding, and signatures. No private key,
password, token, credential, cookie, or session material is stored or required.

## Re-proved behavior

- valid routing fixtures must include the explicit `dependencySettlement` record;
- the settlement must bind `consumerWorkOrderId=WO-MAO-034`;
- the assessment must bind `assessmentWorkOrderId=WO-MAO-032`;
- the subject must bind `subjectWorkOrderId=WO-MAO-033`;
- the subject lifecycle must remain exactly `DEFERRED / PROVIDER_UNAVAILABLE`;
- callers may supply only a registry ID/version reference, not raw roots, writers, bundles, anchors,
  signatures, or trust material;
- the unavailable Claude provider contributes no routing capability;
- same-provider hosted Codex independent review remains permitted only inside the static planning
  model.

## Explicit non-claims

```text
WO_MAO_034_COMPLETE: true
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

- focused provider-settlement/routing/registry Vitest:
  `tests/multi-agent-provider-unavailable-settlement.test.ts`,
  `tests/multi-agent-cross-provider-routing-review.test.ts`,
  `tests/multi-agent-operator-registry.test.ts`,
  `tests/multi-agent-capability-registry.test.ts`,
  `tests/portfolio-operator.test.ts`, and
  `tests/portfolio-operator-surface.test.ts`, PASS.

## Next transition

`WO-MAO-034` is complete, but the chain does not advance to WO-MAO-036 or WO-MAO-037.
`WO-MAO-035` remains blocked because it has its own direct `WO-MAO-033` dependency edge. The
consumer-specific `WO-MAO-034<-WO-MAO-033` settlement cannot satisfy, launder, or reuse that separate
edge. The next valid action is a ratified correction or separately verified settlement for the
WO-MAO-035 direct dependency before provider-health/reroute re-proof.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
