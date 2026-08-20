export type ThreadItemKind =
  | "OWNER_INTENT"
  | "WILLIAMOS_RESPONSE"
  | "WORK_STATE"
  | "VALIDATION"
  | "REVIEW"
  | "REMEDIATION"
  | "ARTIFACT_DELIVERY"
  | "DECISION"
  | "SYSTEM_RECOVERY"

export type ThreadSourceKind =
  | "goal"
  | "outcome_queue_item"
  | "work_order"
  | "conversation_message"
  | "governance_event"
  | "evidence_record"
  | "decision"
  | "event_log"
  | "loop_run"
  | "artifact"

export type ThreadTruthBasis = "PERSISTED" | "LIVE_OBSERVATION" | "INFERRED" | "UNKNOWN"
export type ThreadTruthState = "RECORDED" | "CURRENT" | "STALE" | "MISSING" | "CONFLICTING" | "UNKNOWN"

export type ThreadTruth = Readonly<{
  basis: ThreadTruthBasis
  state: ThreadTruthState
  detail: string | null
}>

export type ThreadDrilldown = Readonly<{
  mode: "EXACT" | "REGISTER" | "UNAVAILABLE"
  href: string | null
}>

export type ThreadRecordInput = Readonly<{
  id: string
  userId: string
  projectId: number
  projectKey: string
  projectName: string
  title: string
  rootSourceKind: ThreadSourceKind | null
  rootSourceId: string | null
  createdAt: Date
  updatedAt: Date
}>

export type ThreadBindingInput = Readonly<{
  threadId: string
  userId: string
  projectId: number
  sourceKind: ThreadSourceKind
  sourceId: string
  role: "root" | "member"
}>

export type ThreadExplicitLink = Readonly<{
  relation: string
  kind: ThreadSourceKind
  id: string
}>

export type ThreadSourceInput = Readonly<{
  kind: ThreadSourceKind
  id: string
  userId: string
  occurredAt: Date
  ref?: string | null
  mirrorKey?: string | null
  drilldown?: ThreadDrilldown
  truth?: ThreadTruth
  links?: readonly ThreadExplicitLink[]
  data: Readonly<Record<string, unknown>>
}>

export type ThreadProjectionInput = {
  userId: string
  projectId: number
  conversationPersistence: "AVAILABLE" | "MISSING"
  truncatedSourceKinds: readonly ThreadSourceKind[]
  threads: ThreadRecordInput[]
  bindings: ThreadBindingInput[]
  sources: ThreadSourceInput[]
}

export type ThreadSourceRef = Readonly<{
  kind: ThreadSourceKind
  id: string
  ref: string | null
  facet: string
  mirrorKey: string | null
  drilldown: ThreadDrilldown
}>

export type ThreadItem = Readonly<{
  id: string
  kind: ThreadItemKind
  occurredAt: Date
  actorRole: "OWNER" | "WILLIAMOS" | "WORKER" | "SYSTEM" | null
  title: string
  summary: string
  rawState: string | null
  truth: ThreadTruth
  source: ThreadSourceRef
  decision?: ThreadDecisionDetail
}>

export type ThreadDecisionDetail = Readonly<{
  state: "ACTIONABLE" | "OWNER_DECIDED" | "CONFLICTING"
  why?: string
  blockedAction?: string
  gates?: string[]
  recommendation?: "APPROVE" | "DENY"
  recommendationRationale?: string
  choices?: Array<"APPROVE" | "DENY">
  consequences?: Readonly<{ APPROVE: string; DENY: string }>
  choice?: "APPROVE" | "DENY"
  disposition?: "AUTHORITY_MATERIALIZATION_REQUIRED" | "DENIED_RESOLVED"
  resumeReleased?: false
  decisionId?: number
  evidenceId?: number
}>

export type ThreadCoverage = Readonly<{
  truncated: boolean
  truncatedSourceKinds: ThreadSourceKind[]
  missingSources: string[]
  conflicts: string[]
  conversation: "AVAILABLE" | "MISSING"
}>

export type Thread = Readonly<{
  id: string
  project: Readonly<{ id: number; key: string; name: string }>
  title: string
  createdAt: Date
  lastActivityAt: Date
  coverage: ThreadCoverage
  items: ThreadItem[]
}>

const DEFAULT_TRUTH: ThreadTruth = {
  basis: "PERSISTED",
  state: "RECORDED",
  detail: null,
}

const SOURCE_ORDER: Record<ThreadSourceKind, number> = {
  goal: 0,
  conversation_message: 1,
  outcome_queue_item: 2,
  work_order: 3,
  governance_event: 4,
  evidence_record: 5,
  decision: 6,
  event_log: 7,
  loop_run: 8,
  artifact: 9,
}

const FACET_ORDER: Record<string, number> = {
  "owner-intent": 0,
  "williamos-response": 1,
  "work-state": 2,
  validation: 3,
  review: 4,
  remediation: 5,
  "artifact-delivery": 6,
  decision: 7,
  "system-recovery": 8,
}

const VALIDATION_STATES = new Set([
  "VALIDATING",
  "VALIDATION_PASSED",
  "VALIDATION_FAILED",
  "HOST_VALIDATION_STARTED",
  "HOST_VALIDATION_PASSED",
  "CI_RUNNING",
  "CI_PASSED",
  "CI_FAILED",
])

const REVIEW_STATES = new Set([
  "INDEPENDENT_REVIEW",
  "REVIEW_PENDING",
  "REVIEW_APPROVED",
  "REVIEW_CHANGES_REQUESTED",
])

const REMEDIATION_STATES = new Set([
  "REMEDIATING",
  "REVIEW_REMEDIATION_REQUIRED",
  "VALIDATION_REMEDIATION_REQUIRED",
])

const DELIVERY_STATES = new Set([
  "COMMIT_CREATED",
  "PR_OPEN",
  "PR_MERGED",
  "MERGED",
  "DELIVERED",
  "DEPENDENTS_RELEASED",
])

const RECOVERY_STATES = new Set([
  "REVIEW_REMEDIATION_RECOVERED",
  "VALIDATION_INFRASTRUCTURE_RECOVERED",
  "POST_MERGE_CLEANUP_RECOVERED",
  "EXTERNAL_TOOL_WALL_RECOVERED",
  "PROVIDER_RECOVERED",
])

const RECOVERY_EVENT_TYPES = new Set([
  "HERMES_OUTCOME_PROVIDER_RECOVERED",
  "HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED",
  "HERMES_OUTCOME_REVIEW_RECOVERED",
  "HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED",
])

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function safeText(value: unknown, fallback: string): string {
  const candidate = text(value) ?? fallback
  return candidate
    .replace(/\b(?:token|password|secret|leaseToken|acquisitionKey|executionBinding)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]")
    .slice(0, 2_000)
}

function truth(value: ThreadTruth | undefined): ThreadTruth {
  if (!value) return DEFAULT_TRUTH
  const bases = new Set<ThreadTruthBasis>(["PERSISTED", "LIVE_OBSERVATION", "INFERRED", "UNKNOWN"])
  const states = new Set<ThreadTruthState>(["RECORDED", "CURRENT", "STALE", "MISSING", "CONFLICTING", "UNKNOWN"])
  return bases.has(value.basis) && states.has(value.state)
    ? { basis: value.basis, state: value.state, detail: text(value.detail) }
    : { basis: "UNKNOWN", state: "UNKNOWN", detail: "Invalid source truth classification" }
}

function drilldown(value: ThreadDrilldown | undefined): ThreadDrilldown {
  if (!value || !["EXACT", "REGISTER", "UNAVAILABLE"].includes(value.mode)) {
    return { mode: "UNAVAILABLE", href: null }
  }
  const href = text(value.href)
  if (value.mode === "UNAVAILABLE" || !href || !href.startsWith("/")) {
    return { mode: "UNAVAILABLE", href: null }
  }
  return { mode: value.mode, href }
}

function sourceRef(source: ThreadSourceInput, facet: string): ThreadSourceRef {
  return {
    kind: source.kind,
    id: source.id,
    ref: text(source.ref),
    facet,
    mirrorKey: text(source.mirrorKey),
    drilldown: drilldown(source.drilldown),
  }
}

function item(
  source: ThreadSourceInput,
  facet: string,
  kind: ThreadItemKind,
  actorRole: ThreadItem["actorRole"],
  title: string,
  summary: string,
  rawState: string | null = null,
  decision?: ThreadDecisionDetail,
): ThreadItem {
  return {
    id: `${source.kind}:${source.id}:${facet}`,
    kind,
    occurredAt: source.occurredAt,
    actorRole,
    title: safeText(title, kind.replaceAll("_", " ")),
    summary: safeText(summary, "No safe summary recorded"),
    rawState,
    truth: truth(source.truth),
    source: sourceRef(source, facet),
    ...(decision ? { decision } : {}),
  }
}

function decisionDetail(value: unknown): ThreadDecisionDetail | null {
  const data = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
  const state = text(data?.state)
  if (!data || !["ACTIONABLE", "OWNER_DECIDED", "CONFLICTING"].includes(state ?? "")) return null
  if (state === "CONFLICTING") return { state }
  if (state === "OWNER_DECIDED") {
    const choice = text(data.choice)
    const disposition = text(data.disposition)
    const decisionId = Number(data.decisionId)
    const evidenceId = Number(data.evidenceId)
    if (!(["APPROVE", "DENY"].includes(choice ?? ""))
      || !(["AUTHORITY_MATERIALIZATION_REQUIRED", "DENIED_RESOLVED"].includes(disposition ?? ""))
      || data.resumeReleased !== false
      || !Number.isSafeInteger(decisionId) || decisionId <= 0
      || !Number.isSafeInteger(evidenceId) || evidenceId <= 0) return { state: "CONFLICTING" }
    return {
      state,
      choice: choice as "APPROVE" | "DENY",
      disposition: disposition as "AUTHORITY_MATERIALIZATION_REQUIRED" | "DENIED_RESOLVED",
      resumeReleased: false,
      decisionId,
      evidenceId,
    }
  }
  const normalizedGates = Array.isArray(data.gates)
    ? [...new Set(data.gates.map(text).filter((entry): entry is string => entry !== null))]
    : []
  const normalizedChoices = Array.isArray(data.choices)
    ? data.choices.map(text).filter((entry): entry is "APPROVE" | "DENY" => entry === "APPROVE" || entry === "DENY")
    : []
  const consequences = data.consequences !== null && typeof data.consequences === "object" && !Array.isArray(data.consequences)
    ? data.consequences as Record<string, unknown>
    : {}
  const recommendation = text(data.recommendation)
  if (normalizedGates.length === 0 || normalizedChoices.length !== 2
    || !text(data.why) || !text(data.blockedAction)
    || !["APPROVE", "DENY"].includes(recommendation ?? "")
    || !text(consequences.APPROVE) || !text(consequences.DENY)) return { state: "CONFLICTING" }
  return {
    state: "ACTIONABLE",
    why: safeText(data.why, "Owner authority is required."),
    blockedAction: safeText(data.blockedAction, "Gated runtime work remains blocked."),
    gates: normalizedGates.map((entry) => safeText(entry, "UNKNOWN")),
    recommendation: recommendation as "APPROVE" | "DENY",
    ...(text(data.recommendationRationale) ? { recommendationRationale: safeText(data.recommendationRationale, "") } : {}),
    choices: normalizedChoices,
    consequences: {
      APPROVE: safeText(consequences.APPROVE, "Record authority only."),
      DENY: safeText(consequences.DENY, "Resolve denied."),
    },
  }
}

function eventKind(state: string | null, eventType: string | null): ThreadItemKind {
  if ((state && RECOVERY_STATES.has(state)) || (eventType && RECOVERY_EVENT_TYPES.has(eventType))) {
    return "SYSTEM_RECOVERY"
  }
  if (state && VALIDATION_STATES.has(state)) return "VALIDATION"
  if (state && REVIEW_STATES.has(state)) return "REVIEW"
  if (state && REMEDIATION_STATES.has(state)) return "REMEDIATION"
  if (state && DELIVERY_STATES.has(state)) return "ARTIFACT_DELIVERY"
  return "WORK_STATE"
}

function eventFacet(kind: ThreadItemKind): string {
  if (kind === "SYSTEM_RECOVERY") return "system-recovery"
  if (kind === "ARTIFACT_DELIVERY") return "artifact-delivery"
  return kind.toLowerCase().replaceAll("_", "-")
}

function projectSource(source: ThreadSourceInput): ThreadItem[] {
  const data = source.data
  switch (source.kind) {
    case "goal": {
      const projected: ThreadItem[] = []
      const command = text(data.command)
      const response = text(data.response) ?? text(data.rationale) ?? text(data.recommendedMove)
      if (command) projected.push(item(source, "owner-intent", "OWNER_INTENT", "OWNER", "Owner intent", command))
      if (response) projected.push(item(
        source,
        "williamos-response",
        "WILLIAMOS_RESPONSE",
        "WILLIAMOS",
        "WilliamOS response",
        response,
        text(data.verdict),
      ))
      return projected
    }
    case "conversation_message": {
      const role = text(data.role)
      const content = text(data.content)
      if (!content || !["owner", "williamos"].includes(role ?? "")) return []
      return role === "owner"
        ? [item(source, "owner-intent", "OWNER_INTENT", "OWNER", "Owner intent", content)]
        : [item(source, "williamos-response", "WILLIAMOS_RESPONSE", "WILLIAMOS", "WilliamOS response", content)]
    }
    case "outcome_queue_item":
      return [item(
        source,
        "work-state",
        "WORK_STATE",
        "SYSTEM",
        text(data.title) ?? "Outcome",
        text(data.objective) ?? text(data.title) ?? "Outcome state recorded",
        text(data.lifecycleState) ?? text(data.state),
      )]
    case "work_order":
      return [item(
        source,
        "work-state",
        "WORK_STATE",
        "SYSTEM",
        text(data.title) ?? "Work Order",
        text(data.summary) ?? text(data.description) ?? text(data.title) ?? "Work Order state recorded",
        text(data.state) ?? text(data.status),
      )]
    case "governance_event":
    case "event_log": {
      const projectedDecision = decisionDetail(data.decision)
      if (source.kind === "governance_event" && projectedDecision) {
        return [item(
          source,
          "decision",
          "DECISION",
          "OWNER",
          projectedDecision.state === "ACTIONABLE"
            ? "Runtime finding needs your decision"
            : projectedDecision.state === "OWNER_DECIDED"
              ? "Runtime finding decision recorded"
              : "Runtime finding decision conflict",
          projectedDecision.why
            ?? (projectedDecision.state === "OWNER_DECIDED"
              ? `${projectedDecision.choice}: ${projectedDecision.disposition}`
              : "Decision receipt conflicts with its gated finding."),
          projectedDecision.state,
          projectedDecision,
        )]
      }
      const state = text(data.state) ?? text(data.checkpointState) ?? text(data.status)
      const eventType = text(data.eventType) ?? text(data.type)
      const kind = eventKind(state, eventType)
      return [item(
        source,
        eventFacet(kind),
        kind,
        kind === "SYSTEM_RECOVERY" ? "SYSTEM" : "WORKER",
        eventType ?? "System event",
        text(data.detail) ?? text(data.summary) ?? text(data.reason) ?? state ?? eventType ?? "System event recorded",
        state,
      )]
    }
    case "evidence_record": {
      const result = text(data.result)
      const summary = text(data.summary) ?? (result ? `Validation ${result}` : "Validation evidence recorded")
      const projected = [item(source, "validation", "VALIDATION", "SYSTEM", "Validation evidence", summary, result)]
      const artifactLabel = text(data.artifactLabel)
      const contentHash = text(data.contentHash)
      if (artifactLabel || contentHash) {
        projected.push(item(
          source,
          "artifact-delivery",
          "ARTIFACT_DELIVERY",
          "SYSTEM",
          "Artifact delivery",
          artifactLabel ?? "Hashed evidence artifact",
          result,
        ))
      }
      return projected
    }
    case "decision":
      return [item(
        source,
        "decision",
        "DECISION",
        "OWNER",
        text(data.title) ?? "Decision",
        text(data.decision) ?? "Decision recorded",
        text(data.status) ?? text(data.authority),
      )]
    case "loop_run":
      return [item(
        source,
        "work-state",
        "WORK_STATE",
        "SYSTEM",
        "Loop run",
        text(data.summary) ?? text(data.stopReason) ?? "Loop state recorded",
        text(data.status),
      )]
    case "artifact":
      return [item(
        source,
        "artifact-delivery",
        "ARTIFACT_DELIVERY",
        "SYSTEM",
        text(data.title) ?? "Artifact",
        text(data.label) ?? text(data.title) ?? "Artifact recorded",
        text(data.status),
      )]
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function sourceKey(kind: ThreadSourceKind, id: string): string {
  return `${kind}:${id}`
}

function itemSort(left: ThreadItem, right: ThreadItem): number {
  return left.occurredAt.getTime() - right.occurredAt.getTime()
    || SOURCE_ORDER[left.source.kind] - SOURCE_ORDER[right.source.kind]
    || left.source.id.localeCompare(right.source.id, "en", { numeric: true })
    || (FACET_ORDER[left.source.facet] ?? 99) - (FACET_ORDER[right.source.facet] ?? 99)
    || left.id.localeCompare(right.id)
}

function semanticItems(items: readonly ThreadItem[]): string {
  return canonical(items.map((entry) => ({
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    summary: entry.summary,
    rawState: entry.rawState,
    truth: entry.truth,
  })))
}

function projectThread(input: ThreadProjectionInput, thread: ThreadRecordInput): Thread {
  const conflicts: string[] = []
  const missingSources = input.conversationPersistence === "MISSING" ? ["conversation"] : []
  const validBindings: ThreadBindingInput[] = []

  for (const binding of input.bindings.filter((candidate) => candidate.threadId === thread.id)) {
    if (binding.userId !== input.userId) {
      conflicts.push(`TENANT_BINDING_MISMATCH:${thread.id}:${sourceKey(binding.sourceKind, binding.sourceId)}`)
    } else if (binding.projectId !== thread.projectId || binding.projectId !== input.projectId) {
      conflicts.push(`PROJECT_BINDING_MISMATCH:${thread.id}:${sourceKey(binding.sourceKind, binding.sourceId)}`)
    } else if (!validBindings.some((candidate) => canonical(candidate) === canonical(binding))) {
      validBindings.push(binding)
    }
  }

  const allRoots = validBindings.filter((binding) => binding.role === "root")
  let matchingRoots: ThreadBindingInput[] = []
  if (allRoots.length === 0 || thread.rootSourceKind === null || thread.rootSourceId === null) {
    conflicts.push(allRoots.length > 1
      ? `ROOT_BINDING_AMBIGUOUS:${thread.id}`
      : thread.rootSourceKind !== null && thread.rootSourceId !== null
        ? `ROOT_BINDING_MISSING:${thread.id}:${sourceKey(thread.rootSourceKind, thread.rootSourceId)}`
        : `ROOT_BINDING_MISSING:${thread.id}`)
  } else if (allRoots.length > 1) {
    conflicts.push(`ROOT_BINDING_AMBIGUOUS:${thread.id}`)
  } else {
    matchingRoots = allRoots.filter((binding) => (
      binding.sourceKind === thread.rootSourceKind
      && binding.sourceId === thread.rootSourceId
    ))
    if (matchingRoots.length === 0) {
      conflicts.push(`ROOT_BINDING_MISSING:${thread.id}:${sourceKey(thread.rootSourceKind, thread.rootSourceId)}`)
    }
  }
  const rootBindingValid = allRoots.length === 1 && matchingRoots.length === 1

  const sourceGroups = new Map<string, ThreadSourceInput[]>()
  for (const source of input.sources) {
    const key = sourceKey(source.kind, source.id)
    const group = sourceGroups.get(key) ?? []
    group.push(source)
    sourceGroups.set(key, group)
  }

  const projectedBySource: Array<{ source: ThreadSourceInput; items: ThreadItem[] }> = []
  for (const binding of rootBindingValid ? validBindings : []) {
    const key = sourceKey(binding.sourceKind, binding.sourceId)
    const matches = sourceGroups.get(key) ?? []
    const owned = matches.filter((source) => source.userId === input.userId)
    if (owned.length === 0) {
      if (matches.length > 0) conflicts.push(`SOURCE_TENANT_MISMATCH:${key}`)
      missingSources.push(key)
      continue
    }
    const representations = new Set(owned.map(canonical))
    if (representations.size > 1) {
      conflicts.push(`SOURCE_CONFLICT:${key}`)
      continue
    }
    const source = owned[0]
    const linksByRelation = new Map<string, Set<string>>()
    for (const link of source.links ?? []) {
      const targets = linksByRelation.get(link.relation) ?? new Set<string>()
      targets.add(sourceKey(link.kind, link.id))
      linksByRelation.set(link.relation, targets)
    }
    for (const [relation, targets] of linksByRelation) {
      if (targets.size > 1) conflicts.push(`LINK_CONFLICT:${key}:${relation}`)
    }
    projectedBySource.push({ source, items: projectSource(source) })
  }

  const mirrorGroups = new Map<string, Array<{ source: ThreadSourceInput; items: ThreadItem[] }>>()
  const withoutMirrors: ThreadItem[] = []
  for (const projection of projectedBySource) {
    const mirrorKey = text(projection.source.mirrorKey)
    if (!mirrorKey) {
      withoutMirrors.push(...projection.items)
      continue
    }
    const group = mirrorGroups.get(mirrorKey) ?? []
    group.push(projection)
    mirrorGroups.set(mirrorKey, group)
  }

  const mirroredItems: ThreadItem[] = []
  for (const [mirrorKey, projections] of mirrorGroups) {
    if (new Set(projections.map((projection) => semanticItems(projection.items))).size > 1) {
      conflicts.push(`MIRROR_CONFLICT:${mirrorKey}`)
      continue
    }
    projections.sort((left, right) => (
      SOURCE_ORDER[left.source.kind] - SOURCE_ORDER[right.source.kind]
      || left.source.id.localeCompare(right.source.id, "en", { numeric: true })
    ))
    mirroredItems.push(...projections[0].items)
  }

  const itemsById = new Map<string, ThreadItem>()
  for (const projected of [...withoutMirrors, ...mirroredItems]) {
    const existing = itemsById.get(projected.id)
    if (!existing) {
      itemsById.set(projected.id, projected)
    } else if (canonical(existing) !== canonical(projected)) {
      conflicts.push(`ITEM_CONFLICT:${projected.id}`)
      itemsById.delete(projected.id)
    }
  }
  const items = [...itemsById.values()].sort(itemSort)
  const lastActivityAt = items.reduce(
    (latest, current) => current.occurredAt.getTime() > latest.getTime() ? current.occurredAt : latest,
    thread.createdAt,
  )
  const truncatedSourceKinds = uniqueStrings(input.truncatedSourceKinds) as ThreadSourceKind[]

  return {
    id: thread.id,
    project: { id: thread.projectId, key: thread.projectKey, name: thread.projectName },
    title: safeText(thread.title, "Untitled Thread"),
    createdAt: thread.createdAt,
    lastActivityAt,
    coverage: {
      truncated: truncatedSourceKinds.length > 0,
      truncatedSourceKinds,
      missingSources: uniqueStrings(missingSources),
      conflicts: uniqueStrings(conflicts),
      conversation: input.conversationPersistence,
    },
    items,
  }
}

export function projectWorkbenchThreads(input: ThreadProjectionInput): Thread[] {
  return input.threads
    .filter((thread) => thread.userId === input.userId && thread.projectId === input.projectId)
    .map((thread) => projectThread(input, thread))
    .sort((left, right) => (
      right.lastActivityAt.getTime() - left.lastActivityAt.getTime()
      || left.id.localeCompare(right.id, "en", { numeric: true })
    ))
}
