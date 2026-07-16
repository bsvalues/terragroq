import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../scripts/multi-agent-operator/codex-host-session-registry.mjs", async () => (
  import("./fixtures/codex-host-session-registry-fixture.mjs")
))

import {
  adaptCodexCoordinatorPlan,
  CodexCoordinatorAdapterError,
} from "../scripts/multi-agent-operator/codex-coordinator-adapter.mjs"
import { codexProviderConformanceFixture } from "../scripts/multi-agent-operator/codex-provider-conformance.mjs"
import {
  clearTestCodexHostSessionRecords,
  installTestCodexHostSessionRecord,
} from "./fixtures/codex-host-session-registry-fixture.mjs"

const BASE_SHA = "35de2eb8517697abc0539fa8b1cfc686aba26263"

function ownerBudget() {
  return {
    credentialTouches: 0,
    diagnosticTouches: 0,
    operationTouches: 0,
    routineContacts: 0,
    routineDecisions: 0,
  }
}

function hostSessionRecord(proofId: string, workerId: string) {
  return {
    schemaVersion: 1,
    artifactType: "CODEX_HOST_SESSION_IDENTITY",
    proofId,
    sessionId: `${proofId}-session`,
    workerId,
    providerId: "hosted-codex",
    adapterId: "hosted-codex-session-native-team-v1",
    status: "ACTIVE",
    issuedAt: "2026-07-15T00:00:00.000Z",
    expiresAt: "2026-07-16T00:00:00.000Z",
    evaluationTime: "2026-07-15T12:00:00.000Z",
  }
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    artifactType: "WORK_ORDER_ENVELOPE_V2",
    schemaVersion: 2,
    programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
    loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
    workOrderId: "WO-MAO-030",
    objective: "Translate a bounded hosted Codex team plan into current-session native assignments.",
    riskClass: "R1",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{ repository: "bsvalues/terragroq", ref: "refs/heads/main", commitSha: BASE_SHA }],
    dependencies: ["WO-MAO-024", "WO-MAO-028", "WO-MAO-029"],
    fanInGate: "ALL",
    laneId: "LANE-MAO-030",
    teamRoles: {
      coordinator: "codex-coordinator",
      builder: "codex-builder",
      reviewer: "codex-reviewer",
    },
    providerRequirements: ["current-hosted-session", "native-team-coordination", "sanitized-evidence"],
    preferredProviders: ["hosted-codex"],
    fallbackProviders: [],
    reservations: {
      paths: [{ repository: "bsvalues/terragroq", path: "scripts/multi-agent-operator/codex-coordinator-adapter.mjs" }],
      contracts: ["codex-coordinator-adapter"],
      environments: [],
    },
    allowedActions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
    forbiddenActions: ["CREDENTIAL_ACCESS", "OWNER_CONTACT", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: ["AUTHORITY-MAO-PROGRAM-ACTIVE"],
    programActivationGrantRef: "AUTHORITY-MAO-PROGRAM-ACTIVE",
    grantStatusEventRefs: ["AUTHORITY-EVENT-MAO-ACTIVE"],
    requiredOutputs: ["native-assignments", "sanitized-evidence"],
    requiredValidation: ["focused-vitest", "git-diff-check"],
    reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 },
    mergeMode: "NO_MERGE",
    retryBudget: { maxAttempts: 3, backoffSeconds: 10 },
    remediationBudget: { maxCycles: 2 },
    reroutePolicy: "COMPATIBLE_PROVIDER_ONLY",
    stopConditions: ["authority-wall", "reservation-collision"],
    evidenceTargets: ["owner-operation-counters", "sanitized-provider-events"],
    ownerDecisionConditions: [],
    ownerOperationsAllowed: false,
    ownerTouchBudget: ownerBudget(),
    communicationPolicy: "FINAL_ONLY",
    ...overrides,
  }
}

function roleProof(role: string, workerId: string) {
  return {
    workOrderId: "WO-MAO-030",
    laneId: "LANE-MAO-030",
    role,
    hostSessionProofReference: { proofId: `proof-${workerId}` },
  }
}

function adapterInput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifactType: "CODEX_COORDINATOR_ADAPTER_INPUT",
    adapterId: "hosted-codex-coordinator-adapter-v1",
    conformance: codexProviderConformanceFixture(),
    completedWorkOrderIds: ["WO-MAO-024", "WO-MAO-028", "WO-MAO-029"],
    envelopes: [envelope()],
    roleProofs: [
      roleProof("coordinator", "codex-coordinator"),
      roleProof("builder", "codex-builder"),
      roleProof("reviewer", "codex-reviewer"),
    ],
    cancellationRequests: [],
    ...overrides,
  }
}

function installRoleSessions() {
  for (const workerId of ["codex-coordinator", "codex-builder", "codex-reviewer"]) {
    installTestCodexHostSessionRecord(hostSessionRecord(`proof-${workerId}`, workerId))
  }
}

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected coordinator adapter wall")
  } catch (error) {
    expect(error).toBeInstanceOf(CodexCoordinatorAdapterError)
    expect(error).toMatchObject({ code })
  }
}

beforeEach(() => installRoleSessions())
afterEach(() => clearTestCodexHostSessionRecords())

describe("WO-MAO-030 hosted Codex coordinator adapter", () => {
  it("translates a selected hosted team plan into native assignments and sanitized evidence", () => {
    const result = adaptCodexCoordinatorPlan(adapterInput())

    expect(result).toMatchObject({
      artifactType: "CODEX_COORDINATOR_ADAPTER_RESULT",
      adapterId: "hosted-codex-coordinator-adapter-v1",
      status: "COORDINATOR_ASSIGNMENTS_READY",
      planStatus: "WAVE_READY",
      ownerRelayRequired: false,
      providerContractDispatchAllowed: false,
      dispatchPerformed: false,
      durablePersistenceClaimed: false,
      serviceWorkerClaimed: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
      evidence: { sanitized: true },
    })
    expect(result.assignments).toHaveLength(3)
    expect(result.assignments.map(({ role }) => role).sort()).toEqual(["builder", "coordinator", "reviewer"])
    expect(result.assignments.every(({ state, dispatchPerformed }) =>
      state === "ASSIGNMENT_READY" && dispatchPerformed === false)).toBe(true)
    expect(result.messages).toHaveLength(3)
    expect(result.messages.every(({ secretFree, ownerRelayRequired }) =>
      secretFree === true && ownerRelayRequired === false)).toBe(true)
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(result.assignments[0])).toBe(true)
  })

  it("supports coordinator-owned cancellation without dispatching or creating a side effect", () => {
    const result = adaptCodexCoordinatorPlan(adapterInput({
      cancellationRequests: [{
        workOrderId: "WO-MAO-030",
        laneId: "LANE-MAO-030",
        requestedBy: "codex-coordinator",
        reasonCode: "RESERVATION_REPLANNED",
      }],
    }))

    expect(result.cancellations).toEqual([{
      workOrderId: "WO-MAO-030",
      laneId: "LANE-MAO-030",
      requestedBy: "codex-coordinator",
      reasonCode: "RESERVATION_REPLANNED",
      state: "CANCELLATION_READY",
      dispatchPerformed: false,
    }])
    expect(result.assignments.every(({ state }) => state === "CANCELLATION_READY")).toBe(true)
    expect(result.dispatchPerformed).toBe(false)
  })

  it("rejects role proofs for lanes that the planner did not select", () => {
    expectWall(() => adaptCodexCoordinatorPlan(adapterInput({
      completedWorkOrderIds: ["WO-MAO-024", "WO-MAO-028"],
    })), "CODEX_COORDINATOR_PLAN_WALL")
  })

  it("rejects caller-supplied or missing host-session proof handles", () => {
    clearTestCodexHostSessionRecords()
    expectWall(() => adaptCodexCoordinatorPlan(adapterInput()), "CODEX_COORDINATOR_CONFORMANCE_WALL")
  })

  it("keeps R3 task execution outside the current hosted-session surface", () => {
    expectWall(() => adaptCodexCoordinatorPlan(adapterInput({
      envelopes: [envelope({ riskClass: "R3" })],
    })), "CODEX_COORDINATOR_CONFORMANCE_WALL")
  })

  it("rejects cancellation by a non-coordinator identity", () => {
    expectWall(() => adaptCodexCoordinatorPlan(adapterInput({
      cancellationRequests: [{
        workOrderId: "WO-MAO-030",
        laneId: "LANE-MAO-030",
        requestedBy: "codex-builder",
        reasonCode: "RESERVATION_REPLANNED",
      }],
    })), "CODEX_COORDINATOR_CANCELLATION_WALL")
  })

  it("exposes a deterministic CLI success and typed failure", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-coordinator-adapter-"))
    const inputPath = path.join(directory, "input.json")
    const badPath = path.join(directory, "bad.json")
    fs.writeFileSync(inputPath, JSON.stringify(adapterInput({
      completedWorkOrderIds: ["WO-MAO-024", "WO-MAO-028"],
      roleProofs: [],
    })))
    fs.writeFileSync(badPath, JSON.stringify({ ...adapterInput(), adapterId: "wrong-adapter" }))

    const output = JSON.parse(execFileSync(process.execPath,
      ["scripts/multi-agent-operator/codex-coordinator-adapter-cli.mjs", inputPath], { encoding: "utf8" }))
    expect(output).toMatchObject({ status: "NO_ELIGIBLE_ASSIGNMENTS", dispatchPerformed: false })

    const failed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/codex-coordinator-adapter-cli.mjs", badPath], { encoding: "utf8" })
    expect(failed.status).toBe(2)
    expect(JSON.parse(failed.stdout)).toMatchObject({ ok: false, code: "CODEX_COORDINATOR_INPUT_WALL" })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
