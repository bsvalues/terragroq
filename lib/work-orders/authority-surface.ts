/**
 * Authority surface classes: `resource × class × capability`.
 *
 * The existing A0–A9 scale is a single monotonic `rank`, compared as a threshold. Its ordering is
 * A4_SCHEMA(4) < A5_DESTRUCTIVE(5) < A6_AUTH(6) < A7_COMMIT(7) < A8_PUSH(8) < A9_RELEASE(9), so
 * granting an agent commit authority mechanically ranks it ABOVE destructive-data and auth/secrets
 * authority. "May commit frontend code, may not touch secrets or run migrations" is not expressible
 * on that ladder at all — which is why a UI-lane work order ends up with commitAllowed: false. That
 * is a taxonomy defect wearing the costume of a risk judgement.
 *
 * Classes here are INDEPENDENT. No capability in one implies any capability in another, and the
 * resource is carried on the grant: with three repositories bound to one contract, `source:write`
 * does not say which source.
 *
 * This module is the vocabulary only. The A0–A9 scale stays in place as compatibility data on
 * historical work orders — nothing here rewrites them.
 */

export const SURFACE_CLASSES = [
  "source",
  "artifact",
  "runtime_config",
  "runtime_control",
  "data",
  "secrets",
  "delivery",
  "external",
] as const
export type SurfaceClass = (typeof SURFACE_CLASSES)[number]

/** Capabilities per class, ordered least → most. Ordering is meaningful only WITHIN a class. */
export const SURFACE_CAPABILITIES = {
  source: ["none", "read", "write"],
  artifact: ["none", "read", "write"],
  runtime_config: ["none", "read", "propose", "write"],
  runtime_control: ["none", "observe", "control"],
  data: ["none", "read", "additive", "destructive"],
  secrets: ["none", "read", "write"],
  delivery: ["none", "commit", "push", "pr", "merge", "release"],
  external: ["none", "read", "act"],
} as const satisfies Record<SurfaceClass, readonly string[]>

export type CapabilityOf<C extends SurfaceClass> = (typeof SURFACE_CAPABILITIES)[C][number]
export type AnyCapability = (typeof SURFACE_CAPABILITIES)[SurfaceClass][number]

/**
 * Classes that must name a resource. A bare grant on these is INVALID rather than permissive — a
 * malformed envelope should refuse, never silently widen.
 */
export const RESOURCE_SCOPED_CLASSES: readonly SurfaceClass[] = [
  "source",
  "data",
  "runtime_config",
  "runtime_control",
  "delivery",
]

/** The wildcard resource, legitimate only for classes that are genuinely not resource-bound. */
export const ANY_RESOURCE = "*"

/**
 * Classes where certification requires a principal distinct from the implementer, because the risk
 * needs judgment or separation of duties rather than observation.
 */
export const SEPARATION_OF_DUTIES: readonly SurfaceClass[] = ["secrets", "data", "delivery"]

export function isSurfaceClass(v: unknown): v is SurfaceClass {
  return typeof v === "string" && (SURFACE_CLASSES as readonly string[]).includes(v)
}

export function isCapabilityOf(cls: SurfaceClass, capability: string): boolean {
  return (SURFACE_CAPABILITIES[cls] as readonly string[]).includes(capability)
}

export function capabilityRank(cls: SurfaceClass, capability: string): number {
  return (SURFACE_CAPABILITIES[cls] as readonly string[]).indexOf(capability)
}

export interface EnvelopeEntry {
  resourceKey: string
  surfaceClass: SurfaceClass
  capability: string
}

export interface EnvelopeValidation {
  valid: boolean
  problems: string[]
}

/** A grant is well-formed when its class is known, its capability belongs to that class, and any
 *  resource-scoped class actually names a resource. */
export function validateEnvelopeEntry(entry: EnvelopeEntry): EnvelopeValidation {
  const problems: string[] = []
  if (!isSurfaceClass(entry.surfaceClass)) {
    return { valid: false, problems: [`Unknown surface class: ${entry.surfaceClass}`] }
  }
  if (!isCapabilityOf(entry.surfaceClass, entry.capability)) {
    problems.push(`${entry.capability} is not a capability of ${entry.surfaceClass}`)
  }
  // `none` is a DENIAL, and a denial needs no resource: `* / data / none` says "no data authority
  // anywhere", which is both meaningful and safe. The scoping rule exists so that a grant which
  // actually confers something cannot be vague about what it confers it over.
  const confersSomething = capabilityRank(entry.surfaceClass, entry.capability) > 0
  if (
    confersSomething &&
    RESOURCE_SCOPED_CLASSES.includes(entry.surfaceClass) &&
    (!entry.resourceKey?.trim() || entry.resourceKey === ANY_RESOURCE)
  ) {
    problems.push(`${entry.surfaceClass} must name a resource — a bare grant is invalid`)
  }
  return { valid: problems.length === 0, problems }
}

/**
 * Whether an envelope permits an operation.
 *
 * Absence is never permission: an operation on a class the envelope never mentions is denied.
 */
export function envelopePermits(
  envelope: readonly EnvelopeEntry[],
  need: EnvelopeEntry,
): boolean {
  const required = capabilityRank(need.surfaceClass, need.capability)
  if (required <= 0) return true // "none" needs nothing
  return envelope.some((granted) => {
    if (granted.surfaceClass !== need.surfaceClass) return false
    const scopeMatches =
      granted.resourceKey === need.resourceKey ||
      (granted.resourceKey === ANY_RESOURCE &&
        !RESOURCE_SCOPED_CLASSES.includes(need.surfaceClass))
    if (!scopeMatches) return false
    return capabilityRank(granted.surfaceClass, granted.capability) >= required
  })
}
