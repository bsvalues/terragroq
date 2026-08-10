# WilliamOS Execution Fabric Shadow Placement Proof 001

Issue: #538
Phase: 2 - shadow placement observation
Phase 1 baseline: merge `794a665`
Initial harness merge: `ec002f515`
First hardening merge: `64e93ef740`
Post-merge hardening: `83b9d699e9`

## Corrected result boundary

Post-merge independent assurance found that the initial Phase 2 harness proved coherent replay but
did not prove trusted provenance: replay artifacts and the interpreter were caller-selected, and the
observed outcome was a caller-authored label. A `NOT_RUN` observation could also bypass chronology.
Review of the first hardening merge then found that actual-target eligibility, independent authority
settlement, immutable outcome admission, duplicate fencing, strict calendar timestamps, and
hyphenated secret/executable aliases still needed fail-closed enforcement.

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

That entry binds the exact receipt digest, Work Order, workload, decision-input digest, evidence
snapshot set, and reviewed commit. The production CLI has no caller-controlled trust-root, registry, policy,
schema, workload-catalog, verifier, interpreter, or snapshot path. An empty registry fails closed.

Two additional repository-owned registries independently settle execution evidence:

```text
config/execution-fabric/shadow-outcome-registry.json
config/execution-fabric/shadow-authority-registry.json
```

The reviewed outcome entry binds the immutable outcome digest to its Work Order, actual node,
retained source digest, authority reference, and reviewed commit. The reviewed authority entry binds
that reference to the Work Order, allowed canonical nodes, validity interval, and reviewed commit.
The authority interval must cover the check, execution start, and execution completion. Neither the
observation nor its outcome artifact can establish these trust facts by declaring them itself.

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

Execution and the observation itself must occur after the placement recommendation, the actual node
must be semantically eligible with fresh observed/proven evidence in the exact receipt, and execution
must begin before that node's evidence expires.
Every mismatch between recommended and actual target requires an explicit reachable divergence
reason. Duplicate receipt/Work Order/source bindings and duplicate immutable outcomes reject the
batch independently.

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

The production trust registries now contain the first genuine reviewed observation:

```text
WORK_ORDER: WO-EF-SHADOW-001
RECOMMENDED_NODE: aegis
ACTUAL_NODE: hermes-node
DIVERGENCE: authority-constrained manual target
RECEIPT_SHA256: 222a72ccbc1cb21acb180af42e3db2b589ad88575ccbaa88323758c39bf8def7
OUTCOME_SHA256: 9bd0b44bc7f4dc77fd2f24e590a048c7b964884da76d37d917d145799caea285
EVALUATION: OBSERVED
```

The recommendation selected AEGIS, but AEGIS execution authority remained ungranted. HERMES was
eligible and separately authorized for the complete execution window. The retained evidence records
the divergence, the two bounded recoverable shell-handling failures, strict Git object verification,
the exact reviewed main commit, and owned-workspace cleanup. The placement engine did not launch
the work.

This one observation proves the hardened admission and replay path with genuine evidence. It does
not satisfy Issue #538's requirement for a bounded representative set of genuine Work Orders or
support policy calibration. Therefore:

```text
PHASE_2_SHADOW_HARNESS: HARDENED
FIRST_OBSERVATION_COMPLETE: TRUE
HERMES_PLACEMENT_SHADOW_PROOF: PENDING_ADDITIONAL_REPRESENTATIVE_OBSERVATIONS
SCHEDULER: OFF
DISPATCH_AUTHORITY: NOT_GRANTED
```

No policy-calibration or bounded-dispatch claim follows from this implementation alone.

## Validation

- Phase 2 focused suites: 43/43 passed.
- Complete Execution Fabric family: 264/264 passed.
- Full repository suite: 2,935 passed, 2 skipped; four pre-existing
  `lab-dev-preflight` environment/child-process failures remain outside this Fabric change.
- Lint: passed with no warnings or errors.
- Production build: passed.
- Independent exact-head assurance: first observation evidence PASS; Phase 2 remains open pending
  additional representative genuine observations.
