import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { planHostedTeamWave } from "../scripts/multi-agent-operator/hosted-team-plan.mjs"

const BASE_SHA = "94795d3c3ef6b4d2eb912214a931da4c1f1c7a10"

function envelope(workOrderId: string, laneId: string, reservations: string[], dependencies = ["WO-MAO-009"]) {
  return {
    schemaVersion: 2,
    programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
    loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
    workOrderId,
    objective: `Deliver ${workOrderId} in an isolated hosted lane.`,
    riskClass: "R1",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{ repository: "bsvalues/terragroq", ref: "refs/heads/main", commitSha: BASE_SHA }],
    dependencies,
    fanInGate: "ALL",
    laneId,
    teamRoles: {
      coordinator: "codex-coordinator",
      builder: `builder-${laneId.toLowerCase()}`,
      reviewer: `reviewer-${laneId.toLowerCase()}`,
    },
    providerRequirements: ["isolated-worktree", "native-subagent"],
    preferredProviders: ["hosted-codex"],
    fallbackProviders: [],
    reservations: {
      paths: reservations.map((reservedPath) => ({ repository: "bsvalues/terragroq", path: reservedPath })),
      contracts: [`contract-${laneId.toLowerCase()}`],
      environments: [],
    },
    allowedActions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
    forbiddenActions: ["CREDENTIAL_ACCESS", "OWNER_CONTACT", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: [],
    programActivationGrantRef: null,
    grantStatusEventRefs: [],
    requiredOutputs: ["implementation", "tests"],
    requiredValidation: ["focused-vitest", "git-diff-check"],
    reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 },
    mergeMode: "NO_MERGE",
    retryBudget: { maxAttempts: 2, backoffSeconds: 0 },
    remediationBudget: { maxCycles: 2 },
    reroutePolicy: "NONE",
    stopConditions: ["authority-wall", "reservation-collision"],
    evidenceTargets: ["commit", "validation"],
    ownerDecisionConditions: [],
    ownerOperationsAllowed: false,
  }
}

function input(candidates: ReturnType<typeof envelope>[], completedWorkOrderIds = ["WO-MAO-009"]) {
  return { schemaVersion: 1, artifactType: "HOSTED_TEAM_PLAN_INPUT", completedWorkOrderIds, candidates }
}

describe("hosted team fan-in planner", () => {
  it("admits compatible A+B candidates into one stable wave", () => {
    const a = envelope("WO-MAO-010", "LANE-MAO-A", ["scripts/multi-agent-operator/dispatch-envelope.mjs"])
    const b = envelope("WO-MAO-011", "LANE-MAO-B", ["scripts/multi-agent-operator/reservation-set.mjs"])
    expect(planHostedTeamWave(input([b, a]))).toMatchObject({
      status: "WAVE_READY",
      selected: [
        { workOrderId: "WO-MAO-010", laneId: "LANE-MAO-A", laneOrdinal: 0 },
        { workOrderId: "WO-MAO-011", laneId: "LANE-MAO-B", laneOrdinal: 1 },
      ],
      blocked: [],
      planningOnly: true,
      dispatchPerformed: false,
      authorityGranted: false,
      atomicReservationClaimed: false,
    })
  })

  it("defers a deliberate reservation collision with a typed reason", () => {
    const a = envelope("WO-MAO-010", "LANE-MAO-A", ["scripts/multi-agent-operator"])
    const b = envelope("WO-MAO-011", "LANE-MAO-B", ["scripts/multi-agent-operator/reservation-set.mjs"])
    expect(planHostedTeamWave(input([a, b]))).toMatchObject({
      selected: [{ workOrderId: "WO-MAO-010" }],
      blocked: [{
        workOrderId: "WO-MAO-011",
        reasonCode: "RESERVATION_CONFLICT",
        collisions: [{ blockingWorkOrderId: "WO-MAO-010", reasonCodes: ["PATH_ANCESTOR_COLLISION"] }],
      }],
    })
  })

  it("releases a dependent only after both fan-in dependencies are complete", () => {
    const fanIn = envelope("WO-MAO-012", "LANE-MAO-C", ["scripts/multi-agent-operator/hosted-team-plan.mjs"], [
      "WO-MAO-010", "WO-MAO-011",
    ])
    expect(planHostedTeamWave(input([fanIn], ["WO-MAO-009", "WO-MAO-010"]))).toMatchObject({
      status: "NO_ELIGIBLE_CANDIDATES",
      selected: [],
      blocked: [{
        reasonCode: "DEPENDENCY_INCOMPLETE",
        fanInGate: "ALL",
        completedDependencies: ["WO-MAO-010"],
        incompleteDependencies: ["WO-MAO-011"],
      }],
    })
    expect(planHostedTeamWave(input([fanIn], ["WO-MAO-009", "WO-MAO-010", "WO-MAO-011"]))).toMatchObject({
      status: "WAVE_READY",
      selected: [{ workOrderId: "WO-MAO-012", laneId: "LANE-MAO-C" }],
      blocked: [],
    })
  })

  it("applies ANY and ALL dependency gates exactly", () => {
    const anyCandidate = envelope("WO-MAO-012", "LANE-MAO-ANY", ["scripts/any.mjs"], [
      "WO-MAO-010", "WO-MAO-011",
    ])
    anyCandidate.fanInGate = "ANY"
    expect(planHostedTeamWave(input([anyCandidate], ["WO-MAO-010"]))).toMatchObject({
      selected: [{ workOrderId: "WO-MAO-012" }],
      blocked: [],
    })
    expect(planHostedTeamWave(input([anyCandidate], ["WO-MAO-009"]))).toMatchObject({
      selected: [],
      blocked: [{
        reasonCode: "DEPENDENCY_INCOMPLETE",
        fanInGate: "ANY",
        completedDependencies: [],
        incompleteDependencies: ["WO-MAO-010", "WO-MAO-011"],
      }],
    })

    const allCandidate = envelope("WO-MAO-012", "LANE-MAO-ALL", ["scripts/all.mjs"], [
      "WO-MAO-010", "WO-MAO-011",
    ])
    expect(planHostedTeamWave(input([allCandidate], ["WO-MAO-010"]))).toMatchObject({
      selected: [],
      blocked: [{ reasonCode: "DEPENDENCY_INCOMPLETE", fanInGate: "ALL" }],
    })
  })

  it("rejects internally invalid reservation sets before admitting a first candidate", () => {
    const selfOverlapping = envelope("WO-MAO-010", "LANE-MAO-A", ["scripts/operator", "scripts/operator/a.mjs"])
    expect(planHostedTeamWave(input([selfOverlapping]))).toMatchObject({
      status: "NO_ELIGIBLE_CANDIDATES",
      selected: [],
      blocked: [{ reasonCode: "INVALID_RESERVATION_SET", reasonCodes: ["SELF_PATH_COLLISION"] }],
    })

    const nulContract = envelope("WO-MAO-011", "LANE-MAO-B", ["scripts/b.mjs"])
    nulContract.reservations.contracts = ["invalid\0contract"]
    expect(planHostedTeamWave(input([nulContract]))).toMatchObject({
      selected: [],
      blocked: [{ reasonCode: "INVALID_RESERVATION_SET", reasonCodes: ["INVALID_RESERVATION_VALUE"] }],
    })
  })

  it("is deterministic across candidate, dependency, and reservation input order", () => {
    const a = envelope("WO-MAO-010", "LANE-MAO-A", ["scripts/a.mjs", "tests/a.test.ts"])
    const b = envelope("WO-MAO-011", "LANE-MAO-B", ["scripts/b.mjs", "tests/b.test.ts"])
    const first = planHostedTeamWave(input([a, b]))
    a.reservations.paths.reverse()
    b.reservations.paths.reverse()
    const second = planHostedTeamWave(input([b, a], ["WO-MAO-009"]))
    expect(second).toEqual(first)
  })

  it("exposes the pure planner through a machine-readable CLI", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-hosted-team-plan-"))
    const file = path.join(directory, "input.json")
    fs.writeFileSync(file, JSON.stringify(input([
      envelope("WO-MAO-010", "LANE-MAO-A", ["scripts/a.mjs"]),
    ])))
    const result = JSON.parse(execFileSync(process.execPath,
      ["scripts/multi-agent-operator/hosted-team-plan-cli.mjs", file], { encoding: "utf8" }))
    expect(result).toMatchObject({ ok: true, status: "WAVE_READY", dispatchPerformed: false })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
