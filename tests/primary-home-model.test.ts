import { describe, expect, it } from "vitest"

import type { GoalTimelineProjection } from "@/components/goal-console/goal-timeline-read-model"
import {
  projectPrimaryHomeModel,
  resolvePrimaryHomeGoalId,
  type PrimaryHomeModelInput,
} from "@/components/primary-home/primary-home-model"
import { formatPrimaryHomeTime } from "@/components/primary-home/primary-home-format"
import type { RecentOutcomeCompletionTimeline } from "@/components/runtime/outcome-completion-timeline"
import type { EvidenceRecord } from "@/lib/db/schema"
import type { OutcomeQueueRecord } from "@/lib/outcome-queue/engine"
import { projectOutcomeQueueOperatorSurface } from "@/lib/outcome-queue/operator-surface"

const NOW = "2026-08-03T12:00:00.000Z"

function queueRecord(overrides: Partial<OutcomeQueueRecord> = {}): OutcomeQueueRecord {
  return {
    id: 1,
    userId: "owner",
    outcomeKey: "goal:GOAL-1",
    goalId: 1,
    goalRef: "GOAL-1",
    title: "Ship the founder briefing",
    objective: "Ship the founder briefing",
    queueOrder: 10,
    dependencyKeys: [],
    riskClass: "R1",
    approvalState: "approved",
    approvedBy: "owner",
    approvedAt: "2026-08-03T08:00:00.000Z",
    approvalDecisionId: 100,
    authorityState: "matched",
    authorityLevel: "A2_WRITE_OWN",
    authorityGrantRef: "GRANT-1",
    authoritySubject: "codex",
    authorityAction: "outcome:execute",
    lifecycleState: "active",
    lifecycleReason: "Implementation is moving.",
    activeWorkOrderId: 101,
    executionBinding: "execution-1",
    leaseHolder: "hermes",
    leaseToken: "lease-1",
    leaseExpiresAt: "2026-08-03T12:05:00.000Z",
    fencingToken: 1,
    version: 1,
    acquisitionKey: "acquisition-1",
    terminalResult: null,
    terminalEvidenceId: null,
    terminalEvidenceRefs: [],
    terminalKey: null,
    suggestedAt: "2026-08-03T07:00:00.000Z",
    activatedAt: "2026-08-03T08:00:00.000Z",
    terminalAt: null,
    createdAt: "2026-08-03T07:00:00.000Z",
    updatedAt: "2026-08-03T11:59:00.000Z",
    ...overrides,
  }
}

function queue(records: readonly OutcomeQueueRecord[]) {
  return projectOutcomeQueueOperatorSurface({
    queue: records,
    now: NOW,
    validApprovalDecisionIds: [100],
    validAuthorityGrantRefs: ["GRANT-1"],
  })
}

function timeline(overrides: {
  goalId?: number
  goalRef?: string
  outcome?: string
  truth?: GoalTimelineProjection["truth"]["state"]
  phase?: string
  workOrderId?: number
  workOrderStatus?: string
  worker?: string | null
  recordedAt?: Date | null
  leaseStatus?: GoalTimelineProjection["current"]["runtime"]["leaseStatus"]
  checkpointState?: string | null
  checkpointDetail?: string | null
  terminalState?: string | null
  terminalResult?: string | null
  delivery?: GoalTimelineProjection["delivery"]["status"]
  actionable?: boolean
  blockedAction?: string | null
  authorityBoundary?: string | null
  queueAge?: Date
} = {}): GoalTimelineProjection {
  const goalId = overrides.goalId ?? 1
  const goalRef = overrides.goalRef ?? `GOAL-${goalId}`
  const actionable = overrides.actionable ?? false
  const observedAt = new Date(NOW)
  return {
    id: `goal:${goalId}`,
    goal: {
      id: goalId,
      ref: goalRef,
      outcome: overrides.outcome ?? "Ship the founder briefing",
      lane: "product",
      mode: "bounded",
      status: "active",
      verdict: "AUTHORIZED",
      authority: "recorded",
      risk: "R1",
    },
    truth: {
      state: overrides.truth ?? "CURRENT",
      issues: overrides.truth && overrides.truth !== "CURRENT"
        ? [{
            code: `TIMELINE_${overrides.truth}`,
            state: overrides.truth,
            detail: `Timeline is ${overrides.truth.toLowerCase()}.`,
            references: [],
          }]
        : [],
      observedAt,
      latestPersistedAt: overrides.queueAge ?? new Date("2026-08-03T10:00:00.000Z"),
    },
    current: {
      phase: overrides.phase ?? "EXECUTING",
      workOrder: {
        id: overrides.workOrderId ?? 101,
        ref: `WO-${overrides.workOrderId ?? 101}`,
        title: "Build Primary Home",
        status: overrides.workOrderStatus ?? "active",
        result: null,
      },
      runtime: {
        attempt: 1,
        worker: overrides.worker === undefined ? "Codex" : overrides.worker,
        leaseStatus: overrides.leaseStatus ?? "ACTIVE",
        leaseExpiresAt: new Date("2026-08-03T12:05:00.000Z"),
        checkpointId: "trace:1",
        checkpointSequence: 1,
        checkpointState: overrides.checkpointState ?? "EXECUTING",
        checkpointDetail: overrides.checkpointDetail ?? "Implementing the bounded projection.",
        recordedAt: overrides.recordedAt === undefined
          ? new Date("2026-08-03T11:59:00.000Z")
          : overrides.recordedAt,
      },
    },
    validationCheckpoints: [],
    delivery: {
      prNumber: null,
      finalRevision: null,
      status: overrides.delivery ?? "MISSING",
    },
    references: { evidence: [], trace: [], audit: [], decisions: [] },
    terminal: {
      state: overrides.terminalState ?? null,
      result: overrides.terminalResult ?? null,
      limitations: [],
      ownerAction: null,
    },
    resume: {
      state: actionable ? "AWAITING_OWNER_DECISION" : "NOT_REQUIRED",
      decisionId: null,
      decisionRef: null,
      governedNextState: actionable ? "EXECUTING" : null,
    },
    decisionRequest: {
      status: actionable ? "ACTIONABLE" : "NOT_REQUIRED",
      blockedAction: overrides.blockedAction ?? (actionable ? "release the protected preview" : null),
      authorityBoundary: overrides.authorityBoundary ?? (actionable ? "Production release authority is required." : null),
      choices: actionable ? ["APPROVE", "DENY"] : [],
      consequences: {
        approve: actionable ? "The protected preview is released." : null,
        deny: actionable ? "The preview remains private." : null,
      },
      goalId,
      goalRef,
      outcomeId: goalId,
      outcomeRef: `OUTCOME-${goalId}`,
      workOrderId: overrides.workOrderId ?? 101,
      workOrderRef: `WO-${overrides.workOrderId ?? 101}`,
      terminalEventId: actionable ? 900 + goalId : null,
      terminalState: actionable ? "OWNER_DECISION_REQUIRED" : null,
      terminalResult: actionable ? "OWNER_DECISION_REQUIRED" : null,
      ownerUserId: "owner",
      expectedNextState: actionable ? "EXECUTING" : null,
      receipt: {
        status: "NOT_RECORDED",
        choice: null,
        decisionId: null,
        decisionRef: null,
        ownerUserId: null,
        terminalEventId: null,
        recordedAt: null,
      },
      resume: {
        state: actionable ? "AWAITING_OWNER_DECISION" : "NOT_REQUIRED",
        governedNextState: actionable ? "EXECUTING" : null,
      },
    },
    entries: [{
      id: `goal:${goalId}:created`,
      kind: "GOAL",
      state: "active",
      label: "Goal active",
      detail: null,
      occurredAt: overrides.queueAge ?? new Date("2026-08-03T09:00:00.000Z"),
      references: [goalRef],
    }],
  }
}

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: 1,
    userId: "owner",
    ref: "EV-1",
    workOrderId: 101,
    result: "PASS",
    repo: "bsvalues/williamos",
    branch: "codex/primary-home",
    head: "abc123",
    worktreeStatus: "clean",
    filesChanged: [],
    validators: [],
    knownFailures: [],
    outOfScopeChanges: [],
    deferredItems: [],
    nextValidMove: null,
    notes: null,
    contentHash: "hash-1",
    artifactPath: "evidence/EV-1.json",
    createdAt: new Date("2026-08-03T11:00:00.000Z"),
    ...overrides,
  }
}

function recommendationBinding(overrides: {
  outcomeId?: number
  workOrderId?: number
  terminalEventId?: number
  expectedNextState?: string
} = {}) {
  return JSON.stringify({
    outcomeId: overrides.outcomeId ?? 1,
    workOrderId: overrides.workOrderId ?? 101,
    terminalEventId: overrides.terminalEventId ?? 901,
    expectedNextState: overrides.expectedNextState ?? "EXECUTING",
  })
}

const noCompletions: RecentOutcomeCompletionTimeline = { rows: [], truncated: false }

function input(overrides: Partial<PrimaryHomeModelInput> = {}): PrimaryHomeModelInput {
  return {
    queue: queue([queueRecord()]),
    currentTimeline: timeline(),
    actionableTimelines: [],
    recentCompletions: noCompletions,
    evidenceRecords: [evidence()],
    ...overrides,
  }
}

describe("Primary Home read model", () => {
  it("projects a normal active briefing from current runtime and linked evidence", () => {
    const model = projectPrimaryHomeModel(input())

    expect(model.founderBriefing).toMatchObject({
      outcome: "Ship the founder briefing",
      project: "bsvalues/williamos",
      actor: "Codex",
      health: { state: "ADVANCING", label: "Advancing" },
      nextAutomaticStep: "Continue Ship the founder briefing",
    })
    expect(model.needsWilliam).toBeNull()
    expect(model.activeArtifact).toMatchObject({
      title: "Build Primary Home",
      phase: "EXECUTING",
      status: "active",
      deliveryStatus: "MISSING",
      actor: "Codex",
      detailHref: "/work-orders",
    })
    expect(model.nextWithoutWilliam).toMatchObject({
      mode: "CONTINUE_ACTIVE",
      reason: "The active outcome holds a live lease",
    })
  })

  it("reports a current blocked timeline without inventing clean progress", () => {
    const current = timeline({
      phase: "BLOCKED_DEPENDENCY",
      checkpointState: "BLOCKED_DEPENDENCY",
      checkpointDetail: "Waiting for the preview dependency.",
      leaseStatus: "RELEASED",
    })
    const model = projectPrimaryHomeModel(input({ currentTimeline: current }))

    expect(model.founderBriefing.health).toEqual({
      state: "BLOCKED",
      label: "Blocked",
      detail: "Waiting for the preview dependency.",
    })
  })

  it("selects exactly one ACTIONABLE request using current, queue, age, and goal priority", () => {
    const current = timeline({
      goalId: 2,
      goalRef: "GOAL-2",
      outcome: "Release the founder preview",
      workOrderId: 202,
      actionable: true,
    })
    const older = timeline({
      goalId: 1,
      outcome: "Choose a secondary policy",
      workOrderId: 201,
      actionable: true,
      queueAge: new Date("2026-08-01T00:00:00.000Z"),
    })
    const records = [
      evidence({
        id: 2,
        ref: "EV-2",
        workOrderId: 202,
        repo: "bsvalues/founder-os",
        nextValidMove: "APPROVE: release the reviewed preview",
        notes: recommendationBinding({ outcomeId: 2, workOrderId: 202, terminalEventId: 902 }),
      }),
    ]
    const model = projectPrimaryHomeModel(input({
      queue: queue([
        queueRecord({ id: 1, goalId: 1, goalRef: "GOAL-1", outcomeKey: "goal:GOAL-1", queueOrder: 1 }),
        queueRecord({
          id: 2,
          goalId: 2,
          goalRef: "GOAL-2",
          outcomeKey: "goal:GOAL-2",
          title: "Release the founder preview",
          activeWorkOrderId: 202,
          queueOrder: 20,
        }),
      ]),
      currentTimeline: current,
      actionableTimelines: [older, current],
      evidenceRecords: records,
    }))

    expect(model.needsWilliam).toMatchObject({
      timelineId: "goal:2",
      question: "Should WilliamOS release the protected preview?",
      project: "bsvalues/founder-os",
      whyNow: "Production release authority is required.",
      recommendation: {
        choice: "APPROVE",
        statement: "APPROVE: release the reviewed preview",
        evidenceRefs: ["EV-2"],
      },
      choices: [
        { label: "Allow release the protected preview", consequence: "The protected preview is released." },
        { label: "Keep Release the founder preview blocked", consequence: "The preview remains private." },
      ],
    })
    expect(model.technicalDetails.decisionGoalId).toBe(2)
  })

  it("fails recommendation closed when linked evidence disagrees", () => {
    const current = timeline({ actionable: true })
    const model = projectPrimaryHomeModel(input({
      currentTimeline: current,
      actionableTimelines: [current],
      evidenceRecords: [
        evidence({ id: 1, ref: "EV-1", nextValidMove: "APPROVE: release", notes: recommendationBinding() }),
        evidence({ id: 2, ref: "EV-2", nextValidMove: "DENY: keep private", notes: recommendationBinding() }),
      ],
    }))

    expect(model.needsWilliam?.recommendation).toBeNull()
  })

  it("uses the newest matching recommendation by timestamp and id", () => {
    const current = timeline({ actionable: true })
    const model = projectPrimaryHomeModel(input({
      currentTimeline: current,
      actionableTimelines: [current],
      evidenceRecords: [
        evidence({
          id: 9,
          ref: "EV-Z",
          nextValidMove: "APPROVE: use the older recommendation",
          notes: recommendationBinding(),
          createdAt: new Date("2026-08-03T09:00:00.000Z"),
        }),
        evidence({
          id: 2,
          ref: "EV-A",
          nextValidMove: "APPROVE: use the current recommendation",
          notes: recommendationBinding(),
          createdAt: new Date("2026-08-03T11:00:00.000Z"),
        }),
      ],
    }))

    expect(model.needsWilliam?.recommendation).toMatchObject({
      choice: "APPROVE",
      statement: "APPROVE: use the current recommendation",
      evidenceRefs: ["EV-A", "EV-Z"],
    })
  })

  it("fails recommendation closed when evidence belongs to an older authority request", () => {
    const current = timeline({ actionable: true })
    const model = projectPrimaryHomeModel(input({
      currentTimeline: current,
      actionableTimelines: [current],
      evidenceRecords: [evidence({
        nextValidMove: "APPROVE: follow stale evidence",
        notes: recommendationBinding({ terminalEventId: 899 }),
      })],
    }))

    expect(model.needsWilliam?.recommendation).toBeNull()
  })

  it("gives an actionable owner decision precedence over historical completion text", () => {
    const current = timeline({
      actionable: true,
      phase: "COMPLETED",
      workOrderStatus: "completed",
      terminalState: "OWNER_DECISION_REQUIRED",
    })
    const model = projectPrimaryHomeModel(input({
      currentTimeline: current,
      actionableTimelines: [current],
    }))

    expect(model.founderBriefing.health.state).toBe("BLOCKED")
  })

  it("does not report an expired active lease as advancing or attribute its worker", () => {
    const model = projectPrimaryHomeModel(input({
      queue: queue([queueRecord({ leaseExpiresAt: "2026-08-03T11:00:00.000Z" })]),
    }))

    expect(model.nextWithoutWilliam.mode).toBe("RECOVER")
    expect(model.founderBriefing.health.state).toBe("UNKNOWN")
    expect(model.founderBriefing.actor).toBeNull()
  })

  it("does not infer review from an in-progress delivery reference alone", () => {
    const model = projectPrimaryHomeModel(input({
      currentTimeline: timeline({ delivery: "IN_PROGRESS", checkpointState: "EXECUTING" }),
    }))

    expect(model.founderBriefing.health.state).toBe("ADVANCING")
  })

  it("matches numeric fallback Goal outcome keys to current timeline truth", () => {
    const model = projectPrimaryHomeModel(input({
      queue: queue([queueRecord({ goalId: null, goalRef: null, outcomeKey: "goal:1" })]),
    }))

    expect(model.founderBriefing.health.state).toBe("ADVANCING")
    expect(model.founderBriefing.actor).toBe("Codex")
  })

  it("resolves the live timeline id from a numeric fallback outcome key", () => {
    expect(resolvePrimaryHomeGoalId({ goalId: null, outcomeKey: "goal:17" })).toBe(17)
    expect(resolvePrimaryHomeGoalId({ goalId: 23, outcomeKey: "goal:17" })).toBe(23)
    expect(resolvePrimaryHomeGoalId({ goalId: null, outcomeKey: "goal:0" })).toBeNull()
    expect(resolvePrimaryHomeGoalId({ goalId: null, outcomeKey: "goal:GOAL-17" })).toBeNull()
  })

  it("uses a nonempty fallback when a blocked lifecycle reason is blank", () => {
    const model = projectPrimaryHomeModel(input({
      queue: queue([queueRecord({
        lifecycleState: "blocked",
        lifecycleReason: "   ",
        leaseHolder: null,
        leaseToken: null,
        leaseExpiresAt: null,
        acquisitionKey: null,
        activatedAt: null,
      })]),
      currentTimeline: null,
    }))

    expect(model.founderBriefing.health).toMatchObject({
      state: "BLOCKED",
      detail: "Lifecycle is not eligible",
    })
  })

  it("guards invalid Home timestamps", () => {
    expect(formatPrimaryHomeTime("not-a-date")).toBe("Time not recorded")
    expect(formatPrimaryHomeTime(null)).toBe("Time not recorded")
  })

  it("uses the exact queue reason for an empty queue", () => {
    const model = projectPrimaryHomeModel(input({
      queue: queue([]),
      currentTimeline: null,
      evidenceRecords: [],
    }))

    expect(model.nextWithoutWilliam).toEqual({
      mode: "NONE",
      outcomeKey: null,
      outcome: null,
      label: "No outcomes are queued",
      reason: "No outcomes are queued",
    })
    expect(model.founderBriefing).toMatchObject({
      outcome: null,
      project: null,
      actor: null,
      health: { state: "UNKNOWN" },
    })
  })

  it("groups normalized nonempty evidence repositories without fake attribution", () => {
    const model = projectPrimaryHomeModel(input({
      queue: queue([
        queueRecord(),
        queueRecord({
          id: 2,
          outcomeKey: "goal:GOAL-2",
          goalId: 2,
          goalRef: "GOAL-2",
          title: "Prepare the second product",
          objective: "Prepare the second product",
          queueOrder: 20,
          lifecycleState: "blocked",
          lifecycleReason: "Dependency is not complete.",
          activeWorkOrderId: 302,
          executionBinding: null,
          leaseHolder: null,
          leaseToken: null,
          leaseExpiresAt: null,
          acquisitionKey: null,
          activatedAt: null,
        }),
      ]),
      evidenceRecords: [
        evidence({ id: 1, repo: " bsvalues/founder-os/ ", workOrderId: 101 }),
        evidence({ id: 2, repo: "BSVALUES/FOUNDER-OS", workOrderId: 101 }),
        evidence({ id: 3, repo: "bsvalues/other-product", workOrderId: 302, result: "PARTIAL" }),
        evidence({ id: 4, repo: "   ", workOrderId: 303 }),
        evidence({ id: 5, repo: null, workOrderId: 304 }),
      ],
    }))

    expect(model.projectHorizon).toHaveLength(2)
    expect(model.projectHorizon[0]).toMatchObject({
      repo: "bsvalues/founder-os",
      currentOutcome: "Ship the founder briefing",
      health: { state: "ADVANCING" },
    })
    expect(model.projectHorizon[1]).toMatchObject({
      repo: "bsvalues/other-product",
      currentOutcome: "Prepare the second product",
      health: {
        state: "BLOCKED",
        detail: "Lifecycle is not eligible. An active lease is still held",
      },
      latestResult: { result: "PARTIAL" },
    })
  })

  it("returns newest meaningful completed outcomes exactly once with evidence state", () => {
    const recentCompletions: RecentOutcomeCompletionTimeline = {
      truncated: false,
      rows: [
        {
          outcomeId: "3",
          outcomeKey: "goal:done",
          title: "Primary Home model completed",
          terminalResult: "PASS",
          completedAt: "2026-08-03T11:00:00.000Z",
          mergeEvidence: { status: "RECORDED", sha: "a".repeat(40), prNumber: 499 },
          successorEvidence: {
            status: "MISSING",
            outcomeKey: null,
            title: null,
            receiptId: null,
            acquiredAt: null,
            fencingTokenRange: null,
          },
        },
        {
          outcomeId: "2",
          outcomeKey: "goal:done",
          title: "Duplicate historical row",
          terminalResult: "PASS",
          completedAt: "2026-08-03T10:00:00.000Z",
          mergeEvidence: { status: "MISSING", sha: null, prNumber: null },
          successorEvidence: {
            status: "MISSING",
            outcomeKey: null,
            title: null,
            receiptId: null,
            acquiredAt: null,
            fencingTokenRange: null,
          },
        },
      ],
    }
    const model = projectPrimaryHomeModel(input({ recentCompletions }))

    expect(model.recentOutcomes).toEqual([{
      outcomeKey: "goal:done",
      title: "Primary Home model completed",
      result: "PASS",
      completedAt: "2026-08-03T11:00:00.000Z",
      evidenceState: "RECORDED",
      technicalDetailHref: "/runtime",
    }])
  })

  it.each(["STALE", "CONFLICTING"] as const)(
    "suppresses actor and clean health when timeline truth is %s",
    (truth) => {
      const model = projectPrimaryHomeModel(input({ currentTimeline: timeline({ truth }) }))

      expect(model.founderBriefing.actor).toBeNull()
      expect(model.founderBriefing.health).toMatchObject({ state: "UNKNOWN" })
      expect(model.technicalDetails.timelineTruth).toBe(truth)
    },
  )

  it("never invents a separate successor while a live active lease exists", () => {
    const model = projectPrimaryHomeModel(input({
      queue: queue([
        queueRecord(),
        queueRecord({
          id: 2,
          goalId: 2,
          goalRef: "GOAL-2",
          outcomeKey: "goal:GOAL-2",
          title: "A later queued outcome",
          lifecycleState: "approved",
          activeWorkOrderId: null,
          executionBinding: null,
          leaseHolder: null,
          leaseToken: null,
          leaseExpiresAt: null,
          acquisitionKey: null,
          queueOrder: 20,
        }),
      ]),
    }))

    expect(model.nextWithoutWilliam).toMatchObject({
      mode: "CONTINUE_ACTIVE",
      outcomeKey: "goal:GOAL-1",
    })
    expect(JSON.stringify(model.nextWithoutWilliam)).not.toContain("A later queued outcome")
  })

  it("does not attribute a worker from a timeline that is not the active queue row", () => {
    const model = projectPrimaryHomeModel(input({
      queue: queue([
        queueRecord(),
        queueRecord({
          id: 2,
          goalId: 2,
          goalRef: "GOAL-2",
          outcomeKey: "goal:GOAL-2",
          title: "Eligible next outcome",
          lifecycleState: "approved",
          activeWorkOrderId: 202,
          executionBinding: null,
          leaseHolder: null,
          leaseToken: null,
          leaseExpiresAt: null,
          acquisitionKey: null,
          queueOrder: 20,
        }),
      ]),
      currentTimeline: timeline({ goalId: 2, workOrderId: 202, worker: "Codex" }),
    }))

    expect(model.founderBriefing.actor).toBeNull()
  })

  it("does not infer a static project when evidence attribution is missing", () => {
    const model = projectPrimaryHomeModel(input({
      evidenceRecords: [evidence({ repo: null })],
    }))

    expect(model.founderBriefing.project).toBeNull()
    expect(model.projectHorizon).toEqual([])
    expect(JSON.stringify(model)).not.toContain("TerraFusion")
  })
})
