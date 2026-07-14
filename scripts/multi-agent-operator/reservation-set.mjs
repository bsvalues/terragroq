const RESERVATION_KINDS = Object.freeze([
  ["paths", "PATH"],
  ["contracts", "CONTRACT"],
  ["environments", "ENVIRONMENT"],
  ["repositories", "REPOSITORY"],
  ["protectedResources", "PROTECTED_RESOURCE"],
])

const INVALID_REASON_ORDER = Object.freeze([
  "INVALID_RESERVATION_SET",
  "INVALID_RESERVATION_VALUE",
  "DUPLICATE_RESERVATION",
  "SELF_PATH_COLLISION",
  "SAME_RESERVATION_SET_ID",
])

const CONFLICT_REASON_ORDER = Object.freeze([
  "PATH_EXACT_COLLISION",
  "PATH_ANCESTOR_COLLISION",
  "CONTRACT_COLLISION",
  "ENVIRONMENT_COLLISION",
  "REPOSITORY_COLLISION",
  "PROTECTED_RESOURCE_COLLISION",
])

export class ReservationSetError extends Error {
  constructor(code, detail = code) {
    super(`${code}:${detail}`)
    this.name = "ReservationSetError"
    this.code = code
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function stableCompare(left, right) {
  return left.localeCompare(right, "en", { sensitivity: "variant" })
}

function normalizeIdentity(value) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized === "" || normalized.includes("\0") ? null : normalized
}

export function normalizeRelativePath(value) {
  if (typeof value !== "string") return null
  const candidate = value.trim().replaceAll("\\", "/")
  if (candidate === "" || candidate.includes("\0") || candidate.startsWith("/")
    || /^[A-Za-z]:\//.test(candidate)) return null

  const segments = []
  for (const segment of candidate.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (segments.length === 0) return null
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return segments.length === 0 ? null : segments.join("/")
}

function pathRelation(left, right) {
  if (left === right) return "EXACT"
  if (right.startsWith(`${left}/`) || left.startsWith(`${right}/`)) return "ANCESTOR"
  return null
}

function overlappingRepositoryContexts(leftRepositories, rightRepositories) {
  if (leftRepositories.length === 0 && rightRepositories.length === 0) return ["@dispatch-repository"]
  if (leftRepositories.length === 0) return [...rightRepositories]
  if (rightRepositories.length === 0) return [...leftRepositories]
  const right = new Set(rightRepositories)
  return leftRepositories.filter((repository) => right.has(repository)).sort(stableCompare)
}

function diagnostic(reasonCode, set, kind, values, detail = {}) {
  return Object.freeze({
    reasonCode,
    reservationSetId: typeof set?.reservationSetId === "string" ? set.reservationSetId : null,
    kind,
    values: Object.freeze([...values].sort(stableCompare)),
    ...detail,
  })
}

function normalizeKind(set, field, label, invalid) {
  const values = set.reservations[field]
  if (!Array.isArray(values)) {
    invalid.push(diagnostic("INVALID_RESERVATION_SET", set, label, [], { field }))
    return []
  }

  const normalized = []
  for (const raw of values) {
    const value = field === "paths" ? normalizeRelativePath(raw) : normalizeIdentity(raw)
    if (value === null || value === "") {
      invalid.push(diagnostic("INVALID_RESERVATION_VALUE", set, label,
        [typeof raw === "string" ? raw : JSON.stringify(raw)], { field }))
    } else {
      normalized.push(value)
    }
  }

  const counts = new Map()
  for (const value of normalized) counts.set(value, (counts.get(value) ?? 0) + 1)
  for (const [value, count] of counts) {
    if (count > 1) invalid.push(diagnostic("DUPLICATE_RESERVATION", set, label, [value], { count }))
  }

  const unique = [...counts.keys()].sort(stableCompare)
  if (field === "paths") {
    for (let left = 0; left < unique.length; left += 1) {
      for (let right = left + 1; right < unique.length; right += 1) {
        if (pathRelation(unique[left], unique[right]) === "ANCESTOR") {
          invalid.push(diagnostic("SELF_PATH_COLLISION", set, label, [unique[left], unique[right]]))
        }
      }
    }
  }
  return unique
}

export function normalizeReservationSet(input) {
  const invalid = []
  if (!plainObject(input)
    || input.schemaVersion !== 1
    || input.artifactType !== "MULTI_AGENT_RESERVATION_SET"
    || normalizeIdentity(input.reservationSetId) === null
    || normalizeIdentity(input.workerId) === null
    || normalizeIdentity(input.workOrderId) === null
    || !plainObject(input.reservations)) {
    invalid.push(diagnostic("INVALID_RESERVATION_SET", input, "SET", []))
  }

  const safeSet = plainObject(input) ? input : {}
  const reservations = plainObject(safeSet.reservations) ? safeSet.reservations : {}
  const working = { ...safeSet, reservations }
  const normalizedReservations = {}
  for (const [field, label] of RESERVATION_KINDS) {
    normalizedReservations[field] = normalizeKind(working, field, label, invalid)
  }

  invalid.sort((left, right) => {
    const reason = INVALID_REASON_ORDER.indexOf(left.reasonCode) - INVALID_REASON_ORDER.indexOf(right.reasonCode)
    return reason || stableCompare(left.kind, right.kind) || stableCompare(left.values.join("\0"), right.values.join("\0"))
  })
  return Object.freeze({
    valid: invalid.length === 0,
    reservationSet: Object.freeze({
      schemaVersion: 1,
      artifactType: "MULTI_AGENT_RESERVATION_SET",
      reservationSetId: normalizeIdentity(safeSet.reservationSetId),
      workerId: normalizeIdentity(safeSet.workerId),
      workOrderId: normalizeIdentity(safeSet.workOrderId),
      reservations: Object.freeze(normalizedReservations),
    }),
    diagnostics: Object.freeze(invalid),
  })
}

function conflict(reasonCode, kind, leftSet, rightSet, leftValue, rightValue, detail = {}) {
  return Object.freeze({
    reasonCode,
    kind,
    leftReservationSetId: leftSet.reservationSetId,
    rightReservationSetId: rightSet.reservationSetId,
    leftValue,
    rightValue,
    ...detail,
  })
}

export function checkReservationCompatibility(leftInput, rightInput) {
  const left = normalizeReservationSet(leftInput)
  const right = normalizeReservationSet(rightInput)
  const invalid = [...left.diagnostics, ...right.diagnostics]

  if (left.reservationSet.reservationSetId !== null
    && left.reservationSet.reservationSetId === right.reservationSet.reservationSetId) {
    invalid.push(diagnostic("SAME_RESERVATION_SET_ID", left.reservationSet, "SET",
      [left.reservationSet.reservationSetId]))
  }

  invalid.sort((a, b) => {
    const reason = INVALID_REASON_ORDER.indexOf(a.reasonCode) - INVALID_REASON_ORDER.indexOf(b.reasonCode)
    return reason || stableCompare(a.reservationSetId ?? "", b.reservationSetId ?? "")
      || stableCompare(a.kind, b.kind) || stableCompare(a.values.join("\0"), b.values.join("\0"))
  })

  const conflicts = []
  if (invalid.length === 0) {
    const leftSet = left.reservationSet
    const rightSet = right.reservationSet
    const repositoryContexts = overlappingRepositoryContexts(
      leftSet.reservations.repositories,
      rightSet.reservations.repositories,
    )
    if (repositoryContexts.length > 0) {
      for (const leftPath of leftSet.reservations.paths) {
        for (const rightPath of rightSet.reservations.paths) {
          const relation = pathRelation(leftPath, rightPath)
          if (relation) conflicts.push(conflict(
            relation === "EXACT" ? "PATH_EXACT_COLLISION" : "PATH_ANCESTOR_COLLISION",
            "PATH", leftSet, rightSet, leftPath, rightPath,
            { repositoryContexts: Object.freeze(repositoryContexts) },
          ))
        }
      }
    }
    for (const [field, label] of RESERVATION_KINDS.slice(1)) {
      const rightValues = new Set(rightSet.reservations[field])
      for (const value of leftSet.reservations[field]) {
        if (rightValues.has(value)) conflicts.push(conflict(
          `${label}_COLLISION`, label, leftSet, rightSet, value, value,
        ))
      }
    }
  }

  conflicts.sort((a, b) => {
    const reason = CONFLICT_REASON_ORDER.indexOf(a.reasonCode) - CONFLICT_REASON_ORDER.indexOf(b.reasonCode)
    return reason || stableCompare(a.leftValue, b.leftValue) || stableCompare(a.rightValue, b.rightValue)
  })
  const reasonCodes = [...new Set((invalid.length > 0 ? invalid : conflicts).map((item) => item.reasonCode))]

  return Object.freeze({
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_COMPATIBILITY_RESULT",
    status: invalid.length > 0 ? "INVALID" : conflicts.length > 0 ? "CONFLICT" : "COMPATIBLE",
    compatible: invalid.length === 0 && conflicts.length === 0,
    reasonCodes: Object.freeze(reasonCodes),
    leftReservationSetId: left.reservationSet.reservationSetId,
    rightReservationSetId: right.reservationSet.reservationSetId,
    invalid: Object.freeze(invalid),
    conflicts: Object.freeze(conflicts),
    effect: "PRE_DISPATCH_CHECK_ONLY",
    ledgerClaimed: false,
    authorityGranted: false,
  })
}
