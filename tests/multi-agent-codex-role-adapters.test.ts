import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../scripts/multi-agent-operator/codex-host-session-registry.mjs", async () => (
  import("./fixtures/codex-host-session-registry-fixture.mjs")
))

import {
  adaptCodexRoleLifecycle,
  CodexRoleAdapterError,
} from "../scripts/multi-agent-operator/codex-role-adapters.mjs"
import { codexProviderConformanceFixture } from "../scripts/multi-agent-operator/codex-provider-conformance.mjs"
import {
  clearTestCodexHostSessionRecords,
  installTestCodexHostSessionRecord,
} from "./fixtures/codex-host-session-registry-fixture.mjs"

const BASE_SHA = "4d1bb1cb749652aff1d8d9f4bf4c295ddff9cafc"

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
    workOrderId: "WO-MAO-031",
    objective: "Prove current-session Codex builder, assurance, remediation, and re-review adapters.",
    riskClass: "R1",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{ repository: "bsvalues/terragroq", ref: "refs/heads/main", commitSha: BASE_SHA }],
    dependencies: ["WO-MAO-026", "WO-MAO-029", "WO-MAO-030"],
    fanInGate: "ALL",
    laneId: "LANE-MAO-031",
    teamRoles: {
      coordinator: "codex-coordinator",
      builder: "codex-builder",
      reviewer: "codex-reviewer",
    },
    providerRequirements: ["current-hosted-session", "native-team-coordination", "sanitized-evidence"],
    preferredProviders: ["hosted-codex"],
    fallbackProviders: [],
    reservations: {
      paths: [{ repository: "bsvalues/terragroq", path: "scripts/multi-agent-operator/codex-role-adapters.mjs" }],
      contracts: ["codex-role-adapters"],
      environments: [],
    },
    allowedActions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
    forbiddenActions: ["CREDENTIAL_ACCESS", "OWNER_CONTACT", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: ["AUTHORITY-MAO-PROGRAM-ACTIVE"],
    programActivationGrantRef: "AUTHORITY-MAO-PROGRAM-ACTIVE",
    grantStatusEventRefs: ["AUTHORITY-EVENT-MAO-ACTIVE"],
    requiredOutputs: ["role-lifecycle", "sanitized-evidence"],
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

function coordinatorResult(overrides: Record<string, unknown> = {}) {
  return {
    adapterId: "hosted-codex-coordinator-adapter-v1",
    status: "COORDINATOR_ASSIGNMENTS_READY",
    assignments: [
      { assignmentId: "WO-MAO-031:LANE-MAO-031:coordinator", workOrderId: "WO-MAO-031", laneId: "LANE-MAO-031", role: "coordinator", workerId: "codex-coordinator", state: "ASSIGNMENT_READY", dispatchPerformed: false },
      { assignmentId: "WO-MAO-031:LANE-MAO-031:builder", workOrderId: "WO-MAO-031", laneId: "LANE-MAO-031", role: "builder", workerId: "codex-builder", state: "ASSIGNMENT_READY", dispatchPerformed: false },
      { assignmentId: "WO-MAO-031:LANE-MAO-031:reviewer", workOrderId: "WO-MAO-031", laneId: "LANE-MAO-031", role: "reviewer", workerId: "codex-reviewer", state: "ASSIGNMENT_READY", dispatchPerformed: false },
    ],
    dispatchPerformed: false,
    providerContractDispatchAllowed: false,
    runtimeActivationAllowed: false,
    authorityGranted: false,
    ...overrides,
  }
}

function roleProof(role: string, workerId: string) {
  return {
    role,
    workerId,
    hostSessionProofReference: { proofId: `proof-${workerId}` },
  }
}

function response(stage: string, role: string, artifactKind = "stage-proof") {
  return {
    schemaVersion: 1,
    artifactType: "PROVIDER_ARTIFACT",
    providerId: "hosted-codex",
    adapterId: "hosted-codex-role-adapters-v1",
    dispatchId: `dispatch-${stage.toLowerCase()}`,
    workOrderId: "WO-MAO-031",
    laneId: "LANE-MAO-031",
    providerState: "SUCCEEDED",
    reasonCode: null,
    sanitized: true,
    authorityGranted: false,
    artifactId: `${stage.toLowerCase()}-${role}-artifact`,
    artifactKind,
    contentHash: crypto.createHash("sha256").update(`${stage}:${role}`).digest("hex"),
    relativePath: `docs/reports/wo-mao-031/${stage.toLowerCase()}.json`,
  }
}

function stages(overrides: Record<string, unknown> = {}) {
  const value = [
    { stageId: "stage-build", stage: "BUILD", role: "builder", workerId: "codex-builder", providerResponse: response("BUILD", "builder"), review: null, remediationCycle: null },
    { stageId: "stage-assurance", stage: "ASSURANCE_REVIEW", role: "reviewer", workerId: "codex-reviewer", providerResponse: response("ASSURANCE_REVIEW", "reviewer"), review: { verdict: "REQUESTED_CHANGES", unresolvedThreads: 1 }, remediationCycle: null },
    { stageId: "stage-remediation", stage: "REMEDIATION", role: "remediator", workerId: "codex-builder", providerResponse: response("REMEDIATION", "remediator"), review: null, remediationCycle: 1 },
    { stageId: "stage-rereview", stage: "REREVIEW", role: "reviewer", workerId: "codex-reviewer", providerResponse: response("REREVIEW", "reviewer"), review: { verdict: "APPROVED", unresolvedThreads: 0 }, remediationCycle: null },
  ]
  for (const [key, child] of Object.entries(overrides)) value[Number(key)] = { ...value[Number(key)], ...(child as Record<string, unknown>) }
  return value
}

function adapterInput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifactType: "CODEX_ROLE_ADAPTER_INPUT",
    adapterId: "hosted-codex-role-adapters-v1",
    conformance: codexProviderConformanceFixture(),
    envelope: envelope(),
    coordinatorResult: coordinatorResult(),
    roleProofs: [
      roleProof("builder", "codex-builder"),
      roleProof("reviewer", "codex-reviewer"),
      roleProof("remediator", "codex-builder"),
    ],
    stages: stages(),
    ...overrides,
  }
}

function installRoleSessions() {
  for (const workerId of ["codex-builder", "codex-reviewer"]) {
    installTestCodexHostSessionRecord(hostSessionRecord(`proof-${workerId}`, workerId))
  }
}

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected role adapter wall")
  } catch (error) {
    expect(error).toBeInstanceOf(CodexRoleAdapterError)
    expect(error).toMatchObject({ code })
  }
}

beforeEach(() => installRoleSessions())
afterEach(() => clearTestCodexHostSessionRecords())

describe("WO-MAO-031 Codex builder, assurance, and remediation adapters", () => {
  it("proves the bounded builder-reviewer-remediator-rereview lifecycle without dispatch", () => {
    const result = adaptCodexRoleLifecycle(adapterInput())

    expect(result).toMatchObject({
      artifactType: "CODEX_ROLE_ADAPTER_RESULT",
      adapterId: "hosted-codex-role-adapters-v1",
      status: "ROLE_LIFECYCLE_PROVEN",
      workOrderId: "WO-MAO-031",
      laneId: "LANE-MAO-031",
      ownerRelayRequired: false,
      providerContractDispatchAllowed: false,
      dispatchPerformed: false,
      durablePersistenceClaimed: false,
      serviceWorkerClaimed: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
      evidence: { sanitized: true },
    })
    expect(result.roleAdapters.map(({ role }) => role).sort()).toEqual(["builder", "remediator", "reviewer"])
    expect(result.roleAdapters.every(({ state, dispatchPerformed }) =>
      state === "ROLE_ADAPTER_READY" && dispatchPerformed === false)).toBe(true)
    expect(result.stages.map(({ stage }) => stage)).toEqual(["BUILD", "ASSURANCE_REVIEW", "REMEDIATION", "REREVIEW"])
    expect(result.stages[2].workerId).toBe(result.stages[0].workerId)
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(result.roleAdapters[0])).toBe(true)
  })

  it("requires independent assurance to request changes before original-builder remediation", () => {
    expectWall(() => adaptCodexRoleLifecycle(adapterInput({
      stages: stages({ 1: { review: { verdict: "APPROVED", unresolvedThreads: 0 } } }),
    })), "CODEX_ROLE_REVIEW_WALL")
  })

  it("requires final re-review approval with zero unresolved threads", () => {
    expectWall(() => adaptCodexRoleLifecycle(adapterInput({
      stages: stages({ 3: { review: { verdict: "REQUESTED_CHANGES", unresolvedThreads: 1 } } }),
    })), "CODEX_ROLE_REVIEW_WALL")
  })

  it("rejects remediation by any identity other than the original builder", () => {
    expectWall(() => adaptCodexRoleLifecycle(adapterInput({
      stages: stages({ 2: { workerId: "codex-remediator" } }),
    })), "CODEX_ROLE_REMEDIATION_WALL")
  })

  it("rejects remediation cycles beyond the envelope budget", () => {
    expectWall(() => adaptCodexRoleLifecycle(adapterInput({
      stages: stages({ 2: { remediationCycle: 3 } }),
    })), "CODEX_ROLE_REMEDIATION_WALL")
  })

  it("rejects unsanitized or failed provider response evidence", () => {
    expectWall(() => adaptCodexRoleLifecycle(adapterInput({
      stages: stages({ 0: { providerResponse: { ...response("BUILD", "builder"), sanitized: false } } }),
    })), "CODEX_ROLE_PROVIDER_RESPONSE_WALL")
    expectWall(() => adaptCodexRoleLifecycle(adapterInput({
      stages: stages({ 0: { providerResponse: { ...response("BUILD", "builder"), providerState: "FAILED", reasonCode: "VALIDATION_FAILED" } } }),
    })), "CODEX_ROLE_PROVIDER_RESPONSE_WALL")
  })

  it("rejects coordinator results that claim dispatch or runtime authority", () => {
    expectWall(() => adaptCodexRoleLifecycle(adapterInput({
      coordinatorResult: coordinatorResult({ dispatchPerformed: true }),
    })), "CODEX_ROLE_AUTHORITY_WALL")
  })

  it("exposes deterministic CLI typed failures without a production host-session proof", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-role-adapter-"))
    const inputPath = path.join(directory, "input.json")
    const badPath = path.join(directory, "bad.json")
    fs.writeFileSync(inputPath, JSON.stringify(adapterInput()))
    fs.writeFileSync(badPath, JSON.stringify({ ...adapterInput(), adapterId: "wrong-adapter" }))

    const missingProof = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/codex-role-adapters-cli.mjs", inputPath], { encoding: "utf8" })
    expect(missingProof.status).toBe(2)
    expect(JSON.parse(missingProof.stdout)).toMatchObject({
      ok: false,
      code: "CODEX_ROLE_CONFORMANCE_WALL",
      dispatchPerformed: false,
      authorityGranted: false,
    })

    const failed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/codex-role-adapters-cli.mjs", badPath], { encoding: "utf8" })
    expect(failed.status).toBe(2)
    expect(JSON.parse(failed.stdout)).toMatchObject({ ok: false, code: "CODEX_ROLE_INPUT_WALL" })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
