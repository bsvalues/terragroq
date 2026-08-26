/**
 * Which workspace a Space is actually showing, on the node actually serving it.
 *
 * Nine routes resolve their root as `process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()`. That is
 * one process-wide directory with no Project attached, so the Space is TerraFusion by
 * CONFIGURATION rather than by construction: the header can say TerraFusion while the files
 * underneath belong to whatever the launcher happened to export, and nothing in the system is in a
 * position to notice. It is exactly how a session spent a day editing a checkout thirteen commits
 * behind main and reported it as progress.
 *
 * Resolution is `(canonical resource, serving node) → checkout`, never `resource → path`. A path is
 * not a property of a repository: the same repo is at C:\... on HERMES, /srv/... on AEGIS,
 * elsewhere on OMEN and absent on ATLAS. Hanging one path off the canonical resource would be
 * WILLIAMOS_PROJECT_ROOT rebuilt inside the database.
 *
 * The repair is not to remove the environment variable — the launcher legitimately sets it, and a
 * single-project deployment is a real configuration. It is to make the DIFFERENCE observable. A
 * root resolved from a Project's repo checkout is `project` provenance and can be verified against
 * a truth binding; a root taken from the environment is `ambient` and cannot. Acceptance then
 * refuses to certify against an ambient root instead of silently accepting it.
 *
 * Pure, with the lookups injected, so the rule is testable without a database.
 */

export type RootProvenance = "project" | "ambient" | "cwd"

export interface ResolvedWorkspaceRoot {
  root: string
  provenance: RootProvenance
  /** The node this resolution is about. A root means nothing without one. */
  node: string
  projectId: number | null
  resourceKey: string | null
  /** The canonical identity of that resource — the remote a checkout must match. */
  canonicalIdentity: string | null
  /** The remote actually observed at the path, when it has been observed. */
  observedIdentity: string | null
  observedRevision: string | null
  /** Owner-confirmed at BOTH levels: the resource record and the checkout binding. */
  ratified: boolean
  /**
   * The checkout claims to be a different repository than the resource says. Detectable only
   * because observed identity is recorded separately from canonical identity.
   */
  identityMismatch: boolean
  /** Why this root is not Project-derived, when it is not. */
  unboundReason?: string
}

/** The subset of `project_resource` this needs. */
export interface WorkspaceResourceLike {
  resourceKey: string
  type: string
  canonicalIdentity: string
  ratifiedAt: Date | null
}

/** The subset of `project_resource_checkout` this needs. */
export interface ResourceCheckoutLike {
  resourceKey: string
  node: string
  path: string
  observedIdentity: string | null
  observedRevision: string | null
  ratifiedAt: Date | null
}

export interface ResolveRootInput {
  projectId: number | null
  /** Resources of that Project, already scoped to it by the caller. */
  resources: readonly WorkspaceResourceLike[]
  /** Checkout bindings, any node; this filters to `node` itself. */
  checkouts: readonly ResourceCheckoutLike[]
  /** The node actually serving this Space. */
  node: string
  /** Which resource the Space is showing. Defaults to the Project's only repo. */
  resourceKey?: string | null
  /** `WILLIAMOS_PROJECT_ROOT`, when set. */
  ambientRoot?: string | null
  /** `process.cwd()`, the last resort. */
  cwd: string
}

/**
 * Resolve the workspace root for a Space on a given node.
 *
 * Falls back the way the current code does, so nothing that works today stops working — but each
 * fallback is labelled, and the label is what acceptance reads.
 */
export function resolveProjectWorkspaceRoot(input: ResolveRootInput): ResolvedWorkspaceRoot {
  const ambient = input.ambientRoot?.trim() || null
  const unbound = (reason: string, extra: Partial<ResolvedWorkspaceRoot> = {}) => ({
    root: ambient ?? input.cwd,
    provenance: (ambient ? "ambient" : "cwd") as RootProvenance,
    node: input.node,
    projectId: null,
    resourceKey: null,
    canonicalIdentity: null,
    observedIdentity: null,
    observedRevision: null,
    ratified: false,
    identityMismatch: false,
    unboundReason: reason,
    ...extra,
  })

  if (input.projectId == null) return unbound("No Project bound to this Space")

  const repos = input.resources.filter((r) => r.type === "repo")
  const resource = input.resourceKey
    ? repos.find((r) => r.resourceKey === input.resourceKey)
    : repos.length === 1
      ? repos[0]
      : undefined

  if (!resource) {
    return unbound(
      input.resourceKey
        ? `Project has no repo resource "${input.resourceKey}"`
        : repos.length === 0
          ? "Project has no repo resource"
          : // Refusing to guess is the point: picking one of several would reintroduce exactly the
            // ambiguity this exists to remove, and would do it silently.
            `Project has ${repos.length} repo resources and the Space names none`,
    )
  }

  const checkout = input.checkouts.find(
    (c) => c.resourceKey === resource.resourceKey && c.node === input.node,
  )

  if (!checkout) {
    // Normal and meaningful: most resources are not checked out on most nodes.
    return unbound(`Resource "${resource.resourceKey}" is not checked out on ${input.node}`, {
      projectId: input.projectId,
      resourceKey: resource.resourceKey,
      canonicalIdentity: resource.canonicalIdentity,
    })
  }

  return {
    root: checkout.path,
    provenance: "project",
    node: input.node,
    projectId: input.projectId,
    resourceKey: resource.resourceKey,
    canonicalIdentity: resource.canonicalIdentity,
    observedIdentity: checkout.observedIdentity,
    observedRevision: checkout.observedRevision,
    // Both levels must be confirmed. A ratified resource pointed at an unratified checkout is still
    // an agent's guess about which directory on this machine it means.
    ratified: resource.ratifiedAt != null && checkout.ratifiedAt != null,
    identityMismatch:
      checkout.observedIdentity != null &&
      !identitiesMatch(resource.canonicalIdentity, checkout.observedIdentity),
  }
}

/** Repository identities differ cosmetically far more often than they differ meaningfully. */
function identitiesMatch(a: string, b: string): boolean {
  return normalise(a) === normalise(b)
}

function normalise(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/^git\+/, "")
    .replace(/^ssh:\/\/git@/, "")
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
}

/**
 * Whether work done against this root can be certified.
 *
 * An ambient root cannot: there is no canonical identity to compare a checkout against, so
 * "the right repository at the right revision" is not a question the system can answer. Work
 * proceeds — refusing to open an editor because a Project record is missing would be worse than
 * the bug — but acceptance says so rather than passing.
 */
export function rootCanCertify(resolved: ResolvedWorkspaceRoot): {
  ok: boolean
  reason?: string
} {
  if (resolved.provenance !== "project") {
    return {
      ok: false,
      reason: `Workspace root is ${resolved.provenance}, not Project-derived: ${resolved.unboundReason ?? "unbound"}`,
    }
  }
  if (resolved.identityMismatch) {
    return {
      ok: false,
      reason:
        `Checkout at ${resolved.root} on ${resolved.node} reports ${resolved.observedIdentity}, ` +
        `but the resource is ${resolved.canonicalIdentity}`,
    }
  }
  if (!resolved.ratified) {
    return { ok: false, reason: `Checkout of "${resolved.resourceKey}" on ${resolved.node} is not owner-ratified` }
  }
  return { ok: true }
}
