/**
 * The STRICT workspace binding W1 routes use.
 *
 * `resolveProjectWorkspaceRoot` falls back to an ambient root and reports the fallback honestly,
 * which is right for a general resolver: an editor should still open when a Project record is
 * incomplete. W1 is different. Its whole reason to exist is that the workspace must be the
 * canonical repository at a known revision on the serving node, and "we could not bind, so here is
 * whatever WILLIAMOS_PROJECT_ROOT pointed at" is the exact failure it eliminates. So this binder
 * NEVER falls back. It either returns a fully-bound root or a typed refusal.
 *
 * `primary-repo` is treated as a cardinality assertion, not a filter. The schema does not enforce
 * one primary repo per Project, so the binder does: zero is unbound, more than one is ambiguous,
 * and only exactly one resolves. Pretending two divergent checkouts are interchangeable is the
 * error; binding one specific checkout on one node at one observed revision is the fix.
 */

import { canonicalRepoIdentity, sameRepository } from "@/lib/loom/repo-identity"
import type {
  ResourceCheckoutLike,
  WorkspaceResourceLike,
} from "@/lib/loom/project-workspace-root"

export const PRIMARY_REPO_RELATIONSHIP = "primary-repo"

export type BindingRefusal =
  | "NO_PROJECT"
  | "NO_PRIMARY_REPO"
  | "AMBIGUOUS_PRIMARY_REPO"
  | "RESOURCE_IDENTITY_UNRECOGNISED"
  | "NOT_CHECKED_OUT_ON_NODE"
  | "NO_OBSERVED_REVISION"
  | "REMOTE_MISMATCH"

export interface BoundWorkspace {
  ok: true
  root: string
  node: string
  projectId: number
  resourceId: number
  /** Canonical `owner/repo`. */
  identity: string
  observedRevision: string
  /** Owner-confirmed at both resource and checkout level; certification needs it, binding does not. */
  ratified: boolean
}

export interface RefusedBinding {
  ok: false
  refusal: BindingRefusal
  detail: string
}

export type W1BindingResult = BoundWorkspace | RefusedBinding

export interface W1BindingInput {
  projectId: number | null
  resources: readonly WorkspaceResourceLike[]
  checkouts: readonly ResourceCheckoutLike[]
  node: string
}

/**
 * Bind the W1 workspace, or refuse with a reason. No ambient fallback, ever.
 */
export function bindW1Workspace(input: W1BindingInput): W1BindingResult {
  if (input.projectId == null) {
    return refuse("NO_PROJECT", "W1 requires a bound Project; the Space names none")
  }

  const primaries = input.resources.filter(
    (r) => r.type === "repo" && r.relationship === PRIMARY_REPO_RELATIONSHIP,
  )

  if (primaries.length === 0) {
    return refuse(
      "NO_PRIMARY_REPO",
      `Project ${input.projectId} has no repo resource with relationship "${PRIMARY_REPO_RELATIONSHIP}"`,
    )
  }
  if (primaries.length > 1) {
    // The cardinality assertion. The schema will not stop two, so the binder does.
    return refuse(
      "AMBIGUOUS_PRIMARY_REPO",
      `Project ${input.projectId} has ${primaries.length} primary-repo resources (ids ${primaries
        .map((r) => r.id)
        .join(", ")}); exactly one is required`,
    )
  }

  const resource = primaries[0]
  const identity = canonicalRepoIdentity(resource.canonicalIdentity)
  if (!identity) {
    return refuse(
      "RESOURCE_IDENTITY_UNRECOGNISED",
      `Resource ${resource.id} identity "${resource.canonicalIdentity}" is not a recognised repository reference`,
    )
  }

  const checkout = input.checkouts.find(
    (c) => c.projectResourceId === resource.id && c.node === input.node,
  )
  if (!checkout) {
    return refuse(
      "NOT_CHECKED_OUT_ON_NODE",
      `Resource ${resource.id} (${identity}) is not checked out on ${input.node}`,
    )
  }

  if (!checkout.observedRevision?.trim()) {
    // A checkout with no observed revision cannot be bound at a known SHA, which is the one thing
    // W1 binding is for.
    return refuse(
      "NO_OBSERVED_REVISION",
      `Checkout of ${identity} at ${checkout.path} on ${input.node} has no observed revision`,
    )
  }

  if (checkout.observedIdentity != null && !sameRepository(resource.canonicalIdentity, checkout.observedIdentity)) {
    return refuse(
      "REMOTE_MISMATCH",
      `Checkout at ${checkout.path} on ${input.node} is ${canonicalRepoIdentity(checkout.observedIdentity) ?? checkout.observedIdentity}, not ${identity}`,
    )
  }

  return {
    ok: true,
    root: checkout.path,
    node: input.node,
    projectId: input.projectId,
    resourceId: resource.id,
    identity,
    observedRevision: checkout.observedRevision,
    ratified: resource.ratifiedAt != null && checkout.ratifiedAt != null,
  }
}

function refuse(refusal: BindingRefusal, detail: string): RefusedBinding {
  return { ok: false, refusal, detail }
}
