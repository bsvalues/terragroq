import { db } from "@/lib/db"
import { projectResource, projectResourceCheckout } from "@/lib/db/schema"
import {
  resolveProjectWorkspaceRoot,
  type ResolvedWorkspaceRoot,
  type ResourceCheckoutLike,
  type WorkspaceResourceLike,
} from "@/lib/loom/project-workspace-root"
import { eq, inArray } from "drizzle-orm"

/**
 * Load the rows the workspace-root resolver needs, and resolve.
 *
 * Split from the resolver so the rule stays pure and testable while the query lives somewhere it
 * can be read against the actual schema. The two halves are verified differently on purpose: the
 * rule by unit tests over fixtures modelled on live rows, the query by running it against the
 * canonical store and feeding what comes back into the rule.
 */

/** The node this process is running on. A workspace root means nothing without one. */
export function servingNode(): string {
  return (
    process.env.WILLIAMOS_NODE?.trim() ||
    process.env.HOSTNAME?.trim() ||
    "unknown"
  ).toLowerCase()
}

export interface LoadWorkspaceRootInput {
  projectId: number | null
  /** A `resourceKey` or a `relationship`; repos in the canonical store carry the latter. */
  resourceSelector?: string | null
  node?: string
}

export async function loadWorkspaceRoot(
  input: LoadWorkspaceRootInput,
): Promise<ResolvedWorkspaceRoot> {
  const node = input.node ?? servingNode()
  const cwd = process.cwd()
  const ambientRoot = process.env.WILLIAMOS_PROJECT_ROOT ?? null

  // No Project means no lookup worth doing; the resolver reports the ambient fallback honestly.
  if (input.projectId == null) {
    return resolveProjectWorkspaceRoot({
      projectId: null,
      resources: [],
      checkouts: [],
      node,
      ambientRoot,
      cwd,
    })
  }

  const resourceRows = await db
    .select({
      id: projectResource.id,
      resourceKey: projectResource.resourceKey,
      relationship: projectResource.relationship,
      type: projectResource.type,
      canonicalIdentity: projectResource.canonicalIdentity,
      ratifiedAt: projectResource.ratifiedAt,
    })
    .from(projectResource)
    .where(eq(projectResource.projectId, input.projectId))

  const resources: WorkspaceResourceLike[] = resourceRows

  // Only this Project's resources, so a checkout belonging to another Project's repo can never be
  // matched by a coincidence of id ordering.
  const ids = resources.map((r) => r.id)
  const checkoutRows =
    ids.length > 0
      ? await db
          .select({
            projectResourceId: projectResourceCheckout.projectResourceId,
            node: projectResourceCheckout.node,
            path: projectResourceCheckout.path,
            observedIdentity: projectResourceCheckout.observedIdentity,
            observedRevision: projectResourceCheckout.observedRevision,
            ratifiedAt: projectResourceCheckout.ratifiedAt,
          })
          .from(projectResourceCheckout)
          .where(inArray(projectResourceCheckout.projectResourceId, ids))
      : []

  const checkouts: ResourceCheckoutLike[] = checkoutRows

  return resolveProjectWorkspaceRoot({
    projectId: input.projectId,
    resources,
    checkouts,
    node,
    resourceSelector: input.resourceSelector ?? null,
    ambientRoot,
    cwd,
  })
}
