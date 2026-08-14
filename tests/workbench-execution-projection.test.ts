import { describe, expect, it } from "vitest"

import {
  projectWorkbenchExecution,
  type WorkbenchExecutionProjectionInput,
} from "@/lib/workbench/execution-projection"

const at = (value: string) => new Date(value)

function input(): WorkbenchExecutionProjectionInput {
  return {
    userId: "owner",
    projectId: 7,
    threadId: "thread-a",
    observedAt: at("2026-08-14T12:30:00.000Z"),
    staleAfterMs: 15 * 60 * 1000,
    bindings: [{ threadId: "thread-a", userId: "owner", sourceType: "outcome" as const, sourceId: "OUT-7", role: "root" as const }],
    goals: [{ id: 4, userId: "owner", linkedWorkOrderId: 12, updatedAt: at("2026-08-14T11:00:00Z") }],
    outcomes: [{
      id: 9, userId: "owner", outcomeKey: "OUT-7", goalId: 4, title: "Usable cockpit",
      lifecycleState: "active", activeWorkOrderId: 11,
      leaseHolder: "hermes", leaseExpiresAt: at("2026-08-14T12:20:00Z"), terminalEvidenceId: null,
      updatedAt: at("2026-08-14T12:10:00Z"),
    }],
    workOrders: [{
      id: 11, userId: "owner", ref: "WO-11", status: "active",
      assignee: "hermes", agent: "codex", updatedAt: at("2026-08-14T12:11:00Z"),
    }],
    claims: [{
      id: 51, userId: "owner", workOrderId: 11, agent: "codex",
      classification: "EVIDENCE_BACKED", createdAt: at("2026-08-14T12:12:00Z"),
    }],
    loops: [{
      id: 71, userId: "owner", workOrderId: 11, loopType: "verify", iteration: 2,
      status: "completed", createdAt: at("2026-08-14T12:13:00Z"),
    }],
    evidence: [{
      id: 61, userId: "owner", workOrderId: 11, result: "PASS",
      validators: ["vitest"], notes: "Focused suite passed", createdAt: at("2026-08-14T12:14:00Z"),
    }],
    governanceEvents: [
      {
        id: 81, userId: "owner", entityType: "work_order", entityId: "11", eventType: "HERMES_RUNTIME_CHECKPOINT",
        reason: "CI passed", metadata: {
          attempt: 1, checkpointSequence: 2, checkpointState: "CI_PASSED", checkpointDetail: "12 tests passed",
          idempotencyKey: "secret-key", token: "never", prNumber: 783,
        }, createdAt: at("2026-08-14T12:15:00Z"),
      },
      {
        id: 82, userId: "owner", entityType: "work_order", entityId: "11", eventType: "HERMES_RUNTIME_CHECKPOINT",
        reason: "Review requested changes", metadata: {
          attempt: 1, checkpointSequence: 3, checkpointState: "REVIEW_CHANGES_REQUESTED", checkpointDetail: "One finding",
        }, createdAt: at("2026-08-14T12:16:00Z"),
      },
      {
        id: 83, userId: "owner", entityType: "work_order", entityId: "11", eventType: "HERMES_RUNTIME_CHECKPOINT",
        reason: "Remediation", metadata: {
          attempt: 1, checkpointSequence: 4, checkpointState: "REVIEW_REMEDIATION_REQUIRED", checkpointDetail: "Repairing",
        }, createdAt: at("2026-08-14T12:17:00Z"),
      },
      {
        id: 84, userId: "owner", entityType: "work_order", entityId: "11", eventType: "HERMES_RUNTIME_CHECKPOINT",
        reason: "Merged", metadata: {
          attempt: 1, checkpointSequence: 5, checkpointState: "PR_MERGED", prNumber: 783, mergeSha: "b".repeat(40),
        }, createdAt: at("2026-08-14T12:18:00Z"),
      },
      {
        id: 85, userId: "owner", entityType: "goal", entityId: "4", eventType: "HERMES_OUTCOME_REVIEW_RECOVERED",
        reason: "Review recovered", metadata: {}, createdAt: at("2026-08-14T12:19:00Z"),
      },
    ],
    auditEvents: [{
      id: 91, userId: "owner", type: "runtime.checkpoint", summary: "CI passed mirror", register: "work-orders",
      refId: 11, metadata: { governanceEventId: 81, password: "never" }, createdAt: at("2026-08-14T12:15:00Z"),
    }],
    acquisitionAttempts: [{
      id: 101, userId: "owner", outcomeKey: "OUT-7", activeWorkOrderId: 11, processIdentity: "hermes-runtime",
      leaseHolder: "hermes", checkpointSequence: 5, checkpointState: "PR_MERGED", disposition: "ACQUIRED",
      reason: null, attemptedAt: at("2026-08-14T12:09:00Z"),
    }],
    truncatedKinds: [] as string[],
  }
}

describe("Workbench Execution projection", () => {
  it("projects explicit persisted execution facets with stable chronology and safe drilldowns", () => {
    const result = projectWorkbenchExecution(input())

    expect(result.availability).toBe("available")
    expect(result.truthState).toBe("persisted")
    expect(result.observedAt).toBe("2026-08-14T12:30:00.000Z")
    expect(result.latestPersistedAt).toBe("2026-08-14T12:19:00.000Z")
    expect(result.freshness.state).toBe("stale")
    expect(result.work.outcomes.map((row) => row.id)).toEqual(["OUT-7"])
    expect(result.work.workOrders.map((row) => row.id)).toEqual([11])
    expect(result.coverage.missing).toContain("work_order:12")
    expect(result.agents.some((row) => row.kind === "claim" && row.truthState === "persisted")).toBe(true)
    expect([...new Set(result.agents.map((row) => row.truthState))]).toEqual(["persisted"])
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0].checkpoints.map((row) => row.sequence)).toEqual([2, 3, 4, 5])
    expect(result.validations.map((row) => row.state)).toEqual(["VALIDATION_RECORDED", "CI_PASSED"])
    expect(result.reviews.map((row) => row.state)).toEqual(["REVIEW_CHANGES_REQUESTED"])
    expect(result.remediations.map((row) => row.state)).toEqual(["REVIEW_REMEDIATION_REQUIRED"])
    expect(result.deliveries.map((row) => row.state)).toEqual(["PR_MERGED"])
    expect(result.recoveries.map((row) => row.state)).toEqual(["HERMES_OUTCOME_REVIEW_RECOVERED"])
    expect(result.events.map((row) => row.id)).not.toContain("audit:91")
    expect(result.events.map((row) => row.id)).toContain("loop:71")
    expect(result.evidence[0].drilldown.href).toContain("evidence%3A61")
    expect(result.events.find((row) => row.id === "governance:81")?.drilldown.href).toContain("trace%3A81")
    expect(result.controls).toEqual({ terminal: false, steer: false, pause: false, stop: false })

    const serialized = JSON.stringify(result)
    for (const forbidden of ["secret-key", "never", "idempotencyKey", "token", "password"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("fails closed on tenant/root mismatches, reports conflicts, and never infers membership", () => {
    const mismatched = input()
    mismatched.bindings = [
      { threadId: "thread-a", userId: "other", sourceType: "outcome", sourceId: "OUT-7", role: "root" },
      { threadId: "thread-a", userId: "owner", sourceType: "goal", sourceId: "4", role: "member" },
    ]

    const result = projectWorkbenchExecution(mismatched)

    expect(result.availability).toBe("unavailable")
    expect(result.truthState).toBe("unknown")
    expect(result.work).toEqual({ outcomes: [], workOrders: [] })
    expect(result.coverage.conflicts).toContain("ROOT_BINDING_MISSING:thread-a")
    expect(JSON.stringify(result)).not.toContain("WO-11")
  })

  it("drops same-tenant records that have no persisted edge from the selected binding", () => {
    const value = input()
    value.outcomes.push({ ...value.outcomes[0], id: 99, outcomeKey: "OUT-UNLINKED", goalId: 99, activeWorkOrderId: 99 })
    value.workOrders.push({ ...value.workOrders[0], id: 99, ref: "WO-UNLINKED" })

    const result = projectWorkbenchExecution(value)

    expect(result.work.outcomes.map((row) => row.id)).toEqual(["OUT-7"])
    expect(result.work.workOrders.map((row) => row.id)).toEqual([11])
    expect(JSON.stringify(result)).not.toContain("UNLINKED")
  })

  it("orders ties by durable ids, rejects malformed and foreign events, and marks truncation", () => {
    const value = input()
    value.outcomes[0].leaseExpiresAt = at("2026-08-14T13:00:00Z")
    value.governanceEvents = [
      { ...value.governanceEvents[0], id: 202, createdAt: at("2026-08-14T12:20:00Z") },
      { ...value.governanceEvents[0], id: 201, createdAt: at("2026-08-14T12:20:00Z") },
      { ...value.governanceEvents[0], id: 203, userId: "other" },
      { ...value.governanceEvents[0], id: 204, metadata: { checkpointState: "CI_PASSED" } },
    ]
    value.auditEvents = []
    value.truncatedKinds = ["governance_event"]

    const result = projectWorkbenchExecution(value)

    expect(result.events.filter((row) => row.id.startsWith("governance:")).map((row) => row.id)).toEqual(["governance:201", "governance:202"])
    expect(result.attempts[0].checkpoints.map((row) => row.eventId)).toEqual([201, 202])
    expect(result.coverage.truncatedKinds).toEqual(["governance_event"])
    expect(result.coverage.truncated).toBe(true)
  })

  it("retains explicitly linked ambiguous outcomes and reports divergent audit mirrors", () => {
    const value = input()
    value.bindings = [{ threadId: "thread-a", userId: "owner", sourceType: "goal", sourceId: "4", role: "root" }]
    value.outcomes.push({ ...value.outcomes[0], id: 10, outcomeKey: "OUT-8", title: "Second explicit outcome" })
    value.auditEvents[0].metadata = { governanceEventId: 81, checkpointState: "CI_FAILED" }

    const result = projectWorkbenchExecution(value)

    expect(result.work.outcomes.map((row) => row.id).sort()).toEqual(["OUT-7", "OUT-8"])
    expect(result.coverage.conflicts).toEqual(expect.arrayContaining([
      "AMBIGUOUS_GOAL_OUTCOMES:4",
      "MIRROR_CONFLICT:governance:81",
    ]))
  })

  it("ages generic persisted evidence and handles future or invalid clocks truthfully", () => {
    const old = input()
    old.outcomes[0].leaseHolder = null
    old.outcomes[0].leaseExpiresAt = null
    old.governanceEvents = []
    old.auditEvents = []
    old.claims = []
    old.loops = []
    old.evidence = []
    old.acquisitionAttempts = []
    old.goals[0].updatedAt = at("2026-08-14T11:00:00Z")
    old.outcomes[0].updatedAt = at("2026-08-14T11:00:00Z")
    old.workOrders[0].updatedAt = at("2026-08-14T11:00:00Z")
    expect(projectWorkbenchExecution(old).freshness.state).toBe("stale")

    const recent = structuredClone(old)
    recent.workOrders[0].updatedAt = at("2026-08-14T12:25:00Z")
    expect(projectWorkbenchExecution(recent).freshness.state).toBe("fresh")

    const future = structuredClone(recent)
    future.workOrders[0].updatedAt = at("2026-08-14T12:31:00Z")
    expect(projectWorkbenchExecution(future).freshness.state).toBe("unknown")

    const invalid = structuredClone(recent)
    invalid.observedAt = new Date(Number.NaN)
    const invalidResult = projectWorkbenchExecution(invalid)
    expect(invalidResult.observedAt).toBeNull()
    expect(invalidResult.freshness.state).toBe("unknown")

    const expiredWins = structuredClone(future)
    expiredWins.outcomes[0].leaseHolder = "worker"
    expiredWins.outcomes[0].leaseExpiresAt = at("2026-08-14T12:20:00Z")
    expect(projectWorkbenchExecution(expiredWins).freshness.state).toBe("stale")
  })

  it("redacts and bounds every persisted free-text field returned to the client", () => {
    const value = input()
    const secrets = [
      "Authorization: Bearer bearer-secret",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.signature",
      "-----BEGIN PRIVATE KEY----- private-material -----END PRIVATE KEY-----",
      "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      "github_pat_abcdefghijklmnopqrstuvwxyz_1234567890",
      "AKIAIOSFODNN7EXAMPLE",
      "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
      "session=browser-secret",
      "postgresql://admin:password@db.example/private",
    ]
    const payload = secrets.join(" ") + " " + "x".repeat(2_000)
    value.outcomes[0].title = payload
    value.outcomes[0].lifecycleState = payload
    value.workOrders[0].ref = payload
    value.workOrders[0].status = payload
    value.workOrders[0].assignee = payload
    value.claims[0].agent = payload
    value.claims[0].classification = payload
    value.governanceEvents[0].metadata = { ...value.governanceEvents[0].metadata as object, checkpointDetail: { nested: payload }, detail: payload }
    value.evidence[0].notes = payload
    value.evidence[0].result = payload

    const result = projectWorkbenchExecution(value)
    expect(result.work.outcomes[0]).not.toHaveProperty("updatedAt")
    expect(result.work.workOrders[0]).not.toHaveProperty("title")
    expect(result.work.workOrders[0]).not.toHaveProperty("result")
    expect(result.work.workOrders[0]).not.toHaveProperty("updatedAt")
    const serialized = JSON.stringify(result)
    for (const secret of secrets) expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain("x".repeat(1_000))
  })

  it("rejects unlinked audit rows before mirror dedupe or conflict evaluation", () => {
    const value = input()
    value.bindings.push({ threadId: "thread-a", userId: "owner", sourceType: "goal", sourceId: "88", role: "member" })
    value.goals.push({ id: 99, userId: "owner", linkedWorkOrderId: null, updatedAt: at("2026-08-14T12:20:00Z") })
    value.governanceEvents.push({
      id: 86, userId: "owner", entityType: "goal", entityId: "88", eventType: "HERMES_OUTCOME_REVIEW_RECOVERED",
      reason: "forged unresolved goal", metadata: {}, createdAt: at("2026-08-14T12:20:00Z"),
    })
    value.auditEvents.push(
      { id: 92, userId: "owner", type: "forged", summary: "unlinked goal", register: "goals", refId: 99, metadata: {}, createdAt: at("2026-08-14T12:20:00Z") },
      { id: 93, userId: "owner", type: "runtime.checkpoint", summary: "forged mirror", register: "goals", refId: 88, metadata: { governanceEventId: 81, checkpointState: "CI_FAILED" }, createdAt: at("2026-08-14T12:20:00Z") },
    )

    const result = projectWorkbenchExecution(value)

    expect(result.events.map((row) => row.id)).not.toContain("audit:92")
    expect(result.events.map((row) => row.id)).not.toContain("governance:86")
    expect(result.coverage.conflicts).not.toContain("MIRROR_CONFLICT:governance:81")
    expect(result.events.map((row) => row.id)).toContain("governance:81")
  })
})
