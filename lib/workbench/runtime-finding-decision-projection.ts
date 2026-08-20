import type { ThreadBindingInput, ThreadSourceInput, ThreadTruth } from "@/lib/workbench/thread-projection"

type RuntimeFindingEvent = Readonly<{
  id: number
  userId: string
  entityType: string | null
  entityId: string | null
  eventType: string
  createdAt: Date
  metadata: unknown
}>

type WorkOrderIdentity = Readonly<{ id: number; ref: string | null }>

type RuntimeFindingRequest = Readonly<Record<string, unknown>> | null

type ProjectionInput = Readonly<{
  userId: string
  projectId: number
  threadId: string
  workOrder: WorkOrderIdentity
  events: readonly RuntimeFindingEvent[]
  actionableRequest: RuntimeFindingRequest
}>

type ProjectionResult = Readonly<{
  bindings: ThreadBindingInput[]
  sources: ThreadSourceInput[]
}>

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function positiveInteger(value: unknown): number | null {
  const candidate = Number(value)
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null
}

function gates(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const normalized = [...new Set(value.map(text).filter((entry): entry is string => entry !== null))].sort()
  return normalized.length > 0 && normalized.every((entry) => /^[A-Z][A-Z0-9_]{1,79}$/.test(entry))
    ? normalized
    : null
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function boundEvent(event: RuntimeFindingEvent, input: ProjectionInput): boolean {
  return event.userId === input.userId
    && event.entityType === "work_order"
    && event.entityId === String(input.workOrder.id)
}

function requestMatches(
  request: RuntimeFindingRequest,
  input: ProjectionInput,
  gateEvent: RuntimeFindingEvent,
  gateMetadata: Record<string, unknown>,
  normalizedGates: readonly string[],
): request is Readonly<Record<string, unknown>> {
  if (!request) return false
  return request.sourceKind === "RUNTIME_FINDING"
    && request.ownerUserId === input.userId
    && positiveInteger(request.parentWorkOrderRowId) === input.workOrder.id
    && request.parentWorkOrderRef === input.workOrder.ref
    && positiveInteger(request.sourceFindingEventId) === positiveInteger(gateMetadata.sourceFindingEventId)
    && positiveInteger(request.gateSettlementEventId) === gateEvent.id
    && request.findingId === gateMetadata.findingId
    && request.gate === gateMetadata.gate
    && sameStrings(gates(request.gates) ?? [], normalizedGates)
}

function exactReceipt(
  event: RuntimeFindingEvent,
  input: ProjectionInput,
  gateEvent: RuntimeFindingEvent,
  gateMetadata: Record<string, unknown>,
  normalizedGates: readonly string[],
): Record<string, unknown> | null {
  if (!boundEvent(event, input) || event.eventType !== "RUNTIME_FINDING_OWNER_DECIDED") return null
  const metadata = record(event.metadata)
  const choice = text(metadata?.choice)
  const disposition = text(metadata?.disposition)
  if (!metadata
    || metadata.sourceKind !== "RUNTIME_FINDING"
    || metadata.ownerUserId !== input.userId
    || positiveInteger(metadata.parentWorkOrderRowId) !== input.workOrder.id
    || metadata.parentWorkOrderRef !== input.workOrder.ref
    || positiveInteger(metadata.sourceFindingEventId) !== positiveInteger(gateMetadata.sourceFindingEventId)
    || positiveInteger(metadata.gateSettlementEventId) !== gateEvent.id
    || metadata.findingId !== gateMetadata.findingId
    || metadata.gate !== gateMetadata.gate
    || !sameStrings(gates(metadata.gates) ?? [], normalizedGates)
    || !["APPROVE", "DENY"].includes(choice ?? "")
    || !["AUTHORITY_MATERIALIZATION_REQUIRED", "DENIED_RESOLVED"].includes(disposition ?? "")
    || metadata.resumeReleased !== false) return null
  return { choice, disposition, resumeReleased: false }
}

function source(
  input: ProjectionInput,
  event: RuntimeFindingEvent,
  truth: ThreadTruth,
  decision: Record<string, unknown>,
): ProjectionResult {
  return {
    bindings: [{
      threadId: input.threadId,
      userId: input.userId,
      projectId: input.projectId,
      sourceKind: "governance_event",
      sourceId: String(event.id),
      role: "member",
    }],
    sources: [{
      kind: "governance_event",
      id: String(event.id),
      userId: input.userId,
      occurredAt: event.createdAt,
      truth,
      drilldown: { mode: "UNAVAILABLE", href: null },
      data: {
        eventType: event.eventType,
        decision,
      },
    }],
  }
}

export function projectRuntimeFindingDecisionSources(input: ProjectionInput): ProjectionResult {
  if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0 || !input.threadId || !input.workOrder.ref) {
    return { bindings: [], sources: [] }
  }
  const result: { bindings: ThreadBindingInput[]; sources: ThreadSourceInput[] } = { bindings: [], sources: [] }
  const gateEvents = input.events
    .filter((event) => boundEvent(event, input) && event.eventType === "RUNTIME_FINDING_OWNER_GATED")
    .sort((left, right) => left.id - right.id)
  for (const gateEvent of gateEvents) {
    const gateMetadata = record(gateEvent.metadata)
    const normalizedGates = gates(gateMetadata?.gates)
    const sourceFindingEventId = positiveInteger(gateMetadata?.sourceFindingEventId)
    const sourceEvents = input.events.filter((event) => (
      boundEvent(event, input)
      && event.eventType === "RUNTIME_OBJECTIVE_FINDING_RECORDED"
      && event.id === sourceFindingEventId
    ))
    const sourceMetadata = sourceEvents.length === 1 ? record(sourceEvents[0].metadata) : null
    const gateValid = gateMetadata !== null
      && normalizedGates !== null
      && gateMetadata.sourceUserId === input.userId
      && gateMetadata.objectiveWorkOrderId === input.workOrder.ref
      && text(gateMetadata.findingId) !== null
      && text(gateMetadata.gate) !== null
      && normalizedGates.includes(String(gateMetadata.gate))
      && sourceMetadata !== null
      && sourceMetadata.findingId === gateMetadata.findingId
      && sourceMetadata.objectiveWorkOrderId === input.workOrder.ref
    const receiptEvents = input.events.filter((event) => {
      if (!boundEvent(event, input) || event.eventType !== "RUNTIME_FINDING_OWNER_DECIDED") return false
      const receiptMetadata = record(event.metadata)
      return positiveInteger(receiptMetadata?.gateSettlementEventId) === gateEvent.id
        || positiveInteger(receiptMetadata?.sourceFindingEventId) === sourceFindingEventId
        || receiptMetadata?.findingId === gateMetadata?.findingId
    })
    const receipts = receiptEvents.map((event) => exactReceipt(event, input, gateEvent, gateMetadata ?? {}, normalizedGates ?? []))
    const receiptConflict = receiptEvents.length > 1 || receipts.some((receipt) => receipt === null)
    const actionable = requestMatches(input.actionableRequest, input, gateEvent, gateMetadata ?? {}, normalizedGates ?? [])
    let projection: ProjectionResult = { bindings: [], sources: [] }
    if ((!gateValid || receiptConflict) && (receiptEvents.length > 0 || actionable)) {
      projection = source(input, gateEvent, {
        basis: "PERSISTED", state: "CONFLICTING", detail: "Runtime finding decision binding is conflicting",
      }, { state: "CONFLICTING" })
    } else if (gateValid && receiptEvents.length === 1 && receipts[0]) {
      projection = source(input, receiptEvents[0], {
        basis: "PERSISTED", state: "RECORDED", detail: "Authenticated runtime finding decision receipt",
      }, { state: "OWNER_DECIDED", ...receipts[0] })
    } else if (gateValid && actionable && input.actionableRequest) {
      const packet = record(input.actionableRequest.decisionPacket) ?? {}
      projection = source(input, gateEvent, {
        basis: "PERSISTED", state: "CURRENT", detail: "Canonical runtime finding decision request",
      }, {
        state: "ACTIONABLE",
        why: text(gateMetadata.reason) ?? "Owner authority is required for this gated finding.",
        blockedAction: text(packet.blockedAction) ?? "Gated runtime work remains blocked.",
        gates: normalizedGates,
        recommendation: text(input.actionableRequest.recommendation) ?? "DENY",
        recommendationRationale: text(input.actionableRequest.recommendationRationale),
        choices: ["APPROVE", "DENY"],
        consequences: {
          APPROVE: text(packet.approveConsequence) ?? "Record approval without executing gated work.",
          DENY: text(packet.denyConsequence) ?? "Resolve the finding as denied without executing gated work.",
        },
      })
    }
    result.bindings.push(...projection.bindings)
    result.sources.push(...projection.sources)
  }
  return result
}
