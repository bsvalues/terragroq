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
const bashUid = execFileSync(bash, ["-lc", "id -u"], { encoding: "utf8" }).trim()
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
  if (result.status !== "INACTIVE_TRUSTED_MAIN_READY") throw new Error(JSON.stringify(result))
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
  writeExecutable(path.join(fakeBin, "id"), `#!/usr/bin/env bash
if [[ "\${1:-}" == -un ]]; then printf '%s\n' "\${FAKE_EXECUTION_ACCOUNT:-williamos-fabric}"; exit 0; fi
if [[ "\${1:-}" == -u ]]; then printf '%s\n' '${bashUid}'; exit 0; fi
exec /usr/bin/id "$@"
`)
  writeExecutable(path.join(fakeBin, "dotnet"), `#!/usr/bin/env bash
if [[ "\${1:-}" == --version ]]; then printf '%s\n' '8.0.100'; exit 0; fi
if [[ "\${FAKE_REQUIRE_REPO_CWD:-0}" == 1 ]]; then [[ "$PWD" == "$REMOTE_DEV_WORKER_ROOT/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001/repository" ]] || exit 66; fi
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
  writeExecutable(path.join(fakeBin, "corepack"), `#!/usr/bin/env bash
if [[ "\${FAKE_REQUIRE_REPO_CWD:-0}" == 1 ]]; then [[ "$PWD" == "$REMOTE_DEV_WORKER_ROOT/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001/repository" ]] || exit 67; fi
if [[ " $* " == *" pnpm --version "* ]]; then printf '%s\n' '9.15.0'; fi
exit 0
`)
  writeExecutable(path.join(fakeBin, "taskset"), "#!/usr/bin/env bash\nshift 2\nexec \"$@\"\n")
  writeExecutable(path.join(fakeBin, "prlimit"), "#!/usr/bin/env bash\nwhile [[ \"$1\" != -- ]]; do shift; done\nshift\nexec \"$@\"\n")
  writeExecutable(path.join(fakeBin, "flock"), `#!/usr/bin/env bash
if [[ "\${FAKE_QUARANTINE_ON_LOCK:-0}" == 1 ]]; then mkdir -p -- "$REMOTE_DEV_WORKER_ROOT/srv/william/workspaces/.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-11111111-1111-4111-8111-111111111111"; fi
exit 0
`)
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
  writeExecutable(path.join(fakeBin, "find"), `#!/usr/bin/env bash
entered="$REMOTE_DEV_WORKER_ROOT/quarantine-entered"
if [[ "\${1:-}" == /proc ]]; then [[ -n "\${FAKE_PROC_IN_USE:-}" || -f "$entered" ]] && printf '%s\n' /proc/4242; exit 0; fi
if [[ "\${1:-}" == /proc/4242/fd ]]; then [[ "\${FAKE_PROC_IN_USE:-}" == *fd ]] && printf '%s\n' /proc/4242/fd/3; exit 0; fi
exec /usr/bin/find "$@"
`)
  writeExecutable(path.join(fakeBin, "stat"), `#!/usr/bin/env bash
if [[ ( -n "\${FAKE_PROC_IN_USE:-}" || -f "$REMOTE_DEV_WORKER_ROOT/quarantine-entered" ) && "\${@: -1}" == /proc/4242 ]]; then [[ "\${FAKE_PROC_IN_USE:-}" == other-* ]] && printf '%s\n' '${Number(bashUid) + 1}' || printf '%s\n' '${bashUid}'; exit 0; fi
exec /usr/bin/stat "$@"
`)
  writeExecutable(path.join(fakeBin, "readlink"), `#!/usr/bin/env bash
if [[ -n "\${FAKE_PROC_IN_USE:-}" || -f "$REMOTE_DEV_WORKER_ROOT/quarantine-entered" ]]; then
  entered_target=''
  [[ -f "$REMOTE_DEV_WORKER_ROOT/quarantine-entered" ]] && entered_target="$(<"$REMOTE_DEV_WORKER_ROOT/quarantine-entered")"
  quarantine_target="$(/usr/bin/find "$REMOTE_DEV_WORKER_ROOT/srv/william/workspaces" -mindepth 1 -maxdepth 1 -type d -name '.williamos-quarantine-*' -print -quit 2>/dev/null)"
  case "\${@: -1}" in
    /proc/4242/cwd) if [[ -n "$entered_target" ]]; then printf '%s\n' "$entered_target"; elif [[ "$FAKE_PROC_IN_USE" == cwd ]]; then printf '%s\n' "\${quarantine_target:-$REMOTE_DEV_WORKER_ROOT/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001}"; else printf '%s\n' /unrelated; fi;;
    /proc/4242/root) printf '%s\n' /;;
    /proc/4242/fd/3) printf '%s\n' "\${quarantine_target:-$REMOTE_DEV_WORKER_ROOT/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001}/repository/README.md";;
    *) exec /usr/bin/readlink "$@";;
  esac
  exit 0
fi
exec /usr/bin/readlink "$@"
`)
  writeExecutable(path.join(fakeBin, "sync"), `#!/usr/bin/env bash
[[ "\${FAKE_SYNC_FAIL:-0}" == 1 ]] && exit 9
[[ -n "\${FAKE_SYNC_LOG:-}" ]] && printf '%s\n' "\${@: -1}" > "$FAKE_SYNC_LOG"
exit 0
`)
  writeExecutable(path.join(fakeBin, "systemd-run"), `#!/usr/bin/env bash
props=''
working_directory=''
expand_disabled=0
while [[ $# -gt 0 ]]; do
  if [[ "$1" == -- ]]; then shift; break; fi
  case "$1" in
    -p) shift; props="$props|\${1:-}"; case "\${1:-}" in WorkingDirectory=*) working_directory="\${1#WorkingDirectory=}";; esac;;
    --expand-environment=no) expand_disabled=1;;
    --setenv=*) value="\${1#--setenv=}"; export "\${value?}";;
  esac
  shift
done
if [[ "\${FAKE_REQUIRE_NO_EXPAND:-0}" == 1 ]]; then
  [[ "$expand_disabled" == 1 ]] || exit 78
  if [[ "\${1:-}" == bash && "\${2:-}" == -c ]]; then
    [[ "\${3:-}" == *'$proof'* && "\${3:-}" == *'$REMOTE_URL'* && "\${3:-}" == *'$BASE_SHA'* && "\${3:-}" == *'$RUN_ID'* ]] || exit 79
  fi
fi
if [[ -n "$working_directory" ]]; then cd "$working_directory" || exit 80
elif [[ "\${FAKE_SERVICE_DEFAULT_CWD:-0}" == 1 ]]; then cd "$REMOTE_DEV_WORKER_ROOT" || exit 81
fi
if [[ "\${1:-}" == mv && "\${FAKE_ENTER_BEFORE_QUARANTINE:-0}" == 1 ]]; then printf '%s\n' "\${@: -1}" > "$REMOTE_DEV_WORKER_ROOT/quarantine-entered"; fi
if [[ "\${1:-}" == mv && "\${FAKE_RECREATE_ORIGINAL:-0}" == 1 ]]; then source_path="\${@: -2:1}"; "$@" || exit $?; mkdir -- "$source_path"; exit 0; fi
if [[ "\${1:-}" == test && ( " $* " == *" ! -w /tmp "* || " $* " == *" -w "* ) ]]; then
  [[ "$props" == *"ReadWritePaths="* && "$props" == *"ReadOnlyPaths=/tmp /var/tmp"* ]] || exit 71
  exit 0
fi
if [[ "\${1:-}" == findmnt ]]; then printf '%s\n' tmpfs; exit 0; fi
if [[ "\${FAKE_NAMESPACE_STRICT:-0}" == 1 ]]; then
  workspace="\${REMOTE_DEV_WORKER_ROOT}/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001"
  parent="\${REMOTE_DEV_WORKER_ROOT}/srv/william/workspaces"
  if [[ "\${1:-}" == rm || "\${1:-}" == mv ]]; then
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

function runWorker(operation: string, value: ReturnType<typeof fixture>, options: { packet?: any, patch?: Buffer, env?: Record<string, string>, attempt?: number, previous?: string } = {}) {
  const packet = options.packet ?? value.packet
  const patch = options.patch ?? value.patch
  const result = spawnSync(bash, [worker, operation, encode(JSON.stringify(packet)), encode(patch), String(options.attempt ?? 1), options.previous ?? "null"], {
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
  it("rejects any execution identity other than williamos-fabric", () => {
    const value = fixture()
    expect(runWorker("PROVE_PREFLIGHT", value, { env: { FAKE_EXECUTION_ACCOUNT: "bs" } }).json).toMatchObject({ status: "EXECUTION_IDENTITY_MISMATCH" })
  })

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

  it("binds ordinary services to the exact repository instead of inheriting the manager working directory", () => {
    const value = fixture()
    const env = { FAKE_SERVICE_DEFAULT_CWD: "1", FAKE_REQUIRE_REPO_CWD: "1" }
    for (const operation of ["RESTORE_DOTNET", "TEST_WORKFLOW_CONTRACT", "TEST_DOTNET_INFORMATIONAL", "BUILD_DOTNET_RELEASE"]) {
      expect(runWorker(operation, value, { env }).json).toMatchObject({ status: "SUCCEEDED" })
    }
    expect(fs.readFileSync(worker, "utf8")).toContain('-p "WorkingDirectory=$working_directory"')
  }, 45_000)

  it("disables systemd manager expansion and preserves fixed preflight Bash variables", () => {
    const value = fixture(); fs.rmSync(value.physicalWorkspace, { recursive: true, force: true })
    writeExecutable(path.join(value.fakeBin, "hostname"), "#!/usr/bin/env bash\nprintf '%s\\n' aegis\n")
    writeExecutable(path.join(value.fakeBin, "id"), `#!/usr/bin/env bash
if [[ "\${1:-}" == -un ]]; then printf '%s\n' williamos-fabric; else printf '%s\n' '${bashUid}'; fi
`)
    writeExecutable(path.join(value.fakeBin, "nproc"), "#!/usr/bin/env bash\nprintf '%s\\n' 12\n")
    writeExecutable(path.join(value.fakeBin, "df"), "#!/usr/bin/env bash\nprintf '%s\\n' Available 100000000000\n")
    writeExecutable(path.join(value.fakeBin, "git"), `#!/usr/bin/env bash
if [[ "\${1:-}" == --version ]]; then printf '%s\n' 'git version 2.50.0'; fi
exit 0
`)
    const result = runWorker("PROVE_PREFLIGHT", value, { env: { FAKE_REQUIRE_NO_EXPAND: "1" } })
    expect(result.json).toMatchObject({ status: "SUCCEEDED" })
    expect((fs.readFileSync(worker, "utf8").match(/--expand-environment=no/g) ?? []).length).toBeGreaterThanOrEqual(3)
  }, 20_000)

  it("blocks exact cleanup while an unrelated same-user process has a workspace cwd or open fd", () => {
    for (const mode of ["cwd", "fd", "other-fd"]) {
      const value = fixture()
      fs.writeFileSync(path.join(value.physicalWorkspace, ".williamos-post-merge-proven"), `${value.packet.runId}:${value.baseSha}\n`)
      const quarantine = path.join(path.dirname(value.physicalWorkspace), `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${value.packet.runId}`)
      expect(runWorker("CLEAN_EXACT_WORKSPACE", value, { env: { FAKE_PROC_IN_USE: mode } }).json).toMatchObject({ status: "BLOCKED", reasonCode: "CLEANUP_QUARANTINED_RECOVERABLE", causeCode: "CLEANUP_WORKSPACE_IN_USE" })
      expect(fs.existsSync(value.physicalWorkspace)).toBe(false)
      expect(fs.existsSync(path.join(quarantine, ".williamos-remote-dev-owner.json"))).toBe(true)
    }
  }, 30_000)

  it("fsyncs the exact canonical parent after removal and fails closed on durability errors", () => {
    const durable = fixture()
    fs.writeFileSync(path.join(durable.physicalWorkspace, ".williamos-post-merge-proven"), `${durable.packet.runId}:${durable.baseSha}\n`)
    const syncLog = path.join(durable.hostRoot, "sync.log")
    expect(runWorker("CLEAN_EXACT_WORKSPACE", durable, { env: { FAKE_SYNC_LOG: toPosix(syncLog) } }).json).toMatchObject({ status: "CLEANUP_ABSENCE_PROVEN" })
    expect(fs.readFileSync(syncLog, "utf8").trim()).toBe(toPosix(path.dirname(durable.physicalWorkspace)))

    const failed = fixture()
    fs.writeFileSync(path.join(failed.physicalWorkspace, ".williamos-post-merge-proven"), `${failed.packet.runId}:${failed.baseSha}\n`)
    const failedQuarantine = path.join(path.dirname(failed.physicalWorkspace), `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${failed.packet.runId}`)
    expect(runWorker("CLEAN_EXACT_WORKSPACE", failed, { env: { FAKE_SYNC_FAIL: "1" } }).json).toMatchObject({ status: "BLOCKED", reasonCode: "CLEANUP_QUARANTINED_RECOVERABLE", causeCode: "CLEANUP_DURABILITY_FAILED" })
    expect(fs.existsSync(failed.physicalWorkspace)).toBe(false)
    expect(fs.existsSync(path.join(failedQuarantine, ".williamos-remote-dev-owner.json"))).toBe(true)
  }, 30_000)

  it("atomically quarantines before scanning and rejects both a pre-rename entrant and original-path recreation", () => {
    const entrant = fixture()
    fs.writeFileSync(path.join(entrant.physicalWorkspace, ".williamos-post-merge-proven"), `${entrant.packet.runId}:${entrant.baseSha}\n`)
    const entrantQuarantine = path.join(path.dirname(entrant.physicalWorkspace), `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${entrant.packet.runId}`)
    expect(runWorker("CLEAN_EXACT_WORKSPACE", entrant, { env: { FAKE_ENTER_BEFORE_QUARANTINE: "1" } }).json).toMatchObject({ status: "BLOCKED", reasonCode: "CLEANUP_QUARANTINED_RECOVERABLE", causeCode: "CLEANUP_WORKSPACE_IN_USE" })
    expect(fs.existsSync(entrant.physicalWorkspace)).toBe(false)
    expect(fs.existsSync(path.join(entrantQuarantine, ".williamos-remote-dev-owner.json"))).toBe(true)

    const recreated = fixture()
    fs.writeFileSync(path.join(recreated.physicalWorkspace, ".williamos-post-merge-proven"), `${recreated.packet.runId}:${recreated.baseSha}\n`)
    const recreatedQuarantine = path.join(path.dirname(recreated.physicalWorkspace), `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${recreated.packet.runId}`)
    expect(runWorker("CLEAN_EXACT_WORKSPACE", recreated, { env: { FAKE_RECREATE_ORIGINAL: "1" } }).json).toMatchObject({ status: "CLEANUP_ORIGINAL_RECREATED" })
    expect(fs.existsSync(recreated.physicalWorkspace)).toBe(true)
    expect(fs.existsSync(path.join(recreatedQuarantine, ".williamos-remote-dev-owner.json"))).toBe(true)
  }, 30_000)

  it("blocks a later run on a prior quarantine before lock or duplicate workspace mutation", () => {
    const value = fixture()
    const parent = path.dirname(value.physicalWorkspace)
    const quarantine = path.join(parent, `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${value.packet.runId}`)
    fs.renameSync(value.physicalWorkspace, quarantine)
    const lock = path.join(parent, ".remote-dev-offload.lock")
    const packet = makePacket(value.baseSha, value.patch, { runId: crypto.randomUUID() })
    expect(fs.existsSync(lock)).toBe(false)
    expect(runWorker("CREATE_WORKSPACE", value, { packet }).json).toMatchObject({ status: "QUARANTINE_RECOVERY_REQUIRED" })
    expect(fs.existsSync(lock)).toBe(false)
    expect(fs.existsSync(value.physicalWorkspace)).toBe(false)
    expect(fs.existsSync(path.join(quarantine, ".williamos-remote-dev-owner.json"))).toBe(true)
  }, 15_000)

  it("rechecks the quarantine namespace under the lifecycle lock before workspace creation", () => {
    const value = fixture(); fs.rmSync(value.physicalWorkspace, { recursive: true, force: true })
    expect(runWorker("CREATE_WORKSPACE", value, { env: { FAKE_QUARANTINE_ON_LOCK: "1" } }).json).toMatchObject({ status: "QUARANTINE_RECOVERY_REQUIRED" })
    expect(fs.existsSync(value.physicalWorkspace)).toBe(false)
  }, 15_000)

  it("fails closed on malformed, symlinked, or multiple Work Order quarantines", () => {
    const malformed = fixture()
    fs.mkdirSync(path.join(path.dirname(malformed.physicalWorkspace), ".williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-not-a-run"))
    expect(runWorker("PROVE_PREFLIGHT", malformed).json).toMatchObject({ status: "QUARANTINE_NAMESPACE_INVALID" })

    const symlinked = fixture()
    const symlinkParent = path.dirname(symlinked.physicalWorkspace)
    const outside = path.join(symlinked.hostRoot, "outside-quarantine"); fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(symlinkParent, `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${crypto.randomUUID()}`), "junction")
    expect(runWorker("PROVE_PREFLIGHT", symlinked).json).toMatchObject({ status: "QUARANTINE_NAMESPACE_INVALID" })

    const multiple = fixture()
    const multipleParent = path.dirname(multiple.physicalWorkspace)
    fs.mkdirSync(path.join(multipleParent, `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${crypto.randomUUID()}`))
    fs.mkdirSync(path.join(multipleParent, `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${crypto.randomUUID()}`))
    expect(runWorker("PROVE_PREFLIGHT", multiple).json).toMatchObject({ status: "QUARANTINE_NAMESPACE_AMBIGUOUS" })
  }, 30_000)

  it("recovers only the exact same-origin quarantine authorized by the CLEAN packet", () => {
    const authorized = fixture()
    const authorizedParent = path.dirname(authorized.physicalWorkspace)
    const authorizedQuarantine = path.join(authorizedParent, `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${authorized.packet.runId}`)
    fs.writeFileSync(path.join(authorized.physicalWorkspace, ".williamos-post-merge-proven"), `${authorized.packet.runId}:${authorized.baseSha}\n`)
    fs.renameSync(authorized.physicalWorkspace, authorizedQuarantine)
    expect(runWorker("CLEAN_EXACT_WORKSPACE", authorized).json).toMatchObject({ status: "CLEANUP_ABSENCE_PROVEN" })
    expect(fs.existsSync(authorizedQuarantine)).toBe(false)
    expect(fs.existsSync(authorized.physicalWorkspace)).toBe(false)

    const denied = fixture()
    const deniedParent = path.dirname(denied.physicalWorkspace)
    const deniedQuarantine = path.join(deniedParent, `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${denied.packet.runId}`)
    fs.writeFileSync(path.join(denied.physicalWorkspace, ".williamos-post-merge-proven"), `${denied.packet.runId}:${denied.baseSha}\n`)
    fs.renameSync(denied.physicalWorkspace, deniedQuarantine)
    const differentRunPacket = makePacket(denied.baseSha, denied.patch, { runId: crypto.randomUUID() })
    expect(runWorker("CLEAN_EXACT_WORKSPACE", denied, { packet: differentRunPacket }).json).toMatchObject({ status: "CLEANUP_RECOVERY_AUTHORITY_MISMATCH" })
    expect(fs.existsSync(path.join(deniedQuarantine, ".williamos-remote-dev-owner.json"))).toBe(true)
  }, 30_000)

  it("retains attempt-specific cleanup evidence and permits only a fully bound same-run retry", () => {
    const value = fixture()
    fs.writeFileSync(path.join(value.physicalWorkspace, ".williamos-post-merge-proven"), `${value.packet.runId}:${value.baseSha}\n`)
    const previous = "e".repeat(64)
    const first = runWorker("CLEAN_EXACT_WORKSPACE", value, { previous, env: { FAKE_PROC_IN_USE: "cwd" } })
    expect(first.json).toMatchObject({
      status: "BLOCKED", reasonCode: "CLEANUP_QUARANTINED_RECOVERABLE", runId: value.packet.runId,
      operation: "CLEAN_EXACT_WORKSPACE", attempt: 1, previousEvidenceSha256: previous,
      originalAbsent: true, causeCode: "CLEANUP_WORKSPACE_IN_USE",
    })
    const quarantine = path.join(path.dirname(value.physicalWorkspace), `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${value.packet.runId}`)
    expect(fs.readFileSync(path.join(quarantine, ".williamos-scratch/results/clean_exact_workspace-1/output.log"), "utf8")).toBe("")

    const second = runWorker("CLEAN_EXACT_WORKSPACE", value, { attempt: 2, previous })
    expect(second.json).toMatchObject({ status: "CLEANUP_ABSENCE_PROVEN", attempt: 2, previousEvidenceSha256: previous })
    expect(fs.existsSync(quarantine)).toBe(false)
    expect(fs.existsSync(value.physicalWorkspace)).toBe(false)
  }, 30_000)

  it("blocks same-run recovery when marker, proof, or repository HEAD no longer matches", () => {
    const marker = fixture(); const markerQuarantine = path.join(path.dirname(marker.physicalWorkspace), `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${marker.packet.runId}`)
    fs.writeFileSync(path.join(marker.physicalWorkspace, ".williamos-post-merge-proven"), `${marker.packet.runId}:${marker.baseSha}\n`); fs.renameSync(marker.physicalWorkspace, markerQuarantine)
    fs.writeFileSync(path.join(markerQuarantine, ".williamos-remote-dev-owner.json"), JSON.stringify({ run_id: marker.packet.runId }))
    expect(runWorker("CLEAN_EXACT_WORKSPACE", marker, { attempt: 2, previous: "e".repeat(64) }).json).toMatchObject({ status: "OWNERSHIP_MARKER_MISMATCH" })

    const proof = fixture(); const proofQuarantine = path.join(path.dirname(proof.physicalWorkspace), `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${proof.packet.runId}`)
    fs.writeFileSync(path.join(proof.physicalWorkspace, ".williamos-post-merge-proven"), `${proof.packet.runId}:${proof.baseSha}\n`); fs.renameSync(proof.physicalWorkspace, proofQuarantine)
    fs.writeFileSync(path.join(proofQuarantine, ".williamos-post-merge-proven"), `${proof.packet.runId}:${"f".repeat(40)}\n`)
    expect(runWorker("CLEAN_EXACT_WORKSPACE", proof, { attempt: 2, previous: "e".repeat(64) }).json).toMatchObject({ status: "CLEANUP_NOT_AUTHORIZED" })

    const head = fixture(); const headQuarantine = path.join(path.dirname(head.physicalWorkspace), `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${head.packet.runId}`)
    fs.writeFileSync(path.join(head.physicalWorkspace, ".williamos-post-merge-proven"), `${head.packet.runId}:${head.baseSha}\n`); fs.renameSync(head.physicalWorkspace, headQuarantine)
    execFileSync("git", ["commit", "--allow-empty", "-m", "synthetic head drift"], { cwd: path.join(headQuarantine, "repository"), stdio: "ignore" })
    expect(runWorker("CLEAN_EXACT_WORKSPACE", head, { attempt: 2, previous: "e".repeat(64) }).json).toMatchObject({ status: "CLEANUP_NOT_AUTHORIZED" })
    expect(fs.existsSync(path.join(headQuarantine, ".williamos-remote-dev-owner.json"))).toBe(true)

    const headThird = fixture(); const headThirdQuarantine = path.join(path.dirname(headThird.physicalWorkspace), `.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${headThird.packet.runId}`)
    fs.writeFileSync(path.join(headThird.physicalWorkspace, ".williamos-post-merge-proven"), `${headThird.packet.runId}:${headThird.baseSha}\n`); fs.renameSync(headThird.physicalWorkspace, headThirdQuarantine)
    execFileSync("git", ["commit", "--allow-empty", "-m", "synthetic third-attempt head drift"], { cwd: path.join(headThirdQuarantine, "repository"), stdio: "ignore" })
    expect(runWorker("CLEAN_EXACT_WORKSPACE", headThird, { attempt: 3, previous: "e".repeat(64) }).json).toMatchObject({ status: "CLEANUP_NOT_AUTHORIZED" })
    expect(fs.existsSync(path.join(headThirdQuarantine, ".williamos-remote-dev-owner.json"))).toBe(true)
  }, 45_000)

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
