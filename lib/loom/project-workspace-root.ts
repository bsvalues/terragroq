/**
 * Which workspace a Space is actually showing.
 *
 * Nine routes resolve their root as `process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()`. That is
 * one process-wide directory with no Project attached, so the Space is TerraFusion by
 * CONFIGURATION rather than by construction: the header can say TerraFusion while the files
 * underneath belong to whatever the launcher happened to export, and nothing in the system is in a
 * position to notice. It is exactly how a session spent a day editing a checkout thirteen commits
 * behind main and reported it as progress.
 *
 * The repair is not to remove the environment variable — the launcher legitimately sets it, and a
 * single-project deployment is a real configuration. It is to make the DIFFERENCE observable. A
 * root resolved from a Project's canonical repo resource is `project` provenance and can be
 * verified against a truth binding; a root taken from the environment is `ambient` and cannot.
 * Acceptance can then refuse to certify against an ambient root instead of silently accepting it.
 *
 * Pure, with the resource lookup injected, so the rule is testable without a database.
 */

export type RootProvenance = "project" | "ambient" | "cwd"

export interface ResolvedWorkspaceRoot {
  root: string
  provenance: RootProvenance
  /** The Project this root belongs to, when it belongs to one. */
  projectId: number | null
  /** The project_resource key the root came from, when it came from one. */
  resourceKey: string | null
  /** The canonical identity of that resource — the remote a checkout must match. */
  canonicalIdentity: string | null
  /**
   * Whether the owner has confirmed the resource record. An agent-drafted resource still resolves,
   * but nothing derived from it may certify.
   */
  ratified: boolean
  /** Why this root is not Project-derived, when it is not. */
  unboundReason?: string
}

/** The subset of `project_resource` this needs. */
export interface WorkspaceResourceLike {
  resourceKey: string
  type: string
  canonicalIdentity: string
  /** Where the checkout of this resource lives on the machine serving it. */
  localPath: string | null
  ratifiedAt: Date | null
}

export interface ResolveRootInput {
  projectId: number | null
  /** Resources of that Project, already scoped to it by the caller. */
  resources: readonly WorkspaceResourceLike[]
  /** Which resource the Space is showing. Defaults to the Project's only repo. */
  resourceKey?: string | null
  /** `WILLIAMOS_PROJECT_ROOT`, when set. */
  ambientRoot?: string | null
  /** `process.cwd()`, the last resort. */
  cwd: string
}

/**
 * Resolve the workspace root for a Space.
 *
 * Falls back the way the current code does, so nothing that works today stops working — but each
 * fallback is labelled, and the label is what acceptance reads.
 */
export function resolveProjectWorkspaceRoot(input: ResolveRootInput): ResolvedWorkspaceRoot {
  const ambient = input.ambientRoot?.trim() || null

  if (input.projectId == null) {
    return unbound(ambient, input.cwd, "No Project bound to this Space")
  }

  const repos = input.resources.filter((r) => r.type === "repo")
  const candidate = input.resourceKey
    ? repos.find((r) => r.resourceKey === input.resourceKey)
    : repos.length === 1
      ? repos[0]
      : undefined

  if (!candidate) {
    return unbound(
      ambient,
      input.cwd,
      input.resourceKey
        ? `Project has no repo resource "${input.resourceKey}"`
        : repos.length === 0
          ? "Project has no repo resource"
          : // Refusing to guess is the point: picking one of several would reintroduce exactly the
            // ambiguity this exists to remove, and would do it silently.
            `Project has ${repos.length} repo resources and the Space names none`,
    )
  }

  if (!candidate.localPath?.trim()) {
    return {
      ...unbound(ambient, input.cwd, `Resource "${candidate.resourceKey}" has no local checkout path`),
      projectId: input.projectId,
      resourceKey: candidate.resourceKey,
      canonicalIdentity: candidate.canonicalIdentity,
      ratified: candidate.ratifiedAt != null,
    }
  }

  return {
    root: candidate.localPath,
    provenance: "project",
    projectId: input.projectId,
    resourceKey: candidate.resourceKey,
    canonicalIdentity: candidate.canonicalIdentity,
    ratified: candidate.ratifiedAt != null,
  }
}

function unbound(
  ambient: string | null,
  cwd: string,
  reason: string,
): ResolvedWorkspaceRoot {
  return {
    root: ambient ?? cwd,
    provenance: ambient ? "ambient" : "cwd",
    projectId: null,
    resourceKey: null,
    canonicalIdentity: null,
    ratified: false,
    unboundReason: reason,
  }
}

/**
 * Whether work done against this root can be certified.
 *
 * An ambient root cannot: there is no canonical identity to compare a checkout against, so
 * "the right repository at the right revision" is not a question the system can answer. Work
 * proceeds — refusing to open an editor because a Project record is missing would be worse — but
 * acceptance says so rather than passing.
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
  if (!resolved.ratified) {
    return {
      ok: false,
      reason: `Resource "${resolved.resourceKey}" is not owner-ratified`,
    }
  }
  return { ok: true }
}
