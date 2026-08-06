import { describe, expect, it } from "vitest"

import type { GoalTimelineProjection } from "@/components/goal-console/goal-timeline-read-model"
import {
  indexGoalTimelinesById,
  normalizeDurableRecordReference,
  projectOutcomeQueueSupportingRecordLinks,
} from "@/components/outcome-queue/supporting-record-links"
import type { OutcomeQueueOperatorRow } from "@/lib/outcome-queue/operator-surface"

function row(overrides: Partial<OutcomeQueueOperatorRow> = {}): OutcomeQueueOperatorRow {
  return {
    goalId: 8,
    goalRef: "GOAL-0008",
    title: "Add evidence links",
    objective: "Show linked durable records",
    activeWorkOrderId: 41,
    terminalEvidenceId: null,
    terminalEvidenceRefs: ["EV-HERMES-8-1-2", "pr:51", "EV-HERMES-8-1-2"],
    ...overrides,
  } as unknown as OutcomeQueueOperatorRow
}

function timeline(overrides: {
  goalId?: number
  goalRef?: string
  workOrderId?: number | null
  evidence?: Array<{ id: string; ref: string }>
  trace?: Array<{ id: string; eventId: number; eventType?: string }>
  audit?: Array<{ id: string }>
} = {}): GoalTimelineProjection {
  const workOrderId = overrides.workOrderId === undefined ? 41 : overrides.workOrderId
  return {
    goal: {
      id: overrides.goalId ?? 8,
      ref: overrides.goalRef ?? "GOAL-0008",
    },
    current: {
      workOrder: workOrderId === null
        ? null
        : {
            id: workOrderId,
            ref: `WO-HERMES-OUTCOME-${workOrderId}`,
          },
    },
    references: {
      evidence: (overrides.evidence ?? [{ id: "evidence:9", ref: "EV-DB-9" }]).map(
        (record) => ({ ...record, result: "PASS", artifactPath: null, contentHash: null }),
      ),
      trace: (overrides.trace ?? [
        { id: "trace:101", eventId: 101 },
        { id: "trace:102", eventId: 102 },
      ]).map((record) => ({
        ...record,
        eventType: record.eventType ?? "HERMES_RUNTIME_CHECKPOINT",
      })),
      audit: (overrides.audit ?? [{ id: "audit:21" }]).map((record) => ({
        ...record,
        type: "work_order.updated",
        summary: "Work Order updated",
      })),
      decisions: [],
    },
  } as unknown as GoalTimelineProjection
}

describe("outcome queue supporting record links", () => {
  it("indexes candidate timelines once by Goal id without hiding duplicates", () => {
    const goalEight = timeline()
    const duplicateGoalEight = timeline()
    const goalNine = timeline({ goalId: 9, goalRef: "GOAL-0009" })
    const indexed = indexGoalTimelinesById([goalEight, goalNine, duplicateGoalEight])

    expect(indexed.get(8)).toEqual([goalEight, duplicateGoalEight])
    expect(indexed.get(9)).toEqual([goalNine])
    expect(indexed.get(10)).toBeUndefined()
  })

  it("projects exact durable Goal, Work Order, Evidence, Trace, and Audit links", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row(), [timeline()])

    expect(links.map((link) => link.kind)).toEqual([
      "GOAL",
      "WORK_ORDER",
      "EVIDENCE",
      "TRACE",
      "AUDIT",
    ])
    expect(links).toMatchObject([
      {
        label: "Goal GOAL-0008",
        href: "/goal-console?goal=8#goal-delivery-timeline",
        references: ["GOAL-0008"],
      },
      {
        label: "Work Order WO-HERMES-OUTCOME-41",
        href: "/work-orders#work-order-41",
        references: ["WO-HERMES-OUTCOME-41"],
      },
      {
        label: "Evidence register (2)",
        href: "/audit?evidence=evidence%3A9#evidence-record-evidence-9",
        references: ["EV-DB-9", "EV-HERMES-8-1-2"],
      },
      {
        label: "Trace register (2)",
        href: "/trace?trace=trace%3A101#trace-record-trace-101",
        references: ["trace:101", "trace:102"],
      },
      {
        label: "Audit register (1)",
        href: "/audit?audit=audit%3A21#audit-record-audit-21",
        references: ["audit:21"],
      },
    ])
    expect(links.find((link) => link.kind === "EVIDENCE")?.records).toEqual([
      {
        reference: "EV-DB-9",
        detail: "PASS",
        href: "/audit?evidence=evidence%3A9#evidence-record-evidence-9",
      },
      {
        reference: "EV-HERMES-8-1-2",
        detail: "Terminal evidence reference",
        href: "/audit?evidence=EV-HERMES-8-1-2#evidence-record-ev-hermes-8-1-2",
      },
    ])
    expect(links.find((link) => link.kind === "AUDIT")?.records).toEqual([{
      reference: "audit:21",
      detail: "work_order.updated · Work Order updated",
      href: "/audit?audit=audit%3A21#audit-record-audit-21",
    }])
  })

  it("omits record categories whose durable references do not exist", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      activeWorkOrderId: null,
      terminalEvidenceRefs: [],
    }), [timeline({
      workOrderId: null,
      evidence: [],
      trace: [],
      audit: [],
    })])

    expect(links).toEqual([{
      kind: "GOAL",
      label: "Goal GOAL-0008",
      href: "/goal-console?goal=8#goal-delivery-timeline",
      references: ["GOAL-0008"],
      records: [{
        reference: "GOAL-0008",
        detail: "Show linked durable records",
      }],
    }])
  })

  it("does not borrow records from a timeline with a different Goal identity", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      activeWorkOrderId: null,
      terminalEvidenceRefs: [],
    }), [timeline({ goalRef: "GOAL-FORGED" })])

    expect(links.map((link) => link.kind)).toEqual(["GOAL"])
  })

  it("links a durable Goal id when its display reference is absent", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      goalRef: null,
      activeWorkOrderId: null,
      terminalEvidenceRefs: [],
    }), [])

    expect(links).toEqual([{
      kind: "GOAL",
      label: "Goal #8",
      href: "/goal-console?goal=8#goal-delivery-timeline",
      references: ["#8"],
      records: [{
        reference: "#8",
        detail: "Show linked durable records",
      }],
    }])
  })

  it("fails closed on a conflicting Work Order binding", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      terminalEvidenceRefs: [],
    }), [timeline({ workOrderId: 99 })])

    expect(links).toEqual([
      {
        kind: "GOAL",
        label: "Goal GOAL-0008",
        href: "/goal-console?goal=8#goal-delivery-timeline",
        references: ["GOAL-0008"],
        records: [{
          reference: "GOAL-0008",
          detail: "Show linked durable records",
        }],
      },
      {
        kind: "WORK_ORDER",
        label: "Work Order #41",
        href: "/work-orders#work-order-41",
        references: ["#41"],
        records: [{ reference: "#41", detail: null }],
      },
    ])
  })

  it("fails closed when duplicate projections claim the same Goal identity", () => {
    const duplicate = timeline()
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      activeWorkOrderId: null,
      terminalEvidenceRefs: [],
    }), [duplicate, duplicate])

    expect(links.map((link) => link.kind)).toEqual(["GOAL"])
  })

  it("links a durable terminal Evidence id even without a Goal timeline", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      goalId: null,
      goalRef: null,
      activeWorkOrderId: null,
      terminalEvidenceId: 17,
      terminalEvidenceRefs: [],
    }), [])

    expect(links).toEqual([{
      kind: "EVIDENCE",
      label: "Evidence register (1)",
      href: "/audit?evidence=evidence%3A17#evidence-record-evidence-17",
      references: ["evidence:17"],
      records: [{
        reference: "evidence:17",
        detail: "Terminal evidence record",
        href: "/audit?evidence=evidence%3A17#evidence-record-evidence-17",
      }],
    }])
  })

  it("keeps an unmatched terminal Evidence id alongside other Evidence references", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      terminalEvidenceId: 17,
    }), [timeline()])

    expect(links.find((link) => link.kind === "EVIDENCE")?.records).toEqual([
      {
        reference: "EV-DB-9",
        detail: "PASS",
        href: "/audit?evidence=evidence%3A9#evidence-record-evidence-9",
      },
      {
        reference: "EV-HERMES-8-1-2",
        detail: "Terminal evidence reference",
        href: "/audit?evidence=EV-HERMES-8-1-2#evidence-record-ev-hermes-8-1-2",
      },
      {
        reference: "evidence:17",
        detail: "Terminal evidence record",
        href: "/audit?evidence=evidence%3A17#evidence-record-evidence-17",
      },
    ])
  })

  it("does not duplicate a terminal Evidence id already represented by its timeline record", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      terminalEvidenceId: 17,
      terminalEvidenceRefs: [],
    }), [timeline({
      evidence: [{ id: "evidence:17", ref: "EV-DB-17" }],
    })])

    expect(links.find((link) => link.kind === "EVIDENCE")?.records).toEqual([
      {
        reference: "EV-DB-17",
        detail: "PASS",
        href: "/audit?evidence=evidence%3A17#evidence-record-evidence-17",
      },
    ])
  })

  it("keeps a terminal Evidence id when its projected display reference is empty", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      terminalEvidenceId: 17,
      terminalEvidenceRefs: [],
    }), [timeline({
      evidence: [{ id: "evidence:17", ref: "" }],
    })])

    expect(links.find((link) => link.kind === "EVIDENCE")?.records).toEqual([
      {
        reference: "evidence:17",
        detail: "Terminal evidence record",
        href: "/audit?evidence=evidence%3A17#evidence-record-evidence-17",
      },
    ])
  })

  it("normalizes durable Evidence references before filtering and deduplication", () => {
    const normalized = projectOutcomeQueueSupportingRecordLinks(row({
      terminalEvidenceRefs: [" EV-DB-9 ", "EV-DB-9"],
    }), [timeline({
      evidence: [{ id: "evidence:9", ref: " EV-DB-9 " }],
    })])
    const omitted = projectOutcomeQueueSupportingRecordLinks(row({
      terminalEvidenceRefs: ["   "],
    }), [timeline({
      evidence: [{ id: "evidence:9", ref: "   " }],
    })])

    expect(normalized.find((link) => link.kind === "EVIDENCE")?.records).toEqual([
      {
        reference: "EV-DB-9",
        detail: "PASS",
        href: "/audit?evidence=evidence%3A9#evidence-record-evidence-9",
      },
    ])
    expect(omitted.some((link) => link.kind === "EVIDENCE")).toBe(false)
  })

  it("fails closed when one Evidence display ref maps to multiple canonical records", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      terminalEvidenceRefs: [],
    }), [timeline({
      evidence: [
        { id: "evidence:9", ref: "EV-DUPLICATE" },
        { id: "evidence:10", ref: "EV-DUPLICATE" },
      ],
    })])

    expect(links.some((link) => link.kind === "EVIDENCE")).toBe(false)
  })

  it("preserves an independent canonical Evidence id while ambiguous aliases fail closed", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      terminalEvidenceId: 9,
      terminalEvidenceRefs: [],
    }), [timeline({
      evidence: [
        { id: "evidence:9", ref: "EV-DUPLICATE" },
        { id: "evidence:10", ref: "EV-DUPLICATE" },
      ],
    })])

    expect(links.find((link) => link.kind === "EVIDENCE")?.records).toEqual([{
      reference: "evidence:9",
      detail: "Terminal evidence record",
      href: "/audit?evidence=evidence%3A9#evidence-record-evidence-9",
    }])
  })

  it("rejects every multi-valued durable-record query parameter", () => {
    expect(normalizeDurableRecordReference("evidence", ["evidence:17"])).toBe("evidence:17")
    expect(normalizeDurableRecordReference("evidence", [
      "evidence:17",
      "evidence:17",
    ])).toBeNull()
    expect(normalizeDurableRecordReference("trace", ["trace:101", "trace:102"])).toBeNull()
    expect(normalizeDurableRecordReference("audit", ["audit:21", "audit:21"])).toBeNull()
  })

  it("advertises only Trace event types rendered by the persisted ledger", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row(), [timeline({
      trace: [
        { id: "trace:101", eventId: 101, eventType: "HERMES_RUNTIME_CHECKPOINT" },
        { id: "trace:102", eventId: 102, eventType: "HERMES_RUNTIME_FAILURE_EVAL" },
        { id: "trace:103", eventId: 103, eventType: "HERMES_RUNTIME_LEASE" },
        { id: "trace:104", eventId: 104, eventType: "HERMES_OUTCOME_TERMINAL" },
        {
          id: "trace:105",
          eventId: 105,
          eventType: "HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED",
        },
      ],
    })])

    expect(links.find((link) => link.kind === "TRACE")).toMatchObject({
      references: ["trace:101", "trace:102"],
      records: [
        {
          reference: "trace:101",
          href: "/trace?trace=trace%3A101#trace-record-trace-101",
        },
        {
          reference: "trace:102",
          href: "/trace?trace=trace%3A102#trace-record-trace-102",
        },
      ],
    })
  })

  it("fails closed instead of advertising records without an exact target", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      terminalEvidenceRefs: ["EV invalid"],
    }), [timeline({
      evidence: [{ id: "evidence:not-a-number", ref: "EV-UNRESOLVED" }],
      trace: [{
        id: "trace:not-a-number",
        eventId: 101,
        eventType: "HERMES_RUNTIME_CHECKPOINT",
      }],
      audit: [{ id: "audit:not-a-number" }],
    })])

    expect(links.map((link) => link.kind)).toEqual(["GOAL", "WORK_ORDER"])
  })
})
