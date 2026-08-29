export const MAX_COUNCIL_HISTORY = 6
export const MAX_COUNCIL_HISTORY_BYTES = 262_144

export type CouncilContextKind = "space" | "file" | "preview" | "diff" | "agent" | "selection"
export type CouncilDispositionDirection = "approve" | "reject" | "request-changes"
export type CouncilDisposition = Readonly<{
  direction: CouncilDispositionDirection
  recordedAt: string
}>

export type CouncilSession = Readonly<{
  id: string
  question: string
  status: "ready"
  createdAt: string
  context: Readonly<{ spaceName: string; kind: CouncilContextKind; label: string }>
  members: readonly Readonly<{
    id: string
    role: string
    name: string
    provider: string
    model: string
    status: "ready" | "dissenting"
    perspective: string
  }>[]
  consensus: string
  dissent: string
  blindSpot: string
  recommendation: string
  confidence: number
  evidence: readonly Readonly<{ id: string; label: string; detail: string }>[]
  /** Owner direction only. This record carries no execution authority and dispatches nothing. */
  disposition: CouncilDisposition | null
}>

function record(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], error: string): void {
  const expectedSet = new Set(expected)
  if (Object.keys(value).length !== expected.length || Object.keys(value).some((key) => !expectedSet.has(key))) {
    throw new Error(error)
  }
}

function text(value: unknown, max: number, error: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\0")) throw new Error(error)
  return value.trim()
}

function iso(value: unknown, error = "COUNCIL_SESSION_CREATED_AT_INVALID"): string {
  const result = text(value, 40, error)
  const parsed = Date.parse(result)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) throw new Error(error)
  return result
}

export function validateCouncilDisposition(raw: unknown): CouncilDisposition | null {
  if (raw === null) return null
  const disposition = record(raw, "COUNCIL_DISPOSITION_MALFORMED")
  exactKeys(disposition, ["direction", "recordedAt"], "COUNCIL_DISPOSITION_UNKNOWN_KEY")
  if (disposition.direction !== "approve" && disposition.direction !== "reject" && disposition.direction !== "request-changes") {
    throw new Error("COUNCIL_DISPOSITION_DIRECTION_INVALID")
  }
  return {
    direction: disposition.direction,
    recordedAt: iso(disposition.recordedAt, "COUNCIL_DISPOSITION_RECORDED_AT_INVALID"),
  }
}

export function validateCouncilSession(raw: unknown): CouncilSession {
  const original = record(raw, "COUNCIL_SESSION_MALFORMED")
  // Additive migration for advisory sessions persisted before owner direction was durable.
  const session = original.disposition === undefined ? { ...original, disposition: null } : original
  exactKeys(session, [
    "id", "question", "status", "createdAt", "context", "members", "consensus", "dissent", "blindSpot",
    "recommendation", "confidence", "evidence", "disposition",
  ], "COUNCIL_SESSION_UNKNOWN_KEY")
  if (session.status !== "ready") throw new Error("COUNCIL_SESSION_STATUS_INVALID")
  const context = record(session.context, "COUNCIL_SESSION_CONTEXT_MALFORMED")
  exactKeys(context, ["spaceName", "kind", "label"], "COUNCIL_SESSION_CONTEXT_UNKNOWN_KEY")
  const kinds = new Set<CouncilContextKind>(["space", "file", "preview", "diff", "agent", "selection"])
  if (!kinds.has(context.kind as CouncilContextKind)) throw new Error("COUNCIL_SESSION_CONTEXT_KIND_INVALID")
  if (!Array.isArray(session.members) || session.members.length < 1 || session.members.length > 5) throw new Error("COUNCIL_SESSION_MEMBERS_INVALID")
  const memberIds = new Set<string>()
  const members = session.members.map((rawMember) => {
    const member = record(rawMember, "COUNCIL_SESSION_MEMBER_MALFORMED")
    exactKeys(member, ["id", "role", "name", "provider", "model", "status", "perspective"], "COUNCIL_SESSION_MEMBER_UNKNOWN_KEY")
    const id = text(member.id, 80, "COUNCIL_SESSION_MEMBER_ID_INVALID")
    if (memberIds.has(id)) throw new Error("COUNCIL_SESSION_MEMBER_ID_DUPLICATE")
    memberIds.add(id)
    if (member.status !== "ready" && member.status !== "dissenting") throw new Error("COUNCIL_SESSION_MEMBER_STATUS_INVALID")
    return {
      id,
      role: text(member.role, 80, "COUNCIL_SESSION_MEMBER_ROLE_INVALID"),
      name: text(member.name, 80, "COUNCIL_SESSION_MEMBER_NAME_INVALID"),
      provider: text(member.provider, 200, "COUNCIL_SESSION_MEMBER_PROVIDER_INVALID"),
      model: text(member.model, 200, "COUNCIL_SESSION_MEMBER_MODEL_INVALID"),
      status: member.status,
      perspective: text(member.perspective, 4_000, "COUNCIL_SESSION_MEMBER_PERSPECTIVE_INVALID"),
    } as const
  })
  if (!Array.isArray(session.evidence) || session.evidence.length < 1 || session.evidence.length > 12) throw new Error("COUNCIL_SESSION_EVIDENCE_INVALID")
  const evidenceIds = new Set<string>()
  const evidence = session.evidence.map((rawEvidence) => {
    const item = record(rawEvidence, "COUNCIL_SESSION_EVIDENCE_MALFORMED")
    exactKeys(item, ["id", "label", "detail"], "COUNCIL_SESSION_EVIDENCE_UNKNOWN_KEY")
    const id = text(item.id, 100, "COUNCIL_SESSION_EVIDENCE_ID_INVALID")
    if (evidenceIds.has(id)) throw new Error("COUNCIL_SESSION_EVIDENCE_ID_DUPLICATE")
    evidenceIds.add(id)
    return {
      id,
      label: text(item.label, 200, "COUNCIL_SESSION_EVIDENCE_LABEL_INVALID"),
      detail: text(item.detail, 2_000, "COUNCIL_SESSION_EVIDENCE_DETAIL_INVALID"),
    }
  })
  const confidence = session.confidence
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) throw new Error("COUNCIL_SESSION_CONFIDENCE_INVALID")
  return {
    id: text(session.id, 200, "COUNCIL_SESSION_ID_INVALID"),
    question: text(session.question, 4_000, "COUNCIL_SESSION_QUESTION_INVALID"),
    status: "ready",
    createdAt: iso(session.createdAt),
    context: {
      spaceName: text(context.spaceName, 500, "COUNCIL_SESSION_SPACE_INVALID"),
      kind: context.kind as CouncilContextKind,
      label: text(context.label, 500, "COUNCIL_SESSION_LABEL_INVALID"),
    },
    members,
    consensus: text(session.consensus, 4_000, "COUNCIL_SESSION_CONSENSUS_INVALID"),
    dissent: text(session.dissent, 4_000, "COUNCIL_SESSION_DISSENT_INVALID"),
    blindSpot: text(session.blindSpot, 4_000, "COUNCIL_SESSION_BLIND_SPOT_INVALID"),
    recommendation: text(session.recommendation, 4_000, "COUNCIL_SESSION_RECOMMENDATION_INVALID"),
    confidence: Math.round(confidence),
    evidence,
    disposition: validateCouncilDisposition(session.disposition),
  }
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function validateCouncilHistory(raw: unknown): readonly CouncilSession[] {
  if (!Array.isArray(raw) || raw.length > MAX_COUNCIL_HISTORY) throw new Error("COUNCIL_HISTORY_INVALID")
  const ids = new Set<string>()
  const history = raw.map((item) => {
    const session = validateCouncilSession(item)
    if (ids.has(session.id)) throw new Error("COUNCIL_HISTORY_DUPLICATE")
    ids.add(session.id)
    return session
  })
  if (byteLength(history) > MAX_COUNCIL_HISTORY_BYTES) throw new Error("COUNCIL_HISTORY_TOO_LARGE")
  return history
}

export function addCouncilSession(history: readonly CouncilSession[], rawSession: unknown): readonly CouncilSession[] {
  const session = validateCouncilSession(rawSession)
  const next = [...history.filter((item) => item.id !== session.id), session]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  while (next.length > MAX_COUNCIL_HISTORY || byteLength(next) > MAX_COUNCIL_HISTORY_BYTES) next.shift()
  if (!next.some((item) => item.id === session.id)) throw new Error("COUNCIL_SESSION_TOO_LARGE")
  return validateCouncilHistory(next)
}

/** Replace one exact target while deterministically pruning the oldest non-target advice for bytes. */
export function replaceCouncilSessionBounded(
  history: readonly CouncilSession[],
  rawSession: unknown,
): readonly CouncilSession[] {
  const session = validateCouncilSession(rawSession)
  if (!history.some((item) => item.id === session.id)) throw new Error("COUNCIL_SESSION_NOT_FOUND")
  const next = history
    .map((item) => item.id === session.id ? session : item)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  while (byteLength(next) > MAX_COUNCIL_HISTORY_BYTES) {
    const oldestNonTarget = next.findIndex((item) => item.id !== session.id)
    if (oldestNonTarget < 0) throw new Error("COUNCIL_SESSION_TOO_LARGE")
    next.splice(oldestNonTarget, 1)
  }
  return validateCouncilHistory(next)
}
