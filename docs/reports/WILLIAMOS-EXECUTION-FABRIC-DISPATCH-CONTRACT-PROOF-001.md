# WilliamOS Execution Fabric dispatch-contract proof

Issue: `#535`
Work Order: `WO-FABRIC-DISPATCH-CONTRACT-001`
Status: `IMPLEMENTED / LOCALLY_VALIDATED / ASSURANCE_READY / STATIC_NON_CONSUMABLE`

## Result

The Fabric now has a deterministic, non-dispatching evaluator for the contract between one placement
recommendation and one bounded job. It composes the canonical dispatch-envelope and reservation-set
validators with exact placement, resource, authority, reservation, lease/fence, recovery, and
completion bindings.

The three decisions are `CONTRACT_READY`, `CONTRACT_BLOCKED`, and `INPUT_REJECTED`. Readiness is
analytical only. Every result keeps execution and dispatch false.

## Representative proof

```text
workload: CPU-heavy scratch build
placement recommendation: AEGIS
risk ceiling: R1
repository: bsvalues/terragroq
path scope: exact reserved Fabric script and test paths
attempt ceiling: 2
timeout ceiling: 1800 seconds
reservation: simulated / single acquisition / zero conflicts
lease: simulated / single holder / fenced
completion: pending, with exact future evidence requirements

expected decision: CONTRACT_READY
execution_authorized: false
dispatch_allowed: false
```

The fixture does not grant AEGIS compute authority and contains no executable command or remote
endpoint. It proves only that the contract graph is sufficient when every hypothetical gate is true.

## Fail-closed coverage

- changed section or authority-tuple digest;
- stale placement;
- mismatched Work Order, repository, selected node, base, path, action, or R1 scope;
- mismatched canonical grant/status event, contract reservation, or environment reservation;
- canonically invalid dispatch envelope or reservation set;
- expired or revoked authority and single-use replay;
- duplicate acquisition, reservation conflict, reservation expiry, or holder mismatch;
- lease loss, expiry, release mismatch, checkpoint mismatch, or stale fencing token;
- unsafe reclaim, exhausted recovery budget, or conflicting retry/terminal class;
- scheduler/dispatch/remote/authority mutation flags;
- executable fields, secret-like material, or unknown fields;
- out-of-order/future completion events, unattested evidence manifests, incomplete outputs, false
  completion, evidence-digest mismatch, or second completion consumption.

## Safety posture

```text
ACTUAL_DISPATCH_PERFORMED=false
JOB_COMMAND_EXECUTION_PERFORMED=false
QUEUE_ACQUISITION_PERFORMED=false
LIVE_RESERVATION_CREATED=false
LIVE_LEASE_CREATED=false
SCHEDULER_STATE=disabled
SCHEDULER_AUTHORITY=not-granted
AUTONOMOUS_SCHEDULING_ENABLED=false
AUTHORITY_MUTATED=false
AUTHORITY_DELEGATED=false
AEGIS_COMPUTE_AUTHORITY_GRANTED=false
AEGIS_STORAGE_AUTHORITY_GRANTED=false
AEGIS_NAS_AUTHORITY_GRANTED=false
AEGIS_BACKUP_AUTHORITY_GRANTED=false
REMOTE_SYSTEMS_MODIFIED=false
PROTECTED_DATA_ACCESSED=false
REJECTED_ISSUE_357_REUSED=false
OWNER_ACTION_REQUIRED=false
```

## Validation

```text
focused dispatch-contract tests: 64 passed
canonical contract tests: 242 passed
exact-head full suite: 2,760 passed / 2 skipped
lint: PASS / no warnings or errors
production build: PASS
git diff --check: PASS
independent exact-head assurance: READY / 0 P1-P2 findings
```

The exact-head full suite was run from a clean LF checkout so the unchanged placement proof was
included. One initial full run encountered a Windows file-lock race in an existing Hermes heartbeat
test; that test passed in isolation and the complete suite then passed on a clean rerun. PR checks and
review-thread disposition remain publication gates rather than local claims.
