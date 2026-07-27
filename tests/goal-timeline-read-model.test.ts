import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import {
  buildGoalTimelineReadModel,
  type GoalTimelineAuditRecord,
  type GoalTimelineDecisionRecord,
  type GoalTimelineEvidenceRecord,
  type GoalTimelineGoalRecord,
  type GoalTimelineReadModelInput,
  type GoalTimelineWorkOrderRecord,
} from "@/components/goal-console/goal-timeline-read-model"
import type { RuntimeExecutionGovernanceEventRecord } from "@/components/runtime/runtime-execution-model"

const owner = "owner"
const observedAt = new Date("2026-07-26T12:00:00.000Z")

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function goal(overrides: Partial<GoalTimelineGoalRecord> = {}): GoalTimelineGoalRecord {
  return {
    id: 7,
    userId: owner,
    ref: "GOAL-0007",
    command: "Ship the persisted operator timeline",
    lane: "product",
    mode: "implement",
    risk: "low",
    authority: "A2_WRITE_OWN",
    verdict: "allow",
    rationale: null,
    recommendedMove: null,
    requiresApproval: false,
    linkedWorkOrderId: null,
    status: "converted",
    createdAt: new Date("2026-07-26T10:00:00.000Z"),
    updatedAt: new Date("2026-07-26T10:01:00.000Z"),
    ...overrides,
  }
}

function workOrder(
  overrides: Partial<GoalTimelineWorkOrderRecord> = {},
): GoalTimelineWorkOrderRecord {
  return {
    id: 70,
    userId: owner,
    ref: "WO-HERMES-OUTCOME-7",
    title: "Deliver goal 7",
    description: null,
    goal: "GOAL-0007",
    lane: "runtime",
    phase: null,
    status: "active",
    result: null,
    commitRef: null,
    evidence: [],
    assignee: "codex-worker",
    validators: ["npm test"],
    stopConditions: [],
    linkedDecisionId: null,
    createdAt: new Date("2026-07-26T10:02:00.000Z"),
    updatedAt: new Date("2026-07-26T11:55:00.000Z"),
    closedAt: null,
    completedAt: null,
    ...overrides,
  }
}

function checkpoint(input: {
  id: number
  sequence: number
  state: string
  at: string
  detail?: string
  metadata?: Record<string, unknown>
  userId?: string
  workOrderId?: number
}): RuntimeExecutionGovernanceEventRecord {
  return {
    id: input.id,
    userId: input.userId ?? owner,
    eventType: "HERMES_RUNTIME_CHECKPOINT",
    entityType: "work_order",
    entityId: String(input.workOrderId ?? 70),
    actor: "hermes-worker-7",
    reason: input.state,
    metadata: {
      idempotencyKey: `goal-7:attempt:1:checkpoint:${input.sequence}`,
      attempt: 1,
      checkpointSequence: input.sequence,
      checkpointState: input.state,
      checkpointDetail: input.detail ?? null,
      ...input.metadata,
    },
    createdAt: new Date(input.at),
  }
}

function lease(input: {
  id: number
  status: string
  at: string
  expiresAt: string
}): RuntimeExecutionGovernanceEventRecord {
  return {
    id: input.id,
    userId: owner,
    eventType: "HERMES_RUNTIME_LEASE",
    entityType: "work_order",
    entityId: "70",
    actor: "hermes-worker-7",
    reason: input.status,
    metadata: {
      idempotencyKey: `goal-7:attempt:1:lease:${input.id}`,
      attempt: 1,
      checkpointSequence: 2,
      leaseStatus: input.status,
      leaseExpiresAt: input.expiresAt,
    },
    createdAt: new Date(input.at),
  }
}

function terminalGoalEvent(input: {
  id: number
  result: "OWNER_DECISION_REQUIRED" | "FAILED_TERMINAL"
  nextState: string
  at: string
  metadata?: Record<string, unknown>
}): RuntimeExecutionGovernanceEventRecord {
  return {
    id: input.id,
    userId: owner,
    eventType: "HERMES_OUTCOME_TERMINAL",
    entityType: "goal",
    entityId: "7",
    actor: "hermes-codex-bridge",
    reason: input.result,
    metadata: { result: input.result, nextState: input.nextState, ...input.metadata },
    createdAt: new Date(input.at),
  }
}

function recoveredGoalEvent(input: {
  id: number
  eventType:
    | "HERMES_OUTCOME_PROVIDER_RECOVERED"
    | "HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED"
    | "HERMES_OUTCOME_REVIEW_RECOVERED"
    | "HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED"
    | "HERMES_OWNER_AUTHORITY_DECISION"
  at: string
  metadata?: Record<string, unknown>
}): RuntimeExecutionGovernanceEventRecord {
  return {
    id: input.id,
    userId: owner,
    eventType: input.eventType,
    entityType: "goal",
    entityId: "7",
    actor: "hermes-codex-bridge",
    reason: "Governed recovery recorded",
    metadata: { outcomeId: 7, ...input.metadata },
    createdAt: new Date(input.at),
  }
}

function evidence(
  overrides: Partial<GoalTimelineEvidenceRecord> = {},
): GoalTimelineEvidenceRecord {
  return {
    id: 700,
    userId: owner,
    ref: "EV-0700",
    workOrderId: 70,
    result: "PASS",
    repo: "bsvalues/terragroq",
    branch: "codex/goal-7",
    head: "c".repeat(40),
    validators: ["vitest run tests/goal-timeline-read-model.test.ts"],
    knownFailures: [],
    outOfScopeChanges: [],
    deferredItems: [],
    nextValidMove: null,
    notes: "Focused validation passed.",
    contentHash: "d".repeat(64),
    artifactPath: "docs/reports/goal-7.md",
    createdAt: new Date("2026-07-26T11:57:00.000Z"),
    ...overrides,
  }
}

function decision(
  overrides: Partial<GoalTimelineDecisionRecord> = {},
): GoalTimelineDecisionRecord {
  return {
    id: 9,
    userId: owner,
    ref: "ADR-0009",
    title: "Authorize governed resume",
    decision: "Resume with the bounded production mutation.",
    rationale: null,
    consequences: null,
    status: "accepted",
    authority: "binding",
    scope: "WO-HERMES-OUTCOME-7",
    evidence: ["trace:502", "PRODUCTION_MUTATION_AUTHORIZED"],
    decidedAt: new Date("2026-07-26T11:59:00.000Z"),
    createdAt: new Date("2026-07-26T11:58:00.000Z"),
    updatedAt: new Date("2026-07-26T11:59:00.000Z"),
    ...overrides,
  }
}

function authorityPacket() {
  return {
    blockedAction: "Resume the exact blocked action.",
    authorityBoundary: "Primary authority is required.",
    minimumChoice: "APPROVE_OR_DENY",
    approveConsequence: "Resume only the blocked action.",
    denyConsequence: "Keep the Work Order blocked.",
  }
}

function ownerReceiptFixture(
  terminalEventId: number,
  nextState: string,
  choice: "APPROVE" | "DENY" = "APPROVE",
  packet = authorityPacket(),
) {
  const packetDigest = createHash("sha256").update(JSON.stringify(packet)).digest("hex")
  const requestKey = `hermes-owner-decision:7:70:${terminalEventId}:${owner}:${choice}:${nextState}`
  const decisionRef = `OWNER-DECISION-7-${terminalEventId}`
  const evidenceLabels = [
    "outcome:7",
    "work-order:70",
    `terminal-event:${terminalEventId}`,
    `next-state:${nextState}`,
    `request:${requestKey}`,
    `terminal-binding:hermes-owner-decision-terminal:7:70:${terminalEventId}`,
    `choice:${choice}`,
    `decision-packet:${packetDigest}`,
  ]
  const recordedAt = new Date("2026-07-26T11:59:00.000Z")
  const decisionRecord = decision({
    ref: decisionRef,
    decision: choice,
    status: choice === "APPROVE" ? "accepted" : "rejected",
    scope: `goal:7|work-order:70|terminal:${terminalEventId}|next-state:${nextState}`,
    evidence: evidenceLabels,
    decidedAt: recordedAt,
    updatedAt: recordedAt,
  })
  const payload = {
    outcomeId: 7,
    workOrderId: 70,
    terminalEventId,
    ownerUserId: owner,
    choice,
    expectedNextState: nextState,
    decisionId: 9,
    decisionRef,
    requestKey,
    decisionPacket: packet,
    decisionPacketDigest: packetDigest,
  }
  const notes = canonicalJson(payload)
  const evidenceRecord = evidence({
    id: 709,
    ref: `EV-OWNER-DECISION-7-${terminalEventId}`,
    result: choice === "APPROVE" ? "PASS" : "FAIL",
    notes,
    contentHash: createHash("sha256").update(notes).digest("hex"),
  })
  const receiptMetadata = {
    ...payload,
    status: choice === "APPROVE" ? "accepted" : "rejected",
    authority: "binding",
    evidenceId: evidenceRecord.id,
    recordedAt: recordedAt.toISOString(),
  }
  const receiptEvent: RuntimeExecutionGovernanceEventRecord = {
    id: terminalEventId + 1,
    userId: owner,
    eventType: "HERMES_OWNER_AUTHORITY_DECISION",
    entityType: "goal",
    entityId: "7",
    actor: owner,
    reason: `Recorded ${choice} owner authority decision`,
    evidenceId: evidenceRecord.id,
    metadata: receiptMetadata,
    createdAt: recordedAt,
  }
  const auditRecord = audit({
    id: 809,
    type: "owner.decision.recorded",
    register: "goals",
    refId: 7,
    metadata: receiptMetadata,
    createdAt: recordedAt,
  })
  return { packet, decisionRecord, evidenceRecord, receiptEvent, auditRecord }
}

function audit(overrides: Partial<GoalTimelineAuditRecord> = {}): GoalTimelineAuditRecord {
  return {
    id: 800,
    userId: owner,
    type: "goal.classified",
    summary: "Goal classified",
    register: "goals",
    refId: 7,
    metadata: null,
    createdAt: new Date("2026-07-26T10:00:01.000Z"),
    ...overrides,
  }
}

function input(overrides: Partial<GoalTimelineReadModelInput> = {}): GoalTimelineReadModelInput {
  return {
    userId: owner,
    goals: [goal()],
    workOrders: [workOrder()],
    governanceEvents: [],
    evidenceRecords: [],
    decisions: [],
    auditRecords: [],
    observedAt,
    ...overrides,
  }
}

describe("persisted Goal timeline read model", () => {
  it("projects phase, worker, lease, validation, delivery, and ledger references", () => {
    const revision = "a".repeat(40)
    const records = [
      checkpoint({
        id: 101,
        sequence: 0,
        state: "LEASED",
        at: "2026-07-26T11:50:00.000Z",
      }),
      checkpoint({
        id: 102,
        sequence: 1,
        state: "VALIDATION_PASSED",
        detail: "Focused and full validation passed.",
        at: "2026-07-26T11:54:00.000Z",
      }),
      checkpoint({
        id: 103,
        sequence: 2,
        state: "COMPLETE",
        at: "2026-07-26T11:56:00.000Z",
        metadata: { prNumber: 457, mergeSha: revision },
      }),
      lease({
        id: 104,
        status: "RELEASED",
        at: "2026-07-26T11:56:01.000Z",
        expiresAt: "2026-07-26T12:10:00.000Z",
      }),
    ]
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "closed",
        result: "PASS",
        commitRef: revision,
        completedAt: new Date("2026-07-26T11:56:00.000Z"),
      })],
      governanceEvents: records,
      evidenceRecords: [evidence()],
      auditRecords: [audit()],
    }))

    expect(timeline.id).toBe("goal:7")
    expect(timeline.truth.state).toBe("CURRENT")
    expect(timeline.current).toMatchObject({
      phase: "TERMINAL",
      workOrder: { id: 70, ref: "WO-HERMES-OUTCOME-7", result: "PASS" },
      runtime: {
        attempt: 1,
        worker: "hermes-worker-7",
        leaseStatus: "RELEASED",
        checkpointId: "trace:103",
        checkpointSequence: 2,
        checkpointState: "COMPLETE",
      },
    })
    expect(timeline.validationCheckpoints).toEqual([
      expect.objectContaining({ id: "trace:102", source: "RUNTIME", state: "VALIDATION_PASSED" }),
      expect.objectContaining({ id: "evidence:700", source: "EVIDENCE", result: "PASS" }),
    ])
    expect(timeline.delivery).toEqual({
      prNumber: 457,
      finalRevision: revision,
      status: "DELIVERED",
    })
    expect(timeline.references).toMatchObject({
      evidence: [{ id: "evidence:700", ref: "EV-0700", result: "PASS" }],
      audit: [{ id: "audit:800", type: "goal.classified" }],
    })
    expect(timeline.references.trace.map((entry) => entry.id)).toEqual([
      "trace:101",
      "trace:102",
      "trace:103",
      "trace:104",
    ])
    expect(timeline.terminal).toEqual({
      state: "COMPLETE",
      result: "PASS",
      limitations: [],
      ownerAction: null,
    })
  })

  it("uses stable persisted identities and ordering across reconnect input order", () => {
    const events = [
      checkpoint({
        id: 202,
        sequence: 1,
        state: "EXECUTING",
        at: "2026-07-26T11:51:00.000Z",
      }),
      checkpoint({
        id: 201,
        sequence: 0,
        state: "LEASED",
        at: "2026-07-26T11:50:00.000Z",
      }),
    ]
    const auditRecords = [
      audit({ id: 802, createdAt: new Date("2026-07-26T10:00:02.000Z") }),
      audit({ id: 801, createdAt: new Date("2026-07-26T10:00:02.000Z") }),
    ]
    const first = buildGoalTimelineReadModel(input({ governanceEvents: events, auditRecords }))[0]
    const second = buildGoalTimelineReadModel(input({
      governanceEvents: [...events].reverse(),
      auditRecords: [...auditRecords].reverse(),
    }))[0]

    expect(second.id).toBe(first.id)
    expect(second.entries.map((entry) => entry.id)).toEqual(first.entries.map((entry) => entry.id))
    expect(first.entries.map((entry) => entry.id)).toEqual([
      "goal:7",
      "audit:801",
      "audit:802",
      "work-order:70",
      "trace:201",
      "trace:202",
    ])
  })

  it("represents missing runtime truth without synthesizing progress", () => {
    const [timeline] = buildGoalTimelineReadModel(input({ workOrders: [] }))

    expect(timeline.truth.state).toBe("MISSING")
    expect(timeline.truth.issues).toContainEqual(expect.objectContaining({
      code: "RUNTIME_WORK_ORDER_MISSING",
      state: "MISSING",
    }))
    expect(timeline.current).toMatchObject({
      phase: "GOAL_RECORDED",
      workOrder: null,
      runtime: {
        attempt: null,
        leaseStatus: "UNKNOWN",
        checkpointState: null,
      },
    })
    expect(timeline.delivery.status).toBe("MISSING")
    expect(timeline.terminal.result).toBeNull()
  })

  it("does not infer terminal completion from a closed Work Order without a checkpoint", () => {
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "closed",
        result: "PASS",
        commitRef: "a".repeat(40),
      })],
    }))

    expect(timeline.truth.state).toBe("MISSING")
    expect(timeline.truth.issues).toContainEqual(expect.objectContaining({
      code: "RUNTIME_CHECKPOINT_MISSING",
    }))
    expect(timeline.terminal).toMatchObject({
      state: null,
      result: null,
    })
    expect(timeline.delivery).toMatchObject({
      finalRevision: "a".repeat(40),
      status: "IN_PROGRESS",
    })
  })

  it("surfaces a bounded runtime history as incomplete", () => {
    const [timeline] = buildGoalTimelineReadModel(input({
      truncatedRuntimeWorkOrderIds: [70],
      governanceEvents: [checkpoint({
        id: 250,
        sequence: 249,
        state: "EXECUTING",
        at: "2026-07-26T11:59:00.000Z",
      })],
    }))

    expect(timeline.truth.state).toBe("MISSING")
    expect(timeline.truth.issues).toContainEqual(expect.objectContaining({
      code: "RUNTIME_HISTORY_TRUNCATED",
    }))
  })

  it("marks expired active leases and old active checkpoints stale", () => {
    const [expired] = buildGoalTimelineReadModel(input({
      governanceEvents: [
        checkpoint({
          id: 301,
          sequence: 2,
          state: "EXECUTING",
          at: "2026-07-26T11:59:00.000Z",
        }),
        lease({
          id: 302,
          status: "ACTIVE",
          at: "2026-07-26T11:59:01.000Z",
          expiresAt: "2026-07-26T11:59:59.000Z",
        }),
      ],
    }))
    expect(expired.truth.state).toBe("STALE")
    expect(expired.truth.issues[0].code).toBe("ACTIVE_LEASE_EXPIRED")

    const [oldCheckpoint] = buildGoalTimelineReadModel(input({
      governanceEvents: [checkpoint({
        id: 303,
        sequence: 2,
        state: "EXECUTING",
        at: "2026-07-26T11:00:00.000Z",
      })],
    }))
    expect(oldCheckpoint.truth.state).toBe("STALE")
    expect(oldCheckpoint.truth.issues[0].code).toBe("RUNTIME_CHECKPOINT_STALE")
  })

  it("surfaces duplicate, terminal, evidence, and final-revision conflicts", () => {
    const runtimeRevision = "a".repeat(40)
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [
        workOrder({
          status: "closed",
          result: "PASS",
          commitRef: "b".repeat(40),
          updatedAt: new Date("2026-07-26T11:59:00.000Z"),
        }),
        workOrder({ id: 71, updatedAt: new Date("2026-07-26T11:58:00.000Z") }),
      ],
      governanceEvents: [checkpoint({
        id: 401,
        sequence: 4,
        state: "FAILED_TERMINAL",
        at: "2026-07-26T11:59:30.000Z",
        metadata: { mergeSha: runtimeRevision },
      })],
      evidenceRecords: [evidence({
        ref: "EV-HERMES-7-1-4",
        result: "PARTIAL",
      })],
    }))

    expect(timeline.truth.state).toBe("CONFLICTING")
    expect(timeline.truth.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "DUPLICATE_RUNTIME_WORK_ORDER",
      "TERMINAL_RESULT_CONFLICT",
      "EVIDENCE_RESULT_CONFLICT",
      "FINAL_REVISION_CONFLICT",
    ]))
    expect(timeline.delivery.status).toBe("CONFLICTING")
  })

  it("rejects a COMPLETE checkpoint paired with a non-PASS result", () => {
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({ status: "closed", result: "FAIL" })],
      governanceEvents: [checkpoint({
        id: 450,
        sequence: 5,
        state: "COMPLETE",
        at: "2026-07-26T11:59:00.000Z",
      })],
    }))

    expect(timeline.truth.state).toBe("CONFLICTING")
    expect(timeline.truth.issues).toContainEqual(expect.objectContaining({
      code: "COMPLETION_RESULT_CONFLICT",
    }))
    expect(timeline.delivery.status).toBe("CONFLICTING")
  })

  it("requires a persisted result before COMPLETE can become delivered", () => {
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({ status: "closed", result: null })],
      governanceEvents: [checkpoint({
        id: 455,
        sequence: 5,
        state: "COMPLETE",
        at: "2026-07-26T11:59:00.000Z",
        metadata: { mergeSha: "e".repeat(40) },
      })],
    }))

    expect(timeline.truth.state).toBe("MISSING")
    expect(timeline.truth.issues).toContainEqual(expect.objectContaining({
      code: "COMPLETION_RESULT_MISSING",
    }))
    expect(timeline.delivery.status).toBe("MISSING")
  })

  it("uses each terminal event's recorded result and a Work Order revision consistently", () => {
    const revision = "f".repeat(40)
    const receipt = ownerReceiptFixture(460, "OWNER_AUTHORITY_REQUIRED")
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "closed",
        result: "PASS",
        commitRef: revision,
        linkedDecisionId: 9,
      })],
      governanceEvents: [
        terminalGoalEvent({
          id: 460,
          result: "OWNER_DECISION_REQUIRED",
          nextState: "OWNER_AUTHORITY_REQUIRED",
          at: "2026-07-26T11:50:00.000Z",
          metadata: receipt.packet,
        }),
        receipt.receiptEvent,
        checkpoint({
          id: 462,
          sequence: 6,
          state: "COMPLETE",
          at: "2026-07-26T12:00:00.000Z",
          metadata: { mergeSha: revision },
        }),
      ],
      decisions: [decision({
        ...receipt.decisionRecord,
      })],
      evidenceRecords: [receipt.evidenceRecord],
      auditRecords: [receipt.auditRecord],
    }))

    expect(timeline.entries.find((entry) => entry.id === "trace:460")?.state)
      .toBe("OWNER_DECISION_REQUIRED")
    expect(timeline.delivery).toEqual({
      prNumber: null,
      finalRevision: revision,
      status: "DELIVERED",
    })
  })

  it("clears an older terminal Goal event when a newer persisted checkpoint resumes execution", () => {
    const receipt = ownerReceiptFixture(480, "OWNER_AUTHORITY_REQUIRED")
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({ status: "active", result: null, linkedDecisionId: 9 })],
      governanceEvents: [
        terminalGoalEvent({
          id: 480,
          result: "OWNER_DECISION_REQUIRED",
          nextState: "OWNER_AUTHORITY_REQUIRED",
          at: "2026-07-26T11:50:00.000Z",
          metadata: receipt.packet,
        }),
        receipt.receiptEvent,
        checkpoint({
          id: 482,
          sequence: 4,
          state: "EXECUTING",
          at: "2026-07-26T12:00:00.000Z",
        }),
      ],
      decisions: [decision({
        ...receipt.decisionRecord,
      })],
      evidenceRecords: [receipt.evidenceRecord],
      auditRecords: [receipt.auditRecord],
    }))

    expect(timeline.current.runtime.checkpointState).toBe("EXECUTING")
    expect(timeline.terminal).toMatchObject({
      state: null,
      result: null,
      ownerAction: null,
    })
    expect(timeline.resume.state).toBe("NOT_REQUIRED")
  })

  it("does not clear an owner wall from a later checkpoint without a governed decision", () => {
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({ status: "active", result: null })],
      governanceEvents: [
        terminalGoalEvent({
          id: 482,
          result: "OWNER_DECISION_REQUIRED",
          nextState: "OWNER_AUTHORITY_REQUIRED",
          at: "2026-07-26T11:50:00.000Z",
        }),
        checkpoint({
          id: 483,
          sequence: 4,
          state: "EXECUTING",
          at: "2026-07-26T11:55:00.000Z",
        }),
      ],
    }))

    expect(timeline.terminal.state).toBe("OWNER_DECISION_REQUIRED")
    expect(timeline.resume.state).toBe("MISSING_DECISION_RECORD")
  })

  it("clears a failed terminal only after a persisted governed recovery event", () => {
    const terminalEvent = terminalGoalEvent({
      id: 484,
      result: "FAILED_TERMINAL",
      nextState: "VALIDATION_INFRASTRUCTURE_WALL",
      at: "2026-07-26T11:50:00.000Z",
    })
    const resumedCheckpoint = checkpoint({
      id: 486,
      sequence: 4,
      state: "EXECUTING",
      at: "2026-07-26T11:55:00.000Z",
    })
    const [unproven] = buildGoalTimelineReadModel(input({
      governanceEvents: [terminalEvent, resumedCheckpoint],
    }))
    expect(unproven.terminal.state).toBe("FAILED_TERMINAL")

    const [proven] = buildGoalTimelineReadModel(input({
      governanceEvents: [
        terminalEvent,
        recoveredGoalEvent({
          id: 485,
          eventType: "HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED",
          at: "2026-07-26T11:52:00.000Z",
          metadata: {
            priorResult: "FAILED_TERMINAL",
            retryState: "VALIDATION_INFRASTRUCTURE_WALL",
            proofDigest: "a".repeat(64),
          },
        }),
        resumedCheckpoint,
      ],
    }))
    expect(proven.terminal.state).toBeNull()
    expect(proven.references.trace).toContainEqual({
      id: "trace:485",
      eventType: "HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED",
      eventId: 485,
    })
  })

  it("retains validation recovery proof as trace without treating proof alone as recovery", () => {
    const terminalEvent = terminalGoalEvent({
      id: 490,
      result: "FAILED_TERMINAL",
      nextState: "VALIDATION_INFRASTRUCTURE_WALL",
      at: "2026-07-26T11:50:00.000Z",
    })
    const proofEvent = recoveredGoalEvent({
      id: 491,
      eventType: "HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED",
      at: "2026-07-26T11:52:00.000Z",
      metadata: { proofDigest: "a".repeat(64) },
    })
    const [timeline] = buildGoalTimelineReadModel(input({
      governanceEvents: [
        terminalEvent,
        proofEvent,
        checkpoint({
          id: 492,
          sequence: 4,
          state: "EXECUTING",
          at: "2026-07-26T11:55:00.000Z",
        }),
      ],
    }))

    expect(timeline.terminal.state).toBe("FAILED_TERMINAL")
    expect(timeline.references.trace).toContainEqual({
      id: "trace:491",
      eventType: "HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED",
      eventId: 491,
    })
    expect(timeline.entries).toContainEqual(expect.objectContaining({
      id: "trace:491",
      label: "Hermes recovery proof confirmed",
    }))
  })

  it("rejects recovery evidence that does not bind to the terminal state", () => {
    const [timeline] = buildGoalTimelineReadModel(input({
      governanceEvents: [
        terminalGoalEvent({
          id: 487,
          result: "FAILED_TERMINAL",
          nextState: "VALIDATION_INFRASTRUCTURE_WALL",
          at: "2026-07-26T11:50:00.000Z",
        }),
        recoveredGoalEvent({
          id: 488,
          eventType: "HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED",
          at: "2026-07-26T11:52:00.000Z",
          metadata: {
            priorResult: "FAILED_TERMINAL",
            retryState: "UNRELATED_RETRY_STATE",
            proofDigest: "a".repeat(64),
          },
        }),
        checkpoint({
          id: 489,
          sequence: 4,
          state: "EXECUTING",
          at: "2026-07-26T11:55:00.000Z",
        }),
      ],
    }))

    expect(timeline.terminal.state).toBe("FAILED_TERMINAL")
    expect(timeline.truth.state).toBe("CONFLICTING")
    expect(timeline.truth.issues).toContainEqual(expect.objectContaining({
      code: "RECOVERY_EVIDENCE_CONFLICT",
    }))
  })

  it("accepts review recovery using the writer's exact persisted contract", () => {
    const [timeline] = buildGoalTimelineReadModel(input({
      governanceEvents: [
        terminalGoalEvent({
          id: 494,
          result: "FAILED_TERMINAL",
          nextState: "REVIEW_REMEDIATION_EXHAUSTED",
          at: "2026-07-26T11:50:00.000Z",
        }),
        recoveredGoalEvent({
          id: 495,
          eventType: "HERMES_OUTCOME_REVIEW_RECOVERED",
          at: "2026-07-26T11:52:00.000Z",
          metadata: {
            idempotencyKey: "goal-7:review-recovery",
            workOrderRef: "WO-HERMES-OUTCOME-7",
            prNumber: 457,
            reviewedHeadSha: "a".repeat(40),
            mergeSha: "b".repeat(40),
          },
        }),
        checkpoint({
          id: 496,
          sequence: 4,
          state: "EXECUTING",
          at: "2026-07-26T11:55:00.000Z",
        }),
      ],
    }))

    expect(timeline.terminal.state).toBeNull()
    expect(timeline.truth.issues.map((issue) => issue.code))
      .not.toContain("RECOVERY_EVIDENCE_CONFLICT")
  })

  it("does not carry delivery artifacts from a failed attempt into its recovery attempt", () => {
    const previousRevision = "8".repeat(40)
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({ commitRef: previousRevision })],
      governanceEvents: [
        {
          ...checkpoint({
            id: 492,
            sequence: 2,
            state: "FAILED_TERMINAL",
            at: "2026-07-26T11:40:00.000Z",
            metadata: { prNumber: 457, mergeSha: previousRevision },
          }),
          metadata: {
            idempotencyKey: "goal-7:attempt:1:checkpoint:2",
            attempt: 1,
            checkpointSequence: 2,
            checkpointState: "FAILED_TERMINAL",
            prNumber: 457,
            mergeSha: previousRevision,
          },
        },
        {
          ...checkpoint({
            id: 493,
            sequence: 1,
            state: "EXECUTING",
            at: "2026-07-26T11:59:00.000Z",
          }),
          metadata: {
            idempotencyKey: "goal-7:attempt:2:checkpoint:1",
            attempt: 2,
            checkpointSequence: 1,
            checkpointState: "EXECUTING",
          },
        },
      ],
    }))

    expect(timeline.current.runtime.attempt).toBe(2)
    expect(timeline.delivery).toEqual({
      prNumber: null,
      finalRevision: null,
      status: "MISSING",
    })
  })

  it("does not treat a prior attempt revision as delivery for an artifact-free COMPLETE recovery", () => {
    const previousRevision = "7".repeat(40)
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({ status: "closed", result: "PASS", commitRef: previousRevision })],
      governanceEvents: [
        {
          ...checkpoint({
            id: 497,
            sequence: 2,
            state: "FAILED_TERMINAL",
            at: "2026-07-26T11:40:00.000Z",
            metadata: { mergeSha: previousRevision },
          }),
          metadata: {
            idempotencyKey: "goal-7:attempt:1:checkpoint:2",
            attempt: 1,
            checkpointSequence: 2,
            checkpointState: "FAILED_TERMINAL",
            mergeSha: previousRevision,
          },
        },
        {
          ...checkpoint({
            id: 498,
            sequence: 5,
            state: "COMPLETE",
            at: "2026-07-26T11:59:00.000Z",
          }),
          metadata: {
            idempotencyKey: "goal-7:attempt:2:checkpoint:5",
            attempt: 2,
            checkpointSequence: 5,
            checkpointState: "COMPLETE",
          },
        },
      ],
    }))

    expect(timeline.current.runtime.attempt).toBe(2)
    expect(timeline.delivery).toEqual({
      prNumber: null,
      finalRevision: null,
      status: "MISSING",
    })
    expect(timeline.truth.state).toBe("MISSING")
    expect(timeline.truth.issues).toContainEqual(expect.objectContaining({
      code: "DELIVERY_ARTIFACT_MISSING",
    }))
  })

  it("retains failed-attempt evidence as history without conflicting with a recovered PASS", () => {
    const revision = "9".repeat(40)
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "closed",
        result: "PASS",
        commitRef: revision,
      })],
      governanceEvents: [
        {
          ...checkpoint({
            id: 490,
            sequence: 2,
            state: "FAILED_TERMINAL",
            at: "2026-07-26T11:40:00.000Z",
          }),
          metadata: {
            idempotencyKey: "goal-7:attempt:1:checkpoint:2",
            attempt: 1,
            checkpointSequence: 2,
            checkpointState: "FAILED_TERMINAL",
          },
        },
        {
          ...checkpoint({
            id: 491,
            sequence: 5,
            state: "COMPLETE",
            at: "2026-07-26T11:59:00.000Z",
            metadata: { mergeSha: revision },
          }),
          metadata: {
            idempotencyKey: "goal-7:attempt:2:checkpoint:5",
            attempt: 2,
            checkpointSequence: 5,
            checkpointState: "COMPLETE",
            mergeSha: revision,
          },
        },
      ],
      evidenceRecords: [
        evidence({ id: 701, ref: "EV-HERMES-7-1-2", result: "FAIL" }),
        evidence({ id: 702, ref: "EV-HERMES-7-2-5", result: "PASS" }),
      ],
    }))

    expect(timeline.truth.state).toBe("CURRENT")
    expect(timeline.truth.issues.map((issue) => issue.code)).not.toContain("EVIDENCE_RESULT_CONFLICT")
    expect(timeline.references.evidence.map((record) => record.result)).toEqual(["FAIL", "PASS"])
    expect(timeline.delivery.status).toBe("DELIVERED")
  })

  it("marks every bounded related history source as incomplete", () => {
    const [timeline] = buildGoalTimelineReadModel(input({
      truncatedEvidenceWorkOrderIds: [70],
      truncatedAuditGoalIds: [7],
      truncatedGoalTerminalIds: [7],
      governanceEvents: [checkpoint({
        id: 470,
        sequence: 1,
        state: "EXECUTING",
        at: "2026-07-26T11:59:00.000Z",
      })],
    }))

    expect(timeline.truth.state).toBe("MISSING")
    expect(timeline.truth.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "EVIDENCE_HISTORY_TRUNCATED",
      "AUDIT_HISTORY_TRUNCATED",
      "GOAL_TERMINAL_HISTORY_TRUNCATED",
    ]))
  })

  it("marks runtime Work Order cardinality truncation as conflicting", () => {
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder(), workOrder({ id: 71 })],
      truncatedRuntimeGoalIds: [7],
    }))

    expect(timeline.truth.state).toBe("CONFLICTING")
    expect(timeline.truth.issues).toContainEqual(expect.objectContaining({
      code: "RUNTIME_WORK_ORDER_CARDINALITY_TRUNCATED",
    }))
  })

  it("projects OWNER_DECISION_REQUIRED and only resumes from an accepted binding link", () => {
    const receipt = ownerReceiptFixture(502, "PRODUCTION_MUTATION_AUTHORIZED")
    const ownerWall = checkpoint({
      id: 501,
      sequence: 3,
      state: "OWNER_DECISION_REQUIRED",
      detail: "Approve production data mutation.",
      at: "2026-07-26T11:58:00.000Z",
    })
    const persistedTerminal = terminalGoalEvent({
      id: 502,
      result: "OWNER_DECISION_REQUIRED",
      nextState: "PRODUCTION_MUTATION_AUTHORIZED",
      at: "2026-07-26T11:58:01.000Z",
      metadata: receipt.packet,
    })
    const [missing] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({ status: "blocked", result: "OWNER_DECISION_REQUIRED" })],
      governanceEvents: [ownerWall, persistedTerminal],
    }))
    expect(missing.resume).toEqual({
      state: "MISSING_DECISION_RECORD",
      decisionId: null,
      decisionRef: null,
      governedNextState: "PRODUCTION_MUTATION_AUTHORIZED",
    })
    expect(missing.terminal.ownerAction).toBe("Approve production data mutation.")

    const [pending] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "blocked",
        result: "OWNER_DECISION_REQUIRED",
        linkedDecisionId: 9,
      })],
      governanceEvents: [ownerWall, persistedTerminal],
      decisions: [decision({ status: "proposed", authority: "advisory" })],
    }))
    expect(pending.resume.state).toBe("AWAITING_OWNER_DECISION")

    const [authorized] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "blocked",
        result: "OWNER_DECISION_REQUIRED",
        linkedDecisionId: 9,
      })],
      governanceEvents: [ownerWall, persistedTerminal, receipt.receiptEvent],
      decisions: [receipt.decisionRecord],
      evidenceRecords: [receipt.evidenceRecord],
      auditRecords: [receipt.auditRecord],
    }))
    expect(authorized.resume).toEqual({
      state: "AUTHORIZED_TO_RESUME",
      decisionId: 9,
      decisionRef: "OWNER-DECISION-7-502",
      governedNextState: "PRODUCTION_MUTATION_AUTHORIZED",
    })
    expect(authorized.references.decisions).toEqual([
      expect.objectContaining({ id: "decision:9", status: "accepted", authority: "binding" }),
    ])
    expect(authorized.references.trace).toContainEqual({
      id: "trace:502",
      eventType: "HERMES_OUTCOME_TERMINAL",
      eventId: 502,
    })
  })

  it("does not authorize resume from a stale or unrelated binding decision", () => {
    const persistedTerminal = terminalGoalEvent({
      id: 503,
      result: "OWNER_DECISION_REQUIRED",
      nextState: "PRODUCTION_MUTATION_AUTHORIZED",
      at: "2026-07-26T11:58:01.000Z",
    })
    const [stale] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "blocked",
        result: "OWNER_DECISION_REQUIRED",
        linkedDecisionId: 9,
      })],
      governanceEvents: [persistedTerminal],
      decisions: [decision({
        scope: "WO-UNRELATED",
        decidedAt: new Date("2026-07-26T11:57:00.000Z"),
      })],
    }))

    expect(stale.terminal.state).toBe("OWNER_DECISION_REQUIRED")
    expect(stale.resume.state).toBe("AWAITING_OWNER_DECISION")

    const [unbound] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "active",
        result: null,
        linkedDecisionId: 9,
      })],
      governanceEvents: [
        persistedTerminal,
        checkpoint({
          id: 504,
          sequence: 4,
          state: "EXECUTING",
          at: "2026-07-26T11:59:00.000Z",
        }),
      ],
      decisions: [decision({
        evidence: ["PRODUCTION_MUTATION_AUTHORIZED"],
        decidedAt: new Date("2026-07-26T11:58:30.000Z"),
      })],
    }))

    expect(unbound.terminal.state).toBe("OWNER_DECISION_REQUIRED")
    expect(unbound.resume.state).toBe("AWAITING_OWNER_DECISION")
  })

  it("projects a fully bound decision request and truthful receipt state", () => {
    const packet = {
      blockedAction: "Resume validation after the recorded provider wall.",
      authorityBoundary: "Owner authority is required to resume this Work Order.",
      minimumChoice: "APPROVE_OR_DENY",
      approveConsequence: "Resume the Work Order in RESUME_VALIDATION.",
      denyConsequence: "Keep the Work Order blocked and record the denial.",
    }
    const denialReceipt = ownerReceiptFixture(505, "RESUME_VALIDATION", "DENY", packet)
    const terminal = terminalGoalEvent({
      id: 505,
      result: "OWNER_DECISION_REQUIRED",
      nextState: "RESUME_VALIDATION",
      at: "2026-07-26T11:58:01.000Z",
      metadata: packet,
    })
    const [actionable] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({ status: "blocked", result: "OWNER_DECISION_REQUIRED" })],
      governanceEvents: [terminal],
    }))

    expect(actionable.decisionRequest).toEqual(expect.objectContaining({
      status: "ACTIONABLE",
      blockedAction: "Resume validation after the recorded provider wall.",
      authorityBoundary: "Owner authority is required to resume this Work Order.",
      choices: ["APPROVE", "DENY"],
      goalId: 7,
      outcomeId: 7,
      workOrderId: 70,
      terminalEventId: 505,
      expectedNextState: "RESUME_VALIDATION",
      ownerUserId: owner,
      receipt: expect.objectContaining({ status: "NOT_RECORDED" }),
      resume: expect.objectContaining({ state: "MISSING_DECISION_RECORD" }),
    }))

    const [recorded] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "blocked",
        result: "OWNER_DECISION_REQUIRED",
        linkedDecisionId: 9,
      })],
      governanceEvents: [terminal, denialReceipt.receiptEvent],
      decisions: [denialReceipt.decisionRecord],
      evidenceRecords: [denialReceipt.evidenceRecord],
      auditRecords: [denialReceipt.auditRecord],
    }))

    expect(recorded.decisionRequest).toEqual(expect.objectContaining({
      status: "RECEIPT_RECORDED",
      receipt: expect.objectContaining({ status: "RECORDED", choice: "DENY", decisionId: 9 }),
      resume: expect.objectContaining({ state: "DECISION_REJECTED" }),
    }))
  })

  it("treats a fully proven prior decision as historical at a successor authority wall", () => {
    const priorReceipt = ownerReceiptFixture(505, "RESUME_VALIDATION")
    const priorTerminal = terminalGoalEvent({
      id: 505,
      result: "OWNER_DECISION_REQUIRED",
      nextState: "RESUME_VALIDATION",
      at: "2026-07-26T11:58:01.000Z",
      metadata: priorReceipt.packet,
    })
    const successorPacket = {
      ...authorityPacket(),
      blockedAction: "Resume the successor validation step.",
      approveConsequence: "Resume only the successor validation step.",
    }
    const successorTerminal = terminalGoalEvent({
      id: 507,
      result: "OWNER_DECISION_REQUIRED",
      nextState: "RESUME_SUCCESSOR_VALIDATION",
      at: "2026-07-26T12:01:00.000Z",
      metadata: successorPacket,
    })
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "blocked",
        result: "OWNER_DECISION_REQUIRED",
        linkedDecisionId: 9,
      })],
      governanceEvents: [
        priorTerminal,
        priorReceipt.receiptEvent,
        successorTerminal,
      ],
      decisions: [priorReceipt.decisionRecord],
      evidenceRecords: [priorReceipt.evidenceRecord],
      auditRecords: [priorReceipt.auditRecord],
    }))

    expect(timeline.decisionRequest).toEqual(expect.objectContaining({
      status: "ACTIONABLE",
      blockedAction: "Resume the successor validation step.",
      expectedNextState: "RESUME_SUCCESSOR_VALIDATION",
      receipt: expect.objectContaining({
        status: "NOT_RECORDED",
        decisionId: null,
      }),
    }))
    expect(timeline.resume).toEqual({
      state: "AWAITING_OWNER_DECISION",
      decisionId: null,
      decisionRef: null,
      governedNextState: "RESUME_SUCCESSOR_VALIDATION",
    })
  })

  it("keeps an invalid prior decision conflicting at a successor authority wall", () => {
    const priorReceipt = ownerReceiptFixture(505, "RESUME_VALIDATION")
    const priorTerminal = terminalGoalEvent({
      id: 505,
      result: "OWNER_DECISION_REQUIRED",
      nextState: "RESUME_VALIDATION",
      at: "2026-07-26T11:58:01.000Z",
      metadata: priorReceipt.packet,
    })
    const successorTerminal = terminalGoalEvent({
      id: 507,
      result: "OWNER_DECISION_REQUIRED",
      nextState: "RESUME_SUCCESSOR_VALIDATION",
      at: "2026-07-26T12:01:00.000Z",
      metadata: authorityPacket(),
    })
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "blocked",
        result: "OWNER_DECISION_REQUIRED",
        linkedDecisionId: 9,
      })],
      governanceEvents: [
        priorTerminal,
        priorReceipt.receiptEvent,
        successorTerminal,
      ],
      decisions: [priorReceipt.decisionRecord],
      evidenceRecords: [{
        ...priorReceipt.evidenceRecord,
        contentHash: "0".repeat(64),
      }],
      auditRecords: [priorReceipt.auditRecord],
    }))

    expect(timeline.decisionRequest.status).toBe("CONFLICTING")
    expect(timeline.resume.state).toBe("AWAITING_OWNER_DECISION")
  })

  it("does not synthesize an actionable request from incomplete terminal evidence", () => {
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({ status: "blocked", result: "OWNER_DECISION_REQUIRED" })],
      governanceEvents: [terminalGoalEvent({
        id: 509,
        result: "OWNER_DECISION_REQUIRED",
        nextState: "RESUME_VALIDATION",
        at: "2026-07-26T11:58:01.000Z",
        metadata: {
          blockedAction: "Resume validation.",
          authorityBoundary: "Primary authority is required.",
          approveConsequence: "Resume validation.",
          denyConsequence: "Keep validation blocked.",
        },
      })],
    }))

    expect(timeline.decisionRequest).toMatchObject({
      status: "CONFLICTING",
      blockedAction: "Resume validation.",
      authorityBoundary: "Primary authority is required.",
    })
  })

  it("rejects a decision request whose next state is not canonical", () => {
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({ status: "blocked", result: "OWNER_DECISION_REQUIRED" })],
      governanceEvents: [terminalGoalEvent({
        id: 510,
        result: "OWNER_DECISION_REQUIRED",
        nextState: "resume validation",
        at: "2026-07-26T11:58:01.000Z",
        metadata: authorityPacket(),
      })],
    }))

    expect(timeline.decisionRequest.status).toBe("CONFLICTING")
    expect(timeline.resume.state).not.toBe("AUTHORIZED_TO_RESUME")
  })

  it("recognizes the runtime owner-decision receipt binding for approved resume", () => {
    const receipt = ownerReceiptFixture(506, "RESUME_VALIDATION")
    const terminal = terminalGoalEvent({
      id: 506,
      result: "OWNER_DECISION_REQUIRED",
      nextState: "RESUME_VALIDATION",
      at: "2026-07-26T11:58:01.000Z",
      metadata: receipt.packet,
    })
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "blocked",
        result: "OWNER_DECISION_REQUIRED",
        linkedDecisionId: 9,
      })],
      governanceEvents: [terminal, receipt.receiptEvent],
      decisions: [receipt.decisionRecord],
      evidenceRecords: [receipt.evidenceRecord],
      auditRecords: [receipt.auditRecord],
    }))

    expect(timeline.resume.state).toBe("AUTHORIZED_TO_RESUME")
    expect(timeline.decisionRequest.receipt.choice).toBe("APPROVE")

    expect(timeline.entries).toContainEqual(expect.objectContaining({
      id: "trace:507",
      label: "Primary authority decision",
    }))
  })

  it("matches canonical decision evidence regardless of persisted key insertion order", () => {
    const receipt = ownerReceiptFixture(511, "RESUME_VALIDATION")
    const reorderedNotes = JSON.stringify(Object.fromEntries(
      Object.entries(JSON.parse(receipt.evidenceRecord.notes ?? "{}")).reverse(),
    ))
    const terminal = terminalGoalEvent({
      id: 511,
      result: "OWNER_DECISION_REQUIRED",
      nextState: "RESUME_VALIDATION",
      at: "2026-07-26T11:58:01.000Z",
      metadata: receipt.packet,
    })
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "blocked",
        result: "OWNER_DECISION_REQUIRED",
        linkedDecisionId: 9,
      })],
      governanceEvents: [terminal, receipt.receiptEvent],
      decisions: [receipt.decisionRecord],
      evidenceRecords: [{
        ...receipt.evidenceRecord,
        notes: reorderedNotes,
        contentHash: createHash("sha256").update(reorderedNotes).digest("hex"),
      }],
      auditRecords: [receipt.auditRecord],
    }))

    expect(timeline.resume.state).toBe("AUTHORIZED_TO_RESUME")
    expect(timeline.decisionRequest.receipt.status).toBe("RECORDED")
  })

  it("fails closed when decision status and recorded choice conflict", () => {
    const terminal = terminalGoalEvent({
      id: 508,
      result: "OWNER_DECISION_REQUIRED",
      nextState: "RESUME_VALIDATION",
      at: "2026-07-26T11:58:01.000Z",
    })
    const [timeline] = buildGoalTimelineReadModel(input({
      workOrders: [workOrder({
        status: "blocked",
        result: "OWNER_DECISION_REQUIRED",
        linkedDecisionId: 9,
      })],
      governanceEvents: [terminal],
      decisions: [decision({
        status: "accepted",
        decision: "DENY",
        scope: "goal:7|work-order:70|terminal:508|next-state:RESUME_VALIDATION",
        evidence: [
          "outcome:7",
          "work-order:70",
          "terminal-event:508",
          "next-state:RESUME_VALIDATION",
          "choice:DENY",
        ],
      })],
    }))

    expect(timeline.resume.state).toBe("AWAITING_OWNER_DECISION")
    expect(timeline.decisionRequest.receipt).toMatchObject({
      status: "CONFLICTING",
      choice: null,
    })
  })

  it("keeps every source current-user scoped", () => {
    const foreign = "foreign"
    const timelines = buildGoalTimelineReadModel(input({
      goals: [goal(), goal({ id: 8, userId: foreign })],
      workOrders: [workOrder(), workOrder({ id: 80, userId: foreign, ref: "WO-HERMES-OUTCOME-8" })],
      governanceEvents: [checkpoint({
        id: 601,
        sequence: 0,
        state: "LEASED",
        at: "2026-07-26T11:50:00.000Z",
        userId: foreign,
      })],
      evidenceRecords: [evidence({ id: 701, userId: foreign })],
      decisions: [decision({ userId: foreign })],
      auditRecords: [audit({ id: 801, userId: foreign })],
    }))

    expect(timelines).toHaveLength(1)
    expect(timelines[0].goal.id).toBe(7)
    expect(timelines[0].references).toEqual({
      evidence: [],
      trace: [],
      audit: [],
      decisions: [],
    })
  })
})
