import { db } from "@/lib/db"
import { project, projectResource, projectResourceCheckout } from "@/lib/db/schema"
import {
  resolveProjectWorkspaceRoot,
  type ResolvedWorkspaceRoot,
  type ResourceCheckoutLike,
  type WorkspaceResourceLike,
} from "@/lib/loom/project-workspace-root"
import { eq, inArray } from "drizzle-orm"
import { bindW1Workspace, type W1BindingResult } from "@/lib/loom/w1-binding"
import type { ProjectIdentity } from "@/lib/environment/space-identity"

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

/* ------------------------------------------------------------------ */
/* Strict W1 loader + route resolver                                   */
/* ------------------------------------------------------------------ */

/**
 * The declared Project for this deployment, if any.
 *
 * Its PRESENCE is what switches a route from legacy behaviour (ambient root, no binding) to strict
 * W1 binding (Project-derived or refuse). A deployment that has been given a Project id is asserting
 * that it serves that Project's canonical repository, and ambient fallback is exactly the failure
 * W1 removes — so from that point there is none.
 */
export function declaredProjectId(): number | null {
  const raw = process.env.WILLIAMOS_PROJECT_ID?.trim()
  if (!raw) return null
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Load the strict W1 binding for a Project on the serving node. No ambient fallback. */
export async function loadW1WorkspaceRoot(input: {
  projectId: number
  node?: string
}): Promise<W1BindingResult> {
  const node = input.node ?? servingNode()

  const resources = await db
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

  const ids = resources.map((r) => r.id)
  const checkouts =
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

  return bindW1Workspace({ projectId: input.projectId, resources, checkouts, node })
}

export interface LoomRoot {
  root: string
  /** true when the root came from a strict W1 binding, false for the legacy ambient fallback. */
  bound: boolean
  projectId: number | null
  observedRevision: string | null
}

/**
 * Resolve the workspace root for a loom route.
 *
 * When a Project is declared, this binds strictly and returns a typed refusal on any binding
 * failure — never a silent ambient root. When no Project is declared (a legacy single-directory
 * deployment), it returns the ambient root the routes have always used, so nothing that works today
 * stops working. The switch is the declaration, and it is one-way: declaring a Project turns the
 * fallback off.
 */
export async function resolveLoomRoot(): Promise<LoomRoot | { refused: string; detail: string }> {
  const projectId = declaredProjectId()
  if (projectId == null) {
    return {
      root: process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd(),
      bound: false,
      projectId: null,
      observedRevision: null,
    }
  }

  const binding = await loadW1WorkspaceRoot({ projectId })
  if (!binding.ok) {
    return { refused: binding.refusal, detail: binding.detail }
  }
  return {
    root: binding.root,
    bound: true,
    projectId: binding.projectId,
    observedRevision: binding.observedRevision,
  }
}

/**
 * The declared Project as an identity record, for Space naming and world matching. Null when no
 * Project is declared, or the declared id does not resolve to a row.
 */
export async function declaredProjectIdentity(): Promise<ProjectIdentity | null> {
  const projectId = declaredProjectId()
  if (projectId == null) return null
  const [row] = await db
    .select({ id: project.id, key: project.key, name: project.name })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1)
  return row ?? null
}
