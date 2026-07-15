# WO-MAO-025 Isolated Workspace Manager

**Work Order:** `WO-MAO-025`

**Status:** `COMPLETE / BOUNDED_ISOLATED_WORKSPACE_LIFECYCLE_PROVEN`

**Risk:** `R3`

**Depends on:** `WO-MAO-018`, `WO-MAO-021`, `WO-MAO-022`, `WO-MAO-023`, and `WO-MAO-024`

## Outcome

WilliamOS now has a deterministic, fail-closed manager for per-lane branch and worktree lifecycle.
The contract binds each lane to its declared repository, workspace root, worktree path, branch, base
reference, base commit, reservation set, lease fence, and evidence event before any mutation. Apply
requires an exact host-injected lifecycle/reservation/lease/evidence/checkpoint verifier and executes one lane at a time so
a later lane cannot strand an earlier mutation behind a failed multi-lane request.

The manager derives live Git state itself. It creates an absent isolated branch/worktree, reuses exact
clean owned state, reattaches a manager-owned branch when its worktree is absent, and cleans only a
terminal clean branch proven merged into a base that remains a descendant of the lane's recorded
base checkpoint. Shared or nested paths/branches, overlapping
reservations, foreign identity, path escape, symlinks, tracked/untracked/ignored state, unbound ownership,
unsafe cleanup, duplicate ownership, and authority-minting input fail closed.

## Isolation boundary

The contract never absorbs foreign changes or assumes that an existing worktree belongs to a lane.
Workspace ownership must be exact and exclusive across the complete input set. A branch or path cannot
be assigned to two lanes, and caller-provided state cannot weaken the repository, reservation, lease,
or evidence gates established by earlier Work Orders.

## Execution and authority boundary

The `apply` path performs only the bounded local Git lifecycle above. It does not:

- stage changes, commit, push, open a PR, review, merge, or mutate remote state;
- force-remove a worktree, force-delete a branch, clean dirty state, or delete an unmerged branch;
- dispatch a provider or activate a worker, scheduler host, background service, or rejected adapter;
- grant authority, release a reservation, alter a lease/checkpoint, or append runtime evidence;
- inspect, store, or transmit credentials or secrets.

Planning outputs remain non-executing. Apply results separate the requested plan hash from the live
execution hash, bind that hash to the complete verified lane identity and checkpoint head, fence reuse
against the host-verified branch-head checkpoint, roll back Git lifecycle
changes when ownership persistence fails, record whether a bounded
mutation occurred, and always keep `authorityGranted=false` and `ownerOperationsRequired=false`.

## Mechanical proof

Focused tests cover deterministic planning and a real temporary Git lifecycle through create, exact
reuse, owned reattach, and merged clean cleanup; repository/base/branch/path identity; lease/evidence
binding through a host verifier, including lifecycle intent and reservation scope; single-lane atomic
apply plus creation and cleanup persistence rollback; root containment; shared/nested path and
branch walls; Windows case-insensitive reservation overlap; foreign tracked, untracked, and ignored
state; checkpoint-head drift and missing-branch inconsistency; malformed and unknown fields; unsafe cleanup; typed CLI behavior; and
authority denial.

The executable registry edits in the feature branch are the proposed post-merge projection. They do
not change `main` or release WO-MAO-026 until this reviewed commit is merged.

## Next transition

`WO-MAO-001` through `WO-MAO-025`, `WO-MAO-029`, and `WO-MAO-032` are complete.
`WO-MAO-033` remains `DEFERRED / PROVIDER_UNAVAILABLE`. The only newly dependency-cleared Work Order
is `WO-MAO-026 - Reservation-aware handoff`.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
