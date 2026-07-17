# WO-MAO-034 Cross-Provider Routing and Review

**Work Order:** `WO-MAO-034`

**Status:** `COMPLETE / INDEPENDENT_EXACT_CANDIDATE_ASSURANCE_APPROVED`

**Control-plane risk:** `R3`

**Depends on:** `WO-MAO-024`, `WO-MAO-031`, `WO-MAO-033`

**Readiness gate:** WO-MAO-031 independently `COMPLETE`; WO-MAO-032 assessment `COMPLETE`;
WO-MAO-033 exactly `DEFERRED / PROVIDER_UNAVAILABLE`; consumer-specific verified settlement
`WO-MAO-034<-WO-MAO-033`.

## Completion outcome

The canonical version-2 assessment binds WO-MAO-032, WO-MAO-033, and the exact WO-MAO-034 consumer
envelope, plus the immutable WO-MAO-032 source-assessment content hash and merged source commit
`42a63e3e11e5bb1a9c1e9419db3e0f2651b1789c`. The separately authenticated immutable registry record
and DAG resolver verify that exact edge. The browser-safe state projection therefore releases
WO-MAO-034 to `READY`. The re-proof then evaluates only an immutable, zero-input canonical registry:
hosted Codex is the sole eligible provider, unavailable Claude contributes no capability, and a
same-provider review route is permitted only between distinct logical builder and reviewer
assignments. Direct raw input, serialized replay, caller arguments, copied trust, route substitution,
and nonclaim substitution all fail closed.

The implementation candidate is remote-reachable commit `1d12d958c05d83d3dd3f20a2b0be8bbaf4c6bc36`, tree
`9af5d82f9bbdb994aa5b4500f0d47ac78cbc510c`, with base-to-candidate binary diff SHA-256
`4e740a6ad3e0cb82ed7158def659819acd7aa9931c2d338b294cd90c49232ef8`. Independent assurance
reviewed the exact four changed candidate paths, returned `APPROVE`, and reported zero blocking,
substantive, or unresolved findings. The immutable integration record
`components/operator/multi-agent-routing-review-registry.ts` binds that candidate, the independent
review outcome, routing registry hash
`d83af5f3792225d5127e6dc024eb606b66961360967a9ab0c7069054af2dfb65`, and deterministic routing
result hash `e91e943a989403d93a9aaf52ff99bf63cab73dc9a7b3c855ef7a7a5211a33da3`.

WO-MAO-034 is therefore complete. WO-MAO-033 remains `DEFERRED / PROVIDER_UNAVAILABLE`; Claude
remains disabled; and WO-MAO-035 and later Work Orders remain pending. No settlement is generalized
to WO-MAO-035's direct WO-MAO-033 dependency.

## Re-proofed fail-closed behavior

- the executable CLI accepts zero caller arguments and loads only the sealed canonical registry;
- valid-looking direct routing fixtures cannot pass the one-shot host-trust wall;
- the settlement must bind `consumerWorkOrderId=WO-MAO-034`;
- the settlement must bind the exact canonical WO-MAO-034 consumer-envelope hash;
- the assessment must bind `assessmentWorkOrderId=WO-MAO-032`;
- the operator projection must independently observe WO-MAO-032 in its completed Work Order set;
- the subject must bind `subjectWorkOrderId=WO-MAO-033`;
- the subject lifecycle must remain exactly `DEFERRED / PROVIDER_UNAVAILABLE`;
- the assessment must bind the exact immutable WO-MAO-032 source-assessment content hash;
- callers may supply only a registry ID/version reference, not raw roots, writers, bundles, anchors,
  signatures, or trust material;
- logical builder and reviewer assignments and worker IDs must be distinct;
- the reviewer logical route is read-only and cannot remediate its own candidate;
- any missing, duplicated, reordered, copied, stale, mismatched, or unauthenticated binding fails
  closed;
- candidate completion requires the separately hashed exact-candidate assurance record; callers
  cannot manufacture completion by rehashing mutated claims.

## Explicit non-claims

```text
WO_MAO_034_COMPLETE: true
WO_MAO_033_COMPLETE: false
CLAUDE_PROVIDER_ENABLED: false
HOST_NATIVE_BINDING_CLAIMED: false
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

- focused canonical settlement and state tests:
  `tests/multi-agent-wo-mao-034-provider-settlement.test.ts`,
  `tests/multi-agent-provider-unavailable-settlement.test.ts`, and
  `tests/multi-agent-operator-registry.test.ts`;
- zero-input routing and attack tests:
  `tests/multi-agent-cross-provider-routing-review.test.ts`;
- exact-candidate evidence integrity and substitution tests:
  `tests/multi-agent-routing-review-registry.test.ts`;
- independent candidate validation: five files and 36 tests passed, plus syntax, diff, and
  deterministic direct-runner checks.

## Next transition

The separate ratified dependency-graph correction removes only the redundant direct WO-MAO-033
edges from WO-MAO-035/036. It does not alter this Work Order's settlement or completion evidence.
WO-MAO-035 later completed through its own provider-health/reroute proof; WO-MAO-036 is now ready.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
