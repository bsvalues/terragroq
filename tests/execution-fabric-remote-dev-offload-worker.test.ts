import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"

import { afterEach, describe, expect, it } from "vitest"

import { bindRemoteDevPacket } from "../scripts/execution-fabric/live/remote-dev-offload-contract.mjs"

const root = process.cwd()
const worker = path.join(root, "scripts/execution-fabric/live/aegis-remote-dev-worker.sh")
const policy = JSON.parse(fs.readFileSync(path.join(root, "config/execution-fabric/remote-dev-offload-v1.policy.json"), "utf8"))
const bash = "C:\\Program Files\\Git\\bin\\bash.exe"
const tempRoots: string[] = []
const reservedPaths = [
  ".github/workflows/dotnet-test.yml",
  ".github/workflows/terrafusion-ci.yml",
  "tests/ci-terrafusion-unit-informational.test.ts",
  "docs/brain/evidence/WO-TF-REMOTE-DEV-OFFLOAD-001-proof.md",
]
const operations = ["PROVE_PREFLIGHT", "CREATE_WORKSPACE", "APPLY_RESERVED_PATCH", "RESTORE_DOTNET", "TEST_WORKFLOW_CONTRACT", "TEST_DOTNET_INFORMATIONAL", "BUILD_DOTNET_RELEASE", "COMMIT_RESERVED_PATHS", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE", "CLEAN_EXACT_WORKSPACE"]
const toPosix = (value: string) => `/${value[0].toLowerCase()}${value.slice(2).replaceAll("\\", "/")}`
const sha256 = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex")
const encode = (value: Buffer | string) => Buffer.from(value).toString("base64")

function envelope(baseSha: string) {
  return {
    schemaVersion: 2, programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001", goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001", loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001", workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001",
    objective: "Deliver the bounded TerraFusion informational CI proof.", riskClass: "R1", repositories: ["bsvalues/terrafusion_os_1.0"], baseRefs: [{ repository: "bsvalues/terrafusion_os_1.0", ref: "refs/heads/main", commitSha: baseSha }], dependencies: [], fanInGate: "ALL", laneId: "LANE-TF-REMOTE-DEV-OFFLOAD",
    teamRoles: { coordinator: "omen-controller", builder: "aegis-worker", reviewer: "independent-assurance" }, providerRequirements: ["hermes-relay"], preferredProviders: ["hermes-relay"], fallbackProviders: [],
    reservations: { paths: reservedPaths.map((entry) => ({ repository: "bsvalues/terrafusion_os_1.0", path: entry })), contracts: ["remote-dev-offload-v1"], environments: ["aegis-proof-workspace"] },
    allowedActions: ["READ_REPOSITORY", "WRITE_RESERVED_PATHS", "RUN_VALIDATION", "COMMIT_OWN_CHANGES", "PUSH_OWN_BRANCH", "OPEN_DRAFT_PR", "READ_CI_AND_REVIEW", "MERGE_ELIGIBLE_PR", "VERIFY_POST_MERGE"], forbiddenActions: ["OWNER_CONTACT", "CREDENTIAL_ACCESS", "RUNTIME_ACTIVATION", "PRODUCTION_WRITE", "BRANCH_PROTECTION_BYPASS", "DESTRUCTIVE_GIT"],
    authorityGrantRefs: ["grant-remote-dev-offload-v1"], programActivationGrantRef: "grant-remote-dev-offload-v1", grantStatusEventRefs: ["grant-status-remote-dev-offload-v1"], requiredOutputs: ["policy-bound-packet", "hash-chained-evidence"], requiredValidation: ["focused-vitest"], reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 }, mergeMode: "ASSURANCE_GATED", retryBudget: { maxAttempts: 3, backoffSeconds: 10 }, remediationBudget: { maxCycles: 2 }, reroutePolicy: "NONE", stopConditions: ["authority-wall", "resource-limit"], evidenceTargets: ["branch", "commit", "merge", "cleanup"], ownerDecisionConditions: [], ownerOperationsAllowed: false,
  }
}

function makePacket(baseSha: string, patch: Buffer, overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  const packet: any = {
    schemaVersion: 1, runId: "0f8fad5b-d9cb-469f-a165-70867728950e", workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001", repository: "bsvalues/terrafusion_os_1.0", baseRef: "refs/heads/main", baseSha,
    branch: "codex/wo-tf-remote-dev-offload-001-734", nodeId: "aegis", workspace: "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001", transport: { controller: "omen", relay: "hermes", worker: "aegis" },
    resourceLimits: { cpuThreads: 12, memoryBytes: 12884901888, scratchBytes: 85899345920, timeoutSeconds: 5400, maxAttempts: 3 }, operations,
    patch: { sha256: sha256(patch), generation: 1, changedPaths: reservedPaths },
    authority: { grantId: "grant-remote-dev-offload-v1", issuedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), singleUse: true }, bindings: { policySha256: "", packetSha256: "" }, ...overrides,
  }
  const result = bindRemoteDevPacket(packet, policy, { now: new Date(now).toISOString(), seenRunIds: [], branch: packet.branch, dispatchEnvelope: envelope(baseSha) })
  if (result.status !== "READY") throw new Error(JSON.stringify(result))
  return result.packet
}

function writeExecutable(file: string, body: string) {
  fs.writeFileSync(file, body.replaceAll("\r\n", "\n"))
  fs.chmodSync(file, 0o755)
}

function fixture() {
  const hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), "remote-dev-worker-")); tempRoots.push(hostRoot)
  const physicalWorkspace = path.join(hostRoot, "srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001")
  const repository = path.join(physicalWorkspace, "repository")
  fs.mkdirSync(repository, { recursive: true })
  execFileSync("git", ["init", "-q"], { cwd: repository })
  execFileSync("git", ["config", "user.email", "worker-test@example.invalid"], { cwd: repository })
  execFileSync("git", ["config", "user.name", "Worker Test"], { cwd: repository })
  fs.writeFileSync(path.join(repository, "README.md"), "base\n")
  execFileSync("git", ["add", "README.md"], { cwd: repository })
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repository })
  const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim()
  execFileSync("git", ["branch", "-M", "codex/wo-tf-remote-dev-offload-001-734"], { cwd: repository })
  execFileSync("git", ["remote", "add", "origin", "git@github.com:bsvalues/terrafusion_os_1.0.git"], { cwd: repository })
  const patch = Buffer.from("", "utf8")
  const packet = makePacket(baseSha, patch)
  fs.writeFileSync(path.join(physicalWorkspace, ".williamos-remote-dev-owner.json"), JSON.stringify({ run_id: packet.runId, work_order_id: packet.workOrderId, repository: packet.repository, branch: packet.branch, base_sha: packet.baseSha }))
  fs.mkdirSync(path.join(physicalWorkspace, ".williamos-scratch"), { mode: 0o700 })
  const fakeBin = path.join(hostRoot, "bin"); fs.mkdirSync(fakeBin)
  writeExecutable(path.join(fakeBin, "dotnet"), `#!/usr/bin/env bash
if [[ "\${FAKE_DOTNET_MODE:-ok}" == timeout ]]; then sleep 3; fi
if [[ "\${FAKE_DOTNET_MODE:-ok}" == build-fail && "\${1:-}" == build ]]; then exit 7; fi
if [[ "\${1:-}" == test ]]; then
  previous=''
  for arg in "$@"; do
    [[ "$previous" == --results-directory ]] && results="$arg"
    case "$arg" in *LogFileName=*) trx="\${arg#*LogFileName=}";; esac
    previous="$arg"
  done
  [[ "\${trx:-}" == /* ]] || trx="\${results:?}/\${trx:?}"
  if [[ "\${FAKE_DOTNET_MODE:-ok}" != test-infra ]]; then
    mkdir -p "$(dirname "$trx")"
    if [[ "\${FAKE_DOTNET_MODE:-ok}" == test-assertion ]]; then printf '%s\n' '<TestRun><ResultSummary outcome="Failed"><Counters failed="1" passed="2" total="3" aborted="0" executed="3" timeout="0" error="0" /></ResultSummary></TestRun>' > "$trx"; exit 1
    else printf '%s\n' '<TestRun><ResultSummary outcome="Completed"><Counters passed="3" total="3" failed="0" executed="3" error="0" aborted="0" timeout="0" /></ResultSummary></TestRun>' > "$trx"; fi
  fi
fi
if [[ "\${1:-}" == test && "\${FAKE_DOTNET_MODE:-ok}" == test-infra ]]; then exit 9; fi
exit 0
`)
  writeExecutable(path.join(fakeBin, "corepack"), "#!/usr/bin/env bash\nexit 0\n")
  writeExecutable(path.join(fakeBin, "taskset"), "#!/usr/bin/env bash\nshift 2\nexec \"$@\"\n")
  writeExecutable(path.join(fakeBin, "prlimit"), "#!/usr/bin/env bash\nwhile [[ \"$1\" != -- ]]; do shift; done\nshift\nexec \"$@\"\n")
  writeExecutable(path.join(fakeBin, "flock"), "#!/usr/bin/env bash\nexit 0\n")
  writeExecutable(path.join(fakeBin, "du"), "#!/usr/bin/env bash\nprintf '%s\\t%s\\n' \"\${FAKE_SCRATCH_BYTES:-4096}\" \"\${@: -1}\"\n")
  writeExecutable(path.join(fakeBin, "findmnt"), `#!/usr/bin/env bash
if [[ "$*" == *"FSTYPE,OPTIONS,TARGET"* ]]; then printf '%s\n' "xfs rw,relatime,prjquota \${FAKE_MOUNT_TARGET:-/srv/william}"; exit 0; fi
if [[ "$*" == *"--target /tmp"* ]]; then printf '%s\n' tmpfs; exit 0; fi
[[ "\${FAKE_NESTED_MOUNT:-0}" == 1 ]] && printf '%s\n' '/nested/mount'
exit 0
`)
  writeExecutable(path.join(fakeBin, "xfs_io"), "#!/usr/bin/env bash\nprintf '%s\\n' 'fsxattr.xflags = 0x00000800 [proj-inherit]' 'fsxattr.projid = 734'\n")
  writeExecutable(path.join(fakeBin, "xfs_quota"), `#!/usr/bin/env bash
if [[ "$*" == *"state -p"* ]]; then
  if [[ "\${FAKE_QUOTA_STATE:-on}" == off ]]; then printf '%s\n' 'Project quota state' '  Accounting: OFF' '  Enforcement: OFF'
  else printf '%s\n' 'Project quota state' '  Accounting: ON' '  Enforcement: ON'; fi
  exit 0
fi
printf '%s\n' '734 0 0 83886080'
`)
  writeExecutable(path.join(fakeBin, "systemd-run"), `#!/usr/bin/env bash
props=''
while [[ $# -gt 0 ]]; do
  if [[ "$1" == -- ]]; then shift; break; fi
  case "$1" in
    -p) shift; props="$props|\${1:-}";;
    --setenv=*) value="\${1#--setenv=}"; export "\${value?}";;
  esac
  shift
done
if [[ "\${1:-}" == test && ( " $* " == *" ! -w /tmp "* || " $* " == *" -w "* ) ]]; then
  [[ "$props" == *"ReadWritePaths="* && "$props" == *"ReadOnlyPaths=/tmp /var/tmp"* ]] || exit 71
  exit 0
fi
if [[ "\${1:-}" == findmnt ]]; then printf '%s\n' tmpfs; exit 0; fi
if [[ "\${FAKE_NAMESPACE_STRICT:-0}" == 1 ]]; then
  workspace="\${REMOTE_DEV_WORKER_ROOT}/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001"
  parent="\${REMOTE_DEV_WORKER_ROOT}/srv/william/workspaces"
  if [[ "\${1:-}" == rm ]]; then
    [[ "$props" == *"ReadWritePaths=$parent"* && "$props" != *"ReadWritePaths=$workspace"* ]] || exit 73
  else
    [[ "$props" == *"ReadWritePaths=$workspace"* && "$props" == *"ReadOnlyPaths=/tmp /var/tmp"* ]] || exit 74
    for value in "\${TMPDIR:-}" "\${TMP:-}" "\${TEMP:-}" "\${XDG_CACHE_HOME:-}" "\${NUGET_PACKAGES:-}" "\${DOTNET_CLI_HOME:-}" "\${COREPACK_HOME:-}" "\${npm_config_cache:-}"; do
      [[ "$value" == "$workspace/.williamos-scratch"/* ]] || exit 75
    done
    if [[ "\${1:-}" == dotnet && " $* " == *" test "* ]]; then
      [[ " $* " == *" --results-directory $workspace/.williamos-scratch/"* ]] || exit 76
      [[ " $* " != *"/tmp/"* ]] || exit 77
    fi
  fi
fi
exec "$@"
`)
  return { hostRoot, physicalWorkspace, repository, baseSha, patch, packet, fakeBin }
}

function runWorker(operation: string, value: ReturnType<typeof fixture>, options: { packet?: any, patch?: Buffer, env?: Record<string, string> } = {}) {
  const packet = options.packet ?? value.packet
  const patch = options.patch ?? value.patch
  const result = spawnSync(bash, [worker, operation, encode(JSON.stringify(packet)), encode(patch), "1", "null"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${toPosix(value.fakeBin)}:${toPosix("C:\\Program Files\\nodejs")}:${process.env.PATH}`, REMOTE_DEV_WORKER_ROOT: toPosix(value.hostRoot), REMOTE_DEV_PROCESS_TIMEOUT_SECONDS: "2", ...options.env },
    timeout: 20_000,
  })
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean)
  return { ...result, json: lines.length ? JSON.parse(lines.at(-1)!) : undefined }
}

function workerSummary(stderr: string) {
  const line = stderr.split(/\r?\n/).find((entry) => entry.startsWith("REMOTE_DEV_SUMMARY\t"))
  return line ? JSON.parse(Buffer.from(line.split("\t", 2)[1], "base64").toString("utf8")) : undefined
}

afterEach(() => { while (tempRoots.length) fs.rmSync(tempRoots.pop()!, { recursive: true, force: true }) })

describe("fixed AEGIS remote development worker", () => {
  it("rejects arbitrary operations, wrong workspaces, and widened resources as invalid input", () => {
    const value = fixture()
    expect(runWorker("ARBITRARY_SHELL", value).json).toMatchObject({ status: "OPERATION_NOT_ALLOWED" })
    expect(runWorker("PROVE_PREFLIGHT", value, { packet: { ...value.packet, workspace: "/tmp/other" } }).json).toMatchObject({ status: "WORKSPACE_MISMATCH" })
    expect(runWorker("PROVE_PREFLIGHT", value, { packet: { ...value.packet, resourceLimits: { ...value.packet.resourceLimits, cpuThreads: 13 } } }).json).toMatchObject({ status: "RESOURCE_LIMIT_EXCEEDED" })
  })

  it("rejects patch content outside the four reserved paths", () => {
    const value = fixture()
    fs.mkdirSync(path.join(value.repository, "backend/src"), { recursive: true })
    fs.writeFileSync(path.join(value.repository, "backend/src/Program.cs"), "unsafe\n")
    const diff = spawnSync("git", ["diff", "--no-index", "--", "/dev/null", "backend/src/Program.cs"], { cwd: value.repository, encoding: "utf8" })
    expect(diff.status).toBe(1)
    const patch = Buffer.from(diff.stdout)
    fs.rmSync(path.join(value.repository, "backend/src/Program.cs"))
    const packet = makePacket(value.baseSha, patch)
    expect(runWorker("APPLY_RESERVED_PATCH", value, { packet, patch }).json).toMatchObject({ status: "PATH_NOT_RESERVED" })
  }, 15_000)

  it("rejects symlinked roots, traversal, wrong Git identity, dirty state, and extra staged paths", () => {
    const symlinked = fixture()
    const outside = path.join(symlinked.hostRoot, "outside"); fs.mkdirSync(outside)
    fs.rmSync(symlinked.physicalWorkspace, { recursive: true, force: true })
    fs.symlinkSync(outside, symlinked.physicalWorkspace, "junction")
    expect(runWorker("PROVE_PREFLIGHT", symlinked).json).toMatchObject({ status: "SYMLINK_REJECTED" })

    const wrongRemote = fixture(); execFileSync("git", ["remote", "set-url", "origin", "git@github.com:bsvalues/other.git"], { cwd: wrongRemote.repository })
    expect(runWorker("RESTORE_DOTNET", wrongRemote).json).toMatchObject({ status: "GIT_REMOTE_MISMATCH" })

    const wrongBase = fixture(); fs.writeFileSync(path.join(wrongBase.repository, "README.md"), "next\n"); execFileSync("git", ["commit", "-qam", "next"], { cwd: wrongBase.repository })
    expect(runWorker("RESTORE_DOTNET", wrongBase).json).toMatchObject({ status: "GIT_BASE_MISMATCH" })

    const dirty = fixture(); fs.writeFileSync(path.join(dirty.repository, "foreign.txt"), "dirty\n")
    expect(runWorker("RESTORE_DOTNET", dirty).json).toMatchObject({ status: "DIRTY_WORKSPACE" })

    const staged = fixture(); fs.writeFileSync(path.join(staged.repository, "foreign.txt"), "staged\n"); execFileSync("git", ["add", "foreign.txt"], { cwd: staged.repository })
    expect(runWorker("COMMIT_RESERVED_PATHS", staged).json).toMatchObject({ status: "PATH_NOT_RESERVED" })
  }, 60_000)

  it("times out bounded processes, blocks failed builds, and preserves informational failures", () => {
    const timedOut = fixture()
    expect(runWorker("RESTORE_DOTNET", timedOut, { env: { FAKE_DOTNET_MODE: "timeout", REMOTE_DEV_PROCESS_TIMEOUT_SECONDS: "1" } }).json).toMatchObject({ status: "PROCESS_TIMEOUT" })
    const failed = fixture()
    expect(runWorker("BUILD_DOTNET_RELEASE", failed, { env: { FAKE_DOTNET_MODE: "build-fail" } }).json).toMatchObject({ status: "BLOCKING_OPERATION_FAILED" })
    const observed = fixture()
    const assertionResult = runWorker("TEST_DOTNET_INFORMATIONAL", observed, { env: { FAKE_DOTNET_MODE: "test-assertion" } })
    expect(assertionResult.json).toMatchObject({ status: "OBSERVED_FAILURE" })
    expect(workerSummary(assertionResult.stderr).testCounts).toEqual({ total: 3, executed: 3, passed: 2, failed: 1 })
    const infrastructure = fixture()
    expect(runWorker("TEST_DOTNET_INFORMATIONAL", infrastructure, { env: { FAKE_DOTNET_MODE: "test-infra" } }).json).toMatchObject({ status: "INFORMATIONAL_TEST_INFRASTRUCTURE_FAILED" })
  }, 60_000)

  it("fails preflight when aggregate containment is unavailable", () => {
    const missing = fixture(); fs.rmSync(missing.physicalWorkspace, { recursive: true, force: true }); fs.rmSync(path.join(missing.fakeBin, "systemd-run"))
    expect(runWorker("PROVE_PREFLIGHT", missing).json).toMatchObject({ status: "CONTAINMENT_UNAVAILABLE" })
  })

  it("requires one aggregate systemd cgroup and an inherited 80 GiB XFS project quota rather than per-process hints", () => {
    const source = fs.readFileSync(worker, "utf8")
    expect(source).toContain("systemd-run --user")
    expect(source).toContain("AllowedCPUs=0-11")
    expect(source).toContain("CPUQuota=1200%")
    expect(source).toContain("MemoryMax=12884901888")
    expect(source).toContain("xfs_io")
    expect(source).toContain("xfs_quota")
    expect(source).toContain("proj-inherit")
    expect(source).toContain("SCRATCH_LIMIT_KIB=83886080")
    expect(source).not.toContain("taskset -c 0-11")
    expect(source).not.toContain("prlimit --as=12884901888")
  })

  it("keeps preflight read-only and checks exact identity, toolchain, capacity, containment, and repository auth", () => {
    const value = fixture()
    fs.rmSync(value.physicalWorkspace, { recursive: true, force: true })
    fs.rmSync(path.join(value.fakeBin, "systemd-run"))
    const parent = path.dirname(value.physicalWorkspace)
    const before = fs.readdirSync(parent).sort()
    const result = runWorker("PROVE_PREFLIGHT", value)
    expect(result.json).toMatchObject({ status: "CONTAINMENT_UNAVAILABLE" })
    expect(fs.readdirSync(parent).sort()).toEqual(before)
    const source = fs.readFileSync(worker, "utf8")
    const preflight = source.slice(source.indexOf("PROVE_PREFLIGHT)"), source.indexOf("CREATE_WORKSPACE)"))
    for (const required of ["hostname", "id -un", "git --version", "dotnet --version", "node --version", "corepack pnpm --version", "nproc", "MemTotal", "df -PB1", "run_preflight_repository_profile", "probe_containment", "prove_project_quota"]) expect(preflight).toContain(required)
    for (const required of ["git ls-remote", "push --dry-run", "TemporaryFileSystem=/tmp:size=4294967296"]) expect(source).toContain(required)
    expect(source).not.toContain("PREFLIGHT_TMP_ROOT")
    expect(preflight).not.toContain('exec 9>')
    expect(preflight).not.toContain('flock -n')
    expect(source).toContain('if [[ "$OPERATION" != "PROVE_PREFLIGHT" ]]')
  })

  it("fails closed when the bounded project quota cannot be proven and confines cache/temp paths", () => {
    const badQuota = fixture(); fs.rmSync(badQuota.physicalWorkspace, { recursive: true, force: true })
    writeExecutable(path.join(badQuota.fakeBin, "xfs_quota"), "#!/usr/bin/env bash\nprintf '%s\\n' '734 0 0 1024'\n")
    expect(runWorker("PROVE_PREFLIGHT", badQuota).json).toMatchObject({ status: "SCRATCH_CONFINEMENT_FAILED" })
    const oversized = fixture()
    expect(runWorker("RESTORE_DOTNET", oversized, { env: { FAKE_SCRATCH_BYTES: "85899345921" } }).json).toMatchObject({ status: "SCRATCH_CONFINEMENT_FAILED" })
    const source = fs.readFileSync(worker, "utf8")
    expect(source).toContain("CONTAINMENT_UNAVAILABLE")
    expect(source).toContain("SCRATCH_CONFINEMENT_FAILED")
    for (const variable of ["TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME", "NUGET_PACKAGES", "DOTNET_CLI_HOME", "COREPACK_HOME", "npm_config_cache"]) expect(source).toContain(`--setenv=${variable}=`)
    expect(source).toContain('run_ordinary_profile "$PHYSICAL_WORKSPACE" "$SCRATCH_DIR"')
    expect(source).toContain('ReadOnlyPaths=/tmp /var/tmp')
    expect(source).toContain('measure_scratch; SCRATCH_BEFORE="$SCRATCH_MEASURED_BYTES"')
    expect(source).toContain('measure_scratch; SCRATCH_AFTER="$SCRATCH_MEASURED_BYTES"')
  }, 15_000)

  it("requires project quota accounting and enforcement to be active", () => {
    const value = fixture(); fs.rmSync(value.physicalWorkspace, { recursive: true, force: true })
    expect(runWorker("PROVE_PREFLIGHT", value, { env: { FAKE_QUOTA_STATE: "off" } }).json).toMatchObject({ status: "SCRATCH_CONFINEMENT_FAILED" })
    expect(fs.readFileSync(worker, "utf8")).toContain('state -p')
  })

  it("keeps informational TRX and every operational capture inside quota-bound scratch under the real namespace profile", () => {
    const value = fixture()
    const result = runWorker("TEST_DOTNET_INFORMATIONAL", value, { env: { FAKE_NAMESPACE_STRICT: "1", FAKE_DOTNET_MODE: "test-assertion" } })
    expect(result.json).toMatchObject({ status: "OBSERVED_FAILURE" })
    expect(workerSummary(result.stderr).testCounts).toEqual({ total: 3, executed: 3, passed: 2, failed: 1 })
    const source = fs.readFileSync(worker, "utf8")
    expect(source).not.toContain('OUTPUT_FILE="$TMP_ROOT/output.log"')
    expect(source).toContain('--results-directory "$RESULTS_DIR"')
    expect(source).toContain('TRX_FILE="$RESULTS_DIR/informational.trx"')
  }, 20_000)

  it("probes both namespace profiles before acquisition and removes the exact workspace through the parent cleanup profile", () => {
    const preflight = fixture(); fs.rmSync(preflight.physicalWorkspace, { recursive: true, force: true })
    expect(runWorker("PROVE_PREFLIGHT", preflight, { env: { FAKE_REQUIRE_PROFILE_PROBES: "1" } }).json).not.toMatchObject({ status: "CONTAINMENT_UNAVAILABLE" })

    const cleanup = fixture()
    fs.writeFileSync(path.join(cleanup.physicalWorkspace, ".williamos-post-merge-proven"), `${cleanup.packet.runId}:${cleanup.baseSha}\n`)
    const result = runWorker("CLEAN_EXACT_WORKSPACE", cleanup, { env: { FAKE_NAMESPACE_STRICT: "1" } })
    expect(result.json).toMatchObject({ status: "CLEANUP_ABSENCE_PROVEN" })
    expect(fs.existsSync(cleanup.physicalWorkspace)).toBe(false)
    const source = fs.readFileSync(worker, "utf8")
    expect(source).toContain('-p "ReadWritePaths=$PHYSICAL_PARENT"')
    expect(source).not.toContain('run_cleanup_capture rm -rf -- "$PHYSICAL_WORKSPACE"')
  }, 30_000)

  it("emits strict sub-second timestamps and rejects a non-increasing clock", () => {
    const source = fs.readFileSync(worker, "utf8")
    expect(source).toContain("%Y-%m-%dT%H:%M:%S.%3NZ")
    expect(source).toContain("CLOCK_NOT_MONOTONIC")
  })

  it("locks workspace lifecycle, recovers only exact owned partial creation, and rejects reserved symlinks", () => {
    const value = fixture()
    const reserved = path.join(value.repository, ".github/workflows/dotnet-test.yml")
    fs.mkdirSync(path.dirname(reserved), { recursive: true })
    fs.symlinkSync(path.join(value.repository, "README.md"), reserved)
    expect(runWorker("RESTORE_DOTNET", value).json).toMatchObject({ status: "RESERVED_PATH_SYMLINK_REJECTED" })
    const source = fs.readFileSync(worker, "utf8")
    expect(source).toContain("WORKSPACE_LOCK_BUSY")
    expect(source).toContain("PARTIAL_WORKSPACE_RECOVERED")
    expect(source).toContain("validate_trusted_parent")
  })

  it("deterministically resets an exact owned partial repository during workspace creation", () => {
    const value = fixture()
    fs.writeFileSync(path.join(value.repository, "partial-clone.tmp"), "partial")
    writeExecutable(path.join(value.fakeBin, "git"), `#!/usr/bin/env bash
if [[ "\${1:-}" == clone ]]; then dest="\${@: -1}"; mkdir -p "$dest/.git"; exit 0; fi
if [[ "\${1:-}" == -C ]]; then shift 2; fi
if [[ "\${1:-}" == rev-parse ]]; then printf '%s\\n' "$FAKE_BASE_SHA"; fi
exit 0
`)
    const result = runWorker("CREATE_WORKSPACE", value, { env: { FAKE_BASE_SHA: value.baseSha } })
    expect(result.json).toMatchObject({ status: "SUCCEEDED" })
    expect(fs.existsSync(path.join(value.repository, "partial-clone.tmp"))).toBe(false)
  }, 15_000)

  it("rejects every nested mount before exact cleanup", () => {
    const value = fixture()
    fs.writeFileSync(path.join(value.physicalWorkspace, ".williamos-post-merge-proven"), `${value.packet.runId}:${value.baseSha}\n`)
    expect(runWorker("CLEAN_EXACT_WORKSPACE", value, { env: { FAKE_NESTED_MOUNT: "1" } }).json).toMatchObject({ status: "CLEANUP_NESTED_MOUNT" })
    expect(fs.existsSync(value.physicalWorkspace)).toBe(true)
  })

  it("does not clean without exact ownership and post-merge proof", () => {
    const value = fixture()
    expect(runWorker("CLEAN_EXACT_WORKSPACE", value).json).toMatchObject({ status: "CLEANUP_NOT_AUTHORIZED" })
    fs.writeFileSync(path.join(value.physicalWorkspace, ".williamos-post-merge-proven"), "wrong\n")
    expect(runWorker("CLEAN_EXACT_WORKSPACE", value).json).toMatchObject({ status: "CLEANUP_NOT_AUTHORIZED" })
    expect(fs.existsSync(value.physicalWorkspace)).toBe(true)
  }, 15_000)

})
