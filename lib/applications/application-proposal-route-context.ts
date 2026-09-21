import path from "node:path"

import { applicationReply, resolveApplicationRouteContext, type ApplicationRouteContext } from "./application-route-context"
import { isApplicationProposalErrorCode } from "./application-proposal-error-codes"
import { resolveApplicationProposalRuntimeRoot } from "./proposal-runtime-root.mjs"

export type ApplicationProposalRouteContext = ApplicationRouteContext & Readonly<{ runtimeRoot: string }>

export async function resolveApplicationProposalRouteContext(projectKey: unknown): Promise<
  Readonly<{ ok: true; context: ApplicationProposalRouteContext }> | Readonly<{ ok: false; response: Response }>
> {
  const resolved = await resolveApplicationRouteContext(projectKey)
  if (!resolved.ok) return resolved
  const configured = process.env.WILLIAMOS_APPLICATION_RUNTIME_ROOT?.trim()
  if (!configured || !path.isAbsolute(configured) || configured.includes("\0")) {
    return { ok: false, response: applicationReply({ error: "APPLICATION_RUNTIME_ROOT_NOT_CONFIGURED" }, 503) }
  }
  try {
    const runtimeRoot = resolveApplicationProposalRuntimeRoot(path.resolve(configured), resolved.context.application.repositoryRoot)
    return { ok: true, context: { ...resolved.context, runtimeRoot } }
  } catch {
    return { ok: false, response: applicationReply({ error: "APPLICATION_RUNTIME_ROOT_INVALID" }, 503) }
  }
}

export function applicationProposalErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "APPLICATION_PROPOSAL_UNAVAILABLE"
  const code = error.message.split(":", 1)[0]
  return isApplicationProposalErrorCode(code) ? code : "APPLICATION_PROPOSAL_UNAVAILABLE"
}

export function applicationProposalError(error: unknown): Response {
  const code = applicationProposalErrorCode(error)
  const status = code === "APPLICATION_PROPOSAL_NOT_FOUND" ? 404
    : ["APPLICATION_PROPOSAL_REQUEST_INVALID", "APPLICATION_PROPOSAL_REJECTION_INVALID", "APPLICATION_EXECUTION_ROUTE_INVALID"].includes(code) ? 400
      : code === "APPLICATION_PROPOSAL_OWNER_MISMATCH" ? 403
        : /(?:STALE|DIRTY|NOT_APPLICABLE|REPOSITORY_BUSY|QUARANTINED)/.test(code) ? 409
          : /(?:PATH_|IGNORED_|PATCH_SIZE|PATCH_SCOPE|RENAME_|NO_CHANGE|VALIDATION_|SECRET_DETECTED|MANIFEST_DRIFT)/.test(code) ? 422
            : 503
  return applicationReply({ error: code }, status)
}
