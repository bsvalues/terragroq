import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"

import { describe, expect, it } from "vitest"

import {
  DagEligibleResolverError,
  resolveDagEligibleSet,
} from "../scripts/multi-agent-operator/dag-eligible-resolver.mjs"

function envelope(workOrderId: string, dependencies: string[] = [], fanInGate = "ALL") {
  return {
    artifactType: "WORK_ORDER_ENVELOPE_V2",
    schemaVersion: 2,
    programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
    loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
    workOrderId,
    objective: `Execute ${workOrderId} inside its recorded authority and reservation.`,
    riskClass: "R3",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{
      repository: "bsvalues/terragroq",
      ref: "refs/heads/main",
      commitSha: "94795d37d4a844045f1461936c5744b89d2e28c0",
    }],
    dependencies,
    fanInGate,
    laneId: `LANE-${workOrderId}`,
    teamRoles: {
      coordinator: "codex-coordinator",
      builder: `builder-${workOrderId.toLowerCase()}`,
      reviewer: `reviewer-${workOrderId.toLowerCase()}`,
    },
    providerRequirements: ["isolated-worktree"],
    preferredProviders: ["hosted-codex"],
    fallbackProviders: [],
    reservations: {
      paths: [{ repository: "bsvalues/terragroq", path: `tmp/${workOrderId.toLowerCase()}.txt` }],
      contracts: [`contract-${workOrderId.toLowerCase()}`],
      environments: [],
    },
    allowedActions: ["READ_REPOSITORY", "WRITE_RESERVED_PATHS", "RUN_VALIDATION"],
    forbiddenActions: ["OWNER_CONTACT", "CREDENTIAL_ACCESS", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: ["docs/reports/WO-MAO-003-owner-only-authority-contract.md"],
    programActivationGrantRef: null,
    grantStatusEventRefs: [],
    requiredOutputs: ["artifact"],
    requiredValidation: ["tests"],
    reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 },
    mergeMode: "NO_MERGE",
    retryBudget: { maxAttempts: 2, backoffSeconds: 0 },
    remediationBudget: { maxCycles: 1 },
    reroutePolicy: "NONE",
    stopConditions: ["authority-wall"],
    evidenceTargets: ["owner-operation-counters"],
    ownerDecisionConditions: [],
    ownerOperationsAllowed: false,
    ownerTouchBudget: {
      operationTouches: 0,
      credentialTouches: 0,
      diagnosticTouches: 0,
      routineDecisions: 0,
      routineContacts: 0,
    },
    communicationPolicy: "FINAL_ONLY",
  }
}

function state(workOrderId: string, value = "PLANNED", reasonCode: string | null = null) {
  return { workOrderId, state: value, reasonCode }
}

function input(workOrders: ReturnType<typeof envelope>[], workOrderStates = workOrders.map(({ workOrderId }) => state(workOrderId))) {
  return { schemaVersion: 1, artifactType: "DAG_ELIGIBILITY_INPUT", workOrders, workOrderStates }
}

function expectWall(value: ReturnType<typeof input>, code: string, detail?: string) {
  try {
    resolveDagEligibleSet(value)
    throw new Error("expected resolver to fail")
  } catch (error) {
    expect(error).toBeInstanceOf(DagEligibleResolverError)
    expect(error).toMatchObject({ code, ...(detail ? { detail } : {}) })
  }
}

describe("cycle-safe DAG eligible-set resolver", () => {
  it("releases every dependency-cleared work order in deterministic order", () => {
    const orders = [
      envelope("WO-MAO-018", ["WO-MAO-016"]),
      envelope("WO-MAO-016"),
      envelope("WO-MAO-019", ["WO-MAO-016"]),
      envelope("WO-MAO-017", ["WO-MAO-016"]),
    ]
    const states = [
      state("WO-MAO-019"),
      state("WO-MAO-016", "COMPLETE"),
      state("WO-MAO-018"),
      state("WO-MAO-017"),
    ]
    const result = resolveDagEligibleSet(input(orders, states))
    expect(result).toMatchObject({
      status: "ELIGIBLE_SET_READY",
      completedWorkOrderIds: ["WO-MAO-016"],
      eligible: [
        { workOrderId: "WO-MAO-017", fanInGate: "ALL", completedDependencies: ["WO-MAO-016"] },
        { workOrderId: "WO-MAO-018", fanInGate: "ALL", completedDependencies: ["WO-MAO-016"] },
        { workOrderId: "WO-MAO-019", fanInGate: "ALL", completedDependencies: ["WO-MAO-016"] },
      ],
      ineligible: [],
      planningOnly: true,
      dispatchPerformed: false,
      authorityGranted: false,
    })
  })

  it("makes dependency-free ALL roots eligible", () => {
    const result = resolveDagEligibleSet(input([envelope("WO-MAO-016")]))
    expect(result.eligible).toEqual([{ workOrderId: "WO-MAO-016", fanInGate: "ALL", completedDependencies: [] }])
  })

  it("honors ALL and ANY gates while preserving explicit dependency dispositions", () => {
    const orders = [
      envelope("WO-MAO-016"),
      envelope("WO-MAO-017"),
      envelope("WO-MAO-018"),
      envelope("WO-MAO-019", ["WO-MAO-016", "WO-MAO-017", "WO-MAO-018"], "ANY"),
      envelope("WO-MAO-020", ["WO-MAO-016", "WO-MAO-017", "WO-MAO-018"], "ALL"),
    ]
    const states = [
      state("WO-MAO-016", "COMPLETE"),
      state("WO-MAO-017", "DEFERRED", "PROVIDER_UNAVAILABLE"),
      state("WO-MAO-018", "BLOCKED", "RESERVATION_CONFLICT"),
      state("WO-MAO-019"),
      state("WO-MAO-020"),
    ]
    const result = resolveDagEligibleSet(input(orders, states))
    expect(result.eligible).toEqual([
      { workOrderId: "WO-MAO-019", fanInGate: "ANY", completedDependencies: ["WO-MAO-016"] },
    ])
    expect(result.ineligible).toEqual([
      { workOrderId: "WO-MAO-017", reasonCode: "EXPLICITLY_DEFERRED", stateReasonCode: "PROVIDER_UNAVAILABLE" },
      { workOrderId: "WO-MAO-018", reasonCode: "EXPLICITLY_BLOCKED", stateReasonCode: "RESERVATION_CONFLICT" },
      {
        workOrderId: "WO-MAO-020",
        reasonCode: "DEPENDENCY_INCOMPLETE",
        fanInGate: "ALL",
        completedDependencies: ["WO-MAO-016"],
        pendingDependencies: [],
        deferredDependencies: ["WO-MAO-017"],
        blockedDependencies: ["WO-MAO-018"],
      },
    ])
  })

  it("keeps explicit defer and block states out of the eligible set even with clear dependencies", () => {
    const orders = [envelope("WO-MAO-016"), envelope("WO-MAO-017", ["WO-MAO-016"]), envelope("WO-MAO-018", ["WO-MAO-016"])]
    const states = [state("WO-MAO-016", "COMPLETE"), state("WO-MAO-017", "DEFERRED", "POLICY_DEFER"), state("WO-MAO-018", "BLOCKED", "SECURITY_WALL")]
    const result = resolveDagEligibleSet(input(orders, states))
    expect(result.status).toBe("NO_ELIGIBLE_WORK")
    expect(result.ineligible.map(({ reasonCode }) => reasonCode)).toEqual(["EXPLICITLY_DEFERRED", "EXPLICITLY_BLOCKED"])
  })

  it("reports pending dependencies without selecting one arbitrary candidate", () => {
    const orders = [envelope("WO-MAO-016"), envelope("WO-MAO-017", ["WO-MAO-016"]), envelope("WO-MAO-018", ["WO-MAO-016"])]
    const result = resolveDagEligibleSet(input(orders))
    expect(result.eligible.map(({ workOrderId }) => workOrderId)).toEqual(["WO-MAO-016"])
    expect(result.ineligible.map(({ workOrderId }) => workOrderId)).toEqual(["WO-MAO-017", "WO-MAO-018"])
  })

  it("detects a missing dependency before eligibility evaluation", () => {
    expectWall(input([envelope("WO-MAO-017", ["WO-MAO-999"])]), "DAG_ELIGIBILITY_MISSING_DEPENDENCY_WALL", "WO-MAO-999")
  })

  it("detects deterministic cycles", () => {
    const value = input([
      envelope("WO-MAO-016", ["WO-MAO-018"]),
      envelope("WO-MAO-017", ["WO-MAO-016"]),
      envelope("WO-MAO-018", ["WO-MAO-017"]),
    ])
    expectWall(value, "DAG_ELIGIBILITY_CYCLE_WALL", "WO-MAO-016->WO-MAO-018->WO-MAO-017->WO-MAO-016")
  })

  it("rejects duplicate envelopes and duplicate state records", () => {
    const duplicateOrder = envelope("WO-MAO-016")
    expectWall(input([duplicateOrder, { ...duplicateOrder }]), "DAG_ELIGIBILITY_DUPLICATE_WALL", "WO-MAO-016")
    const orders = [envelope("WO-MAO-016")]
    expectWall(input(orders, [state("WO-MAO-016"), state("WO-MAO-016")]), "DAG_ELIGIBILITY_DUPLICATE_WALL", "WO-MAO-016")
  })

  it("rejects missing and foreign state records", () => {
    const orders = [envelope("WO-MAO-016"), envelope("WO-MAO-017", ["WO-MAO-016"])]
    expectWall(input(orders, [state("WO-MAO-016")]), "DAG_ELIGIBILITY_STATE_WALL", "MISSING_WORK_ORDER:WO-MAO-017")
    expectWall(input([envelope("WO-MAO-016")], [state("WO-MAO-999")]), "DAG_ELIGIBILITY_STATE_WALL", "UNKNOWN_WORK_ORDER:WO-MAO-999")
  })

  it("rejects invalid explicit-state reasons and invalid envelopes", () => {
    expectWall(input([envelope("WO-MAO-016")], [state("WO-MAO-016", "DEFERRED", null)]), "DAG_ELIGIBILITY_STATE_WALL", "TYPED_REASON_REQUIRED")
    const bad = envelope("WO-MAO-016")
    bad.ownerOperationsAllowed = true as false
    expectWall(input([bad]), "DAG_ELIGIBILITY_ENVELOPE_WALL")
  })

  it("returns typed CLI success and structural failure outcomes", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-dag-resolver-"))
    const validPath = path.join(directory, "valid.json")
    const invalidPath = path.join(directory, "invalid.json")
    fs.writeFileSync(validPath, JSON.stringify(input([envelope("WO-MAO-016")])))
    fs.writeFileSync(invalidPath, JSON.stringify(input([envelope("WO-MAO-017", ["WO-MAO-999"])])))
    const cli = path.resolve("scripts/multi-agent-operator/dag-eligible-resolver-cli.mjs")
    const success = JSON.parse(execFileSync(process.execPath, [cli, validPath], { encoding: "utf8" }))
    expect(success).toMatchObject({
      status: "ELIGIBLE_SET_READY",
      eligible: [{ workOrderId: "WO-MAO-016" }],
      planningOnly: true,
      dispatchPerformed: false,
      authorityGranted: false,
    })
    const failure = spawnSync(process.execPath, [cli, invalidPath], { encoding: "utf8" })
    expect(failure.status).toBe(2)
    expect(failure.stderr).toBe("")
    expect(JSON.parse(failure.stdout)).toEqual({
      ok: false,
      code: "DAG_ELIGIBILITY_MISSING_DEPENDENCY_WALL",
      field: "WO-MAO-017",
      detail: "WO-MAO-999",
    })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
