# OMEN Cockpit Boundary

**Document:** `WILLIAMOS-OMEN-COCKPIT-BOUNDARY-001`

**Status:** `ACTIVE / CONTROLLING` for OMEN's host role.

**Implements:** the `OMEN - cockpit / optional compute` line of
[`sovereign-runtime-and-review-supersession.md`](sovereign-runtime-and-review-supersession.md) §2,
which already declares the architecture but does not say operationally what OMEN may and may not
host.

**Supersedes:** the Phase 1 host clauses of
[`local-runtime-operator-boundary.md`](local-runtime-operator-boundary.md) —
specifically "The HP OMEN is the only authorized Phase 1 operator host" and "Docker is
validation-only." Those clauses were correct for `GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001` Phase 1
and are spent. The rest of that document — its credential controls, owner gates, and the rule that
the runtime never asks William to paste a secret — remains fully in force and is not touched here.

**Origin:** authored 2026-08-18 at the owner's direction during a lab-state review. Active working
doctrine — **not** a formal owner-ratification record. Do not cite owner ratification of this
document without a recorded owner decision.

## 1. Decision

OMEN is the cockpit. It is where the owner and agents sit, not where the system runs.

OMEN hosts no service, no container runtime, and no authoritative state. Work that needs a service
host goes to ATLAS. Work that needs an execution worker goes to AEGIS. Coordination stays on HERMES.

## 2. Why the Phase 1 clause is spent

Phase 1 named OMEN the authorized operator host for a specific and good reason: Codex and GitHub
authentication lived in that user's Windows credential store, and a runtime that needed those
identities had to run where they were. It also gave Docker a narrow validation-only role for the
same reason — it was the only isolation available on the box.

That rationale no longer holds. The Hermes-to-AEGIS execution backend is merged and operating
(PR #754, `scripts/hermes-bridge/execution-backend.mjs`); AEGIS holds its own resident GitHub and
Codex identities; HERMES runs the cycle. The identity that pinned the operator to OMEN has moved to
the nodes that do the work. What remains on OMEN is a cockpit that kept a service host's furniture.

## 3. What OMEN is

Permitted on OMEN:

- Interactive agent and operator sessions.
- Reading, editing, and browsing repository content.
- Reaching other nodes outward over SSH.
- Optional, disposable local compute with scratch-only storage semantics.

Not permitted on OMEN:

- Hosting a service, daemon, or long-lived runtime that another node is responsible for.
- Holding authoritative or durable state. Durable state belongs on ATLAS.
- Being the sole copy of anything.
- Being a dispatch target. OMEN has no entry in
  `config/execution-fabric/registry.seed.json` and must not acquire one as a side effect of
  unrelated work.

## 4. Docker on OMEN is retired

No runtime path requires a container runtime on OMEN. Verified 2026-08-18:

- The fabric baseline does not ask for one. OMEN is registered `workloads: "processes"` and
  `lib/fabric/run-baseline.mjs` routes its lifecycle steps to `Get-Process` / `Start-Process` /
  `Stop-Process`-by-pid. `tests/fabric-workload-model.test.ts` asserts a `processes` node never
  receives the string `docker`.
- OMEN is not in the execution-fabric registry, so nothing is placed on it.
- `config/execution-fabric/placement-workloads.json` is capability-driven and
  `recommendation_only`; `docker-worker-candidate` appears only as a preference, never a
  requirement.

Docker's remaining significance on OMEN is not as a runtime but as a **storage format**: the WSL2
disk image behind `%LOCALAPPDATA%/Docker/wsl/disk` holds real data. That is an archaeology
dependency, not a service dependency, and it is discharged by §5 rather than by starting a daemon.

Controls:

1. Docker Desktop on OMEN stays stopped and must not be configured to start at logon.
2. **Do not uninstall Docker Desktop on OMEN** while its volumes are the sole copy of any data.
   Uninstall flows offer to remove volume data. Disable, do not remove.
3. A stopped Docker daemon on OMEN is the intended state. It is **not** a defect, not a fabric
   failure, and not a thing to repair. An agent that finds `docker` unreachable on OMEN has found
   this document, not a bug.
4. Restoring the OMEN daemon to serve any workload requires a new owner decision, because it
   reverses §1.

## 5. The data still on OMEN's external storage

The Docker volumes on the detached external drive include the only copy of substantial data,
including an application PGDATA and a large PACS store. Until that is drained to ATLAS, OMEN
violates the "never the sole copy" rule in §3 as a matter of fact.

Rules while that is true:

1. Extraction does not require the Docker daemon. The proven method is a read-only mount of the
   disk image — `wsl --mount --vhd <image> --bare`, then mount the ext4 device read-only — which is
   **preferred over starting the daemon**, because a daemon start may migrate or upgrade volumes on
   first run and a read-only mount cannot alter them.
2. Backups must be corrected before any drain or migration. A backup job that reports success while
   capturing the wrong database protects nothing, and a migration performed on top of that is
   unrecoverable if it goes wrong.
3. Nothing in this document authorizes moving, deleting, or reformatting that storage. It records a
   boundary; the drain is separate authorized work.

## 6. How OMEN is proved managed

Being a cockpit does not exempt OMEN from being inspectable. It is held to the same six-step fabric
baseline as every other node — `reach`, `containers`, `start`, `push`, `pull`, `stop` — with the
workload model deciding how lifecycle is proven, not whether it is proven.

A gate that changes shape by node cannot be compared across the fleet; a gate that demands software
a node is deliberately not meant to run tests for installed packages rather than for management
capability. The workload model exists so that both stay true at once.

**Evidence, 2026-08-18T13:02:36Z:** all four nodes pass all six steps — `4/4`, exit code 0 — with
OMEN proved through process lifecycle and no container runtime present or required.

## 7. What this forbids

Future agents must not:

- Treat a stopped Docker daemon on OMEN as a defect to fix, a blocker to escalate, or a reason to
  ask the owner to plug in a drive.
- Report a fabric result below `4/4` without first verifying that the deployed baseline runner
  matches the repository by hash. A hand-copied runner has already produced a false `3/4` by
  demanding Docker from a node this document exempts.
- Add OMEN to the execution-fabric registry, place a workload on it, or give it durable state,
  without a new owner decision superseding §1.
