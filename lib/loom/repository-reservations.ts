export type RepositoryExecutionIdentity = Readonly<{
  repositoryResourceId: number
  repositoryKey: string
  repositoryIdentity: string
  repositoryMountKey: string
  worktreeKey: string
  baseRevision: string
}>

export type ContractReservation = Readonly<{
  contractIdentity: string
  revisionIdentity: string
  role: "producer" | "consumer"
}>

export type EnvironmentReservation = Readonly<{
  environmentIdentity: string
  access: "exclusive" | "shared-read"
}>

export type AssignmentReservationSet = Readonly<{
  assignmentId: string
  repository: RepositoryExecutionIdentity
  paths: readonly string[]
  contracts: readonly ContractReservation[]
  environments: readonly EnvironmentReservation[]
}>

export type ReservationCollision = Readonly<{
  kind: "path" | "contract" | "environment"
  leftAssignmentId: string
  rightAssignmentId: string
  identity: string
  reason: string
}>

export type ReservationDependency = Readonly<{
  contractIdentity: string
  revisionIdentity: string
  producerAssignmentId: string
  consumerAssignmentId: string
}>

export type RepositoryReservationAssessment = Readonly<{
  status: "compatible" | "blocked"
  collisions: readonly ReservationCollision[]
  dependencies: readonly ReservationDependency[]
}>

export class RepositoryReservationError extends Error {
  readonly code:
    | "INVALID_ASSIGNMENT_IDENTITY"
    | "INVALID_REPOSITORY_IDENTITY"
    | "AMBIGUOUS_REPOSITORY_IDENTITY"
    | "AMBIGUOUS_MOUNT_IDENTITY"
    | "AMBIGUOUS_WORKTREE_IDENTITY"
    | "INVALID_PATH_RESERVATION"
    | "INVALID_RESERVATION_IDENTITY"

  constructor(code: RepositoryReservationError["code"], message: string) {
    super(message)
    this.name = "RepositoryReservationError"
    this.code = code
  }
}

type NormalizedReservationSet = Readonly<{
  assignmentId: string
  repository: RepositoryExecutionIdentity
  paths: readonly string[]
  contracts: readonly ContractReservation[]
  environments: readonly EnvironmentReservation[]
}>

const REPOSITORY = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const REVISION = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const RESERVATION_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/

function fail(code: RepositoryReservationError["code"], message: string): never {
  throw new RepositoryReservationError(code, message)
}

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function canonicalPath(value: unknown): string {
  const candidate = nonEmpty(value)
  const body = candidate.endsWith("/**") ? candidate.slice(0, -3) : candidate
  if (!candidate
    || candidate.includes("\\")
    || candidate.startsWith("/")
    || /^[A-Za-z]:/.test(candidate)
    || candidate.includes("//")
    || body.endsWith("/")
    || body.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || /[*?\[\]]/.test(body)) {
    fail("INVALID_PATH_RESERVATION", `path reservation is not canonical: ${candidate || "<empty>"}`)
  }
  return candidate
}

function reservationIdentity(value: unknown, label: string): string {
  const candidate = nonEmpty(value)
  if (!RESERVATION_IDENTITY.test(candidate)) {
    fail("INVALID_RESERVATION_IDENTITY", `${label} is missing or not canonical`)
  }
  return candidate
}

function normalize(input: AssignmentReservationSet): NormalizedReservationSet {
  const assignmentId = reservationIdentity(input.assignmentId, "assignment identity")
  const repositoryResourceId = input.repository?.repositoryResourceId
  const repositoryKey = nonEmpty(input.repository?.repositoryKey)
  const repositoryIdentity = nonEmpty(input.repository?.repositoryIdentity)
  const repositoryMountKey = reservationIdentity(input.repository?.repositoryMountKey, "repository mount identity")
  const worktreeKey = reservationIdentity(input.repository?.worktreeKey, "worktree identity")
  const baseRevision = nonEmpty(input.repository?.baseRevision)
  if (!Number.isSafeInteger(repositoryResourceId) || repositoryResourceId <= 0
    || !KEY.test(repositoryKey) || !REPOSITORY.test(repositoryIdentity) || !REVISION.test(baseRevision)) {
    fail("INVALID_REPOSITORY_IDENTITY", `assignment ${assignmentId} has an incomplete repository execution identity`)
  }
  if (!Array.isArray(input.paths) || input.paths.length === 0) {
    fail("INVALID_PATH_RESERVATION", `assignment ${assignmentId} has no repository path reservation`)
  }

  const paths = [...new Set(input.paths.map(canonicalPath))].sort()
  const contracts = [...input.contracts.map((contract) => {
    const contractIdentity = reservationIdentity(contract.contractIdentity, "contract identity")
    const revisionIdentity = reservationIdentity(contract.revisionIdentity, "contract revision identity")
    if (contract.role !== "producer" && contract.role !== "consumer") {
      fail("INVALID_RESERVATION_IDENTITY", `contract ${contractIdentity} has an unknown reservation role`)
    }
    return { contractIdentity, revisionIdentity, role: contract.role }
  })].sort((left, right) =>
    `${left.contractIdentity}\0${left.revisionIdentity}\0${left.role}`.localeCompare(
      `${right.contractIdentity}\0${right.revisionIdentity}\0${right.role}`,
    ))
  const environments = [...input.environments.map((environment) => {
    const environmentIdentity = reservationIdentity(environment.environmentIdentity, "environment identity")
    if (environment.access !== "exclusive" && environment.access !== "shared-read") {
      fail("INVALID_RESERVATION_IDENTITY", `environment ${environmentIdentity} has an unknown access mode`)
    }
    return { environmentIdentity, access: environment.access }
  })].sort((left, right) =>
    `${left.environmentIdentity}\0${left.access}`.localeCompare(`${right.environmentIdentity}\0${right.access}`))

  return {
    assignmentId,
    repository: {
      repositoryResourceId,
      repositoryKey,
      repositoryIdentity,
      repositoryMountKey,
      worktreeKey,
      baseRevision,
    },
    paths,
    contracts,
    environments,
  }
}

function assertUnambiguous(assignments: readonly NormalizedReservationSet[]): void {
  const assignmentIds = new Set<string>()
  const resourceIdentities = new Map<number, string>()
  const repositoryResources = new Map<string, string>()
  const repositoryKeys = new Map<string, string>()
  const mountRepositories = new Map<string, string>()
  const worktreeRepositories = new Map<string, string>()

  for (const assignment of assignments) {
    if (assignmentIds.has(assignment.assignmentId)) {
      fail("INVALID_ASSIGNMENT_IDENTITY", `assignment identity is duplicated: ${assignment.assignmentId}`)
    }
    assignmentIds.add(assignment.assignmentId)
    const repository = assignment.repository
    const descriptor = `${repository.repositoryKey}\0${repository.repositoryIdentity}`
    const priorIdentity = resourceIdentities.get(repository.repositoryResourceId)
    if (priorIdentity && priorIdentity !== descriptor) {
      fail(
        "AMBIGUOUS_REPOSITORY_IDENTITY",
        `repository resource ${repository.repositoryResourceId} resolves to multiple canonical identities`,
      )
    }
    resourceIdentities.set(repository.repositoryResourceId, descriptor)

    const priorResource = repositoryResources.get(repository.repositoryIdentity)
    const resourceDescriptor = `${repository.repositoryResourceId}\0${repository.repositoryKey}`
    if (priorResource && priorResource !== resourceDescriptor) {
      fail(
        "AMBIGUOUS_REPOSITORY_IDENTITY",
        `canonical repository ${repository.repositoryIdentity} resolves to multiple resource identities`,
      )
    }
    repositoryResources.set(repository.repositoryIdentity, resourceDescriptor)

    const priorKeyIdentity = repositoryKeys.get(repository.repositoryKey)
    if (priorKeyIdentity && priorKeyIdentity !== repository.repositoryIdentity) {
      fail("AMBIGUOUS_REPOSITORY_IDENTITY", `repository key ${repository.repositoryKey} resolves ambiguously`)
    }
    repositoryKeys.set(repository.repositoryKey, repository.repositoryIdentity)

    const priorMountRepository = mountRepositories.get(repository.repositoryMountKey)
    if (priorMountRepository && priorMountRepository !== repository.repositoryIdentity) {
      fail("AMBIGUOUS_MOUNT_IDENTITY", `repository mount ${repository.repositoryMountKey} resolves ambiguously`)
    }
    mountRepositories.set(repository.repositoryMountKey, repository.repositoryIdentity)

    const priorWorktreeRepository = worktreeRepositories.get(repository.worktreeKey)
    if (priorWorktreeRepository && priorWorktreeRepository !== repository.repositoryIdentity) {
      fail("AMBIGUOUS_WORKTREE_IDENTITY", `worktree ${repository.worktreeKey} resolves ambiguously`)
    }
    worktreeRepositories.set(repository.worktreeKey, repository.repositoryIdentity)
  }
}

function pathParts(value: string): Readonly<{ path: string; recursive: boolean }> {
  return value.endsWith("/**")
    ? { path: value.slice(0, -3), recursive: true }
    : { path: value, recursive: false }
}

function pathsOverlap(leftValue: string, rightValue: string): boolean {
  const left = pathParts(leftValue)
  const right = pathParts(rightValue)
  if (left.path === right.path) return true
  if (left.recursive && right.path.startsWith(`${left.path}/`)) return true
  return right.recursive && left.path.startsWith(`${right.path}/`)
}

function orderedPair(
  left: NormalizedReservationSet,
  right: NormalizedReservationSet,
): readonly [NormalizedReservationSet, NormalizedReservationSet] {
  return left.assignmentId.localeCompare(right.assignmentId) <= 0 ? [left, right] : [right, left]
}

function comparePair(
  first: NormalizedReservationSet,
  second: NormalizedReservationSet,
  collisions: ReservationCollision[],
  dependencies: ReservationDependency[],
): void {
  const [left, right] = orderedPair(first, second)
  if (left.repository.repositoryIdentity === right.repository.repositoryIdentity) {
    for (const leftPath of left.paths) {
      for (const rightPath of right.paths) {
        if (!pathsOverlap(leftPath, rightPath)) continue
        const broader = leftPath.endsWith("/**") ? leftPath : rightPath.endsWith("/**") ? rightPath : leftPath
        collisions.push({
          kind: "path",
          leftAssignmentId: left.assignmentId,
          rightAssignmentId: right.assignmentId,
          identity: `${left.repository.repositoryIdentity}:${broader}`,
          reason: "repository path reservations overlap",
        })
      }
    }
  }

  for (const leftContract of left.contracts) {
    for (const rightContract of right.contracts) {
      if (leftContract.contractIdentity !== rightContract.contractIdentity) continue
      if (leftContract.revisionIdentity !== rightContract.revisionIdentity) {
        if (leftContract.role === "producer" && rightContract.role === "producer") {
          collisions.push({
            kind: "contract",
            leftAssignmentId: left.assignmentId,
            rightAssignmentId: right.assignmentId,
            identity: leftContract.contractIdentity,
            reason: "contract has competing producer revisions",
          })
        } else if (leftContract.role !== rightContract.role) {
          collisions.push({
            kind: "contract",
            leftAssignmentId: left.assignmentId,
            rightAssignmentId: right.assignmentId,
            identity: leftContract.contractIdentity,
            reason: "contract producer and consumer revisions differ",
          })
        }
        continue
      }
      if (leftContract.role === "producer" && rightContract.role === "producer") {
        collisions.push({
          kind: "contract",
          leftAssignmentId: left.assignmentId,
          rightAssignmentId: right.assignmentId,
          identity: `${leftContract.contractIdentity}@${leftContract.revisionIdentity}`,
          reason: "contract revision has multiple producers",
        })
      } else if (leftContract.role !== rightContract.role) {
        const producer = leftContract.role === "producer" ? left : right
        const consumer = leftContract.role === "consumer" ? left : right
        dependencies.push({
          contractIdentity: leftContract.contractIdentity,
          revisionIdentity: leftContract.revisionIdentity,
          producerAssignmentId: producer.assignmentId,
          consumerAssignmentId: consumer.assignmentId,
        })
      }
    }
  }

  for (const leftEnvironment of left.environments) {
    for (const rightEnvironment of right.environments) {
      if (leftEnvironment.environmentIdentity === rightEnvironment.environmentIdentity
        && (leftEnvironment.access === "exclusive" || rightEnvironment.access === "exclusive")) {
        collisions.push({
          kind: "environment",
          leftAssignmentId: left.assignmentId,
          rightAssignmentId: right.assignmentId,
          identity: leftEnvironment.environmentIdentity,
          reason: "environment reservation requires exclusive access",
        })
      }
    }
  }
}

function uniqueSorted<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()]
    .sort((left, right) => key(left).localeCompare(key(right)))
}

export function assessRepositoryReservations(
  input: readonly AssignmentReservationSet[],
): RepositoryReservationAssessment {
  const assignments = input.map(normalize)
  assertUnambiguous(assignments)
  const collisions: ReservationCollision[] = []
  const dependencies: ReservationDependency[] = []
  for (let left = 0; left < assignments.length; left += 1) {
    for (let right = left + 1; right < assignments.length; right += 1) {
      comparePair(assignments[left], assignments[right], collisions, dependencies)
    }
  }
  const distinctCollisions = uniqueSorted(collisions, (collision) =>
    `${collision.kind}\0${collision.leftAssignmentId}\0${collision.rightAssignmentId}\0${collision.identity}\0${collision.reason}`)
  const distinctDependencies = uniqueSorted(dependencies, (dependency) =>
    `${dependency.contractIdentity}\0${dependency.revisionIdentity}\0${dependency.producerAssignmentId}\0${dependency.consumerAssignmentId}`)
  return Object.freeze({
    status: distinctCollisions.length === 0 ? "compatible" : "blocked",
    collisions: Object.freeze(distinctCollisions.map((collision) => Object.freeze(collision))),
    dependencies: Object.freeze(distinctDependencies.map((dependency) => Object.freeze(dependency))),
  })
}
