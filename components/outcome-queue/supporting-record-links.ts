import type { GoalTimelineProjection } from "@/components/goal-console/goal-timeline-read-model"
import {
  RUNTIME_CHECKPOINT_EVENT,
  RUNTIME_FAILURE_EVENT,
} from "@/components/runtime/runtime-execution-model"
import type { OutcomeQueueOperatorRow } from "@/lib/outcome-queue/operator-surface"

export const DURABLE_RECORD_ANCHORS = {
  goal: "goal-delivery-timeline",
  workOrder: "work-order",
  evidence: "persisted-evidence-truth-title",
  trace: "persisted-runtime-trace",
  audit: "audit-event-register",
} as const

export type DurableRecordTargetKind = "evidence" | "trace" | "audit"

const DURABLE_RECORD_PREFIXES: Record<DurableRecordTargetKind, string> = {
  evidence: "evidence-record",
  trace: "trace-record",
  audit: "audit-record",
}

const RENDERED_TRACE_EVENT_TYPES = new Set<string>([
  RUNTIME_CHECKPOINT_EVENT,
  RUNTIME_FAILURE_EVENT,
])

export function normalizeDurableRecordReference(
  kind: DurableRecordTargetKind,
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value) && value.length !== 1) return null
  const candidate = (Array.isArray(value) ? value[0] : value)?.trim()
  if (!candidate || candidate.length > 200) return null
  if (kind === "evidence") {
    if (/^EV-[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(candidate)) return candidate
  }
  const prefix = `${kind}:`
  if (!candidate.startsWith(prefix)) return null
  const recordId = Number(candidate.slice(prefix.length))
  return Number.isSafeInteger(recordId) && recordId > 0
    && candidate === `${prefix}${recordId}`
    ? candidate
    : null
}

export function durableRecordDomId(
  kind: DurableRecordTargetKind,
  reference: string,
): string {
  const normalized = normalizeDurableRecordReference(kind, reference)
  const suffix = normalized?.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") ?? "unavailable"
  return `${DURABLE_RECORD_PREFIXES[kind]}-${suffix}`
}

function durableRecordHref(
  kind: DurableRecordTargetKind,
  reference: string,
): string | undefined {
  const normalized = normalizeDurableRecordReference(kind, reference)
  if (!normalized) return undefined
  const pathname = kind === "trace" ? "/trace" : "/audit"
  return `${pathname}?${kind}=${encodeURIComponent(normalized)}#${durableRecordDomId(kind, normalized)}`
}

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
  href?: string
}

export type GoalTimelineIndex = ReadonlyMap<
  number,
  readonly GoalTimelineProjection[]
>

export function indexGoalTimelinesById(
  timelines: readonly GoalTimelineProjection[],
): GoalTimelineIndex {
  const indexed = new Map<number, GoalTimelineProjection[]>()
  for (const timeline of timelines) {
    const matches = indexed.get(timeline.goal.id)
    if (matches) matches.push(timeline)
    else indexed.set(timeline.goal.id, [timeline])
  }
  return indexed
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

function uniqueEvidenceRecords(
  records: readonly OutcomeQueueSupportingRecord[],
): OutcomeQueueSupportingRecord[] {
  const normalized = records.flatMap((record) => {
    const reference = record.reference.trim()
    const canonicalTarget = record.href?.trim()
    return reference && canonicalTarget
      ? [{ ...record, reference, href: canonicalTarget }]
      : []
  })

  const targetsByDisplayReference = new Map<string, Set<string>>()
  for (const record of normalized) {
    const targets = targetsByDisplayReference.get(record.reference) ?? new Set<string>()
    targets.add(record.href)
    targetsByDisplayReference.set(record.reference, targets)
  }
  const ambiguousDisplayReferences = new Set<string>()
  for (const [reference, targets] of targetsByDisplayReference) {
    if (targets.size > 1) ambiguousDisplayReferences.add(reference)
  }

  const byCanonicalTarget = new Map<string, OutcomeQueueSupportingRecord>()
  for (const record of normalized) {
    if (ambiguousDisplayReferences.has(record.reference)) continue
    if (!byCanonicalTarget.has(record.href)) byCanonicalTarget.set(record.href, record)
  }
  return [...byCanonicalTarget.values()]
}

function evidenceRecords(
  row: OutcomeQueueOperatorRow,
  timeline: GoalTimelineProjection | null,
): OutcomeQueueSupportingRecord[] {
  const projected = timeline?.references.evidence.flatMap((record) => {
    const href = durableRecordHref("evidence", record.id)
    return href ? [{ reference: record.ref, detail: record.result, href }] : []
  }) ?? []
  const terminal = row.terminalEvidenceRefs.flatMap((candidate) => {
    const reference = candidate.trim()
    const projectedMatches = projected.filter(
      (record) => record.reference.trim() === reference,
    )
    const href = projectedMatches.length === 1
      ? projectedMatches[0].href
      : durableRecordHref("evidence", reference)
    return href ? [{ reference, detail: "Terminal evidence reference", href }] : []
  })
  const terminalRecordId = row.terminalEvidenceId !== null
    && Number.isSafeInteger(row.terminalEvidenceId)
    && row.terminalEvidenceId > 0
    ? `evidence:${row.terminalEvidenceId}`
    : null
  const terminalRecordHref = terminalRecordId === null
    ? undefined
    : durableRecordHref("evidence", terminalRecordId)
  const terminalRecord = terminalRecordId !== null
    && terminalRecordHref
    ? [{
        reference: terminalRecordId,
        detail: "Terminal evidence record",
        href: terminalRecordHref,
      }]
    : []
  return uniqueEvidenceRecords([...projected, ...terminal, ...terminalRecord])
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
  const firstEvidenceHref = evidence[0]?.href
  if (evidence.length > 0 && firstEvidenceHref) {
    links.push(link(
      "EVIDENCE",
      `Evidence register (${evidence.length})`,
      firstEvidenceHref,
      evidence,
    ))
  }

  const trace = uniqueRecords(
    trustedTimeline?.references.trace
      .filter((record) => RENDERED_TRACE_EVENT_TYPES.has(record.eventType))
      .flatMap((record) => {
        const href = durableRecordHref("trace", record.id)
        return href ? [{ reference: record.id, detail: record.eventType, href }] : []
      }) ?? [],
  )
  const firstTraceHref = trace[0]?.href
  if (trace.length > 0 && firstTraceHref) {
    links.push(link(
      "TRACE",
      `Trace register (${trace.length})`,
      firstTraceHref,
      trace,
    ))
  }

  const audit = uniqueRecords(
    trustedTimeline?.references.audit.flatMap((record) => {
      const href = durableRecordHref("audit", record.id)
      return href ? [{
        reference: record.id,
        detail: `${record.type} · ${record.summary}`,
        href,
      }] : []
    }) ?? [],
  )
  const firstAuditHref = audit[0]?.href
  if (audit.length > 0 && firstAuditHref) {
    links.push(link(
      "AUDIT",
      `Audit register (${audit.length})`,
      firstAuditHref,
      audit,
    ))
  }

  return links
}
