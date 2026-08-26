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
  // RESOLVED: applied to ATLAS 2026-08-26 in one transaction, 42->49 tables, every existing
  // work_order/grant/project/governance count identical. This is why the chain must be recomputed
  // rather than replayed: dependents of this key are now satisfied.
  routingState: "resolved",
  blocksAcceptance: true,
  evidence: [
    "Applied 0014-0017 to ATLAS williamos-postgres:15432/williamos in a single transaction",
    "Pre/post counts identical: 47 work_order, 30 grant, 5 project, 1111 governance_event",
    "Seven tables created, all four invariant indexes live, zero destructive statements",
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
  // APPLY_GOVERNANCE_SCHEMA_MIGRATIONS is already resolved, so it is no longer a pending gate. The
  // live prerequisites are the endpoint schema and a real, observed workspace runtime to bind and
  // verify the branch's binder against before it lands.
  dependsOn: ["APPLY_SERVICE_ENDPOINT_SCHEMA", "PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME"],
  evidence: [
    "Branch is local-only; no delivery capability held on this repository",
    "The runtime binder must be verified against a real provisioned endpoint before landing",
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
  // RESOLVED: applied to ATLAS 2026-08-26, 49->50 tables, all existing counts identical, the
  // node-unique index live. project_service_endpoint now exists to write observations into.
  routingState: "resolved",
  blocksAcceptance: true,
  evidence: [
    "Applied 0018 to ATLAS in a single transaction: 1 CREATE TABLE, 2 indexes",
    "49->50 tables; work_order 47, project 5, governance_event 1111 all unchanged",
    "project_service_endpoint has all 12 columns and project_service_endpoint_node_unique",
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
    "owner declaration AND ratification of a canonical workspace-runtime service resource for the " +
    "TerraFusion Project (project 2 today has only a pacs/runtime service, the SQL Server data runtime)",
  requiredResource: "williamos-project-registry",
  // Declaring what a Project's canonical service IS is a governance act, not something an agent
  // invents. Ratification travels WITH the declaration -- a declared-but-unratified service is a
  // governance record the owner has not actually confirmed, so certification would still refuse.
  requiredCapabilityNonAuth: "owner-resource-declaration",
  // RESOLVED: owner declared+ratified service id=42 on ATLAS 2026-08-26 -- type service,
  // resourceKey/relationship workspace-runtime, canonicalIdentity terrafusion/os-shell (logical, no
  // URL/port/path), label "TerraFusion OS Shell". bindW1Runtime no longer returns NO_WORKSPACE_RUNTIME.
  routingState: "resolved",
  blocksAcceptance: true,
  ownerRouted: true,
  evidence: [
    "Declared+ratified project_resource id=42 terrafusion/os-shell for project 2",
    "Canonical identity is logical, not a URL/port/path; endpoint belongs in project_service_endpoint",
    "bindW1Runtime now returns NOT_SERVED_ON_NODE, not NO_WORKSPACE_RUNTIME",
  ],
  // Declaring the service says what is authoritative; it does not make it run. Provisioning is a
  // separate authority and a separate dependency.
  unlocks: ["provisioning and observation of a real workspace-runtime endpoint"],
}

export const PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME: BootstrapDependency = {
  key: "PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME",
  operation:
    "stand up a real workspace-runtime endpoint on the serving node for the declared service, and " +
    "write its observed endpoint/project/revision binding into project_service_endpoint",
  requiredResource: "williamos-workspace-runtime",
  // Routed to whoever holds runtime_control (and any runtime_config the service genuinely needs)
  // for this service -- an executor, but not this source actor, whose envelope grants only observe.
  requiredClass: "runtime_control",
  requiredCapability: "control",
  routingState: "raised",
  blocksAcceptance: true,
  // Both prerequisites: the endpoint table must exist to write into, and the canonical service must
  // exist to bind the endpoint to.
  dependsOn: ["APPLY_SERVICE_ENDPOINT_SCHEMA", "DECLARE_WORKSPACE_RUNTIME_SERVICE"],
  evidence: [
    "No workspace-runtime endpoint exists on any node for project 2",
    "bindW1Runtime refuses RUNTIME_NOT_OBSERVED until a real endpoint reports its Project",
  ],
  unlocks: ["the Project/runtime binder becomes executable and testable against live state"],
  // The load-bearing exclusion: a declared canonical service pointed at an improvised dev server is
  // the same defect one level up. The endpoint must be a real running service, not a resurrection.
  excludes: [
    "resurrecting the invented https://192.168.88.9:5199 server, or any improvised dev server, as " +
      "the canonical endpoint",
    "any runtime_config mutation beyond what this service genuinely requires — that is its own dependency",
  ],
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
  // RESOLVED for W1: owner ratified Project 2's primary-repo (id=2, bsvalues/terrafusion_os_1.0) on
  // ATLAS 2026-08-26. Deliberately narrow -- id=41 (LocalOps) and id=1 (terragroq) left UNRATIFIED.
  routingState: "resolved",
  blocksAcceptance: true,
  ownerRouted: true,
  evidence: [
    "Ratified project_resource id=2 bsvalues/terrafusion_os_1.0 for project 2 only",
    "LocalOps id=41 and terragroq id=1 deliberately untouched",
    "Repo-level rootCanCertify no longer refuses for want of resource ratification",
  ],
  // The one thing it gates. Route wiring, runtime derivation, Space identity and the verifier are
  // all buildable and verifiable WITHOUT it; only certification is not.
  unlocks: ["final W1 certification against a ratified, bound workspace"],
}

export const BOOTSTRAP_DEPENDENCIES: readonly BootstrapDependency[] = [
  APPLY_GOVERNANCE_SCHEMA_MIGRATIONS,
  APPLY_SERVICE_ENDPOINT_SCHEMA,
  DECLARE_WORKSPACE_RUNTIME_SERVICE,
  PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME,
  LAND_OUTCOME_ORCHESTRATION_REVISION,
  DEPLOY_OUTCOME_ORCHESTRATION_REVISION,
  RATIFY_CANONICAL_PROJECT_REPOSITORIES,
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
/**
 * The keys already resolved according to the dependencies' own recorded state. This is what makes
 * recompute reflect reality rather than a hand-passed list: APPLY_GOVERNANCE_SCHEMA_MIGRATIONS
 * carries routingState "resolved", so it drops out of every "what is still pending" computation.
 */
export function resolvedDependencyKeys(): string[] {
  return BOOTSTRAP_DEPENDENCIES.filter((d) => d.routingState === "resolved").map((d) => d.key)
}

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
