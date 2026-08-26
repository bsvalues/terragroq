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
  /**
   * Placed with the OWNER, not routed to an executor. A governance confirmation an agent cannot
   * perform for itself and the router cannot hand to another agent. It is still a real, tracked,
   * acceptance-gating dependency; it is simply not part of the agent execution chain.
   */
  ownerRouted?: boolean
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
  dependsOn: ["APPLY_GOVERNANCE_SCHEMA_MIGRATIONS", "APPLY_SERVICE_ENDPOINT_SCHEMA"],
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

export const APPLY_SERVICE_ENDPOINT_SCHEMA: BootstrapDependency = {
  key: "APPLY_SERVICE_ENDPOINT_SCHEMA",
  operation: "apply migration 0018-project-service-endpoint to the canonical WilliamOS database",
  requiredResource: "williamos-atlas-db",
  requiredClass: "data",
  requiredCapability: "additive",
  routingState: "raised",
  blocksAcceptance: true,
  // Runtime discovery exposed it, exactly as the checkout gap was exposed: project_resource can say
  // what a service is but not the per-node URL it is served at, and admission today proves a page
  // looks like TerraFusion, not that it belongs to the bound Project.
  evidence: [
    "project_resource has no endpoint or node-scoped service column",
    "admitWorkspaceApp proves reachable+frameable+looks-like-TerraFusion, not Project belonging",
    "0018 is one additive CREATE TABLE plus two indexes",
  ],
  unlocks: [
    "record per-node service endpoints and observe which Project each reports",
    "wire the Project-derived running-app URL through bindW1Runtime",
  ],
  excludes: ["any destructive or non-additive migration — additive DDL only"],
}

export const DECLARE_WORKSPACE_RUNTIME_SERVICE: BootstrapDependency = {
  key: "DECLARE_WORKSPACE_RUNTIME_SERVICE",
  operation:
    "owner declaration of a canonical workspace-runtime service resource for the TerraFusion " +
    "Project (project 2 today has only a pacs/runtime service, the SQL Server data runtime)",
  requiredResource: "williamos-project-registry",
  // Declaring what a Project's canonical service IS is a governance act, not something an agent
  // invents. Observing an endpoint against it, once it exists, is ordinary agent work.
  requiredCapabilityNonAuth: "owner-resource-declaration",
  routingState: "raised",
  blocksAcceptance: true,
  ownerRouted: true,
  evidence: [
    "Project 2's only service resource is id=40 pacs/runtime (aegis:/home/bs/mssql/data)",
    "bindW1Runtime refuses NO_WORKSPACE_RUNTIME against the live store",
  ],
  unlocks: ["a Project-derived, belonging-proven running-app URL for W1"],
}

export const RATIFY_CANONICAL_PROJECT_REPOSITORIES: BootstrapDependency = {
  key: "RATIFY_CANONICAL_PROJECT_REPOSITORIES",
  operation:
    "owner confirmation that each Project's primary-repo resource, and its observed per-node " +
    "checkout, are the canonical repository at the intended revision",
  requiredResource: "williamos-project-registry",
  // Not an authority-envelope operation. Ratification is an owner governance act -- confirming that
  // an agent-drafted record is true -- so it names a non-authority capability rather than a class.
  requiredCapabilityNonAuth: "owner-ratification",
  routingState: "raised",
  blocksAcceptance: true,
  // Placed with the owner, and orthogonal to the schema/land/deploy chain: it can happen at any
  // time, in parallel, and depends on nothing.
  ownerRouted: true,
  evidence: [
    "Zero repo resources are ratified in the canonical store",
    "Observed checkouts recorded on 2026-08-26 are all UNRATIFIED",
    "rootCanCertify refuses on every current binding for want of ratification",
  ],
  // The one thing it gates. Route wiring, runtime derivation, Space identity and the verifier are
  // all buildable and verifiable WITHOUT it; only certification is not.
  unlocks: ["final W1 certification against a ratified, bound workspace"],
}

export const BOOTSTRAP_DEPENDENCIES: readonly BootstrapDependency[] = [
  APPLY_GOVERNANCE_SCHEMA_MIGRATIONS,
  APPLY_SERVICE_ENDPOINT_SCHEMA,
  LAND_OUTCOME_ORCHESTRATION_REVISION,
  DEPLOY_OUTCOME_ORCHESTRATION_REVISION,
  RATIFY_CANONICAL_PROJECT_REPOSITORIES,
  DECLARE_WORKSPACE_RUNTIME_SERVICE,
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
      (d) => !d.ownerRouted && !resolved.has(d.key) && isActionable(d, resolvedKeys),
    ) ?? null
  )
}
