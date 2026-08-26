/**
 * The live-boundary operations the bootstrap outcome cannot perform itself.
 *
 * They are declared here as data because the table that will hold them ships in the same branch
 * that raises them — until migration 0016 is applied there is nowhere to insert a routed
 * dependency, which is itself one of these dependencies. Declaring them makes the record exact
 * rather than narrative: the moment the schema lands they insert verbatim.
 *
 * Three, not two, because they are genuinely different boundaries. Landing a revision and running
 * it are separate authorities, and collapsing them lets "deploy this known revision" quietly
 * become "and change whatever configuration is convenient on the way". If deployment discovers it
 * must alter protected runtime configuration, that is a NEW routed dependency, not something the
 * deploy authority was carrying all along.
 *
 * The other thing this file has to get right is that `blocked` is not permanent. A dependency
 * resolving makes work executable again, so each one declares what it unlocks and the guard is
 * recomputed rather than remembered.
 */

import type { RoutedDependencyLike } from "@/lib/work-orders/routed-dependency"

export interface BootstrapDependency extends RoutedDependencyLike {
  key: string
  requiredResource: string
  evidence: string[]
  /** Work that becomes executable once this resolves. Drives recomputation of `blocked`. */
  unlocks: readonly string[]
  /** Operations this deliberately does NOT carry. Each would be its own routed dependency. */
  excludes?: readonly string[]
  /** Keys that must resolve before this one is even actionable. */
  dependsOn?: readonly string[]
}

export const APPLY_GOVERNANCE_SCHEMA_MIGRATIONS: BootstrapDependency = {
  key: "APPLY_GOVERNANCE_SCHEMA_MIGRATIONS",
  operation:
    "apply migrations 0014-work-order-assignment, 0015-work-order-truth-binding, " +
    "0016-routed-dependency and 0017-project-resource-checkout to the canonical WilliamOS database",
  requiredResource: "williamos-atlas-db",
  requiredClass: "data",
  requiredCapability: "additive",
  routingState: "raised",
  blocksAcceptance: true,
  evidence: [
    "Envelope grants */data/none — no data capability on any resource",
    "Canonical store is ATLAS williamos-postgres:15432/williamos",
    "Four migration files exist and are unapplied",
  ],
  // Every remaining source task needs a live Project, resource and per-node checkout to resolve
  // against. None of them are writable-then-verifiable before the schema exists.
  unlocks: [
    "wire /api/loom/files and the eight sibling routes through the Project-derived workspace root",
    "derive the running-app URL from the bound Project instead of a global env var",
    "give the Space a truthful identity and name instead of the literal string TerraFusion",
    "record per-node checkouts for the canonical repo and observe their remote and revision",
  ],
  excludes: [
    "any destructive or non-additive migration — this is additive DDL only",
    "any mutation of existing work order, grant or project rows",
  ],
}

export const LAND_OUTCOME_ORCHESTRATION_REVISION: BootstrapDependency = {
  key: "LAND_OUTCOME_ORCHESTRATION_REVISION",
  operation:
    "land the reviewed successor revision of the outcome-orchestration work on the canonical " +
    "WilliamOS repository",
  requiredResource: "williamos-primary-repo",
  requiredClass: "delivery",
  requiredCapability: "merge",
  routingState: "raised",
  blocksAcceptance: true,
  // Deliberately AFTER the schema: the current branch is a checkpoint, not the final deployable
  // result, and landing it as though the source work were finished would be its own untruth.
  dependsOn: ["APPLY_GOVERNANCE_SCHEMA_MIGRATIONS"],
  evidence: [
    "Branch is local-only; no delivery capability held on this repository",
    "Source work depending on the live schema is not yet written",
  ],
  unlocks: ["deploy the exact merged successor revision"],
  excludes: ["deployment — running a revision is a separate authority from landing it"],
}

export const DEPLOY_OUTCOME_ORCHESTRATION_REVISION: BootstrapDependency = {
  key: "DEPLOY_OUTCOME_ORCHESTRATION_REVISION",
  operation:
    "deploy the exact merged successor SHA to the WilliamOS service and prove that exact revision " +
    "is the one running",
  requiredResource: "williamos-workspace-runtime",
  requiredClass: "runtime_control",
  requiredCapability: "control",
  routingState: "raised",
  blocksAcceptance: true,
  dependsOn: ["LAND_OUTCOME_ORCHESTRATION_REVISION"],
  evidence: [
    "Envelope grants runtime_control:observe, not control",
    "Deployed revision must be proven equal to the landed successor, not assumed",
  ],
  unlocks: ["run deterministic W1 acceptance against the deployed revision"],
  // The load-bearing exclusion. Without it, "restart this known revision" absorbs "and edit
  // whatever config is convenient", and the protected surface stops being protected.
  excludes: [
    "runtime_config:write — altering protected runtime configuration is a SEPARATE routed dependency",
    "any revision other than the exact landed successor SHA",
  ],
}

export const BOOTSTRAP_DEPENDENCIES: readonly BootstrapDependency[] = [
  APPLY_GOVERNANCE_SCHEMA_MIGRATIONS,
  LAND_OUTCOME_ORCHESTRATION_REVISION,
  DEPLOY_OUTCOME_ORCHESTRATION_REVISION,
]

/**
 * Implementation work executable with NO dependency resolved.
 *
 * Empty, and correctly so. The geometry defect is fixed, the W1 contract and its deterministic
 * verifier exist, the authority vocabulary is built, and the workspace-root resolver is written and
 * tested. Everything left needs a live Project to resolve against.
 *
 * Leaving completed items listed here would lie to the guard this file exists to feed — it would
 * answer "not blocked" from work that no longer exists, which is precisely the failure the model
 * was built to prevent, committed by the model itself.
 */
export const BOOTSTRAP_INDEPENDENT_WORK: readonly string[] = []

/**
 * What is executable given the dependencies resolved so far.
 *
 * `blocked` is a description of the present, never a memory of the past. A work order that went
 * blocked and whose schema dependency then resolved has executable work again and must return to
 * `active` — it should not stay blocked merely because it once was.
 */
export function executableWorkAfter(resolvedKeys: readonly string[]): string[] {
  const resolved = new Set(resolvedKeys)
  const unlocked = BOOTSTRAP_DEPENDENCIES.filter((d) => resolved.has(d.key)).flatMap(
    (d) => [...d.unlocks],
  )
  return [...BOOTSTRAP_INDEPENDENT_WORK, ...unlocked]
}

/** Whether a dependency can even be worked yet, or is waiting on one of its predecessors. */
export function isActionable(
  dependency: BootstrapDependency,
  resolvedKeys: readonly string[],
): boolean {
  const resolved = new Set(resolvedKeys)
  return (dependency.dependsOn ?? []).every((key) => resolved.has(key))
}

/** The next dependency the router should place, in the order the boundaries actually allow. */
export function nextActionableDependency(
  resolvedKeys: readonly string[],
): BootstrapDependency | null {
  const resolved = new Set(resolvedKeys)
  return (
    BOOTSTRAP_DEPENDENCIES.find(
      (d) => !resolved.has(d.key) && isActionable(d, resolvedKeys),
    ) ?? null
  )
}
