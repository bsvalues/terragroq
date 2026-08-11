import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  bindRemoteDevPacket,
  evaluateRemoteDevTransition,
  exitCodeForRemoteDevStatus,
} from "../scripts/execution-fabric/live/remote-dev-offload-contract.mjs"

const root = process.cwd()
const policyPath = path.join(root, "config/execution-fabric/remote-dev-offload-v1.policy.json")
const cliPath = path.join(root, "scripts/execution-fabric/live/remote-dev-offload-contract.mjs")
const sha = (value: unknown) => crypto.createHash("sha256").update(canonicalizeJcs(value)).digest("hex")

function policy() {
  return JSON.parse(fs.readFileSync(policyPath, "utf8"))
}

function envelope() {
  return {
    schemaVersion: 2,
    programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
    loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
    workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001",
    objective: "Deliver the bounded TerraFusion informational CI proof.",
    riskClass: "R1",
    repositories: ["bsvalues/terrafusion_os_1.0"],
    baseRefs: [{ repository: "bsvalues/terrafusion_os_1.0", ref: "refs/heads/main", commitSha: "a".repeat(40) }],
    dependencies: [], fanInGate: "ALL", laneId: "LANE-TF-REMOTE-DEV-OFFLOAD",
    teamRoles: { coordinator: "omen-controller", builder: "aegis-worker", reviewer: "independent-assurance" },
    providerRequirements: ["hermes-relay"], preferredProviders: ["hermes-relay"], fallbackProviders: [],
    reservations: { paths: [
      { repository: "bsvalues/terrafusion_os_1.0", path: ".github/workflows/dotnet-test.yml" },
      { repository: "bsvalues/terrafusion_os_1.0", path: ".github/workflows/terrafusion-ci.yml" },
      { repository: "bsvalues/terrafusion_os_1.0", path: "tests/ci-terrafusion-unit-informational.test.ts" },
      { repository: "bsvalues/terrafusion_os_1.0", path: "docs/brain/evidence/WO-TF-REMOTE-DEV-OFFLOAD-001-proof.md" },
    ], contracts: ["remote-dev-offload-v1"], environments: ["aegis-proof-workspace"] },
    allowedActions: ["READ_REPOSITORY", "WRITE_RESERVED_PATHS", "RUN_VALIDATION", "COMMIT_OWN_CHANGES", "PUSH_OWN_BRANCH", "OPEN_DRAFT_PR", "READ_CI_AND_REVIEW", "MERGE_ELIGIBLE_PR", "VERIFY_POST_MERGE"],
    forbiddenActions: ["OWNER_CONTACT", "CREDENTIAL_ACCESS", "RUNTIME_ACTIVATION", "PRODUCTION_WRITE", "BRANCH_PROTECTION_BYPASS", "DESTRUCTIVE_GIT"],
    authorityGrantRefs: ["grant-remote-dev-offload-v1"], programActivationGrantRef: "grant-remote-dev-offload-v1", grantStatusEventRefs: ["grant-status-remote-dev-offload-v1"],
    requiredOutputs: ["policy-bound-packet", "hash-chained-evidence"], requiredValidation: ["focused-vitest"],
    reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 },
    mergeMode: "ASSURANCE_GATED", retryBudget: { maxAttempts: 3, backoffSeconds: 10 }, remediationBudget: { maxCycles: 2 }, reroutePolicy: "NONE",
    stopConditions: ["authority-wall", "resource-limit"], evidenceTargets: ["branch", "commit", "merge", "cleanup"], ownerDecisionConditions: [], ownerOperationsAllowed: false,
  }
}

function packet() {
  return {
    schemaVersion: 1, runId: "0f8fad5b-d9cb-469f-a165-70867728950e", workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001",
    repository: "bsvalues/terrafusion_os_1.0", baseRef: "refs/heads/main", baseSha: "a".repeat(40),
    branch: "codex/wo-tf-remote-dev-offload-001-734", nodeId: "aegis", workspace: "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001",
    transport: { controller: "omen", relay: "hermes", worker: "aegis" },
    resourceLimits: { cpuThreads: 12, memoryBytes: 12884901888, scratchBytes: 85899345920, timeoutSeconds: 5400, maxAttempts: 3 },
    operations: ["PROVE_PREFLIGHT", "CREATE_WORKSPACE", "APPLY_RESERVED_PATCH", "RESTORE_DOTNET", "TEST_WORKFLOW_CONTRACT", "TEST_DOTNET_INFORMATIONAL", "BUILD_DOTNET_RELEASE", "COMMIT_RESERVED_PATHS", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE", "CLEAN_EXACT_WORKSPACE"],
    patch: { sha256: "b".repeat(64), generation: 1, changedPaths: [".github/workflows/dotnet-test.yml", ".github/workflows/terrafusion-ci.yml", "tests/ci-terrafusion-unit-informational.test.ts", "docs/brain/evidence/WO-TF-REMOTE-DEV-OFFLOAD-001-proof.md"] },
    authority: { grantId: "grant-remote-dev-offload-v1", issuedAt: "2026-08-10T18:00:00.000Z", expiresAt: "2026-08-10T22:00:00.000Z", singleUse: true },
    bindings: { policySha256: "", packetSha256: "" },
  }
}

function context(overrides: Record<string, unknown> = {}) {
  return { now: "2026-08-10T21:00:00.000Z", seenRunIds: [], branch: "codex/wo-tf-remote-dev-offload-001-734", dispatchEnvelope: envelope(), ...overrides }
}

function bound() {
  const result = bindRemoteDevPacket(packet(), policy(), context())
  expect(result.status).toBe("INACTIVE_TRUSTED_MAIN_READY")
  return result.packet
}

function evidence(operation: string, attempt: number, previousEvidenceSha256: string | null, overrides: Record<string, unknown> = {}, boundPacket = bound()) {
  const sequence = packet().operations.indexOf(operation) + 1
  return {
    schemaVersion: 1, runId: packet().runId, operation, attempt,
    startedAt: `2026-08-10T19:${String(sequence).padStart(2, "0")}:00.000Z`, completedAt: `2026-08-10T19:${String(sequence).padStart(2, "0")}:30.000Z`,
    status: "SUCCEEDED", exitCode: 0, nodeId: "aegis", workspace: "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001", branch: boundPacket.branch, baseSha: "a".repeat(40), headSha: "c".repeat(40), outputSha256: "d".repeat(64), policySha256: boundPacket.bindings.policySha256, packetSha256: boundPacket.bindings.packetSha256, patchSha256: boundPacket.patch.sha256, patchGeneration: boundPacket.patch.generation, previousEvidenceSha256,
    ...overrides,
  }
}

describe("remote development offload proof contract", () => {
  it("pins the approved one-shot policy exactly", () => {
    const value = policy()
    expect(value.workOrderId).toBe("WO-TF-REMOTE-DEV-OFFLOAD-001")
    expect(value.nodeId).toBe("aegis")
    expect(value.workspace).toBe("/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001")
    expect(value.resourceLimits).toEqual({ cpuThreads: 12, memoryBytes: 12884901888, scratchBytes: 85899345920, timeoutSeconds: 5400, maxAttempts: 3 })
    expect(value.scheduler).toEqual({ state: "disabled", standingAegisAuthority: false })
    expect(value.operations).toEqual(packet().operations)
    expect(value.reservedPaths).toEqual(packet().patch.changedPaths)
    expect(value.deniedActions).toEqual(["ARBITRARY_SHELL", "ATLAS_ACCESS", "CREDENTIAL_ACCESS", "OWNER_CONTACT", "PERSISTENT_SERVICE", "RUNTIME_ACTIVATION"])
    expect(value.deniedTargets).toEqual(["atlas", "omen-workspace", "hermes-workspace", "production", "protected-data"])
  })

  it.each([
    ["substituted reserved path", (value: any) => { value.reservedPaths[0] = "README.md" }],
    ["removed denied action", (value: any) => { value.deniedActions.pop() }],
    ["removed denied target", (value: any) => { value.deniedTargets.pop() }],
  ])("blocks weakened policy %s", (_name, mutate) => {
    const value = policy(); mutate(value)
    expect(bindRemoteDevPacket(packet(), value, context())).toMatchObject({ status: "BLOCKED" })
  })

  it("compiles one exact Hermes-mediated packet but keeps dispatch inactive", () => {
    const result = bindRemoteDevPacket(packet(), policy(), context())
    expect(result).toMatchObject({ status: "INACTIVE_TRUSTED_MAIN_READY", executionAuthorized: false, packet: { bindings: { policySha256: sha(policy()), packetSha256: expect.stringMatching(/^[a-f0-9]{64}$/) } } })
    expect(exitCodeForRemoteDevStatus(result.status)).not.toBe(0)
  })

  it.each([
    ["reservation path", (value: any) => { value.reservations.paths[0].path = "README.md" }],
    ["authority grant reference", (value: any) => { value.authorityGrantRefs = ["another-grant"] }],
    ["Hermes role", (value: any) => { value.teamRoles.coordinator = "other-controller" }],
    ["allowed action", (value: any) => { value.allowedActions = value.allowedActions.filter((action: string) => action !== "VERIFY_POST_MERGE") }],
    ["forbidden action", (value: any) => { value.forbiddenActions = ["CREDENTIAL_ACCESS"] }],
    ["risk class", (value: any) => { value.riskClass = "R0" }],
    ["retry limit", (value: any) => { value.retryBudget.maxAttempts = 2 }],
    ["review requirement", (value: any) => { value.reviewRequirements.minimumApprovals = 2 }],
  ])("blocks canonical dispatch envelope drift in %s", (_name, mutate) => {
    const changed = envelope(); mutate(changed)
    expect(bindRemoteDevPacket(packet(), policy(), context({ dispatchEnvelope: changed }))).toMatchObject({ status: "BLOCKED", reasons: [{ code: "DISPATCH_ENVELOPE_MISMATCH" }] })
  })

  it.each([
    ["unknown field", (value: any) => { value.surprise = true }], ["wrong repository", (value: any) => { value.repository = "bsvalues/other" }],
    ["wrong base", (value: any) => { value.baseRef = "refs/heads/dev" }], ["wrong node", (value: any) => { value.nodeId = "hermes" }],
    ["wrong workspace", (value: any) => { value.workspace = "/srv/william/workspaces/other" }], ["wrong branch", (value: any) => { value.branch = "codex/wo-tf-remote-dev-offload-001-other" }], ["expired grant", (value: any) => { value.authority.expiresAt = "2026-08-10T18:59:59.000Z" }],
    ["non GUID run id", (value: any) => { value.runId = "not-a-guid" }], ["widened resources", (value: any) => { value.resourceLimits.cpuThreads = 13 }],
    ["extra action", (value: any) => { value.operations.push("ARBITRARY_SHELL") }], ["direct AEGIS transport", (value: any) => { value.transport.controller = "aegis" }],
    ["missing Hermes hop", (value: any) => { value.transport.relay = "omen" }], ["secret like value", (value: any) => { value.authority.grantId = "ghp_abcdefghijklmnopqrstuvwxyz123456" }],
    ["executable field", (value: any) => { value.command = "rm -rf /" }], ["Atlas target", (value: any) => { value.patch.changedPaths.push("atlas/query.sql") }],
  ])("blocks %s without a successful exit", (_name, mutate) => {
    const value = packet(); mutate(value)
    const result = bindRemoteDevPacket(value, policy(), context())
    expect(result.status).toBe("BLOCKED")
    expect(exitCodeForRemoteDevStatus(result.status)).not.toBe(0)
  })

  it("rejects replayed run IDs before any transition", () => {
    const result = bindRemoteDevPacket(packet(), policy(), context({ seenRunIds: [packet().runId] }))
    expect(result).toMatchObject({ status: "BLOCKED", reasons: [{ code: "RUN_ID_REUSED" }] })
  })

  it("rejects every evidence transition while the reconciled proof scope is inactive", () => {
    const value = bound()
    const first = evidence("PROVE_PREFLIGHT", 1, null, {}, value)
    expect(evaluateRemoteDevTransition(value, first, context())).toMatchObject({ status: "BLOCKED", reasons: [{ code: "REMOTE_DEV_SCOPE_INACTIVE" }] })
    const chain = [first]
    for (const [index, operation] of packet().operations.slice(1).entries()) {
      const previous = chain.at(-1)!
      chain.push(evidence(operation, 1, sha(previous), operation === "PROVE_POST_MERGE" ? { status: "MERGE_ANCESTRY_PROVEN" } : operation === "CLEAN_EXACT_WORKSPACE" ? { status: "CLEANUP_ABSENCE_PROVEN" } : {}, value))
    }
    expect(evaluateRemoteDevTransition(value, chain.at(-1)!, context({ evidenceHistory: chain.slice(0, -1) }))).toMatchObject({ status: "BLOCKED", reasons: [{ code: "REMOTE_DEV_SCOPE_INACTIVE" }] })
  })

  it.each([
    ["policy binding", (value: any) => { value.policySha256 = "e".repeat(64) }],
    ["packet binding", (value: any) => { value.packetSha256 = "e".repeat(64) }],
    ["branch", (value: any) => { value.branch = "codex/wo-tf-remote-dev-offload-001-other" }],
    ["patch digest", (value: any) => { value.patchSha256 = "e".repeat(64) }],
    ["patch generation", (value: any) => { value.patchGeneration = 2 }],
    ["future transition timestamp", (value: any) => { value.completedAt = "2026-08-10T21:00:00.001Z" }],
    ["pre-grant transition timestamp", (value: any) => { value.startedAt = "2026-08-10T17:59:00.000Z" }],
  ])("blocks evidence that drifts %s or violates grant chronology", (_name, mutate) => {
    const value = bound(); const first = evidence("PROVE_PREFLIGHT", 1, null, {}, value); mutate(first)
    expect(evaluateRemoteDevTransition(value, first, context())).toMatchObject({ status: "BLOCKED" })
  })

  it("blocks ambiguous cleanup, out-of-order operations, and malformed CLI input", () => {
    const value = bound()
    const ambiguous = evidence("CLEAN_EXACT_WORKSPACE", 1, null)
    expect(evaluateRemoteDevTransition(value, ambiguous, context())).toMatchObject({ status: "BLOCKED" })
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "remote-dev-contract-"))
    try {
      const packetPath = path.join(directory, "packet.json")
      fs.writeFileSync(packetPath, JSON.stringify({ ...packet(), runId: "wrong" }))
      const cli = spawnSync(process.execPath, [cliPath, policyPath, packetPath], { encoding: "utf8" })
      expect(cli.status).not.toBe(0)
      expect(JSON.parse(cli.stdout)).toMatchObject({ status: "BLOCKED" })
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })
})
