# TerraFusion Remote Development Offload V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one real TerraFusion issue #734 CI change from a single AEGIS-hosted workspace while OMEN remains a lightweight cockpit, Hermes performs bounded dispatch, and the general scheduler stays disabled.

**Architecture:** A strict WilliamOS live-dispatch contract validates one proof-scoped packet and a Hermes-mediated controller invokes a fixed Linux worker protocol on AEGIS. The AEGIS worker owns the TerraFusion clone, branch, dependency restore, tests, Release build, commit, and push; GitHub owns review and merge, after which the exact AEGIS workspace is guardedly removed.

**Tech Stack:** Node.js ESM, JSON Schema-style exact validators, Vitest, PowerShell 5.1+, OpenSSH, Bash, Git, .NET 8, GitHub Actions reusable workflows, GitHub CLI.

## Global Constraints

- Work Order is exactly `WO-TF-REMOTE-DEV-OFFLOAD-001`.
- AEGIS workspace is exactly `/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001`.
- Repository is exactly `bsvalues/terrafusion_os_1.0` at a freshly fetched pinned `origin/main` SHA.
- One AEGIS workspace, one TerraFusion branch, one TerraFusion pull request, and at most three execution attempts.
- Maximum resource envelope: 12 logical CPUs, 12 GiB memory, 80 GiB scratch, and 90 minutes per attempt.
- General scheduler remains disabled; `AEGIS_COMPUTE_EXECUTION_AUTHORITY` remains false outside this proof grant.
- OMEN performs no TerraFusion clone/worktree, dependency install, test, build, Docker workload, or model execution.
- Hermes validates and relays only; Hermes performs no TerraFusion clone, dependency install, test, or build.
- Atlas receives zero queries, migrations, writes, workspaces, build artifacts, or test workloads.
- No arbitrary shell/command field, secret, credential, protected data, production mutation, firewall change, SSH weakening, or persistent worker service.
- The hard TerraFusion backend gate remains unchanged; only the informational test invocation may soft-fail.
- A failing informational test must remain visible and retain its real outcome; restore and build failures remain blocking.
- Cleanup is permitted only after merge ancestry and retained evidence prove completion, and only for the exact canonical AEGIS workspace.

---

## File structure

### WilliamOS control plane (`bsvalues/terragroq`)

- `config/execution-fabric/remote-dev-offload-v1.policy.json` — immutable proof authority, repository, workspace, operation, resource, and denial policy; contains no runtime timestamps or secrets.
- `scripts/execution-fabric/live/remote-dev-offload-contract.mjs` — exact packet parser, policy binder, state transition evaluator, typed evidence validator, and CLI.
- `scripts/execution-fabric/live/aegis-remote-dev-worker.sh` — fixed Linux operation dispatcher with canonical-path, repository, Git, process, and cleanup guards.
- `scripts/execution-fabric/live/invoke-remote-dev-offload.ps1` — OMEN controller that validates locally, calls Hermes, transfers only the fixed worker plus validated packet/patch, and captures sanitized evidence.
- `tests/execution-fabric-remote-dev-offload-contract.test.ts` — contract, replay, mismatch, evidence, command-injection, resource, and lifecycle tests.
- `tests/execution-fabric-remote-dev-offload-worker.test.ts` — POSIX fixture tests for operation allowlisting, confinement, Git binding, limits, and guarded cleanup.
- `tests/execution-fabric-remote-dev-offload-controller.test.ts` — fake-SSH tests proving Hermes mediation, no direct AEGIS connection, encoded payload safety, timeout behavior, and redaction.
- `docs/reports/WO-TF-REMOTE-DEV-OFFLOAD-001.md` — sanitized final dispatch, AEGIS execution, GitHub, OMEN-negative, authority, and cleanup evidence.

Runtime packets and full logs live only under ignored `.artifacts/execution-fabric/remote-dev-offload-v1/$RUN_ID/` after `$RUN_ID` is generated as the packet's lowercase GUID; they are not committed.

### TerraFusion product repository (`bsvalues/terrafusion_os_1.0`)

- `.github/workflows/dotnet-test.yml` — add a default-false `informational` boolean input and apply it only to the test step's `continue-on-error` expression.
- `.github/workflows/terrafusion-ci.yml` — add the project-wide `TerraFusion.Unit.Tests` informational reusable-workflow job.
- `tests/ci-terrafusion-unit-informational.test.ts` — static workflow contract tests protecting hard-gate semantics and full-project visibility.
- `docs/brain/evidence/WO-TF-REMOTE-DEV-OFFLOAD-001-proof.md` — sanitized product-side proof linking issue, the immutable run/base identity, and AEGIS restore/test/build hashes. Final PR/review/merge evidence belongs in the later WilliamOS closeout because a commit cannot truthfully contain its own future merge SHA.

---

### Task 1: Proof-scoped live dispatch contract

**Files:**
- Create: `config/execution-fabric/remote-dev-offload-v1.policy.json`
- Create: `scripts/execution-fabric/live/remote-dev-offload-contract.mjs`
- Create: `tests/execution-fabric-remote-dev-offload-contract.test.ts`

**Interfaces:**
- Consumes: owner-approved design commit `d9f879302`, canonical `validateDispatchEnvelope()`, canonical JSON/SHA-256 conventions.
- Produces: `bindRemoteDevPacket(packet, policy, trustedContext)`, `evaluateRemoteDevTransition(packet, evidence, trustedContext)`, `exitCodeForRemoteDevStatus(status)`, and CLI JSON states `READY`, `RUNNING`, `BLOCKED`, `COMPLETE`.

- [ ] **Step 1: Write the failing exact-policy tests**

Create fixtures that require exact values:

```ts
expect(policy.workOrderId).toBe("WO-TF-REMOTE-DEV-OFFLOAD-001")
expect(policy.nodeId).toBe("aegis")
expect(policy.workspace).toBe("/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001")
expect(policy.resourceLimits).toEqual({ cpuThreads: 12, memoryBytes: 12884901888, scratchBytes: 85899345920, timeoutSeconds: 5400, maxAttempts: 3 })
expect(policy.scheduler).toEqual({ state: "disabled", standingAegisAuthority: false })
```

Test unknown fields, wrong repository/base/node/workspace, expired grant, reused `run_id`, non-GUID `run_id`, widened resources, extra action, direct-AEGIS transport, missing Hermes hop, secret-like values, executable fields, Atlas targets, and ambiguous cleanup as `BLOCKED` with nonzero exit.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm exec vitest run tests/execution-fabric-remote-dev-offload-contract.test.ts
```

Expected: fail because the policy and `remote-dev-offload-contract.mjs` do not exist.

- [ ] **Step 3: Add the immutable policy**

Use these exact operation names:

```json
[
  "PROVE_PREFLIGHT",
  "CREATE_WORKSPACE",
  "APPLY_RESERVED_PATCH",
  "RESTORE_DOTNET",
  "TEST_WORKFLOW_CONTRACT",
  "TEST_DOTNET_INFORMATIONAL",
  "BUILD_DOTNET_RELEASE",
  "COMMIT_RESERVED_PATHS",
  "PUSH_AUTHORIZED_BRANCH",
  "PROVE_POST_MERGE",
  "CLEAN_EXACT_WORKSPACE"
]
```

Pin repository, workspace, branch prefix `codex/wo-tf-remote-dev-offload-001-`, reserved TerraFusion paths, resource ceilings, attempt count, Hermes-only transport, scheduler disabled, standing authority false, and denied targets/actions.

- [ ] **Step 4: Implement strict packet and transition validation**

Implement exact-key checks and these typed records:

```js
// packet
{
  schemaVersion: 1, runId, workOrderId, repository, baseRef, baseSha,
  branch, nodeId, workspace, transport: { controller: "omen", relay: "hermes", worker: "aegis" },
  resourceLimits, operations, patch: { sha256, changedPaths },
  authority: { grantId, issuedAt, expiresAt, singleUse: true },
  bindings: { policySha256, packetSha256 }
}

// evidence transition
{
  schemaVersion: 1, runId, operation, attempt, startedAt, completedAt,
  status, exitCode, nodeId, workspace, baseSha, headSha,
  outputSha256, previousEvidenceSha256
}
```

Require strictly increasing timestamps, one immutable `runId`, exact operation order, hash chaining, matching node/workspace/base/branch, finite attempts, and terminal `COMPLETE` only after merge ancestry plus cleanup evidence.

- [ ] **Step 5: Run focused GREEN and regression tests**

Run:

```powershell
pnpm exec vitest run tests/execution-fabric-remote-dev-offload-contract.test.ts tests/execution-fabric-dispatch-contract.test.ts tests/multi-agent-dispatch-envelope.test.ts tests/multi-agent-reservation-set.test.ts
```

Expected: all pass; malformed or widened packets exit nonzero.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- config/execution-fabric/remote-dev-offload-v1.policy.json scripts/execution-fabric/live/remote-dev-offload-contract.mjs tests/execution-fabric-remote-dev-offload-contract.test.ts
git commit -m "feat(fabric): bind one remote dev offload grant"
```

### Task 2: Fixed AEGIS worker and Hermes-mediated controller

**Files:**
- Create: `scripts/execution-fabric/live/aegis-remote-dev-worker.sh`
- Create: `scripts/execution-fabric/live/invoke-remote-dev-offload.ps1`
- Create: `tests/execution-fabric-remote-dev-offload-worker.test.ts`
- Create: `tests/execution-fabric-remote-dev-offload-controller.test.ts`

**Interfaces:**
- Consumes: Task 1 `READY` packet and policy digest.
- Produces: one JSON line per operation matching Task 1's evidence transition; controller exit `0` only for a valid terminal state, `2` for typed operational block, `64` for invalid input.

- [ ] **Step 1: Write worker RED tests**

Use a temporary Git repository and fake `dotnet`, `git`, and network wrappers. Assert:

```ts
expect(runWorker("ARBITRARY_SHELL").status).toBe("OPERATION_NOT_ALLOWED")
expect(runWorker("CREATE_WORKSPACE", { workspace: "/tmp/other" }).status).toBe("WORKSPACE_MISMATCH")
expect(runWorker("APPLY_RESERVED_PATCH", { changedPaths: ["backend/src/Program.cs"] }).status).toBe("PATH_NOT_RESERVED")
expect(runWorker("CLEAN_EXACT_WORKSPACE", { merged: false }).status).toBe("CLEANUP_NOT_AUTHORIZED")
```

Also test symlink roots, `..`, wrong remote URL, wrong base SHA, dirty initial clone, extra staged path, resource excess, timeout, failed build, and cleanup ownership-marker mismatch.

- [ ] **Step 2: Write controller RED tests**

Provide fake `ssh.exe` that logs targets. Require every remote call to target `hermes`; reject a log containing a direct `aegis` target. Test BatchMode, bounded connect timeout, encoded payload transport, host-key policy preservation, no password option, no credential output, SSH timeout, Hermes authentication failure, AEGIS downstream timeout, and malformed worker output.

- [ ] **Step 3: Run both tests and verify RED**

```powershell
pnpm exec vitest run tests/execution-fabric-remote-dev-offload-worker.test.ts tests/execution-fabric-remote-dev-offload-controller.test.ts
```

Expected: fail because both scripts are absent.

- [ ] **Step 4: Implement the fixed Linux worker**

Use `set -euo pipefail`, `umask 077`, a fixed operation `case`, `realpath` confinement, an ownership marker containing `run_id`, `work_order_id`, repository, branch, and base SHA, and `timeout` for every external process. Never evaluate packet text or invoke `sh -c` with packet-derived content.

Hardcode operation-to-command mappings. Representative mappings:

```bash
RESTORE_DOTNET) dotnet restore backend/TerraFusion.sln ;;
TEST_WORKFLOW_CONTRACT) corepack pnpm exec vitest run tests/ci-terrafusion-unit-informational.test.ts ;;
TEST_DOTNET_INFORMATIONAL) dotnet test backend/tests/TerraFusion.Unit.Tests/TerraFusion.Unit.Tests.csproj -c Release --no-build -v:minimal /nologo ;;
BUILD_DOTNET_RELEASE) dotnet build backend/TerraFusion.sln -c Release --no-restore -v:minimal /nologo ;;
```

Capture the informational test's real nonzero exit without converting it to success; emit status `OBSERVED_FAILURE` and continue only because policy marks that single operation informational. All other nonzero exits stop the lifecycle.

- [ ] **Step 5: Implement the PowerShell controller**

Validate packet locally, create one sanitized evidence directory, and invoke only:

```powershell
ssh.exe -o BatchMode=yes -o ConnectTimeout=10 hermes powershell.exe -NoProfile -EncodedCommand <validated-relay-script>
```

The relay script must pin the known AEGIS fingerprint, call AEGIS with BatchMode and a finite timeout, and pass base64 JSON/patch bytes to the fixed worker without interpolation. It may not write a persistent Hermes file or modify Hermes configuration.

- [ ] **Step 6: Run focused GREEN and safety scans**

```powershell
pnpm exec vitest run tests/execution-fabric-remote-dev-offload-worker.test.ts tests/execution-fabric-remote-dev-offload-controller.test.ts tests/execution-fabric-remote-dev-offload-contract.test.ts
git diff --check
```

Expected: all pass; source scan finds no `StrictHostKeyChecking=no`, password option, `Invoke-Expression`, packet-derived `sh -c`, `eval`, Atlas host, or cleanup glob.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- scripts/execution-fabric/live/aegis-remote-dev-worker.sh scripts/execution-fabric/live/invoke-remote-dev-offload.ps1 tests/execution-fabric-remote-dev-offload-worker.test.ts tests/execution-fabric-remote-dev-offload-controller.test.ts
git commit -m "feat(fabric): add bounded AEGIS remote dev worker"
```

### Task 3: Live preflight and exact AEGIS workspace acquisition

**Files:**
- Runtime only: ignored `.artifacts/execution-fabric/remote-dev-offload-v1/$RUN_ID/packet.json`
- Runtime only: AEGIS `/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001`

**Interfaces:**
- Consumes: Tasks 1-2 controller and worker, fresh WilliamOS policy digest, fresh TerraFusion `origin/main` SHA.
- Produces: `PROVE_PREFLIGHT` and `CREATE_WORKSPACE` hash-chained evidence records.

- [ ] **Step 1: Generate and validate the live packet without remote writes**

Fetch both remotes, capture the TerraFusion `origin/main` SHA, generate a random lowercase GUID `runId`, set an expiry no later than four hours after issuance, bind the exact patch paths, and run the Task 1 CLI. Expected status: `READY`.

- [ ] **Step 2: Run bounded read-only Hermes-to-AEGIS recovery checks**

Through `ssh hermes`, verify the effective AEGIS host/user/key, known-host fingerprint, TCP/22, BatchMode authentication, hostname, OS, CPU, memory, disk free, process list for the exact workspace, Git, .NET 8, Node, Corepack/pnpm, and GitHub repository read/push capability. Do not alter SSH configuration, install packages, or write the workspace.

Expected: exact AEGIS identity, at least 12 logical CPUs, at least 12 GiB usable memory or a policy-lowered concurrency that remains within the 12-thread/12-GiB ceiling, at least 80 GiB free scratch, and authenticated Git push capability.

- [ ] **Step 3: Acquire exactly one workspace**

Invoke `CREATE_WORKSPACE`. The worker creates `/srv/william/workspaces` only if its existing canonical parent and ownership are safe, acquires an exclusive lock, creates the exact child, writes the ownership marker atomically, clones the authorized repository, checks out the pinned SHA, and creates the authorized branch.

Expected: clean branch at the pinned base, no second workspace, and hash-chained evidence.

- [ ] **Step 4: Prove OMEN/Hermes/Atlas negative boundaries**

Record that OMEN has no TerraFusion proof worktree/process for `dotnet`, `npm`, `pnpm`, Docker, or model execution; Hermes has no TerraFusion workspace/build process; Atlas received no connection from the controller or worker. Store only sanitized counts and command identities.

### Task 4: TerraFusion issue #734 informational gate, implemented on AEGIS

**Files:**
- Modify on AEGIS: `.github/workflows/dotnet-test.yml`
- Modify on AEGIS: `.github/workflows/terrafusion-ci.yml`
- Create on AEGIS: `tests/ci-terrafusion-unit-informational.test.ts`
- Create on AEGIS: `docs/brain/evidence/WO-TF-REMOTE-DEV-OFFLOAD-001-proof.md`

**Interfaces:**
- Consumes: Task 3 clean AEGIS branch and `APPLY_RESERVED_PATCH` operation.
- Produces: workflow input `informational: boolean = false`, job `backend-doctrine-informational`, and focused static contract tests.

- [ ] **Step 1: Apply the test-only patch and verify RED on AEGIS**

The focused test must parse the workflow text and assert:

```ts
expect(dotnetWorkflow).toContain("informational:")
expect(dotnetWorkflow).toContain("default: false")
expect(dotnetWorkflow).toContain("continue-on-error: ${{ inputs.informational }}")
expect(ciWorkflow).toContain("backend-doctrine-informational:")
expect(ciWorkflow).toContain("test_project: backend/tests/TerraFusion.Unit.Tests/TerraFusion.Unit.Tests.csproj")
expect(ciWorkflow).toContain("informational: true")
expect(hardBackendGateBlock).not.toContain("informational: true")
```

Run `TEST_WORKFLOW_CONTRACT`. Expected: fail because production workflow wiring is absent.

- [ ] **Step 2: Add the reusable workflow input**

Add this exact input under `workflow_call.inputs`:

```yaml
informational:
  description: Allow the test step to report known failures without failing the reusable job
  required: false
  type: boolean
  default: false
```

Add `continue-on-error: ${{ inputs.informational }}` only to `Canonical tests (Release)` and `Tests with coverage (Release)`. Do not add it to checkout, setup, cache, restore, build, or coverage-output verification.

- [ ] **Step 3: Add the project-wide informational job**

Add to `.github/workflows/terrafusion-ci.yml`:

```yaml
backend-doctrine-informational:
  name: Backend Doctrine Tests (informational known-failure baseline)
  uses: ./.github/workflows/dotnet-test.yml
  with:
    solution: backend/TerraFusion.sln
    test_project: backend/tests/TerraFusion.Unit.Tests/TerraFusion.Unit.Tests.csproj
    configuration: Release
    informational: true
```

Do not add the job to `evidence-gate.needs` or `wave5-seal.needs`. Do not add a test filter or edit the solution.

- [ ] **Step 4: Rerun focused GREEN on AEGIS**

Invoke `TEST_WORKFLOW_CONTRACT`. Expected: focused Vitest passes and the source contract proves only test steps can soft-fail.

- [ ] **Step 5: Commit the product implementation only after live validation**

Defer commit until Task 5 completes so the proof document contains exact AEGIS evidence. Stage only the four reserved paths.

### Task 5: AEGIS dependency, test, and Release-build proof

**Files:**
- Update on AEGIS: `docs/brain/evidence/WO-TF-REMOTE-DEV-OFFLOAD-001-proof.md`
- Runtime evidence: ignored WilliamOS `.artifacts/execution-fabric/remote-dev-offload-v1/$RUN_ID/`

**Interfaces:**
- Consumes: Task 4 candidate tree.
- Produces: real restore/test/build exit codes, timings, output hashes, test summary, AEGIS resource evidence, final TerraFusion commit SHA.

- [ ] **Step 1: Restore dependencies on AEGIS**

Invoke `RESTORE_DOTNET`. Expected: `dotnet restore backend/TerraFusion.sln` exits 0 within 90 minutes. Record output digest, duration, and AEGIS identity; do not commit package caches.

- [ ] **Step 2: Build the focused test project on AEGIS**

The reusable workflow's build target is the test project. Run:

```bash
dotnet build backend/tests/TerraFusion.Unit.Tests/TerraFusion.Unit.Tests.csproj -c Release --no-restore -v:minimal /nologo
```

Expected: exit 0. A nonzero result blocks delivery because informational mode applies only to test execution.

- [ ] **Step 3: Run the full informational test project on AEGIS**

Invoke `TEST_DOTNET_INFORMATIONAL`. Record total, passed, failed, skipped, exit code, duration, and output hash. Expected: either exit 0 or typed `OBSERVED_FAILURE`; never relabel a nonzero result as pass.

- [ ] **Step 4: Run the Release solution build on AEGIS**

Invoke `BUILD_DOTNET_RELEASE`. Expected: `dotnet build backend/TerraFusion.sln -c Release --no-restore -v:minimal /nologo` exits 0. A nonzero exit blocks V1 and is not softened.

- [ ] **Step 5: Run relevant repository regressions on AEGIS**

Run the focused Vitest contract plus workflow drift guards and YAML parsing available in the repository. Run `git diff --check`. Confirm `backend/TerraFusion.sln` and production source are unchanged.

- [ ] **Step 6: Finalize sanitized product evidence and commit on AEGIS**

Record exact AEGIS hostname, base SHA, operation timings, result counts, hashes, and the OMEN/Hermes/Atlas negative boundary. Exclude raw response bodies, credentials, environment dumps, and package contents.

Invoke `COMMIT_RESERVED_PATHS` with message:

```text
ci(backend): expose doctrine tests as informational
```

Expected: one commit containing exactly the four reserved TerraFusion paths.

- [ ] **Step 7: Push from AEGIS**

Invoke `PUSH_AUTHORIZED_BRANCH`. Expected: push succeeds from AEGIS using its existing authenticated Git path; evidence binds remote URL, branch, and commit SHA without exposing credentials.

### Task 6: GitHub PR, independent review, remediation, and merge

**Files:**
- Modify only if review requires it: the four reserved TerraFusion paths from Task 4.

**Interfaces:**
- Consumes: Task 5 pushed TerraFusion commit.
- Produces: TerraFusion PR URL, reviewed exact head, resolved threads, merge SHA, and `origin/main` ancestry proof.

- [ ] **Step 1: Open one TerraFusion PR**

Title:

```text
ci(backend): expose TerraFusion.Unit.Tests informationally
```

Body must link issue #734 and state that test failures are visible/non-blocking while restore/build remain blocking; include AEGIS execution hashes and affirm OMEN/Hermes/Atlas boundaries.

- [ ] **Step 2: Run independent review**

Reviewer verifies exact workflow semantics, no solution/production changes, full-project target without filter, default-hard reusable behavior, output truthfulness, AEGIS execution evidence, no arbitrary dispatch, no secret exposure, and changed-path scope.

- [ ] **Step 3: Remediate legitimate findings on AEGIS**

Return each accepted finding to the same AEGIS workspace. Apply only reserved-path patches, rerun Task 4 focused tests and Task 5 relevant build/test gates, commit, and push from AEGIS. Repeat for at most two remediation cycles.

- [ ] **Step 4: Verify exact head and required checks**

Require zero unresolved review threads, reviewed head equal to PR head, branch current with protected main, and every required GitHub check successful. The new informational test step may show its real known-failure outcome without blocking the reusable job.

- [ ] **Step 5: Merge and prove ancestry**

Use the applicable standing merge authority and normal protected-branch merge. Fetch fresh TerraFusion `origin/main` and require:

```bash
git merge-base --is-ancestor $MERGE_SHA origin/main
```

Expected exit: `0`.

### Task 7: Guarded AEGIS cleanup and control-plane closeout

**Files:**
- Create: `docs/reports/WO-TF-REMOTE-DEV-OFFLOAD-001.md`
- Modify: `scripts/execution-fabric/README.md`
- Existing: all Task 1-2 WilliamOS files

**Interfaces:**
- Consumes: Task 6 merge ancestry, complete hash chain, exact ownership marker, and absence of AEGIS processes inside the workspace.
- Produces: cleanup evidence, final control-plane tests, WilliamOS PR/merge, and terminal status.

- [ ] **Step 1: Prove cleanup eligibility**

Invoke `PROVE_POST_MERGE`. Require exact run/work-order/repository/branch/base/head/merge bindings, fresh `origin/main` ancestry, clean Git state, no process with cwd/open file beneath the workspace, and exact ownership marker.

- [ ] **Step 2: Remove only the exact workspace**

Invoke `CLEAN_EXACT_WORKSPACE`. The worker resolves both parent and child with `realpath`, rejects symlinks or mount points, compares the ownership marker, removes the exact child without globbing, fsyncs the parent when available, and emits post-cleanup absence evidence.

- [ ] **Step 3: Prove authority remained bounded**

Reassemble/read the live Execution Fabric status and require:

```text
SCHEDULER=disabled / not-granted
AEGIS_COMPUTE_EXECUTION_AUTHORITY=false
WORKSPACE_EXISTS=false
ACTIVE_PROOF_GRANT=false
```

Also prove OMEN performed zero TerraFusion dependency/test/build operations, Hermes retained no workspace, and Atlas received zero operations.

- [ ] **Step 4: Write the WilliamOS closeout report**

Record policy/packet/run/evidence hashes, AEGIS identity, TerraFusion PR/head/merge, test/build results, negative boundaries, cleanup proof, scope counters, and terminal status. Do not commit runtime packets, full logs, or secrets.

- [ ] **Step 5: Run full WilliamOS validation**

```powershell
pnpm exec vitest run tests/execution-fabric-remote-dev-offload-contract.test.ts tests/execution-fabric-remote-dev-offload-worker.test.ts tests/execution-fabric-remote-dev-offload-controller.test.ts tests/execution-fabric-dispatch-contract.test.ts tests/execution-fabric-shadow-placement.test.ts tests/execution-fabric-shadow-admission.test.ts
pnpm exec vitest run
git diff --check
```

Expected: all applicable tests pass; existing unrelated warnings are reported but not concealed.

- [ ] **Step 6: Commit control-plane evidence**

```powershell
git add -- config/execution-fabric/remote-dev-offload-v1.policy.json scripts/execution-fabric/live tests/execution-fabric-remote-dev-offload-contract.test.ts tests/execution-fabric-remote-dev-offload-worker.test.ts tests/execution-fabric-remote-dev-offload-controller.test.ts docs/superpowers/specs/2026-08-10-terrafusion-remote-dev-offload-v1-design.md docs/superpowers/plans/2026-08-10-terrafusion-remote-dev-offload-v1.md docs/reports/WO-TF-REMOTE-DEV-OFFLOAD-001.md scripts/execution-fabric/README.md
git commit -m "docs(fabric): close remote dev offload v1 proof"
```

- [ ] **Step 7: Open, review, and merge the WilliamOS control-plane PR**

Push the existing `codex/terrafusion-remote-dev-offload-v1` branch, open one WilliamOS PR, complete independent exact-head review/remediation, require normal checks, merge under standing authority, fetch fresh `origin/main`, and verify the merge is an ancestor.

- [ ] **Step 8: Return the terminal result**

Return the following labels populated directly from the retained runtime and GitHub evidence; no
field may contain an example, sentinel, or inferred value:

```text
TERRAFUSION_REMOTE_DEV_OFFLOAD_V1: COMPLETE
WORK_ORDER: WO-TF-REMOTE-DEV-OFFLOAD-001
AEGIS_WORKSPACE: CLEANED_AFTER_VERIFIED_MERGE
TERRAFUSION_PR: actual merged PR URL
TERRAFUSION_MERGE_SHA: actual verified merge SHA
WILLIAMOS_PR: actual merged PR URL
WILLIAMOS_MERGE_SHA: actual verified merge SHA
AEGIS_RESTORE: PASS
AEGIS_INFORMATIONAL_TEST: <PASS_OR_OBSERVED_FAILURE_WITH_COUNTS>
AEGIS_RELEASE_BUILD: PASS
OMEN_PROJECT_WORKLOADS: 0
HERMES_PROJECT_WORKLOADS: 0
ATLAS_OPERATIONS: 0
GENERAL_SCHEDULER: DISABLED
STANDING_AEGIS_AUTHORITY: FALSE
OWNER_ACTION_REQUIRED: false
```
