import { resolveAmbiguity } from "@/lib/environment/assumption-policy"
import {
  classifyGrounded,
  composeProjectsAnswer,
  groundedCurrentWork,
  groundedIdentity,
  type GroundedKind,
  type ProjectRow,
} from "@/lib/environment/grounding"
import {
  toEnvironmentWorldDto,
  type EnvironmentCompareResponse,
  type EnvironmentLineResponse,
  type EnvironmentWorldDto,
} from "@/lib/environment/api-contract"
import { createWorkingWorld, withSurface, withTurn } from "@/lib/environment/working-world"
import {
  admitWorldEndpoint,
  applyExecutionObservation,
  createEnvironmentWorldProjection,
  validateEnvironmentWorldProjection,
  type ExecutionObservation,
  type EnvironmentWorldProjection,
  type EnvironmentWorldStatus,
  type ResourceBinding,
  type WorldEndpointIdentity,
} from "@/lib/environment/world-projection"

export type ResourceCandidate = ResourceBinding & Readonly<{ weight?: number }>

export type StoredEnvironmentWorld = Readonly<{
  world: EnvironmentWorldProjection
  updatedAt: string
  version: number
}>

export interface EnvironmentWorldRepository {
  listGroundedProjects(userId: string): Promise<readonly ProjectRow[]>
  listResourceCandidates(userId: string): Promise<readonly ResourceCandidate[]>
  loadExact(userId: string, worldId: string): Promise<StoredEnvironmentWorld | null>
  loadLatest(userId: string): Promise<StoredEnvironmentWorld | null>
  insert(userId: string, world: EnvironmentWorldProjection, now: string): Promise<void>
  update(userId: string, world: EnvironmentWorldProjection, now: string, expectedVersion: number): Promise<boolean>
}

export interface EnvironmentEndpointResolver {
  /** Return only an endpoint whose registry provenance and liveness have already been evidenced. */
  resolve(input: Readonly<{
    userId: string
    worldId: string
    intent: string
    resource: ResourceBinding
  }>): Promise<WorldEndpointIdentity | null>
}

export interface EnvironmentEndpointLivenessPort {
  /** Re-observe an already admitted endpoint; null means its current reachability was not proven. */
  refresh(endpoint: WorldEndpointIdentity): Promise<WorldEndpointIdentity | null>
}

export type ComparisonEvidence = Readonly<{
  /** The producing port persisted this exact observation in the authority/evidence ledger. */
  durable: true
  artifactRef: string
  evidenceRef: string
  observedAt: string
  subject: string
  conflicts: readonly string[]
  content?: unknown
}>

export interface EnvironmentComparisonPort {
  compare(input: Readonly<{
    userId: string
    left: WorldEndpointIdentity
    right: WorldEndpointIdentity
  }>): Promise<ComparisonEvidence | null>
}

export interface EnvironmentWorkIntakePort {
  createSuggested(input: Readonly<{
    userId: string
    worldId: string
    intent: string
    resource: ResourceBinding
  }>): Promise<Readonly<{ workOrderRef: string }>>
}

export function createEnvironmentWorldService({
  repository,
  endpointResolver,
  endpointLivenessPort,
  comparisonPort,
  workIntakePort,
  now = () => new Date().toISOString(),
  id = () => crypto.randomUUID(),
}: {
  repository: EnvironmentWorldRepository
  endpointResolver?: EnvironmentEndpointResolver
  endpointLivenessPort?: EnvironmentEndpointLivenessPort
  comparisonPort?: EnvironmentComparisonPort
  workIntakePort?: EnvironmentWorkIntakePort
  now?: () => string
  id?: () => string
}) {
  const dto = (world: EnvironmentWorldProjection, updatedAt: string) =>
    toEnvironmentWorldDto(world, updatedAt, Date.parse(now()))
  const refreshLiveness = async (world: EnvironmentWorldProjection): Promise<EnvironmentWorldProjection> => {
    if (!endpointLivenessPort || world.endpoints.length === 0) return world
    const observed = await Promise.all(world.endpoints.map(async (endpoint) => {
      try {
        return await endpointLivenessPort.refresh(endpoint)
      } catch {
        return null
      }
    }))
    return validateEnvironmentWorldProjection({
      ...world,
      // A failed current probe invalidates admission for this response. Keeping the prior endpoint
      // until its TTL elapsed would present a known-dead preview as ready and make Job 4 compare it.
      endpoints: observed.map((endpoint, index) => endpoint ?? invalidateEndpoint(world.endpoints[index], now())),
    })
  }
  const groundedReply = async (userId: string, kind: GroundedKind): Promise<string> => {
    if (kind === "identity") return groundedIdentity()
    const projects = await repository.listGroundedProjects(userId)
    return kind === "projects" ? composeProjectsAnswer(projects) : groundedCurrentWork(projects)
  }

  return {
    async load(userId: string, worldId?: string | null): Promise<EnvironmentWorldDto | null> {
      requireText(userId, "USER_REQUIRED")
      const stored = worldId ? await repository.loadExact(userId, worldId) : await repository.loadLatest(userId)
      if (!stored) return null
      const world = await refreshLiveness(validateEnvironmentWorldProjection(stored.world))
      return dto(world, stored.updatedAt)
    },

    async submitLine(
      userId: string,
      input: Readonly<{ text: string; worldId?: string | null }>,
    ): Promise<EnvironmentLineResponse> {
      requireText(userId, "USER_REQUIRED")
      const text = input.text.trim()
      if (!text) throw new EnvironmentInputError("MESSAGE_EMPTY")
      if (text.length > 4_000) throw new EnvironmentInputError("MESSAGE_TOO_LONG")
      const groundedKind = classifyGrounded(text)

      if (input.worldId) {
        const stored = await repository.loadExact(userId, input.worldId)
        if (!stored) throw new EnvironmentNotFoundError("WORLD_NOT_FOUND")
        let world = await refreshLiveness(validateEnvironmentWorldProjection(stored.world))
        // A previously waiting world may acquire a runtime endpoint later. Re-resolution is safe:
        // the port can return only an already evidenced, live endpoint for this exact world/resource.
        if (world.resource && world.endpoints.length === 0 && endpointResolver) {
          const endpoint = await endpointResolver.resolve({
            userId,
            worldId: world.id,
            intent: world.meaning.intent,
            resource: world.resource,
          })
          if (endpoint) world = admitWorldEndpoint(world, endpoint)
        }
        const visibleStatus = dto(world, stored.updatedAt).status
        world = { ...world, meaning: withTurn(world.meaning, "owner", text, now) }
        const say = groundedKind
          ? await groundedReply(userId, groundedKind)
          : lineContinuation(world, visibleStatus)
        world = { ...world, meaning: withTurn(world.meaning, "williamos", say, now) }
        const updatedAt = now()
        const updated = await repository.update(userId, world, updatedAt, stored.version)
        if (!updated) throw new EnvironmentConflictError("WORLD_CONCURRENTLY_CHANGED")
        return {
          state: "continued",
          say,
          world: dto(world, updatedAt),
        }
      }

      // Identity, project-register, and current-work questions never enter resource selection or a
      // free-form model. They are durable conversation turns answered from WilliamOS + ledger state.
      if (groundedKind) {
        const worldId = id()
        let meaning = createWorkingWorld({ intent: text })
        meaning = withTurn(meaning, "owner", text, now)
        const say = await groundedReply(userId, groundedKind)
        meaning = withTurn(meaning, "williamos", say, now)
        const world = createEnvironmentWorldProjection({ id: worldId, meaning, resource: null })
        const updatedAt = now()
        await repository.insert(userId, world, updatedAt)
        return {
          state: "waiting_for_resource",
          say,
          world: dto(world, updatedAt),
        }
      }

      const candidates = await repository.listResourceCandidates(userId)
      const decision = resolveAmbiguity({
        subject: "which project resource this work belongs to",
        candidates: candidates.map(({ candidateId, label, weight }) => ({ id: candidateId, label, weight })),
        costOfWrongGuess: "cheap",
      })
      const resource = decision.mode === "ASSUME_AND_STATE"
        ? candidates.find((candidate) => candidate.candidateId === decision.chosen.id) ?? null
        : null
      // Binding must be the candidate S1 actually chose. A default repository constant is forbidden.
      if (decision.mode === "ASSUME_AND_STATE" && !resource) throw new Error("CHOSEN_RESOURCE_NOT_FOUND")

      const worldId = id()
      const suggestedWork = resource && workIntakePort
        ? await workIntakePort.createSuggested({ userId, worldId, intent: text, resource })
        : null
      let meaning = createWorkingWorld({
        intent: text,
        assumption: decision.mode === "ASSUME_AND_STATE" ? decision.statement : null,
        resources: resource ? [resource.canonicalIdentity] : [],
      })
      meaning = withTurn(meaning, "owner", text, now)
      let world = createEnvironmentWorldProjection({
        id: worldId,
        meaning,
        resource,
        workOrderRef: suggestedWork?.workOrderRef ?? null,
      })

      if (resource && endpointResolver) {
        const endpoint = await endpointResolver.resolve({ userId, worldId, intent: text, resource })
        if (endpoint) world = admitWorldEndpoint(world, endpoint)
      }

      const say = initialLineReply(world, decision.mode === "ASSUME_AND_STATE" ? decision.statement : decision.question)
      world = { ...world, meaning: withTurn(world.meaning, "williamos", say, now) }
      const updatedAt = now()
      await repository.insert(userId, world, updatedAt)
      return {
        state: world.status === "ready"
          ? "ready"
          : world.status === "waiting_for_resource"
            ? "waiting_for_resource"
            : "waiting_for_execution_endpoint",
        say,
        world: dto(world, updatedAt),
      }
    },

    async admitEndpoint(
      userId: string,
      worldId: string,
      endpoint: WorldEndpointIdentity,
    ): Promise<EnvironmentWorldDto> {
      requireText(userId, "USER_REQUIRED")
      requireText(worldId, "WORLD_ID_REQUIRED")
      const stored = await repository.loadExact(userId, worldId)
      if (!stored) throw new EnvironmentNotFoundError("WORLD_NOT_FOUND")
      let world = admitWorldEndpoint(validateEnvironmentWorldProjection(stored.world), endpoint)
      if (world.endpoints.length >= 2) {
        const [left, right] = world.endpoints.slice(-2)
        const conflicts = endpointPairConflicts(left, right)
        if (conflicts.length > 0) throw new Error(`JOB4_ENDPOINTS_NOT_ISOLATED:${conflicts.join(",")}`)
        if (comparisonPort) {
          const evidence = await comparisonPort.compare({ userId, left, right })
          if (evidence) {
            requireComparisonEvidence(evidence)
            const comparison = {
              id: `compare:${left.id}:${right.id}:${evidence.artifactRef}`,
              kind: evidence.conflicts.length > 0 ? "conflict" as const : "compare" as const,
              subject: evidence.subject,
              because: "observed comparison of two isolated running applications",
              content: evidence.content,
              binding: {
                type: "artifact" as const,
                endpointId: left.id,
                artifactRef: evidence.artifactRef,
                evidenceRef: evidence.evidenceRef,
              },
            }
            world = validateEnvironmentWorldProjection({
              ...world,
              meaning: withSurface(world.meaning, {
                kind: comparison.kind,
                subject: comparison.subject,
                because: comparison.because,
              }),
              surfaces: [...world.surfaces, comparison],
            })
          }
        }
      }
      const updatedAt = now()
      if (!await repository.update(userId, world, updatedAt, stored.version)) throw new EnvironmentConflictError("WORLD_CONCURRENTLY_CHANGED")
      return dto(world, updatedAt)
    },

    async observeExecution(
      userId: string,
      observation: ExecutionObservation,
    ): Promise<EnvironmentWorldDto> {
      requireText(userId, "USER_REQUIRED")
      const stored = await repository.loadExact(userId, observation.worldId)
      if (!stored) throw new EnvironmentNotFoundError("WORLD_NOT_FOUND")
      const world = applyExecutionObservation(validateEnvironmentWorldProjection(stored.world), observation)
      const updatedAt = now()
      if (!await repository.update(userId, world, updatedAt, stored.version)) throw new EnvironmentConflictError("WORLD_CONCURRENTLY_CHANGED")
      return dto(world, updatedAt)
    },

    async compare(
      userId: string,
      input: Readonly<{ leftWorldId: string; rightWorldId: string }>,
    ): Promise<EnvironmentCompareResponse> {
      requireText(userId, "USER_REQUIRED")
      requireText(input.leftWorldId, "LEFT_WORLD_REQUIRED")
      requireText(input.rightWorldId, "RIGHT_WORLD_REQUIRED")
      const [leftStored, rightStored] = await Promise.all([
        repository.loadExact(userId, input.leftWorldId),
        repository.loadExact(userId, input.rightWorldId),
      ])
      if (!leftStored || !rightStored) throw new EnvironmentNotFoundError("WORLD_NOT_FOUND")
      const [left, right] = await Promise.all([
        refreshLiveness(validateEnvironmentWorldProjection(leftStored.world)),
        refreshLiveness(validateEnvironmentWorldProjection(rightStored.world)),
      ])
      const leftDto = dto(left, leftStored.updatedAt)
      const rightDto = dto(right, rightStored.updatedAt)
      const isolationConflicts = distinctEndpointConflicts(left, right)
      const leftEndpoint = left.endpoints.find(endpointIsCurrentlyReachable)
      const rightEndpoint = right.endpoints.find(endpointIsCurrentlyReachable)
      if (isolationConflicts.length > 0 || !leftEndpoint || !rightEndpoint) {
        return {
          state: "waiting_for_distinct_endpoints",
        say: "These approaches do not yet have two genuinely separate running copies. I am not claiming a comparison.",
          conflicts: isolationConflicts.length > 0 ? isolationConflicts : ["ENDPOINT_MISSING"],
          leftWorld: leftDto,
          rightWorld: rightDto,
        }
      }
      if (!comparisonPort) {
        return {
          state: "waiting_for_comparison_evidence",
          say: "Both running copies are separate, but I have not observed a comparison yet. I am not claiming differences.",
          conflicts: [],
          leftWorld: leftDto,
          rightWorld: rightDto,
        }
      }
      const evidence = await comparisonPort.compare({ userId, left: leftEndpoint, right: rightEndpoint })
      if (!evidence) {
        return {
          state: "waiting_for_comparison_evidence",
          say: "The comparison produced no usable observation, so I am not claiming differences.",
          conflicts: [],
          leftWorld: leftDto,
          rightWorld: rightDto,
        }
      }
      requireComparisonEvidence(evidence)
      return {
        state: "compared",
        say: evidence.conflicts.length > 0
          ? "The evidence shows unresolved differences; they remain conflicts, not a merged result."
          : "The isolated endpoints were compared and the evidence reports no conflicts.",
        conflicts: evidence.conflicts,
        leftWorld: leftDto,
        rightWorld: rightDto,
        comparisonSurface: {
          id: `compare:${left.id}:${right.id}:${evidence.artifactRef}`,
          kind: evidence.conflicts.length > 0 ? "conflict" : "compare",
          subject: evidence.subject,
          endpointId: leftEndpoint.id,
          title: "evidence from two isolated world endpoints",
          status: evidence.conflicts.length > 0 ? "failed" : "passed",
          provenance: {
            source: "comparison_evidence",
            observedAt: evidence.observedAt,
            artifactRef: evidence.artifactRef,
            evidenceRef: evidence.evidenceRef,
          },
          content: evidence.content ?? { leftEndpointId: leftEndpoint.id, rightEndpointId: rightEndpoint.id },
        },
      }
    },
  }
}

function initialLineReply(world: EnvironmentWorldProjection, assumptionOrQuestion: string): string {
  if (!world.resource) {
    return `${assumptionOrQuestion} I kept your sentence and have not changed anything.`
  }
  if (world.status !== "ready") {
    return `${assumptionOrQuestion} I kept the work together and am preparing a safe running copy. Nothing has changed yet.`
  }
  return `${assumptionOrQuestion} A verified running copy is ready. Nothing has been changed or tested yet.`
}

function lineContinuation(world: EnvironmentWorldProjection, visibleStatus: EnvironmentWorldStatus): string {
  if (!world.resource) return "I am still finding the right codebase. Your message is kept and nothing has changed."
  if (visibleStatus === "waiting_for_execution_endpoint") {
    return world.endpoints.length === 0
      ? "I am still preparing a safe running copy. Your message is kept and nothing has changed."
      : "The last running copy is no longer proven reachable. I kept your message and am waiting for current runtime evidence."
  }
  if (world.execution.state === "not_started") {
    return "The running copy is ready, but no change or test run has been observed. Your message is kept."
  }
  return world.execution.summary
}

export function distinctEndpointConflicts(
  left: EnvironmentWorldProjection,
  right: EnvironmentWorldProjection,
): string[] {
  if (left.id === right.id) return ["SAME_WORLD"]
  const a = left.endpoints.find(endpointIsCurrentlyReachable)
  const b = right.endpoints.find(endpointIsCurrentlyReachable)
  if (!a || !b) return ["ENDPOINT_MISSING"]
  return endpointPairConflicts(a, b)
}

function endpointIsCurrentlyReachable(endpoint: WorldEndpointIdentity): boolean {
  return endpoint.provenance.liveness.status === "reachable" &&
    endpoint.provenance.liveness.publicRoute.status === "reachable"
}

function invalidateEndpoint(endpoint: WorldEndpointIdentity, observedAt: string): WorldEndpointIdentity {
  return {
    ...endpoint,
    provenance: {
      ...endpoint.provenance,
      liveness: {
        ...endpoint.provenance.liveness,
        status: "unavailable",
        httpStatus: 0,
        observedAt,
        publicRoute: {
          ...endpoint.provenance.liveness.publicRoute,
          status: "unavailable",
          httpStatus: 0,
          observedAt,
        },
      },
    },
  }
}

export function endpointPairConflicts(a: WorldEndpointIdentity, b: WorldEndpointIdentity): string[] {
  const conflicts: string[] = []
  if (a.id === b.id) conflicts.push("SAME_ENDPOINT")
  if (a.resourceIdentity !== b.resourceIdentity) conflicts.push("DIFFERENT_RESOURCE")
  if (a.sandboxId === b.sandboxId) conflicts.push("SAME_SANDBOX")
  if (a.probeUrl === b.probeUrl) conflicts.push("SAME_PROBE_URL")
  if (a.appUrl === b.appUrl) conflicts.push("SAME_APP_URL")
  if (a.branch === b.branch) conflicts.push("SAME_BRANCH")
  if (a.head === b.head) conflicts.push("SAME_HEAD")
  if (a.filesystemRoot === b.filesystemRoot) conflicts.push("SAME_FILESYSTEM_ROOT")
  if (a.terminalStreamRef === b.terminalStreamRef) conflicts.push("SAME_TERMINAL_STREAM")
  if (a.testStreamRef === b.testStreamRef) conflicts.push("SAME_TEST_STREAM")
  return conflicts
}

function requireComparisonEvidence(evidence: ComparisonEvidence): void {
  if (evidence.durable !== true) throw new Error("COMPARISON_EVIDENCE_NOT_DURABLE")
  requireText(evidence.artifactRef, "COMPARISON_ARTIFACT_REQUIRED")
  requireText(evidence.evidenceRef, "COMPARISON_EVIDENCE_REQUIRED")
  requireText(evidence.subject, "COMPARISON_SUBJECT_REQUIRED")
  requireText(evidence.observedAt, "COMPARISON_OBSERVED_AT_REQUIRED")
  if (!Number.isFinite(Date.parse(evidence.observedAt))) throw new Error("COMPARISON_OBSERVED_AT_INVALID")
}

function requireText(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new EnvironmentInputError(code)
}

export class EnvironmentInputError extends Error {}
export class EnvironmentNotFoundError extends Error {}
export class EnvironmentConflictError extends Error {}
