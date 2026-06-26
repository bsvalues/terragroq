// WO-014 — Current Truth Freshness Model (pure logic).
//
// WilliamOS must not treat old facts as current facts. Every truth claim is
// typed, sourced, timestamped, and assigned a confidence + freshness. Volatile
// truth (git status, branch, HEAD, test results, PR state) MUST be rechecked
// before any mutation/commit/push/tag/release/production touch.

export const TRUTH_TYPES = [
  { id: "STATIC_TRUTH", label: "Static", ttlMinutes: null, volatile: false, hint: "Rarely changes (identity, doctrine constants)." },
  { id: "SESSION_TRUTH", label: "Session", ttlMinutes: 720, volatile: false, hint: "Stable within a working session." },
  { id: "VOLATILE_TRUTH", label: "Volatile", ttlMinutes: 5, volatile: true, hint: "Git status, branch, HEAD, tests, PR state." },
  { id: "EVIDENCE_TRUTH", label: "Evidence", ttlMinutes: null, volatile: false, hint: "Backed by a recorded evidence artifact." },
  { id: "LOCK_TRUTH", label: "Lock", ttlMinutes: null, volatile: false, hint: "A posture/lock decision (HOLD/STOP/FREEZE)." },
  { id: "UNKNOWN", label: "Unknown", ttlMinutes: 0, volatile: true, hint: "Not established — must be verified." },
  { id: "STALE", label: "Stale", ttlMinutes: 0, volatile: true, hint: "Known to be out of date." },
  { id: "ASSUMED", label: "Assumed", ttlMinutes: 0, volatile: true, hint: "Presumed without verification." },
] as const

export type TruthTypeId = (typeof TRUTH_TYPES)[number]["id"]

export type Freshness = "fresh" | "aging" | "stale"

export function truthType(id: string) {
  return TRUTH_TYPES.find((t) => t.id === id)
}

export function isVolatileType(id: string): boolean {
  return truthType(id)?.volatile ?? true
}

// Gates that REQUIRE volatile truth to be rechecked first.
export const MUTATION_GATES = ["mutation", "commit", "push", "tag", "release", "production"] as const
export type MutationGate = (typeof MUTATION_GATES)[number]

// Compute freshness from the claim's type and when it was captured.
export function computeFreshness(typeId: string, capturedAt: Date, now: Date = new Date()): Freshness {
  const spec = truthType(typeId)
  if (typeId === "STALE" || typeId === "UNKNOWN") return "stale"
  if (!spec || spec.ttlMinutes === null) return "fresh" // non-expiring types
  const ageMin = (now.getTime() - capturedAt.getTime()) / 60_000
  if (spec.ttlMinutes === 0) return "stale"
  if (ageMin <= spec.ttlMinutes) return "fresh"
  if (ageMin <= spec.ttlMinutes * 3) return "aging"
  return "stale"
}

export interface RecheckDecision {
  required: boolean
  reason: string
}

// Must this claim be rechecked before performing `gate`? Volatile or non-fresh
// truth always requires a recheck before a mutating gate.
export function requiresRecheck(
  claim: { truthType: string; capturedAt: Date; verificationRequiredBefore: string[] },
  gate: MutationGate,
  now: Date = new Date(),
): RecheckDecision {
  const freshness = computeFreshness(claim.truthType, claim.capturedAt, now)
  const explicitlyGated = claim.verificationRequiredBefore
    .map((g) => g.toLowerCase())
    .includes(gate)

  if (explicitlyGated && freshness !== "fresh") {
    return { required: true, reason: `Claim is ${freshness} and gated on "${gate}" — recheck before proceeding.` }
  }
  if (isVolatileType(claim.truthType) && freshness !== "fresh") {
    return { required: true, reason: `Volatile truth is ${freshness} — recheck before "${gate}".` }
  }
  return { required: false, reason: `Fresh enough to support "${gate}".` }
}

// Sensible default gates for a given truth type (used when an operator does not
// specify verificationRequiredBefore explicitly).
export function defaultVerificationGates(typeId: string): MutationGate[] {
  return isVolatileType(typeId) ? [...MUTATION_GATES] : []
}
