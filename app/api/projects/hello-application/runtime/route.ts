import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import {
  getHelloApplicationRuntime,
  startHelloApplicationRuntime,
  stopHelloApplicationRuntime,
} from "@/lib/hello-application/runtime-supervisor"
import { resolveCanonicalWorkspaceProjectBinding } from "@/lib/projects/workspace-project-binding"
import { getSession } from "@/lib/session"
import { guardHelloApplicationMutation } from "@/lib/hello-application/mutation-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

async function authorizeOwner() {
  const session = await getSession()
  if (!session) return { ok: false as const, response: reply({ error: "UNAUTHENTICATED" }, 401) }
  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  const owner = assertOwner(session.user.id, ownerId)
  if (!owner.ok) {
    return {
      ok: false as const,
      response: reply({ error: owner.failure, detail: owner.detail }, owner.failure === "NOT_OWNER" ? 403 : 409),
    }
  }
  return { ok: true as const, userId: session.user.id }
}

export async function GET() {
  const authorization = await authorizeOwner()
  if (!authorization.ok) return authorization.response
  return reply({ runtime: getHelloApplicationRuntime() })
}

export async function POST(request: Request) {
  const rejection = guardHelloApplicationMutation(request)
  if (rejection) return rejection
  const authorization = await authorizeOwner()
  if (!authorization.ok) return authorization.response
  const binding = await resolveCanonicalWorkspaceProjectBinding(authorization.userId, "hello-application")
  if (!binding.ok) return reply({ error: binding.error }, 503)
  try {
    return reply({ runtime: await startHelloApplicationRuntime({ workspaceRoot: binding.binding.workspaceRoot }) })
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "HELLO_APPLICATION_START_FAILED" }, 503)
  }
}

export async function DELETE(request: Request) {
  const rejection = guardHelloApplicationMutation(request)
  if (rejection) return rejection
  const authorization = await authorizeOwner()
  if (!authorization.ok) return authorization.response
  return reply({ runtime: await stopHelloApplicationRuntime() })
}
