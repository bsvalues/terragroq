import { describe, expect, it } from "vitest"

import {
  projectWorkbenchThreads,
  type ThreadProjectionInput,
} from "@/lib/workbench/thread-projection"

const at = (iso: string) => new Date(iso)

function baseInput(): ThreadProjectionInput {
  return {
    userId: "owner-1",
    projectId: 7,
    conversationPersistence: "MISSING",
    truncatedSourceKinds: [],
    threads: [{
      id: "thread-alpha",
      userId: "owner-1",
      projectId: 7,
      projectKey: "williamos",
      projectName: "WilliamOS",
      title: "Ship the cockpit",
      rootSourceKind: "goal",
      rootSourceId: "41",
      createdAt: at("2026-08-14T10:00:00.000Z"),
      updatedAt: at("2026-08-14T10:00:00.000Z"),
    }],
    bindings: [{
      threadId: "thread-alpha",
      userId: "owner-1",
      projectId: 7,
      sourceKind: "goal",
      sourceId: "41",
      role: "root",
    }],
    sources: [{
      kind: "goal",
      id: "41",
      userId: "owner-1",
      occurredAt: at("2026-08-14T10:00:00.000Z"),
      ref: "GOAL-0041",
      data: {
        command: "Make the cockpit usable",
        response: "Classified as governed product work",
        verdict: "allow",
        repo: "must-not-create-membership",
      },
    }],
  }
}

describe("projectWorkbenchThreads", () => {
  it("projects runtime finding decisions as typed read-only decision items", () => {
    const input = baseInput()
    input.bindings.push({
      threadId: "thread-alpha", userId: "owner-1", projectId: 7,
      sourceKind: "governance_event", sourceId: "501", role: "member",
    })
    input.sources.push({
      kind: "governance_event", id: "501", userId: "owner-1",
      occurredAt: at("2026-08-20T16:00:00.000Z"),
      truth: { basis: "PERSISTED", state: "CURRENT", detail: "Canonical request" },
      data: {
        eventType: "RUNTIME_FINDING_OWNER_GATED",
        decision: {
          state: "ACTIONABLE",
          why: "changes reviewed policy",
          blockedAction: "Gated work remains blocked.",
          gates: ["POLICY"], recommendation: "DENY", choices: ["APPROVE", "DENY"],
          consequences: { APPROVE: "Record authority only.", DENY: "Resolve denied." },
        },
      },
    })

    const decision = projectWorkbenchThreads(input)[0].items.find((item) => item.kind === "DECISION")

    expect(decision).toMatchObject({
      title: "Runtime finding needs your decision",
      summary: "changes reviewed policy",
      rawState: "ACTIONABLE",
      actorRole: "OWNER",
      decision: {
        state: "ACTIONABLE", blockedAction: "Gated work remains blocked.", gates: ["POLICY"],
        recommendation: "DENY", choices: ["APPROVE", "DENY"],
      },
    })
    expect(decision?.source.drilldown).toEqual({ mode: "UNAVAILABLE", href: null })
  })

  it("projects a stable explicitly bound root into typed owner and WilliamOS facets", () => {
    const [thread] = projectWorkbenchThreads(baseInput())

    expect(thread.id).toBe("thread-alpha")
    expect(thread.project).toEqual({ id: 7, key: "williamos", name: "WilliamOS" })
    expect(thread.items.map((item) => ({ id: item.id, kind: item.kind, summary: item.summary }))).toEqual([
      {
        id: "goal:41:owner-intent",
        kind: "OWNER_INTENT",
        summary: "Make the cockpit usable",
      },
      {
        id: "goal:41:williamos-response",
        kind: "WILLIAMOS_RESPONSE",
        summary: "Classified as governed product work",
      },
    ])
    expect(thread.coverage.conversation).toBe("MISSING")
    expect(thread.coverage.missingSources).toContain("conversation")
  })

  it("excludes foreign threads and fails closed on tenant, Project, or root-binding mismatches", () => {
    const input = baseInput()
    input.threads.push({
      ...input.threads[0],
      id: "foreign-thread",
      userId: "owner-2",
    })
    input.bindings = [{
      ...input.bindings[0],
      projectId: 8,
    }]

    const [thread] = projectWorkbenchThreads(input)

    expect(thread.id).toBe("thread-alpha")
    expect(thread.items).toEqual([])
    expect(thread.coverage.conflicts).toEqual([
      "PROJECT_BINDING_MISMATCH:thread-alpha:goal:41",
      "ROOT_BINDING_MISSING:thread-alpha:goal:41",
    ])
  })

  it("does not publish timeline items when the declared root is only a member binding", () => {
    const input = baseInput()
    input.bindings[0] = { ...input.bindings[0], role: "member" }

    const [thread] = projectWorkbenchThreads(input)

    expect(thread.items).toEqual([])
    expect(thread.coverage.conflicts).toEqual([
      "ROOT_BINDING_MISSING:thread-alpha:goal:41",
    ])
  })

  it("keeps durable Threads visible while failing closed on missing or ambiguous roots", () => {
    const missing = baseInput()
    missing.threads[0] = { ...missing.threads[0], rootSourceKind: null, rootSourceId: null }
    missing.bindings = []

    const [missingThread] = projectWorkbenchThreads(missing)
    expect(missingThread.items).toEqual([])
    expect(missingThread.coverage.conflicts).toContain("ROOT_BINDING_MISSING:thread-alpha")

    const ambiguous = baseInput()
    ambiguous.threads[0] = { ...ambiguous.threads[0], rootSourceKind: null, rootSourceId: null }
    ambiguous.bindings.push({
      threadId: "thread-alpha", userId: "owner-1", projectId: 7,
      sourceKind: "outcome_queue_item", sourceId: "OUT-2", role: "root",
    })

    const [ambiguousThread] = projectWorkbenchThreads(ambiguous)
    expect(ambiguousThread.items).toEqual([])
    expect(ambiguousThread.coverage.conflicts).toContain("ROOT_BINDING_AMBIGUOUS:thread-alpha")
  })

  it("orders timeline ties and recent Threads deterministically without using input order", () => {
    const input = baseInput()
    input.threads.push({
      ...input.threads[0],
      id: "thread-beta",
      title: "Second thread",
      rootSourceKind: "work_order",
      rootSourceId: "9",
    })
    input.bindings.push(
      {
        threadId: "thread-alpha",
        userId: "owner-1",
        projectId: 7,
        sourceKind: "decision",
        sourceId: "3",
        role: "member",
      },
      {
        threadId: "thread-beta",
        userId: "owner-1",
        projectId: 7,
        sourceKind: "work_order",
        sourceId: "9",
        role: "root",
      },
    )
    input.sources.unshift(
      {
        kind: "work_order",
        id: "9",
        userId: "owner-1",
        occurredAt: at("2026-08-14T12:00:00.000Z"),
        data: { title: "Implement projection", state: "active" },
      },
      {
        kind: "decision",
        id: "3",
        userId: "owner-1",
        occurredAt: at("2026-08-14T10:00:00.000Z"),
        data: { title: "Keep owner authority", decision: "Approved", authority: "binding" },
      },
    )

    const projected = projectWorkbenchThreads(input)

    expect(projected.map((thread) => thread.id)).toEqual(["thread-beta", "thread-alpha"])
    expect(projected[1].items.map((item) => item.id)).toEqual([
      "goal:41:owner-intent",
      "goal:41:williamos-response",
      "decision:3:decision",
    ])
    expect(projected[1].lastActivityAt).toEqual(at("2026-08-14T10:00:00.000Z"))
  })

  it("deduplicates exact source facets and suppresses conflicting duplicates", () => {
    const input = baseInput()
    input.sources.push({ ...input.sources[0], data: { ...input.sources[0].data } })
    expect(projectWorkbenchThreads(input)[0].items).toHaveLength(2)

    input.sources.push({
      ...input.sources[0],
      data: { ...input.sources[0].data, command: "Conflicting owner intent" },
    })
    const [thread] = projectWorkbenchThreads(input)

    expect(thread.items).toEqual([])
    expect(thread.coverage.conflicts).toContain("SOURCE_CONFLICT:goal:41")
  })

  it("deduplicates explicit mirror events and reports divergent mirrors", () => {
    const input = baseInput()
    input.bindings.push(
      {
        threadId: "thread-alpha",
        userId: "owner-1",
        projectId: 7,
        sourceKind: "governance_event",
        sourceId: "70",
        role: "member",
      },
      {
        threadId: "thread-alpha",
        userId: "owner-1",
        projectId: 7,
        sourceKind: "event_log",
        sourceId: "91",
        role: "member",
      },
    )
    input.sources.push(
      {
        kind: "governance_event",
        id: "70",
        userId: "owner-1",
        occurredAt: at("2026-08-14T11:00:00.000Z"),
        mirrorKey: "runtime:41:review-recovered",
        data: { eventType: "HERMES_OUTCOME_REVIEW_RECOVERED", state: "REVIEW_REMEDIATION_RECOVERED", detail: "Review recovered" },
      },
      {
        kind: "event_log",
        id: "91",
        userId: "owner-1",
        occurredAt: at("2026-08-14T11:00:00.000Z"),
        mirrorKey: "runtime:41:review-recovered",
        data: { type: "HERMES_OUTCOME_REVIEW_RECOVERED", state: "REVIEW_REMEDIATION_RECOVERED", summary: "Review recovered" },
      },
    )

    let thread = projectWorkbenchThreads(input)[0]
    expect(thread.items.filter((item) => item.kind === "SYSTEM_RECOVERY")).toHaveLength(1)

    input.sources[input.sources.length - 1] = {
      ...input.sources[input.sources.length - 1],
      data: { type: "HERMES_OUTCOME_REVIEW_RECOVERED", state: "FAILED_TERMINAL", summary: "Conflicting mirror" },
    }
    thread = projectWorkbenchThreads(input)[0]
    expect(thread.items.filter((item) => item.source.mirrorKey === "runtime:41:review-recovered")).toEqual([])
    expect(thread.coverage.conflicts).toContain("MIRROR_CONFLICT:runtime:41:review-recovered")
  })

  it("uses explicit event-state allowlists for validation, review, remediation, delivery, and recovery facets", () => {
    const input = baseInput()
    const states = [
      ["101", "HOST_VALIDATION_PASSED", "VALIDATION"],
      ["102", "INDEPENDENT_REVIEW", "REVIEW"],
      ["103", "REVIEW_REMEDIATION_REQUIRED", "REMEDIATION"],
      ["104", "PR_MERGED", "ARTIFACT_DELIVERY"],
      ["105", "POST_MERGE_CLEANUP_RECOVERED", "SYSTEM_RECOVERY"],
      ["106", "UNRECOGNIZED_STATE", "WORK_STATE"],
    ] as const
    for (const [id, state] of states) {
      input.bindings.push({
        threadId: "thread-alpha",
        userId: "owner-1",
        projectId: 7,
        sourceKind: "governance_event",
        sourceId: id,
        role: "member",
      })
      input.sources.push({
        kind: "governance_event",
        id,
        userId: "owner-1",
        occurredAt: at(`2026-08-14T11:0${Number(id) - 101}:00.000Z`),
        data: { eventType: "HERMES_RUNTIME_CHECKPOINT", state, detail: state },
      })
    }

    const eventItems = projectWorkbenchThreads(input)[0].items.filter(
      (item) => item.source.kind === "governance_event",
    )
    expect(eventItems.map((item) => [item.rawState, item.kind])).toEqual(
      states.map(([, state, kind]) => [state, kind]),
    )
  })

  it("classifies an explicit recovery event type without guessing from its prose", () => {
    const input = baseInput()
    input.bindings.push({
      threadId: "thread-alpha",
      userId: "owner-1",
      projectId: 7,
      sourceKind: "governance_event",
      sourceId: "201",
      role: "member",
    })
    input.sources.push({
      kind: "governance_event",
      id: "201",
      userId: "owner-1",
      occurredAt: at("2026-08-14T11:00:00.000Z"),
      data: {
        eventType: "HERMES_OUTCOME_REVIEW_RECOVERED",
        detail: "This prose contains no classification keyword",
      },
    })

    const recovery = projectWorkbenchThreads(input)[0].items.find(
      (item) => item.source.id === "201",
    )
    expect(recovery?.kind).toBe("SYSTEM_RECOVERY")
    expect(recovery?.rawState).toBeNull()
  })

  it("preserves truth distinctions, reports explicit link conflicts, and never infers membership from repo/path/ref text", () => {
    const input = baseInput()
    input.sources[0] = {
      ...input.sources[0],
      truth: { basis: "INFERRED", state: "STALE", detail: "Classifier cache is stale" },
      links: [
        { relation: "work_order", kind: "work_order", id: "1" },
        { relation: "work_order", kind: "work_order", id: "2" },
      ],
    }
    input.sources.push({
      kind: "work_order",
      id: "77",
      userId: "owner-1",
      occurredAt: at("2026-08-14T13:00:00.000Z"),
      ref: "WO-HERMES-OUTCOME-41",
      data: { title: "Looks related only by ref", repo: "williamos", path: "C:/secret" },
    })

    const [thread] = projectWorkbenchThreads(input)

    expect(thread.items.every((item) => item.source.id !== "77")).toBe(true)
    expect(thread.items[0].truth).toEqual({
      basis: "INFERRED",
      state: "STALE",
      detail: "Classifier cache is stale",
    })
    expect(thread.coverage.conflicts).toContain("LINK_CONFLICT:goal:41:work_order")
  })

  it("redacts secrets and filesystem authority while retaining safe source drill-down", () => {
    const input = baseInput()
    input.bindings.push({
      threadId: "thread-alpha",
      userId: "owner-1",
      projectId: 7,
      sourceKind: "evidence_record",
      sourceId: "8",
      role: "member",
    })
    input.sources.push({
      kind: "evidence_record",
      id: "8",
      userId: "owner-1",
      occurredAt: at("2026-08-14T11:00:00.000Z"),
      ref: "EV-0008",
      drilldown: { mode: "EXACT", href: "/audit?evidence=evidence%3A8" },
      data: {
        result: "PASS",
        summary: "token=super-secret validation passed",
        validators: ["npm test"],
        artifactLabel: "Acceptance packet",
        artifactPath: "C:/private/packet.json",
        leaseToken: "lease-secret",
        acquisitionKey: "acquire-secret",
        executionBinding: "shell-secret",
      },
    })

    const evidenceItems = projectWorkbenchThreads(input)[0].items.filter(
      (item) => item.source.kind === "evidence_record",
    )
    const serialized = JSON.stringify(evidenceItems)

    expect(evidenceItems.map((item) => item.kind)).toEqual(["VALIDATION", "ARTIFACT_DELIVERY"])
    expect(evidenceItems[0].summary).toBe("[REDACTED] validation passed")
    expect(evidenceItems[0].source.drilldown).toEqual({
      mode: "EXACT",
      href: "/audit?evidence=evidence%3A8",
    })
    expect(serialized).not.toMatch(/super-secret|private|lease-secret|acquire-secret|shell-secret|artifactPath|leaseToken/i)
  })

  it("propagates truncation and missing bound sources without fabricating activity", () => {
    const input = baseInput()
    input.truncatedSourceKinds = ["governance_event"]
    input.bindings.push({
      threadId: "thread-alpha",
      userId: "owner-1",
      projectId: 7,
      sourceKind: "decision",
      sourceId: "missing",
      role: "member",
    })

    const [thread] = projectWorkbenchThreads(input)

    expect(thread.coverage.truncated).toBe(true)
    expect(thread.coverage.truncatedSourceKinds).toEqual(["governance_event"])
    expect(thread.coverage.missingSources).toEqual(["conversation", "decision:missing"])
    expect(thread.lastActivityAt).toEqual(at("2026-08-14T10:00:00.000Z"))
  })

  it("collapses identical-intent threads into one entry that reports the run count without losing recorded work", () => {
    const input = baseInput()
    input.threads.push({
      id: "thread-alpha-rerun-1",
      userId: "owner-1",
      projectId: 7,
      projectKey: "williamos",
      projectName: "WilliamOS",
      title: "Ship the cockpit",
      rootSourceKind: "goal",
      rootSourceId: "41b",
      createdAt: at("2026-08-16T09:00:00.000Z"),
      updatedAt: at("2026-08-16T09:00:00.000Z"),
    }, {
      id: "thread-alpha-rerun-2",
      userId: "owner-1",
      projectId: 7,
      projectKey: "williamos",
      projectName: "WilliamOS",
      title: "ship the cockpit ",
      rootSourceKind: "goal",
      rootSourceId: "41c",
      createdAt: at("2026-08-18T11:00:00.000Z"),
      updatedAt: at("2026-08-18T11:00:00.000Z"),
    })
    input.bindings.push({
      threadId: "thread-alpha-rerun-1", userId: "owner-1", projectId: 7,
      sourceKind: "goal", sourceId: "41b", role: "root",
    }, {
      threadId: "thread-alpha-rerun-2", userId: "owner-1", projectId: 7,
      sourceKind: "goal", sourceId: "41c", role: "root",
    })
    input.sources.push({
      kind: "goal", id: "41b", userId: "owner-1",
      occurredAt: at("2026-08-16T09:00:00.000Z"),
      ref: "GOAL-0042",
      data: {
        command: "Make the cockpit usable (run 2)",
        response: "Classified as governed product work",
        verdict: "allow",
        repo: "must-not-create-membership",
      },
    }, {
      kind: "goal", id: "41c", userId: "owner-1",
      occurredAt: at("2026-08-18T11:00:00.000Z"),
      ref: "GOAL-0043",
      data: {
        command: "Make the cockpit usable (run 3)",
        response: "Classified as governed product work",
        verdict: "allow",
        repo: "must-not-create-membership",
      },
    })

    const [thread] = projectWorkbenchThreads(input)

    expect(thread.runCount).toBe(3)
    expect(thread.runCountPartial).toBeUndefined()
    expect(thread.createdAt).toEqual(at("2026-08-14T10:00:00.000Z"))
    expect(thread.lastActivityAt).toEqual(at("2026-08-18T11:00:00.000Z"))
    // Every recorded session's work stays visible in the collapsed entry:
    // items from all three runs merge instead of only the newest surviving.
    const ownerIntents = thread.items
      .filter((item) => item.kind === "OWNER_INTENT")
      .map((item) => item.summary)
    expect(ownerIntents).toEqual([
      "Make the cockpit usable",
      "Make the cockpit usable (run 2)",
      "Make the cockpit usable (run 3)",
    ])
    expect(thread.coverage.missingSources).toContain("conversation")
  })

  it("marks the run count partial when the upstream thread read was truncated before grouping", () => {
    const input = baseInput()
    input.threadListTruncated = true

    const [thread] = projectWorkbenchThreads(input)

    expect(thread.runCountPartial).toBe(true)
  })
})
