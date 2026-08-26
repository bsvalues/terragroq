/**
 * The two live-boundary operations the bootstrap outcome cannot perform itself.
 *
 * Both are real walls, and neither stops the work. They are declared here as data because the
 * table that will hold them ships in the same branch that raises them — until migration 0016 is
 * applied there is nowhere to insert a routed dependency, which is itself one of the two
 * dependencies. Declaring them makes the record exact rather than narrative: the moment the schema
 * lands these insert verbatim.
 *
 * The point of the exercise is the assertion at the bottom of the accompanying test — with both of
 * these open, the bootstrap outcome is NOT blocked, because independent implementation work
 * remains. That is the difference between the model working and the model being a document.
 */

import type { RoutedDependencyLike } from "@/lib/work-orders/routed-dependency"

export const APPLY_GOVERNANCE_SCHEMA_MIGRATIONS: RoutedDependencyLike & {
  key: string
  requiredResource: string
  evidence: string[]
} = {
  key: "APPLY_GOVERNANCE_SCHEMA_MIGRATIONS",
  operation:
    "apply migrations 0014-work-order-assignment, 0015-work-order-truth-binding and " +
    "0016-routed-dependency to the canonical WilliamOS database",
  requiredResource: "williamos-atlas-db",
  requiredClass: "data",
  requiredCapability: "additive",
  routingState: "raised",
  // Additive DDL on the canonical governance store. Nothing in the implementing envelope reaches
  // `data` at any capability, so this is not a judgement call about risk — it is simply outside.
  blocksAcceptance: true,
  evidence: [
    "Envelope grants */data/none — no data capability on any resource",
    "Canonical store is ATLAS williamos-postgres:15432/williamos",
    "Three migration files exist and are unapplied",
  ],
}

export const LAND_AND_DEPLOY_ROUTING_REPAIR: RoutedDependencyLike & {
  key: string
  requiredResource: string
  evidence: string[]
} = {
  key: "LAND_AND_DEPLOY_ROUTING_REPAIR",
  operation:
    "land branch wo/delegated-subject-routing on the canonical WilliamOS repository and deploy it",
  requiredResource: "williamos-primary-repo",
  requiredClass: "delivery",
  requiredCapability: "merge",
  routingState: "raised",
  blocksAcceptance: true,
  evidence: [
    "Branch is local-only; no delivery capability held on this repository",
    "Work is committed and green but unreachable by any running WilliamOS",
  ],
}

export const BOOTSTRAP_DEPENDENCIES = [
  APPLY_GOVERNANCE_SCHEMA_MIGRATIONS,
  LAND_AND_DEPLOY_ROUTING_REPAIR,
] as const

/**
 * Implementation work that remains executable while both dependencies stand open.
 *
 * Maintained deliberately, not as a comment: `evaluateBlocked` asks whether ANY acceptance path is
 * still executable, and the honest answer has to come from somewhere. When this list empties and
 * both dependencies are still open, the outcome is genuinely blocked and should say so.
 */
export const BOOTSTRAP_INDEPENDENT_WORK = [
  "W1 outcome contract expressed against the new primitives",
  "deterministic W1 acceptance verifier",
  "geometry-corruption detection for the border-box defect",
  "authority surface vocabulary and envelope evaluation",
] as const
