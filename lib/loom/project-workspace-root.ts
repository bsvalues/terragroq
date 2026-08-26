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
  /** project_resource.id — the identifier that is always present. */
  resourceId: number | null
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

/**
 * The subset of `project_resource` this needs.
 *
 * Identified by `id`, not by `resourceKey`. In the canonical store `resourceKey` is NULL on 11 of
 * 21 resources and on EVERY repo -- the ten that carry one are all `pacs`. A resolver that matched
 * on it would find nothing and fall back to an ambient root for every Project, silently, which is
 * the exact defect this file exists to remove. `relationship` (`primary-repo`) is the discriminator
 * that is actually populated, so selection accepts either.
 */
export interface WorkspaceResourceLike {
  id: number
  resourceKey: string | null
  relationship: string | null
  type: string
  canonicalIdentity: string
  ratifiedAt: Date | null
}

/** The subset of `project_resource_checkout` this needs. Bound by FK, as the table is. */
export interface ResourceCheckoutLike {
  projectResourceId: number
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
  /**
   * Which resource the Space is showing: a `resourceKey` OR a `relationship`, whichever the record
   * actually carries. Defaults to the Project's only repo.
   */
  resourceSelector?: string | null
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
    resourceId: null,
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
  const selector = input.resourceSelector?.trim() || null
  const resource = selector
    ? repos.find((r) => r.resourceKey === selector || r.relationship === selector)
    : repos.length === 1
      ? repos[0]
      : undefined

  if (!resource) {
    return unbound(
      selector
        ? `Project has no repo resource matching "${selector}"`
        : repos.length === 0
          ? "Project has no repo resource"
          : // Refusing to guess is the point: picking one of several would reintroduce exactly the
            // ambiguity this exists to remove, and would do it silently.
            `Project has ${repos.length} repo resources and the Space names none`,
    )
  }

  const checkout = input.checkouts.find(
    (c) => c.projectResourceId === resource.id && c.node === input.node,
  )

  if (!checkout) {
    // Normal and meaningful: most resources are not checked out on most nodes.
    return unbound(`Resource ${describe(resource)} is not checked out on ${input.node}`, {
      projectId: input.projectId,
      resourceId: resource.id,
      resourceKey: resource.resourceKey,
      canonicalIdentity: resource.canonicalIdentity,
    })
  }

  return {
    root: checkout.path,
    provenance: "project",
    node: input.node,
    projectId: input.projectId,
    resourceId: resource.id,
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

/** A resource has a key only sometimes; it always has an id and usually a relationship. */
function describe(r: WorkspaceResourceLike): string {
  return r.resourceKey ?? r.relationship ?? `#${r.id}`
}

/**
 * Whether two repository identities name the same repository.
 *
 * They are written very differently in practice. The canonical store records a repo resource as the
 * bare slug `bsvalues/terrafusion_os_1.0`, while a checkout observed on disk reports a full remote:
 * `git@github.com:bsvalues/terrafusion_os_1.0.git` or the https form. Comparing those as strings --
 * even after stripping schemes -- makes every correct checkout look like a mismatch, which would
 * block certification on exactly the repositories that are right.
 *
 * So each side is reduced to an optional host plus an owner/repo path, and the host is compared
 * only when BOTH sides carry one. A slug matches any host; two explicit hosts must agree, so
 * github.com/a/b and gitlab.com/a/b are still correctly different.
 */
export function identitiesMatch(a: string, b: string): boolean {
  const left = normalise(a)
  const right = normalise(b)
  if (left.path !== right.path || left.path === "") return false
  if (left.host && right.host) return left.host === right.host
  return true
}

function normalise(value: string): { host: string | null; path: string } {
  let v = value.trim().toLowerCase()
  if (!v) return { host: null, path: "" }
  v = v
    .replace(/^git\+/, "")
    .replace(/^ssh:\/\/git@/, "")
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")

  const segments = v.split("/").filter(Boolean)
  // A host is a leading segment with a dot in it; a bare slug has none.
  const hasHost = segments.length > 2 && segments[0].includes(".")
  return {
    host: hasHost ? segments[0] : null,
    path: (hasHost ? segments.slice(1) : segments).slice(-2).join("/"),
  }
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
    return {
      ok: false,
      reason: `Checkout of ${resolved.resourceKey ?? `resource ${resolved.resourceId}`} on ${resolved.node} is not owner-ratified`,
    }
  }
  return { ok: true }
}
