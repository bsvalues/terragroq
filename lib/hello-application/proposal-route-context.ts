import path from "node:path"

import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import { resolveCanonicalWorkspaceProjectBinding } from "@/lib/projects/workspace-project-binding"
import { getSession } from "@/lib/session"

type ProposalRouteContext = Readonly<{
  userId: string
  repositoryRoot: string
  runtimeRoot: string
}>

export type ProposalRouteContextResult =
  | Readonly<{ ok: true; context: ProposalRouteContext }>
  | Readonly<{ ok: false; response: Response }>

const reply = (value: unknown, status: number) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

export async function resolveHelloProposalRouteContext(): Promise<ProposalRouteContextResult> {
  const session = await getSession()
  if (!session) return { ok: false, response: reply({ error: "UNAUTHENTICATED" }, 401) }
  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  const owner = assertOwner(session.user.id, ownerId)
  if (!owner.ok) {
    return {
      ok: false,
      response: reply({ error: owner.failure, detail: owner.detail }, owner.failure === "NOT_OWNER" ? 403 : 409),
    }
  }
  const runtimeRoot = process.env.WILLIAMOS_HERMES_RUNTIME_ROOT?.trim()
  if (!runtimeRoot || !path.isAbsolute(runtimeRoot)) {
    return { ok: false, response: reply({ error: "HERMES_RUNTIME_ROOT_NOT_CONFIGURED" }, 503) }
  }
  const binding = await resolveCanonicalWorkspaceProjectBinding(session.user.id, "hello-application")
  if (!binding.ok) return { ok: false, response: reply({ error: binding.error }, 503) }
  const helloRoot = path.resolve(binding.binding.workspaceRoot)
  if (path.basename(helloRoot) !== "hello-application" || path.basename(path.dirname(helloRoot)) !== "examples") {
    return { ok: false, response: reply({ error: "HELLO_APPLICATION_ROOT_INVALID" }, 503) }
  }
  return {
    ok: true,
    context: {
      userId: session.user.id,
      repositoryRoot: path.dirname(path.dirname(helloRoot)),
      runtimeRoot: path.resolve(runtimeRoot),
    },
  }
}

export function helloProposalError(error: unknown): Response {
  const code = error instanceof Error ? error.message : "HELLO_PROPOSAL_UNAVAILABLE"
  const status = code === "HELLO_PROPOSAL_NOT_FOUND" ? 404
    : code.includes("OWNER_MISMATCH") ? 403
      : /(?:STALE|DIRTY|NOT_APPLICABLE)/.test(code) ? 409
        : /(?:PATH_|MULTI_FILE|IGNORED_|PATCH_SIZE|RENAME_|REQUEST_INVALID|NO_CHANGE|VALIDATION_)/.test(code) ? 422
          : 503
  return reply({ error: code }, status)
}
