# WO-MAO-024 Team Topology and Fan-Out/Fan-In

**Work Order:** `WO-MAO-024`

**Status:** `COMPLETE / DETERMINISTIC_PLANNING_CONTRACT_PROVEN`

**Risk:** `R3`

**Depends on:** `WO-MAO-019`, `WO-MAO-021`, `WO-MAO-022`, and `WO-MAO-023`

## Outcome

WilliamOS now has a deterministic, fail-closed team-topology planning contract for candidate lanes
bound to the canonical DAG eligible-set resolver input. The contract recomputes that planning result,
rejects a lane that is absent from it or differs at all from its full canonical dispatch envelope,
and assigns the
declared coordinator, builder, reviewer, remediator, merge controller, and verifier roles without
dispatching a provider, executing a command, writing GitHub, or granting authority.

The topology preserves each validated work-order envelope as the source of lane identity,
dependencies, reservations, provider selection, and its coordinator/builder/reviewer identities.
Remediation remains with the original builder. Builders and reviewers remain independent across the
whole topology, not merely inside one lane. The coordinator, merge controller, and verifier are stable
global roles and remain distinct from lane builders, lane reviewers, and each other.

## Fan-out and fan-in

Every lane is evaluated independently against only the dependencies declared by its validated
envelope. A lane becomes a `PLANNING_FAN_OUT_CANDIDATE` when the supplied DAG planning state projects
its dependency semantics as satisfied and remains `PLANNING_WAITING_ON_DECLARED_DEPENDENCIES`
otherwise. There is no topology-wide completion barrier and no
numeric Work Order serialization. Independent ready lanes may therefore fan out together while a
blocked lane waits only for its own unresolved dependency set.

Caller-supplied DAG state is not completion evidence and cannot authorize release. The output labels
fan-out as advisory and always emits `requiresSchedulerVerification=true`, `dispatchEligible=false`,
and `releaseAuthorized=false`. The WO-MAO-023 scheduler, its trust/authority gates, reservations,
leases, checkpoints, and evidence ledger remain mandatory before any execution.

The result is canonical and deterministic: ordering, role assignments, dependency state, and the
topology digest are stable for equivalent inputs. Unknown fields, malformed role assignments,
duplicate lane identities, inconsistent global roles, role collisions, envelope substitution, and
caller-authored completion lists, canonical-envelope substitution, cross-lane builder/reviewer reuse,
and ready-wave reservation collisions fail closed.

## Authority boundary

This is a planning and evidence contract only. It does not:

- activate a provider, worker, background service, scheduler host, or rejected local adapter;
- dispatch a lane, acquire a reservation, mutate a checkpoint, or append runtime evidence;
- create a branch, commit, pull request, review, or merge through a runtime;
- inspect, store, or transmit credentials or secrets;
- certify unattended operation or grant authority.

The already merged WO-MAO-023 scheduler remains the runtime-side canonical source of the exact
eligible set. WO-MAO-024 accepts no standalone `completedWorkOrderIds` assertion: it recomputes the
existing DAG planning contract, binds each topology lane to the full matching canonical dispatch
envelope hash, and emits the DAG result hash. This remains a non-authoritative planning proof and does
not replace scheduler trust, authority, reservation, lease, or evidence gates.

## Mechanical proof

The focused contract suite covers deterministic topology output, all six required roles,
original-builder remediation, role separation, multi-lane fan-out, dependency-specific fan-in,
`ALL` and `ANY` dependency semantics, canonical DAG binding, malformed and substituted input, duplicate
identity rejection, cross-lane role collision, ready-wave reservation collision, authority-minting
field rejection, and CLI fail-closed behavior.

Local validation includes the focused contract/registry suite, repository lint, full Vitest under WSL
for POSIX durability semantics, production build, syntax and diff checks, and secret-like-value
scanning. Pull-request checks, review-thread closure, and merged-main verification remain mandatory
merge gates; this report does not treat them as pre-merge evidence.

The executable registry edits in the feature branch are the proposed post-merge projection. They do
not change the current `main` registry or release WO-MAO-025 until this reviewed commit is merged.

## Next transition

`WO-MAO-001` through `WO-MAO-024`, `WO-MAO-029`, and `WO-MAO-032` are complete.
`WO-MAO-033` remains `DEFERRED / PROVIDER_UNAVAILABLE`. The only newly dependency-cleared Work Order
is `WO-MAO-025 - Isolated workspace manager`; later Phase 3 nodes remain pending on their declared
dependencies.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
