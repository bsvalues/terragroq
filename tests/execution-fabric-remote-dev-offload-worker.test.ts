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
  const fakeBin = path.join(hostRoot, "bin"); fs.mkdirSync(fakeBin)
  writeExecutable(path.join(fakeBin, "dotnet"), `#!/usr/bin/env bash\nif [[ \"\${FAKE_DOTNET_MODE:-ok}\" == timeout ]]; then sleep 3; fi\nif [[ \"\${FAKE_DOTNET_MODE:-ok}\" == build-fail && \"\${1:-}\" == build ]]; then exit 7; fi\nif [[ \"\${FAKE_DOTNET_MODE:-ok}\" == test-fail && \"\${1:-}\" == test ]]; then exit 9; fi\nexit 0\n`)
  writeExecutable(path.join(fakeBin, "corepack"), "#!/usr/bin/env bash\nexit 0\n")
  return { hostRoot, physicalWorkspace, repository, baseSha, patch, packet, fakeBin }
}

function runWorker(operation: string, value: ReturnType<typeof fixture>, options: { packet?: any, patch?: Buffer, env?: Record<string, string> } = {}) {
  const packet = options.packet ?? value.packet
  const patch = options.patch ?? value.patch
  const result = spawnSync(bash, [worker, operation, encode(JSON.stringify(packet)), encode(patch), "1", "null"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${toPosix(value.fakeBin)}:${process.env.PATH}`, REMOTE_DEV_WORKER_ROOT: toPosix(value.hostRoot), REMOTE_DEV_PROCESS_TIMEOUT_SECONDS: "2", ...options.env },
    timeout: 10_000,
  })
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean)
  return { ...result, json: lines.length ? JSON.parse(lines.at(-1)!) : undefined }
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
  })

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
  }, 15_000)

  it("times out bounded processes, blocks failed builds, and preserves informational failures", () => {
    const timedOut = fixture()
    expect(runWorker("RESTORE_DOTNET", timedOut, { env: { FAKE_DOTNET_MODE: "timeout", REMOTE_DEV_PROCESS_TIMEOUT_SECONDS: "1" } }).json).toMatchObject({ status: "PROCESS_TIMEOUT" })
    const failed = fixture()
    expect(runWorker("BUILD_DOTNET_RELEASE", failed, { env: { FAKE_DOTNET_MODE: "build-fail" } }).json).toMatchObject({ status: "BLOCKING_OPERATION_FAILED" })
    const observed = fixture()
    expect(runWorker("TEST_DOTNET_INFORMATIONAL", observed, { env: { FAKE_DOTNET_MODE: "test-fail" } }).json).toMatchObject({ status: "OBSERVED_FAILURE" })
  }, 15_000)

  it("does not clean without exact ownership and post-merge proof", () => {
    const value = fixture()
    expect(runWorker("CLEAN_EXACT_WORKSPACE", value).json).toMatchObject({ status: "CLEANUP_NOT_AUTHORIZED" })
    fs.writeFileSync(path.join(value.physicalWorkspace, ".williamos-post-merge-proven"), "wrong\n")
    expect(runWorker("CLEAN_EXACT_WORKSPACE", value).json).toMatchObject({ status: "CLEANUP_NOT_AUTHORIZED" })
    expect(fs.existsSync(value.physicalWorkspace)).toBe(true)
  })

})
