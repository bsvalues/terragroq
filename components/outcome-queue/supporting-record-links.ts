import type { GoalTimelineProjection } from "@/components/goal-console/goal-timeline-read-model"
import type { OutcomeQueueOperatorRow } from "@/lib/outcome-queue/operator-surface"

export const DURABLE_RECORD_ANCHORS = {
  goal: "goal-delivery-timeline",
  workOrder: "work-order",
  evidence: "persisted-evidence-truth-title",
  trace: "persisted-runtime-trace",
  audit: "audit-event-register",
} as const

export type OutcomeQueueSupportingRecordKind =
  | "GOAL"
  | "WORK_ORDER"
  | "EVIDENCE"
  | "TRACE"
  | "AUDIT"

export type OutcomeQueueSupportingRecordLink = {
  kind: OutcomeQueueSupportingRecordKind
  label: string
  href: string
  references: readonly string[]
  records: readonly OutcomeQueueSupportingRecord[]
}

export type OutcomeQueueSupportingRecord = {
  reference: string
  detail: string | null
}

function uniqueRecords(
  records: readonly OutcomeQueueSupportingRecord[],
): OutcomeQueueSupportingRecord[] {
  const byReference = new Map<string, OutcomeQueueSupportingRecord>()
  for (const record of records) {
    const reference = record.reference.trim()
    if (reference.length > 0 && !byReference.has(reference)) {
      byReference.set(reference, { ...record, reference })
    }
  }
  return [...byReference.values()]
}

function evidenceRecords(
  row: OutcomeQueueOperatorRow,
  timeline: GoalTimelineProjection | null,
): OutcomeQueueSupportingRecord[] {
  const projected = timeline?.references.evidence.map((record) => ({
    reference: record.ref,
    detail: record.result,
  })) ?? []
  const terminal = row.terminalEvidenceRefs.flatMap((candidate) => {
    const reference = candidate.trim()
    return reference.startsWith("EV-") || reference.startsWith("evidence:")
      ? [{ reference, detail: "Terminal evidence reference" }]
      : []
  })
  const terminalRecordId = row.terminalEvidenceId !== null
    && Number.isSafeInteger(row.terminalEvidenceId)
    && row.terminalEvidenceId > 0
    ? `evidence:${row.terminalEvidenceId}`
    : null
  const terminalRecordAlreadyProjected = terminalRecordId !== null
    && (timeline?.references.evidence.some((record) => (
      record.id === terminalRecordId && record.ref.trim().length > 0
    )) ?? false)
  const terminalRecord = terminalRecordId !== null && !terminalRecordAlreadyProjected
    ? [{ reference: terminalRecordId, detail: "Terminal evidence record" }]
    : []
  return uniqueRecords([...projected, ...terminal, ...terminalRecord])
}

function link(
  kind: OutcomeQueueSupportingRecordKind,
  label: string,
  href: string,
  records: readonly OutcomeQueueSupportingRecord[],
): OutcomeQueueSupportingRecordLink {
  return {
    kind,
    label,
    href,
    references: records.map((record) => record.reference),
    records,
  }
}

export function projectOutcomeQueueSupportingRecordLinks(
  row: OutcomeQueueOperatorRow,
  timelines: readonly GoalTimelineProjection[],
): OutcomeQueueSupportingRecordLink[] {
  const links: OutcomeQueueSupportingRecordLink[] = []
  const goalId = row.goalId !== null
    && Number.isSafeInteger(row.goalId)
    && row.goalId > 0
    ? row.goalId
    : null
  const goalRef = row.goalRef?.trim() || null
  const matchedTimelines = goalId !== null
    ? timelines.filter((timeline) => (
        timeline.goal.id === goalId
        && (goalRef === null || timeline.goal.ref === goalRef)
      ))
    : []
  const matchedTimeline = matchedTimelines.length === 1 ? matchedTimelines[0] : null
  const timelineWorkOrder = matchedTimeline?.current.workOrder ?? null
  const workOrderConflict = row.activeWorkOrderId !== null
    && timelineWorkOrder !== null
    && row.activeWorkOrderId !== timelineWorkOrder.id
  const trustedTimeline = workOrderConflict ? null : matchedTimeline

  if (goalId !== null) {
    const goalReference = goalRef ?? matchedTimeline?.goal.ref ?? `#${goalId}`
    links.push(link(
      "GOAL",
      `Goal ${goalReference}`,
      `/goal-console?goal=${goalId}#${DURABLE_RECORD_ANCHORS.goal}`,
      [{
        reference: goalReference,
        detail: trustedTimeline?.goal.outcome ?? row.objective ?? row.title,
      }],
    ))
  }

  const trustedWorkOrder = trustedTimeline?.current.workOrder ?? null
  const workOrderId = trustedWorkOrder?.id ?? row.activeWorkOrderId
  if (workOrderId !== null && Number.isSafeInteger(workOrderId) && workOrderId > 0) {
    const workOrderRef = trustedWorkOrder?.ref ?? `#${workOrderId}`
    const detail = trustedWorkOrder
      ? `${trustedWorkOrder.title} · ${trustedWorkOrder.status}${
          trustedWorkOrder.result ? ` · ${trustedWorkOrder.result}` : ""
        }`
      : null
    links.push(link(
      "WORK_ORDER",
      `Work Order ${workOrderRef}`,
      `/work-orders#${DURABLE_RECORD_ANCHORS.workOrder}-${workOrderId}`,
      [{ reference: workOrderRef, detail }],
    ))
  }

  const evidence = evidenceRecords(row, trustedTimeline)
  if (evidence.length > 0) {
    links.push(link(
      "EVIDENCE",
      `Evidence register (${evidence.length})`,
      `/audit#${DURABLE_RECORD_ANCHORS.evidence}`,
      evidence,
    ))
  }

  const trace = uniqueRecords(
    trustedTimeline?.references.trace.map((record) => ({
      reference: record.id,
      detail: record.eventType,
    })) ?? [],
  )
  if (trace.length > 0) {
    links.push(link(
      "TRACE",
      `Trace register (${trace.length})`,
      `/trace#${DURABLE_RECORD_ANCHORS.trace}`,
      trace,
    ))
  }

  const audit = uniqueRecords(
    trustedTimeline?.references.audit.map((record) => ({
      reference: record.id,
      detail: `${record.type} · ${record.summary}`,
    })) ?? [],
  )
  if (audit.length > 0) {
    links.push(link(
      "AUDIT",
      `Audit register (${audit.length})`,
      `/audit#${DURABLE_RECORD_ANCHORS.audit}`,
      audit,
    ))
  }

  return links
}
