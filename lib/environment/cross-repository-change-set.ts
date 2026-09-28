import { pool } from "@/lib/db"
import { loadOwnedWorkingWorld } from "@/lib/environment/space-persistence"
import { CORE_SEVEN_REPOSITORIES } from "@/lib/projects/core-seven-repositories"

export const CROSS_REPOSITORY_CHANGE_SET_VERSION = "williamos-cross-repository-change-set.v1" as const

type NullableProject = Readonly<{ id: number; key: string; name: string }> | null
type NullableOutcome = Readonly<{ key: string; title: string }> | null

export type CrossRepositoryWorkOrderFact = Readonly<{
  id: number
  ref: string | null
  title: string
  status: string
  result: string | null
  commitRef: string | null
}>

export type CrossRepositoryEvidenceFact = Readonly<{
  id: number
  workOrderId: number
  result: string
  repository: string | null
  branch: string | null
  revision: string | null
  filesChanged: readonly string[]
  createdAt: string
}>

export type CrossRepositoryEventFact = Readonly<{
  id: number
  eventType: string
  entityType: string | null
  metadata: unknown
  createdAt: string
}>

export type CrossRepositoryChangeSetFacts = Readonly<{
  worldId: string
  project: NullableProject
  outcome: NullableOutcome
  workOrders: readonly CrossRepositoryWorkOrderFact[]
  evidence: readonly CrossRepositoryEvidenceFact[]
  events: readonly CrossRepositoryEventFact[]
}>

export type CrossRepositoryChangeSetUnit = Readonly<{
  id: string
  workOrder: Readonly<{
    id: number
    ref: string | null
    title: string
    status: string
    result: string | null
  }>
  repository: Readonly<{ key: string; identity: string }>
  git: Readonly<{
    branch: string | null
    revision: string | null
    pullRequest: number | null
    paths: readonly string[]
  }>
  validation: Readonly<{ state: "pending" | "passed" | "failed"; headSha: string | null }>
  review: Readonly<{ state: "pending" | "approved" | "changes-requested"; headSha: string | null }>
  delivery: Readonly<{ state: "pending" | "sealed"; headSha: string | null }>
  limitations: readonly string[]
}>

export type CrossRepositoryChangeSetProjection = Readonly<{
  version: typeof CROSS_REPOSITORY_CHANGE_SET_VERSION
  worldId: string
  project: NullableProject
  outcome: NullableOutcome
  units: readonly CrossRepositoryChangeSetUnit[]
  dependencies: readonly Readonly<{
    contractIdentity: string
    revisionIdentity: string
    producerWorkOrderId: number
    consumerWorkOrderId: number
  }>[]
  limitations: readonly string[]
}>

type JsonRecord = Record<string, unknown>
type ContractEvidence = Readonly<{
  workOrderId: number
  contractIdentity: string
  revisionIdentity: string
  role: "producer" | "consumer"
}>
type ArtifactIdentity = Readonly<{
  pullRequest: number
  headSha: string
  paths: readonly string[]
}>

const SHA = /^[0-9a-f]{40}$/i
const CONTRACT_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null
}

function canonicalRepository(value: unknown): string | null {
  if (typeof value !== "string") return null
  const candidate = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "")
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(candidate) ? candidate.toLowerCase() : null
}

function repositoryDefinition(identity: string) {
  return CORE_SEVEN_REPOSITORIES.find((candidate) => candidate.identity.toLowerCase() === identity) ?? null
}

function exactString(value: unknown, max = 500): string | null {
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return null
  return value
}

function exactSha(value: unknown): string | null {
  return typeof value === "string" && SHA.test(value) ? value.toLowerCase() : null
}

function exactPullRequest(value: unknown): number | null {
  const result = positiveInteger(value)
  return result && result <= 2_147_483_647 ? result : null
}

function canonicalPath(value: unknown): string | null {
  if (typeof value !== "string") return null
  const path = value.trim().replace(/\\/g, "/")
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("//")
    || path.split("/").some((segment) => !segment || segment === "." || segment === "..")
    || /[\u0000-\u001f\u007f]/.test(path)) return null
  return path
}

function exactPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(canonicalPath).filter((path): path is string => path !== null))].sort()
}

function exactArtifactPaths(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3_000) return null
  const paths = value.map((candidate) => {
    const path = canonicalPath(candidate)
    return typeof candidate === "string" && path === candidate && !path.includes("*") && !path.includes("?")
      ? path
      : null
  })
  if (paths.some((path) => path === null)) return null
  const exact = paths as string[]
  if (new Set(exact).size !== exact.length) return null
  return [...exact].sort()
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index])
}

function sameArtifact(left: ArtifactIdentity | null, right: ArtifactIdentity | null): boolean {
  return left !== null && right !== null
    && left.pullRequest === right.pullRequest
    && left.headSha === right.headSha
    && samePaths(left.paths, right.paths)
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function eventWorkOrderId(event: CrossRepositoryEventFact): number | null {
  const metadata = record(event.metadata)
  if (!metadata) return null
  const direct = positiveInteger(record(metadata.workOrder)?.id)
  if (direct) return direct
  const context = record(metadata.context)
  const contextId = positiveInteger(record(context?.workOrder)?.id)
  if (contextId) return contextId
  const payload = record(record(record(metadata.seal)?.payload))
  return positiveInteger(record(record(payload?.assignment)?.workOrder)?.id)
    ?? positiveInteger(record(record(payload?.adoption)?.workOrder)?.id)
}

function eventOutcomeKey(event: CrossRepositoryEventFact): string | null {
  const metadata = record(event.metadata)
  if (!metadata) return null
  const direct = exactString(record(metadata.outcome)?.key) ?? exactString(metadata.outcomeKey)
  if (direct) return direct
  const context = record(metadata.context)
  const contextKey = exactString(record(context?.outcome)?.key)
  if (contextKey) return contextKey
  const payload = record(record(record(metadata.seal)?.payload))
  return exactString(record(record(payload?.assignment)?.outcome)?.key)
    ?? exactString(record(record(payload?.adoption)?.outcome)?.key)
}

function eventRepository(event: CrossRepositoryEventFact): string | null {
  const metadata = record(event.metadata)
  const contextRepository = canonicalRepository(record(metadata?.context)?.repository)
  if (contextRepository) return contextRepository
  const payload = record(record(record(metadata?.seal)?.payload))
  return canonicalRepository(record(payload?.delivery)?.repository)
}

function eventAdoptionHash(event: CrossRepositoryEventFact): string | null {
  const metadata = record(event.metadata)
  const direct = exactString(metadata?.adoptionHash)
  if (direct && /^[0-9a-f]{64}$/i.test(direct)) return direct.toLowerCase()
  const payload = record(record(record(metadata?.seal)?.payload))
  const nested = exactString(record(payload?.adoption)?.adoptionHash)
  return nested && /^[0-9a-f]{64}$/i.test(nested) ? nested.toLowerCase() : null
}

function eventSealedAdoptionHash(event: CrossRepositoryEventFact): string | null {
  const payload = record(record(record(record(event.metadata)?.seal)?.payload))
  const nested = exactString(record(payload?.adoption)?.adoptionHash)
  return nested && /^[0-9a-f]{64}$/i.test(nested) ? nested.toLowerCase() : null
}

function artifactIdentity(artifact: JsonRecord | null): ArtifactIdentity | null {
  const pullRequest = exactPullRequest(artifact?.pullRequest)
  const headSha = exactSha(artifact?.headSha)
  const paths = exactArtifactPaths(artifact?.paths)
  if (!pullRequest || !headSha || !paths) return null
  return { pullRequest, headSha, paths }
}

function eventArtifact(event: CrossRepositoryEventFact): ArtifactIdentity | null {
  const metadata = record(event.metadata)
  if (!metadata) return null
  const direct = record(metadata.artifact)
  const payload = record(record(record(metadata.seal)?.payload))
  const nested = record(record(payload?.adoption)?.artifact)
  return artifactIdentity(direct ?? nested)
}

function eventDelivery(event: CrossRepositoryEventFact): Readonly<{ repository: string; headSha: string; paths: readonly string[] }> | null {
  if (event.eventType !== "EVIDENCE_RECORDED" || event.entityType !== "williamos_delivery_seal") return null
  const payload = record(record(record(record(event.metadata)?.seal)?.payload))
  const delivery = record(payload?.delivery)
  const repository = canonicalRepository(delivery?.repository)
  const headSha = exactSha(delivery?.commitSha)
  const paths = exactArtifactPaths(delivery?.paths)
  if (!repository || !headSha || !paths) return null
  return { repository, headSha, paths }
}

function eventEvidenceArtifact(event: CrossRepositoryEventFact): ArtifactIdentity | null {
  return artifactIdentity(record(record(event.metadata)?.evidence))
}

function eventContractEvidence(event: CrossRepositoryEventFact): ContractEvidence[] {
  const workOrderId = eventWorkOrderId(event)
  if (!workOrderId) return []
  const reservation = record(record(event.metadata)?.reservation)
  const contracts = reservation?.contracts
  if (!Array.isArray(contracts)) return []
  return contracts.flatMap((candidate): ContractEvidence[] => {
    const row = record(candidate)
    const contractIdentity = exactString(row?.contractIdentity, 200)
    const revisionIdentity = exactString(row?.revisionIdentity, 200)
    const role = row?.role
    if (!contractIdentity || !revisionIdentity || !CONTRACT_IDENTITY.test(contractIdentity)
      || !CONTRACT_IDENTITY.test(revisionIdentity) || (role !== "producer" && role !== "consumer")) return []
    return [{ workOrderId, contractIdentity, revisionIdentity, role }]
  })
}

function matchingEvidence(
  events: readonly CrossRepositoryEventFact[],
  adoptionHash: string | null,
  type: "ARTIFACT_ADOPTION_VALIDATED" | "ARTIFACT_ADOPTION_REVIEWED",
  entityType: "williamos_artifact_adoption_validation" | "williamos_artifact_adoption_review",
): Readonly<{ event: CrossRepositoryEventFact; evidence: JsonRecord }> | null {
  if (!adoptionHash) return null
  const matches = events.filter((event) => event.eventType === type && event.entityType === entityType
    && eventAdoptionHash(event) === adoptionHash)
  if (matches.length !== 1) return null
  const evidence = record(record(matches[0].metadata)?.evidence)
  return evidence ? { event: matches[0], evidence } : null
}

function unitFor(
  workOrder: CrossRepositoryWorkOrderFact,
  evidence: readonly CrossRepositoryEvidenceFact[],
  events: readonly CrossRepositoryEventFact[],
  limitations: string[],
): CrossRepositoryChangeSetUnit | null {
  const unitEvidence = evidence.filter((row) => row.workOrderId === workOrder.id)
  const unitEvents = events.filter((event) => eventWorkOrderId(event) === workOrder.id)
  const persistedRepositoryIdentities = unique([
    ...unitEvidence.map((row) => canonicalRepository(row.repository)),
    ...unitEvents.filter((event) => eventDelivery(event) === null && event.eventType !== "ARTIFACT_ADOPTION_AUTHORIZED").map(eventRepository),
  ].filter((identity): identity is string => identity !== null))
  const authorizationRepositoryIdentities = unique(unitEvents
    .filter((event) => event.eventType === "ARTIFACT_ADOPTION_AUTHORIZED")
    .map(eventRepository)
    .filter((identity): identity is string => identity !== null))
  const deliveryRepositoryIdentities = unique(unitEvents.map(eventDelivery)
    .map((delivery) => delivery?.repository ?? null)
    .filter((identity): identity is string => identity !== null))
  const repositoryIdentities = persistedRepositoryIdentities.length > 0
    ? persistedRepositoryIdentities
    : authorizationRepositoryIdentities.length > 0
      ? authorizationRepositoryIdentities
      : deliveryRepositoryIdentities
  if (repositoryIdentities.length === 0) {
    limitations.push(`Work Order #${workOrder.id} has no repository-qualified delivery evidence and is omitted.`)
    return null
  }
  if (repositoryIdentities.length !== 1) {
    limitations.push(`Work Order #${workOrder.id} has conflicting repository identities and is omitted.`)
    return null
  }
  const repository = repositoryDefinition(repositoryIdentities[0])
  if (!repository) {
    limitations.push(`Work Order #${workOrder.id} targets a repository outside the Core Seven and is omitted.`)
    return null
  }

  const unitLimitations: string[] = []
  const branches = unique(unitEvidence.map((row) => exactString(row.branch, 240)).filter((value): value is string => value !== null))
  const branch = branches.length === 1 ? branches[0] : null
  if (branches.length === 0) unitLimitations.push(`Work Order #${workOrder.id} has no persisted branch identity.`)
  if (branches.length > 1) unitLimitations.push(`Work Order #${workOrder.id} has conflicting branch identities.`)

  const authorizations = unitEvents.filter((event) => event.eventType === "ARTIFACT_ADOPTION_AUTHORIZED"
    && event.entityType === "williamos_artifact_adoption_authorization")
  const artifacts = authorizations.map(eventArtifact).filter((value): value is NonNullable<ReturnType<typeof eventArtifact>> => value !== null)
  const deliveryEvents = unitEvents.filter((event) => event.eventType === "EVIDENCE_RECORDED"
    && event.entityType === "williamos_delivery_seal")
  const deliveries = deliveryEvents.map(eventDelivery).filter((value): value is NonNullable<ReturnType<typeof eventDelivery>> => value !== null)
  const pullRequests = unique(artifacts.map((artifact) => artifact.pullRequest))
  const pullRequest = pullRequests.length === 1 ? pullRequests[0] : null
  if (pullRequests.length === 0) unitLimitations.push(`Work Order #${workOrder.id} has no persisted pull-request identity.`)
  if (pullRequests.length > 1) unitLimitations.push(`Work Order #${workOrder.id} has conflicting pull-request identities.`)

  const artifactHeads = unique(artifacts.map((artifact) => artifact.headSha))
  const evidenceHeads = unique(unitEvidence.map((row) => exactSha(row.revision)).filter((value): value is string => value !== null))
  const deliveryHeads = unique(deliveries.map((delivery) => delivery.headSha))
  const revision = artifactHeads.length === 1
    ? artifactHeads[0]
    : artifactHeads.length === 0 && evidenceHeads.length === 1
      ? evidenceHeads[0]
      : artifactHeads.length === 0 && evidenceHeads.length === 0 && deliveryHeads.length === 1
        ? deliveryHeads[0]
        : null
  if (!revision) unitLimitations.push(`Work Order #${workOrder.id} has no unambiguous persisted revision identity.`)

  const pathSets = artifacts.length > 0
    ? artifacts.map((artifact) => artifact.paths)
    : unitEvidence.length > 0
      ? unitEvidence.map((row) => exactPaths(row.filesChanged))
      : deliveries.map((delivery) => delivery.paths)
  const serializedPaths = unique(pathSets.filter((paths) => paths.length > 0).map((paths) => JSON.stringify(paths)))
  const paths = serializedPaths.length === 1 ? JSON.parse(serializedPaths[0]) as string[] : []
  if (serializedPaths.length > 1) unitLimitations.push(`Work Order #${workOrder.id} has conflicting persisted delivery path sets.`)

  const authorization = authorizations.length === 1 ? authorizations[0] : null
  const adoptionHash = authorization ? eventAdoptionHash(authorization) : null
  const authorizedArtifact = authorization ? eventArtifact(authorization) : null
  const authorizedRepository = authorization ? eventRepository(authorization) : null
  const authorizationExact = authorizedArtifact !== null && authorizedRepository === repository.identity.toLowerCase()
  if (authorization && !authorizationExact) {
    unitLimitations.push(`Work Order #${workOrder.id} artifact authorization does not match the projected repository or lacks an exact pull request, head, and path set.`)
  }
  if (authorizations.length > 1) {
    unitLimitations.push(`Work Order #${workOrder.id} has ambiguous artifact-adoption authorization evidence.`)
  }

  const validationMatch = matchingEvidence(events, adoptionHash, "ARTIFACT_ADOPTION_VALIDATED", "williamos_artifact_adoption_validation")
  const validationArtifact = validationMatch ? eventEvidenceArtifact(validationMatch.event) : null
  const validationExact = authorizationExact && sameArtifact(validationArtifact, authorizedArtifact)
  if (validationMatch && !validationExact) {
    unitLimitations.push(`Work Order #${workOrder.id} validation evidence does not match the authorized repository, pull request, head, and paths.`)
  }
  const validationHead = validationExact ? validationArtifact?.headSha ?? null : null
  const validationState = validationExact && validationMatch?.evidence.checksComplete === true
    ? validationMatch.evidence.checksGreen === true ? "passed" as const : "failed" as const
    : "pending" as const

  const reviewMatch = matchingEvidence(events, adoptionHash, "ARTIFACT_ADOPTION_REVIEWED", "williamos_artifact_adoption_review")
  const reviewArtifact = reviewMatch ? eventEvidenceArtifact(reviewMatch.event) : null
  const reviewExact = authorizationExact && sameArtifact(reviewArtifact, authorizedArtifact)
  if (reviewMatch && !reviewExact) {
    unitLimitations.push(`Work Order #${workOrder.id} review evidence does not match the authorized repository, pull request, head, and paths.`)
  }
  const reviewHead = reviewExact ? reviewArtifact?.headSha ?? null : null
  const reviewState = reviewExact && reviewMatch?.evidence.reviewCompleted === true && reviewMatch.evidence.reviewed === true
    && reviewMatch.evidence.reviewDecision === "APPROVED" && reviewMatch.evidence.unresolvedThreadCount === 0
    ? "approved" as const
    : reviewExact && reviewMatch?.evidence.reviewCompleted === true
      ? "changes-requested" as const
      : "pending" as const

  const deliveryEvent = deliveryEvents.length === 1 ? deliveryEvents[0] : null
  const sealedArtifact = deliveryEvent ? eventArtifact(deliveryEvent) : null
  const sealedDelivery = deliveryEvent ? eventDelivery(deliveryEvent) : null
  const deliveryExact = authorizationExact && deliveryEvent !== null && sealedDelivery !== null
    && eventAdoptionHash(deliveryEvent) === adoptionHash
    && eventSealedAdoptionHash(deliveryEvent) === adoptionHash
    && sameArtifact(sealedArtifact, authorizedArtifact)
    && sealedDelivery.repository === authorizedRepository
    && sealedDelivery.headSha === authorizedArtifact?.headSha
    && samePaths(sealedDelivery.paths, authorizedArtifact?.paths ?? [])
    && validationState === "passed"
    && reviewState === "approved"
  const delivery = deliveryExact
    ? { state: "sealed" as const, headSha: sealedDelivery?.headSha ?? null }
    : { state: "pending" as const, headSha: null }
  if (deliveryEvent && !deliveryExact) {
    unitLimitations.push(`Work Order #${workOrder.id} delivery-seal evidence does not match the authorized repository, pull request, head, and paths.`)
  }
  if (deliveryEvents.length > 1) unitLimitations.push(`Work Order #${workOrder.id} has ambiguous delivery-seal evidence.`)

  limitations.push(...unitLimitations)
  return Object.freeze({
    id: `work-order:${workOrder.id}:${repository.key}`,
    workOrder: Object.freeze({
      id: workOrder.id,
      ref: workOrder.ref,
      title: workOrder.title,
      status: workOrder.status,
      result: workOrder.result,
    }),
    repository: Object.freeze({ key: repository.key, identity: repository.identity }),
    git: Object.freeze({ branch, revision, pullRequest, paths: Object.freeze(paths) }),
    validation: Object.freeze({ state: validationState, headSha: validationHead }),
    review: Object.freeze({ state: reviewState, headSha: reviewHead }),
    delivery: Object.freeze(delivery),
    limitations: Object.freeze([...unitLimitations].sort()),
  })
}

function projectDependencies(events: readonly CrossRepositoryEventFact[], limitations: string[]) {
  const contracts = events.flatMap(eventContractEvidence)
  const groups = new Map<string, ContractEvidence[]>()
  for (const contract of contracts) {
    const key = `${contract.contractIdentity}\0${contract.revisionIdentity}`
    groups.set(key, [...(groups.get(key) ?? []), contract])
  }
  const dependencies: Array<{
    contractIdentity: string
    revisionIdentity: string
    producerWorkOrderId: number
    consumerWorkOrderId: number
  }> = []
  for (const group of groups.values()) {
    const producers = unique(group.filter((entry) => entry.role === "producer").map((entry) => entry.workOrderId))
    const consumers = unique(group.filter((entry) => entry.role === "consumer").map((entry) => entry.workOrderId))
    if (producers.length > 1) {
      limitations.push(`Contract ${group[0].contractIdentity}@${group[0].revisionIdentity} has multiple persisted producers; no dependency was inferred.`)
      continue
    }
    if (producers.length !== 1) continue
    for (const consumerWorkOrderId of consumers) {
      if (consumerWorkOrderId === producers[0]) continue
      dependencies.push({
        contractIdentity: group[0].contractIdentity,
        revisionIdentity: group[0].revisionIdentity,
        producerWorkOrderId: producers[0],
        consumerWorkOrderId,
      })
    }
  }
  return dependencies.sort((left, right) =>
    `${left.contractIdentity}\0${left.revisionIdentity}\0${left.producerWorkOrderId}\0${left.consumerWorkOrderId}`
      .localeCompare(`${right.contractIdentity}\0${right.revisionIdentity}\0${right.producerWorkOrderId}\0${right.consumerWorkOrderId}`))
}

export function projectCrossRepositoryChangeSet(
  facts: CrossRepositoryChangeSetFacts,
): CrossRepositoryChangeSetProjection {
  const limitations: string[] = []
  if (!facts.project) limitations.push("The owned Space has no persisted Project binding.")
  if (!facts.outcome) limitations.push("The owned Space has no persisted Outcome binding.")
  const units = facts.workOrders
    .map((workOrder) => unitFor(workOrder, facts.evidence, facts.events, limitations))
    .filter((unit): unit is CrossRepositoryChangeSetUnit => unit !== null)
    .sort((left, right) => left.workOrder.id - right.workOrder.id)
  const dependencies = projectDependencies(facts.events, limitations)
    .filter((dependency) => units.some((unit) => unit.workOrder.id === dependency.producerWorkOrderId)
      && units.some((unit) => unit.workOrder.id === dependency.consumerWorkOrderId))
  if (units.length === 0 && limitations.every((limitation) => !limitation.includes("repository-qualified"))) {
    limitations.push("No repository-qualified delivery evidence is persisted for this outcome.")
  } else if (units.length === 0 && limitations.length === 0) {
    limitations.push("No repository-qualified delivery evidence is persisted for this outcome.")
  }
  return Object.freeze({
    version: CROSS_REPOSITORY_CHANGE_SET_VERSION,
    worldId: facts.worldId,
    project: facts.project,
    outcome: facts.outcome,
    units: Object.freeze(units),
    dependencies: Object.freeze(dependencies.map((dependency) => Object.freeze(dependency))),
    limitations: Object.freeze(unique(limitations).sort()),
  })
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString()
}

/**
 * Read one owner's persisted Space and the exact Work Order/evidence/receipt facts already bound to
 * it. This reader never writes, never scrapes prose for relationships, and never treats one outcome
 * as a combined Git repository.
 */
export async function loadOwnedCrossRepositoryChangeSet(
  userId: string,
  worldId: string,
): Promise<CrossRepositoryChangeSetProjection | null> {
  const world = await loadOwnedWorkingWorld(userId, worldId)
  if (!world) return null
  const projectId = world.spine.projectId
  const outcomeKey = world.spine.outcomeKey

  const [projectResult, outcomeResult, directEventResult] = await Promise.all([
    projectId === null
      ? Promise.resolve({ rows: [] as JsonRecord[] })
      : pool.query(`SELECT "id","key","name" FROM "project" WHERE "userId"=$1 AND "id"=$2 LIMIT 2`, [userId, projectId]),
    outcomeKey === null
      ? Promise.resolve({ rows: [] as JsonRecord[] })
      : pool.query(`SELECT "id","outcomeKey","title","activeWorkOrderId" FROM "outcome_queue_item"
          WHERE "userId"=$1 AND "outcomeKey"=$2 LIMIT 2`, [userId, outcomeKey]),
    pool.query(`SELECT "id","eventType","entityType","metadata","createdAt" FROM "governance_event"
      WHERE "userId"=$1 AND (
        "metadata"->>'worldId'=$2
        OR "metadata"->'context'->>'worldId'=$2
        OR "metadata"->'seal'->'payload'->'assignment'->>'worldId'=$2
        OR "metadata"->'seal'->'payload'->'adoption'->>'worldId'=$2
      )
      AND (
        "entityType" IN ('loom_codex_assignment','loom_codex_ready','williamos_artifact_adoption_authorization','williamos_delivery_seal')
        OR "eventType"='ARTIFACT_ADOPTION_AUTHORIZED'
      )
      ORDER BY "id" ASC LIMIT 1000`, [userId, worldId]),
  ])

  const projectRow = projectResult.rows.length === 1 ? projectResult.rows[0] : null
  const outcomeRow = outcomeResult.rows.length === 1 ? outcomeResult.rows[0] : null
  const directEvents: CrossRepositoryEventFact[] = directEventResult.rows.map((row) => ({
    id: Number(row.id), eventType: String(row.eventType), entityType: row.entityType == null ? null : String(row.entityType),
    metadata: row.metadata, createdAt: iso(row.createdAt),
  })).filter((event) => outcomeKey !== null && eventOutcomeKey(event) === outcomeKey)
  const adoptionHashes = unique(directEvents.map(eventAdoptionHash).filter((value): value is string => value !== null))
  const evidenceEventResult = adoptionHashes.length === 0
    ? { rows: [] as JsonRecord[] }
    : await pool.query(`SELECT "id","eventType","entityType","metadata","createdAt" FROM "governance_event"
        WHERE "userId"=$1 AND "eventType" IN ('ARTIFACT_ADOPTION_VALIDATED','ARTIFACT_ADOPTION_REVIEWED')
          AND "metadata"->>'adoptionHash'=ANY($2::text[])
        ORDER BY "id" ASC LIMIT 1000`, [userId, adoptionHashes])
  const events = [...directEvents, ...evidenceEventResult.rows.map((row) => ({
    id: Number(row.id), eventType: String(row.eventType), entityType: row.entityType == null ? null : String(row.entityType),
    metadata: row.metadata, createdAt: iso(row.createdAt),
  }))]

  const workOrderIds = unique([
    positiveInteger(world.spine.workOrderId),
    positiveInteger(outcomeRow?.activeWorkOrderId),
    ...events.map(eventWorkOrderId),
  ].filter((id): id is number => id !== null))
  const workOrderResult = workOrderIds.length === 0
    ? { rows: [] as JsonRecord[] }
    : await pool.query(`SELECT "id","ref","title","status","result","commitRef" FROM "work_order"
        WHERE "userId"=$1 AND "id"=ANY($2::integer[]) ORDER BY "id" ASC`, [userId, workOrderIds])
  const evidenceResult = workOrderIds.length === 0
    ? { rows: [] as JsonRecord[] }
    : await pool.query(`SELECT "id","workOrderId","result","repo","branch","head","filesChanged","createdAt" FROM "evidence_record"
        WHERE "userId"=$1 AND "workOrderId"=ANY($2::integer[]) ORDER BY "createdAt" ASC,"id" ASC`, [userId, workOrderIds])

  return projectCrossRepositoryChangeSet({
    worldId,
    project: projectRow && positiveInteger(projectRow.id)
      ? { id: Number(projectRow.id), key: String(projectRow.key), name: String(projectRow.name) }
      : null,
    outcome: outcomeRow && exactString(outcomeRow.outcomeKey) && exactString(outcomeRow.title)
      ? { key: String(outcomeRow.outcomeKey), title: String(outcomeRow.title) }
      : null,
    workOrders: workOrderResult.rows.flatMap((row): CrossRepositoryWorkOrderFact[] => {
      const id = positiveInteger(row.id)
      const title = exactString(row.title, 500)
      const status = exactString(row.status, 100)
      if (!id || !title || !status) return []
      return [{
        id,
        ref: row.ref == null ? null : exactString(row.ref, 200),
        title,
        status,
        result: row.result == null ? null : exactString(row.result, 100),
        commitRef: row.commitRef == null ? null : exactSha(row.commitRef),
      }]
    }),
    evidence: evidenceResult.rows.flatMap((row): CrossRepositoryEvidenceFact[] => {
      const id = positiveInteger(row.id)
      const workOrderId = positiveInteger(row.workOrderId)
      const result = exactString(row.result, 100)
      if (!id || !workOrderId || !result) return []
      return [{
        id,
        workOrderId,
        result,
        repository: row.repo == null ? null : exactString(row.repo, 500),
        branch: row.branch == null ? null : exactString(row.branch, 240),
        revision: row.head == null ? null : exactSha(row.head),
        filesChanged: exactPaths(row.filesChanged),
        createdAt: iso(row.createdAt),
      }]
    }),
    events,
  })
}
