import { describe, expect, it } from "vitest"

import type { GoalTimelineProjection } from "@/components/goal-console/goal-timeline-read-model"
import {
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
  trace?: Array<{ id: string; eventId: number }>
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
      ]).map((record) => ({ ...record, eventType: "HERMES_RUNTIME_CHECKPOINT" })),
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
        href: "/audit#persisted-evidence-truth-title",
        references: ["EV-DB-9", "EV-HERMES-8-1-2"],
      },
      {
        label: "Trace register (2)",
        href: "/trace#persisted-runtime-trace",
        references: ["trace:101", "trace:102"],
      },
      {
        label: "Audit register (1)",
        href: "/audit#audit-event-register",
        references: ["audit:21"],
      },
    ])
    expect(links.find((link) => link.kind === "EVIDENCE")?.records).toEqual([
      { reference: "EV-DB-9", detail: "PASS" },
      { reference: "EV-HERMES-8-1-2", detail: "Terminal evidence reference" },
    ])
    expect(links.find((link) => link.kind === "AUDIT")?.records).toEqual([{
      reference: "audit:21",
      detail: "work_order.updated · Work Order updated",
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
      href: "/audit#persisted-evidence-truth-title",
      references: ["evidence:17"],
      records: [{
        reference: "evidence:17",
        detail: "Terminal evidence record",
      }],
    }])
  })

  it("keeps an unmatched terminal Evidence id alongside other Evidence references", () => {
    const links = projectOutcomeQueueSupportingRecordLinks(row({
      terminalEvidenceId: 17,
    }), [timeline()])

    expect(links.find((link) => link.kind === "EVIDENCE")?.records).toEqual([
      { reference: "EV-DB-9", detail: "PASS" },
      { reference: "EV-HERMES-8-1-2", detail: "Terminal evidence reference" },
      { reference: "evidence:17", detail: "Terminal evidence record" },
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
      { reference: "EV-DB-17", detail: "PASS" },
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
      { reference: "evidence:17", detail: "Terminal evidence record" },
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
      { reference: "EV-DB-9", detail: "PASS" },
    ])
    expect(omitted.some((link) => link.kind === "EVIDENCE")).toBe(false)
  })
})
