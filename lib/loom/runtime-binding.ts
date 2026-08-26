/**
 * Binding the W1 running application to the bound Project, on the serving node.
 *
 * `admitWorkspaceApp` takes one configured URL and proves it is reachable, frameable, and looks
 * like TerraFusion by an identity header or the word "terrafusion" in its HTML. That proves a page
 * exists and resembles the app. It does NOT prove the running service belongs to the bound Project:
 * any TerraFusion build on any port would pass, including a stale one on an invented port — which
 * is exactly what happened.
 *
 * So belonging is proven from recorded observation, not appearance. A service is bound like a repo:
 * the Project has exactly one workspace-runtime service resource (a cardinality assertion, since the
 * schema does not enforce it and `runtime` is already overloaded — project 2's only `runtime`
 * service is the PACS data runtime), that resource has an endpoint on the serving node, and the
 * endpoint has been OBSERVED to report the bound Project. The header/HTML check stays, downgraded to
 * a secondary sanity check on a URL that has already been shown to belong.
 *
 * Pure, with the rows injected. No ambient fallback: bind the bound Project's service or refuse.
 */

export const WORKSPACE_RUNTIME_RELATIONSHIP = "workspace-runtime"

export type RuntimeRefusal =
  | "NO_PROJECT"
  | "NO_WORKSPACE_RUNTIME"
  | "AMBIGUOUS_WORKSPACE_RUNTIME"
  | "NOT_SERVED_ON_NODE"
  | "RUNTIME_NOT_OBSERVED"
  | "RUNTIME_PROJECT_MISMATCH"

/** The subset of a `service` project_resource this needs. */
export interface ServiceResourceLike {
  id: number
  resourceKey: string | null
  relationship: string | null
  type: string
  canonicalIdentity: string
  ratifiedAt: Date | null
}

/** The subset of `project_service_endpoint` this needs. */
export interface ServiceEndpointLike {
  projectResourceId: number
  node: string
  endpoint: string
  /** Which Project the running service reported belonging to. Null means never observed. */
  observedProjectId: number | null
  observedServiceIdentity: string | null
  observedRevision: string | null
  ratifiedAt: Date | null
}

export interface BoundRuntime {
  ok: true
  endpoint: string
  node: string
  projectId: number
  resourceId: number
  observedRevision: string | null
  /** Owner-confirmed at both service and endpoint level; certification needs it, binding does not. */
  ratified: boolean
}

export interface RefusedRuntime {
  ok: false
  refusal: RuntimeRefusal
  detail: string
}

export type RuntimeBindingResult = BoundRuntime | RefusedRuntime

export interface RuntimeBindingInput {
  projectId: number | null
  services: readonly ServiceResourceLike[]
  endpoints: readonly ServiceEndpointLike[]
  node: string
  /** A resourceKey or relationship; defaults to the workspace-runtime relationship. */
  serviceSelector?: string | null
}

/**
 * Bind the W1 runtime, or refuse with a reason. Belonging is proven, not inferred from a header.
 */
export function bindW1Runtime(input: RuntimeBindingInput): RuntimeBindingResult {
  if (input.projectId == null) {
    return refuse("NO_PROJECT", "W1 runtime binding requires a bound Project")
  }

  const selector = input.serviceSelector?.trim() || WORKSPACE_RUNTIME_RELATIONSHIP
  const candidates = input.services.filter(
    (s) => s.type === "service" && (s.resourceKey === selector || s.relationship === selector),
  )

  if (candidates.length === 0) {
    return refuse(
      "NO_WORKSPACE_RUNTIME",
      `Project ${input.projectId} has no service resource matching "${selector}"`,
    )
  }
  if (candidates.length > 1) {
    return refuse(
      "AMBIGUOUS_WORKSPACE_RUNTIME",
      `Project ${input.projectId} has ${candidates.length} "${selector}" service resources (ids ${candidates
        .map((s) => s.id)
        .join(", ")}); exactly one is required`,
    )
  }

  const service = candidates[0]
  const endpoint = input.endpoints.find(
    (e) => e.projectResourceId === service.id && e.node === input.node,
  )
  if (!endpoint) {
    return refuse(
      "NOT_SERVED_ON_NODE",
      `Service ${service.id} is not served on ${input.node}`,
    )
  }

  if (endpoint.observedProjectId == null) {
    // Belonging is unproven: the endpoint has never reported which Project it serves. Appearance is
    // not belonging, so this refuses rather than admitting on a header.
    return refuse(
      "RUNTIME_NOT_OBSERVED",
      `Endpoint ${endpoint.endpoint} on ${input.node} has not been observed reporting its Project`,
    )
  }

  if (endpoint.observedProjectId !== input.projectId) {
    return refuse(
      "RUNTIME_PROJECT_MISMATCH",
      `Endpoint ${endpoint.endpoint} on ${input.node} reports project ${endpoint.observedProjectId}, not ${input.projectId}`,
    )
  }

  return {
    ok: true,
    endpoint: endpoint.endpoint,
    node: input.node,
    projectId: input.projectId,
    resourceId: service.id,
    observedRevision: endpoint.observedRevision,
    ratified: service.ratifiedAt != null && endpoint.ratifiedAt != null,
  }
}

function refuse(refusal: RuntimeRefusal, detail: string): RefusedRuntime {
  return { ok: false, refusal, detail }
}
