import { createHash } from "node:crypto"

import type { ThreadBindingInput, ThreadSourceInput, ThreadTruth } from "@/lib/workbench/thread-projection"
import { projectRuntimeFindingActionability } from "@/scripts/hermes-bridge/runtime-finding-decision.mjs"
import {
  primaryDecisionRequestDigest,
  PRIMARY_DECISION_OWNER_EMAIL,
} from "@/scripts/hermes-bridge/primary-decision-provenance.mjs"

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

type RuntimeFindingRequest = Readonly<Record<string, unknown>>

type ProjectionInput = Readonly<{
  userId: string
  projectId: number
  thread: Readonly<{ id: string; workOrderId: number }>
  workOrder: WorkOrderIdentity
  events: readonly RuntimeFindingEvent[]
  actionableRequest: RuntimeFindingRequest | readonly RuntimeFindingRequest[] | null
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

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function digest(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null
}

function requests(value: ProjectionInput["actionableRequest"]): RuntimeFindingRequest[] {
  if (Array.isArray(value)) return value as RuntimeFindingRequest[]
  return value ? [value as RuntimeFindingRequest] : []
}

function boundEvent(event: RuntimeFindingEvent, input: ProjectionInput): boolean {
  return event.userId === input.userId
    && event.entityType === "work_order"
    && event.entityId === String(input.workOrder.id)
}

function exactRequest(
  request: RuntimeFindingRequest | null,
  input: ProjectionInput,
  gateEvent: RuntimeFindingEvent,
  gateMetadata: Record<string, unknown>,
  normalizedGates: readonly string[],
  sourceMetadata: Record<string, unknown>,
): request is RuntimeFindingRequest {
  if (!request) return false
  const packet = record(request.decisionPacket)
  const projection = projectRuntimeFindingActionability({
    parentWorkOrderRowId: request.parentWorkOrderRowId,
    parentWorkOrderRef: request.parentWorkOrderRef,
    authorityGrantId: request.authorityGrantId,
    authorityGrantRef: request.authorityGrantRef,
    authorityGrantLevel: request.authorityGrantLevel,
    sourceFindingEventId: request.sourceFindingEventId,
    gateSettlementEventId: request.gateSettlementEventId,
    findingId: request.findingId,
    sequence: request.sequence,
    gates: request.gates,
  })
  const canonicalGate = {
    sourceFindingEventId: positiveInteger(gateMetadata.sourceFindingEventId),
    sourceUserId: gateMetadata.sourceUserId,
    findingId: gateMetadata.findingId,
    objectiveWorkOrderId: gateMetadata.objectiveWorkOrderId,
    issueNumber: gateMetadata.issueNumber,
    gate: gateMetadata.gate,
    gates: normalizedGates,
    reason: gateMetadata.reason,
  }
  return input.thread.workOrderId === input.workOrder.id
    && request.sourceKind === "RUNTIME_FINDING"
    && request.ownerUserId === input.userId
    && positiveInteger(request.parentWorkOrderRowId) === input.workOrder.id
    && request.parentWorkOrderRef === input.workOrder.ref
    && positiveInteger(request.sourceFindingEventId) === positiveInteger(gateMetadata.sourceFindingEventId)
    && positiveInteger(request.gateSettlementEventId) === gateEvent.id
    && request.findingId === gateMetadata.findingId
    && request.gate === gateMetadata.gate
    && sameStrings(gates(request.gates) ?? [], normalizedGates)
    && positiveInteger(request.authorityGrantId) !== null
    && text(request.authorityGrantRef) !== null
    && ["A2_WRITE_OWN", "A3_INTEGRATE"].includes(text(request.authorityGrantLevel) ?? "")
    && positiveInteger(request.sequence) === positiveInteger(sourceMetadata.sequence)
    && digest(request.sourcePayloadDigest) === sha256(JSON.stringify(sourceMetadata))
    && digest(gateMetadata.payloadDigest) === sha256(JSON.stringify(canonicalGate))
    && request.gatePayloadDigest === gateMetadata.payloadDigest
    && request.actionableProjectionId === projection.id
    && positiveInteger(request.actionableProjectionVersion) === projection.version
    && request.actionableProjectionDigest === projection.digest
    && packet !== null
    && digest(request.decisionPacketDigest) === sha256(JSON.stringify(packet))
}

function exactReceipt(
  event: RuntimeFindingEvent,
  input: ProjectionInput,
  gateEvent: RuntimeFindingEvent,
  gateMetadata: Record<string, unknown>,
  normalizedGates: readonly string[],
  sourceMetadata: Record<string, unknown>,
  liveRequest: RuntimeFindingRequest | null,
): Record<string, unknown> | null {
  if (!boundEvent(event, input) || event.eventType !== "RUNTIME_FINDING_OWNER_DECIDED") return null
  const metadata = record(event.metadata)
  const choice = text(metadata?.choice)
  const disposition = text(metadata?.disposition)
  const bindingKeys = [
    "sourceKind", "ownerUserId", "parentWorkOrderRowId", "parentWorkOrderRef", "authorityGrantId",
    "authorityGrantRef", "authorityGrantLevel", "sourceFindingEventId", "sourcePayloadDigest",
    "gateSettlementEventId", "gatePayloadDigest", "actionableProjectionId", "actionableProjectionVersion",
    "actionableProjectionDigest", "findingId", "sequence", "gate", "gates", "decisionPacketDigest",
  ]
  const allowedReceiptKeys = new Set([
    ...bindingKeys, "choice", "requestDigest", "responseDigest", "accountEmail", "disposition",
    "resumeReleased", "receiptDigest", "decisionId", "evidenceId",
  ])
  const liveBindingMatches = liveRequest === null
    || bindingKeys.every((key) => canonical(metadata?.[key]) === canonical(liveRequest[key]))
  const receiptPayload = metadata ? Object.fromEntries(Object.entries(metadata).filter(([key]) => (
    !["receiptDigest", "decisionId", "evidenceId"].includes(key)
  ))) : null
  const projection = metadata ? projectRuntimeFindingActionability({
    parentWorkOrderRowId: metadata.parentWorkOrderRowId,
    parentWorkOrderRef: metadata.parentWorkOrderRef,
    authorityGrantId: metadata.authorityGrantId,
    authorityGrantRef: metadata.authorityGrantRef,
    authorityGrantLevel: metadata.authorityGrantLevel,
    sourceFindingEventId: metadata.sourceFindingEventId,
    gateSettlementEventId: metadata.gateSettlementEventId,
    findingId: metadata.findingId,
    sequence: metadata.sequence,
    gates: metadata.gates,
  }) : null
  const canonicalGate = {
    sourceFindingEventId: positiveInteger(gateMetadata.sourceFindingEventId),
    sourceUserId: gateMetadata.sourceUserId,
    findingId: gateMetadata.findingId,
    objectiveWorkOrderId: gateMetadata.objectiveWorkOrderId,
    issueNumber: gateMetadata.issueNumber,
    gate: gateMetadata.gate,
    gates: normalizedGates,
    reason: gateMetadata.reason,
  }
  if (!metadata
    || !liveBindingMatches
    || Object.keys(metadata).some((key) => !allowedReceiptKeys.has(key))
    || metadata.sourceKind !== "RUNTIME_FINDING"
    || metadata.ownerUserId !== input.userId
    || positiveInteger(metadata.parentWorkOrderRowId) !== input.workOrder.id
    || metadata.parentWorkOrderRef !== input.workOrder.ref
    || positiveInteger(metadata.sourceFindingEventId) !== positiveInteger(gateMetadata.sourceFindingEventId)
    || positiveInteger(metadata.gateSettlementEventId) !== gateEvent.id
    || metadata.findingId !== gateMetadata.findingId
    || metadata.gate !== gateMetadata.gate
    || !sameStrings(gates(metadata.gates) ?? [], normalizedGates)
    || positiveInteger(metadata.authorityGrantId) === null
    || text(metadata.authorityGrantRef) === null
    || !["A2_WRITE_OWN", "A3_INTEGRATE"].includes(text(metadata.authorityGrantLevel) ?? "")
    || positiveInteger(metadata.sequence) !== positiveInteger(sourceMetadata.sequence)
    || digest(metadata.sourcePayloadDigest) !== sha256(JSON.stringify(sourceMetadata))
    || digest(gateMetadata.payloadDigest) !== sha256(JSON.stringify(canonicalGate))
    || metadata.gatePayloadDigest !== gateMetadata.payloadDigest
    || projection === null
    || metadata.actionableProjectionId !== projection.id
    || positiveInteger(metadata.actionableProjectionVersion) !== projection.version
    || metadata.actionableProjectionDigest !== projection.digest
    || digest(metadata.decisionPacketDigest) === null
    || !["APPROVE", "DENY"].includes(choice ?? "")
    || !["AUTHORITY_MATERIALIZATION_REQUIRED", "DENIED_RESOLVED"].includes(disposition ?? "")
    || (choice === "APPROVE" && disposition !== "AUTHORITY_MATERIALIZATION_REQUIRED")
    || (choice === "DENY" && disposition !== "DENIED_RESOLVED")
    || metadata.resumeReleased !== false
    || (liveRequest === null
      ? digest(metadata.requestDigest) === null
      : digest(metadata.requestDigest) !== primaryDecisionRequestDigest(liveRequest))
    || digest(metadata.responseDigest) === null
    || text(metadata.accountEmail)?.toLowerCase() !== PRIMARY_DECISION_OWNER_EMAIL
    || digest(metadata.receiptDigest) !== sha256(canonical(receiptPayload))
    || positiveInteger(metadata.decisionId) === null
    || positiveInteger(metadata.evidenceId) === null) return null
  return {
    choice,
    disposition,
    resumeReleased: false,
  }
}

function source(
  input: ProjectionInput,
  event: RuntimeFindingEvent,
  truth: ThreadTruth,
  decision: Record<string, unknown>,
): ProjectionResult {
  return {
    bindings: [{
      threadId: input.thread.id,
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
  if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0 || !input.thread.id
    || input.thread.workOrderId !== input.workOrder.id || !input.workOrder.ref) {
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
    let canonicalRequest: RuntimeFindingRequest | null = null
    if (gateMetadata && normalizedGates && sourceMetadata) {
      canonicalRequest = requests(input.actionableRequest).find((request) => {
        try {
          return exactRequest(request, input, gateEvent, gateMetadata, normalizedGates, sourceMetadata)
        } catch {
          return false
        }
      }) ?? null
    }
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
    const receipts = gateMetadata && normalizedGates && sourceMetadata
      ? receiptEvents.map((event) => {
        try {
          return exactReceipt(event, input, gateEvent, gateMetadata, normalizedGates, sourceMetadata, canonicalRequest)
        } catch {
          return null
        }
      })
      : receiptEvents.map(() => null)
    const receiptConflict = receiptEvents.length > 1 || receipts.some((receipt) => receipt === null)
    const actionable = canonicalRequest !== null
    let projection: ProjectionResult = { bindings: [], sources: [] }
    if ((!gateValid || receiptConflict) && (receiptEvents.length > 0 || actionable)) {
      projection = source(input, gateEvent, {
        basis: "PERSISTED", state: "CONFLICTING", detail: "Runtime finding decision binding is conflicting",
      }, { state: "CONFLICTING" })
    } else if (gateValid && receiptEvents.length === 1 && receipts[0]) {
      projection = source(input, receiptEvents[0], {
        basis: "PERSISTED", state: "RECORDED", detail: "Authenticated runtime finding decision receipt",
      }, { state: "OWNER_DECIDED", ...receipts[0] })
    } else if (gateValid && actionable && canonicalRequest) {
      const packet = record(canonicalRequest.decisionPacket) ?? {}
      projection = source(input, gateEvent, {
        basis: "PERSISTED", state: "CURRENT", detail: "Canonical runtime finding decision request",
      }, {
        state: "ACTIONABLE",
        why: text(gateMetadata.reason) ?? "Owner authority is required for this gated finding.",
        blockedAction: text(packet.blockedAction) ?? "Gated runtime work remains blocked.",
        gates: normalizedGates,
        recommendation: text(canonicalRequest.recommendation) ?? "DENY",
        recommendationRationale: text(canonicalRequest.recommendationRationale),
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
