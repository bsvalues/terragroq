# TerraFusion Remote Development Offload V1

**Outcome:** `TERRAFUSION_REMOTE_DEV_OFFLOAD_V1`  
**Proof Work Order:** `WO-TF-REMOTE-DEV-OFFLOAD-001`  
**Product issue:** `bsvalues/terrafusion_os_1.0#734`  
**Risk:** R1, proof-scoped repository and remote-compute work  
**Authority:** one isolated AEGIS workspace and one bounded TerraFusion delivery; no standing
scheduler or standing AEGIS execution authority

## Purpose

Prove the missing last mile of the lab architecture: OMEN remains the owner cockpit, Hermes validates
and dispatches one bounded job, AEGIS owns the repository workspace and all dependency, test, and
build execution, and GitHub remains the canonical delivery surface.

The proof delivers real TerraFusion work rather than another placement simulation. It implements the
bounded informational-gate portion of issue #734: make the currently omitted
`TerraFusion.Unit.Tests` project visible in CI without claiming that its known baseline failures are
fixed or adding it to the hard-gated solution.

## Approved architecture

```text
OMEN
  submit bounded packet; observe status and evidence only
       |
       v
HERMES
  validate authority, placement, limits, lease and evidence contract
       | SSH
       v
AEGIS
  /srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001
  clone -> branch -> edit -> restore -> test -> build -> commit -> push
       |
       v
GitHub
  PR -> checks -> independent review -> merge -> ancestry proof
```

OMEN may hold the lightweight controller, packet, logs, and sanitized evidence. It must not host the
TerraFusion proof workspace, dependencies, test execution, build execution, Docker workload, model,
or canonical branch.

## Proof-scoped authority

The owner authorizes exactly one isolated AEGIS workspace, allowlisted Git/install/test/build
operations, bounded resources, and guarded cleanup after retained evidence. General scheduling and
standing AEGIS execution authority remain disabled.

The grant is bound to:

- Work Order `WO-TF-REMOTE-DEV-OFFLOAD-001`;
- repository `bsvalues/terrafusion_os_1.0`;
- a freshly fetched, pinned `origin/main` commit;
- node `aegis` with fresh identity and compute evidence;
- exact workspace `/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001`;
- one named branch and one pull request;
- R1 repository work only;
- finite time, CPU, memory, scratch, retry, and remediation limits;
- an expiry at terminal completion or failure.

This bounded grant does not change the registry's general scheduler or standing authority fields.

## Worker contract

The worker accepts a versioned, unknown-field-rejecting packet. It does not accept an arbitrary shell
string, free-form executable, endpoint, secret, credential, or environment injection.

Allowed typed operations are:

1. prove node identity, runtime availability, resource headroom, and exact workspace confinement;
2. clone or fetch the authorized GitHub repository at the pinned base commit;
3. create the authorized branch inside the exact workspace;
4. modify only the reserved TerraFusion workflow, focused tests, and evidence paths;
5. run the pinned dependency restore command;
6. run named focused and regression test targets;
7. run the named Release build target;
8. inspect Git status and diff, stage only allowlisted paths, commit, and push the authorized branch;
9. emit sanitized command, timing, exit-code, resource, Git, and artifact-digest evidence;
10. archive or remove only the exact proof workspace after merge and evidence retention.

The worker rejects path traversal, symlink escape, repository mismatch, base drift, branch mismatch,
resource-limit expansion, command substitution, unapproved network targets, protected data, and any
operation outside the allowlist.

## TerraFusion product change

The existing hard backend gate remains unchanged. The implementation adds a distinct informational
job that:

- invokes the existing reusable `.github/workflows/dotnet-test.yml` contract;
- targets `backend/tests/TerraFusion.Unit.Tests/TerraFusion.Unit.Tests.csproj`;
- restores, builds, and runs the entire test project;
- remains visibly non-blocking while its known baseline failures exist;
- preserves full GitHub job output and test evidence;
- never labels a failing test invocation as passing;
- does not add the project to `backend/TerraFusion.sln`;
- does not modify production code or compensate for failures by exclusion.

If current `origin/main` has evolved enough that the exact informational gate already exists, the
worker must fail closed as `NO_PRODUCT_DELTA` and select no substitute work without a new approved
design. Existing selected-test invocations do not satisfy the project-wide requirement.

## Resource envelope

The implementation plan must pin finite values after a fresh read-only AEGIS preflight. It must not
exceed:

- one workspace;
- one active attempt plus two bounded recovery attempts;
- 12 logical CPUs for build/test;
- 12 GiB memory;
- 80 GiB workspace and dependency scratch;
- 90 minutes per execution attempt;
- one Git branch and one pull request.

The worker must stop rather than silently exceed a limit. It must not start Docker or persistent
services. Any dependency cache used for the proof remains non-authoritative and may not be represented
as retained project state.

## Transport and trust

Hermes is the dispatch controller. It uses the already proven Hermes-to-AEGIS trust chain and pins the
recorded AEGIS host identity before a workspace write. OMEN does not establish a competing direct
worker lane.

A live read-only Hermes-to-AEGIS preflight timed out during design discovery. This is an operational
recovery condition. Execution must diagnose the existing route using bounded read-only checks and
restore only the already-authorized trust path. It may not weaken host-key checking, enable password
authentication, broaden firewall exposure, create another node identity, or bypass Hermes. If the
existing trust path cannot be recovered within the bounded retry budget, the outcome is blocked with
exact evidence and no AEGIS mutation.

## State, AI, and data boundaries

- Atlas receives no query, migration, write, workspace, dependency, build artifact, or test workload.
- Hermes receives no TerraFusion workspace or build workload; it validates and dispatches only.
- No AI assistance is required for this CI wiring change. If later analysis uses local AI, it must use
  the existing Hermes loopback Ollama boundary and may not execute tools or access repository/state.
- WilliamOS's separate Neon contract is untouched.
- No county, PACS, production, protected, or credential-bearing data enters the proof.
- GitHub is the only canonical code and PR authority.

## Evidence model

Every consequential transition records a common immutable `run_id` and binds:

- authority and Work Order identity;
- AEGIS machine identity and observed time;
- repository, pinned base SHA, branch, and final commit SHA;
- workspace canonical path;
- reservation, lease generation, and fencing token;
- exact typed operation and allowlist rule;
- start/completion timestamps, exit code, duration, and bounded resource observations;
- changed-path manifest;
- restore, test, and build result digests;
- PR number, reviewed head, merge SHA, and `origin/main` ancestry;
- cleanup target and post-cleanup absence proof.

Raw responses, credentials, environment secrets, dependency contents, and excessive logs are not
committed. Evidence summarizes failures truthfully and retains the command identity and exit status
needed to reproduce them.

## Failure behavior

The dispatch fails closed for:

- stale, conflicting, malformed, expired, revoked, replayed, or mismatched authority;
- unavailable or identity-mismatched AEGIS;
- failed Hermes-to-AEGIS host authentication;
- workspace collision or confinement failure;
- base or branch drift;
- non-allowlisted command, path, network target, or environment input;
- resource or time-limit breach;
- dependency, test, build, Git, PR, review, or merge failure beyond its bounded retry budget;
- missing or mismatched evidence;
- cleanup target ambiguity.

Known TerraFusion test failures are not dispatch failures when the informational job is correctly
non-blocking, but they must be reported with their real exit status and may not be called green. A
failed Release build prevents V1 completion.

## Delivery and review

The work uses one implementation lane and separate read-only assurance. The control-plane branch and
the AEGIS TerraFusion branch have non-overlapping repository ownership. Independent review verifies
the worker boundary, workflow semantics, evidence binding, actual execution location, and exact PR
head. Legitimate findings return to the owning implementation lane for bounded remediation.

The TerraFusion pull request merges only after required checks, resolved review threads, exact-head
assurance, and applicable standing merge authority. Post-merge verification fetches fresh
`origin/main` and proves merge ancestry before cleanup.

## Acceptance criteria

`TERRAFUSION_REMOTE_DEV_OFFLOAD_V1` is complete only when:

1. the TerraFusion repository and branch existed only in the authorized AEGIS proof workspace;
2. dependency restore ran on AEGIS;
3. the entire `TerraFusion.Unit.Tests` informational invocation ran on AEGIS and its real result was
   retained;
4. a Release build ran and passed on AEGIS;
5. the intended workflow change was committed and pushed from AEGIS;
6. one reviewed PR merged and its merge is an ancestor of fresh `origin/main`;
7. OMEN ran no TerraFusion dependency install, tests, build, Docker workload, or local model;
8. Hermes performed control and dispatch only;
9. Atlas was untouched;
10. the exact AEGIS workspace was safely cleaned after retained completion evidence;
11. the general scheduler remains off and standing AEGIS execution authority remains false;
12. all owner-operation, credential, diagnostic, routine-decision, and routine-contact counters are
    zero after this recorded grant.

## Explicit non-goals

- no general-purpose remote shell service;
- no standing AEGIS runner or GitHub self-hosted runner;
- no Kubernetes, queue daemon, or persistent scheduler;
- no OMEN cleanup or migration in this milestone;
- no database, retrieval, Forge, backup, NAS, or storage-authority change;
- no repair of the known `TerraFusion.Unit.Tests` baseline;
- no addition of `TerraFusion.Unit.Tests` to the hard-gated solution;
- no Hermes Ollama or network reconfiguration;
- no WilliamOS Neon change;
- no production deployment.

## Rollback

The product change rolls back through a normal revert PR. The proof-scoped worker grant expires and
cannot be reused. Any retained AEGIS workspace is quarantined on ambiguous cleanup state; cleanup may
resume only after exact-path and process ownership are proven. No force push, direct-main edit, broad
filesystem cleanup, or authority widening is permitted.

