import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  compileTeamTopology,
  TeamTopologyError,
} from "../scripts/multi-agent-operator/team-topology.mjs"

const BASE_SHA = "6239cd907bd5d260d2f11a2ee864a5d8c9a7e1f2"

function envelope(
  workOrderId: string,
  laneId: string,
  dependencies: string[] = [],
  fanInGate = "ALL",
) {
  return {
    schemaVersion: 2,
    programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
    loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
    workOrderId,
    objective: `Execute ${workOrderId} in its isolated team lane.`,
    riskClass: "R1",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{
      repository: "bsvalues/terragroq",
      ref: "refs/heads/main",
      commitSha: BASE_SHA,
    }],
    dependencies,
    fanInGate,
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
      paths: [{
        repository: "bsvalues/terragroq",
        path: `tmp/${workOrderId.toLowerCase()}.txt`,
      }],
      contracts: [`contract-${laneId.toLowerCase()}`],
      environments: [],
    },
    allowedActions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
    forbiddenActions: ["CREDENTIAL_ACCESS", "OWNER_CONTACT", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: ["docs/reports/WO-MAO-003-owner-only-authority-contract.md"],
    programActivationGrantRef: null,
    grantStatusEventRefs: [],
    requiredOutputs: ["implementation", "tests"],
    requiredValidation: ["focused-vitest", "git-diff-check"],
    reviewRequirements: {
      independentReviewer: true,
      minimumApprovals: 1,
      maximumUnresolvedThreads: 0,
    },
    mergeMode: "NO_MERGE",
    retryBudget: { maxAttempts: 2, backoffSeconds: 0 },
    remediationBudget: { maxCycles: 2 },
    reroutePolicy: "NONE",
    stopConditions: ["authority-wall", "reservation-collision"],
    evidenceTargets: ["owner-operation-counters", "validation"],
    ownerDecisionConditions: [],
    ownerOperationsAllowed: false,
  }
}

type Envelope = ReturnType<typeof envelope>

function lane(value: Envelope) {
  return {
    envelope: value,
    roleAssignments: {
      coordinator: value.teamRoles.coordinator,
      builder: value.teamRoles.builder,
      reviewer: value.teamRoles.reviewer,
      remediator: value.teamRoles.builder,
      mergeController: "codex-merge-controller",
      verifier: "codex-verifier",
    },
  }
}

type Lane = ReturnType<typeof lane>

function input(lanes: Lane[], completedWorkOrderIds: string[] = []) {
  const laneByWorkOrder = new Map(lanes.map(({ envelope }) => [envelope.workOrderId, envelope]))
  const referencedIds = new Set([
    ...laneByWorkOrder.keys(),
    ...lanes.flatMap(({ envelope }) => envelope.dependencies),
    ...completedWorkOrderIds,
  ])
  const workOrders = [...referencedIds].sort().map((workOrderId) => {
    const raw = structuredClone(laneByWorkOrder.get(workOrderId) ?? envelope(workOrderId, `LANE-${workOrderId}`))
    return {
      artifactType: "WORK_ORDER_ENVELOPE_V2",
      ...raw,
      authorityGrantRefs: ["docs/reports/WO-MAO-003-owner-only-authority-contract.md"],
      ownerTouchBudget: {
        operationTouches: 0,
        credentialTouches: 0,
        diagnosticTouches: 0,
        routineDecisions: 0,
        routineContacts: 0,
      },
      communicationPolicy: "FINAL_ONLY",
    }
  })
  const completed = new Set(completedWorkOrderIds)
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_TEAM_TOPOLOGY_INPUT",
    topologyId: "topology-wo-mao-024",
    dagInput: {
      schemaVersion: 1,
      artifactType: "DAG_ELIGIBILITY_INPUT",
      workOrders,
      workOrderStates: workOrders.map(({ workOrderId }) => ({
        workOrderId,
        state: completed.has(workOrderId) ? "COMPLETE" : "PLANNED",
        reasonCode: null,
      })),
    },
    lanes,
  }
}

type Input = ReturnType<typeof input>

function expectWall(
  value: unknown,
  code: string,
  field?: string,
  detail?: string,
) {
  try {
    compileTeamTopology(value)
    throw new Error("expected team topology compilation to fail")
  } catch (error) {
    expect(error).toBeInstanceOf(TeamTopologyError)
    expect(error).toMatchObject({
      code,
      ...(field ? { field } : {}),
      ...(detail ? { detail } : {}),
    })
  }
}

describe("multi-agent team topology", () => {
  it("fans out two independent lanes in the same ready wave", () => {
    const a = lane(envelope("WO-MAO-024", "LANE-MAO-A"))
    const b = lane(envelope("WO-MAO-025", "LANE-MAO-B"))

    expect(compileTeamTopology(input([b, a]))).toMatchObject({
      schemaVersion: 1,
      artifactType: "MULTI_AGENT_TEAM_TOPOLOGY",
      topologyId: "topology-wo-mao-024",
      status: "PLANNING_FAN_OUT_CANDIDATES",
      lanes: [
        {
          workOrderId: "WO-MAO-024",
          laneId: "LANE-MAO-A",
          roleAssignments: a.roleAssignments,
          fanIn: {
            fanInGate: "ALL",
            declaredDependencies: [],
            satisfiedDependencies: [],
            pendingDependencies: [],
            projectedGateSatisfied: true,
          },
        },
        {
          workOrderId: "WO-MAO-025",
          laneId: "LANE-MAO-B",
          roleAssignments: b.roleAssignments,
          fanIn: {
            fanInGate: "ALL",
            declaredDependencies: [],
            satisfiedDependencies: [],
            pendingDependencies: [],
            projectedGateSatisfied: true,
          },
        },
      ],
      candidateFanOut: [
        { workOrderId: "WO-MAO-024", laneId: "LANE-MAO-A" },
        { workOrderId: "WO-MAO-025", laneId: "LANE-MAO-B" },
      ],
      waiting: [],
      explicitlyIneligible: [],
    })
  })

  it("holds an ALL lane only for its pending declared dependencies", () => {
    const dependent = lane(envelope(
      "WO-MAO-026",
      "LANE-MAO-C",
      ["WO-MAO-024", "WO-MAO-025"],
    ))
    const result = compileTeamTopology(input(
      [dependent],
      ["WO-MAO-024", "WO-MAO-999"],
    ))

    expect(result).toMatchObject({
      status: "PLANNING_WAITING_ON_DECLARED_DEPENDENCIES",
      declaredCompleteWorkOrderIds: ["WO-MAO-024", "WO-MAO-999"],
      candidateFanOut: [],
      waiting: [{
        workOrderId: "WO-MAO-026",
        laneId: "LANE-MAO-C",
        pendingDependencies: ["WO-MAO-025"],
      }],
      lanes: [{
        fanIn: {
          fanInGate: "ALL",
          declaredDependencies: ["WO-MAO-024", "WO-MAO-025"],
          satisfiedDependencies: ["WO-MAO-024"],
          pendingDependencies: ["WO-MAO-025"],
          projectedGateSatisfied: false,
        },
      }],
    })
  })

  it.each([
    ["BLOCKED", "SECURITY_WALL", "EXPLICITLY_BLOCKED"],
    ["DEFERRED", "PROVIDER_UNAVAILABLE", "EXPLICITLY_DEFERRED"],
  ] as const)("partitions an explicitly %s root outside dependency waits", (state, reason, disposition) => {
    const root = lane(envelope("WO-MAO-024", `LANE-${state}`))
    const value = input([root])
    value.dagInput.workOrderStates[0] = {
      workOrderId: "WO-MAO-024",
      state,
      reasonCode: reason,
    }

    expect(compileTeamTopology(value)).toMatchObject({
      status: "PLANNING_EXPLICITLY_INELIGIBLE",
      candidateFanOut: [],
      waiting: [],
      explicitlyIneligible: [{
        workOrderId: "WO-MAO-024",
        laneId: `LANE-${state}`,
        disposition,
        reasonCode: disposition,
        stateReasonCode: reason,
      }],
      lanes: [{
        fanIn: {
          declaredDependencies: [],
          pendingDependencies: [],
          projectedGateSatisfied: false,
          planningDisposition: disposition,
          reasonCode: disposition,
          stateReasonCode: reason,
        },
      }],
    })
  })

  it("releases ANY after one declared dependency and releases zero-dependency roots", () => {
    const anyLane = lane(envelope(
      "WO-MAO-026",
      "LANE-MAO-ANY",
      ["WO-MAO-024", "WO-MAO-025"],
      "ANY",
    ))
    const anyWaiting = compileTeamTopology(input([anyLane], ["WO-MAO-999"]))
    expect(anyWaiting).toMatchObject({
      candidateFanOut: [],
      waiting: [{ pendingDependencies: ["WO-MAO-024", "WO-MAO-025"] }],
      lanes: [{ fanIn: {
        fanInGate: "ANY",
        satisfiedDependencies: [],
        pendingDependencies: ["WO-MAO-024", "WO-MAO-025"],
        projectedGateSatisfied: false,
      } }],
    })

    const anyReady = compileTeamTopology(input([anyLane], ["WO-MAO-024"]))
    expect(anyReady).toMatchObject({
      candidateFanOut: [{ workOrderId: "WO-MAO-026", laneId: "LANE-MAO-ANY" }],
      waiting: [],
      lanes: [{ fanIn: {
        fanInGate: "ANY",
        satisfiedDependencies: ["WO-MAO-024"],
        pendingDependencies: ["WO-MAO-025"],
        projectedGateSatisfied: true,
      } }],
    })

    const root = lane(envelope("WO-MAO-024", "LANE-ROOT-ALL"))
    expect(compileTeamTopology(input([root]))).toMatchObject({
      candidateFanOut: [{ workOrderId: "WO-MAO-024", laneId: "LANE-ROOT-ALL" }],
      waiting: [],
      lanes: [{ fanIn: {
        fanInGate: "ALL",
        declaredDependencies: [],
        satisfiedDependencies: [],
        pendingDependencies: [],
        projectedGateSatisfied: true,
      } }],
    })
  })

  it("never treats unrelated completed work orders as dependency satisfaction or a wait", () => {
    const root = lane(envelope("WO-MAO-024", "LANE-MAO-ROOT"))
    const dependent = lane(envelope("WO-MAO-025", "LANE-MAO-DEPENDENT", ["WO-MAO-024"]))

    expect(compileTeamTopology(input([root, dependent], ["WO-MAO-777"]))).toMatchObject({
      candidateFanOut: [{ workOrderId: "WO-MAO-024" }],
      waiting: [{
        workOrderId: "WO-MAO-025",
        pendingDependencies: ["WO-MAO-024"],
      }],
      lanes: [
        { workOrderId: "WO-MAO-024", fanIn: { pendingDependencies: [], projectedGateSatisfied: true } },
        { workOrderId: "WO-MAO-025", fanIn: {
          satisfiedDependencies: [],
          pendingDependencies: ["WO-MAO-024"],
          projectedGateSatisfied: false,
        } },
      ],
    })
  })

  it("is deterministic across lane, dependency, and completed-ID order", () => {
    const a = lane(envelope("WO-MAO-024", "LANE-MAO-A", ["WO-MAO-021", "WO-MAO-019"]))
    const b = lane(envelope("WO-MAO-025", "LANE-MAO-B"))
    const first = compileTeamTopology(input([a, b], ["WO-MAO-999", "WO-MAO-019", "WO-MAO-021"]))

    a.envelope.dependencies.reverse()
    const second = compileTeamTopology(input([b, a], ["WO-MAO-021", "WO-MAO-019", "WO-MAO-999"]))
    expect(second).toEqual(first)
    expect(first.topologyHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("rejects duplicate canonical DAG state claims instead of normalizing them", () => {
    const value = input([lane(envelope("WO-MAO-024", "LANE-MAO-A"))])
    value.dagInput.workOrderStates.push({ ...value.dagInput.workOrderStates[0] })
    expectWall(
      value,
      "TEAM_TOPOLOGY_DAG_WALL",
      "dagInput.workOrderStates",
      "DAG_ELIGIBILITY_DUPLICATE_WALL",
    )
  })

  it("rejects duplicate work orders and duplicate lane IDs", () => {
    const first = lane(envelope("WO-MAO-024", "LANE-MAO-A"))
    const duplicateWorkOrder = lane(envelope("WO-MAO-024", "LANE-MAO-B"))
    expectWall(
      input([first, duplicateWorkOrder]),
      "TEAM_TOPOLOGY_DUPLICATE_WORK_ORDER_WALL",
      "lanes",
    )

    const duplicateLane = lane(envelope("WO-MAO-025", "LANE-MAO-A"))
    expectWall(
      input([first, duplicateLane]),
      "TEAM_TOPOLOGY_DUPLICATE_LANE_WALL",
      "lanes",
    )
  })

  it("rejects a lane envelope substituted after canonical DAG validation input is built", () => {
    const value = input([lane(envelope("WO-MAO-024", "LANE-MAO-A"))])
    value.lanes[0].envelope.laneId = "LANE-SUBSTITUTED"
    expectWall(
      value,
      "TEAM_TOPOLOGY_DAG_BINDING_WALL",
      "lanes[0].envelope",
      "CANONICAL_ENVELOPE_MISMATCH",
    )
  })

  it("rejects security-relevant canonical envelope substitution", () => {
    const value = input([lane(envelope("WO-MAO-024", "LANE-MAO-A"))])
    value.lanes[0].envelope.riskClass = "R2"
    expectWall(
      value,
      "TEAM_TOPOLOGY_DAG_BINDING_WALL",
      "lanes[0].envelope",
      "CANONICAL_ENVELOPE_MISMATCH",
    )
  })

  it("rejects cross-lane builder and reviewer reuse", () => {
    const a = lane(envelope("WO-MAO-024", "LANE-MAO-A"))
    const b = lane(envelope("WO-MAO-025", "LANE-MAO-B"))
    a.roleAssignments.reviewer = b.roleAssignments.builder
    a.envelope.teamRoles.reviewer = b.roleAssignments.builder
    expectWall(
      input([a, b]),
      "TEAM_TOPOLOGY_ROLE_WALL",
      "lanes",
      "CROSS_LANE_BUILDER_REVIEWER_COLLISION",
    )
  })

  it.each([
    ["builder", "CROSS_LANE_BUILDER_REUSE"],
    ["reviewer", "CROSS_LANE_REVIEWER_REUSE"],
  ] as const)("rejects cross-lane %s reuse", (role, reason) => {
    const a = lane(envelope("WO-MAO-024", "LANE-A"))
    const b = lane(envelope("WO-MAO-025", "LANE-B"))
    b.roleAssignments[role] = a.roleAssignments[role]
    b.envelope.teamRoles[role] = a.roleAssignments[role]
    if (role === "builder") b.roleAssignments.remediator = a.roleAssignments.builder

    expectWall(input([a, b]), "TEAM_TOPOLOGY_ROLE_WALL", "lanes", reason)
  })

  it("rejects reservation collisions across the ready fan-out wave", () => {
    const a = lane(envelope("WO-MAO-024", "LANE-MAO-A"))
    const b = lane(envelope("WO-MAO-025", "LANE-MAO-B"))
    b.envelope.reservations.paths = structuredClone(a.envelope.reservations.paths)
    expectWall(
      input([a, b]),
      "TEAM_TOPOLOGY_RESERVATION_WALL",
      "lanes",
      "WO-MAO-024:WO-MAO-025",
    )
  })

  it("rejects coordinator, builder, and reviewer mismatches with the envelope", () => {
    for (const role of ["coordinator", "builder", "reviewer"] as const) {
      const value = input([lane(envelope("WO-MAO-024", "LANE-MAO-A"))])
      value.lanes[0].roleAssignments[role] = `different-${role}`
      expectWall(value, "TEAM_TOPOLOGY_ROLE_WALL", `lanes[0].roleAssignments.${role}`, "ENVELOPE_ROLE_MISMATCH")
    }
  })

  it("requires remediation to return to the original builder", () => {
    const value = input([lane(envelope("WO-MAO-024", "LANE-MAO-A"))])
    value.lanes[0].roleAssignments.remediator = "different-remediator"
    expectWall(
      value,
      "TEAM_TOPOLOGY_ROLE_WALL",
      "lanes[0].roleAssignments.remediator",
      "REMEDIATOR_MUST_EQUAL_BUILDER",
    )
  })

  it.each([
    ["merge controller equals builder", "mergeController", "builder"],
    ["merge controller equals reviewer", "mergeController", "reviewer"],
    ["merge controller equals coordinator", "mergeController", "coordinator"],
    ["verifier equals builder", "verifier", "builder"],
    ["verifier equals reviewer", "verifier", "reviewer"],
    ["verifier equals coordinator", "verifier", "coordinator"],
    ["verifier equals merge controller", "verifier", "mergeController"],
  ] as const)("rejects %s", (_name, target, source) => {
    const value = input([lane(envelope("WO-MAO-024", "LANE-MAO-A"))])
    value.lanes[0].roleAssignments[target] = value.lanes[0].roleAssignments[source]
    expectWall(value, "TEAM_TOPOLOGY_ROLE_WALL", `lanes[0].roleAssignments.${target}`, "ROLE_INDEPENDENCE_REQUIRED")
  })

  it.each(["coordinator", "mergeController", "verifier"] as const)(
    "requires one global %s across lanes",
    (role) => {
      const a = lane(envelope("WO-MAO-024", "LANE-MAO-A"))
      const b = lane(envelope("WO-MAO-025", "LANE-MAO-B"))
      b.roleAssignments[role] = `different-${role.toLowerCase()}`
      if (role === "coordinator") b.envelope.teamRoles.coordinator = b.roleAssignments.coordinator
      expectWall(
        input([a, b]),
        "TEAM_TOPOLOGY_ROLE_WALL",
        `lanes[1].roleAssignments.${role}`,
        "INCONSISTENT_GLOBAL_ROLE",
      )
    },
  )

  it("rejects missing, malformed, and unknown input fields", () => {
    const missing = input([lane(envelope("WO-MAO-024", "LANE-MAO-A"))]) as Partial<Input>
    delete missing.topologyId
    expectWall(missing, "TEAM_TOPOLOGY_MISSING_FIELD_WALL", "input.topologyId")

    expectWall(
      { ...input([]), schemaVersion: 2 },
      "TEAM_TOPOLOGY_INPUT_WALL",
      "schemaVersion",
      "UNSUPPORTED_SCHEMA_VERSION",
    )
    expectWall(
      { ...input([]), artifactType: "WRONG_ARTIFACT" },
      "TEAM_TOPOLOGY_INPUT_WALL",
      "artifactType",
      "UNSUPPORTED_ARTIFACT_TYPE",
    )
    expectWall(
      { ...input([]), surprise: true },
      "TEAM_TOPOLOGY_UNKNOWN_FIELD_WALL",
      "input.surprise",
    )

    const unknownRole = input([lane(envelope("WO-MAO-024", "LANE-MAO-A"))])
    Object.assign(unknownRole.lanes[0].roleAssignments, { dispatcher: "codex-dispatcher" })
    expectWall(
      unknownRole,
      "TEAM_TOPOLOGY_UNKNOWN_FIELD_WALL",
      "lanes[0].roleAssignments.dispatcher",
    )
  })

  it("converts an invalid schema-v2 envelope into a typed topology wall", () => {
    const value = input([lane(envelope("WO-MAO-024", "LANE-MAO-A"))])
    value.lanes[0].envelope.ownerOperationsAllowed = true as false
    expectWall(
      value,
      "TEAM_TOPOLOGY_ENVELOPE_WALL",
      "lanes[0].envelope.ownerOperationsAllowed",
      "DISPATCH_ENVELOPE_OWNER_OPERATION_WALL",
    )
  })

  it("is planning-only and performs no authority, dispatch, or owner operation", () => {
    const result = compileTeamTopology(input([
      lane(envelope("WO-MAO-024", "LANE-MAO-A")),
    ]))
    expect(result).toMatchObject({
      planningOnly: true,
      authorityGranted: false,
      dispatchPerformed: false,
      ownerOperationsRequired: false,
    })
  })

  it("provides machine-readable CLI success and typed failure", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-team-topology-"))
    const validPath = path.join(directory, "valid.json")
    const invalidPath = path.join(directory, "invalid.json")
    fs.writeFileSync(validPath, JSON.stringify(input([
      lane(envelope("WO-MAO-024", "LANE-MAO-A")),
    ])))
    const invalid = input([lane(envelope("WO-MAO-024", "LANE-MAO-A"))])
    invalid.lanes[0].roleAssignments.remediator = "wrong-remediator"
    fs.writeFileSync(invalidPath, JSON.stringify(invalid))
    const cli = path.resolve("scripts/multi-agent-operator/team-topology-cli.mjs")

    const success = JSON.parse(execFileSync(process.execPath, [cli, validPath], { encoding: "utf8" }))
    expect(success).toMatchObject({
      ok: true,
      status: "PLANNING_FAN_OUT_CANDIDATES",
      fanOutIsAdvisory: true,
      requiresSchedulerVerification: true,
      dispatchEligible: false,
      releaseAuthorized: false,
      topologyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      planningOnly: true,
      authorityGranted: false,
      dispatchPerformed: false,
      ownerOperationsRequired: false,
    })

    const failure = spawnSync(process.execPath, [cli, invalidPath], { encoding: "utf8" })
    expect(failure.status).toBe(2)
    expect(failure.stderr).toBe("")
    expect(JSON.parse(failure.stdout)).toEqual({
      ok: false,
      code: "TEAM_TOPOLOGY_ROLE_WALL",
      field: "lanes[0].roleAssignments.remediator",
      detail: "REMEDIATOR_MUST_EQUAL_BUILDER",
    })

    fs.rmSync(directory, { recursive: true, force: true })
  })
})
