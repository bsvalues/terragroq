# WilliamOS Execution Fabric Shadow Placement Proof 001

Issue: #538
Phase: 2 - shadow placement observation
Phase 1 baseline: merge `794a665`
Initial harness merge: `ec002f515`

## Corrected result boundary

Post-merge independent assurance found that the initial Phase 2 harness proved coherent replay but
did not prove trusted provenance: replay artifacts and the interpreter were caller-selected, and the
observed outcome was a caller-authored label. A `NOT_RUN` observation could also bypass chronology.

This hardening supersedes the initial certification claim. It remains observation-only and does not
launch work, contact a node, acquire a lease, reserve capacity, mutate a remote system, activate a
scheduler, authorize execution, or silently redirect work.

## Production trust root

Production accepts exactly:

```text
--receipt <exact Phase 1 receipt JSON>
--observation <exact shadow observation JSON>
```

The receipt digest must exist in the repository-owned reviewed registry:

```text
config/execution-fabric/shadow-receipt-registry.json
```

That entry binds the exact receipt digest, workload, decision-input digest, evidence snapshot set,
and reviewed commit. The production CLI has no caller-controlled trust-root, registry, policy,
schema, workload-catalog, verifier, interpreter, or snapshot path. An empty registry fails closed.

Test-fixture roots are confined to the operating-system temporary directory and emit only
`TEST_OBSERVED` / `TEST_PASS`; they cannot emit the production gate.

## Outcome evidence

Each genuine observation binds two retained repository artifacts by exact SHA-256:

1. a human-reviewable delivery record under `docs/reports`; and
2. canonical JSON outcome evidence under `docs/reports`.

The outcome evidence binds:

- Work Order identity;
- actual canonical node;
- terminal status/result;
- start and completion timestamps;
- a COMPLIANT authority result and retained authority reference;
- bounded resource observations.

Latency is derived from the bound timestamps. Caller-authored latency/duration fields, executable
fields, secret-like fields or values, malformed chronology, non-compliant authority, and changed
artifact bytes reject the input.

Execution and the observation itself must occur after the placement recommendation. Every mismatch
between recommended and actual target requires an explicit allowed divergence reason. Duplicate
receipt/Work Order/source bindings reject the batch.

## Safety invariants

Every accepted result records:

```text
observation_only: true
job_launched: false
scheduler_activated: false
authority_mutated: false
remote_accessed: false
shell_executed: false
```

The production trust registry intentionally contains no receipt until a genuine reviewed Phase 1
receipt and its outcome evidence are admitted. Therefore:

```text
PHASE_2_SHADOW_HARNESS: HARDENED
HERMES_PLACEMENT_SHADOW_PROOF: PENDING_GENUINE_OBSERVATIONS
SCHEDULER: OFF
DISPATCH_AUTHORITY: NOT_GRANTED
```

No policy-calibration or bounded-dispatch claim follows from this implementation alone.

## Validation

- Phase 2 focused suites: 26/26 passed.
- Complete Execution Fabric family: 247/247 passed.
- Full repository suite: 2,918 passed, 2 skipped; four pre-existing
  `lab-dev-preflight` environment/child-process failures remain outside this Fabric change.
- Lint: passed with no warnings or errors.
- Production build: passed.
- Independent hardening assurance: READY with no remaining P1/P2 finding.
